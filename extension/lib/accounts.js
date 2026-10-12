/**
 * Connected accounts (AniList). Runs only in the background worker, which is the one place
 * that holds tokens. The token never reaches the popup, the website, or an export.
 */
const KSAccounts = (() => {
  const KEY = "ks:accounts";
  const AUTH_URL = "https://anilist.co/api/v2/oauth/authorize";
  const GRAPHQL = "https://graphql.anilist.co";

  /** Where AniList sends the browser back to. Register this exact URL with the API client. */
  const redirectUrl = () => chrome.identity.getRedirectURL();

  async function read() {
    const got = await chrome.storage.local.get(KEY);
    return got[KEY] || {};
  }

  const write = (all) => chrome.storage.local.set({ [KEY]: all });

  /** What the UI may know: who is connected, never the token. */
  async function status(clientId) {
    const a = (await read()).anilist;
    const expired = !!(a && a.expiresAt && a.expiresAt < Date.now());
    return {
      redirectUrl: redirectUrl(),
      hasClientId: !!clientId,
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

  /** Implicit grant: AniList returns the token in the URL fragment, no client secret involved. */
  async function connectAnilist(clientId) {
    if (!clientId) throw new Error("Add your AniList client ID first.");
    const url = `${AUTH_URL}?client_id=${encodeURIComponent(clientId)}&response_type=token`;
    let back;
    try {
      back = await chrome.identity.launchWebAuthFlow({ url, interactive: true });
    } catch (e) {
      const msg = String((e && e.message) || e);
      if (/did not approve|canceled|cancelled|closed/i.test(msg)) throw new Error("Login was cancelled.");
      throw new Error(`Could not open AniList login: ${msg}`);
    }
    const hash = new URL(back).hash.replace(/^#/, "");
    const params = new URLSearchParams(hash);
    const token = params.get("access_token");
    if (!token) throw new Error(params.get("error_description") || "AniList did not return a token.");
    const expiresIn = Number(params.get("expires_in")) || 0;
    const user = await viewer(token);
    const all = await read();
    all.anilist = {
      token,
      user: { id: user.id, name: user.name },
      connectedAt: Date.now(),
      expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : 0,
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

  return { status, connectAnilist, disconnectAnilist, anilistToken, invalidateAnilist, redirectUrl };
})();
