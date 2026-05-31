'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function PosError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[POS] Page error:', error);
  }, [error]);

  return (
    <main className="pos-invalid">
      <p style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>⚠️</p>
      <p className="pos-invalid__text">
        {error.message || 'เกิดข้อผิดพลาด กรุณาลองใหม่'}
      </p>
      <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
        <button onClick={reset} className="pos-invalid__link" style={{ cursor: 'pointer', background: 'none', border: 'none' }}>
          ลองใหม่
        </button>
        <Link href="/select-shop" className="pos-invalid__link">
          เลือกร้านใหม่
        </Link>
      </div>
    </main>
  );
}
