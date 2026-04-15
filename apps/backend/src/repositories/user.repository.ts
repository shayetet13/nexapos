import { eq, and, isNotNull, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users, userShopRoles } from '../db/schema.js';

export const userRepository = {
  /** Insert or update a user record (ใช้สำหรับ regular email user) */
  upsertUser(id: string, email: string) {
    return db
      .insert(users)
      .values({ id, email, is_staff: false })
      .onConflictDoUpdate({
        target: users.id,
        set: { email, updated_at: new Date() },
      })
      .returning()
      .then((rows) => rows[0] ?? null);
  },

  /** Insert or update a staff account (is_staff = true) */
  upsertStaffUser(id: string, syntheticEmail: string) {
    return db
      .insert(users)
      .values({ id, email: syntheticEmail, is_staff: true })
      .onConflictDoUpdate({
        target: users.id,
        set: { email: syntheticEmail, updated_at: new Date() },
      })
      .returning()
      .then((rows) => rows[0] ?? null);
  },

  /** Assign user to shop with optional nickname (for staff PIN accounts) */
  assignToShop(
    userId:   string,
    shopId:   string,
    role:     'owner' | 'manager' | 'cashier' | 'viewer',
    branchId?: string,
    nickname?: string,
  ) {
    return db
      .insert(userShopRoles)
      .values({
        user_id:   userId,
        shop_id:   shopId,
        role,
        branch_id: branchId ?? null,
        nickname:  nickname ?? null,
      })
      .onConflictDoUpdate({
        target: [userShopRoles.user_id, userShopRoles.shop_id],
        set: {
          role,
          branch_id: branchId ?? null,
          nickname:  nickname ?? null,
          updated_at: new Date(),
        },
      })
      .returning()
      .then((rows) => rows[0] ?? null);
  },

  /** Get all users in a shop (includes nickname for staff accounts) */
  getUsersByShop(shopId: string) {
    return db
      .select({
        user_id:    userShopRoles.user_id,
        email:      users.email,
        is_staff:   users.is_staff,
        nickname:   userShopRoles.nickname,
        role:       userShopRoles.role,
        branch_id:  userShopRoles.branch_id,
        created_at: userShopRoles.created_at,
      })
      .from(userShopRoles)
      .innerJoin(users, eq(users.id, userShopRoles.user_id))
      .where(eq(userShopRoles.shop_id, shopId));
  },

  /** Get only staff (PIN) accounts for a shop */
  getStaffByShop(shopId: string) {
    return db
      .select({
        user_id:    userShopRoles.user_id,
        nickname:   userShopRoles.nickname,
        role:       userShopRoles.role,
        branch_id:  userShopRoles.branch_id,
        created_at: userShopRoles.created_at,
      })
      .from(userShopRoles)
      .innerJoin(users, eq(users.id, userShopRoles.user_id))
      .where(
        and(
          eq(userShopRoles.shop_id, shopId),
          eq(users.is_staff, true),
          isNotNull(userShopRoles.nickname),
        ),
      );
  },

  /**
   * Global nickname lookup — v2 staff login (ไม่ต้องระบุ shopId)
   * Nickname เป็น unique ทั้งระบบ ดังนั้น return ได้แค่ 1 row เสมอ
   */
  findStaffByNicknameGlobal(nickname: string) {
    const lower = nickname.toLowerCase().trim();
    return db
      .select({
        user_id:   users.id,
        email:     users.email,
        role:      userShopRoles.role,
        shop_id:   userShopRoles.shop_id,
        branch_id: userShopRoles.branch_id,
      })
      .from(userShopRoles)
      .innerJoin(users, eq(users.id, userShopRoles.user_id))
      .where(
        and(
          sql`LOWER(${userShopRoles.nickname}) = ${lower}`,
          eq(users.is_staff, true),
        ),
      )
      .then((rows) => rows[0] ?? null);
  },

  /**
   * ตรวจสอบว่า nickname ถูกใช้ไปแล้วในระบบหรือไม่ (global)
   * ใช้ case-insensitive เพื่อป้องกันซ้ำกันต่างตัวพิมพ์
   */
  async isNicknameTaken(nickname: string, excludeUserId?: string): Promise<boolean> {
    const lower = nickname.toLowerCase().trim();
    const rows = await db
      .select({ user_id: userShopRoles.user_id })
      .from(userShopRoles)
      .where(sql`LOWER(${userShopRoles.nickname}) = ${lower}`)
      .limit(1);
    if (rows.length === 0) return false;
    // ถ้าระบุ excludeUserId (กรณีแก้ชื่อตัวเอง) ให้ถือว่าไม่ซ้ำ
    if (excludeUserId && rows[0]!.user_id === excludeUserId) return false;
    return true;
  },

  /** Update nickname for a staff account */
  updateStaffNickname(userId: string, shopId: string, nickname: string) {
    return db
      .update(userShopRoles)
      .set({ nickname: nickname.trim(), updated_at: new Date() })
      .where(and(eq(userShopRoles.user_id, userId), eq(userShopRoles.shop_id, shopId)))
      .returning()
      .then((rows) => rows[0] ?? null);
  },

  findByEmail(email: string) {
    return db
      .select()
      .from(users)
      .where(eq(users.email, email.toLowerCase().trim()))
      .then((rows) => rows[0] ?? null);
  },

  removeFromShop(userId: string, shopId: string) {
    return db
      .delete(userShopRoles)
      .where(and(eq(userShopRoles.user_id, userId), eq(userShopRoles.shop_id, shopId)))
      .returning()
      .then((rows) => rows[0] ?? null);
  },

  deleteUser(userId: string) {
    return db.delete(users).where(eq(users.id, userId)).returning().then((rows) => rows[0] ?? null);
  },
};
