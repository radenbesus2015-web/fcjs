# Cara Test `fetchActiveAdvertisements()`

## Cara 1: Test di Browser Console (Paling Cepat)

1. Buka halaman website Anda di browser
2. Buka Developer Tools (F12)
3. Buka tab **Console**
4. Paste kode berikut:

```javascript
// Test fetch iklan aktif
async function testFetchAds() {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://your-project.supabase.co';
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'your-anon-key';
    
    const response = await fetch(`${supabaseUrl}/rest/v1/advertisements_active`, {
      headers: {
        'apikey': anonKey,
        'Authorization': `Bearer ${anonKey}`,
      },
    });
    
    if (!response.ok) {
      throw new Error(`Failed: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log('✅ Success! Found', data.length, 'advertisements');
    console.log('Data:', data);
    return data;
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

testFetchAds();
```

**Note**: Ganti `supabaseUrl` dan `anonKey` dengan nilai yang benar dari `.env.local`

## Cara 2: Test di React Component

Buat file test sederhana di `app/test-ads/page.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { fetchActiveAdvertisements } from "@/lib/supabase-advertisements";

export default function TestAdsPage() {
  const [ads, setAds] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    async function test() {
      try {
        setLoading(true);
        const data = await fetchActiveAdvertisements();
        setAds(data);
        console.log("✅ Success! Found", data.length, "advertisements");
      } catch (err: any) {
        setError(err.message);
        console.error("❌ Error:", err);
      } finally {
        setLoading(false);
      }
    }
    test();
  }, []);

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Test Supabase Advertisements</h1>
      
      {loading && <p>Loading...</p>}
      {error && <p className="text-red-500">Error: {error}</p>}
      
      {!loading && !error && (
        <>
          <p className="mb-4">Found {ads.length} advertisements:</p>
          <div className="space-y-2">
            {ads.map((ad) => (
              <div key={ad.id} className="border p-4 rounded">
                <p><strong>ID:</strong> {ad.id}</p>
                <p><strong>Type:</strong> {ad.type}</p>
                <p><strong>URL:</strong> {ad.src}</p>
                <p><strong>Order:</strong> {ad.display_order}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
```

Lalu buka: `http://localhost:3000/test-ads`

## Cara 3: Test dengan cURL (Terminal)

```bash
curl -X GET \
  'https://your-project.supabase.co/rest/v1/advertisements_active' \
  -H 'apikey: your-anon-key' \
  -H 'Authorization: Bearer your-anon-key'
```

## Expected Result

Jika berhasil, Anda akan mendapat response JSON seperti:

```json
[
  {
    "id": "uuid-here",
    "src": "https://your-project.supabase.co/storage/v1/object/public/advertisements/image-123.jpg",
    "type": "image",
    "display_order": 1,
    "file_name": "banner.jpg",
    "title": "Banner Promosi"
  }
]
```

## Troubleshooting

### Error: "NEXT_PUBLIC_SUPABASE_URL tidak di-set"
- Pastikan file `.env.local` ada di root project
- Pastikan sudah restart dev server setelah menambah env variable
- Cek dengan: `console.log(process.env.NEXT_PUBLIC_SUPABASE_URL)`

### Error: 401 Unauthorized
- Cek apakah anon key benar
- Cek apakah RLS policies sudah di-setup dengan benar

### Error: 404 Not Found
- Pastikan sudah menjalankan SQL schema di Supabase
- Pastikan view `advertisements_active` sudah dibuat

### Empty Array []
- Normal jika belum ada data
- Upload beberapa iklan dulu untuk test

