/*
 * Account sync: while signed in, this page keeps the library here (extension or
 * localStorage) and the copy on the server merged. Changes here are pushed a moment
 * after they happen; the server is checked on focus and every minute for changes made
 * on other browsers. Merging is the shared core's: newest mark wins, deletions stick.
 */
import { useSyncExternalStore } from "react";
import { getAccount, loadAccount, subscribeAccount } from "./account";
import { KS, type Db } from "./ks";
import { getDb, getMode, op, subscribe } from "./store";

interface MalResult {
  title: string;
  progress?: number;
  total?: number;
  outcome: "updated" | "skipped" | "failed";
  reason?: string;
}

export type SyncState =
  | { status: "off" }
  | { status: "syncing" }
  | { status: "synced"; at: number }
  | { status: "error"; message: string };

const PUSH_DELAY_MS = 2000;
const PULL_EVERY_MS = 60_000;

let state: SyncState = { status: "off" };
/** The last thing sent to (or refused by) MyAnimeList, for the header. */
let malNote = "";
const listeners = new Set<() => void>();
let server: { db: Db; rev: number } | null = null;
let active = false;
let busy: Promise<void> = Promise.resolve();
let pushTimer: ReturnType<typeof setTimeout> | undefined;
let pullTimer: ReturnType<typeof setInterval> | undefined;

function set(next: SyncState) {
  state = next;
  if (next.status === "off") malNote = "";
  listeners.forEach((fn) => fn());
}

/** Would merging `other` into `base` change it? */
function adds(base: Db, other: Db): boolean {
  const merged = KS.applyOp(structuredClone(base), { type: "import", db: structuredClone(other) });
  return KS.dbSignature(merged) !== KS.dbSignature(base);
}

/** Sync only a real library: not before the store knows where it lives, and never the sample. */
const syncable = () => getMode() !== "pending" && !getDb().sample;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "Content-Type": "application/json", Accept: "application/json", ...init?.headers } });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (res.status === 401) {
    loadAccount(); // the session ended elsewhere: the header goes back to "Sign in"
    throw new Error("Signed out. Sign in again to keep syncing.");
  }
  if (!res.ok) throw new Error(body.error || `The server answered ${res.status}.`);
  return body;
}

/** Bring what the server has into this browser, if it has anything new. */
async function adopt() {
  if (server && adds(getDb(), server.db)) await op({ type: "import", db: structuredClone(server.db) });
}

async function pull() {
  const since = server ? `?since=${server.rev}` : "";
  const res = await api<{ db?: Db; rev: number; unchanged?: boolean }>(`/api/library${since}`);
  if (!res.unchanged && res.db) server = { db: res.db, rev: res.rev };
  await adopt();
}

/** AniList blocks the server, so this browser looks up MAL ids for sheets linked before `malId` existed. */
async function fillMalIds() {
  const todo = Object.values(getDb().series).filter((s) => s.meta?.source === "anilist" && s.meta.malId === undefined).slice(0, 50);
  if (!todo.length) return;
  const res = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      query: "query ($ids: [Int]) { Page(perPage: 50) { media(id_in: $ids, type: ANIME) { id idMal } } }",
      variables: { ids: todo.map((s) => Number(s.meta!.id)) },
    }),
  }).catch(() => null);
  if (!res?.ok) return; // try again next visit
  const json = (await res.json()) as { data?: { Page?: { media?: { id: number; idMal: number | null }[] } } };
  for (const m of json.data?.Page?.media || []) {
    for (const s of todo) if (Number(s.meta!.id) === m.id) await op({ type: "upsertSeries", key: s.key, meta: { malId: m.idMal || null } });
  }
}

/** Put recent watching on the MyAnimeList list (the server skips what it already sent). */
async function malSync() {
  await fillMalIds();
  await push();
  const { results } = await api<{ results: MalResult[] }>("/api/library/mal-sync", { method: "POST", body: "{}" });
  const updated = results.filter((r) => r.outcome === "updated");
  const failed = results.find((r) => r.outcome === "failed");
  if (updated.length) {
    malNote = `MyAnimeList: ${updated.map((r) => `${r.title} → ${r.progress}${r.total ? `/${r.total}` : ""}`).join(", ")}`;
  } else if (failed) {
    malNote = `MyAnimeList: ${failed.title} not updated (${failed.reason})`;
  }
}

async function push() {
  const local = getDb();
  if (server && !adds(server.db, local)) return;
  const res = await api<{ db: Db; rev: number }>("/api/library/merge", { method: "POST", body: JSON.stringify({ db: local }) });
  server = { db: res.db, rev: res.rev };
  await adopt();
}

/** One sync step at a time, so a push never races a pull. */
function run(step: () => Promise<void>) {
  busy = busy.then(async () => {
    if (!active || !syncable()) return;
    if (state.status !== "synced") set({ status: "syncing" });
    try {
      await step();
      if (active) set({ status: "synced", at: Date.now() });
    } catch (e) {
      if (active) set({ status: "error", message: (e as Error).message || "Couldn't reach the server." });
    }
  });
  return busy;
}

const pullSoon = () => {
  if (document.visibilityState === "visible") run(pull);
};

function begin() {
  active = true;
  run(async () => {
    await pull();
    await push();
    await malSync();
  });
  pullTimer = setInterval(pullSoon, PULL_EVERY_MS);
  window.addEventListener("focus", pullSoon);
  document.addEventListener("visibilitychange", pullSoon);
}

function end() {
  active = false;
  server = null;
  clearTimeout(pushTimer);
  clearInterval(pullTimer);
  window.removeEventListener("focus", pullSoon);
  document.removeEventListener("visibilitychange", pullSoon);
  set({ status: "off" });
}

function check() {
  const want = getAccount().status === "signed-in" && syncable();
  if (want && !active) begin();
  else if (!want && active) end();
}

/** Called once at startup, after the store and account have started. */
export function startSync() {
  subscribeAccount(check);
  subscribe(() => {
    check();
    if (!active) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => run(push), PUSH_DELAY_MS);
  });
  check();
}

/** Ask now (the header's retry). */
export function syncNow() {
  return run(async () => {
    await pull();
    await push();
    await malSync();
  });
}

export function getMalNote() {
  return malNote;
}

export function useSync(): SyncState {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => state,
  );
}
