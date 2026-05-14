import type { FastifyRequest } from 'fastify';
import { ForbiddenError, UnauthorizedError } from './errors.js';

const DEV_EMAILS = (process.env.DEV_ADMIN_EMAILS ?? '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export function isDevAdmin(email: string): boolean {
  return DEV_EMAILS.length > 0 && DEV_EMAILS.includes(email.toLowerCase());
}

/** Ensures the authenticated user is a dev admin.
 *  Throws UnauthorizedError / ForbiddenError — caught by the global error handler. */
export async function requireDevAdmin(req: FastifyRequest): Promise<void> {
  if (!req.auth) throw new UnauthorizedError();
  if (!isDevAdmin(req.auth.email)) {
    throw new ForbiddenError('Dev admin access required');
  }
}
