/**
 * NexaPos — Cloudflare Workers Edge Gateway
 *
 * Responsibilities:
 *  1. CORS — strict origin whitelist (FRONTEND_URL)
 *  2. Rate limiting — 100 req/min per IP (via CF Rate Limit binding)
 *  3. JWT decode — extract shop_id claim for routing / early 403
 *  4. Edge cache — KV-backed cache for hot GET endpoints
 *  5. Pass-through proxy — all other traffic forwarded to Fastify origin
 *  6. Cache invalidation — purge KV on successful mutations
 *
 * Security rules enforced here: #3 (CORS), #5 (rate limit), #11 (strict CORS)
 * Full auth (JWT verify + RLS) is enforced by Fastify origin.
 */

import type { Env } from './types';
import { handlePreflight, withCors } from './cors';
import { isCacheableGet, serveCachedGet } from './routes/cached';
import { passthrough } from './routes/passthrough';
import { jsonError } from './proxy';

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url    = new URL(request.url);
    const origin = request.headers.get('Origin') ?? '';

    /* ── 1. CORS pre-flight ─────────────────────────────────────── */
    const preflight = handlePreflight(request, env.FRONTEND_URL);
    if (preflight) return preflight;

    /* ── 2. Rate limiting ───────────────────────────────────────── */
    const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    try {
      const { success } = await env.RATE_LIMITER.limit({ key: ip });
      if (!success) {
        const resp = jsonError('Too many requests — slow down', 429);
        return withCors(resp, request, env.FRONTEND_URL);
      }
    } catch {
      // Rate limiter binding unavailable (e.g. local dev without flag) — continue
    }

    /* ── 3. Health check (no auth required) ────────────────────── */
    if (url.pathname === '/health') {
      const resp = new Response(
        JSON.stringify({ status: 'ok', worker: 'nexapos', ts: Date.now() }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
      return withCors(resp, request, env.FRONTEND_URL);
    }

    /* ── 4. Reject non-API paths ─────────────────────────────────── */
    if (!url.pathname.startsWith('/api/')) {
      const resp = jsonError('Not found', 404);
      return withCors(resp, request, env.FRONTEND_URL);
    }

    /* ── 5. Edge-cached GET routes ──────────────────────────────── */
    let resp: Response;
    if (isCacheableGet(request)) {
      resp = await serveCachedGet(request, env);
    } else {
      /* ── 6. Pass-through all other routes ───────────────────── */
      resp = await passthrough(request, env);
    }

    /* ── 7. Attach CORS to every response ───────────────────────── */
    return withCors(resp, request, env.FRONTEND_URL);
  },
} satisfies ExportedHandler<Env>;
