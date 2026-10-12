/*
 * Automatic catalog linking. Sheets the extension creates carry only a title;
 * this looks each one up (AniList, then TVmaze or IMDb) and links the match:
 * synopsis, poster, episode count, runtime, genres. Sheets linked to a retired
 * catalog are re-linked the same way.
 */
import { useSyncExternalStore } from "react";
import { match, RETIRED } from "./catalog";
import { KS, type Series } from "./ks";
import { getDb, getMode, op } from "./store";

// Bump the version when matching improves, so earlier misses are retried at once.
const TRIED_KEY = "kumostamp:autolink:v2";
const MISS_RETRY_MS = 24 * 3600 * 1000; // no clear match: ask again tomorrow
const ERROR_RETRY_MS = 10 * 60 * 1000; // catalogs unreachable: ask again soon

let pending = new Set<string>();
const listeners = new Set<() => void>();
let running = false;
let again = false;

function emit() {
  pending = new Set(pending);
  listeners.forEach((fn) => fn());
}

function readTried(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(TRIED_KEY) || "{}");
  } catch {
    return {};
  }
}

function writeTried(t: Record<string, number>) {
  try {
    localStorage.setItem(TRIED_KEY, JSON.stringify(t));
  } catch {
    /* private mode */
  }
}

export function needsInfo(s: Series): boolean {
  return !s.meta || !s.meta.source || RETIRED.includes(s.meta.source);
}

/** What the marks say about this sheet, as matching signals (film, episode, duration, site). */
function signalsFor(s: Series) {
  const keys = Object.keys(s.episodes || {});
  const numbered = keys.filter((k) => k !== KS.FILM).map(Number);
  const latest = Object.values(s.episodes || {}).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
  return {
    title: s.title,
    film: keys.length > 0 && numbered.length === 0,
    episode: numbered.length ? Math.max(...numbered) : null,
    duration: latest?.duration || null,
    host: latest?.lastHost || "",
  };
}

/** Look up every sheet that needs info. Safe to call often: runs one pass at a time. */
export async function runAutoLink(): Promise<void> {
  // A connected extension looks sheets up itself the moment they are saved.
  if (getMode() === "extension") return;
  if (running) {
    again = true; // new sheets arrived mid-pass; go round once more
    return;
  }
  running = true;
  try {
    do {
      again = false;
      const tried = readTried();
      const todo = Object.values(getDb().series).filter((s) => needsInfo(s) && Date.now() >= (tried[s.key] || 0));
      for (const s of todo) {
        pending.add(s.key);
        emit();
        let next = Date.now() + MISS_RETRY_MS;
        try {
          const r = await match(signalsFor(s));
          const meta = r.best ? { ...r.best, confident: r.confident, alternatives: r.alternatives, autoLinked: true } : null;
          const live = getDb().series[s.key];
          if (meta && live && needsInfo(live)) {
            await op({ type: "upsertSeries", key: s.key, meta });
            // Streaming sites use the romaji or English title; file those under this sheet too.
            for (const alt of [meta.title, meta.altTitle, ...(meta.synonyms || [])]) {
              const k = alt ? KS.seriesKey(alt) : "";
              if (k && k !== s.key && !getDb().series[k] && !getDb().aliases?.[k]) await op({ type: "alias", from: alt!, toKey: s.key });
            }
            delete tried[s.key];
            next = 0;
          }
        } catch {
          next = Date.now() + ERROR_RETRY_MS;
        }
        if (next) tried[s.key] = next;
        writeTried(tried);
        pending.delete(s.key);
        emit();
        await new Promise((r) => setTimeout(r, 500)); // be gentle with the catalogs
      }
    } while (again);
  } finally {
    running = false;
  }
}

/** Forget earlier misses for one sheet (e.g. after it was renamed) and look it up now. */
export function retryAutoLink(key: string) {
  const tried = readTried();
  delete tried[key];
  writeTried(tried);
  runAutoLink();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useLookingUp(key: string): boolean {
  return useSyncExternalStore(subscribe, () => pending).has(key);
}
