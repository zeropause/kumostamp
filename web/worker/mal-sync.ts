/*
 * Puts what you watch on your MyAnimeList list. Runs on the server after a library sync.
 *
 * An episode watched for at least a minute marks its anime Watching, with progress = that
 * episode. The same rules as the extension's AniList sync: progress is never lowered,
 * Completed and rewatching entries are left alone, and Completed is never set for you.
 */
import type { Db, Episode, Series } from "../src/lib/ks";
import { decrypt, encrypt } from "./crypto";

const MAL_API = "https://api.myanimelist.net/v2";
const MAL_TOKEN = "https://myanimelist.net/v1/oauth2/token";
const ANILIST = "https://graphql.anilist.co";
const WATCHED_SEC = 60; // seconds of an episode before it counts as started
const RECENT_MS = 30 * 24 * 3600 * 1000; // older marks are history, not news for the list

interface Candidate {
  series: Series;
  episode: number;
}

export interface MalResult {
  title: string;
  malId?: number;
  progress?: number;
  total?: number;
  outcome: "updated" | "skipped" | "failed";
  reason?: string;
}

function episodeNumber(key: string, ep: Episode, s: Series): number | null {
  if (key === "film") return Number(s.meta?.episodes) === 1 ? 1 : null; // a film is episode 1 of 1
  const n = Number(ep.episode ?? key);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Episodes that newly count as watched: changed since `before` (all of them when `before`
 * is null), watched a minute or finished, and recent. The furthest one per series.
 */
export function candidates(before: Db | null, after: Db, now = Date.now()): Candidate[] {
  const out: Candidate[] = [];
  for (const s of Object.values(after.series || {})) {
    const source = s.meta?.source;
    if (source !== "anilist" && source !== "jikan") continue;
    let best = 0;
    for (const [key, ep] of Object.entries(s.episodes || {})) {
      const prev = before?.series?.[s.key]?.episodes?.[key];
      if (prev && (prev.updatedAt || 0) >= (ep.updatedAt || 0)) continue;
      if (now - (ep.updatedAt || 0) > RECENT_MS) continue;
      if ((ep.time || 0) < WATCHED_SEC && !ep.finished) continue;
      const n = episodeNumber(key, ep, s);
      if (n && n > best) best = n;
    }
    if (best) out.push({ series: s, episode: best });
  }
  return out;
}

/** MAL ids for AniList entries, from AniList's idMal; remembered in D1. */
async function malIds(env: Env, anilistIds: number[]): Promise<Map<number, number | null>> {
  const found = new Map<number, number | null>();
  if (!anilistIds.length) return found;
  const marks = anilistIds.map(() => "?").join(",");
  const rows = await env.DB.prepare(`SELECT anilist_id, mal_id FROM mal_ids WHERE anilist_id IN (${marks})`)
    .bind(...anilistIds)
    .all<{ anilist_id: number; mal_id: number | null }>();
  for (const r of rows.results) found.set(r.anilist_id, r.mal_id);

  const missing = anilistIds.filter((id) => !found.has(id));
  if (missing.length) {
    const res = await fetch(ANILIST, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        query: "query ($ids: [Int]) { Page(perPage: 50) { media(id_in: $ids, type: ANIME) { id idMal } } }",
        variables: { ids: missing.slice(0, 50) },
      }),
    });
    if (!res.ok) console.error("AniList idMal lookup failed", res.status);
    else {
      const json = (await res.json()) as { data?: { Page?: { media?: { id: number; idMal: number | null }[] } } };
      const media = json.data?.Page?.media || [];
      for (const m of media) found.set(m.id, m.idMal || null);
      if (media.length) {
        await env.DB.batch(
          media.map((m) => env.DB.prepare("INSERT OR REPLACE INTO mal_ids (anilist_id, mal_id) VALUES (?, ?)").bind(m.id, m.idMal || null)),
        );
      }
    }
  }
  return found;
}

interface TokenRow {
  access_token: string;
  refresh_token: string | null;
  expires_at: number | null;
}

