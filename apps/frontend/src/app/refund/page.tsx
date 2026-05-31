'use client';

import { useState, useCallback, useEffect, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { fetchWithAuth } from '@/lib/supabase';
import { API_URL } from '@/lib/config';

// ── Types ──────────────────────────────────────────────────────────────────
interface OrderItem {
  id: string;
  product_name: string;
  quantity: number;
  unit_price: string;
  subtotal: string;
}

interface OrderDetail {
  id: string;
  daily_seq: number;
  order_number: number;
  status: string;
  total: string;
  payment_method: string | null;
  created_at: string;
  branch_id: string;
  branch_name: string;
  items: OrderItem[];
}

interface ShopInfo {
  id: string;
  name: string;
}

type Step = 'search' | 'confirm' | 'otp' | 'done';
const REFUND_STEPS: Step[] = ['search', 'confirm', 'otp', 'done'];
type RefundType = 'money_mistake' | 'product_return';

const PAYMENT_LABELS: Record<string, string> = {
  cash: 'เงินสด', card: 'บัตร', transfer: 'โอน', other: 'อื่นๆ',
};

const REFUND_TYPES: { value: RefundType; label: string; desc: string; stock: boolean }[] = [
  { value: 'money_mistake', label: '💸 ทอนเงินผิด / รับเงินมาไม่ถึง', desc: 'ไม่คืน stock', stock: false },
  { value: 'product_return', label: '📦 ลูกค้าคืนสินค้า', desc: 'คืน stock + points', stock: true },
];

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('th-TH', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

// ── Main Component ─────────────────────────────────────────────────────────
export default function RefundPage() {
  return (
    <Suspense fallback={<div className="refund-page" style={{ display: 'flex', justifyContent: 'center', padding: '4rem' }}>⏳ กำลังโหลด...</div>}>
      <RefundContent />
    </Suspense>
  );
}

function RefundContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Shop selection
  const [shops,      setShops]      = useState<ShopInfo[]>([]);
  const [shopId,     setShopId]     = useState('');
  const [shopsLoaded, setShopsLoaded] = useState(false);

  // Search
  const [searchSeq,  setSearchSeq]  = useState('');
  const [searchDate, setSearchDate] = useState('');
  const [searching,  setSearching]  = useState(false);
  const [searchErr,  setSearchErr]  = useState('');
  const [foundOrder, setFoundOrder] = useState<OrderDetail | null>(null);

  // Confirm step
  const [refundType,    setRefundType]    = useState<RefundType>('product_return');
  const [reason,        setReason]        = useState('');
  const [cashReceived,  setCashReceived]  = useState('');
  const [requesting,    setRequesting]    = useState(false);
  const [reqErr,        setReqErr]        = useState('');

  // OTP step
  const [otp,        setOtp]        = useState('');
  const [confirming, setConfirming] = useState(false);
  const [otpErr,     setOtpErr]     = useState('');

  const [step, setStep] = useState<Step>('search');
  const stepItemRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Keep the active step visible when the row overflows (mobile / narrow tablet)
  useEffect(() => {
    const i = REFUND_STEPS.indexOf(step);
    const el = stepItemRefs.current[i];
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [step]);

  // Load shops on mount + pre-fill from URL params
  useEffect(() => {
    const urlShopId  = searchParams.get('shopId');
    const urlOrderId = searchParams.get('orderId');

    fetchWithAuth(`${API_URL}/api/v1/me/shops`)
      .then((r) => r.json())
      .then(async (j: { data?: ShopInfo[] }) => {
        const list = j.data ?? [];
        setShops(list);

        const resolvedShopId = urlShopId ?? (list.length === 1 ? list[0].id : '');
        if (resolvedShopId) setShopId(resolvedShopId);

        // If orderId passed from admin, auto-load the order
        if (urlOrderId && resolvedShopId) {
          try {
            const res  = await fetchWithAuth(`${API_URL}/api/v1/shops/${resolvedShopId}/orders/${urlOrderId}`);
            const json = await res.json() as { data?: OrderDetail };
            if (json.data && json.data.status === 'paid') {
              setFoundOrder(json.data);
              setStep('confirm');
            }
          } catch { /* ignore */ }
        }

        setShopsLoaded(true);
      })
      .catch(() => setShopsLoaded(true));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Search order ────────────────────────────────────────────────────────
  const handleSearch = useCallback(async () => {
    if (!shopId) return;
    setSearching(true);
    setSearchErr('');
    setFoundOrder(null);

    const params = new URLSearchParams();
    if (searchSeq)  params.set('seq',  searchSeq);
    if (searchDate) params.set('date', searchDate);
    params.set('status', 'paid');
    params.set('limit', '1');

    try {
      const res = await fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/orders?${params}`);
      const json = await res.json() as { data?: OrderDetail[] };
      const list = json.data ?? [];

      if (list.length === 0) {
        setSearchErr('ไม่พบออเดอร์ที่ชำระแล้วตามเงื่อนไขนี้');
        return;
      }

      // Load full detail
      const detailRes = await fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/orders/${list[0].id}`);
      const detailJson = await detailRes.json() as { data?: OrderDetail };
      if (detailJson.data) {
        setFoundOrder(detailJson.data);
        setStep('confirm');
      }
    } catch {
      setSearchErr('เกิดข้อผิดพลาด ลองใหม่อีกครั้ง');
    } finally {
      setSearching(false);
    }
  }, [shopId, searchSeq, searchDate]);

  // ── Derived: cash calc ──────────────────────────────────────────────────
  const cashCalc = (() => {
    if (refundType !== 'money_mistake' || !cashReceived || !foundOrder) return null;
    const cash  = Number(cashReceived);
    const total = Number(foundOrder.total);
    if (isNaN(cash) || cash <= 0) return null;
    const diff = cash - total;
    if (Math.abs(diff) < 0.01) return { type: 'ok' as const, diff: 0 };
    if (diff > 0) return { type: 'over'  as const, diff };
    return       { type: 'under' as const, diff: Math.abs(diff) };
  })();

  const canRequestOtp = reason.trim() && (
    refundType !== 'money_mistake' || (cashCalc !== null && cashCalc.type !== 'ok')
  );

  // ── Request OTP ─────────────────────────────────────────────────────────
  const handleRequestOtp = useCallback(async () => {
    if (!foundOrder || !shopId || !reason.trim()) return;
    setRequesting(true);
    setReqErr('');

    try {
      const res = await fetchWithAuth(
        `${API_URL}/api/v1/shops/${shopId}/orders/${foundOrder.id}/refund/request-otp`,
        { method: 'POST' },
      );
      if (!res.ok) {
        const j = await res.json() as { error?: { message?: string } };
        setReqErr(j?.error?.message ?? 'ส่งรหัสไม่สำเร็จ');
        return;
      }
      setStep('otp');
    } catch {
      setReqErr('เกิดข้อผิดพลาด ลองใหม่อีกครั้ง');
    } finally {
      setRequesting(false);
    }
  }, [foundOrder, shopId, reason]);

  // ── Confirm Refund ──────────────────────────────────────────────────────
  const handleConfirmRefund = useCallback(async () => {
    if (!foundOrder || !shopId || otp.length !== 4) return;
    setConfirming(true);
    setOtpErr('');

    try {
      const res = await fetchWithAuth(
        `${API_URL}/api/v1/shops/${shopId}/orders/${foundOrder.id}/refund`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            otp,
            reason,
            refund_type: refundType,
            ...(refundType === 'money_mistake' && cashReceived ? { cash_received: Number(cashReceived) } : {}),
          }),
        },
      );
      if (!res.ok) {
        const j = await res.json() as { error?: { message?: string } };
        setOtpErr(j?.error?.message ?? 'คืนเงินไม่สำเร็จ');
        return;
      }
      setStep('done');
    } catch {
      setOtpErr('เกิดข้อผิดพลาด ลองใหม่อีกครั้ง');
    } finally {
      setConfirming(false);
    }
  }, [foundOrder, shopId, otp, reason, refundType, cashReceived]);

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="refund-page">
      {/* Header */}
      <header className="refund-header">
        <button type="button" className="refund-back" onClick={() => router.back()}>← กลับ</button>
        <div>
          <h1 className="refund-title">💰 คืนเงิน</h1>
          <p className="refund-subtitle">Refund Management</p>
        </div>
      </header>

      {/* Step indicator */}
      <div className="refund-steps" role="navigation" aria-label="ขั้นตอนการคืนเงิน">
        {REFUND_STEPS.map((s, i) => {
          const labels = ['ค้นหาออเดอร์', 'เลือกประเภท', 'ใส่รหัส', 'สำเร็จ'];
          const active  = s === step;
          const done    = REFUND_STEPS.indexOf(s) < REFUND_STEPS.indexOf(step);
          return (
            <div
              key={s}
              ref={(el) => { stepItemRefs.current[i] = el; }}
              className={`refund-step ${active ? 'refund-step--active' : ''} ${done ? 'refund-step--done' : ''}`}
              aria-current={active ? 'step' : undefined}
            >
              <div className="refund-step__dot">{done ? '✓' : i + 1}</div>
              <span className="refund-step__label">{labels[i]}</span>
            </div>
          );
        })}
      </div>

      <div className="refund-body">

        {/* ── STEP 1: Search ────────────────────────────────────────────── */}
        {step === 'search' && (
          <div className="refund-card">
            <h2 className="refund-card__title">🔍 ค้นหาออเดอร์</h2>

            {/* Shop selector */}
            {shopsLoaded && shops.length > 1 && (
              <div className="refund-field">
                <label className="refund-label">ร้าน</label>
                <select className="refund-input" value={shopId} onChange={(e) => setShopId(e.target.value)}>
                  <option value="">เลือกร้าน...</option>
                  {shops.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="refund-row">
              <div className="refund-field">
                <label className="refund-label" htmlFor="r-seq">🔢 เลขออเดอร์</label>
                <input
                  id="r-seq"
                  className="refund-input"
                  type="number"
                  min={1}
                  placeholder="เช่น 42"
                  value={searchSeq}
                  onChange={(e) => setSearchSeq(e.target.value)}
                />
              </div>
              <div className="refund-field">
                <label className="refund-label" htmlFor="r-date">📅 วันที่</label>
                <input
                  id="r-date"
                  className="refund-input"
                  type="date"
                  value={searchDate}
                  onChange={(e) => setSearchDate(e.target.value)}
                />
              </div>
            </div>

            {searchErr && <p className="refund-error">{searchErr}</p>}

            <button
              type="button"
              className="refund-btn refund-btn--primary"
              onClick={handleSearch}
              disabled={searching || !shopId}
            >
              {searching ? '⏳ กำลังค้นหา...' : '🔍 ค้นหา'}
            </button>
          </div>
        )}

        {/* ── STEP 2: Confirm ───────────────────────────────────────────── */}
        {step === 'confirm' && foundOrder && (
          <div className="refund-card">
            <h2 className="refund-card__title">📋 รายละเอียดออเดอร์</h2>

            {/* Order summary */}
            <div className="refund-order-info">
              <div className="refund-info-row">
                <span className="refund-info-label">เลขออเดอร์</span>
                <span className="refund-info-value refund-info-value--mono">
                  #{String(foundOrder.daily_seq ?? foundOrder.order_number).padStart(4, '0')}
                </span>
              </div>
              <div className="refund-info-row">
                <span className="refund-info-label">วันที่</span>
                <span className="refund-info-value">{fmtDate(foundOrder.created_at)}</span>
              </div>
              <div className="refund-info-row">
                <span className="refund-info-label">สาขา</span>
                <span className="refund-info-value">{foundOrder.branch_name}</span>
              </div>
              <div className="refund-info-row">
                <span className="refund-info-label">ชำระด้วย</span>
                <span className="refund-info-value">
                  {foundOrder.payment_method ? PAYMENT_LABELS[foundOrder.payment_method] ?? foundOrder.payment_method : '—'}
                </span>
              </div>
              <div className="refund-total-row">
                <span>ยอดคืนเงิน</span>
                <span className="refund-total-amount">
                  ฿{Number(foundOrder.total).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>

            {/* Items list */}
            <div className="refund-items">
              <p className="refund-items-title">รายการสินค้า ({foundOrder.items?.length ?? 0})</p>
              {foundOrder.items?.map((item) => (
                <div key={item.id} className="refund-item-row">
                  <span className="refund-item-name">{item.product_name}</span>
                  <span className="refund-item-qty">×{item.quantity}</span>
                  <span className="refund-item-price">฿{Number(item.subtotal).toLocaleString('th-TH')}</span>
                </div>
              ))}
            </div>

            {/* Refund type */}
            <div className="refund-field">
              <label className="refund-label">ประเภทการคืนเงิน</label>
              <div className="refund-type-list">
                {REFUND_TYPES.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    className={`refund-type-btn ${refundType === t.value ? 'refund-type-btn--active' : ''}`}
                    onClick={() => setRefundType(t.value)}
                  >
                    <span className="refund-type-label">{t.label}</span>
                    <span className="refund-type-desc">{t.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* cash_received input — only for money_mistake */}
            {refundType === 'money_mistake' && (
              <div className="refund-field">
                <label className="refund-label" htmlFor="r-cash">
                  💵 จำนวนเงินที่รับมาจริง (บาท) <span className="refund-required">*</span>
                </label>
                <input
                  id="r-cash"
                  className="refund-input"
                  type="number"
                  min={0}
                  step={0.01}
                  placeholder="เช่น 200"
                  value={cashReceived}
                  onChange={(e) => setCashReceived(e.target.value)}
                />
                {cashCalc && (
                  <div className={`refund-cash-calc refund-cash-calc--${cashCalc.type}`}>
                    {cashCalc.type === 'over'  && <>🔴 รับเกินมา — ต้องทอนคืนลูกค้า <strong>฿{cashCalc.diff.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</strong><br/><small>({Number(cashReceived).toLocaleString('th-TH', { minimumFractionDigits: 2 })} − {Number(foundOrder!.total).toLocaleString('th-TH', { minimumFractionDigits: 2 })} = {cashCalc.diff.toLocaleString('th-TH', { minimumFractionDigits: 2 })})</small></>}
                    {cashCalc.type === 'under' && <>🟡 รับขาดมา — ลูกค้าค้างชำระ <strong>฿{cashCalc.diff.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</strong><br/><small>({Number(foundOrder!.total).toLocaleString('th-TH', { minimumFractionDigits: 2 })} − {Number(cashReceived).toLocaleString('th-TH', { minimumFractionDigits: 2 })} = {cashCalc.diff.toLocaleString('th-TH', { minimumFractionDigits: 2 })})</small></>}
                    {cashCalc.type === 'ok'    && <>✅ ยอดถูกต้อง — ไม่ต้องคืนเงิน</>}
                  </div>
                )}
              </div>
            )}

            {/* Reason */}
            <div className="refund-field">
              <label className="refund-label" htmlFor="r-reason">เหตุผล <span className="refund-required">*</span></label>
              <textarea
                id="r-reason"
                className="refund-input refund-textarea"
                rows={3}
                placeholder="ระบุเหตุผลการคืนเงิน..."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
              />
            </div>

            {reqErr && <p className="refund-error">{reqErr}</p>}

            <div className="refund-actions">
              <button type="button" className="refund-btn refund-btn--ghost" onClick={() => setStep('search')}>
                ← กลับ
              </button>
              <button
                type="button"
                className="refund-btn refund-btn--primary"
                onClick={handleRequestOtp}
                disabled={requesting || !canRequestOtp}
              >
                {requesting ? '⏳ กำลังส่งรหัส...' : '📲 ขอรหัสยืนยัน'}
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 3: OTP ───────────────────────────────────────────────── */}
        {step === 'otp' && foundOrder && (
          <div className="refund-card refund-card--centered">
            <div className="refund-otp-icon">🔐</div>
            <h2 className="refund-card__title">ใส่รหัสยืนยัน</h2>
            <p className="refund-otp-hint">
              รหัส 4 หลักถูกส่งไปยัง Telegram Bot ของร้าน<br/>
              รหัสหมดอายุใน <strong>10 นาที</strong>
            </p>

            <input
              className="refund-otp-input"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={4}
              placeholder="_ _ _ _"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 4))}
              autoFocus
            />

            {otpErr && <p className="refund-error">{otpErr}</p>}

            <div className="refund-actions refund-actions--centered">
              <button type="button" className="refund-btn refund-btn--ghost" onClick={() => { setStep('confirm'); setOtp(''); setOtpErr(''); }}>
                ← กลับ
              </button>
              <button
                type="button"
                className="refund-btn refund-btn--danger"
                onClick={handleConfirmRefund}
                disabled={confirming || otp.length !== 4}
              >
                {confirming ? '⏳ กำลังดำเนินการ...' : '✅ ยืนยันคืนเงิน'}
              </button>
            </div>

            <button
              type="button"
              className="refund-resend"
              onClick={() => { setStep('confirm'); setOtp(''); setOtpErr(''); }}
            >
              ขอรหัสใหม่
            </button>
          </div>
        )}

        {/* ── STEP 4: Done ──────────────────────────────────────────────── */}
        {step === 'done' && foundOrder && (
          <div className="refund-card refund-card--centered refund-card--success">
            <div className="refund-success-icon">✅</div>
            <h2 className="refund-card__title refund-card__title--success">คืนเงินสำเร็จ</h2>
            <p className="refund-success-detail">
              ออเดอร์ #{String(foundOrder.daily_seq ?? foundOrder.order_number).padStart(4, '0')}<br/>
              ยอด ฿{Number(foundOrder.total).toLocaleString('th-TH', { minimumFractionDigits: 2 })}<br/>
              บันทึกลง Audit Log แล้ว
            </p>

            {refundType === 'product_return' && (
              <p className="refund-success-note">📦 คืน Stock + Points ลูกค้าแล้ว</p>
            )}
            {refundType === 'money_mistake' && cashCalc && cashCalc.type !== 'ok' && (
              <p className={`refund-success-note`}>
                {cashCalc.type === 'over'
                  ? `🔴 คืนเงินลูกค้า ฿${cashCalc.diff.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`
                  : `🟡 บันทึกขาด ฿${cashCalc.diff.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`
                }
              </p>
            )}

            <div className="refund-actions refund-actions--centered">
              <button
                type="button"
                className="refund-btn refund-btn--ghost"
                onClick={() => {
                  setStep('search');
                  setFoundOrder(null);
                  setSearchSeq('');
                  setSearchDate('');
                  setOtp('');
                  setReason('');
                  setCashReceived('');
                }}
              >
                คืนเงินรายการใหม่
              </button>
              <button type="button" className="refund-btn refund-btn--primary" onClick={() => router.back()}>
                เสร็จสิ้น
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
