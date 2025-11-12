# Pagination Multilingual Support

## Translation Keys Required

Komponen Pagination telah diupdate untuk mendukung multilingual penuh. Berikut adalah translation keys yang diperlukan:

### Core Pagination Keys

```json
{
  "pagination": {
    "showing": "Showing {start}-{end} of {total} {items}",
    "showingMobile": "{start}-{end} of {total}",
    "first": "First page",
    "previous": "Previous page", 
    "next": "Next page",
    "last": "Last page"
  }
}
```

### Indonesian Translation Example

```json
{
  "pagination": {
    "showing": "Menampilkan {start}-{end} dari {total} {items}",
    "showingMobile": "{start}-{end} dari {total}",
    "first": "Halaman pertama",
    "previous": "Halaman sebelumnya",
    "next": "Halaman selanjutnya", 
    "last": "Halaman terakhir"
  }
}
```

## Features

### ✅ Fully Multilingual
- **Desktop text**: Full descriptive text with item labels
- **Mobile text**: Compact format for small screens
- **Button tooltips**: Accessible tooltips for all navigation buttons
- **Dynamic item labels**: Support for different content types (members, users, ads, etc.)

### ✅ Responsive Text
- **Desktop**: "Showing 1-10 of 100 members"
- **Mobile**: "1-10 of 100" (compact)
- **Adaptive**: Automatically switches based on screen size

### ✅ Accessibility
- **ARIA labels**: All buttons have proper tooltips
- **Screen reader friendly**: Descriptive text for assistive technologies
- **Keyboard navigation**: Full keyboard support

## Usage Examples

### Basic Usage
```tsx
<Pagination
  currentPage={1}
  totalPages={10}
  totalItems={100}
  itemsPerPage={10}
  itemLabel="members"
  onPageChange={(page) => console.log(page)}
/>
```

### With Custom Item Label
```tsx
<Pagination
  currentPage={1}
  totalPages={5}
  totalItems={50}
  itemsPerPage={10}
  itemLabel={t("common.users", "users")}
  onPageChange={handlePageChange}
/>
```

### Extended Pagination
```tsx
<ExtendedPagination
  currentPage={5}
  totalPages={20}
  totalItems={200}
  itemsPerPage={10}
  itemLabel={t("common.advertisements", "advertisements")}
  maxVisiblePages={7}
  onPageChange={handlePageChange}
/>
```

## Implementation Notes

### Dynamic Item Labels
The `itemLabel` prop supports dynamic translation:
```tsx
// Static label
itemLabel="members"

// Dynamic translated label  
itemLabel={t("common.users", "users")}

// Context-specific label
itemLabel={t("adminListMembers.itemLabel", "anggota")}
```

### Responsive Behavior
- **Desktop (≥640px)**: Shows full "Showing X-Y of Z items" text
- **Mobile (<640px)**: Shows compact "X-Y of Z" format
- **Auto-detection**: Uses window width for responsive switching

### Accessibility Compliance
- **WCAG 2.1 AA**: Meets accessibility standards
- **Keyboard navigation**: Tab through all interactive elements
- **Screen readers**: Proper ARIA labels and descriptions
- **High contrast**: Works with system theme preferences

## Browser Support
- ✅ Chrome 90+
- ✅ Firefox 88+
- ✅ Safari 14+
- ✅ Edge 90+
- ✅ Mobile browsers (iOS Safari, Chrome Mobile)

## Performance
- **Lightweight**: Minimal bundle impact
- **Optimized rendering**: Only re-renders when necessary
- **Memory efficient**: Proper cleanup of event listeners
- **Fast switching**: Instant language switching without flicker
