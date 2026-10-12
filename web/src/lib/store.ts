/*
 * Store: talks to the extension through its bridge content script when it is
 * installed (on localhost); otherwise keeps marks in this browser's localStorage.
 */
import { useSyncExternalStore } from "react";
import { KS, type Db, type Op } from "./ks";

const LOCAL_KEY = "kumostamp:db";
const TO_EXT = "kumostamp-web";
const FROM_EXT = "kumostamp-ext";

// "untrusted": the extension is installed but hasn't been told this address is your library.
export type Mode = "pending" | "extension" | "local" | "untrusted";

export interface Snapshot {
  db: Db;
  mode: Mode;
  extVersion: string | null;
}

let snapshot: Snapshot = { db: KS.emptyDb(), mode: "pending", extVersion: null };
const listeners = new Set<() => void>();
const pending = new Map<number, { resolve: () => void; reject: (e: Error) => void }>();
let seq = 0;
let started = false;

const targetOrigin = () => (location.origin === "null" ? "*" : location.origin);

function set(patch: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((fn) => fn());
}

function readLocal(): Db {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    const parsed = raw ? (JSON.parse(raw) as Db) : null;
    return parsed && parsed.series ? parsed : KS.emptyDb();
  } catch {
    return KS.emptyDb();
  }
}

function writeLocal(db: Db) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(db));
  } catch {
    /* private mode or full storage: keep working in memory */
  }
}

function onMessage(e: MessageEvent) {
  if (e.source !== window || !e.data || e.data.source !== FROM_EXT) return;
  if (e.data.type === "db") {
    const wasLocal = snapshot.mode !== "extension";
    const db: Db = e.data.db && e.data.db.series ? e.data.db : KS.emptyDb();
    set({ mode: "extension", db, extVersion: e.data.version || snapshot.extVersion });
    if (wasLocal) adoptLocalMarks();
  } else if (e.data.type === "untrusted") {
    if (snapshot.mode !== "extension") set({ mode: "untrusted", db: snapshot.mode === "pending" ? readLocal() : snapshot.db });
  } else if (e.data.type === "ack") {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.error) p.reject(new Error(e.data.error));
    else p.resolve();
  }
}

/** Marks made before the extension was installed move into it once. */
function adoptLocalMarks() {
  const local = readLocal();
  if (!Object.keys(local.series).length || local.sample) return;
  op({ type: "import", db: local }).then(() => {
    try {
      localStorage.removeItem(LOCAL_KEY);
    } catch {
      /* ignore */
    }
  });
}

export function op(operation: Op): Promise<void> {
  if (snapshot.mode === "extension") {
    const id = ++seq;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      window.postMessage({ source: TO_EXT, type: "op", id, op: operation }, targetOrigin());
      setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(new Error("The extension did not answer."));
      }, 5000);
    });
  }
  // Clone: applyOp mutates, and React needs a new reference.
  const db = KS.applyOp(structuredClone(snapshot.db), operation);
  writeLocal(db);
  set({ db });
  return Promise.resolve();
}

/** The product was briefly spelled "Kumotstamp": carry marks saved under that name over once. */
function migrateLegacyKeys() {
  try {
    const old = localStorage.getItem("kumotstamp:db");
    if (old !== null && localStorage.getItem(LOCAL_KEY) === null) localStorage.setItem(LOCAL_KEY, old);
    for (const k of ["kumotstamp:db", "kumotstamp:autolink", "kumotstamp:autolink:v2"]) localStorage.removeItem(k);
  } catch {
    /* storage blocked: nothing to migrate */
  }
}

export function start() {
  if (started) return;
  started = true;
  migrateLegacyKeys();
  window.addEventListener("message", onMessage);
  window.postMessage({ source: TO_EXT, type: "hello" }, targetOrigin());
  setTimeout(() => {
    if (snapshot.mode !== "pending") return; // the extension answered (connected or untrusted)
    set({ mode: "local", db: readLocal() });
  }, 700);
}

export function loadSample(db: Db) {
  const sample = { ...db, sample: true };
  writeLocal(sample);
  set({ db: sample });
}

export function clearSample() {
  try {
    localStorage.removeItem(LOCAL_KEY);
  } catch {
    /* ignore */
  }
  set({ db: KS.emptyDb() });
}

export function getDb(): Db {
  return snapshot.db;
}

export function getMode(): Mode {
  return snapshot.mode;
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useStore(): Snapshot {
  return useSyncExternalStore(subscribe, () => snapshot);
}
