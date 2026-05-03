import type { FastifyRequest, FastifyReply } from 'fastify';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { UnauthorizedError } from '../lib/errors.js';

let supabase: SupabaseClient | null = null;
let cachedKey = '';
let cachedUrl = '';

function getSupabase(): SupabaseClient {
  const url =
    process.env.SUPABASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
    '';
  const key =
    process.env.SUPABASE_ANON_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    '';
  if (!url || !key) {
    throw new UnauthorizedError('Auth service not configured');
  }
  if (!supabase || cachedKey !== key || cachedUrl !== url) {
    supabase = createClient(url, key);
    cachedKey = key;
    cachedUrl = url;
  }
  return supabase;
}

export interface AuthPayload {
  userId: string;
  email: string;
  role?: string;
}

/** Verifies the Bearer token and returns the auth payload.
 *  Throws UnauthorizedError on any failure — caught by the global error handler. */
export async function verifyJwt(request: FastifyRequest): Promise<AuthPayload> {
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) throw new UnauthorizedError('Missing authorization header');

  const { data: { user }, error } = await getSupabase().auth.getUser(token);
  if (error || !user) throw new UnauthorizedError('Invalid or expired token');

  return {
    userId: user.id,
    email:  user.email ?? '',
    role:   user.user_metadata?.role,
  };
}

/** Fastify preHandler — attaches auth payload to request or throws. */
export function authMiddleware() {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    request.auth = await verifyJwt(request);
  };
}
