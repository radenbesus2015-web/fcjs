# Fix untuk Error pada Banyak Page

## Masalah yang Ditemukan

### 1. **Admin Index Page Error**
**Lokasi**: `app/admin/page.tsx`

**Error**:
```
Error: redirect() can only be called from Server Components
```

**Penyebab**:
- Admin layout adalah **client component** (`"use client"`)
- Admin index page menggunakan `redirect()` dari Next.js (server-side function)
- Conflict antara server dan client component

**Solusi** ✅:
```typescript
// BEFORE (❌ Error)
import { redirect } from "next/navigation";

export default function AdminIndexPage() {
  redirect("/admin/dashboard");
}

// AFTER (✅ Fixed)
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AdminIndexPage() {
  const router = useRouter();
  
  useEffect(() => {
    router.replace("/admin/dashboard");
  }, [router]);
  
  return null;
}
```

### 2. **Admin Layout Error**
**Lokasi**: `app/admin/layout.tsx`

**Error**:
```
Hydration mismatch on all admin pages
localStorage is not defined
useAuth/useI18n hooks fail
```

**Penyebab**:
- Admin layout menggunakan hooks yang akses localStorage
- Semua child pages (dashboard, users, attendance, dll) inherit masalah ini
- Tidak ada guard untuk client-side mounting

**Solusi** ✅:
```typescript
// BEFORE (❌ Error)
export default function AdminLayout({ children }) {
  const { status, user } = useAuth(); // Langsung akses localStorage
  // ... rest of code
}

// AFTER (✅ Fixed)
export default function AdminLayout({ children }) {
  const [mounted, setMounted] = useState(false);
  
  useEffect(() => {
    setMounted(true);
  }, []);
  
  // Wait for client-side mount
  if (!mounted) {
    return <LoadingSpinner />;
  }
  
  // ... rest of code
}
```

**Impact**:
- ✅ Fixes **ALL** admin pages dengan single fix
- ✅ `/admin/dashboard` - Fixed
- ✅ `/admin/users` - Fixed
- ✅ `/admin/attendance` - Fixed
- ✅ `/admin/config` - Fixed
- ✅ Dan semua admin pages lainnya

### 3. **Register Face Page Error**
**Lokasi**: `app/register-face/page.tsx`

**Error**:
```
Hydration mismatch
WebSocket connection failed
localStorage is not defined
```

**Penyebab**:
- Page menggunakan **WebSocket**, **Camera API**, dan **localStorage** langsung
- Tidak ada guard untuk menunggu client-side mounting
- SSR render berbeda dengan CSR render

**Solusi** ✅:
```typescript
// BEFORE (❌ Error)
export default function RegisterFacePage() {
  const socket = useWs({ root: true }); // Langsung akses WebSocket
  const { useSetting } = useSettings(); // Langsung akses localStorage
  // ... rest of code
}

// AFTER (✅ Fixed)
function RegisterFacePageContent() {
  // Component content with browser APIs
}

export default function RegisterFacePage() {
  const { t } = useI18n();
  
  return (
    <ClientOnly loaderText={t("common.loading", "Memuat...")}>
      <RegisterFacePageContent />
    </ClientOnly>
  );
}
```

## Komponen Baru yang Dibuat

### ClientOnly Component
**Lokasi**: `components/providers/ClientOnly.tsx`

**Tujuan**:
- Prevent hydration mismatch untuk components yang menggunakan browser APIs
- Show loader saat menunggu client-side mounting
- Flexible dengan custom fallback

**Usage**:
```typescript
import { ClientOnly } from "@/components/providers/ClientOnly";

export default function MyPage() {
  return (
    <ClientOnly 
      loaderText="Loading..." 
      showLoader={true}
    >
      <MyPageContent />
    </ClientOnly>
  );
}
```

## Pattern untuk Prevent Hydration Errors

### ✅ DO: Wrap Client-Only Pages
```typescript
// Pages yang menggunakan:
// - WebSocket
// - Camera/MediaDevices
// - localStorage/sessionStorage
// - window/document APIs
// - navigator APIs

export default function MyPage() {
  return (
    <ClientOnly>
      <MyPageContent />
    </ClientOnly>
  );
}
```

### ❌ DON'T: Direct Access Browser APIs
```typescript
// ❌ JANGAN seperti ini
export default function MyPage() {
  const [data, setData] = useState(() => {
    return localStorage.getItem('key'); // ERROR!
  });
  
  useEffect(() => {
    const ws = new WebSocket('ws://...'); // ERROR di SSR!
  }, []);
}
```

### ✅ DO: Use Mounted State Pattern
```typescript
// ✅ Atau gunakan pattern ini
export default function MyPage() {
  const [mounted, setMounted] = useState(false);
  
  useEffect(() => {
    setMounted(true);
  }, []);
  
  if (!mounted) {
    return <LoadingSpinner />;
  }
  
  return <PageContent />;
}
```

