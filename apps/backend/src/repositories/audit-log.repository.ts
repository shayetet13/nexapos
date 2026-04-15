/**
 * audit-log.repository.ts
 * Data access layer for the audit_logs table.
 * All write operations are fire-and-forget (non-blocking) by design;
 * failures are swallowed so they never break the primary request path.
 */

import { eq, desc, and, gte, lte, like, count, SQL, sql } from 'drizzle-orm';
import { db }         from '../db/index.js';
import { auditLogs }  from '../db/schema.js';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Default page size for audit log queries. */
const DEFAULT_LIMIT = 50;

/** Hard cap on rows returned per request (prevents runaway memory use). */
const MAX_LIMIT = 200;

/** Audit log status values — kept in sync with the DB enum. */
export const AuditLogStatus = {
  SUCCESS: 'success',
  FAIL:    'fail',
  ERROR:   'error',
} as const;
export type AuditLogStatusValue = typeof AuditLogStatus[keyof typeof AuditLogStatus];

// ─── Types ────────────────────────────────────────────────────────────────────

/** Shape of a row to insert into audit_logs. */
export interface AuditLogInsert {
  event:           string;
  status:          AuditLogStatusValue;
  request_id:      string;
  session_id?:     string;
  shop_id?:        string | null;
  user_id?:        string | null;
  role?:           string | null;
  ip_address?:     string | null;
  user_agent?:     string | null;
  method?:         string | null;
  endpoint?:       string | null;
  execution_time?: number | null;
  error_message?:  string;
  metadata?:       Record<string, unknown>;
}

/** Query parameters for paginated audit log retrieval. */
export interface AuditLogQuery {
  shop_id?:        string;
  user_id?:        string;
  event?:          string;
  status?:         string;
  from?:           Date;
  to?:             Date;
  /** Partial text match against the `endpoint` column. */
  search?:         string;
  /** Filter logs where `metadata->>'ref_code'` matches (case-insensitive). */
  ref_code?:       string;
  limit?:          number;
  offset?:         number;
  /** When true, suppress read-only `api_call + GET` rows (noise reduction). */
  hide_get_calls?: boolean;
}

/** Aggregated stats returned by {@link auditLogRepository.stats}. */
export interface AuditLogStats {
  total:    number;
  errors:   number;
  fails:    number;
  byEvent:  Record<string, number>;
  byStatus: Record<string, number>;
}

// ─── Private helpers ──────────────────────────────────────────────────────────

/** SQL fragment that filters out read-only GET api_call rows. */
const EXCLUDE_GET_NOISE = sql`NOT (
  ${auditLogs.event} = 'api_call'
  AND upper(coalesce(${auditLogs.method}, '')) = 'GET'
)`;

/** Build a WHERE clause array from a query object. */
function buildConditions(q: AuditLogQuery): SQL[] {
  const conditions: SQL[] = [];

  if (q.shop_id) conditions.push(eq(auditLogs.shop_id, q.shop_id));
  if (q.user_id) conditions.push(eq(auditLogs.user_id, q.user_id));
  if (q.event)   conditions.push(eq(auditLogs.event,   q.event));
  if (q.status)  conditions.push(eq(auditLogs.status,  q.status as AuditLogStatusValue));
  if (q.from)    conditions.push(gte(auditLogs.created_at, q.from));
  if (q.to)      conditions.push(lte(auditLogs.created_at, q.to));

  if (q.search) {
    conditions.push(like(auditLogs.endpoint, `%${q.search}%`));
  }

  if (q.ref_code) {
    conditions.push(
      sql`${auditLogs.metadata}->>'ref_code' ILIKE ${`%${q.ref_code.trim().toUpperCase()}%`}`,
    );
  }

  if (q.hide_get_calls) {
    conditions.push(EXCLUDE_GET_NOISE);
  }

  return conditions;
}

// ─── Repository ───────────────────────────────────────────────────────────────

export const auditLogRepository = {

  /**
   * Insert one audit log row.
   * Called by `lib/audit.ts` as fire-and-forget (errors are not propagated).
   */
  insert(data: AuditLogInsert) {
    return db
      .insert(auditLogs)
      .values({
        event:          data.event,
        status:         data.status,
        request_id:     data.request_id,
        session_id:     data.session_id,
        shop_id:        data.shop_id        ?? null,
        user_id:        data.user_id        ?? null,
        role:           data.role           ?? null,
        ip_address:     data.ip_address     ?? null,
        user_agent:     data.user_agent     ?? null,
        method:         data.method         ?? null,
        endpoint:       data.endpoint       ?? null,
        execution_time: data.execution_time ?? null,
        error_message:  data.error_message  ?? null,
        metadata:       data.metadata       ?? {},
      })
      .returning()
      .then((rows) => rows[0] ?? null);
  },

  /**
   * Paginated query with optional filters.
   * Uses a single parallel `count(*)` query — never loads all rows to count.
   * Limit is capped at {@link MAX_LIMIT}.
   */
  async query(q: AuditLogQuery): Promise<{
    data:   typeof auditLogs.$inferSelect[];
    total:  number;
    limit:  number;
    offset: number;
  }> {
    const limit  = Math.min(q.limit  ?? DEFAULT_LIMIT, MAX_LIMIT);
    const offset = q.offset ?? 0;

    const conditions = buildConditions(q);
    const where      = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, [countRow]] = await Promise.all([
      db
        .select()
        .from(auditLogs)
        .where(where)
        .orderBy(desc(auditLogs.created_at))
        .limit(limit)
        .offset(offset),
      db
        .select({ total: count() })
        .from(auditLogs)
        .where(where),
    ]);

    return { data: rows, total: countRow?.total ?? 0, limit, offset };
  },

  /**
   * Aggregated stats for a shop via a single `GROUP BY` query.
   * Read-only GET `api_call` rows are excluded to surface only meaningful events.
   */
  async stats(shopId: string, since?: Date): Promise<AuditLogStats> {
    const baseCond = since
      ? and(eq(auditLogs.shop_id, shopId), gte(auditLogs.created_at, since))
      : eq(auditLogs.shop_id, shopId);

    const grouped = await db
      .select({
        event:  auditLogs.event,
        status: auditLogs.status,
        n:      sql<number>`count(*)::int`,
      })
      .from(auditLogs)
      .where(and(baseCond, EXCLUDE_GET_NOISE))
      .groupBy(auditLogs.event, auditLogs.status);

    const byEvent:  Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    let total  = 0;
    let errors = 0;
    let fails  = 0;

    for (const row of grouped) {
      const n = row.n;
      byEvent[row.event]   = (byEvent[row.event]   ?? 0) + n;
      byStatus[row.status] = (byStatus[row.status] ?? 0) + n;
      total += n;
      if (row.status === AuditLogStatus.ERROR) errors += n;
      if (row.status === AuditLogStatus.FAIL)  fails  += n;
    }

    return { total, errors, fails, byEvent, byStatus };
  },

  /**
   * Fetch recent logs for a single user (session or profile view).
   * @param limit Max rows to return (default 20).
   */
  getByUserId(userId: string, limit = 20) {
    return db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.user_id, userId))
      .orderBy(desc(auditLogs.created_at))
      .limit(limit);
  },

  /**
   * Fetch recent logs for a shop (lightweight admin summary).
   * For full paginated admin view, use {@link auditLogRepository.query} instead.
   * @param limit Max rows to return (default 100).
   */
  getByShopId(shopId: string, limit = 100) {
    return db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.shop_id, shopId))
      .orderBy(desc(auditLogs.created_at))
      .limit(limit);
  },
};
