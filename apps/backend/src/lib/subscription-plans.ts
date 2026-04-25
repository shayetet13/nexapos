// Plan IDs — keep 'basic' and 'enterprise' as aliases for backward compat with existing DB rows
export type PlanId = 'free' | 'trial' | 'pro' | 'basic' | 'enterprise';

/** จำนวนวันทดลองใช้ฟรี นับจากวันสร้างร้าน */
export const TRIAL_DAYS = 30;

export interface PlanConfig {
  id:            PlanId;
  name:          string;
  price_monthly: number;
  price_yearly:  number;
  max_branches:  number;   // -1 = unlimited
  max_products:  number;   // -1 = unlimited
  features:      string[];
  highlight:     boolean;
  color:         string;
  display:       boolean;  // show in plans grid
}

// ── Features ที่มีในระบบทั้งหมด ────────────────────────────────────────────
// POS
//   pos_basic            — POS ขายหน้าร้านพื้นฐาน
//   pos_full             — POS ครบทุกฟีเจอร์ (โปรโมชัน/ลูกค้า/history)
//   pos_customer_display — จอที่ 2 (Customer Display)
// Receipt
//   receipt_print        — พิมพ์ใบเสร็จ (Bluetooth/WiFi printer)
// Reports
//   reports_basic        — รายงานยอดขาย
//   reports_advanced     — รายงานกำไร/ขาดทุน (P&L) + Export CSV
// Membership
//   membership           — ระบบสมาชิก + สะสมแต้ม
//   birthday_notify      — แจ้งเตือนวันเกิดลูกค้า (In-app)
// Promotions
//   promotions           — โปรโมชัน / ส่วนลด / คอมโบ
// Stock
//   stock_alert          — แจ้งเตือนสต๊อกต่ำ
//   stock_transfer       — โอนสต๊อกระหว่างสาขา
// Branch
//   multi_branch         — หลายสาขา (ไม่จำกัด)
// Dashboard
//   dashboard_analytics  — แดชบอร์ดวิเคราะห์ข้อมูล
// Refund & Security
//   refund_otp           — คืนเงิน + OTP ยืนยัน (Telegram/Email)
// Notification
//   telegram_notify      — แจ้งเตือนผ่าน Telegram Bot (OTP + refund)

/** Features ครบชุดสำหรับแผน Pro */
const PRO_FEATURES = [
  // POS
  'pos_basic',
  'pos_full',
  'pos_customer_display',
  // Receipt
  'receipt_print',
  // Reports
  'reports_basic',
  'reports_advanced',
  // Membership
  'membership',
  'birthday_notify',
  // Promotions
  'promotions',
  // Stock
  'stock_alert',
  'stock_transfer',
  // Branch
  'multi_branch',
  // Dashboard
  'dashboard_analytics',
  // Refund & Security
  'refund_otp',
  // Notification
  'telegram_notify',
] as const;

export const PLAN_CONFIG: Record<PlanId, PlanConfig> = {
  free: {
    id: 'free', name: 'ฟรี',
    price_monthly: 0, price_yearly: 0,
    max_branches: 1, max_products: 30,
    highlight: false, color: '#71717a', display: true,
    // หลัง trial/plan หมดอายุ: เหลือแค่ POS พื้นฐาน + พิมพ์ใบเสร็จ
    features: ['pos_basic', 'receipt_print'],
  },
  trial: {
    id: 'trial', name: 'ทดลองใช้ฟรี',
    price_monthly: 0, price_yearly: 0,
    max_branches: -1, max_products: -1,
    highlight: false, color: '#f59e0b', display: false,
    features: [...PRO_FEATURES],
  },
  pro: {
    id: 'pro', name: 'Pro',
    price_monthly: 299, price_yearly: 2990,
    max_branches: -1, max_products: -1,
    highlight: true, color: '#00d4ff', display: true,
    features: [...PRO_FEATURES],
  },
  // Legacy aliases — same features as pro (backward compat with existing DB rows)
  basic: {
    id: 'basic', name: 'Pro',
    price_monthly: 299, price_yearly: 2990,
    max_branches: -1, max_products: -1,
    highlight: false, color: '#00d4ff', display: false,
    features: [...PRO_FEATURES],
  },
  enterprise: {
    id: 'enterprise', name: 'Pro',
    price_monthly: 299, price_yearly: 2990,
    max_branches: -1, max_products: -1,
    highlight: false, color: '#00d4ff', display: false,
    features: [...PRO_FEATURES],
  },
};

export const FEATURE_LABEL: Record<string, string> = {
  // POS
  pos_basic:            'POS ขายหน้าร้านพื้นฐาน',
  pos_full:             'POS ครบทุกฟีเจอร์',
  pos_customer_display: 'จอที่ 2 (Customer Display)',
  // Receipt
  receipt_print:        'พิมพ์ใบเสร็จ (Bluetooth/WiFi)',
  // Reports
  reports_basic:        'รายงานยอดขาย',
  reports_advanced:     'รายงานกำไร/ขาดทุน (P&L)',
  // Membership
  membership:           'ระบบสมาชิก + สะสมแต้ม',
  birthday_notify:      'แจ้งเตือนวันเกิดลูกค้า',
  // Promotions
  promotions:           'โปรโมชัน / ส่วนลด / คอมโบ',
  // Stock
  stock_alert:          'แจ้งเตือนสต๊อกต่ำ',
  stock_transfer:       'โอนสต๊อกระหว่างสาขา',
  // Branch
  multi_branch:         'หลายสาขา (ไม่จำกัด)',
  // Dashboard
  dashboard_analytics:  'แดชบอร์ดวิเคราะห์ข้อมูล',
  // Refund & Security
  refund_otp:           'คืนเงิน + OTP ยืนยัน',
  // Notification
  telegram_notify:      'แจ้งเตือน Telegram Bot',
};

export function getPlan(planId: string): PlanConfig {
  return PLAN_CONFIG[planId as PlanId] ?? PLAN_CONFIG.free;
}

export function getDisplayPlans(): PlanConfig[] {
  return [PLAN_CONFIG.free, PLAN_CONFIG.pro];
}

/**
 * คำนวณแผนที่ใช้งานจริง (effective plan)
 *
 * Priority:
 *  1. Whitelist → pro (ฟรีตลอด ไม่หมดอายุ)
 *  2. หมดอายุ (trial หรือ paid) → free
 *  3. อื่น ๆ → plan ตามที่บันทึกไว้
 */
export function getEffectivePlanId(
  sub: { plan: string; expires_at: Date | null; is_whitelisted?: boolean } | null,
): string {
  if (!sub) return 'free';
  if (sub.is_whitelisted) return 'pro';
  if (sub.expires_at && sub.expires_at < new Date()) return 'free';
  return sub.plan;
}

export function isSubscriptionActive(sub: { status: string; expires_at: Date | null } | null): boolean {
  if (!sub) return false;
  if (sub.status !== 'active') return false;
  if (sub.expires_at && sub.expires_at < new Date()) return false;
  return true;
}

export function calcExpiresAt(interval: 'monthly' | 'yearly' | 'once', fromDate = new Date()): Date {
  const d = new Date(fromDate);
  if (interval === 'monthly')  d.setMonth(d.getMonth() + 1);
  else if (interval === 'yearly') d.setFullYear(d.getFullYear() + 1);
  else d.setFullYear(d.getFullYear() + 100);
  return d;
}
