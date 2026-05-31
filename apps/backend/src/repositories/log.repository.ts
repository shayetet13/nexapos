import { eq, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { logs } from '../db/schema.js';

export const logRepository = {
  insert(data: {
    shop_id: string;
    action: string;
    entity_type: string;
    entity_id: string;
    payload: Record<string, unknown>;
    user_id?: string;
  }) {
    return db.insert(logs).values(data).returning().then((rows) => rows[0] ?? null);
  },

  getByShopId(shopId: string, limit = 100) {
    return db
      .select()
      .from(logs)
      .where(eq(logs.shop_id, shopId))
      .orderBy(desc(logs.created_at))
      .limit(limit);
  },
};
