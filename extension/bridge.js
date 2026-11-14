/*
 * Kumostamp bridge: connects the library website to the extension's database.
 * Runs on every top-level page but stays silent unless the page declares
 * <html data-kumostamp-app>. Even then it hands over data only when the
 * page's origin is trusted: localhost / 127.0.0.1 / file, or the Library
 * address the user set in the popup. Any other site that copies the marker
 * learns only that the extension exists, never your marks.
 */
(function () {
  "use strict";
  if (window.top !== window) return;
  const DB_KEY = "ks:db";
  const SETTINGS_KEY = "ks:settings";
  const FROM_PAGE = "kumostamp-web";
  const TO_PAGE = "kumostamp-ext";

  function ready(fn) {
    if (document.documentElement && document.documentElement.hasAttribute("data-kumostamp-app")) fn();
    else document.addEventListener("DOMContentLoaded", () => {
      if (document.documentElement.hasAttribute("data-kumostamp-app")) fn();
    });
  }

  ready(() => {
    const origin = location.origin === "null" ? "*" : location.origin;
    const post = (payload) => window.postMessage(Object.assign({ source: TO_PAGE }, payload), origin);
    let trusted = false;

    /** What the homepage's AniList chip may know: no token, just reachability and the last push. */
    async function anilistState() {
      const accounts = await chrome.runtime.sendMessage({ type: "accountStatus" }).catch(() => null);
      const settings = await chrome.runtime.sendMessage({ type: "getSettings" }).catch(() => null);
      const last = await chrome.runtime.sendMessage({ type: "anilistLast" }).catch(() => null);
      return {
        connected: !!(accounts && accounts.accounts && accounts.accounts.anilist),
        syncOn: !!(settings && settings.settings && settings.settings.anilistSync),
        last: (last && last.last) || null,
      };
    }

    /** Discord Rich Presence status and privacy toggles for the library's onboarding/settings. */
    async function discordState(force) {
      const [presence, settingsRes] = await Promise.all([
        chrome.runtime.sendMessage({ type: "presenceStatus", force: !!force }).catch(() => null),
        chrome.runtime.sendMessage({ type: "getSettings" }).catch(() => null),
      ]);
      const s = (settingsRes && settingsRes.settings) || {};
      return {
        enabled: !!s.discordRpc,
        showTitle: s.discordShowTitle !== false,
        showTime: s.discordShowTime !== false,
        helper: (presence && presence.helper) || { ok: false, discord: "unknown" },
        live: (presence && presence.live) || null,
        error: (presence && presence.error) || "",
      };
    }

    async function pushDb() {
      if (!trusted) return;
      const res = await chrome.runtime.sendMessage({ type: "getDb" });
      const [anilist, discord] = await Promise.all([anilistState(), discordState(false)]);
      post({ type: "db", db: res && res.db, version: chrome.runtime.getManifest().version, anilist, discord });
    }

    async function checkTrust() {
      const res = await chrome.runtime.sendMessage({ type: "bridgeHello", origin: location.origin, url: location.href });
      trusted = !!(res && res.trusted);
      if (trusted) pushDb();
      else post({ type: "untrusted", origin: location.origin });
    }

    window.addEventListener("message", async (e) => {
      if (e.source !== window || !e.data || e.data.source !== FROM_PAGE) return;
      const { type, id } = e.data;
      if (type === "hello") return trusted ? pushDb() : checkTrust();
      if (type === "anilist") {
        // The login page hands over an AniList token (or asks who is connected). Only your library may.
        if (!trusted) return post({ type: "anilistAck", id, error: "This address isn't your Kumostamp library yet. Allow it in the extension popup." });
        try {
          const res = await chrome.runtime.sendMessage({ type: "anilistFromWeb", token: e.data.token, expiresIn: e.data.expiresIn });
          post({ type: "anilistAck", id, user: res && res.user, error: res && res.error });
        } catch (err) {
          post({ type: "anilistAck", id, error: String((err && err.message) || err) });
        }
        return;
      }
      if (type === "discord") {
        if (!trusted) return post({ type: "discordAck", id, error: "This address isn't your Kumostamp library yet. Allow it in the extension popup." });
        try {
          const patch = e.data.patch;
          if (patch && typeof patch === "object") {
            const allowed = {};
            for (const k of ["discordRpc", "discordShowTitle", "discordShowTime"]) {
              if (typeof patch[k] === "boolean") allowed[k] = patch[k];
            }
            if (Object.keys(allowed).length) await chrome.runtime.sendMessage({ type: "setSettings", settings: allowed });
          }
          const discord = await discordState(!!e.data.force);
          post({ type: "discordAck", id, discord });
        } catch (err) {
          post({ type: "discordAck", id, error: String((err && err.message) || err) });
        }
        return;
      }
      if (type === "op") {
        if (!trusted) return post({ type: "ack", id, error: "This address isn't your Kumostamp library yet. Allow it in the extension popup." });
        try {
          const res = await chrome.runtime.sendMessage({ type: "op", op: e.data.op });
          post({ type: "ack", id, error: res && res.error });
        } catch (err) {
          // Usually the extension was reloaded or updated under this page: its link to the page is gone.
          post({ type: "ack", id, error: /context invalidated/i.test(String(err && err.message)) ? "Kumostamp was updated. Reload this page and try again." : String((err && err.message) || err) });
        }
      }
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes[SETTINGS_KEY]) checkTrust(); // allowed (or revoked) from the popup
      if (changes[DB_KEY] && trusted) post({ type: "db", db: changes[DB_KEY].newValue });
      // An auto-update to AniList lands here, not in ks:db: re-answer with the fresh state.
      if (changes["ks:anilist-sync"] && trusted) pushDb();
      if (changes["ks:accounts"] && trusted) pushDb();
    });

    checkTrust();
  });
})();
