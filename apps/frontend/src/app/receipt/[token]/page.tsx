'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import QRCodeLib from 'react-qr-code';
const QRCode = QRCodeLib as unknown as (props: {
  value: string; size?: number; bgColor?: string; fgColor?: string;
  level?: string; style?: React.CSSProperties; className?: string;
}) => React.ReactElement;

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

const PAYMENT_LABELS: Record<string, string> = {
  cash: 'เงินสด',
  card: 'บัตรเครดิต',
  transfer: 'โอนเงิน',
  qr: 'QR Code',
  other: 'อื่นๆ',
};

interface ReceiptItem {
  id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: string;
  subtotal: string;
  note?: string | null;
}

interface Receipt {
  order_id: string;
  order_number: number;
  daily_seq: number;
  receipt_token: string;
  status: string;
  total: string;
  payment_method: string | null;
  created_at: string;
  branch_id: string;
  branch_name: string;
  branch_address: string | null;
  shop_id: string;
  shop_name: string;
  shop_logo_url: string | null;
  vat_enabled: boolean;
  discount: string | null;
  cash_received: string | null;
  points_earned: number;
  points_redeemed: number;
  staff_name: string;
  items: ReceiptItem[];
  ref_code: string | null;
  shop_phone: string | null;
  shop_tax_id: string | null;
  shop_address: string | null;
  shop_opening_hours: string | null;
  shop_working_days: string | null;
  shop_google_review_url: string | null;
}

const fmt = (n: number | string) =>
  Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = (d: string) =>
  new Date(d).toLocaleString('th-TH', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
    calendar: 'buddhist',
  });

