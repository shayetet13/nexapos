/**
 * Receipt renderer — draws the receipt to a Canvas (full Thai support, no code-page
 * dependency) then converts to ESC/POS raster bytes (GS v 0).
 *
 * Single render pass with auto-crop: content is drawn onto an oversized canvas while
 * tracking `y`, then cropped to the exact content height. This removes the dual-pass
 * height/render mismatch that caused overlapping text.
 *
 * Print output = body image  →  ESC a 1 (center) → native QR (GS ( k) → ESC a 0
 *             →  footer image →  feed + cut.
 */

import { withLayoutDefaults, type ReceiptData, type ReceiptLayout } from './receipt-layout';

const FONT = "'Sarabun', 'Noto Sans Thai', sans-serif";
// MAXH: ความสูงสูงสุดของ canvas กันชน (dots/px)
// 80mm @ 203dpi ≈ 640px; ใช้ 3000 รองรับใบเสร็จยาวมาก ประหยัด RAM vs เดิม 8000 (~18MB/canvas)
const MAXH = 3000;

const PAYMENT_TH: Record<string, string> = {
  cash: 'เงินสด', card: 'บัตรเครดิต', transfer: 'โอนเงิน', qr: 'QR Code', other: 'อื่นๆ',
};

// ราคาแบบไม่มีทศนิยม .00 (มี , คั่นหลักพัน) — เช่น 10, 1,250 ; แสดงเศษเฉพาะถ้ามีจริง
const money = (n: number): string =>
  n.toLocaleString('en-US', { maximumFractionDigits: 2 });

function dots(data: ReceiptData): number {
  return data.paperWidth === 32 ? 384 : 576;
}

async function loadImage(url: string): Promise<HTMLImageElement | null> {
  try {
    return await new Promise<HTMLImageElement>((res, rej) => {
      const img = new window.Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = url;
      setTimeout(() => rej(new Error('timeout')), 3000);
    });
  } catch {
    return null;
  }
}

/** Wrap a string to lines that fit maxW with the ctx's current font. */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  if (ctx.measureText(text).width <= maxW) return [text];
  let cur = '';
  const out: string[] = [];
  for (const ch of text) {
    if (ctx.measureText(cur + ch).width > maxW && cur) { out.push(cur); cur = ch; }
    else cur += ch;
  }
  if (cur) out.push(cur);
  return out.length ? out : [text];
}

/** Render a block via a draw callback onto an oversized canvas, then crop to content height. */
function renderBlock(width: number, draw: (ctx: CanvasRenderingContext2D) => number): HTMLCanvasElement {
  const big = document.createElement('canvas');
  big.width = width; big.height = MAXH;
  const ctx = big.getContext('2d')!;
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, MAXH);
  ctx.textBaseline = 'top';
  const finalY = Math.max(1, Math.ceil(draw(ctx)));
  const out = document.createElement('canvas');
  out.width = width; out.height = finalY;
  const octx = out.getContext('2d')!;
  octx.fillStyle = '#ffffff'; octx.fillRect(0, 0, width, finalY);
  octx.drawImage(big, 0, 0, width, finalY, 0, 0, width, finalY);
  return out;
}

// ─── Body ─────────────────────────────────────────────────────────────────────

