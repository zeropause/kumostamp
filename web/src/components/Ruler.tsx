/*
 * The ruler: the sheet's signature instrument. One tick per minute, a heavier
 * tick every five, the red pencil at the stop. Click or arrow keys move the mark.
 */
import { useRef, useState, type CSSProperties } from "react";
import { KS } from "../lib/ks";

const DEFAULT_EP_SECONDS = 24 * 60;

interface Props {
  time: number;
  duration?: number;
  finished?: boolean;
  size?: "xl";
  label: string;
  onSet?: (sec: number) => void;
  ghost?: boolean;
}

export function Ruler({ time, duration, finished, size, label, onSet, ghost }: Props) {
  const total = Math.max(duration || DEFAULT_EP_SECONDS, (time || 0) + 60);
  const minutes = Math.max(1, Math.round(total / 60));
  const ref = useRef<HTMLDivElement>(null);
  const hoverRef = useRef<HTMLSpanElement>(null);
  const [pendingSec, setPending] = useState<number | null>(null);
  const commit = useRef<number | undefined>(undefined);
  const shown = pendingSec ?? time ?? 0;

  const cls = ["ruler", size && `ruler-${size}`, finished && "is-done", onSet && "is-live", ghost && "ruler-ghost"].filter(Boolean).join(" ");
  const style = { "--pos": String(Math.min(1, shown / total)), "--minutes": String(minutes) } as CSSProperties;

  if (ghost) return <div className={cls} style={style} aria-hidden="true" />;

  if (!onSet) {
    return (
      <div className={cls} style={style} role="img" aria-label={`${label} at ${KS.formatTime(time)} of ${KS.formatTime(total)}`}>
        <span className="ruler-mark" />
      </div>
    );
  }

  const at = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.round(Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * total);
  };

  return (
    <div
      ref={ref}
      className={cls}
      style={style}
      tabIndex={0}
      role="slider"
      aria-label={`${label}. Click or use arrow keys to move the mark`}
      aria-valuemin={0}
      aria-valuemax={Math.round(total)}
      aria-valuenow={Math.round(shown)}
      aria-valuetext={KS.formatTime(shown)}
      onPointerMove={(e) => {
        // Direct style writes: no re-render per pointer move.
        const sec = at(e.clientX);
        const h = hoverRef.current;
        if (!h) return;
        h.style.setProperty("--hx", String(sec / total));
        h.firstElementChild!.textContent = KS.formatTime(sec);
      }}
      onClick={(e) => onSet(at(e.clientX))}
      onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        const step = e.shiftKey ? 60 : 10;
        const next = Math.min(total, Math.max(0, shown + (e.key === "ArrowRight" ? step : -step)));
        setPending(next);
        window.clearTimeout(commit.current);
        commit.current = window.setTimeout(() => {
          onSet(next);
          setPending(null);
        }, 700);
      }}
    >
      <span className="ruler-mark" />
      <span className="ruler-hover" ref={hoverRef} aria-hidden="true">
        <span className="ruler-hover-time" />
      </span>
    </div>
  );
}
