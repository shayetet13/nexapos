/**
 * ตรวจ PromptPay EMV QR payload ที่ได้จาก LINEJS platform ก่อนเก็บ/แสดงให้ลูกค้าสแกน
 * (defense-in-depth: ถ้า platform หรือ base URL ถูกแก้ไข QR ต้องไม่พาเงินลูกค้าไปบัญชีอื่นได้)
 *
 * รูปแบบที่ platform สร้าง: 00 01 | 01 12 | 29{ 00 AID | 01/02/03 target } | 53 764 | 54 amount | 58 TH | 63 CRC16
 */

export type PromptPayIdType = 'phone' | 'national_id' | 'ewallet';

const PROMPTPAY_AID = 'A000000677010111';
const SUBTAG_BY_TYPE: Record<PromptPayIdType, string> = { phone: '01', national_id: '02', ewallet: '03' };

/** แตก TLV ระดับเดียว (id 2 หลัก + ความยาว 2 หลัก + ค่า) — null ถ้ารูปแบบเพี้ยน */
function parseTlv(input: string): Map<string, string> | null {
  const out = new Map<string, string>();
  let i = 0;
  while (i < input.length) {
    if (i + 4 > input.length) return null;
    const id = input.slice(i, i + 2);
    const lenStr = input.slice(i + 2, i + 4);
    if (!/^\d{2}$/.test(id) || !/^\d{2}$/.test(lenStr)) return null;
    const end = i + 4 + Number(lenStr);
    if (end > input.length) return null;
    if (out.has(id)) return null; // tag ซ้ำ = ไม่ใช่ payload ที่เราสร้าง
    out.set(id, input.slice(i + 4, end));
    i = end;
  }
  return out;
}

export function crc16Ccitt(value: string): string {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(value)) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** ค่าที่ต้องปรากฏใน tag 29 ตามประเภท (เบอร์โทร → 0066 + เลข 9 หลักหลังตัด 0 นำหน้า) */
function expectedTarget(type: PromptPayIdType, id: string): string | null {
  const digits = id.replace(/\D/g, '');
  if (type === 'phone') return /^0\d{9}$/.test(digits) ? `0066${digits.slice(1)}` : null;
  if (type === 'national_id') return /^\d{13}$/.test(digits) ? digits : null;
  return /^\d{15}$/.test(digits) ? digits : null;
}

export interface QrExpectation {
  type: PromptPayIdType;
  promptPayId: string;
  amountSatang: number;
}

/** true เมื่อ CRC ถูกต้อง, บัญชีปลายทางตรงกับพร้อมเพย์ของร้าน และยอดตรงกับที่ขอ */
export function verifyPromptPayPayload(payload: string, expected: QrExpectation): boolean {
  if (payload.length < 8 || payload.slice(-8, -4) !== '6304') return false;
  if (crc16Ccitt(payload.slice(0, -4)) !== payload.slice(-4).toUpperCase()) return false;

  const root = parseTlv(payload.slice(0, -8));
  if (!root) return false;

  const account = parseTlv(root.get('29') ?? '');
  const wantTarget = expectedTarget(expected.type, expected.promptPayId);
  if (!account || !wantTarget) return false;
  if (account.get('00') !== PROMPTPAY_AID) return false;
  if (account.get(SUBTAG_BY_TYPE[expected.type]) !== wantTarget) return false;
  // ต้องไม่มี target อื่นปนมา (เช่น เพิ่ม sub-tag ของบัญชีอื่น)
  if (account.size !== 2) return false;

  const amount = root.get('54');
  const wantAmount = `${Math.floor(expected.amountSatang / 100)}.${String(expected.amountSatang % 100).padStart(2, '0')}`;
  return amount === wantAmount && root.get('53') === '764';
}
