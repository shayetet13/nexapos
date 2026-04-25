'use client';

import { useEffect } from 'react';

const PAY_LABEL: Record<string, string> = {
  cash: '💵 เงินสด', transfer: '📲 โอนเงิน', card: '💳 บัตร', qr: '📱 QR Code', other: '···',
};

export function SuccessModal({
  total, orderNumber, paymentMethod,
  printerEnabled,
  subtotal, totalDiscount, vatAmount, vatEnabled, discountLabel,
  receivedAmount, change, earnedPoints, newTotalPoints, refCode,
  receiptToken,
  onPrint, onClose,
}: {
  total: number;
  orderNumber: number;
  paymentMethod: string;
  printerEnabled: boolean;
  subtotal: number;
  totalDiscount: number;
  vatAmount: number;
  vatEnabled: boolean;
  discountLabel: string;
  receivedAmount?: number;
  change?: number;
  earnedPoints?: number;
  newTotalPoints?: number;
  refCode?: string;
  receiptToken?: string;
  onPrint: () => void;
  onClose: () => void;
}) {
  const fmt = (n: number) =>
    n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  useEffect(() => {
    const timer = setTimeout(onClose, 15000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const now = new Date();
  const dateStr = now.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
  const timeStr = now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="sm2" onClick={e => e.stopPropagation()}>

        {/* Glow bg */}
        <div className="sm2__glow" />

        {/* Check ring */}
        <div className="sm2__ring">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" width="44" height="44">
            <path d="M20 6L9 17l-5-5"/>
          </svg>
        </div>

        <div className="sm2__title">ชำระเงินสำเร็จ!</div>
        <div className="sm2__sub">
          ออเดอร์ #ORD-{String(orderNumber).padStart(4, '0')} · วันที่ {dateStr} · {timeStr}
        </div>
        {refCode && (
          <div className="sm2__refcode">
            อ้างอิง: <span className="sm2__refcode-val">{refCode}</span>
          </div>
        )}

        {/* Receipt card */}
        <div className="sm2__receipt">
          {/* Subtotal row */}
          <div className="sm2__row">
            <span className="sm2__row-l">ยอดรวมสินค้า</span>
            <span className="sm2__row-v">฿{fmt(subtotal)}</span>
          </div>

          {/* Discount row */}
          {totalDiscount > 0 && (
            <div className="sm2__row">
              <span className="sm2__row-l">{discountLabel}</span>
              <span className="sm2__row-v sm2__row-v--red">-฿{fmt(totalDiscount)}</span>
            </div>
          )}

          {/* VAT row */}
          {vatEnabled && vatAmount > 0 && (
            <div className="sm2__row">
              <span className="sm2__row-l">VAT 7%</span>
              <span className="sm2__row-v">฿{fmt(vatAmount)}</span>
            </div>
          )}

          {/* Grand total */}
          <div className="sm2__divider" />
          <div className="sm2__row sm2__row--grand">
            <span className="sm2__row-l sm2__row-l--grand">ยอดรวมสุทธิ</span>
            <span className="sm2__row-v sm2__row-v--big">฿{fmt(total)}</span>
          </div>

          {/* Payment method row */}
          <div className="sm2__divider" />
          <div className="sm2__row">
            <span className="sm2__row-l">ช่องทาง</span>
            <span className="sm2__row-v">{PAY_LABEL[paymentMethod] ?? paymentMethod}</span>
          </div>

          {/* Cash: received + change */}
          {receivedAmount !== undefined && receivedAmount > 0 && (
            <div className="sm2__row">
              <span className="sm2__row-l">รับเงินมา</span>
              <span className="sm2__row-v">฿{fmt(receivedAmount)}</span>
            </div>
          )}
          {change !== undefined && change >= 0 && (
            <div className="sm2__row">
              <span className="sm2__row-l">เงินทอน</span>
              <span className="sm2__row-v sm2__row-v--green">฿{fmt(change)}</span>
            </div>
          )}

          {/* Points */}
          {earnedPoints !== undefined && earnedPoints > 0 && (
            <>
              <div className="sm2__divider" />
              <div className="sm2__pts">
                ได้รับ <b>+{earnedPoints} pts</b>
                {newTotalPoints !== undefined && <> · คะแนนรวม <b>{newTotalPoints} pts</b></>}
              </div>
            </>
          )}
        </div>

        {/* Actions */}
        <div className="sm2__actions">
          {printerEnabled && (
            <button onClick={onPrint} className="sm2__btn sm2__btn--outline">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" width="16" height="16">
                <path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>
              </svg>
              พิมพ์ (เครื่องพิมพ์)
            </button>
          )}
          {receiptToken && (
            <button
              onClick={() => {
                const w = window.open(`/receipt/${receiptToken}`, '_blank', 'width=420,height=700');
                if (w) { w.onload = () => w.print(); }
              }}
              className="sm2__btn sm2__btn--outline"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" width="16" height="16">
                <path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>
              </svg>
              พิมพ์ใบเสร็จ
            </button>
          )}
          <button onClick={onClose} className="sm2__btn sm2__btn--primary">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" width="16" height="16">
              <path d="M12 5v14M5 12l7-7 7 7"/>
            </svg>
            ออเดอร์ใหม่
          </button>
        </div>

      </div>
    </div>
  );
}
