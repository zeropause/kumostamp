/* Add a series (or link catalog info to one) from AniList, TVmaze, IMDb, or by title. */
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { KS, safeUrl, type Meta, type Source } from "../lib/ks";
import { LABEL, fullMovie, search } from "../lib/catalog";
import { getDb, op } from "../lib/store";
import { Icon } from "./Icon";
import { useUi } from "./ui";

type Tab = Source | "manual";
const TABS: { id: Tab; name: string; sub?: string }[] = [
  { id: "anilist", name: "Anime", sub: "AniList" },
  { id: "tvmaze", name: "TV series", sub: "TVmaze" },
  { id: "cinemeta", name: "Movie", sub: "IMDb via Cinemeta" },
  { id: "manual", name: "Just a title" },
];

export function AddPanel() {
  const { addRequest, closeAdd, run } = useUi();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("anilist");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [results, setResults] = useState<Meta[]>([]);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const panelRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const linkKey = addRequest?.linkKey || null;
  const linking = linkKey ? getDb().series[linkKey] : null;

  async function doSearch(src: Tab, q: string) {
    q = q.trim();
    if (!q) return setStatus("Type a title first.");
    if (src === "manual") {
      if (linkKey) {
        await run({ type: "upsertSeries", key: linkKey, title: q }, `Renamed to ${q}.`);
        closeAdd();
        return;
      }
      await run({ type: "upsertSeries", title: q }, `Added ${q}.`);
      finish(KS.resolveKey(getDb(), q));
      return;
    }
    const mine = ++seq.current;
    setBusy(true);
    setStatus(`Searching ${LABEL[src]}…`);
    try {
      const found = await search(src, q);
      if (mine !== seq.current) return;
      setResults(found);
      setStatus(found.length ? `${found.length} found on ${LABEL[src]}.` : `Nothing on ${LABEL[src]} for “${q}”. Try another spelling, another source, or add it as just a title.`);
    } catch (err) {
      if (mine !== seq.current) return;
      setResults([]);
      setStatus((err as Error).message || "Couldn't reach the catalog. Check your connection and try again.");
    } finally {
      if (mine === seq.current) setBusy(false);
    }
  }

  // Each open request resets the panel; a request with a query searches right away.
  useEffect(() => {
    if (!addRequest) return;
    const src = addRequest.source || "anilist";
    setTab(src);
    setQuery(addRequest.query || "");
    setResults([]);
    setStatus("");
    panelRef.current?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    inputRef.current?.focus();
    if (addRequest.query && src !== "manual") doSearch(src, addRequest.query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addRequest]);

  function finish(key: string) {
    closeAdd();
    navigate(`/series/${encodeURIComponent(key)}?mark=1`);
  }

  async function choose(hit: Meta) {
    const r = await fullMovie(hit).catch(() => hit);
    const db = getDb();
    const key = linkKey || KS.resolveKey(db, r.title || "");
    await run(
      { type: "upsertSeries", key, title: linkKey || db.series[key] ? undefined : r.title, meta: r },
      linkKey ? `Linked to ${r.title} on ${LABEL[r.source!]}.` : `Added ${r.title}.`,
    );
    // Streaming sites use the romaji or English title; file both under this sheet.
    for (const alt of [r.title, r.altTitle]) {
      const k = alt ? KS.seriesKey(alt) : "";
      if (k && k !== key && !getDb().series[k]) await op({ type: "alias", from: alt!, toKey: key });
    }
    if (linkKey) closeAdd();
    else finish(key);
  }

  if (!addRequest) return null;

  return (
    <section className="add-panel" id="add-panel" ref={panelRef} aria-labelledby="add-title" onKeyDown={(e) => e.key === "Escape" && closeAdd()}>
      <div className="add-inner">
        <div className="add-head">
          <h2 id="add-title">{linking ? `Find info for “${linking.title}”` : "Add series"}</h2>
          <div className="source-switch" role="tablist" aria-label="Where to look it up">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                type="button"
                aria-selected={tab === t.id}
                onClick={() => {
                  setTab(t.id);
                  setResults([]);
                  setStatus("");
                  inputRef.current?.focus();
                  if (query.trim() && t.id !== "manual") doSearch(t.id, query);
                }}
              >
                {t.name} {t.sub && <small>{t.sub}</small>}
              </button>
            ))}
          </div>
          <button className="btn btn-icon btn-flat" id="add-close" type="button" aria-label="Close" onClick={closeAdd}>
            <Icon name="close" />
          </button>
        </div>
        <form
          className="add-search"
          autoComplete="off"
          onSubmit={(e) => {
            e.preventDefault();
            doSearch(tab, query);
          }}
        >
          <span className="search-glyph">
            <Icon name="search" />
          </span>
          <input
            ref={inputRef}
            type={tab === "manual" ? "text" : "search"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={tab === "manual" ? "Title" : `Search ${LABEL[tab]}`}
            placeholder={
              tab === "manual" ? "Series or film title"
              : tab === "tvmaze" ? "Search a TV series, e.g. Breaking Bad"
              : tab === "cinemeta" ? "Search a movie, e.g. Interstellar"
              : "Search an anime, e.g. JoJo Stone Ocean"
            }
          />
          <button className="btn" type="submit">
            {tab === "manual" ? (linkKey ? "Rename" : "Add") : "Search"}
          </button>
        </form>
        <p className="add-status" role="status">
          {status}
        </p>
        <ol className="results" aria-busy={busy}>
          {results.map((r) => {
            const img = safeUrl(r.image);
            const existing = !linkKey && getDb().series[KS.resolveKey(getDb(), r.title || "")];
            const bits = [r.kind, r.episodes ? `${r.episodes} eps` : null, r.year, r.status].filter(Boolean).join(" · ");
            return (
              <li className="result" key={`${r.source}-${r.id}`}>
                {img ? <img src={img} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <div className="result-blank" aria-hidden="true" />}
                <div className="result-id">
                  <p className="result-title">{r.title}</p>
                  {r.altTitle && <p className="result-alt">{r.altTitle}</p>}
                  <p className="result-meta">{bits}</p>
                  {r.synopsis && <p className="result-syn">{r.synopsis}</p>}
                </div>
                <button className={`btn${existing ? "" : " btn-ink"}`} type="button" onClick={() => choose(r)}>
                  {linkKey ? "Use this" : existing ? "Update sheet" : "Add"}
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
