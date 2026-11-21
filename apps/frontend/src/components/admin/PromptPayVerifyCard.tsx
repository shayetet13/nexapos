'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import QRCodeLib from 'react-qr-code';
import { toast } from 'sonner';
import { fetchWithAuth } from '@/lib/supabase';
import { API_URL } from '@/lib/config';

const QRCode = QRCodeLib as unknown as (props: {
  value: string; size?: number; level?: string; style?: React.CSSProperties;
}) => React.ReactElement;

type IdType = 'phone' | 'national_id' | 'ewallet';

interface VerifyConfig {
  api_base_configured: boolean;
  enabled: boolean;
  ready: boolean;
  has_api_key: boolean;
  api_key_last4: string | null;
  bot_id: string | null;
  source_target_id: string | null;
  promptpay_id_type: IdType | null;
  promptpay_id_last4: string | null;
  destination_last4: string | null;
  line: { logged_in: boolean; display_name: string | null; logged_in_at: string | null };
}

interface QrLoginState {
  state: 'idle' | 'waiting_scan' | 'waiting_pin' | 'success' | 'failed' | 'expired';
  qrUrl: string | null;
  pin: string | null;
  error: string | null;
  displayName: string | null;
}

const ID_TYPES: { id: IdType; label: string; hint: string }[] = [
  { id: 'phone',       label: 'เบอร์โทร',  hint: '10 หลัก เช่น 0812345678' },
  { id: 'national_id', label: 'บัตร ปชช.', hint: '13 หลัก' },
  { id: 'ewallet',     label: 'e-Wallet',  hint: '15 หลัก' },
];

const POLL_MS = 2000;

