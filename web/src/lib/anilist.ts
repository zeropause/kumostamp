/*
 * AniList login for the extension. The login page sends you to AniList (implicit grant: no secret),
 * AniList comes back to /login with the token in the URL fragment, and this hands it to the
 * extension, which keeps it and updates your list. The server never sees it.
 * Until the extension answers, the token waits in localStorage, for an hour at most.
 */
import { useSyncExternalStore } from "react";
import { getMode, subscribe as onStore } from "./store";

const CLIENT_ID = import.meta.env.VITE_ANILIST_CLIENT_ID as string | undefined;
const PENDING_KEY = "kumostamp:anilist-pending";
const PENDING_MS = 60 * 60 * 1000;
const TO_EXT = "kumostamp-web";
const FROM_EXT = "kumostamp-ext";

/** Null when this site has no AniList client configured. */
export const ANILIST_LOGIN_URL = CLIENT_ID
  ? `https://anilist.co/api/v2/oauth/authorize?client_id=${encodeURIComponent(CLIENT_ID)}&response_type=token`
  : null;

interface Pending {
  token: string;
  expiresIn: number;
  at: number;
}

export interface AnilistState {
  user: { id: number; name: string } | null;
  waiting: boolean; // signed in on AniList, the extension hasn't taken the token yet
  error: string;
}

let state: AnilistState = { user: null, waiting: false, error: "" };
const listeners = new Set<() => void>();
let seq = 0;

function set(patch: Partial<AnilistState>) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
}

function readPending(): Pending | null {
  try {
    const p = JSON.parse(localStorage.getItem(PENDING_KEY) || "null") as Pending | null;
    if (p && typeof p.token === "string" && Date.now() - p.at < PENDING_MS) return p;
    localStorage.removeItem(PENDING_KEY);
  } catch {
    /* storage blocked */
  }
  return null;
}

function clearPending() {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    /* storage blocked */
  }
}

/** Take a token (or AniList's refusal) out of the URL so it doesn't stay in history. */
function takeFromUrl() {
  const params = new URLSearchParams(location.hash.replace(/^#/, ""));
  const token = params.get("access_token");
  const error = params.get("error_description") || params.get("error");
  if (!token && !error) return;
  history.replaceState(history.state, "", location.pathname + location.search);
  if (error) return set({ error });
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify({ token, expiresIn: Number(params.get("expires_in")) || 0, at: Date.now() }));
  } catch {
    set({ error: "This browser blocks site storage, so the AniList login couldn't be kept. Allow storage and try again." });
  }
}

/** Ask the extension who is connected, handing over `pending` first if there is one. */
function ask(pending: Pending | null): Promise<{ user?: AnilistState["user"]; error?: string } | null> {
  const id = ++seq;
  return new Promise((resolve) => {
    const done = (v: { user?: AnilistState["user"]; error?: string } | null) => {
      window.removeEventListener("message", onAck);
      clearTimeout(timer);
      resolve(v);
    };
    const onAck = (e: MessageEvent) => {
      if (e.source !== window || !e.data || e.data.source !== FROM_EXT || e.data.type !== "anilistAck" || e.data.id !== id) return;
      done({ user: e.data.user || null, error: e.data.error });
    };
    const timer = setTimeout(() => done(null), 10000); // checking the token with AniList can take a moment
    window.addEventListener("message", onAck);
    window.postMessage(
      { source: TO_EXT, type: "anilist", id, token: pending?.token, expiresIn: pending?.expiresIn },
      location.origin === "null" ? "*" : location.origin,
    );
  });
}

let asking = false;
async function refresh() {
  const pending = readPending();
  set({ waiting: !!pending });
  if (getMode() !== "extension" || asking) return;
  asking = true;
  const res = await ask(pending).finally(() => (asking = false));
  if (!res) return; // no answer: keep any pending token for the next try
  if (pending) clearPending(); // the extension has decided on it, kept or rejected
  set({ waiting: false, user: res.user || null, error: res.error || "" });
}

export function startAnilist() {
  takeFromUrl();
  let mode = getMode();
  onStore(() => {
    if (getMode() === mode) return;
    mode = getMode();
    refresh();
  });
  refresh();
}

export function useAnilist(): AnilistState {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => state,
  );
}
