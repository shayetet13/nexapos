'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { fetchWithAuth } from '@/lib/supabase';
import { API_URL } from '@/lib/config';
import { Badge, Btn, Card, DSelect, FieldLabel, SectionHeader, Toast } from './dev-ui';

interface BotOption {
  id: string;
  name: string;
  status: string;
  targets: { id: string; name: string; type: string }[];
  claimed_by: { shop_id: string; shop_name: string } | null;
}

interface Binding {
  shop_id: string;
  shop_name: string;
  bot_id: string | null;
  bot_name: string | null;
  source_target_id: string | null;
  source_target_name: string | null;
  enabled: boolean;
}

interface Overview {
  platform: { base_url_configured: boolean; api_key_configured: boolean };
  platform_error: string | null;
  bots: BotOption[];
  bindings: Binding[];
}

interface ShopLite { id: string; name: string }

interface ApiError { error?: { message?: string; details?: Record<string, string[]> } }

async function apiMessage(res: Response, fallback: string): Promise<string> {
  const j = await res.json().catch(() => null) as ApiError | null;
  const detail = j?.error?.details ? Object.values(j.error.details).flat()[0] : undefined;
  return detail ?? j?.error?.message ?? fallback;
}

/**
 * ผูก LINE Bot + แชทธนาคารให้แต่ละร้าน (dev เท่านั้น)
 * API key ของ platform เห็น bot ของทุกร้าน เจ้าของร้านจึงเลือกเองไม่ได้ — 1 Bot ผูกได้ร้านเดียว
 */
