'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { PAY_ICONS, STATUS_STYLES, STATUS_TH, type TodayOrder } from './pos-types';

export function TodayOrdersPanel({
  orders, loading, totalCount, shopId, onClose, onSelectOrder,
}: {
  orders: TodayOrder[];
  loading: boolean;
  totalCount: number;
  shopId: string;
  onClose: () => void;
  onSelectOrder: (orderId: string, seqNum: number) => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    if (!mounted) return;
    document.body.classList.add('pos-today-open');
    return () => { document.body.classList.remove('pos-today-open'); };
  }, [mounted]);

  useEffect(() => {
    if (!mounted) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); };
  }, [mounted, onClose]);

  const fmt = (n: number) =>
    n.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });

  const frontendBase = typeof window !== 'undefined' ? window.location.origin : '';

  function castReceiptToDisplay(order: TodayOrder) {
    if (!order.receipt_token || !shopId) return;
    const url = `${frontendBase}/receipt/${order.receipt_token}`;
    window.open(url, `receipt_${order.id}`,
      'width=480,height=820,scrollbars=yes,resizable=yes,toolbar=no,menubar=no,location=no');
  }

  if (!mounted || typeof document === 'undefined') return null;

  return createPortal(
    <>
      <div className="pos-today-overlay" onClick={onClose} role="presentation" />
      <div className="pos-today-panel" role="dialog" aria-modal="true" aria-labelledby="pos-today-title">
        <div className="pos-today-panel__head">
          <button
            type="button"
            className="pos-today-panel__close"
            onClick={onClose}
            aria-label="ปิด"
          >
            <span className="pos-today-panel__close-icon" aria-hidden>✕</span>
          </button>
          <span id="pos-today-title" className="pos-today-panel__title">ออเดอร์วันนี้</span>
          <span className="pos-today-panel__count">{totalCount} ออเดอร์</span>
        </div>

        <div className="pos-today-panel__body">
          {loading ? (
            <div className="pos-today-panel__loading">⏳ กำลังโหลด...</div>
          ) : orders.length === 0 ? (
            <div className="pos-today-panel__empty">ยังไม่มีออเดอร์วันนี้</div>
          ) : (
            <ul className="pos-today-list">
              {orders.map((order) => {
                const displayNum = order.daily_seq ?? order.order_number ?? 0;
                return (
                  <li
                    key={order.id}
                    className="pos-today-item pos-today-item--clickable"
                    onClick={() => onSelectOrder(order.id, displayNum)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && onSelectOrder(order.id, displayNum)}
                  >
                    <span className="pos-today-item__seq">
                      #{String(displayNum).padStart(4, '0')}
                    </span>
                    <span className="pos-today-item__time">{fmtTime(order.created_at)}</span>
                    <span className="pos-today-item__pay">
                      {PAY_ICONS[order.payment_method ?? ''] ?? '···'}
                    </span>
                    <span className="pos-today-item__total">฿{fmt(Number(order.total))}</span>
                    <span className={`pos-today-item__status ${STATUS_STYLES[order.status] ?? ''}`}>
                      {STATUS_TH[order.status] ?? order.status}
                    </span>
                    {order.receipt_token && (
                      <button
                        className="pos-today-item__receipt-btn"
                        title="เปิดใบเสร็จ"
                        onClick={(e) => { e.stopPropagation(); castReceiptToDisplay(order); }}
                      >
                        🧾
                      </button>
                    )}
                    <span className="pos-today-item__arrow">›</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}
