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

    async function pushDb() {
      if (!trusted) return;
      const res = await chrome.runtime.sendMessage({ type: "getDb" });
      post({ type: "db", db: res && res.db, version: chrome.runtime.getManifest().version });
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
      if (type === "op") {
        if (!trusted) return post({ type: "ack", id, error: "This address isn't your Kumostamp library yet. Allow it in the extension popup." });
        const res = await chrome.runtime.sendMessage({ type: "op", op: e.data.op });
        post({ type: "ack", id, error: res && res.error });
      }
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes[SETTINGS_KEY]) checkTrust(); // allowed (or revoked) from the popup
      if (changes[DB_KEY] && trusted) post({ type: "db", db: changes[DB_KEY].newValue });
    });

    checkTrust();
  });
})();
