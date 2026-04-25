'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { createSupabaseClient } from '@/lib/supabase';
import { PROVINCES, BKK_DISTRICTS, IS_BANGKOK } from '@/lib/thai-provinces';

// ใช้ Next.js API proxy routes แทนการเรียก backend โดยตรง (หลีกเลี่ยง CORS)
const PROXY_BASE = '/api/register';

// Internal steps: 0=email, 1=OTP, 2=password, 3=shop, 4=branch, 5=success
type InternalStep = 0 | 1 | 2 | 3 | 4 | 5;
type ProgressStep = 1 | 2 | 3 | 4;

const PROGRESS_LABELS: Record<ProgressStep, string> = {
  1: 'ยืนยันอีเมล',
  2: 'รหัสผ่าน',
  3: 'ข้อมูลร้าน',
  4: 'สาขา',
};

function internalToProgress(step: InternalStep): ProgressStep {
  if (step <= 1) return 1;
  if (step === 2) return 2;
  if (step === 3) return 3;
  return 4;
}

function maskEmail(email: string): string {
  const [user, domain] = email.split('@');
  if (!domain) return email;
  return `${user.slice(0, 2)}***@${domain}`;
}

function fmtCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function ProgressBar({ step }: { step: InternalStep }) {
  if (step === 5) return null;
  const progress = internalToProgress(step);
  return (
    <div className="reg-progress">
      {([1, 2, 3, 4] as ProgressStep[]).map((s) => (
        <div key={s} className="reg-progress__step">
          <div className={`reg-progress__circle${progress === s ? ' reg-progress__circle--active' : progress > s ? ' reg-progress__circle--done' : ''}`}>
            {progress > s ? '✓' : s}
          </div>
          <span className={`reg-progress__label${progress === s ? ' reg-progress__label--active' : ''}`}>
            {PROGRESS_LABELS[s]}
          </span>
          {s < 4 && <div className={`reg-progress__line${progress > s ? ' reg-progress__line--done' : ''}`} />}
        </div>
      ))}
    </div>
  );
}

