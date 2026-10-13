/* Browser sessions: a random cookie value, stored in D1 only as its hash. */
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { randomToken, sha256 } from "./crypto";

const COOKIE = "ks_session";
const MAX_AGE = 60 * 24 * 60 * 60; // seconds

export interface User {
  id: string;
  malUserId: number;
  name: string;
  picture: string | null;
}

/** Any route's context with our bindings, whatever variables that route adds. */
type Ctx = Context<{ Bindings: Env }>;
const asCtx = <E extends { Bindings: Env }>(c: Context<E>) => c as unknown as Ctx;

/** Secure only over https, so the session also works on http://localhost. */
export const secureCookies = <E extends { Bindings: Env }>(c: Context<E>) => new URL(c.req.url).protocol === "https:";

export async function startSession<E extends { Bindings: Env }>(ctx: Context<E>, userId: string) {
  const c = asCtx(ctx);
  const value = randomToken();
  const now = Date.now();
  await c.env.DB.prepare("INSERT INTO sessions (id_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256(value), userId, now, now + MAX_AGE * 1000)
    .run();
  setCookie(c, COOKIE, value, { path: "/", httpOnly: true, secure: secureCookies(c), sameSite: "Lax", maxAge: MAX_AGE });
}

export async function currentUser<E extends { Bindings: Env }>(ctx: Context<E>): Promise<User | null> {
  const c = asCtx(ctx);
  const value = getCookie(c, COOKIE);
  if (!value) return null;
  const row = await c.env.DB.prepare(
    `SELECT u.id, u.mal_user_id, u.mal_name, u.mal_picture FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id_hash = ? AND s.expires_at > ?`,
  )
    .bind(await sha256(value), Date.now())
    .first<{ id: string; mal_user_id: number; mal_name: string; mal_picture: string | null }>();
  return row ? { id: row.id, malUserId: row.mal_user_id, name: row.mal_name, picture: row.mal_picture } : null;
}

export async function endSession<E extends { Bindings: Env }>(ctx: Context<E>) {
  const c = asCtx(ctx);
  const value = getCookie(c, COOKIE);
  if (value) await c.env.DB.prepare("DELETE FROM sessions WHERE id_hash = ?").bind(await sha256(value)).run();
  deleteCookie(c, COOKIE, { path: "/", secure: secureCookies(c) });
}
