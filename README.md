# IDX ISSI Screener — Setup Guide

Screener sinyal saham IDX ISSI dari grup Telegram "Zeta IDX Signal". Paste teks
sinyal (dari desktop maupun HP), otomatis di-parsing, di-cross-check ke daftar
saham ISSI (halal), lalu disimpan & ditampilkan sebagai kartu.

**Zero npm/Node.js** — semua akses Firestore pakai REST API murni lewat
`fetch()`, jadi nggak ada `package.json`, nggak perlu `npm install`. Cukup push
folder ini ke GitHub dan connect ke Cloudflare Pages.

> Konsekuensi: karena nggak ada build step, kamu nggak bisa preview lokal pakai
> `wrangler pages dev`. Testing dilakukan langsung di Preview deployment
> Cloudflare (tiap push ke branch non-main otomatis dapat URL preview sendiri).

## 1. Buat Firebase Project + Service Account

1. Buka https://console.firebase.google.com → **Add project** → kasih nama, misal `idx-issi-screener`.
2. Di sidebar klik **Build → Firestore Database** → **Create database** → mode **Production** → region `asia-southeast2` (Jakarta).
3. Di tab **Rules**, kunci akses langsung dari browser (semua akses lewat backend Cloudflare Function pakai Service Account, bukan dari client):
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /{document=**} {
         allow read, write: if false;
       }
     }
   }
   ```
4. Klik ikon **gear ⚙️ → Project settings → Service accounts** → klik **Generate new private key** → akan ter-download file JSON, isinya kira-kira:
   ```json
   {
     "project_id": "idx-issi-screener",
     "private_key": "-----BEGIN PRIVATE KEY-----\nMII...\n-----END PRIVATE KEY-----\n",
     "client_email": "firebase-adminsdk-xxxxx@idx-issi-screener.iam.gserviceaccount.com"
   }
   ```
   **Simpan file ini baik-baik, jangan pernah di-commit ke GitHub** — ini kredensial penuh ke Firestore project kamu.
5. Tentukan juga satu **admin key** bebas (string acak, misal hasil dari https://www.uuidgenerator.net/) — dipakai buat lock endpoint yang bisa nulis data (parse sinyal & kelola daftar ISSI), biar nggak sembarang orang yang tahu URL bisa spam/ubah data. Simpan string ini, nanti diisi ke env var `ADMIN_KEY`.

## 2. Upload ke GitHub (full lewat browser, tanpa Git/terminal)

1. Buka https://github.com/new → kasih nama repo (misal `idx-issi-screener`) → **centang "Add a README file"** → **Create repository**.
2. Di halaman repo, klik **Add file → Create new file**.
3. Di kotak nama file, ketik path lengkapnya sekalian — GitHub otomatis bikin foldernya. Contoh: ketik `functions/lib/parser.js`, itu otomatis bikin folder `functions/lib/` isinya `parser.js`.
4. Paste isi file ke kotak besar di bawahnya.
5. Scroll ke bawah, klik **Commit changes**.
6. Ulangi langkah 2-5 untuk semua file berikut (nama path harus persis, karena kode saling `import` berdasarkan lokasi ini):
   - `functions/lib/parser.js`
   - `functions/lib/firestore.js`
   - `functions/api/parse-signal.js`
   - `functions/api/signals.js`
   - `functions/api/issi-list.js`
   - `index.html`
   - `style.css`
   - `app.js`
   - `.gitignore`
   - `README.md` → **timpa isi README bawaan GitHub** dengan isi README ini (klik file `README.md` yang sudah ada di repo → ikon pensil ✏️ **Edit** → hapus semua isinya → paste isi README ini → **Commit changes**)

## 3. Deploy ke Cloudflare Pages

1. Login ke https://dash.cloudflare.com → sidebar **Workers & Pages** → **Create application** → tab **Pages** → **Connect to Git**.
2. Kalau belum pernah connect GitHub ke Cloudflare, klik **Connect GitHub**, authorize, lalu pilih repo `idx-issi-screener` saja (nggak perlu kasih akses ke semua repo).
3. Pilih repo → **Begin setup**.
4. Di halaman **Set up builds and deployments**:
   - **Production branch**: `main`
   - **Framework preset**: **None**
   - **Build command**: kosongkan
   - **Build output directory**: `/` (root — karena `index.html`, `style.css`, `app.js` sekarang langsung di root repo, bukan di folder `public/`)
5. Scroll ke **Environment variables (advanced)** — isi sebelum klik deploy:
   | Variable name | Value |
   |---|---|
   | `FIREBASE_PROJECT_ID` | dari `project_id` di file JSON service account |
   | `FIREBASE_CLIENT_EMAIL` | dari `client_email` |
   | `FIREBASE_PRIVATE_KEY` | dari `private_key` (paste apa adanya, termasuk `\n` di dalamnya) |
   | `ADMIN_KEY` | string acak yang kamu tentukan sendiri di langkah 1.5 |
6. Klik **Save and Deploy**. Tunggu ~30 detik-1 menit, nanti muncul link `https://nama-project.pages.dev`.
7. Kalau env var salah/lupa: **Settings → Environment variables** → edit → **Save**, lalu **Deployments** → titik tiga di deployment terakhir → **Retry deployment** (setting env var nggak auto-redeploy).
8. Custom domain (misal `myissi.anyapp.my.id`): project → **Custom domains** → **Set up a custom domain** → ketik domain-nya → ikuti instruksi CNAME yang muncul di pengaturan DNS domain kamu.

