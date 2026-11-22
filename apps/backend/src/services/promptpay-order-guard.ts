/**
 * บังคับฝั่ง server: ออเดอร์ POS ที่จ่ายแบบ "transfer" ในร้านที่เปิด PromptPay auto-verify
 * ต้องอ้าง promptpay_payments ที่ตรวจเงินเข้าแล้ว (succeeded), เป็นของร้านนี้, ยังไม่เคยปิดออเดอร์อื่น,
 * และยอดไม่ต่ำกว่ายอดที่ลูกค้าต้องจ่าย — ไม่งั้นแคชเชียร์/client ที่ถูกแก้สามารถบันทึกยอดโอนที่ไม่มีเงินเข้าจริงได้
 *
 * ร้านที่ไม่ได้เปิดใช้ (หรือ platform ยังไม่พร้อม) ไม่ถูกบังคับ — flow เดิมทำงานต่อ
 */
import { audit, logger } from '../lib/audit.js';
import { getPlatformStatus } from '../lib/promptpay-verify-api.js';
import { isVerifyReady, minimumPaidSatang, payableSatang, platformReady } from '../lib/promptpay-verify-logic.js';
import { promptpayVerifyRepository, type PaymentRow } from '../repositories/promptpay-verify.repository.js';

export type PaymentGuardResult =
  | { enforced: false }
  | { enforced: true; ok: true; payment: PaymentRow }
  | { enforced: true; ok: false; code: 'PAYMENT_NOT_VERIFIED'; message: string };

const baht = (satang: number): string => (satang / 100).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function reject(message: string): PaymentGuardResult {
  return { enforced: true, ok: false, code: 'PAYMENT_NOT_VERIFIED', message };
}

export async function claimVerifiedPayment(input: {
  shopId:      string;
  paymentId?:  string;
  /** ยอดออเดอร์ที่ server คำนวณ (หลังส่วนลด ยังไม่รวม VAT) */
  finalTotal:  number;
  vatEnabled:  boolean;
}): Promise<PaymentGuardResult> {
  const { shopId, paymentId, finalTotal, vatEnabled } = input;

  const cfg = await promptpayVerifyRepository.getConfig(shopId);
  if (!isVerifyReady(cfg)) return { enforced: false };
  const platform = await getPlatformStatus();
  if (!platformReady(platform)) {
    // ร้านเปิดใช้แต่ platform ไม่พร้อม (key/URL หาย หรือรูปแบบผิด) → POS ใช้ flow เดิม แต่ต้องมีร่องรอยให้ dev เห็น
    // ไม่งั้นการบังคับถูกปิดเงียบ ๆ ทั้งระบบจากการพิมพ์ env ผิดตัวเดียว
    logger.warn({ shop_id: shopId, ...platform }, 'promptpay guard skipped: platform not configured');
    audit.action({
      event: 'payment_guard_skipped', shop_id: shopId, entity_type: 'shop_promptpay_verify', entity_id: shopId,
      metadata: { reason: 'platform_not_configured', ...platform },
    });
    return { enforced: false };
  }

  if (!paymentId) {
    return reject('ร้านนี้เปิดตรวจสอบ PromptPay อัตโนมัติ — การชำระด้วย QR/โอนต้องมีรายการที่ตรวจเงินเข้าแล้ว');
  }

  const claimed = await promptpayVerifyRepository.claimForOrder(shopId, paymentId, minimumPaidSatang(finalTotal, vatEnabled));
  if (claimed) return { enforced: true, ok: true, payment: claimed };

  // claim ไม่ผ่าน — หาสาเหตุเพื่อบอกแคชเชียร์ (ไม่เปิดเผยรายการของร้านอื่น: getPayment scope shop_id)
  const row = await promptpayVerifyRepository.getPayment(shopId, paymentId);
  if (!row) return reject('ไม่พบรายการชำระเงินที่อ้างถึง');
  if (row.status === 'ambiguous') return reject('ตรวจพบเงินเข้าแต่ยอดไม่ตรงกับรายการ — ตรวจยอดกับธนาคาร แล้วสร้าง QR ใหม่');
  if (row.status === 'expired' || row.status === 'cancelled') return reject('รายการชำระเงินนี้หมดอายุหรือถูกยกเลิกแล้ว — สร้าง QR ใหม่');
  if (row.status !== 'succeeded') return reject('ยังไม่ได้รับเงินสำหรับรายการนี้ (ยังไม่ตรวจพบเงินเข้า)');
  if (row.claimed_at) return reject('รายการชำระเงินนี้ถูกใช้กับออเดอร์อื่นไปแล้ว');
  return reject(`ยอดที่ตรวจพบ ฿${baht(row.amount_satang)} น้อยกว่ายอดที่ต้องชำระ ฿${baht(payableSatang(finalTotal, vatEnabled))}`);
}

/** สร้างออเดอร์ไม่สำเร็จหลัง claim → คืนสิทธิ์ให้ payment */
export async function releasePaymentClaim(shopId: string, paymentId: string): Promise<void> {
  try {
    await promptpayVerifyRepository.releaseClaim(shopId, paymentId);
  } catch (err) {
    // ถ้าปล่อยคืนไม่ได้ payment จะค้างเป็น "ถูกใช้แล้ว" โดยไม่มีออเดอร์ — ต้องมีร่องรอยให้ตามแก้
    logger.error({ shop_id: shopId, payment_id: paymentId, err: err instanceof Error ? err.message : String(err) },
      'promptpay guard: failed to release claim after order creation failure');
  }
}

/** บันทึกว่า payment ปิดออเดอร์ไหน — ล้มเหลวไม่ทำให้ออเดอร์ล้ม (payment ยังถูก claim อยู่ จึงใช้ซ้ำไม่ได้) */
export async function linkPaymentToOrder(shopId: string, paymentId: string, orderId: string): Promise<void> {
  try {
    await promptpayVerifyRepository.linkOrder(shopId, paymentId, orderId);
  } catch (err) {
    logger.error({ shop_id: shopId, payment_id: paymentId, order_id: orderId, err: err instanceof Error ? err.message : String(err) },
      'promptpay guard: failed to link payment to order');
  }
}
