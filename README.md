# Kumostamp

Simpan menit terakhir yang kamu tonton di anime atau series, lalu lanjutkan di situs streaming mana pun.

Contoh: kamu nonton *JoJo Part 6* episode 2 sampai menit 26:14 di situs A, lalu pindah ke situs B. Di situs B, Kumostamp menawarkan **Jump to 26:14**.

Ada dua bagian:

| Bagian | Folder | Fungsi |
|---|---|---|
| Extension (Chrome/Edge, Manifest V3) | `extension/` | Mendeteksi video yang diputar (termasuk di dalam iframe), menebak judul dan episode, menyimpan timestamp, dan menampilkan tombol resume di situs lain |
| Website (React + Vite + TypeScript SPA) | `web/` | Daftar series dan timestamp, halaman per series dengan daftar episode lengkap dari AniList / TVmaze / IMDb, tambah manual, edit, hapus, export/import |

Tidak ada backend. Semua data disimpan lokal di browser.

## Menjalankan

### 1. Website

```bash
cd web
npm install
npm run dev
```

Lalu buka http://localhost:5173. Deploy ke Cloudflare Pages: `npm run deploy` (branch produksi proyek ini bernama `production`). Build saja: `npm run build` (hasil di `web/dist/`, preview dengan `npm run preview`). Port harus tetap 5173 di localhost agar extension bisa terhubung.

Halaman:
- `/`: library, berisi band *Continue*, filter (`?show=all&sort=az&q=…` tersimpan di URL), dan satu sheet per series.
- `/series/:key`: satu series dengan semua episode. Kalau sudah di-link ke katalog, daftar episode (judul, tanggal tayang, durasi) diambil otomatis dari AniList / TVmaze / IMDb. Mark kamu ditempel di atasnya, dan episode yang belum ditonton punya tombol *Mark*.

### 2. Extension

1. Buka `chrome://extensions` (atau `edge://extensions`).
2. Aktifkan **Developer mode**.
3. Klik **Load unpacked**, pilih folder `kumotstamp/extension`.
4. Reload tab website. Di header, status *Source* berubah menjadi **Extension connected**.

## Cara kerja

**Deteksi.** `content.js` berjalan di setiap frame dan memilih `<video>` terbesar yang sedang diputar (durasi lebih dari 45 detik). Posisi video dikirim ke background worker setiap ~4 detik, juga saat pause, seek, ganti tab, dan saat halaman ditutup. Frame paling atas membaca `og:title`, `<h1>`, `document.title`, dan URL, lalu `KS.parseMedia` menebak series dan episode, misalnya:

| Judul halaman | Hasil |
|---|---|
| `Nonton Jojo no Kimyou na Bouken Part 6 Episode 2 Sub Indo \| Otakudesu` | Jojo no Kimyou na Bouken Part 6 · Ep 2 |
| `Frieren - 05 [1080p]` | Frieren · Ep 5 |
| `Breaking Bad S02E05 \| Netflix` | Breaking Bad Season 2 · Ep 5 |
| `葬送のフリーレン 第3話` | 葬送のフリーレン · Ep 3 |
| URL `/watch/jojo-part-6-episode-12` | Jojo Part 6 · Ep 12 |

Judul halaman hanyalah sumber terakhir. `detect.js` mencoba sumber dari yang paling bisa dipercaya:

1. **State player di halaman** (`main-world.js`, berjalan di dunia JS halaman): Netflix menyimpan judul, season, dan episode di `netflix.appContext`, sedangkan `document.title` cuma "Netflix".
2. **DOM player per situs**: overlay judul Netflix, Prime Video, Disney+/Hotstar, Crunchyroll, YouTube.
3. **JSON-LD** `TVEpisode` / `Movie` (banyak situs streaming menyertakannya).
4. **Judul player + label episode di bawahnya**, misalnya `<h1>Dandadan</h1><p>E3 · 23m</p>` atau `<h1>Game of Thrones</h1><p>S2 E3 … · 53m</p>`. Pola ini dipakai banyak situs streaming (Movy dan sejenisnya).
5. **Media Session** (`navigator.mediaSession.metadata`), yang diisi player untuk kontrol media OS.
6. **Angka di akhir alamat halaman**: `/anime/dandadan-lzcmw/3` → episode 3, `/tv/1399/2/3` → season 2 episode 3. Angka setelah kata jenis (`/tv/1399`, `/movie/550`) dianggap ID, bukan episode.
7. **Parameter URL dan path film**: `?season=1&episode=3` (juga `s`, `ep`, `episode_number`, dst.) dengan nama dari `<h1>` atau judul halaman; path `/movie/…` atau `/film/…` dianggap film.
8. **Judul halaman / og:title / h1 / URL** (tabel di atas).