## Kapan Menggunakan ClientOnly?

### Gunakan ClientOnly untuk:
- ✅ Pages dengan Camera/Video
- ✅ Pages dengan WebSocket real-time
- ✅ Pages dengan Canvas/WebGL
- ✅ Pages dengan geolocation
- ✅ Pages dengan third-party scripts yang akses DOM
- ✅ Pages dengan localStorage intensive operations

### TIDAK Perlu ClientOnly untuk:
- ❌ Simple form pages
- ❌ Static content pages
- ❌ Pages dengan API calls saja (fetch/axios)
- ❌ Pages dengan state management saja

## Testing Checklist

### 1. Test Hard Refresh
```bash
# Buka page
# Tekan Ctrl+Shift+R (hard refresh)
# ✅ Should load tanpa error
```

### 2. Test Navigation
```bash
# Navigate dari page lain
# Navigate ke page
# ✅ Should load tanpa error
```

### 3. Test Console
```bash
# Buka DevTools Console
# ✅ No hydration errors
# ✅ No "X is not defined" errors
# ✅ No WebSocket connection errors (kecuali server down)
```

## List Pages yang Sudah Diperbaiki

### Fixed ✅
1. `app/admin/page.tsx` - Changed to client-side redirect
2. `app/admin/layout.tsx` - **Added mounted state** (fixes ALL admin pages)
3. `app/register-face/page.tsx` - Wrapped dengan ClientOnly
4. **All admin pages** (`/admin/*`) - Fixed via layout mounted state

### Potentially Need Fix (Check if errors occur)
1. `app/absensi-fun-meter/page.tsx` - Uses WebSocket & Camera
2. `app/attendance/page.tsx` - Uses Camera
3. `app/fun-meter/page.tsx` - Uses Camera & WebSocket
4. `app/home/page.tsx` - Check if uses browser APIs

## Quick Fix Pattern

Jika menemukan error pada page lain:

### Step 1: Check Error
```bash
# Lihat browser console
# Cari:
- "Hydration failed"
- "X is not defined" (localStorage, window, navigator, etc)
- "WebSocket connection failed"
```

### Step 2: Identify Cause
```typescript
// Cari di code:
- useEffect yang akses browser APIs
- useState dengan localStorage
- Direct WebSocket initialization
- Camera/MediaDevices access
```

### Step 3: Apply Fix
```typescript
// Option 1: Wrap dengan ClientOnly (recommended untuk complex pages)
export default function MyPage() {
  return (
    <ClientOnly>
      <MyPageContent />
    </ClientOnly>
  );
}

// Option 2: Add mounted state (untuk simple cases)
const [mounted, setMounted] = useState(false);
useEffect(() => { setMounted(true); }, []);
if (!mounted) return <Loader />;
```

## Best Practices

### 1. **Always Use ClientOnly for Browser APIs**
```typescript
// ✅ Good
export default function CameraPage() {
  return (
    <ClientOnly>
      <CameraComponent />
    </ClientOnly>
  );
}
```

### 2. **Provider-Level Fixes Done**
Providers sudah diperbaiki dengan mounted state:
- ✅ ThemeProvider
- ✅ SettingsProvider
- ✅ I18nProvider

### 3. **Error Boundaries in Place**
- ✅ ErrorBoundary di layout
- ✅ error.tsx untuk page-level errors
- ✅ global-error.tsx untuk global errors

### 4. **Next.js Config Optimized**
- ✅ reactStrictMode: true
- ✅ onDemandEntries configured
- ✅ Better memory management

## Monitoring

### Check Browser Console
```bash
# Development
npm run dev

# Look for:
- [HMR] messages (normal)
- No error messages
- No warning messages about hydration
```

### Check Build
```bash
# Production build
npm run build

# Should see:
- ✓ Compiled successfully
- No warnings about hydration
- No errors
```

## Summary

**Root Cause**:
1. Server-side functions di client components (admin/page.tsx)
2. Browser APIs accessed sebelum client-side mounting
3. **Admin layout** tidak menunggu client-side mounting → affects ALL admin pages

**Solution**:
1. ✅ Changed admin redirect to client-side useRouter
2. ✅ **Added mounted state to admin/layout.tsx** → fixes ALL admin pages
3. ✅ Created ClientOnly wrapper component
4. ✅ Wrapped browser-API-heavy pages dengan ClientOnly
5. ✅ Error boundaries untuk graceful error handling

**Result**:
- ✅ No more "hard refresh required"
- ✅ No more hydration errors
- ✅ **All admin pages now work** (dashboard, users, attendance, config, dll)
- ✅ Smooth navigation between pages
- ✅ Better error handling dengan fallback UI

**Key Fix for Admin Pages**:
Single fix di `admin/layout.tsx` dengan mounted state pattern automatically fixes **semua** admin pages tanpa perlu modify setiap page individual.
