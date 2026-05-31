'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, SectionHeader, FieldLabel, Btn, Toast } from './dev-ui';
import {
  DEFAULT_RECEIPT_LAYOUT, loadReceiptLayout, saveReceiptLayout, resetReceiptLayout,
  MOCK_RECEIPT_ORDER, type ReceiptLayout, type SectionStyle, type ReceiptData,
} from '@/lib/receipt-layout';
import { renderReceipt, buildReceiptBytes } from '@/lib/receipt-render';
import {
  hasBluetooth, hasUsb,
  connectBluetoothPrinter, sendBluetooth, type BtPrinter,
  connectUsbPrinter, sendUsb, type UsbPrinter,
  sendNetwork,
} from '@/lib/escpos-transport';

type ToastMsg = { type: 'ok' | 'err'; text: string };
type PrintMode = 'bluetooth' | 'usb' | 'network';

const SECTION_LABELS: Record<keyof Pick<ReceiptLayout, 'shopName' | 'sub' | 'title' | 'meta' | 'itemHeader' | 'item' | 'total' | 'footer'>, string> = {
  shopName:   'ชื่อร้าน',
  sub:        'สาขา / ที่อยู่ / โทร',
  title:      'หัวข้อใบเสร็จ',
  meta:       'เลขที่ / วันที่ / พนักงาน',
  itemHeader: 'หัวตารางสินค้า',
  item:       'แถวสินค้า',
  total:      'ยอดรวมทั้งหมด',
  footer:     'ท้ายใบเสร็จ',
};

