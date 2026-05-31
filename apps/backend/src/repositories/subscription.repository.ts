import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { subscriptions } from '../db/schema.js';

export const subscriptionRepository = {
  getByShopId(shopId: string) {
    return db.select().from(subscriptions).where(eq(subscriptions.shop_id, shopId)).then((rows) => rows[0] ?? null);
  },

  setWhitelist(shopId: string, isWhitelisted: boolean) {
    return db
      .update(subscriptions)
      .set({ is_whitelisted: isWhitelisted, updated_at: new Date() })
      .where(eq(subscriptions.shop_id, shopId))
      .returning()
      .then((rows) => rows[0] ?? null);
  },

  upsert(shopId: string, data: {
    plan: string;
    billing_interval: 'monthly' | 'yearly' | 'once';
    status?: 'active' | 'cancelled' | 'past_due';
    expires_at?: Date | null;
  }) {
    return db
      .insert(subscriptions)
      .values({
        shop_id: shopId,
        plan: data.plan,
        billing_interval: data.billing_interval,
        status: data.status ?? 'active',
        expires_at: data.expires_at ?? null,
      })
      .onConflictDoUpdate({
        target: subscriptions.shop_id,
        set: {
          plan: data.plan,
          billing_interval: data.billing_interval,
          status: data.status ?? 'active',
          expires_at: data.expires_at ?? null,
          updated_at: new Date(),
        },
      })
      .returning()
      .then((rows) => rows[0] ?? null);
  },
};
