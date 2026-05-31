'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { fetchWithAuth } from '@/lib/supabase';
import { API_URL } from '@/lib/config';
import { Card, SectionHeader, StatCard, Badge, Btn, Toast, thb, daysUntil, Empty } from './dev-ui';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PlanDistItem {
  plan: string;
  count: number;
  mrr: number;
}

interface ExpiringSoonItem {
  shop_id: string;
  shop_name: string;
  plan: string;
  expires_at: string | null;
  days_left: number | null;
}

interface NewShopMonth {
  month: string;
  count: number;
}

interface AnalyticsData {
  mrr: number;
  arr: number;
  total_shops: number;
  active_subs: number;
  expired_subs: number;
  cancelled_subs: number;
  no_sub: number;
  plan_distribution: PlanDistItem[];
  expiring_soon: ExpiringSoonItem[];
  new_shops_by_month: NewShopMonth[];
}

interface AnalyticsTabProps {
  shopId?: string | null;
}

// ─── Plan badge color ─────────────────────────────────────────────────────────

function planBadgeColor(plan: string): 'gray' | 'blue' | 'green' | 'purple' | 'yellow' {
  switch (plan) {
    case 'free':       return 'gray';
    case 'basic':      return 'blue';
    case 'pro':        return 'green';
    case 'enterprise': return 'purple';
    default:           return 'gray';
  }
}

