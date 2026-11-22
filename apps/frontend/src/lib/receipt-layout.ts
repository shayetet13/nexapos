/**
 * Receipt layout config — sizes/spacing for the image-based ESC/POS receipt.
 *
 * DEFAULT_RECEIPT_LAYOUT is the baked-in default (edit these numbers to change the
 * permanent default for all devices). The dev tuning tab writes a per-device override
 * to localStorage so changes take effect immediately; real prints read the merge of
 * DEFAULT + override via loadReceiptLayout().
 */

const LS_KEY = 'pos_receipt_layout';
// เพิ่มเลขนี้เมื่อเปลี่ยนโครงสร้าง/ค่า default — ค่าเก่าที่ผู้ใช้บันทึกไว้จะถูกทิ้งอัตโนมัติ
const LAYOUT_VERSION = 4;

/** Font size + line height for one receipt section (in printer dots / px) */
export interface SectionStyle {
  fs: number; // font size
  lh: number; // line height
}

export interface ReceiptLayout {
  marginTop: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
  showLogo: boolean;
  logoDiameter: number;
  qrSize: number;        // native ESC/POS QR cell size (1–16); also drives preview QR scale
  totalTextGap: number;  // ระยะบล็อกยอดรวม (band) — ดึง "ยอดรวมทั้งหมด" ลง (ตัวหนังสือขยับ)
  totalLineGap: number;  // ตำแหน่งเส้นทึบยอดรวม (อิสระ) — เลื่อนเฉพาะเส้น ไม่ขยับยอดรวม (ลบ=ขึ้น)
  dashGap: number;       // ระยะตัวหนังสือรอบเส้นประ (band) — ดันตัวหนังสือให้ห่างเส้น
  dashOffset: number;    // ตำแหน่งเส้นประ (อิสระ) — เลื่อนเฉพาะเส้นประ ไม่ขยับตัวหนังสือ (ลบ=ขึ้น)
  titleGap: number;      // ระยะว่างบน-ล่างรอบ "ใบเสร็จรับเงิน" (px)
  itemGap: number;       // ระยะจากเส้นใต้หัวตารางถึงออเดอร์แรก (px)
  feedAfter: number;     // ระยะ feed กระดาษก่อนตัด (dots) — น้อย=ประหยัดกระดาษท้าย (8 dots ≈ 1mm)
  shopName: SectionStyle;   // ชื่อร้าน
  sub: SectionStyle;        // สาขา / ที่อยู่ / โทร / เลขภาษี / เวลาทำการ
  title: SectionStyle;      // "ใบเสร็จรับเงิน"
  meta: SectionStyle;       // เลขที่ / วันที่ / ชำระด้วย / พนักงาน / ส่วนลด / VAT / รับเงิน / ทอน
  itemHeader: SectionStyle; // หัวตาราง: รายการ จำนวน ราคา รวม
  item: SectionStyle;       // แถวสินค้า
  total: SectionStyle;      // ยอดรวมทั้งหมด
  footer: SectionStyle;     // ขอบคุณ / NexaPos
}

/** Baked default — tuned to match the web receipt design. Edit here to set the permanent default. */
export const DEFAULT_RECEIPT_LAYOUT: ReceiptLayout = {
  marginTop: 10,
  marginBottom: 12,
  marginLeft: 18,
  marginRight: 18,
  showLogo: true,
  logoDiameter: 120,
  qrSize: 7,
  totalTextGap: 27,
  totalLineGap: 0,
  dashGap: 14,
  dashOffset: -2,
  titleGap: 4,
  itemGap: 20,
  feedAfter: 0,
  shopName:   { fs: 38, lh: 50 },
  sub:        { fs: 20, lh: 30 },
  title:      { fs: 25, lh: 23 },
  meta:       { fs: 19, lh: 38 },
  itemHeader: { fs: 20, lh: 36 },
  item:       { fs: 20, lh: 33 },
  total:      { fs: 24, lh: 45 },
  footer:     { fs: 24, lh: 36 },
};

/** Deep-merge a partial override over the default layout (nested SectionStyle objects merged too). */
function mergeLayout(base: ReceiptLayout, ov: Partial<ReceiptLayout>): ReceiptLayout {
  const sec = (k: keyof ReceiptLayout): SectionStyle => ({
    ...(base[k] as SectionStyle),
    ...((ov[k] as Partial<SectionStyle> | undefined) ?? {}),
  });
  return {
    ...base,
    ...ov,
    shopName:   sec('shopName'),
    sub:        sec('sub'),
    title:      sec('title'),
    meta:       sec('meta'),
    itemHeader: sec('itemHeader'),
    item:       sec('item'),
    total:      sec('total'),
    footer:     sec('footer'),
  };
}