export default function ReceiptPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token ?? '';

  const [receipt, setReceipt]   = useState<Receipt | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [saving, setSaving]     = useState(false);
  const billRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!token) return;
    fetch(`${API_URL}/api/v1/public/receipts/${token}`)
      .then(async (res) => {
        if (!res.ok) throw new Error('ไม่พบใบเสร็จ');
        const j = await res.json() as { data?: Receipt };
        if (!j.data) throw new Error('ไม่พบข้อมูล');
        setReceipt(j.data);
      })
      .catch((e: unknown) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [token]);

  const receiptUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/receipt/${token}`
    : '';

  const handleSave = async () => {
    if (!billRef.current) return;
    setSaving(true);
    try {
      const { default: html2canvas } = await import('html2canvas');
      const canvas = await html2canvas(billRef.current, {
        backgroundColor: '#ffffff',
        scale: 3,
        useCORS: true,
        logging: false,
      });
      const link = document.createElement('a');
      link.download = `receipt-${String(receipt?.daily_seq ?? 0).padStart(4, '0')}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <ReceiptSkeleton />;

  if (error || !receipt) {
    return (
      <div className="rcpt-error">
        <div className="rcpt-error__icon">🧾</div>
        <p className="rcpt-error__msg">{error ?? 'ไม่พบใบเสร็จ'}</p>
        <p className="rcpt-error__sub">ลิงก์อาจหมดอายุหรือไม่ถูกต้อง</p>
        <button className="rcpt-btn rcpt-btn--secondary" onClick={() => window.close()}>
          ปิดหน้าต่าง
        </button>
      </div>
    );
  }

  const subtotalBeforeVat = receipt.vat_enabled
    ? Number(receipt.total) / 1.07
    : Number(receipt.total);
  const vatAmount = receipt.vat_enabled ? Number(receipt.total) - subtotalBeforeVat : 0;

  return (
    <div className="rcpt-page">
      {/* Bill content — captured by html2canvas */}
      <div className="rcpt-bill" ref={billRef}>
        {/* Header */}
        <div className="rcpt-header">
          {receipt.shop_logo_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="rcpt-logo" src={receipt.shop_logo_url} alt="logo" crossOrigin="anonymous" />
          )}
          <h1 className="rcpt-shop-name">{receipt.shop_name}</h1>
          <p className="rcpt-branch">{receipt.branch_name}</p>
          {receipt.branch_address && <p className="rcpt-address">{receipt.branch_address}</p>}
          {receipt.shop_address && <p className="rcpt-address">{receipt.shop_address}</p>}
          {receipt.shop_phone && <p className="rcpt-shop-info">โทร: {receipt.shop_phone}</p>}
          {receipt.shop_tax_id && <p className="rcpt-shop-info">เลขประจำตัวผู้เสียภาษี: {receipt.shop_tax_id}</p>}
          {(receipt.shop_opening_hours || receipt.shop_working_days) && (
            <p className="rcpt-shop-info">
              {receipt.shop_working_days && `${receipt.shop_working_days} `}
              {receipt.shop_opening_hours && receipt.shop_opening_hours}
            </p>
          )}
          <div className="rcpt-divider rcpt-divider--dashed" />
          <p className="rcpt-title">
            {receipt.vat_enabled ? 'ใบเสร็จรับเงิน / ใบกำกับภาษีอย่างย่อ' : 'ใบเสร็จรับเงิน'}
          </p>
          <div className="rcpt-divider rcpt-divider--dashed" />
        </div>

        {/* Order meta */}
        <div className="rcpt-meta">
          <div className="rcpt-meta-row">
            <span>เลขที่</span>
            <span className="rcpt-meta-value">#{String(receipt.daily_seq).padStart(4, '0')}</span>
          </div>
          {receipt.ref_code && (
            <div className="rcpt-meta-row">
              <span>เลขอ้างอิง</span>
              <span className="rcpt-meta-value" style={{ fontFamily: 'var(--font-mono)', letterSpacing: '0.08em' }}>{receipt.ref_code}</span>
            </div>
          )}
          <div className="rcpt-meta-row">
            <span>วันที่</span>
            <span className="rcpt-meta-value">{fmtDate(receipt.created_at)}</span>
          </div>
          <div className="rcpt-meta-row">
            <span>ชำระด้วย</span>
            <span className="rcpt-meta-value">{PAYMENT_LABELS[receipt.payment_method ?? 'other'] ?? '—'}</span>
          </div>
          {receipt.staff_name && (
            <div className="rcpt-meta-row">
              <span>พนักงาน</span>
              <span className="rcpt-meta-value">{receipt.staff_name}</span>
            </div>
          )}
        </div>

        <div className="rcpt-divider rcpt-divider--solid" />

        {/* Items */}
        <table className="rcpt-items">
          <thead>
            <tr>
              <th className="rcpt-items__name">รายการ</th>
              <th className="rcpt-items__qty">จำนวน</th>
              <th className="rcpt-items__price">ราคา</th>
              <th className="rcpt-items__sub">รวม</th>
            </tr>
          </thead>
          <tbody>
            {receipt.items.map((item) => (
              <tr key={item.id}>
                <td className="rcpt-items__name">
                  {item.product_name}
                  {item.note && <div className="rcpt-item-note">📝 {item.note}</div>}
                </td>
                <td className="rcpt-items__qty">{item.quantity}</td>
                <td className="rcpt-items__price">{fmt(item.unit_price)}</td>
                <td className="rcpt-items__sub">{fmt(item.subtotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="rcpt-divider rcpt-divider--dashed" />

        {/* Totals */}
        <div className="rcpt-totals">
          {Number(receipt.discount) > 0 && (
            <div className="rcpt-total-row">
              <span>ส่วนลด</span>
              <span style={{ color: '#16a34a' }}>-฿{fmt(receipt.discount ?? 0)}</span>
            </div>
          )}
          {receipt.vat_enabled && (
            <>
              <div className="rcpt-total-row">
                <span>ยอดก่อน VAT</span>
                <span>฿{fmt(subtotalBeforeVat)}</span>
              </div>
              <div className="rcpt-total-row">
                <span>VAT 7%</span>
                <span>฿{fmt(vatAmount)}</span>
              </div>
            </>
          )}
          <div className="rcpt-total-row rcpt-total-row--grand">
            <span>ยอดรวมทั้งหมด</span>
            <span>฿{fmt(receipt.total)}</span>
          </div>
          {receipt.payment_method === 'cash' && receipt.cash_received && Number(receipt.cash_received) > 0 && (
            <>
              <div className="rcpt-total-row">
                <span>รับเงินสด</span>
                <span>฿{fmt(receipt.cash_received)}</span>
              </div>
              <div className="rcpt-total-row">
                <span>เงินทอน</span>
                <span style={{ color: '#2563eb', fontWeight: 700 }}>
                  ฿{fmt(Number(receipt.cash_received) - Number(receipt.total))}
                </span>
              </div>
            </>
          )}
          {receipt.points_redeemed > 0 && (
            <div className="rcpt-total-row">
              <span>แต้มที่ใช้</span>
              <span style={{ color: '#dc2626' }}>-{receipt.points_redeemed} แต้ม</span>
            </div>
          )}
          {receipt.points_earned > 0 && (
            <div className="rcpt-total-row">
              <span>แต้มที่ได้รับ</span>
              <span style={{ color: '#16a34a' }}>+{receipt.points_earned} แต้ม</span>
            </div>
          )}
        </div>

        <div className="rcpt-divider rcpt-divider--dashed" />

        {/* QR — Google Review (if configured) or receipt URL */}
        <div className="rcpt-qr-section">
          <p className="rcpt-qr-label">
            {receipt.shop_google_review_url ? 'สแกนรีวิวร้านค้า' : 'สแกนเพื่อดูใบเสร็จ'}
          </p>
          <div className="rcpt-qr-box">
            <QRCode value={receipt.shop_google_review_url || receiptUrl} size={96} />
          </div>
        </div>

        {/* Footer */}
        <div className="rcpt-footer">
          <p>ขอบคุณที่ใช้บริการ 🙏</p>
          <p className="rcpt-footer-sub">NexaPos · {receipt.shop_name}</p>
        </div>
      </div>

      {/* Action buttons — excluded from screenshot */}
      <div className="rcpt-actions" data-html2canvas-ignore>
        <button
          className="rcpt-btn rcpt-btn--print"
          onClick={() => window.print()}
        >
          🖨️ พิมพ์ใบเสร็จ
        </button>
        <button
          className="rcpt-btn rcpt-btn--save"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? '⏳ กำลังบันทึก...' : '💾 บันทึกเป็นรูป'}
        </button>
        <button
          className="rcpt-btn rcpt-btn--secondary"
          onClick={() => window.close()}
        >
          ✕ ปิด
        </button>
      </div>
    </div>
  );
}

function ReceiptSkeleton() {
  return (
    <div className="rcpt-page">
      <div className="rcpt-bill rcpt-bill--skeleton">
        {[80, 50, 40, 100, 60, 80].map((w, i) => (
          <div key={i} className="rcpt-skel" style={{ width: `${w}%` }} />
        ))}
      </div>
    </div>
  );
}