function DaysBadge({ days }: { days: number | null }) {
  if (days === null) return <span className="days-badge days-badge--none">–</span>;
  if (days > 30)    return <span className="days-badge days-badge--ok">{days}d</span>;
  if (days >= 10)   return <span className="days-badge days-badge--warn">{days}d</span>;
  return <span className="days-badge days-badge--danger">{days}d</span>;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AnalyticsTab(_props: AnalyticsTabProps) {
  const [data,    setData]    = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast,   setToast]   = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [acting,  setActing]  = useState<string | null>(null);

  const fetchAnalytics = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchWithAuth(`${API_URL}/api/v1/dev/analytics`);
      const json = await res.json() as { success: boolean; data: AnalyticsData };
      if (json.success) setData(json.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchAnalytics(); }, [fetchAnalytics]);

  const extend30 = async (shopId: string) => {
    setActing(shopId);
    try {
      const res = await fetchWithAuth(`${API_URL}/api/v1/dev/subscriptions/${shopId}/quick-action`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'extend_30' }),
      });
      const json = await res.json() as { success: boolean };
      if (json.success) {
        setToast({ type: 'ok', text: 'ต่ออายุ 30 วันสำเร็จ' });
        void fetchAnalytics();
      } else {
        setToast({ type: 'err', text: 'เกิดข้อผิดพลาด' });
      }
    } finally {
      setActing(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-sm text-[var(--color-text-muted)] animate-pulse">กำลังโหลด...</p>
      </div>
    );
  }

  if (!data) return <Empty>ไม่สามารถโหลดข้อมูล analytics ได้</Empty>;

  return (
    <div className="space-y-5">
      {toast && <Toast msg={toast} onClose={() => setToast(null)} />}

      {/* ── KPI row ── */}
      <div className="analytics-kpi-row">
        <StatCard icon="💰" label="MRR (รายได้/เดือน)"  value={thb(data.mrr)} accent />
        <StatCard icon="📅" label="ARR (รายได้/ปี)"     value={thb(data.arr)} />
        <StatCard icon="✅" label="Active Subscriptions" value={String(data.active_subs)} />
        <StatCard icon="🏪" label="ร้านทั้งหมด"          value={String(data.total_shops)} />
      </div>

      {/* ── Subscription status summary ── */}
      <Card>
        <SectionHeader title="สถานะ Subscription" />
        <div className="p-4 flex flex-wrap gap-3">
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-green-500/10 text-green-400 border border-green-500/20">
            ✅ Active: {data.active_subs}
          </span>
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-red-500/10 text-red-400 border border-red-500/20">
            ⚠️ Expired: {data.expired_subs}
          </span>
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
            ❌ Cancelled: {data.cancelled_subs}
          </span>
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-gray-500/10 text-gray-400 border border-gray-500/20">
            🚫 No Sub: {data.no_sub}
          </span>
        </div>
      </Card>

      {/* ── Plan distribution ── */}
      <Card>
        <SectionHeader title="แผนแต่ละประเภท" desc="จำนวนร้านและรายได้ต่อแผน" />
        {data.plan_distribution.length === 0 ? (
          <Empty>ไม่มีข้อมูลแผน</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="analytics-dist-table w-full text-sm">
              <thead>
                <tr className="text-xs text-[var(--color-text-muted)] border-b border-[var(--color-border)]">
                  <th className="text-left px-4 py-2">แผน</th>
                  <th className="text-right px-4 py-2">จำนวนร้าน</th>
                  <th className="text-right px-4 py-2">MRR</th>
                </tr>
              </thead>
              <tbody>
                {data.plan_distribution.map((item) => (
                  <tr key={item.plan} className="border-b border-[var(--color-border)] hover:bg-[var(--color-bg-hover)] transition-colors">
                    <td className="px-4 py-2.5">
                      <Badge color={planBadgeColor(item.plan)}>{item.plan}</Badge>
                    </td>
                    <td className="px-4 py-2.5 text-right text-[var(--color-text)]">{item.count}</td>
                    <td className="px-4 py-2.5 text-right text-[var(--color-text)]">{thb(item.mrr)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ── Expiring soon ── */}
      {data.expiring_soon.length > 0 && (
        <Card>
          <SectionHeader title="⚠️ ใกล้หมดอายุ (≤30 วัน)" desc="ต้องต่ออายุเร่งด่วน" />
          <div className="overflow-x-auto">
            <table className="analytics-expiring w-full text-sm">
              <thead>
                <tr className="text-xs text-[var(--color-text-muted)] border-b border-[var(--color-border)]">
                  <th className="text-left px-4 py-2">ร้าน</th>
                  <th className="text-left px-4 py-2">แผน</th>
                  <th className="text-left px-4 py-2">หมดอายุ</th>
                  <th className="text-right px-4 py-2">เหลือ</th>
                  <th className="text-right px-4 py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {data.expiring_soon.map((item) => (
                  <tr key={item.shop_id} className="border-b border-[var(--color-border)] hover:bg-[var(--color-bg-hover)] transition-colors">
                    <td className="px-4 py-2.5 text-[var(--color-text)] font-medium">{item.shop_name}</td>
                    <td className="px-4 py-2.5"><Badge color={planBadgeColor(item.plan)}>{item.plan}</Badge></td>
                    <td className="px-4 py-2.5 text-[var(--color-text-muted)] text-xs">
                      {item.expires_at
                        ? new Date(item.expires_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: '2-digit', month: 'short', year: 'numeric' })
                        : '–'}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <DaysBadge days={daysUntil(item.expires_at)} />
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Btn
                        variant="success"
                        className="text-xs px-2 py-1"
                        disabled={acting === item.shop_id}
                        onClick={() => void extend30(item.shop_id)}
                      >
                        +30d
                      </Btn>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ── New shops by month ── */}
      {data.new_shops_by_month.length > 0 && (
        <Card>
          <SectionHeader title="ร้านใหม่รายเดือน (6 เดือนล่าสุด)" />
          <div className="p-4 flex flex-wrap gap-3">
            {data.new_shops_by_month.map((item) => (
              <div key={item.month} className="text-center px-4 py-3 rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)]">
                <p className="text-xs text-[var(--color-text-muted)]">{item.month}</p>
                <p className="text-xl font-bold text-[var(--color-primary)] mt-1">{item.count}</p>
                <p className="text-xs text-[var(--color-text-muted)]">ร้าน</p>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
