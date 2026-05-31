/**
 * Origin proxy — forwards requests to Fastify backend.
 * Attaches X-Internal-Token for service-to-service auth.
 * Strips hop-by-hop headers before forwarding.
 */

import type { Env } from './types';

// Standard hop-by-hop headers + 'host' + 'origin':
//
// 'host':   The browser sends Host: pos-cloud-worker.ipbpower.workers.dev.
//           If we forward that to the Fastify origin (which is also behind
//           Cloudflare), CF sees the wrong Host header and returns a 1003/403.
//           Stripping it lets fetch() set the correct Host from ORIGIN_URL.
//
// 'origin': The CF Worker already handles browser CORS; forwarding Origin to
//           Fastify triggers a second @fastify/cors check that may reject
//           origins not in CORS_ORIGIN → 403.  Fastify skips CORS entirely
//           when no Origin header is present.
const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate',
  'proxy-authorization', 'te', 'trailers', 'transfer-encoding', 'upgrade',
  'host', 'origin',
]);

/**
 * Forward a request to the Fastify origin.
 * Returns the raw Response from origin (caller adds CORS).
 */
export async function proxyToOrigin(
  request: Request,
  env: Env,
  overrideUrl?: string,
): Promise<Response> {
  const originUrl = overrideUrl ?? buildOriginUrl(request, env.ORIGIN_URL);

  // Clone headers, strip hop-by-hop, inject internal token
  const headers = new Headers();
  for (const [k, v] of request.headers.entries()) {
    if (!HOP_BY_HOP.has(k.toLowerCase())) headers.set(k, v);
  }
  headers.set('X-Internal-Token', env.INTERNAL_TOKEN);
  headers.set('X-Forwarded-For',  request.headers.get('CF-Connecting-IP') ?? '');
  headers.set('X-Real-IP',        request.headers.get('CF-Connecting-IP') ?? '');

  // CF Access Service Token — required when backend is protected by Cloudflare Access
  if (env.CF_ACCESS_CLIENT_ID && env.CF_ACCESS_CLIENT_SECRET) {
    headers.set('CF-Access-Client-Id',     env.CF_ACCESS_CLIENT_ID);
    headers.set('CF-Access-Client-Secret', env.CF_ACCESS_CLIENT_SECRET);
  }

  const init: RequestInit = {
    method:  request.method,
    headers,
    // Stream body for POST/PATCH/PUT/DELETE
    body: ['GET', 'HEAD', 'OPTIONS'].includes(request.method) ? null : request.body,
    redirect: 'follow',
  };

  try {
    return await fetch(originUrl, init);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'upstream unreachable';
    return new Response(
      JSON.stringify({ success: false, error: { message: `Gateway error: ${msg}` } }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

/** Rewrite request URL to point at the Fastify origin */
export function buildOriginUrl(request: Request, originBase: string): string {
  const url = new URL(request.url);
  return `${originBase.replace(/\/$/, '')}${url.pathname}${url.search}`;
}

/** Build a JSON error response */
export function jsonError(message: string, status: number): Response {
  return new Response(
    JSON.stringify({ success: false, error: { message } }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );
}
