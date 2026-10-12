/* Kumostamp background worker: the single writer of the progress database. */
importScripts("lib/core.js", "lib/catalog.js", "lib/accounts.js", "lib/anilist-sync.js");

const DB_KEY = "ks:db";
const SETTINGS_KEY = "ks:settings";
const SAVE_EVERY_MS = 5000;
const START_AFTER = 60; // seconds of playback before AniList is told you are watching it
const MIN_SAVE_TIME = 5; // seconds into a video before it counts as watched

const DEFAULT_SETTINGS = { libraryUrl: "http://localhost:5173/", resumeChip: true, autoSave: true, autoResume: true, anilistClientId: "", anilistSync: false };
const SYNC_SLACK = 20; // seconds: closer than this to the mark counts as caught up

/* ---------- storage ---------- */

let writeQueue = Promise.resolve();

async function readDb() {
  const got = await chrome.storage.local.get(DB_KEY);
  return got[DB_KEY] && got[DB_KEY].series ? got[DB_KEY] : KS.emptyDb();
}

function mutate(op) {
  // Serialise writes so periodic saves and website edits never clobber each other.
  writeQueue = writeQueue.then(async () => {
    const db = KS.applyOp(await readDb(), op);
    await chrome.storage.local.set({ [DB_KEY]: db });
    return db;
  });
  return writeQueue;
}

async function getSettings() {
  const got = await chrome.storage.local.get(SETTINGS_KEY);
  return Object.assign({}, DEFAULT_SETTINGS, got[SETTINGS_KEY]);
}

/* ---------- per-tab state (session storage survives worker restarts) ---------- */

const tabKey = (id) => `tab:${id}`;

// The top frame reports `meta` while the player frame reports `video` every few
// seconds. Updates must not interleave, or a stale read drops the other field
// (which is how identity got lost and nothing auto-saved). Every change to a tab
// goes through an in-memory copy and a per-tab queue; session storage only
// restores state after the worker restarts.
const tabCache = new Map();
const tabQueue = new Map();

async function loadTab(tabId) {
  if (!tabCache.has(tabId)) {
    const got = await chrome.storage.session.get(tabKey(tabId));
    if (!tabCache.has(tabId)) tabCache.set(tabId, got[tabKey(tabId)] || {});
  }
  return tabCache.get(tabId);
}

function withTab(tabId, fn) {
  const prev = tabQueue.get(tabId) || Promise.resolve();
  const next = prev.then(async () => {
    const tab = await loadTab(tabId);
    tab.tabId = tabId;
    const result = await fn(tab);
    chrome.storage.session.set({ [tabKey(tabId)]: tab }).catch(() => {});
    return result;
  });
  tabQueue.set(tabId, next.catch(() => {}));
  return next;
}

async function getTab(tabId) {
  await (tabQueue.get(tabId) || Promise.resolve());
  return loadTab(tabId);
}

chrome.tabs.onRemoved.addListener((tabId) => {
  tabCache.delete(tabId);
  tabQueue.delete(tabId);
  chrome.storage.session.remove(tabKey(tabId));
});

/** What this tab is playing: the user's correction wins over detection. */
function identity(tab) {
  const o = tab.override && tab.override.url === (tab.meta && tab.meta.url) ? tab.override : null;
  // A correction with an empty episode field is the user saying "this is a film".
  if (o) return { series: o.series, episode: o.episode, corrected: true, kind: o.episode == null ? "film" : "episode" };
  if (tab.meta && tab.meta.series) {
    const m = tab.meta;
    const kind = m.kind || (m.episode != null ? "episode" : "unknown");
    return { series: m.series, episode: m.episode, corrected: false, confidence: m.confidence, kind };
  }
  return null;
}

/**
 * Only confident detections (or the user's own correction) are written automatically,
 * and never one without an episode number: an unknown episode would file every
 * episode of the series into one slot and sync you into the wrong episode.
 */
