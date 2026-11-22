/**
 * Pure helpers สำหรับ PromptPay auto-verify (แยกจาก route เพื่อเทสต์ได้โดยไม่ต้องมี DB/Fastify)
 */
import { DAY_MS, bkkDayStart, parseBkkDate } from './bkk-time.js';
import { ValidationError } from './errors.js';
import type { PaymentStatus } from './promptpay-verify-api.js';

export const MAX_RANGE_DAYS = 366;

/** รายการที่ค้าง queued/pending เกินนี้ถือว่าไม่มีหน้าจอ poll อยู่แล้ว → reconcile กับ platform (หน้าต่างชำระ ~2 นาที) */
export const STALE_PENDING_MS = 3 * 60_000;

/** reconcile ไม่ได้เลย (เช่น platform ลบรายการทิ้ง) เกินนี้ → ปิดเป็น expired ฝั่ง NexaPos */
export const ABANDONED_PENDING_MS = 30 * 60_000;

export const TERMINAL_STATUSES: ReadonlySet<PaymentStatus> =
  new Set<PaymentStatus>(['succeeded', 'expired', 'cancelled', 'ambiguous']);

export interface DateRange { from: Date; to: Date }

/**
 * from/to = วันที่ตามเวลาไทย (YYYY-MM-DD, รวมวัน to) → ช่วง [from, to+1วัน) เป็น instant จริง
 * ไม่ส่ง = วันนี้; ช่วงยาวสุด MAX_RANGE_DAYS วัน
 */
export function resolveRange(q: { from?: string; to?: string }, now: Date = new Date()): DateRange {
  const today = bkkDayStart(now);
  const from  = q.from ? parseBkkDate(q.from) : today;
  const toDay = q.to   ? parseBkkDate(q.to)   : today;
  if (!from || !toDay) throw new ValidationError({ from: ['ช่วงวันที่ไม่ถูกต้อง (รูปแบบ YYYY-MM-DD)'] });
  if (from > toDay)    throw new ValidationError({ from: ['วันที่เริ่มต้นต้องไม่เกินวันที่สิ้นสุด'] });
  const to = new Date(toDay.getTime() + DAY_MS);
  if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * DAY_MS) {
    throw new ValidationError({ from: [`เลือกช่วงได้ไม่เกิน ${MAX_RANGE_DAYS} วัน`] });
  }
  return { from, to };
}

/** succeeded ต้องยอดตรงกับที่ร้านสร้างเท่านั้น — ไม่ตรง = ambiguous (ให้คนตรวจกับธนาคาร) */
export function settleStatus(expectedAmountSatang: number, ext: { status: PaymentStatus; amountSatang: number }): PaymentStatus {
  return ext.status === 'succeeded' && ext.amountSatang !== expectedAmountSatang ? 'ambiguous' : ext.status;
}

// ── ร้านพร้อมใช้ auto-verify หรือไม่ (ใช้ร่วมกันระหว่าง route และ order service) ─────────────────────────

export interface VerifyConfigLike {
  enabled:                boolean;
  bot_id:                 string | null;
  source_target_id:       string | null;
  promptpay_id_type:      string | null;
  promptpay_id_encrypted: string | null;
}

/** config ครบ + เปิดใช้งาน (ยังไม่รวมสถานะ platform — ดู platformReady) */
export function isVerifyReady<T extends VerifyConfigLike>(c: T | null): c is T {
  return !!c && c.enabled && !!c.bot_id && !!c.source_target_id
    && !!c.promptpay_id_type && !!c.promptpay_id_encrypted;
}

export const platformReady = (p: { base_url_configured: boolean; api_key_configured: boolean }): boolean =>
  p.base_url_configured && p.api_key_configured;

// ── ยอดที่ลูกค้าต้องจ่ายจริง เทียบกับ payment ที่ตรวจแล้ว ─────────────────────────────────────────────

/** VAT ของ POS (CheckoutModal): ปัดเป็นบาทเต็มจากยอดหลังหักส่วนลด */
export const VAT_RATE = 0.07;

/**
 * ส่วนต่างที่ยอมรับได้ระหว่างยอดที่ server คำนวณกับยอดที่ลูกค้าจ่ายจริง
 * (POS คำนวณส่วนลด/แต้มฝั่ง client — เศษปัดอาจต่างจาก server เล็กน้อย)
 */
export const PAYMENT_TOLERANCE_SATANG = 100;

/** ยอดที่ลูกค้าต้องจ่าย (สตางค์) = ยอดออเดอร์ที่ server คำนวณ + VAT ถ้าร้านเปิด VAT */
export function payableSatang(finalTotalBaht: number, vatEnabled: boolean): number {
  const vat = vatEnabled ? Math.round(finalTotalBaht * VAT_RATE) : 0;
  return Math.round((finalTotalBaht + vat) * 100);
}

/** ยอดขั้นต่ำของ payment ที่ใช้ปิดออเดอร์นี้ได้ — จ่ายขาดเกินส่วนต่างที่ยอมรับไม่ได้ */
export function minimumPaidSatang(finalTotalBaht: number, vatEnabled: boolean): number {
  return Math.max(0, payableSatang(finalTotalBaht, vatEnabled) - PAYMENT_TOLERANCE_SATANG);
}
