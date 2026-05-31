/**
 * Notification Cleanup Cron — runs on the 1st of every month at 00:01 Bangkok time
 * Deletes all shop_notifications rows (monthly reset).
 *
 * Pattern mirrors audit-cleanup-cron.ts: setInterval checks every minute,
 * fires once per 1st of month (guarded by lastCleanupDate to prevent double-run).
 */
import { db, schema } from '../db/index.js';
import { bkkNow } from './bkk-time.js';

let handle: ReturnType<typeof setInterval> | null = null;
let lastCleanupDate = ''; // 'YYYY-MM' — prevents double-run in same month

async function cleanupNotifications() {
  try {
    const result = await db
      .delete(schema.shopNotifications)
      .returning({ id: schema.shopNotifications.id });

    console.log(`[NotificationCleanup] Deleted ${result.length} notification(s)`);
  } catch (err) {
    console.error('[NotificationCleanup] Failed to delete notifications:', err);
  }
}

export function startNotificationCleanupCron() {
  if (handle) return; // already running

  // Check every 60 seconds
  handle = setInterval(() => {
    const now = bkkNow();
    // Fire on the 1st of the month at 00:01 Bangkok time
    if (now.getDate() === 1 && now.getHours() === 0 && now.getMinutes() === 1) {
      const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      if (lastCleanupDate === monthKey) return; // already ran this month
      lastCleanupDate = monthKey;
      cleanupNotifications().catch((err) =>
        console.error('[NotificationCleanup] Unexpected error:', err),
      );
    }
  }, 60_000);

  console.log('[NotificationCleanup] Started — will delete all notifications on 1st of every month at 00:01 Bangkok time');
}

export function stopNotificationCleanupCron() {
  if (handle) { clearInterval(handle); handle = null; }
}

/** Trigger manual cleanup immediately — for testing */
export async function triggerManualNotificationCleanup() {
  return cleanupNotifications();
}
