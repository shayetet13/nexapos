import { db } from '../db/index.js';
import { staffQrTokens, staffCheckins, users, userShopRoles } from '../db/schema.js';
import { eq, and, desc, isNull, sql } from 'drizzle-orm';
import { supabaseAdmin } from '../lib/supabase-admin.js';

export const staffQrRepository = {
  // ── QR Tokens ────────────────────────────────────────────────────

  async listByShop(shopId: string) {
    const rows = await db
      .select()
      .from(staffQrTokens)
      .where(eq(staffQrTokens.shop_id, shopId));

    // Enrich with email from Supabase auth
    const enriched = await Promise.all(
      rows.map(async (r) => {
        const { data: { user } } = await supabaseAdmin.auth.admin.getUserById(r.user_id);
        return {
          ...r,
          email: user?.email ?? 'unknown',
          user_metadata: user?.user_metadata ?? {},
        };
      })
    );
    return enriched;
  },

  /** Create or replace QR token for user+shop */
  async upsert(userId: string, shopId: string, branchId?: string | null) {
    // Delete existing
    await db.delete(staffQrTokens)
      .where(and(eq(staffQrTokens.user_id, userId), eq(staffQrTokens.shop_id, shopId)));

    const [row] = await db
      .insert(staffQrTokens)
      .values({
        user_id:   userId,
        shop_id:   shopId,
        branch_id: branchId ?? null,
      })
      .returning();
    return row;
  },

  async deleteByUser(userId: string, shopId: string) {
    const [row] = await db
      .delete(staffQrTokens)
      .where(and(eq(staffQrTokens.user_id, userId), eq(staffQrTokens.shop_id, shopId)))
      .returning();
    return row;
  },

  async findByToken(token: string) {
    const [row] = await db
      .select()
      .from(staffQrTokens)
      .where(eq(staffQrTokens.token, token));
    return row ?? null;
  },

  // ── Check-ins ────────────────────────────────────────────────────

  async createCheckin(userId: string, shopId: string, branchId?: string | null) {
    const [row] = await db
      .insert(staffCheckins)
      .values({
        user_id:   userId,
        shop_id:   shopId,
        branch_id: branchId ?? null,
      })
      .returning();
    return row;
  },

  async listCheckins(shopId: string, limit = 50) {
    return db
      .select()
      .from(staffCheckins)
      .where(eq(staffCheckins.shop_id, shopId))
      .orderBy(desc(staffCheckins.checked_in_at))
      .limit(limit);
  },

  async getTodayShifts(shopId: string, branchId?: string | null) {
    return db
      .select({
        userId:        staffCheckins.user_id,
        email:         users.email,
        role:          userShopRoles.role,
        checkedInAt:   staffCheckins.checked_in_at,
        checkedOutAt:  staffCheckins.checked_out_at,
      })
      .from(staffCheckins)
      .innerJoin(users,         eq(users.id, staffCheckins.user_id))
      .leftJoin(userShopRoles,  and(
        eq(userShopRoles.user_id, staffCheckins.user_id),
        eq(userShopRoles.shop_id, shopId),
      ))
      .where(
        and(
          eq(staffCheckins.shop_id, shopId),
          sql`(${staffCheckins.checked_in_at} AT TIME ZONE 'Asia/Bangkok')::date = CURRENT_DATE AT TIME ZONE 'Asia/Bangkok'`,
          branchId ? eq(staffCheckins.branch_id, branchId) : undefined,
        ),
      )
      .orderBy(staffCheckins.checked_in_at);
  },

  async checkoutUser(userId: string, shopId: string) {
    return db
      .update(staffCheckins)
      .set({ checked_out_at: new Date() })
      .where(
        and(
          eq(staffCheckins.user_id, userId),
          eq(staffCheckins.shop_id, shopId),
          isNull(staffCheckins.checked_out_at),
          sql`(${staffCheckins.checked_in_at} AT TIME ZONE 'Asia/Bangkok')::date = CURRENT_DATE AT TIME ZONE 'Asia/Bangkok'`,
        ),
      )
      .returning()
      .then((rows) => rows[0] ?? null);
  },
};
