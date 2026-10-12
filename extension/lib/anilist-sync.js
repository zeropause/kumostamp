/**
 * Pushes finished episodes to the viewer's AniList list. Background worker only.
 *
 * An episode that starts playing (or finishes) becomes a job in a small queue. Jobs are worked one at a time:
 * read the list entry, ask KS.anilistPlan what to send (it never lowers progress), send it,
 * and keep enough of the old entry to undo it. Network trouble leaves the job queued for a retry.
 */
const KSAnilistSync = (() => {
  const KEY = "ks:anilist-sync"; // { queue: [job], last: { mediaId: progress }, undo: {...} | null }
  const ALARM = "ks-anilist-retry";
  const GRAPHQL = "https://graphql.anilist.co";
  const MAX_TRIES = 6;
  const WAIT_FOR_LINK_MS = 10 * 60 * 1000; // a brand-new series may not be matched to a catalog entry yet

  let deps = null; // { readDb, getSettings, notify(tabId, info) }
  let chain = Promise.resolve();

  const init = (d) => { deps = d; };

  async function load() {
    const got = await chrome.storage.local.get(KEY);
    return Object.assign({ queue: [], last: {}, undo: null }, got[KEY]);
  }
  const save = (state) => chrome.storage.local.set({ [KEY]: state });

  /** Run `fn` after everything queued before it, so storage is never written by two jobs at once. */
  function serial(fn) {
    const next = chain.then(fn);
    chain = next.catch(() => {});
    return next;
  }

  class ApiError extends Error {
    constructor(kind, message) { super(message); this.kind = kind; }
  }

  async function gql(token, query, variables) {
    let res;
    try {
      res = await fetch(GRAPHQL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ query, variables }),
      });
    } catch (_) {
      throw new ApiError("retry", "Could not reach AniList.");
    }
    if (res.status === 401) throw new ApiError("auth", "AniList rejected the login.");
    if (res.status === 429 || res.status >= 500) throw new ApiError("retry", `AniList answered ${res.status}.`);
    const json = await res.json().catch(() => null);
    if (!res.ok || !json || json.errors) {
      const first = json && json.errors && json.errors[0];
      if (first && first.status === 401) throw new ApiError("auth", "AniList rejected the login.");
      throw new ApiError("fatal", (first && first.message) || `AniList answered ${res.status}.`);
    }
    return json.data;
  }

  const ENTRY_QUERY = "query ($id: Int) { Media(id: $id, type: ANIME) { id mediaListEntry { id progress status } } }";
  const SAVE_MUTATION = `mutation ($mediaId: Int, $progress: Int, $status: MediaListStatus) {
    SaveMediaListEntry(mediaId: $mediaId, progress: $progress, status: $status) { id progress status } }`;
  const DELETE_MUTATION = "mutation ($id: Int) { DeleteMediaListEntry(id: $id) { deleted } }";

  /** Queue an episode that started or finished (`job.phase`). `tabId` is told when it lands. */
  function enqueue(job) {
    return serial(async () => {
      const state = await load();
      const dup = state.queue.some((j) => j.key === job.key && j.ep === job.ep && j.phase === job.phase);
      if (!dup) state.queue.push(Object.assign({ at: Date.now(), tries: 0 }, job));
      await save(state);
    }).then(run);
  }

  /** Work the queue. Safe to call any time; calls are serialised. */
  function run() {
    return serial(async () => {
      if (!deps) return;
      const settings = await deps.getSettings();
      const token = await KSAccounts.anilistToken();
      const state = await load();
      if (!state.queue.length) return;
      if (!settings.anilistSync || !token) {
        state.queue = [];
        return save(state);
      }
      const first = state.queue[0];
      const keep = [];
      let retryIn = 0;
      let authLost = false;
      for (const job of state.queue) {
        if (authLost) break;
        try {
          const outcome = await work(state, token, job);
          if (outcome === "wait") keep.push(job);
        } catch (e) {
          if (e.kind === "auth") {
            authLost = true;
          } else if (e.kind === "retry" && ++job.tries < MAX_TRIES) {
            keep.push(job);
            retryIn = Math.max(retryIn, Math.min(30, 2 * job.tries * job.tries));
          } else {
            deps.notify(job.tabId, { ok: false, title: job.title || "", error: e.message });
          }
        }
      }
      state.queue = authLost ? [] : keep;
      if (authLost) {
        await KSAccounts.invalidateAnilist();
        deps.notify(first && first.tabId, { ok: false, error: "AniList login expired. Reconnect in the Kumostamp popup." });
      }
      await save(state);
      if (keep.length && !authLost) chrome.alarms.create(ALARM, { delayInMinutes: retryIn || 1 });
    });
  }

  /** One job. Returns "wait" to keep it for later without counting a failed try. */
  async function work(state, token, job) {
    const db = await deps.readDb();
    const series = db.series[job.key] || db.series[KS.resolveKey(db, job.key)];
    const ep = series && series.episodes[job.ep];
    if (!ep) return "done";
    const meta = series.meta;
    if ((!meta || !meta.source) && Date.now() - job.at < WAIT_FOR_LINK_MS) return "wait";

    const phase = job.phase === "finish" ? "finish" : "start";
    const plan0 = KS.anilistPlan(series, ep.episode, null, phase);
    if (plan0.skip) return "done";
    // Playing sends an update once per episode; no need to ask AniList again for each save.
    if (phase === "start" && (state.last[plan0.mediaId] || 0) >= plan0.progress) return "done";

    const data = await gql(token, ENTRY_QUERY, { id: plan0.mediaId });
    const current = data.Media && data.Media.mediaListEntry;
    const plan = KS.anilistPlan(series, ep.episode, current, phase);
    if (plan.skip) {
      state.last[plan0.mediaId] = Math.max(state.last[plan0.mediaId] || 0, current ? current.progress : 0);
      return "done";
    }
    const saved = (await gql(token, SAVE_MUTATION, { mediaId: plan.mediaId, progress: plan.progress, status: plan.status })).SaveMediaListEntry;
    state.last[plan.mediaId] = plan.progress;
    state.undo = {
      mediaId: plan.mediaId,
      entryId: saved.id,
      title: series.title,
      progress: plan.progress,
      total: Number(meta.episodes) || null,
      prev: current ? { progress: current.progress, status: current.status } : null,
      at: Date.now(),
    };
    deps.notify(job.tabId, { ok: true, title: series.title, progress: plan.progress, total: Number(meta.episodes) || null, status: plan.status });
    return "done";
  }

  /** Put the entry back the way it was before the last push. */
  function undo() {
    return serial(async () => {
      const state = await load();
      const u = state.undo;
      if (!u) throw new Error("Nothing to undo.");
      const token = await KSAccounts.anilistToken();
      if (!token) throw new Error("AniList is not connected.");
      if (u.prev) {
        await gql(token, SAVE_MUTATION, { mediaId: u.mediaId, progress: u.prev.progress, status: u.prev.status });
      } else {
        await gql(token, DELETE_MUTATION, { id: u.entryId });
      }
      // Keep `last` so this same episode is not pushed again by the next save.
      state.undo = null;
      await save(state);
      return { title: u.title, progress: u.progress };
    });
  }

  async function lastPush() {
    const u = (await load()).undo;
    return u ? { title: u.title, progress: u.progress, total: u.total, at: u.at } : null;
  }

  return { init, enqueue, run, undo, lastPush, ALARM };
})();
