'use client';

import { useEffect } from 'react';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[Dashboard] Page error:', error);
  }, [error]);

  return (
    <main style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', gap: '1rem', color: 'var(--color-text)' }}>
      <p style={{ fontSize: '2.5rem' }}>⚠️</p>
      <h2>เกิดข้อผิดพลาด</h2>
      <p style={{ color: 'var(--color-text-muted)' }}>{error.message || 'ไม่สามารถโหลดแดชบอร์ดได้'}</p>
      <button onClick={reset} className="btn-primary">ลองใหม่</button>
    </main>
  );
}
