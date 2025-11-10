# Advertisements API Endpoints

API endpoints untuk pengelolaan iklan (advertisements) di backend.

## Base URL
```
/admin/advertisements
```

## Endpoints

### 1. GET `/admin/advertisements/active` (PUBLIC)
List semua iklan yang aktif (enabled = true).

**Auth**: Tidak perlu (public endpoint)

**Response**:
```json
[
  {
    "id": "uuid",
    "src": "https://...supabase.co/storage/v1/object/public/advertisements/image.jpg",
    "type": "image",
    "enabled": true,
    "display_order": 1,
    "file_name": "banner.jpg",
    "title": "Banner Promosi"
  }
]
```

### 2. GET `/admin/advertisements` (ADMIN ONLY)
List semua iklan (termasuk yang disabled).

**Auth**: Required (admin token)

**Query Parameters**:
- `enabled_only` (boolean, optional): Jika true, hanya return iklan yang enabled

**Response**: Same as above

### 3. POST `/admin/advertisements` (ADMIN ONLY)
Upload iklan baru.

**Auth**: Required (admin token)

**Request**: `multipart/form-data`
- `file` (File, required): File gambar atau video
- `title` (string, optional): Judul iklan
- `description` (string, optional): Deskripsi iklan
- `enabled` (boolean, optional, default: true): Apakah iklan aktif
- `display_order` (integer, optional, default: 0): Urutan tampil

**Response**:
```json
{
  "id": "uuid",
  "src": "https://...supabase.co/storage/v1/object/public/advertisements/image.jpg",
  "type": "image",
  "enabled": true,
  "display_order": 0,
  "file_name": "banner.jpg",
  "file_size": 102400,
  "mime_type": "image/jpeg",
  "title": "Banner Promosi",
  "description": "Deskripsi iklan"
}
```

### 4. PUT `/admin/advertisements/{id}` (ADMIN ONLY)
Update metadata iklan (bukan file).

**Auth**: Required (admin token)

**Request Body** (JSON):
```json
{
  "enabled": false,
  "display_order": 5,
  "title": "New Title",
  "description": "New Description"
}
```

**Response**: Same as POST response

### 5. DELETE `/admin/advertisements/{id}` (ADMIN ONLY)
Hapus iklan (hapus file dan record).

**Auth**: Required (admin token)

**Response**: 204 No Content

### 6. PATCH `/admin/advertisements/reorder` (ADMIN ONLY)
Reorder iklan (update display_order untuk multiple iklan).

**Auth**: Required (admin token)

**Request Body** (JSON):
```json
{
  "orders": [
    {"id": "uuid-1", "display_order": 1},
    {"id": "uuid-2", "display_order": 2},
    {"id": "uuid-3", "display_order": 3}
  ]
}
```

**Response**:
```json
{
  "status": "ok",
  "message": "Reorder successful"
}
```

## Authentication

Untuk admin endpoints, gunakan Bearer token di header:
```
Authorization: Bearer <API_KEY>
```

Atau di query parameter:
```
?token=<API_KEY>
```

## Error Responses

- `400 Bad Request`: Invalid request data
- `401 Unauthorized`: Missing or invalid token
- `403 Forbidden`: Not admin
- `404 Not Found`: Advertisement not found
- `500 Internal Server Error`: Server error
- `503 Service Unavailable`: Supabase not configured

## Notes

- File akan di-upload ke Supabase Storage bucket `advertisements`
- Public URL akan otomatis di-generate oleh backend
- File akan di-delete dari storage saat iklan di-delete
- Rollback otomatis: jika database insert gagal, file akan di-delete dari storage

