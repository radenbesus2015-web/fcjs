# Pagination Component

Komponen pagination yang konsisten untuk seluruh aplikasi, mengikuti style referensi yang telah ditentukan.

## Style Referensi

Berdasarkan foto referensi, pagination menggunakan format:
- **Kiri**: "Showing 1-12 of 74 members"
- **Kanan**: "Previous | Page 1 of 7 | Next"

## Komponen

### `Pagination`
Komponen pagination dasar dengan navigasi Previous/Next dan informasi halaman.

### `ExtendedPagination`
Komponen pagination dengan opsi untuk menampilkan nomor halaman.

## Props

```typescript
interface PaginationProps {
  currentPage: number;        // Halaman saat ini (1-based)
  totalPages: number;         // Total halaman
  totalItems: number;         // Total item
  itemsPerPage: number | "all"; // Item per halaman atau "all"
  itemLabel?: string;         // Label untuk item (default: "items")
  onPageChange: (page: number) => void; // Callback saat halaman berubah
  className?: string;         // CSS class tambahan
  showInfo?: boolean;         // Tampilkan info "Showing X-Y of Z" (default: true)
}
```

## Penggunaan

### Basic Usage

```tsx
import { Pagination } from "@/components/common/Pagination";

<Pagination
  currentPage={currentPage}
  totalPages={totalPages}
  totalItems={totalMembers}
  itemsPerPage={perPage}
  itemLabel="members"
  onPageChange={(page) => fetchMembers(page, searchQuery)}
/>
```

### Extended Usage dengan Page Numbers

```tsx
import { ExtendedPagination } from "@/components/common/Pagination";

<ExtendedPagination
  currentPage={currentPage}
  totalPages={totalPages}
  totalItems={totalItems}
  itemsPerPage={perPage}
  itemLabel="items"
  onPageChange={handlePageChange}
  showPageNumbers={true}
  maxVisiblePages={5}
/>
```

## Fitur

### 1. Responsive Design
- Tombol Previous/Next dengan icon dan teks
- Teks tersembunyi di layar kecil (mobile)
- Info halaman yang adaptif

### 2. Internationalization
- Mendukung multi-bahasa melalui i18n
- Teks dapat dikustomisasi per bahasa

### 3. Accessibility
- Tombol disabled saat tidak dapat digunakan
- ARIA labels yang sesuai
- Keyboard navigation support

### 4. Flexible Item Labels
- Dapat menampilkan berbagai jenis item (members, users, ads, etc.)
- Label dapat disesuaikan dengan konteks

## Styling

Komponen menggunakan Tailwind CSS dengan:
- `border-t` untuk garis pemisah atas
- `bg-background` untuk background
- `text-muted-foreground` untuk teks sekunder
- `Button` component dengan variant `outline`

## Contoh Implementasi

### 1. Admin List Members
```tsx
<Pagination
  currentPage={currentPage}
  totalPages={totalPages}
  totalItems={totalMembers}
  itemsPerPage={perPage}
  itemLabel="members"
  onPageChange={(page) => fetchMembers(page, searchQuery)}
/>
```

### 2. Admin Users
```tsx
<Pagination
  currentPage={currentPage}
  totalPages={totalPages}
  totalItems={totalUsers}
  itemsPerPage={perPage}
  itemLabel="users"
  onPageChange={handlePageChange}
/>
```

### 3. Advertisement List
```tsx
<Pagination
  currentPage={currentPage}
  totalPages={totalPages}
  totalItems={totalAds}
  itemsPerPage={perPage}
  itemLabel="ads"
  onPageChange={handlePageChange}
/>
```

## Localization Keys

Komponen menggunakan key i18n berikut:

```json
{
  "pagination": {
    "showing": "Showing {start}-{end} of {total} {items}",
    "previous": "Previous",
    "next": "Next",
    "page": "Page",
    "of": "of",
    "first": "First",
    "last": "Last"
  }
}
```

### Bahasa Indonesia
```json
{
  "pagination": {
    "showing": "Menampilkan {start}-{end} dari {total} {items}",
    "previous": "Sebelumnya",
    "next": "Selanjutnya",
    "page": "Halaman",
    "of": "dari",
    "first": "Pertama",
    "last": "Terakhir"
  }
}
```

## Best Practices

1. **Konsistensi**: Gunakan komponen ini di semua halaman yang memerlukan pagination
2. **Item Labels**: Sesuaikan `itemLabel` dengan konteks (members, users, ads, etc.)
3. **Performance**: Pastikan `onPageChange` tidak menyebabkan re-render yang tidak perlu
4. **Accessibility**: Selalu berikan feedback visual untuk state disabled
5. **Mobile**: Pastikan komponen tetap usable di layar kecil

## Migration dari Pagination Lama

Untuk mengganti implementasi pagination lama:

1. Import komponen Pagination
2. Ganti implementasi manual dengan komponen
3. Sesuaikan props sesuai kebutuhan
4. Test responsivitas dan functionality

### Before
```tsx
<div className="flex items-center justify-between p-4 border-t">
  <div className="text-sm text-muted-foreground">
    Showing {start}-{end} of {total} items
  </div>
  <div className="flex items-center space-x-2">
    <Button onClick={handlePrevious} disabled={currentPage <= 1}>
      Previous
    </Button>
    <span>Page {currentPage} of {totalPages}</span>
    <Button onClick={handleNext} disabled={currentPage >= totalPages}>
      Next
    </Button>
  </div>
</div>
```

### After
```tsx
<Pagination
  currentPage={currentPage}
  totalPages={totalPages}
  totalItems={totalItems}
  itemsPerPage={perPage}
  itemLabel="items"
  onPageChange={handlePageChange}
/>
```
