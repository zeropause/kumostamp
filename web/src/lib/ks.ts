/*
 * Typed view of the shared core (src/lib/core.js, copied from the extension by
 * scripts/sync-shared.mjs). The core attaches itself to `self.KS`.
 */
import "./core.js";

export type Source = "anilist" | "jikan" | "tvmaze" | "cinemeta";

export interface Provider {
  url: string;
  time: number;
  updatedAt: number;
}

export interface Episode {
  episode: number | null;
  time: number;
  duration?: number;
  finished?: boolean;
  updatedAt?: number;
  lastHost?: string;
  providers?: Record<string, Provider>;
}

export interface Meta {
  source?: Source;
  id?: number | string; // IMDb ids ("tt5311514") are strings
  runtime?: number | null; // minutes, when the catalog knows it
  title?: string;
  altTitle?: string;
  image?: string;
  synopsis?: string;
  episodes?: number | null;
  year?: number | null;
  status?: string;
  kind?: string;
  score?: number | null;
  genres?: string[];
  synonyms?: string[]; // other titles (romaji, English, native, alternates) used for matching
  confident?: boolean; // false: an automatic best guess with close rivals
  alternatives?: { source: Source; id: number | string; title: string; altTitle?: string; kind?: string; year?: number | null; episodes?: number | null; image?: string }[];
  autoLinked?: boolean;
  chosen?: boolean; // picked by the user
  url?: string;
  fetchedAt?: number;
}

export interface Series {
  key: string;
  title: string;
  meta: Meta | null;
  episodes: Record<string, Episode>;
  createdAt?: number;
  updatedAt?: number;
}

export interface Db {
  version: number;
  series: Record<string, Series>;
  aliases: Record<string, string>;
  updatedAt: number;
  sample?: boolean;
}

export type Op =
  | { type: "progress"; series: string; episode: number | null; time: number; duration?: number; url?: string; host?: string; ended?: boolean }
  | { type: "setEpisode"; key: string; episode: number | null; time?: number; duration?: number; url?: string; title?: string }
  | { type: "upsertSeries"; key?: string; title?: string; meta?: Meta }
  | { type: "alias"; from: string; to?: string; toKey?: string }
  | { type: "deleteSeries"; key: string }
  | { type: "deleteEpisode"; key: string; episode: number | null }
  | { type: "moveEpisode"; key: string; from: number | null; to: number | null }
  | { type: "import"; db: Partial<Db> & { series: Record<string, Series> } }
  | { type: "replace"; db: Db };

export interface RecentRow {
  series: Series;
  key: string;
  episode: Episode;
}

interface KSApi {
  FILM: "film";
  emptyDb(): Db;
  seriesKey(title: string): string;
  epKey(episode: number | null | undefined): string;
  resolveKey(db: Db, title: string): string;
  formatTime(sec: number | undefined): string;
  parseTime(input: string): number | null;
  hostOf(url: string): string;
  applyOp(db: Db, op: Op, now?: number): Db;
  recent(db: Db, limit?: number): RecentRow[];
  relTime(ts: number | undefined, now?: number): string;
}

export const KS = (globalThis as unknown as { KS: KSApi }).KS;

export function epName(ep: number | null | undefined): string {
  return ep === null || ep === undefined ? "Film" : `Ep ${ep}`;
}

export function epCode(key: string | number): string {
  return key === KS.FILM ? "FILM" : String(key).padStart(2, "0");
}

export function safeUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

/** Episodes sorted for a sheet: film first, then by number. */
export function sortedEpisodes(s: Series): [string, Episode][] {
  return Object.entries(s.episodes || {}).sort((a, b) => {
    if (a[0] === KS.FILM) return -1;
    if (b[0] === KS.FILM) return 1;
    return Number(a[0]) - Number(b[0]);
  });
}

export function seriesState(s: Series): "progress" | "done" {
  const eps = Object.values(s.episodes || {});
  if (!eps.length) return "progress";
  const total = s.meta?.episodes;
  const allDone = eps.every((e) => e.finished);
  return allDone && (!total || eps.length >= total) ? "done" : "progress";
}

export function isMovie(s: Series): boolean {
  return !!s.meta?.kind && /movie|film/i.test(s.meta.kind);
}

/**
 * A series with numbered episodes (or a catalog that says so). A mark saved here
 * without an episode number is a misfiled mark, not a film.
 */
export function isEpisodic(s: Series): boolean {
  if (Object.keys(s.episodes || {}).some((k) => k !== KS.FILM)) return true;
  const m = s.meta;
  if (isMovie(s)) return false;
  return !!(m?.episodes && m.episodes > 1);
}

export type MediaType = "anime" | "tv" | "movie";

/**
 * What kind of thing a sheet is, from its catalog info (or, without info, from
 * marks saved only as a film). Null when it can't be told yet.
 */
export function mediaType(s: Series): MediaType | null {
  if (isMovie(s)) return "movie";
  const source = s.meta?.source;
  if (source === "anilist" || source === "jikan") return "anime";
  if (source === "tvmaze") return "tv";
  if (source === "cinemeta") return "movie";
  const keys = Object.keys(s.episodes || {});
  if (keys.length > 0 && keys.every((k) => k === KS.FILM)) return "movie";
  return null;
}

/** "Breaking Bad Season 2" → 2; plain titles → null. */
export function seasonOf(title: string): number | null {
  const m = title.match(/\bSeason\s*(\d{1,2})\b/i);
  return m ? Number(m[1]) : null;
}
