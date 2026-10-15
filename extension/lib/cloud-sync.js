/**
 * Keeps this extension's database merged with the user's Kumostamp account. Background worker only.
 *
 * Connecting opens the library's /extension/connect page in a sign-in window; allowing it there
 * returns a one-time code, traded for a device token that never leaves this worker.
 * A sync pulls the server copy (cheaply, when it hasn't changed), pushes local marks the server
 * lacks, and imports what the server has that this copy lacks. Merging is KS.applyOp "import":
 * newest mark wins per episode and deletions stick, the same rules as the website and server.
 */
const KSCloud = (() => {
  const KEY = "ks:cloud"; // { base, token, user, connectedAt, lastSyncAt, error, expired }
  const SERVER_KEY = "ks:cloud-server"; // { rev, db }: the server copy at the last sync
  const PULL_ALARM = "ks-cloud-pull";
  const PUSH_ALARM = "ks-cloud-push";
  const PULL_EVERY_MIN = 2;
  const PUSH_DELAY_MIN = 0.5; // the shortest alarm Chrome allows

  let deps = null; // { readDb, mutate, getSettings }
  let chain = Promise.resolve();

  const init = (d) => { deps = d; };

  async function read() {
    const got = await chrome.storage.local.get(KEY);
    return got[KEY] || null;
  }
  const write = (c) => chrome.storage.local.set({ [KEY]: c });

  function serial(fn) {
    const next = chain.then(fn);
    chain = next.catch(() => {});
    return next;
  }

  /** The library's origin, from the Library address setting. */
  async function baseUrl() {
    const { libraryUrl } = await deps.getSettings();
    try {
      return new URL(libraryUrl).origin;
    } catch (_) {
      throw new Error("Set the Library address first.");
    }
  }

  /** What the popup may know: never the token. */
  async function status() {
    const c = await read();
    let base = "";
    try { base = await baseUrl(); } catch (_) { /* unset */ }
    if (!c) return { connected: false, base };
    return { connected: true, base: c.base, user: c.user, lastSyncAt: c.lastSyncAt || 0, error: c.error || "", expired: !!c.expired };
  }

  async function connect() {
    const base = await baseUrl();
    const redirect = chrome.identity.getRedirectURL("kumostamp");
    const state = crypto.randomUUID();
    const url = `${base}/extension/connect?${new URLSearchParams({ redirect_uri: redirect, state })}`;
    let back;
    try {
      back = await chrome.identity.launchWebAuthFlow({ url, interactive: true });
    } catch (e) {
      const msg = String((e && e.message) || e);
      if (/did not approve|canceled|cancelled|closed/i.test(msg)) throw new Error("Connecting was cancelled.");
      throw new Error(`Could not open ${base}: ${msg}`);
    }
    const params = new URLSearchParams(new URL(back).hash.replace(/^#/, ""));
    if (params.get("state") !== state) throw new Error("That answer wasn't for this request. Try again.");
    if (params.get("error")) throw new Error("Connecting was cancelled.");
    const code = params.get("code");
    if (!code) throw new Error("The library did not send a code back.");

    let res;
    try {
      res = await fetch(`${base}/api/extension/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ code, redirect, label: navigator.userAgent.includes("Edg/") ? "Edge extension" : "Chrome extension" }),
      });
    } catch (_) {
      throw new Error(`Could not reach ${base}.`);
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.token) throw new Error(body.error || `The library answered ${res.status}.`);

    await chrome.storage.local.remove(SERVER_KEY);
    await write({ base, token: body.token, user: body.user, connectedAt: Date.now(), lastSyncAt: 0, error: "" });
    schedule();
    await sync().catch(() => {}); // the outcome shows in status()
    return status();
  }

  async function disconnect() {
    const c = await read();
    if (c && c.token) {
      // A JSON body: bodiless cross-origin POSTs are refused as possible CSRF.
      fetch(`${c.base}/api/extension/disconnect`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${c.token}` },
        body: "{}",
      }).catch(() => {});
    }
    await chrome.storage.local.remove([KEY, SERVER_KEY]);
    await chrome.alarms.clear(PULL_ALARM);
    await chrome.alarms.clear(PUSH_ALARM);
    return status();
  }

  class AuthError extends Error {}

  async function api(c, path, init) {
    let res;
    try {
      res = await fetch(c.base + path, {
        ...init,
        headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${c.token}` },
      });
    } catch (_) {
      throw new Error(`Could not reach ${c.base}.`);
    }
    if (res.status === 401) throw new AuthError("The account no longer knows this extension. Connect again.");
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `The library answered ${res.status}.`);
    return body;
  }

  /** Would merging `other` into `base` change it? */
  function adds(base, other) {
    const merged = KS.applyOp(structuredClone(base), { type: "import", db: structuredClone(other) });
    return KS.dbSignature(merged) !== KS.dbSignature(base);
  }

  function sync() {
    return serial(async () => {
      const c = await read();
      if (!c || !c.token || c.expired) return;
      try {
        let server = (await chrome.storage.local.get(SERVER_KEY))[SERVER_KEY] || null;
        const got = await api(c, `/api/library${server ? `?since=${server.rev}` : ""}`);
        if (!got.unchanged) server = { rev: got.rev, db: got.db };

        const local = await deps.readDb();
        if (adds(server.db, local)) {
          const res = await api(c, "/api/library/merge", { method: "POST", body: JSON.stringify({ db: local }) });
          server = { rev: res.rev, db: res.db };
        }
        await chrome.storage.local.set({ [SERVER_KEY]: server });
        // The website may have written in the meantime; mutate re-reads, so nothing is lost.
        if (adds(await deps.readDb(), server.db)) await deps.mutate({ type: "import", db: server.db, fromCloud: true });
        await write(Object.assign(c, { lastSyncAt: Date.now(), error: "" }));
      } catch (e) {
        const expired = e instanceof AuthError;
        await write(Object.assign(c, { error: e.message || String(e), expired }));
        throw e;
      }
    });
  }

  /** Periodic pulls, so marks from other browsers arrive without opening anything. */
  function schedule() {
    chrome.alarms.get(PULL_ALARM, (a) => {
      if (!a) chrome.alarms.create(PULL_ALARM, { periodInMinutes: PULL_EVERY_MIN, delayInMinutes: PULL_EVERY_MIN });
    });
  }

  /**
   * After a local change: push within half a minute. The alarm is not pushed back by
   * further changes, so marks saved every few seconds while watching still go up.
   */
  async function soon(op) {
    if (op && op.fromCloud) return;
    const c = await read();
    if (!c || !c.token || c.expired) return;
    const pending = await chrome.alarms.get(PUSH_ALARM);
    if (!pending) chrome.alarms.create(PUSH_ALARM, { delayInMinutes: PUSH_DELAY_MIN });
  }

  function onAlarm(name) {
    if (name === PULL_ALARM || name === PUSH_ALARM) sync().catch(() => {});
  }

  /** Worker start or browser start: catch up, and make sure the pull alarm exists. */
  async function wake() {
    if (!(await read())) return;
    schedule();
    sync().catch(() => {});
  }

  return { init, status, connect, disconnect, sync, soon, onAlarm, wake };
})();
