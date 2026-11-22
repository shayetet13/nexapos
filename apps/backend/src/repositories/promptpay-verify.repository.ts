import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { shopPromptpayVerify, promptpayPayments, shops } from '../db/schema.js';

export type VerifyConfigRow = typeof shopPromptpayVerify.$inferSelect;
export type PaymentRow      = typeof promptpayPayments.$inferSelect;

export interface BindingRow {
  shop_id:            string;
  shop_name:          string;
  bot_id:             string | null;
  bot_name:           string | null;
  source_target_id:   string | null;
  source_target_name: string | null;
  enabled:            boolean;
}

type ConfigPatch = Partial<Omit<typeof shopPromptpayVerify.$inferInsert, 'shop_id' | 'created_at'>>;

export interface PaymentRange { from: Date; to: Date }

/** เฉพาะรายการที่สำเร็จ */
export interface BankBreakdownRow { bank: string; count: number; amount_satang: number }

export interface PeriodTotals { count: number; succeeded_count: number; amount_satang: number }

const succeededOnly = sql`${promptpayPayments.status} = 'succeeded'`;

export const promptpayVerifyRepository = {
  async getConfig(shopId: string): Promise<VerifyConfigRow | null> {
    const [row] = await db.select().from(shopPromptpayVerify)
      .where(eq(shopPromptpayVerify.shop_id, shopId));
    return row ?? null;
  },

  /** upsert เฉพาะ field ที่ส่งมา — unique violation (23505) โยนให้ caller แปลง */
  async upsertConfig(shopId: string, patch: ConfigPatch): Promise<VerifyConfigRow> {
    const values = { ...patch, updated_at: new Date() };
    const [row] = await db.insert(shopPromptpayVerify)
      .values({ shop_id: shopId, ...values })
      .onConflictDoUpdate({ target: shopPromptpayVerify.shop_id, set: values })
      .returning();
    return row!;
  },

  /** owner ล้างค่าที่ตัวเองตั้ง (พร้อมเพย์ + ปิดใช้งาน) — การผูก bot ที่ dev ตั้งไว้ไม่ถูกแตะ */
  async clearOwnerFields(shopId: string): Promise<void> {
    await db.update(shopPromptpayVerify)
      .set({
        enabled: false, promptpay_id_type: null, promptpay_id_encrypted: null,
        destination_last4: null, updated_at: new Date(),
      })
      .where(eq(shopPromptpayVerify.shop_id, shopId));
  },

  /** ทุกร้านที่ถูกผูก bot (ใช้ฝั่ง dev เท่านั้น — ข้ามร้าน) */
  async listBindings(): Promise<BindingRow[]> {
    return db.select({
      shop_id:            shopPromptpayVerify.shop_id,
      shop_name:          shops.name,
      bot_id:             shopPromptpayVerify.bot_id,
      bot_name:           shopPromptpayVerify.bot_name,
      source_target_id:   shopPromptpayVerify.source_target_id,
      source_target_name: shopPromptpayVerify.source_target_name,
      enabled:            shopPromptpayVerify.enabled,
    }).from(shopPromptpayVerify)
      .innerJoin(shops, eq(shops.id, shopPromptpayVerify.shop_id))
      .where(isNotNull(shopPromptpayVerify.bot_id))
      .orderBy(shops.name);
  },

  async insertPayment(data: typeof promptpayPayments.$inferInsert): Promise<PaymentRow> {
    const [row] = await db.insert(promptpayPayments).values(data).returning();
    return row!;
  },

  async getPayment(shopId: string, id: string): Promise<PaymentRow | null> {
    const [row] = await db.select().from(promptpayPayments)
      .where(and(eq(promptpayPayments.shop_id, shopId), eq(promptpayPayments.id, id)));
    return row ?? null;
  },

  /**
   * อัปเดตแบบ compare-and-set: ส่ง expectedStatus เพื่อเขียนก็ต่อเมื่อสถานะยังเป็นค่านั้น
   * (poll กับ cancel ที่ซ้อนกันจะไม่เขียนทับกัน/ไม่ audit ซ้ำ) — คืน null ถ้าไม่มีแถวที่ตรงเงื่อนไข
   */
  async updatePayment(
    shopId: string,
    id: string,
    patch: Partial<Pick<PaymentRow, 'status' | 'bank' | 'payer_name' | 'transaction_at' | 'qr_payload'>>,
    expectedStatus?: PaymentRow['status'],
  ): Promise<PaymentRow | null> {
    const [row] = await db.update(promptpayPayments)
      .set({ ...patch, updated_at: new Date() })
      .where(and(
        eq(promptpayPayments.shop_id, shopId),
        eq(promptpayPayments.id, id),
        expectedStatus ? eq(promptpayPayments.status, expectedStatus) : undefined,
      ))
      .returning();
    return row ?? null;
  },

  /**
   * claim payment เพื่อปิดออเดอร์ แบบ atomic: ต้อง succeeded, ยังไม่เคยถูกใช้, ของร้านนี้ และยอดไม่ต่ำกว่าขั้นต่ำ
   * คืนแถวที่ claim ได้ — null = เงื่อนไขข้อใดข้อหนึ่งไม่ผ่าน (หรือมีคำขออื่น claim ไปก่อน)
   */
  async claimForOrder(shopId: string, id: string, minAmountSatang: number): Promise<PaymentRow | null> {
    const [row] = await db.update(promptpayPayments)
      .set({ claimed_at: new Date(), updated_at: new Date() })
      .where(and(
        eq(promptpayPayments.shop_id, shopId),
        eq(promptpayPayments.id, id),
        eq(promptpayPayments.status, 'succeeded'),
        isNull(promptpayPayments.claimed_at),
        gte(promptpayPayments.amount_satang, minAmountSatang),
      ))
      .returning();
    return row ?? null;
  },

  /** สร้างออเดอร์ไม่สำเร็จ → ปล่อย claim คืนให้ใช้ปิดออเดอร์ใหม่ได้ (เฉพาะที่ยังไม่ผูกออเดอร์) */
  async releaseClaim(shopId: string, id: string): Promise<void> {
    await db.update(promptpayPayments)
      .set({ claimed_at: null, updated_at: new Date() })
      .where(and(
        eq(promptpayPayments.shop_id, shopId),
        eq(promptpayPayments.id, id),
        isNull(promptpayPayments.order_id),
      ));
  },

  /** บันทึกว่า payment นี้ปิดออเดอร์ไหน (หลังสร้างออเดอร์สำเร็จ) */
  async linkOrder(shopId: string, id: string, orderId: string): Promise<void> {
    await db.update(promptpayPayments)
      .set({ order_id: orderId, updated_at: new Date() })
      .where(and(
        eq(promptpayPayments.shop_id, shopId),
        eq(promptpayPayments.id, id),
        isNotNull(promptpayPayments.claimed_at),
        isNull(promptpayPayments.order_id),
      ));
  },

  /** รายการที่ยังค้าง queued/pending เกินเวลา (ผู้ใช้ปิดหน้าจอก่อนจบ) — ใช้ reconcile กับ platform */
  async listStalePending(shopId: string, olderThan: Date, limit: number): Promise<PaymentRow[]> {
    return db.select().from(promptpayPayments)
      .where(and(
        eq(promptpayPayments.shop_id, shopId),
        inArray(promptpayPayments.status, ['queued', 'pending']),
        lt(promptpayPayments.created_at, olderThan),
      ))
      .orderBy(promptpayPayments.created_at)
      .limit(limit);
  },

  /** ประวัติรายการในช่วงเวลา (created_at ∈ [from, to)) — scoped shop_id, เรียงใหม่สุดก่อน, แบ่งหน้า */
  async listPayments(shopId: string, range: PaymentRange, limit: number, offset: number): Promise<{ rows: PaymentRow[]; total: number }> {
    const where = and(
      eq(promptpayPayments.shop_id, shopId),
      gte(promptpayPayments.created_at, range.from),
      lt(promptpayPayments.created_at, range.to),
    );
    const [rows, [totalRow]] = await Promise.all([
      // id เป็น tiebreaker — created_at ซ้ำกันได้ ไม่งั้นแถวอาจซ้ำ/หายข้ามหน้า
      db.select().from(promptpayPayments).where(where)
        .orderBy(desc(promptpayPayments.created_at), desc(promptpayPayments.id)).limit(limit).offset(offset),
      db.select({ total: sql<number>`count(*)::int` }).from(promptpayPayments).where(where),
    ]);
    return { rows, total: totalRow?.total ?? 0 };
  },

  /** สรุปแยกธนาคารในช่วงเวลา — เฉพาะรายการที่สำเร็จ (รายการยกเลิก/หมดอายุไม่มีธนาคาร จึงไม่นับ) */
  async bankBreakdown(shopId: string, range: PaymentRange): Promise<BankBreakdownRow[]> {
    const rows = await db.select({
      bank:          promptpayPayments.bank,
      count:         sql<number>`count(*)::int`,
      amount_satang: sql<number>`(coalesce(sum(${promptpayPayments.amount_satang}), 0))::float8`,
    }).from(promptpayPayments)
      .where(and(
        eq(promptpayPayments.shop_id, shopId),
        eq(promptpayPayments.status, 'succeeded'),
        gte(promptpayPayments.created_at, range.from),
        lt(promptpayPayments.created_at, range.to),
      ))
      .groupBy(promptpayPayments.bank);
    return rows.map((r) => ({ ...r, bank: r.bank ?? 'unknown' }));
  },

  /** ยอดรวมตั้งแต่ `since` จนถึงปัจจุบัน (ใช้กับ วันนี้/เดือนนี้/ปีนี้) */
  async totalsSince(shopId: string, since: Date): Promise<PeriodTotals> {
    const [row] = await db.select({
      count:           sql<number>`count(*)::int`,
      succeeded_count: sql<number>`(count(*) filter (where ${succeededOnly}))::int`,
      amount_satang:   sql<number>`(coalesce(sum(${promptpayPayments.amount_satang}) filter (where ${succeededOnly}), 0))::float8`,
    }).from(promptpayPayments)
      .where(and(eq(promptpayPayments.shop_id, shopId), gte(promptpayPayments.created_at, since)));
    return row ?? { count: 0, succeeded_count: 0, amount_satang: 0 };
  },

  async listRecentPayments(shopId: string, limit = 20): Promise<PaymentRow[]> {
    return db.select().from(promptpayPayments)
      .where(eq(promptpayPayments.shop_id, shopId))
      .orderBy(desc(promptpayPayments.created_at))
      .limit(limit);
  },
};
