import type { FastifyRequest, FastifyReply } from 'fastify';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { UnauthorizedError } from '../lib/errors.js';

const supabaseUrl     = process.env.SUPABASE_URL      ?? '';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY ?? '';

let supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new UnauthorizedError('Auth service not configured');
  }
  if (!supabase) {
    supabase = createClient(supabaseUrl, supabaseAnonKey);
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
