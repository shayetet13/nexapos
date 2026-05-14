/**
 * Bitmap raster receipt printer
 *
 * Renders the receipt to an offscreen canvas (with full Sarabun Thai font
 * support, QR code, logo, all metadata) then converts it to ESC/POS
 * `GS v 0` raster image bytes. Bypasses the printer's code-page and Kanji
 * conversion logic entirely — the printer just prints the bitmap.
 *
 * Use this instead of TIS-620/CP874 text encoding when:
 * - Printer firmware uses a non-standard code page (Chinese clones)
 * - You need Thai + emoji + logo + QR in one ticket
 * - Output must match the web receipt visually
 */

import { API_URL } from './config';

export interface ReceiptItem {
  id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: string;
  subtotal: string;
  note?: string | null;
}

export interface ReceiptData {
  order_id: string;
  order_number: number;
  daily_seq: number;
  receipt_token: string;
  status: string;
  total: string;
  payment_method: string | null;
  created_at: string;
  branch_id: string;
  branch_name: string;
  branch_address: string | null;
  shop_id: string;
  shop_name: string;
  shop_logo_url: string | null;
  vat_enabled: boolean;
  discount: string | null;
  cash_received: string | null;
  points_earned: number;
  points_redeemed: number;
  staff_name: string;
  items: ReceiptItem[];
  ref_code: string | null;
  shop_phone: string | null;
  shop_tax_id: string | null;
  shop_address: string | null;
  shop_opening_hours: string | null;
  shop_working_days: string | null;
  shop_google_review_url: string | null;
}

const PAYMENT_LABELS: Record<string, string> = {
  cash: 'เงินสด',
  card: 'บัตรเครดิต',
  transfer: 'โอนเงิน',
  qr: 'QR Code',
  other: 'อื่นๆ',
};

const fmt = (n: number | string) =>
  Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = (d: string) =>
  new Date(d).toLocaleString('th-TH', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
    calendar: 'buddhist',
  });

export async function fetchReceipt(token: string): Promise<ReceiptData> {
  const res = await fetch(`${API_URL}/api/v1/public/receipts/${token}`);
  if (!res.ok) throw new Error('Receipt fetch failed');
  const j = await res.json() as { data?: ReceiptData };
  if (!j.data) throw new Error('Receipt empty');
  return j.data;
}

/**
 * Word-wrap text to fit a given pixel width using ctx.measureText.
 * Returns an array of lines.
 */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const rawLine of text.split('\n')) {
    const words = rawLine.split(/(\s+)/);
    let cur = '';
    for (const w of words) {
      const next = cur + w;
      if (ctx.measureText(next).width > maxWidth && cur.trim()) {
        lines.push(cur.trimEnd());
        cur = w.trimStart();
      } else {
        cur = next;
      }
    }
    if (cur) lines.push(cur);
    if (!rawLine) lines.push('');
  }
  return lines;
}

/**
 * Generate a QR code as a black-and-white bitmap using the qrcode package.
 * Returns null on failure (caller should skip QR section).
 */
async function makeQrCanvas(text: string, sizePx: number): Promise<HTMLCanvasElement | null> {
  try {
    const QRCode = (await import('qrcode')).default;
    const canvas = document.createElement('canvas');
    await QRCode.toCanvas(canvas, text, {
      width: sizePx,
      margin: 1,
      color: { dark: '#000000', light: '#FFFFFF' },
      errorCorrectionLevel: 'M',
    });
    return canvas;
  } catch {
    return null;
  }
}

/** Load shop logo as Image (with CORS). Returns null on failure. */
function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * Render the receipt onto an offscreen canvas at thermal-printer DPI.
 * Width 384 dots = 48mm @ 203dpi (close to 58mm printable area).
 * Width 576 dots = 72mm @ 203dpi (close to 80mm printable area).
 */
