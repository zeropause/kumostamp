/*
 * First-time onboarding wizard shown once the website detects the extension bridge
 * (mode === "extension"). Walks through connecting MyAnimeList, AniList, and
 * Discord Rich Presence, persisting step state across OAuth redirects.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { SIGN_IN_URL, useAccount } from "../lib/account";
import { ANILIST_LOGIN_URL, useAnilist } from "../lib/anilist";
import { updateDiscord, useStore } from "../lib/store";
import { useUi } from "./ui";

const STORAGE_KEY = "kumostamp:onboarding";
const TOTAL_STEPS = 4;

export interface OnboardingState {
  done?: boolean;
  step?: number;
  returnPath?: string;
}

function readPersisted(): OnboardingState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as OnboardingState) : null;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

let state: OnboardingState = readPersisted();
const listeners = new Set<() => void>();

function updateState(next: OnboardingState) {
  state = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* private mode or blocked storage */
  }
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useOnboardingState(): OnboardingState {
  return useSyncExternalStore(subscribe, () => state);
}

/** Re-open the onboarding wizard at a specific step. */
export function openOnboarding(step = 0) {
  updateState({ done: false, step });
}

const BrandLogo = ({ name }: { name: string }) => <span className={`brand-logo brand-${name}`} aria-hidden="true" />;

