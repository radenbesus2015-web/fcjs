# API Routes untuk Deployment Vercel

## Overview

Project ini menggunakan Next.js API Routes untuk proxy request dari frontend ke backend FastAPI. Ini memungkinkan deployment ke Vercel dimana backend di-deploy terpisah.

## Struktur

```
app/api/[...path]/route.ts  # API route handler yang proxy semua request ke backend
```

## Cara Kerja

1. **Frontend** membuat request ke endpoint seperti `/admin/users` atau `/register-face`
2. **API Route Handler** (`app/api/[...path]/route.ts`) menangkap request
3. **Proxy** request ke backend URL yang di-set via `NEXT_PUBLIC_BACKEND_URL`
4. **Response** dari backend dikembalikan ke frontend

## Environment Variables

Lihat `ENV_DEPLOYMENT.md` untuk detail lengkap.

**Minimal yang diperlukan:**
```bash
NEXT_PUBLIC_BACKEND_URL=https://your-backend.railway.app
NEXT_PUBLIC_WS_HTTP_BASE=your-backend.railway.app
```

## Development vs Production

### Development
- Default: menggunakan Next.js rewrites (langsung ke `localhost:8000`)
- Atau: set `NEXT_PUBLIC_USE_API_ROUTES=true` untuk test API routes

### Production
- Otomatis menggunakan API routes (`/api/...`)
- Semua request di-proxy ke backend URL yang di-set

## Testing

Test API routes di development:

```bash
# Set environment variable
export NEXT_PUBLIC_USE_API_ROUTES=true
export NEXT_PUBLIC_BACKEND_URL=http://localhost:8000

# Run dev server
npm run dev

# Test API route
curl http://localhost:3000/api/register-db-data
```

## Endpoints yang Didukung

Semua endpoint backend didukung melalui API routes:

- `/api/register-face` → Backend `/register-face`
- `/api/admin/*` → Backend `/admin/*`
- `/api/auth/*` → Backend `/auth/*`
- `/api/recognize-image` → Backend `/recognize-image`
- `/api/attendance-log` → Backend `/attendance-log`
- `/api/orgs/*` → Backend `/orgs/*`
- `/api/config` → Backend `/config`
- Dan semua endpoint lainnya

## Troubleshooting

### Request tidak sampai ke backend

1. Check `NEXT_PUBLIC_BACKEND_URL` sudah di-set dengan benar
2. Check backend URL accessible dari internet
3. Check Vercel function logs untuk error details

### CORS Error

Pastikan backend mengizinkan origin Vercel. Lihat `ENV_DEPLOYMENT.md` untuk detail.

## Catatan

- API routes hanya handle HTTP requests
- WebSocket connections tetap langsung ke backend (tidak melalui API routes)
- File uploads (multipart/form-data) didukung
- Streaming responses didukung

