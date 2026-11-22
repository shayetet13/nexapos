'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { fetchWithAuth } from '@/lib/supabase';
import { API_URL } from '@/lib/config';

type IdType = 'phone' | 'national_id' | 'ewallet';

interface VerifyConfig {
  api_base_configured: boolean;
  api_key_configured: boolean;
  enabled: boolean;
  ready: boolean;
  bot_id: string | null;
  bot_name: string | null;
  source_target_id: string | null;
  source_target_name: string | null;
  promptpay_id_type: IdType | null;
  promptpay_id_last4: string | null;
  destination_last4: string | null;
}

const ID_TYPES: { id: IdType; label: string; hint: string }[] = [
  { id: 'phone',       label: 'เบอร์โทร',  hint: '10 หลัก เช่น 0812345678' },
  { id: 'national_id', label: 'บัตร ปชช.', hint: '13 หลัก' },
  { id: 'ewallet',     label: 'e-Wallet',  hint: '15 หลัก' },
];

/**
 * ตั้งค่าตรวจสอบ PromptPay อัตโนมัติของร้าน (owner)
 * - Bot / แชท LINE OA ธนาคาร: ผู้ดูแลระบบ (dev) ผูกให้ — แสดงอ่านอย่างเดียว
 * - เจ้าของร้านตั้งเฉพาะหมายเลขพร้อมเพย์ที่รับเงิน และเปิด/ปิดใช้งาน
 */
export function PromptPayVerifyCard({ shopId }: { shopId: string | null }) {
  const base = `${API_URL}/api/v1/shops/${shopId}/promptpay-verify`;

  const [cfg, setCfg] = useState<VerifyConfig | null>(null);
  const [idType, setIdType] = useState<IdType>('phone');
  const [ppId, setPpId] = useState('');
  const [last4, setLast4] = useState('');
  const [saving, setSaving] = useState(false);

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
    const j = await res.json().catch(() => null) as
      { error?: { message?: string; details?: { fieldErrors?: Record<string, string[]> } | Record<string, string[]> } } | null;
    const details = j?.error?.details as Record<string, string[] | undefined> | undefined;
    const firstDetail = details ? Object.values(details).flat().find((v): v is string => typeof v === 'string') : undefined;
    return firstDetail ?? j?.error?.message ?? fallback;
  }

  async function save(extra: Record<string, unknown> = {}) {
    if (!shopId) return false;
    setSaving(true);
    const body: Record<string, unknown> = {
      promptpay_id_type: idType,
      destination_last4: last4 || null,
      ...extra,
    };
    if (ppId.trim()) body.promptpay_id = ppId.trim();

    const res = await fetchWithAuth(base, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!res.ok) { toast.error(await errorMessage(res, 'บันทึกไม่สำเร็จ')); return false; }
    applyConfig((await res.json()).data as VerifyConfig);
    setPpId('');
    toast.success('บันทึกการตั้งค่าแล้ว');
    return true;
  }

  async function clearMine() {
    if (!shopId || !window.confirm('ล้างหมายเลขพร้อมเพย์และปิดการตรวจสอบอัตโนมัติของร้านนี้? (Bot ที่ผู้ดูแลระบบผูกไว้ไม่ถูกลบ)')) return;
    const res = await fetchWithAuth(base, { method: 'DELETE' });
    if (!res.ok) { toast.error(await errorMessage(res, 'ล้างไม่สำเร็จ')); return; }
    applyConfig((await res.json()).data as VerifyConfig);
    setPpId('');
  }

  if (!shopId || !cfg) return null;

  const idTypeMeta = ID_TYPES.find((t) => t.id === idType)!;
  const hasBot = !!cfg.bot_id && !!cfg.source_target_id;
  const platformOk = cfg.api_base_configured && cfg.api_key_configured;

  return (
    <div className="page-admin__card">
      <h3 className="page-admin__card-title">ตรวจสอบ PromptPay อัตโนมัติ (LINE Bot)</h3>
      <p className="page-admin__section-desc">
        ยืนยันยอดเงินเข้าจริงผ่าน LINE OA ธนาคาร — Bot ผูกกับร้านโดยผู้ดูแลระบบ (1 Bot ต่อ 1 ร้าน) หมายเลขพร้อมเพย์เก็บเข้ารหัส AES-256
      </p>

      {!platformOk && (
        <p className="page-admin__hint ppv-error">
          ผู้ดูแลระบบยังไม่ได้ตั้งค่าบริการตรวจสอบ ({!cfg.api_base_configured ? 'URL' : 'API key ของระบบ'}) — ยังเปิดใช้งานไม่ได้
        </p>
      )}

      <div className="page-admin__form">
        {/* 1) Bot + แชทธนาคาร — dev ผูกให้ (อ่านอย่างเดียว) */}
        <div>
          <label className="page-admin__label">1. Bot และแชท LINE OA ธนาคาร</label>
          {hasBot ? (
            <p className="page-admin__hint">
              ผู้ดูแลระบบผูกให้แล้ว: <strong>{cfg.bot_name ?? cfg.bot_id}</strong> → <strong>{cfg.source_target_name ?? cfg.source_target_id}</strong>
            </p>
          ) : (
            <p className="page-admin__hint ppv-error">
              ยังไม่ได้ผูก Bot ให้ร้านนี้ — ติดต่อผู้ดูแลระบบเพื่อผูก LINE Bot และแชทธนาคารที่รับแจ้งเงินเข้า
            </p>
          )}
          <p className="page-admin__hint">
            ⚠️ การใช้บัญชี LINE ส่วนตัวเป็นบอท (self-bot) อาจขัดต่อข้อกำหนด LINE — แนะนำใช้บัญชีแยกสำหรับร้านโดยเฉพาะ
          </p>
        </div>

        <div>
          <label className="page-admin__label">
            2. หมายเลขพร้อมเพย์ที่รับเงิน {cfg.promptpay_id_last4 && <span className="page-admin__hint">— บันทึกแล้ว ลงท้าย …{cfg.promptpay_id_last4}</span>}
          </label>
          <div className="ppv-range">
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

        <div className="ppv-range">
          <button type="button" className="page-admin__btn-sm page-admin__btn-active" disabled={saving} onClick={() => void save()}>
            {saving ? 'กำลังบันทึก…' : 'บันทึก'}
          </button>
          <button
            type="button"
            className="page-admin__btn-sm"
            disabled={saving || (!cfg.enabled && !hasBot)}
            onClick={() => void save({ enabled: !cfg.enabled })}
          >
            {cfg.enabled ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
          </button>
          {(cfg.promptpay_id_last4 || cfg.enabled) && (
            <button type="button" className="page-admin__btn-sm page-admin__btn-danger" onClick={() => void clearMine()}>ล้างการตั้งค่า</button>
          )}
          <span className="page-admin__hint">
            สถานะ: {cfg.ready ? '🟢 พร้อมใช้งาน' : cfg.enabled ? '🟡 ตั้งค่าไม่ครบ / บริการยังไม่พร้อม' : '⚪ ปิดอยู่'}
          </span>
        </div>
      </div>
    </div>
  );
}
