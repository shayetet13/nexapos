import { z } from 'zod';

/** Normalize date string to YYYY-MM-DD. Accepts yyyy-mm-dd or dd/mm/yyyy (day/month/year). */
export function normalizeBirthday(value: string | null | undefined): string | undefined {
  if (value == null || typeof value !== 'string') return undefined;
  const s = value.trim();
  if (!s) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const ddmmyyyy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})$/);
  if (ddmmyyyy) {
    const [, d, m, y] = ddmmyyyy;
    let year = parseInt(y!, 10);
    if (year < 100) year += year >= 50 ? 1900 : 2000;
    const month = m!.padStart(2, '0');
    const day = d!.padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return undefined;
}

export const createOrderSchema = z.object({
  branch_id: z.string().uuid(),
  items: z.array(z.object({
    product_id: z.string().uuid(),
    quantity: z.number().int().positive().max(9999),
    note: z.string().max(120).optional(),
  })).min(1).max(100),
  payment_method: z.enum(['cash', 'card', 'transfer', 'other']).optional(),
  customer_id:     z.string().uuid().optional(),
  points_redeemed: z.number().int().min(0).max(100000).optional().default(0),
  discount:        z.number().min(0).max(999999).optional().default(0),
  cash_received:   z.number().positive().optional(),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;

const baseCustomerSchema = z.object({
  name:     z.string().min(1).max(200),
  phone:    z.string().max(20).optional(),
  email:    z.string().email().max(255).optional(),
  birthday: z.string().optional().transform((v) => normalizeBirthday(v)),
  notes:    z.string().max(500).optional(),
});

const birthdayRefine = (d: { birthday?: string }) =>
  !d.birthday || /^\d{4}-\d{2}-\d{2}$/.test(d.birthday);
const birthdayMsg = { message: 'birthday must be YYYY-MM-DD or dd/mm/yyyy', path: ['birthday'] as (string | number)[] };

export const createCustomerSchema = baseCustomerSchema.refine(birthdayRefine, birthdayMsg);

export const updateCustomerSchema = baseCustomerSchema.partial().refine(birthdayRefine, birthdayMsg);

/** Public self-register (no auth) — name + phone + birthday required */
export const publicRegisterSchema = z.object({
  name:     z.string().min(1).max(200),
  phone:    z.string().min(1).max(20),
  birthday: z.string().min(1, 'กรุณากรอกวันเกิด').transform((v) => normalizeBirthday(v)),
}).refine((d) => !!d.birthday && /^\d{4}-\d{2}-\d{2}$/.test(d.birthday), { message: 'birthday must be YYYY-MM-DD or dd/mm/yyyy', path: ['birthday'] });

/** Membership config stored in shops.membership_config */
export const membershipConfigSchema = z.object({
  enabled:                    z.boolean().optional(),
  points_per_10_baht:        z.number().int().min(1).max(100).optional(),
  redemption_rate:           z.number().int().min(10).max(1000).optional(), // points per 10 baht (legacy)
  redemption_type:           z.enum(['points_per_10_baht', 'baht_per_point']).optional(),
  redemption_baht_per_point:  z.number().min(0.01).max(10).optional(), // e.g. 0.1 = 1 point = 0.1 baht
  tier_silver:               z.number().min(0).optional(),
  tier_gold:                 z.number().min(0).optional(),
  birthday_benefit_type:     z.enum(['percent', 'fixed']).optional(),
  birthday_benefit_value:    z.number().min(0).optional(), // percent (1-100) or fixed baht
  birthday_auto_use_points:  z.boolean().optional(),
});

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;

export const loginSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(128),
});

export type LoginInput = z.infer<typeof loginSchema>;

// ─── Staff PIN schemas ────────────────────────────────────────────────────────

/**
 * ชื่อเล่น v2:
 *  - ภาษาไทย [\u0E00-\u0E7F]
 *  - อังกฤษตัวเล็กเท่านั้น [a-z]  (ห้ามตัวใหญ่ A-Z)
 *  - ตัวเลข [0-9]
 *  - underscore _ เท่านั้น (ห้ามเว้นวรรค, -, .)
 */
const NICKNAME_REGEX = /^[\u0E00-\u0E7F_a-z0-9]+$/u;
const NICKNAME_MSG   = 'ชื่อเล่นใช้ได้: ภาษาไทย, อังกฤษตัวเล็ก, ตัวเลข, _ เท่านั้น';
/** PIN: ตัวเลขล้วน 4-13 หลัก */
const pinRegex = /^\d{4,13}$/;

const nicknameField = z.string()
  .min(1, 'กรุณากรอกชื่อเล่น')
  .max(50, 'ชื่อเล่นยาวเกินไป (สูงสุด 50 ตัวอักษร)')
  .regex(NICKNAME_REGEX, NICKNAME_MSG)
  .transform((s) => s.trim().toLowerCase()); // trim + lowercase ก่อนบันทึก/ค้นหาเสมอ

/** สร้าง staff account (admin/owner ใช้สร้างพนักงาน) */
export const createStaffSchema = z.object({
  nickname: nicknameField,
  pin: z.string()
    .regex(pinRegex, 'PIN ต้องเป็นตัวเลข 4-13 หลักเท่านั้น'),
  role: z.enum(['manager', 'cashier', 'viewer'], {
    errorMap: () => ({ message: 'Role ต้องเป็น manager, cashier, หรือ viewer' }),
  }),
  branchId: z.string().uuid('branchId ไม่ถูกต้อง').optional(),
});

/**
 * Login สำหรับพนักงาน (ชื่อเล่น + PIN) — v2 ไม่ต้องระบุ shopId
 * ระบบค้นหาร้าน/สาขาจาก nickname ที่ unique ทั่วทั้ง SaaS platform
 */
export const staffLoginSchema = z.object({
  nickname: z.string().min(1, 'กรุณากรอกชื่อเล่น').max(50)
    .transform((s) => s.trim().toLowerCase()),
  pin: z.string().regex(pinRegex, 'PIN ต้องเป็นตัวเลข 4-13 หลักเท่านั้น'),
});

/** เปลี่ยน PIN พนักงาน */
export const updateStaffPinSchema = z.object({
  pin: z.string().regex(pinRegex, 'PIN ต้องเป็นตัวเลข 4-13 หลักเท่านั้น'),
});

/** เปลี่ยนชื่อเล่นพนักงาน */
export const updateStaffNicknameSchema = z.object({
  nickname: nicknameField,
});

export type CreateStaffInput        = z.infer<typeof createStaffSchema>;
export type StaffLoginInput         = z.infer<typeof staffLoginSchema>;
export type UpdateStaffPinInput     = z.infer<typeof updateStaffPinSchema>;
export type UpdateStaffNicknameInput = z.infer<typeof updateStaffNicknameSchema>;
