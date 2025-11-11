# Environment Variables untuk Deployment

File ini menjelaskan environment variables yang diperlukan untuk deployment ke Vercel.

## Setup Environment Variables

### Di Vercel Dashboard

1. Buka project di [Vercel Dashboard](https://vercel.com/dashboard)
2. Pergi ke **Settings** > **Environment Variables**
3. Tambahkan variables berikut:

### Required Variables

#### 1. Backend URL (REQUIRED)

```bash
NEXT_PUBLIC_BACKEND_URL=https://your-backend.railway.app
```

**Penjelasan:**
- URL backend FastAPI yang sudah di-deploy
- Harus accessible dari internet (public URL)
- Contoh platform: Railway, Render, Fly.io, dll

**Contoh nilai:**
- `https://your-app.railway.app`
- `https://your-app.onrender.com`
- `https://api.yourdomain.com`

#### 2. WebSocket Base URL (REQUIRED)

```bash
NEXT_PUBLIC_WS_HTTP_BASE=your-backend.railway.app
```

**Penjelasan:**
- Base URL untuk WebSocket connection
- Biasanya sama dengan backend URL (tanpa `https://`)
- Atau bisa full URL: `https://your-backend.railway.app`

**Contoh nilai:**
- `your-app.railway.app` (recommended)
- `https://your-app.railway.app`
- `your-app.onrender.com`

#### 3. TLS Connection (Optional)

```bash
NEXT_PUBLIC_TLS_CONNECTION=auto
```

**Penjelasan:**
- Options: `auto` | `secure` | `insecure`
- `auto`: otomatis detect dari protocol (https -> wss, http -> ws)
- `secure`: selalu gunakan wss://
- `insecure`: selalu gunakan ws://
- Default: `auto`

### Optional Variables

#### Force API Routes

```bash
NEXT_PUBLIC_USE_API_ROUTES=true
```

**Penjelasan:**
- Force menggunakan `/api/` routes bahkan di development
- Default: auto-detect (production = true, development = false)
- Biasanya tidak perlu di-set manual

## Development Setup

Untuk development lokal, buat file `.env.local` di folder `frontend/`:

```bash
# .env.local
NEXT_PUBLIC_BACKEND_URL=http://localhost:8000
NEXT_PUBLIC_WS_HTTP_BASE=localhost:8000
NEXT_PUBLIC_TLS_CONNECTION=auto
```

## Catatan Penting

### 1. NEXT_PUBLIC_* Variables

Variables yang dimulai dengan `NEXT_PUBLIC_` adalah **PUBLIC** dan akan di-expose ke client-side browser. Jangan masukkan secrets/sensitive data di sini!

### 2. Backend Deployment

Backend FastAPI **harus di-deploy terpisah** karena:
- FastAPI memerlukan Python runtime yang terus berjalan
- Ada model ONNX yang perlu di-load ke memory
- Ada WebSocket (Socket.IO) yang perlu persistent connection
- Vercel serverless functions tidak cocok untuk use case ini

### 3. Rekomendasi Platform untuk Backend

#### Railway (Recommended)
- **URL:** https://railway.app
- **Pros:** Mudah setup, gratis tier, auto-deploy dari GitHub
- **Setup:**
  1. Connect GitHub repo
  2. Add Python service
  3. Set environment variables
  4. Deploy!

#### Render
- **URL:** https://render.com
- **Pros:** Gratis tier, mudah setup
- **Setup:**
  1. Create new Web Service
  2. Connect GitHub repo
  3. Set build command: `cd backend && pip install -r requirements.txt`
  4. Set start command: `cd backend && python main_fastapi.py`

#### Fly.io
- **URL:** https://fly.io
- **Pros:** Gratis tier, global edge network
- **Setup:** Ikuti dokumentasi Fly.io untuk Python apps

### 4. Backend Environment Variables

Backend juga perlu environment variables. Lihat `backend/ENV_VARIABLES.md` untuk detail.

### 5. CORS Configuration

Pastikan backend mengizinkan CORS dari domain Vercel Anda. Di backend FastAPI, tambahkan:

```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://your-app.vercel.app",
        "http://localhost:3000",  # untuk development
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

## Testing

Setelah setup, test dengan:

1. **Test API Routes:**
   ```bash
   curl https://your-app.vercel.app/api/register-db-data
   ```

2. **Test WebSocket:**
   - Buka browser console
   - Check apakah WebSocket connection berhasil

3. **Test Frontend:**
   - Buka https://your-app.vercel.app
   - Test semua fitur yang menggunakan API

## Troubleshooting

### API Routes tidak bekerja

1. Check apakah `NEXT_PUBLIC_BACKEND_URL` sudah di-set dengan benar
2. Check apakah backend URL accessible dari internet
3. Check browser console untuk error details

### WebSocket tidak connect

1. Check apakah `NEXT_PUBLIC_WS_HTTP_BASE` sudah di-set
2. Check apakah backend WebSocket endpoint accessible
3. Check browser console untuk WebSocket errors

### CORS Error

1. Pastikan backend mengizinkan origin Vercel
2. Check backend CORS configuration
3. Pastikan `allow_credentials=True` jika menggunakan cookies/auth

## Support

Jika ada masalah, check:
1. Vercel deployment logs
2. Backend logs
3. Browser console errors
4. Network tab di browser DevTools

