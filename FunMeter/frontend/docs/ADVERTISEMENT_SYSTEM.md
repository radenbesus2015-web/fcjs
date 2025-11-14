# Sistem Iklan (Advertisement System)

## Gambaran Umum

Sistem iklan terintegrasi dengan halaman Attendance Fun Meter untuk menampilkan iklan yang dapat dikelola melalui admin panel.

## Fitur Utama

### 1. **Integrasi dengan Backend**
- Menggunakan API endpoint `/admin/advertisements/active` untuk mengambil iklan aktif
- Hanya iklan dengan `enabled: true` yang ditampilkan
- Iklan diurutkan berdasarkan `display_order`

### 2. **Fallback System**
- Jika backend tidak tersedia, menggunakan placeholder ads
- Default ads ditampilkan saat loading atau error
- Memastikan iklan selalu muncul untuk user experience yang baik

### 3. **Positioning**
- Iklan ditampilkan tepat di atas footer
- Responsive untuk landscape dan portrait mode
- Transform positioning: `-20px` (portrait) dan `-30px` (landscape)

### 4. **Format Support**
- Support image (JPG, PNG, WebP)
- Support video (MP4, WebM)
- Auto-rotation untuk multiple ads

## Cara Kerja

### Loading Ads
```typescript
// 1. Load dari backend
const data = await fetchActiveAdvertisements();

// 2. Filter dan sort
const list = data
  .filter((ad) => ad.enabled)
  .sort((a, b) => (a.display_order || 0) - (b.display_order || 0))
  .map((ad) => ({
    src: ad.src,
    type: ad.type as 'image' | 'video',
  }));

// 3. Update state
setAdMediaList(list);
```

### Rendering Logic
```jsx
{adMediaList.length > 0 && adMediaList[currentAdIndex] && (
  <div className="ad-overlay-wrapper">
    {/* Iklan ditampilkan di sini */}
  </div>
)}
```

## Kelola Iklan

### Menambah Iklan Baru
1. Buka admin panel
2. Upload file gambar/video
3. Set `enabled: true` untuk menampilkan
4. Set `display_order` untuk urutan tampil

### Mengatur Urutan
- Iklan dengan `display_order` lebih kecil ditampilkan lebih dulu
- Rotation otomatis setiap 5 detik (gambar) atau setelah video selesai

### Menonaktifkan Iklan
- Set `enabled: false` di admin panel
- Iklan akan hilang dari rotation secara real-time

## CSS Classes

### `.ad-overlay-wrapper`
- Positioning container untuk iklan
- `position: absolute; bottom: 0;`
- `transform: translateY(-20px)` untuk gap dari footer

### `.ad-overlay-container`
- Container individual untuk setiap iklan
- Aspect ratio 4:3 (75% padding-top)
- Responsive width: 240px (portrait) - 600px (large screens)

## Debug Mode

Untuk debugging, check console logs:
- `[ADS] Loading advertisements from backend...`
- `[ADS] Raw data from backend:` - data mentah dari API
- `[ADS] Processed ad list:` - data setelah filter dan sort
- `[ADS_RENDER]` - info rendering kondisi

## Troubleshooting

### Iklan Tidak Muncul
1. Check console untuk error loading
2. Pastikan ada iklan dengan `enabled: true` di database
3. Verify API endpoint `/admin/advertisements/active` accessible
4. Check network tab untuk failed requests

### Positioning Salah
1. Verify CSS transform values
2. Check responsive breakpoints
3. Ensure z-index hierarchy correct

### Performance Issues
1. Optimize image/video file sizes
2. Use appropriate formats (WebP for images, MP4 for videos)
3. Implement lazy loading if needed

## API Integration

### Endpoint: `/admin/advertisements/active`
```json
[
  {
    "id": "uuid",
    "src": "https://storage.url/path/to/file.jpg",
    "type": "image",
    "enabled": true,
    "display_order": 1,
    "title": "Ad Title",
    "description": "Ad Description"
  }
]
```

### Error Handling
- Network errors → fallback to placeholder ads
- Empty response → keep default test ads
- Invalid data → filter out broken entries

## Future Enhancements

1. **Analytics Integration**
   - Track ad impressions
   - Click-through rates (jika interactive)
   - View duration metrics

2. **Advanced Scheduling**
   - Time-based ad rotation
   - Date range scheduling
   - Frequency capping

3. **Interactive Ads**
   - Click handlers
   - Call-to-action buttons
   - Deep linking

4. **Performance Optimization**
   - Preloading next ads
   - CDN integration
   - Adaptive quality based on connection
