import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { shops, branches, userShopRoles } from '../db/schema.js';

/** สร้างรหัสร้าน 10 หลัก: [ปณ 5][running 3][ปีพศ 2 หลักท้าย]
 *  1 query แทน loop 999 ครั้ง: หา max sequence จากรหัสที่มีอยู่แล้ว increment
 */
async function generateShopCode(postalCode: string): Promise<string> {
  const beYear = new Date().getFullYear() + 543;
  const yr = String(beYear).slice(-2); // '69' จาก 2569

  // ดึงรหัสทุกตัวที่ขึ้นต้นด้วย postalCode และลงท้ายด้วย yr ในฐานข้อมูล — 1 query
  const rows = await db
    .select({ shop_code: shops.shop_code })
    .from(shops)
    .where(sql`${shops.shop_code} LIKE ${postalCode + '%' + yr} AND LENGTH(${shops.shop_code}) = 10`);

  // หา max sequence จาก middle 3 digits
  let maxSeq = 0;
  for (const row of rows) {
    if (!row.shop_code) continue;
    const mid = parseInt(row.shop_code.slice(5, 8), 10);
    if (!isNaN(mid) && mid > maxSeq) maxSeq = mid;
  }

  const nextSeq = maxSeq + 1;
  if (nextSeq > 999) {
    // overflow (>999 ร้านในรหัสไปรษณีย์เดียวกันปีเดียวกัน)
    return postalCode + String(Date.now()).slice(-3) + yr;
  }
  return postalCode + String(nextSeq).padStart(3, '0') + yr;
}

