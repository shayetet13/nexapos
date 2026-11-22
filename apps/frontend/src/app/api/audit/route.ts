/**
 * app/api/audit/route.ts — Audit proxy endpoint (Node.js runtime)
 *
 * POST — receives client-side audit events from lib/audit.ts,
 *         logs to stdout and forwards to the Fastify backend for DB persistence.
 * GET  — proxies paginated audit-log queries to the Fastify backend
 *         for the admin panel and dev dashboard.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient }              from '@supabase/supabase-js';
import { createServerClient }        from '@supabase/ssr';
import { cookies }                   from 'next/headers';
import type { User }                 from '@supabase/supabase-js';

// ─── Minimal stdout logger (no extra deps — backend handles pino+DB) ──────────

const isDev = process.env.NODE_ENV !== 'production';

const log = {
  info:  (msg: string, data?: unknown) => isDev && console.log( `[audit] ${msg}`, data ?? ''),
  error: (msg: string, data?: unknown) => console.error(`[audit:err] ${msg}`, data ?? ''),
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const BACKEND_URL = process.env.BACKEND_URL
                 ?? process.env.NEXT_PUBLIC_API_URL
                 ?? 'http://localhost:4000';

function bearerFromRequest(req: NextRequest): string | null {
  const h = req.headers.get('Authorization');
  if (!h?.toLowerCase().startsWith('bearer ')) return null;
  const t = h.slice(7).trim();
  return t || null;
}

/**
 * Access token: cookies first (SSR session), else Bearer (same as fetchWithAuth on the client).
 * In production, cookie chunks may be missing on the server while the browser still has a
 * valid access token in memory and sends it — without this fallback, GET /api/audit returns 401
 * and fetchWithAuth redirects to /login.
 */
async function getTokenForRequest(req: NextRequest): Promise<string> {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll() {},
      },
    },
  );
  const { data: { session } } = await supabase.auth.getSession();
  const fromCookies = session?.access_token ?? '';
  return fromCookies || bearerFromRequest(req) || '';
}

/** Resolve user: cookie session first, then validate via Bearer (must match getTokenForRequest). */
async function getUserForRequest(req: NextRequest): Promise<User | null> {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll() {},
      },
    },
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (user) return user;

  const bearer = bearerFromRequest(req);
  if (!bearer) return null;

  const withAuth = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${bearer}` } } },
  );
  const { data: { user: u2 }, error } = await withAuth.auth.getUser();
  if (error || !u2) return null;
  return u2;
}

// ─── POST /api/audit ─────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Record<string, unknown>;
    const requestId = req.headers.get('x-request-id') ?? crypto.randomUUID();
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
            ?? req.headers.get('x-real-ip')
            ?? '0.0.0.0';

    // Log to stdout (dev only — backend persists to DB)
    const event = (body.event as string) ?? body.type ?? 'client_event';
    log.info(`[frontend] ${event}`, { request_id: requestId, ip_address: ip });

    // Forward to backend (fire-and-forget — don't await to keep response fast)
    const token = await getTokenForRequest(req);
    if (token) {
      fetch(`${BACKEND_URL}/api/v1/audit/ingest`, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ ...body, request_id: requestId, ip_address: ip }),
      }).catch(() => {/* backend unavailable — stdout already logged */});
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    log.error('POST failed', err);
    return NextResponse.json({ ok: false });
  }
}

// ─── GET /api/audit ──────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const user = await getUserForRequest(req);
  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const shopId = searchParams.get('shop_id');
  const isDev  = searchParams.get('dev') === '1';

  const isStats = searchParams.get('stats') === '1';

  let targetUrl: string;
  if (isDev) {
    const params = new URLSearchParams(searchParams);
    params.delete('dev');
    params.delete('stats');
    targetUrl = isStats
      ? `${BACKEND_URL}/api/v1/dev/audit/stats?${params.toString()}`
      : `${BACKEND_URL}/api/v1/dev/audit?${params.toString()}`;
  } else if (shopId) {
    const params = new URLSearchParams(searchParams);
    params.delete('shop_id');
    params.delete('stats');
    targetUrl = isStats
      ? `${BACKEND_URL}/api/v1/shops/${shopId}/audit/stats?${params.toString()}`
      : `${BACKEND_URL}/api/v1/shops/${shopId}/audit?${params.toString()}`;
  } else {
    return NextResponse.json({ success: false, error: 'shop_id required' }, { status: 400 });
  }

  const token = await getTokenForRequest(req);
  if (!token) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  const upstream = await fetch(targetUrl, {
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  const json = await upstream.json();
  return NextResponse.json(json, { status: upstream.status });
}

// ─── GET /api/audit/stats ─────────────────────────────────────────────────────
// Handled by the same GET route via ?stats=1 query param handled in Fastify