export default function RegisterPage() {
  const [step, setStep]       = useState<InternalStep>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  // Step 0: Email
  const [email, setEmail] = useState('');

  // Step 1: OTP
  const [refCode, setRefCode]               = useState('');
  const [otpDigits, setOtpDigits]           = useState(['', '', '', '', '', '']);
  const [verifiedToken, setVerifiedToken]   = useState('');
  const [otpSecondsLeft, setOtpSecondsLeft] = useState(600);
  const [resendCooldown, setResendCooldown] = useState(0);
  const digitRefs = useRef<(HTMLInputElement | null)[]>([null, null, null, null, null, null]);

  // Step 2: Password
  const [password, setPassword]     = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [showPwd, setShowPwd]       = useState(false);

  // Step 3: Shop
  const [shopName, setShopName] = useState('');
  const [province, setProvince] = useState('');
  const [district, setDistrict] = useState('');

  // Step 4: Branch
  const [branchName, setBranchName] = useState('');

  // Step 5: Result
  const [shopCode, setShopCode] = useState<string | null>(null);
  const [shopId, setShopId]     = useState<string | null>(null);

  // ── OTP countdown ───────────────────────────────────────
  useEffect(() => {
    if (step !== 1 || otpSecondsLeft <= 0) return;
    const t = setInterval(() => setOtpSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [step, otpSecondsLeft]);

  // ── Resend cooldown ─────────────────────────────────────
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setInterval(() => setResendCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [resendCooldown]);

  // ── Verify OTP (auto-submit when 6 digits filled) ───────
  const verifyOtp = useCallback(async (digits: string[]) => {
    const code = digits.join('');
    if (code.length !== 6) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${PROXY_BASE}/verify-otp`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email, otp_code: code }),
      });
      const json = await res.json() as {
        success: boolean;
        data?:  { verified_token: string };
        error?: { message: string };
      };
      if (!res.ok) {
        setError(json.error?.message ?? 'รหัส OTP ไม่ถูกต้อง');
        setOtpDigits(['', '', '', '', '', '']);
        setTimeout(() => digitRefs.current[0]?.focus(), 80);
      } else {
        setVerifiedToken(json.data?.verified_token ?? '');
        setStep(2);
      }
    } catch {
      setError('เกิดข้อผิดพลาด กรุณาลองใหม่');
    } finally {
      setLoading(false);
    }
  }, [email]);

  // ── OTP digit input ─────────────────────────────────────
  function handleDigitChange(index: number, value: string) {
    const digit = value.replace(/\D/g, '').slice(-1);
    const next  = [...otpDigits];
    next[index] = digit;
    setOtpDigits(next);
    setError(null);
    if (digit && index < 5) digitRefs.current[index + 1]?.focus();
    if (next.every((d) => d !== '')) void verifyOtp(next);
  }

  function handleDigitKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !otpDigits[index] && index > 0) {
      digitRefs.current[index - 1]?.focus();
    }
  }

  function handleDigitPaste(e: React.ClipboardEvent) {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;
    e.preventDefault();
    const next = Array.from({ length: 6 }, (_, i) => pasted[i] ?? '');
    setOtpDigits(next);
    if (pasted.length === 6) void verifyOtp(next);
    else digitRefs.current[pasted.length]?.focus();
  }

  // ── Request OTP ─────────────────────────────────────────
  async function requestOtp(targetEmail = email) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${PROXY_BASE}/request-otp`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: targetEmail }),
      });
      const json = await res.json() as {
        success: boolean;
        data?:  { ref_code: string; expires_in: number };
        error?: { message: string };
      };
      if (!res.ok) {
        setError(json.error?.message ?? 'ส่ง OTP ไม่สำเร็จ');
      } else {
        setRefCode(json.data?.ref_code ?? '');
        setOtpSecondsLeft(json.data?.expires_in ?? 600);
        setOtpDigits(['', '', '', '', '', '']);
        setResendCooldown(60);
        setStep(1);
        setTimeout(() => digitRefs.current[0]?.focus(), 80);
      }
    } catch {
      setError('เกิดข้อผิดพลาด กรุณาลองใหม่');
    } finally {
      setLoading(false);
    }
  }

  // ── Postal code ─────────────────────────────────────────
  function postalCode(): string | undefined {
    if (!province) return undefined;
    if (IS_BANGKOK(province)) {
      return BKK_DISTRICTS.find((d) => d.name === district)?.postal
          ?? PROVINCES.find((p) => p.name === province)?.postal;
    }
    return PROVINCES.find((p) => p.name === province)?.postal;
  }

  // ── Navigation ───────────────────────────────────────────
  function goNext() {
    setError(null);
    if (step === 0) {
      if (!email.trim()) { setError('กรุณาใส่อีเมล'); return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError('อีเมลไม่ถูกต้อง'); return; }
      void requestOtp();
      return;
    }
    if (step === 2) {
      if (password.length < 8) { setError('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร'); return; }
      if (password !== confirmPwd) { setError('รหัสผ่านไม่ตรงกัน'); return; }
    }
    if (step === 3) {
      if (!shopName.trim()) { setError('กรุณาใส่ชื่อร้าน'); return; }
    }
    if (step === 4) {
      if (!branchName.trim()) { setError('กรุณาใส่ชื่อสาขา'); return; }
      void handleSubmit();
      return;
    }
    setStep((prev) => (prev + 1) as InternalStep);
  }

  function goBack() {
    setError(null);
    setStep((prev) => (prev - 1) as InternalStep);
  }

  // ── Final submit (step 4 → 5) ────────────────────────────
  async function handleSubmit() {
    setLoading(true);
    setError(null);
    try {
      const body: Record<string, string | undefined> = {
        email,
        password,
        verified_token: verifiedToken,
        shopName,
        province:    province    || undefined,
        district:    district    || undefined,
        postal_code: postalCode(),
        branchName:  branchName.trim(),
      };

      const res = await fetch(`${PROXY_BASE}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });

      const json = await res.json() as {
        success: boolean;
        data?:  { shopId: string; shopCode: string | null; shopName: string };
        error?: { message: string };
      };

      if (!res.ok) { setError(json.error?.message ?? 'สมัครไม่สำเร็จ'); return; }

      setShopCode(json.data?.shopCode ?? null);
      setShopId(json.data?.shopId ?? null);

      const supabase = createSupabaseClient();
      await supabase.auth.signInWithPassword({ email, password });

      setStep(5);
    } catch {
      setError('เกิดข้อผิดพลาด กรุณาลองใหม่');
    } finally {
      setLoading(false);
    }
  }

  function formatCode(code: string): string {
    if (code.length !== 10) return code;
    return `${code.slice(0, 5)}-${code.slice(5, 8)}-${code.slice(8, 10)}`;
  }

  // ─────────────────────────────────────────────────────────
  return (
    <main className="reg-page">
      <div className="reg-card">
        {/* Header */}
        <div className="reg-header">
          <h1 className="reg-header__title">NexaPos</h1>
          <p className="reg-header__sub">สมัครใช้งาน — เริ่มต้นใช้งานได้ทันที</p>
        </div>

        <ProgressBar step={step} />

        {/* ── Step 0: Email ──────────────────────────────── */}
        {step === 0 && (
          <div className="reg-form">
            <h2 className="reg-form__title">📧 อีเมลของคุณ</h2>
            <div className="reg-email-note">
              💡 กรุณาใช้อีเมลจริงเท่านั้น — ระบบจะส่งรหัส OTP เพื่อยืนยันตัวตน
            </div>
            <label className="reg-label">อีเมล *</label>
            <input
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input-field"
              autoComplete="email"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && goNext()}
            />
          </div>
        )}

        {/* ── Step 1: OTP ────────────────────────────────── */}
        {step === 1 && (
          <div className="reg-otp-wrap">
            <div className="reg-otp-header">
              <div className="reg-otp-icon">🔐</div>
              <h2 className="reg-form__title" style={{ margin: 0 }}>ยืนยันอีเมลของคุณ</h2>
              <p className="reg-otp-email">
                ส่งรหัส OTP ไปยัง <strong>{maskEmail(email)}</strong> แล้ว
              </p>
            </div>

            <div className="reg-otp-ref">
              <span className="reg-otp-ref__label">รหัสอ้างอิง</span>
              <span className="reg-otp-ref__code">{refCode}</span>
            </div>

            {/* 6 digit boxes */}
            <div className="reg-otp-inputs" onPaste={handleDigitPaste}>
              {otpDigits.map((digit, i) => (
                <input
                  key={i}
                  ref={(el) => { digitRefs.current[i] = el; }}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handleDigitChange(i, e.target.value)}
                  onKeyDown={(e) => handleDigitKeyDown(i, e)}
                  className={`reg-otp-digit${digit ? ' reg-otp-digit--filled' : ''}`}
                  disabled={loading}
                  autoComplete="one-time-code"
                />
              ))}
            </div>

            {loading && <p className="reg-otp-verifying">⏳ กำลังตรวจสอบ...</p>}

            <div className={`reg-otp-timer${otpSecondsLeft < 120 ? ' reg-otp-timer--urgent' : ''}`}>
              ⏱ หมดอายุใน <strong>{fmtCountdown(otpSecondsLeft)}</strong>
            </div>

            <button
              type="button"
              className="reg-otp-resend"
              onClick={() => void requestOtp()}
              disabled={resendCooldown > 0 || loading}
            >
              {resendCooldown > 0
                ? `ขอรหัสใหม่ได้ใน ${resendCooldown} วินาที`
                : 'ยังไม่ได้รับรหัส? ขอรหัสใหม่'}
            </button>

            <button
              type="button"
              className="reg-nav__back"
              style={{ alignSelf: 'flex-start', marginTop: '0.25rem' }}
              onClick={goBack}
              disabled={loading}
            >
              ← เปลี่ยนอีเมล
            </button>
          </div>
        )}

        {/* ── Step 2: Password ───────────────────────────── */}
        {step === 2 && (
          <div className="reg-form">
            <h2 className="reg-form__title">🔒 ตั้งรหัสผ่าน</h2>
            <label className="reg-label">รหัสผ่าน * <span className="reg-label__hint">(อย่างน้อย 8 ตัวอักษร)</span></label>
            <div className="reg-pwd-wrap">
              <input
                type={showPwd ? 'text' : 'password'}
                placeholder="รหัสผ่าน"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input-field"
                autoComplete="new-password"
                autoFocus
              />
              <button type="button" className="reg-pwd-toggle" onClick={() => setShowPwd((v) => !v)}>
                {showPwd ? '🙈' : '👁'}
              </button>
            </div>
            <label className="reg-label">ยืนยันรหัสผ่าน *</label>
            <input
              type={showPwd ? 'text' : 'password'}
              placeholder="ยืนยันรหัสผ่าน"
              value={confirmPwd}
              onChange={(e) => setConfirmPwd(e.target.value)}
              className="input-field"
              autoComplete="new-password"
              onKeyDown={(e) => e.key === 'Enter' && goNext()}
            />
          </div>
        )}

        {/* ── Step 3: Shop ───────────────────────────────── */}
        {step === 3 && (
          <div className="reg-form">
            <h2 className="reg-form__title">🏪 ข้อมูลร้าน</h2>
            <label className="reg-label">ชื่อร้าน *</label>
            <input
              type="text"
              placeholder="เช่น ร้านกาแฟสดใจดี"
              value={shopName}
              onChange={(e) => setShopName(e.target.value)}
              className="input-field"
              autoFocus
            />
            <label className="reg-label">จังหวัด <span className="reg-label__hint">(สำหรับ Shop ID)</span></label>
            <select
              value={province}
              onChange={(e) => { setProvince(e.target.value); setDistrict(''); }}
              className="input-field"
            >
              <option value="">— เลือกจังหวัด (ไม่บังคับ) —</option>
              {PROVINCES.map((p) => (
                <option key={p.postal} value={p.name}>{p.name}</option>
              ))}
            </select>
            {IS_BANGKOK(province) && (
              <>
                <label className="reg-label">เขต *</label>
                <select
                  value={district}
                  onChange={(e) => setDistrict(e.target.value)}
                  className="input-field"
                >
                  <option value="">— เลือกเขต —</option>
                  {BKK_DISTRICTS.map((d) => (
                    <option key={d.name} value={d.name}>{d.name}</option>
                  ))}
                </select>
              </>
            )}
            {province && (
              <div className="reg-code-preview">
                <span className="reg-code-preview__label">รหัสไปรษณีย์: </span>
                <span className="reg-code-preview__value">{postalCode() ?? '—'}</span>
                <span className="reg-code-preview__note">→ Shop ID จะถูก gen อัตโนมัติ</span>
              </div>
            )}
          </div>
        )}

        {/* ── Step 4: Branch ─────────────────────────────── */}
        {step === 4 && (
          <div className="reg-form">
            <h2 className="reg-form__title">🏢 สาขา</h2>
            <p className="reg-form__desc">กรุณาระบุชื่อสาขาของร้าน เพื่อเริ่มต้นใช้งาน</p>
            <label className="reg-label">ชื่อสาขา *</label>
            <input
              type="text"
              placeholder="เช่น สาขาหลัก / สาขาสยาม"
              value={branchName}
              onChange={(e) => setBranchName(e.target.value)}
              className="input-field"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && goNext()}
            />
          </div>
        )}

        {/* ── Step 5: Success ────────────────────────────── */}
        {step === 5 && (
          <div className="reg-success">
            <div className="reg-success__icon">🎉</div>
            <h2 className="reg-success__title">สมัครใช้งานสำเร็จ!</h2>
            <p className="reg-success__desc">ระบบได้สร้างบัญชีและร้านค้าให้เรียบร้อยแล้ว</p>

            {shopCode && (
              <div className="reg-success__code-wrap">
                <p className="reg-success__code-label">รหัสร้านของคุณ</p>
                <p className="reg-success__code">{formatCode(shopCode)}</p>
                <p className="reg-success__code-hint">บันทึกรหัสนี้ไว้เพื่อใช้อ้างอิง</p>
              </div>
            )}

            <div className="reg-success__actions">
              <a href={`/admin?shopId=${shopId ?? ''}`} className="btn-primary reg-success__btn">
                ไปหน้าจัดการร้าน →
              </a>
              <Link href="/pos" className="reg-success__link">ไปหน้า POS</Link>
            </div>
          </div>
        )}

        {/* Error */}
        {error && <p className="reg-error">{error}</p>}

        {/* Navigation — hidden on OTP step (auto-submit) and success */}
        {step !== 1 && step !== 5 && (
          <div className="reg-nav">
            {step > 0 && (
              <button
                type="button"
                className="reg-nav__back"
                onClick={goBack}
                disabled={loading}
              >
                ← ย้อนกลับ
              </button>
            )}
            <button
              type="button"
              className="btn-primary reg-nav__next"
              onClick={goNext}
              disabled={loading}
            >
              {loading
                ? (step === 0 ? '⏳ กำลังส่ง OTP...' : '⏳ กำลังสร้าง...')
                : step === 4
                  ? 'สร้างร้านค้า ✓'
                  : 'ถัดไป →'}
            </button>
          </div>
        )}

        {/* Footer */}
        {step < 5 && (
          <p className="reg-footer">
            มีบัญชีอยู่แล้ว?{' '}
            <Link href="/login" className="reg-footer__link">เข้าสู่ระบบ</Link>
          </p>
        )}
      </div>
    </main>
  );
}
