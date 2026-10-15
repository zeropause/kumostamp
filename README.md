# Kumostamp

Simpan menit terakhir yang kamu tonton di anime atau series, lalu lanjutkan di situs streaming mana pun.

Contoh: kamu nonton *JoJo Part 6* episode 2 sampai 26:14 di situs A, lalu pindah ke situs B. Begitu episode itu dibuka di situs B, muncul tombol *Jump to 26:14*.

| Bagian | Folder | Isi |
|---|---|---|
| Extension (Chrome/Edge, Manifest V3) | `extension/` | Membaca video yang diputar beserta judul dan episodenya, menyimpan timestamp, dan menampilkan tombol resume di situs lain |
| Website (React + Vite + TypeScript) | `web/` | Library series dan timestamp, daftar episode dari AniList / TVmaze / IMDb, tambah dan edit manual, export/import |
| API (Hono di Cloudflare Workers + D1) | `web/worker/` | Login MyAnimeList, sinkron library antar browser, update list MAL |

Mark selalu disimpan lokal di browser dan extension, jadi semuanya tetap jalan tanpa login.

## Menjalankan

### Website

```bash
cd web
npm install
cp .dev.vars.example .dev.vars   # isi TOKEN_KEY, MAL_CLIENT_ID, MAL_CLIENT_SECRET
npm run db:migrate               # ulangi setiap ada file baru di web/migrations/
npm run dev
```

Buka http://localhost:5173. Port harus 5173 supaya extension mau terhubung. Dev server yang sama menjalankan API (`/api/*`) dan D1 lokal.

Client MAL dibuat di https://myanimelist.net/apiconfig (App Type: web) dengan redirect URL `http://localhost:5173/api/auth/mal/callback`.

### Extension

1. Buka `chrome://extensions` (atau `edge://extensions`) dan aktifkan Developer mode.
2. Klik Load unpacked, pilih folder `extension/`.
3. Reload tab website. Status di header berubah menjadi *Extension connected*.

Setelah extension di-reload, refresh juga tab website yang sedang terbuka.

### Deploy

```bash
npx wrangler login
npx wrangler d1 create kumostamp        # salin database_id ke wrangler.jsonc
npm run db:migrate:remote
npx wrangler secret put MAL_CLIENT_ID   # ulangi untuk MAL_CLIENT_SECRET dan TOKEN_KEY
npm run deploy
```

Daftarkan juga `https://<domain>/api/auth/mal/callback` di client MAL.

## Cara kerja singkat

Extension mengambil `<video>` terbesar yang sedang diputar (termasuk di iframe), lalu membaca judul dan episode dari state player, DOM per situs, JSON-LD, Media Session, URL, dan judul halaman. Hasil yang tidak yakin baru disimpan setelah kamu konfirmasi di popup.

Tiap episode punya satu mark per situs. Saat episode yang sama diputar di situs lain, player lompat ke mark terbaru, dengan tombol Undo.

Setelah login MyAnimeList, library di browser digabung dengan salinan di server: mark terbaru menang per episode, dan yang sudah dihapus tetap terhapus. Episode yang diputar minimal 1 menit membuat anime itu *Watching* di list MAL (dan AniList, kalau dihubungkan) dengan progres = nomor episode. Progres tidak pernah diturunkan, dan *Completed* tidak pernah di-set otomatis.

Detailnya ada di [docs/how-it-works.md](docs/how-it-works.md).

## Struktur

```
extension/
  background.js        satu-satunya penulis database (chrome.storage.local)
  content.js           deteksi video, kartu resume
  detect.js            urutan pembaca judul/episode + jejak diagnosa
  main-world.js        pembaca state player (Netflix) di dunia JS halaman
  bridge.js            penghubung ke website
  popup.html/css/js
  lib/core.js          parsing judul + operasi data (sumber utama)
  lib/catalog.js       pencarian katalog dan skor kecocokan (sumber utama)
  lib/accounts.js      login AniList
  lib/anilist-sync.js  antrean update list AniList
  lib/cloud-sync.js    sinkron extension ke akun
web/
  src/routes/          Library, SeriesPage, Login, ExtensionConnect
  src/components/
  src/lib/             store, sync, catalog, core.js dan catalog-shared.js (salinan)
  src/styles/          tokens.css (sumber utama token desain), app.css
  worker/              API: auth MAL, library, sinkron MAL
  migrations/          skema D1
scripts/
  sync-shared.mjs      salin core.js, catalog.js, dan tokens.css di antara kedua bagian
  render-icons.mjs     render ikon PNG extension dari logo
```

Setelah mengedit `extension/lib/core.js`, `extension/lib/catalog.js`, atau `web/src/styles/tokens.css`, jalankan `node scripts/sync-shared.mjs`.

## Batasan

- Video lewat plugin non-HTML5 atau canvas DRM tidak bisa dibaca.
- Judul diambil dari halaman, jadi kadang perlu dikoreksi sekali per situs.
- Beberapa player custom menimpa `currentTime`. Kalau begitu, salin waktunya (tombol Copy) dan seek manual.
- Series dari TVmaze atau IMDb tidak ikut ke list MAL/AniList. Season yang nomor episodenya berlanjut (Ep 29 yang sebenarnya S2 Ep 5) belum didukung.
- Belum ada tes otomatis.