/** A working access token, refreshed first when it is about to expire (or `force`). */
async function accessToken(env: Env, userId: string, force = false): Promise<string | null> {
  const row = await env.DB.prepare("SELECT access_token, refresh_token, expires_at FROM oauth_tokens WHERE user_id = ? AND provider = 'mal'")
    .bind(userId)
    .first<TokenRow>();
  if (!row) return null;
  const fresh = row.expires_at && row.expires_at > Date.now() + 5 * 60 * 1000;
  if (fresh && !force) return decrypt(env.TOKEN_KEY, row.access_token);
  if (!row.refresh_token) return null;

  const res = await fetch(MAL_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.MAL_CLIENT_ID,
      client_secret: env.MAL_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: await decrypt(env.TOKEN_KEY, row.refresh_token),
    }),
  });
  if (!res.ok) {
    console.error("MAL token refresh failed", res.status, await res.text());
    return null;
  }
  const t = (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
  const now = Date.now();
  await env.DB.prepare("UPDATE oauth_tokens SET access_token = ?, refresh_token = ?, expires_at = ?, updated_at = ? WHERE user_id = ? AND provider = 'mal'")
    .bind(
      await encrypt(env.TOKEN_KEY, t.access_token),
      t.refresh_token ? await encrypt(env.TOKEN_KEY, t.refresh_token) : row.refresh_token,
      t.expires_in ? now + t.expires_in * 1000 : null,
      now,
      userId,
    )
    .run();
  return t.access_token;
}

interface ListStatus {
  status?: string;
  num_episodes_watched?: number;
  is_rewatching?: boolean;
}

/** Send what's new in `after` (compared with `before`) to the user's MAL list. */
export async function pushToMal(env: Env, userId: string, before: Db | null, after: Db): Promise<MalResult[]> {
  const todo = candidates(before, after);
  if (!todo.length) return [];

  // Most sheets carry malId (the browser asks AniList, which blocks Workers); look up only the rest.
  const anilistIds = todo.filter((c) => c.series.meta?.source === "anilist" && c.series.meta.malId === undefined).map((c) => Number(c.series.meta!.id));
  const fromAnilist = await malIds(env, anilistIds);
  const pushed = await env.DB.prepare("SELECT mal_id, progress FROM mal_pushes WHERE user_id = ?").bind(userId).all<{ mal_id: number; progress: number }>();
  const sent = new Map(pushed.results.map((r) => [r.mal_id, r.progress]));

  const results: MalResult[] = [];
  let token: string | null = null;
  for (const { series, episode } of todo) {
    const meta = series.meta!;
    const title = meta.title || series.title;
    const malId = meta.source === "jikan" ? Number(meta.id) : meta.malId !== undefined ? meta.malId : fromAnilist.get(Number(meta.id)) || null;
    if (!malId) {
      results.push({ title, outcome: "skipped", reason: "not on MyAnimeList" });
      continue;
    }
    if ((sent.get(malId) || 0) >= episode) continue; // already sent this far

    token = token || (await accessToken(env, userId));
    if (!token) return [...results, { title, malId, outcome: "failed", reason: "MyAnimeList login expired; sign in again" }];

    const call = async (init?: RequestInit, path = `/anime/${malId}?fields=my_list_status,num_episodes`) => {
      let res = await fetch(MAL_API + path, { ...init, headers: { ...init?.headers, Authorization: `Bearer ${token}` } });
      if (res.status === 401) {
        token = await accessToken(env, userId, true);
        if (!token) return res;
        res = await fetch(MAL_API + path, { ...init, headers: { ...init?.headers, Authorization: `Bearer ${token}` } });
      }
      return res;
    };

    const info = await call();
    if (!info.ok) {
      results.push({ title, malId, outcome: "failed", reason: `MyAnimeList answered ${info.status}` });
      continue;
    }
    const anime = (await info.json()) as { num_episodes?: number; my_list_status?: ListStatus };
    const total = anime.num_episodes || 0;
    const current = anime.my_list_status;
    const skip = (reason: string) => results.push({ title, malId, progress: episode, total, outcome: "skipped", reason });
    if (total && episode > total) {
      skip("episode number beyond this entry (a later season?)");
      continue;
    }
    if (current?.is_rewatching) {
      skip("rewatching");
      continue;
    }
    if (current?.status === "completed") {
      skip("already completed");
      continue;
    }
    if ((current?.num_episodes_watched || 0) >= episode && current?.status === "watching") {
      skip("already recorded");
    } else {
      const res = await call(
        {
          method: "PATCH",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ status: "watching", num_watched_episodes: String(Math.max(episode, current?.num_episodes_watched || 0)) }),
        },
        `/anime/${malId}/my_list_status`,
      );
      if (!res.ok) {
        console.error("MAL list update failed", malId, res.status, await res.text());
        results.push({ title, malId, progress: episode, total, outcome: "failed", reason: `MyAnimeList answered ${res.status}` });
        continue;
      }
      results.push({ title, malId, progress: episode, total, outcome: "updated" });
    }
    await env.DB.prepare(
      `INSERT INTO mal_pushes (user_id, mal_id, progress, title, at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id, mal_id) DO UPDATE SET progress = excluded.progress, title = excluded.title, at = excluded.at`,
    )
      .bind(userId, malId, episode, title, Date.now())
      .run();
  }
  return results;
}
