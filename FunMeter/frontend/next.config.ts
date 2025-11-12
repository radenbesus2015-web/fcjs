import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enable strict mode to catch potential issues early
  // Fixed hydration issues in providers, so we can safely enable this
  reactStrictMode: true,
  
  // Performance optimizations
  compress: true,
  poweredByHeader: false,
  
  // Turbopack configuration (Next.js 16 default bundler)
  // Empty config silences the webpack warning
  turbopack: {},
  
  // Compiler optimizations
  compiler: {
    // Remove console logs in production
    removeConsole: process.env.NODE_ENV === 'production' ? {
      exclude: ['error', 'warn'],
    } : false,
  },
  
  // Experimental features for better performance
  experimental: {
    optimizePackageImports: [
      'lucide-react',
      '@radix-ui/react-dialog',
      '@radix-ui/react-dropdown-menu',
      '@radix-ui/react-select',
      'recharts',
      'socket.io-client',
    ],
    // Optimize CSS
    optimizeCss: true,
  },
  
  // Prevent hydration errors
  onDemandEntries: {
    // Keep pages in memory longer to prevent hydration issues
    maxInactiveAge: 60 * 1000,
    pagesBufferLength: 5,
  },
  
  // Allow images from Supabase Storage and localhost backend
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        port: '',
        pathname: '/storage/v1/object/public/**',
      },
      {
        protocol: 'http',
        hostname: 'localhost',
        port: '8000',
        pathname: '/**',
      },
    ],
    unoptimized: false,
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 60,
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
  },
  
  async headers() {
    return [
      {
        // Cache static assets aggressively
        source: '/assets/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      {
        // Cache API routes for 5 minutes
        source: '/admin/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=300, stale-while-revalidate=60',
          },
        ],
      },
      {
        // Cache pages for 1 hour, revalidate in background
        source: '/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=3600, stale-while-revalidate=86400',
          },
        ],
      },
    ];
  },
  
  // Rewrites dihapus karena kita menggunakan API routes di app/api/[...path]/route.ts
  // API routes akan proxy request ke backend yang di-deploy terpisah
  // Untuk development, backend URL bisa di-set via NEXT_PUBLIC_BACKEND_URL atau BACKEND_URL
  // Untuk production, set NEXT_PUBLIC_BACKEND_URL di Vercel environment variables
  async rewrites() {
    // Di development, jika NEXT_PUBLIC_USE_API_ROUTES tidak di-set, 
    // kita bisa tetap menggunakan rewrites untuk kemudahan
    const useApiRoutes = process.env.NEXT_PUBLIC_USE_API_ROUTES === 'true' || 
                         process.env.NODE_ENV === 'production';
    
    if (useApiRoutes) {
      // Di production atau jika explicitly di-set, tidak perlu rewrites
      // Semua request akan melalui /api/[...path] yang akan proxy ke backend
      return [];
    }
    
    // Di development, tetap gunakan rewrites untuk kemudahan
    return [
      {
        source: "/face/register",
        destination: "http://localhost:8000/register-face",
      },
      {
        source: "/face/:path*",
        destination: "http://localhost:8000/face/:path*",
      },
      {
        source: "/register-face/:path*",
        destination: "http://localhost:8000/register-face/:path*",
      },
      {
        source: "/admin/:path*",
        destination: "http://localhost:8000/admin/:path*",
      },
      {
        source: "/admin/attendance/:path*",
        destination: "http://localhost:8000/admin/attendance/:path*",
      },
      {
        source: "/auth/:path*",
        destination: "http://localhost:8000/auth/:path*",
      },
      {
        source: "/recognize-image",
        destination: "http://localhost:8000/recognize-image",
      },
      {
        source: "/attendance-log",
        destination: "http://localhost:8000/attendance-log",
      },
      {
        source: "/orgs/:path*",
        destination: "http://localhost:8000/orgs/:path*",
      },
      {
        source: "/register-db-data",
        destination: "http://localhost:8000/register-db-data",
      },
      {
        source: "/register-dataset",
        destination: "http://localhost:8000/register-dataset",
      },
      {
        source: "/config",
        destination: "http://localhost:8000/config",
      },
      {
        source: "/config/reset",
        destination: "http://localhost:8000/config/reset",
      },
    ];
  },
};

export default nextConfig;
