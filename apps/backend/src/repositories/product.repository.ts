import { eq, and, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { products } from '../db/schema.js';

export const productRepository = {
  getByShopId(shopId: string) {
    return db.select().from(products).where(eq(products.shop_id, shopId));
  },

  getById(productId: string, shopId: string) {
    return db
      .select()
      .from(products)
      .where(and(eq(products.id, productId), eq(products.shop_id, shopId)))
      .then((rows) => rows[0] ?? null);
  },

  /** Batch fetch multiple products by IDs — 1 query instead of N */
  getByIds(shopId: string, productIds: string[]) {
    if (productIds.length === 0) return Promise.resolve([]);
    return db
      .select()
      .from(products)
      .where(and(eq(products.shop_id, shopId), inArray(products.id, productIds)));
  },

  getByShopIdForPos(shopId: string) {
    return db.select().from(products).where(and(eq(products.shop_id, shopId), eq(products.show_on_pos, true)));
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
      .where(and(eq(products.id, productId), eq(products.shop_id, shopId)))
      .returning()
      .then((rows) => rows[0] ?? null);
  },

  delete(productId: string, shopId: string) {
    return db
      .delete(products)
      .where(and(eq(products.id, productId), eq(products.shop_id, shopId)));
  },
};