function savable(id) {
  if (!id) return false;
  if (id.corrected) return true;
  return (id.confidence === "high" || id.confidence === "medium") && id.kind !== "unknown";
}

async function resumeFor(tab, db) {
  const id = identity(tab);
  if (!id) return null;
  const hit = KS.findEntry(db || (await readDb()), id.series, id.episode);
  if (!hit || !hit.episode || hit.episode.finished || (hit.episode.time || 0) < 30) return null;
  return { title: hit.series.title, key: hit.series.key, episode: hit.episode.episode, time: hit.episode.time, duration: hit.episode.duration, host: hit.episode.lastHost };
}

/* ---------- cross-site sync ---------- */

/** The newest mark for what this tab plays (any provider), if it is worth resuming. */
async function markFor(tab) {
  const id = identity(tab);
  if (!id || !id.series) return null;
  const hit = KS.findEntry(await readDb(), id.series, id.episode);
  const ep = hit && hit.episode;
  if (!ep || ep.finished || (ep.time || 0) < 30) return null;
  return { time: ep.time, host: ep.lastHost, title: hit.series.title, episode: ep.episode, duration: ep.duration };
}

function syncKey(tab) {
  const id = identity(tab);
  return id ? [tab.meta && tab.meta.url, KS.seriesKey(id.series), id.episode].join("|") : "";
}

/** Ask the player to go to `time`. Sync lands a few seconds early (the content script's run-up); exact skips that. */
async function seekTab(tabId, frameId, time, exact) {
  const opts = typeof frameId === "number" ? { frameId } : undefined;
  await chrome.tabs.sendMessage(tabId, { type: "seek", time, exact: !!exact }, opts).catch(() => {});
}

// The content script resumes a few seconds before the mark; positions inside that
// lead-in must not overwrite the mark (otherwise every resume moves it back).
const RUNUP_WINDOW_SEC = 12;
function inRunUp(tab) {
  const to = tab.sync && tab.sync.to;
  const t = tab.video ? tab.video.time || 0 : 0;
  if (!to || t >= to) {
    if (tab.sync) delete tab.sync.to; // caught up with the mark: back to normal saving
    return false;
  }
  return t >= to - RUNUP_WINDOW_SEC;
}

/* ---------- identity across languages ---------- */

// The same show can reach us under different titles: Netflix translates them
// ("Hal-Hal Aneh" is Stranger Things), other sites use romaji or English. Before
// a title we've never seen gets its own sheet, look it up by language-independent
// IDs (Netflix's show ID, Wikidata, the catalogs). If it is a show we already
// have under another name, file the new title under that sheet so marks and
// sync carry over. Saving waits for the answer, briefly, so a fresh 0:05 never
// splits off a duplicate sheet or overwrites the real mark.
const IDENTIFY_HOLD_MS = 15000;
const identifying = new Map(); // seriesKey(title) -> { state: "pending" | "done", started, meta? }

/** Only the keys that carry a value (so an unknown page signal never erases a known one). */
function defined(o) {
  return Object.fromEntries(Object.entries(o || {}).filter(([, v]) => v !== undefined && v !== null && v !== ""));
}

function hintFromTab(tab) {
  const id = identity(tab) || {};
  const m = tab.meta || {};
  return {
    film: id.kind === "film",
    episode: id.episode,
    duration: tab.video && tab.video.duration,
    host: KS.hostOf(m.url || ""),
    lang: m.lang || "",
    netflixId: m.ids && m.ids.netflix,
    ids: m.ids || null,
  };
}

/** Sheets that turn out to be the same work (shared catalog entry or cross-catalog ID). */
function sameSheet(db, meta, exceptKey) {
  return Object.values(db.series).find((s) => s.key !== exceptKey && s.meta && !needsInfo(s) && KSCatalog.sameEntry(s.meta, meta));
}

