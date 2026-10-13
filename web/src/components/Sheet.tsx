/* Sheet pieces: poster, meta line, providers, episode rows, the hand-mark row. */
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { KS, epCode, epName, isEpisodic, safeUrl, type Episode, type Meta, type Series } from "../lib/ks";
import { LABEL, brief, complete, details } from "../lib/catalog";
import { useLookingUp } from "../lib/autolink";
import { Icon } from "./Icon";
import { Ruler } from "./Ruler";
import { useUi } from "./ui";

export function Poster({ series, size }: { series: Series; size?: "lg" }) {
  const src = safeUrl(series.meta?.image);
  const [failed, setFailed] = useState<string | null>(null);
  const cls = `poster${size ? " poster-" + size : ""}`;
  if (src && failed !== src) {
    return <img className={cls} src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(src)} />;
  }
  const initials = series.title.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return (
    <div className={`${cls} poster-blank`} aria-hidden="true">
      {initials || "?"}
    </div>
  );
}

export function MetaLine({ meta }: { meta: Meta | null }) {
  if (!meta) return null;
  const bits = [
    meta.kind,
    meta.episodes ? `${meta.episodes} eps` : null,
    meta.runtime && /movie|film/i.test(meta.kind || "") ? `${meta.runtime} min` : null,
    meta.year,
    meta.status,
    meta.score ? `score ${meta.score}` : null,
  ].filter(Boolean);
  if (!bits.length) return null;
  return <p className="sheet-meta">{bits.join(" · ")}</p>;
}

export function SourceLine({ meta, series }: { meta: Meta | null; series?: Series }) {
  const { run, toast } = useUi();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  if (!meta?.source) return null;
  const href = safeUrl(meta.url);
  const label = LABEL[meta.source] || meta.source;
  const alts = (meta.alternatives || []).filter((a) => a && a.source && a.id != null);

  async function choose(a: NonNullable<Meta["alternatives"]>[number]) {
    if (!series) return;
    setBusy(`${a.source}:${a.id}`);
    try {
      const full = await complete({ source: a.source, id: a.id, image: a.image || "" });
      const others = alts.filter((x) => !(x.source === a.source && x.id === a.id));
      if (meta?.source && meta.id != null) others.unshift(brief(meta));
      await run({ type: "upsertSeries", key: series.key, meta: { ...full, confident: true, chosen: true, alternatives: others.slice(0, 3) } }, `Switched to ${full.title}.`);
      setOpen(false);
    } catch (err) {
      toast((err as Error).message || "Couldn't reach the catalog.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
    <p className="sheet-source">
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer">
          {label}
        </a>
      ) : (
        label
      )}
      {meta.fetchedAt ? ` · info updated ${KS.relTime(meta.fetchedAt)}` : ""}
      {meta.confident === false && " · best guess"}
      {series && alts.length > 0 && (
        <>
          {" · "}
          <button className="linklike" type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {meta.confident === false ? "Not this one?" : "Wrong match?"}
          </button>
        </>
      )}
    </p>
    {open && (
      <ul className="alt-list">
        {alts.map((a) => (
          <li key={`${a.source}:${a.id}`}>
            <button className="alt-pick" type="button" disabled={!!busy} onClick={() => choose(a)}>
              <span className="alt-pick-title">{a.title}</span>
              <span className="alt-pick-facts">
                {[LABEL[a.source], a.kind, a.episodes ? `${a.episodes} eps` : null, a.year].filter(Boolean).join(" · ")}
                {busy === `${a.source}:${a.id}` ? " · switching…" : ""}
              </span>
            </button>
          </li>
        ))}
      </ul>
    )}
    </>
  );
}

export function FindInfo({ series }: { series: Series }) {
  const { openAdd } = useUi();
  const looking = useLookingUp(series.key);
  if (looking) return <p className="synopsis-missing is-looking">Looking this up on AniList, TVmaze and IMDb…</p>;
  const find = (source: "anilist" | "tvmaze" | "cinemeta") => () => openAdd({ linkKey: series.key, query: series.title, source });
  return (
    <p className="synopsis-missing">
      No description yet. Find it on{" "}
      <button className="linklike" type="button" onClick={find("anilist")}>
        AniList
      </button>{" "}
      or{" "}
      <button className="linklike" type="button" onClick={find("tvmaze")}>
        TVmaze
      </button>
      , or as a movie on{" "}
      <button className="linklike" type="button" onClick={find("cinemeta")}>
        IMDb
      </button>
      .
    </p>
  );
}

