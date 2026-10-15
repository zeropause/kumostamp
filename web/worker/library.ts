/*
 * The signed-in user's library: one Db per account, merged with the same core the
 * extension uses (newest mark wins per episode, deletions carried as tombstones).
 */
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { KS, type Db, type Series } from "../src/lib/ks";
import { pushToMal } from "./mal-sync";
import { currentUser, deviceUser, type User } from "./session";

const library = new Hono<{ Bindings: Env; Variables: { user: User } }>();

library.use(async (c, next) => {
  // The website signs in by cookie; the extension by its device token.
  const user = (await currentUser(c)) || (await deviceUser(c));
  if (!user) return c.json({ error: "Sign in to sync your library." }, 401);
  c.set("user", user);
  await next();
});

interface Row {
  db: string;
  rev: number;
}

async function load(env: Env, userId: string): Promise<{ db: Db; rev: number }> {
  const row = await env.DB.prepare("SELECT db, rev FROM libraries WHERE user_id = ?").bind(userId).first<Row>();
  return row ? { db: JSON.parse(row.db) as Db, rev: row.rev } : { db: KS.emptyDb(), rev: 0 };
}

/** `?since=<rev>`: answers without the library when nothing changed since then. */
library.get("/", async (c) => {
  const userId = c.get("user").id;
  const since = Number(c.req.query("since"));
  if (Number.isFinite(since) && since > 0) {
    const row = await c.env.DB.prepare("SELECT rev FROM libraries WHERE user_id = ?").bind(userId).first<{ rev: number }>();
    if (row && row.rev === since) return c.json({ rev: since, unchanged: true });
  }
  return c.json(await load(c.env, userId));
});

/** Merge a copy of the library in and answer with the result, which the caller adopts. */
library.post(
  "/merge",
  bodyLimit({ maxSize: 2 * 1024 * 1024, onError: (c) => c.json({ error: "That library is too large to sync (over 2 MB)." }, 413) }),
  async (c) => {
    const body = await c.req.json<{ db?: Partial<Db> }>().catch(() => null);
    const incoming = body?.db;
    if (!incoming || typeof incoming.series !== "object" || incoming.series === null) return c.json({ error: "Expected { db: { series } }." }, 400);
    const userId = c.get("user").id;

    // Optimistic: retry if another device saved between our read and write.
    for (let attempt = 0; attempt < 4; attempt++) {
      const { db, rev } = await load(c.env, userId);
      const previous = structuredClone(db);
      const before = KS.dbSignature(db);
      const merged = KS.applyOp(db, { type: "import", db: incoming as Partial<Db> & { series: Record<string, Series> } });
      if (KS.dbSignature(merged) === before) return c.json({ db: merged, rev, changed: false });

      const json = JSON.stringify(merged);
      const now = Date.now();
      const res =
        rev === 0
          ? await c.env.DB.prepare("INSERT INTO libraries (user_id, db, rev, updated_at) VALUES (?, ?, 1, ?) ON CONFLICT (user_id) DO NOTHING").bind(userId, json, now).run()
          : await c.env.DB.prepare("UPDATE libraries SET db = ?, rev = rev + 1, updated_at = ? WHERE user_id = ? AND rev = ?").bind(json, now, userId, rev).run();
      if (res.meta.changes === 1) {
        // Newly watched episodes go on the MyAnimeList list, without holding up the sync.
        c.executionCtx.waitUntil(pushToMal(c.env, userId, previous, merged).catch((e) => console.error("MAL sync", e)));
        return c.json({ db: merged, rev: rev + 1, changed: true });
      }
    }
    return c.json({ error: "Your library is being saved from another device. Try again in a moment." }, 409);
  },
);

/** Send recent watching to MyAnimeList now (the website asks once per visit). */
library.post("/mal-sync", async (c) => {
  const userId = c.get("user").id;
  const { db } = await load(c.env, userId);
  return c.json({ results: await pushToMal(c.env, userId, null, db) });
});

export default library;