export function PromptPayVerifyCard({ shopId }: { shopId: string | null }) {
  const base = `${API_URL}/api/v1/shops/${shopId}/promptpay-verify`;

  const [cfg, setCfg] = useState<VerifyConfig | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [botId, setBotId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [idType, setIdType] = useState<IdType>('phone');
  const [ppId, setPpId] = useState('');
  const [last4, setLast4] = useState('');
  const [saving, setSaving] = useState(false);
  const [login, setLogin] = useState<QrLoginState | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const applyConfig = useCallback((c: VerifyConfig) => {
    setCfg(c);
    setBotId(c.bot_id ?? '');
    setTargetId(c.source_target_id ?? '');
    setIdType(c.promptpay_id_type ?? 'phone');
    setLast4(c.destination_last4 ?? '');
  }, []);

  const load = useCallback(async () => {
    if (!shopId) return;
    const res = await fetchWithAuth(base);
    if (res.ok) applyConfig((await res.json()).data as VerifyConfig);
  }, [shopId, base, applyConfig]);

  useEffect(() => { void load(); }, [load]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);
  useEffect(() => stopPolling, [stopPolling]);

  async function errorMessage(res: Response, fallback: string): Promise<string> {
    const j = await res.json().catch(() => null) as { error?: { message?: string } } | null;
    return j?.error?.message ?? fallback;
  }

  async function save(extra: Record<string, unknown> = {}) {
    if (!shopId) return;
    setSaving(true);
    const body: Record<string, unknown> = {
      bot_id: botId.trim() || undefined,
      source_target_id: targetId.trim() || undefined,
      promptpay_id_type: idType,
      destination_last4: last4 || null,
      ...extra,
    };
    if (apiKey.trim()) body.api_key = apiKey.trim();
    if (ppId.trim()) body.promptpay_id = ppId.trim();
    Object.keys(body).forEach((k) => body[k] === undefined && delete body[k]);

    const res = await fetchWithAuth(base, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!res.ok) { toast.error(await errorMessage(res, 'บันทึกไม่สำเร็จ')); return; }
    applyConfig((await res.json()).data as VerifyConfig);
    setApiKey('');
    setPpId('');
    toast.success('บันทึกการตั้งค่าแล้ว');
  }

  async function remove() {
    if (!shopId || !window.confirm('ลบการตั้งค่าตรวจสอบ PromptPay อัตโนมัติของร้านนี้?')) return;
    const res = await fetchWithAuth(base, { method: 'DELETE' });
    if (!res.ok) { toast.error(await errorMessage(res, 'ลบไม่สำเร็จ')); return; }
    stopPolling();
    setLogin(null);
    applyConfig((await res.json()).data as VerifyConfig);
  }

  async function startLogin() {
    stopPolling();
    const res = await fetchWithAuth(`${base}/line-login`, { method: 'POST' });
    if (!res.ok) { toast.error(await errorMessage(res, 'เริ่มสแกนไม่สำเร็จ')); return; }
    setLogin((await res.json()).data as QrLoginState);
    pollRef.current = setInterval(async () => {
      const r = await fetchWithAuth(`${base}/line-login`);
      if (!r.ok) return;
      const s = (await r.json()).data as QrLoginState;
      setLogin(s);
      if (s.state === 'success') { stopPolling(); toast.success('เข้าสู่ระบบ LINE สำเร็จ'); void load(); }
      if (s.state === 'failed' || s.state === 'expired') stopPolling();
    }, POLL_MS);
  }

  async function lineLogout() {
    stopPolling();
    const res = await fetchWithAuth(`${base}/line-login`, { method: 'DELETE' });
    if (!res.ok) { toast.error(await errorMessage(res, 'ออกจากระบบ LINE ไม่สำเร็จ')); return; }
    setLogin(null);
    void load();
  }

  if (!shopId || !cfg) return null;

  const showQr = login && (login.state === 'waiting_scan' || login.state === 'waiting_pin') && login.qrUrl;
  const idTypeMeta = ID_TYPES.find((t) => t.id === idType)!;

  return (
    <div className="page-admin__card">
      <h3 className="page-admin__card-title">ตรวจสอบ PromptPay อัตโนมัติ (LINE Bot)</h3>
      <p className="page-admin__section-desc">
        ยืนยันยอดเงินเข้าจริงผ่าน LINE OA ธนาคาร — ตั้งค่าแยกต่อร้าน API key / Bot ซ้ำกับร้านอื่นไม่ได้ (เก็บเข้ารหัส AES-256)
      </p>

      {!cfg.api_base_configured && (
        <p className="page-admin__hint" style={{ color: 'var(--color-danger, #c0392b)' }}>
          ผู้ดูแลระบบยังไม่ได้ตั้งค่า URL ของบริการตรวจสอบ (Dev Dashboard → Settings) — ยังเปิดใช้งานไม่ได้
        </p>
      )}

      <div className="page-admin__form">
        <div>
          <label className="page-admin__label">
            API key (lbk_…) {cfg.has_api_key && <span className="page-admin__hint">— บันทึกแล้ว ลงท้าย …{cfg.api_key_last4}</span>}
          </label>
          <input
            type="password"
            autoComplete="off"
            className="input-field"
            placeholder={cfg.has_api_key ? 'เว้นว่างไว้ถ้าไม่เปลี่ยน' : 'lbk_xxxxxxxx'}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <p className="page-admin__hint">ต้องมี scope promptpay:write และ promptpay:read</p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <div>
            <label className="page-admin__label">Bot ID</label>
            <input className="input-field" placeholder="bot_xxx" value={botId} onChange={(e) => setBotId(e.target.value)} />
          </div>
          <div>
            <label className="page-admin__label">Target ID (แชท LINE OA ธนาคาร)</label>
            <input className="input-field" placeholder="target_xxx" value={targetId} onChange={(e) => setTargetId(e.target.value)} />
          </div>
        </div>

        <div>
          <label className="page-admin__label">
            หมายเลขพร้อมเพย์ที่รับเงิน {cfg.promptpay_id_last4 && <span className="page-admin__hint">— บันทึกแล้ว ลงท้าย …{cfg.promptpay_id_last4}</span>}
          </label>
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
            {ID_TYPES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setIdType(t.id)}
                className={`page-admin__btn-sm${idType === t.id ? ' page-admin__btn-active' : ''}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <input
            className="input-field"
            inputMode="numeric"
            autoComplete="off"
            placeholder={cfg.promptpay_id_last4 ? 'เว้นว่างไว้ถ้าไม่เปลี่ยน' : idTypeMeta.hint}
            value={ppId}
            onChange={(e) => setPpId(e.target.value.replace(/\D/g, '').slice(0, 15))}
          />
        </div>

        <div>
          <label className="page-admin__label">เลขบัญชีปลายทาง 4 หลักท้าย (ไม่บังคับ)</label>
          <input
            className="input-field"
            inputMode="numeric"
            maxLength={4}
            placeholder="1234"
            value={last4}
            onChange={(e) => setLast4(e.target.value.replace(/\D/g, '').slice(0, 4))}
          />
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button type="button" className="page-admin__btn-sm page-admin__btn-active" disabled={saving} onClick={() => void save()}>
            {saving ? 'กำลังบันทึก…' : 'บันทึก'}
          </button>
          <button
            type="button"
            className="page-admin__btn-sm"
            disabled={saving}
            onClick={() => void save({ enabled: !cfg.enabled })}
          >
            {cfg.enabled ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
          </button>
          {(cfg.has_api_key || cfg.bot_id) && (
            <button type="button" className="page-admin__btn-sm page-admin__btn-danger" onClick={() => void remove()}>ลบการตั้งค่า</button>
          )}
          <span className="page-admin__hint" style={{ alignSelf: 'center' }}>
            สถานะ: {cfg.ready ? '🟢 พร้อมใช้งาน' : cfg.enabled ? '🟡 ตั้งค่าไม่ครบ' : '⚪ ปิดอยู่'}
          </span>
        </div>

        <hr style={{ border: 0, borderTop: '1px solid var(--color-border, #e5e5e5)', width: '100%' }} />

        <div>
          <label className="page-admin__label">บัญชี LINE ที่ใช้ตรวจสอบ</label>
          {cfg.line.logged_in ? (
            <p className="page-admin__hint">
              🟢 เข้าสู่ระบบแล้ว: <strong>{cfg.line.display_name ?? '-'}</strong>
              {cfg.line.logged_in_at && ` (${new Date(cfg.line.logged_in_at).toLocaleString('th-TH')})`}
            </p>
          ) : (
            <p className="page-admin__hint">ยังไม่ได้เข้าสู่ระบบ LINE</p>
          )}

          <div style={{ display: 'flex', gap: '0.5rem', margin: '0.5rem 0' }}>
            <button type="button" className="page-admin__btn-sm page-admin__btn-active" onClick={() => void startLogin()}>
              {cfg.line.logged_in ? 'สแกนเข้าสู่ระบบใหม่' : 'สแกน QR เข้าสู่ระบบ LINE'}
            </button>
            {cfg.line.logged_in && (
              <button type="button" className="page-admin__btn-sm page-admin__btn-danger" onClick={() => void lineLogout()}>ออกจากระบบ LINE</button>
            )}
          </div>

          {showQr && (
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ background: '#fff', padding: 12, borderRadius: 8, lineHeight: 0 }}>
                <QRCode value={login.qrUrl!} size={180} level="M" />
              </div>
              <div className="page-admin__hint">
                {login.state === 'waiting_pin' && login.pin ? (
                  <>
                    <div>กรอก PIN นี้บนมือถือเพื่อยืนยัน</div>
                    <div style={{ fontSize: '2rem', fontWeight: 700, letterSpacing: '0.3em' }}>{login.pin}</div>
                  </>
                ) : (
                  <div>เปิด LINE บนมือถือ → สแกน QR นี้ (QR หมดอายุใน 3 นาที)</div>
                )}
              </div>
            </div>
          )}
          {login && (login.state === 'failed' || login.state === 'expired') && (
            <p className="page-admin__hint" style={{ color: 'var(--color-danger, #c0392b)' }}>{login.error ?? 'เข้าสู่ระบบไม่สำเร็จ'}</p>
          )}
          <p className="page-admin__hint">
            ⚠️ การใช้บัญชี LINE ส่วนตัวเป็นบอท (self-bot) อาจขัดต่อข้อกำหนด LINE — แนะนำใช้บัญชีแยกสำหรับร้านโดยเฉพาะ
          </p>
        </div>
      </div>
    </div>
  );
}
