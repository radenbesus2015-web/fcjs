import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Disable strict mode to prevent double rendering in development
  reactStrictMode: false,
  
  // Performance optimizations
  compress: true,
  poweredByHeader: false,
  
  // Experimental features for better performance
  experimental: {
    optimizePackageImports: [
      'lucide-react',
      '@radix-ui/react-dialog',
      '@radix-ui/react-dropdown-menu',
      '@radix-ui/react-select',
      'recharts',
    ],
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
  
  async rewrites() {
    return [
      // Proxy API routes to backend (port 8000)
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
      // Admin Config endpoints (required by admin/config page)
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
