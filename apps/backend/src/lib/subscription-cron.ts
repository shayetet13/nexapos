/**
 * Subscription expiry cron
 * Runs on startup and every 12 h.
 * Creates renewal_reminder notifications for shops whose trial / paid plan
 * expires within the next 7 days (alerts at 7 d, 3 d, and 1 d before expiry).
 * Deduplicates per shop × days-bucket so the same alert is sent only once.
 */
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { subscriptions, shops, shopNotifications } from '../db/schema.js';
import { broadcast } from './ws-broadcast.js';
import { bkkNow } from './bkk-time.js';

/** Alert thresholds in days before expiry */
const ALERT_DAYS = [7, 3, 1];

/** Format date in Thai locale (Bangkok time) */
function fmtThaiDate(d: Date): string {
  return d.toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    day:   '2-digit',
    month: 'long',
    year:  'numeric',
    hour:   '2-digit',
    minute: '2-digit',
  });
}

/** Deduplicate key stored in notification title prefix */
function dedupeKey(shopId: string, bucket: number): string {
  const now = bkkNow();
  // e.g. "2026-04-12-bucket7" — one notification per shop per alert bucket per calendar day
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  return `__sub_${shopId}_${bucket}_${dateStr}`;
}

export async function runSubscriptionExpiryNotifications() {
  const now     = bkkNow();
  const maxLook = new Date(now.getTime() + 7 * 86_400_000); // +7 days

  // All active/trial subscriptions expiring within 7 days
  const rows = await db
    .select({
      shop_id:    subscriptions.shop_id,
      plan:       subscriptions.plan,
      expires_at: subscriptions.expires_at,
      shop_name:  shops.name,
    })
    .from(subscriptions)
    .innerJoin(shops, eq(shops.id, subscriptions.shop_id))
    .where(
      and(
        eq(subscriptions.status, 'active'),
        gte(subscriptions.expires_at, now),          // not yet expired
        lte(subscriptions.expires_at, maxLook),      // within 7 days
      ),
    );

  let inserted = 0;

  for (const row of rows) {
    if (!row.expires_at) continue;

    const msLeft   = row.expires_at.getTime() - now.getTime();
    const daysLeft = Math.ceil(msLeft / 86_400_000);
    const planLabel = row.plan === 'trial' ? 'ทดลองใช้ฟรี 30 วัน' : `แผน ${row.plan}`;
    const expiryStr = fmtThaiDate(row.expires_at);

    for (const bucket of ALERT_DAYS) {
      if (daysLeft > bucket) continue; // not yet in this alert window

      // Deduplicate: check if we already created a notification for this shop+bucket today
      const key = dedupeKey(row.shop_id, bucket);
      const existing = await db
        .select({ id: shopNotifications.id })
        .from(shopNotifications)
        .where(
          and(
            eq(shopNotifications.shop_id, row.shop_id),
            eq(shopNotifications.type, 'renewal_reminder'),
            // created today (Bangkok)
            gte(shopNotifications.created_at,
              new Date(now.getFullYear(), now.getMonth(), now.getDate())), // midnight local approx
            sql`${shopNotifications.title} LIKE ${'%' + key + '%'}`,
          ),
        )
        .limit(1);

      if (existing.length > 0) continue;

      const urgency = daysLeft <= 1 ? '🚨' : daysLeft <= 3 ? '⚠️' : '⏰';
      const title   = `${urgency} ร้าน "${row.shop_name}" (${planLabel}) จะหมดอายุในอีก ${daysLeft} วัน — ${key}`;
      const message = `หมดอายุวันที่ ${expiryStr}\nกรุณาต่ออายุได้ที่เมนู Subscription ก่อนระบบถูกจำกัดการใช้งาน`;

      const [notif] = await db
        .insert(shopNotifications)
        .values({
          shop_id: row.shop_id,
          type:    'renewal_reminder',
          title,
          message,
        })
        .returning();

      broadcast(row.shop_id, 'RENEWAL_REMINDER', {
        notification_id: notif?.id ?? null,
        shop_name:       row.shop_name,
        plan:            row.plan,
        expires_at:      row.expires_at.toISOString(),
        days_left:       daysLeft,
        title,
        message,
      });

      inserted++;
      break; // send only the most urgent alert bucket per shop per run
    }
  }

  if (inserted > 0) {
    console.log(`[SubscriptionCron] Inserted ${inserted} renewal_reminder notification(s)`);
  }
  return inserted;
}

let handle: ReturnType<typeof setInterval> | null = null;
const INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 h

export function startSubscriptionCron() {
  runSubscriptionExpiryNotifications().catch((err) =>
    console.error('[SubscriptionCron] Run failed:', err),
  );
  handle = setInterval(() => {
    runSubscriptionExpiryNotifications().catch((err) =>
      console.error('[SubscriptionCron] Run failed:', err),
    );
  }, INTERVAL_MS);
  console.log('[SubscriptionCron] Started — runs on startup and every 12 h');
}

export function stopSubscriptionCron() {
  if (handle) { clearInterval(handle); handle = null; }
}
