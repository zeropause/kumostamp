/*
 * Kumostamp API. Runs only for /api/* (see run_worker_first in wrangler.jsonc);
 * every other path is the library SPA served from static assets.
 */
import { Hono } from "hono";
import { csrf } from "hono/csrf";
import { HTTPException } from "hono/http-exception";
import auth from "./auth-mal";
import library from "./library";

const app = new Hono<{ Bindings: Env }>().basePath("/api");

// Rejects cross-site form posts; JSON posts from other sites already need CORS, which we never grant.
app.use(csrf());

app.route("/auth", auth);
app.route("/library", library);

app.get("/health", async (c) => {
  const row = await c.env.DB.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'users'").first<{ n: number }>();
  return c.json({ ok: true, migrated: !!row && row.n > 0 });
});

app.notFound((c) => c.json({ error: "Not found" }, 404));

app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse();
  console.error(err);
  return c.json({ error: "Something went wrong on the server." }, 500);
});

export default app;
