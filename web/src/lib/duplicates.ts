/*
 * Duplicate detection for the library. Catalog sources split a show differently
 * (AniList per part, Netflix/TVmaze as one series), so one show can end up filed
 * twice. A pair is only a *suggestion*: the user decides whether to merge.
 */
import { installment, similarity } from "./catalog";
import { isMovie, type Db, type Series } from "./ks";

export interface DuplicatePair {
  a: Series;
  b: Series;
  score: number;
}

const SAME_WORK = 0.82; // below this, two similar titles are more likely different works

export function pairKey(a: string, b: string): string {
  return [a, b].sort().join("|");
}

function namesOf(s: Series): string[] {
  return [s.title, s.meta?.altTitle, ...(s.meta?.synonyms || [])].filter((x): x is string => !!x);
}

function marksOf(s: Series): number {
  return Object.keys(s.episodes || {}).length;
}

function scoreOf(a: Series, b: Series): number {
  let best = 0;
  for (const x of namesOf(a)) for (const y of namesOf(b)) best = Math.max(best, similarity(x, y));
  return best;
}

/** The sheet the merge should keep: most marks, then the richer catalog record, then the older sheet. */
export function preferredKeep(a: Series, b: Series): Series {
  const marks = marksOf(b) - marksOf(a);
  if (marks) return marks > 0 ? b : a;
  const eps = (b.meta?.episodes || 0) - (a.meta?.episodes || 0);
  if (eps) return eps > 0 ? b : a;
  const age = (a.createdAt || 0) - (b.createdAt || 0);
  if (age) return age < 0 ? a : b;
  return a;
}

/** Pairs that look like one show but are filed as two, strongest first. */
export function findDuplicates(db: Db): DuplicatePair[] {
  const series = Object.values(db.series || {});
  const distinct = db.distinct || {};
  const out: DuplicatePair[] = [];

  for (let i = 0; i < series.length; i++) {
    for (let j = i + 1; j < series.length; j++) {
      const a = series[i];
      const b = series[j];
      if (a.key === b.key) continue;
      if (db.aliases?.[a.key] || db.aliases?.[b.key]) continue;
      if (distinct[pairKey(a.key, b.key)]) continue;
      if (marksOf(a) + marksOf(b) === 0) continue; // nothing to merge yet
      // A film and an episodic series are different things.
      if (isMovie(a) !== isMovie(b)) continue;
      // A later installment (a sequel, another season or part) is a different work.
      // This also keeps "Cyberpunk: Edgerunners" apart from "… 2" when years are missing.
      if ((installment(a.title) ?? 1) !== (installment(b.title) ?? 1)) continue;
      // Release years far apart (remakes) are different works.
      if (a.meta?.year && b.meta?.year && Math.abs(a.meta.year - b.meta.year) > 1) continue;

      const sameEntry =
        a.meta?.source && a.meta.source === b.meta?.source && a.meta.id != null && b.meta?.id != null && String(a.meta.id) === String(b.meta.id);
      const score = sameEntry ? 1 : scoreOf(a, b);
      if (score >= SAME_WORK) out.push({ a, b, score });
    }
  }

  return out.sort((x, y) => y.score - x.score);
}