Hanya deteksi yang yakin (atau koreksi kamu) yang disimpan otomatis. Halaman navigasi seperti "Beranda", "Browse", atau "Home" tidak pernah dianggap judul. Tebakan yang lemah ditampilkan di popup; tekan Enter (atau *Mark now*) untuk mengonfirmasi.

**Kalau deteksi gagal**, buka popup lalu klik *How this was detected*. Bagian itu menampilkan hasil setiap pembaca, misalnya `page-world: netflix: metadata not readable` atau `page-title: nothing`. Kirim isinya kalau ada situs yang belum terbaca.

**Koreksi.** Kalau tebakannya salah, perbaiki di popup extension. Koreksi itu disimpan sebagai *alias*, jadi judul yang sama di situs tersebut otomatis masuk ke series yang benar di kunjungan berikutnya. Saat menambahkan series dari AniList/TVmaze/IMDb, judul romaji dan Inggrisnya juga didaftarkan sebagai alias.

**Resume.** Saat kamu membuka episode yang sudah punya mark (minimal 30 detik dan belum selesai), muncul kartu kecil di pojok kiri bawah: *Jump to 26:14*. Popup juga punya tombol yang sama.

**Kalau nomor episode tidak terbaca.** Setiap hasil deteksi punya jenis: *episode* (nomornya terbaca), *film* (sumbernya sendiri bilang ini film, misalnya tipe movie di Netflix atau JSON-LD `Movie`), atau *unknown* (series ketemu, nomor episode tidak). Safeguard-nya:
- **Unknown tidak pernah disimpan atau di-sync otomatis.** Popup menulis "Found the series, not the episode number". Ketik nomornya lalu Enter, atau kosongkan Ep lalu Enter kalau memang film.
- **"Film" palsu ditolak.** Kalau halaman mengaku film tapi series itu sudah punya episode bernomor (atau katalognya bilang lebih dari 1 episode), mark tidak disimpan sampai kamu isi nomornya.
- **Sync hanya ke episode yang sama persis**, jadi tidak pernah melompat ke timestamp episode lain.
- **Mark lama tanpa nomor** (dari sebelum safeguard ini) ditandai `??` di website. Isi "Which one?" lalu Move untuk memindahkannya ke episode yang benar. Kalau episode itu sudah punya mark, yang lebih baru dipertahankan.

**Judul dalam bahasa lain.** Netflix (dan situs lain) bisa menampilkan judul terjemahan, misalnya "Hal-Hal Aneh" untuk Stranger Things. Supaya tetap jadi satu sheet:
- **Identitas, bukan judul.** Sheet dianggap sama kalau terhubung ke entri katalog yang sama atau berbagi ID lintas katalog (AniList, MyAnimeList, IMDb, TVmaze, Netflix, Wikidata). Sheet ganda yang ketahuan sama digabung, dan mark terbaru menang per episode.
- **ID dari situsnya.** ID acara Netflix dan ID TMDB di URL Movy (`/tv/1399`) sama di semua bahasa. Extension mencarinya di Wikidata untuk mendapatkan ID katalognya.
- **Judul terjemahan lain** dicari di Wikidata dalam bahasa halaman itu (`<html lang>`).
- **Tidak ada sheet ganda saat masih mencari.** Untuk judul yang belum pernah dilihat, penyimpanan ditahan sampai 15 detik sambil identitasnya dicek. Popup menulis "Checking whether you've watched this under another title…".
- **Semua aksara didukung.** Judul berhuruf Thailand, Korea, Rusia, Arab, Vietnam, dan lainnya masing-masing punya sheet sendiri. Nomor episode dan season dikenali dalam banyak bahasa: "Tập 5", "ตอนที่ 5", "5화", "Серия 5", "Capítulo 5", "Folge 5", "5. Bölüm", "第5話", "Phần 2", "시즌 2", "Staffel 2", dan seterusnya.
- **Di halaman berbahasa non-Inggris**, label Wikidata yang persis sama dicek lebih dulu, karena katalog kadang punya acara lain yang kebetulan berjudul terjemahan yang sama. Kalau Wikidata tidak menjawab, hasilnya ditandai *best guess*.
- **Kalau tetap tidak ketemu**, koreksi judulnya sekali di popup. Judul terjemahan itu diingat dan sheet-nya digabung.