## 4. Isi Daftar ISSI Pertama Kali

Setelah live, buka web app-nya → klik **"Kelola daftar ISSI"** di pojok kanan atas
→ paste semua kode ticker ISSI (satu per baris atau dipisah koma) → **Simpan**.
List ini disimpan di Firestore `config/issi_list` dan dipakai untuk cross-check
halal/non-halal setiap kali sinyal baru di-parse.

## Struktur Proyek

```
functions/
  api/
    parse-signal.js   -> POST: parse teks mentah + cross-check halal + simpan (butuh x-admin-key)
    signals.js        -> GET: ambil 50 sinyal terbaru (publik, read-only)
    issi-list.js      -> GET/POST: kelola daftar ticker ISSI (POST butuh x-admin-key)
  lib/
    parser.js         -> logika regex parsing teks Telegram -> object
    firestore.js      -> Firestore REST API client (fetch murni, auth via Service Account JWT)
index.html
style.css
app.js
```

## Autentikasi (Admin Key)

Endpoint yang bisa **menulis** data (`POST /api/parse-signal`, `POST /api/issi-list`)
dikunci pakai shared-secret header `x-admin-key`, dicocokkan dengan env var
`ADMIN_KEY` di Cloudflare Pages. Endpoint baca (`GET /api/signals`, `GET /api/issi-list`)
tetap terbuka karena datanya nggak sensitif.

Di sisi browser, `app.js` akan **prompt sekali** minta admin key pas pertama kali
kamu klik "Parse & Simpan" atau "Kelola daftar ISSI", lalu disimpan di
`localStorage` browser tersebut. Kalau salah, otomatis diminta ulang. Karena ini
dicek di URL request (bukan proteksi tingkat UI), siapapun yang tahu admin key
bisa akses lewat cara lain (curl dll) — cukup untuk mencegah orang iseng yang
cuma nemu URL-nya, bukan pengganti autentikasi penuh kalau nanti butuh
multi-user.

## Catatan Parser

Parser (`functions/lib/parser.js`) didesain toleran terhadap variasi format yang
sudah teramati antara Telegram Desktop dan Mobile:
- Header pemisah antar sinyal pakai `🇮🇩 ZETA IDX STOCK SIGNAL 🇮🇩` (konsisten di semua platform).
- Field `Confidence Score` bisa hilang total — di-handle sebagai `null`.
- Field `Bandarmology` kadang cuma teks status ("Data sedang maintenance") — disimpan sebagai `status`, field lain `null`.
- Label status RSI/MACD/dst kadang tanpa teks (cuma emoji) — di-handle sebagai optional.

Kalau nanti ketemu variasi format baru yang belum ke-cover, cukup update regex
di `parser.js` — struktur data lain nggak perlu berubah.

## Roadmap (belum dikerjakan)

- **Trading jurnal**: bot Zeta juga kirim sinyal konfirmasi (HIT TP/SL, dll). Rencana ke depan: parse sinyal konfirmasi ini, link ke sinyal awal by ticker, dan biarkan user input actual buy price manual → jadi trading journal (entry vs actual vs hasil).

## Catatan Keamanan

`FIREBASE_PRIVATE_KEY` adalah kredensial admin penuh ke Firestore project ini.
Jangan pernah commit file service account JSON ke git, dan jangan expose env
var ini ke sisi client — semua pemanggilan Firestore hanya boleh lewat
`functions/api/*.js` (server-side), bukan langsung dari `public/app.js`.
