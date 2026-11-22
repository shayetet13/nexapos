'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { toast } from 'sonner';
import { fetchWithAuth } from '@/lib/supabase';
import { API_URL } from '@/lib/config';

export type IdType = 'phone' | 'national_id' | 'ewallet';

export interface VerifyConfig {
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

type Tone = 'ok' | 'warn' | 'off';

function statusOf(cfg: VerifyConfig): { tone: Tone; label: string } {
  if (cfg.ready) return { tone: 'ok', label: 'พร้อมใช้งาน' };
  if (cfg.enabled) return { tone: 'warn', label: 'ตั้งค่าไม่ครบ / บริการยังไม่พร้อม' };
  return { tone: 'off', label: 'ปิดอยู่' };
}

interface FormProps {
  cfg: VerifyConfig;
  idType: IdType;
  ppId: string;
  last4: string;
  saving: boolean;
  onIdType: (t: IdType) => void;
  onPpId: (v: string) => void;
  onLast4: (v: string) => void;
  onSave: () => void;
  onToggle: () => void;
  onClear: () => void;
}

/** ฟอร์มตั้งค่า (ส่วนแสดงผลล้วน — ไม่เรียก API) เพื่อให้ดู/ทดสอบหน้าตาแต่ละสถานะได้ง่าย */
export function PromptPayVerifyForm({
  cfg, idType, ppId, last4, saving, onIdType, onPpId, onLast4, onSave, onToggle, onClear,
}: FormProps) {
  const uid = useId();
  const status = statusOf(cfg);
  const hasBot = !!cfg.bot_id && !!cfg.source_target_id;
  const hasNumber = !!cfg.promptpay_id_last4;
  const platformOk = cfg.api_base_configured && cfg.api_key_configured;
  const typeMeta = ID_TYPES.find((t) => t.id === idType) ?? ID_TYPES[0]!;
  const canToggle = !saving && (cfg.enabled || hasBot);

  return (
    <section className="page-admin__card ppv-card" aria-labelledby={`${uid}-title`}>
      <header className="ppv-card__head">
        <div className="ppv-card__intro">
          <h3 id={`${uid}-title`} className="ppv-card__title">ตรวจสอบ PromptPay อัตโนมัติ</h3>
          <p className="ppv-card__sub">
            ยืนยันว่าเงินเข้าจริงจากแจ้งเตือน LINE OA ของธนาคาร — ไม่ต้องกดยืนยันเองทุกครั้งที่ลูกค้าสแกนจ่าย
          </p>
        </div>
        <span className={`ppv-badge ppv-badge--${status.tone}`} role="status">
          <span className="ppv-badge__dot" aria-hidden="true" />
          {status.label}
        </span>
      </header>

      {!platformOk && (
        <div className="ppv-alert ppv-alert--warn" role="alert">
          <strong>บริการตรวจสอบยังไม่พร้อม</strong>
          <span>
            ผู้ดูแลระบบต้องตั้งค่า {!cfg.api_base_configured ? 'URL ของบริการ' : 'API key ของระบบ'} ที่เซิร์ฟเวอร์ก่อน จึงจะเปิดใช้งานได้
          </span>
        </div>
      )}

      <ol className="ppv-steps">
        {/* 1) Bot + แชทธนาคาร — dev ผูกให้ (อ่านอย่างเดียว) */}
        <li className={`ppv-step${hasBot ? ' ppv-step--done' : ''}`}>
          <span className="ppv-step__num" aria-hidden="true">{hasBot ? '✓' : '1'}</span>
          <div className="ppv-step__body">
            <h4 className="ppv-step__title">Bot และแชทธนาคาร</h4>
            {hasBot ? (
              <>
                <div className="ppv-bind">
                  <span className="ppv-chip"><span aria-hidden="true">🤖</span> {cfg.bot_name ?? cfg.bot_id}</span>
                  <span className="ppv-bind__arrow" aria-hidden="true">→</span>
                  <span className="ppv-chip"><span aria-hidden="true">💬</span> {cfg.source_target_name ?? cfg.source_target_id}</span>
                </div>
                <p className="ppv-note">ผู้ดูแลระบบเป็นผู้ผูกให้ (1 Bot ต่อ 1 ร้าน) — แก้ไขเองไม่ได้</p>
              </>
            ) : (
              <p className="ppv-note ppv-note--warn">
                ยังไม่ได้ผูก Bot ให้ร้านนี้ — ติดต่อผู้ดูแลระบบเพื่อผูก LINE Bot และแชทธนาคารที่รับแจ้งเงินเข้า
              </p>
            )}
          </div>
        </li>

        {/* 2) พร้อมเพย์ที่รับเงิน */}
        <li className={`ppv-step${hasNumber ? ' ppv-step--done' : ''}`}>
          <span className="ppv-step__num" aria-hidden="true">{hasNumber ? '✓' : '2'}</span>
          <div className="ppv-step__body">
            <h4 className="ppv-step__title">บัญชีพร้อมเพย์ที่รับเงิน</h4>

            <div className="ppv-seg" role="radiogroup" aria-label="ประเภทพร้อมเพย์">
              {ID_TYPES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={idType === t.id}
                  className={`ppv-seg__btn${idType === t.id ? ' ppv-seg__btn--on' : ''}`}
                  onClick={() => onIdType(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="ppv-field">
              <label htmlFor={`${uid}-pp`} className="ppv-field__label">
                หมายเลข{typeMeta.label}
                {hasNumber && <span className="ppv-saved">บันทึกแล้ว ลงท้าย …{cfg.promptpay_id_last4}</span>}
              </label>
              <input
                id={`${uid}-pp`}
                className="input-field ppv-input"
                inputMode="numeric"
                autoComplete="off"
                placeholder={hasNumber ? 'เว้นว่างไว้ถ้าไม่เปลี่ยน' : typeMeta.hint}
                value={ppId}
                onChange={(e) => onPpId(e.target.value.replace(/\D/g, '').slice(0, 15))}
              />
              <p className="ppv-help">{hasNumber ? 'กรอกใหม่เฉพาะเมื่อต้องการเปลี่ยนหมายเลข — ' : ''}เก็บเข้ารหัส AES-256 และไม่แสดงเต็มหลังบันทึก</p>
            </div>

            <div className="ppv-field ppv-field--short">
              <label htmlFor={`${uid}-l4`} className="ppv-field__label">
                เลขบัญชีปลายทาง 4 หลักท้าย <span className="ppv-optional">(ไม่บังคับ)</span>
              </label>
              <input
                id={`${uid}-l4`}
                className="input-field ppv-input"
                inputMode="numeric"
                maxLength={4}
                placeholder="1234"
                value={last4}
                onChange={(e) => onLast4(e.target.value.replace(/\D/g, '').slice(0, 4))}
              />
              <p className="ppv-help">ใช้ตรวจว่าเงินเข้าบัญชีของร้านจริง ช่วยกันสับสนเมื่อมียอดเท่ากันหลายบัญชี</p>
            </div>
          </div>
        </li>
      </ol>

      <footer className="ppv-actions">
        <div className="ppv-switch">
          <button
            type="button"
            role="switch"
            aria-checked={cfg.enabled}
            aria-labelledby={`${uid}-sw`}
            disabled={!canToggle}
            onClick={onToggle}
            className={`page-admin__toggle${cfg.enabled ? ' page-admin__toggle--on' : ''}`}
          >
            <span className="page-admin__toggle-thumb" />
          </button>
          <div>
            <span id={`${uid}-sw`} className="ppv-switch__label">เปิดใช้งานตรวจสอบอัตโนมัติ</span>
            {!hasBot && !cfg.enabled && <span className="ppv-switch__hint">รอผู้ดูแลระบบผูก Bot ก่อน</span>}
          </div>
        </div>

        <div className="ppv-actions__buttons">
          {(hasNumber || cfg.enabled) && (
            <button type="button" className="ppv-btn ppv-btn--danger" disabled={saving} onClick={onClear}>
              ล้างการตั้งค่า
            </button>
          )}
          <button type="button" className="ppv-btn ppv-btn--primary" disabled={saving} onClick={onSave}>
            {saving ? 'กำลังบันทึก…' : 'บันทึก'}
          </button>
        </div>
      </footer>

      <p className="ppv-footnote">
        ⚠️ การใช้บัญชี LINE ส่วนตัวเป็นบอท (self-bot) อาจขัดต่อข้อกำหนดของ LINE — แนะนำใช้บัญชีแยกสำหรับร้านโดยเฉพาะ
      </p>
    </section>
  );
}

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
      { error?: { message?: string; details?: Record<string, string[] | undefined> } } | null;
    const details = j?.error?.details;
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

  return (
    <PromptPayVerifyForm
      cfg={cfg}
      idType={idType}
      ppId={ppId}
      last4={last4}
      saving={saving}
      onIdType={setIdType}
      onPpId={setPpId}
      onLast4={setLast4}
      onSave={() => void save()}
      onToggle={() => void save({ enabled: !cfg.enabled })}
      onClear={() => void clearMine()}
    />
  );
}
