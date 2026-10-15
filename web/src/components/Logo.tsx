/*
 * The Kumostamp mark: a K whose leg is the red pencil, sharpened, with its
 * graphite tip. The red pencil marks where you stopped.
 * Ink follows `currentColor` so the mark sits on paper and on the night sheet.
 */
export function LogoMark({ size = 32, title }: { size?: number; title?: string }) {
  return (
    <svg
      className="logo-mark"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <path d="M8 6h14v52H8z" fill="currentColor" />
      <path d="M22 22 38 6h18L30 32h-8z" fill="currentColor" />
      <path d="M22 32h8l16 16 4.5 13.5L37 57 22 42z" fill="var(--red)" />
      <path d="M49.15 57.45 50.5 61.5l-4.05-1.35z" fill="currentColor" />
    </svg>
  );
}
