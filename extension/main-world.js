/*
 * Runs in the page's own JS world (manifest "world": "MAIN") so it can read
 * player state that sites keep in JavaScript, not in the DOM. It only reads,
 * and hands what it finds to the isolated content script through a data
 * attribute on <html>.
 */
(function () {
  "use strict";
  if (window.top !== window || window.__kumostampMain) return;
  window.__kumostampMain = true;

  const ATTR = "data-kumostamp-media";

  /* ---------------- Netflix ---------------- */

  // Netflix keeps show → seasons → episodes in a metadata document. The watch
  // id in the URL is the episode's id; find it and report its season/episode seq.
  function fromNetflixVideo(video, id) {
    if (!video || !video.title) return null;
    const showId = video.id != null ? String(video.id) : null; // same in every language
    if (video.type === "movie") return { series: video.title, episode: null, source: "netflix", showId };
    const want = String(id);
    const current = String(video.currentEpisode || "");
    let fallback = null;
    for (const season of video.seasons || []) {
      for (const ep of season.episodes || []) {
        const epId = String(ep.id || ep.episodeId || "");
        const hit = { series: video.title, season: season.seq, episode: ep.seq, episodeTitle: ep.title || "", source: "netflix", showId };
        if (epId === want) return hit;
        if (epId === current) fallback = hit;
      }
    }
    return fallback || { series: video.title, episode: null, source: "netflix", partial: true, showId };
  }

  function netflixState(id) {
    const app = window.netflix && window.netflix.appContext && window.netflix.appContext.state && window.netflix.appContext.state.playerApp;
    const state = app && typeof app.getState === "function" ? app.getState() : null;
    const all = state && state.videoPlayer && state.videoPlayer.videoMetadata;
    if (!all) return null;
    const entry = all[id] || Object.values(all).find((v) => v && v._metadata);
    const video = entry && entry._metadata && entry._metadata.video;
    return video ? fromNetflixVideo(video, id) : null;
  }

  const netflixCache = new Map(); // watch id → result | "pending" | "failed"

  async function netflixFetch(id) {
    netflixCache.set(id, "pending");
    const build = window.netflix && window.netflix.reactContext && window.netflix.reactContext.models &&
      window.netflix.reactContext.models.serverDefs && window.netflix.reactContext.models.serverDefs.data &&
      window.netflix.reactContext.models.serverDefs.data.BUILD_IDENTIFIER;
    const urls = [`/nq/website/memberapi/release/metadata?movieid=${id}`];
    if (build) urls.push(`/nq/website/memberapi/${build}/metadata?movieid=${id}`, `/api/shakti/${build}/metadata?movieid=${id}`);
    for (const url of urls) {
      try {
        const res = await fetch(url, { credentials: "include" });
        if (!res.ok) continue;
        const json = await res.json();
        const found = fromNetflixVideo(json && json.video, id);
        if (found) { netflixCache.set(id, found); return; }
      } catch (_) { /* try the next endpoint */ }
    }
    netflixCache.set(id, "failed");
  }

  function netflix() {
    const id = (location.pathname.match(/\/watch\/(\d+)/) || [])[1];
    if (!id) return null;
    const fromState = netflixState(id);
    if (fromState && !fromState.partial) return fromState;
    const cached = netflixCache.get(id);
    if (cached === undefined) netflixFetch(id);
    if (cached && typeof cached === "object") return cached;
    if (fromState) return fromState;
    return { status: cached === "failed" ? "netflix: metadata not readable" : "netflix: reading metadata…" };
  }

  const READERS = [[/(^|\.)netflix\.com$/, netflix]];

  function tick() {
    const reader = READERS.find(([re]) => re.test(location.hostname));
    if (!reader) return;
    let found = null;
    try { found = reader[1](); } catch (err) { found = { status: `error: ${err && err.message}` }; }
    if (!found) return;
    const html = document.documentElement;
    const next = JSON.stringify(Object.assign(found, { url: location.href }));
    if (html.getAttribute(ATTR) !== next) html.setAttribute(ATTR, next);
  }

  setInterval(tick, 1500);
  tick();

  // Seek requests from the content script (Netflix rejects direct <video> seeks).
  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || e.data.source !== "kumostamp-seek") return;
    let ok = false;
    try {
      const vp = window.netflix.appContext.state.playerApp.getAPI().videoPlayer;
      const ids = vp.getAllPlayerSessionIds();
      const player = vp.getVideoPlayerBySessionId(ids[ids.length - 1]);
      player.seek(Math.round(e.data.time * 1000));
      if (player.isPaused && player.isPaused()) player.play();
      ok = true;
    } catch (_) { ok = false; }
    window.postMessage({ source: "kumostamp-seek-result", id: e.data.id, ok }, location.origin);
  });
})();
