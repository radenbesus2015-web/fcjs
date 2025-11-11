# Panduan Deployment ke Vercel

Dokumen ini menjelaskan cara mengkonfigurasi dan mendeploy aplikasi Next.js ke Vercel dengan backend terpisah.

## ⚠️ KONFIGURASI ROOT DIRECTORY (WAJIB!)

**MASALAH:** Vercel mendeteksi folder `backend/` dan mencoba build sebagai FastAPI, padahal yang perlu di-deploy hanya frontend Next.js.

### ✅ SOLUSI: Set Root Directory di Vercel Dashboard

**INI WAJIB DILAKUKAN!** File `vercel.json` tidak cukup, Anda HARUS set Root Directory di Dashboard:

1. Buka **Vercel Dashboard** → Pilih project Anda
2. Klik **Settings** (di menu atas)
3. Scroll ke bagian **"General"**
4. Cari **"Root Directory"**
5. Klik **"Edit"** dan set ke: `FunMeter/frontend`
6. Klik **"Save"**
7. **Redeploy** project (atau push commit baru untuk trigger auto-deploy)

**Setelah ini, Vercel akan hanya build dari folder `FunMeter/frontend` dan tidak akan mendeteksi backend.**

### File Pendukung

File-file berikut sudah dibuat untuk membantu:
- `vercel.json` (root) - Konfigurasi build
- `.vercelignore` (root) - Ignore backend folder

Tapi **tetap harus set Root Directory di Dashboard** untuk hasil yang optimal.

## Environment Variables

Tambahkan environment variables berikut di Vercel Dashboard (Settings > Environment Variables):

### Wajib untuk Production

```bash
# URL backend production (tanpa trailing slash)
NEXT_PUBLIC_BACKEND_URL=https://your-backend-domain.com

# Atau jika backend di subdomain yang sama
NEXT_PUBLIC_BACKEND_URL=https://api.yourdomain.com

# Untuk WebSocket (opsional, jika berbeda dari HTTP)
NEXT_PUBLIC_WS_HTTP_BASE=wss://your-backend-domain.com

# TLS Connection (auto | secure | insecure)
NEXT_PUBLIC_TLS_CONNECTION=auto
```

### Opsional

```bash
# Supabase (jika menggunakan Supabase)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

## Konfigurasi Backend

Pastikan backend FastAPI Anda:

1. **CORS Configuration**: Update `allow_origins` di `main_fastapi.py` untuk mengizinkan domain Vercel Anda:

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://your-app.vercel.app",
        "https://your-custom-domain.com",
        # Tambahkan domain production Anda di sini
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

2. **Deploy Backend**: Deploy backend ke platform yang mendukung Python (Railway, Render, Fly.io, dll)

## Cara Kerja API Routes

### Development
- Menggunakan Next.js rewrites untuk proxy langsung ke `localhost:8000`
- Tidak perlu konfigurasi khusus

### Production
- Semua request ke `/admin/*`, `/auth/*`, `/register-face/*`, dll akan di-proxy melalui `/api/*` routes
- API routes akan forward request ke backend URL yang dikonfigurasi di `NEXT_PUBLIC_BACKEND_URL`

## Contoh Request Flow

### Development
```
Frontend → /admin/dashboard-data → (rewrite) → http://localhost:8000/admin/dashboard-data
```

### Production
```
Frontend → /api/admin/dashboard-data → (API route) → https://your-backend.com/admin/dashboard-data
```

## Testing

Setelah deploy, test endpoint berikut:

1. **Health Check**: `https://your-app.vercel.app/api/health`
2. **Admin Dashboard**: Login dan akses dashboard
3. **Register Face**: Test registrasi wajah baru
4. **List Members**: Pastikan foto ter-load dengan benar

## Troubleshooting

### Error: "Failed to fetch" atau CORS error
- Pastikan `NEXT_PUBLIC_BACKEND_URL` sudah dikonfigurasi dengan benar
- Pastikan backend CORS sudah mengizinkan domain Vercel Anda
- Cek Network tab di browser untuk melihat request yang gagal

### Foto tidak ter-load
- Pastikan `NEXT_PUBLIC_BACKEND_URL` mengarah ke backend yang benar
- Pastikan backend mengembalikan URL foto yang valid
- Cek konfigurasi Supabase Storage (jika menggunakan)

### API routes tidak bekerja
- Pastikan file `app/api/[...path]/route.ts` sudah ada
- Cek logs di Vercel untuk error di server-side
- Pastikan `NEXT_PUBLIC_BACKEND_URL` sudah dikonfigurasi

## Catatan Penting

1. **Jangan hardcode URL**: Semua URL harus menggunakan `resolveApi()` atau environment variables
2. **Authorization Headers**: Pastikan Authorization header di-forward dengan benar
3. **FormData**: API routes sudah mendukung FormData untuk upload file
4. **WebSocket**: Untuk WebSocket, pastikan `NEXT_PUBLIC_WS_HTTP_BASE` dikonfigurasi dengan benar

## Deployment Checklist

- [ ] Set environment variables di Vercel
- [ ] Update CORS di backend untuk mengizinkan domain Vercel
- [ ] Deploy backend ke production
- [ ] Test semua fitur utama setelah deploy
- [ ] Monitor logs untuk error
- [ ] Setup custom domain (opsional)

