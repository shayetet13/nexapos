'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { fetchWithAuth } from '@/lib/supabase';
import { API_URL } from '@/lib/config';
import { Card, SectionHeader, Btn, Badge, DInput, DSelect, Toast, Empty, type Shop } from './dev-ui';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SubsRow {
  shop_id:          string;
  shop_name:        string;
  shop_code:        string | null;
  plan:             string | null;
  billing_interval: string | null;
  status:           'active' | 'cancelled' | 'past_due' | 'none';
  expires_at:       string | null;
  days_left:        number | null;
  sub_id:           string | null;
  is_whitelisted:   boolean;
}

interface SubsManagerTabProps {
  shops: Shop[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusBadgeColor(status: SubsRow['status']): 'green' | 'red' | 'yellow' | 'gray' {
  switch (status) {
    case 'active':    return 'green';
    case 'cancelled': return 'red';
    case 'past_due':  return 'yellow';
    default:          return 'gray';
  }
}

function planBadgeColor(plan: string | null): 'gray' | 'blue' | 'green' | 'purple' {
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

export function SubsManagerTab(_props: SubsManagerTabProps) {
  const [rows,    setRows]    = useState<SubsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting,  setActing]  = useState<string | null>(null);
  const [toast,   setToast]   = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [search,       setSearch]       = useState('');
  const [filterPlan,   setFilterPlan]   = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  const fetchSubs = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetchWithAuth(`${API_URL}/api/v1/dev/subscriptions-all`);
      const json = await res.json() as { success: boolean; data: SubsRow[] };
      if (json.success) setRows(json.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchSubs(); }, [fetchSubs]);

  const toggleWhitelist = async (shopId: string, current: boolean) => {
    setActing(`${shopId}:wl`);
    try {
      const res = await fetchWithAuth(`${API_URL}/api/v1/dev/subscriptions/${shopId}/whitelist`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_whitelisted: !current }),
      });
      const json = await res.json() as { success: boolean };
      if (json.success) {
        setToast({ type: 'ok', text: !current ? `✅ เพิ่ม WL สำเร็จ` : `🔓 ยกเลิก WL แล้ว` });
        void fetchSubs();
      } else {
        setToast({ type: 'err', text: 'เกิดข้อผิดพลาด' });
      }
    } finally {
      setActing(null);
    }
  };

  const quickAction = async (
    shopId: string,
    action: 'activate' | 'cancel' | 'extend_30' | 'extend_365',
  ) => {
    setActing(`${shopId}:${action}`);
    try {
      const res = await fetchWithAuth(`${API_URL}/api/v1/dev/subscriptions/${shopId}/quick-action`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const json = await res.json() as { success: boolean };
      if (json.success) {
        setToast({ type: 'ok', text: `${action} สำเร็จ` });
        void fetchSubs();
      } else {
        setToast({ type: 'err', text: 'เกิดข้อผิดพลาด' });
      }
    } finally {
      setActing(null);
    }
  };

  // ── Filtered rows ──
  const q = search.trim().toLowerCase();
  const filtered = rows.filter((r) => {
    if (q && !r.shop_name.toLowerCase().includes(q) && !(r.shop_code ?? '').toLowerCase().includes(q)) return false;
    if (filterPlan   && r.plan   !== filterPlan)   return false;
    if (filterStatus && r.status !== filterStatus) return false;
    return true;
  });

  // ── Summary counts ──
  const total    = rows.length;
  const active   = rows.filter((r) => r.status === 'active' && (r.days_left === null || r.days_left > 0)).length;
  const expired  = rows.filter((r) => r.status === 'active' && r.days_left !== null && r.days_left <= 0).length;
  const noSub    = rows.filter((r) => r.status === 'none').length;

  return (
    <div className="space-y-5">
      {toast && <Toast msg={toast} onClose={() => setToast(null)} />}

      {/* ── Summary row ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'ทั้งหมด',   value: total,   color: 'text-[var(--color-text)]' },
          { label: 'Active',    value: active,  color: 'text-green-400' },
          { label: 'Expired',   value: expired, color: 'text-red-400' },
          { label: 'ไม่มีแผน',  value: noSub,   color: 'text-gray-400' },
        ].map(({ label, value, color }) => (
          <Card key={label} className="p-3 text-center">
            <p className="text-xs text-[var(--color-text-muted)]">{label}</p>
            <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
          </Card>
        ))}
      </div>

      {/* ── Filter bar ── */}
      <Card>
        <div className="p-4 flex flex-wrap gap-3 items-center">
          <DInput
            placeholder="ค้นหาชื่อร้าน / รหัส..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs"
          />
          <DSelect value={filterPlan} onChange={(e) => setFilterPlan(e.target.value)} className="w-36">
            <option value="">ทุกแผน</option>
            <option value="free">Free</option>
            <option value="basic">Basic</option>
            <option value="pro">Pro</option>
            <option value="enterprise">Enterprise</option>
          </DSelect>
          <DSelect value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="w-36">
            <option value="">ทุกสถานะ</option>
            <option value="active">Active</option>
            <option value="cancelled">Cancelled</option>
            <option value="past_due">Past Due</option>
            <option value="none">ไม่มีแผน</option>
          </DSelect>
          {(search || filterPlan || filterStatus) && (
            <Btn variant="ghost" className="text-xs" onClick={() => { setSearch(''); setFilterPlan(''); setFilterStatus(''); }}>
              ล้างตัวกรอง
            </Btn>
          )}
          <span className="ml-auto text-xs text-[var(--color-text-muted)]">{filtered.length} รายการ</span>
        </div>
      </Card>

      {/* ── Table ── */}
      <Card>
        <SectionHeader title="รายการ Subscription ทั้งหมด" />
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <p className="text-sm text-[var(--color-text-muted)] animate-pulse">กำลังโหลด...</p>
          </div>
        ) : filtered.length === 0 ? (
          <Empty>ไม่พบข้อมูล</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="subs-table w-full text-sm">
              <thead>
                <tr className="text-xs text-[var(--color-text-muted)] border-b border-[var(--color-border)]">
                  <th className="text-left px-4 py-2">ร้าน</th>
                  <th className="text-left px-4 py-2">แผน</th>
                  <th className="text-left px-4 py-2">สถานะ</th>
                  <th className="text-left px-4 py-2">หมดอายุ</th>
                  <th className="text-right px-4 py-2">เหลือ</th>
                  <th className="text-right px-4 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const isActing = acting?.startsWith(row.shop_id) ?? false;
                  return (
                    <tr key={row.shop_id} className="subs-table__row border-b border-[var(--color-border)] hover:bg-[var(--color-bg-hover)] transition-colors">
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-[var(--color-text)]">{row.shop_name}</p>
                        {row.shop_code && <p className="text-xs text-[var(--color-text-muted)] font-mono">{row.shop_code}</p>}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-wrap gap-1 items-center">
                          {row.plan
                            ? <Badge color={planBadgeColor(row.plan)}>{row.plan}</Badge>
                            : <span className="text-xs text-[var(--color-text-muted)]">–</span>
                          }
                          {row.is_whitelisted && (
                            <span title="Whitelisted — ใช้ได้ฟรีตลอด" style={{ fontSize: '0.7rem', background: 'rgba(168,85,247,0.15)', color: '#c084fc', border: '1px solid rgba(168,85,247,0.4)', borderRadius: 4, padding: '1px 5px', fontWeight: 700 }}>
                              ⭐ WL
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge color={statusBadgeColor(row.status)}>{row.status}</Badge>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-[var(--color-text-muted)]">
                        {row.expires_at
                          ? new Date(row.expires_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: '2-digit', month: 'short', year: 'numeric' })
                          : '–'}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <DaysBadge days={row.days_left} />
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="subs-table__actions flex gap-1 justify-end flex-wrap">
                          <button
                            type="button"
                            className="quick-action-btn quick-action-btn--activate"
                            disabled={isActing}
                            title="Activate"
                            onClick={() => void quickAction(row.shop_id, 'activate')}
                          >✅</button>
                          <button
                            type="button"
                            className="quick-action-btn quick-action-btn--extend"
                            disabled={isActing}
                            title="+30 วัน"
                            onClick={() => void quickAction(row.shop_id, 'extend_30')}
                          >+30d</button>
                          <button
                            type="button"
                            className="quick-action-btn quick-action-btn--extend"
                            disabled={isActing}
                            title="+1 ปี"
                            onClick={() => void quickAction(row.shop_id, 'extend_365')}
                          >+1y</button>
                          <button
                            type="button"
                            className="quick-action-btn quick-action-btn--cancel"
                            disabled={isActing}
                            title="Cancel"
                            onClick={() => void quickAction(row.shop_id, 'cancel')}
                          >❌</button>
                          <button
                            type="button"
                            className="quick-action-btn"
                            disabled={isActing}
                            title={row.is_whitelisted ? 'ยกเลิก Whitelist' : 'เพิ่ม Whitelist (ใช้ได้ฟรีตลอด)'}
                            style={{ background: row.is_whitelisted ? 'rgba(168,85,247,0.25)' : 'rgba(168,85,247,0.08)', color: '#c084fc', border: '1px solid rgba(168,85,247,0.35)', borderRadius: 6, padding: '2px 7px', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer' }}
                            onClick={() => void toggleWhitelist(row.shop_id, row.is_whitelisted)}
                          >{row.is_whitelisted ? '⭐ WL' : '☆ WL'}</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
