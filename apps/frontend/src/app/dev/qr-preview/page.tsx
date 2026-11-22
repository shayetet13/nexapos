'use client';

import { useEffect, useState, useRef } from 'react';

function FakeQR({ size }: { size: number }) {
  const cells: { x: number; y: number }[] = [];
  const s = 21;
  for (let r = 0; r < s; r++) {
    for (let c = 0; c < s; c++) {
      const inTL = r < 7 && c < 7;
      const inTR = r < 7 && c >= s - 7;
      const inBL = r >= s - 7 && c < 7;
      const border =
        (r === 0 || r === 6 || r === s - 1 || r === s - 7 || c === 0 || c === 6 || c === s - 1 || c === s - 7) &&
        (r < 7 || r >= s - 7 || c < 7 || c >= s - 7);
      const inner =
        (r >= 2 && r <= 4 && c >= 2 && c <= 4) ||
        (r >= 2 && r <= 4 && c >= s - 5 && c <= s - 3) ||
        (r >= s - 5 && r <= s - 3 && c >= 2 && c <= 4);
      const data = !inTL && !inTR && !inBL && (r + c + r * c) % 3 === 0;
      if (border || inner || data) cells.push({ x: c, y: r });
    }
  }
  const cell = size / s;
  return (
    <svg width={size} height={size}>
      <rect width={size} height={size} fill="white" />
      {cells.map((p, i) => (
        <rect key={i} x={p.x * cell} y={p.y * cell} width={cell} height={cell} fill="#000" />
      ))}
    </svg>
  );
}

const COUNTDOWN_SEC = 45;
const RING_R = 34;
const RING_SIZE = 82;

function CountdownRing({ scale }: { scale: number }) {
  const [remaining, setRemaining] = useState(COUNTDOWN_SEC);

  useEffect(() => {
    if (remaining <= 0) return;
    const t = setTimeout(() => setRemaining(r => r - 1), 1000);
    return () => clearTimeout(t);
  }, [remaining]);

  const sz  = RING_SIZE * scale;
  const r   = RING_R * scale;
  const cx  = sz / 2;
  const sw  = 5 * scale;
  const circ = 2 * Math.PI * r;
  const progress   = remaining / COUNTDOWN_SEC;           // 1 → 0
  const dashOffset = circ * (1 - progress);

  // น้ำเงิน → ส้ม → ชมพู → แดง
  const color = remaining > 33 ? '#2563EB'
              : remaining > 22 ? '#f97316'
              : remaining > 11 ? '#ec4899'
              :                  '#ef4444';

  return (
    <div style={{ position: 'relative', width: sz, height: sz }}>
      <svg width={sz} height={sz} style={{ position: 'absolute', inset: 0, transform: 'rotate(-90deg)' }}>
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="rgba(0,0,0,0.10)" strokeWidth={sw} />
        <circle cx={cx} cy={cx} r={r} fill="none"
          stroke={color} strokeWidth={sw} strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={dashOffset}
        />
      </svg>
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 26 * scale, fontWeight: 900, color,
        fontFamily: 'monospace',
      }}>
        {remaining}
      </div>
    </div>
  );
}

const IMG_W   = 532;
const IMG_H   = 768;
const QR_SIZE = 240;
const QR_TOP     = 205;
const INFO_TOP   = QR_TOP + QR_SIZE + 10;
const FOOTER_TOP = 693;
const FOOTER_LEFT = 16;
const FOOTER_RIGHT = 15;
const FOOTER_BOTTOM = 10;

export default function QrPreviewPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    function updateScale() {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const maxW = Math.min(vw, 560);
      setScale(Math.min(maxW / IMG_W, vh / IMG_H) * 0.97);
    }
    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, []);

  const grandTotal      = 1234.5;
  const shopName        = 'ร้านกาแฟสวัสดี';
  const promptpayNumber = '066-xxx-xxxx';
  const shopLogoUrl: string | null = null;
  const fmt = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2 });
  const W = IMG_W * scale;
  const H = IMG_H * scale;

  return (
    <>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        html, body {
          background: #374151;
          min-height: 100dvh;
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: 'Prompt', 'Noto Sans Thai', Arial, sans-serif;
        }
      `}</style>

      <div ref={containerRef} style={{ position: 'relative', width: W, height: H, overflow: 'hidden' }}>

        {/* Template image */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/promptpay-sample.jpg" alt="PromptPay"
          style={{ width: '100%', height: '100%', display: 'block' }} />


        {/* QR code */}
        <div style={{
          position: 'absolute',
          top: QR_TOP * scale,
          left: ((IMG_W - QR_SIZE) / 2) * scale,
          background: '#fff',
          padding: 4 * scale,
          lineHeight: 0,
        }}>
          <FakeQR size={QR_SIZE * scale} />
        </div>

        {/* Info block */}
        <div style={{
          position: 'absolute',
          top: INFO_TOP * scale,
          left: 0, right: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 4 * scale,
          padding: `0 ${20 * scale}px`,
        }}>
          <div style={{ fontSize: 50 * scale, fontWeight: 900, color: '#111827', lineHeight: 1, marginTop: 30 * scale }}>
            <span style={{ fontSize: 50 * scale, color: '#374151', marginRight: 3 * scale }}>฿</span>
            {fmt(grandTotal)}
          </div>

          {shopLogoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shopLogoUrl} alt={shopName}
              style={{ height: 40 * scale, maxWidth: '55%', objectFit: 'contain' }} />
          )}

          <div style={{ fontSize: 25 * scale, fontWeight: 800, color: '#111827', textAlign: 'center', marginTop: 25 * scale }}>
            {shopName}
          </div>

          {promptpayNumber && (
            <div style={{ fontSize: 25 * scale, fontWeight: 600, color: '#374151' }}>
              พร้อมเพย์: {promptpayNumber}
            </div>
          )}
        </div>

        {/* Countdown ring — bottom-right, above footer */}
        <div style={{
          position: 'absolute',
          right: 22 * scale,
          bottom: (IMG_H - FOOTER_TOP + 8) * scale,
        }}>
          <CountdownRing scale={scale} />
        </div>

        {/* Black footer */}
        <div style={{
          position: 'absolute',
          top: FOOTER_TOP * scale,
          left: FOOTER_LEFT * scale,
          right: FOOTER_RIGHT * scale,
          bottom: FOOTER_BOTTOM * scale,
          background: '#000',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6 * scale,
        }}>
          <svg width={20 * scale} height={20 * scale} viewBox="0 0 24 24" fill="none">
            <path d="M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11M20 10v11M8 10v11M12 10v11M16 10v11"
              stroke="#ffffff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div style={{ fontSize: 25 * scale, fontWeight: 700, color: '#ffffff' }}>
            รับเงินได้จากทุกธนาคาร
          </div>
        </div>

      </div>
    </>
  );
}