function identifyNew(title, hint) {
  const tkey = KS.seriesKey(title);
  if (identifying.has(tkey)) return identifying.get(tkey);
  const entry = { state: "pending", started: Date.now() };
  identifying.set(tkey, entry);
  (async () => {
    try {
      const r = await KSCatalog.match(Object.assign({ title }, hint));
      if (r.best) {
        entry.meta = Object.assign({}, r.best, { confident: r.confident, alternatives: r.alternatives, autoLinked: true });
        const db = await readDb();
        const known = sameSheet(db, r.best);
        if (known && KS.resolveKey(db, title) !== known.key) {
          await mutate({ type: "alias", from: title, toKey: known.key }); // file this title under the existing sheet
          entry.mergedInto = known.title;
        }
      }
    } catch (_) {
      /* catalogs unreachable: save normally; linking retries later */
    } finally {
      entry.state = "done";
    }
  })();
  return entry;
}

/** After a sheet gets its catalog record, fold any other sheet for the same work into the older one. */
async function mergeDuplicates(key) {
  const db = await readDb();
  const sheet = db.series[key];
  if (!sheet || !sheet.meta) return;
  const twin = sameSheet(db, sheet.meta, key);
  if (!twin) return;
  const [keep, fold] = (twin.createdAt || 0) <= (sheet.createdAt || 0) ? [twin, sheet] : [sheet, twin];
  if (KS.seriesKey(fold.title) !== fold.key) return; // only fold sheets still keyed by their own title
  await mutate({ type: "alias", from: fold.title, toKey: keep.key }); // merges episodes; the newer mark wins per episode
}

/**
 * A page that starts behind your mark (another site, or a fresh load) must not
 * overwrite it. Either it syncs forward (auto-resume, or the Sync button), or you
 * choose to start there (Mark now / Undo). Returns true while saving is held back.
 */
async function holdForSync(tabId, tab) {
  const key = syncKey(tab);
  if (!key) return false;

  // A title we've never filed: first find out whether it's a sheet we know under another name.
  const who = identity(tab);
  const db = await readDb();
  if (who && who.series && !db.series[KS.resolveKey(db, who.series)]) {
    const e = identifying.get(KS.seriesKey(who.series)) || identifyNew(who.series, hintFromTab(tab));
    if (e.state === "pending" && Date.now() - e.started < IDENTIFY_HOLD_MS) {
      tab.saveStatus = { saved: false, reason: "Checking whether you've watched this under another title…", at: Date.now() };
      return true;
    }
  }

  if (!tab.sync || tab.sync.key !== key) tab.sync = { key, state: "pending" };
  if (tab.sync.state !== "pending") return false;

  const mark = await markFor(tab);
  const now = tab.video ? tab.video.time || 0 : 0;
  if (!mark || now >= mark.time - SYNC_SLACK) {
    tab.sync.state = "synced";
    return false;
  }
  const settings = await getSettings();
  if (settings.autoResume && tab.video && tab.video.duration) {
    tab.sync = { key, state: "synced", from: now, to: mark.time };
    await seekTab(tabId, tab.videoFrameId, mark.time);
    chrome.tabs.sendMessage(tabId, { type: "synced", info: Object.assign({ from: now }, mark) }, { frameId: 0 }).catch(() => {});
    tab.saveStatus = { saved: false, reason: `Synced to ${KS.formatTime(mark.time)} from ${mark.host || "your last site"}.`, at: Date.now() };
    return true;
  }
  tab.saveStatus = {
    saved: false,
    reason: `Behind your mark at ${KS.formatTime(mark.time)}${mark.host ? " (" + mark.host + ")" : ""}. Press Sync, or Mark now to start from here.`,
    at: Date.now(),
  };
  return true;
}

