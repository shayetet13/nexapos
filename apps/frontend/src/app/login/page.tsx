'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { QRCodeSVG } from 'qrcode.react';
import { createSupabaseClient } from '@/lib/supabase';
import { API_URL, WS_URL } from '@/lib/config';
import type { ShopMode } from '@/lib/work-area';
import { workAreaHref } from '@/lib/work-area';

const DEV_EMAILS = (process.env.NEXT_PUBLIC_DEV_ADMIN_EMAILS ?? '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

const QR_TTL = 45;

interface PosAssignment {
  role:       'owner' | 'manager' | 'cashier' | 'viewer';
  shopId:     string;
  shopName:   string;
  branchId:   string | null;
  branchName: string | null;
  shop_mode?: ShopMode;
}

type Mode = 'password' | 'qr' | 'staff';

interface QrSession {
  token:      string;
  expires_at: string;
}

/**
 * ตรวจสอบ pos-assignment และ redirect ให้เหมาะสม
 * - ถ้า banned/suspended → ไป /banned
 * - ถ้า assigned branchId → ไป /pos หรือ /dining (ตาม shop_mode)
 * - ถ้าไม่มี branchId → ไป /select-branch
 * Returns true if redirect happened, false if caller should handle error
 */
async function handlePosAssignment(
  token: string,
  apiUrl: string,
): Promise<{ ok: false; message: string } | { ok: true }> {
  const res = await fetch(`${apiUrl}/api/v1/me/pos-assignment`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await res.json() as {
    success: boolean;
    data?: PosAssignment | null;
    error?: { code?: string; message?: string; ban_reason?: string | null };
  };

  if (!res.ok) {
    const code      = json.error?.code ?? '';
    const banReason = json.error?.ban_reason ?? null;
    if (code === 'SHOP_BANNED' || code === 'SHOP_SUSPENDED') {
      const params = new URLSearchParams({ type: code === 'SHOP_BANNED' ? 'banned' : 'suspended' });
      if (banReason) params.set('reason', banReason);
      window.location.href = `/banned?${params}`;
      return { ok: true };
    }
    return { ok: false, message: json.error?.message ?? 'ไม่พบข้อมูลร้านที่กำหนดให้' };
  }

  const assignment = json.data as PosAssignment | null;
  if (!assignment) {
    return { ok: false, message: 'ยังไม่ได้รับการกำหนดสาขา กรุณาติดต่อ admin' };
  }

  const { shopId, shopName, branchId, branchName, shop_mode } = assignment;
  const mode = shop_mode ?? 'retail';
  if (branchId) {
    window.location.href = workAreaHref({
      shopId, shopName: shopName ?? '', branchId, branchName: branchName ?? '', shopMode: mode,
    });
  } else {
    window.location.href = `/select-branch?${new URLSearchParams({ shopId, shopName: shopName ?? '', from: 'login' })}`;
  }
  return { ok: true };
}

// ─── QR LOGIN PANEL ───────────────────────────────────────────────────────────
function QrLoginPanel() {
  const [session, setSession]     = useState<QrSession | null>(null);
  const [status, setStatus]       = useState<'loading' | 'waiting' | 'confirmed' | 'error'>('loading');
  const [countdown, setCountdown] = useState(QR_TTL);
  const wsRef    = useRef<WebSocket | null>(null);
  const pollRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const appOrigin = typeof window !== 'undefined' ? window.location.origin : '';

  const closeWsAndPoll = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    clearInterval(pollRef.current!);
    pollRef.current = null;
  }, []);

  const createSession = useCallback(async () => {
    closeWsAndPoll();
    setStatus('loading');
    setSession(null);
    try {
      const res  = await fetch(`${API_URL}/api/v1/auth/qr-session`, { method: 'POST' });
      const json = await res.json();
      if (!json.success) throw new Error('failed');
      setSession(json.data);
      setCountdown(QR_TTL);
      setStatus('waiting');
    } catch {
      setStatus('error');
    }
  }, [closeWsAndPoll]);

  useEffect(() => {
    createSession();
    return () => { closeWsAndPoll(); clearInterval(timerRef.current!); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    clearInterval(timerRef.current!);
    if (status !== 'waiting') return;
    timerRef.current = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) { createSession(); return QR_TTL; }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current!);
  }, [status, createSession]);

  useEffect(() => {
    if (status !== 'waiting' || !session) return;
    const token = session.token;

    function onConfirmed(loginToken: string) {
      closeWsAndPoll();
      clearInterval(timerRef.current!);
      timerRef.current = null;
      setStatus('confirmed');
      exchangeAndLogin(token, loginToken);
    }

    function startFallbackPoll() {
      if (pollRef.current) return;
      pollRef.current = setInterval(async () => {
        try {
          const res  = await fetch(`${API_URL}/api/v1/auth/qr-session/${token}`);
          const json = await res.json();
          if (!json.success) return;
          if (json.data.status === 'expired') { createSession(); return; }
          if (json.data.status === 'confirmed' && json.data.login_token) onConfirmed(json.data.login_token);
        } catch { /* ignore */ }
      }, 1500);
    }

    try {
      const ws = new WebSocket(`${WS_URL}/api/v1/ws-qr?t=${token}`);
      wsRef.current = ws;
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data as string) as { type: string; login_token?: string };
          if (data.type === 'QR_CONFIRMED' && data.login_token) onConfirmed(data.login_token);
        } catch { /* ignore */ }
      };
      ws.onerror = () => startFallbackPoll();
      ws.onclose = (e) => { if (e.code !== 1000 && e.code !== 1005) startFallbackPoll(); };
    } catch { startFallbackPoll(); }

    return () => {
      wsRef.current?.close(); wsRef.current = null;
      clearInterval(pollRef.current!); pollRef.current = null;
    };
  }, [status, session, createSession, closeWsAndPoll]);

  async function exchangeAndLogin(token: string, loginToken: string) {
    try {
      const res  = await fetch(`${API_URL}/api/v1/auth/qr-session/${token}/exchange`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login_token: loginToken }),
      });
      const json = await res.json();
      if (!json.success) { setStatus('error'); return; }

      const supabase = createSupabaseClient();
      const { error } = await supabase.auth.verifyOtp({ token_hash: json.data.token_hash, type: 'magiclink' });
      if (error) { setStatus('error'); return; }

      const { data: { session: s } } = await supabase.auth.getSession();
      const accessToken = s?.access_token;
      if (!accessToken) { setStatus('error'); return; }

      await handlePosAssignment(accessToken, API_URL);
    } catch { setStatus('error'); }
  }

  if (status === 'loading') return <div className="page-login-qr__loading">กำลังสร้าง QR Code...</div>;
  if (status === 'error') return (
    <div className="page-login-qr__error-wrap">
      <p className="page-login-qr__error-msg">เกิดข้อผิดพลาด</p>
      <button onClick={createSession} className="btn-primary" style={{ width: '100%' }}>ลองใหม่</button>
    </div>
  );
  if (status === 'confirmed') return (
    <div className="page-login-qr__confirmed-wrap">
      <div className="page-login-qr__confirmed-icon">✅</div>
      <p className="page-login-qr__confirmed-status">ยืนยันแล้ว</p>
      <p className="page-login-qr__confirmed-sub">กำลังเข้าสู่ระบบ...</p>
    </div>
  );

  const qrUrl     = `${appOrigin}/qr-auth?t=${session!.token}`;
  const TOTAL     = QR_TTL;
  const R         = 22;
  const CIRC      = 2 * Math.PI * R;
  const dash      = (countdown / TOTAL) * CIRC;
  const ringColor = countdown <= 10 ? 'var(--color-error)' : countdown <= 20 ? 'var(--color-warning)' : 'var(--color-primary)';

  return (
    <div className="page-login-qr__wrap">
      <p className="page-login-qr__hint">สแกน QR ด้วยโทรศัพท์เพื่อเข้าสู่ระบบที่เครื่องนี้</p>
      <div style={{ background: '#fff', borderRadius: '12px', padding: '12px', boxShadow: `0 0 0 3px ${ringColor}`, transition: 'box-shadow 0.4s ease' }}>
        <QRCodeSVG value={qrUrl} size={180} level="M" />
      </div>
      <div className="page-login-qr__timer-wrap">
        <svg width={60} height={60} style={{ transform: 'rotate(-90deg)' }}>
          <circle cx={30} cy={30} r={R} fill="none" style={{ stroke: 'var(--color-bg-hover)' }} strokeWidth={4} />
          <circle cx={30} cy={30} r={R} fill="none" style={{ stroke: ringColor, transition: 'stroke-dasharray 0.9s linear, stroke 0.4s ease' }} strokeWidth={4} strokeLinecap="round" strokeDasharray={`${dash} ${CIRC}`} />
          <text x={30} y={30} textAnchor="middle" dominantBaseline="central" style={{ transform: 'rotate(90deg)', transformOrigin: '30px 30px', fill: ringColor, fontSize: '13px', fontWeight: 700, fontFamily: 'system-ui, sans-serif', transition: 'fill 0.4s ease' }}>
            {countdown}
          </text>
        </svg>
        <p className={`page-login-qr__timer-label${countdown <= 10 ? ' page-login-qr__timer-label--urgent' : ''}`}>
          {countdown <= 10 ? '⚠️ กำลังหมดอายุ...' : 'หมดอายุใน'}
        </p>
      </div>
      <button type="button" onClick={createSession} className="page-login-qr__refresh-btn">🔄 สร้าง QR ใหม่</button>
    </div>
  );
}

