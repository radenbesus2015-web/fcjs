# Toast System Changelog

## [2.0.0] - 2025-11-12

### 🎉 Major Refactoring

Sistem toast telah direfactor dari single file menjadi modular structure untuk maintainability yang lebih baik.

### ✨ Added

- **`types.ts`**: Type definitions lengkap untuk toast system
  - `ToastOptions` interface
  - `ToastType` type
  - `Language` type
  - `ToastDict` interface

- **`constants.ts`**: Konstanta terpusat
  - `TYPE_METHOD`: Mapping toast type ke sonner method
  - `DEFAULTS`: Default options untuk toast

- **`utils.ts`**: Utility functions
  - `getCurrentLanguage()`: Mendapatkan bahasa aktif dari localStorage
  - `fallbackTitle()`: Generate fallback title berdasarkan type dan bahasa

- **`README.md`**: Dokumentasi lengkap
  - Penggunaan dasar
  - Advanced options
  - Best practices
  - Type definitions
  - Maintenance guide

- **`CHANGELOG.md`**: File ini untuk tracking perubahan

### 🔄 Changed

- **Struktur file**: Dari `lib/toast.ts` menjadi `lib/toast/` folder
- **Modularity**: Kode dipecah menjadi 4 file dengan tanggung jawab spesifik
- **Documentation**: Dokumentasi lebih lengkap dan terstruktur
- **Type Safety**: Improved type definitions dan exports

### ⚠️ Breaking Changes

**NONE** - Semua API tetap backward compatible

### 📦 Migration

Tidak perlu migration karena:
- Import path tetap sama: `import { toast } from '@/lib/toast'`
- Semua API method tetap sama
- Tidak ada perubahan behavior

### 🔍 Technical Details

#### Before
```
lib/toast.ts (117 lines)
├── Imports
├── Type definitions
├── Constants
├── Utility functions
└── Toast API
```

#### After
```
lib/toast/
├── index.ts (95 lines) - Main API & exports
├── types.ts (25 lines) - Type definitions
├── constants.ts (21 lines) - Constants
├── utils.ts (33 lines) - Utility functions
└── README.md - Documentation
```

### 📊 Metrics

- **Total lines**: 117 → 174 (dengan dokumentasi lengkap)
- **Code lines**: 117 → ~150 (tanpa comments & docs)
- **Files**: 1 → 5
- **Documentation**: Minimal → Comprehensive
- **Type safety**: Good → Excellent
- **Maintainability**: Good → Excellent

### 🎯 Goals Achieved

- ✅ **Correctness**: No `any` types, strict typing
- ✅ **Efficiency**: Better tree-shaking, code splitting
- ✅ **Maintainability**: Clear separation of concerns
- ✅ **Readability**: Better code organization
- ✅ **Documentation**: Comprehensive docs
- ✅ **No Duplication**: Single source of truth

### 🚀 Future Improvements

- [ ] Unit tests untuk setiap utility function
- [ ] Storybook stories untuk visual testing
- [ ] Analytics tracking untuk toast usage
- [ ] Custom toast templates
- [ ] Toast queue management system
- [ ] Priority-based toast system

### 📝 Notes

- Tidak ada perubahan pada behavior atau API
- Semua existing code tetap berfungsi tanpa perubahan
- Import path tidak berubah
- Backward compatible 100%

---

### Legacy Version

## [1.0.0] - Previous

Single file implementation (`lib/toast.ts`) dengan semua functionality dalam satu file.