**Sync antar situs.** Timestamp yang dipakai selalu mark terbaru dari situs mana pun. Contoh: kamu berhenti di 02:34 di Netflix, lalu membuka episode yang sama di situs B.
- Dengan *Sync to my mark on other sites* aktif (default), begitu video di situs B mulai main, player langsung lompat ke 02:34. Muncul kartu kecil "Synced to 02:34 from netflix.com" dengan tombol **Undo** (kembali ke posisi awal dan mulai mencatat dari sana).
- Kalau setelan itu dimatikan, kartu menawarkan **Sync to 02:34**. Tombol yang sama juga ada di popup.
- Halaman yang posisinya *di belakang* mark tidak akan menimpa mark sampai ia sync. Jadi 0:05 di situs B tidak menghapus 02:34. Kalau memang mau mulai ulang di situ, tekan **Mark now**.
- Resume mendarat tepat di detik yang tersimpan (tanpa mundur beberapa detik), dan detik disimpan dengan pembulatan ke bawah seperti yang ditampilkan player.
- Di Netflix, seek dilakukan lewat API player Netflix (`main-world.js`), karena mengubah waktu `<video>` secara langsung membuat Netflix error (M7375).

**Sinkron ke website.** `bridge.js` hanya aktif di `localhost`, `127.0.0.1`, dan `file://`, dan hanya pada halaman yang punya atribut `<html data-kumostamp-app>`. Bridge mengirim database ke halaman dan meneruskan perubahan dari website ke background worker, yang menjadi satu-satunya penulis data. Tanpa extension, website tetap jalan dan menyimpan ke `localStorage` (mark itu dipindahkan ke extension setelah extension terpasang).

**Sinkron ke AniList.** Opsional, dihubungkan lewat popup (*Connected accounts*). Begitu sebuah episode diputar sekitar 1 menit, Kumostamp menandainya *Watching* di list AniList kamu (progres = episode yang sedang diputar). Selesai menonton tidak mengirim apa pun; status *Completed* di episode terakhir kamu set sendiri di AniList. Setiap pembaruan dan menampilkan kartu kecil *AniList updated · Dandadan 3/12* dengan tombol **Undo**.
- **Hanya satu arah dan hanya naik.** Progres yang sudah di AniList tidak pernah diturunkan, dan entri yang sedang *Rewatching* tidak disentuh. Kumostamp tidak pernah menandai *Completed*.
- **Hanya series yang terhubung ke AniList.** Series dari TVmaze atau IMDb dilewati. Season yang nomornya berlanjut (Ep 29 yang sebenarnya S2 Ep 5) belum didukung.
- **Gagal karena jaringan akan dicoba lagi** otomatis (antrean di `chrome.storage.local`). Kalau login kedaluwarsa, popup menampilkan *Reconnect*.
- **Token** disimpan hanya di extension, tidak ikut export dan tidak pernah dikirim ke website. Login memakai Client ID AniList milik kamu sendiri; redirect URL-nya tampil di popup.

**Poster & info otomatis.** Begitu sebuah series pertama kali tersimpan, background extension langsung mencari info di katalog (sekitar 1 detik), tanpa perlu membuka website. Hasilnya tampil di popup (poster, sinopsis, jumlah episode) dan di website. Saat extension di-install atau browser dibuka, series lama yang belum punya info ikut dicarikan. Tanpa extension, website yang mencarikan.

Jenisnya (anime, serial TV, atau film) tidak ditebak di depan. AniList dan TVmaze dicari sekaligus (AniList dan IMDb untuk film), lalu tiap kandidat diberi skor dari:
- kemiripan judul, termasuk judul alternatif dan urutan kata;
- film atau episode (film hanya ke entri movie, episode tidak pernah ke movie);
- nomor episode dibanding jumlah episode entri (Ep 4 tidak cocok ke entri 1 episode);
- durasi video dibanding durasi katalog;
- situs streaming (situs khusus anime memberi bonus ke AniList).

Kalau dua kandidat teratas berdekatan, yang terbaik tetap dipakai tapi ditandai *best guess*, dan popup maupun website menawarkan **Not this one?** berisi 2–3 alternatif yang bisa diganti sekali klik. Logika ini ada di `extension/lib/catalog.js` dan dipakai bersama oleh extension dan website (disalin ke `web/src/lib/catalog-shared.js` oleh `scripts/sync-shared.mjs`).

**Info series.** Tombol *Add series* mencari di:
- **AniList** (GraphQL, tanpa API key) untuk anime
- **TVmaze** (tanpa API key) untuk serial TV
- **IMDb via Cinemeta** (tanpa API key, dari Stremio) untuk film: poster IMDb, sinopsis, durasi, sutradara, rating IMDb
- **Just a title** untuk input manual tanpa katalog

