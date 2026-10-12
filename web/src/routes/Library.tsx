/* Library: the continue band, then one sheet per series. Filters live in the URL. */
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ContinueBand } from "../components/ContinueBand";
import { Landing } from "../components/Landing";
import { Icon } from "../components/Icon";
import { AddMarkRow, EpisodeRow, EpisodeTableHead, FindInfo, MetaLine, Poster, SeriesTitleLink, SheetTools, SourceLine } from "../components/Sheet";
import { Ruler } from "../components/Ruler";
import { KS, epCode, isMovie, mediaType, seriesState, sortedEpisodes, type MediaType, type Series } from "../lib/ks";
import { sampleDb } from "../lib/sample";
import { clearSample, loadSample, useStore } from "../lib/store";

type Show = "progress" | "all" | "done";
type Sort = "recent" | "az";

export function Library() {
  const { db, mode } = useStore();
  const [params, setParams] = useSearchParams();
  const show = (params.get("show") as Show) || "progress";
  const sort = (params.get("sort") as Sort) || "recent";
  const type = (params.get("type") as MediaType | "all") || "all";
  const filter = params.get("q") || "";

  const setParam = (k: string, v: string, fallback: string) =>
    setParams((p) => {
      if (v === fallback) p.delete(k);
      else p.set(k, v);
      return p;
    }, { replace: true });

  const all = Object.values(db.series || {});
  if (mode === "pending") return <main id="main" />;

  const sampleNote = db.sample && (
    <div className="sample-note" role="note">
      <span>
        <strong>Sample sheet.</strong> Made-up marks to show how it works. Nothing here is yours.
      </span>
      <button className="btn btn-quiet" type="button" onClick={clearSample}>
        Clear sample
      </button>
    </div>
  );

  if (!all.length) {
    return (
      <main id="main">
        {sampleNote}
        <Landing
          mode={mode}
          onSample={mode === "local" ? () => { loadSample(sampleDb()); window.scrollTo(0, 0); } : undefined}
        />
      </main>
    );
  }

  const q = filter.trim().toLowerCase();
  let list = all;
  if (q) list = list.filter((s) => `${s.title} ${s.meta?.altTitle || ""}`.toLowerCase().includes(q));
  if (show !== "all") list = list.filter((s) => seriesState(s) === show);
  if (type !== "all") list = list.filter((s) => mediaType(s) === type);
  list = [...list].sort(sort === "az" ? (a, b) => a.title.localeCompare(b.title) : (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  return (
    <main id="main">
      {sampleNote}
      <ContinueBand db={db} />
      <div className="toolbar">
        <label className="filter">
          <Icon name="search" />
          <input type="search" value={filter} placeholder="Filter your sheets" aria-label="Filter series" onChange={(e) => setParam("q", e.target.value, "")} />
        </label>
        <Segmented label="Show" value={show} onChange={(v) => setParam("show", v, "progress")} options={[["progress", "In progress"], ["all", "All"], ["done", "Finished"]]} />
        <Segmented
          label="Type"
          value={type}
          onChange={(v) => setParam("type", v, "all")}
          options={[["all", "All"], ["anime", "Anime"], ["tv", "TV series"], ["movie", "Movies"]]}
        />
        <Segmented label="Sort" value={sort} onChange={(v) => setParam("sort", v, "recent")} options={[["recent", "Recent"], ["az", "A–Z"]]} />
      </div>
      <div className="sheets">
        {list.length ? (
          list.map((s) => <LibrarySheet key={s.key} series={s} />)
        ) : (
          <p className="no-match">
            {filter
              ? `No sheet matches “${filter}”. `
              : type !== "all"
                ? `No ${{ anime: "anime", tv: "TV series", movie: "movies" }[type]}${show === "done" ? " finished" : show === "progress" ? " in progress" : ""} yet. `
                : show === "done"
                  ? "Nothing finished yet. "
                  : "Everything here is finished. "}
            {(show !== "all" || type !== "all") && (
              <button
                className="linklike"
                type="button"
                onClick={() =>
                  setParams((p) => {
                    p.delete("show");
                    p.delete("type");
                    p.set("show", "all");
                    return p;
                  }, { replace: true })
                }
              >
                Show all sheets
              </button>
            )}
          </p>
        )}
      </div>
    </main>
  );
}

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

/** Compact sheet: the marks you have, the next episode, and a hand-mark row. */
function LibrarySheet({ series }: { series: Series }) {
  const [adding, setAdding] = useState(false);
  const entries = sortedEpisodes(series);
  const numbered = entries.filter(([k]) => k !== KS.FILM).map(([k]) => Number(k));
  const maxEp = numbered.length ? Math.max(...numbered) : 0;
  const total = series.meta?.episodes;
  const lastDone = maxEp > 0 && series.episodes[String(maxEp)].finished;
  const movie = isMovie(series);
  const nextEp = movie ? null : !entries.length ? 1 : lastDone && (!total || maxEp < total) ? maxEp + 1 : null;
  const m = series.meta;

  return (
    <article className="sheet" id={`s-${series.key}`} aria-labelledby={`t-${series.key}`}>
      <div className="sheet-head">
        <Poster series={series} />
        <div className="sheet-id">
          <h3 className="sheet-title" id={`t-${series.key}`}>
            <SeriesTitleLink series={series} />
          </h3>
          {m?.altTitle && m.altTitle !== series.title && <p className="sheet-alt">{m.altTitle}</p>}
          <MetaLine meta={m} />
          {m?.synopsis ? <p className="synopsis synopsis-clamp">{m.synopsis}</p> : <FindInfo series={series} />}
          <SourceLine meta={m} series={series} />
        </div>
        <SheetTools series={series} />
      </div>
      <div className="table-wrap">
        <table className="ep-table">
          <EpisodeTableHead />
          <tbody>
            {entries.map(([k, ep]) => (
              <EpisodeRow key={k} series={series} epKey={k} ep={ep} />
            ))}
            {nextEp != null && entries.length > 0 && (
              <tr className="row-next">
                <th scope="row" className="c-ep">
                  <span className="ep-box">{epCode(nextEp)}</span>
                </th>
                <td className="c-ruler">
                  <Ruler ghost time={0} label="" />
                </td>
                <td className="c-time" colSpan={3}>
                  <span className="muted">Next up · not started</span>
                </td>
              </tr>
            )}
            {!(movie && entries.length > 0) && (
              <AddMarkRow
                series={series}
                suggestedEp={nextEp}
                open={adding}
                onOpen={() => setAdding(true)}
                onClose={() => setAdding(false)}
                defaultDuration={m?.runtime ? m.runtime * 60 : undefined}
              />
            )}
          </tbody>
        </table>
      </div>
      <div className="sheet-foot">
        <SeriesTitleLink series={series} className="linklike" />
        <span className="muted">{movie ? " · details" : ` · all episodes${total ? ` (${total})` : ""}`}</span>
      </div>
    </article>
  );
}
