/*
 * Kumostamp catalog — shared by the extension (background worker) and the website.
 * Keep this file identical in extension/lib and web/src/lib (run
 * `node scripts/sync-shared.mjs` after editing).
 *
 * Sources: AniList (anime), TVmaze (TV series), Cinemeta (IMDb data, movies).
 * All free, keyless, CORS-enabled. Results are normalised into one `meta` shape.
 *
 * match(signals) answers "what is this page playing?" without guessing the type
 * first: every relevant catalog is searched at once and candidates compete on
 * title similarity plus signals the extension already has (film or episode,
 * episode number, video duration, the streaming site).
 */
(function (root) {
  "use strict";

  const ANILIST = "https://graphql.anilist.co";
  const TVMAZE = "https://api.tvmaze.com";
  const CINEMETA = "https://v3-cinemeta.strem.io";
  const TIMEOUT_MS = 12000;

  const LABEL = { anilist: "AniList", jikan: "MyAnimeList", tvmaze: "TVmaze", cinemeta: "IMDb" };
  const RETIRED = ["jikan"]; // sheets linked to these are re-linked automatically

  /* ---------------- transport ---------------- */

  async function get(url, init, name) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, Object.assign({ signal: ctrl.signal }, init || {}));
      if (res.status === 429) throw new Error(`${name} is rate-limiting requests. Try again in a few seconds.`);
      if (!res.ok) throw new Error(`${name} answered with an error (${res.status}).`);
      return await res.json();
    } catch (err) {
      if (err && (err.name === "AbortError" || err instanceof TypeError)) {
        throw new Error(`${name} didn't answer. It may be down or blocked on this network; try another source.`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async function anilist(query, variables) {
    const json = await get(ANILIST, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query, variables }),
    }, "AniList");
    if (json.errors && json.errors.length) throw new Error(`AniList: ${json.errors[0].message}`);
    return json.data;
  }

  // Works without a DOM (the extension's service worker has no DOMParser).
  function stripHtml(html) {
    return String(html || "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#0?39;|&apos;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&mdash;/g, "—")
      .replace(/&ndash;/g, "–")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  /* ---------------- AniList ---------------- */

  const ANILIST_FIELDS = `id siteUrl title { romaji english native } coverImage { large extraLarge }
    description(asHtml: false) episodes duration seasonYear status format averageScore genres synonyms`;

  const ANILIST_STATUS = {
    FINISHED: "Finished Airing", RELEASING: "Currently Airing", NOT_YET_RELEASED: "Not yet aired", CANCELLED: "Cancelled", HIATUS: "On hiatus",
  };

  function fromAnilist(m) {
    const english = m.title.english || "";
    return {
      source: "anilist",
      id: m.id,
      title: english || m.title.romaji,
      altTitle: english && m.title.romaji !== english ? m.title.romaji : m.title.native || "",
      image: (m.coverImage && (m.coverImage.extraLarge || m.coverImage.large)) || "",
      synopsis: stripHtml(m.description),
      episodes: m.episodes || null,
      runtime: m.duration || null,
      year: m.seasonYear || null,
      status: ANILIST_STATUS[m.status] || m.status || "",
      kind: m.format ? m.format.replace(/_/g, " ") : "",
      score: m.averageScore ? m.averageScore / 10 : null,
      genres: m.genres || [],
      synonyms: [m.title.romaji, m.title.english, m.title.native].concat(m.synonyms || []).filter(Boolean),
      url: m.siteUrl || `https://anilist.co/anime/${m.id}`,
    };
  }

  /* ---------------- TVmaze ---------------- */

  function fromTvmaze(s, episodes) {
    return {
      source: "tvmaze",
      id: s.id,
      title: s.name,
      altTitle: (s.network && s.network.name) || (s.webChannel && s.webChannel.name) || "",
      image: (s.image && (s.image.original || s.image.medium)) || "",
      synopsis: stripHtml(s.summary),
      episodes: episodes ? episodes.length : null,
      runtime: s.averageRuntime || s.runtime || null,
      year: s.premiered ? Number(s.premiered.slice(0, 4)) : null,
      status: s.status || "",
      kind: s.type || "",
      score: s.rating && s.rating.average ? s.rating.average : null,
      genres: s.genres || [],
      synonyms: [],
      url: s.url || `https://www.tvmaze.com/shows/${s.id}`,
    };
  }

  async function tvmazeSeasonCount(id, season) {
    const all = await get(`${TVMAZE}/shows/${id}/episodes`, null, "TVmaze");
    return all.filter((e) => e.season === (season || 1) && e.number != null).length || null;
  }

  /* ---------------- Cinemeta (movies) ---------------- */

  /** IMDb's own poster (Amazon CDN) at 600px when given; else metahub's small poster (its medium size stalls). */
  function cinemetaPoster(poster, id) {
    if (poster && /media-amazon\.com/.test(poster)) return poster.replace(/\._V1_[^/]*(\.\w+)$/, "._V1_SX600$1");
    return `https://images.metahub.space/poster/small/${id}/img`;
  }

  function fromCinemeta(m) {
    const id = m.imdb_id || m.id;
    const year = Number(String(m.releaseInfo || m.year || "").slice(0, 4)) || null;
    const released = m.released ? new Date(m.released) : null;
    const facts = [m.director && m.director.length ? `Directed by ${m.director.join(", ")}` : "", m.country || ""].filter(Boolean).join(" · ");
    return {
      source: "cinemeta",
      id,
      title: m.name,
      altTitle: facts,
      image: cinemetaPoster(m.poster, id),
      synopsis: m.description || "",
      episodes: null,
      runtime: m.runtime ? parseInt(m.runtime, 10) || null : null,
      year,
      status: released && released > new Date() ? `Releases ${released.toLocaleDateString()}` : "Released",
      kind: "Movie",
      score: m.imdbRating ? Number(m.imdbRating) : null,
      genres: m.genres || m.genre || [],
      synonyms: [],
      url: `https://www.imdb.com/title/${id}/`,
    };
  }

  /* ---------------- search / details ---------------- */

  function retired(source) {
    return new Error(`${LABEL[source] || source} is no longer available. Link this sheet again from AniList, TVmaze or IMDb.`);
  }

  async function search(source, query) {
    const q = String(query || "").trim();
    if (!q) return [];
    if (RETIRED.includes(source)) throw retired(source);
    if (source === "anilist") {
      const data = await anilist(
        `query ($q: String) { Page(perPage: 12) { media(search: $q, type: ANIME, sort: SEARCH_MATCH) { ${ANILIST_FIELDS} } } }`,
        { q },
      );
      return data.Page.media.map(fromAnilist);
    }
    if (source === "tvmaze") {
      const json = await get(`${TVMAZE}/search/shows?q=${encodeURIComponent(q)}`, null, "TVmaze");
      return json.map((r) => fromTvmaze(r.show));
    }
    if (source === "cinemeta") {
      const json = await get(`${CINEMETA}/catalog/movie/top/search=${encodeURIComponent(q)}.json`, null, "IMDb (Cinemeta)");
      return (json.metas || []).slice(0, 12).map(fromCinemeta);
    }
    return [];
  }

  async function details(source, id) {
    if (RETIRED.includes(source)) throw retired(source);
    if (source === "anilist") {
      const data = await anilist(`query ($id: Int) { Media(id: $id, type: ANIME) { ${ANILIST_FIELDS} } }`, { id: Number(id) });
      return fromAnilist(data.Media);
    }
    if (source === "tvmaze") {
      const s = await get(`${TVMAZE}/shows/${id}?embed=episodes`, null, "TVmaze");
      return fromTvmaze(s, s._embedded && s._embedded.episodes);
    }
    if (source === "cinemeta") {
      return fromCinemeta((await get(`${CINEMETA}/meta/movie/${id}.json`, null, "IMDb (Cinemeta)")).meta);
    }
    throw new Error("Unknown source");
  }

  /** A search hit is thin (movies especially); fetch the full record, keeping the better poster. */
  async function complete(hit, season) {
    if (!hit || !hit.source || hit.id == null) return hit;
    if (hit.source === "cinemeta") {
      const full = await details("cinemeta", hit.id);
      return Object.assign(full, { image: /media-amazon/.test(hit.image || "") ? hit.image : full.image });
    }
    if (hit.source === "tvmaze") {
      const full = await details("tvmaze", hit.id);
      // A "Season N" sheet counts only that season's episodes.
      if (season) full.episodes = await tvmazeSeasonCount(hit.id, season).catch(() => full.episodes);
      return full;
    }
    // An AniList search hit already carries every field; a bare {source, id} (an alternative picked later) does not.
    return hit.title && hit.synonyms ? hit : details(hit.source, hit.id);
  }

  /* ---------------- title similarity ---------------- */

  function norm(s) {
    return String(s || "")
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/['’`]/g, "")
      .replace(/&/g, " and ")
      .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ") // every script's letters (Thai, Hangul, Cyrillic, Arabic...)
      .trim();
  }

  /** Dice coefficient over character bigrams: 1 = identical, 0 = nothing shared. */
  function similarity(a, b) {
    a = norm(a).replace(/\s/g, "");
    b = norm(b).replace(/\s/g, "");
    if (!a || !b) return 0;
    if (a === b) return 1;
    const grams = (s) => {
      const m = new Map();
      for (let i = 0; i < s.length - 1; i++) m.set(s.slice(i, i + 2), (m.get(s.slice(i, i + 2)) || 0) + 1);
      return m;
    };
    const ga = grams(a), gb = grams(b);
    let hit = 0;
    for (const [g, n] of ga) hit += Math.min(n, gb.get(g) || 0);
    return (2 * hit) / (a.length - 1 + b.length - 1);
  }

  const SEASON_RE = /\b(?:season|part|cour)\s*(\d{1,2})\b|\b(\d{1,2})(?:st|nd|rd|th)\s+season\b|(?:temporada|staffel|saison|stagione|sezon|musim|phần|ซีซั่น|시즌|сезон)\s*(\d{1,2})/i;
  const seasonIn = (t) => { const m = String(t || "").match(SEASON_RE); return m ? Number(m[1] || m[2] || m[3]) : null; };
  const words = (t) => new Set(norm(t).split(" ").filter(Boolean));
  const isMovie = (m) => /movie|film/i.test(m.kind || "");

  // Streaming sites that only carry anime: a nudge toward AniList.
  const ANIME_HOSTS = /(^|\.)(otakudesu|samehadaku|kuramanime|anoboy|oploverz|nanimex|animeindo|neonime|kusonime|crunchyroll|hidive|hianime|aniwatch|9anime|aniwave|gogoanime|gogoanime3|anitaku|animepahe|zoro|kickassanime|animesaturn|animeunity|bilibili|bstation|muse|aniplus)\.|anime|nime\./i;

  /* ---------------- Wikidata: identity across languages ---------------- */

  // Wikidata keeps one entry per show or film, with its title in many languages
  // and the IDs other catalogs use for it. Those IDs are the same in every
  // language, so they connect a translated title to the right catalog entry.
  const WD_SPARQL = "https://query.wikidata.org/sparql";
  const WD_API = "https://www.wikidata.org/w/api.php";
  const WD_PROPS = { anilist: "P8729", mal: "P4086", imdb: "P345", tvmaze: "P8600", netflix: "P1874", tmdbTv: "P4983", tmdbMovie: "P4947" };

  function emptyIds() {
    return { wikidata: null, anilist: [], mal: [], imdb: [], tvmaze: [], netflix: [], tmdbTv: [], tmdbMovie: [] };
  }

  /** IDs of the Wikidata entries matching a SPARQL triple pattern about ?item. */
  async function wikidataIds(pattern) {
    const vars = Object.keys(WD_PROPS);
    const query = `SELECT ?item ${vars.map((v) => "?" + v).join(" ")} WHERE { ${pattern} ${vars
      .map((v) => `OPTIONAL { ?item wdt:${WD_PROPS[v]} ?${v} . }`)
      .join(" ")} } LIMIT 40`;
    const json = await get(`${WD_SPARQL}?format=json&query=${encodeURIComponent(query)}`, { headers: { Accept: "application/sparql-results+json" } }, "Wikidata");
    const ids = emptyIds();
    for (const b of json.results.bindings) {
      if (!ids.wikidata && b.item) ids.wikidata = b.item.value.split("/").pop();
      for (const v of vars) if (b[v] && !ids[v].includes(b[v].value)) ids[v].push(b[v].value);
    }
    return ids.wikidata ? ids : null;
  }

  /** Search Wikidata labels and aliases in the page's language; return the first entry that carries catalog IDs. */
  async function wikidataByTitle(title, lang) {
    const langs = [...new Set([String(lang || "").slice(0, 2).toLowerCase(), "en"].filter((l) => /^[a-z]{2}$/.test(l)))];
    for (const language of langs) {
      const found = await get(
        `${WD_API}?action=wbsearchentities&format=json&origin=*&type=item&limit=5&uselang=en&language=${language}&search=${encodeURIComponent(title)}`,
        null, "Wikidata");
      const items = (found.search || []).map((s) => s.id);
      if (!items.length) continue;
      const ents = await get(`${WD_API}?action=wbgetentities&format=json&origin=*&props=claims&ids=${items.join("|")}`, null, "Wikidata");
      for (const qid of items) {
        const claims = (ents.entities[qid] && ents.entities[qid].claims) || {};
        const ids = emptyIds();
        ids.wikidata = qid;
        for (const [k, p] of Object.entries(WD_PROPS)) {
          for (const c of claims[p] || []) {
            const v = c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value;
            if (typeof v === "string" && !ids[k].includes(v)) ids[k].push(v);
          }
        }
        if (ids.anilist.length || ids.tvmaze.length || ids.imdb.length) {
          const hit = (found.search || []).find((s) => s.id === qid);
          return { ids, label: (hit && (hit.match && hit.match.text)) || "" };
        }
      }
    }
    return null;
  }

  /** Catalog records for a set of cross-catalog IDs (several AniList entries when a show has parts). */
  async function metasFromIds(ids, film) {
    const tasks = [];
    for (const id of ids.anilist.slice(0, 8)) tasks.push(details("anilist", id)); // one per season or part
    if (!film) {
      for (const id of ids.tvmaze.slice(0, 1)) tasks.push(details("tvmaze", id));
      if (!ids.tvmaze.length) {
        for (const imdb of ids.imdb.slice(0, 1)) {
          tasks.push(get(`${TVMAZE}/lookup/shows?imdb=${imdb}`, null, "TVmaze").then((s) => details("tvmaze", s.id)));
        }
      }
    } else {
      for (const imdb of ids.imdb.slice(0, 1)) tasks.push(complete({ source: "cinemeta", id: imdb }));
    }
    const settled = await Promise.all(tasks.map((t) => t.then((m) => m, () => null)));
    return settled.filter(Boolean);
  }

  /** Cross-catalog IDs as stored on a sheet (single values, for comparing sheets). */
  function idsOf(meta, wd) {
    const out = {};
    if (wd) {
      if (wd.wikidata) out.wikidata = wd.wikidata;
      if (wd.mal[0]) out.mal = wd.mal[0];
      if (wd.imdb[0]) out.imdb = wd.imdb[0];
      if (wd.tvmaze[0]) out.tvmaze = wd.tvmaze[0];
      if (wd.netflix[0]) out.netflix = wd.netflix[0];
      if (wd.tmdbTv[0]) out.tmdbTv = wd.tmdbTv[0];
      if (wd.tmdbMovie[0]) out.tmdbMovie = wd.tmdbMovie[0];
    }
    if (meta.source === "anilist") out.anilist = String(meta.id);
    if (meta.source === "tvmaze") out.tvmaze = String(meta.id);
    if (meta.source === "cinemeta") out.imdb = String(meta.id);
    return out;
  }

  /** Do two catalog records describe the same work? (Same entry, or any shared cross-catalog ID.) */
  function sameEntry(a, b) {
    if (!a || !b) return false;
    if (a.source && a.source === b.source && String(a.id) === String(b.id)) return true;
    const x = a.ids || {}, y = b.ids || {};
    return ["wikidata", "anilist", "mal", "imdb", "tvmaze", "netflix", "tmdbTv", "tmdbMovie"].some((k) => x[k] && y[k] && String(x[k]) === String(y[k]));
  }

  /* ---------------- matching ---------------- */

  function scorer(signals, title) {
    const film = !!signals.film;
    const episode = signals.episode != null ? Number(signals.episode) : null;
    const minutes = signals.duration ? signals.duration / 60 : null;
    const animeSite = signals.host ? ANIME_HOSTS.test(signals.host) : false;
    const wantSeason = seasonIn(title);
    const base = title.replace(SEASON_RE, " ").replace(/\s{2,}/g, " ").trim();
    const wanted = norm(base).replace(/\s/g, "");
    const wantWords = words(base);

    return function score(m, rank, byId) {
      const names = [m.title, m.altTitle].concat(m.synonyms || []).filter(Boolean);

      // 1. Title: best of character similarity, with and without season words.
      //    A record reached through language-independent IDs already is the work.
      let s = byId ? 0.9 : Math.max(...names.map((n) => Math.max(similarity(n, title), similarity(String(n).replace(SEASON_RE, " "), base))));
      const contains = wanted.length >= 4 && names.some((n) => norm(n).replace(/\s/g, "").includes(wanted));
      const covers = wantWords.size >= 2 && names.some((n) => { const have = words(n); return [...wantWords].every((w) => have.has(w)); });
      if (contains || covers) s = Math.max(s, 0.78); // every word present, any order

      // 2. Season: "Season 2" should not take another season's entry.
      const theirs = names.map(seasonIn).find((x) => x != null);
      if (wantSeason > 1 && theirs === wantSeason) s += 0.1;
      if (wantSeason > 1 && theirs != null && theirs !== wantSeason) s -= 0.3;
      if (!wantSeason && theirs != null && theirs > 1 && !byId) s -= 0.12;

      // 3. Episode number beyond the entry's episode count: a different entry.
      if (episode && m.episodes && episode > m.episodes) s -= 0.2;

      // 4. Duration: a 24-minute video is not a 2-hour movie, and vice versa.
      if (minutes && m.runtime) {
        const off = Math.abs(m.runtime - minutes);
        if (off <= 6) s += 0.08;
        else if (off > 25) s -= 0.1;
      } else if (minutes && !film) {
        if (m.source === "anilist" && minutes > 40) s -= 0.05; // anime episodes run ~20–30 min
        if (m.source === "tvmaze" && minutes < 15) s -= 0.05;
      }

      // 5. Site: anime-only sites favour AniList.
      if (animeSite) s += m.source === "anilist" ? 0.08 : -0.08;

      // 6. The catalog's own relevance order, lightly (records reached by ID have no order).
      if (rank === 0 && !byId) s += 0.03;

      return { s, strong: s >= 0.8 || ((contains || covers) && s >= 0.6) };
    };
  }

  function kindFits(m, film) {
    return film ? isMovie(m) : !isMovie(m);
  }

  /** Pick among records reached by ID (e.g. the parts of one show) using the same signals. */
  async function fromIds(wd, signals, title) {
    const film = !!signals.film;
    const metas = (await metasFromIds(wd, film)).filter((m) => kindFits(m, film));
    if (!metas.length) return null;
    const score = scorer(signals, title);
    const ranked = metas
      .map((m, i) => ({ m, s: score(m, i, true).s }))
      // Ties: the earliest season, then AniList (richer anime records: episode titles, runtime).
      .sort((a, b) => (b.s - a.s) || ((a.m.year || 9999) - (b.m.year || 9999)) || ((b.m.source === "anilist") - (a.m.source === "anilist")));
    const best = await complete(ranked[0].m, seasonIn(title)).catch(() => ranked[0].m);
    best.ids = idsOf(best, wd);
    return { best, alternatives: ranked.slice(1, 4).map((c) => brief(c.m)), confident: ranked.length === 1 || ranked[0].s - ranked[1].s >= 0.08 };
  }

  /**
   * signals: { title, film, episode, duration (seconds), host, lang, netflixId }
   * Returns { best, alternatives, confident } — best is a complete meta (with
   * cross-catalog `ids` when known) or null. Throws when every catalog failed
   * to answer (so callers retry soon instead of recording a miss).
   *
   * Order: the streaming service's own ID (language-independent), then title
   * search in the catalogs, then a Wikidata title search in the page's language.
   */
  async function match(signals) {
    const title = String(signals.title || "").trim();
    if (!title) return { best: null, alternatives: [], confident: false };
    const film = !!signals.film;

    // 1. A streaming service's own ID (Netflix show, TMDB title) is the same whatever
    //    language the title is shown in.
    const ids = Object.assign({}, signals.ids, signals.netflixId ? { netflix: signals.netflixId } : null);
    for (const k of ["netflix", "tmdbTv", "tmdbMovie"]) {
      if (!ids[k]) continue;
      const wd = await wikidataIds(`?item wdt:${WD_PROPS[k]} "${String(ids[k]).replace(/\D/g, "")}" .`).catch(() => null);
      const viaId = wd && (await fromIds(wd, signals, title).catch(() => null));
      if (viaId) return viaId;
    }

    // 2. On a page in another language, an exact Wikidata label (or alias) in that
    //    language is the strongest evidence: catalogs may hold a different show
    //    that happens to share the translated title.
    const pageLang = String(signals.lang || "").slice(0, 2).toLowerCase();
    let viaLabel = null;
    let labelUnchecked = false; // Wikidata didn't answer: a translated-title match can't be confirmed
    if (pageLang && pageLang !== "en") {
      viaLabel = await wikidataByTitle(title.replace(SEASON_RE, " ").replace(/\s{2,}/g, " ").trim(), pageLang).catch(() => {
        labelUnchecked = true;
        return null;
      });
      if (viaLabel && norm(viaLabel.label) === norm(title.replace(SEASON_RE, " "))) {
        const r = await fromIds(viaLabel.ids, signals, title).catch(() => null);
        if (r) return r;
      }
    }

    // 3. Title search in the catalogs themselves.
    const wantSeason = seasonIn(title);
    const base = title.replace(SEASON_RE, " ").replace(/\s{2,}/g, " ").trim();
    const sources = film ? ["anilist", "cinemeta"] : ["anilist", "tvmaze"];
    const results = await Promise.all(sources.map((s) =>
      search(s, s === "tvmaze" ? base : title).then((list) => ({ s, list }), () => ({ s, list: null }))));
    const allFailed = results.every((r) => r.list === null);

    const score = scorer(signals, title);
    const candidates = [];
    for (const { list } of results) {
      if (!list) continue;
      list.forEach((m, rank) => {
        if (!kindFits(m, film)) return; // a film never links to a series, an episode never to a movie
        candidates.push(Object.assign({ m }, score(m, rank, false)));
      });
    }
    candidates.sort((a, b) => b.s - a.s);
    const top = candidates[0];

    if (top && top.strong) {
      // The same title in another catalog (a film on AniList and IMDb) is not a rival.
      // Release years differ by region (Spirited Away: 2001 in Japan, 2003 on IMDb), so a matching runtime also counts.
      const sameWork = (a, b) =>
        a.source !== b.source && norm(a.title) === norm(b.title) &&
        ((a.year && b.year && Math.abs(a.year - b.year) <= 2) || (a.runtime && b.runtime && Math.abs(a.runtime - b.runtime) <= 3));
      const runnerUp = candidates.find((c) => c !== top && !(c.m.source === top.m.source && c.m.id === top.m.id) && !sameWork(c.m, top.m));
      const confident = top.s >= 0.9 && (!runnerUp || top.s - runnerUp.s >= 0.08) && !labelUnchecked;
      const best = await complete(top.m, wantSeason).catch(() => top.m);
      best.ids = idsOf(best, null);
      return { best, alternatives: candidates.filter((c) => c !== top).slice(0, 3).map((c) => brief(c.m)), confident };
    }

    // 4. A translated title the catalogs don't know: look it up in Wikidata, in the page's language.
    if (!viaLabel) viaLabel = await wikidataByTitle(base, signals.lang).catch(() => null);
    if (viaLabel) {
      const r = await fromIds(viaLabel.ids, signals, title).catch(() => null);
      if (r) {
        // An exact label hit is as good as a title match; a fuzzy one stays a best guess.
        r.confident = r.confident && norm(viaLabel.label) === norm(base);
        return r;
      }
    }

    if (allFailed) throw new Error("No catalog answered.");
    return { best: null, alternatives: candidates.slice(0, 3).map((c) => brief(c.m)), confident: false };
  }

  /** Just enough to show and pick an alternative later. */
  function brief(m) {
    return { source: m.source, id: m.id, title: m.title, altTitle: m.altTitle || "", kind: m.kind || "", year: m.year || null, episodes: m.episodes || null, image: m.image || "" };
  }

  const api = { LABEL, RETIRED, search, details, complete, match, brief, sameEntry, similarity, norm };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.KSCatalog = api;
})(typeof self !== "undefined" ? self : this);
