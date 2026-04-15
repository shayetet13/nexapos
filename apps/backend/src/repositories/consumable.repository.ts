import { db } from '../db/index.js';
import { consumables, productConsumables } from '../db/schema.js';
import { eq, and, sql } from 'drizzle-orm';

export const consumableRepository = {
  // ── Consumables CRUD ─────────────────────────────────────────────

  async listByShop(shopId: string) {
    return db
      .select()
      .from(consumables)
      .where(eq(consumables.shop_id, shopId))
      .orderBy(consumables.name);
  },

  /** Real-time stock snapshot สำหรับ Telegram — เรียงตาม quantity/min_qty ratio (ต่ำสุดก่อน) */
  async getStockSnapshot(shopId: string) {
    return db
      .select({
        id:       consumables.id,
        name:     consumables.name,
        unit:     consumables.unit,
        quantity: consumables.quantity,
        min_qty:  consumables.min_qty,
      })
      .from(consumables)
      .where(eq(consumables.shop_id, shopId))
      .orderBy(
        // เรียงจาก critical → low → ok
        sql`CASE
          WHEN ${consumables.quantity}::numeric = 0 THEN 0
          WHEN ${consumables.quantity}::numeric <= ${consumables.min_qty}::numeric THEN 1
          ELSE 2
        END`,
        consumables.name,
      );
  },

  async create(shopId: string, data: { name: string; unit: string; quantity: string; min_qty: string }) {
    const [row] = await db
      .insert(consumables)
      .values({ shop_id: shopId, ...data })
      .returning();
    return row;
  },

  async update(id: string, shopId: string, data: Partial<{ name: string; unit: string; quantity: string; min_qty: string }>) {
    const [row] = await db
      .update(consumables)
      .set({ ...data, updated_at: new Date() })
      .where(and(eq(consumables.id, id), eq(consumables.shop_id, shopId)))
      .returning();
    return row;
  },

  async delete(id: string, shopId: string) {
    const [row] = await db
      .delete(consumables)
      .where(and(eq(consumables.id, id), eq(consumables.shop_id, shopId)))
      .returning();
    return row;
  },

  // ── BOM ──────────────────────────────────────────────────────────

  async getBOM(productId: string) {
    return db
      .select({
        id:            productConsumables.id,
        consumable_id: productConsumables.consumable_id,
        qty_per_unit:  productConsumables.qty_per_unit,
        name:          consumables.name,
        unit:          consumables.unit,
      })
      .from(productConsumables)
      .innerJoin(consumables, eq(productConsumables.consumable_id, consumables.id))
      .where(eq(productConsumables.product_id, productId));
  },

  async setBOM(productId: string, items: { consumable_id: string; qty_per_unit: string }[]) {
    await db.delete(productConsumables).where(eq(productConsumables.product_id, productId));
    if (items.length === 0) return [];
    return db
      .insert(productConsumables)
      .values(items.map(i => ({ product_id: productId, ...i })))
      .returning();
  },

  /** Deduct consumables based on BOM for multiple order items.
   *  orderItems: [{ product_id, quantity }]
   *  Fires one query per consumable (typically few). */
  async deductByBOM(shopId: string, orderItems: { product_id: string; quantity: number }[]) {
    if (orderItems.length === 0) return;

    // Fetch all BOM entries for the ordered products
    const productIds = orderItems.map(i => i.product_id);
    const bomRows = await db
      .select({
        product_id:    productConsumables.product_id,
        consumable_id: productConsumables.consumable_id,
        qty_per_unit:  productConsumables.qty_per_unit,
      })
      .from(productConsumables)
      .innerJoin(consumables, eq(productConsumables.consumable_id, consumables.id))
      .where(
        and(
          eq(consumables.shop_id, shopId),
          sql`${productConsumables.product_id} = ANY(ARRAY[${sql.join(productIds.map(id => sql`${id}::uuid`), sql`, `)}])`
        )
      );

    if (bomRows.length === 0) return;

    // Aggregate total deduction per consumable
    const deductMap = new Map<string, number>();
    for (const row of bomRows) {
      const orderItem = orderItems.find(i => i.product_id === row.product_id);
      if (!orderItem) continue;
      const deduct = Number(row.qty_per_unit) * orderItem.quantity;
      deductMap.set(row.consumable_id, (deductMap.get(row.consumable_id) ?? 0) + deduct);
    }

    // Apply deductions
    for (const [consumableId, deduct] of deductMap.entries()) {
      await db
        .update(consumables)
        .set({
          quantity: sql`GREATEST(0, ${consumables.quantity} - ${deduct.toFixed(3)}::numeric)`,
          updated_at: new Date(),
        })
        .where(and(eq(consumables.id, consumableId), eq(consumables.shop_id, shopId)));
    }
  },
};
