import { eq, and, inArray, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { products } from '../db/schema.js';

export const productRepository = {
  /** Active products only (not soft-deleted) */
  getByShopId(shopId: string) {
    return db.select().from(products).where(
      and(eq(products.shop_id, shopId), isNull(products.deleted_at)),
    );
  },

  /** Lookup by ID — includes soft-deleted so order history / reports still resolve names */
  getById(productId: string, shopId: string) {
    return db
      .select()
      .from(products)
      .where(and(eq(products.id, productId), eq(products.shop_id, shopId)))
      .then((rows) => rows[0] ?? null);
  },

  /** Active-only lookup — used for order creation / stock management */
  getActiveById(productId: string, shopId: string) {
    return db
      .select()
      .from(products)
      .where(and(eq(products.id, productId), eq(products.shop_id, shopId), isNull(products.deleted_at)))
      .then((rows) => rows[0] ?? null);
  },

  /** Batch fetch active products by IDs — 1 query instead of N */
  getByIds(shopId: string, productIds: string[]) {
    if (productIds.length === 0) return Promise.resolve([]);
    return db
      .select()
      .from(products)
      .where(and(eq(products.shop_id, shopId), inArray(products.id, productIds), isNull(products.deleted_at)));
  },

  getByShopIdForPos(shopId: string) {
    return db.select().from(products).where(
      and(eq(products.shop_id, shopId), eq(products.show_on_pos, true), isNull(products.deleted_at)),
    );
  },

  create(data: {
    shop_id: string; name: string; sku?: string; price: string;
    cost_price?: string; unit?: string; category?: string; barcode?: string; image_url?: string;
    show_on_pos?: boolean;
  }) {
    return db.insert(products).values(data).returning().then((rows) => rows[0] ?? null);
  },

  update(productId: string, shopId: string, data: {
    name?: string; sku?: string; price?: string; cost_price?: string | null;
    unit?: string; category?: string | null; barcode?: string | null; image_url?: string | null;
  }) {
    return db
      .update(products)
      .set({ ...data, updated_at: new Date() })
      .where(and(eq(products.id, productId), eq(products.shop_id, shopId), isNull(products.deleted_at)))
      .returning()
      .then((rows) => rows[0] ?? null);
  },

  /** Soft-delete: marks deleted_at = NOW(). The row is preserved so order history / reports remain intact. */
  delete(productId: string, shopId: string) {
    return db
      .update(products)
      .set({ deleted_at: new Date(), updated_at: new Date() })
      .where(and(eq(products.id, productId), eq(products.shop_id, shopId), isNull(products.deleted_at)))
      .returning()
      .then((rows) => rows[0] ?? null);
  },
};
