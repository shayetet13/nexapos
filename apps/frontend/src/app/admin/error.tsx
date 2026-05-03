'use client';

import { useEffect } from 'react';

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[Admin] Page error:', error);
  }, [error]);

  return (
    <main className="page-admin">
      <div className="page-admin__content" style={{ textAlign: 'center', paddingTop: '4rem' }}>
        <p style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>⚠️</p>
        <h2 style={{ marginBottom: '0.5rem', color: 'var(--color-text)' }}>เกิดข้อผิดพลาด</h2>
        <p style={{ color: 'var(--color-text-muted)', marginBottom: '1.5rem' }}>
          {error.message || 'ไม่สามารถโหลดหน้าได้ กรุณาลองใหม่'}
        </p>
        <button onClick={reset} className="btn-primary">
          ลองใหม่
        </button>
      </div>
    </main>
  );
}
