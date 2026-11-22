'use client';

import { Suspense, useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import Image from 'next/image';
import QRCodeLib from 'react-qr-code';
const QRCode = QRCodeLib as unknown as (props: {
  value: string; size?: number; bgColor?: string; fgColor?: string;
  level?: string; style?: React.CSSProperties; className?: string;
}) => React.ReactElement;

/* ── Constants ── */
const AUTO_RESET_MS    = 5 * 60 * 1000;
const RECEIPT_RESET_MS = 15_000;
const API_URL          = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

type WsStatus = 'connecting' | 'connected' | 'disconnected';

type DisplayMode =
  | { kind: 'idle' }
  | { kind: 'cash';    shopName: string; orderNumber: number; total: number }
  | { kind: 'qr';      shopName: string; orderNumber: number; total: number; qrPayload: string; accountName: string; promptpayNumber: string }
  | { kind: 'paid';    total: number }
  | { kind: 'receipt'; receiptToken: string; dailySeq: number; total: number }
  | { kind: 'register' };

function buildWsUrl(shopId: string): string {
  const wsEnv = process.env.NEXT_PUBLIC_WS_URL;
  if (wsEnv) return `${wsEnv}/ws-display?shopId=${shopId}`;
  const direct = process.env.NEXT_PUBLIC_API_URL_DIRECT ?? 'http://localhost:4000';
  const wsBase = direct.replace(/^https/, 'wss').replace(/^http(?!s)/, 'ws');
  return `${wsBase}/ws-display?shopId=${shopId}`;
}

/* ── PromptPay Template Card ── */
const TPL_W = 532, TPL_H = 768, TPL_QR_SIZE = 240, TPL_QR_TOP = 205;
const TPL_INFO_TOP = TPL_QR_TOP + TPL_QR_SIZE + 10;
const TPL_FOOTER_TOP = 693, TPL_FOOTER_L = 16, TPL_FOOTER_R = 15, TPL_FOOTER_B = 10;
const QR_RING_R = 34, QR_RING_SIZE = 82, QR_COUNTDOWN = 45;

function QrCountdownRing({ scale, onExpired }: { scale: number; onExpired?: () => void }) {
  const [rem, setRem] = useState(QR_COUNTDOWN);
  const onExpiredRef  = useRef(onExpired);
  useEffect(() => { onExpiredRef.current = onExpired; }, [onExpired]);
  useEffect(() => {
    if (rem <= 0) { onExpiredRef.current?.(); return; }
    const t = setTimeout(() => setRem(r => r - 1), 1000);
    return () => clearTimeout(t);
  }, [rem]);
  const sz = QR_RING_SIZE * scale, r = QR_RING_R * scale, cx = sz / 2, sw = 5 * scale;
  const circ = 2 * Math.PI * r;
  const color = rem > 33 ? '#2563EB' : rem > 22 ? '#f97316' : rem > 11 ? '#ec4899' : '#ef4444';
  return (
    <div style={{ position: 'relative', width: sz, height: sz }}>
      <svg width={sz} height={sz} style={{ position: 'absolute', inset: 0, transform: 'rotate(-90deg)' }}>
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="rgba(0,0,0,0.10)" strokeWidth={sw} />
        <circle cx={cx} cy={cx} r={r} fill="none" stroke={color} strokeWidth={sw}
          strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={circ * (1 - rem / QR_COUNTDOWN)} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
        justifyContent: 'center', fontSize: 26 * scale, fontWeight: 900, color, fontFamily: 'monospace' }}>
        {rem}
      </div>
    </div>
  );
}

function maskPromptPay(num: string): string {
  const d = num.replace(/\D/g, '');
  if (d.length === 10) {
    // เบอร์โทร: 083-XXX-9787
    return `${d.slice(0,3)}-XXX-${d.slice(6)}`;
  } else if (d.length === 13) {
    // บัตรประชาชน: 0-000X-XXXX-X000
    return `${d[0]}-${d.slice(1,4)}X-XXXX-X${d.slice(10)}`;
  }
  return num;
}

