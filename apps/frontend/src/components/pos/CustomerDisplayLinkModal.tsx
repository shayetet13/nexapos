'use client';

import QRCodeLib from 'react-qr-code';
const QRCode = QRCodeLib as unknown as (props: {
  value: string; size?: number; bgColor?: string; fgColor?: string;
  level?: string; style?: React.CSSProperties; className?: string;
}) => React.ReactElement;
import { _displayWindow, setDisplayWindow } from './pos-types';

export function CustomerDisplayLinkModal({
  shopId, branchId, onClose,
}: { shopId: string; branchId: string; onClose: () => void }) {
  const displayMode: 'browser' | 'monitor' = (() => {
    try { return (localStorage.getItem(`display_mode_${shopId}`) as 'browser' | 'monitor') || 'browser'; }
    catch { return 'browser'; }
  })();

  const frontendBase = typeof window !== 'undefined' ? window.location.origin : '';
  const displayUrl   = `${frontendBase}/pay?shopId=${shopId}&branchId=${branchId}`;

  function openMonitor() {
    if (_displayWindow && !_displayWindow.closed) { _displayWindow.focus(); return; }
    const sw = typeof window !== 'undefined' ? window.screen.width       : 1920;
    const sh = typeof window !== 'undefined' ? window.screen.availHeight : 1080;
    const aw = typeof window !== 'undefined' ? window.screen.availWidth  : 1920;
    const popup = window.open(
      displayUrl,
      'pos_customer_display',
      `left=${sw},top=0,width=${aw},height=${sh},resizable=yes,scrollbars=no,toolbar=no,menubar=no`,
    );
    if (popup) setDisplayWindow(popup);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="customer-display-link" onClick={e => e.stopPropagation()}>
        <div className="checkout-modal__head">
          <h2 className="checkout-modal__title">
            {displayMode === 'monitor' ? '🖥️' : '📱'} Customer Display
          </h2>
          <button onClick={onClose} className="checkout-modal__close" aria-label="ปิด">✕</button>
        </div>

        <div className="customer-display-link__body">
          {displayMode === 'browser' ? (
            <>
              <p className="customer-display-link__hint">
                สแกน QR ด้วยมือถือเพื่อเปิดหน้าจ่ายเงิน<br />
                <span>เปิดค้างไว้ — ระบบอัปเดตอัตโนมัติเมื่อมีออเดอร์ใหม่</span>
              </p>
              <div className="customer-display-link__qr-wrap">
                <QRCode value={displayUrl} size={220} bgColor="#ffffff" fgColor="#000000" level="M" />
              </div>
              <p className="customer-display-link__url">{displayUrl}</p>
            </>
          ) : (
            <>
              <p className="customer-display-link__hint">
                เชื่อมต่อจอที่ 2 กับคอมพิวเตอร์<br />
                <span>กดปุ่มด้านล่างเพื่อเปิดหน้าจอแสดงผลบนจอที่ 2</span>
              </p>
              <button className="cdl-open-monitor" onClick={openMonitor}>
                🖥️ เปิดจอที่ 2
              </button>
              <p className="customer-display-link__url" style={{ fontSize: '0.72rem', marginTop: '0.5rem' }}>
                หน้าต่างจะเปิดที่จอที่ 2 โดยอัตโนมัติ<br />
                ถ้าหน้าต่างเปิดอยู่แล้ว ระบบจะโฟกัสหน้าต่างเดิม
              </p>
            </>
          )}
          <p className="cdl-settings-hint">
            เปลี่ยนโหมดได้ที่ ตั้งค่าร้าน → จอแสดงผลลูกค้า
          </p>
        </div>
      </div>
    </div>
  );
}