// ─── STAFF PIN NUMPAD ─────────────────────────────────────────────────────────
const PIN_KEYS = ['1','2','3','4','5','6','7','8','9','⌫','0',''] as const;
const MIN_PIN_LENGTH = 4;

function StaffPinPanel() {
  const [nickname, setNickname]   = useState('');
  const [pin, setPin]             = useState('');
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);

  const appendPin = (digit: string) => {
    setPin((prev) => (prev.length < 13 ? prev + digit : prev));
  };
  const backspacePin = () => setPin((prev) => prev.slice(0, -1));

  // Auto-submit เมื่อ PIN ครบ (≥ MIN_PIN_LENGTH) และมี nickname
  useEffect(() => {
    if (pin.length >= MIN_PIN_LENGTH && nickname.trim() && !loading) {
      void handleLogin(pin);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  async function handleLogin(currentPin: string) {
    if (!nickname.trim()) { setError('กรุณากรอกชื่อเล่น'); return; }
    setLoading(true);
    setError(null);
    try {
      // v2: ส่งแค่ nickname + pin — ไม่ต้องระบุ shopId
      const res  = await fetch('/api/staff-login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ nickname: nickname.trim().toLowerCase(), pin: currentPin }),
      });
      const json = await res.json() as {
        success: boolean;
        error?: { message: string };
        data?: { access_token: string; refresh_token: string; user: { shop_id: string; branch_id: string | null; nickname: string } };
      };

      if (!json.success || !json.data) {
        setError(json.error?.message ?? 'ชื่อเล่นหรือ PIN ไม่ถูกต้อง');
        setPin('');
        setLoading(false);
        return;
      }

      // Set Supabase session จาก token ที่ backend คืนมา
      const supabase = createSupabaseClient();
      await supabase.auth.setSession({
        access_token:  json.data.access_token,
        refresh_token: json.data.refresh_token,
      });

      // ตรวจสอบ ban/suspend + redirect
      const result = await handlePosAssignment(json.data.access_token, API_URL);
      if (!result.ok) {
        setError(result.message);
        setPin('');
        setLoading(false);
      }
    } catch {
      setError('เกิดข้อผิดพลาด กรุณาลองใหม่');
      setPin('');
      setLoading(false);
    }
  }

  return (
    <div className="page-login-staff">
      {/* Nickname input */}
      <div className="page-login-staff__field">
        <label className="page-login__label">ชื่อเล่น</label>
        <input
          type="text"
          value={nickname}
          onChange={(e) => { setNickname(e.target.value); setError(null); setPin(''); }}
          placeholder="ชื่อเล่นของคุณ"
          className="input-field"
          autoComplete="off"
          disabled={loading}
        />
      </div>

      {/* PIN dots display */}
      <div className="page-login-staff__pin-display">
        <label className="page-login__label">PIN</label>
        <div className="page-login-staff__pin-dots" aria-label={`PIN ${pin.length} หลัก`}>
          {Array.from({ length: Math.max(4, pin.length) }).map((_, i) => (
            <span
              key={i}
              className={`page-login-staff__pin-dot${i < pin.length ? ' page-login-staff__pin-dot--filled' : ''}`}
            />
          ))}
        </div>
      </div>

      {/* Numpad */}
      <div className="page-login-staff__numpad" role="group" aria-label="แป้นกด PIN">
        {PIN_KEYS.map((key, i) => {
          if (key === '⌫') return (
            <button key={i} type="button" className="page-login-staff__key page-login-staff__key--delete"
              onClick={backspacePin} disabled={loading || pin.length === 0} aria-label="ลบ">
              ⌫
            </button>
          );
          if (key === '') return <span key={i} aria-hidden="true" />;
          return (
            <button key={i} type="button" className="page-login-staff__key"
              onClick={() => appendPin(key)} disabled={loading}>
              {key}
            </button>
          );
        })}
      </div>

      {error && <p className="page-login__error">{error}</p>}
      {loading && <p className="page-login-staff__loading">กำลังเข้าสู่ระบบ...</p>}
    </div>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────
export default function LoginPage() {
  const [mode, setMode]         = useState<Mode>('password');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

  // ถ้ามี ?shopId= ใน URL → auto-select staff tab
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const shopId = new URLSearchParams(window.location.search).get('shopId');
      if (shopId) setMode('staff');
    }
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createSupabaseClient();
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });

    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }

    if (DEV_EMAILS.length > 0 && DEV_EMAILS.includes(email.trim().toLowerCase())) {
      window.location.href = '/dev';
      return;
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) { window.location.href = '/login'; return; }

      const result = await handlePosAssignment(token, API_URL);
      if (!result.ok) {
        setLoading(false);
        setError(result.message);
      }
    } catch {
      setLoading(false);
      setError('เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง');
    }
  }

  return (
    <main className="page-login">
      <div className="page-login__container">
        <div className="page-login__header">
          <h1 className="page-login__title">NexaPos</h1>
          <p className="page-login__subtitle">เข้าสู่ระบบเพื่อดำเนินการต่อ</p>
        </div>

        {/* ── Mode tabs ── */}
        <div className="page-login__mode-tabs">
          <button type="button" onClick={() => setMode('password')}
            className={`page-login__mode-btn${mode === 'password' ? ' page-login__mode-btn--active' : ''}`}>
            🔑 เจ้าของ
          </button>
          <button type="button" onClick={() => setMode('staff')}
            className={`page-login__mode-btn${mode === 'staff' ? ' page-login__mode-btn--active' : ''}`}>
            👤 พนักงาน
          </button>
          <button type="button" onClick={() => setMode('qr')}
            className={`page-login__mode-btn${mode === 'qr' ? ' page-login__mode-btn--active' : ''}`}>
            📱 QR
          </button>
        </div>

        {/* ── Password form (owner/manager with email) ── */}
        {mode === 'password' && (
          <form onSubmit={handleSubmit} className="page-login__form">
            <div>
              <label htmlFor="email" className="page-login__label">อีเมล</label>
              <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                required autoComplete="email" className="input-field" placeholder="you@example.com" />
            </div>
            <div>
              <label htmlFor="password" className="page-login__label">รหัสผ่าน</label>
              <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                required autoComplete="current-password" className="input-field" />
            </div>
            {error && <p className="page-login__error">{error}</p>}
            <button type="submit" disabled={loading} className="btn-primary btn-block">
              {loading ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}
            </button>
          </form>
        )}

        {/* ── Staff PIN login ── */}
        {mode === 'staff' && <StaffPinPanel />}

        {/* ── QR login ── */}
        {mode === 'qr' && <QrLoginPanel />}

        <p className="page-login__footer">
          {mode === 'password' && (
            <><Link href="/forgot-password" className="page-login__link">ลืมรหัสผ่าน?</Link>{' · '}</>
          )}
          <Link href="/" className="page-login__link">กลับหน้าหลัก</Link>
        </p>
      </div>
    </main>
  );
}