export function Onboarding() {
  const { mode, extVersion, anilist: bridgeAnilist, discord } = useStore();
  const account = useAccount();
  const anilist = useAnilist();
  const { addRequest, mergeRequest, toast } = useUi();
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const persisted = useOnboardingState();
  const step = Math.min(TOTAL_STEPS - 1, Math.max(0, persisted.step ?? 0));
  const done = !!persisted.done;
  const [checkingDiscord, setCheckingDiscord] = useState(false);

  const dialogRef = useRef<HTMLDialogElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);

  // If AniList OAuth redirected back to /login#access_token=... during onboarding, return to the library view.
  useEffect(() => {
    if (!done && persisted.returnPath && pathname === "/login" && !location.hash.includes("access_token")) {
      const target = persisted.returnPath;
      updateState({ ...persisted, returnPath: undefined });
      navigate(target, { replace: true });
    }
  }, [done, persisted, pathname, navigate]);

  const shouldShow =
    mode === "extension" &&
    !done &&
    !addRequest &&
    !mergeRequest &&
    pathname !== "/extension/connect";

  // Refresh Discord helper status when entering step 4.
  useEffect(() => {
    if (shouldShow && step === 3) {
      updateDiscord(undefined, true).catch(() => {});
    }
  }, [shouldShow, step]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (shouldShow) {
      if (!dialog.open) dialog.showModal();
      primaryRef.current?.focus();
    } else if (dialog.open) {
      dialog.close();
    }
    return () => {
      if (dialog.open) dialog.close();
    };
  }, [shouldShow, step]);

  if (!shouldShow) return null;

  function goToStep(nextStep: number) {
    const clamped = Math.min(TOTAL_STEPS - 1, Math.max(0, nextStep));
    updateState({ ...persisted, step: clamped, returnPath: undefined });
  }

  function finish() {
    updateState({ done: true, step: 0 });
  }

  function rememberBeforeOAuth(targetStep: number) {
    updateState({
      ...persisted,
      done: false,
      step: targetStep,
      returnPath: pathname === "/login" ? "/" : pathname,
    });
  }

  async function toggleDiscord(patch: { discordRpc?: boolean; discordShowTitle?: boolean; discordShowTime?: boolean }, force = false) {
    setCheckingDiscord(true);
    try {
      await updateDiscord(patch, force);
    } catch (err) {
      toast((err as Error).message || "Couldn't reach the extension.");
    } finally {
      setCheckingDiscord(false);
    }
  }

  const malConnected = account.status === "signed-in";
  const anilistConnected = !!(anilist.user || bridgeAnilist?.connected);
  const helperOk = !!discord?.helper?.ok;
  const discordReady = helperOk && discord?.helper?.discord === "connected";
  const discordEnabled = !!discord?.enabled;
  const discordStateLabel = !helperOk
    ? "Helper not running"
    : !discordReady
      ? "Waiting for Discord desktop"
      : !discordEnabled
        ? "Helper ready · Rich Presence off"
        : discord?.live
          ? `Live · ${discord.live.title}${discord.live.episode != null ? ` · Ep ${discord.live.episode}` : ""}${discord.live.paused ? " · paused" : ""}`
          : "Ready · Rich Presence on";

  const nextUrl = `${SIGN_IN_URL}?next=${encodeURIComponent(location.pathname + location.search)}`;

  return (
    <dialog
      ref={dialogRef}
      className="dupe-dialog onboard-dialog"
      aria-labelledby="onboard-title"
      onCancel={(e) => {
        e.preventDefault();
        finish();
      }}
    >
      <div className="dupe-body onboard-body">
        <div className="onboard-top">
          <p className="dupe-kicker">
            Step 0{step + 1} / 0{TOTAL_STEPS} · Extension setup
          </p>
          <ol className="onboard-dots" aria-label="Onboarding steps">
            {[0, 1, 2, 3].map((i) => (
              <li key={i} className={i === step ? "is-current" : i < step ? "is-done" : ""} aria-current={i === step ? "step" : undefined}>
                <button type="button" onClick={() => goToStep(i)} aria-label={`Go to step ${i + 1}`}>
                  0{i + 1}
                </button>
              </li>
            ))}
          </ol>
        </div>

        {step === 0 && (
          <>
            <h2 id="onboard-title">Extension {extVersion ? `v${extVersion} ` : ""}connected</h2>
            <p className="dupe-lede">
              This browser’s Kumostamp extension is now linked to your library. Whenever you watch or pause an episode on a streaming site,
              your mark lands here automatically and resumes on the next site.
            </p>
            <div className="onboard-card">
              <span className="cell-label">Optional integrations</span>
              <p>
                In the next steps, you can connect <strong>MyAnimeList</strong> or <strong>AniList</strong> for automatic episode progress
                updates, and set up <strong>Discord Rich Presence</strong> to show what you’re watching on your Discord profile.
              </p>
            </div>
            <div className="dupe-actions onboard-actions">
              <button ref={primaryRef} className="btn btn-ink" type="button" onClick={() => goToStep(1)}>
                Next: MyAnimeList
              </button>
              <button className="btn btn-flat" type="button" onClick={finish}>
                Skip setup
              </button>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <h2 id="onboard-title" className="onboard-brand-title">
              <BrandLogo name="myanimelist" /> MyAnimeList
            </h2>
            <p className="dupe-lede">
              Your Kumostamp account and MyAnimeList sync. Signing in keeps a backup of your marks across browsers and sets anime you watch
              to <strong>Watching</strong> with the episode you reached.
            </p>

            <div className="onboard-card" data-connected={malConnected ? "true" : "false"}>
              <span className="cell-label">Status</span>
              {malConnected ? (
                <div className="account-who onboard-who">
                  {account.user.picture && <img src={account.user.picture} alt="" width={44} height={44} />}
                  <div>
                    <strong>Connected as {account.user.name}</strong>
                    <p className="muted">Your library syncs with your account and updates your MyAnimeList progress.</p>
                  </div>
                </div>
              ) : account.status === "unavailable" ? (
                <p className="muted">Signing in needs the Kumostamp server, which isn’t running behind this page.</p>
              ) : (
                <div className="onboard-connect-row">
                  <p>Not connected yet. You’ll return straight to this step after signing in.</p>
                  <a
                    className="btn btn-ink"
                    href={nextUrl}
                    aria-disabled={account.status === "loading"}
                    onClick={() => rememberBeforeOAuth(1)}
                  >
                    Sign in with MyAnimeList
                  </a>
                </div>
              )}
            </div>

            <div className="dupe-actions onboard-actions">
              <button ref={primaryRef} className="btn btn-ink" type="button" onClick={() => goToStep(2)}>
                {malConnected ? "Next: AniList" : "Skip MyAnimeList"}
              </button>
              <button className="btn" type="button" onClick={() => goToStep(0)}>
                Back
              </button>
              <button className="btn btn-flat" type="button" onClick={finish}>
                Finish later
              </button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h2 id="onboard-title" className="onboard-brand-title">
              <BrandLogo name="anilist" /> AniList
            </h2>
            <p className="dupe-lede">
              Direct list updates from the extension. After you watch an episode for a minute, the extension sets that anime to{" "}
              <strong>Watching</strong> on your AniList with the episode you reached. Your AniList token stays in this browser’s extension.
            </p>

            <div className="onboard-card" data-connected={anilistConnected ? "true" : "false"}>
              <span className="cell-label">Status</span>
              {anilistConnected ? (
                <div className="onboard-connect-row">
                  <div>
                    <strong>Connected{anilist.user ? ` as ${anilist.user.name}` : " to AniList"}</strong>
                    <p className="muted">
                      {bridgeAnilist && !bridgeAnilist.syncOn
                        ? "Auto-update is currently turned off in the extension popup."
                        : "Episodes you watch auto-update your AniList progress."}
                    </p>
                  </div>
                  {ANILIST_LOGIN_URL && (
                    <a className="btn btn-quiet" href={ANILIST_LOGIN_URL} onClick={() => rememberBeforeOAuth(2)}>
                      Reconnect
                    </a>
                  )}
                </div>
              ) : !ANILIST_LOGIN_URL ? (
                <p className="muted">AniList login isn’t set up on this site yet (VITE_ANILIST_CLIENT_ID).</p>
              ) : (
                <div className="onboard-connect-row">
                  <p>Not connected yet. Authorizing hands the token directly to your Kumostamp extension.</p>
                  <a className="btn btn-ink" href={ANILIST_LOGIN_URL} onClick={() => rememberBeforeOAuth(2)}>
                    Sign in with AniList
                  </a>
                </div>
              )}
              {anilist.error && (
                <p className="account-error" role="alert">
                  {anilist.error}
                </p>
              )}
            </div>

            <div className="dupe-actions onboard-actions">
              <button ref={primaryRef} className="btn btn-ink" type="button" onClick={() => goToStep(3)}>
                {anilistConnected ? "Next: Discord" : "Skip AniList"}
              </button>
              <button className="btn" type="button" onClick={() => goToStep(1)}>
                Back
              </button>
              <button className="btn btn-flat" type="button" onClick={finish}>
                Finish later
              </button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h2 id="onboard-title" className="onboard-brand-title">
              <BrandLogo name="discord" /> Discord Rich Presence
            </h2>
            <p className="dupe-lede">
              Shows what you’re watching on your Discord profile — series title, episode, and progress bar. Because browsers cannot open
              Discord’s local IPC socket directly, the extension pairs with a lightweight local Node helper.
            </p>

            <div className="onboard-card" data-connected={discordEnabled && helperOk ? "true" : "false"}>
              <div className="onboard-connect-row">
                <div>
                  <span className="cell-label">Status</span>
                  <strong>{discordStateLabel}</strong>
                </div>
                <button
                  className="btn btn-quiet"
                  type="button"
                  disabled={checkingDiscord}
                  onClick={() => toggleDiscord({}, true)}
                >
                  {checkingDiscord ? "Checking…" : "Check helper"}
                </button>
              </div>

              <div className="onboard-switches">
                <label className="onboard-check">
                  <input
                    type="checkbox"
                    checked={discordEnabled}
                    disabled={checkingDiscord}
                    onChange={(e) => toggleDiscord({ discordRpc: e.target.checked }, true)}
                  />
                  <span>Show what I’m watching in Discord</span>
                </label>
                {discordEnabled && (
                  <>
                    <label className="onboard-check">
                      <input
                        type="checkbox"
                        checked={discord?.showTitle !== false}
                        disabled={checkingDiscord}
                        onChange={(e) => toggleDiscord({ discordShowTitle: e.target.checked })}
                      />
                      <span>Show the series title</span>
                    </label>
                    <label className="onboard-check">
                      <input
                        type="checkbox"
                        checked={discord?.showTime !== false}
                        disabled={checkingDiscord}
                        onChange={(e) => toggleDiscord({ discordShowTime: e.target.checked })}
                      />
                      <span>Show progress bar &amp; time</span>
                    </label>
                  </>
                )}
              </div>

              {!helperOk && (
                <div className="onboard-helper-guide">
                  <span className="cell-label">Run the local helper</span>
                  <ol>
                    <li>
                      In <code>helper/</code>, copy <code>config.example.json</code> to <code>config.json</code> and set{" "}
                      <code>clientId</code> to your Discord Application ID.
                    </li>
                    <li>
                      Start <code>node helper/index.mjs</code> with Discord desktop open, then click <strong>Check helper</strong>.
                    </li>
                  </ol>
                </div>
              )}

              {helperOk && discord?.error && (
                <p className="account-error" role="alert">
                  {discord.error}
                </p>
              )}
            </div>

            <div className="dupe-actions onboard-actions">
              <button ref={primaryRef} className="btn btn-ink" type="button" onClick={finish}>
                Done
              </button>
              <button className="btn" type="button" onClick={() => goToStep(2)}>
                Back
              </button>
            </div>
          </>
        )}
      </div>
    </dialog>
  );
}
