'use client';
import { useState, useRef, useEffect } from 'react';
import { fetchWithAuth } from '@/lib/supabase';
import { API_URL } from '@/lib/config';

interface ResetTabProps { onReset: () => void; }

type Step = 'idle' | 'pin-sent' | 'success';

export function ResetTab({ onReset }: ResetTabProps) {
  const [step,         setStep]         = useState<Step>('idle');
  const [pinDigits,    setPinDigits]    = useState(['', '', '', '']);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const [countdown,    setCountdown]    = useState(0);
  const [resetCounts,  setResetCounts]  = useState<Record<string, number> | null>(null);
  const inputRefs = [
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
  ];
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  function startCountdown() {
    setCountdown(600); // 10 minutes
    timerRef.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(timerRef.current!);
          setStep('idle');
          setError('PIN หมดอายุแล้ว กรุณาขอใหม่');
          return 0;
        }
        return c - 1;
      });
    }, 1000);
  }

  async function handleRequestPin() {
    setLoading(true);
    setError(null);
    const res = await fetchWithAuth(`${API_URL}/api/v1/dev/reset/request-pin`, { method: 'POST' });
    const j   = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) { setError((j as { error?: { message?: string } }).error?.message ?? 'ส่ง PIN ไม่สำเร็จ'); return; }
    setStep('pin-sent');
    setPinDigits(['', '', '', '']);
    startCountdown();
    setTimeout(() => inputRefs[0].current?.focus(), 100);
  }

  function handleDigitChange(idx: number, val: string) {
    const digit = val.replace(/\D/g, '').slice(-1);
    const next  = [...pinDigits];
    next[idx]   = digit;
    setPinDigits(next);
    if (digit && idx < 3) inputRefs[idx + 1].current?.focus();
  }

  function handleDigitKeyDown(idx: number, e: React.KeyboardEvent) {
    if (e.key === 'Backspace' && !pinDigits[idx] && idx > 0) {
      inputRefs[idx - 1].current?.focus();
    }
  }

  async function handleConfirm() {
    const pin = pinDigits.join('');
    if (pin.length !== 4) { setError('กรุณากรอก PIN 4 หลักให้ครบ'); return; }
    setLoading(true);
    setError(null);
    const res = await fetchWithAuth(`${API_URL}/api/v1/dev/reset/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    });
    const j = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) { setError((j as { error?: { message?: string } }).error?.message ?? 'ยืนยันไม่สำเร็จ'); return; }
    clearInterval(timerRef.current!);
    setResetCounts((j as { data?: { counts?: Record<string, number> } }).data?.counts ?? {});
    setStep('success');
    onReset();
  }

  const fmtCountdown = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  const totalDeleted = resetCounts ? Object.values(resetCounts).reduce((a, b) => a + b, 0) : 0;

  return (
    <div className="reset-tab">
      {/* ── Step: idle ── */}
      {step === 'idle' && (
        <div className="reset-tab__card">
          <div className="reset-tab__warning-icon">☢️</div>
          <h2 className="reset-tab__title">รีเซตข้อมูลทดสอบทั้งหมด</h2>
          <p className="reset-tab__desc">
            จะลบข้อมูลทุกตารางในฐานข้อมูลอย่างถาวร<br/>
            <strong>ยกเว้น</strong> บัญชีผู้ใช้ (auth users)<br/>
            ใช้เฉพาะก่อน go-live เท่านั้น
          </p>
          <div className="reset-tab__table-list">
            {['shops','branches','products','orders','customers','stock','subscriptions','notifications','logs'].map((t) => (
              <span key={t} className="reset-tab__table-badge">🗑 {t}</span>
            ))}
          </div>
          {error && <div className="reset-tab__error">{error}</div>}
          <button
            className="reset-tab__btn-request"
            onClick={() => void handleRequestPin()}
            disabled={loading}
          >
            {loading ? '⏳ กำลังส่ง…' : '📧 ส่ง PIN ยืนยันไปที่ shayetet14@protonmail.com'}
          </button>
        </div>
      )}

      {/* ── Step: pin-sent ── */}
      {step === 'pin-sent' && (
        <div className="reset-tab__card">
          <div className="reset-tab__warning-icon">📧</div>
          <h2 className="reset-tab__title">ป้อน PIN 4 หลัก</h2>
          <p className="reset-tab__desc">
            ส่ง PIN ไปที่ <strong>shayetet14@protonmail.com</strong> แล้ว<br/>
            กรุณาตรวจสอบอีเมลและป้อนรหัส 4 หลัก
          </p>
          <div className="reset-tab__pin-row">
            {pinDigits.map((d, i) => (
              <input
                key={i}
                ref={inputRefs[i]}
                type="text"
                inputMode="numeric"
                maxLength={1}
                value={d}
                onChange={(e) => handleDigitChange(i, e.target.value)}
                onKeyDown={(e) => handleDigitKeyDown(i, e)}
                className={`reset-tab__pin-input${d ? ' reset-tab__pin-input--filled' : ''}`}
                aria-label={`PIN digit ${i + 1}`}
              />
            ))}
          </div>
          <div className="reset-tab__countdown">
            ⏱ หมดอายุใน {fmtCountdown(countdown)}
          </div>
          {error && <div className="reset-tab__error">{error}</div>}
          <div className="reset-tab__actions">
            <button className="reset-tab__btn-cancel" onClick={() => { setStep('idle'); setError(null); clearInterval(timerRef.current!); }}>
              ยกเลิก
            </button>
            <button
              className="reset-tab__btn-confirm"
              onClick={() => void handleConfirm()}
              disabled={loading || pinDigits.join('').length !== 4}
            >
              {loading ? '⏳ กำลังรีเซต…' : '🗑 ยืนยันรีเซตข้อมูล'}
            </button>
          </div>
        </div>
      )}

      {/* ── Step: success ── */}
      {step === 'success' && (
        <div className="reset-tab__card reset-tab__card--success">
          <div className="reset-tab__warning-icon">✅</div>
          <h2 className="reset-tab__title" style={{ color: 'var(--color-green)' }}>รีเซตเสร็จสิ้น</h2>
          <p className="reset-tab__desc">ลบข้อมูลทั้งหมด <strong style={{ color: 'var(--color-green)' }}>{totalDeleted} รายการ</strong> เรียบร้อยแล้ว</p>
          {resetCounts && (
            <div className="reset-tab__counts">
              {Object.entries(resetCounts).filter(([, v]) => v > 0).map(([k, v]) => (
                <div key={k} className="reset-tab__count-row">
                  <span className="reset-tab__count-table">{k}</span>
                  <span className="reset-tab__count-val">{v} rows</span>
                </div>
              ))}
            </div>
          )}
          <button className="reset-tab__btn-cancel" style={{ marginTop: '1.5rem' }} onClick={() => setStep('idle')}>
            🔄 รีเซตอีกครั้ง
          </button>
        </div>
      )}
    </div>
  );
}
