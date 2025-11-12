# Toast System

Sistem toast terpusat untuk notifikasi di aplikasi FunMeter. Menggunakan `sonner` sebagai library dasar dengan wrapper yang menyediakan API konsisten dan dukungan multi-bahasa.

## Struktur File

```
lib/toast/
├── index.ts       # Main export dan API toast
├── types.ts       # TypeScript type definitions
├── constants.ts   # Konstanta dan konfigurasi default
├── utils.ts       # Utility functions (language, fallback title)
└── README.md      # Dokumentasi ini
```

## Penggunaan

### Import

```typescript
import { toast } from '@/lib/toast';
```

### Metode Dasar

#### Success Toast
```typescript
toast.success('Data berhasil disimpan');
toast.success('Data saved successfully', { duration: 5000 });
```

#### Error Toast
```typescript
toast.error('Terjadi kesalahan');
toast.error('An error occurred', { 
  duration: 5000,
  actionText: 'Retry',
  onAction: () => console.log('Retry clicked')
});
```

#### Warning Toast
```typescript
toast.warn('Perhatian: Data akan dihapus');
```

#### Info Toast
```typescript
toast.info('Proses sedang berjalan');
```

### Options Lanjutan

```typescript
toast.show({
  type: 'success',           // 'success' | 'error' | 'warn' | 'info'
  title: 'Custom Title',     // Judul toast
  message: 'Custom message', // Pesan toast
  delay: 1000,              // Delay sebelum muncul (ms)
  duration: 5000,           // Durasi tampil (ms), Infinity untuk persistent
  dismissible: true,        // Bisa ditutup manual
  actionText: 'Undo',       // Text tombol aksi
  onAction: () => {         // Handler tombol aksi
    console.log('Action clicked');
  }
});
```

### Dismiss Toast

```typescript
// Tutup semua toast
toast.dismiss();

// Tutup toast spesifik berdasarkan ID
const id = toast.success('Message');
toast.dismiss(id);
```

## Fitur

### ✅ Multi-bahasa
Toast secara otomatis mengambil bahasa dari localStorage (`settings.language`) untuk fallback title:
- **English**: Success, Error, Warning, Info
- **Indonesia**: Berhasil, Gagal, Perhatian, Info

### ✅ Delayed Toast
```typescript
const result = toast.show({
  message: 'Delayed message',
  delay: 2000 // Muncul setelah 2 detik
});

// Bisa dibatalkan sebelum muncul
if (typeof result === 'object') {
  result.cancel();
}
```

### ✅ Action Button
```typescript
toast.error('Failed to save', {
  actionText: 'Retry',
  onAction: () => {
    // Retry logic
  }
});
```

### ✅ Persistent Toast
```typescript
toast.info('Please wait...', {
  duration: Infinity // Tetap muncul sampai di-dismiss manual
});
```

## Konfigurasi Default

Default options (bisa di-override):
```typescript
{
  type: 'info',
  title: '',           // Auto-generated berdasarkan type dan bahasa
  message: '',
  delay: 0,
  duration: 3200,      // 3.2 detik
  dismissible: true,
  actionText: '',
  onAction: () => {}
}
```

## Integrasi dengan Layout

Toast sudah terintegrasi di `app/layout.tsx` dengan konfigurasi:
```typescript
<Toaster
  position="bottom-right"
  richColors
  closeButton
  expand
  visibleToasts={2}
/>
```

## Best Practices

1. **Gunakan metode shorthand** untuk kasus umum:
   ```typescript
   // ✅ Good
   toast.success('Saved!');
   
   // ❌ Tidak perlu
   toast.show({ type: 'success', message: 'Saved!' });
   ```

2. **Berikan pesan yang jelas dan actionable**:
   ```typescript
   // ✅ Good
   toast.error('Failed to upload image. File size exceeds 5MB');
   
   // ❌ Terlalu umum
   toast.error('Error');
   ```

3. **Gunakan action button untuk memberi opsi kepada user**:
   ```typescript
   toast.error('Connection lost', {
     actionText: 'Reconnect',
     onAction: reconnectWebSocket
   });
   ```

4. **Set duration yang sesuai dengan tipe**:
   - Success: 3-4 detik (default 3200ms)
   - Error: 5-6 detik (lebih lama agar user bisa baca)
   - Warning: 4-5 detik
   - Info: 3-4 detik

## Type Definitions

Lihat `types.ts` untuk detail lengkap type definitions yang tersedia.

## Maintenance

### Menambah Bahasa Baru

Edit `utils.ts` di function `fallbackTitle`:
```typescript
const dict: ToastDict = lang === 'en'
  ? { success: 'Success', error: 'Error', warn: 'Warning', info: 'Info' }
  : lang === 'id'
  ? { success: 'Berhasil', error: 'Gagal', warn: 'Perhatian', info: 'Info' }
  : lang === 'fr'
  ? { success: 'Succès', error: 'Erreur', warn: 'Attention', info: 'Info' }
  : { success: 'Success', error: 'Error', warn: 'Warning', info: 'Info' };
```

### Mengubah Default Duration

Edit `constants.ts`:
```typescript
export const DEFAULTS: Required<ToastOptions> = {
  // ...
  duration: 4000, // Ubah dari 3200 ke 4000
  // ...
};
```
