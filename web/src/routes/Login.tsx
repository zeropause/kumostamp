/* Sign in with MyAnimeList, or see who is signed in and sign out. */
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { SIGN_IN_URL, signOut, useAccount } from "../lib/account";

export function Login() {
  const account = useAccount();
  const [params] = useSearchParams();
  const error = params.get("error");
  const [busy, setBusy] = useState(false);

  return (
    <main id="main" className="account-page">
      <section className="account-card" aria-labelledby="account-title">
        <span className="cell-label">Account</span>
        {account.status === "signed-in" ? (
          <>
            <h2 id="account-title">Signed in as {account.user.name}</h2>
            <div className="account-who">
              {account.user.picture && <img src={account.user.picture} alt="" width={56} height={56} />}
              <p>Through MyAnimeList. Kumostamp only reads your profile name and picture.</p>
            </div>
            <div className="account-actions">
              <Link className="btn btn-ink" to="/">Back to your library</Link>
              <button
                className="btn"
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  await signOut().finally(() => setBusy(false));
                }}
              >
                Sign out
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 id="account-title">Sign in to keep your marks in one place</h2>
            <p className="account-lede">
              Use your MyAnimeList account. Your marks stay in this browser and the extension as they do now. Syncing them to your account
              (so another browser picks them up, without exporting a file) comes next.
            </p>
            {error && (
              <p className="account-error" role="alert">
                {error}
              </p>
            )}
            <div className="account-actions">
              {account.status === "unavailable" ? (
                <p className="muted">Signing in needs the Kumostamp server, which isn't running behind this page.</p>
              ) : (
                <a className="btn btn-ink btn-lg" href={SIGN_IN_URL} aria-disabled={account.status === "loading"}>
                  Sign in with MyAnimeList
                </a>
              )}
            </div>
          </>
        )}
      </section>
    </main>
  );
}
