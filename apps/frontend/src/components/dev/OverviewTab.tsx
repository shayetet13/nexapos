'use client';

import React from 'react';
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import {
  Card, SectionHeader, StatCard, Badge, Btn,
  chartTooltipStyle, thb, daysUntil, formatCode,
  type OverviewData,
} from './dev-ui';

interface OverviewTabProps {
  overview: OverviewData | null;
  ovPeriod: 'day' | 'week' | 'month' | 'year';
  ovOffset: number;
  ovLoading: boolean;
  setOvPeriod: (p: 'day' | 'week' | 'month' | 'year') => void;
  setOvOffset: React.Dispatch<React.SetStateAction<number>>;
  onPrintReport: () => void;
  onGoToSubscription: (shopId: string) => void;
}

export function OverviewTab({
  overview, ovPeriod, ovOffset, ovLoading,
  setOvPeriod, setOvOffset, onPrintReport, onGoToSubscription,
}: OverviewTabProps) {
  return (
    <div className="space-y-5">
      {/* ── Period nav bar ── */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Period type buttons */}
        <div className="flex rounded-lg border border-[var(--color-border)] overflow-hidden">
          {(['day', 'week', 'month', 'year'] as const).map((p) => (
            <button
              key={p} type="button"
              onClick={() => { setOvPeriod(p); setOvOffset(0); }}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                ovPeriod === p
                  ? 'bg-[var(--color-primary)] text-black'
                  : 'text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)]'
              }`}
            >
              {p === 'day' ? 'วัน' : p === 'week' ? 'สัปดาห์' : p === 'month' ? 'เดือน' : 'ปี'}
            </button>
          ))}
        </div>
        {/* Prev / next navigation */}
        <Btn variant="ghost" className="text-xs px-2" onClick={() => setOvOffset((o) => o + 1)}>← ก่อนหน้า</Btn>
        <Btn variant="ghost" className="text-xs px-2" disabled={ovOffset === 0} onClick={() => setOvOffset((o) => Math.max(0, o - 1))}>ถัดไป →</Btn>
        {ovOffset > 0 && (
          <Btn variant="ghost" className="text-xs px-2 border-[var(--color-primary)]/40 text-[var(--color-primary)]" onClick={() => setOvOffset(0)}>
            ปัจจุบัน
          </Btn>
        )}
        {/* Period label */}
        {overview && (
          <span className="text-xs text-[var(--color-text-muted)] px-2">
            {ovLoading ? '⏳ กำลังโหลด...' : overview.period_label}
          </span>
        )}
        {/* PDF export */}
        <div className="ml-auto flex gap-2">
          <Btn variant="ghost" className="text-xs" onClick={onPrintReport} disabled={!overview || ovLoading}>
            📄 ส่งออก PDF
          </Btn>
        </div>
      </div>

      {(!overview || ovLoading) ? (
        <div className="py-16 text-center text-sm text-[var(--color-text-muted)] animate-pulse">กำลังโหลดข้อมูล...</div>
      ) : (
        <>
          {/* ── KPI Cards ── */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <StatCard icon="🏪" label="ร้านทั้งหมด"    value={`${overview.total_shops} ร้าน`} />
            <StatCard icon="🏢" label="สาขา"           value={`${overview.total_branches} สาขา`} />
            <StatCard icon="👥" label="ผู้ใช้งาน"      value={`${overview.total_users} คน`} />
            <StatCard icon="💰" label={`รายได้${ovPeriod === 'day' ? 'วันนี้' : ovPeriod === 'week' ? 'สัปดาห์นี้' : ovPeriod === 'month' ? 'เดือนนี้' : 'ปีนี้'}`} value={thb(overview.revenue_period)} accent />
            <StatCard icon="📦" label="รายได้วันนี้"   value={thb(overview.revenue_today)}
              sub={overview.revenue_today > 0 ? '🟢 มีออเดอร์วันนี้' : '—'} />
          </div>

          {/* ── Alerts ── */}
          {(() => {
            const now2      = new Date();
            const expired   = overview.shops.filter((s) => s.subscription?.expires_at && new Date(s.subscription.expires_at) < now2);
            const soon      = overview.shops.filter((s) => { const d = daysUntil(s.subscription?.expires_at); return d !== null && d >= 0 && d <= 7; });
            const nosub     = overview.shops.filter((s) => !s.subscription);
            if (!expired.length && !soon.length && !nosub.length) return null;
            return (
              <div className="space-y-2">
                {expired.map((s) => (
                  <div key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3 rounded-xl border border-red-500/30 bg-red-500/8 text-red-400 text-sm">
                    <span>🔴</span>
                    <span className="font-semibold">{s.name}</span>
                    <span className="text-red-400/70 text-xs">หมดอายุแล้ว เมื่อ {new Date(s.subscription!.expires_at!).toLocaleDateString('th-TH')}</span>
                    <Btn variant="danger" className="text-xs ml-auto" onClick={() => onGoToSubscription(s.id)}>ต่ออายุ →</Btn>
                  </div>
                ))}
                {soon.map((s) => (
                  <div key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3 rounded-xl border border-yellow-500/30 bg-yellow-500/8 text-yellow-400 text-sm">
                    <span>⚠️</span>
                    <span className="font-semibold">{s.name}</span>
                    <span className="text-yellow-400/70 text-xs">หมดอายุในอีก {daysUntil(s.subscription?.expires_at)} วัน ({new Date(s.subscription!.expires_at!).toLocaleDateString('th-TH')})</span>
                    <Btn variant="warn" className="text-xs ml-auto" onClick={() => onGoToSubscription(s.id)}>ต่ออายุ →</Btn>
                  </div>
                ))}
                {nosub.map((s) => (
                  <div key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text-muted)] text-sm">
                    <span>ℹ️</span>
                    <span className="font-medium">{s.name}</span>
                    <span className="text-xs opacity-70">ยังไม่มีข้อมูลแผนบริการ</span>
                    <Btn variant="ghost" className="text-xs ml-auto" onClick={() => onGoToSubscription(s.id)}>ตั้งค่า →</Btn>
                  </div>
                ))}
              </div>
            );
          })()}

          {/* ── Charts row ── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Trend line chart */}
            <Card>
              <SectionHeader
                title={`📈 เทรนด์รายได้${ovPeriod === 'day' ? ' (รายชั่วโมง)' : ovPeriod === 'week' ? ' (รายวัน)' : ovPeriod === 'month' ? ' (รายวัน)' : ' (รายเดือน)'}`}
                desc="ยอดรวมทุกร้าน (บาท)"
              />
              <div className="px-4 pb-4 pt-2 h-[230px] min-h-0">
                <ResponsiveContainer width="100%" height={210}>
                  <LineChart data={overview.trend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: '#6b7280', fontSize: 10 }}
                      axisLine={false} tickLine={false}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v)}
                      tick={{ fill: '#6b7280', fontSize: 10 }}
                      axisLine={false} tickLine={false} width={40}
                    />
                    <Tooltip
                      formatter={(v: unknown) => [thb(Number(v)), 'ยอดขาย']}
                      contentStyle={chartTooltipStyle}
                    />
                    <Line type="monotone" dataKey="total" stroke="#00d4ff" strokeWidth={2.5}
                      dot={{ fill: '#00d4ff', r: 3, strokeWidth: 0 }}
                      activeDot={{ r: 5, fill: '#00d4ff' }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>

            {/* Top shops bar chart */}
            <Card>
              <SectionHeader title={`🏆 Top ร้านขายดี (${overview.period_label})`} desc="เรียงตามรายได้สูงสุด" />
              <div className="px-4 pb-4 pt-2 h-[230px] min-h-0">
                <ResponsiveContainer width="100%" height={210}>
                  <BarChart
                    layout="vertical"
                    data={[...overview.shops]
                      .sort((a, b) => b.revenue_period - a.revenue_period)
                      .slice(0, 6)
                      .map((s) => ({ name: s.name.length > 10 ? s.name.slice(0, 10) + '…' : s.name, revenue: s.revenue_period }))}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
                    <XAxis
                      type="number"
                      tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v)}
                      tick={{ fill: '#6b7280', fontSize: 10 }}
                      axisLine={false} tickLine={false}
                    />
                    <YAxis
                      type="category" dataKey="name" width={72}
                      tick={{ fill: '#9ca3af', fontSize: 10 }}
                      axisLine={false} tickLine={false}
                    />
                    <Tooltip
                      formatter={(v: unknown) => [thb(Number(v)), 'รายได้']}
                      contentStyle={chartTooltipStyle}
                      cursor={false}
                    />
                    <Bar dataKey="revenue" fill="#00d4ff" radius={[0, 4, 4, 0]} activeBar={false} background={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          {/* ── Shop summary table ── */}
          <Card>
            <SectionHeader title="สรุปทุกร้าน" desc={`เรียงตามรายได้ — ${overview.period_label}`} />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border)]">
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">ร้าน</th>
                    <th className="text-right px-4 py-2.5 text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">วันนี้</th>
                    <th className="text-right px-4 py-2.5 text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">{ovPeriod === 'day' ? 'วันนี้' : ovPeriod === 'week' ? 'สัปดาห์นี้' : ovPeriod === 'month' ? 'เดือนนี้' : 'ปีนี้'}</th>
                    <th className="text-right px-4 py-2.5 text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">ออเดอร์</th>
                    <th className="text-center px-4 py-2.5 text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">สาขา / คน</th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">แผน</th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">หมดอายุ</th>
                    <th className="text-right px-4 py-2.5 text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {[...overview.shops]
                    .sort((a, b) => b.revenue_period - a.revenue_period)
                    .map((s) => {
                      const d          = daysUntil(s.subscription?.expires_at);
                      const isExpired  = d !== null && d < 0;
                      const isExpiring = d !== null && d >= 0 && d <= 7;
                      const subColor: 'green' | 'yellow' | 'red' | 'gray' = !s.subscription ? 'gray' : isExpired ? 'red' : isExpiring ? 'yellow' : 'green';
                      return (
                        <tr key={s.id} className="hover:bg-[var(--color-bg-hover)] transition-colors">
                          <td className="px-4 py-3">
                            <div className="font-medium text-[var(--color-text)] truncate max-w-[140px]">{s.name}</div>
                            <div className="text-xs text-[var(--color-text-muted)]">
                              {s.shop_code ? <span className="font-mono text-[var(--color-primary)]">{formatCode(s.shop_code)}</span> : s.province ?? '—'}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-xs">
                            {s.revenue_today > 0
                              ? <span className="text-green-400 font-semibold">{thb(s.revenue_today)}</span>
                              : <span className="text-[var(--color-text-subtle)]">—</span>}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-sm font-semibold text-[var(--color-text)]">
                            {s.revenue_period > 0 ? thb(s.revenue_period) : <span className="text-[var(--color-text-subtle)] font-normal text-xs">—</span>}
                          </td>
                          <td className="px-4 py-3 text-right text-[var(--color-text-muted)] text-xs">{s.order_count_period || '—'}</td>
                          <td className="px-4 py-3 text-center text-xs text-[var(--color-text-muted)]">
                            {s.branch_count}🏢 / {s.user_count}👤
                          </td>
                          <td className="px-4 py-3">
                            {s.subscription
                              ? <Badge color={subColor}>{s.subscription.plan}</Badge>
                              : <span className="text-xs text-[var(--color-text-subtle)]">—</span>}
                          </td>
                          <td className="px-4 py-3">
                            {s.subscription?.expires_at ? (
                              <span className={`text-xs font-medium ${isExpired ? 'text-red-400' : isExpiring ? 'text-yellow-400' : 'text-[var(--color-text-muted)]'}`}>
                                {isExpired ? '🔴 ' : isExpiring ? '⏰ ' : ''}{new Date(s.subscription.expires_at).toLocaleDateString('th-TH')}
                              </span>
                            ) : <span className="text-xs text-[var(--color-text-subtle)]">—</span>}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Btn variant="ghost" className="text-xs" onClick={() => onGoToSubscription(s.id)}>💳</Btn>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
