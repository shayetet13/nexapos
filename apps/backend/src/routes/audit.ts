/**
 * routes/audit.ts
 * REST endpoints for querying and ingesting audit log data.
 *
 * Routes:
 *  GET  /shops/:shopId/audit          — paginated shop audit log (admin+)
 *  GET  /shops/:shopId/audit/stats    — aggregated stats for a shop
 *  GET  /dev/audit                    — global audit log (dev admin only)
 *  GET  /dev/audit/stats              — global stats across all shops
 *  POST /audit/ingest                 — receive client-side events from the Next.js proxy
 */

import { z }                        from 'zod';
import type { FastifyPluginAsync }  from 'fastify';
import { auditLogRepository, AuditLogStatus } from '../repositories/audit-log.repository.js';
import { audit }                    from '../lib/audit.js';
import { requireAdminShop }         from '../lib/admin-guard.js';
import { requireDevAdmin }          from '../lib/dev-guard.js';
import { ValidationError }          from '../lib/errors.js';
import { meta }                     from '../lib/response.js';

// ─── Validation constants ─────────────────────────────────────────────────────

const QUERY_MAX_SEARCH_LEN = 120;
const QUERY_MAX_REFCODE_LEN = 20;
const QUERY_MIN_LIMIT       = 1;
const QUERY_MAX_LIMIT       = 200;
const QUERY_DEFAULT_LIMIT   = 50;

// ─── Shared query schema ──────────────────────────────────────────────────────

/**
 * Zod schema for all paginated audit log query endpoints.
 * Shared by both the shop-scoped and dev-admin routes.
 */
const querySchema = z.object({
  event:    z.string().optional(),
  status:   z.enum(['success', 'fail', 'error']).optional(),
  user_id:  z.string().uuid().optional(),
  from:     z.string().datetime({ offset: true }).optional(),
  to:       z.string().datetime({ offset: true }).optional(),
  /** Partial text match against the endpoint column. */
  search:   z.string().max(QUERY_MAX_SEARCH_LEN).optional(),
  /** Filter by order reference number stored in metadata (case-insensitive). */
  ref_code: z.string().max(QUERY_MAX_REFCODE_LEN).optional(),
  limit:    z.coerce.number().int().min(QUERY_MIN_LIMIT).max(QUERY_MAX_LIMIT)
              .optional().default(QUERY_DEFAULT_LIMIT),
  offset:   z.coerce.number().int().min(0).optional().default(0),
});

type QueryInput = z.input<typeof querySchema>;
type QueryParsed = z.output<typeof querySchema>;

/** Parse and throw a {@link ValidationError} on failure. */
function parseQuery(raw: QueryInput): QueryParsed {
  const result = querySchema.safeParse(raw);
  if (!result.success) {
    throw new ValidationError(result.error.flatten().fieldErrors as Record<string, string[]>);
  }
  return result.data;
}

/** Ingest event body shape forwarded from the Next.js /api/audit proxy. */
interface IngestBody {
  type?:        string;
  event?:       string;
  shop_id?:     string | null;
  user_id?:     string | null;
  role?:        string | null;
  entity_type?: string;
  entity_id?:   string;
  changes?:     Record<string, unknown>;
  error?:       string;
  path?:        string;
  endpoint?:    string | null;
  user_agent?:  string | null;
  ip_address?:  string | null;
  request_id?:  string;
  metadata?:    Record<string, unknown>;
}

// ─── Route plugin ─────────────────────────────────────────────────────────────