/** Fill any missing fields with defaults — keeps render safe against stale/partial layouts (HMR). */
export function withLayoutDefaults(layout: Partial<ReceiptLayout> | null | undefined): ReceiptLayout {
  return mergeLayout(DEFAULT_RECEIPT_LAYOUT, layout ?? {});
}

/** Load the effective layout: DEFAULT_RECEIPT_LAYOUT merged with the device localStorage override. */
export function loadReceiptLayout(): ReceiptLayout {
  if (typeof localStorage === 'undefined') return DEFAULT_RECEIPT_LAYOUT;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULT_RECEIPT_LAYOUT;
    const parsed = JSON.parse(raw) as Partial<ReceiptLayout> & { _v?: number };
    // ค่าเก่าคนละ version (ก่อนเปลี่ยนระยะ/โครงสร้าง) → ทิ้ง แล้วใช้ default ใหม่
    if (parsed._v !== LAYOUT_VERSION) {
      try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
      return DEFAULT_RECEIPT_LAYOUT;
    }
    return mergeLayout(DEFAULT_RECEIPT_LAYOUT, parsed);
  } catch {
    return DEFAULT_RECEIPT_LAYOUT;
  }
}

/** Persist a full layout as the device override (stamped with the current version). */
export function saveReceiptLayout(layout: ReceiptLayout): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(LS_KEY, JSON.stringify({ ...layout, _v: LAYOUT_VERSION })); } catch { /* ignore */ }
}

/** Remove the device override (revert to baked default). */
export function resetReceiptLayout(): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
}

// ─── Receipt data model (what the renderer consumes) ──────────────────────────

export interface ReceiptLineItem {
  name: string;
  quantity: number;
  unitPrice: number;
  note?: string | null;
}

export interface ReceiptData {
  paperWidth: 32 | 48;           // 58mm(32) → 384 dots, 80mm(48) → 576 dots
  shopName: string;
  branchName?: string | null;
  logoUrl?: string | null;
  phone?: string | null;
  taxId?: string | null;
  address?: string | null;
  openingHours?: string | null;
  workingDays?: string | null;
  googleReviewUrl?: string | null;
  orderNumber: number;
  refCode?: string | null;
  staffNickname?: string | null;
  dateStr?: string;              // pre-formatted; defaults to now in Asia/Bangkok
  paymentMethod?: string | null; // 'cash' | 'card' | 'transfer' | 'qr' | 'other'
  vatEnabled: boolean;
  discount: number;
  subtotal?: number;             // pre-VAT subtotal (optional)
  total: number;
  receivedAmount?: number | null;
  change?: number | null;
  receiptToken?: string | null;
  items: ReceiptLineItem[];
}

/** Mock order for the dev preview — 10 products, 1–3 Thai-word names, prices across magnitudes. */
export const MOCK_RECEIPT_ORDER: ReceiptData = {
  paperWidth: 48,
  shopName: 'CAPYFOOD',
  branchName: 'ดาวอังคาร',
  logoUrl: null,
  phone: '0835519787',
  taxId: '3101900123365',
  address: 'หมู่บ้าน อมรชัย3 ซอย7 แขวงศาลาธรรมสพน์ เขตทวีวัฒนา กรุงเทพ 10170',
  openingHours: '06:00-10:00',
  workingDays: 'จันทร์-อาทิตย์',
  googleReviewUrl: null,
  orderNumber: 9,
  refCode: 'FPOXN12410',
  staffNickname: 'okex7724',
  dateStr: '29 พ.ค. 2569 17:30',
  paymentMethod: 'cash',
  vatEnabled: false,
  discount: 0,
  subtotal: 176,
  total: 176,
  receivedAmount: 176,
  change: 0,
  receiptToken: '00000000-0000-0000-0000-000000000009',
  items: [
    { name: 'น้ำเปล่า', quantity: 1, unitPrice: 7 },
    { name: 'ส้มตำ', quantity: 1, unitPrice: 8 },
    { name: 'หมูกรอบ', quantity: 1, unitPrice: 25 },
    { name: 'สังขยา เล็ก', quantity: 1, unitPrice: 15 },
    { name: 'น้ำเต้าหู้', quantity: 1, unitPrice: 12 },
    { name: 'กาแฟเย็น', quantity: 1, unitPrice: 45 },
    { name: 'ผัดไทยกุ้งสด', quantity: 1, unitPrice: 65 },
    { name: 'ต้มยำกุ้งน้ำข้น', quantity: 1, unitPrice: 120 },
    { name: 'ข้าวมันไก่พิเศษ', quantity: 1, unitPrice: 1250, note: 'ไม่ใส่ผัก' },
    { name: 'เปาะเปี๊ยะ', quantity: 1, unitPrice: 30 },
  ],
};
