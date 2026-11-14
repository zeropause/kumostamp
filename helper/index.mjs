#!/usr/bin/env node
/**
 * Kumostamp's Discord Rich Presence helper.
 *
 * The browser extension cannot open Discord's IPC socket, so it POSTs what is
 * playing to this small local server instead. The server owns the Discord
 * connection, translates the state into an activity, and clears it when the
 * browser goes quiet (the extension may be suspended at any time).
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { timingSafeEqual } from "node:crypto";
import { DiscordRpc } from "./discord.mjs";

const DEFAULT_PORT = 47834;
const MAX_BODY = 32 * 1024;
const DIR = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(DIR, "config.json");
const STATE_PATH = path.join(DIR, ".state.json");

const log = (msg) => console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);

/* ---------- config ---------- */

const config = { clientId: "", port: DEFAULT_PORT, token: "", assets: { large: "kumostamp", playing: "playing", paused: "paused" } };
if (fs.existsSync(CONFIG_PATH)) {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    Object.assign(config, raw);
    config.assets = Object.assign({ large: "kumostamp", playing: "playing", paused: "paused" }, raw.assets || {});
  } catch (e) {
    console.error(`config.json is not valid JSON: ${e.message}`);
    process.exit(1);
  }
}

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const flag = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : "";
};

const clientId = flag("client-id") || process.env.KUMOSTAMP_CLIENT_ID || process.env.DISCORD_CLIENT_ID || config.clientId;
const port = Number(flag("port") || process.env.KUMOSTAMP_PORT || config.port || DEFAULT_PORT);

if (!dryRun && (!clientId || clientId === "GANTI_APPLICATION_ID")) {
  console.error("Set your Discord Application ID in helper/config.json (or pass --client-id=).");
  console.error("Create one at https://discord.com/developers/applications, then copy config.example.json to config.json.");
  process.exit(1);
}
if (port !== DEFAULT_PORT) log(`warning: the extension posts to port ${DEFAULT_PORT}; set the same port there or keep ${DEFAULT_PORT}.`);

/* ---------- pairing token ---------- */

let bound = "";
try {
  bound = JSON.parse(fs.readFileSync(STATE_PATH, "utf8")).token || "";
} catch (_) {
  /* first run */
}

function saveBound(token) {
  try {
    fs.writeFileSync(STATE_PATH, JSON.stringify({ token }), { mode: 0o600 });
  } catch (e) {
    log(`could not save the pairing token: ${e.message}`);
  }
}

function same(a, b) {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

/**
 * Pinned token wins; otherwise the first token seen is remembered (trust on first
 * use). Any local page can reach this port, so pin `config.token` if that matters.
 */
function authorize(token) {
  if (typeof token !== "string" || token.length < 16) return false;
  const pinned = config.token || process.env.KUMOSTAMP_TOKEN || "";
  if (pinned) return same(pinned, token);
  if (bound) return same(bound, token);
  bound = token;
  saveBound(token);
  log("paired with the extension (token saved to .state.json)");
  return true;
}

/* ---------- state -> Discord activity ---------- */

function safeHttpUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:" ? u : null;
  } catch (_) {
    return null;
  }
}

/**
 * Discord strictly enforces max URL lengths (256 chars for details_url, state_url,
 * large_url; 512 for buttons). If query parameters make it exceed `max`, strip them.
 */
function fitUrl(urlObj, max = 256) {
  if (!urlObj) return null;
  if (urlObj.href.length <= max) return urlObj.href;
  try {
    const clean = new URL(urlObj.origin + urlObj.pathname);
    if (clean.href.length <= max) return clean.href;
  } catch (_) {
    /* ignore */
  }
  return null;
}

const clamp = (value, n) => String(value || "").slice(0, n);

const clock = (seconds) => {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
};

function sanitize(state) {
  const num = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : 0);
  return {
    v: 1,
    title: clamp(state.title, 200),
    episode: state.episode == null || state.episode === "" ? null : num(state.episode),
    seriesKey: clamp(state.seriesKey, 200),
    position: num(state.position),
    duration: num(state.duration),
    paused: !!state.paused,
    ended: !!state.ended,
    host: clamp(state.host, 100),
    poster: /^https:\/\//.test(String(state.poster || "")) ? String(state.poster) : "",
    url: /^https?:\/\//.test(String(state.url || "")) ? clamp(state.url, 500) : "",
    episodeCount: Number.isFinite(Number(state.episodeCount)) ? Math.max(0, Number(state.episodeCount)) : 0,
    libraryUrl: clamp(state.libraryUrl, 500),
    showTitle: state.showTitle !== false,
    showTime: state.showTime !== false,
  };
}

