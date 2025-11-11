// middleware.ts
// Port dari src-vue-original/router/index.js router.beforeEach untuk admin guards

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { CONFIG } from './lib/config';

interface User {
  id?: string | number;
  username?: string;
  is_admin?: boolean;
  is_owner?: boolean;
  [key: string]: unknown;
}

// Fungsi untuk memverifikasi user dari API
async function verifyUser(apiKey: string): Promise<{ user: User | null; isValid: boolean }> {
  if (!apiKey) {
    return { user: null, isValid: false };
  }

  try {
    // Panggil API untuk verifikasi token
    const base = (CONFIG.HTTP_API || process.env.NEXT_PUBLIC_WS_HTTP_BASE || '').replace(/\/+$/, '');
    const url = `${base}/auth/me`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      return { user: null, isValid: false };
    }

    const data = await response.json();
    return { user: data.user || data, isValid: true };
  } catch (error) {
    console.error('Auth verification failed:', error);
    return { user: null, isValid: false };
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip middleware untuk file statis dan API routes
  if (
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/api/') ||
    pathname.includes('.') ||
    pathname === '/favicon.ico'
  ) {
    return NextResponse.next();
  }

  // Cek apakah route memerlukan admin atau owner
  const needsOwner = pathname.startsWith('/admin/config');
  const needsAdmin = pathname.startsWith('/admin') && !needsOwner;

  if (!needsOwner && !needsAdmin) {
    return NextResponse.next();
  }

  // Ambil token dari cookie atau header
  const apiKey = request.cookies.get('api_key')?.value || 
                 request.headers.get('authorization')?.replace('Bearer ', '');

  const { user, isValid } = await verifyUser(apiKey || '');

  if (needsOwner) {
    if (isValid && user?.is_owner) {
      return NextResponse.next();
    }
    
    // Redirect ke home dengan pesan error
    const url = request.nextUrl.clone();
    url.pathname = '/';
    url.searchParams.set('redirect', pathname);
    url.searchParams.set('error', 'owner_required');
    return NextResponse.redirect(url);
  }

  if (needsAdmin) {
    if (isValid && user?.is_admin) {
      return NextResponse.next();
    }
    
    // Redirect ke home dengan pesan error
    const url = request.nextUrl.clone();
    url.pathname = '/';
    url.searchParams.set('redirect', pathname);
    url.searchParams.set('error', 'admin_required');
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
};
