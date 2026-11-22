/**
 * Birthday cron — runs once on startup and daily; creates shop_notifications
 * for customers with birthday in the next 7 days. Deduplicates by customer_id + year.
 */
import { and, eq, sql, gte } from 'drizzle-orm';
import { db } from '../db/index.js';
import { customers, shopNotifications } from '../db/schema.js';
import { broadcast } from './ws-broadcast.js';
import { bkkNow, DAY_MS } from './bkk-time.js';

/** Get (month, day) for the next N days including today */
function nextDaysMonthDay(days: number): Array<{ month: number; day: number }> {
  const now = bkkNow();
  const out: Array<{ month: number; day: number }> = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    out.push({ month: d.getMonth() + 1, day: d.getDate() });
  }
  return out;
}

/** Start of current year in Bangkok for dedupe check */
function startOfYearBkk(): Date {
  const d = bkkNow();
  return new Date(Date.UTC(d.getFullYear(), 0, 1));
}

export async function runBirthdayNotifications() {
  const pairs = nextDaysMonthDay(7);
  const yearStart = startOfYearBkk();
  let inserted = 0;

  for (const { month, day } of pairs) {
    // Customers with birthday on this (month, day) — use raw SQL for portable date parts
    const rows = await db
      .select({ id: customers.id, shop_id: customers.shop_id, name: customers.name })
      .from(customers)
      .where(
        and(
          sql`EXTRACT(MONTH FROM ${customers.birthday}) = ${month}`,
          sql`EXTRACT(DAY FROM ${customers.birthday}) = ${day}`,
        ),
      );

    for (const row of rows) {
      const existing = await db
        .select({ id: shopNotifications.id })
        .from(shopNotifications)
        .where(
          and(
            eq(shopNotifications.shop_id, row.shop_id),
            eq(shopNotifications.customer_id, row.id),
            eq(shopNotifications.type, 'birthday'),
            gte(shopNotifications.created_at, yearStart),
          ),
        )
        .limit(1);
      if (existing.length > 0) continue;

      const notifTitle   = 'วันเกิดสมาชิก';
      const notifMessage = `${row.name} มีวันเกิดใน 7 วันนี้`;

      const [notification] = await db.insert(shopNotifications).values({
        shop_id:     row.shop_id,
        customer_id: row.id,
        type:        'birthday',
        title:       notifTitle,
        message:     notifMessage,
      }).returning();

      // Push real-time alert to all connected POS clients in this shop
      broadcast(row.shop_id, 'BIRTHDAY_ALERT', {
        notification_id: notification?.id ?? null,
        customer_id:     row.id,
        customer_name:   row.name,
        title:           notifTitle,
        message:         notifMessage,
      });

      inserted++;
    }
  }

  if (inserted > 0) {
    console.log(`[BirthdayCron] Inserted ${inserted} birthday notification(s)`);
  }
  return inserted;
}

let handle: ReturnType<typeof setInterval> | null = null;

export function startBirthdayCron() {
  runBirthdayNotifications().catch((err) => console.error('[BirthdayCron] Run failed:', err));
  handle = setInterval(() => {
    runBirthdayNotifications().catch((err) => console.error('[BirthdayCron] Run failed:', err));
  }, DAY_MS);
  console.log('[BirthdayCron] Started — runs on startup and every 24h');
}

export function stopBirthdayCron() {
  if (handle) {
    clearInterval(handle);
    handle = null;
  }
}
