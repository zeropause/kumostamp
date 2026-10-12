/* The decisive band: where you stopped last, and the one action that returns you there. */
import { Link } from "react-router-dom";
import { KS, epCode, epName, isEpisodic, safeUrl, type Db } from "../lib/ks";
import { Icon } from "./Icon";
import { Ruler } from "./Ruler";
import { useUi } from "./ui";

export function ContinueBand({ db }: { db: Db }) {
  const { run, copy } = useUi();
  const rows = KS.recent(db);
  const pick = rows.find((r) => !r.episode.finished) || rows[0];
  if (!pick) return null;

  const { series, episode: ep, key } = pick;
  const host = ep.lastHost;
  const p = host ? ep.providers?.[host] : undefined;
  const href = safeUrl(p?.url);
  const others = Object.keys(ep.providers || {}).filter((h) => h !== host);
  const time = KS.formatTime(ep.time);

  return (
    <section className="continue" aria-labelledby="continue-title">
      <div className="cb-grid">
        <div className="cb-series">
          <h2 className="cb-title" id="continue-title">
            <Link to={`/series/${encodeURIComponent(series.key)}`}>{series.title}</Link>
          </h2>
          {series.meta?.altTitle && <p className="cb-alt">{series.meta.altTitle}</p>}
        </div>
        <div className="cb-ep">
          <span className="cell-label">{key === KS.FILM && !isEpisodic(series) ? "Film" : "Episode"}</span>
          <span className="cb-ep-num">{key !== KS.FILM ? epCode(key) : isEpisodic(series) ? "??" : "—"}</span>
        </div>
        <div className="cb-time">
          <span className="cell-label">{ep.finished ? "Finished" : "Stopped at"}</span>
          <span className={`timecode${ep.finished ? " is-done" : ""}`}>{time}</span>
          <span className="cb-of">
            {ep.duration ? `of ${KS.formatTime(ep.duration)} ` : ""}
            <span>{`${ep.duration ? "· " : ""}${KS.relTime(ep.updatedAt)}`}</span>
          </span>
        </div>
        <div className="cb-go">
          {href ? (
            <a className="btn btn-red btn-lg" href={href} target="_blank" rel="noopener noreferrer">
              <Icon name="open" />
              Resume on {host}
            </a>
          ) : (
            <span className="muted">No provider link yet</span>
          )}
          <div className="cb-go-row">
            <button className="btn" type="button" onClick={() => copy(time)}>
              <Icon name="copy" />
              Copy {time}
            </button>
            {others.length > 0 && <span className="cb-also">Also on {others.join(", ")}</span>}
          </div>
        </div>
      </div>
      <Ruler
        time={ep.time}
        duration={ep.duration}
        finished={ep.finished}
        size="xl"
        label={`${series.title} ${epName(ep.episode)}`}
        onSet={(sec) => run({ type: "setEpisode", key: series.key, episode: ep.episode, time: sec }, `Moved the mark to ${KS.formatTime(sec)}.`)}
      />
    </section>
  );
}
