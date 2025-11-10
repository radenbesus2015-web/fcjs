# Environment Variables untuk Backend

## Untuk Fitur Advertisements (IKLAN)

**TIDAK PERLU** menambahkan env variable baru di backend untuk fitur advertisements!

### Kenapa?
- Backend sudah punya env variables untuk Supabase yang digunakan untuk advertisements
- Backend menggunakan env variables yang sama untuk semua operasi Supabase:
  - `SUPABASE_URL` (sudah ada)
  - `SUPABASE_SERVICE_ROLE_KEY` (sudah ada)
- Frontend akan call Backend API, bukan langsung ke Supabase

## Env Variables yang Sudah Ada (untuk Database Operations)

Backend sudah punya env variables untuk Supabase yang digunakan untuk database operations lainnya (attendance, users, dll):

### WAJIB:
```env
# Supabase URL
SUPABASE_URL=https://your-project.supabase.co

# Supabase Key (pilih salah satu, urutan prioritas):
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key  # RECOMMENDED untuk backend
# atau
SUPABASE_SERVICE_KEY=your-service-key
# atau
SUPABASE_KEY=your-key
# atau
SUPABASE_ANON_KEY=your-anon-key  # Fallback, kurang aman
```

### OPSIONAL:
```env
# Organization (untuk multi-tenant)
DEFAULT_ORG_SLUG=default
DEFAULT_ORG_NAME=Default Organization

# Retry attempts untuk Supabase queries
SUPABASE_RETRY_ATTEMPTS=3
```

## Perbedaan Service Role Key vs Anon Key

| Key Type | Access Level | RLS (Row Level Security) | Recommended For |
|----------|--------------|--------------------------|------------------|
| **SERVICE_ROLE_KEY** | Full access | Bypass RLS | Backend/Admin operations |
| **ANON_KEY** | Limited access | Respect RLS | Frontend/Public access |

**Backend sebaiknya pakai SERVICE_ROLE_KEY** karena:
- Bypass RLS untuk operasi admin
- Bisa akses semua data
- Lebih aman untuk server-side operations

## Contoh File .env Backend

```env
# Supabase (WAJIB)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here

# Organization (OPSIONAL)
DEFAULT_ORG_SLUG=default
DEFAULT_ORG_NAME=Default Organization

# OpenCV
OPENCV_BACKEND=cpu
OPENCV_LOG_LEVEL=SILENT

# Attendance
ATT_MAX_EVENTS=5000
ATT_GRACE_IN_MIN=10
ATT_GRACE_OUT_MIN=5

# Next.js Frontend
NEXT_UI_BASE=http://localhost:3000
```

## Kesimpulan

✅ **TIDAK PERLU** tambah env variable baru untuk advertisements
✅ Backend sudah punya env variables yang diperlukan untuk database operations
✅ Frontend punya env variables sendiri untuk connect ke Supabase advertisements

## Cara Setup

1. **Backend**: Pastikan `.env` sudah ada dengan `SUPABASE_URL` dan `SUPABASE_SERVICE_ROLE_KEY`
2. **Frontend**: Pastikan `.env.local` sudah ada dengan `NEXT_PUBLIC_SUPABASE_URL` dan `NEXT_PUBLIC_SUPABASE_ANON_KEY`
3. **Supabase**: Jalankan SQL schema di `supabase/advertisements.sql`

Selesai! Tidak perlu tambah env variable baru.

