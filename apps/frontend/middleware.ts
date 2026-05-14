/**
 * middleware.ts — Edge-compatible request tracking
 *
 * Runs on the Edge Runtime (no Node.js native modules).
 * Stamps every request with:
 *   - X-Request-Id  (UUID v4 via Web Crypto)
 *   - X-Request-Start  (Unix ms — for execution_time calc in API routes)
 *
 * Actual DB persistence is done in API route handlers (Node.js runtime)
 * using lib/audit.ts — this file only propagates tracing headers.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const response = NextResponse.next();

  // Propagate or generate request-id
  const existing = request.headers.get('x-request-id');
  const requestId = existing ?? crypto.randomUUID();

  // Stamp both request (for downstream) and response (for client correlation)
  response.headers.set('x-request-id',    requestId);
  response.headers.set('x-request-start', String(Date.now()));

  return response;
}

export const config = {
  // Run on all routes except Next.js internals and static assets
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?|ttf|otf|css|js)).*)',
  ],
};
