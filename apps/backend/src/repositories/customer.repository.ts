import { eq, and, ilike, or, sql, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { customers, orders } from '../db/schema.js';

type MembershipConfigLike = {
  redemption_type?: 'points_per_10_baht' | 'baht_per_point';
  redemption_rate?: number;
  redemption_baht_per_point?: number;
  points_per_10_baht?: number;
  tier_silver?: number;
  tier_gold?: number;
} | null | undefined;

/** Points earned: (total/10) * points_per_10_baht (default 1 point per ฿10) */
export function calcPointsEarned(total: number, pointsPer10Baht: number = 1): number {
  return Math.floor(total / 10) * pointsPer10Baht;
}

/** Discount from points — legacy (100 points = ฿10) */
export function pointsToDiscount(points: number): number {
  return Math.floor(points / 100) * 10;
}

/** Discount from points using membership_config */
export function pointsToDiscountFromConfig(points: number, config: MembershipConfigLike): number {
  if (!config) return pointsToDiscount(points);
  if (config.redemption_type === 'baht_per_point' && typeof config.redemption_baht_per_point === 'number') {
    return Math.floor(points * config.redemption_baht_per_point * 100) / 100;
  }
  const rate = config.redemption_rate ?? 100; // points per ฿10
  return Math.floor(points / rate) * 10;
}

export const customerRepository = {
  /* ── Find by phone (exact, per shop) ─────────────────────── */
  async findByPhone(shopId: string, phone: string) {
    const [row] = await db
      .select()
      .from(customers)
      .where(and(eq(customers.shop_id, shopId), eq(customers.phone, phone)));
    return row ?? null;
  },

  /* ── Search by name or phone (partial) ───────────────────── */
  async search(shopId: string, query: string, limit = 20) {
    const q = `%${query}%`;
    return db
      .select()
      .from(customers)
      .where(
        and(
          eq(customers.shop_id, shopId),
          or(ilike(customers.name, q), ilike(customers.phone, q)),
        ),
      )
      .orderBy(desc(customers.updated_at))
      .limit(limit);
  },

  /* ── List all (latest first) ─────────────────────────────── */
  async list(shopId: string, limit = 50, offset = 0) {
    return db
      .select()
      .from(customers)
      .where(eq(customers.shop_id, shopId))
      .orderBy(desc(customers.updated_at))
      .limit(limit)
      .offset(offset);
  },

  /* ── Get by ID ───────────────────────────────────────────── */
  async getById(shopId: string, customerId: string) {
    const [row] = await db
      .select()
      .from(customers)
      .where(and(eq(customers.shop_id, shopId), eq(customers.id, customerId)));
    return row ?? null;
  },

  /* ── Create ──────────────────────────────────────────────── */
  async create(shopId: string, data: { name: string; phone?: string; email?: string; birthday?: string; notes?: string }) {
    const [row] = await db
      .insert(customers)
      .values({
        shop_id:  shopId,
        name:     data.name,
        phone:    data.phone ?? null,
        email:    data.email ?? null,
        birthday: data.birthday ?? null,
        notes:    data.notes ?? null,
      })
      .returning();
    return row ?? null;
  },

  /* ── Update info ─────────────────────────────────────────── */
  async update(shopId: string, customerId: string, data: { name?: string; phone?: string; email?: string; birthday?: string; notes?: string }) {
    const [row] = await db
      .update(customers)
      .set({ ...data, updated_at: new Date() })
      .where(and(eq(customers.shop_id, shopId), eq(customers.id, customerId)))
      .returning();
    return row ?? null;
  },

  /* ── Add points + total_spent after a purchase ───────────── */
  async applyPurchase(
    shopId: string,
    customerId: string,
    orderTotal: number,
    pointsEarned: number,
    tierSilver: number = 1000,
    tierGold: number = 5000,
  ) {
    const [row] = await db
      .update(customers)
      .set({
        points:      sql`${customers.points} + ${pointsEarned}`,
        total_spent: sql`${customers.total_spent} + ${orderTotal.toFixed(2)}`,
        tier:        sql`CASE
                           WHEN (${customers.total_spent} + ${orderTotal.toFixed(2)})::numeric >= ${tierGold} THEN 'gold'
                           WHEN (${customers.total_spent} + ${orderTotal.toFixed(2)})::numeric >= ${tierSilver} THEN 'silver'
                           ELSE 'bronze'
                         END`,
        updated_at:  new Date(),
      })
      .where(and(eq(customers.shop_id, shopId), eq(customers.id, customerId)))
      .returning();
    return row ?? null;
  },

  /* ── Deduct redeemed points ──────────────────────────────── */
  async deductPoints(shopId: string, customerId: string, points: number) {
    const [row] = await db
      .update(customers)
      .set({
        points:     sql`GREATEST(0, ${customers.points} - ${points})`,
        updated_at: new Date(),
      })
      .where(and(eq(customers.shop_id, shopId), eq(customers.id, customerId)))
      .returning();
    return row ?? null;
  },

  /* ── Order history for a customer ───────────────────────── */
  async listOrders(shopId: string, customerId: string, limit = 20) {
    return db
      .select({
        id:              orders.id,
        daily_seq:       orders.daily_seq,
        total:           orders.total,
        discount:        orders.discount,
        points_earned:   orders.points_earned,
        points_redeemed: orders.points_redeemed,
        payment_method:  orders.payment_method,
        status:          orders.status,
        created_at:      orders.created_at,
      })
      .from(orders)
      .where(and(eq(orders.shop_id, shopId), eq(orders.customer_id, customerId)))
      .orderBy(desc(orders.created_at))
      .limit(limit);
  },

  /* ── Delete ──────────────────────────────────────────────── */
  async delete(shopId: string, customerId: string) {
    await db
      .delete(customers)
      .where(and(eq(customers.shop_id, shopId), eq(customers.id, customerId)));
  },
};
