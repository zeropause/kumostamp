/* The timesheet's printed title block: name, counts, data source, actions. */
import { useRef } from "react";
import { Link } from "react-router-dom";
import { useAccount } from "../lib/account";
import { useStore, op } from "../lib/store";
import { syncNow, useSync } from "../lib/sync";
import type { Db } from "../lib/ks";
import { Icon } from "./Icon";
import { LogoMark } from "./Logo";
import { useUi } from "./ui";

export function TitleBlock() {
  const { db, mode, extVersion } = useStore();
  const { openAdd, closeAdd, addRequest, toast } = useUi();
  const account = useAccount();
  const sync = useSync();
  const fileRef = useRef<HTMLInputElement>(null);
  const all = Object.values(db.series || {});
  const marks = all.reduce((n, s) => n + Object.keys(s.episodes || {}).length, 0);

  const linkText =
    mode === "extension" ? `Extension ${extVersion ? "v" + extVersion + " " : ""}connected`
    : mode === "untrusted" ? "Extension found: allow this site"
    : mode === "local" ? "This browser only"
    : "Looking for the extension…";

  function exportJson() {
    const blob = new Blob([JSON.stringify(db, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `kumostamp-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function importJson(file: File) {
    try {
      const parsed = JSON.parse(await file.text()) as Db;
      if (!parsed || typeof parsed.series !== "object") throw new Error("bad");
      await op({ type: "import", db: parsed });
      toast(`Imported ${Object.keys(parsed.series).length} series. Newer marks won where both had one.`);
    } catch {
      toast("That file isn't a Kumostamp export.");
    }
  }

  return (
    <header className="title-block">
      <div className="tb-cell tb-name">
        <Link to="/" className="wordmark-link" aria-label="Kumostamp, go to your library">
          <LogoMark size={44} />
          <h1 className="wordmark">Kumostamp</h1>
        </Link>
      </div>
      <div className="tb-cell tb-count">
        <span className="tb-label">Series</span>
        <span className="tb-value">{all.length}</span>
      </div>
      <div className="tb-cell tb-count">
        <span className="tb-label">Marks</span>
        <span className="tb-value">{marks}</span>
      </div>
      <div className="tb-cell tb-link">
        <span className="tb-label">Source</span>
        <span
          className="link-state"
          data-state={mode}
          title={
            mode === "untrusted" ? "Open the Kumostamp extension popup on this tab and press “Use this page as my library”."
            : mode === "local" ? "The Kumostamp extension isn't installed in this browser. Marks are kept in this browser only."
            : undefined
          }
        >
          {linkText}
        </span>
        {sync.status !== "off" && (
          <span className="sync-state" data-state={sync.status} role="status">
            {sync.status === "syncing" ? "Syncing with your account…"
            : sync.status === "synced" ? "Synced with your account"
            : (
              <>
                {sync.message}{" "}
                <button className="linklike" type="button" onClick={() => syncNow()}>
                  Retry
                </button>
              </>
            )}
          </span>
        )}
      </div>
      <div className="tb-cell tb-actions">
        <button className="btn btn-ink" type="button" aria-expanded={!!addRequest} aria-controls="add-panel" onClick={() => (addRequest ? closeAdd() : openAdd({}))}>
          <Icon name="plus" />
          Add series
        </button>
        <button className="btn btn-icon" type="button" title="Export marks as JSON" aria-label="Export marks as JSON" onClick={exportJson}>
          <Icon name="down" />
        </button>
        <button className="btn btn-icon" type="button" title="Import marks from JSON" aria-label="Import marks from JSON" onClick={() => fileRef.current?.click()}>
          <Icon name="up" />
        </button>
        {account.status === "signed-in" ? (
          <Link className="btn btn-flat account-chip" to="/login" title="Your account">
            {account.user.picture && <img src={account.user.picture} alt="" width={24} height={24} />}
            <span>{account.user.name}</span>
          </Link>
        ) : account.status === "signed-out" ? (
          <Link className="btn" to="/login">
            Sign in
          </Link>
        ) : null}
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) importJson(f);
            e.target.value = "";
          }}
        />
      </div>
    </header>
  );
}
