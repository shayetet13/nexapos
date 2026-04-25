/* Shared POS types, constants, and helper functions */

export interface Product {
  id: string;
  name: string;
  price: string;
  sku?: string;
  barcode?: string | null;
  image_url?: string | null;
  category?: string | null;
  unit?: string | null;
}

export interface CartItem {
  product: Product;
  quantity: number;
  note?: string;
}

export interface PosStats {
  dailyTotal: number;
  orderCount: number;
  avgOrder: number;
  topProduct: string;
}

export interface TodayOrder {
  id: string;
  order_number?: number;
  daily_seq?: number;
  receipt_token?: string;
  status: string;
  total: string;
  payment_method: string | null;
  created_at: string;
}

export interface OrderDetailItem {
  id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: string;
  subtotal: string;
  note?: string | null;
}

export interface OrderDetail extends TodayOrder {
  order_number: number;
  daily_seq: number;
  branch_id: string;
  branch_name: string;
  user_email?: string | null;
  items: OrderDetailItem[];
}

/* ── Shared constants ── */
export const PAY_ICONS: Record<string, string> = {
  cash: '💵', card: '💳', transfer: '📲', other: '···',
};

export const STATUS_STYLES: Record<string, string> = {
  paid: 'pos-today-item__status--paid',
  void: 'pos-today-item__status--void',
  refunded: 'pos-today-item__status--refund',
};

export const STATUS_TH: Record<string, string> = {
  paid: 'ชำระแล้ว', void: 'ยกเลิก', refunded: 'คืนเงิน', pending: 'รอ',
};

/* ── PromptPay EMV QR helpers ── */

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) */
function crc16Ccitt(str: string): number {
  let crc = 0xFFFF;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xFFFF;
    }
  }
  return crc;
}

/** Build EMV TLV string */
function tlv(id: string, value: string): string {
  return id + String(value.length).padStart(2, '0') + value;
}

/** Generate PromptPay EMV QR payload — supports phone and national ID
 *  Includes a random 8-char reference label (EMV field 62.05) to ensure
 *  each display generates a unique QR string even for identical amount/number.
 */
export function generatePromptPayPayload(number: string, amount: number, type: 'phone' | 'id_card' = 'phone'): string {
  const clean = number.replace(/\D/g, ''); // strip dashes/spaces
  // phone → 0066XXXXXXXXX (strip leading 0, prepend country code)
  // id_card → 13-digit number as-is
  const proxy = type === 'id_card' ? clean : '0066' + clean.replace(/^0/, '');
  const accountInfo   = tlv('00', 'A000000677010111') + tlv('01', proxy);
  const amountStr     = amount.toFixed(2);
  // Random 8-char nonce → unique QR per checkout session (banks ignore ref label for payment)
  const nonce         = Math.random().toString(36).slice(2, 10).toUpperCase();
  const additionalData = tlv('05', nonce); // sub-field 05 = Reference Label
  const body =
    tlv('00', '01') +
    tlv('01', '12') +
    tlv('29', accountInfo) +
    tlv('53', '764') +
    tlv('54', amountStr) +
    tlv('58', 'TH') +
    tlv('62', additionalData) +
    '6304';
  const crc = crc16Ccitt(body);
  return body + crc.toString(16).toUpperCase().padStart(4, '0');
}

/* ── Birthday helpers ── */
const BKK_OFFSET_MS = 7 * 3600_000;

export function bkkToday(): { month: number; day: number } {
  const bkk = new Date(Date.now() + BKK_OFFSET_MS);
  return { month: bkk.getUTCMonth() + 1, day: bkk.getUTCDate() };
}

export function isBirthdayToday(birthday: string | null | undefined): boolean {
  if (!birthday || !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) return false;
  const [, m, d] = birthday.split('-').map(Number);
  const today = bkkToday();
  return m === today.month && d === today.day;
}

export function isBirthdayWithin7Days(birthday: string | null | undefined): boolean {
  if (!birthday || !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) return false;
  const [, m, d] = birthday.split('-').map(Number);
  for (let i = 0; i < 7; i++) {
    const t = new Date(Date.now() + BKK_OFFSET_MS + i * 86400000);
    if (m === t.getUTCMonth() + 1 && d === t.getUTCDate()) return true;
  }
  return false;
}

export function formatBirthdayDisplay(birthday: string | null | undefined): string {
  if (!birthday || !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) return '';
  const d = new Date(birthday + 'T12:00:00');
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Persistent popup reference — survives modal open/close while POS is running */
export let _displayWindow: Window | null = null;
export function setDisplayWindow(w: Window | null) { _displayWindow = w; }