Sinopsis, poster, jumlah episode, dan status disimpan bersama series. Tombol ⟳ di tiap sheet mengambil deskripsi terbaru, dan website otomatis me-refresh info yang lebih tua dari 3 hari (maksimal 8 per kunjungan, satu per satu).


## Struktur

```
kumotstamp/
├─ extension/
│  ├─ manifest.json
│  ├─ background.js      satu-satunya penulis database (chrome.storage.local)
│  ├─ content.js         deteksi video + judul, kartu resume
│  ├─ bridge.js          penghubung ke website (khusus origin lokal)
│  ├─ popup.html/css/js
│  ├─ tokens.css         ← disalin dari web/css/tokens.css
│  ├─ lib/core.js        parsing judul + operasi data (sumber utama)
│  ├─ lib/accounts.js    login AniList (token hanya di worker)
│  ├─ lib/anilist-sync.js antrean + push progres ke AniList, Undo
│  └─ icons/
├─ extension/detect.js   urutan pembaca judul/episode + jejak diagnosa
├─ extension/main-world.js  pembaca state player (Netflix) di dunia JS halaman
├─ web/                  React + Vite + TypeScript
│  ├─ index.html
│  └─ src/
│     ├─ main.tsx · App.tsx
│     ├─ routes/        Library.tsx · SeriesPage.tsx
│     ├─ components/    TitleBlock · AddPanel · ContinueBand · Sheet · Ruler · Icon · ui (toast, panel)
│     ├─ lib/           ks.ts (tipe) · core.js (salinan) · store.ts · catalog.ts · sample.ts
│     └─ styles/        tokens.css (sumber utama token desain) · app.css
├─ scripts/
│  ├─ sync-shared.mjs    salin core.js & tokens.css di antara kedua bagian
│  └─ render-icons.mjs   render ikon PNG extension (16–128 px) dari logo
└─ PRODUCT.md
```

Setelah mengedit `extension/lib/core.js` atau `web/css/tokens.css`, jalankan:

```bash
node scripts/sync-shared.mjs
```

## Bentuk data

```json
{
  "version": 1,
  "series": {
    "jojos-bizarre-adventure-stone-ocean": {
      "title": "JoJo's Bizarre Adventure: Stone Ocean",
      "meta": { "source": "anilist", "id": 131942, "synopsis": "…", "episodes": 12, "fetchedAt": 0 },
      "episodes": {
        "2": {
          "episode": 2, "time": 1574, "duration": 1440, "finished": false,
          "lastHost": "situs-b.example",
          "providers": { "situs-b.example": { "url": "https://…", "time": 1574 } }
        }
      }
    }
  },
  "aliases": { "jojo-no-kimyou-na-bouken-stone-ocean": "jojos-bizarre-adventure-stone-ocean" }
}
```

Export/import di website menggunakan format ini. Saat import digabung, mark yang lebih baru yang dipakai.

## Batasan

- Situs yang memutar video lewat plugin non-HTML5 atau canvas DRM tertutup tidak bisa dibaca.
- Judul diambil dari halaman, jadi kadang perlu dikoreksi sekali per situs.
- Jump-to-time memindahkan `currentTime` pada video; beberapa player custom bisa menimpanya. Kalau begitu, salin waktunya (tombol *Copy*) dan seek manual.

## Logo

Huruf **K** yang lengan dan kakinya adalah dua jarum jam, berayun dari batangnya di dalam setengah dial. Kakinya berwarna merah pensil: tempat kamu berhenti.

- `web/public/logo.svg`: logo utama, tinta di atas terang.
- `web/public/favicon.svg`: favicon, ikut mode gelap.
- `web/src/components/Logo.tsx`: komponen React. Warnanya `currentColor`, jadi otomatis ikut tema.
- `extension/icons/icon{16,32,48,128}.png`: ikon toolbar, logo di atas kertas timesheet. Render ulang dengan `node scripts/render-icons.mjs` (butuh Edge atau Chrome).


## Rencana berikutnya

- **Sinkron ke profil MyAnimeList / AniList.** Episode yang selesai ditonton otomatis ditandai di list kamu. Butuh login OAuth ke MAL/AniList, jadi extension akan menyimpan token akun. Ini pertama kalinya Kumostamp menyimpan sesuatu di luar browser, jadi cakupannya perlu diputuskan dulu.
- **Tes otomatis.** Sejauh ini pengujian masih berupa simulasi ad-hoc (Node untuk `background.js`, Edge headless untuk deteksi, seek, dan tangkapan layar). Rencananya dijadikan test suite yang bisa dijalankan ulang, misalnya Vitest untuk `core.js`/`catalog.js` dan Playwright untuk alur extension.
