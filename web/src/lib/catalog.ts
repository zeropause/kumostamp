/*
 * Typed view of the shared catalog (src/lib/catalog-shared.js, copied from the
 * extension by scripts/sync-shared.mjs): search, details and matching live
 * there so the extension and the website agree. Episode lists, which only the
 * website shows, live here.
 */
import "./catalog-shared.js";
import type { Meta, Source } from "./ks";

export interface MatchSignals {
  title: string;
  film?: boolean;
  episode?: number | null;
  duration?: number | null; // seconds
  host?: string;
}

export interface Brief {
  source: Source;
  id: number | string;
  title: string;
  altTitle?: string;
  kind?: string;
  year?: number | null;
  episodes?: number | null;
  image?: string;
}

export interface MatchResult {
  best: Meta | null;
  alternatives: Brief[];
  confident: boolean;
}

interface CatalogApi {
  LABEL: Record<Source, string>;
  RETIRED: Source[];
  search(source: Source, query: string): Promise<Meta[]>;
  details(source: Source, id: number | string): Promise<Meta>;
  complete(hit: Partial<Meta> & { source: Source; id: number | string }, season?: number | null): Promise<Meta>;
  match(signals: MatchSignals): Promise<MatchResult>;
  brief(m: Meta): Brief;
  similarity(a: string, b: string): number;
  installment(title: string): number | null;
}

const C = (globalThis as unknown as { KSCatalog: CatalogApi }).KSCatalog;

export const LABEL = C.LABEL;
export const RETIRED = C.RETIRED;
export const search = C.search;
export const details = C.details;
export const complete = C.complete;
export const match = C.match;
export const brief = C.brief;
export const similarity = C.similarity;
export const installment = C.installment;

/** A search hit is thin (movies especially); fetch the full record before saving it. */
export const fullMovie = (hit: Meta): Promise<Meta> =>
  hit.source && hit.id != null ? C.complete(hit as Meta & { source: Source; id: number | string }) : Promise.resolve(hit);

/* ---------------- episode lists ---------------- */

export interface CatalogEpisode {
  number: number;
  title: string;
  aired?: string;
  runtime?: number; // minutes
}

export interface EpisodeList {
  episodes: CatalogEpisode[];
  total: number | null;
  runtime: number | null; // typical minutes per episode
  nextAiring?: { episode: number; at: number } | null;
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new Error(`The catalog answered with an error (${res.status}).`);
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof DOMException || err instanceof TypeError) throw new Error("The catalog didn't answer. Try again in a moment.", { cause: err });
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

const episodeCache = new Map<string, Promise<EpisodeList>>();

/** Full episode list for a linked series. `season` narrows TVmaze shows. */
export function episodes(source: Source, id: number | string, season: number | null): Promise<EpisodeList> {
  const key = `${source}:${id}:${season ?? ""}`;
  let p = episodeCache.get(key);
  if (!p) {
    p = loadEpisodes(source, id, season);
    episodeCache.set(key, p);
    p.catch(() => episodeCache.delete(key));
  }
  return p;
}

async function loadEpisodes(source: Source, id: number | string, season: number | null): Promise<EpisodeList> {
  if (RETIRED.includes(source)) throw new Error(`${LABEL[source]} is no longer available. Link this sheet again.`);

  if (source === "cinemeta") {
    // A movie is one sitting: no episode list, but the runtime sizes the ruler.
    const m = await details("cinemeta", id);
    return { episodes: [], total: 1, runtime: m.runtime || null };
  }

  if (source === "anilist") {
    const json = await getJson<{
      data: { Media: { episodes: number | null; duration: number | null; nextAiringEpisode: { episode: number; airingAt: number } | null; streamingEpisodes: { title: string }[] } };
    }>("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        query: `query ($id: Int) { Media(id: $id, type: ANIME) { episodes duration nextAiringEpisode { episode airingAt } streamingEpisodes { title } } }`,
        variables: { id: Number(id) },
      }),
    });
    const m = json.data.Media;
    // AniList has no per-episode table; streaming listings carry titles like "Episode 3 - The Title".
    const titles = new Map<number, string>();
    for (const s of m.streamingEpisodes || []) {
      const hit = s.title.match(/Episode\s*(\d+)\s*[-–:]\s*(.+)$/i);
      if (hit) titles.set(Number(hit[1]), hit[2].trim());
    }
    const aired = m.nextAiringEpisode ? m.nextAiringEpisode.episode - 1 : null;
    const count = m.episodes || aired || titles.size || 0;
    return {
      total: m.episodes,
      runtime: m.duration,
      nextAiring: m.nextAiringEpisode ? { episode: m.nextAiringEpisode.episode, at: m.nextAiringEpisode.airingAt * 1000 } : null,
      episodes: Array.from({ length: count }, (_, i) => ({ number: i + 1, title: titles.get(i + 1) || "", runtime: m.duration || undefined })),
    };
  }

  const all = await getJson<{ season: number; number: number | null; name: string; airdate: string; runtime: number | null }[]>(
    `https://api.tvmaze.com/shows/${id}/episodes`,
  );
  const wanted = season ?? 1;
  const eps = all.filter((e) => e.season === wanted && e.number != null);
  const runtimes = eps.map((e) => e.runtime).filter((r): r is number => !!r);
  return {
    total: eps.length,
    runtime: runtimes.length ? Math.round(runtimes.reduce((a, b) => a + b, 0) / runtimes.length) : null,
    episodes: eps.map((e) => ({ number: e.number as number, title: e.name, aired: e.airdate || undefined, runtime: e.runtime || undefined })),
  };
}
