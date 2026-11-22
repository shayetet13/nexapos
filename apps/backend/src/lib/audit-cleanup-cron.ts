/**
 * Audit Cleanup Cron — runs every Sunday at 00:01 Bangkok time
 * Deletes audit_logs rows older than 7 days.
 *
 * Pattern mirrors snapshot-cron.ts: setInterval checks every minute,
 * fires once per Sunday (guarded by lastCleanupDate to prevent double-run).
 */
import { lt } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { bkkNow } from './bkk-time.js';

let handle: ReturnType<typeof setInterval> | null = null;
let lastCleanupDate = ''; // 'YYYY-MM-DD' — prevents double-run on same day

async function cleanupAuditLogs() {
  const cutoff = new Date(Date.now() - 60 * 24 * 3600_000); // 2 months (60 days) ago (UTC)

  try {
    const result = await db
      .delete(schema.auditLogs)
      .where(lt(schema.auditLogs.created_at, cutoff))
      .returning({ id: schema.auditLogs.id });

    console.log(`[AuditCleanup] Deleted ${result.length} log(s) older than ${cutoff.toISOString()}`);
  } catch (err) {
    console.error('[AuditCleanup] Failed to delete old audit logs:', err);
  }
}

export function startAuditCleanupCron() {
  if (handle) return; // already running

  // Check every 60 seconds
  handle = setInterval(() => {
    const now = bkkNow();
    // Fire on Sunday (0) at 00:01 Bangkok time
    if (now.getDay() === 0 && now.getHours() === 0 && now.getMinutes() === 1) {
      const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      if (lastCleanupDate === date) return; // already ran this Sunday
      lastCleanupDate = date;
      cleanupAuditLogs().catch((err) => console.error('[AuditCleanup] Unexpected error:', err));
    }
  }, 60_000);

  console.log('[AuditCleanup] Started — will delete audit logs >2 months (60 days) every Sunday 00:01 Bangkok time');
}

export function stopAuditCleanupCron() {
  if (handle) { clearInterval(handle); handle = null; }
}

/** Trigger manual cleanup immediately — for testing or one-off admin use */
export async function triggerManualAuditCleanup() {
  return cleanupAuditLogs();
}