function PromptPayCard({ qrValue, total, shopName, accountName, promptpayNumber, logoUrl, onExpired }: {
  qrValue: string; total: number; shopName: string; accountName: string; promptpayNumber: string; logoUrl?: string | null; onExpired?: () => void;
}) {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    function calc() {
      const vw = window.innerWidth, vh = window.innerHeight;
      const maxW = Math.min(vw * 0.95, 480);
      // status bar 80px + reset button 56px + gaps 24px
      const maxH = vh - 160;
      setScale(Math.min(maxW / TPL_W, maxH / TPL_H) * 1.02);
    }
    calc();
    window.addEventListener('resize', calc);
    return () => window.removeEventListener('resize', calc);
  }, []);
  const W = TPL_W * scale, H = TPL_H * scale;
  const fmtAmt = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2 });
  return (
    <div style={{ position: 'relative', width: W, height: H, overflow: 'hidden' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/promptpay-sample.jpg" alt="" style={{ width: '100%', height: '100%', display: 'block' }} />
      {/* QR */}
      <div style={{ position: 'absolute', top: TPL_QR_TOP * scale, left: ((TPL_W - TPL_QR_SIZE) / 2) * scale,
        background: '#fff', padding: 4 * scale, lineHeight: 0 }}>
        <QRCode value={qrValue} size={TPL_QR_SIZE * scale} bgColor="#fff" fgColor="#000" level="M" />
      </div>
      {/* Info — amount + promptpay number */}
      <div style={{ position: 'absolute', top: TPL_INFO_TOP * scale, left: 0, right: 0,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 * scale, padding: `0 ${16 * scale}px` }}>
        <div style={{ fontSize: 55 * scale, fontWeight: 900, color: '#111827', lineHeight: 1, marginTop: 20 * scale }}>
          <span style={{ fontSize: 55 * scale, color: '#374151', marginRight: 3 * scale }}>฿ </span>{fmtAmt(total)} บาท
        </div>
        {logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt={shopName} style={{ height: 0 * scale, maxWidth: '50%', objectFit: 'contain', marginTop: 4 * scale }} />
        )}
        {promptpayNumber && (
           <div style={{ fontSize: 25 * scale, fontWeight: 700, color: '#1d4ed8', letterSpacing: 1, marginTop: 10 * scale }}>
           เลขพร้อมเพย์: {maskPromptPay(promptpayNumber)}
          </div>
        )}
      </div>
      {/* ชื่อบัญชี — ชิดล่าง เหนือ footer */}
      {accountName && (
        <div style={{ position: 'absolute', bottom: (TPL_H - TPL_FOOTER_TOP + 16) * scale,
          left: 0, right: 0, textAlign: 'center',
          fontSize: 30 * scale, fontWeight: 700, color: '#374151' }}>
          {accountName}
        </div>
      )}
      {/* Countdown ring */}
      <div style={{ position: 'absolute', right: 22 * scale, bottom: (TPL_H - TPL_FOOTER_TOP + 8) * scale }}>
        <QrCountdownRing scale={scale} onExpired={onExpired} />
      </div>
      {/* Footer */}
      <div style={{ position: 'absolute', top: TPL_FOOTER_TOP * scale, left: TPL_FOOTER_L * scale,
        right: TPL_FOOTER_R * scale, bottom: TPL_FOOTER_B * scale,
        background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 * scale }}>
        <svg width={20 * scale} height={20 * scale} viewBox="0 0 24 24" fill="none">
          <path d="M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11M20 10v11M8 10v11M12 10v11M16 10v11"
            stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div style={{ fontSize: 25 * scale, fontWeight: 700, color: '#fff' }}>รับเงินได้ทุกธนาคาร</div>
      </div>
    </div>
  );
}

/* ── Countdown ring (SVG circle) ── */
function CountdownRing({ seconds, total, color = '#34d399' }: { seconds: number; total: number; color?: string }) {
  const r = 19;
  const circ = 2 * Math.PI * r;
  const dashOffset = circ * (1 - seconds / total);
  const isUrgent = seconds <= 5;
  return (
    <div className={`pd-countdown${isUrgent ? ' pd-countdown--urgent' : ''}`}>
      <svg width="46" height="46" viewBox="0 0 46 46">
        <circle cx="23" cy="23" r={r} fill="none" stroke="rgba(255,255,255,.07)" strokeWidth="3" />
        <circle cx="23" cy="23" r={r} fill="none"
          stroke={isUrgent ? '#ff4560' : color}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={dashOffset}
          style={{ transform: 'rotate(-90deg)', transformOrigin: '50% 50%', transition: 'stroke-dashoffset .9s linear, stroke .3s' }}
        />
      </svg>
      <span className="pd-countdown__num">{seconds}</span>
    </div>
  );
}

