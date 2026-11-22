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

/** 00:00 (Bangkok) ของวันที่ `now` เป็น instant จริง (UTC) — ไทยไม่มี DST จึงใช้ offset คงที่ได้ */
export function bkkDayStart(now: Date = new Date()): Date {
  const shifted = new Date(now.getTime() + BKK_OFFSET_MS);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - BKK_OFFSET_MS);
}

/** 00:00 (Bangkok) ของวันที่ 1 ของเดือนที่ `now` อยู่ */
export function bkkMonthStart(now: Date = new Date()): Date {
  const shifted = new Date(now.getTime() + BKK_OFFSET_MS);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), 1) - BKK_OFFSET_MS);
}

/** 00:00 (Bangkok) ของวันที่ 1 ม.ค. ของปีที่ `now` อยู่ */
export function bkkYearStart(now: Date = new Date()): Date {
  const shifted = new Date(now.getTime() + BKK_OFFSET_MS);
  return new Date(Date.UTC(shifted.getUTCFullYear(), 0, 1) - BKK_OFFSET_MS);
}

/** แปลง "YYYY-MM-DD" (วันตามเวลาไทย) → instant 00:00 Bangkok; null ถ้ารูปแบบ/วันที่ไม่ถูกต้อง */
export function parseBkkDate(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const utc = new Date(Date.UTC(y, mo - 1, d));
  if (utc.getUTCFullYear() !== y || utc.getUTCMonth() !== mo - 1 || utc.getUTCDate() !== d) return null;
  return new Date(utc.getTime() - BKK_OFFSET_MS);
}