/** Runs inside withTab: `tab` is the live state. Records why it saved or skipped. */
async function saveProgress(tab, force) {
  const video = tab.video;
  const skip = (reason) => { tab.saveStatus = { saved: false, reason, at: Date.now() }; return null; };
  const settings = await getSettings();
  if (!settings.autoSave && !force) return skip("Automatic marks are off.");
  const id = identity(tab);
  if (!id || !id.series) return skip("No series title on this page yet.");
  if (!force && !savable(id)) {
    return skip(id.kind === "unknown"
      ? "Found the series but not the episode number. Type it in Ep and press Enter (leave Ep empty for a film)."
      : "Title is only a guess. Press Enter in the title field to confirm it.");
  }
  if (id.kind === "film" && !id.corrected) {
    // A detected "film" that the database knows as a series with episodes is a misread, not a film.
    const hit = KS.findEntry(await readDb(), id.series, null);
    const numbered = hit && Object.keys(hit.series.episodes || {}).some((k) => k !== "film");
    const metaEps = hit && hit.series.meta && hit.series.meta.episodes;
    if (numbered || (metaEps && metaEps > 1)) {
      return skip("This series has episodes, but this page didn't say which one. Type the episode number and press Enter.");
    }
  }
  if (!video) return skip("No video found yet.");
  if ((video.time || 0) < MIN_SAVE_TIME) return skip("Waiting for the first few seconds of playback.");
  if (inRunUp(tab)) return skip(`Resuming: your mark ${KS.formatTime(tab.sync.to)} is kept until playback passes it.`);
  const now = Date.now();
  if (!force && tab.lastSave && now - tab.lastSave < SAVE_EVERY_MS) return null;
  tab.lastSave = now;
  tab.saveStatus = { saved: true, time: video.time, at: now };
  const host = KS.hostOf((tab.meta && tab.meta.url) || video.frameUrl || "");
  const hint = { episode: id.episode, duration: video.duration, host, lang: (tab.meta && tab.meta.lang) || "", netflixId: tab.meta && tab.meta.ids && tab.meta.ids.netflix, ids: (tab.meta && tab.meta.ids) || null };
  const saved = await mutate({
    type: "progress",
    series: id.series,
    episode: id.episode,
    time: video.time,
    duration: video.duration,
    ended: video.ended,
    url: tab.meta ? tab.meta.url : video.frameUrl,
  });
  // A series seen for the first time gets its synopsis, poster and episode count right away.
  const key = KS.resolveKey(saved, id.series);
  if (saved.series[key] && needsInfo(saved.series[key])) queueLink(key, hint);
  // AniList hears about an episode once, when it has played a minute. Finishing it sends nothing.
  const playId = `${key}|${KS.epKey(id.episode)}`;
  if (video.time >= START_AFTER && tab.anilistStarted !== playId) {
    tab.anilistStarted = playId;
    KSAnilistSync.enqueue({ key, ep: KS.epKey(id.episode), phase: "start", title: saved.series[key] && saved.series[key].title, tabId: tab.tabId }).catch(() => {});
  }
  return saved;
}

/* ---------- catalog info: fetched as soon as a new series is saved ---------- */

const LINK_KEY = "ks:autolink"; // { seriesKey: next attempt time }
const MISS_RETRY_MS = 24 * 3600 * 1000;
const ERROR_RETRY_MS = 10 * 60 * 1000;
const linking = new Set();
let linkQueue = Promise.resolve();

function needsInfo(series) {
  return !series.meta || !series.meta.source || KSCatalog.RETIRED.includes(series.meta.source);
}

/** What the extension knows about this series, as matching signals. */
function signalsFor(series, hint) {
  const keys = Object.keys(series.episodes || {});
  const numbered = keys.filter((k) => k !== "film").map(Number);
  const latest = Object.values(series.episodes || {}).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
  return {
    title: series.title,
    film: keys.length > 0 && numbered.length === 0,
    episode: hint && hint.episode != null ? hint.episode : numbered.length ? Math.max(...numbered) : null,
    duration: (hint && hint.duration) || (latest && latest.duration) || null,
    host: (hint && hint.host) || (latest && latest.lastHost) || "",
  };
}

