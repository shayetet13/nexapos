'use client';

import React from 'react';
import { Card, SectionHeader, Btn, Empty, thb, type LeaderboardData } from './dev-ui';

interface LeaderboardTabProps {
  lbPeriod: 'day' | 'week' | 'month' | 'year';
  lbOffset: number;
  lbMode: 'live' | 'snapshot';
  lbData: LeaderboardData | null;
  lbLoading: boolean;
  lbPage: number;
  lbCountdown: string;
  snapLoading: boolean;
  setLbPeriod: (p: 'day' | 'week' | 'month' | 'year') => void;
  setLbOffset: React.Dispatch<React.SetStateAction<number>>;
  setLbMode: (m: 'live' | 'snapshot') => void;
  setLbPage: (page: number) => void;
  onTakeSnapshot: () => void;
}

export function LeaderboardTab({
  lbPeriod, lbOffset, lbMode, lbData, lbLoading, lbPage, lbCountdown, snapLoading,
  setLbPeriod, setLbOffset, setLbMode, setLbPage, onTakeSnapshot,
}: LeaderboardTabProps) {
  return (
    <div className="space-y-4">
      {/* ── Controls ── */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          {/* Period type */}
          <div className="flex rounded-lg border border-[var(--color-border)] overflow-hidden">
            {(['day', 'week', 'month', 'year'] as const).map((p) => (
              <button
                key={p} type="button"
                onClick={() => { setLbPeriod(p); setLbOffset(0); setLbPage(0); }}
                className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                  lbPeriod === p
                    ? 'bg-[var(--color-primary)] text-black'
                    : 'text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)]'
                }`}
              >
                {p === 'day' ? 'วัน' : p === 'week' ? 'สัปดาห์' : p === 'month' ? 'เดือน' : 'ปี'}
              </button>
            ))}
          </div>

          {/* Mode: live / snapshot */}
          <div className="flex rounded-lg border border-[var(--color-border)] overflow-hidden">
            <button type="button"
              onClick={() => { setLbMode('live'); setLbOffset(0); }}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${lbMode === 'live' ? 'bg-red-500/20 text-red-400' : 'text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)]'}`}
            >🔴 Live</button>
            <button type="button"
              onClick={() => setLbMode('snapshot')}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${lbMode === 'snapshot' ? 'bg-blue-500/20 text-blue-400' : 'text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)]'}`}
            >📷 ประวัติ</button>
          </div>

          {/* Period navigation */}
          <div className="flex items-center gap-1">
            <Btn variant="ghost" className="text-xs px-2" onClick={() => { setLbOffset((o) => o + 1); setLbPage(0); }}>← ก่อนหน้า</Btn>
            <Btn variant="ghost" className="text-xs px-2" disabled={lbOffset === 0} onClick={() => { setLbOffset((o) => Math.max(0, o - 1)); setLbPage(0); }}>ถัดไป →</Btn>
            {lbOffset > 0 && (
              <Btn variant="ghost" className="text-xs px-2 border-[var(--color-primary)]/40 text-[var(--color-primary)]" onClick={() => { setLbOffset(0); setLbPage(0); }}>
                ปัจจุบัน
              </Btn>
            )}
          </div>

          {/* Snapshot controls */}
          <div className="ml-auto flex items-center gap-3">
            <span className="text-xs text-[var(--color-text-muted)]">
              📸 Snapshot ถัดไป: <span className="font-mono text-[var(--color-primary)]">{lbCountdown}</span>
            </span>
            <Btn variant="ghost" className="text-xs" onClick={onTakeSnapshot} disabled={snapLoading}>
              {snapLoading ? '⏳' : '📸'} บันทึกตอนนี้
            </Btn>
          </div>
        </div>
      </Card>

      {/* ── Leaderboard list ── */}
      <Card>
        <SectionHeader
          title={`🏆 Top ร้านขายดี${lbData?.label ? ` — ${lbData.label}` : ''}`}
          desc={lbData?.mode === 'live'
            ? '🔴 ข้อมูล Live (ดึงจากออเดอร์ล่าสุด)'
            : `📷 Snapshot เมื่อ ${lbData?.snapshot_at ? new Date(lbData.snapshot_at).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : '—'}`}
        />

        {lbLoading ? (
          <div className="py-14 text-center text-sm text-[var(--color-text-muted)] animate-pulse">กำลังโหลด...</div>
        ) : !lbData || lbData.entries.length === 0 ? (
          <div className="p-8"><Empty>ยังไม่มีข้อมูลในช่วงนี้ — ลองเปลี่ยนช่วงเวลา หรือบันทึก Snapshot ก่อน</Empty></div>
        ) : (
          <>
            <div className="divide-y divide-[var(--color-border)]">
              {lbData.entries.slice(lbPage * 5, lbPage * 5 + 5).map((entry) => {
                const maxRev = lbData.entries[0]?.revenue ?? 1;
                const pct    = (entry.revenue / maxRev) * 100;
                const medal  = entry.rank === 1 ? '🥇' : entry.rank === 2 ? '🥈' : entry.rank === 3 ? '🥉' : null;
                const barColor = entry.rank === 1 ? '#f59e0b' : entry.rank === 2 ? '#94a3b8' : entry.rank === 3 ? '#b45309' : 'var(--color-primary)';
                return (
                  <div key={entry.shop_id} className="px-6 py-4 flex items-center gap-4">
                    {/* Rank */}
                    <div className="w-9 shrink-0 text-center">
                      {medal
                        ? <span className="text-2xl leading-none">{medal}</span>
                        : <span className="text-base font-bold text-[var(--color-text-muted)]">#{entry.rank}</span>}
                    </div>

                    {/* Shop info + bar */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-semibold text-[var(--color-text)] truncate">{entry.shop_name}</span>
                        <span className="text-xs text-[var(--color-text-muted)] shrink-0">{entry.order_count} ออเดอร์</span>
                      </div>
                      <div className="h-2 rounded-full bg-[var(--color-bg)] overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${Math.max(2, pct)}%`, background: barColor }}
                        />
                      </div>
                    </div>

                    {/* Revenue */}
                    <div className="text-right shrink-0">
                      <div className="font-bold text-[var(--color-text)] text-sm">{thb(entry.revenue)}</div>
                      <div className="text-xs text-[var(--color-text-muted)]">{pct.toFixed(1)}%</div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Pagination */}
            {lbData.entries.length > 5 && (
              <div className="px-6 py-3 border-t border-[var(--color-border)] flex items-center justify-between">
                <span className="text-xs text-[var(--color-text-muted)]">
                  แสดง {lbPage * 5 + 1}–{Math.min(lbPage * 5 + 5, lbData.entries.length)} จาก {lbData.entries.length} ร้าน
                </span>
                <div className="flex gap-1">
                  {[...Array(Math.ceil(lbData.entries.length / 5))].map((_, pi) => (
                    <Btn
                      key={pi}
                      variant={lbPage === pi ? 'primary' : 'ghost'}
                      className="text-xs px-2.5"
                      onClick={() => setLbPage(pi)}
                    >
                      {pi + 1}
                    </Btn>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </Card>

      {/* Snapshot timestamp */}
      {lbData?.snapshot_at && (
        <p className="text-xs text-[var(--color-text-muted)] text-center">
          📷 บันทึก Snapshot ล่าสุด: {new Date(lbData.snapshot_at).toLocaleString('th-TH', { dateStyle: 'full', timeStyle: 'medium' })}
        </p>
      )}
    </div>
  );
}
