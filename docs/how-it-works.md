# Cara kerja Kumostamp

## Deteksi

`content.js` berjalan di setiap frame dan memilih `<video>` terbesar yang sedang diputar (durasi lebih dari 45 detik). Posisinya dikirim ke background worker setiap ~4 detik, juga saat pause, seek, ganti tab, dan saat halaman ditutup.

`detect.js` membaca judul dan episode dari sumber yang paling bisa dipercaya dulu:

1. State player di halaman (`main-world.js`). Netflix menyimpan judul, season, dan episode di `netflix.appContext`, sedangkan `document.title` cuma "Netflix".
2. DOM player per situs: Netflix, Prime Video, Disney+/Hotstar, Crunchyroll, YouTube.
3. JSON-LD `TVEpisode` / `Movie`.
4. Judul player dengan label episode di bawahnya, misalnya `<h1>Dandadan</h1><p>E3 · 23m</p>`.
5. Media Session (`navigator.mediaSession.metadata`).
6. Angka di akhir alamat: `/anime/dandadan-lzcmw/3` jadi episode 3, `/tv/1399/2/3` jadi season 2 episode 3. Angka setelah kata jenis (`/tv/1399`, `/movie/550`) dianggap ID.
7. Parameter URL (`?season=1&episode=3`, juga `s`, `ep`, `episode_number`) dan path `/movie/…` atau `/film/…`.
8. Judul halaman, `og:title`, `<h1>`, dan URL, lewat `KS.parseMedia`:

| Judul halaman | Hasil |
|---|---|
| `Nonton Jojo no Kimyou na Bouken Part 6 Episode 2 Sub Indo \| Otakudesu` | Jojo no Kimyou na Bouken Part 6 · Ep 2 |
| `Frieren - 05 [1080p]` | Frieren · Ep 5 |
| `Breaking Bad S02E05 \| Netflix` | Breaking Bad Season 2 · Ep 5 |
| `葬送のフリーレン 第3話` | 葬送のフリーレン · Ep 3 |
| URL `/watch/jojo-part-6-episode-12` | Jojo Part 6 · Ep 12 |

Hanya deteksi yang yakin (atau koreksi kamu) yang disimpan otomatis. Halaman navigasi seperti "Beranda", "Browse", atau "Home" tidak pernah dianggap judul. Tebakan yang lemah ditampilkan di popup; tekan Enter (atau Mark now) untuk mengonfirmasi.

Kalau deteksi gagal, buka popup lalu klik *How this was detected*. Bagian itu menampilkan hasil setiap pembaca, misalnya `page-title: nothing`. Kirim isinya kalau ada situs yang belum terbaca.

### Situs yang ganti episode tanpa pindah halaman

- Begitu pemutar memuat media baru (`loadstart` / `emptied`, juga dari iframe), penyimpanan ditahan sampai 5 detik dan halaman induk membaca ulang judul dan episodenya.
- Perubahan judul, heading, atau label episode memicu pembacaan ulang dalam kurang dari 1 detik.
- Jawaban yang yakin hanya dipakai selama judul dan heading halaman masih sama seperti saat dibaca.
- Posisi video dari episode sebelumnya dibuang saat halaman menyebut episode lain.
- Koreksi manual di popup gugur begitu halaman dengan yakin menyebut episode lain.
- Banyak situs hanya menulis `og:title` dan JSON-LD saat halaman pertama dimuat (contoh: reanime.to). Episode dari URL (`?ep=3`) dan `<title>` yang hidup menang atas keduanya.

### Kalau nomor episode tidak terbaca

Setiap hasil deteksi punya jenis: *episode*, *film* (sumbernya sendiri bilang film), atau *unknown* (series ketemu, nomornya tidak).

- *Unknown* tidak pernah disimpan atau di-sync otomatis. Popup menulis "Found the series, not the episode number". Ketik nomornya lalu Enter, atau kosongkan Ep kalau memang film.
- Halaman yang mengaku film ditolak kalau series itu sudah punya episode bernomor, atau katalognya bilang lebih dari 1 episode.
- Sync hanya ke episode yang sama persis.
- Mark lama tanpa nomor ditandai `??` di website. Isi "Which one?" lalu Move untuk memindahkannya.

### Judul dalam bahasa lain

