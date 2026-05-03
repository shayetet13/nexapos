'use client';

import { useState, useEffect } from 'react';
import { fetchWithAuth } from '@/lib/supabase';
import { th } from '@/lib/locales/th';
import { type CustomerInfo } from '@/components/CustomersPanel';
const t = th.pos;
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

const PAYMENT_METHODS = [
  { id: 'cash' as const, label: 'เงินสด' },
  { id: 'qr' as const, label: 'QR Code' },
];

type PayM = 'cash' | 'qr';

export function CloseBillModal({
  shopId,
  sessionId,
  vatEnabled: _vatEnabled,
  promptpayNumber,
  orderNumber,
  onClose,
  onSuccess,
}: {
  shopId: string;
  sessionId: string;
  vatEnabled: boolean;
  promptpayNumber?: string | null;
  orderNumber: number;
  onClose: () => void;
  onSuccess: (data: { total: number; dailySeq: number; receiptToken: string; refCode?: string }) => void;
}) {
  const [loading, setLoading]     = useState(true);
  const [subtotal, setSubtotal]   = useState(0);
  const [err, setErr]             = useState<string | null>(null);
  const [method, setMethod]       = useState<PayM>('cash');
  const [received, setReceived]   = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [discountIn, setDiscountIn] = useState('');
  const [customer, setCustomer]   = useState<CustomerInfo | null>(null);
  const [usePoints, setUsePoints]  = useState(false);
  const [memberPhone, setMemberPhone] = useState('');

  useEffect(() => {
    let a = true;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const res = await fetchWithAuth(
          `${API_URL}/api/v1/shops/${shopId}/dining-sessions/${sessionId}/pending-total`,
        );
        const j   = await res.json();
        if (!res.ok) {
          if (a) setErr((j as { error?: { message?: string } }).error?.message ?? 'โหลดยอดไม่สำเร็จ');
        } else {
          const s = Number((j as { data?: { subtotal?: number } }).data?.subtotal ?? 0);
          if (a) setSubtotal(s);
        }
      } catch {
        if (a) setErr('เครือข่ายผิดพลาด');
      } finally {
        if (a) setLoading(false);
      }
    })();
    return () => { a = false; };
  }, [shopId, sessionId]);

  const maxRedeem   = customer ? Math.floor(customer.points / 100) * 100 : 0;
  const pointsDisc  = usePoints && customer ? Math.floor(maxRedeem / 100) * 10 : 0;
  const pointsToRedeem = usePoints ? maxRedeem : 0;

  const discNum = Math.min(Number(discountIn) || 0, subtotal - pointsDisc);
  const afterDisc  = Math.max(0, subtotal - pointsDisc - discNum);
  /** ปิดบิล: รวมยอดเท่ากับ backend (order.total รวม; ยังไม่เพิ่ม VAT แยก) */
  const grandTotal = afterDisc;
  const receivedNum = Number(received) || 0;
  const change = receivedNum - grandTotal;

  const fmt = (n: number) =>
    n.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

  async function searchMember() {
    const phone = memberPhone.trim().replace(/\s/g, '');
    if (!phone) return;
    const res  = await fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/customers?q=${encodeURIComponent(phone)}`);
    const j    = await res.json();
    const list = (j.data ?? []) as Array<{ id: string; name: string; phone?: string | null; points: number; birthday?: string | null; tier: string; total_spent: string }>;
    const ex   = list.find((c) => (c.phone ?? '').replace(/\s/g, '') === phone) ?? list[0];
    if (ex) {
      setCustomer({
        id: ex.id, name: ex.name, phone: ex.phone ?? undefined, points: ex.points, birthday: ex.birthday ?? undefined, tier: ex.tier as CustomerInfo['tier'], total_spent: Number(ex.total_spent), notes: undefined,
      });
      setMemberPhone('');
    }
  }

  async function pay() {
    if (method === 'cash' && receivedNum < grandTotal) return;
    setSubmitting(true);
    setErr(null);
    try {
      const res = await fetchWithAuth(
        `${API_URL}/api/v1/shops/${shopId}/dining-sessions/${sessionId}/close`,
        {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            payment_method:  method === 'qr' ? 'transfer' : 'cash',
            customer_id:     customer?.id,
            points_redeemed: pointsToRedeem,
            discount:        discNum,
            ...(method === 'cash' && receivedNum > 0 ? { cash_received: receivedNum } : {}),
          }),
        },
      );
      const j = await res.json() as { data?: { total?: number; dailySeq?: number; receiptToken?: string }; error?: { message?: string } };
      if (!res.ok) {
        setErr(j.error?.message ?? t.payment.failed);
        setSubmitting(false);
        return;
      }
      onSuccess({
        total:        Number(j.data?.total ?? grandTotal),
        dailySeq:     Number(j.data?.dailySeq ?? orderNumber),
        receiptToken: (j.data as { receiptToken?: string })?.receiptToken ?? '',
        refCode:      (j.data as { refCode?: string })?.refCode,
      });
    } catch {
      setErr('ชำระไม่สำเร็จ');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="cm" onClick={(e) => e.stopPropagation()}>
          <p className="p-4 text-center">กำลังโหลดยอดโต๊ะ…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="cm" onClick={(e) => e.stopPropagation()}>
        <div className="cm-head">
          <div className="cm-head__left">
            <span className="cm-head__title">ปิดบิลโต๊ะ</span>
            <span className="cm-head__id">#{String(orderNumber).padStart(4, '0')}</span>
          </div>
          <button type="button" onClick={onClose} className="cm-head__close" aria-label="ปิด">✕</button>
        </div>
        {err && <p className="px-3 py-1 text-amber-700 text-sm">{err}</p>}
        <div className="px-3 pb-2">
          <p className="text-sm text-neutral-500 mb-1">ยอดรวมรอบสั่ง (รอบ้านหลัง)</p>
          <p className="text-2xl font-bold">฿{fmt(subtotal)}</p>
        </div>
        <div className="cm-member cm-member--search px-3">
          <input
            type="tel"
            className="cm-member__phone-input"
            placeholder="เบอร์สมาชิก (ตอนปิดบิล)"
            value={memberPhone}
            onChange={(e) => setMemberPhone(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void searchMember()}
          />
          <button type="button" className="cm-member__phone-btn" onClick={() => void searchMember()}>ค้นหา</button>
        </div>
        {customer && (
          <div className="px-3 pb-2 flex items-center gap-2 text-sm">
            <span className="font-medium">{customer.name}</span>
            {maxRedeem >= 100 && (
              <label>
                <input type="checkbox" checked={usePoints} onChange={(e) => setUsePoints(e.target.checked)} />
                ใช้ {maxRedeem} pts
              </label>
            )}
            <button type="button" className="text-rose-600" onClick={() => setCustomer(null)}>✕</button>
          </div>
        )}
        <div className="px-3 py-1">
          <label className="text-xs text-neutral-500">ส่วนลดท้ายบิล (บาท)</label>
          <input
            type="number"
            className="input-field w-full mt-0.5"
            min={0}
            value={discountIn}
            onChange={(e) => setDiscountIn(e.target.value)}
          />
        </div>
        <div className="cm-sum px-3 py-2">
          <div className="cm-sum__row"><span>หลังหักแต้ม/ส่วนลด</span><span>฿{fmt(afterDisc)}</span></div>
          <div className="cm-sum__row cm-sum__row--total"><span>จ่ายรวม</span><span>฿{fmt(grandTotal)}</span></div>
        </div>
        <div className="px-3 flex gap-1 pb-1">
          {PAYMENT_METHODS.filter((m) => m.id !== 'qr' || !!promptpayNumber).map((m) => (
            <button
              key={m.id}
              type="button"
              className={`flex-1 py-1.5 rounded text-sm border ${method === m.id ? 'border-amber-600 bg-amber-50' : 'border-neutral-200'}`}
              onClick={() => setMethod(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
        {method === 'cash' && (
          <div className="px-3 pb-2">
            <input
              className="input-field w-full"
              inputMode="decimal"
              placeholder="รับเงิน"
              value={received}
              onChange={(e) => setReceived(e.target.value)}
            />
            {change >= 0 && receivedNum > 0 && (
              <p className="text-sm text-emerald-700 mt-0.5">ทอน ฿{fmt(change)}</p>
            )}
          </div>
        )}
        <div className="p-3 pt-0">
          <button
            type="button"
            className="btn-primary w-full"
            disabled={submitting || (method === 'cash' && receivedNum < grandTotal)}
            onClick={() => void pay()}
          >
            {submitting ? '…' : 'ยืนยันปิดบิล'}
          </button>
        </div>
      </div>
    </div>
  );
}