function drawBody(
  ctx: CanvasRenderingContext2D,
  data: ReceiptData,
  layout: ReceiptLayout,
  DOTS: number,
  logo: HTMLImageElement | null,
  qrUrl: string | null,
): number {
  const L = layout.marginLeft;
  const R = DOTS - layout.marginRight;
  const contentW = R - L;
  let y = layout.marginTop;

  const cen = (text: string, fs: number, lh: number, bold = false, color = '#000') => {
    ctx.font = `${bold ? '700 ' : ''}${fs}px ${FONT}`;
    ctx.textAlign = 'center'; ctx.fillStyle = color;
    ctx.fillText(text, DOTS / 2, y);
    y += lh;
  };
  const cenWrap = (text: string, s: { fs: number; lh: number }, bold = false, color = '#000') => {
    ctx.font = `${bold ? '700 ' : ''}${s.fs}px ${FONT}`;
    for (const ln of wrapText(ctx, text, contentW)) cen(ln, s.fs, s.lh, bold, color);
  };
  const metaRow = (label: string, value: string, valueBold = true, valueColor = '#000') => {
    const s = layout.meta;
    ctx.fillStyle = '#000';
    ctx.font = `${s.fs}px ${FONT}`;
    ctx.textAlign = 'left'; ctx.fillText(label, L, y);
    ctx.font = `${valueBold ? '700 ' : ''}${s.fs}px ${FONT}`;
    ctx.fillStyle = valueColor; ctx.textAlign = 'right'; ctx.fillText(value, R, y);
    ctx.fillStyle = '#000';
    y += s.lh;
  };
  const dash = () => {
    // band = พื้นที่คงที่ (ตัวหนังสือบน-ล่างอยู่กับที่) ; เส้นประลอยภายในด้วย dashOffset (อิสระ)
    const gap = Math.max(0, layout.dashGap);
    const band = gap * 2 + 2;
    const lineY = y + gap + layout.dashOffset;
    ctx.fillStyle = '#000';
    for (let x = L; x < R; x += 10) ctx.fillRect(x, lineY, 5, 2);
    y += band;                                           // y เลื่อนเท่า band เสมอ — ไม่ขึ้นกับ offset
  };

  // Logo (circle-clipped)
  if (logo) {
    const d = layout.logoDiameter;
    const cx = DOTS / 2;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, y + d / 2, d / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(logo, cx - d / 2, y, d, d);
    ctx.restore();
    y += d + 12;
  }

  // Shop name
  cenWrap(data.shopName.toUpperCase(), layout.shopName, true);
  y += 2;

  // Branch / address / phone / tax / hours
  if (data.branchName) cen(data.branchName, layout.sub.fs, layout.sub.lh, false, '#222');
  if (data.address) cenWrap(data.address, layout.sub, false, '#444');
  if (data.phone) cen(`โทร: ${data.phone}`, layout.sub.fs, layout.sub.lh, false, '#444');
  if (data.taxId) cen(`เลขประจำตัวผู้เสียภาษี: ${data.taxId}`, layout.sub.fs, layout.sub.lh, false, '#444');
  if (data.workingDays || data.openingHours)
    cen([data.workingDays, data.openingHours].filter(Boolean).join(' '), layout.sub.fs, layout.sub.lh, false, '#444');

  dash();

  // Title — มีช่องว่างบน-ล่าง (titleGap) ระหว่างเส้นประ กันหัวข้อติดเส้น
  y += Math.max(0, layout.titleGap);
  cen(data.vatEnabled ? 'ใบเสร็จรับเงิน / ใบกำกับภาษีอย่างย่อ' : 'ใบเสร็จรับเงิน', layout.title.fs, layout.title.lh, true);
  y += Math.max(0, layout.titleGap);

  dash();

  // Meta rows
  const dateStr = data.dateStr ?? new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' });
  metaRow('เลขที่', `#${String(data.orderNumber).padStart(4, '0')}`);
  if (data.refCode) metaRow('เลขอ้างอิง', data.refCode);
  metaRow('วันที่', dateStr);
  if (data.paymentMethod) metaRow('ชำระด้วย', PAYMENT_TH[data.paymentMethod] ?? data.paymentMethod);
  if (data.staffNickname) metaRow('พนักงาน', data.staffNickname);

  dash();

  // Items — 4 columns, all right-aligned at their column right edges
  //
  // ⚠️  DO NOT use ctx.measureText() to size these columns.
  //
  // Reason: Canvas 2D has its own font cache separate from document.fonts. Even after
  // ensureSarabunLoaded() resolves, a fresh canvas may measureText() with the fallback
  // font (Noto Sans Thai / system sans-serif) which is WIDER than Sarabun. The column
  // calculation would make QTY+PRICE+SUB columns too wide → nameW collapses to a few
  // pixels → every product name wraps character-by-character on the printed receipt
  // (while fillText() correctly renders with Sarabun, making dev preview look fine but
  // the actual print come out broken on 2nd+ orders).
  //
  // Fix: fixed proportional widths derived from content width — deterministic, font-
  // agnostic, and matches the visual layout tuned in the dev receipt-tuning tab.
  //
  //   nameW   ≈ 55 %  →  297px @ 80mm (540 content)  |  191px @ 58mm (348 content)
  //   COL_QTY ≈ 13 %  →   70px @ 80mm                |   45px @ 58mm
  //   COL_PRICE≈ 16 %  →   86px @ 80mm                |   56px @ 58mm
  //   COL_SUB ≈ 16 %  →   87px @ 80mm                |   56px @ 58mm
  ctx.font = `${layout.item.fs}px ${FONT}`;
  const COL_SUB   = Math.round(contentW * 0.16);
  const COL_PRICE = Math.round(contentW * 0.16);
  const COL_QTY   = Math.round(contentW * 0.13);
  const nameW     = contentW - COL_QTY - COL_PRICE - COL_SUB;   // ≈ 55 %
  const subRight   = R;
  const priceRight = subRight - COL_SUB;
  const qtyRight   = priceRight - COL_PRICE;

  // Header
  const h = layout.itemHeader;
  ctx.font = `700 ${h.fs}px ${FONT}`; ctx.fillStyle = '#333';
  ctx.textAlign = 'left';  ctx.fillText('รายการ', L, y);
  ctx.textAlign = 'right'; ctx.fillText('จำนวน', qtyRight, y);
  ctx.textAlign = 'right'; ctx.fillText('ราคา', priceRight, y);
  ctx.textAlign = 'right'; ctx.fillText('รวม', subRight, y);
  y += h.lh;
  ctx.fillStyle = '#000'; ctx.fillRect(L, y, contentW, 2);
  y += 2 + Math.max(0, layout.itemGap);          // เส้นใต้หัวตาราง → ออเดอร์แรก (ปรับด้วย itemGap)

  // Rows
  for (const it of data.items) {
    const it_s = layout.item;
    ctx.font = `${it_s.fs}px ${FONT}`; ctx.fillStyle = '#000';
    const nameLines = wrapText(ctx, it.name, nameW);
    ctx.textAlign = 'left';  ctx.fillText(nameLines[0] ?? '', L, y);
    ctx.textAlign = 'right'; ctx.fillText(String(it.quantity), qtyRight, y);
    ctx.textAlign = 'right'; ctx.fillText(money(it.unitPrice), priceRight, y);
    ctx.font = `700 ${it_s.fs}px ${FONT}`;
    ctx.textAlign = 'right'; ctx.fillText(money(it.unitPrice * it.quantity), subRight, y);
    y += it_s.lh;
    ctx.font = `${it_s.fs}px ${FONT}`;
    for (let i = 1; i < nameLines.length; i++) {
      ctx.textAlign = 'left'; ctx.fillText(nameLines[i] ?? '', L + 8, y); y += it_s.lh;
    }
    if (it.note) {
      ctx.font = `${layout.sub.fs}px ${FONT}`; ctx.fillStyle = '#555';
      ctx.textAlign = 'left'; ctx.fillText(`* ${it.note}`, L + 8, y);
      ctx.fillStyle = '#000'; y += layout.sub.lh;
    }
  }

  // Discount / VAT
  if (data.discount > 0) metaRow('ส่วนลด', `-${money(data.discount)}`, false, '#16a34a');
  if (data.vatEnabled) {
    const vatAmt = data.total / 1.07 * 0.07;
    const pretax = data.subtotal ?? (data.total - vatAmt);
    metaRow('ก่อน VAT', money(pretax), false);
    metaRow('VAT 7%', money(vatAmt), false);
  }

  // เส้นทึบเหนือยอดรวม — เส้นลอยอิสระ:
  //  totalTextGap = พื้นที่บล็อก (band) → ดึงยอดรวมลง (ตัวหนังสือขยับ)
  //  totalLineGap = ตำแหน่งเส้นภายใน band (อิสระ) → เลื่อนเฉพาะเส้น ยอดรวมไม่ขยับ
  {
    const band = Math.max(4, layout.totalTextGap);
    const lineY = y + layout.totalLineGap;
    ctx.fillStyle = '#000'; ctx.fillRect(L, lineY, contentW, 3);
    y += band;                                           // ตำแหน่งยอดรวมคงที่ — ไม่ขึ้นกับ totalLineGap
  }

  // Grand total
  {
    const s = layout.total;
    ctx.font = `700 ${s.fs}px ${FONT}`; ctx.fillStyle = '#000';
    ctx.textAlign = 'left';  ctx.fillText('ยอดรวมทั้งหมด', L, y);
    ctx.textAlign = 'right'; ctx.fillText(`${money(data.total)} บาท`, R, y);
    y += s.lh;
  }

  // Cash received / change
  if (data.paymentMethod === 'cash' && data.receivedAmount != null) {
    metaRow('รับเงินสด', `${money(data.receivedAmount)} บาท`, false);
    metaRow('เงินทอน', `${money(data.change ?? 0)} บาท`, true, '#1a56db');
  }

  // QR label (the QR barcode itself is printed by ESC/POS between body & footer)
  if (qrUrl) {
    dash();
    cen(data.googleReviewUrl ? 'สแกนรีวิวร้านค้า' : 'สแกนดูใบเสร็จ', layout.sub.fs, layout.sub.lh, false, '#555');
  }

  return y + 4;
}

