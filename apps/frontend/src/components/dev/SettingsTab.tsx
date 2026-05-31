'use client';

import React, { useEffect, useState } from 'react';
import { fetchWithAuth } from '@/lib/supabase';
import { API_URL } from '@/lib/config';
import { Card, SectionHeader, FieldLabel, DInput, Btn, Toast } from './dev-ui';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SettingsData {
  stripe_link_monthly:         string;
  stripe_link_yearly:          string;
  stripe_renewal_link_monthly: string;
  stripe_renewal_link_yearly:  string;
  stripe_webhook_secret:       string;
  yearly_discount_percent:     string;
  plan_pro_price_monthly:      string;
  plan_pro_price_yearly:       string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SettingsTab() {
  const [monthly,         setMonthly]         = useState('');
  const [yearly,          setYearly]          = useState('');
  const [renewalMonthly,  setRenewalMonthly]  = useState('');
  const [renewalYearly,   setRenewalYearly]   = useState('');
  const [webhookSecret,   setWebhookSecret]   = useState('');
  const [discountPct,     setDiscountPct]     = useState('17');
  const [priceMonthly,    setPriceMonthly]    = useState('');
  const [priceYearly,     setPriceYearly]     = useState('');
  const [loading,         setLoading]         = useState(true);
  const [savingStripe,    setSavingStripe]     = useState(false);
  const [savingRenewal,   setSavingRenewal]   = useState(false);
  const [savingPrice,     setSavingPrice]     = useState(false);
  const [toast,           setToast]           = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // ── Load ──
  useEffect(() => {
    void (async () => {
      try {
        const res  = await fetchWithAuth(`${API_URL}/api/v1/dev/settings`);
        const json = await res.json() as { success: boolean; data: SettingsData };
        if (json.success) {
          setMonthly(json.data.stripe_link_monthly             ?? '');
          setYearly(json.data.stripe_link_yearly               ?? '');
          setRenewalMonthly(json.data.stripe_renewal_link_monthly ?? '');
          setRenewalYearly(json.data.stripe_renewal_link_yearly   ?? '');
          setWebhookSecret(json.data.stripe_webhook_secret        ?? '');
          setDiscountPct(json.data.yearly_discount_percent        ?? '17');
          setPriceMonthly(json.data.plan_pro_price_monthly        ?? '299');
          setPriceYearly(json.data.plan_pro_price_yearly          ?? '2990');
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // ── Save Stripe Links ──
  async function handleSaveStripe() {
    setSavingStripe(true);
    try {
      const res = await fetchWithAuth(`${API_URL}/api/v1/dev/settings`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          stripe_link_monthly: monthly.trim(),
          stripe_link_yearly:  yearly.trim(),
        }),
      });
      const json = await res.json() as { success: boolean };
      setToast(json.success
        ? { type: 'ok',  text: 'บันทึก Stripe Links สำเร็จ' }
        : { type: 'err', text: 'เกิดข้อผิดพลาด' }
      );
    } catch {
      setToast({ type: 'err', text: 'ไม่สามารถเชื่อมต่อได้' });
    } finally {
      setSavingStripe(false);
    }
  }

  // ── Save Renewal Config ──
  async function handleSaveRenewal() {
    const pct = Number(discountPct);
    if (isNaN(pct) || pct < 0 || pct > 99) {
      setToast({ type: 'err', text: 'ส่วนลดต้องเป็น 0–99%' });
      return;
    }
    setSavingRenewal(true);
    try {
      const res = await fetchWithAuth(`${API_URL}/api/v1/dev/settings`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          stripe_renewal_link_monthly: renewalMonthly.trim(),
          stripe_renewal_link_yearly:  renewalYearly.trim(),
          stripe_webhook_secret:       webhookSecret.trim(),
          yearly_discount_percent:     String(pct),
        }),
      });
      const json = await res.json() as { success: boolean };
      setToast(json.success
        ? { type: 'ok',  text: '✅ บันทึก Renewal Config สำเร็จ' }
        : { type: 'err', text: 'เกิดข้อผิดพลาด' }
      );
    } catch {
      setToast({ type: 'err', text: 'ไม่สามารถเชื่อมต่อได้' });
    } finally {
      setSavingRenewal(false);
    }
  }

  // ── Save Prices ──
  async function handleSavePrice() {
    const mon = Number(priceMonthly);
    const yr  = Number(priceYearly);
    if (!mon || mon <= 0 || !yr || yr <= 0) {
      setToast({ type: 'err', text: 'ราคาต้องเป็นตัวเลขมากกว่า 0' });
      return;
    }
    setSavingPrice(true);
    try {
      const res = await fetchWithAuth(`${API_URL}/api/v1/dev/settings`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          plan_pro_price_monthly: String(mon),
          plan_pro_price_yearly:  String(yr),
        }),
      });
      const json = await res.json() as { success: boolean };
      setToast(json.success
        ? { type: 'ok',  text: `✅ อัปเดตราคา Pro → ฿${mon.toLocaleString()}/เดือน · ฿${yr.toLocaleString()}/ปี` }
        : { type: 'err', text: 'เกิดข้อผิดพลาด' }
      );
    } catch {
      setToast({ type: 'err', text: 'ไม่สามารถเชื่อมต่อได้' });
    } finally {
      setSavingPrice(false);
    }
  }

  return (
    <div className="space-y-5">
      {toast && <Toast msg={toast} onClose={() => setToast(null)} />}

      {/* ── Stripe Payment Links ── */}
      <Card>
        <SectionHeader title="Stripe Payment Links" />
        <div className="p-5 space-y-4">
          {loading ? (
            <p className="text-sm text-[var(--color-text-muted)] animate-pulse">กำลังโหลด…</p>
          ) : (
            <>
              <div>
                <FieldLabel>Pro รายเดือน (฿299/เดือน)</FieldLabel>
                <DInput
                  placeholder="https://buy.stripe.com/…"
                  value={monthly}
                  onChange={(e) => setMonthly(e.target.value)}
                  className="w-full font-mono text-xs"
                />
                {monthly && (
                  <a
                    href={monthly}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 text-xs text-[var(--color-primary)] hover:underline block"
                  >
                    เปิด link ทดสอบ ↗
                  </a>
                )}
              </div>

              <div>
                <FieldLabel>Pro รายปี (฿2,990/ปี)</FieldLabel>
                <DInput
                  placeholder="https://buy.stripe.com/…"
                  value={yearly}
                  onChange={(e) => setYearly(e.target.value)}
                  className="w-full font-mono text-xs"
                />
                {yearly && (
                  <a
                    href={yearly}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 text-xs text-[var(--color-primary)] hover:underline block"
                  >
                    เปิด link ทดสอบ ↗
                  </a>
                )}
              </div>

              <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">
                สร้าง Payment Link ใน{' '}
                <a
                  href="https://dashboard.stripe.com/payment-links"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--color-primary)] hover:underline"
                >
                  Stripe Dashboard → Payment Links ↗
                </a>
                {' '}แล้ววาง URL ที่ได้ด้านบน
              </p>

              <Btn onClick={() => void handleSaveStripe()} disabled={savingStripe}>
                {savingStripe ? 'กำลังบันทึก…' : '💾 บันทึก Stripe Links'}
              </Btn>
            </>
          )}
        </div>
      </Card>

      {/* ── Renewal Config ── */}
      <Card>
        <SectionHeader title="🔄 ระบบต่ออายุ (Renewal)" />
        <div className="p-5 space-y-4">
          {loading ? (
            <p className="text-sm text-[var(--color-text-muted)] animate-pulse">กำลังโหลด…</p>
          ) : (
            <>
              <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">
                Stripe link สำหรับ tab ต่ออายุ — หากว่างจะ fallback ใช้ link ของ Upgrade
              </p>

              <div>
                <FieldLabel>Renewal Link รายเดือน</FieldLabel>
                <DInput
                  placeholder="https://buy.stripe.com/… (ว่างไว้ = ใช้ Upgrade link)"
                  value={renewalMonthly}
                  onChange={(e) => setRenewalMonthly(e.target.value)}
                  className="w-full font-mono text-xs"
                />
              </div>

              <div>
                <FieldLabel>Renewal Link รายปี</FieldLabel>
                <DInput
                  placeholder="https://buy.stripe.com/… (ว่างไว้ = ใช้ Upgrade link)"
                  value={renewalYearly}
                  onChange={(e) => setRenewalYearly(e.target.value)}
                  className="w-full font-mono text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <FieldLabel>ส่วนลดรายปี (%)</FieldLabel>
                  <DInput
                    type="number"
                    min="0"
                    max="99"
                    placeholder="17"
                    value={discountPct}
                    onChange={(e) => setDiscountPct(e.target.value)}
                    className="w-full"
                  />
                  {discountPct && Number(discountPct) > 0 && (
                    <p className="mt-1 text-xs text-[var(--color-green)]">
                      ลูกค้าประหยัด {discountPct}% เมื่อต่ออายุรายปี
                    </p>
                  )}
                </div>

                <div>
                  <FieldLabel>Stripe Webhook Secret</FieldLabel>
                  <DInput
                    type="password"
                    placeholder="whsec_…"
                    value={webhookSecret}
                    onChange={(e) => setWebhookSecret(e.target.value)}
                    className="w-full font-mono text-xs"
                  />
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                    Stripe → Developers → Webhooks
                  </p>
                </div>
              </div>

              <Btn onClick={() => void handleSaveRenewal()} disabled={savingRenewal}>
                {savingRenewal ? 'กำลังบันทึก…' : '🔄 บันทึก Renewal Config'}
              </Btn>
            </>
          )}
        </div>
      </Card>

      {/* ── Plan Pricing ── */}
      <Card>
        <SectionHeader title="💰 ราคาแผน Pro" />
        <div className="p-5 space-y-4">
          {loading ? (
            <p className="text-sm text-[var(--color-text-muted)] animate-pulse">กำลังโหลด…</p>
          ) : (
            <>
              <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">
                ราคาที่ตั้งไว้จะแสดงในหน้า Subscription ของลูกค้าทันที (ไม่ต้อง restart)
              </p>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <FieldLabel>ราคารายเดือน (฿)</FieldLabel>
                  <DInput
                    type="number"
                    min="1"
                    placeholder="299"
                    value={priceMonthly}
                    onChange={(e) => setPriceMonthly(e.target.value)}
                    className="w-full"
                  />
                  {priceMonthly && Number(priceMonthly) > 0 && (
                    <p className="mt-1 text-xs text-[var(--color-primary)]">
                      ฿{Number(priceMonthly).toLocaleString()} / เดือน
                    </p>
                  )}
                </div>

                <div>
                  <FieldLabel>ราคารายปี (฿)</FieldLabel>
                  <DInput
                    type="number"
                    min="1"
                    placeholder="2990"
                    value={priceYearly}
                    onChange={(e) => setPriceYearly(e.target.value)}
                    className="w-full"
                  />
                  {priceYearly && priceMonthly && Number(priceYearly) > 0 && Number(priceMonthly) > 0 && (
                    <p className="mt-1 text-xs text-[var(--color-green)]">
                      ประหยัด {Math.round(((Number(priceMonthly) * 12 - Number(priceYearly)) / (Number(priceMonthly) * 12)) * 100)}% เทียบรายเดือน
                    </p>
                  )}
                </div>
              </div>

              <Btn onClick={() => void handleSavePrice()} disabled={savingPrice}>
                {savingPrice ? 'กำลังบันทึก…' : '💰 อัปเดตราคา'}
              </Btn>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
