'use client';

/**
 * /qr-auth?t={token}
 *
 * ARCHITECTURE: ไม่พึ่ง Supabase session ที่ฝั่ง phone เลย
 *
 * ครั้งแรก (first scan):
 *   - กรอก email + password → signInWithPassword → ได้ JWT → confirm QR
 *   - Backend ออก device_token (UUID, หมดอายุ 30 วัน) กลับมา
 *   - เก็บ device_token ใน localStorage key 'qr_dt'
 *
 * ครั้งที่สอง+ (second scan):
 *   - โหลดหน้า → อ่าน device_token จาก localStorage
 *   - ส่ง X-QR-Device-Token header ตรงๆ (ไม่ต้อง login ใหม่)
 *   - Backend ตรวจ device_token ใน DB → confirm → refresh expiry
 *   - ไม่มี Supabase session dependency บน phone เลย
 *
 * Phase machine:
 *   checking → confirm  (มี device_token ใน localStorage)
 *           → login    (ไม่มี)
 *   login    → confirm  (signInWithPassword สำเร็จ + confirm สำเร็จ ครั้งแรก)
 *   confirm  → confirming → done
 *                       → error → retry
 */

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { createBrowserClient } from '@supabase/ssr';
import { API_URL } from '@/lib/config';

// ── Isolated Supabase client (ใช้แค่ signInWithPassword — ไม่มี listener) ────
const qrSupabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { isSingleton: false },
);

// ── Device token storage ──────────────────────────────────────────────────────
const DT_KEY = 'qr_dt'; // device token — UUID จาก backend (หมดอายุ 30 วัน)

function saveDeviceToken(dt: string) {
  try { localStorage.setItem(DT_KEY, dt); } catch { /**/ }
}
function loadDeviceToken(): string | null {
  try { return localStorage.getItem(DT_KEY) ?? null; } catch { return null; }
}
function clearDeviceToken() {
  try { localStorage.removeItem(DT_KEY); } catch { /**/ }
}

type Phase = 'checking' | 'login' | 'confirm' | 'confirming' | 'done' | 'error';

interface ShopInfo { name: string; logo_url: string | null; }

