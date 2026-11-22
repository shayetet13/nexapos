/**
 * Pass-through proxy for all non-cached routes.
 *
 * Responsibilities:
 *  - Forward request to Fastify origin unchanged
 *  - On successful mutation (POST/PATCH/DELETE) to a cacheable resource,
 *    invalidate the corresponding KV cache entry
 *  - Attach X-Internal-Token for origin auth
 */

import type { Env } from '../types';
import { proxyToOrigin } from '../proxy';
import { parseMutationPath, invalidateAfterMutation } from './cached';

const MUTATION_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

export async function passthrough(request: Request, env: Env): Promise<Response> {
  const resp = await proxyToOrigin(request, env);

  // Invalidate KV cache after a successful mutation
  if (MUTATION_METHODS.has(request.method) && resp.ok) {
    const pathname = new URL(request.url).pathname;
    const parsed   = parseMutationPath(pathname);
    if (parsed) {
      // fire-and-forget — don't hold up the response
      void invalidateAfterMutation(env, parsed.shopId, parsed.resource);
    }
  }

  return resp;
}
