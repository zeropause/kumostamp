/* Kumostamp popup: what is this page playing, correct it, sync to the mark. */
(async function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const send = (msg) => chrome.runtime.sendMessage(msg);

  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = active && active.id;

  let state = await send({ type: "getTab", tabId });
  let refreshTimer = null;

  function el(html) {
    const t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  const SOURCE_LABEL = {
    netflix: "Netflix's player", "netflix-dom": "Netflix's player", primevideo: "Prime Video's player",
    disneyplus: "Disney+'s player", crunchyroll: "Crunchyroll", youtube: "the video title",
    "json-ld": "the page's episode data", "page-heading": "the player's heading", "url-path": "the page address", "media-session": "the player's media info", "page-title": "the page title",
  };

  function epLabel(ep) {
    return ep === null || ep === undefined || ep === "" ? "Film" : `Ep ${ep}`;
  }

  /* ---------------- this page ---------------- */

  function renderNow() {
    const box = $("#now");
    const { tab, identity, entry } = state;
    const video = tab && tab.video;
    box.textContent = "";

    const lib = tab && tab.library;
    if (lib && !lib.trusted) {
      const allow = el(`
        <div class="allow">
          <h2>This is a Kumostamp library</h2>
          <p>It can't see your marks yet. Allow <strong></strong> to show and edit them.</p>
          <button class="btn btn-ink" type="button">Use this page as my library</button>
        </div>`);
      allow.querySelector("strong").textContent = lib.origin;
      allow.querySelector("button").addEventListener("click", async () => {
        const r = await send({ type: "setSettings", settings: { libraryUrl: lib.origin + "/" } });
        state.settings = r.settings;
        renderSettings();
        await refresh(true);
      });
      box.append(allow);
      return;
    }
    if (lib && lib.trusted && !video) {
      box.append(el(`
        <div class="empty">
          <h2>Your library is connected</h2>
          <p>Marks from every site show up on this page as you watch.</p>
        </div>`));
      return;
    }

    if (!video) {
      box.append(el(`
        <div class="empty">
          <h2>No player on this page yet</h2>
          <p>Start an episode. Kumostamp finds the video within a couple of seconds, even inside embedded players.</p>
        </div>`));
      return;
    }

    const series = identity ? identity.series : "";
    const episode = identity && identity.episode !== null && identity.episode !== undefined ? identity.episode : "";
    const dur = video.duration || 0;
    const live = !video.paused && !video.ended;
    const confidence = tab.meta && tab.meta.confidence;

    const node = el(`
      <div>
        <h2 class="section-label">This page</h2>
        <form class="fields" id="identity-form" autocomplete="off">
          <div class="field">
            <label for="f-series">Series</label>
            <input id="f-series" name="series" required placeholder="Series title">
          </div>
          <div class="field">
            <label for="f-ep">Ep</label>
            <input id="f-ep" class="ep" name="episode" inputmode="numeric" placeholder="—">
          </div>
          <button type="submit" hidden></button>
        </form>
        <p class="hint" id="hint"></p>
        <div class="info" id="info"></div>
        <div class="clock">
          <span class="clock-time" id="clock-time">${KS.formatTime(video.time)}</span>
          <span class="clock-of">${dur ? "of " + KS.formatTime(dur) : ""}</span>
          <span class="clock-dur"></span>
        </div>
        <div class="ruler" id="ruler" role="img"></div>
        <p class="save-status" id="save-status"></p>
        <div class="actions" id="actions"></div>
        <details class="trace" id="trace"><summary>How this was detected</summary><ol></ol></details>
        <p class="toast" id="toast" role="status"></p>
      </div>`);
    box.append(node);

    $("#f-series").value = series;
    $("#f-ep").value = episode;

    const hint = $("#hint");
    if (identity && identity.corrected) hint.textContent = "Corrected by you. Kept for this page.";
    else if (!series) { hint.textContent = "Couldn't read a title here. Type it and press Enter; Kumostamp remembers it for this page."; hint.classList.add("guess"); }
    else if (tab.meta && tab.meta.kind === "unknown" && confidence !== "low") { hint.textContent = "Found the series, not the episode number. Type it and press Enter so marks land on the right episode."; hint.classList.add("guess"); }
    else if (confidence === "low") { hint.textContent = "Only a guess, so nothing is saved yet. Fix it if needed and press Enter to start marking."; hint.classList.add("guess"); }
    else if (confidence !== "high") { hint.textContent = "Guessed from the page. Fix it if it's wrong, then press Enter."; hint.classList.add("guess"); }
    else hint.textContent = `Read from ${SOURCE_LABEL[tab.meta.source] || "the page"}.`;

    node.querySelector(".clock-dur").prepend(
      el(`<span class="state ${live ? "live" : ""}">${live ? "Marking" : video.ended ? "Ended" : "Paused"}</span>`)
    );

    const traceList = node.querySelector("#trace ol");
    for (const line of (tab.meta && tab.meta.trace) || ["No page information yet."]) {
      const li = document.createElement("li");
      li.textContent = line;
      traceList.append(li);
    }

    renderSaveStatus(tab.saveStatus);
    renderInfo();

    const ruler = $("#ruler");
    ruler.style.setProperty("--minutes", Math.max(1, Math.round(dur / 60) || 24));
    ruler.style.setProperty("--pos", dur ? Math.min(1, video.time / dur) : 0);
    ruler.setAttribute("aria-label", `At ${KS.formatTime(video.time)}${dur ? " of " + KS.formatTime(dur) : ""}`);

    const actions = $("#actions");
    const saveBtn = el(`<button class="btn" type="button">Mark now</button>`);
    saveBtn.addEventListener("click", async () => {
      await commitIdentity();
      const r = await send({ type: "saveNow", tabId });
      toast(r && r.error ? r.error : `Marked ${KS.formatTime(video.time)}.`);
      refresh();
    });

    if (entry && Math.abs((entry.time || 0) - video.time) > 20) {
      const sync = el(`<button class="btn btn-red" type="button">Sync to <span class="time">${KS.formatTime(entry.time)}</span></button>`);
      sync.title = `Go to your newest mark${entry.lastHost ? " (saved on " + entry.lastHost + ")" : ""}`;
      sync.addEventListener("click", async () => {
        const r = await send({ type: "sync", tabId });
        toast(r && r.error ? r.error : `Synced to ${KS.formatTime(r.time)}${r.host ? ` from ${r.host}` : ""}.`);
      });
      actions.append(sync);
      if (dur) {
        const saved = document.createElement("span");
        saved.className = "saved";
        saved.style.setProperty("--saved", Math.min(1, entry.time / dur));
        ruler.append(saved);
      }
    }
    actions.append(saveBtn);

    $("#identity-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      await commitIdentity(true);
    });
    ["#f-series", "#f-ep"].forEach((s) => $(s).addEventListener("blur", () => commitIdentity()));
  }

  /* Catalog info for what's playing: poster, synopsis, and "Not this one?" when unsure. */
  let altsOpen = null; // the user's own open/closed choice survives the 2-second refresh
  function renderInfo() {
    const box = $("#info");
    if (!box) return;
    box.textContent = "";
    const m = state.seriesMeta;
    if (state.linking) {
      box.append(el(`<p class="info-status">Looking up the synopsis and poster…</p>`));
      return;
    }
    if (!m || !m.source) return;
    const label = { anilist: "AniList", tvmaze: "TVmaze", cinemeta: "IMDb", jikan: "MyAnimeList" }[m.source] || m.source;
    const facts = [m.kind, m.episodes ? `${m.episodes} eps` : null, m.runtime && /movie|film/i.test(m.kind || "") ? `${m.runtime} min` : null, m.year].filter(Boolean).join(" · ");
    const card = el(`
      <div class="info-card">
        <div class="info-text">
          <p class="info-title"></p>
          <p class="info-facts"></p>
          <p class="info-syn"></p>
          <p class="info-src"></p>
        </div>
      </div>`);
    // The poster is only added when the catalog gave one; a failed load removes it.
    if (m.image && /^https:/.test(m.image)) {
      const img = document.createElement("img");
      img.className = "info-poster";
      img.alt = "";
      img.referrerPolicy = "no-referrer";
      img.src = m.image;
      img.addEventListener("error", () => img.remove());
      card.prepend(img);
    }
    card.querySelector(".info-title").textContent = m.title || "";
    card.querySelector(".info-facts").textContent = facts;
    card.querySelector(".info-syn").textContent = m.synopsis || "";
    card.querySelector(".info-src").textContent = `From ${label}${m.confident === false ? " · best guess" : ""}`;
    box.append(card);

    const alts = (m.alternatives || []).filter((a) => a && a.source && a.id != null);
    if (!alts.length) return;
    const open = altsOpen === null ? m.confident === false : altsOpen;
    const wrap = el(`<details class="alts"${open ? " open" : ""}><summary>${m.confident === false ? "Not this one?" : "Wrong match?"}</summary><ul></ul></details>`);
    wrap.addEventListener("toggle", () => { altsOpen = wrap.open; });
    const ul = wrap.querySelector("ul");
    for (const a of alts) {
      const li = el(`<li><button type="button" class="alt"><span class="alt-title"></span><span class="alt-facts"></span></button></li>`);
      li.querySelector(".alt-title").textContent = a.title;
      li.querySelector(".alt-facts").textContent = [a.kind, a.episodes ? `${a.episodes} eps` : null, a.year].filter(Boolean).join(" · ");
      li.querySelector("button").addEventListener("click", async (e) => {
        e.currentTarget.disabled = true;
        const r = await send({ type: "chooseMatch", key: state.seriesKey, source: a.source, id: a.id, image: a.image });
        toast(r && r.error ? r.error : `Switched to ${r.title}.`);
        await refresh(true);
      });
      ul.append(li);
    }
    box.append(wrap);
  }

  function renderSaveStatus(st) {
    const el = $("#save-status");
    if (!el) return;
    el.classList.toggle("is-skipped", !!st && !st.saved);
    el.textContent = !st ? "Not saved yet."
      : st.saved ? `Saved ${KS.formatTime(st.time)} · ${KS.relTime(st.at)}`
      : `Not saving: ${st.reason}`;
  }

  async function commitIdentity(announce) {
    const seriesInput = $("#f-series");
    if (!seriesInput) return;
    const series = seriesInput.value.trim();
    const epRaw = $("#f-ep").value.trim();
    const episode = epRaw === "" ? null : Number(epRaw);
    if (!series || (epRaw !== "" && !Number.isFinite(episode))) {
      if (announce) toast("Series needs a title, episode needs a number (or leave it empty for a film).");
      return;
    }
    const cur = state.identity || {};
    const unconfirmed = !cur.corrected && ((cur.confidence !== "high" && cur.confidence !== "medium") || cur.kind === "unknown");
    // Enter on an unchanged low-confidence guess confirms it.
    if (cur.series === series && String(cur.episode ?? "") === epRaw && !(announce && unconfirmed)) return;
    await send({ type: "correct", tabId, series, episode });
    if (announce) toast(`Filed under ${series} · ${epLabel(episode)}.`);
    await refresh(true);
  }

  function toast(text) {
    const t = $("#toast");
    if (t) t.textContent = text;
  }

  /* ---------------- recent ---------------- */

  function renderRecent() {
    const list = $("#recent");
    list.textContent = "";
    if (!state.recent || !state.recent.length) {
      list.append(el(`<li class="recent-empty">Nothing marked yet. Play anything and your stop points land here.</li>`));
      return;
    }
    for (const r of state.recent) {
      const done = r.duration && r.time >= r.duration - 90;
      const li = el(`
        <li><button class="recent-row" type="button">
          <span class="recent-ep">${r.episode === null || r.episode === undefined ? "FILM" : "EP " + r.episode}</span>
          <span class="recent-title"></span>
          <span class="recent-time ${done ? "done" : ""}">${done ? "done" : KS.formatTime(r.time)}</span>
        </button></li>`);
      const title = li.querySelector(".recent-title");
      title.textContent = r.title;
      const host = document.createElement("span");
      host.className = "recent-host";
      host.textContent = [r.host, KS.relTime(r.updatedAt)].filter(Boolean).join(" · ");
      title.append(host);
      const btn = li.querySelector("button");
      if (r.url) btn.addEventListener("click", () => chrome.tabs.create({ url: r.url }));
      else btn.disabled = true;
      list.append(li);
    }
  }

  /* ---------------- saved marks: every site's mark for this episode ---------------- */

  let marksShown = "";

  function renderMarks() {
    const box = $("#marks");
    const entry = state.entry;
    const here = KS.hostOf((state.tab && state.tab.meta && state.tab.meta.url) || "");
    const marks = KS.marksOf(entry);
    // Nothing to choose between when the only mark is the one on this site.
    if (!marks.length || (marks.length === 1 && marks[0].host === here)) {
      box.hidden = true;
      marksShown = "";
      return;
    }
    const canJump = !!(state.tab && state.tab.video);
    const sig = JSON.stringify([marks, here, canJump, state.seriesTitle]);
    if (sig === marksShown) return; // unchanged: keep the buttons stable under the cursor
    marksShown = sig;
    box.hidden = false;
    const id = state.identity;
    $("#marks-for").textContent = state.seriesTitle ? `· ${state.seriesTitle}${entry && entry.episode != null ? " · Ep " + entry.episode : ""}` : "";
    const list = $("#marks-list");
    list.textContent = "";
    for (const m of marks) {
      const li = el(`
        <li class="mark-row">
          <span class="mark-main"><span class="mark-host"></span><span class="mark-meta"></span></span>
          <span class="mark-time"></span>
          <span class="mark-actions"></span>
        </li>`);
      li.querySelector(".mark-host").textContent = m.host === here ? `${m.host} (this site)` : m.host;
      const meta = li.querySelector(".mark-meta");
      if (m.latest) meta.append(el(`<span class="mark-tag">Latest</span>`));
      if (m.furthest) meta.append(el(`<span class="mark-tag is-furthest">Furthest</span>`));
      meta.append(document.createTextNode(KS.relTime(m.updatedAt)));
      li.querySelector(".mark-time").textContent = KS.formatTime(m.time);
      const actions = li.querySelector(".mark-actions");
      if (canJump && id && id.series) {
        const jump = el(`<button class="btn btn-quiet" type="button">Jump</button>`);
        jump.title = `Go to ${KS.formatTime(m.time)} in this tab`;
        jump.addEventListener("click", async () => {
          jump.disabled = true;
          const r = await send({ type: "jumpTo", tabId, time: m.time });
          if (r && r.error) jump.title = r.error;
          await refresh(true);
        });
        actions.append(jump);
      }
      if (m.host !== here && m.url) {
        const open = el(`<button class="btn btn-quiet" type="button">Open</button>`);
        open.title = `Open this episode on ${m.host}`;
        open.addEventListener("click", () => chrome.tabs.create({ url: m.url }));
        actions.append(open);
      }
      list.append(li);
    }
  }

  /* ---------------- settings ---------------- */

  function renderSettings() {
    const s = state.settings;
    $("#autosave").checked = !!s.autoSave;
    $("#autoresume").checked = !!s.autoResume;
    $("#library-url").value = s.libraryUrl;
    $("#open-library").href = s.libraryUrl;
  }

  $("#autosave").addEventListener("change", (e) => send({ type: "setSettings", settings: { autoSave: e.target.checked } }));
  $("#autoresume").addEventListener("change", (e) => send({ type: "setSettings", settings: { autoResume: e.target.checked } }));
  $("#settings-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const r = await send({ type: "setSettings", settings: { libraryUrl: $("#library-url").value.trim() } });
    state.settings = r.settings;
    renderSettings();
  });
  $("#open-library").addEventListener("click", (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: state.settings.libraryUrl });
  });

  /* ---------------- live refresh ---------------- */

  async function refresh(full) {
    state = await send({ type: "getTab", tabId });
    const editing = document.activeElement && document.activeElement.closest && document.activeElement.closest("#identity-form");
    if (full || !editing) renderNow();
    else if (state.tab && state.tab.video) {
      // Only tick the clock while the user is typing.
      const v = state.tab.video;
      $("#clock-time").textContent = KS.formatTime(v.time);
      if (v.duration) $("#ruler").style.setProperty("--pos", Math.min(1, v.time / v.duration));
      renderSaveStatus(state.tab.saveStatus);
      renderInfo();
    }
    renderRecent();
    renderMarks();
  }

  /* ---------------- connected accounts ---------------- */

  let accounts = null;

  function renderAccounts() {
    if (!accounts) return;
    const a = accounts.anilist;
    const hasId = accounts.hasClientId;
    $("#anilist-state").textContent = a ? `Connected as ${a.user.name}` : accounts.anilistExpired ? "Login expired" : hasId ? "Not connected" : "Needs a client ID";
    const action = $("#anilist-action");
    action.textContent = a ? "Disconnect" : accounts.anilistExpired ? "Reconnect" : "Connect";
    action.disabled = !a && !hasId;
    // The client ID form and registration hint show until the account is connected.
    $("#anilist-setup").hidden = !!a;
    $("#anilist-hint").hidden = !!a;
    $("#anilist-redirect").textContent = accounts.redirectUrl;
    if (!$("#anilist-client").value) $("#anilist-client").value = state.settings.anilistClientId || "";
    $("#anilist-sync-row").hidden = !a;
    $("#anilist-sync").checked = !!state.settings.anilistSync;
    renderLastPush();
  }

  async function renderLastPush() {
    const row = $("#anilist-last-row");
    const last = accounts && accounts.anilist ? (await send({ type: "anilistLast" })).last : null;
    row.hidden = !last;
    if (!last) return;
    $("#anilist-last").textContent = `Last: ${last.title} ${last.total ? `${last.progress}/${last.total}` : `Ep ${last.progress}`} · ${KS.relTime(last.at)}`;
  }

  $("#anilist-sync").addEventListener("change", async (e) => {
    const r = await send({ type: "setSettings", settings: { anilistSync: e.target.checked } });
    state.settings = r.settings;
  });

  $("#anilist-undo").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    accountError("");
    const r = await send({ type: "anilistUndo" });
    btn.disabled = false;
    if (r.error) accountError(r.error);
    renderLastPush();
  });

  function accountError(text) {
    const p = $("#anilist-error");
    p.textContent = text || "";
    p.hidden = !text;
  }

  async function loadAccounts() {
    accounts = (await send({ type: "accountStatus" })).accounts;
    renderAccounts();
  }

  $("#anilist-action").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    accountError("");
    btn.disabled = true;
    try {
      const r = accounts.anilist
        ? await send({ type: "accountDisconnect" })
        : await send({ type: "accountConnect", provider: "anilist" });
      if (r.error) accountError(r.error);
      else {
        accounts = r.accounts;
        if (r.settings) state.settings = r.settings;
      }
    } finally {
      btn.disabled = false;
      renderAccounts();
    }
  });

  $("#anilist-setup").addEventListener("submit", async (e) => {
    e.preventDefault();
    accountError("");
    const id = $("#anilist-client").value.trim();
    if (id && !/^\d+$/.test(id)) return accountError("The client ID is a number, like 12345.");
    const r = await send({ type: "setSettings", settings: { anilistClientId: id } });
    state.settings = r.settings;
    await loadAccounts();
  });

  renderNow();
  renderRecent();
  renderMarks();
  renderSettings();
  loadAccounts();
  refreshTimer = setInterval(refresh, 2000);
  window.addEventListener("unload", () => clearInterval(refreshTimer));
})();
