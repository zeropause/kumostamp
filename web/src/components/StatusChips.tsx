/*
 * Homepage status chips: the three pieces that have to cooperate for auto-updates.
 * "Connected" means the auto-update pipeline demonstrably works end to end, so each
 * chip carries its last auto-update as proof, not just the login state.
 */
import { useAccount } from "../lib/account";
import { getMalLast, useSync } from "../lib/sync";
import { useStore } from "../lib/store";
import { KS } from "../lib/ks";

/** "Black Clover · ep 3/170 · 2h ago" */
function lastText(last: { title: string; progress?: number; total?: number | null; at?: number } | null) {
  if (!last || last.progress == null) return "no auto-update yet";
  const ep = last.total ? `ep ${last.progress}/${last.total}` : `ep ${last.progress}`;
  return `${last.title} · ${ep}${last.at ? ` · ${KS.relTime(last.at)}` : ""}`;
}

function Chip({ label, detail, state, title }: { label: string; detail: string; state: "ok" | "dim" | "warn"; title?: string }) {
  return (
    <span className="status-chip" data-state={state} title={title}>
      <strong>{label}</strong>
      <small>{detail}</small>
    </span>
  );
}

export function StatusChips() {
  const { mode, extVersion, anilist } = useStore();
  const account = useAccount();
  useSync(); // re-render when the MAL chip's data changes

  const malLast = getMalLast();
  const extensionState: "ok" | "dim" | "warn" = mode === "extension" ? "ok" : mode === "untrusted" ? "warn" : "dim";
  const extensionLabel =
    mode === "extension" ? `Extension ${extVersion ? "v" + extVersion : ""} connected`
    : mode === "untrusted" ? "Extension found"
    : "Extension not connected";
  const extensionTitle =
    mode === "extension" ? "Marks on streaming pages are kept here and can auto-update your lists."
    : mode === "untrusted" ? "Allow this site in the extension popup to use it as your library."
    : "Marks are kept in this browser only.";
  const extensionDetail = mode === "extension" ? "auto-updates on" : mode === "untrusted" ? "allow this site in the popup" : "this browser only";

  const malState = account.status === "signed-in" ? "ok" : account.status === "signed-out" ? "dim" : null;
  const malLabel = account.status === "signed-in" ? "MyAnimeList connected" : "MyAnimeList not connected";
  const malTitle = account.status === "signed-in" ? "Episodes you watch are sent to your MAL list. Last: " + lastText(malLast) : "Sign in with MyAnimeList on the Login page.";

  const anilistState: "ok" | "dim" | "warn" = !anilist ? "dim" : anilist.connected && anilist.syncOn ? "ok" : anilist.connected ? "warn" : "dim";
  const anilistLabel = anilist && anilist.connected ? "AniList connected" : "AniList not connected";
  const anilistTitle =
    !anilist ? "The AniList chip needs this browser's extension connected."
    : anilist.connected ? (anilist.syncOn ? "Episodes you watch auto-update your AniList list. Last: " + lastText(anilist.last) : "AniList is connected, but auto-update is off. Switch it on in the extension popup.")
    : "Connect AniList from the extension popup's Login.";
  const anilistDetail = anilistState === "ok" ? lastText(anilist ? anilist.last : null) : anilistState === "warn" ? "auto-update off" : "not connected yet";

  return (
    <div className="status-chips" role="group" aria-label="Connection status">
      <Chip label={extensionLabel} detail={extensionDetail} state={extensionState} title={extensionTitle} />
      {malState && <Chip label={malLabel} detail={lastText(malLast)} state={malState} title={malTitle} />}
      <Chip label={anilistLabel} detail={anilistDetail} state={anilistState} title={anilistTitle} />
    </div>
  );
}
