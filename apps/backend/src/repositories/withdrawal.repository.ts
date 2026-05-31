import { db } from '../db/index.js';
import { withdrawalRequests, consumables, type WithdrawalItem } from '../db/schema.js';
import { eq, and, sql } from 'drizzle-orm';
import { stockRepository } from './stock.repository.js';

export const withdrawalRepository = {

  async create(data: {
    shop_id:    string;
    branch_id:  string;
    staff_name: string;
    note?:      string;
    items:      WithdrawalItem[];
  }) {
    const [row] = await db
      .insert(withdrawalRequests)
      .values({ ...data, status: 'pending' })
      .returning();
    return row;
  },

  async listPending(shopId: string) {
    return db
      .select()
      .from(withdrawalRequests)
      .where(and(
        eq(withdrawalRequests.shop_id, shopId),
        eq(withdrawalRequests.status, 'pending'),
      ));
  },

  async getById(id: string, shopId: string) {
    const [row] = await db
      .select()
      .from(withdrawalRequests)
      .where(and(eq(withdrawalRequests.id, id), eq(withdrawalRequests.shop_id, shopId)));
    return row ?? null;
  },

  /** Approve: deduct stock, update status */
  async approve(id: string, shopId: string, approvedBy: string) {
    const request = await this.getById(id, shopId);
    if (!request || request.status !== 'pending') return null;

    const items = request.items as WithdrawalItem[];

    // Deduct consumables
    const consumableItems = items.filter(i => i.type === 'consumable');
    for (const item of consumableItems) {
      await db
        .update(consumables)
        .set({
          quantity:   sql`GREATEST(0, ${consumables.quantity} - ${item.qty.toFixed(3)}::numeric)`,
          updated_at: new Date(),
        })
        .where(and(eq(consumables.id, item.id), eq(consumables.shop_id, shopId)));
    }

    // Deduct product stock
    const productItems = items.filter(i => i.type === 'product');
    for (const item of productItems) {
      await stockRepository.deductStock(request.branch_id, item.id, item.qty);
    }

    const [updated] = await db
      .update(withdrawalRequests)
      .set({
        status:      'approved',
        approved_by: approvedBy,
        approved_at: new Date(),
      })
      .where(and(eq(withdrawalRequests.id, id), eq(withdrawalRequests.shop_id, shopId)))
      .returning();

    return updated;
  },

  async reject(id: string, shopId: string) {
    const [row] = await db
      .update(withdrawalRequests)
      .set({
        status:      'rejected',
        rejected_at: new Date(),
      })
      .where(and(
        eq(withdrawalRequests.id, id),
        eq(withdrawalRequests.shop_id, shopId),
        eq(withdrawalRequests.status, 'pending'),
      ))
      .returning();
    return row ?? null;
  },
};
