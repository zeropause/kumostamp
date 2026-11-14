/**
 * Discord Rich Presence. Background worker only.
 *
 * The extension cannot open Discord's IPC socket, so this module describes what
 * is playing and POSTs it to the local helper (helper/index.mjs), which owns the
 * Discord connection. Nothing here blocks a save: every call is fire-and-forget.
 */
const KSPresence = (() => {
  const HELPER = "http://127.0.0.1:47834";
  const TOKEN_KEY = "ks:discord"; // { token }: worker-only, never part of ks:settings
  const DEBOUNCE_MS = 1500;
  const MIN_INTERVAL_MS = 15000; // Discord rate-limits activity updates
  const MIN_FORCE_MS = 1000; // pause / episode change may jump the queue
  const MIN_PLAY_SEC = 30; // previews and accidental plays do not count
  const LIVE_WINDOW_MS = 120000; // a silent tab stops being a candidate

  let deps = null; // { readDb, getSettings }
  const tabs = new Map(); // tabId -> { tab, id, at }
  let timer = null;
  let pendingForce = false;
  let inFlight = false;
  let lastAttempt = 0;
  let lastSentJson = "";
  let lastSentAt = 0;
  let lastSentOk = false;
  let lastKey = "";
  let lastError = "";
  let current = null;
  let health = { at: 0, ok: false, discord: "unknown", user: null };
  let tokenPromise = null;

  const init = (d) => {
    deps = d;
  };

  function token() {
    if (!tokenPromise) {
      tokenPromise = (async () => {
        const got = await chrome.storage.local.get(TOKEN_KEY);
        const saved = got[TOKEN_KEY];
        if (saved && saved.token) return saved.token;
        const fresh = { token: crypto.randomUUID() };
        await chrome.storage.local.set({ [TOKEN_KEY]: fresh });
        return fresh.token;
      })();
    }
    return tokenPromise;
  }

  async function checkHealth(force) {
    if (!deps) return health;
    const now = Date.now();
    if (!force && now - health.at < MIN_INTERVAL_MS) return health;
    try {
      const t = await token();
      const res = await fetch(`${HELPER}/health?token=${encodeURIComponent(t)}`);
      const body = await res.json().catch(() => ({}));
      health = { at: now, ok: !!res.ok && !!body.ok, discord: body.discord || "unknown", user: body.user || null };
    } catch (_) {
      health = { at: now, ok: false, discord: "offline", user: null };
    }
    return health;
  }

  const epOf = (id) => (id ? `${id.series}|${id.episode == null ? "" : id.episode}` : "");

  /** Only a confident detection or the user's own correction is worth publishing. */
  function publishable(id) {
    if (!id || !id.series) return false;
    if (id.corrected) return true;
    return (id.confidence === "high" || id.confidence === "medium") && id.kind !== "unknown";
  }

  /** The most recently updated playing tab; a paused one only when nothing plays. */
  function candidate() {
    const now = Date.now();
    let playing = null;
    let paused = null;
    for (const [tabId, entry] of tabs) {
      if (now - entry.at > LIVE_WINDOW_MS) {
        tabs.delete(tabId);
        continue;
      }
      const video = entry.tab && entry.tab.video;
      if (!video) continue;
      if (!video.paused && !video.ended) {
        if (!playing || entry.at > playing.at) playing = entry;
      } else if (!paused || entry.at > paused.at) paused = entry;
    }
    return playing || paused;
  }

  async function buildState(settings) {
    const entry = candidate();
    if (!entry || !publishable(entry.id)) return null;
    const video = entry.tab && entry.tab.video;
    if (!video || (video.time || 0) < MIN_PLAY_SEC) return null;

    const id = entry.id;
    const db = await deps.readDb();
    const hit = KS.findEntry(db, id.series, id.episode);
    const series = hit && hit.series;
    const url = (entry.tab.meta && entry.tab.meta.url) || video.frameUrl || "";
    return {
      v: 1,
      title: (series && series.title) || id.series,
      episode: id.episode == null ? null : Number(id.episode),
      seriesKey: (series && series.key) || KS.seriesKey(id.series),
      position: Math.round(video.time || 0),
      duration: Math.round(video.duration || 0),
      paused: !!video.paused,
      ended: !!video.ended,
      host: KS.hostOf(url),
      url,
      episodeCount: (series && series.meta && Number(series.meta.episodes)) || 0,
      poster: (series && series.meta && series.meta.image) || "",
      libraryUrl: settings.libraryUrl || "",
      showTitle: settings.discordShowTitle !== false,
      showTime: settings.discordShowTime !== false,
    };
  }

  async function flush(force) {
    if (!deps) return;
    if (inFlight) {
      schedule(DEBOUNCE_MS);
      return;
    }
    inFlight = true;
    try {
      const settings = await deps.getSettings();
      const state = settings.discordRpc ? await buildState(settings) : null;
      current = state;

      const json = JSON.stringify(state);
      const key = state ? [state.seriesKey, state.episode, state.paused, state.ended].join("|") : "null";
      const now = Date.now();
      // The same payload can be skipped only if it actually reached the helper:
      // a helper that was down at the time must get it on the next attempt.
      if (json === lastSentJson && lastSentOk && now - lastSentAt < 60000) return;

      const urgent = force && key !== lastKey;
      const floor = urgent ? MIN_FORCE_MS : MIN_INTERVAL_MS;
      if (now - lastAttempt < floor) {
        schedule(floor - (now - lastAttempt), urgent);
        return;
      }
      lastAttempt = now;

      const t = await token();
      const res = await fetch(`${HELPER}/presence`, {
        method: "POST",
        body: JSON.stringify({ token: t, state }),
      });
      if (!res.ok) throw new Error(`helper answered ${res.status}`);
      const body = await res.json().catch(() => ({}));
      lastSentJson = json;
      lastSentAt = Date.now();
      lastSentOk = true;
      lastKey = key;
      lastError = body.warning || "";
      health = { at: Date.now(), ok: true, discord: body.discord || health.discord, user: health.user };
    } catch (e) {
      lastSentOk = false;
      lastError = String((e && e.message) || e);
      health = { at: Date.now(), ok: false, discord: "offline", user: null };
    } finally {
      inFlight = false;
    }
  }

  function schedule(delay = DEBOUNCE_MS, force = false) {
    if (!deps) return;
    pendingForce = pendingForce || force;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const f = pendingForce;
      pendingForce = false;
      flush(f);
    }, Math.max(0, delay));
  }

  /**
   * Called after every `video` / `meta` message. `tab` is the live background
   * object, so the previous play state is snapshotted here: comparing against the
   * stored reference would always say "still playing".
   */
  function note(tabId, tab, id) {
    if (!deps || typeof tabId !== "number" || !tab) return;
    const video = tab.video;
    const before = tabs.get(tabId);
    const nowPlaying = !!video && !video.paused && !video.ended;
    const episode = epOf(id);
    tabs.set(tabId, { tab, id: id || null, at: Date.now(), playing: nowPlaying, episode });

    // Pausing, resuming and switching episodes are worth showing immediately:
    // they are what the viewer (and their friends) actually watch change.
    const changed = !!before && (before.playing !== nowPlaying || (!!before.episode && before.episode !== episode));
    schedule(DEBOUNCE_MS, changed);
  }

  function clear(tabId) {
    if (typeof tabId === "number") tabs.delete(tabId);
    schedule(0, true);
  }

  function refresh() {
    schedule(0, true);
  }

  function libraryChanged() {
    schedule();
  }

  async function status(force) {
    if (!deps) return { enabled: false, helper: { ok: false, discord: "unknown" }, live: null, error: "" };
    const settings = await deps.getSettings();
    const h = await checkHealth(!!force);
    return {
      enabled: !!settings.discordRpc,
      helper: { ok: h.ok, discord: h.discord },
      live: current
        ? { title: current.title, episode: current.episode, paused: current.paused, ended: current.ended }
        : null,
      error: lastError || "",
    };
  }

  return { init, note, clear, refresh, libraryChanged, status };
})();