export function ReceiptTuningTab() {
  const [layout, setLayout]   = useState<ReceiptLayout>(() => loadReceiptLayout());
  const [paperWidth, setPaper] = useState<32 | 48>(MOCK_RECEIPT_ORDER.paperWidth);
  const [logoUrl, setLogoUrl] = useState('');
  const [toast, setToast]     = useState<ToastMsg | null>(null);
  const [mode, setMode]       = useState<PrintMode>('bluetooth');
  const [netIP, setNetIP]     = useState('');
  const [netPort, setNetPort] = useState('9100');
  const [printing, setPrinting] = useState(false);

  const bodyRef   = useRef<HTMLCanvasElement>(null);
  const footerRef = useRef<HTMLCanvasElement>(null);
  const btRef     = useRef<BtPrinter | null>(null);
  const usbRef    = useRef<UsbPrinter | null>(null);
  const renderSeq = useRef(0);

  const [qrUrl, setQrUrl] = useState<string | null>(null);

  const mockData: ReceiptData = useMemo(
    () => ({ ...MOCK_RECEIPT_ORDER, paperWidth, logoUrl: logoUrl.trim() || null }),
    [paperWidth, logoUrl],
  );

  // Live preview — re-render the receipt canvases whenever layout/paper/logo changes
  useEffect(() => {
    const seq = ++renderSeq.current;
    let cancelled = false;
    void (async () => {
      try {
        const { body, footer, qrUrl: q } = await renderReceipt(mockData, layout);
        if (cancelled || seq !== renderSeq.current) return;
        for (const [src, ref] of [[body, bodyRef], [footer, footerRef]] as const) {
          const dst = ref.current;
          if (!dst) continue;
          dst.width = src.width; dst.height = src.height;
          const ctx = dst.getContext('2d');
          if (ctx) ctx.drawImage(src, 0, 0);
        }
        setQrUrl(q);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [mockData, layout]);

  const updateTop = useCallback(<K extends keyof ReceiptLayout>(key: K, val: ReceiptLayout[K]) => {
    setLayout((prev) => ({ ...prev, [key]: val }));
  }, []);
  const updateSection = useCallback((key: keyof typeof SECTION_LABELS, field: keyof SectionStyle, val: number) => {
    setLayout((prev) => ({ ...prev, [key]: { ...prev[key], [field]: val } }));
  }, []);

  function handleSave() {
    saveReceiptLayout(layout);
    setToast({ type: 'ok', text: 'บันทึกเป็นค่าเริ่มต้นบนเครื่องนี้แล้ว — การพิมพ์จริงจะใช้ค่านี้ทันที' });
  }
  function handleReset() {
    resetReceiptLayout();
    setLayout(DEFAULT_RECEIPT_LAYOUT);
    setToast({ type: 'ok', text: 'รีเซ็ตกลับค่าเริ่มต้นในโค้ดแล้ว' });
  }
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(layout, null, 2));
      setToast({ type: 'ok', text: 'คัดลอก JSON แล้ว — นำไปวางใน DEFAULT_RECEIPT_LAYOUT เพื่อฝังเป็นค่าถาวร' });
    } catch {
      setToast({ type: 'err', text: 'คัดลอกไม่สำเร็จ' });
    }
  }

  async function handleConnect() {
    try {
      if (mode === 'bluetooth') { btRef.current = await connectBluetoothPrinter(); setToast({ type: 'ok', text: `เชื่อมต่อ Bluetooth: ${btRef.current.device.name ?? 'printer'}` }); }
      else if (mode === 'usb')  { usbRef.current = await connectUsbPrinter(); setToast({ type: 'ok', text: 'เชื่อมต่อ USB printer แล้ว' }); }
      else setToast({ type: 'ok', text: 'โหมด Network ไม่ต้องเชื่อมต่อล่วงหน้า — กดพิมพ์ได้เลย' });
    } catch (err) {
      setToast({ type: 'err', text: (err as Error).message });
    }
  }

  async function handlePrint() {
    setPrinting(true);
    try {
      const bytes = await buildReceiptBytes(mockData, layout);
      let ok = false;
      if (mode === 'bluetooth') {
        if (!btRef.current) { setToast({ type: 'err', text: 'ยังไม่ได้เชื่อมต่อ Bluetooth' }); return; }
        ok = await sendBluetooth(btRef.current, bytes);
      } else if (mode === 'usb') {
        if (!usbRef.current) { setToast({ type: 'err', text: 'ยังไม่ได้เชื่อมต่อ USB' }); return; }
        ok = await sendUsb(usbRef.current, bytes);
      } else {
        if (!netIP) { setToast({ type: 'err', text: 'กรุณากรอก IP เครื่องปริ๊น' }); return; }
        ok = await sendNetwork(netIP, netPort, bytes);
      }
      setToast(ok ? { type: 'ok', text: 'ส่งคำสั่งพิมพ์แล้ว' } : { type: 'err', text: 'พิมพ์ไม่สำเร็จ — ตรวจสอบการเชื่อมต่อ' });
    } catch (err) {
      setToast({ type: 'err', text: (err as Error).message });
    } finally {
      setPrinting(false);
    }
  }

  return (
    <div className="space-y-5">
      {toast && <Toast msg={toast} onClose={() => setToast(null)} />}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* ── Live preview ─────────────────────────────────────── */}
        <Card>
          <SectionHeader title="ตัวอย่างใบเสร็จ (Mock)" desc="ข้อมูลจำลอง 10 รายการ — เหมือนที่จะพิมพ์จริง" />
          <div className="p-4 flex flex-col items-center">
            <div
              style={{ width: paperWidth === 32 ? 280 : 360, background: '#fff', boxShadow: '0 2px 16px rgba(0,0,0,.15)', padding: 8, borderRadius: 4 }}
            >
              {/* QR is now rendered inside the body canvas (centered by canvas math) */}
              <canvas ref={bodyRef} style={{ width: '100%', display: 'block' }} />
              <canvas ref={footerRef} style={{ width: '100%', display: 'block' }} />
            </div>
            <p className="text-xs text-[var(--color-text-muted)] mt-3">
              {paperWidth === 32 ? '58mm · 384 dots' : '80mm · 576 dots'}
            </p>
          </div>
        </Card>

        {/* ── Controls ─────────────────────────────────────────── */}
        <div className="space-y-5">
          <Card>
            <SectionHeader title="กระดาษ & โลโก้" />
            <div className="px-6 py-4 grid grid-cols-2 gap-3">
              <div>
                <FieldLabel>ขนาดกระดาษ</FieldLabel>
                <select
                  className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm"
                  value={paperWidth}
                  onChange={(e) => setPaper(Number(e.target.value) as 32 | 48)}
                >
                  <option value={48}>80mm (48)</option>
                  <option value={32}>58mm (32)</option>
                </select>
              </div>
              <div>
                <FieldLabel>QR ขนาด (1–16)</FieldLabel>
                <NumberField value={layout.qrSize} min={1} max={16} onChange={(v) => updateTop('qrSize', v)} />
              </div>
              <div className="flex items-center gap-2 pt-5">
                <input id="showLogo" type="checkbox" checked={layout.showLogo} onChange={(e) => updateTop('showLogo', e.target.checked)} />
                <label htmlFor="showLogo" className="text-sm text-[var(--color-text)]">พิมพ์โลโก้</label>
              </div>
              <div>
                <FieldLabel>โลโก้ Ø (px)</FieldLabel>
                <NumberField value={layout.logoDiameter} min={40} max={240} onChange={(v) => updateTop('logoDiameter', v)} />
              </div>
              <div>
                <FieldLabel>📏 ระยะบล็อกยอดรวม (ดึงยอดลง)</FieldLabel>
                <NumberField value={layout.totalTextGap} min={0} max={100} onChange={(v) => updateTop('totalTextGap', v)} />
              </div>
              <div>
                <FieldLabel>➖ ตำแหน่งเส้นยอดรวม (อิสระ · ลบ=ขึ้น)</FieldLabel>
                <NumberField value={layout.totalLineGap} min={-60} max={80} onChange={(v) => updateTop('totalLineGap', v)} />
              </div>
              <div>
                <FieldLabel>📏 ระยะตัวหนังสือรอบเส้นประ</FieldLabel>
                <NumberField value={layout.dashGap} min={0} max={40} onChange={(v) => updateTop('dashGap', v)} />
              </div>
              <div>
                <FieldLabel>┈ ตำแหน่งเส้นประ (อิสระ · ลบ=ขึ้น)</FieldLabel>
                <NumberField value={layout.dashOffset} min={-30} max={30} onChange={(v) => updateTop('dashOffset', v)} />
              </div>
              <div>
                <FieldLabel>ระยะรอบหัวข้อใบเสร็จ (px)</FieldLabel>
                <NumberField value={layout.titleGap} min={0} max={40} onChange={(v) => updateTop('titleGap', v)} />
              </div>
              <div>
                <FieldLabel>📏 ระยะหัวตาราง → ออเดอร์แรก</FieldLabel>
                <NumberField value={layout.itemGap} min={0} max={60} onChange={(v) => updateTop('itemGap', v)} />
              </div>
              <div className="col-span-2">
                <FieldLabel>✂️ feed ก่อนตัดกระดาษ (dots · น้อย=ประหยัด)</FieldLabel>
                <NumberField value={layout.feedAfter} min={0} max={255} onChange={(v) => updateTop('feedAfter', v)} />
              </div>
              <div className="col-span-2">
                <FieldLabel>URL โลโก้ (สำหรับพรีวิวเท่านั้น)</FieldLabel>
                <input
                  className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm"
                  placeholder="https://..."
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                />
              </div>
            </div>
          </Card>

          <Card>
            <SectionHeader title="ระยะขอบ (Margin · px)" />
            <div className="px-6 py-4 grid grid-cols-4 gap-3">
              <div><FieldLabel>บน</FieldLabel><NumberField value={layout.marginTop} min={0} max={80} onChange={(v) => updateTop('marginTop', v)} /></div>
              <div><FieldLabel>ล่าง</FieldLabel><NumberField value={layout.marginBottom} min={0} max={120} onChange={(v) => updateTop('marginBottom', v)} /></div>
              <div><FieldLabel>ซ้าย</FieldLabel><NumberField value={layout.marginLeft} min={0} max={80} onChange={(v) => updateTop('marginLeft', v)} /></div>
              <div><FieldLabel>ขวา</FieldLabel><NumberField value={layout.marginRight} min={0} max={80} onChange={(v) => updateTop('marginRight', v)} /></div>
            </div>
          </Card>

          <Card>
            <SectionHeader title="ขนาด & ระยะบรรทัด (px)" desc="fs = ขนาดตัวอักษร, lh = ระยะบรรทัด" />
            <div className="px-6 py-4 space-y-2">
              {(Object.keys(SECTION_LABELS) as (keyof typeof SECTION_LABELS)[]).map((key) => (
                <div key={key} className="grid grid-cols-[1fr_auto_auto] items-center gap-3">
                  <span className="text-sm text-[var(--color-text)]">{SECTION_LABELS[key]}</span>
                  <LabeledNum label="fs" value={layout[key].fs} onChange={(v) => updateSection(key, 'fs', v)} />
                  <LabeledNum label="lh" value={layout[key].lh} onChange={(v) => updateSection(key, 'lh', v)} />
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <SectionHeader title="พิมพ์ทดสอบจริง" desc="Bluetooth ต้องเปิดผ่าน HTTPS" />
            <div className="px-6 py-4 space-y-3">
              <div className="flex gap-2">
                {(['bluetooth', 'usb', 'network'] as PrintMode[]).map((m) => (
                  <Btn key={m} variant={mode === m ? 'primary' : 'ghost'} onClick={() => setMode(m)}>
                    {m === 'bluetooth' ? '📶 Bluetooth' : m === 'usb' ? '🔌 USB' : '🌐 Network'}
                  </Btn>
                ))}
              </div>
              {mode === 'network' && (
                <div className="grid grid-cols-2 gap-3">
                  <div><FieldLabel>IP</FieldLabel><input className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm" placeholder="192.168.1.100" value={netIP} onChange={(e) => setNetIP(e.target.value)} /></div>
                  <div><FieldLabel>Port</FieldLabel><input className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm" placeholder="9100" value={netPort} onChange={(e) => setNetPort(e.target.value)} /></div>
                </div>
              )}
              {mode === 'bluetooth' && !hasBluetooth && <p className="text-xs text-yellow-400">⚠️ เบราว์เซอร์นี้ไม่มี Web Bluetooth (ต้องเปิดผ่าน https://)</p>}
              {mode === 'usb' && !hasUsb && <p className="text-xs text-yellow-400">⚠️ เบราว์เซอร์นี้ไม่มี WebUSB</p>}
              <div className="flex gap-2">
                {mode !== 'network' && <Btn variant="ghost" onClick={() => void handleConnect()}>🔗 เชื่อมต่อ</Btn>}
                <Btn variant="primary" onClick={() => void handlePrint()} disabled={printing}>{printing ? '⏳ กำลังพิมพ์...' : '🖨 พิมพ์จริง'}</Btn>
              </div>
            </div>
          </Card>

          <div className="flex gap-2">
            <Btn variant="success" onClick={handleSave}>💾 บันทึกเป็นค่าเริ่มต้น</Btn>
            <Btn variant="ghost" onClick={() => void handleCopy()}>📋 คัดลอก JSON</Btn>
            <Btn variant="danger" onClick={handleReset}>↺ รีเซ็ต</Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

function NumberField({ value, min, max, onChange }: { value: number; min?: number; max?: number; onChange: (v: number) => void }) {
  return (
    <input
      type="number"
      min={min}
      max={max}
      value={Number.isFinite(value) ? value : 0}
      onChange={(e) => { const v = Number(e.target.value); if (!Number.isNaN(v)) onChange(v); }}
      className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm focus:outline-none focus:border-[var(--color-primary)]"
    />
  );
}

function LabeledNum({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex items-center gap-1">
      <span className="text-xs text-[var(--color-text-muted)] w-5">{label}</span>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => { const v = Number(e.target.value); if (!Number.isNaN(v)) onChange(v); }}
        className="w-16 px-2 py-1 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm focus:outline-none focus:border-[var(--color-primary)]"
      />
    </label>
  );
}
