/**
 * Internal-token middleware for Cloudflare Worker → Fastify calls.
 *
 * When the Worker forwards a request it injects:
 *   X-Internal-Token: <INTERNAL_TOKEN secret>
 *
 * The Fastify backend validates this header on every incoming request.
 * If the token is missing or wrong, the request is rejected with 401.
 *
 * ⚠ This does NOT replace JWT auth — it is an extra layer to ensure
 * that the Fastify origin is only reachable through the Worker (or
 * direct authenticated callers).  The normal JWT authMiddleware still
 * runs on all protected routes.
 *
 * Security rule #3: "Internal service calls use X-Internal-Token header"
 */

import type { FastifyRequest, FastifyReply } from 'fastify';

const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN ?? '';

/** เบราว์เซอร์ dev ชี้ Fastify โดยตรง (ไม่มี CF Worker ใส่ X-Internal-Token)
 *  รองรับทั้ง localhost และ LAN IP (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
 *  เพื่อให้ mobile/device บน LAN เข้าได้ในโหมด dev */
function skipInternalTokenForLocalDirectBrowser(request: FastifyRequest): boolean {
  if (process.env.INTERNAL_TOKEN_REQUIRE === 'true') return false;
  // tsx dev มักไม่ตั้ง NODE_ENV → ถือว่าไม่ใช่ production
  if (process.env.NODE_ENV === 'production') return false;

  const host = ((request.headers.host ?? '').split(':')[0] ?? '').toLowerCase();

  // localhost / loopback
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') return true;

  // LAN private ranges: 192.168.x.x / 10.x.x.x / 172.16-31.x.x
  if (/^192\.168\.\d+\.\d+$/.test(host)) return true;
  if (/^10\.\d+\.\d+\.\d+$/.test(host))  return true;
  if (/^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(host)) return true;

  return false;
}

/**
 * Returns true if the INTERNAL_TOKEN env var is configured AND the
 * incoming request carries the matching header.
 *
 * If INTERNAL_TOKEN is not set (local dev without Worker), the check
 * is skipped so development still works without the Worker running.
 */
export function validateInternalToken(request: FastifyRequest): boolean {
  if (!INTERNAL_TOKEN) return true; // not configured → allow (dev mode)

  if (skipInternalTokenForLocalDirectBrowser(request)) return true;

  // WebSocket connections come directly from the browser (no CF Worker in path).
  // /ws (authenticated), /ws-display (read-only), /api/v1/ws-qr (QR login) are exempt.
  const path = request.url?.split('?')[0];
  if (path === '/ws' || path === '/ws-display' || path === '/api/v1/ws-qr') return true;

  // Display broadcast endpoint is called directly from the browser (POS page).
  // It is protected by JWT auth (app.auth) so the internal token is not needed.
  if (path?.endsWith('/display')) return true;

  // Public receipt — browser calls directly (no CF Worker), no auth required.
  // Mobile/LAN devices fetch receipts by token UUID only.
  if (path?.match(/\/api\/v1\/public\/receipts\/[0-9a-f-]{36}$/i)) return true;

  // Staff withdrawal QR scan — browser calls backend directly (no CF Worker).
  // /withdrawals/items  → read-only list (public)
  // /withdrawals        → POST create request (public, no auth)
  // /public/withdrawals/:id/status → polling status (public)
  if (path?.match(/\/api\/v1\/shops\/[^/]+\/withdrawals(\/items)?$/) && ['GET','POST'].includes(request.method)) return true;
  if (path?.match(/\/api\/v1\/public\/withdrawals\/[^/]+\/status$/)) return true;

  const incoming = request.headers['x-internal-token'];
  if (!incoming) return false;
  if (Array.isArray(incoming)) return incoming[0] === INTERNAL_TOKEN;
  return incoming === INTERNAL_TOKEN;
}

/**
 * Fastify preHandler — rejects requests from unknown origins.
 * Register at the server level (not per-route) to protect all endpoints.
 */
export function internalTokenMiddleware() {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!validateInternalToken(request)) {
      return reply.status(401).send({
        success: false,
        error: { code: 'AUTH_001', message: 'Unauthorized: missing or invalid internal token' },
      });
    }
  };
}
