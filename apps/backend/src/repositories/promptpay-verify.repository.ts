import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { shopPromptpayVerify, promptpayPayments } from '../db/schema.js';

export type VerifyConfigRow = typeof shopPromptpayVerify.$inferSelect;
export type PaymentRow      = typeof promptpayPayments.$inferSelect;

type ConfigPatch = Partial<Omit<typeof shopPromptpayVerify.$inferInsert, 'shop_id' | 'created_at'>>;

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

  async deleteConfig(shopId: string): Promise<void> {
    await db.delete(shopPromptpayVerify).where(eq(shopPromptpayVerify.shop_id, shopId));
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

  async updatePayment(
    shopId: string,
    id: string,
    patch: Partial<Pick<PaymentRow, 'status' | 'bank' | 'payer_name' | 'transaction_at'>>,
  ): Promise<PaymentRow | null> {
    const [row] = await db.update(promptpayPayments)
      .set({ ...patch, updated_at: new Date() })
      .where(and(eq(promptpayPayments.shop_id, shopId), eq(promptpayPayments.id, id)))
      .returning();
    return row ?? null;
  },

  async listRecentPayments(shopId: string, limit = 20): Promise<PaymentRow[]> {
    return db.select().from(promptpayPayments)
      .where(eq(promptpayPayments.shop_id, shopId))
      .orderBy(desc(promptpayPayments.created_at))
      .limit(limit);
  },
};
