// ==UserScript==
// @name         Movy.sx / 7movies Anti Popup / New Tab Ads
// @namespace    https://movy.sx/
// @version      1.1
// @description  Blokir tab iklan (popup/popunder) yang muncul tiap klik di movy.sx
// @match        *://movy.sx/*
// @match        *://*.movy.sx/*
// @match        *://7movies.ac/*
// @match        *://*.7movies.ac/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const log = (...a) => console.debug('[AntiPopup]', ...a);
  const sameSite = (url) => {
    try {
      const u = new URL(url, location.href);
      return u.hostname === location.hostname || u.hostname.endsWith('.' + location.hostname);
    } catch (e) { return true; }
  };

  // 1. Matikan window.open (sumber utama popup/popunder)
  const fakeWin = () => new Proxy(function () {}, {
    get: (_, k) => (k === 'closed' ? true : fakeWin()),
    set: () => true,
    apply: () => undefined,
  });
  window.open = function (url) {
    log('blocked window.open', url);
    return fakeWin();
  };
  try {
    Object.defineProperty(window, 'open', { value: window.open, writable: false, configurable: false });
  } catch (e) {}

  // 2. Anchor "palsu" yang di-click() lewat script (trik umum iklan)
  const origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (!this.isConnected && !sameSite(this.href)) {
      log('blocked detached anchor click', this.href);
      return;
    }
    return origClick.apply(this, arguments);
  };

  // 3. Klik pada link target=_blank ke domain lain -> batalkan
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    const blank = a.target === '_blank' || a.target === '_new';
    if (blank && !sameSite(a.href)) {
      log('blocked external _blank link', a.href);
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }, true);

  // 4. Hapus overlay transparan layar penuh (penangkap klik iklan)
  const isClickJackOverlay = (el) => {
    if (!(el instanceof HTMLElement) || el.children.length || el.textContent.trim()) return false;
    if (/^(video|iframe|img|canvas|svg|a|button|input)$/i.test(el.tagName)) return false;
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed' && cs.position !== 'absolute') return false;
    const r = el.getBoundingClientRect();
    const big = r.width > innerWidth * 0.8 && r.height > innerHeight * 0.8;
    const z = parseInt(cs.zIndex, 10) || 0;
    const invisible = parseFloat(cs.opacity) < 0.1 || cs.backgroundColor === 'rgba(0, 0, 0, 0)' || cs.backgroundColor === 'transparent';
    return big && z > 100 && invisible;
  };

  // 5. Widget iklan melayang (ikon gift, "Click this button", dll)
  const AD_TEXT = /gift|claim|click (this|here)|tap (this|here)|free|prize|bonus|reward|winner|congrat|spin|download now|install|sponsored/i;
  const AD_ATTR = /(^|[-_ ])(ad|ads|adv|advert|banner|popup|pop-up|promo|sponsor|gift|floating|sticky-ad)([-_ ]|$)/i;
  const isFloatingAd = (el) => {
    if (!(el instanceof HTMLElement) || el === document.body || el === document.documentElement) return false;
    if (el.querySelector('video, #player, [class*="player"]')) return false;
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed' && cs.position !== 'sticky') return false;
    const r = el.getBoundingClientRect();
    if (r.width < 20 || r.height < 20) return false;
    if (r.width > innerWidth * 0.95 && r.height > innerHeight * 0.95) return false; // dihandle overlay
    // jangan sentuh navbar/header bawaan situs
    if (el.closest('header, nav') || /^(header|nav)$/i.test(el.tagName)) return false;

    const links = [...el.querySelectorAll('a[href]')];
    if (el.tagName === 'A') links.push(el);
    const extLink = links.some((a) => !sameSite(a.href));
    const extFrame = [...el.querySelectorAll('iframe')].some((f) => f.src && !sameSite(f.src));
    const extImg = [...el.querySelectorAll('img')].some((i) => i.src && !sameSite(i.src));
    const attr = AD_ATTR.test((el.id || '') + ' ' + (typeof el.className === 'string' ? el.className : ''));
    const text = AD_TEXT.test(el.innerText || '') || AD_TEXT.test(el.getAttribute('aria-label') || '') ||
      [...el.querySelectorAll('img')].some((i) => AD_TEXT.test((i.alt || '') + (i.src || '')));

    return extFrame || extLink || (attr && (extImg || text)) || (text && extImg);
  };

  const sweep = () => {
    document.querySelectorAll('div, span, a, aside, section, iframe, img').forEach((el) => {
      if (isClickJackOverlay(el)) { log('removed overlay', el); el.remove(); return; }
      if (isFloatingAd(el)) { log('removed floating ad', el); el.remove(); }
    });
  };

  // CSS cadangan untuk pola iklan umum (aman: hanya iframe/ins iklan)
  const style = document.createElement('style');
  style.textContent = `
    ins.adsbygoogle, iframe[src*="doubleclick"], iframe[src*="googlesyndication"],
    iframe[src*="adsterra"], iframe[src*="popads"], iframe[src*="propeller"],
    [id*="gift" i][style*="fixed"], [class*="gift-icon" i], [class*="giftbox" i] { display: none !important; }`;
  (document.head || document.documentElement).appendChild(style);

  const start = () => {
    sweep();
    new MutationObserver(sweep).observe(document.documentElement, { childList: true, subtree: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
