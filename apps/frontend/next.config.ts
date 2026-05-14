import type { NextConfig } from 'next';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const isDev = process.env.NODE_ENV !== 'production';

const nextConfig: NextConfig = {
  devIndicators: false,
  eslint: { ignoreDuringBuilds: true },
  transpilePackages: ['@pos-cloud/shared'],
  outputFileTracingRoot: path.join(__dirname, '../..'),

  // Proxy /api/v1/* → local Fastify backend (used when NEXT_PUBLIC_USE_PROXY=true)
  // This lets mobile/LAN devices reach the backend through the Next.js server
  // without CORS or "localhost resolves to phone" problems.
  async rewrites() {
    if (process.env.NEXT_PUBLIC_USE_PROXY !== 'true') return [];
    const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
    return [
      { source: '/api/v1/:path*', destination: `${backend}/api/v1/:path*` },
    ];
  },

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          // HSTS — only in production (avoids localhost HTTPS issues in dev)
          ...(isDev ? [] : [
            {
              key: 'Strict-Transport-Security',
              value: 'max-age=31536000; includeSubDomains; preload',
            },
          ]),
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              // Next.js requires 'unsafe-inline' for its runtime scripts
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              // Google Fonts stylesheets
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              // Google Fonts font files
              "font-src 'self' https://fonts.gstatic.com data:",
              // Allow Supabase storage images
              "img-src 'self' data: blob: https://*.supabase.co",
              // Allow Supabase auth + CF Worker API + direct WS backend
              // WS goes direct to backend because CF Worker does not proxy WebSocket upgrades
              // NEXT_PUBLIC_LOCAL_API_URL — dev override ให้ชี้ Fastify ที่ localhost โดยตรง
              [
                "connect-src 'self'",
                'https://*.supabase.co',
                'wss://*.supabase.co',
                'https://api.line.me',
                'https://access.line.me',
                'https://obs.line-scdn.net',
                process.env.NEXT_PUBLIC_API_URL ?? '',
                (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/^http/, 'ws'),
                process.env.NEXT_PUBLIC_WS_URL ?? '',
                process.env.NEXT_PUBLIC_API_URL_DIRECT ?? '',
                process.env.NEXT_PUBLIC_LOCAL_API_URL ?? '',
                (process.env.NEXT_PUBLIC_LOCAL_API_URL ?? '').replace(/^http/, 'ws'),
              ].filter(Boolean).join(' '),
              "object-src 'none'",
              "frame-ancestors 'none'",
            ].join('; '),
          },
        ],
      },
    ];
  },

  images: {
    // Allow Supabase Storage CDN URLs
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
    // Optimised size steps matching the POS UI grid and admin thumbnail
    deviceSizes: [640, 750, 828, 1080, 1200],
    imageSizes:  [16, 32, 48, 56, 64, 96, 128, 256],
  },
};

export default nextConfig;
