'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { createSupabaseClient } from '@/lib/supabase';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

function SetNewPasswordContent() {
  const params = useSearchParams();
  const router = useRouter();
  const email  = params.get('email') ?? '';

  // Gate check — ตรวจสอบว่า token ถูก used แล้วก่อนแสดงฟอร์ม
  const [gateStatus, setGateStatus] = useState<'checking' | 'ok' | 'denied'>('checking');

  const [password, setPassword]     = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [showPwd, setShowPwd]       = useState(false);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState<string | null>(null);

  // ── ตรวจสอบ token ตอน load ───────────────────────────────
  useEffect(() => {
    if (!email) {
      router.replace('/forgot-password');
      return;
    }
    void (async () => {
      try {
        const res = await fetch(`${API_URL}/api/v1/auth/forgot-password/status`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ email }),
        });
        if (!res.ok) { router.replace('/forgot-password'); return; }
        const json = await res.json() as { success: boolean; data: { used: boolean; expired: boolean } };
        if (json.data?.used) {
          setGateStatus('ok');
        } else {
          // Token ยังไม่ถูก used → redirect กลับ (ผู้ใช้ยังไม่ได้กด link ใน email)
          setGateStatus('denied');
          setTimeout(() => router.replace('/forgot-password'), 2500);
        }
      } catch {
        setGateStatus('denied');
        setTimeout(() => router.replace('/forgot-password'), 2500);
      }
    })();
  }, [email, router]);

  async function handleSubmit() {
    setError(null);
    if (password.length < 8) { setError('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร'); return; }
    if (password !== confirmPwd) { setError('รหัสผ่านไม่ตรงกัน'); return; }

    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/auth/set-new-password`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email, password, confirm_password: confirmPwd }),
      });
      const json = await res.json() as { success: boolean; error?: { message: string } };
      if (!res.ok) { setError(json.error?.message ?? 'เกิดข้อผิดพลาด'); return; }

      // Auto sign-in with new password
      const supabase = createSupabaseClient();
      const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
      if (signInErr) {
        router.push('/login?reset=success');
        return;
      }
      router.push('/select-shop');
    } catch {
      setError('เกิดข้อผิดพลาด กรุณาลองใหม่');
    } finally {
      setLoading(false);
    }
  }

  // ── Loading / gate check ─────────────────────────────────
  if (gateStatus === 'checking') {
    return (
      <main className="page-login">
        <div className="page-login__container">
          <div className="fp-waiting">
            <div className="fp-waiting__spinner" />
            <p className="fp-waiting__email">กำลังตรวจสอบสถานะ...</p>
          </div>
        </div>
      </main>
    );
  }

  if (gateStatus === 'denied') {
    return (
      <main className="page-login">
        <div className="page-login__container">
          <div className="fp-waiting">
            <div className="fp-waiting__expired-icon">🔒</div>
            <p className="fp-waiting__email">กรุณายืนยันจากอีเมลก่อน</p>
            <p className="fp-waiting__hint">กำลังกลับไปหน้าลืมรหัสผ่าน...</p>
          </div>
        </div>
      </main>
    );
  }

  // ── Form ─────────────────────────────────────────────────
  return (
    <main className="page-login">
      <div className="page-login__container">
        <div className="page-login__header">
          <h1 className="page-login__title">🔒 ตั้งรหัสผ่านใหม่</h1>
          {email && (
            <p className="page-login__subtitle">สำหรับบัญชี <strong>{email}</strong></p>
          )}
        </div>

        <div className="page-login__form">
          <div>
            <label className="page-login__label">
              รหัสผ่านใหม่{' '}
              <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', fontWeight: 400 }}>
                (อย่างน้อย 8 ตัวอักษร)
              </span>
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type={showPwd ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input-field"
                placeholder="รหัสผ่านใหม่"
                autoComplete="new-password"
                autoFocus
                style={{ paddingRight: '2.8rem' }}
              />
              <button
                type="button"
                onClick={() => setShowPwd((v) => !v)}
                style={{ position: 'absolute', right: '0.7rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem' }}
              >
                {showPwd ? '🙈' : '👁'}
              </button>
            </div>
          </div>

          <div>
            <label className="page-login__label">ยืนยันรหัสผ่าน</label>
            <input
              type={showPwd ? 'text' : 'password'}
              value={confirmPwd}
              onChange={(e) => setConfirmPwd(e.target.value)}
              className="input-field"
              placeholder="ยืนยันรหัสผ่าน"
              autoComplete="new-password"
              onKeyDown={(e) => e.key === 'Enter' && void handleSubmit()}
            />
          </div>

          {error && <p className="page-login__error">{error}</p>}

          <button
            type="button"
            className="btn-primary btn-block"
            onClick={() => void handleSubmit()}
            disabled={loading}
          >
            {loading ? '⏳ กำลังบันทึก...' : '✅ บันทึกรหัสผ่านใหม่'}
          </button>
        </div>

        <p className="page-login__footer">
          <Link href="/login" className="page-login__link">← กลับหน้าเข้าสู่ระบบ</Link>
        </p>
      </div>
    </main>
  );
}

export default function SetNewPasswordPage() {
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
      <SetNewPasswordContent />
    </Suspense>
  );
}
