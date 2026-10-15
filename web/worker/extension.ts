/*
 * Connecting the browser extension to an account. The extension opens /extension/connect
 * in an identity window; once you allow it there, the page asks /grant for a one-time code
 * and hands it to the extension's chromiumapp.org redirect. The extension trades the code
 * at /token for a long-lived device token, which it alone keeps.
 */
import { Hono } from "hono";
import { randomToken, sha256 } from "./crypto";
import { currentUser, deviceUser } from "./session";

const CODE_TTL_MS = 2 * 60 * 1000;
// chrome.identity.getRedirectURL(): https://<32-letter extension id>.chromiumapp.org/<path>
const EXTENSION_REDIRECT = /^https:\/\/[a-p]{32}\.chromiumapp\.org\/[\w/-]*$/;

const ext = new Hono<{ Bindings: Env }>();

/** Called by the connect page, signed in by cookie. Same-origin only: it mints access. */
ext.post("/grant", async (c) => {
  if (c.req.header("Origin") !== new URL(c.req.url).origin) return c.json({ error: "Open this from your Kumostamp library." }, 403);
  const user = await currentUser(c);
  if (!user) return c.json({ error: "Sign in first." }, 401);
  const { redirect } = await c.req.json<{ redirect?: string }>().catch(() => ({ redirect: undefined }));
  if (!redirect || !EXTENSION_REDIRECT.test(redirect)) return c.json({ error: "That isn't a browser extension asking to connect." }, 400);
  const code = randomToken(32);
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM connect_codes WHERE expires_at < ?").bind(now),
    c.env.DB.prepare("INSERT INTO connect_codes (code_hash, user_id, redirect, expires_at) VALUES (?, ?, ?, ?)").bind(await sha256(code), user.id, redirect, now + CODE_TTL_MS),
  ]);
  return c.json({ code });
});

/** Called by the extension: one-time code in, device token out. */
ext.post("/token", async (c) => {
  const { code, redirect, label } = await c.req.json<{ code?: string; redirect?: string; label?: string }>().catch(() => ({}) as Record<string, undefined>);
  if (!code || !redirect) return c.json({ error: "Expected { code, redirect }." }, 400);
  const hash = await sha256(code);
  // Delete-and-return: a code works once, even if two requests race.
  const row = await c.env.DB.prepare("DELETE FROM connect_codes WHERE code_hash = ? RETURNING user_id, redirect, expires_at")
    .bind(hash)
    .first<{ user_id: string; redirect: string; expires_at: number }>();
  if (!row || row.redirect !== redirect || row.expires_at < Date.now()) return c.json({ error: "That connection request expired. Try connecting again." }, 400);

  const token = `kst_${randomToken(32)}`;
  await c.env.DB.prepare("INSERT INTO device_tokens (id, user_id, token_hash, label, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), row.user_id, await sha256(token), (label || "Browser extension").slice(0, 80), Date.now())
    .run();
  const user = await c.env.DB.prepare("SELECT mal_name, mal_picture FROM users WHERE id = ?").bind(row.user_id).first<{ mal_name: string; mal_picture: string | null }>();
  return c.json({ token, user: { name: user?.mal_name || "", picture: user?.mal_picture || null } });
});

/** The extension forgets its token; the server forgets it too. */
ext.post("/disconnect", async (c) => {
  const auth = c.req.header("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (token) await c.env.DB.prepare("DELETE FROM device_tokens WHERE token_hash = ?").bind(await sha256(token)).run();
  return c.json({ ok: true });
});

ext.get("/me", async (c) => {
  const user = await deviceUser(c);
  if (!user) return c.json({ error: "This extension isn't connected anymore." }, 401);
  return c.json({ user: { name: user.name, picture: user.picture } });
});

export default ext;
