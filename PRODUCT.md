# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Delegated (user accepted the recommendation): a Manifest V3 browser extension in vanilla JS (no build step) plus a static HTML/CSS/JS website. No backend. The extension stores progress in `chrome.storage.local` and bridges it to the website through a content script injected on the website's origin (localhost / file served pages), with `localStorage` as the website's fallback store and JSON import/export.

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
- Manual add: the website searches Jikan (MyAnimeList, anime) and TVmaze (TV series) to create or link a series, pulling synopsis, poster, episode count, status; a refresh action re-fetches the latest description.
- No accounts, no cloud sync (undecided for later).

## Evidence on Hand

None. All demo data shown in the website's empty/sample state must be labeled as sample.

## Product Principles

1. The show is the unit, the provider is a footnote.
2. Resume in one action.
3. Guess, then let the user correct quickly.
4. Local-first; the user owns their data (export/import).