// ─── Footer ─────────────────────────────────────────────────────────────────

function drawFooter(ctx: CanvasRenderingContext2D, data: ReceiptData, layout: ReceiptLayout, DOTS: number): number {
  let y = 6;
  const cen = (text: string, fs: number, lh: number, color = '#000') => {
    ctx.font = `${fs}px ${FONT}`; ctx.textAlign = 'center'; ctx.fillStyle = color;
    ctx.fillText(text, DOTS / 2, y);
    y += lh;
  };
  cen('ขอบคุณที่ใช้บริการ', layout.footer.fs, layout.footer.lh, '#000');
  cen(`NexaPos · ${data.shopName}`, Math.max(12, layout.footer.fs - 4), layout.footer.lh, '#777');
  return y + layout.marginBottom;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface RenderedReceipt {
  body: HTMLCanvasElement;
  footer: HTMLCanvasElement;
  qrUrl: string | null;
}

/**
 * Explicitly request Sarabun at every size + weight the renderer uses via FontFaceSet.load().
 *
 * Why not document.fonts.ready?
 *   fonts.ready resolves once stylesheet fonts finish their initial load, but the Canvas 2D
 *   context has its OWN font cache. Setting ctx.font = "20px Sarabun" on a fresh canvas may
 *   still return fallback-font metrics (wider Noto Sans Thai / system sans-serif) if the
 *   canvas font cache hasn't registered Sarabun at that exact size yet — even if fonts.ready
 *   has resolved. fonts.load() at the specific descriptors forces the font into the cache
 *   before any measureText/fillText call.
 *
 * Why per-layout sizes?
 *   Canvas font caching is per-descriptor — loading 38px does NOT prime the cache for 20px.
 *   We extract every unique fs value from the active layout so all sizes are cached before
 *   drawBody() runs. This fixes the "first print fine, subsequent prints broken" symptom
 *   caused by the layout being tuned to non-default sizes (e.g. item.fs=20 instead of 28).
 */
async function ensureSarabunLoaded(layout: ReceiptLayout): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  try {
    const SECTION_KEYS = [
      'shopName', 'sub', 'title', 'meta', 'itemHeader', 'item', 'total', 'footer',
    ] as const;
    // Deduplicate sizes — user layout may set multiple sections to the same fs
    const sizes = [...new Set(SECTION_KEYS.map((k) => layout[k].fs))];
    await Promise.all(
      sizes.flatMap((s) => [
        document.fonts.load(`400 ${s}px Sarabun`),
        document.fonts.load(`700 ${s}px Sarabun`),
      ]),
    );
  } catch { /* font unavailable — canvas falls back to Noto Sans Thai */ }
}