function ttlFor(state) {
  if (state.ended) return 120000;
  if (state.paused) return 600000;
  return 90000;
}

const MIN_TEXT = 2; // Discord rejects asset texts shorter than this

/** Discord truncates the visible lines, so keep them short and meaningful. */
const line = (value, n) => clamp(String(value || "").replace(/\s+/g, " ").trim(), n);

/**
 * The activity card, using the fields the current Discord desktop RPC accepts.
 *
 * Layout decisions:
 * - `name` (the heading) is the series title, so the card does not advertise the
 *   Kumostamp app.
 * - `details` (line 2) carries "Series · Ep N", because that is also what the
 *   compact member-list status shows (`status_display_type: 2`).
 * - `state` (line 3) carries the provider, or where playback stopped.
 * - Anything clickable goes to the provider page first: the poster is a way back
 *   to what is playing, not an ad for Kumostamp.
 */
function toActivity(state, assets) {
  const title = line(state.title, 120) || "Something";
  const showTitle = state.showTitle !== false;
  const showTime = state.showTime !== false;
  const numbered = state.episode != null;
  const episode = numbered ? `Ep ${state.episode}` : "";
  const lib = safeHttpUrl(state.libraryUrl);
  const seriesUrl = lib && state.seriesKey
    ? safeHttpUrl(new URL(`series/${encodeURIComponent(state.seriesKey)}/`, lib.href).href)
    : null;
  const provider = showTitle ? safeHttpUrl(state.url) : null;
  const providerLabel = state.host ? `Watch on ${state.host}` : "Back to the player";

  const heading = showTitle ? title : "Kumostamp";
  const headline = showTitle ? [title, episode].filter(Boolean).join(" · ") : "Watching anime";

  const activity = {
    type: 3, // watching
    name: line(heading, 128),
    details: line(headline, 128),
    state: "",
    instance: false,
  };

  // Line 3: where it plays, or why it is not playing.
  if (state.ended) activity.state = "Finished";
  else if (state.paused && showTime && state.duration > 0) activity.state = `Paused at ${clock(state.position)}`;
  else activity.state = showTitle && state.host ? line(state.host, 128) : "Watching";

  // The compact status in the member list: line 2, i.e. "Series · Ep N".
  activity.status_display_type = 2;

  // Clicking the title line and the poster returns to the provider page; the
  // series sheet is the fallback for a film or a page without a usable URL.
  // Discord RPC rejects details_url, state_url, and large_url if longer than 256 chars.
  const provider256 = fitUrl(provider, 256);
  const series256 = fitUrl(seriesUrl, 256);
  const clickableUrl = provider256 || series256;

  if (clickableUrl) {
    activity.details_url = clickableUrl;
    activity.state_url = clickableUrl;
  }

  // Discord draws the bar and counts the clock down on the client, from these two
  // timestamps alone: an activity that keeps them while paused visibly keeps
  // running. A paused card therefore carries no timestamps; the position moves
  // into the state line above.
  if (showTime && !state.paused && !state.ended && state.duration > 0 && state.position < state.duration) {
    const now = Date.now();
    activity.timestamps = {
      start: Math.round(now - state.position * 1000),
      end: Math.round(now + (state.duration - state.position) * 1000),
    };
  }

  const art = {};
  if (showTitle && state.poster) art.large_image = state.poster;
  else if (assets.large) art.large_image = assets.large;
  if (art.large_image) {
    art.large_text = line(showTitle ? [title, episode].filter(Boolean).join(" · ") : "Kumostamp", 128);
    if (art.large_text.length < MIN_TEXT) art.large_text = "Kumostamp";
    if (clickableUrl) art.large_url = clickableUrl;
  }
  const small = state.paused ? assets.paused : assets.playing;
  if (small) {
    art.small_image = small;
    art.small_text = line(state.paused ? "Paused" : state.ended ? "Finished" : "Kumostamp", 128);
  }
  if (Object.keys(art).length) activity.assets = art;

  // "5 of 10": the sheet's episode count becomes the card's progress readout.
  const total = Math.round(state.episodeCount);
  if (numbered && total > 0 && state.episode <= total) {
    activity.party = {
      id: line(state.seriesKey || "kumostamp", 128),
      current_size: Math.round(state.episode),
      max_size: total,
    };
  }

  // Buttons are the explicit calls to action; the title line already links out.
  // Discord limits button labels to 32 characters and URLs to 512 characters.
  const buttons = [];
  const provider512 = fitUrl(provider, 512);
  const series512 = fitUrl(seriesUrl, 512);
  const lib512 = fitUrl(lib, 512);
  if (provider512) buttons.push({ label: line(providerLabel, 32), url: provider512 });
  if (series512) buttons.push({ label: "Open series", url: series512 });
  else if (lib512) buttons.push({ label: "Open library", url: lib512 });
  if (buttons.length) activity.buttons = buttons.slice(0, 2);

  return activity;
}

