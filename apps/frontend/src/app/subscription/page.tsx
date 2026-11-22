'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { AuthHeader } from '@/components/layout/AuthHeader';
import { fetchWithAuth } from '@/lib/supabase';
import { API_URL } from '@/lib/config';
import '@/styles/pages/subscription.css';

// ─── Types ────────────────────────────────────────────────────────────────────

interface FeatureLabel { key: string; label: string; }

interface PlanConfig {
  id:             string;
  name:           string;
  price_monthly:  number;
  price_yearly:   number;
  max_branches:   number;
  max_products:   number;
  features:       string[];
  feature_labels: FeatureLabel[];
  highlight:      boolean;
  color:          string;
  display:        boolean;
}

interface TrialInfo {
  is_trial:   boolean;
  ends_at:    string | null;
  days_left:  number | null;
  trial_days: number;
  is_expired: boolean;
}

interface SubData {
  subscription: {
    plan:             string;
    status:           string;
    expires_at:       string | null;
    billing_interval: string;
  } | null;
  plan_config: PlanConfig;
  usage: { branches: number; products: number };
  trial: TrialInfo;
}

type BillingInterval = 'monthly' | 'yearly';

interface PaymentConfig {
  stripe_link_monthly:         string;
  stripe_link_yearly:          string;
  stripe_renewal_link_monthly: string;
  stripe_renewal_link_yearly:  string;
  yearly_discount_percent:     number;
}

interface RenewalHistoryItem {
  id:               string;
  amount:           number;
  interval:         string | null;
  renewed_at:       string | null;
  new_expires_at:   string | null;
  stripe_session_id: string | null;
}

// ─── Feature icon map ─────────────────────────────────────────────────────────

const FEATURE_ICON: Record<string, string> = {
  pos_basic:            '🛒',
  pos_full:             '⚡',
  pos_customer_display: '🖥️',
  receipt_print:        '🖨️',
  reports_basic:        '📊',
  reports_advanced:     '📈',
  membership:           '👥',
  birthday_notify:      '🎂',
  promotions:           '🎁',
  stock_alert:          '🔔',
  stock_transfer:       '🔄',
  multi_branch:         '🏪',
  dashboard_analytics:  '📉',
  refund_otp:           '🔐',
  telegram_notify:      '📲',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    day:      '2-digit',
    month:    'long',
    year:     'numeric',
  });
}

function buildStripeUrl(base: string, shopId: string): string {
  if (!base) return '';
  try {
    const url = new URL(base);
    url.searchParams.set('client_reference_id', shopId);
    return url.toString();
  } catch {
    return base;
  }
}

// ─── UpgradeModal ─────────────────────────────────────────────────────────────