Netflix bisa menampilkan judul terjemahan, misalnya "Hal-Hal Aneh" untuk Stranger Things. Supaya tetap jadi satu sheet:

- Sheet dianggap sama kalau terhubung ke entri katalog yang sama atau berbagi ID lintas katalog (AniList, MyAnimeList, IMDb, TVmaze, Netflix, Wikidata). Sheet ganda digabung, mark terbaru menang per episode.
- ID acara Netflix dan ID TMDB di URL (`/tv/1399`) sama di semua bahasa. Extension mencarinya di Wikidata untuk mendapat ID katalog.
- Judul terjemahan dicari di Wikidata dalam bahasa halaman (`<html lang>`). Di halaman non-Inggris, label Wikidata yang persis sama dicek lebih dulu. Kalau Wikidata tidak menjawab, hasilnya ditandai *best guess*.
- Untuk judul yang belum pernah dilihat, penyimpanan ditahan sampai 15 detik sambil identitasnya dicek.
- Nomor episode dan season dikenali dalam banyak bahasa: "Tập 5", "ตอนที่ 5", "5화", "Серия 5", "Capítulo 5", "Folge 5", "第5話", "Staffel 2".
- Kalau tetap tidak ketemu, koreksi judulnya sekali di popup. Koreksi disimpan sebagai *alias*, jadi kunjungan berikutnya otomatis masuk ke series yang benar.

## Resume dan sync antar situs

Saat kamu membuka episode yang sudah punya mark (minimal 30 detik dan belum selesai), muncul kartu *Jump to 26:14* di pojok kiri bawah. Popup punya tombol yang sama.

Kumostamp menyimpan satu mark per situs untuk tiap episode, dan sync mengikuti mark terbaru, bukan yang terjauh.

- Dengan *Sync to my mark on other sites* aktif (default), player di situs B langsung lompat ke mark terbaru begitu mulai main. Kartu "Synced to 02:34 from netflix.com" punya tombol Undo.
- Kalau setelan itu mati, kartunya berisi tombol *Sync to 02:34*.
- Halaman yang posisinya di belakang mark tidak menimpa mark sampai ia sync, jadi 0:05 di situs B tidak menghapus 02:34. Untuk mulai ulang di situ, tekan Mark now.
- Popup menampilkan *Saved marks*: semua situs untuk episode itu, dengan label Latest dan Furthest. Jump memindahkan video di tab ini, Open membuka episode di situs tersebut.
- Kalau ada mark lain yang lebih jauh lebih dari 1 menit, kartu di halaman juga menampilkannya: *Also 14:56 on B*.
- Di Netflix, seek lewat API player Netflix, karena mengubah `currentTime` langsung membuat Netflix error (M7375).

## Website dan extension

`bridge.js` hanya aktif di halaman yang punya `<html data-kumostamp-app>`, dan hanya memberi data ke origin yang dipercaya: `localhost`, `127.0.0.1`, `file://`, atau *Library address* yang kamu set di popup. Bridge meneruskan perubahan dari website ke background worker, satu-satunya penulis data. Tanpa extension, website menyimpan ke `localStorage`, dan mark itu dipindahkan ke extension setelah extension terpasang.

## Sinkron akun

Setelah login MyAnimeList (`/login`), website menggabungkan library di browser ini dengan salinan di server, lalu menyimpan hasilnya ke keduanya.

- Penggabungannya sama seperti import: mark terbaru menang per episode, mark per situs digabung, info katalog dan judul yang lebih baru ikut menang.
- Penghapusan dicatat beserta waktunya (`removed`), jadi salinan lama di browser lain tidak menghidupkannya lagi. Menonton lagi setelah dihapus membuatnya muncul kembali.
- Website sinkron sekitar 2 detik setelah ada perubahan, saat tab aktif lagi, dan setiap menit.
- Extension bisa sinkron sendiri: popup, *Connected accounts*, *Kumostamp*, Connect. Extension menyimpan *device token* (hanya di background worker) lalu mengirim mark baru paling lambat ~30 detik dan menarik mark dari browser lain tiap 2 menit. Disconnect mencabut token di server juga.

## List MyAnimeList

Server memperbarui list MAL memakai token MAL milikmu, setiap kali library tersinkron dan sekali saat website dibuka.