export const shopRepository = {
  getAllShops() {
    return db.select().from(shops).orderBy(desc(shops.created_at));
  },

  async createShop(
    name: string,
    opts?: {
      postalCode?: string;
      province?: string;
      district?: string;
      shopMode?: 'retail' | 'full_service_restaurant';
    },
  ) {
    const shop_code   = opts?.postalCode ? await generateShopCode(opts.postalCode) : null;
    const province    = opts?.province   ?? null;
    const district    = opts?.district   ?? null;
    const postal_code = opts?.postalCode ?? null;
    const shop_mode   = opts?.shopMode   ?? 'retail';
    return db.insert(shops).values({ name, shop_code, province, district, postal_code, shop_mode })
      .returning().then((rows) => rows[0] ?? null);
  },

  createBranch(shopId: string, name: string, address?: string) {
    return db.insert(branches).values({ shop_id: shopId, name, address: address ?? null }).returning().then((rows) => rows[0] ?? null);
  },

  getShopsForUser(userId: string) {
    return db
      .select({
        id:           shops.id,
        name:         shops.name,
        logo_url:     shops.logo_url,
        created_at:   shops.created_at,
        role:         userShopRoles.role,
        branch_id:    userShopRoles.branch_id,
        shop_code:    shops.shop_code,
        province:     shops.province,
        district:     shops.district,
        postal_code:  shops.postal_code,
        shop_mode:    shops.shop_mode,
        is_active:    shops.is_active,
        is_banned:    shops.is_banned,
        ban_reason:   shops.ban_reason,
      })
      .from(shops)
      .innerJoin(userShopRoles, eq(userShopRoles.shop_id, shops.id))
      .where(eq(userShopRoles.user_id, userId));
  },

  /** Generate a new code for an existing shop that has no code yet */
  async generateAndSaveShopCode(
    shopId: string,
    postalCode: string,
    province: string | null,
    district: string | null,
  ) {
    const code = await generateShopCode(postalCode);
    return db
      .update(shops)
      .set({
        shop_code:   code,
        province:    province,
        district:    district,
        postal_code: postalCode,
        updated_at:  new Date(),
      })
      .where(eq(shops.id, shopId))
      .returning()
      .then((rows) => rows[0] ?? null);
  },

  getShopById(shopId: string) {
    return db
      .select()
      .from(shops)
      .where(eq(shops.id, shopId))
      .then((rows) => rows[0] ?? null);
  },

  updateShop(shopId: string, data: {
    name?: string;
    logo_url?: string | null;
    vat_enabled?: boolean;
    owner_firstname?: string | null;
    owner_lastname?: string | null;
    promptpay_type?: 'phone' | 'id_card' | null;
    promptpay_number_encrypted?: string | null;
    print_receipt_enabled?: boolean;
    printer_width?: number | null;
    membership_config?: Record<string, unknown> | null;
    phone?: string | null;
    tax_id?: string | null;
    address?: string | null;
    opening_hours?: string | null;
    working_days?: string | null;
    google_review_url?: string | null;
  }) {
    const updates: Record<string, unknown> = { updated_at: new Date() };
    if (data.name                       !== undefined) updates.name                       = data.name;
    if (data.logo_url                   !== undefined) updates.logo_url                   = data.logo_url;
    if (data.vat_enabled                !== undefined) updates.vat_enabled                = data.vat_enabled;
    if (data.owner_firstname            !== undefined) updates.owner_firstname            = data.owner_firstname;
    if (data.owner_lastname             !== undefined) updates.owner_lastname             = data.owner_lastname;
    if (data.promptpay_type             !== undefined) updates.promptpay_type             = data.promptpay_type;
    if (data.promptpay_number_encrypted !== undefined) updates.promptpay_number_encrypted = data.promptpay_number_encrypted;
    if (data.print_receipt_enabled      !== undefined) updates.print_receipt_enabled      = data.print_receipt_enabled;
    if (data.printer_width              !== undefined) updates.printer_width              = data.printer_width;
    if (data.membership_config          !== undefined) updates.membership_config          = data.membership_config;
    if (data.phone                      !== undefined) updates.phone                      = data.phone;
    if (data.tax_id                     !== undefined) updates.tax_id                     = data.tax_id;
    if (data.address                    !== undefined) updates.address                    = data.address;
    if (data.opening_hours              !== undefined) updates.opening_hours              = data.opening_hours;
    if (data.working_days               !== undefined) updates.working_days               = data.working_days;
    if (data.google_review_url          !== undefined) updates.google_review_url          = data.google_review_url;
    return db
      .update(shops)
      .set(updates)
      .where(eq(shops.id, shopId))
      .returning()
      .then((rows) => rows[0] ?? null);
  },

  getShopByChatId(chatId: string) {
    return db
      .select({ id: shops.id, name: shops.name })
      .from(shops)
      .where(eq(shops.telegram_chat_id, chatId))
      .then((rows) => rows[0] ?? null);
  },

  getShopsByUserId(userId: string) {
    return db
      .select({ id: shops.id, name: shops.name })
      .from(shops)
      .innerJoin(userShopRoles, eq(userShopRoles.shop_id, shops.id))
      .where(
        and(
          eq(userShopRoles.user_id, userId),
          inArray(userShopRoles.role, ['owner', 'manager']),
        ),
      );
  },

  setTelegramChatId(shopId: string, chatId: string | null) {
    return db
      .update(shops)
      .set({ telegram_chat_id: chatId, updated_at: new Date() })
      .where(eq(shops.id, shopId))
      .returning()
      .then((rows) => rows[0] ?? null);
  },

  getUserRoleForShop(userId: string, shopId: string) {
    return db
      .select({ role: userShopRoles.role })
      .from(userShopRoles)
      .where(and(eq(userShopRoles.user_id, userId), eq(userShopRoles.shop_id, shopId)))
      .then((rows) => rows[0]?.role ?? null);
  },

  getBranchesByShopId(shopId: string) {
    return db
      .select()
      .from(branches)
      .where(eq(branches.shop_id, shopId));
  },

  getBranchById(branchId: string, shopId: string) {
    return db
      .select()
      .from(branches)
      .where(and(eq(branches.id, branchId), eq(branches.shop_id, shopId)))
      .then((rows) => rows[0] ?? null);
  },

  updateBranch(branchId: string, shopId: string, data: { name?: string; address?: string | null }) {
    return db
      .update(branches)
      .set({ ...data, updated_at: new Date() })
      .where(and(eq(branches.id, branchId), eq(branches.shop_id, shopId)))
      .returning()
      .then((rows) => rows[0] ?? null);
  },

  deleteBranch(branchId: string) {
    return db.delete(branches).where(eq(branches.id, branchId)).returning().then((rows) => rows[0] ?? null);
  },

  setBranchActive(branchId: string, isActive: boolean) {
    return db
      .update(branches)
      .set({ is_active: isActive, updated_at: new Date() })
      .where(eq(branches.id, branchId))
      .returning()
      .then((rows) => rows[0] ?? null);
  },

  // ── Shop status management (dev admin only) ────────────────────────────────

  /** ระงับ / เปิดใช้งานร้านชั่วคราว (is_active) */
  setShopActive(shopId: string, isActive: boolean) {
    return db
      .update(shops)
      .set({ is_active: isActive, updated_at: new Date() })
      .where(eq(shops.id, shopId))
      .returning()
      .then((rows) => rows[0] ?? null);
  },

  /** แบนร้านถาวร หรือ ยกเลิกการแบน (is_banned) */
  setShopBanned(shopId: string, isBanned: boolean, reason: string | null = null) {
    return db
      .update(shops)
      .set({
        is_banned:  isBanned,
        ban_reason: isBanned ? reason : null,
        updated_at: new Date(),
      })
      .where(eq(shops.id, shopId))
      .returning()
      .then((rows) => rows[0] ?? null);
  },

  /** ลบร้านถาวร (CASCADE ลบข้อมูลทั้งหมดที่เกี่ยวข้อง) */
  deleteShop(shopId: string) {
    return db
      .delete(shops)
      .where(eq(shops.id, shopId))
      .returning()
      .then((rows) => rows[0] ?? null);
  },
};
