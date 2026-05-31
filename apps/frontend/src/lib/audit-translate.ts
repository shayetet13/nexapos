/**
 * audit-translate.ts
 * Pure (no React) helpers for rendering audit log rows in Thai.
 * Used by AuditTab (admin panel) and LogsTab (dev dashboard).
 */

// ─── Base type ────────────────────────────────────────────────────────────────

export interface AuditRowBase {
  event:         string;
  status:        string;
  user_id:       string | null;
  role:          string | null;
  ip_address:    string | null;
  method:        string | null;
  endpoint:      string | null;
  error_message: string | null;
  metadata:      Record<string, unknown>;
  created_at:    string;
}

// ─── Enums / Constants ────────────────────────────────────────────────────────

/** Audit event status values */
export const AuditStatus = {
  SUCCESS: 'success',
  FAIL:    'fail',
  ERROR:   'error',
} as const;
export type AuditStatusValue = typeof AuditStatus[keyof typeof AuditStatus];

/** HTTP methods that represent write operations (meaningful to audit) */
export const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/** Event name treated as a generic API proxy (not a named domain event) */
export const API_CALL_EVENT = 'api_call' as const;

/** Role → Thai display label */
export const ROLE_LABEL: Readonly<Record<string, string>> = {
  owner:   'เจ้าของ',
  manager: 'ผู้จัดการ',
  cashier: 'แคชเชียร์',
  viewer:  'ผู้ดู',
  admin:   'Admin',
  dev:     'Dev',
};

/** Role → Thai full title */
export const ROLE_TITLE: Readonly<Record<string, string>> = {
  owner:   'เจ้าของร้าน',
  manager: 'ผู้จัดการ',
  cashier: 'แคชเชียร์',
  admin:   'Admin',
  dev:     'Dev',
};

/** Role → Tailwind badge color classes */
export const ROLE_COLOR: Readonly<Record<string, string>> = {
  owner:   'bg-orange-500/25 text-orange-300 border-orange-500/40',
  manager: 'bg-blue-500/25 text-blue-300 border-blue-500/40',
  cashier: 'bg-green-500/25 text-green-300 border-green-500/40',
  admin:   'bg-rose-500/25 text-rose-300 border-rose-500/40',
  dev:     'bg-purple-500/25 text-purple-300 border-purple-500/40',
};

/** Audit status → Thai label */
export const STATUS_LABEL: Readonly<Record<string, string>> = {
  [AuditStatus.SUCCESS]: 'สำเร็จ',
  [AuditStatus.FAIL]:    'ไม่สำเร็จ',
  [AuditStatus.ERROR]:   'เกิดข้อผิดพลาด',
};

/** Payment method → Thai + emoji label */
export const PAYMENT_LABEL: Readonly<Record<string, string>> = {
  cash:      '💵 เงินสด',
  qr:        '📱 QR พร้อมเพย์',
  card:      '💳 บัตรเครดิต/เดบิต',
  transfer:  '🏦 โอนเงิน',
  promptpay: '📱 PromptPay',
  other:     '💼 อื่นๆ',
};

// ─── Endpoint rules ───────────────────────────────────────────────────────────

interface EndpointRule {
  readonly method:  string | RegExp;
  readonly pattern: RegExp;
  readonly label:   string;
}

/** Ordered list of endpoint pattern → Thai label mappings.
 *  More specific patterns must come before generic ones. */