/* ─────────────────────────────────────────────────── */
function PayContent() {
  const searchParams = useSearchParams();
  const shopId   = searchParams.get('shopId')   ?? '';
  const branchId = searchParams.get('branchId') ?? '';

  const [wsStatus, setWsStatus]   = useState<WsStatus>('connecting');
  const [mode, setMode]           = useState<DisplayMode>({ kind: 'idle' });
  const [countdown, setCountdown] = useState(0);
  const [origin, setOrigin]       = useState('');
  const [shopInfo, setShopInfo]   = useState<{ name: string; logoUrl: string | null } | null>(null);

  const modeRef             = useRef<DisplayMode>({ kind: 'idle' });
  const wsRef               = useRef<WebSocket | null>(null);
  const resetTimerRef       = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Dedicated timer for paid→receipt transition — NEVER touched by any other handler
  const paidTransitionRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef        = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef        = useRef(true);

  const applyMode = useCallback((m: DisplayMode) => {
    modeRef.current = m;
    setMode(m);
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    setOrigin(window.location.origin);
    return () => { isMountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!shopId) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`${API_URL}/api/v1/public/shops/${shopId}`);
        const j = await res.json();
        if (!cancelled && j?.success && j.data) {
          setShopInfo({ name: j.data.name as string, logoUrl: (j.data.logo_url as string | null) ?? null });
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [shopId]);

  const fmt = (n: number) =>
    n.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

  const startCountdown = useCallback((secs: number) => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    setCountdown(secs);
    countdownRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) { if (countdownRef.current) clearInterval(countdownRef.current); return 0; }
        return prev - 1;
      });
    }, 1000);
  }, []);

  const stopCountdown = useCallback(() => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    setCountdown(0);
  }, []);

  const scheduleReset = useCallback(() => {
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    resetTimerRef.current = setTimeout(() => setMode({ kind: 'idle' }), AUTO_RESET_MS);
  }, []);

  const connect = useCallback(() => {
    if (!shopId) return;
    setWsStatus('connecting');
    const ws = new WebSocket(buildWsUrl(shopId));
    wsRef.current = ws;

    ws.onopen = () => { if (isMountedRef.current) setWsStatus('connected'); };

    ws.onmessage = (e) => {
      if (!isMountedRef.current) return;
      try {
        const msg = JSON.parse(e.data as string) as {
          type: string; shopId?: string;
          payload?: { qr_payload?:string; total?:number; order_number?:number; shop_name?:string;
            branch_id?:string; account_name?:string; receipt_token?:string; daily_seq?:number; };
        };
        if (msg.shopId && msg.shopId !== shopId) return;
        const p = msg.payload ?? {};

        if (msg.type === 'CHECKOUT_QR') {
          stopCountdown();
          applyMode({ kind:'qr', shopName:p.shop_name??'', orderNumber:p.order_number??0,
            total:p.total??0, qrPayload:p.qr_payload??'', accountName:p.account_name??'',
            promptpayNumber:(p as {promptpay_number?:string}).promptpay_number??'' });
          scheduleReset();
        } else if (msg.type === 'CHECKOUT_CASH') {
          stopCountdown();
          applyMode({ kind:'cash', shopName:p.shop_name??'', orderNumber:p.order_number??0, total:p.total??0 });
          scheduleReset();
        } else if (msg.type === 'CHECKOUT_PAID') {
          // Clear auto-reset timer (5-min idle) only — NOT the paid transition timer
          if (resetTimerRef.current) { clearTimeout(resetTimerRef.current); resetTimerRef.current = null; }
          // Cancel any previous paid→receipt timer (e.g. duplicate event)
          if (paidTransitionRef.current) { clearTimeout(paidTransitionRef.current); paidTransitionRef.current = null; }
          stopCountdown();
          const paidTotal    = p.total ?? 0;
          const receiptToken = p.receipt_token as string | undefined;
          const dailySeq     = (p.daily_seq as number | undefined) ?? 0;
          // Always show paid screen first — stored in separate ref so NO other handler can cancel it
          applyMode({ kind: 'paid', total: paidTotal });
          if (receiptToken) {
            paidTransitionRef.current = setTimeout(() => {
              paidTransitionRef.current = null;
              applyMode({ kind: 'receipt', receiptToken, dailySeq, total: paidTotal });
              startCountdown(RECEIPT_RESET_MS / 1000);
              resetTimerRef.current = setTimeout(() => {
                applyMode({ kind: 'idle' });
                stopCountdown();
              }, RECEIPT_RESET_MS);
            }, 1500);
          } else {
            // No receipt token → paid for 8 s then idle
            resetTimerRef.current = setTimeout(() => applyMode({ kind: 'idle' }), 8000);
          }
        } else if (msg.type === 'CHECKOUT_CLOSE') {
          stopCountdown();
          applyMode({ kind:'idle' });
          if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
        } else if (msg.type === 'ORDER_CREATED') {
          if (branchId && p.branch_id && p.branch_id !== branchId) return;
          // Do NOT interrupt paid/receipt screens — CHECKOUT_PAID arrives just before ORDER_CREATED
          const curr = modeRef.current.kind;
          if (curr !== 'receipt' && curr !== 'paid') {
            applyMode({ kind:'idle' });
            if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
          }
        } else if (msg.type === 'REGISTER_QR') {
          stopCountdown();
          applyMode({ kind:'register' });
          startCountdown(RECEIPT_RESET_MS / 1000);
          if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
          resetTimerRef.current = setTimeout(() => { applyMode({ kind:'idle' }); stopCountdown(); }, RECEIPT_RESET_MS);
        }
      } catch { /* ignore */ }
    };

    ws.onclose = () => {
      if (!isMountedRef.current) return;
      setWsStatus('disconnected');
      reconnectTimerRef.current = setTimeout(() => { if (isMountedRef.current) connect(); }, 3000);
    };
    ws.onerror = () => ws.close();
  }, [shopId, branchId, scheduleReset, startCountdown, stopCountdown, applyMode]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimerRef.current)  clearTimeout(reconnectTimerRef.current);
      if (resetTimerRef.current)      clearTimeout(resetTimerRef.current);
      if (paidTransitionRef.current)  clearTimeout(paidTransitionRef.current);
      if (countdownRef.current)       clearInterval(countdownRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  function handleReset() {
    stopCountdown();
    applyMode({ kind:'idle' });
    if (resetTimerRef.current)     { clearTimeout(resetTimerRef.current);    resetTimerRef.current = null; }
    if (paidTransitionRef.current) { clearTimeout(paidTransitionRef.current); paidTransitionRef.current = null; }
  }

  const wsLabel =
    wsStatus === 'connected'  ? 'เชื่อมต่อแล้ว' :
    wsStatus === 'connecting' ? 'กำลังเชื่อมต่อ...' :
                                'ขาดการเชื่อมต่อ';

  const displayName = shopInfo?.name ?? 'POS CLOUD';

  /* confetti: 22 dots matching design */
  const confettiColors = ['#00e676','#00d4ff','#ffb300','#a855f7','#ff4560','#fff'];

  return (
    <div className="pd-wrap">

      {/* ── Status bar ── */}
      <div className={`pd-status pd-status--${wsStatus}`}>
        <span className="pd-status__dot" />
        {wsLabel}
      </div>

      {/* ══════════════════ IDLE ══════════════════ */}
      {mode.kind === 'idle' && (
        <div className="pd-idle">
          <div className="pd-idle__scan">
            <div className="pd-idle__scan-ring" />
            <div className="pd-idle__scan-ring" />
            <div className="pd-idle__scan-ring" />
            <div className="pd-idle__scan-inner">
              {shopInfo?.logoUrl ? (
                <Image src={shopInfo.logoUrl} alt={displayName} width={56} height={56} className="pd-idle__logo" />
              ) : (
                <span style={{ fontSize: 30 }}>🧾</span>
              )}
            </div>
          </div>
          <p className="pd-idle__title">รอการชำระเงิน</p>
          <p className="pd-idle__sub">ระบบจะแสดงยอดชำระเงิน<br />อัตโนมัติเมื่อแคชเชียร์พร้อม</p>
          <p className="pd-idle__shop">{displayName}</p>
        </div>
      )}

      {/* ══════════════════ CASH ══════════════════ */}
      {mode.kind === 'cash' && (
        <div className="pd-cash">
          <div className="pd-cash__header">
            <span className="pd-cash__shop">{mode.shopName || displayName}</span>
            <span className="pd-cash__pill">#{String(mode.orderNumber).padStart(4, '0')}</span>
          </div>
          <div className="pd-cash__body">
            <div className="pd-cash__icon-ring">💵</div>
            <p className="pd-cash__lbl">ยอดรวมสุทธิ</p>
            <p className="pd-cash__total">
              <span className="pd-cash__cur">฿</span>{fmt(mode.total)}
            </p>
            <div className="pd-cash__method">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>
              </svg>
              ชำระด้วยเงินสด
            </div>
          </div>
          <button className="pd-reset-btn" onClick={handleReset}>↩ รีเซ็ต</button>
        </div>
      )}

      {/* ══════════════════ QR ══════════════════ */}
      {mode.kind === 'qr' && (
        <div style={{
          position: 'absolute', top: 80, bottom: 0, left: 0, right: 0,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12,
        }}>
          <PromptPayCard
            qrValue={mode.qrPayload}
            total={mode.total}
            shopName={mode.shopName || displayName}
            accountName={mode.accountName}
            promptpayNumber={mode.promptpayNumber}
            logoUrl={shopInfo?.logoUrl}
            onExpired={handleReset}
          />
          <button className="pd-reset-btn" onClick={handleReset}>↩ รีเซ็ต</button>
        </div>
      )}

      {/* ══════════════════ PAID ══════════════════ */}
      {mode.kind === 'paid' && (
        <div className="pd-paid">
          {/* Confetti — 22 dots */}
          <div className="pd-paid__confetti" aria-hidden="true">
            {Array.from({ length: 22 }).map((_, i) => {
              const size = (i % 3) * 2 + 3;
              return (
                <span
                  key={i}
                  className="pd-conf"
                  style={{
                    width: size, height: size,
                    background: confettiColors[i % confettiColors.length],
                    left: `${(i * 4.5 + 2) % 100}%`,
                    top: `${(i * 3) % 30 - 20}px`,
                    animationDuration: `${(i % 2) * 1 + 2}s`,
                    animationDelay: `${(i * 0.09).toFixed(2)}s`,
                  }}
                />
              );
            })}
          </div>
          <div className="pd-paid__ring">
            <span className="pd-paid__check">✅</span>
          </div>
          <p className="pd-paid__title">ชำระเรียบร้อย!</p>
          <p className="pd-paid__sub">ขอบคุณที่ใช้บริการ 🙏</p>
          <div className="pd-paid__card">
            <div className="pd-paid__card-lbl">ยอดที่ชำระ</div>
            <div className="pd-paid__card-amt">
              <span className="pd-paid__card-cur">฿</span>{fmt(mode.total)}
            </div>
          </div>
          <div className="pd-paid__thank">
            <span style={{ fontSize: 16 }}>🎉</span>
            พบกันใหม่ครั้งหน้า
          </div>
        </div>
      )}

      {/* ══════════════════ RECEIPT ══════════════════ */}
      {mode.kind === 'receipt' && (() => {
        const receiptUrl = `${origin}/receipt/${mode.receiptToken}`;
        const totalSecs  = RECEIPT_RESET_MS / 1000;
        return (
          <div className="pd-receipt">
            <div className="pd-receipt__header">
              <div className="pd-receipt__paid-pill">
                <span className="pd-receipt__paid-dot" />
                ชำระเงินสำเร็จ
              </div>
              <CountdownRing seconds={countdown} total={totalSecs} color="#34d399" />
            </div>
            <div className="pd-receipt__amount-row">
              <div>
                <div className="pd-receipt__amount-lbl">ยอดชำระ</div>
                <div className="pd-receipt__amount-val">
                  <span className="pd-receipt__amount-cur">฿</span>{fmt(mode.total)}
                </div>
              </div>
              <span className="pd-receipt__seq">#{String(mode.dailySeq).padStart(4, '0')}</span>
            </div>
            <div className="pd-receipt__card">
              <p className="pd-receipt__cta">สแกน QR รับใบเสร็จ</p>
              <div className="pd-receipt__qr-wrap">
                <QRCode value={receiptUrl} size={180} bgColor="#ffffff" fgColor="#000000" level="M" />
              </div>
              <div className="pd-receipt__hint">
                บันทึก
                <span className="pd-receipt__hint-dot" />
                แชร์
                <span className="pd-receipt__hint-dot" />
                ไม่ต้องใช้กระดาษ
              </div>
            </div>
            <div className="pd-receipt__btns">
              <button
                className="pd-receipt__print-btn"
                onClick={() => {
                  const w = window.open(receiptUrl, '_blank', 'width=420,height=700');
                  if (w) { w.onload = () => w.print(); }
                }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" width="16" height="16">
                  <path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>
                </svg>
                พิมพ์ใบเสร็จ
              </button>
              <button className="pd-reset-btn" onClick={handleReset}>↩ ปิด</button>
            </div>
          </div>
        );
      })()}

      {/* ══════════════════ REGISTER ══════════════════ */}
      {mode.kind === 'register' && (() => {
        const totalSecs   = RECEIPT_RESET_MS / 1000;
        const registerUrl = origin && shopId ? `${origin}/register/${shopId}` : '';
        return (
          <div className="pd-register">
            <div className="pd-register__header">
              <div className="pd-register__logo-box">
                {shopInfo?.logoUrl ? (
                  <Image src={shopInfo.logoUrl} alt={displayName} width={44} height={44} className="pd-register__logo-img" />
                ) : (
                  <span>⭐</span>
                )}
              </div>
              <div className="pd-register__head-text">
                <div className="pd-register__title">สมัครสมาชิกสะสมแต้ม</div>
                <div className="pd-register__sub">{displayName} · สแกน QR ด้วยมือถือ</div>
              </div>
              <CountdownRing seconds={countdown} total={totalSecs} color="#a855f7" />
            </div>
            <div className="pd-register__card">
              <p className="pd-register__cta">สแกน QR เพื่อสมัครสมาชิก</p>
              <div className="pd-register__benefits">
                <div className="pd-register__benefit">
                  <span className="pd-register__benefit-ico">🎁</span>
                  <span className="pd-register__benefit-txt">สะสมแต้มทุกการซื้อ</span>
                </div>
                <div className="pd-register__benefit">
                  <span className="pd-register__benefit-ico">💰</span>
                  <span className="pd-register__benefit-txt">แลกส่วนลด</span>
                </div>
                <div className="pd-register__benefit">
                  <span className="pd-register__benefit-ico">🎂</span>
                  <span className="pd-register__benefit-txt">ของขวัญวันเกิด</span>
                </div>
              </div>
              <div className="pd-register__qr-wrap">
                <QRCode
                  value={registerUrl || origin || ''}
                  size={170}
                  bgColor="#ffffff"
                  fgColor="#6d28d9"
                  level="M"
                />
              </div>
              <p className="pd-register__hint">
                กรอกชื่อและเบอร์โทร<br />เพื่อรับสิทธิ์สะสมแต้มและส่วนลด
              </p>
            </div>
            <button className="pd-reset-btn" onClick={handleReset}>↩ ปิด</button>
          </div>
        );
      })()}

    </div>
  );
}

/* ─────────────────────────────────────────── */
export default function PayPage() {
  return (
    <Suspense fallback={
      <div className="pd-wrap">
        <div className="pd-idle">
          <div className="pd-idle__scan">
            <div className="pd-idle__scan-ring" />
            <div className="pd-idle__scan-ring" />
            <div className="pd-idle__scan-ring" />
            <div className="pd-idle__scan-inner">⏳</div>
          </div>
          <p className="pd-idle__title">กำลังโหลด...</p>
        </div>
      </div>
    }>
      <PayContent />
    </Suspense>
  );
}
