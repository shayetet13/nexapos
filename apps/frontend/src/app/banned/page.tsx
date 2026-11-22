'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

export default function BannedPage() {
  const [reason, setReason]           = useState<string | null>(null);
  const [isSuspended, setIsSuspended] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    setReason(params.get('reason'));
    setIsSuspended(params.get('type') === 'suspended');
  }, []);

  return (
    <main className="banned-page">
      <div className="banned-card">
        <div className="banned-icon">{isSuspended ? '⏸️' : '🚫'}</div>
        <h1 className="banned-title">
          {isSuspended ? 'ร้านค้าถูกระงับชั่วคราว' : 'ร้านค้าถูกระงับการใช้งาน'}
        </h1>

        {reason ? (
          <div className="banned-reason">
            <p className="banned-reason__label">สาเหตุ:</p>
            <p className="banned-reason__text">{reason}</p>
          </div>
        ) : (
          <p className="banned-desc">
            ไม่สามารถเข้าใช้งานร้านค้านี้ได้ในขณะนี้
          </p>
        )}

        <div className="banned-contact">
          <p className="banned-contact__label">หากต้องการความช่วยเหลือ กรุณาติดต่อ:</p>
          <a
            href="mailto:support@nexapos.io"
            className="banned-contact__email"
          >
            support@nexapos.io
          </a>
        </div>

        <Link href="/login" className="banned-back">
          ← กลับหน้าเข้าสู่ระบบ
        </Link>
      </div>
    </main>
  );
}
