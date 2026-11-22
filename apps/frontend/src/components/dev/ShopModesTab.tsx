'use client';

import React, { useEffect, useState } from 'react';
import { fetchWithAuth } from '@/lib/supabase';
import { API_URL } from '@/lib/config';
import { Card, SectionHeader, Btn, Toast } from './dev-ui';

// ─── Shop mode definitions (must mirror backend ALL_SHOP_MODES) ───────────────

interface ShopMode {
  key: string;
  label: string;
  hint: string;
  icon: string;
  color: string;
}

const SHOP_MODES: ShopMode[] = [
  {
    key:   'retail',
    label: 'ร้านค้า / POS',
    hint:  'ขายหน้าร้านทั่วไป ไม่เน้นโต๊ะนั่ง',
    icon:  '🛒',
    color: 'blue',
  },
  {
    key:   'full_service_restaurant',
    label: 'ร้านอาหาร (ภัตตาคาร)',
    hint:  'โต๊ะนั่ง พนักงานสั่ง เปิดบิล',
    icon:  '🍽️',
    color: 'orange',
  },
];

// ─── Toggle switch ─────────────────────────────────────────────────────────────

function Toggle({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={() => onChange(!enabled)}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] ${
        enabled ? 'bg-emerald-500' : 'bg-[var(--color-border)]'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          enabled ? 'translate-x-5' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ShopModesTab() {
  const [disabled, setDisabled] = useState<string[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [toast,    setToast]    = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res  = await fetchWithAuth(`${API_URL}/api/v1/dev/settings`);
        const json = await res.json() as { success: boolean; data: Record<string, string> };
        if (json.success) {
          const raw = json.data['disabled_shop_modes'] ?? '[]';
          try { setDisabled(JSON.parse(raw) as string[]); } catch { setDisabled([]); }
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function handleToggle(modeKey: string, enabled: boolean) {
    setDisabled((prev) =>
      enabled ? prev.filter((k) => k !== modeKey) : [...prev.filter((k) => k !== modeKey), modeKey],
    );
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API_URL}/api/v1/dev/settings`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ disabled_shop_modes: JSON.stringify(disabled) }),
      });
      const json = await res.json() as { success: boolean };
      setToast(json.success
        ? { type: 'ok',  text: '✅ บันทึกการตั้งค่าระบบร้านแล้ว' }
        : { type: 'err', text: 'เกิดข้อผิดพลาด กรุณาลองใหม่' },
      );
    } catch {
      setToast({ type: 'err', text: 'ไม่สามารถเชื่อมต่อได้' });
    } finally {
      setSaving(false);
    }
  }

  const enabledCount = SHOP_MODES.filter((m) => !disabled.includes(m.key)).length;

  return (
    <div className="space-y-5">
      {toast && <Toast msg={toast} onClose={() => setToast(null)} />}

      {/* ── Header card ── */}
      <Card>
        <SectionHeader
          title="🏪 ระบบร้านที่รองรับ"
          desc="เปิด/ปิดระบบร้านที่ลูกค้าสามารถเลือกได้ตอนสมัคร — เหมาะสำหรับช่วงปรับปรุงระบบ"
        />

        <div className="p-5 space-y-4">
          {loading ? (
            <p className="text-sm text-[var(--color-text-muted)] animate-pulse">กำลังโหลด…</p>
          ) : (
            <>
              <div className="space-y-3">
                {SHOP_MODES.map((mode) => {
                  const isEnabled = !disabled.includes(mode.key);
                  return (
                    <div
                      key={mode.key}
                      className={`flex items-center justify-between gap-4 rounded-xl border px-5 py-4 transition-colors ${
                        isEnabled
                          ? 'border-emerald-500/30 bg-emerald-500/5'
                          : 'border-[var(--color-border)] bg-[var(--color-bg-hover)]'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-2xl leading-none shrink-0">{mode.icon}</span>
                        <div className="min-w-0">
                          <p className={`text-sm font-semibold ${isEnabled ? 'text-[var(--color-text)]' : 'text-[var(--color-text-muted)]'}`}>
                            {mode.label}
                          </p>
                          <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{mode.hint}</p>
                          <p className="text-[10px] font-mono mt-1 text-[var(--color-text-subtle)]">{mode.key}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        <span className={`text-xs font-medium ${isEnabled ? 'text-emerald-400' : 'text-[var(--color-text-muted)]'}`}>
                          {isEnabled ? 'เปิดใช้งาน' : 'ปิดชั่วคราว'}
                        </span>
                        <Toggle enabled={isEnabled} onChange={(v) => handleToggle(mode.key, v)} />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Warning if all disabled */}
              {enabledCount === 0 && (
                <div className="rounded-xl border border-yellow-500/40 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-400">
                  ⚠️ ปิดทุกระบบไว้ — ลูกค้าจะไม่สามารถสมัครสร้างร้านได้จนกว่าจะเปิดอย่างน้อย 1 ระบบ
                </div>
              )}

              <div className="flex items-center justify-between pt-1">
                <p className="text-xs text-[var(--color-text-muted)]">
                  เปิดใช้งาน {enabledCount}/{SHOP_MODES.length} ระบบ
                </p>
                <Btn onClick={() => void handleSave()} disabled={saving}>
                  {saving ? 'กำลังบันทึก…' : '💾 บันทึก'}
                </Btn>
              </div>
            </>
          )}
        </div>
      </Card>

      {/* ── Info card ── */}
      <Card>
        <div className="px-5 py-4 space-y-2">
          <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
            ℹ️ วิธีการทำงาน
          </p>
          <ul className="space-y-1.5 text-sm text-[var(--color-text-muted)]">
            <li>• เมื่อปิดระบบร้านใด ตัวเลือกนั้นจะ<strong className="text-[var(--color-text)]">ซ่อน</strong>จากหน้าสมัครทันที</li>
            <li>• ร้านที่<strong className="text-[var(--color-text)]">สร้างไปแล้ว</strong>ไม่ได้รับผลกระทบ</li>
            <li>• เหมาะใช้ช่วง<strong className="text-[var(--color-text)]">ปรับปรุงหรือทดสอบ</strong>ระบบ</li>
            <li>• การเปลี่ยนแปลงมีผล<strong className="text-[var(--color-text)]">ทันที</strong>หลังบันทึก</li>
          </ul>
        </div>
      </Card>
    </div>
  );
}
