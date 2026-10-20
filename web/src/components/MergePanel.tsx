/*
 * Merge two sheets for the same show. Catalog sources split a show differently
 * (AniList per part, Netflix/TVmaze as one series), so detection can file one
 * show twice. This folds the chosen sheet into the one you keep: both sets of
 * marks survive, the newer mark wins per episode, and the old title keeps
 * filing under the kept sheet.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { LABEL, similarity } from "../lib/catalog";
import { KS, safeUrl, type Series } from "../lib/ks";
import { op, useStore } from "../lib/store";
import { Icon } from "./Icon";
import { useUi } from "./ui";

function namesOf(s: Series): string[] {
  return [s.title, s.meta?.altTitle].filter((x): x is string => !!x);
}

/** Best title similarity between two sheets (either title may be the translated one). */
function pairScore(a: Series, b: Series): number {
  let best = 0;
  for (const x of namesOf(a)) for (const y of namesOf(b)) best = Math.max(best, similarity(x, y));
  return best;
}

function facts(s: Series): string {
  return [
    s.meta?.source ? LABEL[s.meta.source] : "No catalog link",
    s.meta?.episodes ? `${s.meta.episodes} eps` : null,
    s.meta?.year,
    `${Object.keys(s.episodes || {}).length} marks`,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function MergePanel() {
  const { mergeRequest } = useUi();
  if (!mergeRequest) return null;
  // A new request (or another sheet) starts with fresh state.
  return <MergePanelBody key={mergeRequest.key} sourceKey={mergeRequest.key} />;
}

function MergePanelBody({ sourceKey }: { sourceKey: string }) {
  const { closeMerge, toast } = useUi();
  const { db } = useStore();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [pickedKey, setPickedKey] = useState<string | null>(null);
  const [keep, setKeep] = useState<"source" | "picked">("source");
  const [busy, setBusy] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mergeRef = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  const source = db.series[sourceKey];
  const picked = pickedKey ? db.series[pickedKey] : null;

  // Bring the panel into view; closing puts focus back on the button that opened it.
  useEffect(() => {
    opener.current = document.activeElement as HTMLElement | null;
    panelRef.current?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    return () => {
      if (opener.current?.isConnected) opener.current.focus();
    };
  }, []);

  // Focus follows the step: the filter first, then the confirmation's action.
  useEffect(() => {
    if (pickedKey) mergeRef.current?.focus();
    else inputRef.current?.focus();
  }, [pickedKey]);

  const others = useMemo(() => {
    if (!source) return [];
    const q = query.trim().toLowerCase();
    return Object.values(db.series)
      .filter((s) => s.key !== source.key)
      .filter((s) => !q || `${s.title} ${s.meta?.altTitle || ""}`.toLowerCase().includes(q))
      .map((s) => ({ series: s, score: pairScore(source, s) }))
      .sort((a, b) => b.score - a.score || (b.series.updatedAt || 0) - (a.series.updatedAt || 0));
  }, [db, source, query]);

  async function mergeSheets() {
    if (!source || !picked || busy) return;
    const from = keep === "source" ? picked : source;
    const to = keep === "source" ? source : picked;
    const snapshot = structuredClone(from);
    const titleKey = KS.seriesKey(from.title);

    setBusy(true);
    try {
      await op({ type: "mergeSeries", fromKey: from.key, toKey: to.key });
      if (pathname === `/series/${encodeURIComponent(from.key)}`) navigate(`/series/${encodeURIComponent(to.key)}`);
      closeMerge();
      toast(`Merged “${from.title}” into “${to.title}”.`, {
        label: "Undo",
        run: async () => {
          try {
            await op({
              type: "unmerge",
              key: from.key,
              titleKey: titleKey !== from.key ? titleKey : undefined,
              toKey: to.key,
            });
            await op({ type: "import", restore: true, db: { series: { [from.key]: snapshot }, aliases: {} } });
            toast(`Split “${snapshot.title}” back out.`);
          } catch (err) {
            toast((err as Error).message || "Couldn't undo the merge.");
          }
        },
      });
    } catch (err) {
      toast((err as Error).message || "Couldn't merge those sheets.");
    } finally {
      setBusy(false);
    }
  }

  if (!source) return null;

  return (
    <section className="add-panel merge-panel" id="merge-panel" ref={panelRef} aria-labelledby="merge-title" onKeyDown={(e) => e.key === "Escape" && closeMerge()}>
      <div className="add-inner">
        <div className="add-head">
          <h2 id="merge-title">Merge “{source.title}” with…</h2>
          <button className="btn btn-icon btn-flat" id="merge-close" type="button" aria-label="Close" onClick={closeMerge}>
            <Icon name="close" />
          </button>
        </div>

        {picked ? (
          <div className="merge-confirm">
            <p>
              Both sheets become one. Every mark from each is kept; where the same episode exists on both, the newer mark wins. The other
              title keeps filing under the sheet you keep, so future saves land there too.
            </p>
            <fieldset>
              <legend>Keep the title and catalog info of</legend>
              <label>
                <input type="radio" name="merge-keep" checked={keep === "source"} onChange={() => setKeep("source")} />
                <span>
                  <strong>“{source.title}”</strong>
                  <small>{facts(source)}</small>
                </span>
              </label>
              <label>
                <input type="radio" name="merge-keep" checked={keep === "picked"} onChange={() => setKeep("picked")} />
                <span>
                  <strong>“{picked.title}”</strong>
                  <small>{facts(picked)}</small>
                </span>
              </label>
            </fieldset>
            <div className="merge-actions">
              <button ref={mergeRef} className="btn btn-ink" type="button" disabled={busy} onClick={mergeSheets}>
                {busy ? "Merging…" : "Merge sheets"}
              </button>
              <button className="btn btn-flat" type="button" disabled={busy} onClick={() => setPickedKey(null)}>
                Pick another
              </button>
              <button className="btn btn-flat" type="button" disabled={busy} onClick={closeMerge}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            <form className="add-search" autoComplete="off" onSubmit={(e) => e.preventDefault()}>
              <span className="search-glyph">
                <Icon name="search" />
              </span>
              <input
                ref={inputRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Filter your sheets"
                placeholder="Which other sheet is the same show?"
              />
            </form>
            <p className="add-status" role="status">
              {others.length ? `${others.length} other ${others.length === 1 ? "sheet" : "sheets"}, closest title first.` : "No other sheet matches that filter."}
            </p>
            <ol className="results">
              {others.map(({ series: s, score }) => {
                const img = safeUrl(s.meta?.image);
                return (
                  <li className="result merge-result" key={s.key}>
                    {img ? <img src={img} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <div className="result-blank" aria-hidden="true" />}
                    <div className="result-id">
                      <p className="result-title">{s.title}</p>
                      {s.meta?.altTitle && s.meta.altTitle !== s.title && <p className="result-alt">{s.meta.altTitle}</p>}
                      <p className="result-meta">
                        {facts(s)}
                        {score >= 0.82 ? <span className="merge-likely"> · similar title</span> : null}
                      </p>
                    </div>
                    <button className="btn" type="button" onClick={() => setPickedKey(s.key)}>
                      This one
                    </button>
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </div>
    </section>
  );
}