export async function renderReceiptToCanvas(
  data: ReceiptData,
  widthDots: 384 | 576 = 576,
): Promise<HTMLCanvasElement> {
  // Make sure Sarabun is loaded before measuring/drawing
  if (typeof document !== 'undefined' && document.fonts) {
    await document.fonts.load('20px Sarabun');
    await document.fonts.load('bold 26px Sarabun');
    await document.fonts.load('bold 34px Sarabun');
  }

  const W = widthDots;
  const PAD = 8;                  // 8 dots ≈ 1mm padding L/R
  const innerW = W - PAD * 2;

  const FONT = 'Sarabun, Tahoma, "Noto Sans Thai", sans-serif';
  // 58mm (384 dots): smallSize 24px=3mm, fontSize 30px=3.8mm, bigSize 38px=4.8mm
  // 80mm (576 dots): smallSize 28px=3.5mm, fontSize 34px=4.3mm, bigSize 44px=5.5mm
  const fontSize  = widthDots === 384 ? 30 : 34;
  const smallSize = widthDots === 384 ? 24 : 28;
  const bigSize   = widthDots === 384 ? 38 : 44;

  // Two-pass: pass 1 = measure height by simulating draw, pass 2 = actual draw
  const tmp = document.createElement('canvas');
  tmp.width = W;
  const tctx = tmp.getContext('2d')!;
  tctx.textBaseline = 'top';

  type Block =
    | { kind: 'logo'; img: HTMLImageElement; size: number }
    | { kind: 'text'; text: string; font: string; size: number; align: 'left' | 'center' | 'right'; bold?: boolean }
    | { kind: 'row'; left: string; right: string; size: number; bold?: boolean }
    | { kind: 'item'; name: string; qty: number; price: string; subtotal: string; note?: string | null }
    | { kind: 'divider'; style: 'solid' | 'dashed' }
    | { kind: 'spacer'; h: number }
    | { kind: 'qr'; canvas: HTMLCanvasElement; label: string };

  const blocks: Block[] = [];

  // ── Header ──
  if (data.shop_logo_url) {
    const img = await loadImage(data.shop_logo_url);
    if (img) blocks.push({ kind: 'logo', img, size: 80 });
  }
  blocks.push({ kind: 'text', text: data.shop_name, font: FONT, size: bigSize, align: 'center', bold: true });
  if (data.branch_name) blocks.push({ kind: 'text', text: data.branch_name, font: FONT, size: smallSize, align: 'center' });
  if (data.branch_address) blocks.push({ kind: 'text', text: data.branch_address, font: FONT, size: smallSize, align: 'center' });
  if (data.shop_address) blocks.push({ kind: 'text', text: data.shop_address, font: FONT, size: smallSize, align: 'center' });
  if (data.shop_phone) blocks.push({ kind: 'text', text: `โทร: ${data.shop_phone}`, font: FONT, size: smallSize, align: 'center' });
  if (data.shop_tax_id) blocks.push({ kind: 'text', text: `เลขประจำตัวผู้เสียภาษี: ${data.shop_tax_id}`, font: FONT, size: smallSize, align: 'center' });
  if (data.shop_working_days || data.shop_opening_hours) {
    blocks.push({ kind: 'text', text: `${data.shop_working_days ?? ''} ${data.shop_opening_hours ?? ''}`.trim(), font: FONT, size: smallSize, align: 'center' });
  }

  blocks.push({ kind: 'divider', style: 'dashed' });
  blocks.push({ kind: 'text', text: data.vat_enabled ? 'ใบเสร็จรับเงิน / ใบกำกับภาษีอย่างย่อ' : 'ใบเสร็จรับเงิน', font: FONT, size: fontSize, align: 'center', bold: true });
  blocks.push({ kind: 'divider', style: 'dashed' });

  // ── Meta ──
  blocks.push({ kind: 'row', left: 'เลขที่', right: `#${String(data.daily_seq).padStart(4, '0')}`, size: smallSize, bold: true });
  if (data.ref_code) blocks.push({ kind: 'row', left: 'เลขอ้างอิง', right: data.ref_code, size: smallSize });
  blocks.push({ kind: 'row', left: 'วันที่', right: fmtDate(data.created_at), size: smallSize });
  blocks.push({ kind: 'row', left: 'ชำระด้วย', right: PAYMENT_LABELS[data.payment_method ?? 'other'] ?? '—', size: smallSize });
  if (data.staff_name) blocks.push({ kind: 'row', left: 'พนักงาน', right: data.staff_name, size: smallSize });

  blocks.push({ kind: 'divider', style: 'solid' });

  // ── Items ──
  blocks.push({ kind: 'row', left: 'รายการ', right: 'รวม', size: smallSize, bold: true });
  for (const it of data.items) {
    blocks.push({ kind: 'item', name: it.product_name, qty: it.quantity, price: it.unit_price, subtotal: it.subtotal, note: it.note });
  }

  blocks.push({ kind: 'divider', style: 'dashed' });

  // ── Totals ──
  const subBeforeVat = data.vat_enabled ? Number(data.total) / 1.07 : Number(data.total);
  const vatAmt = data.vat_enabled ? Number(data.total) - subBeforeVat : 0;

  if (Number(data.discount) > 0) blocks.push({ kind: 'row', left: 'ส่วนลด', right: `-฿${fmt(data.discount ?? 0)}`, size: smallSize });
  if (data.vat_enabled) {
    blocks.push({ kind: 'row', left: 'ยอดก่อน VAT', right: `฿${fmt(subBeforeVat)}`, size: smallSize });
    blocks.push({ kind: 'row', left: 'VAT 7%', right: `฿${fmt(vatAmt)}`, size: smallSize });
  }
  blocks.push({ kind: 'divider', style: 'solid' });
  blocks.push({ kind: 'row', left: 'ยอดรวมทั้งหมด', right: `฿${fmt(data.total)}`, size: fontSize, bold: true });
  if (data.payment_method === 'cash' && data.cash_received && Number(data.cash_received) > 0) {
    blocks.push({ kind: 'row', left: 'รับเงินสด', right: `฿${fmt(data.cash_received)}`, size: smallSize });
    blocks.push({ kind: 'row', left: 'เงินทอน', right: `฿${fmt(Number(data.cash_received) - Number(data.total))}`, size: smallSize, bold: true });
  }
  if (data.points_redeemed > 0) blocks.push({ kind: 'row', left: 'แต้มที่ใช้', right: `-${data.points_redeemed} แต้ม`, size: smallSize });
  if (data.points_earned > 0)   blocks.push({ kind: 'row', left: 'แต้มที่ได้รับ', right: `+${data.points_earned} แต้ม`, size: smallSize });

  blocks.push({ kind: 'divider', style: 'dashed' });

  // ── QR ──
  const qrUrl = data.shop_google_review_url || `${typeof window !== 'undefined' ? window.location.origin : ''}/receipt/${data.receipt_token}`;
  const qrCanvas = await makeQrCanvas(qrUrl, Math.min(180, innerW - 40));
  if (qrCanvas) {
    blocks.push({ kind: 'text', text: data.shop_google_review_url ? 'สแกนรีวิวร้านค้า' : 'สแกนเพื่อดูใบเสร็จ', font: FONT, size: smallSize, align: 'center' });
    blocks.push({ kind: 'qr', canvas: qrCanvas, label: '' });
  }

  blocks.push({ kind: 'spacer', h: 8 });
  blocks.push({ kind: 'text', text: 'ขอบคุณที่ใช้บริการ', font: FONT, size: fontSize, align: 'center', bold: true });
  blocks.push({ kind: 'spacer', h: 8 });

  // ── Measure pass ──
  const lineHeight = (size: number) => Math.ceil(size * 1.35);
  const measureBlock = (b: Block): number => {
    switch (b.kind) {
      case 'logo':    return b.size + 6;
      case 'spacer':  return b.h;
      case 'divider': return 8;
      case 'qr':      return b.canvas.height + 6;
      case 'text': {
        tctx.font = `${b.bold ? 'bold ' : ''}${b.size}px ${b.font}`;
        const lines = wrap(tctx, b.text, innerW);
        return lines.length * lineHeight(b.size) + 2;
      }
      case 'row': {
        tctx.font = `${b.bold ? 'bold ' : ''}${b.size}px ${FONT}`;
        return lineHeight(b.size) + 2;
      }
      case 'item': {
        tctx.font = `${smallSize}px ${FONT}`;
        const nameLines = wrap(tctx, `${b.name} x${b.qty}`, innerW - 80);
        let h = nameLines.length * lineHeight(smallSize) + 2;
        if (b.note?.trim()) {
          const noteLines = wrap(tctx, `* ${b.note.trim()}`, innerW - 16);
          h += noteLines.length * lineHeight(smallSize - 2);
        }
        return h;
      }
    }
  };

  let totalH = PAD;
  for (const b of blocks) totalH += measureBlock(b);
  totalH += PAD * 2;

  // ── Draw pass ──
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = totalH;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, totalH);
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'top';

  let y = PAD;

  for (const b of blocks) {
    switch (b.kind) {
      case 'logo': {
        const s = b.size;
        ctx.drawImage(b.img, (W - s) / 2, y, s, s);
        y += s + 6;
        break;
      }
      case 'spacer': {
        y += b.h;
        break;
      }
      case 'divider': {
        ctx.strokeStyle = '#000';
        ctx.lineWidth = b.style === 'solid' ? 2 : 1;
        if (b.style === 'dashed') ctx.setLineDash([4, 3]);
        else ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(PAD, y + 4);
        ctx.lineTo(W - PAD, y + 4);
        ctx.stroke();
        ctx.setLineDash([]);
        y += 8;
        break;
      }
      case 'qr': {
        ctx.drawImage(b.canvas, (W - b.canvas.width) / 2, y);
        y += b.canvas.height + 6;
        break;
      }
      case 'text': {
        ctx.font = `${b.bold ? 'bold ' : ''}${b.size}px ${b.font}`;
        const lines = wrap(ctx, b.text, innerW);
        for (const ln of lines) {
          const w = ctx.measureText(ln).width;
          const x = b.align === 'center' ? (W - w) / 2 : b.align === 'right' ? W - PAD - w : PAD;
          ctx.fillText(ln, x, y);
          y += lineHeight(b.size);
        }
        y += 2;
        break;
      }
      case 'row': {
        ctx.font = `${b.bold ? 'bold ' : ''}${b.size}px ${FONT}`;
        const rightW = ctx.measureText(b.right).width;
        ctx.fillText(b.left, PAD, y);
        ctx.fillText(b.right, W - PAD - rightW, y);
        y += lineHeight(b.size) + 2;
        break;
      }
      case 'item': {
        ctx.font = `${smallSize}px ${FONT}`;
        const priceText = `฿${fmt(b.subtotal)}`;
        const priceW = ctx.measureText(priceText).width;
        const nameLines = wrap(ctx, `${b.name} x${b.qty}`, innerW - priceW - 8);
        for (let i = 0; i < nameLines.length; i++) {
          ctx.fillText(nameLines[i], PAD, y);
          if (i === 0) ctx.fillText(priceText, W - PAD - priceW, y);
          y += lineHeight(smallSize);
        }
        if (b.note?.trim()) {
          ctx.font = `italic ${smallSize - 2}px ${FONT}`;
          const noteLines = wrap(ctx, `* ${b.note.trim()}`, innerW - 16);
          for (const ln of noteLines) {
            ctx.fillText(ln, PAD + 8, y);
            y += lineHeight(smallSize - 2);
          }
        }
        y += 2;
        break;
      }
    }
  }

  return canvas;
}

