/*
 * The Kumostamp mark: the K's arm and leg are two clock hands swinging from the
 * stem, inside a half dial. The leg is the red pencil: where you stopped.
 * Ink follows `currentColor` so the mark sits on paper and on the night sheet.
 */
export function LogoMark({ size = 32, title }: { size?: number; title?: string }) {
  return (
    <svg
      className="logo-mark"
      width={size}
      height={size}
      viewBox="-2 0 64 64"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <rect x="6" y="6" width="13" height="52" fill="currentColor" />
      <line x1="19" y1="32" x2="39.7" y2="14.67" stroke="currentColor" strokeWidth="10" />
      <line x1="19" y1="32" x2="39.7" y2="49.33" stroke="var(--red)" strokeWidth="10" />
      <path d="M42.42 5.99A35 35 0 0 1 42.42 58.01" fill="none" stroke="currentColor" strokeWidth="4" />
      <line x1="47" y1="32" x2="52" y2="32" stroke="currentColor" strokeWidth="3" />
    </svg>
  );
}