export function Providers({ ep }: { ep: Episode }) {
  const entries = Object.entries(ep.providers || {}).sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0));
  if (!entries.length) return <span className="muted">Added by hand</span>;
  return (
    <ul className="providers is-compact">
      {entries.map(([host, p]) => {
        const href = safeUrl(p.url);
        const inner = (
          <>
            <span className="prov-host">{host}</span>
            <span className="prov-time">{KS.formatTime(p.time)}</span>
          </>
        );
        return (
          <li key={host}>
            {href ? (
              <a href={href} target="_blank" rel="noopener noreferrer" title={`Open on ${host} (stopped at ${KS.formatTime(p.time)})`}>
                {inner}
              </a>
            ) : (
              <span className="prov-static">{inner}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Opens the episode that was played last, on the site it was last played on. */
export function ContinueWatching({ series }: { series: Series }) {
  let last: Episode | null = null;
  for (const ep of Object.values(series.episodes)) {
    if (!last || (ep.updatedAt || 0) > (last.updatedAt || 0)) last = ep;
  }
  const host = last?.lastHost;
  const href = safeUrl(host ? last?.providers?.[host]?.url : undefined);
  if (!last || !host || !href) return null;
  const where = last.episode == null ? (isEpisodic(series) ? "Unnumbered mark" : "Film") : epName(last.episode);
  return (
    <a
      className="btn btn-red continue-watching"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={`Resume on ${host}`}
      aria-label={`Continue watching ${series.title}, ${where}, at ${KS.formatTime(last.time)}, on ${host}`}
    >
      <Icon name="play" />
      <span className="cw-text">
        Continue Watching
        <span className="cw-sub">
          {where} · {KS.formatTime(last.time)}
        </span>
      </span>
    </a>
  );
}

/** Tools every sheet header carries: continue watching, refresh info, link info, delete. */
export function SheetTools({ series, onDeleted }: { series: Series; onDeleted?: () => void }) {
  const { openAdd, run, toast } = useUi();
  const [spinning, setSpinning] = useState(false);
  const m = series.meta;

  async function refresh() {
    if (!m?.source || !m.id) return;
    setSpinning(true);
    try {
      const fresh = await details(m.source, m.id);
      await run({ type: "upsertSeries", key: series.key, meta: fresh }, `Updated ${series.title} from ${LABEL[m.source]}.`);
    } catch (err) {
      toast((err as Error).message || "Couldn't reach the catalog.");
    } finally {
      setSpinning(false);
    }
  }

  function remove() {
    const snapshot = structuredClone(series);
    run({ type: "deleteSeries", key: series.key });
    onDeleted?.();
    toast(`Deleted ${series.title}.`, {
      label: "Undo",
      run: () => run({ type: "import", restore: true, db: { series: { [series.key]: snapshot }, aliases: {} } }),
    });
  }

  return (
    <div className="sheet-tools">
      <ContinueWatching series={series} />
      {m?.source && (
        <button className={`btn btn-icon${spinning ? " is-spinning" : ""}`} type="button" title="Fetch the latest description" aria-label={`Fetch the latest description for ${series.title}`} onClick={refresh}>
          <Icon name="refresh" />
        </button>
      )}
      <button
        className="btn btn-icon"
        type="button"
        title={m ? "Link to a different catalog entry" : "Find info on AniList, TVmaze or IMDb"}
        aria-label={`Link catalog info for ${series.title}`}
        onClick={() => openAdd({ linkKey: series.key, query: series.title, source: m?.source && m.source !== "jikan" ? m.source : "anilist" })}
      >
        <Icon name="link" />
      </button>
      <button className="btn btn-icon btn-danger" type="button" title="Delete this sheet" aria-label={`Delete ${series.title}`} onClick={remove}>
        <Icon name="trash" />
      </button>
    </div>
  );
}

/* ---------------- episode rows ---------------- */

interface RowProps {
  series: Series;
  epKey: string;
  ep: Episode;
  catalogTitle?: string;
  defaultDuration?: number;
}

export function EpisodeRow({ series, epKey, ep, catalogTitle, defaultDuration }: RowProps) {
  const { run, copy, toast } = useUi();
  const [editing, setEditing] = useState(false);
  const unassigned = epKey === KS.FILM && isEpisodic(series);
  const name = unassigned ? "the unnumbered mark" : epName(ep.episode);
  const duration = ep.duration || defaultDuration;

  function remove() {
    const snapshot = structuredClone(ep);
    run({ type: "deleteEpisode", key: series.key, episode: ep.episode });
    toast(`Removed ${name} of ${series.title}.`, {
      label: "Undo",
      run: () =>
        run({ type: "import", db: { series: { [series.key]: { key: series.key, title: series.title, meta: series.meta, episodes: { [epKey]: snapshot } } }, aliases: {} }, restore: true }),
    });
  }

  return (
    <tr className={[ep.finished && "is-done", unassigned && "is-unassigned"].filter(Boolean).join(" ")}>
      <th scope="row" className="c-ep">
        {unassigned ? (
          <span className="ep-box is-unknown" title="Saved without an episode number">??</span>
        ) : (
          <span className="ep-box">{epCode(epKey)}</span>
        )}
      </th>
      <td className="c-ruler">
        {catalogTitle && <span className="ep-title">{catalogTitle}</span>}
        <Ruler
          time={ep.time}
          duration={duration}
          finished={ep.finished}
          label={`${series.title} ${name}`}
          onSet={(sec) => run({ type: "setEpisode", key: series.key, episode: ep.episode, time: sec, duration }, `${name} mark moved to ${KS.formatTime(sec)}.`)}
        />
      </td>
      <td className="c-time">
        {unassigned && <AssignEpisode series={series} />}
        {editing ? (
          <EditTime
            initial={KS.formatTime(ep.time)}
            onCancel={() => setEditing(false)}
            onSave={(sec) => {
              setEditing(false);
              run({ type: "setEpisode", key: series.key, episode: ep.episode, time: sec }, `${series.title} ${name} now at ${KS.formatTime(sec)}.`);
            }}
          />
        ) : (
          <span className={`mark-time${ep.finished ? " is-done" : ""}`}>
            {ep.finished ? "done" : KS.formatTime(ep.time)}
            {ep.duration ? <small> / {KS.formatTime(ep.duration)}</small> : null}
          </span>
        )}
      </td>
      <td className="c-prov">
        <Providers ep={ep} />
        <span className="c-when">{KS.relTime(ep.updatedAt)}</span>
      </td>
      <td className="c-act">
        <button className="btn btn-icon btn-flat" type="button" title="Copy time" aria-label={`Copy ${name} time`} onClick={() => copy(KS.formatTime(ep.time))}>
          <Icon name="copy" />
        </button>
        <button className="btn btn-icon btn-flat" type="button" title="Type a time" aria-label={`Edit ${name} time`} onClick={() => setEditing(true)}>
          <Icon name="edit" />
        </button>
        <button className="btn btn-icon btn-flat btn-danger" type="button" title="Remove this mark" aria-label={`Remove ${name}`} onClick={remove}>
          <Icon name="trash" />
        </button>
      </td>
    </tr>
  );
}

/** A mark saved without an episode number: say which episode it belongs to. */
function AssignEpisode({ series }: { series: Series }) {
  const { run, toast } = useUi();
  const [value, setValue] = useState("");
  return (
    <form
      className="assign-ep"
      onSubmit={(e) => {
        e.preventDefault();
        const n = Number(value.trim());
        if (!value.trim() || !Number.isInteger(n) || n < 0) return toast("Type the episode number this mark belongs to.");
        const clash = series.episodes[String(n)];
        run(
          { type: "moveEpisode", key: series.key, from: null, to: n },
          clash ? `Merged into ${epName(n)}; the newer mark was kept.` : `Moved to ${epName(n)}.`,
        );
      }}
    >
      <label>
        <span>No episode number. Which one?</span>
        <input inputMode="numeric" placeholder="Ep" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Episode number for this mark" />
      </label>
      <button className="btn btn-quiet" type="submit">
        Move
      </button>
    </form>
  );
}

function EditTime({ initial, onSave, onCancel }: { initial: string; onSave: (sec: number) => void; onCancel: () => void }) {
  const { toast } = useUi();
  const [value, setValue] = useState(initial);
  return (
    <form
      className="edit-time"
      onSubmit={(e) => {
        e.preventDefault();
        const sec = KS.parseTime(value);
        if (sec === null) return toast("Use a time like 26:14 or 1:02:03.");
        onSave(sec);
      }}
    >
      <input value={value} aria-label="Time" autoFocus onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === "Escape" && onCancel()} />
      <button className="btn btn-quiet" type="submit">
        Save
      </button>
    </form>
  );
}

/** An episode the catalog knows but you haven't marked: ghost ruler, one-click mark. */
export function UnwatchedRow({ number, title, aired, onMark }: { number: number; title?: string; aired?: string; onMark: () => void }) {
  return (
    <tr className="row-next">
      <th scope="row" className="c-ep">
        <span className="ep-box">{epCode(number)}</span>
      </th>
      <td className="c-ruler">
        {title && <span className="ep-title">{title}</span>}
        <Ruler ghost time={0} label="" />
      </td>
      <td className="c-time" colSpan={2}>
        <span className="muted">{aired && new Date(aired) > new Date() ? `Airs ${aired}` : "Not started"}</span>
      </td>
      <td className="c-act">
        <button className="btn btn-quiet" type="button" onClick={onMark}>
          Mark
        </button>
      </td>
    </tr>
  );
}

/** Hand-entered mark: episode, minute, optional provider link. */
export function AddMarkRow({ series, suggestedEp, open, onOpen, onClose, defaultDuration }: {
  series: Series;
  suggestedEp: number | null;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  defaultDuration?: number;
}) {
  const { run, toast } = useUi();
  const firstRef = useRef<HTMLInputElement>(null);
  const timeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    (suggestedEp != null ? timeRef : firstRef).current?.focus();
  }, [open, suggestedEp]);

  if (!open) {
    return (
      <tr className="row-add">
        <td colSpan={5}>
          <button className="linklike add-mark-toggle" type="button" onClick={onOpen}>
            <Icon name="plus" />
            {suggestedEp != null ? `Mark ${epName(suggestedEp)}` : "Add a mark by hand"}
          </button>
        </td>
      </tr>
    );
  }

  return (
    <tr className="row-add is-open">
      <td colSpan={5}>
        <form
          className="add-mark"
          key={String(suggestedEp)}
          onSubmit={(e) => {
            e.preventDefault();
            const f = e.currentTarget.elements as unknown as Record<string, HTMLInputElement>;
            const epRaw = f.ep.value.trim();
            const episode = epRaw === "" ? null : Number(epRaw);
            if (epRaw !== "" && (!Number.isFinite(episode) || (episode as number) < 0)) return toast("Episode needs to be a number, or empty for a film.");
            const sec = KS.parseTime(f.t.value || "0:00");
            if (sec === null) return toast("Use a time like 26:14 or 1:02:03.");
            const url = f.url.value.trim();
            if (url && !safeUrl(url)) return toast("That link isn't a web address.");
            onClose();
            run({ type: "setEpisode", key: series.key, episode, time: sec, url: url || undefined, duration: defaultDuration }, `Marked ${epName(episode)} at ${KS.formatTime(sec)}.`);
          }}
        >
          <label className="am-field am-ep">
            <span>Ep</span>
            <input ref={firstRef} name="ep" inputMode="numeric" defaultValue={suggestedEp != null ? String(suggestedEp) : ""} placeholder="—" />
          </label>
          <label className="am-field am-t">
            <span>Stopped at</span>
            <input ref={timeRef} name="t" placeholder="26:14" required />
          </label>
          <label className="am-field am-url">
            <span>Link (optional)</span>
            <input name="url" type="url" placeholder="https://…" spellCheck={false} />
          </label>
          <div className="am-actions">
            <button className="btn btn-ink" type="submit">
              Add mark
            </button>
            <button className="btn btn-flat" type="button" onClick={onClose}>
              Cancel
            </button>
          </div>
        </form>
      </td>
    </tr>
  );
}

export function EpisodeTableHead() {
  return (
    <thead>
      <tr>
        <th scope="col" className="c-ep">Ep</th>
        <th scope="col" className="c-ruler">Timeline</th>
        <th scope="col" className="c-time">Mark</th>
        <th scope="col" className="c-prov">Watched on</th>
        <th scope="col" className="c-act">
          <span className="sr-only">Actions</span>
        </th>
      </tr>
    </thead>
  );
}

export function SeriesTitleLink({ series, className }: { series: Series; className?: string }) {
  return (
    <Link className={className} to={`/series/${encodeURIComponent(series.key)}`}>
      {series.title}
    </Link>
  );
}