/** Render the receipt to body + footer canvases (Thai-safe). Used by both print and dev preview. */
export async function renderReceipt(data: ReceiptData, layoutIn: ReceiptLayout): Promise<RenderedReceipt> {
  const layout = withLayoutDefaults(layoutIn); // fill missing fields → safe against stale/partial layout
  // Wait for Sarabun to be ready in canvas context at every size the layout actually uses.
  // Must pass the merged layout (not the raw input) so sizes are correct after withLayoutDefaults().
  await ensureSarabunLoaded(layout);
  const DOTS = dots(data);
  const logo = layout.showLogo && data.logoUrl ? await loadImage(data.logoUrl) : null;
  const qrUrl = data.googleReviewUrl ?? (data.receiptToken ? `https://nexapos.io/receipt/${data.receiptToken}` : null);

  const body   = renderBlock(DOTS, (ctx) => drawBody(ctx, data, layout, DOTS, logo, qrUrl));
  const footer = renderBlock(DOTS, (ctx) => drawFooter(ctx, data, layout, DOTS));
  return { body, footer, qrUrl };
}

/** Convert a canvas to ESC/POS GS v 0 raster bytes (header + 1-bit bitmap). */
export function canvasToRaster(cv: HTMLCanvasElement): Uint8Array {
  const w = cv.width, h = cv.height;
  const ctx = cv.getContext('2d')!;
  const img = ctx.getImageData(0, 0, w, h);
  const bytesPerRow = Math.ceil(w / 8);
  const header = [0x1D, 0x76, 0x30, 0x00, bytesPerRow & 0xFF, (bytesPerRow >> 8) & 0xFF, h & 0xFF, (h >> 8) & 0xFF];
  const out = new Uint8Array(header.length + bytesPerRow * h);
  out.set(header, 0);
  const base = header.length;
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const i = (py * w + px) * 4;
      const luma = 0.299 * (img.data[i] ?? 255) + 0.587 * (img.data[i + 1] ?? 255) + 0.114 * (img.data[i + 2] ?? 255);
      if (luma < 128) {
        const bi = base + py * bytesPerRow + (px >> 3);
        out[bi] = (out[bi] ?? 0) | (0x80 >> (px % 8));
      }
    }
  }
  return out;
}

