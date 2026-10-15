/*
 * Kumostamp core, shared by the extension (background, content, popup)
 * and the website. Keep this file identical in extension/lib and web/js
 * (run `node scripts/sync-shared.mjs` after editing).
 */
(function (root) {
  "use strict";

  const VERSION = 1;
  const FILM = "film";

  function emptyDb() {
    return { version: VERSION, series: {}, aliases: {}, removed: { series: {}, episodes: {} }, updatedAt: 0 };
  }

  /**
   * The sheet key for a title: lower case, accents off, every letter of every
   * script kept (Thai, Hangul, Cyrillic, Arabic...), words joined by "-".
   * Latin and Japanese titles get the same keys as before.
   */
  function seriesKey(title) {
    return String(title || "")
      .replace(/[đĐ]/g, "d") // Vietnamese đ has no decomposition
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .normalize("NFC") // re-compose Hangul syllables split by NFKD
      .toLowerCase()
      .replace(/['’`]/g, "")
      .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
      .trim()
      .replace(/\s+/g, "-");
  }

  /** The key scheme used before every script was kept (only Latin, digits, kana, kanji). */
  function legacySeriesKey(title) {
    return String(title || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/['’`]/g, "")
      .replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9fff]+/g, " ")
      .trim()
      .replace(/\s+/g, "-");
  }

  function epKey(episode) {
    if (episode === null || episode === undefined || episode === "") return FILM;
    const n = Number(episode);
    return Number.isFinite(n) ? String(n) : String(episode);
  }

  function formatTime(sec) {
    sec = Math.max(0, Math.floor(Number(sec) || 0));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const pad = (v) => String(v).padStart(2, "0");
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }

  /** "26:14", "1:02:03", "26m14s", "26" (minutes) → seconds, or null. */
  function parseTime(input) {
    const s = String(input || "").trim();
    if (!s) return null;
    if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s) * 60);
    const hms = s.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})$/);
    if (hms) return (Number(hms[1] || 0) * 3600) + Number(hms[2]) * 60 + Number(hms[3]);
    const unit = s.match(/^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?\s*(?:(\d+)\s*s)?$/i);
    if (unit && (unit[1] || unit[2] || unit[3])) {
      return Number(unit[1] || 0) * 3600 + Number(unit[2] || 0) * 60 + Number(unit[3] || 0);
    }
    return null;
  }

  function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch (_) { return ""; }
  }

  /* ---------------- title / episode detection ---------------- */

  const EP_PATTERNS = [
    /\b(?:episode|episodio|episódio|épisode|eps?|ep\.)\s*[-#:.]?\s*(\d{1,4})(?:\s*(?:end|final))?\b/i,
    /第\s*(\d{1,4})\s*[話话集回]/,
    /\bS(\d{1,2})\s*[·•|/:,.\-–—]?\s*E(\d{1,4})\b/i,
    /(?:Tập|Tap)\s*(\d{1,4})/i,                       // Vietnamese
    /ตอนที่\s*(\d{1,4})/, /ตอน\s*(\d{1,4})/,           // Thai
    /(\d{1,4})\s*[화회](?![\p{L}])/u,                 // Korean: 5화, 5회
    /(?:Серия|серия)\s*(\d{1,4})|(\d{1,4})\s*серия/,  // Russian
    /\b(?:Capítulo|Capitulo|Folge|Odcinek|Afl\.?|Aflevering|Jakso|Avsnitt)\s*(\d{1,4})/i, // es/pt, de, pl, nl, fi, sv
    /(\d{1,4})\.\s*Bölüm/i,                           // Turkish
    /الحلقة\s*(\d{1,4})/,                            // Arabic
    /(?:^|[\s》」』〉])#\s?(\d{1,4})(?=\s|$|[\[(【|])/,  // "《HOTEL INHUMANS》#15", "Show #15"
    /\sE(\d{1,4})(?=\s*(?:$|[-–—:|(\[]))/,              // "Firefly Wedding E1 - Title"
    /\s[-–—]\s+(\d{1,4})(?=\s|$|[\[(|])/,
  ];

  const NOISE = [
    /\b(?:watch|nonton|streaming|stream|online|free|full\s*hd|hd|1080p|720p|480p|360p)\b/gi,
    /\b(?:sub(?:title)?\s*indo(?:nesia)?|english\s*(?:sub(?:bed)?|dub(?:bed)?)|sub(?:bed)?|dub(?:bed)?|raw)\b/gi,
    /\b(?:vietsub|thuyết minh|lồng tiếng|subtitulado|doblado|legendado|dublado|untertitel|vostfr|vf)\b/gi,
    /ซับไทย|พากย์ไทย|ดูออนไลน์|자막|더빙|다시보기|смотреть онлайн|озвучка|xem phim|online|مترجم/gi,
    /\[[^\]]*\]/g,
    /【[^】]*】/g,                                                      // 【Ani-One Asia】
    /\((?:eng|english|jp|jpn|japanese|indo|multi|sub|dub|cc)\b[^)]*\)/gi, // (ENG sub | JP dub)
    /\((?:limited time|free|full|uncut|official)[^)]*\)/gi,         // (Limited Time)
    /\bfull\s*(?:movie|episode)\b|\bofficial\s*(?:trailer|video)\b/gi,
    /\((?:sub|dub|uncensored)[^)]*\)/gi,
  ];

  function cleanSeries(raw, host) {
    let s = String(raw || "").replace(/[《「『〈]([^》」』〉]+)[》」』〉]/g, " $1 ").replace(/[《》「」『』〈〉]/g, " ");
    for (const re of NOISE) s = s.replace(re, " ");
    if (host) {
      const brand = host.split(".")[0];
      if (brand.length > 2) s = s.replace(new RegExp(`\\b${brand}\\b`, "ig"), " ");
    }
    s = s.replace(/\s{2,}/g, " ").replace(/^[\s\-–—:|·•]+|[\s\-–—:|·•,]+$/g, "").trim();
    return s;
  }

  function findEpisode(text) {
    for (const re of EP_PATTERNS) {
      const m = re.exec(text);
      if (!m) continue;
      if (/S\(/.test(re.source) && m[2]) return { episode: Number(m[2]), season: Number(m[1]), index: m.index };
      return { episode: Number(m[1] || m[2]), index: m.index };
    }
    return null;
  }

  /**
   * Guess { series, episode } from page signals.
   * signals: { title, ogTitle, h1, url }
   */
  function parseMedia(signals) {
    const host = hostOf(signals.url || "");
    // Drop bracketed channel/language tags first: their "|" ("(ENG sub | JP dub)") is not a title separator.
    const untag = (t) => t
      .replace(/【[^】]*】/g, " ")
      .replace(/\((?:eng|english|jp|jpn|japanese|indo|multi|sub|dub|cc)[^)]*\)/gi, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
    const texts = [signals.ogTitle, signals.h1, signals.title].filter(Boolean).map((t) => untag(String(t)));

    for (const text of texts) {
      // Split site-name segments, prefer the one with an episode marker.
      const segments = text.split(/\s[|»]\s|\s[-–—]\s(?=[A-Z][\w.]+(?:\.\w{2,})?\s*$)/);
      for (const seg of segments) {
        const ep = findEpisode(seg);
        if (!ep) continue;
        let head = seg.slice(0, ep.index);
        const tag = head.match(/\(\s*S(\d{1,2})\s*\)/i); // "Show (S2) - Episode 07"
        if (tag) head = head.replace(tag[0], " ");
        let series = cleanSeries(head, host);
        const season = ep.season || (tag && Number(tag[1]));
        if (season > 1) series += ` Season ${season}`;
        if (series.length >= 2) return { series, episode: ep.episode, confidence: "high" };
      }
    }

    // URL slug: /watch/jojo-part-6-episode-2
    try {
      const path = decodeURIComponent(new URL(signals.url).pathname);
      const slug = path.split("/").filter(Boolean).reverse()
        .find((p) => /(?:episode|ep)[-_]?\d+/i.test(p));
      if (slug) {
        const words = slug.replace(/\.[a-z]+$/i, "").replace(/[-_]+/g, " ");
        const ep = findEpisode(words);
        if (ep) {
          const series = cleanSeries(words.slice(0, ep.index), host);
          if (series.length >= 2) return { series: titleCase(series), episode: ep.episode, confidence: "medium" };
        }
      }
    } catch (_) { /* ignore */ }

    // A title that says it's a film: "Haikyu!! The Dumpster Battle (2024) Full Movie", "… The Movie".
    for (const text of texts) {
      if (!/\b(?:full\s*movie|the\s*movie|movie|film)\b/i.test(text) || /\b(?:trailer|teaser|review|reaction)\b/i.test(text)) continue;
      const name = cleanSeries(text.split(/\s[|»]\s/)[0].replace(/\(\s*(?:19|20)\d{2}\s*\)/g, " ").replace(/\b(?:full\s*)?movie\b\s*$/i, " "), host);
      if (name.length >= 2 && !isGenericTitle(name)) return { series: name, episode: null, confidence: "medium", film: true };
    }

    // No episode marker: maybe a film, maybe a browse page. Low confidence: never auto-saved.
    const first = texts[0] ? cleanSeries(texts[0].split(/\s[|»\-–—]\s/)[0], host) : "";
    if (isGenericTitle(first)) return { series: "", episode: null, confidence: "none" };
    return { series: first, episode: null, confidence: "low" };
  }

  /** Episode labels as players print them: "S1:E2", "S1 E2", "Season 1, Ep. 2", "Ep 2", "E2", "Episode 2". */
  function parseEpisodeLabel(text) {
    const s = String(text || "");
    // The two numbers may be joined by a space, colon, comma, dot, middle dot, bar, slash or dash ("S1 · E2", "S1-E2", "S1E2").
    let m = s.match(/\bS(?:eason)?\s*(\d{1,2})\s*[:,.·•|/\-–—]?\s*E(?:p(?:isode)?)?\.?\s*(\d{1,4})\b/i);
    if (m) return { season: Number(m[1]), episode: Number(m[2]) };
    m = s.match(/\bSeason\s*(\d{1,2})\b.*?\b(?:Ep(?:isode)?\.?|E)\s*(\d{1,4})\b/i);
    if (m) return { season: Number(m[1]), episode: Number(m[2]) };
    m = s.match(/^\s*(?:E|Ep\.?|Eps\.?|Episode)\s*(\d{1,4})\b/i) || s.match(/\b(?:Episode|Ep\.?|Eps)\s*(\d{1,4})\b/i);
    if (m) return { season: null, episode: Number(m[1]) };
    m = s.match(/第\s*(\d{1,4})\s*[話话集回]/);
    if (m) return { season: null, episode: Number(m[1]) };
    // Other languages: "Tập 5", "ตอนที่ 5", "5화", "Серия 5", "Capítulo 5", "Folge 5" (with an optional season word)
    const ep = s.match(/(?:Tập|Tap|ตอนที่|ตอน|Серия|серия|Capítulo|Capitulo|Episódio|Episodio|Folge|Odcinek|Afl\.?|Jakso|Avsnitt)\s*(\d{1,4})/i)
      || s.match(/(\d{1,4})\s*(?:화|회|серия|\.\s*Bölüm)/i);
    if (ep) {
      const se = s.match(SEASON_WORDS);
      return { season: se ? Number(se[1]) : null, episode: Number(ep[1]) };
    }
    return null;
  }

  /** "Season" in other languages, as players print it. */
  const SEASON_WORDS = /(?:season|temporada|staffel|saison|stagione|sezon|musim|phần|ซีซั่น|시즌|сезон)\s*(\d{1,2})/i;

  /** "Breaking Bad" + season 2 → "Breaking Bad Season 2"; season 1 stays bare. */
  function withSeason(series, season) {
    return season && season > 1 && !/\b(season|part|cour)\s*\d/i.test(series) && !SEASON_WORDS.test(series) ? `${series} Season ${season}` : series;
  }

  // Page names that are never a series: navigation pages of streaming sites.
  const GENERIC = new Set([
    "home", "beranda", "browse", "watch", "player", "video", "videos", "movies", "movie", "film", "series", "tv shows",
    "my list", "daftar saya", "search", "cari", "netflix", "prime video", "disney+", "disney+ hotstar", "hbo max", "max",
    "crunchyroll", "youtube", "vidio", "viu", "iqiyi", "bilibili", "loading", "untitled", "anime", "streaming", "nonton",
    "episodes", "episode", "episode list", "comments", "related", "recommended", "about anime",
  ]);
  function isGenericTitle(s) {
    const t = String(s || "").trim().toLowerCase();
    return !t || t.length < 2 || GENERIC.has(t);
  }

  function titleCase(s) {
    return s.replace(/\b([a-z])/g, (c) => c.toUpperCase());
  }

  /* ---------------- data ops ---------------- */

  function resolveKey(db, title) {
    const k = seriesKey(title);
    const hit = (db.aliases && db.aliases[k]) || k;
    if (db.series && !db.series[hit]) {
      const old = legacySeriesKey(title);
      const legacy = (db.aliases && db.aliases[old]) || old;
      if (old && db.series[legacy]) return legacy;
    }
    return hit;
  }

  function ensureSeries(db, title, now) {
    const key = resolveKey(db, title);
    if (!db.series[key]) {
      db.series[key] = { key, title: String(title).trim(), meta: null, episodes: {}, createdAt: now, updatedAt: now };
    }
    return db.series[key];
  }

  function touch(db, series, now) {
    series.updatedAt = now;
    db.updatedAt = now;
  }

  /**
   * Apply one mutation. Returns the same (mutated) db.
   * Every writer (background worker or website fallback) goes through here.
   */
  function applyOp(db, op, now) {
    now = now || Date.now();
    db = db && db.series ? db : emptyDb();
    db.aliases = db.aliases || {};
    const removed = removedOf(db);

    switch (op.type) {
      case "progress": {
        if (!op.series) break;
        const series = ensureSeries(db, op.series, now);
        const k = epKey(op.episode);
        const ep = series.episodes[k] || { episode: k === FILM ? null : Number(op.episode), providers: {} };
        ep.time = Math.max(0, Math.floor(op.time || 0));
        if (op.duration && Number.isFinite(op.duration)) ep.duration = Math.round(op.duration);
        ep.finished = !!(ep.duration && ep.time >= ep.duration - 90) || !!op.ended;
        ep.updatedAt = now;
        const host = op.host || hostOf(op.url);
        if (host) {
          ep.lastHost = host;
          ep.providers = ep.providers || {};
          ep.providers[host] = { url: op.url || "", time: ep.time, updatedAt: now };
        }
        series.episodes[k] = ep;
        touch(db, series, now);
        break;
      }
      case "setEpisode": {
        const series = db.series[op.key] || (op.title ? ensureSeries(db, op.title, now) : null);
        if (!series) break;
        const k = epKey(op.episode);
        const ep = series.episodes[k] || { episode: k === FILM ? null : Number(op.episode), providers: {} };
        if (op.time !== undefined && op.time !== null) ep.time = Math.max(0, Math.floor(op.time));
        if (op.duration) ep.duration = Math.round(op.duration);
        if (op.url) {
          const host = hostOf(op.url);
          ep.providers = ep.providers || {};
          ep.providers[host] = { url: op.url, time: ep.time || 0, updatedAt: now };
          ep.lastHost = host;
        }
        ep.time = ep.time || 0;
        ep.finished = !!(ep.duration && ep.time >= ep.duration - 90);
        ep.updatedAt = now;
        series.episodes[k] = ep;
        touch(db, series, now);
        break;
      }
      case "upsertSeries": {
        const key = op.key || resolveKey(db, op.title);
        const series = db.series[key] || { key, title: op.title, meta: null, episodes: {}, createdAt: now };
        if (op.title && op.title !== series.title) {
          series.title = op.title;
          series.titledAt = now;
        }
        if (op.meta) series.meta = Object.assign({}, series.meta || {}, op.meta, { fetchedAt: now });
        db.series[key] = series;
        touch(db, series, now);
        break;
      }
      case "alias": {
        // Detected title `from` should file under series `to`.
        const from = seriesKey(op.from);
        const to = op.toKey || resolveKey(db, op.to);
        if (from && to && from !== to) {
          db.aliases[from] = to;
          if (db.series[from] && db.series[to]) mergeInto(db.series[to], db.series[from]);
          if (db.series[from] && !db.series[to]) {
            db.series[to] = Object.assign(db.series[from], { key: to, title: op.to || db.series[from].title });
          }
          if (from !== to) delete db.series[from];
          db.updatedAt = now;
        }
        break;
      }
      case "deleteSeries":
        delete db.series[op.key];
        delete removed.episodes[op.key];
        removed.series[op.key] = now;
        for (const [a, t] of Object.entries(db.aliases)) if (t === op.key) delete db.aliases[a];
        db.updatedAt = now;
        break;
      case "moveEpisode": {
        // Re-file a mark under another episode (e.g. one saved without a number).
        const series = db.series[op.key];
        if (!series) break;
        const from = epKey(op.from);
        const to = epKey(op.to);
        const src = series.episodes[from];
        if (!src || from === to) break;
        const dst = series.episodes[to];
        const moved = Object.assign({}, src, { episode: to === FILM ? null : Number(op.to) });
        if (!dst || (src.updatedAt || 0) >= (dst.updatedAt || 0)) {
          moved.providers = Object.assign({}, dst && dst.providers, src.providers);
          series.episodes[to] = moved;
        } else {
          dst.providers = Object.assign({}, src.providers, dst.providers);
        }
        delete series.episodes[from];
        markRemoved(removed, op.key, from, now);
        touch(db, series, now);
        break;
      }
      case "deleteEpisode":
        if (db.series[op.key]) {
          delete db.series[op.key].episodes[epKey(op.episode)];
          markRemoved(removed, op.key, epKey(op.episode), now);
          touch(db, db.series[op.key], now);
        }
        break;
      case "import": {
        // Another copy of the library (sync, a JSON file, or an undo snapshot), merged in.
        const incoming = op.db && op.db.series ? op.db : null;
        if (!incoming) break;
        // Undo: what comes back must outlive the deletion it reverses, here and on every synced copy.
        const series = op.restore ? restoreAfter(removed, incoming.series, now) : incoming.series;
        mergeDb(db, Object.assign({}, incoming, { series }));
        db.updatedAt = now;
        break;
      }
      case "replace":
        return op.db && op.db.series ? op.db : db;
    }
    return db;
  }

  /** Per site, the newer mark wins. */
  function mergeProviders(a, b) {
    const out = Object.assign({}, a);
    for (const [host, p] of Object.entries(b || {})) {
      if (!out[host] || ((p && p.updatedAt) || 0) > ((out[host] && out[host].updatedAt) || 0)) out[host] = p;
    }
    return out;
  }

  /**
   * Fold `source` into `target`, newest episode winning. `sameSeries`: both are copies of one
   * series (sync, import), so newer info and a newer rename win too. Without it (an alias
   * folding another sheet in) the target keeps its own info.
   */
  function mergeInto(target, source, sameSeries) {
    target.episodes = target.episodes || {};
    for (const [k, ep] of Object.entries(source.episodes || {})) {
      const cur = target.episodes[k];
      const a = (ep && ep.updatedAt) || 0;
      const b = (cur && cur.updatedAt) || 0;
      const newer = !cur || a > b || (a === b && (ep.time || 0) > (cur.time || 0));
      const providers = mergeProviders(cur && cur.providers, ep.providers);
      target.episodes[k] = Object.assign({}, newer ? ep : cur, { providers });
    }
    if (sameSeries) {
      if (source.meta && (!target.meta || (source.meta.fetchedAt || 0) > (target.meta.fetchedAt || 0))) target.meta = source.meta;
      if (source.title && (source.titledAt || 0) > (target.titledAt || 0)) {
        target.title = source.title;
        target.titledAt = source.titledAt;
      }
    } else if (!target.meta && source.meta) target.meta = source.meta;
    target.updatedAt = Math.max(target.updatedAt || 0, source.updatedAt || 0);
  }

  /** Deletions, kept with their time so a synced copy can't bring the item back. */
  function removedOf(db) {
    db.removed = db.removed || {};
    db.removed.series = db.removed.series || {};
    db.removed.episodes = db.removed.episodes || {};
    return db.removed;
  }

  function markRemoved(removed, key, ep, at) {
    removed.episodes[key] = removed.episodes[key] || {};
    removed.episodes[key][ep] = at;
  }

  function restoreAfter(removed, series, now) {
    const out = {};
    for (const [key, s] of Object.entries(series)) {
      const copy = Object.assign({}, s, { episodes: Object.assign({}, s.episodes) });
      if (removed.series[key] && (copy.updatedAt || 0) <= removed.series[key]) copy.updatedAt = now;
      const gone = removed.episodes[key] || {};
      for (const [k, ep] of Object.entries(copy.episodes)) {
        if (gone[k] && (ep.updatedAt || 0) <= gone[k]) copy.episodes[k] = Object.assign({}, ep, { updatedAt: now });
      }
      out[key] = copy;
    }
    return out;
  }

  /**
   * Merge another copy of a library into `db` (mutated): union of sheets and marks,
   * newest wins per episode, and deletions known to either side apply to both.
   */
  function mergeDb(db, incoming) {
    db.series = db.series || {};
    db.aliases = Object.assign(db.aliases || {}, incoming.aliases || {});
    const removed = removedOf(db);
    const theirs = incoming.removed || {};
    for (const [key, t] of Object.entries(theirs.series || {})) if (!(removed.series[key] >= t)) removed.series[key] = t;
    for (const [key, eps] of Object.entries(theirs.episodes || {})) {
      for (const [k, t] of Object.entries(eps || {})) {
        if (!(removed.episodes[key] && removed.episodes[key][k] >= t)) markRemoved(removed, key, k, t);
      }
    }
    for (const [key, s] of Object.entries(incoming.series || {})) {
      // A sheet the other copy still files under a title this one has since re-filed (alias).
      const to = db.aliases[key] && db.aliases[key] !== key ? db.aliases[key] : key;
      if (!db.series[to]) db.series[to] = Object.assign({}, s, { key: to, episodes: Object.assign({}, s.episodes) });
      else mergeInto(db.series[to], s, to === key);
    }
    // Sheets this copy still keeps under a title that has since been re-filed elsewhere.
    for (const key of Object.keys(db.series)) {
      const to = db.aliases[key];
      if (!to || to === key) continue;
      if (db.series[to]) mergeInto(db.series[to], db.series[key]);
      else db.series[to] = Object.assign(db.series[key], { key: to });
      delete db.series[key];
    }
    for (const [key, t] of Object.entries(removed.series)) {
      if (db.series[key] && (db.series[key].updatedAt || 0) <= t) delete db.series[key];
    }
    for (const [key, eps] of Object.entries(removed.episodes)) {
      const s = db.series[key];
      if (!s) continue;
      for (const [k, t] of Object.entries(eps)) if (s.episodes[k] && (s.episodes[k].updatedAt || 0) <= t) delete s.episodes[k];
    }
    return db;
  }

  /** Stable fingerprint of a library's content (not its save time): equal means nothing to sync. */
  function dbSignature(db) {
    const stable = (v) => {
      if (Array.isArray(v)) return "[" + v.map(stable).join(",") + "]";
      if (v && typeof v === "object") {
        const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
        return "{" + keys.map((k) => JSON.stringify(k) + ":" + stable(v[k])).join(",") + "}";
      }
      return JSON.stringify(v === undefined ? null : v);
    };
    return stable({ series: db.series || {}, aliases: db.aliases || {}, removed: db.removed || {} });
  }

  function findEntry(db, title, episode) {
    if (!db || !title) return null;
    const series = db.series[resolveKey(db, title)];
    if (!series) return null;
    return { series, episode: series.episodes[epKey(episode)] || null };
  }

  /** Most recent episode mark across all series. */
  function recent(db, limit) {
    const rows = [];
    for (const s of Object.values((db && db.series) || {})) {
      for (const [k, ep] of Object.entries(s.episodes || {})) {
        rows.push({ series: s, key: k, episode: ep });
      }
    }
    rows.sort((a, b) => (b.episode.updatedAt || 0) - (a.episode.updatedAt || 0));
    return rows.slice(0, limit || rows.length);
  }

  function relTime(ts, now) {
    if (!ts) return "";
    const d = Math.round(((now || Date.now()) - ts) / 1000);
    if (d < 60) return "just now";
    if (d < 3600) return `${Math.floor(d / 60)} min ago`;
    if (d < 86400) return `${Math.floor(d / 3600)} h ago`;
    if (d < 86400 * 7) return `${Math.floor(d / 86400)} d ago`;
    return new Date(ts).toLocaleDateString();
  }

  /**
   * What to tell AniList about an episode. Pure, so it can be tested without a network.
   * `current` is the viewer's existing list entry for that anime ({progress, status}) or null.
   * `phase` is "start" (the episode is playing: show it as Watching) or "finish" (it ended).
   * Returns {mediaId, progress, status} to send, or {skip: reason}.
   */
  function anilistPlan(series, episode, current, phase) {
    const meta = series && series.meta;
    if (!meta || meta.source !== "anilist" || !meta.id) return { skip: "not-on-anilist" };
    const total = Number(meta.episodes) || 0;
    let n = episode === null || episode === undefined || episode === FILM ? null : Number(episode);
    // A film has no number; AniList counts it as episode 1 of a one-episode entry.
    if (n === null && total === 1) n = 1;
    if (!Number.isInteger(n) || n < 1) return { skip: "no-episode-number" };
    if (total && n > total) return { skip: "beyond-episode-count" };
    const last = !!total && n >= total;
    const finishing = phase === "finish" && last;
    if (current) {
      if (current.status === "REPEATING") return { skip: "rewatching" };
      // Never lower progress; the one thing still worth sending is Completed on the last episode.
      if (current.progress >= n && !(finishing && current.status !== "COMPLETED")) return { skip: "already-recorded" };
    }
    return { mediaId: Number(meta.id), progress: n, status: finishing ? "COMPLETED" : "CURRENT" };
  }

  /**
   * Every site's saved mark for one episode, furthest first.
   * `latest` is the site you last watched on (what sync follows); `furthest` is the biggest time.
   */
  function marksOf(episode) {
    const rows = Object.entries((episode && episode.providers) || {})
      .map(([host, p]) => ({ host, time: Math.max(0, Math.floor((p && p.time) || 0)), updatedAt: (p && p.updatedAt) || 0, url: (p && p.url) || "" }))
      .filter((m) => m.time > 0 || m.url);
    if (!rows.length) return [];
    const newest = rows.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a));
    const latestHost = episode.lastHost && rows.some((r) => r.host === episode.lastHost) && newest.updatedAt <= ((episode.providers[episode.lastHost] || {}).updatedAt || 0) ? episode.lastHost : newest.host;
    rows.sort((a, b) => b.time - a.time || b.updatedAt - a.updatedAt);
    const top = rows[0].time;
    return rows.map((r) => Object.assign(r, { latest: r.host === latestHost, furthest: r.time === top && rows.some((o) => o.time < top) }));
  }

  /** A mark on another site that is well ahead of the one sync follows (the latest): worth offering. */
  const ALT_GAP_SEC = 60;
  function altMark(episode) {
    const marks = marksOf(episode);
    const latest = marks.find((m) => m.latest);
    if (!latest) return null;
    const ahead = marks.filter((m) => !m.latest && m.time >= latest.time + ALT_GAP_SEC);
    return ahead.length ? { host: ahead[0].host, time: ahead[0].time } : null;
  }

  const api = {
    VERSION, FILM, emptyDb, seriesKey, epKey, resolveKey, formatTime, parseTime, hostOf,
    parseMedia, parseEpisodeLabel, withSeason, isGenericTitle, cleanSeries, applyOp, mergeDb, dbSignature, findEntry, recent, relTime, anilistPlan, marksOf, altMark,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.KS = api;
})(typeof self !== "undefined" ? self : this);
