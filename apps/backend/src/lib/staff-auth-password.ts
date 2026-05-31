/**
 * รหัสผ่านใน Supabase Auth สำหรับบัญชีพนักงาน (nickname + PIN)
 *
 * Supabase ใช้กฎความแข็งแรงกับ admin.updateUserById แต่มักไม่บังคับกับ admin.createUser
 * (ดู supabase/auth#1959) — PIN สั้นๆ จึงสร้างได้แต่เปลี่ยน PIN ไม่สำเร็จได้
 *
 * เก็บใน Auth เป็น prefix + PIN (ตัวเลข) เพื่อให้ความยาวผ่านนโยบายทั่วไป
 * ล็อกอิน: ลองรูปแบบนี้ก่อน แล้วลอง PIN ตรงๆ (legacy ก่อนมี prefix)
 */
const STAFF_AUTH_PASSWORD_PREFIX = 'nexapos:';

export function staffPasswordForSupabaseAuth(pin: string): string {
  return `${STAFF_AUTH_PASSWORD_PREFIX}${pin}`;
}
