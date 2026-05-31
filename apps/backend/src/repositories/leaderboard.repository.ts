import { eq, and, gte, lt, sql, asc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { orders, shops, shopSalesSnapshots } from '../db/schema.js';
import { bkkNow, BKK_OFFSET_MS } from '../lib/bkk-time.js';

export type PeriodType = 'day' | 'week' | 'month' | 'year';

export interface PeriodRange {
  from:      Date;       // UTC boundary start
  to:        Date;       // UTC boundary end (exclusive)
  key:       string;     // period_key string for snapshots
  label:     string;     // Thai display label
  shortLabel: string;    // short label for chart axis
}

/**
 * Compute UTC from/to for a given period + offset.
 * offset 0 = current period, 1 = previous, 2 = two back, etc.
 */
export function getPeriodRange(period: PeriodType, offset = 0): PeriodRange {
  const now = bkkNow(); // Bangkok local time as Date

  if (period === 'day') {
    // Start of day (BKK) converted back to UTC
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
    const from = new Date(d.getTime() - BKK_OFFSET_MS);
    const to   = new Date(from.getTime() + 86_400_000);
    const key  = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const label = d.toLocaleDateString('th-TH', { dateStyle: 'full' });
    const shortLabel = d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
    return { from, to, key, label, shortLabel };
  }

  if (period === 'week') {
    const dayOfWeek = now.getDay(); // 0=Sun
    const daysFromMon = (dayOfWeek + 6) % 7;
    const monBkk = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysFromMon - offset * 7);
    const from   = new Date(monBkk.getTime() - BKK_OFFSET_MS);
    const to     = new Date(from.getTime() + 7 * 86_400_000);
    // ISO week number
    const jan1   = new Date(monBkk.getFullYear(), 0, 1);
    const weekNo = Math.ceil(((monBkk.getTime() - jan1.getTime()) / 86_400_000 + jan1.getDay() + 1) / 7);
    const key    = `${monBkk.getFullYear()}-W${pad(weekNo)}`;
    const sunBkk = new Date(monBkk);
    sunBkk.setDate(sunBkk.getDate() + 6);
    const label = `สัปดาห์ ${monBkk.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })} — ${sunBkk.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })}`;
    const shortLabel = key;
    return { from, to, key, label, shortLabel };
  }

  if (period === 'month') {
    const y = now.getFullYear();
    const m = now.getMonth() - offset;
    const startBkk = new Date(y, m, 1);
    const endBkk   = new Date(y, m + 1, 1);
    const from = new Date(startBkk.getTime() - BKK_OFFSET_MS);
    const to   = new Date(endBkk.getTime()   - BKK_OFFSET_MS);
    const key  = `${startBkk.getFullYear()}-${pad(startBkk.getMonth() + 1)}`;
    const label = startBkk.toLocaleDateString('th-TH', { year: 'numeric', month: 'long' });
    const shortLabel = startBkk.toLocaleDateString('th-TH', { month: 'short', year: '2-digit' });
    return { from, to, key, label, shortLabel };
  }

  // year
  const y    = now.getFullYear() - offset;
  const from = new Date(new Date(y, 0, 1).getTime() - BKK_OFFSET_MS);
  const to   = new Date(new Date(y + 1, 0, 1).getTime() - BKK_OFFSET_MS);
  const key  = String(y);
  const label = `ปี พ.ศ. ${y + 543}`;
  return { from, to, key, label, shortLabel: label };
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

// ── Chart data helpers ───────────────────────────────────────────────

/**
 * Build the trend chart data for the overview at the given period.
 * day → 24 hourly points | week → 7 daily | month → daily | year → 12 monthly
 */
export async function getPeriodTrend(period: PeriodType, offset = 0): Promise<{ label: string; total: number; count: number }[]> {
  const { from, to } = getPeriodRange(period, offset);

  if (period === 'day') {
    // Hourly breakdown (group by hour in BKK)
    const rows = await db.select({
      hour:  sql<number>`EXTRACT(HOUR FROM ${orders.created_at} AT TIME ZONE 'Asia/Bangkok')::int`,
      total: sql<string>`COALESCE(SUM(${orders.total}::numeric), 0)`,
      count: sql<string>`COUNT(*)`,
    }).from(orders)
      .where(and(eq(orders.status, 'paid'), gte(orders.created_at, from), lt(orders.created_at, to)))
      .groupBy(sql`EXTRACT(HOUR FROM ${orders.created_at} AT TIME ZONE 'Asia/Bangkok')`)
      .orderBy(sql`EXTRACT(HOUR FROM ${orders.created_at} AT TIME ZONE 'Asia/Bangkok')`);

    const map = new Map(rows.map((r) => [r.hour, r]));
    return Array.from({ length: 24 }, (_, h) => {
      const r = map.get(h);
      return { label: `${pad(h)}:00`, total: Number(r?.total ?? 0), count: Number(r?.count ?? 0) };
    });
  }

  if (period === 'week') {
    const rows = await db.select({
      day:   sql<string>`(${orders.created_at} AT TIME ZONE 'Asia/Bangkok')::date`,
      total: sql<string>`COALESCE(SUM(${orders.total}::numeric), 0)`,
      count: sql<string>`COUNT(*)`,
    }).from(orders)
      .where(and(eq(orders.status, 'paid'), gte(orders.created_at, from), lt(orders.created_at, to)))
      .groupBy(sql`(${orders.created_at} AT TIME ZONE 'Asia/Bangkok')::date`)
      .orderBy(sql`(${orders.created_at} AT TIME ZONE 'Asia/Bangkok')::date`);

    const map = new Map(rows.map((r) => [String(r.day).slice(0, 10), r]));
    return Array.from({ length: 7 }, (_, i) => {
      const d   = new Date(from.getTime() + i * 86_400_000 + BKK_OFFSET_MS);
      const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      const r   = map.get(key);
      return { label: d.toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric' }), total: Number(r?.total ?? 0), count: Number(r?.count ?? 0) };
    });
  }

  if (period === 'month') {
    const rows = await db.select({
      day:   sql<string>`(${orders.created_at} AT TIME ZONE 'Asia/Bangkok')::date`,
      total: sql<string>`COALESCE(SUM(${orders.total}::numeric), 0)`,
      count: sql<string>`COUNT(*)`,
    }).from(orders)
      .where(and(eq(orders.status, 'paid'), gte(orders.created_at, from), lt(orders.created_at, to)))
      .groupBy(sql`(${orders.created_at} AT TIME ZONE 'Asia/Bangkok')::date`)
      .orderBy(sql`(${orders.created_at} AT TIME ZONE 'Asia/Bangkok')::date`);

    const map  = new Map(rows.map((r) => [String(r.day).slice(0, 10), r]));
    const days = Math.round((to.getTime() - from.getTime()) / 86_400_000);
    return Array.from({ length: days }, (_, i) => {
      const d   = new Date(from.getTime() + i * 86_400_000 + BKK_OFFSET_MS);
      const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      const r   = map.get(key);
      return { label: String(d.getDate()), total: Number(r?.total ?? 0), count: Number(r?.count ?? 0) };
    });
  }

  // year → monthly
  const rows = await db.select({
    month: sql<number>`EXTRACT(MONTH FROM ${orders.created_at} AT TIME ZONE 'Asia/Bangkok')::int`,
    total: sql<string>`COALESCE(SUM(${orders.total}::numeric), 0)`,
    count: sql<string>`COUNT(*)`,
  }).from(orders)
    .where(and(eq(orders.status, 'paid'), gte(orders.created_at, from), lt(orders.created_at, to)))
    .groupBy(sql`EXTRACT(MONTH FROM ${orders.created_at} AT TIME ZONE 'Asia/Bangkok')`)
    .orderBy(sql`EXTRACT(MONTH FROM ${orders.created_at} AT TIME ZONE 'Asia/Bangkok')`);

  const MONTHS_TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const map = new Map(rows.map((r) => [r.month, r]));
  return Array.from({ length: 12 }, (_, i) => {
    const r = map.get(i + 1);
    return { label: MONTHS_TH[i] ?? String(i + 1), total: Number(r?.total ?? 0), count: Number(r?.count ?? 0) };
  });
}

// ── Live leaderboard ─────────────────────────────────────────────────

export interface LeaderboardEntry {
  rank:        number;
  shop_id:     string;
  shop_name:   string;
  shop_code:   string | null;
  revenue:     number;
  order_count: number;
  snapshot_at?: string | null;
}

export async function getLiveLeaderboard(period: PeriodType, offset = 0): Promise<LeaderboardEntry[]> {
  const { from, to } = getPeriodRange(period, offset);
  const rows = await db.select({
    shop_id:     orders.shop_id,
    shop_name:   shops.name,
    shop_code:   shops.shop_code,
    revenue:     sql<string>`COALESCE(SUM(${orders.total}::numeric), 0)`,
    order_count: sql<string>`COUNT(*)`,
  }).from(orders)
    .innerJoin(shops, eq(shops.id, orders.shop_id))
    .where(and(eq(orders.status, 'paid'), gte(orders.created_at, from), lt(orders.created_at, to)))
    .groupBy(orders.shop_id, shops.name, shops.shop_code)
    .orderBy(sql`SUM(${orders.total}::numeric) DESC`);

  return rows.map((r, i) => ({
    rank:        i + 1,
    shop_id:     r.shop_id,
    shop_name:   r.shop_name,
    shop_code:   r.shop_code,
    revenue:     Number(r.revenue),
    order_count: Number(r.order_count),
  }));
}

// ── Snapshot operations ──────────────────────────────────────────────

/** Take a snapshot of the current period standings and upsert into shop_sales_snapshots */
export async function takeSnapshot(period: PeriodType, offset = 0): Promise<{ period: string; key: string; count: number }> {
  const { from, to, key } = getPeriodRange(period, offset);

  const rows = await db.select({
    shop_id:     orders.shop_id,
    revenue:     sql<string>`COALESCE(SUM(${orders.total}::numeric), 0)`,
    order_count: sql<string>`COUNT(*)`,
  }).from(orders)
    .where(and(eq(orders.status, 'paid'), gte(orders.created_at, from), lt(orders.created_at, to)))
    .groupBy(orders.shop_id)
    .orderBy(sql`SUM(${orders.total}::numeric) DESC`);

  for (const [idx, row] of rows.entries()) {
    await db.insert(shopSalesSnapshots).values({
      shop_id:     row.shop_id,
      period_type: period,
      period_key:  key,
      revenue:     row.revenue,
      order_count: Number(row.order_count),
      rank:        idx + 1,
    }).onConflictDoUpdate({
      target:      [shopSalesSnapshots.shop_id, shopSalesSnapshots.period_type, shopSalesSnapshots.period_key],
      set: {
        revenue:     row.revenue,
        order_count: Number(row.order_count),
        rank:        idx + 1,
        snapshot_at: new Date(),
      },
    });
  }

  return { period, key, count: rows.length };
}

/** Load historical snapshot by period type + key */
export async function getSnapshot(period: PeriodType, periodKey: string): Promise<LeaderboardEntry[]> {
  const rows = await db.select({
    rank:        shopSalesSnapshots.rank,
    shop_id:     shopSalesSnapshots.shop_id,
    shop_name:   shops.name,
    shop_code:   shops.shop_code,
    revenue:     shopSalesSnapshots.revenue,
    order_count: shopSalesSnapshots.order_count,
    snapshot_at: shopSalesSnapshots.snapshot_at,
  }).from(shopSalesSnapshots)
    .innerJoin(shops, eq(shops.id, shopSalesSnapshots.shop_id))
    .where(and(
      eq(shopSalesSnapshots.period_type, period),
      eq(shopSalesSnapshots.period_key, periodKey),
    ))
    .orderBy(asc(shopSalesSnapshots.rank));

  return rows.map((r) => ({
    rank:        r.rank ?? 0,
    shop_id:     r.shop_id,
    shop_name:   r.shop_name,
    shop_code:   r.shop_code,
    revenue:     Number(r.revenue),
    order_count: r.order_count,
    snapshot_at: r.snapshot_at?.toISOString() ?? null,
  }));
}

/** List available snapshot period keys (most recent first) */
export async function getAvailablePeriodKeys(period: PeriodType): Promise<string[]> {
  const rows = await db.selectDistinct({ key: shopSalesSnapshots.period_key })
    .from(shopSalesSnapshots)
    .where(eq(shopSalesSnapshots.period_type, period))
    .orderBy(sql`${shopSalesSnapshots.period_key} DESC`);
  return rows.map((r) => r.key);
}
