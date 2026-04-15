/** Bangkok timezone utilities — UTC+7 shared across all cron jobs and repositories */

export const BKK_OFFSET_MS = 7 * 3_600_000;  // UTC+7 in milliseconds
export const DAY_MS        = 24 * 3_600_000;  // 1 day in milliseconds
export const WEEK_MS       = 7  * DAY_MS;     // 7 days in milliseconds
export const OTP_EXPIRY_MS = 10 * 60_000;     // 10 minutes in milliseconds

/** Current time shifted to Bangkok local time (for date comparisons) */
export function bkkNow(): Date {
  return new Date(Date.now() + BKK_OFFSET_MS);
}

/** Today's month and day in Bangkok timezone */
export function bkkToday(): { month: number; day: number } {
  const d = bkkNow();
  return { month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}
