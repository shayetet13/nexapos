'use client';

import { useState, useEffect, useRef, useCallback, useMemo, type MutableRefObject } from 'react';
import QRCodeLib from 'react-qr-code';
const QRCode = QRCodeLib as unknown as (props: {
  value: string; size?: number; bgColor?: string; fgColor?: string;
  level?: string; style?: React.CSSProperties; className?: string;
}) => React.ReactElement;
import { fetchWithAuth, getAuthToken } from '@/lib/supabase';
import { th } from '@/lib/locales/th';
import { type CustomerInfo } from '@/components/CustomersPanel';
import {
  type CartItem,
  generatePromptPayPayload,
  isBirthdayToday,
  formatBirthdayDisplay,
} from './pos-types';

import { API_URL, API_URL_DIRECT as API_DIRECT } from '@/lib/config';
const t = th.pos;

const PAYMENT_METHODS = [
  { id: 'cash', label: 'เงินสด',  icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="13" height="13">
      <rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>
    </svg>
  )},
  { id: 'qr', label: 'QR Code', icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="13" height="13">
      <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
      <rect x="3" y="14" width="7" height="7"/>
      <path d="M14 14h3v3h-3zM20 17v4h-4M17 14h3"/>
    </svg>
  )},
] as const;

type PayMethod = 'cash' | 'qr';