async function setTried(key, next) {
  const tried = (await chrome.storage.local.get(LINK_KEY))[LINK_KEY] || {};
  if (next) tried[key] = next;
  else delete tried[key];
  await chrome.storage.local.set({ [LINK_KEY]: tried });
}

/**
 * Save a catalog record onto a sheet, and file its other titles under the same sheet.
 * A confident match also renames the sheet to the catalog's title, so a show first
 * seen under a translated title ("Hal-Hal Aneh") reads the same everywhere
 * (Stranger Things); the translated title stays filed under it.
 */
async function applyMeta(key, meta) {
  const rename = meta.confident !== false && meta.title ? { title: meta.title } : {};
  await mutate(Object.assign({ type: "upsertSeries", key, meta }, rename));
  const db = await readDb();
  const names = [meta.title, meta.altTitle].concat(meta.synonyms || []).filter(Boolean).slice(0, 10);
  for (const name of names) {
    const k = KS.seriesKey(name);
    if (k && k !== key && !db.series[k] && !(db.aliases && db.aliases[k])) await mutate({ type: "alias", from: name, toKey: key });
  }
}

async function linkOne(key, hint, force) {
  const series = (await readDb()).series[key];
  if (!series || (!force && !needsInfo(series))) return;
  const tried = (await chrome.storage.local.get(LINK_KEY))[LINK_KEY] || {};
  if (!force && Date.now() < (tried[key] || 0)) return;
  linking.add(key);
  let next = Date.now() + MISS_RETRY_MS;
  try {
    const cached = !force && identifying.get(KS.seriesKey(series.title));
    const meta = cached && cached.meta
      ? cached.meta
      : await KSCatalog.match(Object.assign(signalsFor(series, hint), defined(hint), { title: series.title })).then((r) =>
          r.best ? Object.assign({}, r.best, { confident: r.confident, alternatives: r.alternatives, autoLinked: true }) : null);
    const live = (await readDb()).series[key];
    if (meta && live && (force || needsInfo(live))) {
      await applyMeta(key, meta);
      await mergeDuplicates(key);
      next = 0;
    }
  } catch (_) {
    next = Date.now() + ERROR_RETRY_MS; // catalogs unreachable: try again soon
  } finally {
    linking.delete(key);
  }
  await setTried(key, next);
}

function queueLink(key, hint, force) {
  linkQueue = linkQueue.then(() => linkOne(key, hint, force)).catch(() => {});
  return linkQueue;
}

async function linkPending() {
  const db = await readDb();
  for (const s of Object.values(db.series)) if (needsInfo(s)) queueLink(s.key);
}

chrome.runtime.onInstalled.addListener(() => linkPending());
chrome.runtime.onStartup.addListener(() => { linkPending(); KSAnilistSync.run(); });

KSAnilistSync.init({
  readDb,
  getSettings,
  // Tell the page that just finished the episode, so it can offer Undo.
  notify: (tabId, info) => { if (typeof tabId === "number") chrome.tabs.sendMessage(tabId, { type: "anilistSync", info }, { frameId: 0 }).catch(() => {}); },
});
chrome.alarms.onAlarm.addListener((a) => { if (a.name === KSAnilistSync.ALARM) KSAnilistSync.run(); });

/* ---------- badge: a red dot while a mark is being kept ---------- */

function badge(tabId, on) {
  chrome.action.setBadgeBackgroundColor({ tabId, color: "#d23a2c" });
  chrome.action.setBadgeText({ tabId, text: on ? "●" : "" });
}

/* ---------- messages ---------- */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handle(msg, sender).then(sendResponse, (err) => sendResponse({ error: String(err && err.message || err) }));
  return true;
});

