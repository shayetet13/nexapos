/**
 * ธีม UI ต่อบัญชีผู้ใช้ (localStorage) — แอดมิน/พนักงานเซฟคนละค่า
 * guest (หน้าเว็บก่อนล็อกอิน) ใช้ key เดิม `nexapos-theme`
 */

export type AppTheme = 'warm' | 'light' | 'ocean';

const LEGACY_GUEST_KEY     = 'nexapos-theme' as const;
const ACTIVE_USER_KEY      = 'nexapos-theme-active-uid' as const;
const THEME_PER_USER      = (userId: string) => `nexapos-theme:u:${userId}` as const;

export const THEME_STORAGE_KEYS = { LEGACY_GUEST_KEY, ACTIVE_USER_KEY, THEME_PER_USER };

const VALID: readonly AppTheme[] = ['warm', 'light', 'ocean'];

function isAppTheme(s: string | null | undefined): s is AppTheme {
  return s === 'warm' || s === 'light' || s === 'ocean';
}

function safeGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSet(key: string, v: string): void {
  try { localStorage.setItem(key, v); } catch { /* Safari private, quota */ }
}
function safeRemove(key: string): void {
  try { localStorage.removeItem(key); } catch { /* */ }
}

/** ใช้เฉพาะ client: user ที่ล็อกอิน ณ ตอนนี้ (ตั้งค่าโดย sync กับ session) */
export function getActiveUserIdFromStorage(): string | null {
  if (typeof window === 'undefined') return null;
  return safeGet(ACTIVE_USER_KEY);
}

export function getPersistedThemeForUserId(userId: string): AppTheme | null {
  if (typeof window === 'undefined') return null;
  const t = safeGet(THEME_PER_USER(userId));
  return isAppTheme(t) ? t : null;
}

export function getGuestThemeFromStorage(): AppTheme | null {
  if (typeof window === 'undefined') return null;
  const t = safeGet(LEGACY_GUEST_KEY);
  return isAppTheme(t) ? t : null;
}

/** บันทึก: ล็อกอิน = ราย user, ยังไม่ล็อกอิน = เก็บ guest สำหรับหน้า landing / login */
export function persistThemeSelection(theme: AppTheme, userId: string | null | undefined): void {
  if (typeof window === 'undefined') return;
  if (userId) safeSet(THEME_PER_USER(userId), theme);
  else safeSet(LEGACY_GUEST_KEY, theme);
}

export function applyThemeToDocument(theme: AppTheme): void {
  if (typeof window === 'undefined') return;
  const root = document.documentElement;
  // Idempotent — ถ้าธีมตรงอยู่แล้วไม่แตะ DOM (กันธีมกระพริบจากการทาซ้ำหลายรอบตอน mount)
  const current = root.getAttribute('data-theme') ?? 'light';
  if (current === theme) return;
  if (theme === 'light') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

/** ค่าเริ่มต้นของเว็บ = ธีมขาว */
export function getDefaultDeviceTheme(): AppTheme {
  return 'light';
}

function applyGuestOrDefault(): void {
  const g = getGuestThemeFromStorage();
  if (g) { applyThemeToDocument(g); return; }
  applyThemeToDocument(getDefaultDeviceTheme());
}

/**
 * เรียกเมื่อ session เปลี่ยน (Supabase onAuthStateChange)
 * ราย user อ่านเฉพาะ key ของ user นี้ (ไม่ดึง guest มา — กัน user อื่นค้างเครื่องเดียว)
 *
 * applyVisual=false → อัปเดตเฉพาะ bookkeeping (ACTIVE_USER_KEY) ไม่แตะธีมบนจอ
 * ใช้กับ INITIAL_SESSION ตอนรีเฟรชหน้า: inline script ใน <head> ทาธีมถูกต้องไปแล้ว
 * การทาซ้ำตรงนี้ (ยิง async หลัง restore session) คือต้นเหตุธีมสลับไปมาบนหน้า login/register
 */
export function syncThemeWithSession(
  userId: string | null | undefined,
  opts: { applyVisual?: boolean } = {},
): void {
  if (typeof window === 'undefined') return;
  const applyVisual = opts.applyVisual !== false;
  if (userId) {
    safeSet(ACTIVE_USER_KEY, userId);
    if (!applyVisual) return;
    const t = getPersistedThemeForUserId(userId);
    if (t) applyThemeToDocument(t);
    else applyThemeToDocument(getDefaultDeviceTheme());
  } else {
    safeRemove(ACTIVE_USER_KEY);
    if (!applyVisual) return;
    applyGuestOrDefault();
  }
}

/** หาธีมที่ UI ต้องแสดง (icon) — อ่านซ้ำกับ document มักตรงกัน หลัง sync */
export function getResolvedCurrentThemeForClient(): AppTheme {
  if (typeof window === 'undefined') return 'light';
  const uid = getActiveUserIdFromStorage();
  if (uid) {
    const t = getPersistedThemeForUserId(uid);
    if (t) return t;
    return getDefaultDeviceTheme();
  }
  const g = getGuestThemeFromStorage();
  if (g) return g;
  return getDefaultDeviceTheme();
}