export const auditRoutes: FastifyPluginAsync = async (app) => {

  // ── GET /shops/:shopId/audit ────────────────────────────────────────────────

  app.get<{
    Params:      { shopId: string };
    Querystring: QueryInput;
  }>('/shops/:shopId/audit', {
    preHandler: [app.auth],
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    await requireAdminShop(req);

    const q = parseQuery(req.query);

    const result = await auditLogRepository.query({
      shop_id:        req.params.shopId,
      event:          q.event,
      status:         q.status,
      user_id:        q.user_id,
      from:           q.from     ? new Date(q.from) : undefined,
      to:             q.to       ? new Date(q.to)   : undefined,
      search:         q.search,
      ref_code:       q.ref_code,
      limit:          q.limit,
      offset:         q.offset,
      // When searching by ref_code, include all event types so related logs surface;
      // otherwise suppress noisy read-only GET api_call rows.
      hide_get_calls: !q.ref_code,
    });

    return reply.send({
      success:    true,
      data:       result.data,
      pagination: { total: result.total, limit: result.limit, offset: result.offset },
      meta:       meta(req),
    });
  });

  // ── GET /shops/:shopId/audit/stats ──────────────────────────────────────────

  app.get<{
    Params:      { shopId: string };
    Querystring: { since?: string };
  }>('/shops/:shopId/audit/stats', {
    preHandler: [app.auth],
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    await requireAdminShop(req);

    const since = req.query.since ? new Date(req.query.since) : undefined;
    const stats = await auditLogRepository.stats(req.params.shopId, since);

    return reply.send({ success: true, data: stats, meta: meta(req) });
  });

  // ── GET /dev/audit ──────────────────────────────────────────────────────────

  app.get<{
    Querystring: QueryInput & { shop_id?: string };
  }>('/dev/audit', {
    preHandler: [app.auth],
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    requireDevAdmin(req);

    const q = parseQuery(req.query);

    const result = await auditLogRepository.query({
      shop_id:  (req.query as { shop_id?: string }).shop_id,
      event:    q.event,
      status:   q.status,
      user_id:  q.user_id,
      from:     q.from    ? new Date(q.from) : undefined,
      to:       q.to      ? new Date(q.to)   : undefined,
      search:   q.search,
      ref_code: q.ref_code,
      limit:    q.limit,
      offset:   q.offset,
    });

    return reply.send({
      success:    true,
      data:       result.data,
      pagination: { total: result.total, limit: result.limit, offset: result.offset },
      meta:       meta(req),
    });
  });

  // ── GET /dev/audit/stats ────────────────────────────────────────────────────

  app.get<{
    Querystring: { shop_id?: string; since?: string };
  }>('/dev/audit/stats', {
    preHandler: [app.auth],
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    requireDevAdmin(req);

    const { shop_id, since } = req.query;
    const sinceDate = since ? new Date(since) : undefined;

    if (!shop_id) {
      // Global summary — aggregate the latest N rows across all shops
      const result = await auditLogRepository.query({
        from:   sinceDate,
        limit:  QUERY_MAX_LIMIT,
        offset: 0,
      });

      const byEvent:  Record<string, number> = {};
      const byStatus: Record<string, number> = {};
      let errors = 0;
      let fails  = 0;

      for (const r of result.data) {
        byEvent[r.event]   = (byEvent[r.event]   ?? 0) + 1;
        byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
        if (r.status === AuditLogStatus.ERROR) errors++;
        if (r.status === AuditLogStatus.FAIL)  fails++;
      }

      return reply.send({
        success: true,
        data:    { total: result.total, errors, fails, byEvent, byStatus },
        meta:    meta(req),
      });
    }

    const stats = await auditLogRepository.stats(shop_id, sinceDate);
    return reply.send({ success: true, data: stats, meta: meta(req) });
  });

  // ── POST /audit/ingest ──────────────────────────────────────────────────────
  // Receives client-side events forwarded by the Next.js /api/audit proxy.
  // Requires a valid JWT; the frontend route already holds a session token.

  app.post<{ Body: IngestBody }>('/audit/ingest', {
    preHandler: [app.auth],
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const b = req.body;

    const base = {
      request_id: b.request_id ?? req.id,
      shop_id:    b.shop_id    ?? null,
      user_id:    b.user_id    ?? null,
      role:       b.role       ?? null,
      ip_address: b.ip_address ?? req.ip,
      user_agent: b.user_agent ?? req.headers['user-agent'] ?? null,
      endpoint:   b.endpoint   ?? null,
    };

    switch (b.type) {
      case 'action':
        audit.action({ ...base, event: b.event ?? 'client_action', entity_type: b.entity_type, entity_id: b.entity_id, changes: b.changes, metadata: b.metadata });
        break;
      case 'error':
        audit.error({ ...base, event: b.event ?? 'client_error', error: b.error ?? 'Unknown', metadata: b.metadata });
        break;
      case 'page_view':
        audit.pageView({ ...base, path: b.path ?? '/', metadata: b.metadata });
        break;
      default:
        audit.action({ ...base, event: b.event ?? 'client_event', metadata: b.metadata });
    }

    return reply.send({ ok: true });
  });
};
