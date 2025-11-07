# Fitur Modal Konfirmasi Logout

## Deskripsi
Modal konfirmasi logout yang muncul sebelum user benar-benar keluar dari aplikasi.

## Fitur

### ✅ Multilingual Support
- **Bahasa Indonesia**: "Konfirmasi Keluar", "Apakah Anda yakin ingin keluar dari akun Anda?", "Ya, Keluar", "Batal"
- **English**: "Confirm Sign Out", "Are you sure you want to sign out of your account?", "Yes, Sign Out", "Cancel"
- Otomatis mengikuti pengaturan bahasa aplikasi

### ✅ Dark/Light Theme Support
- Menggunakan komponen `AlertDialog` dari Radix UI yang sudah terintegrasi dengan sistem tema
- Warna dan style otomatis menyesuaikan dengan tema yang aktif (gelap/terang)
- Tombol konfirmasi menggunakan warna `destructive` untuk menunjukkan aksi penting

### ✅ ESC Key Handler
- Tekan tombol **ESC** untuk menutup modal konfirmasi
- Event listener menggunakan capture phase untuk prioritas tinggi
- Otomatis cleanup saat modal ditutup

### ✅ Fitur Tambahan
- **Icon visual**: Menampilkan icon LogOut untuk clarity
- **Animasi smooth**: Fade in/out dan zoom animation
- **Responsive**: Bekerja baik di desktop dan mobile
- **Accessible**: Menggunakan ARIA labels dan semantic HTML
- **Keyboard navigation**: Support Tab, Enter, dan ESC keys
- **Tombol Close (X)**: Icon X di pojok kanan atas untuk menutup modal dengan mudah

## File yang Dimodifikasi

### 1. **`components/common/LogoutConfirmDialog.tsx`** (Baru)
Komponen modal konfirmasi logout dengan semua fitur di atas.

### 2. **`components/layout/AppSidebar.tsx`**
- Import `LogoutConfirmDialog`
- Tambah state `showLogoutDialog`
- Tambah handler `handleLogoutClick` dan `handleLogoutConfirm`
- Ganti `onClick={logout}` menjadi `onClick={handleLogoutClick}`
- Render `<LogoutConfirmDialog />` di akhir komponen

### 3. **`locales/id.json`**
```json
"avatar": {
  "logout": {
    "title": "Konfirmasi Keluar",
    "description": "Apakah Anda yakin ingin keluar dari akun Anda?",
    "confirm": "Ya, Keluar",
    "cancel": "Batal"
  }
}
```

### 4. **`locales/en.json`**
```json
"avatar": {
  "logout": {
    "title": "Confirm Sign Out",
    "description": "Are you sure you want to sign out of your account?",
    "confirm": "Yes, Sign Out",
    "cancel": "Cancel"
  }
}
```

## Cara Penggunaan

1. User klik tombol "Keluar"/"Sign out" di sidebar
2. Modal konfirmasi muncul dengan animasi
3. User dapat:
   - Klik "Ya, Keluar" untuk logout
   - Klik "Batal" untuk membatalkan
   - Klik icon **X** di pojok kanan atas untuk menutup
   - Tekan **ESC** untuk menutup modal
   - Klik di luar modal untuk menutup
4. Jika dikonfirmasi, user akan logout dan diarahkan sesuai flow aplikasi

## Fitur Close Modal (2 Cara)

Modal dapat ditutup dengan **2 cara berbeda** tanpa logout:

### 1. **Tombol Close (X)**
- Posisi: Pojok kanan atas modal
- Visual: Icon X dengan opacity 70% (hover 100%)
- Fungsi: Menutup modal tanpa logout

### 2. **Tombol Batal**
- Posisi: Footer modal (kiri)
- Visual: Tombol outline dengan teks "Batal"/"Cancel"
- Fungsi: Menutup modal tanpa logout

**Fitur close lainnya:**
- Tekan **ESC** key
- Klik di luar area modal (overlay)

## Prinsip Kode yang Diterapkan

### ✅ Correctness
- Implementasi yang benar dengan TypeScript type safety
- Event handler yang proper dengan cleanup
- State management yang konsisten

### ✅ Efficiency
- Minimal re-render dengan proper state management
- Event listener cleanup untuk mencegah memory leak
- Lazy rendering (modal hanya render saat open)

### ✅ Maintainability
- Komponen terpisah dan reusable
- Kode yang mudah dibaca dengan komentar yang jelas
- Mengikuti pattern yang sudah ada di aplikasi
- Tidak ada duplikasi kode
- Tidak ada penggunaan `any` type

## Testing

### Manual Testing Checklist
- [ ] Modal muncul saat klik tombol logout
- [ ] Teks dalam bahasa Indonesia saat locale ID
- [ ] Teks dalam bahasa English saat locale EN
- [ ] Modal menutup saat klik icon **X** di pojok kanan atas
- [ ] Modal menutup saat tekan **ESC**
- [ ] Modal menutup saat klik tombol "Batal"
- [ ] Modal menutup saat klik di luar modal
- [ ] Logout berhasil saat klik "Ya, Keluar"
- [ ] Icon X memiliki hover effect (opacity berubah)
- [ ] Icon X memiliki focus ring saat navigasi keyboard
- [ ] Tema gelap menampilkan warna yang sesuai
- [ ] Tema terang menampilkan warna yang sesuai
- [ ] Responsive di mobile dan desktop
- [ ] Animasi smooth saat buka/tutup

## Status Modal Lainnya

Semua modal di aplikasi sudah memiliki tombol close (X) di pojok kanan atas:

✅ **LogoutConfirmDialog** - Modal konfirmasi logout (baru ditambahkan)
✅ **GlobalConfirm** - Modal konfirmasi umum (sudah diperbaiki)
✅ **LoginModal** - Modal login/register (sudah ada)
✅ **SettingsModal** - Modal pengaturan (sudah ada)
✅ **Dialog** (ui/dialog.tsx) - Komponen base dialog (built-in X button)

Semua modal menggunakan styling yang konsisten untuk tombol close (X).
