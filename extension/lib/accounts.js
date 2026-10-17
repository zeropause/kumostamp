/**
 * Connected accounts (AniList). Runs only in the background worker, which is the one place
 * that holds tokens. The website's login page hands the token over once; after that it never
 * reaches the popup, the website, or an export.
 */
const KSAccounts = (() => {
  const KEY = "ks:accounts";
  const GRAPHQL = "https://graphql.anilist.co";

  async function read() {
    const got = await chrome.storage.local.get(KEY);
    return got[KEY] || {};
  }

  const write = (all) => chrome.storage.local.set({ [KEY]: all });

  /** What the UI may know: who is connected, never the token. */
  async function status() {
    const a = (await read()).anilist;
    const expired = !!(a && a.expiresAt && a.expiresAt < Date.now());
    return {
      anilist: a && !expired ? { user: a.user, connectedAt: a.connectedAt } : null,
      anilistExpired: expired,
    };
  }

  async function viewer(token) {
    const res = await fetch(GRAPHQL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ query: "{ Viewer { id name } }" }),
    });
    if (res.status === 401) throw new Error("AniList rejected the login. Try connecting again.");
    if (!res.ok) throw new Error(`AniList answered ${res.status}.`);
    const json = await res.json();
    if (!json.data || !json.data.Viewer) throw new Error("AniList did not say who you are.");
    return json.data.Viewer;
  }

  /** Keep a token from the website's AniList login (implicit grant), after AniList confirms whose it is. */
  async function saveAnilistToken(token, expiresIn) {
    if (typeof token !== "string" || !token) throw new Error("AniList did not return a token.");
    const user = await viewer(token);
    const all = await read();
    all.anilist = {
      token,
      user: { id: user.id, name: user.name },
      connectedAt: Date.now(),
      expiresAt: Number(expiresIn) > 0 ? Date.now() + Number(expiresIn) * 1000 : 0,
    };
    await write(all);
    return all.anilist.user;
  }

  async function disconnectAnilist() {
    const all = await read();
    delete all.anilist;
    await write(all);
  }

  /** AniList refused the token: show "Login expired" until the user reconnects. */
  async function invalidateAnilist() {
    const all = await read();
    if (all.anilist) all.anilist.expiresAt = 1;
    await write(all);
  }

  /** For the sync code in the worker only. Null when not connected or expired. */
  async function anilistToken() {
    const a = (await read()).anilist;
    if (!a || (a.expiresAt && a.expiresAt < Date.now())) return null;
    return a.token;
  }

  return { status, saveAnilistToken, disconnectAnilist, anilistToken, invalidateAnilist };
})();
