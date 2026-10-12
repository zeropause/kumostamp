/*
 * One series, every episode. Linked series pull their full episode list
 * (titles, air dates, runtime) from the catalog; your marks sit on top.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Icon } from "../components/Icon";
import { AddMarkRow, EpisodeRow, EpisodeTableHead, FindInfo, MetaLine, Poster, SheetTools, SourceLine, UnwatchedRow } from "../components/Sheet";
import { episodes as loadEpisodes, LABEL, type EpisodeList } from "../lib/catalog";
import { KS, epCode, isMovie, seasonOf, sortedEpisodes, type Series } from "../lib/ks";
import { useStore } from "../lib/store";

type ListState = { status: "idle" | "loading" | "ready" | "error"; data?: EpisodeList; error?: string };

function useEpisodeList(series: Series | undefined): ListState {
  const [state, setState] = useState<ListState>({ status: "idle" });
  const source = series?.meta?.source;
  const id = series?.meta?.id;
  const season = series ? seasonOf(series.title) : null;

  useEffect(() => {
    if (!source || !id) {
      setState({ status: "idle" });
      return;
    }
    let live = true;
    setState({ status: "loading" });
    loadEpisodes(source, id, season)
      .then((data) => live && setState({ status: "ready", data }))
      .catch((err: Error) => live && setState({ status: "error", error: err.message }));
    return () => {
      live = false;
    };
  }, [source, id, season]);

  return state;
}

export function SeriesPage() {
  const { key = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { db, mode } = useStore();
  const series = db.series[key];
  const list = useEpisodeList(series);
  const [addingEp, setAddingEp] = useState<number | null | undefined>(params.get("mark") ? null : undefined);

  // Arriving from "Add series" opens the hand-mark row once.
  useEffect(() => {
    if (params.get("mark")) {
      setParams((p) => {
        p.delete("mark");
        return p;
      }, { replace: true });
    }
  }, [params, setParams]);

  useEffect(() => {
    if (series) document.title = `${series.title} · Kumostamp`;
    return () => {
      document.title = "Kumostamp";
    };
  }, [series]);

  const rows = useMemo(() => {
    if (!series) return [];
    const marked = new Map(sortedEpisodes(series));
    const catalog = list.data?.episodes || [];
    const out: { key: string; number: number | null; title?: string; aired?: string }[] = [];
    const seen = new Set<string>();
    if (marked.has(KS.FILM)) {
      out.push({ key: KS.FILM, number: null });
      seen.add(KS.FILM);
    }
    for (const e of catalog) {
      const k = String(e.number);
      out.push({ key: k, number: e.number, title: e.title, aired: e.aired });
      seen.add(k);
    }
    // Marks the catalog doesn't list (specials, wrong count) still show.
    for (const k of marked.keys()) if (!seen.has(k)) out.push({ key: k, number: Number(k) });
    return out.sort((a, b) => (a.number ?? -1) - (b.number ?? -1));
  }, [series, list.data]);

  if (mode === "pending") return <main id="main" />;

  if (!series) {
    return (
      <main id="main" className="not-found">
        <h2>No sheet called “{key}”.</h2>
        <p>
          It may have been deleted, or renamed when you linked it to a catalog entry. <Link to="/">Back to the library</Link>.
        </p>
      </main>
    );
  }

  const m = series.meta;
  const movie = isMovie(series);
  const runtimeMin = list.data?.runtime || m?.runtime || null;
  const defaultDuration = runtimeMin ? runtimeMin * 60 : undefined;
  const filmMark = series.episodes[KS.FILM];
  const watched = Object.values(series.episodes).filter((e) => e.finished).length;
  const totalEps = list.data?.total || m?.episodes || null;
  const marked = (k: string) => series.episodes[k];

  return (
    <main id="main" className="series-page">
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/" className="linklike">
          <Icon name="back" />
          Library
        </Link>
      </nav>

      <article className="sheet sheet-full" aria-labelledby="series-title">
        <div className="sheet-head sheet-head-lg">
          <Poster series={series} size="lg" />
          <div className="sheet-id">
            <h2 className="sheet-title sheet-title-lg" id="series-title">
              {series.title}
            </h2>
            {m?.altTitle && m.altTitle !== series.title && <p className="sheet-alt">{m.altTitle}</p>}
            <MetaLine meta={m} />
            {m?.genres && m.genres.length > 0 && (
              <ul className="genres">
                {m.genres.slice(0, 6).map((g) => (
                  <li key={g}>{g}</li>
                ))}
              </ul>
            )}
            {m?.synopsis ? <p className="synopsis synopsis-full">{m.synopsis}</p> : <FindInfo series={series} />}
            <SourceLine meta={m} series={series} />
          </div>
          <SheetTools series={series} onDeleted={() => navigate("/")} />
        </div>

        <div className="form-row" role="group" aria-label="Progress">
          <div className="fr-cell">
            <span className="cell-label">Marked</span>
            <span className="fr-value">{Object.keys(series.episodes).length}</span>
          </div>
          <div className="fr-cell">
            <span className="cell-label">Finished</span>
            <span className="fr-value">
              {watched}
              {totalEps ? <small> / {totalEps}</small> : null}
            </span>
          </div>
          <div className="fr-cell">
            <span className="cell-label">Runtime</span>
            <span className="fr-value">{runtimeMin ? `${runtimeMin} min` : "—"}</span>
          </div>
          <div className="fr-cell fr-wide">
            <span className="cell-label">Episode list</span>
            <span className="fr-note">
              {list.status === "loading" && `Loading from ${LABEL[m!.source!]}…`}
              {list.status === "ready" && movie && `A movie, ${runtimeMin ? runtimeMin + " minutes" : "runtime unknown"} · from ${LABEL[m!.source!]}`}
              {list.status === "ready" && !movie && `${list.data!.episodes.length} episodes from ${LABEL[m!.source!]}${list.data!.nextAiring ? ` · Ep ${list.data!.nextAiring.episode} airs ${new Date(list.data!.nextAiring.at).toLocaleDateString()}` : ""}`}
              {list.status === "error" && list.error}
              {list.status === "idle" && "Link this series to a catalog to list every episode."}
            </span>
          </div>
        </div>

        <div className="table-wrap">
          <table className="ep-table">
            <EpisodeTableHead />
            <tbody>
              {movie && !filmMark && addingEp !== null && (
                <tr className="row-next">
                  <th scope="row" className="c-ep">
                    <span className="ep-box">{epCode(KS.FILM)}</span>
                  </th>
                  <td className="c-ruler">
                    <span className="ep-title">{series.title}</span>
                  </td>
                  <td className="c-time" colSpan={2}>
                    <span className="muted">Not started</span>
                  </td>
                  <td className="c-act">
                    <button className="btn btn-quiet" type="button" onClick={() => setAddingEp(null)}>
                      Mark
                    </button>
                  </td>
                </tr>
              )}
              {rows.map((r) => {
                const ep = marked(r.key);
                if (ep) return <EpisodeRow key={r.key} series={series} epKey={r.key} ep={ep} catalogTitle={r.title} defaultDuration={defaultDuration} />;
                if (addingEp != null && addingEp === r.number) {
                  return (
                    <AddMarkRow key={r.key} series={series} suggestedEp={r.number} open onOpen={() => {}} onClose={() => setAddingEp(undefined)} defaultDuration={defaultDuration} />
                  );
                }
                return <UnwatchedRow key={r.key} number={r.number!} title={r.title} aired={r.aired} onMark={() => setAddingEp(r.number)} />;
              })}
              {!(movie && filmMark) && (
                <AddMarkRow
                  series={series}
                  suggestedEp={null}
                  open={addingEp === null}
                  onOpen={() => setAddingEp(null)}
                  onClose={() => setAddingEp(undefined)}
                  defaultDuration={defaultDuration}
                />
              )}
            </tbody>
          </table>
        </div>
      </article>
    </main>
  );
}
