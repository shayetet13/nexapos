'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { API_URL } from '@/lib/config';

function ResetPasswordContent() {
  const params = useSearchParams();
  const token  = params.get('token') ?? '';

  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) {
      setMessage('ลิงก์ไม่ถูกต้อง — ไม่พบ token');
      setStatus('error');
      return;
    }

    void (async () => {
      try {
        const res = await fetch(
          `${API_URL}/api/v1/auth/reset-password?token=${encodeURIComponent(token)}`,
        );
        const json = await res.json() as { success: boolean; error?: { message: string } };
        if (res.ok && json.success) {
          setStatus('success');
        } else {
          setMessage(json.error?.message ?? 'ลิงก์หมดอายุหรือไม่ถูกต้อง');
          setStatus('error');
        }
      } catch {
        setMessage('เกิดข้อผิดพลาด กรุณาลองใหม่');
        setStatus('error');
      }
    })();
  }, [token]);

  return (
    <main className="page-login">
      <div className="page-login__container">
        {status === 'loading' && (
          <div className="fp-waiting">
            <div className="fp-waiting__spinner" />
            <p className="fp-waiting__email">กำลังยืนยัน...</p>
          </div>
        )}

        {status === 'success' && (
          <div className="fp-reset-confirmed">
            <div className="fp-reset-confirmed__icon">✅</div>
            <h2 className="fp-reset-confirmed__title">ยืนยันสำเร็จ!</h2>
            <p className="fp-reset-confirmed__desc">
              กลับไปที่แท็บเล็ต / iPad ของคุณ<br />
              แล้วตั้งรหัสผ่านใหม่ได้เลย
            </p>
            <div className="fp-reset-confirmed__hint">
              หน้านี้ปิดได้แล้ว — ดำเนินการต่อที่เครื่อง POS
            </div>
          </div>
        )}

        {status === 'error' && (
          <div className="fp-reset-confirmed">
            <div className="fp-reset-confirmed__icon">❌</div>
            <h2 className="fp-reset-confirmed__title">เกิดข้อผิดพลาด</h2>
            <p className="fp-reset-confirmed__desc">{message}</p>
            <Link href="/forgot-password" className="btn-primary" style={{ display: 'block', textAlign: 'center', marginTop: '1rem' }}>
              ← ขอลิงก์ใหม่
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={
      <main className="page-login">
        <div className="page-login__container">
          <div className="fp-waiting">
            <div className="fp-waiting__spinner" />
            <p className="fp-waiting__email">กำลังโหลด...</p>
          </div>
        </div>
      </main>
    }>
      <ResetPasswordContent />
    </Suspense>
  );
}
