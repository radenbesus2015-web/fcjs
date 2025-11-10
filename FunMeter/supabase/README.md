# Supabase Setup untuk Advertisements

Dokumentasi untuk setup Supabase Storage dan Database untuk sistem iklan.

## Prerequisites

1. Akun Supabase (https://supabase.com)
2. Project Supabase yang sudah dibuat
3. Supabase URL dan API keys

## Setup Instructions

### 1. Jalankan SQL Schema

1. Buka Supabase Dashboard
2. Pergi ke **SQL Editor**
3. Copy seluruh isi file `advertisements.sql`
4. Paste dan jalankan di SQL Editor
5. Pastikan tidak ada error

### 2. Setup Environment Variables

Tambahkan ke file `.env.local` atau `.env`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://[project-ref].supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=[your-anon-key]
```

Untuk mendapatkan keys:
1. Buka Supabase Dashboard
2. Pergi ke **Settings** > **API**
3. Copy **Project URL** dan **anon/public key**

### 3. Verifikasi Storage Bucket

1. Buka Supabase Dashboard
2. Pergi ke **Storage**
3. Pastikan bucket `advertisements` sudah ada
4. Pastikan bucket adalah **Public**
5. Pastikan file size limit dan allowed MIME types sudah sesuai

### 4. Test Connection

Gunakan helper functions di `lib/supabase-advertisements.ts`:

```typescript
import { fetchActiveAdvertisements } from '@/lib/supabase-advertisements';

// Test fetch iklan aktif
const ads = await fetchActiveAdvertisements();
console.log('Active advertisements:', ads);
```

## Database Schema

### Table: `advertisements`

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| src | TEXT | Path ke file di storage |
| type | TEXT | 'image' atau 'video' |
| enabled | BOOLEAN | Apakah iklan aktif |
| display_order | INTEGER | Urutan tampil |
| file_name | TEXT | Nama file asli |
| file_size | BIGINT | Ukuran file (bytes) |
| mime_type | TEXT | MIME type |
| title | TEXT | Judul iklan (opsional) |
| description | TEXT | Deskripsi (opsional) |
| created_at | TIMESTAMPTZ | Waktu dibuat |
| updated_at | TIMESTAMPTZ | Waktu diupdate |
| created_by | UUID | User yang membuat |
| updated_by | UUID | User yang update |

### View: `advertisements_active`

View untuk mendapatkan semua iklan yang aktif, sudah diurutkan berdasarkan `display_order`.

## Storage Bucket

- **Bucket ID**: `advertisements`
- **Public**: Yes (untuk akses langsung)
- **File Size Limit**: 50MB
- **Allowed MIME Types**:
  - `image/jpeg`
  - `image/png`
  - `image/gif`
  - `image/webp`
  - `video/mp4`
  - `video/webm`
  - `video/quicktime`

## Security (RLS Policies)

### Public Access
- ✅ Semua orang bisa membaca iklan yang `enabled = true`
- ✅ Semua orang bisa membaca file di storage bucket

### Admin Access
- ✅ Admin bisa membaca semua iklan (termasuk yang disabled)
- ✅ Admin bisa upload file ke storage
- ✅ Admin bisa create/update/delete iklan di database
- ✅ Admin bisa delete file dari storage

**Note**: Admin ditentukan dari `auth.users.raw_user_meta_data->>'role' = 'admin'`

## Usage Examples

### Fetch Active Advertisements (Public)

```typescript
import { fetchActiveAdvertisements } from '@/lib/supabase-advertisements';

const ads = await fetchActiveAdvertisements();
// Returns: Array of Advertisement dengan src sudah full URL
```

### Upload Advertisement (Admin Only)

```typescript
import { uploadAdvertisement } from '@/lib/supabase-advertisements';

const file = new File([...], 'banner.jpg', { type: 'image/jpeg' });
const authToken = 'your-admin-auth-token'; // Dari Supabase Auth

const ad = await uploadAdvertisement({
  file,
  title: 'Banner Promosi',
  description: 'Banner untuk promosi produk',
  enabled: true,
  display_order: 1,
}, authToken);
```

### Update Advertisement (Admin Only)

```typescript
import { updateAdvertisement } from '@/lib/supabase-advertisements';

await updateAdvertisement(
  'ad-id-here',
  {
    enabled: false,
    display_order: 5,
  },
  authToken
);
```

### Delete Advertisement (Admin Only)

```typescript
import { deleteAdvertisement } from '@/lib/supabase-advertisements';

await deleteAdvertisement('ad-id-here', authToken);
```

## Integration dengan Halaman Advertisement

Untuk mengintegrasikan dengan halaman `/admin/advertisement`:

1. Import helper functions
2. Replace localStorage dengan Supabase
3. Gunakan `fetchAllAdvertisements()` untuk load data
4. Gunakan `uploadAdvertisement()` untuk upload file baru
5. Gunakan `updateAdvertisement()` untuk toggle enabled/disabled
6. Gunakan `deleteAdvertisement()` untuk hapus iklan
7. Gunakan `reorderAdvertisements()` untuk reorder

## Troubleshooting

### Error: "Supabase URL tidak dikonfigurasi"
- Pastikan `NEXT_PUBLIC_SUPABASE_URL` sudah di-set di `.env.local`
- Restart development server setelah menambah environment variable

### Error: "Failed to fetch advertisements"
- Cek apakah RLS policies sudah benar
- Cek apakah bucket `advertisements` sudah dibuat
- Cek apakah API key valid

### Error: "Failed to upload file"
- Cek apakah user sudah login sebagai admin
- Cek apakah auth token valid
- Cek apakah file size tidak melebihi limit (50MB)
- Cek apakah MIME type diizinkan

### File tidak bisa diakses
- Pastikan bucket adalah **Public**
- Pastikan storage policy untuk SELECT sudah ada
- Cek URL yang dihasilkan oleh `getAdvertisementPublicUrl()`

## Next Steps

1. Integrasikan dengan halaman `/admin/advertisement`
2. Replace localStorage dengan Supabase
3. Test upload/download/delete
4. Setup authentication untuk admin
5. Monitor storage usage di Supabase Dashboard