/**
 * Progressively simpler activities for older or stricter Discord builds.
 * 1. drop clickable URLs that might violate client schemas or length limits;
 * 2. drop `type` and swap external images for uploaded assets;
 * 3. also drop the dynamic `name` override.
 */
function safeActivities(activity) {
  // 1. Drop clickable URLs that might violate client schemas or length limits
  const withoutUrls = Object.assign({}, activity);
  delete withoutUrls.details_url;
  delete withoutUrls.state_url;
  delete withoutUrls.status_display_type;
  if (withoutUrls.assets) {
    const art = Object.assign({}, withoutUrls.assets);
    delete art.large_url;
    delete art.small_url;
    withoutUrls.assets = art;
  }
  delete withoutUrls.buttons;

  // 2. Drop type and swap external images for uploaded assets
  const withoutExtras = Object.assign({}, withoutUrls);
  delete withoutExtras.type;
  if (withoutExtras.assets) {
    const art = Object.assign({}, withoutExtras.assets);
    if (/^https:\/\//.test(art.large_image || "")) {
      if (config.assets.large) art.large_image = config.assets.large;
      else delete art.large_image;
    }
    if (!art.large_image) delete art.large_text;
    withoutExtras.assets = art;
  }

  // 3. Drop dynamic name override
  const plain = Object.assign({}, withoutExtras);
  delete plain.name;

  return [withoutUrls, withoutExtras, plain];
}

/* ---------- Discord connection ---------- */

const rpc = dryRun ? null : new DiscordRpc({ clientId, log, fallback: safeActivities });

let lastState = null;
let lastAt = 0;
let lastTtl = 0;

async function push(rawState) {
  if (rawState == null) {
    lastState = null;
    lastAt = 0;
    if (rpc) await rpc.apply(null);
    else log("activity: cleared");
    return null;
  }
  const state = sanitize(rawState);
  lastState = state;
  lastAt = Date.now();
  lastTtl = ttlFor(state);

  const activity = toActivity(state, config.assets);
  if (dryRun) {
    log("activity:");
    console.log(JSON.stringify(activity, null, 2));
    return activity;
  }
  await rpc.apply(activity);
  log(`presence: ${state.title}${state.episode == null ? "" : ` · Ep ${state.episode}`} ${state.paused ? "(paused)" : state.ended ? "(ended)" : `@ ${Math.floor(state.position / 60)}m`}`);
  return activity;
}

if (rpc) rpc.start();



/* ---------- HTTP ---------- */

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("Body too large."));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Cache-Control", "no-store");

  const json = (code, body) => {
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };

  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/health") {
    if (!authorize(url.searchParams.get("token"))) return json(401, { error: "Not paired with this helper." });
    return json(200, { ok: true, discord: rpc ? rpc.status() : "dry-run", user: rpc && rpc.ready ? rpc.ready.username : null });
  }

  if (req.method === "POST" && url.pathname === "/presence") {
    let raw;
    try {
      raw = await readBody(req);
    } catch (e) {
      return json(413, { error: e.message });
    }
    let body;
    try {
      body = JSON.parse(raw || "{}");
    } catch (_) {
      return json(400, { error: "Body must be JSON." });
    }
    if (!authorize(body.token)) return json(401, { error: "Not paired with this helper." });

    try {
      await push(body.state === undefined ? null : body.state);
      return json(200, { ok: true, discord: rpc ? rpc.status() : "dry-run" });
    } catch (e) {
      // The helper itself is fine; Discord refused the activity.
      log(`presence update failed: ${e.message}`);
      return json(200, { ok: true, discord: rpc ? rpc.status() : "dry-run", warning: e.message });
    }
  }

  json(404, { error: "Not found." });
});

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use. Is another Kumostamp helper running?`);
    process.exit(1);
  }
  console.error(e);
  process.exit(1);
});

server.listen(port, "127.0.0.1", () => {
  log(`listening on http://127.0.0.1:${port}${dryRun ? " (dry run, Discord not connected)" : ""}`);
  if (bound) log("paired token loaded; waiting for the extension.");
  else log("waiting for the extension to pair on first contact.");
  if (!dryRun) log(`client id ${clientId}`);
});

/* A browser that crashed or closed never sends "null"; expire its state instead. */
setInterval(() => {
  if (!lastState || !lastAt) return;
  if (Date.now() - lastAt <= lastTtl) return;
  log("no updates from the browser; clearing the activity");
  push(null).catch(() => {});
}, 15000);

process.on("SIGINT", () => {
  log("shutting down");
  if (rpc) rpc.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500);
});
