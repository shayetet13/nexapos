import { eq, and, sql, lte, gte, desc, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { branchStock, branches, products, stockTransactions, orders, orderItems } from '../db/schema.js';

export const stockRepository = {
  getStock(branchId: string, productId: string) {
    return db
      .select()
      .from(branchStock)
      .where(and(eq(branchStock.branch_id, branchId), eq(branchStock.product_id, productId)))
      .then((rows) => rows[0] ?? null);
  },

  /** Batch fetch stock for multiple products in one branch — 1 query instead of N */
  getStockForProducts(branchId: string, productIds: string[]) {
    if (productIds.length === 0) return Promise.resolve([]);
    return db
      .select()
      .from(branchStock)
      .where(and(eq(branchStock.branch_id, branchId), inArray(branchStock.product_id, productIds)));
  },

  getStockByBranch(branchId: string, shopId: string) {
    return db
      .select({
        branch_id:  branchStock.branch_id,
        product_id: branchStock.product_id,
        quantity:   branchStock.quantity,
        min_qty:    branchStock.min_qty,
        updated_at: branchStock.updated_at,
      })
      .from(branchStock)
      .innerJoin(branches, eq(branches.id, branchStock.branch_id))
      .where(and(eq(branchStock.branch_id, branchId), eq(branches.shop_id, shopId)));
  },

  /** Batch-insert stock=0 for every branch when a product is created — 1 query instead of N */
  batchInitStock(productId: string, branchIds: string[]) {
    if (branchIds.length === 0) return Promise.resolve([]);
    return db
      .insert(branchStock)
      .values(branchIds.map((branch_id) => ({
        branch_id,
        product_id: productId,
        quantity:   0,
        updated_at: new Date(),
      })))
      .onConflictDoNothing()
      .returning();
  },

  async upsertStock(
    branchId: string,
    productId: string,
    quantity: number,
    opts?: { shopId?: string; userId?: string; note?: string },
  ) {
    // Fast path: no audit log needed → 1 round trip only (skip the SELECT)
    if (!opts?.shopId) {
      const result = await db
        .insert(branchStock)
        .values({ branch_id: branchId, product_id: productId, quantity, updated_at: new Date() })
        .onConflictDoUpdate({
          target: [branchStock.branch_id, branchStock.product_id],
          set: { quantity, updated_at: new Date() },
        })
        .returning();
      return result[0];
    }

    // With audit log: 2 round trips (SELECT qty_before → upsert + log in tx)
    const existing = await db
      .select({ quantity: branchStock.quantity })
      .from(branchStock)
      .where(and(eq(branchStock.branch_id, branchId), eq(branchStock.product_id, productId)))
      .limit(1);
    const qtyBefore = existing[0]?.quantity ?? 0;

    const [row] = await db.transaction(async (tx) => {
      const result = await tx
        .insert(branchStock)
        .values({ branch_id: branchId, product_id: productId, quantity, updated_at: new Date() })
        .onConflictDoUpdate({
          target: [branchStock.branch_id, branchStock.product_id],
          set: { quantity, updated_at: new Date() },
        })
        .returning();
      await tx.insert(stockTransactions).values({
        shop_id:    opts.shopId!,
        branch_id:  branchId,
        product_id: productId,
        type:       'manual_set',
        qty_before: qtyBefore,
        qty_change: quantity - qtyBefore,
        qty_after:  quantity,
        note:       opts.note ?? null,
        created_by: opts.userId ?? null,
      });
      return result;
    });

    return row;
  },

  async deductStock(
    branchId: string,
    productId: string,
    qty: number,
    opts?: { shopId?: string; userId?: string; note?: string },
  ) {
    const existing = await db
      .select({ quantity: branchStock.quantity })
      .from(branchStock)
      .where(and(eq(branchStock.branch_id, branchId), eq(branchStock.product_id, productId)))
      .limit(1);
    const qtyBefore = existing[0]?.quantity ?? 0;

    const rows = await db
      .update(branchStock)
      .set({
        quantity:   sql`${branchStock.quantity} - ${qty}`,
        updated_at: new Date(),
      })
      .where(and(eq(branchStock.branch_id, branchId), eq(branchStock.product_id, productId)))
      .returning();
    const row = rows[0] ?? null;

    if (row && opts?.shopId) {
      await db.insert(stockTransactions).values({
        shop_id:    opts.shopId,
        branch_id:  branchId,
        product_id: productId,
        type:       'sale_deduct',
        qty_before: qtyBefore,
        qty_change: -qty,
        qty_after:  row.quantity,
        note:       opts.note ?? null,
        created_by: opts.userId ?? null,
      });
    }

    return row;
  },

  getStockByProductInShop(shopId: string, productId: string) {
    // LEFT JOIN from branches so every active branch appears even with no stock record
    return db
      .select({
        branch_id:   branches.id,
        branch_name: branches.name,
        quantity:    sql<number>`COALESCE(${branchStock.quantity}, 0)`,
        min_qty:     sql<number>`COALESCE(${branchStock.min_qty}, 5)`,
      })
      .from(branches)
      .leftJoin(
        branchStock,
        and(
          eq(branchStock.branch_id, branches.id),
          eq(branchStock.product_id, productId),
        ),
      )
      .where(and(eq(branches.shop_id, shopId), eq(branches.is_active, true)))
      .orderBy(branches.name);
  },

  getAllStockInShop(shopId: string, opts?: { limit?: number; offset?: number }) {
    const { limit = 500, offset = 0 } = opts ?? {};
    // LEFT JOIN from products x branches → branchStock so every product+branch
    // combination appears, even if no stock record exists yet (quantity = 0)
    return db
      .select({
        product_id:   products.id,
        product_name: products.name,
        sku:          products.sku,
        unit:         products.unit,
        category:     products.category,
        image_url:    products.image_url,
        show_on_pos:  products.show_on_pos,
        branch_id:    branches.id,
        branch_name:  branches.name,
        quantity:     sql<number>`COALESCE(${branchStock.quantity}, 0)`,
        min_qty:      sql<number>`COALESCE(${branchStock.min_qty}, 5)`,
        updated_at:   branchStock.updated_at,
      })
      .from(products)
      .innerJoin(branches, eq(branches.shop_id, products.shop_id))
      .leftJoin(
        branchStock,
        and(
          eq(branchStock.product_id, products.id),
          eq(branchStock.branch_id, branches.id),
        ),
      )
      .where(and(eq(products.shop_id, shopId), eq(branches.is_active, true)))
      .orderBy(products.name, branches.name)
      .limit(limit)
      .offset(offset);
  },

  getLowStockItems(shopId: string, branchId?: string) {
    return db
      .select({
        product_id:   products.id,
        product_name: products.name,
        unit:         products.unit,
        branch_id:    branchStock.branch_id,
        branch_name:  branches.name,
        quantity:     branchStock.quantity,
        min_qty:      branchStock.min_qty,
      })
      .from(branchStock)
      .innerJoin(products, eq(products.id, branchStock.product_id))
      .innerJoin(branches, eq(branches.id, branchStock.branch_id))
      .where(and(
        eq(products.shop_id, shopId),
        lte(branchStock.quantity, branchStock.min_qty),
        branchId ? eq(branchStock.branch_id, branchId) : undefined,
      ))
      .orderBy(branchStock.quantity, products.name);
  },

  updateMinQty(branchId: string, productId: string, minQty: number) {
    return db
      .update(branchStock)
      .set({ min_qty: minQty, updated_at: new Date() })
      .where(and(eq(branchStock.branch_id, branchId), eq(branchStock.product_id, productId)))
      .returning()
      .then((rows) => rows[0] ?? null);
  },

  async transferStock(
    shopId: string,
    fromBranchId: string,
    toBranchId: string,
    productId: string,
    qty: number,
    userId?: string,
    note?: string,
  ) {
    // Single atomic DB transaction — 1 round trip, no partial failures
    return db.transaction(async (tx) => {
      // Deduct from source atomically (check + update in one query)
      const srcRows = await tx
        .update(branchStock)
        .set({ quantity: sql`${branchStock.quantity} - ${qty}`, updated_at: new Date() })
        .where(and(
          eq(branchStock.branch_id, fromBranchId),
          eq(branchStock.product_id, productId),
          gte(branchStock.quantity, qty), // atomic stock check
        ))
        .returning();
      const srcRow = srcRows[0];
      if (!srcRow) return null; // insufficient stock or no record

      const srcBefore = srcRow.quantity + qty; // qty before deduction

      // Get destination before (for log) then upsert
      const dstBefore = await tx
        .select({ quantity: branchStock.quantity })
        .from(branchStock)
        .where(and(eq(branchStock.branch_id, toBranchId), eq(branchStock.product_id, productId)))
        .limit(1)
        .then((r) => r[0]?.quantity ?? 0);

      const dstRows = await tx
        .insert(branchStock)
        .values({ branch_id: toBranchId, product_id: productId, quantity: dstBefore + qty, updated_at: new Date() })
        .onConflictDoUpdate({
          target: [branchStock.branch_id, branchStock.product_id],
          set: { quantity: sql`${branchStock.quantity} + ${qty}`, updated_at: new Date() },
        })
        .returning();
      const dstRow = dstRows[0];
      if (!dstRow) return null;

      // Batch insert both transaction logs in 1 round trip
      await tx.insert(stockTransactions).values([
        {
          shop_id: shopId, branch_id: fromBranchId, product_id: productId,
          type: 'transfer_out',
          qty_before: srcBefore, qty_change: -qty, qty_after: srcRow.quantity,
          note: note ?? null, created_by: userId ?? null,
        },
        {
          shop_id: shopId, branch_id: toBranchId, product_id: productId,
          type: 'transfer_in',
          qty_before: dstBefore, qty_change: qty, qty_after: dstRow.quantity,
          note: note ?? null, created_by: userId ?? null,
        },
      ]);

      return { from: srcRow, to: dstRow };
    });
  },

  getStockTransactions(
    shopId: string,
    opts?: { branchId?: string; fromDate?: Date; toDate?: Date; limit?: number },
  ) {
    const { branchId, fromDate, toDate, limit = 200 } = opts ?? {};
    const conds = [eq(stockTransactions.shop_id, shopId)];
    if (branchId) conds.push(eq(stockTransactions.branch_id, branchId));
    if (fromDate) conds.push(gte(stockTransactions.created_at, fromDate));
    if (toDate)   conds.push(lte(stockTransactions.created_at, toDate));

    return db
      .select({
        id:           stockTransactions.id,
        branch_id:    stockTransactions.branch_id,
        branch_name:  branches.name,
        product_id:   stockTransactions.product_id,
        product_name: products.name,
        sku:          products.sku,
        unit:         products.unit,
        type:         stockTransactions.type,
        qty_before:   stockTransactions.qty_before,
        qty_change:   stockTransactions.qty_change,
        qty_after:    stockTransactions.qty_after,
        note:         stockTransactions.note,
        created_at:   stockTransactions.created_at,
      })
      .from(stockTransactions)
      .innerJoin(products, eq(products.id, stockTransactions.product_id))
      .innerJoin(branches, eq(branches.id, stockTransactions.branch_id))
      .where(and(...conds))
      .orderBy(desc(stockTransactions.created_at))
      .limit(limit);
  },

  async getTopSoldProducts(shopId: string, period: 'day' | 'month' | 'year', limit = 5, branchId?: string | null) {
    const now = new Date();
    const bkk = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
    let fromDate: Date;
    let toDate: Date;
    if (period === 'day') {
      fromDate = new Date(bkk.getFullYear(), bkk.getMonth(), bkk.getDate());
      toDate   = new Date(fromDate.getTime() + 24 * 60 * 60 * 1000);
    } else if (period === 'month') {
      fromDate = new Date(bkk.getFullYear(), bkk.getMonth(), 1);
      toDate   = new Date(bkk.getFullYear(), bkk.getMonth() + 1, 1);
    } else {
      fromDate = new Date(bkk.getFullYear(), 0, 1);
      toDate   = new Date(bkk.getFullYear() + 1, 0, 1);
    }

    return db
      .select({
        name:     products.name,
        unit:     products.unit,
        qtySold:  sql<number>`SUM(${orderItems.quantity})::int`,
        revenue:  sql<string>`COALESCE(SUM(${orderItems.subtotal})::numeric, 0)`,
      })
      .from(orderItems)
      .innerJoin(orders,   eq(orders.id, orderItems.order_id))
      .innerJoin(products, eq(products.id, orderItems.product_id))
      .where(
        and(
          eq(orders.shop_id, shopId),
          eq(orders.status, 'paid'),
          gte(orders.created_at, fromDate),
          lte(orders.created_at, toDate),
          branchId ? eq(orders.branch_id, branchId) : undefined,
        ),
      )
      .groupBy(orderItems.product_id, products.name, products.unit)
      .orderBy(sql`SUM(${orderItems.quantity}) DESC`)
      .limit(limit);
  },
};
