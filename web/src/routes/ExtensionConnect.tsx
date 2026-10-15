/*
 * Opened by the extension (in a sign-in window) to connect it to your account.
 * Allowing hands a one-time code back to the extension's own redirect address.
 */
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { SIGN_IN_URL, useAccount } from "../lib/account";

const EXTENSION_REDIRECT = /^https:\/\/[a-p]{32}\.chromiumapp\.org\/[\w/-]*$/;

export function ExtensionConnect() {
  const account = useAccount();
  const [params] = useSearchParams();
  const redirect = params.get("redirect_uri") || "";
  const state = params.get("state") || "";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const valid = EXTENSION_REDIRECT.test(redirect);

  const back = (fragment: Record<string, string>) => {
    location.href = `${redirect}#${new URLSearchParams({ ...fragment, state })}`;
  };

  async function allow() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/extension/grant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ redirect }),
      });
      const body = (await res.json().catch(() => ({}))) as { code?: string; error?: string };
      if (!res.ok || !body.code) throw new Error(body.error || `The server answered ${res.status}.`);
      back({ code: body.code });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <main id="main" className="account-page">
      <section className="account-card" aria-labelledby="connect-title">
        <span className="cell-label">Browser extension</span>
        {!valid ? (
          <>
            <h2 id="connect-title">Nothing to connect here</h2>
            <p className="account-lede">Open this from the Kumostamp extension: popup, Connected accounts, Kumostamp, Connect.</p>
          </>
        ) : account.status === "signed-in" ? (
          <>
            <h2 id="connect-title">Connect the extension to {account.user.name}’s account?</h2>
            <p className="account-lede">
              The extension will save your marks to this account and pick up marks from your other browsers, even while this page is closed.
              You can disconnect it from the extension popup at any time.
            </p>
            {error && (
              <p className="account-error" role="alert">
                {error}
              </p>
            )}
            <div className="account-actions">
              <button className="btn btn-ink btn-lg" type="button" disabled={busy} onClick={allow}>
                Connect extension
              </button>
              <button className="btn" type="button" disabled={busy} onClick={() => back({ error: "access_denied" })}>
                Cancel
              </button>
            </div>
          </>
        ) : account.status === "signed-out" ? (
          <>
            <h2 id="connect-title">Sign in to connect the extension</h2>
            <p className="account-lede">Sign in with MyAnimeList first. You’ll come straight back here.</p>
            <div className="account-actions">
              <a className="btn btn-ink btn-lg" href={`${SIGN_IN_URL}?next=${encodeURIComponent(location.pathname + location.search)}`}>
                Sign in with MyAnimeList
              </a>
            </div>
          </>
        ) : account.status === "unavailable" ? (
          <>
            <h2 id="connect-title">The Kumostamp server isn’t reachable</h2>
            <p className="account-lede">Check the Library address in the extension popup, then try again.</p>
          </>
        ) : null}
      </section>
    </main>
  );
}
