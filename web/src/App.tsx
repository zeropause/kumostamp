import { useEffect, useRef } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { AddPanel } from "./components/AddPanel";
import { DuplicateCheck } from "./components/DuplicateCheck";
import { MergePanel } from "./components/MergePanel";
import { TitleBlock } from "./components/TitleBlock";
import { details, RETIRED } from "./lib/catalog";
import { needsInfo, runAutoLink } from "./lib/autolink";
import { getDb, op, useStore } from "./lib/store";
import { Library } from "./routes/Library";
import { ExtensionConnect } from "./routes/ExtensionConnect";
import { Login } from "./routes/Login";
import { SeriesPage } from "./routes/SeriesPage";

const STALE_MS = 3 * 24 * 3600 * 1000;

/** Quietly refresh catalog descriptions older than a few days, one at a time. */
function useStaleRefresh(ready: boolean) {
  const done = useRef(false);
  useEffect(() => {
    if (!ready || done.current) return;
    done.current = true;
    (async () => {
      const stale = Object.values(getDb().series).filter((s) => s.meta?.source && !RETIRED.includes(s.meta.source) && s.meta.id && Date.now() - (s.meta.fetchedAt || 0) > STALE_MS);
      for (const s of stale.slice(0, 8)) {
        try {
          await op({ type: "upsertSeries", key: s.key, meta: await details(s.meta!.source!, s.meta!.id!) });
        } catch {
          /* offline or rate-limited: try again next visit */
        }
        await new Promise((r) => setTimeout(r, 900));
      }
    })();
  }, [ready]);
}

/** Link catalog info for any sheet that lacks it, whenever the set of sheets changes. */
function useAutoLink(ready: boolean, signature: string) {
  useEffect(() => {
    if (ready) runAutoLink();
  }, [ready, signature]);
}

/** The pencil marks draw in once, on the first paint with data. */
function useFirstPaint(ready: boolean) {
  const painted = useRef(false);
  useEffect(() => {
    if (!ready || painted.current) return;
    painted.current = true;
    document.body.classList.add("first-paint");
    const t = setTimeout(() => document.body.classList.remove("first-paint"), 1600);
    return () => clearTimeout(t);
  }, [ready]);
}

export default function App() {
  const { mode, db } = useStore();
  const { pathname } = useLocation();
  const ready = mode !== "pending";
  useStaleRefresh(ready);
  // Re-run when a sheet without info appears (from the extension, an import, or a rename).
  const unlinked = Object.values(db.series).filter(needsInfo).map((s) => s.key).sort().join("|");
  useAutoLink(ready, unlinked);
  useFirstPaint(ready);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <>
      <TitleBlock />
      <AddPanel />
      <MergePanel />
      <DuplicateCheck />
      <Routes>
        <Route path="/" element={<Library />} />
        <Route path="/series/:key" element={<SeriesPage />} />
        <Route path="/login" element={<Login />} />
        <Route path="/extension/connect" element={<ExtensionConnect />} />
        <Route path="*" element={<Library />} />
      </Routes>
    </>
  );
}