- Episode yang diputar minimal 1 menit dalam 30 hari terakhir membuat anime itu *Watching*, dengan progres = nomor episode.
- Progres tidak pernah diturunkan, entri *Completed* dan yang sedang *rewatching* tidak disentuh, dan *Completed* tidak pernah di-set.
- Hanya series yang terhubung ke AniList atau MyAnimeList. AniList memblokir request dari Cloudflare Workers, jadi browser yang mengambil `idMal` lalu menyimpannya sebagai `meta.malId`.
- Episode yang nomornya melebihi jumlah episode entri dilewati (season yang nomornya berlanjut).
- Hasilnya tampil di header, misalnya *MyAnimeList: Frieren → 3/28*. Token MAL di-refresh otomatis.

## List AniList

Opsional, dihubungkan lewat popup (*Connected accounts*), memakai Client ID AniList milikmu sendiri. Begitu episode diputar sekitar 1 menit, Kumostamp menandainya *Watching* di AniList dan menampilkan kartu *AniList updated · Dandadan 3/12* dengan tombol Undo.

- Satu arah dan hanya naik; entri *Rewatching* tidak disentuh, *Completed* kamu set sendiri.
- Gagal karena jaringan dicoba lagi otomatis (antrean di `chrome.storage.local`). Kalau login kedaluwarsa, popup menampilkan Reconnect.
- Token hanya di extension, tidak ikut export dan tidak pernah dikirim ke website.

## Info katalog

Begitu series pertama kali tersimpan, background extension mencari info di katalog tanpa perlu membuka website. Series lama yang belum punya info dicarikan saat extension di-install atau browser dibuka.

Jenisnya (anime, serial TV, film) tidak ditebak di depan. AniList dan TVmaze dicari sekaligus (AniList dan IMDb untuk film), lalu tiap kandidat diberi skor dari kemiripan judul, film atau episode, nomor episode dibanding jumlah episode entri, durasi video dibanding durasi katalog, dan jenis situs streaming.

Kalau dua kandidat teratas berdekatan, yang terbaik dipakai tapi ditandai *best guess*, dan di popup maupun website ada tombol *Not this one?* berisi 2 sampai 3 alternatif.

*Add series* di website mencari di AniList (anime), TVmaze (serial TV), IMDb lewat Cinemeta (film), atau *Just a title* tanpa katalog. Tombol ⟳ di tiap sheet mengambil info terbaru, dan website me-refresh info yang lebih tua dari 3 hari (maksimal 8 per kunjungan).

## Bentuk data

```json
{
  "version": 1,
  "series": {
    "jojos-bizarre-adventure-stone-ocean": {
      "title": "JoJo's Bizarre Adventure: Stone Ocean",
      "meta": { "source": "anilist", "id": 131942, "malId": 48661, "episodes": 12, "fetchedAt": 0 },
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

Export/import di website memakai format ini. Saat import digabung, mark yang lebih baru yang dipakai.

## Cakupan deteksi

Belum diukur: belum ada daftar situs uji atau tes otomatis. Yang sudah diketahui:

- Netflix, Prime Video, Disney+, Crunchyroll, dan YouTube punya pembaca khusus. Selector DOM Prime dan Disney+ bisa berubah tanpa pemberitahuan.
- Situs yang menulis judul dan episode di judul halaman, `<h1>` dengan label, atau URL (Otakudesu, Movy, dan sejenisnya) ditangani oleh pola umum.
- Belum terbaca: nomor episode yang hanya ada di tombol daftar, judul yang dimuat belakangan lewat JavaScript, atau teks di dalam gambar.
- Player di iframe lintas-origin dengan halaman induk tanpa info: videonya terbaca, judulnya tidak.

## Logo

Huruf K yang lengan dan kakinya adalah dua jarum jam, berayun dari batangnya di dalam setengah dial. Kakinya berwarna merah pensil: tempat kamu berhenti.

- `web/public/logo.svg`: logo utama, tinta di atas terang.
- `web/public/favicon.svg`: favicon, ikut mode gelap.
- `web/src/components/Logo.tsx`: komponen React, warnanya `currentColor`.
- `extension/icons/icon{16,32,48,128}.png`: render ulang dengan `node scripts/render-icons.mjs` (butuh Edge atau Chrome).
