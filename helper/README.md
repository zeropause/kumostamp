# Kumostamp Discord helper

Puts what you are watching on your Discord profile. A browser cannot open
Discord's local IPC socket, so the extension POSTs the playback state to this
small server, and the server owns the Discord connection.

The helper has no dependencies and no build step. Node 18 or newer is enough.

## 1. Create the Discord application

1. Open <https://discord.com/developers/applications> → **New Application**.
2. Copy the **Application ID** from *General Information*.
3. Under **Rich Presence → Art Assets**, upload (128×128 px or larger):
   - `kumostamp` — used as the fallback large image
   - `playing` — small image while playing
   - `paused` — small image while paused

   Without these assets the card still works, but external poster URLs are the
   only image source and some Discord builds ignore them.

You do not need a bot, a server, or any OAuth scope. The helper only calls
`SET_ACTIVITY` on your own desktop client, so nothing leaves your machine.

## 2. Configure and run

```bash
cd helper
cp config.example.json config.json
# edit config.json: clientId = your Application ID
node index.mjs
```

Expected log:

```
[10:42:01] listening on http://127.0.0.1:47834
[10:42:01] waiting for the extension to pair on first contact.
[10:42:02] discord connected (yourname)
```

Leave it running while you watch. The extension reconnects by itself after the
helper or Discord restarts.

### config.json

| Key | Meaning |
|---|---|
| `clientId` | Discord Application ID (required) |
| `port` | Default `47834`; the extension uses the same port |
| `token` | Optional fixed pairing token. Empty = trust on first use |
| `assets.large` / `assets.playing` / `assets.paused` | Asset keys uploaded in step 1 |

### What the card shows

| Discord field | Kumostamp value |
|---|---|
| `name` (line 1) | the series title |
| `details` (line 2) | `Cyberpunk: Edgerunners · Ep 5`, clickable to the provider page |
| `state` (line 3) | `reanime.to`, `Paused at 18:58`, or `Finished` |
| `status_display_type` | `2` (details), so the compact member list shows title + episode |
| `timestamps` | the progress bar and countdown while playing |
| `party` | `5 of 10` from the sheet's episode count |
| `assets.large_*` | the poster, clickable to the provider page |
| `assets.small_*` | playing/paused badge, not a link |
| `buttons` | *Watch on <provider>* and *Open series* |

Links prefer the provider page (the thing you were watching) over the Kumostamp
library; the series sheet is only the fallback when the page URL is unusable.

Older clients that reject any of these get progressively simpler activities: first
without `type` and external images, then without the `name` override.

### The first line: application name vs. series title

Discord renders the application name on the first line of the card ("Watching
<name>"). Since Discord added the per-activity `name` override to the RPC, the
helper sets it to the series title, so the card reads "Watching Cyberpunk:
Edgerunners" instead of the static app name. Turning off *Show the series title*
falls back to `Kumostamp`.

If a client rejects the override, the helper retries automatically: first without
`type` and with uploaded assets instead of external image URLs, then without the
`name` override as well.

### Progress bar

While something plays, the bar and the countdown come from two timestamps sent
with the activity.

There is no "frozen" bar: Discord draws the bar and counts down on its own client,
from those timestamps, so any activity that keeps them keeps running. A paused
card therefore sends no timestamps and puts the position in the second line
instead: `Ep 5 · Paused at 16:27`. Resuming sends fresh timestamps and the bar
returns at the right place. Turning off *Show progress* removes both.

### Flags

```bash
node index.mjs --dry-run          # never connects; prints the activity JSON it would send
node index.mjs --port=47834       # override the port
node index.mjs --client-id=123    # override the config file
```

`--dry-run` is the fastest way to check the extension side: watch the JSON while
pausing, seeking, or switching episodes.

## 3. Pair with the extension

Open the Kumostamp popup → **Connected accounts → Discord** and turn on
*Show what I'm watching in Discord*. The first request pairs the two:

- The extension generates a random token and stores it in `chrome.storage.local`.
- The helper remembers the first token it sees in `helper/.state.json`.

Leave `token` empty in normal use: the extension generates its own and the
helper remembers it. Setting `token` pins the pairing, but then both sides must
hold the same value, and the extension has no field for it — only do that while
debugging.

**Trust boundary:** any local page can reach `127.0.0.1:47834`. Pairing on first
contact means a malicious local page could bind first and then send fake
activities or block the extension. The blast radius is only your Discord
presence. For a stricter setup, pin `token` and pair deliberately.

## HTTP API

```http
GET  /health?token=…
  -> { "ok": true, "discord": "connected" | "connecting" | "idle", "user": "name" }

POST /presence
  { "token": "…", "state": { … } | null }
  -> { "ok": true, "discord": "connected", "warning": "optional" }
```

Body is plain text JSON (no custom headers, so no CORS preflight). The helper
only listens on `127.0.0.1`. `state: null` clears the presence.

Fields in `state`: `title`, `episode`, `seriesKey`, `position`, `duration`,
`paused`, `ended`, `host`, `poster`, `libraryUrl`, `showTitle`, `showTime`.

The helper expires a forgotten state by itself: 90 s while playing, 10 min while
paused, 2 min after the episode ended. That handles a closed or crashed browser,
which cannot send `null`.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `Set your Discord Application ID…` | `config.json` is missing or still has the placeholder |
| `Port 47834 is already in use` | Another helper is running (or an old one did not exit) |
| Popup says *Waiting for Discord* | Discord desktop is closed, or it runs under another OS user |
| Popup says *Helper not running* | `node index.mjs` is not running, or it failed to start |
| `Not paired with this helper.` | `.state.json` belongs to a different extension token. Stop the helper, delete `.state.json`, reload the extension |
| No card at all | Discord → *Settings → Activity Privacy* → enable *Share your detected activities with others* |
| Card appears but with no images | Assets were not uploaded, or the poster URL was rejected; check the helper log |
