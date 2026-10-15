/*
 * Sign in with MyAnimeList: OAuth 2 authorization code + PKCE.
 * MAL accepts only code_challenge_method=plain, so the challenge is the verifier itself;
 * the client secret (server only) is what protects the exchange.
 */
import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { encrypt, randomToken } from "./crypto";
import { currentUser, endSession, secureCookies, startSession } from "./session";

const AUTHORIZE = "https://myanimelist.net/v1/oauth2/authorize";
const TOKEN = "https://myanimelist.net/v1/oauth2/token";
const ME = "https://api.myanimelist.net/v2/users/@me";
const FLOW_COOKIE = "ks_mal_flow";
const NEXT_COOKIE = "ks_mal_next";

/** Only paths inside this app: "/x", never "//host" or "https://...". */
const safeNext = (next: string | undefined) => (next && /^\/(?![/\\])/.test(next) ? next : "/");

interface MalTokens {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

const auth = new Hono<{ Bindings: Env }>();

const callbackUrl = (reqUrl: string) => new URL("/api/auth/mal/callback", reqUrl).toString();

/** Back to the SPA's login page with a message it can show. */
const fail = (c: Context<{ Bindings: Env }>, message: string) => c.redirect(`/login?${new URLSearchParams({ error: message })}`);

auth.get("/mal/login", (c) => {
  if (!c.env.MAL_CLIENT_ID) return fail(c, "MyAnimeList login isn't set up on this server yet (MAL_CLIENT_ID).");
  const state = randomToken(16);
  const verifier = randomToken(64); // 86 characters; MAL wants 43–128
  setCookie(c, FLOW_COOKIE, `${state}.${verifier}`, {
    path: "/api/auth/mal",
    httpOnly: true,
    secure: secureCookies(c),
    sameSite: "Lax",
    maxAge: 600,
  });
  const next = safeNext(c.req.query("next"));
  if (next !== "/") setCookie(c, NEXT_COOKIE, next, { path: "/api/auth/mal", httpOnly: true, secure: secureCookies(c), sameSite: "Lax", maxAge: 600 });
  else deleteCookie(c, NEXT_COOKIE, { path: "/api/auth/mal", secure: secureCookies(c) });
  const url = new URL(AUTHORIZE);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: c.env.MAL_CLIENT_ID,
    redirect_uri: callbackUrl(c.req.url),
    state,
    code_challenge: verifier,
    code_challenge_method: "plain",
  }).toString();
  return c.redirect(url.toString());
});

auth.get("/mal/callback", async (c) => {
  const flow = getCookie(c, FLOW_COOKIE) || "";
  deleteCookie(c, FLOW_COOKIE, { path: "/api/auth/mal", secure: secureCookies(c) });
  const [state, verifier] = flow.split(".");
  const q = c.req.query();
  if (q.error) return fail(c, q.error === "access_denied" ? "Login was cancelled." : `MyAnimeList said: ${q.error_description || q.error}`);
  if (!state || !verifier || q.state !== state || !q.code) return fail(c, "The login took too long or was started elsewhere. Try again.");

  const tokenRes = await fetch(TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: c.env.MAL_CLIENT_ID,
      client_secret: c.env.MAL_CLIENT_SECRET,
      grant_type: "authorization_code",
      code: q.code,
      redirect_uri: callbackUrl(c.req.url),
      code_verifier: verifier,
    }),
  });
  if (!tokenRes.ok) {
    console.error("MAL token exchange failed", tokenRes.status, await tokenRes.text());
    return fail(c, `MyAnimeList refused the login (${tokenRes.status}).`);
  }
  const tokens = (await tokenRes.json()) as MalTokens;

  const meRes = await fetch(ME, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
  if (!meRes.ok) return fail(c, `Couldn't read your MyAnimeList profile (${meRes.status}).`);
  const me = (await meRes.json()) as { id: number; name: string; picture?: string };

  const now = Date.now();
  const db = c.env.DB;
  const existing = await db.prepare("SELECT id FROM users WHERE mal_user_id = ?").bind(me.id).first<{ id: string }>();
  const userId = existing ? existing.id : crypto.randomUUID();
  await db.batch([
    existing
      ? db.prepare("UPDATE users SET mal_name = ?, mal_picture = ? WHERE id = ?").bind(me.name, me.picture || null, userId)
      : db.prepare("INSERT INTO users (id, mal_user_id, mal_name, mal_picture, created_at) VALUES (?, ?, ?, ?, ?)").bind(userId, me.id, me.name, me.picture || null, now),
    db
      .prepare(
        `INSERT INTO oauth_tokens (user_id, provider, access_token, refresh_token, expires_at, updated_at) VALUES (?, 'mal', ?, ?, ?, ?)
         ON CONFLICT (user_id, provider) DO UPDATE SET access_token = excluded.access_token, refresh_token = excluded.refresh_token,
           expires_at = excluded.expires_at, updated_at = excluded.updated_at`,
      )
      .bind(
        userId,
        await encrypt(c.env.TOKEN_KEY, tokens.access_token),
        tokens.refresh_token ? await encrypt(c.env.TOKEN_KEY, tokens.refresh_token) : null,
        tokens.expires_in ? now + tokens.expires_in * 1000 : null,
        now,
      ),
  ]);

  await startSession(c, userId);
  const next = safeNext(getCookie(c, NEXT_COOKIE));
  deleteCookie(c, NEXT_COOKIE, { path: "/api/auth/mal", secure: secureCookies(c) });
  return c.redirect(next);
});

auth.post("/logout", async (c) => {
  await endSession(c);
  return c.json({ ok: true });
});

auth.get("/me", async (c) => {
  const user = await currentUser(c);
  return c.json({ user: user && { name: user.name, picture: user.picture } });
});

export default auth;
