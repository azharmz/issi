# IDX ISSI Screener — Ringkasan Progress & Workflow

## 1. Tujuan Project

Trading Workflow Manager pribadi (bukan SaaS/multi-user) untuk saham IDX ISSI
(syariah), berbasis sinyal dari bot Telegram "Zeta IDX Signal". Workflow penuh
yang dituju: Signal → Research → Decision → Execution → Journal → Analytics →
Research Dataset → AI Review (7 phase, mengikuti dokumen vision yang sudah
didiskusikan sebelumnya).

## 2. Tech Stack (final, sudah diputuskan)

- **Hosting:** Cloudflare Pages + Pages Functions
- **Frontend:** Vanilla HTML/CSS/JS, zero build step, zero npm/Node.js
- **Database:** Firebase Firestore, diakses via **REST API murni** (`fetch()`),
  auth pakai Service Account JWT (di-sign pakai Web Crypto API bawaan Workers)
- **Auth aplikasi:** shared-secret header (`x-admin-key`) buat endpoint yang
  bisa nulis data — bukan Firebase Auth / login user beneran
- **Workflow deploy:** push ke GitHub (lewat browser, tanpa Git command) →
  Cloudflare Pages auto-deploy

> Catatan: sempat didiskusikan pakai Next.js + Firebase Auth + Firebase Hosting
> (saran dari AI lain), tapi ditolak karena nggak sesuai konteks project yang
> sudah dibangun dari awal dengan stack di atas.

## 3. Yang SUDAH selesai & sudah teruji

### Fitur aplikasi (jalan di produksi)
- Paste sinyal Telegram (manual) → auto-parse → cross-check daftar ISSI (halal)
  → simpan ke Firestore → tampil sebagai card
- Grid utama **default filter halal**, tapi ada toggle Halal/Non-halal/Semua
  untuk keperluan riset (data non-halal tetap tersimpan semua, cuma soal
  ditampilkan atau tidak di grid — prinsip "Never Throw Away Data")
- Modal "Tempel Sinyal" dan "Kelola ISSI" — muncul on-demand (bukan makan
  tempat permanen), bisa ditutup klik-luar atau Esc
- Ticker di card bisa diklik → langsung buka chart Stockbit di tab baru
- Timestamp per-sinyal: diekstrak dari header asli kalau ada (dikonversi dari
  WITA, bukan WIB — sesuai lokasi user), fallback ke jam parsing kalau nggak ada
- Auth admin key untuk endpoint yang bisa menulis data (parse & simpan sinyal,
  kelola daftar ISSI)
- Cap 30 sinyal per parse, biar nggak abuse

### Parser (logic murni, sudah diuji terhadap 948 pesan histori Telegram asli)
- **Parser sinyal WATCHLIST/BUY** — mendukung **3 varian format** yang
  ditemukan di histori (bot berubah format seiring waktu):
  - Format A (terbaru): Confidence Score, TP1 dengan %, SL 3-tier (Default/
    Moderat/Konservatif), Bandarmology lengkap
  - Format B (paling lama): tanpa Confidence Score, TP/SL cuma 1 angka,
    tanpa Bandarmology
  - Format C (menengah): ada Bandarmology (IPOT Broker Flow) tapi TP/SL masih
    1 angka, belum ada Confidence Score
  - Hasil test: **504/504 sinyal ter-parse benar** dari seluruh histori
- **Parser konfirmasi** — 3 jenis pesan (ongoing/profit naik, TP HIT, closed/
  profit terkunci), termasuk field baru "Call Watchlist" (timestamp sinyal
  asli, WIB, ditulis eksplisit oleh bot) dan "Durasi" yang baru dirilis bot.
  Hasil test: **430/430 konfirmasi ter-parse benar**
- **Parser Market Regime Prediction** — prediksi arah IHSG harian (BULLISH/
  BEARISH/NEUTRAL + index scoring + peringatan UMA/suspensi saham).
  Hasil test: **7/7 ter-parse benar**
- **Temuan penting:** bot **tidak pernah** mengirim konfirmasi HIT SL lewat
  Telegram (dicek: 0 dari 948 pesan mengandung frasa "SL HIT"). Data SL HIT
  cuma ada di trade history yang di-scrape user dari web journal provider.

### Sumber data historis yang sudah dianalisis (belum diimpor ke aplikasi)
- **Excel trade history** (hasil scrape user, 422 baris): kolom Date/Symbol/
  Signal-type/Entry/SL/TP/Status(TP HIT 258, EXPIRED 129, SL HIT 35)/Return
- **JSON export Telegram** (948 pesan, format resmi Telegram dengan timestamp
  akurat dari server per pesan): berisi semua sinyal + konfirmasi + regime
  di atas

## 4. Keputusan desain yang sudah dikonfirmasi user

- Semua sinyal (halal & non-halal) selalu disimpan; UI cuma filter tampilan
- Importer JSON perlu baca **ketiga format sinyal** (A/B/C), bukan cuma
  yang terbaru
- Market Regime Prediction ikut disimpan (tipe data terpisah) untuk riset
  korelasi regime vs performa sinyal nantinya
- Input tetap dua jalur: **copy-paste** untuk pemakaian harian (sinyal,
  konfirmasi, regime — volumenya kecil per hari), **upload file** khusus
  untuk bulk-import histori (JSON, Excel — sekali jalan di awal atau re-sync)
- Konfirmasi HIT SL yang tidak pernah dikirim bot akan diisi dari Excel
  trade history sebagai sumber otoritatif

## 5. Yang BELUM dikerjakan (PR selanjutnya, urutan prioritas kasar)

1. Firestore schema untuk collection `confirmations` dan `market_regime`
   (parser sudah ada, storage-nya belum)
2. Cross-reference logic: link Signal ↔ Confirmation ↔ Excel trade history
   (by ticker + entry price + timestamp)
3. Endpoint API untuk upload & proses JSON Telegram export dan Excel
4. UI upload file (belum ada tombol/textarea untuk konfirmasi & regime,
   baru ada untuk sinyal WATCHLIST)
5. UX fix yang sudah dicatat tapi belum dieksekusi:
   - Password diminta **sebelum** modal kebuka (bukan pas submit di dalamnya)
   - Ukuran menu topbar diperkecil untuk layar HP
6. Phase 3-7 dari roadmap besar: Execution (Ikut/Lewati/Pending/Filled),
   Journal (entry/exit/lot, P&L otomatis), Analytics (win rate, profit
   factor, drawdown, dst), Research Dashboard, AI Review

## 6. Pertanyaan terbuka untuk didiskusikan lagi

- Struktur Firestore untuk Confirmation/Execution/Journal — sub-collection di
  bawah tiap Signal document, atau collection terpisah? (perlu review hemat
  read/write karena Spark Plan/gratis)
- Bentuk final URL Stockbit sudah dikonfirmasi (`stockbit.com/symbol/{TICKER}/chartbit`)
- Apakah upload JSON/Excel prosesnya sinkron (langsung tunggu selesai) atau
  perlu semacam job/progress indicator mengingat volumenya besar (5MB JSON,
  bisa expand ke ribuan write Firestore)