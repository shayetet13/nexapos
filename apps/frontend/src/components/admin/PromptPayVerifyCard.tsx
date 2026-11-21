'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { fetchWithAuth } from '@/lib/supabase';
import { API_URL } from '@/lib/config';

type IdType = 'phone' | 'national_id' | 'ewallet';

interface VerifyConfig {
  api_base_configured: boolean;
  enabled: boolean;
  ready: boolean;
  has_api_key: boolean;
  api_key_last4: string | null;
  bot_id: string | null;
  bot_name: string | null;
  source_target_id: string | null;
  source_target_name: string | null;
  promptpay_id_type: IdType | null;
  promptpay_id_last4: string | null;
  destination_last4: string | null;
}

interface BotOption {
  id: string;
  name: string;
  status: string;
  targets: { id: string; name: string; type: string }[];
}

const ID_TYPES: { id: IdType; label: string; hint: string }[] = [
  { id: 'phone',       label: 'เบอร์โทร',  hint: '10 หลัก เช่น 0812345678' },
  { id: 'national_id', label: 'บัตร ปชช.', hint: '13 หลัก' },
  { id: 'ewallet',     label: 'e-Wallet',  hint: '15 หลัก' },
];

export function PromptPayVerifyCard({ shopId }: { shopId: string | null }) {
  const base = `${API_URL}/api/v1/shops/${shopId}/promptpay-verify`;

  const [cfg, setCfg] = useState<VerifyConfig | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [idType, setIdType] = useState<IdType>('phone');
  const [ppId, setPpId] = useState('');
  const [last4, setLast4] = useState('');
  const [saving, setSaving] = useState(false);
  const [bots, setBots] = useState<BotOption[] | null>(null);
  const [loadingBots, setLoadingBots] = useState(false);
  const [pickedBot, setPickedBot] = useState('');
  const [pickedTarget, setPickedTarget] = useState('');

  const applyConfig = useCallback((c: VerifyConfig) => {
    setCfg(c);
    setIdType(c.promptpay_id_type ?? 'phone');
    setLast4(c.destination_last4 ?? '');
  }, []);

  const load = useCallback(async () => {
    if (!shopId) return;
    const res = await fetchWithAuth(base);
    if (res.ok) applyConfig((await res.json()).data as VerifyConfig);
  }, [shopId, base, applyConfig]);

  useEffect(() => { void load(); }, [load]);

  async function errorMessage(res: Response, fallback: string): Promise<string> {
    const j = await res.json().catch(() => null) as { error?: { message?: string } } | null;
    return j?.error?.message ?? fallback;
  }

  async function save(extra: Record<string, unknown> = {}) {
    if (!shopId) return;
    setSaving(true);
    const body: Record<string, unknown> = {
      promptpay_id_type: idType,
      destination_last4: last4 || null,
      ...extra,
    };
    if (apiKey.trim()) body.api_key = apiKey.trim();
    if (ppId.trim()) body.promptpay_id = ppId.trim();

    const res = await fetchWithAuth(base, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!res.ok) { toast.error(await errorMessage(res, 'บันทึกไม่สำเร็จ')); return false; }
    applyConfig((await res.json()).data as VerifyConfig);
    setApiKey('');
    setPpId('');
    toast.success('บันทึกการตั้งค่าแล้ว');
    return true;
  }

  async function remove() {
    if (!shopId || !window.confirm('ลบการตั้งค่าตรวจสอบ PromptPay อัตโนมัติของร้านนี้?')) return;
    const res = await fetchWithAuth(base, { method: 'DELETE' });
    if (!res.ok) { toast.error(await errorMessage(res, 'ลบไม่สำเร็จ')); return; }
    setBots(null);
    applyConfig((await res.json()).data as VerifyConfig);
  }

  async function loadBots() {
    setLoadingBots(true);
    try {
      const res = await fetchWithAuth(`${base}/options`);
      if (!res.ok) { toast.error(await errorMessage(res, 'ดึงรายชื่อ Bot ไม่สำเร็จ')); return; }
      const list = (await res.json()).data.bots as BotOption[];
      setBots(list);
      const cur = list.find((b) => b.id === cfg?.bot_id) ?? list[0];
      setPickedBot(cur?.id ?? '');
      setPickedTarget(cur?.targets.find((t) => t.id === cfg?.source_target_id)?.id ?? '');
      if (list.length === 0) toast.info('ไม่พบ Bot LINEJS ที่เปิดใช้งาน — ตรวจ API key และสิทธิ์ bots:read');
    } finally {
      setLoadingBots(false);
    }
  }

  async function saveTarget() {
    if (!pickedBot || !pickedTarget) return;
    // เลือกครบแล้ว = ตั้งใจใช้งาน → เปิดใช้งานให้เลย ถ้ามี API key + หมายเลขพร้อมเพย์แล้ว
    const canEnable = cfg?.has_api_key && !!cfg.promptpay_id_last4;
    await save({ bot_id: pickedBot, source_target_id: pickedTarget, ...(canEnable ? { enabled: true } : {}) });
  }

  if (!shopId || !cfg) return null;

  const currentBot = bots?.find((b) => b.id === pickedBot) ?? null;
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
        {/* 1) API key */}
        <div>
          <label className="page-admin__label">
            1. API key (lbk_…) {cfg.has_api_key && <span className="page-admin__hint">— บันทึกแล้ว ลงท้าย …{cfg.api_key_last4}</span>}
          </label>
          <input
            type="password"
            autoComplete="off"
            className="input-field"
            placeholder={cfg.has_api_key ? 'เว้นว่างไว้ถ้าไม่เปลี่ยน' : 'lbk_xxxxxxxx'}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <p className="page-admin__hint">ต้องมี scope bots:read, promptpay:read และ promptpay:write</p>
        </div>

        {/* 2) เลือก Bot + แชทธนาคาร (login LINE ทำที่แดชบอร์ดของบริการ LINEJS) */}
        <div>
          <label className="page-admin__label">
            2. Bot และแชท LINE OA ธนาคาร
            {cfg.bot_name && (
              <span className="page-admin__hint"> — เลือกไว้: <strong>{cfg.bot_name}</strong> → <strong>{cfg.source_target_name ?? '-'}</strong></span>
            )}
          </label>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <button type="button" className="page-admin__btn-sm" disabled={loadingBots || !cfg.has_api_key} onClick={() => void loadBots()}>
              {loadingBots ? 'กำลังโหลด…' : bots ? 'โหลดรายชื่อใหม่' : 'โหลดรายชื่อ Bot'}
            </button>
            {bots && bots.length > 0 && (
              <>
                <select
                  className="input-field"
                  style={{ flex: '1 1 160px', minWidth: 0 }}
                  value={pickedBot}
                  onChange={(e) => { setPickedBot(e.target.value); setPickedTarget(''); }}
                >
                  {bots.map((b) => <option key={b.id} value={b.id}>{b.name}{b.status === 'online' ? '' : ` (${b.status})`}</option>)}
                </select>
                <select
                  className="input-field"
                  style={{ flex: '1 1 200px', minWidth: 0 }}
                  value={pickedTarget}
                  onChange={(e) => setPickedTarget(e.target.value)}
                >
                  <option value="">— เลือกแชทธนาคาร —</option>
                  {currentBot?.targets.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <button
                  type="button"
                  className="page-admin__btn-sm page-admin__btn-active"
                  disabled={!pickedBot || !pickedTarget || saving}
                  onClick={() => void saveTarget()}
                >
                  ใช้ตัวนี้
                </button>
              </>
            )}
          </div>
          {!cfg.has_api_key && <p className="page-admin__hint">บันทึก API key ก่อน แล้วจึงโหลดรายชื่อ Bot ได้</p>}
          {currentBot && currentBot.status !== 'online' && (
            <p className="page-admin__hint" style={{ color: 'var(--color-danger, #c0392b)' }}>
              ⚠️ Bot นี้ยังไม่ออนไลน์ (สถานะ: {currentBot.status}) — ต้องกดเริ่ม Bot ที่แดชบอร์ดของบริการ LINEJS ก่อน ไม่งั้นจะตรวจเงินเข้าไม่ได้
            </p>
          )}
          {bots && currentBot && currentBot.targets.length === 0 && (
            <p className="page-admin__hint">Bot นี้ยังไม่มีแชทที่อนุญาต — เพิ่ม/อนุญาตแชท LINE OA ธนาคารที่แท็บ Targets ในแดชบอร์ดของบริการก่อน</p>
          )}
          <p className="page-admin__hint">
            การล็อกอินบัญชี LINE ของ Bot (สแกน QR) ทำที่แดชบอร์ดของบริการ LINEJS — ที่นี่เลือกได้เฉพาะ Bot ที่ตั้งค่าไว้แล้ว
          </p>
          <p className="page-admin__hint">
            ⚠️ การใช้บัญชี LINE ส่วนตัวเป็นบอท (self-bot) อาจขัดต่อข้อกำหนด LINE — แนะนำใช้บัญชีแยกสำหรับร้านโดยเฉพาะ
          </p>
        </div>

        <div>
          <label className="page-admin__label">
            3. หมายเลขพร้อมเพย์ที่รับเงิน {cfg.promptpay_id_last4 && <span className="page-admin__hint">— บันทึกแล้ว ลงท้าย …{cfg.promptpay_id_last4}</span>}
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
          {cfg.has_api_key && (
            <button type="button" className="page-admin__btn-sm page-admin__btn-danger" onClick={() => void remove()}>ลบการตั้งค่า</button>
          )}
          <span className="page-admin__hint" style={{ alignSelf: 'center' }}>
            สถานะ: {cfg.ready ? '🟢 พร้อมใช้งาน' : cfg.enabled ? '🟡 ตั้งค่าไม่ครบ' : '⚪ ปิดอยู่'}
          </span>
        </div>
      </div>
    </div>
  );
}