/**
 * Convert canvas to ESC/POS GS v 0 raster image bytes.
 *
 * Packing: 1 bit per pixel, MSB-first, 8 pixels per byte, left-to-right
 * within each row, top-to-bottom rows. Black = 1, white = 0.
 *
 * GS v 0 has a hard 65535-line height limit. Most printers also accept a
 * smaller per-command height — we chunk every 256 rows to stay friendly
 * to small-buffer printers.
 */
export function canvasToEscPosRaster(canvas: HTMLCanvasElement): Uint8Array {
  const ctx = canvas.getContext('2d')!;
  const W = canvas.width;
  const H = canvas.height;
  // Round width up to next multiple of 8 (raster requires whole bytes)
  const padW = (8 - (W % 8)) % 8;
  const fullW = W + padW;
  const wBytes = fullW / 8;

  const img = ctx.getImageData(0, 0, W, H).data;
  // Convert to bitonal: black = 1, white = 0. Use luminance with threshold 160
  // (slightly biased toward black so thin anti-aliased strokes survive on
  // 203-dpi thermal where the dot pitch washes out faint pixels).
  const bits = new Uint8Array(fullW * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const a = img[i + 3];
      // Transparent → white
      const r = a < 128 ? 255 : img[i];
      const g = a < 128 ? 255 : img[i + 1];
      const b = a < 128 ? 255 : img[i + 2];
      const luma = (r * 299 + g * 587 + b * 114) / 1000;
      bits[y * fullW + x] = luma < 160 ? 1 : 0;
    }
    // padding pixels stay 0 (already)
  }

  // Pack all rows into a SINGLE GS v 0 command.
  // Chunking caused printers that only accept one GS v 0 command to print
  // subsequent chunks as raw ASCII garbage. GS v 0 supports up to 65535 rows,
  // which is far more than any receipt needs.
  const out: number[] = [];

  // ESC @ + full Kanji-cancel sequence
  out.push(0x1B, 0x40);
  out.push(0x1B, 0x21, 0x00);
  out.push(0x1C, 0x2E);
  out.push(0x1C, 0x43, 0x00);
  out.push(0x1C, 0x53, 0x00, 0x00);
  out.push(0x1B, 0x52, 0x00);
  // ESC 3 0 — zero inter-line spacing
  out.push(0x1B, 0x33, 0x00);

  // Single GS v 0 covering the entire canvas height
  out.push(0x1D, 0x76, 0x30, 0x00);
  out.push(wBytes & 0xFF, (wBytes >> 8) & 0xFF);
  out.push(H & 0xFF, (H >> 8) & 0xFF);

  for (let y = 0; y < H; y++) {
    const rowBase = y * fullW;
    for (let b = 0; b < wBytes; b++) {
      let byte = 0;
      const bitBase = rowBase + b * 8;
      for (let k = 0; k < 8; k++) {
        if (bits[bitBase + k]) byte |= 1 << (7 - k);
      }
      out.push(byte);
    }
  }

  // Restore default line spacing, feed paper, cut
  out.push(0x1B, 0x32);              // ESC 2  — default line spacing
  out.push(0x0A, 0x0A, 0x0A, 0x0A);  // feed 4 lines so the tear bar clears
  out.push(0x1D, 0x56, 0x41, 0x30);  // GS V A 48 — full cut with feed

  return new Uint8Array(out);
}

/**
 * Top-level: fetch receipt by token, render canvas, convert to ESC/POS bytes.
 */
export async function buildReceiptRasterBytes(
  token: string,
  widthDots: 384 | 576 = 576,
): Promise<Uint8Array> {
  const data = await fetchReceipt(token);
  const canvas = await renderReceiptToCanvas(data, widthDots);
  return canvasToEscPosRaster(canvas);
}