export function CheckoutModal({
  shopId, branchId, cart, total, vatEnabled, shopLogoUrl, orderNumber, shopName,
  promptpayNumber, promptpayType = 'phone', promptpayName, discount, customer,
  birthdayBenefitType, birthdayBenefitValue = 0,
  posWsRef,
  onSelectCustomer, onClose, onSuccess,
}: {
  shopId: string;
  branchId: string;
  cart: CartItem[];
  total: number;
  vatEnabled: boolean;
  shopLogoUrl?: string | null;
  orderNumber: number;
  shopName: string;
  promptpayNumber?: string | null;
  promptpayType?: 'phone' | 'id_card';
  promptpayName?: string | null;
  discount: number;
  customer?: CustomerInfo | null;
  birthdayBenefitType?: 'percent' | 'fixed' | null;
  birthdayBenefitValue?: number;
  posWsRef?: MutableRefObject<WebSocket | null>;
  onSelectCustomer?: (customer: CustomerInfo | null) => void;
  onClose: () => void;
  onSuccess: (orderId: string, paidTotal: number, paymentMethod: string, dailySeq: number, receiptToken?: string, extras?: { subtotal: number; totalDiscount: number; vatAmount: number; receivedAmount?: number; change?: number; earnedPoints?: number; newTotalPoints?: number; refCode?: string }) => void;
}) {
  const [method, setMethod]         = useState<PayMethod>('cash');
  const [received, setReceived]     = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [usePoints, setUsePoints]   = useState(false);
  const [memberPhone, setMemberPhone]       = useState('');
  const [memberSearching, setMemberSearching] = useState(false);
  const [memberSearchError, setMemberSearchError] = useState<string | null>(null);
  const paidRef = useRef(false);

  const isCustomerBirthdayToday = !!customer?.birthday && isBirthdayToday(customer.birthday);
  useEffect(() => {
    if (customer && isBirthdayToday(customer.birthday) && customer.points >= 100) {
      setUsePoints(true);
    }
  }, [customer]);

  async function searchMemberByPhone() {
    const phone = memberPhone.trim().replace(/\s/g, '');
    if (!phone) { setMemberSearchError('กรุณาใส่เบอร์'); return; }
    setMemberSearchError(null);
    setMemberSearching(true);
    try {
      const res = await fetchWithAuth(
        `${API_URL}/api/v1/shops/${shopId}/customers?q=${encodeURIComponent(phone)}`,
      );
      const j = await res.json();
      const list = (j.data ?? []) as Array<{
        id: string; name: string; phone?: string | null; email?: string | null;
        birthday?: string | null; points: number; total_spent: string; tier: string; notes?: string | null;
      }>;
      const exact = list.find((c) => (c.phone ?? '').replace(/\s/g, '') === phone);
      const chosen = exact ?? list[0];
      if (chosen) {
        onSelectCustomer?.({
          id: chosen.id, name: chosen.name,
          phone: chosen.phone ?? undefined, email: chosen.email ?? undefined,
          birthday: chosen.birthday ?? undefined, points: chosen.points ?? 0,
          total_spent: Number(chosen.total_spent ?? 0),
          tier: (chosen.tier as CustomerInfo['tier']) ?? 'bronze',
          notes: chosen.notes ?? undefined,
        });
        setMemberPhone('');
      } else {
        setMemberSearchError('ไม่พบสมาชิกเบอร์นี้');
      }
    } catch {
      setMemberSearchError('ค้นหาไม่สำเร็จ');
    } finally {
      setMemberSearching(false);
    }
  }

  const maxRedeemablePoints = customer ? Math.floor(customer.points / 100) * 100 : 0;
  const pointsDiscount      = usePoints && customer ? Math.floor(maxRedeemablePoints / 100) * 10 : 0;
  const pointsToRedeem      = usePoints ? maxRedeemablePoints : 0;
  const earnedPoints        = customer ? Math.floor(total / 10) : 0;

  const afterPointsDiscount = total - discount - pointsDiscount;
  const birthdayDiscount =
    isCustomerBirthdayToday &&
    (birthdayBenefitType === 'percent' || birthdayBenefitType === 'fixed') &&
    birthdayBenefitValue > 0
      ? birthdayBenefitType === 'percent'
        ? Math.round((afterPointsDiscount * birthdayBenefitValue) / 100 * 100) / 100
        : Math.min(birthdayBenefitValue, afterPointsDiscount)
      : 0;

  const VAT_RATE      = 0.07;
  const totalDiscount = discount + pointsDiscount + birthdayDiscount;
  const vatAmount     = vatEnabled ? Math.round((total - totalDiscount) * VAT_RATE) : 0;
  const grandTotal    = total - totalDiscount + vatAmount;
  const receivedNum   = Number(received) || 0;
  const change        = receivedNum - grandTotal;

  const fmt = (n: number) =>
    n.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

  const availableMethods = PAYMENT_METHODS.filter(m => m.id !== 'qr' || !!promptpayNumber);

  // QR payload: generated once per (method=qr + amount + number) — nonce inside ensures uniqueness
  // useMemo prevents nonce from changing on every render
  const qrPayload = useMemo(() => {
    if (!promptpayNumber || method !== 'qr') return '';
    return generatePromptPayPayload(promptpayNumber, grandTotal, promptpayType);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method, promptpayNumber, promptpayType, grandTotal]);

  /** ส่ง event ไปยัง customer display
   *  Fast path: existing POS WebSocket (no auth overhead, no HTTP round-trip)
   *  Fallback: REST API (if WS unavailable) */
  const postDisplay = useCallback(async (body: Record<string, unknown>) => {
    // Fast path — piggy-back on the already-authenticated POS WebSocket
    const ws = posWsRef?.current;
    if (ws?.readyState === 1) {
      ws.send(JSON.stringify(body));
      return;
    }
    // Fallback: REST (e.g. WS not yet connected on first open)
    try {
      const token = await getAuthToken();
      if (!token) return;
      const res = await fetch(`${API_DIRECT}/api/v1/shops/${shopId}/display`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) console.warn('[display]', res.status, await res.text().catch(() => ''));
    } catch (err) {
      console.warn('[display]', err);
    }
  }, [shopId, posWsRef]);

  const sendDisplay = useCallback((m: PayMethod, gt: number) => {
    const base = { order_number: orderNumber, shop_name: shopName, total: gt };
    const body = m === 'qr' && promptpayNumber
      ? { type: 'CHECKOUT_QR', payload: { ...base, qr_payload: qrPayload, account_name: promptpayName ?? '', promptpay_number: promptpayNumber ?? '', promptpay_type: promptpayType } }
      : { type: 'CHECKOUT_CASH', payload: base };
    void postDisplay(body);
  }, [orderNumber, shopName, promptpayNumber, promptpayName, promptpayType, qrPayload, postDisplay]);

  // Broadcast checkout screen to customer display on mount
  useEffect(() => {
    sendDisplay(method, grandTotal);
    return () => {
      if (!paidRef.current) {
        void postDisplay({ type: 'CHECKOUT_CLOSE', payload: {} });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId]);

  // Re-broadcast when method or total changes
  useEffect(() => {
    sendDisplay(method, grandTotal);
  }, [method, sendDisplay, grandTotal]);

  async function handlePay() {
    if (method === 'cash' && receivedNum < grandTotal) return;
    setSubmitting(true);
    setError(null);

    const res = await fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        branch_id:       branchId,
        items:           cart.map(i => ({ product_id: i.product.id, quantity: i.quantity, ...(i.note?.trim() ? { note: i.note.trim() } : {}) })),
        payment_method:  method === 'qr' ? 'transfer' : method,
        customer_id:     customer?.id,
        points_redeemed: pointsToRedeem,
        discount:        discount,
        ...(method === 'cash' && receivedNum > 0 ? { cash_received: receivedNum } : {}),
      }),
    });

    const json = await res.json();
    if (!res.ok) {
      const raw = json?.error ?? json;
      const msg = typeof raw === 'string' ? raw : (typeof raw?.message === 'string' ? raw.message : null);
      setError(msg ?? t.payment.failed);
      setSubmitting(false);
      return;
    }

    paidRef.current = true;
    const apiDailySeq     = Number(json.data?.dailySeq) || orderNumber;
    const apiReceiptToken = (json.data as { receiptToken?: string; refCode?: string })?.receiptToken;
    const apiRefCode      = (json.data as { refCode?: string })?.refCode;

    // CHECKOUT_PAID is broadcast by the backend (order.service.ts) synchronously during
    // order creation — faster and more reliable than a second REST call from the browser.
    onSuccess(json.data?.orderId ?? '', grandTotal, method === 'qr' ? 'transfer' : method, apiDailySeq, apiReceiptToken, {
      subtotal: total,
      totalDiscount,
      vatAmount,
      receivedAmount: method === 'cash' ? receivedNum : undefined,
      change: method === 'cash' && receivedNum >= grandTotal ? change : undefined,
      earnedPoints: earnedPoints > 0 ? earnedPoints : undefined,
      newTotalPoints: customer ? customer.points - pointsToRedeem + earnedPoints : undefined,
      refCode: apiRefCode,
    });
    setSubmitting(false);
  }

  // Numpad key handler
  function handleNumKey(k: string) {
    if (k === 'C')   { setReceived(''); return; }
    if (k === 'DEL') { setReceived(prev => prev.slice(0, -1)); return; }
    setReceived(prev => {
      if (prev.length >= 7) return prev;
      return prev + k;
    });
  }

  const canPay = method === 'qr' || receivedNum >= grandTotal;
  const hasCustomer = !!customer;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="cm" onClick={e => e.stopPropagation()}>

        {/* ── HEADER ── */}
        <div className="cm-head">
          <div className="cm-head__left">
            <span className="cm-head__dot" />
            <span className="cm-head__title">ชำระเงิน</span>
            <span className="cm-head__id">#{String(orderNumber).padStart(4, '0')}</span>
          </div>
          <div className="cm-head__right">
            <button onClick={onClose} className="cm-head__close" aria-label="ปิด">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" width="14" height="14">
                <path d="M18 6 6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>
        </div>

        {/* ── MEMBER BAR ── */}
        {hasCustomer ? (
          <div className="cm-member">
            <div className="cm-member__av">{customer!.name.slice(0,1).toUpperCase()}</div>
            <span className="cm-member__name">{customer!.name}</span>
            <span className="cm-member__pts">
              คะแนน: <b>{customer!.points.toLocaleString()} pts</b>
            </span>
            {customer!.birthday && (
              <span className="cm-member__bday">🎂 {formatBirthdayDisplay(customer!.birthday)}</span>
            )}
            {maxRedeemablePoints >= 100 && (
              <label className="cm-member__redeem">
                <input type="checkbox" checked={usePoints} onChange={e => setUsePoints(e.target.checked)} />
                <span>ใช้ {maxRedeemablePoints} pts ลด ฿{fmt(pointsDiscount)}</span>
              </label>
            )}
            <button
              type="button"
              className="cm-member__tier"
              onClick={() => onSelectCustomer?.(null)}
              title="ยกเลิกลูกค้า"
            >
              {customer!.tier === 'gold' ? '⭐ Gold' : customer!.tier === 'silver' ? '🥈 Silver' : '🥉 Bronze'} ✕
            </button>
          </div>
        ) : (
          <div className="cm-member cm-member--search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14" style={{flexShrink:0,opacity:.5}}>
              <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
            </svg>
            <input
              type="tel"
              className="cm-member__phone-input"
              placeholder="เบอร์สมาชิก (ถ้ามี)"
              value={memberPhone}
              onChange={e => { setMemberPhone(e.target.value); setMemberSearchError(null); }}
              onKeyDown={e => e.key === 'Enter' && searchMemberByPhone()}
            />
            <button
              type="button"
              className="cm-member__phone-btn"
              onClick={searchMemberByPhone}
              disabled={memberSearching}
            >
              {memberSearching ? '⏳' : 'ค้นหา'}
            </button>
            {memberSearchError && <span className="cm-member__phone-err">{memberSearchError}</span>}
          </div>
        )}

        {/* ── LEFT PANEL ── */}
        <div className="cm-left">
          <div className="cm-sec-lbl">รายการสินค้า</div>
          <div className="cm-items">
            {cart.map(item => (
              <div key={item.product.id} className="cm-item">
                <div className="cm-item__left">
                  <div className="cm-item__name">{item.product.name}</div>
                  <div className="cm-item__unit">฿{fmt(Number(item.product.price))} × {item.quantity}</div>
                  {item.note?.trim() && (
                    <div className="cm-item__note">📝 {item.note.trim()}</div>
                  )}
                </div>
                <div className="cm-item__qty">×{item.quantity}</div>
                <div className="cm-item__price">฿{fmt(Number(item.product.price) * item.quantity)}</div>
              </div>
            ))}
            {discount > 0 && (
              <div className="cm-item cm-item--dim">
                <div className="cm-item__left">
                  <div className="cm-item__name cm-item__name--red">ส่วนลด</div>
                  <div className="cm-item__unit">โปรโมชั่น</div>
                </div>
                <div className="cm-item__qty cm-item__qty--dim">—</div>
                <div className="cm-item__price cm-item__price--red">-฿{fmt(discount)}</div>
              </div>
            )}
            {pointsDiscount > 0 && (
              <div className="cm-item cm-item--dim">
                <div className="cm-item__left">
                  <div className="cm-item__name cm-item__name--red">แลกแต้ม ({pointsToRedeem} pts)</div>
                  <div className="cm-item__unit">สมาชิก</div>
                </div>
                <div className="cm-item__qty cm-item__qty--dim">—</div>
                <div className="cm-item__price cm-item__price--red">-฿{fmt(pointsDiscount)}</div>
              </div>
            )}
            {birthdayDiscount > 0 && (
              <div className="cm-item cm-item--dim">
                <div className="cm-item__left">
                  <div className="cm-item__name cm-item__name--red">ส่วนลดวันเกิด{birthdayBenefitType === 'percent' ? ` (${birthdayBenefitValue}%)` : ''}</div>
                  <div className="cm-item__unit">🎂 Birthday</div>
                </div>
                <div className="cm-item__qty cm-item__qty--dim">—</div>
                <div className="cm-item__price cm-item__price--red">-฿{fmt(birthdayDiscount)}</div>
              </div>
            )}
          </div>
          <div className="cm-sum">
            <div className="cm-sum__row"><span>รวมสินค้า</span><span>฿{fmt(total)}</span></div>
            {totalDiscount > 0 && (
              <div className="cm-sum__row cm-sum__row--red"><span>ส่วนลดรวม</span><span>-฿{fmt(totalDiscount)}</span></div>
            )}
            {vatEnabled && (
              <div className="cm-sum__row"><span>VAT 7%</span><span>฿{fmt(vatAmount)}</span></div>
            )}
            <div className="cm-sum__div" />
            <div className="cm-sum__row cm-sum__row--total"><span>ยอดรวมสุทธิ</span><span>฿{fmt(grandTotal)}</span></div>
          </div>
        </div>

        {/* ── RIGHT PANEL ── */}
        <div className="cm-right">
          {/* Method tabs */}
          {availableMethods.length > 1 && (
            <div className="cm-ptabs">
              {availableMethods.map(m => (
                <button
                  key={m.id}
                  className={`cm-ptab${method === m.id ? ' cm-ptab--active' : ''}`}
                  onClick={() => setMethod(m.id as PayMethod)}
                >
                  {m.icon}{m.label}
                </button>
              ))}
            </div>
          )}

          {/* CASH PANEL */}
          {method === 'cash' && (
            <>
              {/* Amount display */}
              <div className="cm-amtbox">
                <div className="cm-amtbox__lbl">รับเงินมา (บาท)</div>
                <div className="cm-amtbox__val">
                  <span className="cm-amtbox__cur">฿</span>
                  {receivedNum > 0 ? receivedNum.toLocaleString('th-TH') : grandTotal.toLocaleString('th-TH')}
                </div>
              </div>

              {/* Quick chips */}
              <div className="cm-chips">
                <button
                  className={`cm-chip${received === String(grandTotal) ? ' cm-chip--on' : ''}`}
                  onClick={() => setReceived(String(Math.round(grandTotal)))}
                >
                  พอดี
                </button>
                {[20, 50, 100, 500].map(n => (
                  <button
                    key={n}
                    className="cm-chip"
                    onClick={() => setReceived(prev => String((Number(prev) || 0) + n))}
                  >
                    {n}
                  </button>
                ))}
              </div>

              {/* Numpad */}
              <div className="cm-numpad">
                {['7','8','9','4','5','6','1','2','3'].map(k => (
                  <button key={k} className="cm-key" onClick={() => handleNumKey(k)}>{k}</button>
                ))}
                <button className="cm-key cm-key--clr" onClick={() => handleNumKey('C')}>เคลียร์</button>
                <button className="cm-key" onClick={() => handleNumKey('0')}>0</button>
                <button className="cm-key cm-key--del" onClick={() => handleNumKey('DEL')}>⌫</button>
              </div>

              {/* Change */}
              <div className={`cm-change${change > 0 ? ' cm-change--pos' : ''}`}>
                <span>เงินทอน</span>
                <span className="cm-change__val">
                  {receivedNum >= grandTotal && received !== '' ? `฿${fmt(change)}` : '฿0'}
                </span>
              </div>
            </>
          )}

          {/* QR PANEL */}
          {method === 'qr' && (
            <div className="cm-qr-panel">
              <div className="cm-qr-panel__title">สแกน QR ชำระเงิน</div>
              <div className="cm-qr-panel__amount">
                <span className="cm-qr-panel__cur">฿</span>
                {fmt(grandTotal)}
              </div>
              <div className="cm-qr-panel__frame">
                <QRCode
                  value={qrPayload}
                  size={178}
                  bgColor="#ffffff"
                  fgColor="#000000"
                  level="M"
                />
              </div>
              <div className="cm-qr-panel__status">
                <span className="cm-qr-panel__dot" />
                <span>รอการชำระเงิน...</span>
              </div>
              {promptpayName && (
                <div className="cm-qr-panel__name">{promptpayName}</div>
              )}
            </div>
          )}

          {/* Error */}
          {error && <p className="cm-error">{error}</p>}

          {/* Confirm button */}
          <button
            className="cm-confirm-btn"
            onClick={handlePay}
            disabled={submitting || !canPay}
          >
            {submitting ? (
              <>⏳ กำลังบันทึก...</>
            ) : method === 'qr' ? (
              <>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" width="17" height="17"><path d="M20 6L9 17l-5-5"/></svg>
                ยืนยันรับเงินแล้ว
              </>
            ) : (
              <>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" width="17" height="17"><path d="M20 6L9 17l-5-5"/></svg>
                ยืนยันชำระเงิน ฿{fmt(grandTotal)}
              </>
            )}
          </button>
        </div>

      </div>
    </div>
  );
}
