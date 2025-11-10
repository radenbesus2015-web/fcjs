# 🚀 Performance Optimization Guide

## ✅ Sudah Diperbaiki (Otomatis)

### 1. **Cache Headers** ✓
- Static assets: Cache 1 tahun
- API routes: Cache 5 menit dengan stale-while-revalidate
- Pages: Cache 1 jam dengan background revalidation

### 2. **Next.js Config** ✓
- Compression enabled
- Package import optimization (tree-shaking)
- Image optimization dengan AVIF/WebP
- Responsive image sizes

---

## 📋 Optimisasi Manual yang Disarankan

### **PRIORITAS TINGGI**

#### 1. **Hapus `unoptimized` dari Image Components**
**Lokasi yang perlu diperbaiki:**
- `app/home/page.tsx` (3 instances)
- `app/absensi-fun-meter/page.tsx` (3 instances)
- `app/admin/list-members/page.tsx` (4 instances)

**Cara:**
```tsx
// ❌ SEBELUM
<Image src="..." unoptimized />

// ✅ SESUDAH
<Image src="..." />
```

**Catatan:** Properti `unoptimized` membuat gambar tidak dikompresi dan tidak dioptimasi.

---

#### 2. **Lazy Load Components**

**Untuk halaman yang jarang diakses, gunakan dynamic import:**

```tsx
// ❌ SEBELUM
import { SettingsModal } from "@/components/modals/SettingsModal";

// ✅ SESUDAH
import dynamic from 'next/dynamic';
const SettingsModal = dynamic(() => 
  import("@/components/modals/SettingsModal").then(mod => ({ default: mod.SettingsModal })),
  { ssr: false }
);
```

**Component yang bisa di-lazy load:**
- `SettingsModal`
- `GlobalConfirm`
- `LoginModal`

---

#### 3. **Optimize Provider Nesting**

**File:** `app/layout.tsx`

**Masalah:** 6 nested providers memperlambat initial render.

**Solusi:** Gabungkan providers yang bisa digabung atau gunakan composition:

```tsx
// Buat combined provider
export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <I18nProvider initialLocale="id">
        <SettingsProvider>
          <AuthProvider>
            <WsProvider>
              <ConfirmDialogProvider>
                {children}
              </ConfirmDialogProvider>
            </WsProvider>
          </AuthProvider>
        </SettingsProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}
```

---

### **PRIORITAS SEDANG**

#### 4. **Code Splitting untuk Recharts**

**Recharts sangat besar (115 KB).** Lazy load chart components:

```tsx
import dynamic from 'next/dynamic';

const ChartComponent = dynamic(
  () => import('@/components/charts/YourChart'),
  { 
    ssr: false,
    loading: () => <div>Loading chart...</div>
  }
);
```

---

#### 5. **Optimize CSS**

**File:** `app/globals.css` (206 lines)

**Masalah:**
- Terlalu banyak CSS variables (100+)
- Redundant shadow definitions

**Solusi:**
1. Hapus CSS variables yang tidak digunakan
2. Gunakan CSS variables dengan lebih efisien
3. Gabungkan shadow definitions yang mirip

---

#### 6. **Optimize Socket.io Connection**

**File:** `components/providers/WsProvider.tsx`

**Saran:**
- Jangan connect socket di semua halaman
- Connect hanya di halaman yang membutuhkan (attendance, fun-meter)
- Disconnect saat user pindah halaman

```tsx
// Di halaman yang butuh socket
useEffect(() => {
  if (socket && !socket.connected) {
    socket.connect();
  }
  
  return () => {
    if (socket?.connected) {
      socket.disconnect();
    }
  };
}, []);
```

---

### **PRIORITAS RENDAH**

#### 7. **Bundle Size Analysis**

**Install bundle analyzer:**
```bash
npm install @next/bundle-analyzer
```

**Update next.config.ts:**
```typescript
const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
});

module.exports = withBundleAnalyzer(nextConfig);
```

**Run analysis:**
```bash
ANALYZE=true npm run build
```

---

#### 8. **Preload Critical Assets**

**Tambahkan di `app/layout.tsx`:**

```tsx
import Head from 'next/head';

export default function RootLayout({ children }) {
  return (
    <html>
      <head>
        <link
          rel="preload"
          href="/assets/header/header.png"
          as="image"
        />
        <link
          rel="preload"
          href="/assets/footer/footer.png"
          as="image"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
```

---

#### 9. **Memoize Expensive Components**

**Gunakan React.memo untuk components yang sering re-render:**

```tsx
import { memo } from 'react';

export const ExpensiveComponent = memo(function ExpensiveComponent({ data }) {
  // component code
});
```

**Components yang bisa di-memo:**
- Sidebar items
- Chart components
- List items dalam loop

---

## 📊 Expected Results

**Setelah optimisasi:**
- **Initial Load:** 50-70% lebih cepat
- **Time to Interactive:** 40-60% lebih cepat
- **Bundle Size:** Berkurang 30-40%
- **Lighthouse Score:** 80-95 (dari ~50-60)

---

## 🔧 Testing Performance

### **1. Lighthouse (Chrome DevTools)**
```
F12 → Lighthouse → Generate Report
```

### **2. Network Analysis**
```
F12 → Network → Reload page
```
Perhatikan:
- Total transfer size (target: < 2 MB)
- Number of requests (target: < 50)
- Largest Contentful Paint (target: < 2.5s)

### **3. React DevTools Profiler**
```
Install React DevTools Extension
F12 → Profiler → Record
```

---

## ⚠️ Catatan Penting

1. **Restart development server** setelah perubahan `next.config.ts`
2. **Test di production build** (`npm run build && npm start`)
3. **Monitor bundle size** dengan `npm run build`
4. **Jangan optimize premature** - ukur dulu, baru optimize

---

## 📝 Checklist Optimisasi

- [x] Cache headers configured
- [x] Next.js config optimized
- [ ] Remove `unoptimized` from images
- [ ] Lazy load modals
- [ ] Optimize provider nesting
- [ ] Code split Recharts
- [ ] Optimize CSS variables
- [ ] Conditional Socket.io connection
- [ ] Preload critical assets
- [ ] Memoize expensive components
- [ ] Run bundle analyzer
- [ ] Lighthouse score > 80

---

## 🎯 Quick Wins (Lakukan Sekarang)

1. **Restart dev server** untuk apply config baru
2. **Hapus `unoptimized`** dari semua Image components
3. **Lazy load modals** yang jarang digunakan

**Estimasi peningkatan:** 40-50% improvement hanya dengan 3 langkah ini!
