/**
 * CORS helper — enforces strict origin whitelist.
 * No wildcard origins on authenticated routes (security rule #11).
 *
 * FRONTEND_URL may be a comma-separated list of allowed origins, e.g.:
 *   http://192.168.100.99:3000,http://localhost:3000
 * The request Origin is reflected back only when it appears in the list.
 */

/** Parse a comma-separated origin list from an env string */
function parseAllowedOrigins(allowedOrigin: string): string[] {
  return allowedOrigin.split(',').map(o => o.trim()).filter(Boolean);
}

/** Resolve the value to echo as Access-Control-Allow-Origin */
function resolveOrigin(origin: string | null, allowedOrigin: string): string {
  if (!origin) return allowedOrigin.split(',')[0].trim();
  const list = parseAllowedOrigins(allowedOrigin);
  return list.includes(origin) ? origin : list[0];
}

/** Build CORS headers for a given request origin */
export function corsHeaders(origin: string | null, allowedOrigin: string): HeadersInit {
  return {
    'Access-Control-Allow-Origin':      resolveOrigin(origin, allowedOrigin),
    'Access-Control-Allow-Methods':     'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers':     'Authorization, Content-Type, X-CSRF-Token, X-Internal-Token, X-QR-Device-Token',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age':           '86400',
  };
}

/** Handle pre-flight OPTIONS → 204 No Content */
export function handlePreflight(request: Request, allowedOrigin: string): Response | null {
  if (request.method !== 'OPTIONS') return null;
  const origin = request.headers.get('Origin');
  return new Response(null, {
    status: 204,
    headers: corsHeaders(origin, allowedOrigin),
  });
}

/** Attach CORS headers to an existing Response */
export function withCors(response: Response, request: Request, allowedOrigin: string): Response {
  const origin = request.headers.get('Origin');
  const headers = new Headers(response.headers);
  Object.entries(corsHeaders(origin, allowedOrigin)).forEach(([k, v]) => headers.set(k, v));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
