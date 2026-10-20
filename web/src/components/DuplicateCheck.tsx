/*
 * Duplicate check. When two sheets look like one show, ask once per visit until
 * the user decides: merge them, or say they are different works (remembered, so
 * the question doesn't come back). It never merges on its own.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { LABEL } from "../lib/catalog";
import { findDuplicates, preferredKeep, type DuplicatePair } from "../lib/duplicates";
import { KS, type Series } from "../lib/ks";
import { op, useStore } from "../lib/store";
import { Poster } from "./Sheet";
import { useUi } from "./ui";

function facts(s: Series): string {
  const marks = Object.entries(s.episodes || {});
  const last = marks.reduce((at, [, ep]) => Math.max(at, ep.updatedAt || 0), 0);
  return [
    s.meta?.source ? LABEL[s.meta.source] : "No catalog link",
    s.meta?.episodes ? `${s.meta.episodes} eps` : null,
    s.meta?.year,
    marks.length ? `${marks.length} marks${last ? ` · ${KS.relTime(last)}` : ""}` : "No marks",
  ]
    .filter(Boolean)
    .join(" · ");
}

export function DuplicateCheck() {
  const { db, mode } = useStore();
  const { addRequest, mergeRequest } = useUi();
  const { pathname } = useLocation();

  const pairs = useMemo(() => (mode === "pending" || db.sample ? [] : findDuplicates(db)), [db, mode]);
  const pair = pairs[0] || null;
  const onLibrary = pathname === "/" || pathname.startsWith("/series/");

  // Don't cover a panel the user opened; it comes back when that closes.
  if (!pair || !onLibrary || addRequest || mergeRequest) return null;
  return <DuplicateDialog key={`${pair.a.key}|${pair.b.key}`} pair={pair} />;
}

function DuplicateDialog({ pair }: { pair: DuplicatePair }) {
  const { toast } = useUi();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const mergeRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [keepA, setKeepA] = useState(() => preferredKeep(pair.a, pair.b).key === pair.a.key);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    mergeRef.current?.focus();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  const keep = keepA ? pair.a : pair.b;
  const fold = keepA ? pair.b : pair.a;

  async function merge() {
    if (busy) return;
    const snapshot = structuredClone(fold);
    const titleKey = KS.seriesKey(fold.title);
    setBusy(true);
    try {
      await op({ type: "mergeSeries", fromKey: fold.key, toKey: keep.key });
      toast(`Merged “${fold.title}” into “${keep.title}”.`, {
        label: "Undo",
        run: async () => {
          try {
            await op({
              type: "unmerge",
              key: fold.key,
              titleKey: titleKey !== fold.key ? titleKey : undefined,
              toKey: keep.key,
            });
            await op({ type: "import", restore: true, db: { series: { [fold.key]: snapshot }, aliases: {} } });
            toast(`Split “${snapshot.title}” back out.`);
          } catch (err) {
            toast((err as Error).message || "Couldn't undo the merge.");
          }
        },
      });
    } catch (err) {
      setBusy(false);
      toast((err as Error).message || "Couldn't merge those sheets.");
    }
  }

  async function distinct() {
    if (busy) return;
    setBusy(true);
    try {
      await op({ type: "keepDistinct", a: pair.a.key, b: pair.b.key });
      toast("Noted: different series, so this won't be asked again.");
    } catch (err) {
      setBusy(false);
      toast((err as Error).message || "Couldn't save that answer.");
    }
  }

  return (
    <dialog ref={dialogRef} className="dupe-dialog" aria-labelledby="dupe-title" onCancel={(e) => e.preventDefault()}>
      <div className="dupe-body">
        <p className="dupe-kicker">Duplicate check</p>
        <h2 id="dupe-title">Are these the same series?</h2>
        <p className="dupe-lede">
          Two sheets look like one show. If they are the same, merge them so your marks stay in one place. This check comes back every
          visit until you choose.
        </p>

        <div className="dupe-pair">
          <DupeCard series={pair.a} kept={keepA} onKeep={() => setKeepA(true)} />
          <span className="dupe-or" aria-hidden="true">
            vs
          </span>
          <DupeCard series={pair.b} kept={!keepA} onKeep={() => setKeepA(false)} />
        </div>

        <p className="dupe-keep">
          Keeping <strong>“{keep.title}”</strong>. Its title and catalog info stay; the other title becomes an alias. Every mark is
          kept; for the same episode, the newer mark wins.
        </p>

        <div className="dupe-actions">
          <button ref={mergeRef} className="btn btn-ink" type="button" disabled={busy} onClick={merge}>
            {busy ? "Working…" : "Yes, merge these"}
          </button>
          <button className="btn" type="button" disabled={busy} onClick={distinct}>
            Not the same series
          </button>
        </div>
      </div>
    </dialog>
  );
}

function DupeCard({ series, kept, onKeep }: { series: Series; kept: boolean; onKeep: () => void }) {
  return (
    <button type="button" className="dupe-card" aria-pressed={kept} onClick={onKeep}>
      <Poster series={series} />
      <span className="dupe-card-id">
        <span className="dupe-card-title">{series.title}</span>
        <span className="dupe-card-facts">{facts(series)}</span>
        <span className="dupe-card-keep">{kept ? "Kept" : "Keep this one"}</span>
      </span>
    </button>
  );
}