/** ESC/POS native QR command bytes (GS ( k), model 2. */
function qrCommand(url: string, cellSize: number): number[] {
  const size = Math.min(16, Math.max(1, Math.round(cellSize)));
  const urlBytes = Array.from(new TextEncoder().encode(url));
  const dataLen = urlBytes.length + 3;
  return [
    0x1D, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00,          // model 2
    0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, size,                 // module size
    0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, 0x31,                 // error correction M
    0x1D, 0x28, 0x6B, dataLen & 0xFF, (dataLen >> 8) & 0xFF, 0x31, 0x50, 0x30, ...urlBytes, // store
    0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30,                 // print
  ];
}

function concat(chunks: (number[] | Uint8Array)[]): Uint8Array {
  let len = 0; for (const c of chunks) len += c.length;
  const out = new Uint8Array(len);
  let off = 0; for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

/** Build the full ESC/POS byte stream for a receipt (body raster → centered QR → footer raster → cut). */
export async function buildReceiptBytes(data: ReceiptData, layoutIn: ReceiptLayout): Promise<Uint8Array> {
  const layout = withLayoutDefaults(layoutIn);
  const { body, footer, qrUrl } = await renderReceipt(data, layout);
  const chunks: (number[] | Uint8Array)[] = [];
  chunks.push([0x1B, 0x40]);            // ESC @ — init
  chunks.push(canvasToRaster(body));
  if (qrUrl) {
    chunks.push([0x1B, 0x61, 0x01]);    // ESC a 1 — center
    chunks.push(qrCommand(qrUrl, layout.qrSize));
    chunks.push([0x1B, 0x61, 0x00]);    // ESC a 0 — left
  }
  chunks.push(canvasToRaster(footer));
  // ตัดกระดาษโดยไม่ feed บรรทัดเปล่าเกินจำเป็น — GS V A n (partial cut, feed n dots)
  // feedAfter น้อย = ประหยัดกระดาษท้าย (เครื่องตัดส่วนใหญ่ feed ถึงตำแหน่งตัดให้เองอยู่แล้ว)
  const feed = Math.min(255, Math.max(0, Math.round(layout.feedAfter)));
  chunks.push([0x1D, 0x56, 0x41, feed]);
  return concat(chunks);
}
