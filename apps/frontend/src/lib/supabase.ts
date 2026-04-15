import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl     = process.env.NEXT_PUBLIC_SUPABASE_URL      ?? '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

/** Singleton browser client — shared across all components so token-refresh
 *  state stays consistent between concurrent useEffects. */
let _client: SupabaseClient | null = null;

/** หน้า QR จัดการ session เอง ไม่ต้อง redirect ไป /login */
const QR_PATHS = ['/qr-auth', '/qr-login'];
const isQrPage = () =>
  typeof window !== 'undefined' &&
  QR_PATHS.some(p => window.location.pathname.startsWith(p));

export function createSupabaseClient(): SupabaseClient {
  if (typeof window === 'undefined') {
    return createBrowserClient(supabaseUrl, supabaseAnonKey);
  }
  if (!_client) {
    _client = createBrowserClient(supabaseUrl, supabaseAnonKey);

    _client.auth.onAuthStateChange((event) => {
      if (event === 'TOKEN_REFRESHED') return; // ปกติ ไม่ต้องทำอะไร
      if (event === 'SIGNED_OUT') {
        // sign out จาก tab อื่น หรือ token ถูก revoke
        if (window.location.pathname !== '/login' && !isQrPage()) {
          window.location.href = '/login';
        }
      }
    });

    // ดัก unhandled promise rejection จาก Supabase internal refresh
    window.addEventListener('unhandledrejection', (e) => {
      const msg: string = e?.reason?.message ?? '';
      if (
        msg.includes('Refresh Token Not Found') ||
        msg.includes('Invalid Refresh Token') ||
        msg.includes('refresh_token_not_found')
      ) {
        e.preventDefault(); // ป้องกัน error ขึ้น console
        if (_client) {
          _client.auth.signOut({ scope: 'local' }).finally(() => {
            if (window.location.pathname !== '/login' && !isQrPage()) {
              window.location.href = '/login';
            }
          });
        }
      }
    });
  }
  return _client;
}

/** ล้าง session ออกจาก storage ทั้งหมด แล้ว redirect ไป /login
 *  หน้า /qr-auth และ /qr-login จัดการ session เอง ไม่ต้อง redirect */
async function clearSessionAndRedirect(): Promise<null> {
  try {
    const supabase = createSupabaseClient();
    await supabase.auth.signOut({ scope: 'local' }); // ล้าง local storage
  } catch {
    // ignore — ถ้า signOut ก็ fail ด้วย ให้ redirect ต่อไป
  }
  if (typeof window !== 'undefined' && !isQrPage()) {
    window.location.href = '/login';
  }
  return null;
}

/** Force-refresh and return a fresh access token.
 *  Returns null (+ redirects to /login) if refresh token is dead. */
async function forceRefreshToken(): Promise<string | null> {
  const supabase = createSupabaseClient();
  const { data, error } = await supabase.auth.refreshSession();
  if (error) {
    // "Refresh Token Not Found" หรือ token expired/revoked → ล้าง session ออก
    return clearSessionAndRedirect();
  }
  if (!data.session?.access_token) return clearSessionAndRedirect();
  return data.session.access_token;
}

/**
 * Returns a valid access token, auto-refreshing if expired.
 * Uses a 60-second buffer so tokens aren't used right before expiry.
 * Returns null only when the user has no session at all.
 */
export async function getAuthToken(): Promise<string | null> {
  const supabase = createSupabaseClient();

  let session;
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) return clearSessionAndRedirect();
    session = data.session;
  } catch {
    return clearSessionAndRedirect();
  }

  // No session → not logged in
  if (!session?.access_token) return null;

  // Session has expiry info → check with 60 s safety buffer
  if (session.expires_at) {
    const expiresMs = session.expires_at * 1000;
    if (Date.now() < expiresMs - 60_000) {
      return session.access_token; // still fresh
    }
  }

  // Token expired (or no expiry info) → force refresh
  return forceRefreshToken();
}

/**
 * drop-in fetch() replacement that automatically:
 *   1. Attaches a fresh Bearer token
 *   2. On 401 → force-refreshes the token and retries ONCE
 *   3. On second 401 → redirects to /login (session is truly dead)
 *
 * Usage:  const res = await fetchWithAuth(url, { method: 'POST', body: … })
 */
export async function fetchWithAuth(
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  let token = await getAuthToken();

  if (!token) {
    // clearSessionAndRedirect() ทำ redirect ให้แล้ว — คืน 401 synthetic
    return new Response(JSON.stringify({ success: false }), { status: 401 });
  }

  const makeRequest = (t: string) =>
    fetch(url, {
      ...options,
      headers: {
        ...(options.headers ?? {}),
        Authorization: `Bearer ${t}`,
      },
    });

  // AbortError = caller cancelled intentionally — re-throw so callers can detect via signal.aborted.
  // Other network errors (backend down, CORS, DNS) → synthetic 503 so callers use `if (!res.ok)` uniformly.
  const NETWORK_503 = new Response(JSON.stringify({ success: false, error: 'Network error' }), { status: 503 });
  async function safeRequest(t: string): Promise<Response> {
    try {
      return await makeRequest(t);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      if (process.env.NODE_ENV !== 'production') console.warn('[fetchWithAuth] Network error:', url, err);
      return NETWORK_503;
    }
  }

  let res = await safeRequest(token);

  // First 401: token slipped through expiry check → force refresh + retry
  if (res.status === 401) {
    const fresh = await forceRefreshToken();
    if (!fresh) {
      if (typeof window !== 'undefined') window.location.href = '/login';
      return res;
    }
    res = await safeRequest(fresh);
  }

  // Second 401: refresh token itself is dead → back to login
  if (res.status === 401 && typeof window !== 'undefined') {
    window.location.href = '/login';
  }

  return res;
}
