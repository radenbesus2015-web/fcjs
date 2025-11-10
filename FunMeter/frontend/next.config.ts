import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Disable strict mode to prevent double rendering in development
  reactStrictMode: false,
  
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
  },
  
  async headers() {
    return [
      {
        // Apply these headers to all routes
        source: '/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-cache, no-store, must-revalidate',
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
