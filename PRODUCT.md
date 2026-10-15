# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

A Manifest V3 browser extension in vanilla JS (no build step), a React + Vite + TypeScript website, and a small Hono API on Cloudflare Workers with D1. The extension stores progress in `chrome.storage.local` and bridges it to the website through a content script on trusted origins (localhost, file pages, or the Library address set in the popup), with `localStorage` as the website's fallback store and JSON import/export. The API handles MyAnimeList sign-in, library sync between browsers, and MyAnimeList list updates.

## Users

A single viewer watching anime and TV series across several streaming sites in one browser. They often switch provider mid-episode (a site goes down, a better sub/quality appears elsewhere) and lose their place.

## Product Purpose

Kumostamp remembers where you stopped in a series, episode, and minute, independent of which site played it. Success: the user opens another provider, sees "JoJo Part 6 · Ep 2 · 26:14", and jumps there in seconds.

## Positioning

Progress belongs to the show, not the site. Every provider keeps its own resume point; Kumostamp keeps one across all of them.

## Operating Context

- Extension detects the largest playing `<video>` on any page (including iframes), reads `currentTime`/`duration`, and infers series title and episode number from page title/URL/metadata; the user can correct both in the popup.
- Saves periodically while playing and on pause/leave.
- On a different site, the popup (and an optional in-page chip) offers "Resume at mm:ss" for the matching series.
- Website lists saved series, episodes, timestamps, and the providers they were watched on.

## Capabilities and Constraints

- Detection of title/episode is heuristic; manual correction is a core flow, not an edge case.
- Cross-origin iframes: extension content scripts run with `all_frames`, so most embedded players are reachable.
- Manual add: the website searches AniList (anime), TVmaze (TV series), and IMDb via Cinemeta (films) to create or link a series, pulling synopsis, poster, episode count, status; a refresh action re-fetches the latest description.
- Accounts are optional: signing in with MyAnimeList syncs the library between browsers and updates the user's MAL list. Everything still works signed out.

## Evidence on Hand

None. All demo data shown in the website's empty/sample state must be labeled as sample.

## Product Principles

1. The show is the unit, the provider is a footnote.
2. Resume in one action.
3. Guess, then let the user correct quickly.
4. Local-first; the user owns their data (export/import).
