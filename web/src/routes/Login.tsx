/* Sign in with MyAnimeList (your Kumostamp account) or AniList (list updates through the extension). */
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { SIGN_IN_URL, signOut, useAccount } from "../lib/account";
import { ANILIST_LOGIN_URL, useAnilist } from "../lib/anilist";
import { useStore } from "../lib/store";

const BrandLogo = ({ name }: { name: string }) => <span className={`brand-logo brand-${name}`} aria-hidden="true" />;

export function Login() {
  const account = useAccount();
  const anilist = useAnilist();
  const { mode } = useStore();
  const [params] = useSearchParams();
  const error = params.get("error");
  const [busy, setBusy] = useState(false);

  return (
    <main id="main" className="account-page">
      <div className="login-grid">
        <section className="account-card" aria-labelledby="mal-title">
          <span className="cell-label">Account</span>
          {account.status === "signed-in" ? (
            <>
              <h2 id="mal-title">Signed in as {account.user.name}</h2>
              <div className="account-who">
                {account.user.picture && <img src={account.user.picture} alt="" width={56} height={56} />}
                <p>Through MyAnimeList. Kumostamp reads only your profile name and picture.</p>
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
              <h2 id="mal-title">
                <BrandLogo name="myanimelist" /> MyAnimeList
              </h2>
              <p className="account-lede">
                Your Kumostamp account. Kumostamp keeps a copy of your marks on its server and merges it with every browser you sign in on, so
                you never need to export a file. Anime you start watching is set to Watching on your MyAnimeList list, with the episode you
                reached. The extension keeps working without signing in.
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

        <section className="account-card" aria-labelledby="anilist-title">
          <span className="cell-label">List updates</span>
          <h2 id="anilist-title">
            <BrandLogo name="anilist" /> AniList
          </h2>
          <p className="account-lede">
            {anilist.user
              ? `Connected as ${anilist.user.name}. `
              : "Not an account: it only updates your AniList list. "}
            When the extension sees you play an episode for a minute, that anime is set to Watching with the episode you reached. Turn it off
            or disconnect in the extension popup.
          </p>
          {anilist.error && (
            <p className="account-error" role="alert">
              {anilist.error}
            </p>
          )}
          <div className="account-actions">
            {!ANILIST_LOGIN_URL ? (
              <p className="muted">AniList login isn't set up on this site yet (VITE_ANILIST_CLIENT_ID).</p>
            ) : anilist.waiting && mode !== "extension" ? (
              <p className="muted">
                Signed in to AniList. Connect the Kumostamp extension to this page within an hour and it picks up the login.
              </p>
            ) : (
              <>
                <a className={anilist.user ? "btn" : "btn btn-ink btn-lg"} href={ANILIST_LOGIN_URL}>
                  {anilist.user ? "Sign in again" : "Sign in with AniList"}
                </a>
                {mode !== "extension" && !anilist.user && <span className="muted">Needs the Kumostamp extension on this browser.</span>}
              </>
            )}
          </div>
        </section>

        <section className="account-card login-soon" aria-labelledby="soon-title">
          <span className="cell-label">Coming soon</span>
          <h2 id="soon-title">Series and films</h2>
          <ul className="soon-list">
            <li>
              <BrandLogo name="trakt" /> Trakt
            </li>
            <li>
              <BrandLogo name="letterboxd" /> Letterboxd
            </li>
          </ul>
        </section>
      </div>
    </main>
  );
}