function UpgradeModal({
  plan, shopId, paymentConfig, onClose,
}: { plan: PlanConfig; shopId: string; paymentConfig: PaymentConfig; onClose: () => void }) {
  const [interval, setInterval] = useState<BillingInterval>('monthly');

  const amount   = interval === 'yearly' ? plan.price_yearly : plan.price_monthly;
  const savings  = plan.price_monthly > 0
    ? Math.round(((plan.price_monthly * 12 - plan.price_yearly) / (plan.price_monthly * 12)) * 100)
    : 0;
  const baseLink  = interval === 'yearly' ? paymentConfig.stripe_link_yearly : paymentConfig.stripe_link_monthly;
  const stripeUrl = buildStripeUrl(baseLink, shopId);

  return (
    <div className="sub-modal-overlay" onClick={onClose}>
      <div className="sub-modal" onClick={(e) => e.stopPropagation()}>
        <div className="sub-modal__header">
          <div className="sub-modal__crown">👑</div>
          <p className="sub-modal__title">Upgrade เป็น Pro</p>
          <p className="sub-modal__subtitle">เลือกรอบการชำระเงิน</p>
        </div>

        <div className="sub-modal__billing-options">
          {(['monthly', 'yearly'] as const).map((iv) => {
            const isActive = interval === iv;
            const price    = iv === 'yearly' ? plan.price_yearly : plan.price_monthly;
            return (
              <button
                key={iv}
                type="button"
                className={`sub-modal__billing-opt${isActive ? ' sub-modal__billing-opt--active' : ''}`}
                onClick={() => setInterval(iv)}
              >
                <span className="sub-modal__billing-opt-title">{iv === 'monthly' ? 'รายเดือน' : 'รายปี'}</span>
                <span className="sub-modal__billing-opt-price">฿{price.toLocaleString()}</span>
                <span className="sub-modal__billing-opt-note">/ {iv === 'monthly' ? 'เดือน' : 'ปี'}</span>
                {iv === 'yearly' && savings > 0 && (
                  <span className="sub-modal__savings-badge">ประหยัด {savings}%</span>
                )}
              </button>
            );
          })}
        </div>

        <div className="sub-modal__summary">
          <span className="sub-modal__summary-label">ยอดชำระ</span>
          <span className="sub-modal__summary-amount">฿{amount.toLocaleString()}</span>
        </div>

        <p className="sub-modal__stripe-note">
          💳 ชำระเงินผ่าน Stripe · บัตรเครดิต / เดบิต · เปิดหน้าชำระในแท็บใหม่
        </p>

        {!stripeUrl && (
          <p className="sub-modal__no-link">ยังไม่ได้ตั้งค่า Payment Link กรุณาติดต่อทีมงาน</p>
        )}

        <div className="sub-modal__actions">
          <button className="sub-modal__cancel-btn" onClick={onClose}>ยกเลิก</button>
          <button
            className="sub-modal__confirm-btn"
            disabled={!stripeUrl}
            onClick={() => { if (stripeUrl) { window.open(stripeUrl, '_blank', 'noopener,noreferrer'); onClose(); } }}
          >
            💳 ไปชำระเงิน
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── PlanCard ─────────────────────────────────────────────────────────────────

function PlanCard({ plan, isCurrent, onUpgrade }: {
  plan:      PlanConfig;
  isCurrent: boolean;
  onUpgrade: (plan: PlanConfig) => void;
}) {
  const isFree = plan.id === 'free';
  const isPro  = !isFree;

  return (
    <div className={`sub-plan-card${isPro ? ' sub-plan-card--pro' : ' sub-plan-card--free'}${isCurrent ? ' sub-plan-card--current' : ''}`}>
      {isPro && !isCurrent && (
        <div className="sub-plan-card__badge">⭐ แนะนำ</div>
      )}
      {isCurrent && (
        <div className="sub-plan-card__badge sub-plan-card__badge--current">✓ แผนปัจจุบัน</div>
      )}

      {/* Header */}
      <div className="sub-plan-card__top">
        <div className="sub-plan-card__icon">{isFree ? '🆓' : '👑'}</div>
        <div>
          <p className="sub-plan-card__name">{plan.name}</p>
          <p className="sub-plan-card__tagline">
            {isFree ? 'เริ่มต้นใช้งานฟรี' : 'ทุกฟีเจอร์ · ไม่จำกัด'}
          </p>
        </div>
      </div>

      {/* Price */}
      <div className="sub-plan-card__pricing">
        {isFree ? (
          <span className="sub-plan-card__price sub-plan-card__price--free">ฟรี</span>
        ) : (
          <>
            <span className="sub-plan-card__price">฿{plan.price_monthly.toLocaleString()}</span>
            <span className="sub-plan-card__period">/ เดือน</span>
          </>
        )}
      </div>
      {isPro && (
        <p className="sub-plan-card__yearly-note">
          หรือ ฿{plan.price_yearly.toLocaleString()} / ปี&nbsp;
          <span className="sub-plan-card__yearly-save">
            (ประหยัด {Math.round(((plan.price_monthly * 12 - plan.price_yearly) / (plan.price_monthly * 12)) * 100)}%)
          </span>
        </p>
      )}

      {/* Divider */}
      <div className="sub-plan-card__divider" />

      {/* Features */}
      <ul className="sub-plan-card__features">
        {plan.feature_labels.map((fl) => (
          <li key={fl.key} className="sub-plan-card__feature">
            <span className="sub-plan-card__feature-icon">{FEATURE_ICON[fl.key] ?? '✓'}</span>
            <span className="sub-plan-card__feature-label">{fl.label}</span>
          </li>
        ))}
      </ul>

      {/* Limits */}
      <div className="sub-plan-card__limits">
        <span className="sub-plan-card__limit-item">
          🏪 {plan.max_branches < 0 ? 'สาขาไม่จำกัด' : `${plan.max_branches} สาขา`}
        </span>
        <span className="sub-plan-card__limit-sep">·</span>
        <span className="sub-plan-card__limit-item">
          📦 {plan.max_products < 0 ? 'สินค้าไม่จำกัด' : `${plan.max_products} รายการ`}
        </span>
      </div>

      {/* CTA */}
      <button
        className={`sub-plan-card__btn${isFree ? ' sub-plan-card__btn--free' : isCurrent ? ' sub-plan-card__btn--current' : ' sub-plan-card__btn--upgrade'}`}
        disabled={isCurrent || isFree}
        onClick={() => { if (!isCurrent && !isFree) onUpgrade(plan); }}
      >
        {isCurrent ? '✓ แผนปัจจุบัน' : isFree ? 'แผนเริ่มต้น' : '🚀 Upgrade เป็น Pro'}
      </button>
    </div>
  );
}

// ─── TrialBanner ──────────────────────────────────────────────────────────────

function TrialBanner({ daysLeft, endsAt, expired, onUpgrade }: {
  daysLeft:  number | null;
  endsAt:    string | null;
  expired:   boolean;
  onUpgrade: () => void;
}) {
  if (expired) {
    return (
      <div className="sub-trial-banner sub-trial-banner--expired">
        <div className="sub-trial-banner__icon">⏰</div>
        <div className="sub-trial-banner__body">
          <p className="sub-trial-banner__title">หมดระยะทดลองใช้แล้ว</p>
          <p className="sub-trial-banner__desc">ขณะนี้ใช้ได้เฉพาะ POS พื้นฐาน · พิมพ์ใบเสร็จ</p>
        </div>
        <button className="sub-trial-banner__btn" onClick={onUpgrade}>Upgrade Pro →</button>
      </div>
    );
  }

  const isUrgent = (daysLeft ?? 99) <= 7;
  return (
    <div className={`sub-trial-banner${isUrgent ? ' sub-trial-banner--urgent' : ''}`}>
      <div className="sub-trial-banner__icon">🎁</div>
      <div className="sub-trial-banner__body">
        <p className="sub-trial-banner__title">
          ทดลองใช้ฟรีทุกฟีเจอร์
          {daysLeft !== null && (
            <span className="sub-trial-banner__days"> — เหลือ <strong>{daysLeft}</strong> วัน</span>
          )}
        </p>
        <p className="sub-trial-banner__desc">
          {endsAt ? `หมดอายุ ${fmtDate(endsAt)} · ` : ''}
          หลังหมดทดลอง จะเหลือเฉพาะ POS · พิมพ์ใบเสร็จ
        </p>
      </div>
      <button className="sub-trial-banner__btn" onClick={onUpgrade}>Upgrade Pro →</button>
    </div>
  );
}

// ─── CurrentPlanBar ───────────────────────────────────────────────────────────

function CurrentPlanBar({ subData }: { subData: SubData }) {
  const { subscription: sub, plan_config: cfg, usage, trial } = subData;
  const isTrial   = trial?.is_trial ?? false;
  const isExpired = trial?.is_expired ?? false;

  const paidDaysLeft = (!isTrial && sub?.expires_at)
    ? Math.ceil((new Date(sub.expires_at).getTime() - Date.now()) / 86_400_000)
    : null;

  const planLabel = isTrial
    ? (isExpired ? 'ฟรี (หมดทดลอง)' : 'ทดลองใช้ฟรี')
    : (cfg?.name ?? sub?.plan ?? 'ฟรี');

  const statusLabel = sub?.status === 'active' ? '● ใช้งานอยู่'
    : sub?.status === 'cancelled' ? '✕ ยกเลิกแล้ว'
    : sub?.status === 'past_due'  ? '⚠ ค้างชำระ'
    : '— ยังไม่มีแผน';

  const statusCls = `sub-status-badge sub-status-badge--${sub?.status ?? 'none'}`;

  return (
    <div className="sub-current">
      <div className="sub-current__left">
        <p className="sub-current__label">แผนที่ใช้อยู่</p>
        <h2 className="sub-current__plan-name">{planLabel}</h2>
        {!isTrial && sub?.expires_at && (
          <p className="sub-current__expires">
            หมดอายุ {fmtDate(sub.expires_at)}
            {paidDaysLeft !== null && paidDaysLeft > 0 && (
              <span className={`sub-current__days${paidDaysLeft <= 7 ? ' sub-current__days--warn' : ''}`}>
                &nbsp;(เหลือ {paidDaysLeft} วัน)
              </span>
            )}
            {paidDaysLeft !== null && paidDaysLeft <= 0 && (
              <span className="sub-current__days sub-current__days--exp">&nbsp;(หมดอายุแล้ว)</span>
            )}
          </p>
        )}
        {isTrial && !isExpired && trial.ends_at && (
          <p className="sub-current__expires">ทดลองใช้ถึง {fmtDate(trial.ends_at)}</p>
        )}
      </div>

      <div className="sub-current__right">
        <span className={statusCls}>{statusLabel}</span>
        <div className="sub-current__usage-row">
          <span className="sub-current__usage-item">
            🏪 {usage.branches} / {cfg?.max_branches < 0 ? '∞' : cfg?.max_branches} สาขา
          </span>
          <span className="sub-current__usage-item">
            📦 {usage.products} / {cfg?.max_products < 0 ? '∞' : cfg?.max_products} สินค้า
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── RenewalTab ───────────────────────────────────────────────────────────────

function RenewalTab({ shopId, subData, paymentConfig }: {
  shopId:        string;
  subData:       SubData | null;
  paymentConfig: PaymentConfig;
}) {
  const [billingInterval, setBillingInterval] = useState<BillingInterval>('monthly');
  const [history,         setHistory]         = useState<RenewalHistoryItem[]>([]);
  const [histLoading,     setHistLoading]      = useState(true);

  useEffect(() => {
    setHistLoading(true);
    fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/subscription/renewal-history`)
      .then((r) => r.json())
      .then((j: { data?: RenewalHistoryItem[] }) => setHistory(j.data ?? []))
      .catch(() => setHistory([]))
      .finally(() => setHistLoading(false));
  }, [shopId]);

  // ── Price calculation ──
  const monthlyPrice   = subData?.plan_config?.price_monthly ?? 299;
  const discountPct    = paymentConfig.yearly_discount_percent ?? 17;
  const yearlyFull     = monthlyPrice * 12;
  const yearlyPrice    = Math.round(yearlyFull * (1 - discountPct / 100));
  const yearlySaving   = yearlyFull - yearlyPrice;

  const renewalLinkBase = billingInterval === 'yearly'
    ? paymentConfig.stripe_renewal_link_yearly
    : paymentConfig.stripe_renewal_link_monthly;

  const stripeUrl = renewalLinkBase
    ? (() => {
        try {
          const u = new URL(renewalLinkBase);
          u.searchParams.set('client_reference_id', `${shopId}__${billingInterval}`);
          return u.toString();
        } catch { return renewalLinkBase; }
      })()
    : '';

  const sub         = subData?.subscription;
  const planName    = sub?.plan === 'pro' ? 'Pro' : (sub?.plan ?? 'ฟรี');
  const expiresAt   = sub?.expires_at ?? null;
  const isPro       = sub?.plan === 'pro';
  const isActive    = sub?.status === 'active';

  return (
    <div className="sub-renewal">

      {/* ── Current status ── */}
      <div className="sub-renewal__status-card">
        <div className="sub-renewal__status-left">
          <span className="sub-renewal__status-icon">{isPro ? '👑' : '🆓'}</span>
          <div>
            <p className="sub-renewal__plan-name">{planName}</p>
            {expiresAt ? (
              <p className="sub-renewal__expires">หมดอายุ {fmtDate(expiresAt)}</p>
            ) : (
              <p className="sub-renewal__expires sub-renewal__expires--none">ไม่มีวันหมดอายุ</p>
            )}
          </div>
        </div>
        <span className={`sub-renewal__status-pill${isActive ? ' sub-renewal__status-pill--active' : ''}`}>
          {isActive ? '● ใช้งานอยู่' : '○ ไม่ได้ใช้งาน'}
        </span>
      </div>

      {/* ── Package selector ── */}
      <div className="sub-renewal__section">
        <p className="sub-renewal__section-title">เลือกแพ็กเกจต่ออายุ</p>

        <div className="sub-renewal__billing-tabs">
          <button
            type="button"
            className={`sub-renewal__billing-tab${billingInterval === 'monthly' ? ' sub-renewal__billing-tab--active' : ''}`}
            onClick={() => setBillingInterval('monthly')}
          >
            รายเดือน
          </button>
          <button
            type="button"
            className={`sub-renewal__billing-tab${billingInterval === 'yearly' ? ' sub-renewal__billing-tab--active' : ''}`}
            onClick={() => setBillingInterval('yearly')}
          >
            รายปี
            {discountPct > 0 && (
              <span className="sub-renewal__save-badge">ประหยัด {discountPct}%</span>
            )}
          </button>
        </div>

        <div className="sub-renewal__price-box">
          {billingInterval === 'monthly' ? (
            <>
              <span className="sub-renewal__price-main">฿{monthlyPrice.toLocaleString()}</span>
              <span className="sub-renewal__price-period">/ เดือน</span>
            </>
          ) : (
            <>
              <span className="sub-renewal__price-main">฿{yearlyPrice.toLocaleString()}</span>
              <span className="sub-renewal__price-period">/ ปี</span>
              {yearlySaving > 0 && (
                <span className="sub-renewal__price-saving">ประหยัด ฿{yearlySaving.toLocaleString()} ต่อปี</span>
              )}
            </>
          )}
        </div>

        {!renewalLinkBase ? (
          <p className="sub-renewal__no-link">ยังไม่ได้ตั้งค่า Payment Link กรุณาติดต่อทีมงาน</p>
        ) : (
          <a
            href={stripeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="sub-renewal__pay-btn"
          >
            💳 ชำระเงิน ฿{(billingInterval === 'yearly' ? yearlyPrice : monthlyPrice).toLocaleString()} ผ่าน Stripe →
          </a>
        )}

        <p className="sub-renewal__note">
          อายุการใช้งานนับจากวันที่ชำระ ·{' '}
          {billingInterval === 'yearly' ? '1 ปี' : '1 เดือน'}นับจากวันชำระ
        </p>
      </div>

      {/* ── Renewal history ── */}
      <div className="sub-renewal__section">
        <p className="sub-renewal__section-title">ประวัติการต่ออายุ</p>

        {histLoading ? (
          <div className="sub-renewal__hist-empty">
            <span className="sub-page__spinner" />
          </div>
        ) : history.length === 0 ? (
          <div className="sub-renewal__hist-empty">ยังไม่มีประวัติการต่ออายุ</div>
        ) : (
          <div className="sub-renewal__hist-table-wrap">
            <table className="sub-renewal__hist-table">
              <thead>
                <tr>
                  <th>วันที่ชำระ</th>
                  <th>ประเภท</th>
                  <th>จำนวนเงิน</th>
                  <th>หมดอายุ</th>
                </tr>
              </thead>
              <tbody>
                {history.map((row) => (
                  <tr key={row.id}>
                    <td>{row.renewed_at ? fmtDate(row.renewed_at) : '—'}</td>
                    <td>
                      <span className={`sub-renewal__hist-badge${row.interval === 'yearly' ? ' sub-renewal__hist-badge--yearly' : ' sub-renewal__hist-badge--monthly'}`}>
                        {row.interval === 'yearly' ? 'รายปี' : 'รายเดือน'}
                      </span>
                    </td>
                    <td>฿{row.amount.toLocaleString()}</td>
                    <td>{row.new_expires_at ? fmtDate(row.new_expires_at) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main content ─────────────────────────────────────────────────────────────

function SubscriptionContent() {
  const params   = useSearchParams();
  const shopIdQs = params.get('shopId');

  const [shopId,        setShopId]        = useState<string | null>(shopIdQs);
  const [subData,       setSubData]       = useState<SubData | null>(null);
  const [allPlans,      setAllPlans]      = useState<PlanConfig[]>([]);
  const [paymentConfig, setPaymentConfig] = useState<PaymentConfig>({
    stripe_link_monthly: '', stripe_link_yearly: '',
    stripe_renewal_link_monthly: '', stripe_renewal_link_yearly: '',
    yearly_discount_percent: 17,
  });
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState<string | null>(null);
  const [upgradeTarget, setUpgradeTarget] = useState<PlanConfig | null>(null);
  const [activeTab,     setActiveTab]     = useState<'plan' | 'renewal'>('plan');

  useEffect(() => {
    if (shopIdQs) { setShopId(shopIdQs); return; }
    fetchWithAuth(`${API_URL}/api/v1/me/shops`).then(async (res) => {
      if (!res.ok) return;
      const json = (await res.json()) as { data?: { id: string }[] };
      if (json.data?.[0]) setShopId(json.data[0].id);
    });
  }, [shopIdQs]);

  const loadData = useCallback(async () => {
    if (!shopId) return;
    setLoading(true); setError(null);
    try {
      const [subRes, plansRes, cfgRes] = await Promise.all([
        fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/subscription`),
        fetch(`${API_URL}/api/v1/subscription/plans`),
        fetch(`${API_URL}/api/v1/subscription/payment-config`),
      ]);
      if (!subRes.ok) {
        const j = (await subRes.json()) as { error?: { message?: string } };
        throw new Error(j.error?.message ?? 'โหลดข้อมูลไม่สำเร็จ');
      }
      const [subJson, plansJson, cfgJson] = await Promise.all([
        subRes.json()   as Promise<{ data: SubData }>,
        plansRes.json() as Promise<{ data: PlanConfig[] }>,
        cfgRes.json()   as Promise<{ data: PaymentConfig }>,
      ]);
      setSubData(subJson.data);
      setAllPlans((plansJson.data ?? []).filter((p) => p.display));
      setPaymentConfig(cfgJson.data ?? { stripe_link_monthly: '', stripe_link_yearly: '' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'เกิดข้อผิดพลาด');
    } finally {
      setLoading(false);
    }
  }, [shopId]);

  useEffect(() => { loadData(); }, [loadData]);

  if (loading) {
    return (
      <div className="sub-page__loading">
        <span className="sub-page__spinner" />
        <span>กำลังโหลด...</span>
      </div>
    );
  }

  if (error) {
    return <div className="sub-page"><div className="sub-page__error">{error}</div></div>;
  }

  const currentPlanId = subData?.subscription?.plan ?? 'free';
  const trial         = subData?.trial;
  const isTrial       = trial?.is_trial ?? false;
  const isExpired     = trial?.is_expired ?? false;
  const trialDays     = trial?.days_left ?? null;
  const trialEnd      = trial?.ends_at ?? null;
  const proPlans      = allPlans.filter((p) => p.id === 'pro');

  return (
    <main className="sub-page">

      {/* ── Hero heading ── */}
      <div className="sub-hero">
        <h1 className="sub-hero__title">เลือกแผนที่ใช่สำหรับคุณ</h1>
        <p className="sub-hero__sub">ปลดล็อกทุกฟีเจอร์ด้วยแผน Pro — จัดการร้านได้อย่างเต็มประสิทธิภาพ</p>
      </div>

      {/* ── Tab navigation ── */}
      <div className="sub-tabs">
        <button
          type="button"
          className={`sub-tabs__tab${activeTab === 'plan' ? ' sub-tabs__tab--active' : ''}`}
          onClick={() => setActiveTab('plan')}
        >
          แผน
        </button>
        <button
          type="button"
          className={`sub-tabs__tab${activeTab === 'renewal' ? ' sub-tabs__tab--active' : ''}`}
          onClick={() => setActiveTab('renewal')}
        >
          ต่ออายุ
        </button>
      </div>

      {activeTab === 'plan' && (
        <>
          {/* ── Trial Banner ── */}
          {isTrial && (
            <TrialBanner
              daysLeft={trialDays}
              endsAt={trialEnd}
              expired={isExpired}
              onUpgrade={() => { if (proPlans[0]) setUpgradeTarget(proPlans[0]); }}
            />
          )}

          {/* ── Current plan ── */}
          {subData && <CurrentPlanBar subData={subData} />}

          {/* ── Plan grid ── */}
          <div className="sub-plans-grid">
            {allPlans.map((plan) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                isCurrent={
                  plan.id === currentPlanId ||
                  (plan.id === 'pro' && ['basic', 'enterprise'].includes(currentPlanId))
                }
                onUpgrade={setUpgradeTarget}
              />
            ))}
          </div>

          {/* ── FAQ ── */}
          <div className="sub-faq">
            <p className="sub-faq__heading">❓ คำถามที่พบบ่อย</p>
            {[
              ['ชำระเงินแล้วเมื่อไหร่จะได้ใช้?', 'Stripe ยืนยันแบบ real-time — ระบบเปิดใช้งานอัตโนมัติหลังได้รับการยืนยัน'],
              ['Telegram Bot คืออะไร?', 'แจ้งเตือน OTP คืนเงิน + ยืนยัน Refund ผ่าน Telegram ส่วนตัว เชื่อมได้ทุกร้านแยกกัน'],
              ['ชำระด้วยอะไรได้บ้าง?', 'บัตรเครดิต / เดบิต Visa, Mastercard ผ่าน Stripe — ปลอดภัย 100%'],
              ['ยกเลิกได้ไหม?', 'ยกเลิกได้ทุกเมื่อ ระบบจะยังใช้ได้จนหมดรอบที่ชำระ'],
            ].map(([q, a]) => (
              <div key={q} className="sub-faq__item">
                <p className="sub-faq__q">{q}</p>
                <p className="sub-faq__a">{a}</p>
              </div>
            ))}
          </div>
        </>
      )}

      {activeTab === 'renewal' && shopId && (
        <RenewalTab
          shopId={shopId}
          subData={subData}
          paymentConfig={paymentConfig}
        />
      )}

      {/* ── Upgrade modal ── */}
      {upgradeTarget && shopId && (
        <UpgradeModal
          plan={upgradeTarget}
          shopId={shopId}
          paymentConfig={paymentConfig}
          onClose={() => setUpgradeTarget(null)}
        />
      )}
    </main>
  );
}

// ─── Page export ──────────────────────────────────────────────────────────────

export default function SubscriptionPage() {
  return (
    <>
      <AuthHeader title="Subscription" backToPOS backLabel="← กลับ POS" />
      <Suspense fallback={
        <div className="sub-page__loading">
          <span className="sub-page__spinner" />
          <span>กำลังโหลด...</span>
        </div>
      }>
        <SubscriptionContent />
      </Suspense>
    </>
  );
}