export function PromptPayBindingsCard() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [shops, setShops] = useState<ShopLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [shopId, setShopId] = useState('');
  const [botId, setBotId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ovRes, shopsRes] = await Promise.all([
        fetchWithAuth(`${API_URL}/api/v1/dev/promptpay-verify/overview`),
        fetchWithAuth(`${API_URL}/api/v1/dev/shops`),
      ]);
      if (ovRes.ok) setOverview((await ovRes.json()).data as Overview);
      else setToast({ type: 'err', text: await apiMessage(ovRes, 'โหลดข้อมูลการผูก Bot ไม่สำเร็จ') });
      if (shopsRes.ok) {
        const list = (await shopsRes.json()).data as ShopLite[];
        setShops(list.map(({ id, name }) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'th')));
      }
    } catch {
      setToast({ type: 'err', text: 'ไม่สามารถเชื่อมต่อได้' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const currentBot = overview?.bots.find((b) => b.id === botId) ?? null;

  async function putBinding(targetShopId: string, body: { bot_id: string | null; source_target_id: string | null }) {
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API_URL}/api/v1/dev/promptpay-verify/shops/${targetShopId}/binding`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) { setToast({ type: 'err', text: await apiMessage(res, 'บันทึกไม่สำเร็จ') }); return; }
      setToast({ type: 'ok', text: body.bot_id ? '✅ ผูก Bot ให้ร้านแล้ว' : '✅ ยกเลิกการผูกแล้ว (ร้านถูกปิดใช้งานอัตโนมัติ)' });
      if (body.bot_id) { setBotId(''); setTargetId(''); }
      await load();
    } catch {
      setToast({ type: 'err', text: 'ไม่สามารถเชื่อมต่อได้' });
    } finally {
      setSaving(false);
    }
  }

  const platformReady = !!overview && overview.platform.base_url_configured && overview.platform.api_key_configured;

  return (
    <Card>
      <SectionHeader title="🤖 ผูก LINE Bot ให้แต่ละร้าน (PromptPay auto-verify)" />
      <div className="p-5 space-y-4">
        {toast && <Toast msg={toast} onClose={() => setToast(null)} />}
        {loading && !overview ? (
          <p className="text-sm text-[var(--color-text-muted)] animate-pulse">กำลังโหลด…</p>
        ) : !overview ? null : (
          <>
            <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">
              API key ของ LINEJS platform อยู่ที่ env <code>LINEJS_API_KEY</code> ฝั่ง backend (scope: bots:read, promptpay:read, promptpay:write)
              และเห็น Bot ของทุกร้าน — จึงให้เฉพาะผู้ดูแลระบบเลือกว่าร้านไหนใช้ Bot ตัวไหน (1 Bot ต่อ 1 ร้าน) เจ้าของร้านเห็นแค่ Bot ที่ผูกให้ร้านตัวเอง
            </p>

            {!platformReady && (
              <p className="text-xs text-red-400">
                {!overview.platform.base_url_configured && 'ยังไม่ได้ตั้ง Base URL (ด้านบน หรือ env LINEJS_API_BASE_URL). '}
                {!overview.platform.api_key_configured && 'ยังไม่ได้ตั้ง env LINEJS_API_KEY (รูปแบบ lbk_…) ที่ backend.'}
              </p>
            )}
            {overview.platform_error && <p className="text-xs text-red-400">platform: {overview.platform_error}</p>}

            {platformReady && !overview.platform_error && (
              <div className="grid gap-3 md:grid-cols-3">
                <div>
                  <FieldLabel>ร้าน</FieldLabel>
                  <DSelect value={shopId} onChange={(e) => setShopId(e.target.value)}>
                    <option value="">— เลือกร้าน —</option>
                    {shops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </DSelect>
                </div>
                <div>
                  <FieldLabel>Bot</FieldLabel>
                  <DSelect value={botId} onChange={(e) => { setBotId(e.target.value); setTargetId(''); }}>
                    <option value="">— เลือก Bot —</option>
                    {overview.bots.map((b) => (
                      <option key={b.id} value={b.id} disabled={!!b.claimed_by && b.claimed_by.shop_id !== shopId}>
                        {b.name}{b.status === 'online' ? '' : ` (${b.status})`}{b.claimed_by ? ` — ใช้โดย ${b.claimed_by.shop_name}` : ''}
                      </option>
                    ))}
                  </DSelect>
                </div>
                <div>
                  <FieldLabel>แชท LINE OA ธนาคาร</FieldLabel>
                  <DSelect value={targetId} onChange={(e) => setTargetId(e.target.value)} disabled={!currentBot}>
                    <option value="">— เลือกแชท —</option>
                    {currentBot?.targets.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </DSelect>
                </div>
                {currentBot && currentBot.targets.length === 0 && (
                  <p className="text-xs text-yellow-400 md:col-span-3">
                    Bot นี้ยังไม่มีแชทที่อนุญาต — เพิ่ม/อนุญาตแชท LINE OA ธนาคารและยืนยัน consent ที่แท็บ Targets ในแดชบอร์ดของ platform (http://localhost:5173) ก่อน
                  </p>
                )}
                {currentBot && currentBot.status !== 'online' && (
                  <p className="text-xs text-yellow-400 md:col-span-3">
                    Bot นี้ยังไม่ออนไลน์ (สถานะ: {currentBot.status}) — ผูกได้ แต่ต้องกดเริ่ม Bot ที่แดชบอร์ดของ platform ก่อนจึงจะตรวจเงินเข้าได้
                  </p>
                )}
                <div className="md:col-span-3">
                  <Btn
                    disabled={saving || !shopId || !botId || !targetId}
                    onClick={() => void putBinding(shopId, { bot_id: botId, source_target_id: targetId })}
                  >
                    {saving ? 'กำลังบันทึก…' : '🔗 ผูก Bot กับร้านนี้'}
                  </Btn>
                </div>
              </div>
            )}

            <div>
              <FieldLabel>ร้านที่ผูกไว้แล้ว ({overview.bindings.length})</FieldLabel>
              {overview.bindings.length === 0 ? (
                <p className="text-xs text-[var(--color-text-muted)]">ยังไม่มีร้านที่ผูก Bot</p>
              ) : (
                <ul className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)]">
                  {overview.bindings.map((b) => (
                    <li key={b.shop_id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                      <span className="font-semibold">{b.shop_name}</span>
                      <span className="text-xs text-[var(--color-text-muted)]">
                        {b.bot_name ?? b.bot_id} → {b.source_target_name ?? b.source_target_id}
                      </span>
                      <Badge color={b.enabled ? 'green' : 'gray'}>{b.enabled ? 'เปิดใช้งาน' : 'ปิดอยู่'}</Badge>
                      <Btn
                        variant="danger"
                        className="ml-auto"
                        disabled={saving}
                        onClick={() => {
                          if (window.confirm(`ยกเลิกการผูก Bot ของร้าน "${b.shop_name}"? (ร้านจะถูกปิดการตรวจสอบอัตโนมัติ)`)) {
                            void putBinding(b.shop_id, { bot_id: null, source_target_id: null });
                          }
                        }}
                      >
                        ยกเลิกการผูก
                      </Btn>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
