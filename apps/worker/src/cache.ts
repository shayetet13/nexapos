/**
 * Edge cache layer using Cloudflare KV.
 *
 * Cache keys are scoped per shop to enforce isolation:
 *   pos:products:{shopId}
 *   pos:pos-config:{shopId}
 *   pos:branches:{shopId}
 *   pos:units:{shopId}
 *
 * TTLs (seconds):
 *   products   60   — menu items change infrequently
 *   pos-config 300  — logo / VAT setting rarely changes
 *   branches   120  — branches change rarely
 *   units      300  — unit list changes rarely
 */

import type { Env } from './types';

type CacheKey = 'products' | 'pos-config' | 'branches' | 'units';

const TTL_MAP: Record<CacheKey, number> = {
  products:   60,
  'pos-config': 300,
  branches:   120,
  units:      300,
};

function kvKey(resource: CacheKey, shopId: string): string {
  return `pos:${resource}:${shopId}`;
}

/** Read from KV cache. Returns parsed JSON or null on miss. */
export async function cacheGet<T>(
  env: Env,
  resource: CacheKey,
  shopId: string,
): Promise<T | null> {
  const raw = await env.CACHE.get(kvKey(resource, shopId));
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

/** Write to KV cache with resource-specific TTL. */
export async function cacheSet(
  env: Env,
  resource: CacheKey,
  shopId: string,
  value: unknown,
): Promise<void> {
  await env.CACHE.put(
    kvKey(resource, shopId),
    JSON.stringify(value),
    { expirationTtl: TTL_MAP[resource] },
  );
}

/**
 * Invalidate all cache entries for a shop.
 * Called on any mutating request (POST/PATCH/DELETE) for that shop.
 */
export async function cacheInvalidateShop(
  env: Env,
  shopId: string,
): Promise<void> {
  const keys: CacheKey[] = ['products', 'pos-config', 'branches', 'units'];
  await Promise.all(keys.map((k) => env.CACHE.delete(kvKey(k, shopId))));
}

/** Invalidate only a specific resource for a shop. */
export async function cacheInvalidateResource(
  env: Env,
  resource: CacheKey,
  shopId: string,
): Promise<void> {
  await env.CACHE.delete(kvKey(resource, shopId));
}
