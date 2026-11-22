/**
 * Edge-cached GET routes.
 *
 * Pattern: /api/v1/shops/:shopId/(products|pos-config|branches|units)
 *
 * Flow:
 *  1. Decode JWT → verify shop_id claim matches URL param
 *  2. Check KV cache → return cached response if hit
 *  3. Forward to origin → on 200, store in KV cache
 *  4. Return response
 *
 * Mutating requests (POST/PATCH/DELETE) for the same resources
 * are handled in routes/passthrough.ts which invalidates the KV key.
 */

import type { Env } from '../types';
import { decodeJwt, extractBearerToken, checkShopClaim } from '../auth';
import { cacheGet, cacheSet, cacheInvalidateResource } from '../cache';
import { proxyToOrigin, jsonError } from '../proxy';

type CacheableResource = 'products' | 'pos-config' | 'branches' | 'units';

const RESOURCE_PATTERN = /^\/api\/v1\/shops\/([^/]+)\/(products|pos-config|branches|units)$/;

/** Returns true if this request should be served from the edge cache */
export function isCacheableGet(request: Request): boolean {
  if (request.method !== 'GET') return false;
  const path = new URL(request.url).pathname;
  return RESOURCE_PATTERN.test(path);
}

/**
 * Serve a cacheable GET request:
 *   cache hit  → 200 from KV (X-Cache: HIT)
 *   cache miss → proxy origin, store result, return with X-Cache: MISS
 */
export async function serveCachedGet(request: Request, env: Env): Promise<Response> {
  const path = new URL(request.url).pathname;
  const match = path.match(RESOURCE_PATTERN);
  if (!match) return jsonError('Not found', 404);

  const shopId   = match[1];
  const resource = match[2] as CacheableResource;

  // ── Auth: decode JWT claim (no verify — origin enforces RLS) ──
  const token   = extractBearerToken(request);
  const payload = token ? decodeJwt(token) : null;

  if (token && !payload) {
    // Token present but expired / malformed
    return jsonError('Unauthorized: invalid or expired token', 401);
  }

  const claimResult = checkShopClaim(payload, shopId);
  if (claimResult === 'mismatch') {
    return jsonError('Forbidden: shop access denied', 403);
  }

  // ── KV cache lookup ──
  const cached = await cacheGet<unknown>(env, resource, shopId);
  if (cached !== null) {
    return new Response(JSON.stringify(cached), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Cache':       'HIT',
        'Cache-Control': 'private, max-age=0',
      },
    });
  }

  // ── Cache miss: forward to origin ──
  const originResp = await proxyToOrigin(request, env);

  if (originResp.ok) {
    // Clone body before reading (body can only be consumed once)
    const body = await originResp.json();
    // Store in KV (fire-and-forget — don't await to save latency)
    void cacheSet(env, resource, shopId, body);

    return new Response(JSON.stringify(body), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Cache':       'MISS',
        'Cache-Control': 'private, max-age=0',
      },
    });
  }

  // Origin returned error — pass through as-is
  return originResp;
}

/**
 * Invalidate cache for a specific resource after a mutating request succeeds.
 * Called from passthrough handler for POST/PATCH/DELETE.
 */
export async function invalidateAfterMutation(
  env: Env,
  shopId: string,
  resource: CacheableResource,
): Promise<void> {
  await cacheInvalidateResource(env, resource, shopId);
}

/** Extract shopId + resource from a mutating URL */
export function parseMutationPath(pathname: string): { shopId: string; resource: CacheableResource } | null {
  const match = pathname.match(RESOURCE_PATTERN);
  if (!match) return null;
  return { shopId: match[1], resource: match[2] as CacheableResource };
}
