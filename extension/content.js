/* Kumostamp content script: runs in every frame, finds the player, reports time. */
(function () {
  "use strict";
  if (window.__kumostamp) return;
  window.__kumostamp = true;

  const isTop = window === window.top;
  const isLibrary = document.documentElement.hasAttribute("data-kumostamp-app");
  if (isLibrary) return;

  const send = (msg) => {
    try { return chrome.runtime.sendMessage(msg).catch(() => null); }
    catch (_) { return Promise.resolve(null); } // extension reloaded: context gone
  };

  /* ---------------- video tracking (any frame) ---------------- */

  let video = null;
  let lastSent = 0;

  function area(v) {
    const r = v.getBoundingClientRect();
    return r.width * r.height;
  }

  function pickVideo() {
    const vids = Array.from(document.querySelectorAll("video"))
      .filter((v) => (v.duration || 0) > 45 && area(v) > 120 * 68);
    if (!vids.length) return null;
    // A playing video beats a bigger paused one (muted previews often autoplay small).
    vids.sort((a, b) => (Number(!b.paused) - Number(!a.paused)) || area(b) - area(a));
    return vids[0];
  }

  function report(force) {
    if (!video) return;
    const now = Date.now();
    if (!force && now - lastSent < 4000) return;
    lastSent = now;
    send({
      type: "video",
      force: !!force,
      video: {
        time: video.currentTime,
        duration: Number.isFinite(video.duration) ? video.duration : 0,
        paused: video.paused,
        ended: video.ended,
        frameUrl: location.href,
      },
    });
  }

  const onTime = () => report(false);
  const onStop = () => report(true);

  // Some sites change episode without leaving the page: the same <video> loads a new source.
  // That is the moment the page text is about to change too, so tell the background (which
  // pauses saving until the new episode is read) and let the top frame look again.
  let hadMedia = false;
  const onMedia = () => { if (video && (video.duration || 0) > 45) hadMedia = true; };
  const onNewMedia = () => {
    if (!hadMedia) return; // first load of this player: nothing stale to guard
    hadMedia = false;
    send({ type: "mediaChanged" });
  };

  function attach(v) {
    if (v === video) return;
    if (video) {
      video.removeEventListener("timeupdate", onTime);
      ["pause", "ended", "seeked"].forEach((e) => video.removeEventListener(e, onStop));
      ["durationchange", "loadedmetadata"].forEach((e) => video.removeEventListener(e, onMedia));
      ["loadstart", "emptied"].forEach((e) => video.removeEventListener(e, onNewMedia));
    }
    video = v;
    hadMedia = false;
    if (!v) return;
    v.addEventListener("timeupdate", onTime);
    ["pause", "ended", "seeked"].forEach((e) => v.addEventListener(e, onStop));
    ["durationchange", "loadedmetadata"].forEach((e) => v.addEventListener(e, onMedia));
    ["loadstart", "emptied"].forEach((e) => v.addEventListener(e, onNewMedia));
    onMedia();
    report(true);
  }

  setInterval(() => {
    const v = pickVideo();
    if (v && v !== video) attach(v);
  }, 2000);

  window.addEventListener("pagehide", () => report(true));
  document.addEventListener("visibilitychange", () => { if (document.hidden) report(true); });

  /* Seek the player. Netflix's player crashes (M7375) when the <video> time is set
     directly, so there the request goes to main-world.js, which uses Netflix's API. */
  const isNetflix = /(^|\.)netflix\.com$/.test(location.hostname);

  // Resume this many seconds before the mark, so the scene picks up with a little context.
  const RESUME_RUNUP_SEC = 3;

  function rawSeek(target) {
    if (!isNetflix) {
      video.currentTime = target;
      return;
    }
    const id = Math.random().toString(36).slice(2);
    let answered = false;
    const onReply = (e) => {
      if (e.source !== window || !e.data || e.data.source !== "kumostamp-seek-result" || e.data.id !== id) return;
      answered = true;
      window.removeEventListener("message", onReply);
      if (!e.data.ok) video.currentTime = target;
    };
    window.addEventListener("message", onReply);
    window.postMessage({ source: "kumostamp-seek", id, time: target }, location.origin);
    setTimeout(() => { if (!answered) { window.removeEventListener("message", onReply); video.currentTime = target; } }, 800);
  }

  /** Resolves once the player has finished moving (or after a short wait if it never says so). */
  function landed() {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => { if (done) return; done = true; video.removeEventListener("seeked", finish); setTimeout(resolve, 150); };
      video.addEventListener("seeked", finish);
      setTimeout(finish, 2500);
    });
  }

  /**
   * Seek to `time` (minus the run-up unless exact). Many streaming players snap a
   * seek forward to the start of the next video segment, landing seconds past the
   * request; when that happens, ask again further back to make up for it.
   */
  async function seekTo(time, exact) {
    if (!video) return;
    const target = Math.max(0, exact ? time : time - RESUME_RUNUP_SEC);
    let ask = target;
    for (let attempt = 0; attempt < 3; attempt++) {
      rawSeek(ask);
      await landed();
      const over = video.currentTime - target;
      console.debug(`[Kumostamp] seek to ${target.toFixed(1)}s, asked ${ask.toFixed(1)}s, landed ${video.currentTime.toFixed(1)}s`);
      if (over <= 1 || ask <= 0) break;
      ask = Math.max(0, ask - over - 0.5); // came out ahead: ask again further back
    }
    if (video.paused) video.play().catch(() => {});
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "seek" && video) {
      seekTo(msg.time, !!msg.exact);
      if (isTop) hideChip();
    }
    if (msg.type === "synced" && isTop) showChip(Object.assign({ synced: true }, msg.info));
  });

  if (!isTop) return;

  /* ---------------- page identity (top frame only) ---------------- */

  let lastSignature = "";

  async function announce() {
    const found = KSDetect.detect();
    // Re-announce when the URL or the answer changes: SPAs swap episodes without reloading,
    // and players like Netflix publish their metadata a few seconds after the URL changes.
    const signature = [location.href, found.series, found.episode, found.kind, found.confidence, found.trace.join(";")].join("|");
    if (signature === lastSignature) return;
    lastSignature = signature;
    const res = await send({
      type: "meta",
      meta: {
        series: found.series, episode: found.episode, kind: found.kind, confidence: found.confidence, source: found.source,
        trace: found.trace, url: location.href, title: document.title,
        ids: found.ids || null,
        // The page's language: translated titles are looked up in it.
        lang: document.documentElement.lang || navigator.language || "",
      },
    });
    if (res && res.resume) showChip(res.resume);
  }

  announce();
  setInterval(announce, 2000);

  // The page text changes when the site swaps episodes in place: look again soon after
  // any DOM change instead of waiting for the next poll.
  let lookTimer = null;
  new MutationObserver(() => {
    if (lookTimer) return;
    lookTimer = setTimeout(() => { lookTimer = null; announce(); }, 800);
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  // A player (possibly in an iframe) loaded new media: re-send what this page says, even if
  // it looks unchanged, and check again as the heading catches up.
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type !== "reannounce") return;
    lastSignature = "";
    announce();
    setTimeout(announce, 700);
    setTimeout(announce, 2000);
  });

  /* ---------------- resume chip ---------------- */

  let chipHost = null;
  let slipHost = null;

  /** The resume chip and the AniList slip share the bottom-left corner: the slip rides above the chip. */
  function stackCards() {
    if (!slipHost) return;
    const gap = chipHost ? Math.ceil(chipHost.getBoundingClientRect().height) + 10 : 0;
    slipHost.style.bottom = `${20 + gap}px`;
  }

  function hideChip() {
    if (!chipHost) return;
    chipHost.remove();
    chipHost = null;
    stackCards();
  }

  function showChip(r) {
    hideChip();
    chipHost = document.createElement("kumostamp-chip");
    chipHost.style.cssText = "all:initial;position:fixed;z-index:2147483647;left:20px;bottom:20px;";
    const root = chipHost.attachShadow({ mode: "closed" });
    const ep = r.episode === null || r.episode === undefined ? "Film" : `Ep ${r.episode}`;
    const elsewhere = r.host && r.host !== KS.hostOf(location.href);
    const total = Math.max(r.duration || 1440, r.time + 60);
    const pos = Math.min(1, r.time / total).toFixed(4);
    const condensed = '"Barlow Condensed", "Arial Narrow", "Roboto Condensed", "Segoe UI", sans-serif';
    root.innerHTML = `
      <style>
        :host { all: initial; }
        .slip {
          font: 13px/1.35 "Barlow", "Segoe UI", system-ui, sans-serif;
          color: #1b1f1d;
          background: #eef1ea;
          border: 1px solid #3d8fa8;
          box-shadow: 0 10px 28px -8px rgba(10,30,30,.45);
          display: grid;
          grid-template-columns: 1fr auto;
          min-width: 300px;
          max-width: 420px;
          animation: in .32s cubic-bezier(.16,1,.3,1);
        }
        @keyframes in { from { transform: translateY(10px); opacity: 0; } }
        @media (prefers-reduced-motion: reduce) { .slip { animation: none; } }
        .body { padding: 10px 12px 12px; min-width: 0; }
        .title { display: flex; gap: 7px; align-items: baseline; font: 700 16px/1.15 ${condensed}; }
        .name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
        .mark { width: 18px; height: 18px; flex: none; align-self: center; }
        .ep { flex: none; font: 700 11px/1 ui-monospace, "Cascadia Mono", Consolas, monospace; border: 1px solid #3d8fa8; padding: 3px 4px; color: #23677d; }
        .where { color: #48514c; font-size: 12px; margin-top: 3px; }
        .time { font-family: ui-monospace, "Cascadia Mono", Consolas, monospace; font-variant-numeric: tabular-nums; color: #b52c20; font-weight: 700; }
        .ruler {
          position: relative; height: 10px; margin-top: 8px; border: 1px solid #3d8fa8;
          background:
            repeating-linear-gradient(to right, #a9cfd9 0 1px, transparent 1px calc(100% / ${Math.max(1, Math.round(total / 60))})) bottom / 100% 5px no-repeat,
            linear-gradient(to right, #f6dcd6 ${pos * 100}%, transparent 0);
        }
        .ruler::after { content: ""; position: absolute; top: -4px; bottom: -4px; left: ${pos * 100}%; width: 3px; margin-left: -1.5px; background: #d23a2c; }
        .actions { display: flex; flex-direction: column; border-left: 1px solid #3d8fa8; }
        button {
          all: unset; cursor: pointer; padding: 0 14px; flex: 1; display: flex; align-items: center;
          font: 600 14px/1 ${condensed}; color: #1b1f1d;
        }
        button.go { background: #d23a2c; color: #fff; }
        button.go:hover { background: #b52c20; }
        button.x { color: #48514c; border-top: 1px solid #3d8fa8; justify-content: center; }
        .alt { margin-top: 9px; padding-top: 7px; border-top: 1px dashed #a9cfd9; display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; font-size: 12px; color: #48514c; }
        button.use { all: unset; cursor: pointer; font: 600 13px/1.2 ${condensed}; color: #23677d; text-decoration: underline; text-underline-offset: 2px; }
        button.use:hover { color: #1b1f1d; }
        button.use:focus-visible { outline: 2px solid #2d5fb8; outline-offset: 2px; }
        button.x:hover { background: #e2e8df; }
        button:focus-visible { outline: 2px solid #2d5fb8; outline-offset: -2px; }
      </style>
      <div class="slip" role="dialog" aria-label="Kumostamp resume">
        <div class="body">
          <div class="title"><svg class="mark" viewBox="-2 0 64 64" aria-hidden="true"><rect x="6" y="6" width="13" height="52" fill="#1b1f1d"/><line x1="19" y1="32" x2="39.7" y2="14.67" stroke="#1b1f1d" stroke-width="10"/><line x1="19" y1="32" x2="39.7" y2="49.33" stroke="#d23a2c" stroke-width="10"/><path d="M42.42 5.99A35 35 0 0 1 42.42 58.01" fill="none" stroke="#1b1f1d" stroke-width="4"/><line x1="47" y1="32" x2="52" y2="32" stroke="#1b1f1d" stroke-width="3"/></svg><span class="name"></span><span class="ep">${ep.toUpperCase()}</span></div>
          <div class="where">${r.synced ? "Synced to" : "Your mark is at"} <span class="time">${KS.formatTime(r.time)}</span>${elsewhere ? ` from ${escapeHtml(r.host)}` : ""}</div>
          <div class="ruler" aria-hidden="true"></div>
          ${r.alt ? `<div class="alt"><span>Also <span class="time">${KS.formatTime(r.alt.time)}</span> on <span class="alt-host"></span></span><button class="use" type="button">Use ${KS.formatTime(r.alt.time)} instead</button></div>` : ""}
        </div>
        <div class="actions">
          <button class="go" type="button">${r.synced ? `Undo · back to ${KS.formatTime(r.from || 0)}` : `Sync to ${KS.formatTime(r.time)}`}</button>
          <button class="x" type="button" aria-label="Dismiss">Dismiss</button>
        </div>
      </div>`;
    root.querySelector(".name").textContent = r.title;
    root.querySelector(".go").addEventListener("click", () => {
      send(r.synced ? { type: "undoSync" } : { type: "sync" });
      hideChip();
    });
    root.querySelector(".x").addEventListener("click", hideChip);
    if (r.alt) {
      root.querySelector(".alt-host").textContent = r.alt.host;
      root.querySelector(".use").addEventListener("click", () => {
        send({ type: "jumpTo", time: r.alt.time });
        hideChip();
      });
    }
    document.documentElement.appendChild(chipHost);
    stackCards();
    setTimeout(hideChip, r.synced ? 12000 : 45000);
  }

  /* ---------------- AniList update slip ---------------- */

  function hideSlip() {
    if (!slipHost) return;
    slipHost.remove();
    slipHost = null;
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "anilistSync") showSlip(msg.info);
  });

  function showSlip(info) {
    hideSlip();
    slipHost = document.createElement("kumostamp-slip");
    slipHost.style.cssText = "all:initial;position:fixed;z-index:2147483647;left:20px;bottom:20px;";
    const root = slipHost.attachShadow({ mode: "closed" });
    const condensed = '"Barlow Condensed", "Arial Narrow", "Roboto Condensed", "Segoe UI", sans-serif';
    root.innerHTML = `
      <style>
        :host { all: initial; }
        .slip {
          font: 13px/1.35 "Barlow", "Segoe UI", system-ui, sans-serif; color: #1b1f1d; background: #eef1ea;
          border: 1px solid #3d8fa8; box-shadow: 0 10px 28px -8px rgba(10,30,30,.45);
          display: grid; grid-template-columns: 1fr auto; min-width: 280px; max-width: 420px;
          animation: in .32s cubic-bezier(.16,1,.3,1);
        }
        @keyframes in { from { transform: translateY(10px); opacity: 0; } }
        @media (prefers-reduced-motion: reduce) { .slip { animation: none; } }
        .body { padding: 10px 12px; min-width: 0; }
        .head { font: 700 11px/1 ui-monospace, "Cascadia Mono", Consolas, monospace; letter-spacing: .04em; color: #23677d; text-transform: uppercase; }
        .line { margin-top: 4px; font: 700 16px/1.15 ${condensed}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .count { font-family: ui-monospace, "Cascadia Mono", Consolas, monospace; color: #b52c20; }
        .err { color: #b52c20; }
        button { all: unset; cursor: pointer; padding: 0 14px; display: flex; align-items: center; border-left: 1px solid #3d8fa8; font: 600 14px/1 ${condensed}; }
        button:hover { background: #e2e8df; }
        button:focus-visible { outline: 2px solid #2d5fb8; outline-offset: -2px; }
      </style>
      <div class="slip" role="status" aria-live="polite">
        <div class="body"><div class="head"></div><div class="line"></div></div>
        <button type="button"></button>
      </div>`;
    const head = root.querySelector(".head");
    const line = root.querySelector(".line");
    const btn = root.querySelector("button");
    if (info.ok) {
      head.textContent = "AniList updated";
      line.textContent = `${info.title} `;
      const c = document.createElement("span");
      c.className = "count";
      c.textContent = info.total ? `${info.progress}/${info.total}` : `Ep ${info.progress}`;
      line.appendChild(c);
      btn.textContent = "Undo";
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        const r = await send({ type: "anilistUndo" });
        head.textContent = r && r.error ? "Undo failed" : "AniList restored";
        if (r && r.error) { line.textContent = r.error; line.classList.add("err"); }
        btn.remove();
        setTimeout(hideSlip, 4000);
      });
    } else {
      head.textContent = "AniList not updated";
      line.classList.add("err");
      line.textContent = info.error || "Something went wrong.";
      btn.textContent = "Dismiss";
      btn.addEventListener("click", hideSlip);
    }
    document.documentElement.appendChild(slipHost);
    stackCards();
    setTimeout(hideSlip, info.ok ? 15000 : 10000);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
})();