async function handle(msg, sender) {
  const tabId = msg.tabId || (sender.tab && sender.tab.id);

  switch (msg.type) {
    case "meta": {
      // Top frame reports page identity; reply with a resume offer if one exists.
      return withTab(tabId, async (tab) => {
        const changed = !tab.meta || tab.meta.url !== msg.meta.url || tab.meta.series !== msg.meta.series || tab.meta.episode !== msg.meta.episode;
        tab.meta = msg.meta;
        delete tab.library; // a playing page in this tab is not the library
        if (changed) tab.lastSave = 0; // a new episode saves on the next tick
        const who = identity(tab);
        if (who && who.series && savable(who)) {
          const db = await readDb();
          if (!db.series[KS.resolveKey(db, who.series)]) identifyNew(who.series, hintFromTab(tab));
        }
        const settings = await getSettings();
        // With auto-resume the player syncs itself once it starts; otherwise offer the card.
        return { resume: settings.resumeChip && !settings.autoResume ? await resumeFor(tab) : null };
      });
    }

    case "video": {
      return withTab(tabId, async (tab) => {
        tab.video = msg.video;
        tab.videoFrameId = sender.frameId;
        const playing = !msg.video.paused && !msg.video.ended;
        badge(tabId, playing && savable(identity(tab)));
        if (savable(identity(tab)) && (await holdForSync(tabId, tab))) return { ok: true };
        // A pause or seek always saves; playback saves every few seconds.
        await saveProgress(tab, !!msg.force && savable(identity(tab)));
        return { ok: true };
      });
    }

    case "getTab": {
      const tab = await getTab(tabId);
      const db = await readDb();
      const id = identity(tab);
      const hit = id ? KS.findEntry(db, id.series, id.episode) : null;
      return {
        tab,
        identity: id,
        entry: hit && hit.episode ? hit.episode : null,
        seriesTitle: hit ? hit.series.title : null,
        seriesKey: hit ? hit.series.key : null,
        seriesMeta: hit ? hit.series.meta : null,
        linking: hit ? linking.has(hit.series.key) : false,
        recent: KS.recent(db, 6).map((r) => ({
          title: r.series.title, key: r.series.key, episode: r.episode.episode,
          time: r.episode.time, duration: r.episode.duration, host: r.episode.lastHost,
          url: r.episode.lastHost && r.episode.providers && r.episode.providers[r.episode.lastHost] && r.episode.providers[r.episode.lastHost].url,
          updatedAt: r.episode.updatedAt,
        })),
        settings: await getSettings(),
      };
    }

    case "correct": {
      // Popup: user fixes (or confirms) the detected title/episode for this page.
      return withTab(tabId, async (tab) => {
        tab.override = { url: tab.meta && tab.meta.url, series: msg.series, episode: msg.episode };
        if (tab.meta && tab.meta.series && KS.seriesKey(tab.meta.series) !== KS.seriesKey(msg.series)) {
          // Teach the database: this detected title belongs to the corrected series.
          await mutate({ type: "alias", from: tab.meta.series, to: msg.series });
        }
        if (tab.video) await saveProgress(tab, true);
        return { ok: true };
      });
    }

    case "saveNow": {
      // "Start from here": an explicit mark ends any pending sync for this page.
      return withTab(tabId, async (tab) => {
        if (!tab.video) return { error: "No video found on this page yet." };
        if (!identity(tab) || !identity(tab).series) return { error: "Type the series title first." };
        tab.sync = { key: syncKey(tab), state: "declined" };
        await saveProgress(tab, true);
        return { ok: true };
      });
    }

    case "sync": {
      // Sync button (popup or page card): go to the newest mark from any site.
      return withTab(tabId, async (tab) => {
        const mark = await markFor(tab);
        if (!mark) return { error: "No mark to sync to for this episode yet." };
        tab.sync = { key: syncKey(tab), state: "synced", from: tab.video ? tab.video.time : 0, to: mark.time };
        tab.lastSave = Date.now(); // let the seek land before the next save
        await seekTab(tabId, tab.videoFrameId, mark.time);
        tab.saveStatus = { saved: false, reason: `Synced to ${KS.formatTime(mark.time)}${mark.host ? " from " + mark.host : ""}.`, at: Date.now() };
        return { ok: true, time: mark.time, host: mark.host };
      });
    }

    case "undoSync": {
      // The card's Undo: go back to where this page was and keep marking from there.
      return withTab(tabId, async (tab) => {
        const back = tab.sync && typeof tab.sync.from === "number" ? tab.sync.from : 0;
        tab.sync = { key: syncKey(tab), state: "declined" };
        await seekTab(tabId, tab.videoFrameId, back, true);
        return { ok: true };
      });
    }

    case "seek": {
      await chrome.tabs.sendMessage(tabId, { type: "seek", time: msg.time });
      return { ok: true };
    }

    case "op":
      return { db: await mutate(msg.op) };

    case "bridgeHello": {
      // A page claims to be the Kumostamp library. Trust local origins and the
      // Library address set in the popup; remember the claim so the popup can offer it.
      const settings = await getSettings();
      const local = /^(https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?|file:\/\/|null$)/.test(msg.origin || "");
      let libraryOrigin = "";
      try { libraryOrigin = new URL(settings.libraryUrl).origin; } catch (_) { /* unset */ }
      const trusted = local || msg.origin === libraryOrigin;
      if (typeof tabId === "number") await withTab(tabId, (tab) => { tab.library = { origin: msg.origin, url: msg.url, trusted }; });
      return { trusted };
    }

    case "linkNow": {
      // Website or popup asks to (re)look up one sheet now.
      queueLink(msg.key, null, !!msg.force);
      return { ok: true };
    }

    case "chooseMatch": {
      // "Not this one?": the user picked another catalog entry.
      const db = await readDb();
      const series = db.series[msg.key];
      if (!series) return { error: "That sheet no longer exists." };
      const old = series.meta;
      const full = await KSCatalog.complete({ source: msg.source, id: msg.id, image: msg.image || "" });
      const others = ((old && old.alternatives) || []).filter((a) => !(a.source === msg.source && a.id === msg.id));
      if (old && old.source && !KSCatalog.RETIRED.includes(old.source)) others.unshift(KSCatalog.brief(old));
      await applyMeta(msg.key, Object.assign({}, full, { confident: true, chosen: true, alternatives: others.slice(0, 3) }));
      await mergeDuplicates(msg.key);
      return { ok: true, title: full.title };
    }

    case "getDb":
      return { db: await readDb() };

    case "getSettings":
      return { settings: await getSettings() };

    case "accountStatus":
      return { accounts: await KSAccounts.status((await getSettings()).anilistClientId) };

    case "accountConnect": {
      if (msg.provider !== "anilist") return { error: "Unsupported account." };
      try {
        await KSAccounts.connectAnilist((await getSettings()).anilistClientId);
      } catch (e) {
        return { error: String((e && e.message) || e) };
      }
      // Connecting is the opt-in; the switch in the popup turns it off again.
      const next = Object.assign(await getSettings(), { anilistSync: true });
      await chrome.storage.local.set({ [SETTINGS_KEY]: next });
      return { accounts: await KSAccounts.status(next.anilistClientId), settings: next };
    }

    case "anilistUndo": {
      try {
        return { ok: true, undone: await KSAnilistSync.undo() };
      } catch (e) {
        return { error: String((e && e.message) || e) };
      }
    }

    case "anilistLast":
      return { last: await KSAnilistSync.lastPush() };

    case "accountDisconnect": {
      await KSAccounts.disconnectAnilist();
      const next = Object.assign(await getSettings(), { anilistSync: false });
      await chrome.storage.local.set({ [SETTINGS_KEY]: next });
      return { accounts: await KSAccounts.status(next.anilistClientId), settings: next };
    }

    case "setSettings": {
      const next = Object.assign(await getSettings(), msg.settings);
      await chrome.storage.local.set({ [SETTINGS_KEY]: next });
      return { settings: next };
    }
  }
  return { error: `Unknown message ${msg.type}` };
}
