/*
 * Who is signed in, asked of the server once per page load.
 * "unavailable": no API behind this page (file://, or a static-only deploy), so account UI hides.
 */
import { useSyncExternalStore } from "react";

export interface Account {
  name: string;
  picture: string | null;
}

export type AccountState =
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "signed-out" }
  | { status: "signed-in"; user: Account };

let state: AccountState = { status: "loading" };
const listeners = new Set<() => void>();

function set(next: AccountState) {
  state = next;
  listeners.forEach((fn) => fn());
}

/** Called once at startup, next to the store's start(). */
export async function loadAccount() {
  try {
    const res = await fetch("/api/auth/me", { headers: { Accept: "application/json" } });
    if (!res.ok || !res.headers.get("content-type")?.includes("json")) return set({ status: "unavailable" });
    const { user } = (await res.json()) as { user: Account | null };
    set(user ? { status: "signed-in", user } : { status: "signed-out" });
  } catch {
    set({ status: "unavailable" });
  }
}

export async function signOut() {
  await fetch("/api/auth/logout", { method: "POST" });
  set({ status: "signed-out" });
}

/** Full-page navigation: the server redirects on to MyAnimeList. */
export const SIGN_IN_URL = "/api/auth/mal/login";

export function getAccount(): AccountState {
  return state;
}

export function subscribeAccount(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useAccount(): AccountState {
  return useSyncExternalStore(subscribeAccount, getAccount);
}
