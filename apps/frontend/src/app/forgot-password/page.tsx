'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { API_URL } from '@/lib/config';

function fmtCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export default function ForgotPasswordPage() {
  const router = useRouter();

  const [step, setStep]       = useState<0 | 1>(0);
  const [email, setEmail]     = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  // Countdown (120 seconds = 2 min)
  const [secondsLeft, setSecondsLeft] = useState(120);
  const pollRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Start countdown + polling when step=1 ───────────────
  useEffect(() => {
    if (step !== 1) return;

    // Countdown
    timerRef.current = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(timerRef.current!);
          clearInterval(pollRef.current!);
          return 0;
        }
        return s - 1;
      });
    }, 1000);

    // Polling every 3 seconds
    pollRef.current = setInterval(() => {
      void checkStatus();
    }, 3000);

    return () => {
      clearInterval(timerRef.current!);
      clearInterval(pollRef.current!);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  async function checkStatus() {
    try {
      const res = await fetch(`${API_URL}/api/v1/auth/forgot-password/status`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email }),
      });
      if (!res.ok) return;
      const json = await res.json() as { success: boolean; data: { used: boolean; expired: boolean } };
      if (json.data?.used) {
        clearInterval(timerRef.current!);
        clearInterval(pollRef.current!);
        router.push(`/set-new-password?email=${encodeURIComponent(email)}`);
      }
    } catch {
      // silent — keep polling
    }
  }

  async function handleRequestReset() {
    if (!email.trim()) { setError('กรุณาใส่อีเมล'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError('อีเมลไม่ถูกต้อง'); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/v1/auth/forgot-password`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: email.trim() }),
      });
      const json = await res.json() as { success: boolean; error?: { message: string } };
      if (!res.ok) { setError(json.error?.message ?? 'เกิดข้อผิดพลาด'); return; }
      setSecondsLeft(120);
      setStep(1);
    } catch {
      setError('เกิดข้อผิดพลาด กรุณาลองใหม่');
    } finally {
      setLoading(false);
    }
  }

  function handleRetry() {
    clearInterval(timerRef.current!);
    clearInterval(pollRef.current!);
    setStep(0);
    setSecondsLeft(120);
    setError(null);
  }

  const expired = step === 1 && secondsLeft <= 0;

  return (
    <main className="page-login">
      <div className="page-login__container">
        {/* Header */}
        <div className="page-login__header">
          <h1 className="page-login__title">🔑 ลืมรหัสผ่าน</h1>
          <p className="page-login__subtitle">
            {step === 0
              ? 'กรอกอีเมลเพื่อรับลิงก์รีเซ็ตรหัสผ่าน'
              : 'รอการยืนยันจากอีเมลของคุณ'}
          </p>
        </div>

        {/* ── Step 0: Email form ─────────────────────────── */}
        {step === 0 && (
          <div className="page-login__form">
            <div>
              <label htmlFor="fp-email" className="page-login__label">อีเมล</label>
              <input
                id="fp-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                autoFocus
                className="input-field"
                placeholder="you@example.com"
                onKeyDown={(e) => e.key === 'Enter' && void handleRequestReset()}
              />
            </div>

            {error && <p className="page-login__error">{error}</p>}

            <button
              type="button"
              onClick={() => void handleRequestReset()}
              disabled={loading}
              className="btn-primary btn-block"
            >
              {loading ? '⏳ กำลังส่ง...' : '📧 ส่งลิงก์รีเซ็ต'}
            </button>
          </div>
        )}

        {/* ── Step 1: Waiting / polling ──────────────────── */}
        {step === 1 && (
          <div className="fp-waiting">
            {/* Spinner + status */}
            {!expired ? (
              <>
                <div className="fp-waiting__spinner" />

                <p className="fp-waiting__email">
                  ส่งลิงก์ยืนยันไปยัง<br />
                  <strong>{email}</strong>
                </p>

                <p className="fp-waiting__hint">
                  เปิดอีเมลบนโทรศัพท์/คอมพิวเตอร์ แล้วกดลิงก์ยืนยัน<br />
                  หน้านี้จะไปหน้าตั้งรหัสใหม่โดยอัตโนมัติ
                </p>

                {/* Countdown */}
                <div className={`fp-countdown${secondsLeft < 30 ? ' fp-countdown--urgent' : ''}`}>
                  <span className="fp-countdown__label">ลิงก์หมดอายุใน</span>
                  <span className="fp-countdown__time">{fmtCountdown(secondsLeft)}</span>
                </div>

                <p className="fp-waiting__spam">
                  ไม่พบอีเมล? ตรวจสอบโฟลเดอร์ Spam / Junk
                </p>
              </>
            ) : (
              /* Expired state */
              <>
                <div className="fp-waiting__expired-icon">⏰</div>
                <p className="fp-waiting__email">ลิงก์หมดอายุแล้ว</p>
                <p className="fp-waiting__hint">กรุณาขอลิงก์รีเซ็ตใหม่อีกครั้ง</p>
                <button
                  type="button"
                  className="btn-primary btn-block"
                  onClick={handleRetry}
                >
                  ← ขอลิงก์ใหม่
                </button>
              </>
            )}
          </div>
        )}

        <p className="page-login__footer">
          <Link href="/login" className="page-login__link">← กลับหน้าเข้าสู่ระบบ</Link>
        </p>
      </div>
    </main>
  );
}
