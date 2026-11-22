/**
 * กติกาแลกแต้มเป็นส่วนลด — ใช้ร่วมกันระหว่าง POS (client) และ order service (server)
 * เพื่อให้ยอดที่ลูกค้าจ่ายที่หน้าจอ ตรงกับยอดที่ server บันทึก (ร้านที่ตรวจเงินเข้าอัตโนมัติเทียบสองยอดนี้)
 */

export interface RedemptionConfig {
  redemption_type?: 'points_per_10_baht' | 'baht_per_point';
  /** แต้มต่อ ฿10 (เมื่อ redemption_type = points_per_10_baht; ค่าเริ่มต้น 100) */
  redemption_rate?: number;
  /** บาทต่อ 1 แต้ม (เมื่อ redemption_type = baht_per_point) */
  redemption_baht_per_point?: number;
}

const DEFAULT_POINTS_PER_10_BAHT = 100;

function isBahtPerPoint(config: RedemptionConfig | null | undefined): config is RedemptionConfig & { redemption_baht_per_point: number } {
  return config?.redemption_type === 'baht_per_point' && typeof config.redemption_baht_per_point === 'number';
}

function pointsPer10Baht(config: RedemptionConfig | null | undefined): number {
  const rate = config?.redemption_rate;
  return typeof rate === 'number' && rate > 0 ? rate : DEFAULT_POINTS_PER_10_BAHT;
}

/** ส่วนลด (บาท) จากแต้มที่แลก ตาม membership_config ของร้าน (ไม่มี config = 100 แต้ม ต่อ ฿10) */
export function pointsToDiscountFromConfig(points: number, config?: RedemptionConfig | null): number {
  if (isBahtPerPoint(config)) return Math.floor(points * config.redemption_baht_per_point * 100) / 100;
  return Math.floor(points / pointsPer10Baht(config)) * 10;
}

/** แต้มสูงสุดที่แลกได้ในครั้งเดียว — ไม่มีเศษเกินหน่วยแลก (เช่น rate 200: มี 450 แต้ม แลกได้ 400) */
export function maxRedeemablePoints(points: number, config?: RedemptionConfig | null): number {
  const whole = Math.max(0, Math.floor(points));
  if (isBahtPerPoint(config)) return whole;
  const rate = pointsPer10Baht(config);
  return Math.floor(whole / rate) * rate;
}
