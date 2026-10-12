/*
 * Kumostamp detection: works out which series and episode the page is playing.
 * Readers run from most to least trustworthy; the first confident answer wins.
 *   1. page-world player state (main-world.js, e.g. Netflix)
 *   2. per-site player DOM (Prime Video, Disney+, Crunchyroll, YouTube, Netflix overlay)
 *   3. schema.org JSON-LD (TVEpisode / Movie)
 *   4. Media Session metadata the player published for the OS media controls
 *   5. episode in the URL query (?season=1&episode=3) and /movie/ paths
 *   6. page title / og:title / h1 / URL heuristics (KS.parseMedia)
 */
(function () {
  "use strict";
  if (window.KSDetect) return;

  const text = (sel, root) => {
    const el = (root || document).querySelector(sel);
    return el ? el.textContent.replace(/\s+/g, " ").trim() : "";
  };

  /*
   * Every answer carries a kind:
   *   "episode"  the episode number was read
   *   "film"     a source explicitly said this is a movie (Netflix type, JSON-LD Movie)
   *   "unknown"  the series was found but no episode number; never auto-saved
   */
  function result(series, label, source, confidence, film) {
    series = KS.cleanSeries(series || "", "");
    if (KS.isGenericTitle(series)) return null;
    const ep = typeof label === "object" && label !== null ? label : KS.parseEpisodeLabel(label);
    return {
      series: KS.withSeason(series, ep && ep.season),
      episode: ep ? ep.episode : null,
      kind: ep ? "episode" : film ? "film" : "unknown",
      confidence: confidence || (ep ? "high" : "medium"),
      source,
    };
  }

  /* ---------- 1. page-world state ---------- */

  let lastMain = null; // controls hide, state persists: keep the last good answer for this URL
  function fromMainWorld() {
    const raw = document.documentElement.getAttribute("data-kumostamp-media");
    if (!raw) return null;
    try {
      const d = JSON.parse(raw);
      if (d.url !== location.href) return lastMain && lastMain.url === location.href ? lastMain.r : null;
      if (!d.series) return { series: "", episode: null, confidence: "none", source: "page-world", note: d.status || "" };
      // No episode and not partial means the player itself said "movie".
      const r = result(d.series, d.episode == null ? null : { season: d.season, episode: d.episode }, d.source, d.partial ? "medium" : "high", d.episode == null && !d.partial);
      if (r && d.showId) r.ids = { netflix: d.showId };
      lastMain = { url: location.href, r };
      return r;
    } catch (_) { return null; }
  }

  /* ---------- 2. site DOM readers ---------- */

  const SITES = [
    {
      host: /(^|\.)netflix\.com$/,
      read() {
        // Player overlay (visible while controls show): <h4>Show</h4><span>S1:E2</span><span>Title</span>
        const box = document.querySelector('[data-uia="video-title"]');
        if (!box) return null;
        const series = text("h4", box) || (box.firstElementChild ? box.firstElementChild.textContent.trim() : "");
        const label = Array.from(box.querySelectorAll("span")).map((s) => s.textContent).join(" ");
        return result(series, label, "netflix-dom");
      },
    },
    {
      host: /(^|\.)(primevideo|amazon)\.[a-z.]+$/,
      read() {
        const series = text(".atvwebplayersdk-title-text");
        if (!series) return null;
        return result(series, text(".atvwebplayersdk-subtitle-text"), "primevideo");
      },
    },
    {
      host: /(^|\.)(disneyplus|hotstar)\.com$/,
      read() {
        const series = text(".title-field, [data-testid='title-field'], .title-bug-container .title");
        if (!series) return null;
        return result(series, text(".subtitle-field, [data-testid='subtitle-field']"), "disneyplus");
      },
    },
    {
      host: /(^|\.)crunchyroll\.com$/,
      read() {
        const series = text("[data-t='show-title-link'], .show-title-link, a.show-title-link h4");
        const ep = text("h1.title, [data-t='episode-title'], .erc-current-media-info h1");
        if (!series) return null;
        return result(series, ep, "crunchyroll");
      },
    },
    {
      host: /(^|\.)youtube\.com$/,
      read() {
        if (!/^\/watch/.test(location.pathname)) return null;
        const t = text("h1.ytd-watch-metadata, #title h1") || document.title.replace(/\s*-\s*YouTube\s*$/, "");
        if (!t) return null;
        const parsed = KS.parseMedia({ title: t, url: location.href });
        return parsed.series && parsed.episode != null ? Object.assign(parsed, { source: "youtube", kind: "episode" }) : null;
      },
    },
  ];

  /** IDs some sites put in their URLs that also exist in Wikidata (identity across languages). */
  function urlIds() {
    const p = location.pathname;
    if (/(^|\.)(movy\.sx|7movies\.[a-z]+)$/.test(location.hostname)) {
      const tv = p.match(/^\/tv\/(\d+)/);
      const movie = p.match(/^\/movie\/(\d+)/);
      if (tv) return { tmdbTv: tv[1] };
      if (movie) return { tmdbMovie: movie[1] };
    }
    return null;
  }

  function fromSite() {
    const site = SITES.find((s) => s.host.test(location.hostname));
    if (!site) return null;
    try { return site.read(); } catch (_) { return null; }
  }

  /* ---------- 3. JSON-LD ---------- */

  function fromJsonLd() {
    for (const node of document.querySelectorAll('script[type="application/ld+json"]')) {
      let data;
      try { data = JSON.parse(node.textContent); } catch (_) { continue; }
      const items = [].concat(data["@graph"] || data);
      for (const it of items) {
        const type = [].concat(it && it["@type"] || []);
        if (type.includes("TVEpisode") || type.includes("Episode")) {
          const series = (it.partOfSeries && it.partOfSeries.name) || "";
          const season = it.partOfSeason && Number(it.partOfSeason.seasonNumber);
          const ep = Number(it.episodeNumber);
          if (series && ep) return result(series, { season: season || null, episode: ep }, "json-ld", "high");
        }
        if (type.includes("Movie") && it.name) return result(it.name, null, "json-ld", "high", true);
      }
    }
    return null;
  }

  /* ---------- 3b. Player heading: <h1>Show</h1><p>S2 E3 · 53m</p> ---------- */

  // Many players print the show as a heading and the episode in a short line right
  // under it ("E3 · 23m", "S2 E3 Title · 53m", "Tập 3"). Read that pair.
  function fromHeading() {
    for (const h of document.querySelectorAll("h1, h2")) {
      const series = h.textContent.replace(/\s+/g, " ").trim();
      if (!series || series.length > 120 || KS.isGenericTitle(series)) continue;
      const near = [h.nextElementSibling, h.previousElementSibling].concat(Array.from((h.parentElement && h.parentElement.children) || []));
      for (const el of near) {
        if (!el || el === h) continue;
        const label = el.textContent.replace(/\s+/g, " ").trim();
        if (!label || label.length > 90) continue; // a short caption, not a synopsis
        const ep = KS.parseEpisodeLabel(label);
        if (ep && !KS.parseEpisodeLabel(series)) {
          const r = result(series, ep, "page-heading", "high");
          if (r) return r;
        }
      }
    }
    return null;
  }

  /* ---------- 3c. Numbers at the end of the URL path ---------- */

  // "/anime/dandadan-lzcmw/3" is episode 3; "/tv/1399/2/3" is season 2, episode 3.
  // The series name comes from the page heading or title. Paths that end in a
  // film or title ID ("/movie/550", "/title/123") are not episodes.
  // A lone number after one of these is an ID ("/tv/1399", "/movie/550"), not an episode.
  const NOT_EPISODE_PARENT = /^(tv|tvshow|tv-show|tv-series|show|shows|series|serie|anime|drama|dramas|kdrama|donghua|cartoon|movie|movies|film|films|title|titles|video|videos|v|watch|embed|play|player|id|post|p|news|user|u|profile|search|page|category|genre|season|seasons|s)$/i;

  function fromUrlPath() {
    const segs = location.pathname.split("/").filter(Boolean);
    const nums = [];
    while (segs.length && /^\d{1,4}$/.test(segs[segs.length - 1])) nums.unshift(Number(segs.pop()));
    if (!nums.length || !segs.length) return null;
    const parent = segs[segs.length - 1];
    let season = null;
    let episode = null;
    if (nums.length >= 2) {
      [season, episode] = nums.slice(-2); // "/tv/1399/2/3": id, season, episode
      if (season > 50) return null;
    } else {
      // Only after a title slug: "/anime/dandadan-lzcmw/3", not "/tv/1399" or "/movie/550".
      if (NOT_EPISODE_PARENT.test(parent) || !/[a-z]/i.test(parent) || parent.length < 3) return null;
      episode = nums[0];
    }
    if (!episode || episode > 3000) return null;
    const h1 = document.querySelector("h1");
    const og = document.querySelector('meta[property="og:title"]');
    const base = KS.parseMedia({ title: document.title, ogTitle: og ? og.getAttribute("content") : "", h1: h1 ? h1.textContent.trim().slice(0, 200) : "", url: location.href });
    const series = (h1 && h1.textContent.trim()) || base.series;
    if (!series || base.episode != null) return null; // the page text already says (or contradicts) it
    return result(series, { season, episode }, "url-path", "medium");
  }

  /* ---------- 3d. Episode in the query string, film in the path ---------- */

  // "/tv/1399/watch?season=1&episode=3", "/play?s=2&ep=5", "?episode_number=7".
  const EP_PARAM = /^(?:episode|episode_?(?:no|num|number)|ep|eps|ep_?(?:no|num|number)|e)$/i;
  const SEASON_PARAM = /^(?:season|season_?(?:no|num|number)|s|sea)$/i;

  /** The show or film name the page prints: its heading, else the title minus the site name. */
  function pageName() {
    const h1 = document.querySelector("h1");
    const heading = h1 ? h1.textContent.replace(/\s+/g, " ").trim() : "";
    if (heading && heading.length <= 120 && !KS.isGenericTitle(heading) && !KS.parseEpisodeLabel(heading)) return heading;
    const first = (document.title || "").split(/\s[|»\-–—]\s/).map((p) => p.trim()).find((p) => p && !KS.isGenericTitle(KS.cleanSeries(p, KS.hostOf(location.href))));
    return first || "";
  }

  function fromUrlQuery() {
    let episode = null;
    let season = null;
    for (const [k, v] of new URLSearchParams(location.search)) {
      if (!/^\d{1,4}$/.test(v)) continue;
      if (episode === null && EP_PARAM.test(k)) episode = Number(v);
      else if (season === null && SEASON_PARAM.test(k)) season = Number(v);
    }
    if (!episode || episode > 3000 || (season !== null && season > 50)) return null;
    const name = pageName();
    return name ? result(name, { season, episode }, "url-query", "medium") : null;
  }

  // "/movie/1083381/watch", "/film/inception": the path itself says this is a film.
  function fromUrlFilm() {
    if (location.search && fromUrlQuery()) return null;
    if (!/^\/(?:movie|movies|film|films)\/[^/]+(?:\/(?:watch|play|stream))?\/?$/i.test(location.pathname)) return null;
    const name = pageName();
    return name ? result(name, null, "url-film", "medium", true) : null;
  }

  /* ---------- 4. Media Session ---------- */

  function fromMediaSession() {
    const md = navigator.mediaSession && navigator.mediaSession.metadata;
    if (!md || !md.title) return null;
    // Players usually put the show in `artist` or `album` and the episode in `title`.
    const label = KS.parseEpisodeLabel(md.title) || KS.parseEpisodeLabel(md.album) || KS.parseEpisodeLabel(md.artist);
    const series = [md.album, md.artist].find((s) => s && !KS.isGenericTitle(s) && !KS.parseEpisodeLabel(s));
    if (series && label) return result(series, label, "media-session", "high");
    const parsed = KS.parseMedia({ title: md.title, url: location.href });
    if (parsed.series && parsed.episode != null) return Object.assign(parsed, { source: "media-session", kind: "episode" });
    return null;
  }

  /* ---------- 5. page text ---------- */

  function fromPage() {
    const og = document.querySelector('meta[property="og:title"], meta[name="twitter:title"]');
    const h1 = document.querySelector("h1");
    const parsed = KS.parseMedia({
      title: document.title,
      ogTitle: og ? og.getAttribute("content") : "",
      h1: h1 ? h1.textContent.trim().slice(0, 200) : "",
      url: location.href,
    });
    return Object.assign(parsed, { source: "page-title", kind: parsed.episode != null ? "episode" : parsed.film ? "film" : "unknown" });
  }

  const RANK = { high: 3, medium: 2, low: 1, none: 0 };

  const READERS = [
    ["page-world", fromMainWorld], ["site", fromSite], ["json-ld", fromJsonLd],
    ["page-heading", fromHeading], ["media-session", fromMediaSession], ["url-path", fromUrlPath],
    ["url-query", fromUrlQuery], ["url-film", fromUrlFilm], ["page-title", fromPage],
  ];

  // Overlays come and go with the player controls: once a URL has a confident
  // answer, keep it until the URL changes or a different confident answer appears.
  // Sites that swap episodes in place keep the URL, so the answer is also tied to what
  // the page printed when it was read (title and heading): when those change, it is stale.
  let sticky = null;

  function pageFingerprint() {
    const h1 = document.querySelector("h1");
    return `${location.href}|${document.title}|${h1 ? h1.textContent.replace(/\s+/g, " ").trim().slice(0, 120) : ""}`;
  }

  function detect() {
    let best = null;
    const trace = [];
    for (const [name, reader] of READERS) {
      let r = null;
      try { r = reader(); } catch (err) { r = { series: "", note: `error: ${err && err.message}` }; }
      trace.push(r && r.series
        ? `${name}: ${r.series}${r.episode != null ? " · ep " + r.episode : r.kind === "film" ? " · film" : " · ep ?"} (${r.confidence})`
        : `${name}: ${(r && r.note) || "nothing"}`);
      if (!r || !r.series) continue;
      // Prefer answers that know the episode (or know it's a film) over equally confident unknowns.
      const better = !best || RANK[r.confidence] > RANK[best.confidence] || (RANK[r.confidence] === RANK[best.confidence] && best.kind === "unknown" && r.kind !== "unknown");
      if (better) best = r;
      if (r.confidence === "high" && r.kind !== "unknown") break;
    }
    if (best && best.confidence === "high" && best.kind !== "unknown") sticky = { url: location.href, print: pageFingerprint(), r: best };
    else if (sticky && sticky.url === location.href && sticky.print === pageFingerprint()) best = sticky.r;
    const out = Object.assign({}, best || { series: "", episode: null, confidence: "none", source: "none" });
    const ids = urlIds();
    if (ids) out.ids = Object.assign({}, out.ids, ids);
    out.trace = trace;
    return out;
  }

  window.KSDetect = { detect };
})();
