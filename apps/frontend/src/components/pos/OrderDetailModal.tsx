'use client';

import { PAY_ICONS, STATUS_STYLES, STATUS_TH, type OrderDetail } from './pos-types';

export function OrderDetailModal({
  detail, loading, seqNum, shopName, onClose,
}: {
  detail: OrderDetail | null;
  loading: boolean;
  seqNum: number | null;
  shopName: string;
  onClose: () => void;
}) {

  const fmt = (n: number) =>
    n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const fmtDateTime = (iso: string) =>
    new Date(iso).toLocaleString('th-TH', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });

  const PAY_TH: Record<string, string> = {
    cash: 'เงินสด', card: 'บัตร', transfer: 'โอนเงิน', other: 'อื่นๆ',
  };

  function handlePrint() {
    window.print();
  }

  return (
    <div className="pos-order-detail-overlay" onClick={onClose}>
      <div className="pos-order-detail-modal" onClick={(e) => e.stopPropagation()}>
        <div className="pos-order-detail-modal__head">
          <div>
            <h2 className="pos-order-detail-modal__title">📋 รายละเอียดออเดอร์</h2>
            {detail && (
              <p className="pos-order-detail-modal__sub">{shopName} · {detail.branch_name}</p>
            )}
          </div>
          <button className="pos-order-detail-modal__close" onClick={onClose} aria-label="ปิด">✕</button>
        </div>

        <div className="pos-order-detail-modal__body" id="pos-order-print-area">
          {loading ? (
            <div className="pos-order-detail-modal__loading">⏳ กำลังโหลด...</div>
          ) : !detail ? (
            <div className="pos-order-detail-modal__empty">ไม่พบข้อมูลออเดอร์</div>
          ) : (
            <>
              <div className="pos-order-print-header">
                <p className="pos-order-print-shop">{shopName}</p>
                <p className="pos-order-print-branch">{detail.branch_name}</p>
                <p className="pos-order-print-title">
                  ใบรายงานออเดอร์{seqNum !== null ? ` #${String(seqNum).padStart(4, '0')}` : ''}
                </p>
              </div>

              <div className="pos-order-detail-meta">
                {seqNum !== null && (
                  <div className="pos-order-detail-meta__row">
                    <span className="pos-order-detail-meta__label">เลขออเดอร์</span>
                    <span className="pos-order-detail-meta__val pos-order-detail-meta__val--seq">
                      #{String(seqNum).padStart(4, '0')}
                    </span>
                  </div>
                )}
                <div className="pos-order-detail-meta__row">
                  <span className="pos-order-detail-meta__label">เวลา</span>
                  <span className="pos-order-detail-meta__val">{fmtDateTime(detail.created_at)}</span>
                </div>
                <div className="pos-order-detail-meta__row">
                  <span className="pos-order-detail-meta__label">ช่องทาง</span>
                  <span className="pos-order-detail-meta__val">
                    {PAY_ICONS[detail.payment_method ?? ''] ?? '···'} {PAY_TH[detail.payment_method ?? ''] ?? '-'}
                  </span>
                </div>
                <div className="pos-order-detail-meta__row">
                  <span className="pos-order-detail-meta__label">สถานะ</span>
                  <span className={`pos-today-item__status ${STATUS_STYLES[detail.status] ?? ''}`}>
                    {STATUS_TH[detail.status] ?? detail.status}
                  </span>
                </div>
                {detail.user_email && (
                  <div className="pos-order-detail-meta__row">
                    <span className="pos-order-detail-meta__label">ผู้ขาย</span>
                    <span className="pos-order-detail-meta__val">{detail.user_email}</span>
                  </div>
                )}
              </div>

              <table className="pos-order-detail-tbl">
                <thead>
                  <tr>
                    <th className="pos-order-detail-tbl__name">สินค้า</th>
                    <th className="pos-order-detail-tbl__num">จำนวน</th>
                    <th className="pos-order-detail-tbl__num">ราคา/หน่วย</th>
                    <th className="pos-order-detail-tbl__num">รวม</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.items.map((item) => (
                    <tr key={item.id}>
                      <td className="pos-order-detail-tbl__name">
                        {item.product_name}
                        {item.note && <div className="pos-order-detail-tbl__note">📝 {item.note}</div>}
                      </td>
                      <td className="pos-order-detail-tbl__num">{item.quantity}</td>
                      <td className="pos-order-detail-tbl__num">฿{fmt(Number(item.unit_price))}</td>
                      <td className="pos-order-detail-tbl__num pos-order-detail-tbl__subtotal">฿{fmt(Number(item.subtotal))}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3} className="pos-order-detail-tbl__total-label">ยอดรวมทั้งหมด</td>
                    <td className="pos-order-detail-tbl__total-val">฿{fmt(Number(detail.total))}</td>
                  </tr>
                </tfoot>
              </table>
            </>
          )}
        </div>

        {detail && !loading && (
          <div className="pos-order-detail-modal__foot">
            <button className="pos-order-detail-modal__cancel" onClick={onClose}>ปิด</button>

<button className="pos-order-detail-modal__print" onClick={handlePrint}>
              🖨️ Export PDF
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