// ─── Inner Component ──────────────────────────────────────────────────────────
function QrAuthContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('t') ?? '';

  const [phase, setPhase]             = useState<Phase>('checking');
  const [deviceToken, setDeviceToken] = useState('');
  const [accessToken, setAccessToken] = useState(''); // ใช้แค่ตอน first scan
  const [userName, setUserName]       = useState('');
  const [shopInfo, setShopInfo]       = useState<ShopInfo | null>(null);
  const [email, setEmail]             = useState('');
  const [password, setPassword]       = useState('');
  const [errMsg, setErrMsg]           = useState('');

  // Lock scroll
  useEffect(() => {
    const h = document.documentElement, b = document.body;
    const ph = h.style.overflow, pb = b.style.overflow;
    h.style.overflow = 'hidden'; b.style.overflow = 'hidden';
    return () => { h.style.overflow = ph; b.style.overflow = pb; };
  }, []);

  // Fetch shop info for display (best-effort)
  async function fetchShopInfo(tok: string) {
    try {
      const res  = await fetch(`${API_URL}/api/v1/me/pos-assignment`, {
        headers: { Authorization: `Bearer ${tok}` },
      });
      const json = await res.json();
      if (json.success && json.data?.shop)
        setShopInfo({ name: json.data.shop.name, logo_url: json.data.shop.logo_url ?? null });
    } catch { /**/ }
  }

  // ── Mount: ตรวจ device_token ──────────────────────────────────────────────
  useEffect(() => {
    const dt = loadDeviceToken();
    if (dt) {
      // มี device_token → ไปหน้า confirm ได้เลย ไม่ต้อง login
      setDeviceToken(dt);
      setPhase('confirm');
    } else {
      setPhase('login');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── First scan login ──────────────────────────────────────────────────────
  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setErrMsg('');

    const { data, error } = await qrSupabase.auth.signInWithPassword({ email, password });
    if (error || !data.session) {
      setErrMsg('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
      return;
    }

    const at = data.session.access_token;
    setAccessToken(at);
    setUserName(data.session.user.email ?? '');

    // ── ทำ confirm ทันทีหลัง login (first scan) ──────────────────────────
    // เพื่อให้ได้ device_token กลับมาเก็บไว้
    setPhase('confirming');
    const ok = await doConfirm(at, null);
    if (!ok) {
      // confirm ล้มเหลว (QR หมดอายุ ฯลฯ) → กลับไปหน้า login
      setAccessToken('');
      setPhase('login');
    }
  }

  // ── Confirm (second scan+) ────────────────────────────────────────────────
  async function handleConfirm() {
    if (!token) return;
    setPhase('confirming');
    setErrMsg('');
    await doConfirm(null, deviceToken);
  }

  /** Core confirm call. Returns true on success.
   *  @param jwt - Supabase JWT (first scan) or null (second scan+)
   *  @param dt  - device_token (second scan+) or null (first scan)
   */
  async function doConfirm(jwt: string | null, dt: string | null): Promise<boolean> {
    if (!token) return false;

    const headers: Record<string, string> = {};
    if (jwt) headers['Authorization'] = `Bearer ${jwt}`;
    if (dt)  headers['X-QR-Device-Token'] = dt;

    try {
      const res  = await fetch(`${API_URL}/api/v1/auth/qr-session/${token}/confirm`, {
        method: 'POST',
        headers,
      });
      const json = await res.json() as { success: boolean; error?: unknown; data?: { device_token?: string } };

      if (!json.success) {
        handleConfirmError(json);
        return false;
      }

      // บันทึก device_token ที่ได้กลับมา
      const newDt = json.data?.device_token;
      if (newDt) {
        saveDeviceToken(newDt);
        setDeviceToken(newDt);
      }

      // Fetch shop info ถ้ามี JWT (first scan เท่านั้น — second scan ไม่มี AT)
      if (jwt) await fetchShopInfo(jwt);

      setPhase('done');
      return true;
    } catch {
      setErrMsg('ไม่สามารถเชื่อมต่อได้');
      setPhase('error');
      return false;
    }
  }

  function handleConfirmError(json: { success: boolean; error?: unknown }) {
    const e = typeof json.error === 'string' ? json.error : '';
    if (e === 'expired' || e === 'already_used') {
      // QR หมดอายุหรือถูกใช้แล้ว — กลับไปรอ scan ใหม่
      setErrMsg(
        e === 'expired'
          ? 'QR หมดอายุแล้ว กรุณาสแกน QR ใหม่ที่เครื่อง POS'
          : 'QR ถูกใช้ไปแล้ว กรุณาสแกนใหม่',
      );
    } else if (e === 'unauthorized') {
      // device_token หมดอายุหรือถูกลบ → ล้างแล้ว login ใหม่
      clearDeviceToken();
      setDeviceToken('');
      setErrMsg('');
      setPhase('login');
      return;
    } else {
      setErrMsg('เกิดข้อผิดพลาด กรุณาลองใหม่');
    }
    setPhase('error');
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  if (!token) return (
    <div style={s.screen}>
      <div style={s.body}>
        <div style={s.card}>
          <p style={{ ...s.title, color: '#f87171' }}>❌ ลิงก์ไม่ถูกต้อง</p>
          <p style={s.sub}>กรุณาสแกน QR ใหม่จากหน้า Login ของเครื่อง POS</p>
        </div>
      </div>
    </div>
  );

  if (phase === 'checking') return (
    <div style={{ ...s.screen, alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: '#94a3b8', fontSize: '0.9rem' }}>กำลังตรวจสอบ...</p>
    </div>
  );

  if (phase === 'done') return (
    <div style={s.screen}>
      <ShopBar shopInfo={shopInfo} />
      <div style={s.body}>
        <div style={s.card}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '0.4rem' }}>✅</div>
            <p style={{ ...s.title, color: '#34d399' }}>ยืนยันสำเร็จ!</p>
            <p style={{ ...s.sub, marginTop: '0.4rem' }}>
              เครื่อง POS กำลังเข้าสู่ระบบ<br />
              <span style={{ color: '#64748b', fontSize: '0.78rem' }}>สามารถปิดหน้านี้ได้</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );

  if (phase === 'login') return (
    <div style={s.screen}>
      <div style={s.body}>
        <div style={s.card}>
          <p style={s.title}>🔐 เข้าสู่ระบบ</p>
          <p style={s.sub}>เพื่อยืนยันการเข้าสู่ระบบที่เครื่อง POS</p>
          <form onSubmit={handleLogin}>
            <input type="email" placeholder="อีเมล" value={email}
              onChange={e => setEmail(e.target.value)} required autoComplete="email" style={s.input} />
            <input type="password" placeholder="รหัสผ่าน" value={password}
              onChange={e => setPassword(e.target.value)} required autoComplete="current-password" style={s.input} />
            {errMsg && <p style={s.err}>{errMsg}</p>}
            <button type="submit" style={s.btnPrimary}>เข้าสู่ระบบ</button>
          </form>
        </div>
      </div>
    </div>
  );

  // confirm / confirming / error
  return (
    <div style={s.screen}>
      <ShopBar shopInfo={shopInfo} />
      <div style={s.body}>
        <div style={s.card}>
          <div style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
            <div style={{
              width: 56, height: 56, borderRadius: '50%',
              background: 'linear-gradient(135deg,#3b82f6,#8b5cf6)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '1.5rem', margin: '0 auto 0.65rem',
            }}>🖥️</div>
            <p style={s.title}>ยืนยันเข้าสู่ระบบ</p>
            {userName
              ? <>
                  <p style={{ ...s.sub, marginBottom: 0 }}>ในฐานะ</p>
                  <p style={{ color: '#93c5fd', fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.2rem' }}>{userName}</p>
                  <p style={{ color: '#64748b', fontSize: '0.78rem' }}>ที่เครื่อง POS นี้</p>
                </>
              : <p style={s.sub}>กดยืนยันเพื่อเข้าสู่ระบบที่เครื่อง POS</p>
            }
          </div>
          <div style={s.warning}>⚠️ กด &ldquo;ยืนยัน&rdquo; เฉพาะเมื่ออยู่หน้าเครื่อง POS ของร้านคุณ</div>
          {errMsg && <p style={s.err}>{errMsg}</p>}
          <button type="button" disabled={phase === 'confirming'}
            onClick={phase === 'error' ? () => { setPhase('confirm'); setErrMsg(''); } : handleConfirm}
            style={{ ...s.btnPrimary, opacity: phase === 'confirming' ? 0.7 : 1 }}>
            {phase === 'confirming' ? '⏳ กำลังยืนยัน...' : phase === 'error' ? '🔄 ลองใหม่' : '✅ ยืนยันเข้าสู่ระบบที่เครื่อง POS'}
          </button>
          <button type="button" style={s.btnSecondary} onClick={() => {
            clearDeviceToken();
            setDeviceToken(''); setAccessToken(''); setUserName(''); setShopInfo(null); setErrMsg('');
            setPhase('login');
          }}>เปลี่ยนบัญชี</button>
        </div>
      </div>
    </div>
  );
}

function ShopBar({ shopInfo }: { shopInfo: ShopInfo | null }) {
  if (!shopInfo) return null;
  return (
    <div style={s.topBar}>
      {shopInfo.logo_url
        ? <Image src={shopInfo.logo_url} alt={shopInfo.name} width={36} height={36} style={s.shopLogo} />
        : <div style={s.shopLogoPlaceholder}>🏪</div>}
      <span style={s.shopName}>{shopInfo.name}</span>
    </div>
  );
}

const s = {
  screen:             { position:'fixed',inset:0,overflow:'hidden',background:'linear-gradient(160deg,#0f172a 0%,#1e1b4b 60%,#0f172a 100%)',display:'flex',flexDirection:'column',fontFamily:'system-ui,-apple-system,sans-serif' } as React.CSSProperties,
  topBar:             { display:'flex',alignItems:'center',justifyContent:'center',gap:'0.6rem',padding:'0.9rem 1rem 0.7rem',borderBottom:'1px solid rgba(255,255,255,0.07)',flexShrink:0 } as React.CSSProperties,
  shopLogo:           { borderRadius:'8px',objectFit:'cover' as const,border:'1px solid rgba(255,255,255,0.15)' } as React.CSSProperties,
  shopLogoPlaceholder:{ width:36,height:36,borderRadius:'8px',background:'linear-gradient(135deg,#3b82f6,#8b5cf6)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'1rem',flexShrink:0 } as React.CSSProperties,
  shopName:           { color:'#e2e8f0',fontWeight:600,fontSize:'0.95rem' } as React.CSSProperties,
  body:               { flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:'1rem',overflowY:'auto' } as React.CSSProperties,
  card:               { background:'#1e293b',borderRadius:'16px',padding:'1.5rem 1.25rem',width:'100%',maxWidth:'360px',boxShadow:'0 20px 60px rgba(0,0,0,0.5)' } as React.CSSProperties,
  title:              { fontSize:'1.15rem',fontWeight:700,color:'#f1f5f9',marginBottom:'0.2rem',textAlign:'center' } as React.CSSProperties,
  sub:                { fontSize:'0.82rem',color:'#94a3b8',textAlign:'center',marginBottom:'1.25rem' } as React.CSSProperties,
  input:              { width:'100%',padding:'0.6rem 0.85rem',background:'#0f172a',border:'1px solid #334155',borderRadius:'8px',color:'#f1f5f9',fontSize:'0.95rem',marginBottom:'0.65rem',boxSizing:'border-box',outline:'none' } as React.CSSProperties,
  btnPrimary:         { width:'100%',padding:'0.8rem',background:'linear-gradient(90deg,#3b82f6,#8b5cf6)',border:'none',borderRadius:'10px',color:'#fff',fontWeight:700,fontSize:'0.95rem',cursor:'pointer',marginTop:'0.4rem' } as React.CSSProperties,
  btnSecondary:       { width:'100%',marginTop:'0.6rem',background:'transparent',border:'1px solid #334155',color:'#64748b',borderRadius:'8px',padding:'0.55rem',fontSize:'0.82rem',cursor:'pointer' } as React.CSSProperties,
  err:                { color:'#f87171',fontSize:'0.82rem',marginBottom:'0.65rem',textAlign:'center' } as React.CSSProperties,
  warning:            { background:'#1e3a5f',border:'1px solid #1d4ed8',borderRadius:'8px',padding:'0.65rem',marginBottom:'1rem',fontSize:'0.78rem',color:'#93c5fd',textAlign:'center' } as React.CSSProperties,
};

export default function QrAuthPage() {
  return (
    <Suspense fallback={
      <div style={{ position:'fixed',inset:0,overflow:'hidden',background:'linear-gradient(160deg,#0f172a 0%,#1e1b4b 60%,#0f172a 100%)',display:'flex',alignItems:'center',justifyContent:'center',color:'#94a3b8',fontFamily:'system-ui,sans-serif' }}>
        กำลังโหลด...
      </div>
    }>
      <QrAuthContent />
    </Suspense>
  );
}
