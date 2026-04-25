/**
 * JWT decode-only (no signature verification).
 *
 * Supabase uses ES256 (ECDSA) — the Worker cannot verify the signature
 * without the private key. Actual verification is enforced by:
 *   1. Supabase PostgREST RLS on every query
 *   2. Fastify origin validates every proxied request via supabaseAdmin.auth.getUser()
 *
 * The Worker only reads claims to make *routing / caching* decisions.
 */

import type { JwtPayload } from './types';

/**
 * Decode the payload section of a JWT (base64url → JSON).
 * Returns null if the token is malformed or expired.
 */
export function decodeJwt(token: string): JwtPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    // base64url → base64 → decode
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(b64);
    const payload = JSON.parse(json) as JwtPayload;

    // Reject expired tokens early (saves origin round-trip)
    if (payload.exp !== undefined && payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

/**
 * Extract Bearer token from Authorization header.
 * Returns null if header is missing or malformed.
 */
export function extractBearerToken(request: Request): string | null {
  const auth = request.headers.get('Authorization');
  if (!auth || !auth.startsWith('Bearer ')) return null;
  return auth.slice(7).trim() || null;
}

/**
 * Verify that the shop_id in the JWT matches the shopId in the URL path.
 * Owners / super-admins that manage multiple shops may have a different
 * claim — in that case the origin Fastify handles full validation.
 *
 * Returns:
 *   - 'ok'      — claims match (or no shop_id claim, defer to origin)
 *   - 'mismatch' — clear mismatch; worker should 403 immediately
 */
export function checkShopClaim(
  payload: JwtPayload | null,
  urlShopId: string,
): 'ok' | 'mismatch' {
  if (!payload) return 'ok'; // let origin reject
  if (!payload.shop_id) return 'ok'; // multi-shop owner — origin checks
  if (payload.shop_id === urlShopId) return 'ok';
  return 'mismatch';
}
