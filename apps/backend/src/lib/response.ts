/** Shared response utilities used by all route handlers */

/** Standard request metadata attached to every API response */
export function meta(req: { id: string }) {
  return { requestId: req.id, timestamp: new Date().toISOString() };
}
