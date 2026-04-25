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
              "style-src 'self' 'unsafe-inline'",
              // Allow Supabase storage images
              "img-src 'self' data: blob: https://*.supabase.co",
              // Allow Supabase auth + CF Worker API + direct WS backend
              // WS goes direct to backend because CF Worker does not proxy WebSocket upgrades
              // NEXT_PUBLIC_LOCAL_API_URL — dev override ให้ชี้ Fastify ที่ localhost โดยตรง
              [
                "connect-src 'self'",
                'https://*.supabase.co',
                'wss://*.supabase.co',
                process.env.NEXT_PUBLIC_API_URL ?? '',
                (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/^http/, 'ws'),
                process.env.NEXT_PUBLIC_WS_URL ?? '',
                process.env.NEXT_PUBLIC_API_URL_DIRECT ?? '',
                process.env.NEXT_PUBLIC_LOCAL_API_URL ?? '',
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
