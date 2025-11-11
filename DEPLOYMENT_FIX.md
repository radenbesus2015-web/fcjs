# 🔧 FIX: Error "No fastapi entrypoint found" di Vercel

## Masalah
Vercel mendeteksi folder `backend/` dan mencoba build sebagai FastAPI, padahal yang perlu di-deploy hanya frontend Next.js.

## ✅ SOLUSI WAJIB

### Langkah 1: Set Root Directory di Vercel Dashboard

**INI HARUS DILAKUKAN!** Tanpa ini, Vercel akan selalu mendeteksi backend.

1. Buka **https://vercel.com/dashboard**
2. Pilih project Anda
3. Klik **"Settings"** (di menu atas)
4. Scroll ke bagian **"General"**
5. Cari **"Root Directory"**
6. Klik **"Edit"** (atau "Override" jika sudah ada)
7. Ketik: `FunMeter/frontend`
8. Klik **"Save"**
9. Klik **"Deployments"** → Pilih deployment terbaru → **"Redeploy"**

### Langkah 2: Commit dan Push File Konfigurasi

Pastikan file berikut sudah di-commit dan push:

```bash
git add vercel.json .vercelignore FunMeter/frontend/vercel.json
git commit -m "Fix: Configure Vercel to only build frontend Next.js"
git push
```

### Langkah 3: Verifikasi

Setelah set Root Directory dan redeploy, build log harusnya menunjukkan:
- ✅ Framework: Next.js
- ✅ Build Command: `npm run build`
- ❌ TIDAK ada error "No fastapi entrypoint found"

## File yang Sudah Dibuat

1. `vercel.json` (root) - Konfigurasi build untuk Next.js
2. `.vercelignore` (root) - Ignore backend folder
3. `FunMeter/frontend/vercel.json` - Konfigurasi Next.js

## Catatan Penting

- **Root Directory HARUS di-set di Dashboard** - File `vercel.json` saja tidak cukup
- Setelah set Root Directory, Vercel akan hanya scan folder `FunMeter/frontend`
- Backend folder akan diabaikan sepenuhnya
- Tidak perlu deploy backend ke Vercel (deploy ke platform lain seperti Railway, Render, dll)

## Troubleshooting

Jika masih error setelah set Root Directory:

1. Pastikan Root Directory sudah di-set ke `FunMeter/frontend` (bukan `FunMeter/frontend/`)
2. Pastikan sudah redeploy setelah set Root Directory
3. Cek Build Logs - harusnya tidak ada deteksi FastAPI
4. Pastikan file `FunMeter/frontend/package.json` ada dan valid