const ENDPOINT_RULES: readonly EndpointRule[] = [
  // Auth
  { method: 'POST',      pattern: /\/auth\/login/,                    label: 'เข้าสู่ระบบ' },
  { method: 'POST',      pattern: /\/auth\/logout/,                   label: 'ออกจากระบบ' },
  { method: 'POST',      pattern: /\/auth\/register/,                 label: 'สมัครสมาชิก' },
  { method: 'POST',      pattern: /\/auth\/forgot-password/,          label: 'ขอรีเซ็ตรหัสผ่าน' },
  { method: 'POST',      pattern: /\/auth\/set-new-password/,         label: 'ตั้งรหัสผ่านใหม่' },
  // Products
  { method: 'POST',      pattern: /\/products$/,                      label: 'เพิ่มสินค้าใหม่' },
  { method: /PATCH|PUT/, pattern: /\/products\//,                     label: 'แก้ไขข้อมูลสินค้า' },
  { method: 'DELETE',    pattern: /\/products\//,                     label: 'ลบสินค้า' },
  { method: 'GET',       pattern: /\/products$/,                      label: 'ดูรายการสินค้า' },
  // Stock
  { method: /PUT|PATCH/, pattern: /\/stock/,                          label: 'อัปเดตสต็อกสินค้า' },
  { method: 'POST',      pattern: /transfer-stock/,                   label: 'โอนสต็อกระหว่างสาขา' },
  // Orders (specific → generic)
  { method: 'POST',      pattern: /\/orders$/,                        label: 'สร้างออเดอร์ใหม่' },
  { method: /PATCH|PUT/, pattern: /\/orders\/.*\/void/,               label: 'ยกเลิกออเดอร์' },
  { method: /PATCH|PUT/, pattern: /\/orders\/.*\/refund/,             label: 'คืนเงินออเดอร์' },
  { method: /PATCH|PUT/, pattern: /\/orders\//,                       label: 'แก้ไขสถานะออเดอร์' },
  { method: 'DELETE',    pattern: /\/orders\//,                       label: 'ลบออเดอร์' },
  { method: 'GET',       pattern: /\/orders\/today/,                  label: 'ดูออเดอร์วันนี้' },
  { method: 'GET',       pattern: /\/orders$/,                        label: 'ดูรายการออเดอร์' },
  // Customers
  { method: 'POST',      pattern: /\/customers$/,                     label: 'เพิ่มลูกค้าใหม่' },
  { method: /PATCH|PUT/, pattern: /\/customers\//,                    label: 'แก้ไขข้อมูลลูกค้า' },
  { method: 'DELETE',    pattern: /\/customers\//,                    label: 'ลบลูกค้า' },
  // Notifications
  { method: 'DELETE',    pattern: /\/notifications\//,                label: 'ลบการแจ้งเตือน' },
  { method: 'PATCH',     pattern: /\/notifications\/.*\/read/,        label: 'อ่านการแจ้งเตือน' },
  { method: 'PATCH',     pattern: /\/notifications\/read-all/,        label: 'อ่านการแจ้งเตือนทั้งหมด' },
  // Promotions
  { method: 'POST',      pattern: /\/promotions$/,                    label: 'สร้างโปรโมชันใหม่' },
  { method: /PATCH|PUT/, pattern: /\/promotions\//,                   label: 'แก้ไขโปรโมชัน' },
  { method: 'DELETE',    pattern: /\/promotions\//,                   label: 'ลบโปรโมชัน' },
  // Shops / Branches
  { method: 'POST',      pattern: /\/shops$/,                         label: 'สร้างร้านค้าใหม่' },
  { method: /PATCH|PUT/, pattern: /\/shops\//,                        label: 'แก้ไขข้อมูลร้านค้า' },
  { method: 'POST',      pattern: /\/branches$/,                      label: 'เพิ่มสาขาใหม่' },
  { method: /PATCH|PUT/, pattern: /\/branches\//,                     label: 'แก้ไขข้อมูลสาขา' },
  { method: 'DELETE',    pattern: /\/branches\//,                     label: 'ลบสาขา' },
  // Staff / Users
  { method: 'POST',      pattern: /\/users$/,                         label: 'เพิ่มผู้ใช้งาน' },
  { method: 'DELETE',    pattern: /\/users\//,                        label: 'ลบผู้ใช้งาน' },
  { method: /PATCH|PUT/, pattern: /\/users\//,                        label: 'แก้ไขสิทธิ์ผู้ใช้งาน' },
  // Withdrawals / Consumables
  { method: 'POST',      pattern: /\/withdrawals$/,                   label: 'บันทึกการเบิกจ่าย' },
  { method: 'POST',      pattern: /\/consumables$/,                   label: 'เพิ่มวัสดุสิ้นเปลือง' },
  { method: /PATCH|PUT/, pattern: /\/consumables\//,                  label: 'แก้ไขวัสดุสิ้นเปลือง' },
  { method: 'DELETE',    pattern: /\/consumables\//,                  label: 'ลบวัสดุสิ้นเปลือง' },
  // Units
  { method: 'POST',      pattern: /\/units$/,                         label: 'เพิ่มหน่วยนับ' },
  { method: /PATCH|PUT/, pattern: /\/units\//,                        label: 'แก้ไขหน่วยนับ' },
  { method: 'DELETE',    pattern: /\/units\//,                        label: 'ลบหน่วยนับ' },
  // Reports / Subscription / QR
  { method: 'GET',       pattern: /\/reports/,                        label: 'ดูรายงาน' },
  { method: 'POST',      pattern: /\/subscription/,                   label: 'อัปเดต Subscription' },
  { method: 'POST',      pattern: /\/staff-qr/,                       label: 'สร้าง QR พนักงาน' },
  { method: 'DELETE',    pattern: /\/staff-qr/,                       label: 'ลบ QR พนักงาน' },
  { method: 'POST',      pattern: /\/qr-session/,                     label: 'เริ่มเซสชัน QR' },
  { method: /PATCH|PUT/, pattern: /\/qr-session/,                     label: 'อัปเดตสถานะ QR' },
  { method: 'GET',       pattern: /\/receipts\//,                     label: 'ดูใบเสร็จ' },
] as const;

/** Path segment → Thai resource name (used as humanize fallback) */
const RESOURCE_NAME: Readonly<Record<string, string>> = {
  orders:        'ออเดอร์',
  products:      'สินค้า',
  customers:     'ลูกค้า',
  shops:         'ร้านค้า',
  branches:      'สาขา',
  users:         'ผู้ใช้',
  staff:         'พนักงาน',
  promotions:    'โปรโมชัน',
  notifications: 'การแจ้งเตือน',
  stock:         'สต็อก',
  reports:       'รายงาน',
  subscription:  'Subscription',
  consumables:   'วัสดุสิ้นเปลือง',
  withdrawals:   'การเบิกจ่าย',
  units:         'หน่วยนับ',
  receipts:      'ใบเสร็จ',
  settings:      'ตั้งค่า',
};

/** HTTP method → Thai verb prefix */
const METHOD_VERB: Readonly<Record<string, string>> = {
  POST: 'เพิ่ม', PATCH: 'แก้ไข', PUT: 'แก้ไข', DELETE: 'ลบ', GET: 'ดู',
};

// ─── Private helpers ──────────────────────────────────────────────────────────

/** Extract a string/number value from audit row metadata by key. */
function metaStr(row: AuditRowBase, key: string): string {
  const v = row.metadata?.[key];
  return typeof v === 'string' || typeof v === 'number' ? String(v) : '';
}

/** Wrap a non-empty string in Thai quotation marks for descriptions. */
function quoted(v: string): string {
  return v ? ` "${v}"` : '';
}

/** Convert a raw endpoint + method into a human-readable Thai fallback label. */
function humanizeEndpoint(method: string, endpoint: string): string {
  const clean = endpoint
    .replace(/\/[0-9a-f-]{36}/g, '') // strip UUIDs
    .replace(/\/api\/v1/, '')
    .replace(/\/$/, '')
    || endpoint;

  const verb = METHOD_VERB[method] ?? method;
  const lastSegment = clean.split('/').filter(Boolean).pop() ?? '';
  const resource = RESOURCE_NAME[lastSegment] ?? lastSegment;
  return resource ? `${verb}${resource}` : `${verb} (${clean})`;
}

/** Translate an `api_call` event into Thai using endpoint pattern matching. */
function translateApiCall(method: string | null, endpoint: string | null): string {
  if (!method || !endpoint) return 'เรียกใช้ระบบ';
  const m  = method.toUpperCase();
  const ep = endpoint.replace('/api/v1', '');

  for (const rule of ENDPOINT_RULES) {
    const methodMatch = typeof rule.method === 'string'
      ? rule.method === m
      : rule.method.test(m);
    if (methodMatch && rule.pattern.test(ep)) return rule.label;
  }
  return humanizeEndpoint(m, ep);
}

// ─── Event description map ────────────────────────────────────────────────────

type EventDescFn = (row: AuditRowBase) => string;

const EVENT_DESC: Readonly<Record<string, EventDescFn>> = {
  // Auth
  login:              ()  => 'เข้าสู่ระบบ',
  logout:             ()  => 'ออกจากระบบ',
  login_failed:       (r) => `เข้าสู่ระบบไม่สำเร็จ${metaStr(r, 'email') ? ` (${metaStr(r, 'email')})` : ''}`,

  // Products
  create_product:     (r) => `เพิ่มสินค้า${quoted(metaStr(r, 'name'))}`,
  update_product:     (r) => `แก้ไขสินค้า${quoted(metaStr(r, 'name'))}`,
  delete_product:     (r) => `ลบสินค้า${quoted(metaStr(r, 'name'))}`,

  // Orders — enriched with ref_code, daily_seq, staff_email
  create_order: (r) => {
    const total = metaStr(r, 'total');
    const ref   = metaStr(r, 'ref_code');
    const seq   = metaStr(r, 'daily_seq');
    const staff = metaStr(r, 'staff_email');
    const parts: string[] = [];
    if (seq)   parts.push(`#${seq}`);
    if (ref)   parts.push(`[${ref}]`);
    if (total) parts.push(`฿${Number(total).toLocaleString('th-TH')}`);
    if (staff) parts.push(`— ${staff.split('@')[0]}`);
    return `ขาย${parts.length ? ' ' + parts.join(' ') : ''}`;
  },
  update_order: (r) => {
    const ref = metaStr(r, 'ref_code');
    return `อัปเดตออเดอร์${ref ? ` [${ref}]` : ''}${quoted(metaStr(r, 'status'))}`;
  },
  void_order:   (r) => {
    const ref = metaStr(r, 'ref_code');
    return `ยกเลิกออเดอร์${ref ? ` [${ref}]` : ''}`;
  },
  delete_order: (r) => {
    const ref = metaStr(r, 'ref_code');
    return `ลบออเดอร์${ref ? ` [${ref}]` : ''}`;
  },

  // Customers
  create_customer:  (r) => `เพิ่มลูกค้า${quoted(metaStr(r, 'name'))}`,
  update_customer:  (r) => `แก้ไขข้อมูลลูกค้า${quoted(metaStr(r, 'name'))}`,
  delete_customer:  ()  => 'ลบลูกค้า',

  // Promotions
  create_promotion: (r) => `สร้างโปรโมชัน${quoted(metaStr(r, 'name'))}`,
  update_promotion: (r) => `แก้ไขโปรโมชัน${quoted(metaStr(r, 'name'))}`,
  delete_promotion: (r) => `ลบโปรโมชัน${quoted(metaStr(r, 'name'))}`,

  // Categories / Units
  create_category:  (r) => `เพิ่มหมวดหมู่${quoted(metaStr(r, 'name'))}`,
  update_category:  (r) => `แก้ไขหมวดหมู่${quoted(metaStr(r, 'name'))}`,
  delete_category:  (r) => `ลบหมวดหมู่${quoted(metaStr(r, 'name'))}`,
  create_unit:      (r) => `เพิ่มหน่วยนับ${quoted(metaStr(r, 'name'))}`,
  update_unit:      (r) => `แก้ไขหน่วยนับ${quoted(metaStr(r, 'name'))}`,
  delete_unit:      (r) => `ลบหน่วยนับ${quoted(metaStr(r, 'name'))}`,

  // Consumables / Withdrawals
  create_consumable: (r) => `เพิ่มวัสดุสิ้นเปลือง${quoted(metaStr(r, 'name'))}`,
  update_consumable: (r) => `แก้ไขวัสดุสิ้นเปลือง${quoted(metaStr(r, 'name'))}`,
  delete_consumable: (r) => `ลบวัสดุสิ้นเปลือง${quoted(metaStr(r, 'name'))}`,
  create_withdrawal: ()  => 'บันทึกการเบิกจ่าย',

  // Staff / QR
  create_staff_qr: () => 'สร้าง QR พนักงาน',
  delete_staff_qr: () => 'ลบ QR พนักงาน',

  // Shop / Settings
  update_shop:  (r) => `แก้ไขข้อมูลร้าน${quoted(metaStr(r, 'name'))}`,
  create_shop:  (r) => `สร้างร้านใหม่${quoted(metaStr(r, 'name'))}`,

  // Subscription
  update_subscription: () => 'อัปเดต subscription',

  // Admin
  admin_action: (r) => {
    const action = metaStr(r, 'action') || metaStr(r, 'reason');
    return `ดำเนินการ admin${action ? `: ${action}` : ''}`;
  },

  // Frontend client events
  page_view:     (r) => `เปิดหน้า${metaStr(r, 'path') ? ` ${metaStr(r, 'path')}` : ''}`,
  client_action: (r) => `การกระทำ: ${metaStr(r, 'action') || metaStr(r, 'label') || 'ไม่ระบุ'}`,
  client_error:  (r) => {
    const msg = r.error_message || metaStr(r, 'message') || metaStr(r, 'error') || 'ไม่ทราบสาเหตุ';
    return `เกิดข้อผิดพลาด: ${msg.slice(0, 60)}`;
  },

  // Generic API call — translate via endpoint rules
  [API_CALL_EVENT]: (r) => translateApiCall(r.method, r.endpoint),
};

// ─── Icon / color maps ────────────────────────────────────────────────────────

type PatternEntry = readonly [RegExp, string];

const EVENT_ICON_MAP: readonly PatternEntry[] = [
  [/login_failed|client_error|error/, '❌'],
  [/login/,                           '🔐'],
  [/logout/,                          '🚪'],
  [/delete|void/,                     '🗑️'],
  [/create_order|update_order/,       '🛍️'],
  [/create_product|update_product/,   '📦'],
  [/create_customer|update_customer/, '👤'],
  [/create_promotion|update_promotion/,'🎁'],
  [/create_category|update_category/, '🏷️'],
  [/create_shop|update_shop/,         '🏪'],
  [/subscription/,                    '💳'],
  [/withdrawal|consumable/,           '📋'],
  [/staff_qr/,                        '📲'],
  [/admin_action/,                    '⚙️'],
  [/page_view/,                       '👁️'],
  [/client_action/,                   '🖱️'],
  [/api_call/,                        '🔁'],
] as const;

const EVENT_COLOR_MAP: readonly PatternEntry[] = [
  [/login_failed|client_error|error|delete|void/, 'bg-red-500/20 text-red-400'],
  [/login|logout/,                                'bg-purple-500/20 text-purple-400'],
  [/create/,                                      'bg-blue-500/20 text-blue-400'],
  [/update/,                                      'bg-amber-500/20 text-amber-400'],
  [/order/,                                       'bg-emerald-500/20 text-emerald-400'],
  [/page_view|client_action/,                     'bg-slate-500/20 text-slate-400'],
  [/api_call/,                                    'bg-slate-500/20 text-slate-400'],
] as const;

// ─── Exported functions ───────────────────────────────────────────────────────

/**
 * Convert an audit row into a human-readable Thai description string.
 * Falls back to humanising the snake_case event name if no specific rule exists.
 */
export function describeEvent(row: AuditRowBase): string {
  const fn = EVENT_DESC[row.event];
  if (fn) return fn(row);
  return row.event.replace(/_/g, ' ');
}

/**
 * Return the emoji icon for an audit event.
 * For `api_call` events the method and endpoint are used to pick a more specific icon.
 */
export function eventIcon(
  event: string,
  method?: string | null,
  endpoint?: string | null,
): string {
  if (event === API_CALL_EVENT && method) {
    const m  = method.toUpperCase();
    const ep = endpoint ?? '';
    if (m === 'DELETE')                              return '🗑️';
    if (m === 'POST' && /\/orders/.test(ep))         return '🛍️';
    if (m === 'POST' && /\/products/.test(ep))       return '📦';
    if (m === 'POST' && /\/customers/.test(ep))      return '👤';
    if (m === 'POST' && /\/promotions/.test(ep))     return '🎁';
    if (m === 'POST' && /\/auth\/login/.test(ep))    return '🔐';
    if (/PATCH|PUT/.test(m))                         return '✏️';
    if (m === 'POST')                                return '➕';
    return '🔁';
  }
  for (const [re, icon] of EVENT_ICON_MAP) {
    if (re.test(event)) return icon;
  }
  return '📝';
}

/**
 * Return Tailwind CSS classes for the icon background circle of an audit event.
 * For `api_call` events the HTTP method determines the color.
 */
export function eventIconBg(
  event: string,
  method?: string | null,
  endpoint?: string | null,
): string {
  if (event === API_CALL_EVENT && method) {
    const m  = method.toUpperCase();
    if (m === 'DELETE')                                           return 'bg-red-500/20 text-red-400';
    if (/PATCH|PUT/.test(m))                                      return 'bg-amber-500/20 text-amber-400';
    if (m === 'POST')                                             return 'bg-blue-500/20 text-blue-400';
    if (m === 'GET' && endpoint?.includes('/orders'))             return 'bg-emerald-500/20 text-emerald-400';
    return 'bg-slate-500/20 text-slate-400';
  }
  for (const [re, cls] of EVENT_COLOR_MAP) {
    if (re.test(event)) return cls;
  }
  return 'bg-sky-500/20 text-sky-400';
}

/**
 * Return a short actor label for the feed row pill.
 * Prefers role label → first 4 chars of user ID → 'ระบบ'.
 */
export function actorLabel(userId: string | null, role: string | null): string {
  if (role && ROLE_LABEL[role]) return ROLE_LABEL[role];
  if (!userId) return 'ระบบ';
  return userId.slice(0, 4).toUpperCase();
}

/**
 * Return Tailwind CSS badge color classes for a given role.
 * Falls back to a neutral slate style if the role is unknown.
 */
export function actorColorClass(role: string | null | undefined): string {
  if (role && ROLE_COLOR[role]) return ROLE_COLOR[role];
  return 'bg-slate-500/25 text-slate-300 border-slate-500/40';
}

/**
 * Return a human-readable relative time string in Thai.
 * Example: "5 นาทีที่แล้ว", "เมื่อวาน"
 */
export function relativeTime(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins   = Math.floor(diffMs / 60_000);
  if (mins < 1)   return 'เมื่อกี้';
  if (mins < 60)  return `${mins} นาทีที่แล้ว`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return `${hrs} ชั่วโมงที่แล้ว`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'เมื่อวาน';
  return `${days} วันที่แล้ว`;
}

/**
 * Returns `true` for audit events that are meaningful to display in the admin feed.
 * Filters out read-only `api_call` GET requests which are noise.
 */
export function isSignificantEvent(event: string, method: string | null): boolean {
  if (event !== API_CALL_EVENT) return true;
  return WRITE_METHODS.has((method ?? '').toUpperCase());
}

/**
 * Return Tailwind CSS class for the status indicator dot colour.
 */
export function statusDotClass(status: string): string {
  if (status === AuditStatus.SUCCESS) return 'bg-emerald-400';
  if (status === AuditStatus.ERROR)   return 'bg-red-400';
  return 'bg-yellow-400';
}

/**
 * Return Tailwind CSS class for the status text colour.
 */
export function statusTextClass(status: string): string {
  if (status === AuditStatus.SUCCESS) return 'text-emerald-400';
  if (status === AuditStatus.ERROR)   return 'text-red-400';
  return 'text-yellow-400';
}
