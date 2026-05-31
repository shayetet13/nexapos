/**
 * Snapshot Cron — checks every minute if it is 23:00 Bangkok time,
 * then saves leaderboard snapshots for all period types.
 * Does NOT delete any data — snapshots are upserted (cumulative).
 */
import { takeSnapshot } from '../repositories/leaderboard.repository.js';
import { bkkNow } from './bkk-time.js';

let handle: ReturnType<typeof setInterval> | null = null;
let lastSnapshotDate = ''; // 'YYYY-MM-DD' — prevents double-run

async function runSnapshots() {
  const now  = bkkNow();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  if (lastSnapshotDate === date) return; // already ran today
  lastSnapshotDate = date;

  console.log(`[SnapshotCron] Running at ${now.toISOString()} (BKK 23:00)`);

  const results = await Promise.allSettled([
    takeSnapshot('day'),
    takeSnapshot('week'),
    takeSnapshot('month'),
    takeSnapshot('year'),
  ]);

  results.forEach((r, i) => {
    const types = ['day', 'week', 'month', 'year'];
    if (r.status === 'fulfilled') {
      console.log(`[SnapshotCron] ${types[i]} → key=${r.value.key}, shops=${r.value.count}`);
    } else {
      console.error(`[SnapshotCron] ${types[i]} failed:`, r.reason);
    }
  });
}

export function startSnapshotCron() {
  if (handle) return; // already running

  // Check every 60 seconds
  handle = setInterval(() => {
    const now = bkkNow();
    // Fire at 23:00 Bangkok (hour=23, minute=0)
    if (now.getHours() === 23 && now.getMinutes() === 0) {
      runSnapshots().catch((err) => console.error('[SnapshotCron] Unexpected error:', err));
    }
  }, 60_000);

  console.log('[SnapshotCron] Started — will snapshot at 23:00 Bangkok time daily');
}

export function stopSnapshotCron() {
  if (handle) { clearInterval(handle); handle = null; }
}

/** Trigger a manual snapshot immediately (all period types) — called from API */
export async function triggerManualSnapshot() {
  return Promise.all([
    takeSnapshot('day'),
    takeSnapshot('week'),
    takeSnapshot('month'),
    takeSnapshot('year'),
  ]);
}
