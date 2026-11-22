'use client';

/**
 * AuditTab.tsx
 * Admin panel tab for browsing and searching the shop audit log.
 * Features: stats cards, activity feed, ref-code search, detail modal.
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { fetchWithAuth } from '@/lib/supabase';
import {
  describeEvent,
  eventIcon,
  eventIconBg,
  actorLabel,
  actorColorClass,
  relativeTime,
  statusDotClass,
  statusTextClass,
  isSignificantEvent,
  AuditStatus,
  ROLE_TITLE,
  STATUS_LABEL,
  PAYMENT_LABEL,
  type AuditRowBase,
} from '@/lib/audit-translate';

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_PAGE_SIZE = 50;
const REF_SEARCH_LIMIT  = 50;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AuditRow extends AuditRowBase {
  id:             string;
  request_id:     string;
  session_id:     string | null;
  shop_id:        string | null;
  execution_time: number | null;
  user_agent:     string | null;
}

interface AuditStats {
  total:    number;
  errors:   number;
  fails:    number;
  byEvent:  Record<string, number>;
  byStatus: Record<string, number>;
}

interface OrderItem {
  name:       string;
  quantity:   number;
  unit_price: number;
  subtotal:   number;
}

interface AuditTabProps {
  shopId: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Format a UTC date string to Thai locale datetime string (Asia/Bangkok). */
function fmtDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString('th-TH', {
    timeZone:  'Asia/Bangkok',
    day:       '2-digit',
    month:     'short',
    hour:      '2-digit',
    minute:    '2-digit',
    second:    '2-digit',
  });
}

/** Format a number as Thai baht with locale separators. */
function fmtBaht(value: number): string {
  return `฿${value.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

/** Build the shared top-event label for the stats card — skips generic api_call. */
function topEventLabel(byEvent: Record<string, number>): string {
  const named = Object.entries(byEvent)
    .filter(([ev]) => ev !== 'api_call')
    .sort(([, a], [, b]) => b - a);
  const top = named[0] ?? Object.entries(byEvent).sort(([, a], [, b]) => b - a)[0];
  if (!top) return '–';
  return describeEvent({
    event: top[0], status: AuditStatus.SUCCESS,
    user_id: null, role: null, ip_address: null,
    method: null, endpoint: null, error_message: null,
    metadata: {}, created_at: '',
  });
}

function topEventCount(byEvent: Record<string, number>): number {
  const named = Object.entries(byEvent)
    .filter(([ev]) => ev !== 'api_call')
    .sort(([, a], [, b]) => b - a);
  return (named[0] ?? Object.entries(byEvent).sort(([, a], [, b]) => b - a)[0])?.[1] ?? 0;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({
  label, value, sub, color,
}: {
  label: string;
  value: number | string;
  sub?:  string;
  color?: string;
}) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-4 flex flex-col gap-1">
      <p className="text-xs text-[var(--color-text-muted)]">{label}</p>
      <p className={`text-2xl font-bold tabular-nums ${color ?? 'text-[var(--color-text)]'}`}>{value}</p>
      {sub && <p className="text-xs text-[var(--color-text-muted)]">{sub}</p>}
    </div>
  );
}

/** Mini-table showing line items for an order audit event. */
function OrderItemsTable({ items }: { items: OrderItem[] }) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] overflow-hidden">
      <div className="px-4 py-2 border-b border-[var(--color-border)] bg-[var(--color-bg-card)]">
        <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">
          รายการสินค้า
        </p>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[10px] text-[var(--color-text-muted)] border-b border-[var(--color-border)]">
            <th className="px-4 py-2 text-left  font-medium">ชื่อสินค้า</th>
            <th className="px-3 py-2 text-center font-medium">จำนวน</th>
            <th className="px-3 py-2 text-right  font-medium">ราคา/ชิ้น</th>
            <th className="px-4 py-2 text-right  font-medium">รวม</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-border)]">
          {items.map((item, i) => (
            <tr key={i}>
              <td className="px-4 py-2.5 text-[var(--color-text)] font-medium">{item.name}</td>
              <td className="px-3 py-2.5 text-center text-[var(--color-text-muted)]">{item.quantity}</td>
              <td className="px-3 py-2.5 text-right text-[var(--color-text-muted)]">{fmtBaht(Number(item.unit_price))}</td>
              <td className="px-4 py-2.5 text-right font-semibold text-[var(--color-text)]">{fmtBaht(Number(item.subtotal))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Info row helper (used inside DetailModal) ────────────────────────────────

function InfoRow({ label, value, valueClass }: { label: string; value: React.ReactNode; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5 gap-4">
      <span className="text-sm text-[var(--color-text-muted)] whitespace-nowrap">{label}</span>
      <span className={`text-sm font-medium text-right ${valueClass ?? 'text-[var(--color-text)]'}`}>{value}</span>
    </div>
  );
}

// ─── Detail modal ─────────────────────────────────────────────────────────────

function DetailModal({ row, onClose }: { row: AuditRow; onClose: () => void }) {
  const [showTech, setShowTech] = useState(false);

  const icon      = eventIcon(row.event, row.method, row.endpoint);
  const iconBg    = eventIconBg(row.event, row.method, row.endpoint);
  const what      = describeEvent(row);
  const roleThai  = ROLE_TITLE[row.role ?? ''] ?? null;
  const when      = fmtDate(row.created_at);
  const meta      = (row.metadata ?? {}) as Record<string, unknown>;
  const isOk      = row.status === AuditStatus.SUCCESS;
  const isErr     = row.status === AuditStatus.ERROR;
  const isOrder   = ['create_order', 'void_order', 'update_order'].includes(row.event);

  // ── Order-specific derived values ──
  const orderItems   = isOrder && Array.isArray(meta.items) ? (meta.items as OrderItem[]) : null;
  const total        = meta.total        != null ? Number(meta.total)         : null;
  const discount     = meta.discount     != null ? Number(meta.discount)      : null;
  const cashReceived = meta.cash_received != null ? Number(meta.cash_received) : null;
  const change       = cashReceived != null && total != null && cashReceived > 0
    ? Math.max(0, cashReceived - total) : null;
  const staffEmail   = typeof meta.staff_email === 'string' ? meta.staff_email : null;

  // ── Badge colors ──
  const statusBadgeCls = isOk
    ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
    : isErr
      ? 'bg-red-500/15 text-red-400 border-red-500/30'
      : 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30';

  const heroBg = isErr ? 'bg-red-500/10' : isOk ? 'bg-emerald-500/8' : 'bg-yellow-500/8';

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] shadow-2xl overflow-y-auto max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Hero */}
        <div className={`p-5 rounded-t-2xl ${heroBg}`}>
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-2xl ${iconBg}`}>
                {icon}
              </div>
              <div>
                <p className="font-bold text-base text-[var(--color-text)] leading-snug">{what}</p>
                <div className="flex items-center gap-2 mt-1">
                  {roleThai && (
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${actorColorClass(row.role)}`}>
                      {roleThai}
                    </span>
                  )}
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${statusBadgeCls}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${statusDotClass(row.status)}`} />
                    {STATUS_LABEL[row.status] ?? row.status}
                  </span>
                </div>
              </div>
            </div>
            <button type="button" onClick={onClose}
              className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] text-xl leading-none p-1">
              ✕
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {/* Error message */}
          {row.error_message && (
            <div className="rounded-xl bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-400">
              ⚠️ {row.error_message}
            </div>
          )}

          {/* ── Order detail block ── */}
          {isOrder && (
            <div className="space-y-3">
              {/* Identifiers + staff */}
              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] divide-y divide-[var(--color-border)]">
                {typeof meta.ref_code === 'string' && meta.ref_code && (
                  <InfoRow
                    label="🔖 เลขอ้างอิง"
                    value={<span className="font-mono font-bold text-base">{meta.ref_code}</span>}
                  />
                )}
                {meta.daily_seq != null && (
                  <InfoRow label="🧾 ลำดับวัน" value={`ออเดอร์ที่ #${meta.daily_seq as number}`} />
                )}
                {staffEmail && (
                  <InfoRow label="👤 พนักงานที่ขาย" value={staffEmail} />
                )}
                <InfoRow label="🕐 เวลาขาย" value={when} />
              </div>

              {/* Items table */}
              {orderItems && orderItems.length > 0 && (
                <OrderItemsTable items={orderItems} />
              )}

              {/* Payment summary */}
              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] divide-y divide-[var(--color-border)]">
                {typeof meta.payment_method === 'string' && meta.payment_method && (
                  <InfoRow
                    label="💳 วิธีชำระเงิน"
                    value={PAYMENT_LABEL[meta.payment_method] ?? meta.payment_method}
                  />
                )}
                {discount != null && discount > 0 && (
                  <InfoRow label="🎁 ส่วนลด"      value={`-${fmtBaht(discount)}`}    valueClass="text-orange-400" />
                )}
                {total != null && (
                  <InfoRow label="💰 ยอดรวมสุทธิ"  value={fmtBaht(total)}            valueClass="text-base font-bold text-emerald-400" />
                )}
                {cashReceived != null && cashReceived > 0 && (
                  <InfoRow label="💵 รับเงินมา"     value={fmtBaht(cashReceived)} />
                )}
                {change != null && change > 0 && (
                  <InfoRow label="🪙 เงินทอน"       value={fmtBaht(change)}           valueClass="font-bold text-sky-400" />
                )}
              </div>
            </div>
          )}

          {/* ── Generic highlights (non-order) ── */}
          {!isOrder && (
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] divide-y divide-[var(--color-border)]">
              {staffEmail && <InfoRow label="👤 พนักงาน"     value={staffEmail} />}
              {!staffEmail && roleThai && <InfoRow label="👤 ตำแหน่ง"  value={roleThai} />}
              <InfoRow label="🕐 วันเวลา" value={when} />
              {row.ip_address && <InfoRow label="📍 IP" value={row.ip_address} />}
              {meta.total != null && (
                <InfoRow label="💰 ยอดรวม" value={fmtBaht(Number(meta.total))} />
              )}
              {typeof meta.name === 'string' && meta.name && (
                <InfoRow label="📌 ชื่อรายการ" value={meta.name} />
              )}
              {typeof meta.email === 'string' && meta.email && (
                <InfoRow label="📧 อีเมล" value={meta.email} />
              )}
              {meta.qty != null && (
                <InfoRow label="📦 จำนวน" value={String(meta.qty)} />
              )}
              {typeof meta.reason === 'string' && meta.reason && (
                <InfoRow label="📝 เหตุผล" value={meta.reason} />
              )}
            </div>
          )}

          {/* Technical toggle */}
          <button
            type="button"
            onClick={() => setShowTech((v) => !v)}
            className="w-full text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] py-2 rounded-lg hover:bg-[var(--color-bg-hover)] transition-colors"
          >
            {showTech ? '▲ ซ่อนข้อมูลทางเทคนิค' : '▼ ดูข้อมูลทางเทคนิค (สำหรับผู้ดูแลระบบ)'}
          </button>

          {showTech && (
            <dl className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] divide-y divide-[var(--color-border)]">
              {(
                [
                  ['Event',      row.event],
                  ['Method',     row.method ?? '–'],
                  ['Endpoint',   row.endpoint ?? '–'],
                  ['Request ID', row.request_id],
                  ['Exec time',  row.execution_time != null ? `${row.execution_time} ms` : '–'],
                  ['User ID',    row.user_id ?? '–'],
                  ['Shop ID',    row.shop_id ?? '–'],
                ] as [string, string][]
              ).map(([k, v]) => (
                <div key={k} className="flex items-start justify-between px-4 py-2 gap-4">
                  <dt className="text-xs text-[var(--color-text-muted)] whitespace-nowrap">{k}</dt>
                  <dd className="font-mono text-xs break-all text-[var(--color-text)] text-right">{v}</dd>
                </div>
              ))}
              {row.metadata && Object.keys(row.metadata).length > 0 && (
                <div className="px-4 py-3">
                  <p className="text-xs text-[var(--color-text-muted)] mb-1.5">Metadata</p>
                  <pre className="text-xs font-mono text-[var(--color-text)] whitespace-pre-wrap break-all">
                    {JSON.stringify(row.metadata, null, 2)}
                  </pre>
                </div>
              )}
            </dl>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─── Activity feed ────────────────────────────────────────────────────────────

/**
 * Renders a scrollable list of significant audit events.
 * GET-only api_call events are filtered out as read-only noise.
 */
export function AuditHumanFeed({
  rows,
  onRowClick,
}: {
  rows:       AuditRow[];
  onRowClick: (row: AuditRow) => void;
}) {
  const significant = rows.filter((r) => isSignificantEvent(r.event, r.method));

  if (significant.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-2">
        <span className="text-3xl">🔍</span>
        <p className="text-sm text-[var(--color-text-muted)]">ไม่พบกิจกรรม</p>
        {rows.length > 0 && (
          <p className="text-xs text-[var(--color-text-muted)] opacity-60">
            ({rows.length} รายการถูกซ่อน เป็น GET requests)
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="divide-y divide-[var(--color-border)]">
      {significant.map((row) => {
        const icon        = eventIcon(row.event, row.method, row.endpoint);
        const iconBg      = eventIconBg(row.event, row.method, row.endpoint);
        const actor       = actorLabel(row.user_id, row.role);
        const actorColor  = actorColorClass(row.role);
        const description = describeEvent(row);
        const time        = relativeTime(row.created_at);
        const dotCls      = statusDotClass(row.status);
        const timeCls     = statusTextClass(row.status);
        // Prefer staff short name from metadata over generic role label
        const staffShort  = (row.metadata?.staff_email as string | undefined)
          ?.split('@')[0] ?? null;
        const displayActor = staffShort ?? actor;

        return (
          <button
            key={row.id}
            type="button"
            className="w-full text-left px-5 py-3.5 hover:bg-[var(--color-bg-hover)] transition-colors flex items-center gap-3 group"
            onClick={() => onRowClick(row)}
          >
            <div className={`w-9 h-9 rounded-xl flex-shrink-0 flex items-center justify-center text-base ${iconBg}`}>
              {icon}
            </div>
            <div className={`flex-shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${actorColor} max-w-[80px] justify-center truncate`}>
              {displayActor}
            </div>
            <span className="flex-1 text-sm text-[var(--color-text)] truncate min-w-0">
              {description}
            </span>
            <span className={`flex-shrink-0 w-2 h-2 rounded-full ${dotCls}`} title={row.status} />
            <span className={`flex-shrink-0 text-xs tabular-nums whitespace-nowrap ${timeCls} opacity-75`}>
              {time}
            </span>
            <span className="flex-shrink-0 text-[var(--color-text-muted)] opacity-0 group-hover:opacity-100 transition-opacity text-xs">›</span>
          </button>
        );
      })}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

/**
 * AuditTab — full audit log browser for the admin panel.
 * Supports event/status/date filters and ref-code search.
 * All inflight fetches are aborted on unmount to prevent memory leaks.
 */
export function AuditTab({ shopId }: AuditTabProps) {
  const [rows,    setRows]    = useState<AuditRow[]>([]);
  const [stats,   setStats]   = useState<AuditStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [offset,  setOffset]  = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [detail,  setDetail]  = useState<AuditRow | null>(null);

  // Filters
  const [filterEvent,  setFilterEvent]  = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterFrom,   setFilterFrom]   = useState('');
  const [filterTo,     setFilterTo]     = useState('');

  // Ref-code search
  const [refInput,   setRefInput]   = useState('');
  const [refSearch,  setRefSearch]  = useState('');
  const [refRows,    setRefRows]    = useState<AuditRow[]>([]);
  const [refLoading, setRefLoading] = useState(false);

  // AbortController refs — cancelled on unmount or filter change
  const feedAbortRef = useRef<AbortController | null>(null);
  const refAbortRef  = useRef<AbortController | null>(null);

  // ── Fetch feed rows ──
  const fetchRows = useCallback(async (off: number, append: boolean) => {
    feedAbortRef.current?.abort();
    const controller = new AbortController();
    feedAbortRef.current = controller;

    setLoading(true);
    try {
      const params = new URLSearchParams({
        shop_id: shopId,
        limit:   String(DEFAULT_PAGE_SIZE),
        offset:  String(off),
      });
      if (filterEvent)  params.set('event',  filterEvent);
      if (filterStatus) params.set('status', filterStatus);
      if (filterFrom)   params.set('from',   new Date(filterFrom).toISOString());
      if (filterTo)     params.set('to',     new Date(filterTo + 'T23:59:59').toISOString());

      const res  = await fetchWithAuth(`/api/audit?${params.toString()}`, { signal: controller.signal });
      const json = await res.json() as { success: boolean; data: AuditRow[] };
      if (json.success) {
        setHasMore(json.data.length === DEFAULT_PAGE_SIZE);
        setRows(append ? (prev) => [...prev, ...json.data] : json.data);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [shopId, filterEvent, filterStatus, filterFrom, filterTo]);

  // ── Fetch stats ──
  const fetchStats = useCallback(async () => {
    try {
      const res  = await fetchWithAuth(`/api/audit?shop_id=${shopId}&stats=1`);
      const json = await res.json() as { success: boolean; data: AuditStats };
      if (json.success) setStats(json.data);
    } catch { /* stats are non-critical */ }
  }, [shopId]);

  // ── Reset + reload when filters change; abort all in-flight requests on unmount ──
  useEffect(() => {
    setOffset(0);
    void fetchRows(0, false);
    void fetchStats();
    return () => {
      feedAbortRef.current?.abort();
      refAbortRef.current?.abort();
    };
  }, [fetchRows, fetchStats]);

  const loadMore = () => {
    const next = offset + DEFAULT_PAGE_SIZE;
    setOffset(next);
    void fetchRows(next, true);
  };

  const clearFilters = () => {
    setFilterEvent('');
    setFilterStatus('');
    setFilterFrom('');
    setFilterTo('');
  };

  // ── Ref-code search ──
  const doRefSearch = useCallback(async (term: string) => {
    if (!term.trim()) { setRefSearch(''); setRefRows([]); return; }

    refAbortRef.current?.abort();
    const controller = new AbortController();
    refAbortRef.current = controller;

    const upper = term.trim().toUpperCase();
    setRefSearch(upper);
    setRefLoading(true);
    try {
      const params = new URLSearchParams({
        shop_id:  shopId,
        ref_code: upper,
        limit:    String(REF_SEARCH_LIMIT),
        offset:   '0',
      });
      const res  = await fetchWithAuth(`/api/audit?${params.toString()}`, { signal: controller.signal });
      const json = await res.json() as { success: boolean; data: AuditRow[] };
      setRefRows(json.success ? json.data : []);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setRefRows([]);
    } finally {
      if (!controller.signal.aborted) setRefLoading(false);
    }
  }, [shopId]);

  const handleRefSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void doRefSearch(refInput);
  };

  const clearRefSearch = () => {
    refAbortRef.current?.abort();
    setRefInput('');
    setRefSearch('');
    setRefRows([]);
  };

  const hasActiveFilters = filterEvent || filterStatus || filterFrom || filterTo;

  return (
    <div className="space-y-5">
      {detail && <DetailModal row={detail} onClose={() => setDetail(null)} />}

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="กิจกรรมทั้งหมด" value={stats.total} />
          <StatCard
            label="ข้อผิดพลาด"
            value={stats.errors}
            color="text-red-400"
            sub={`${Math.round(stats.errors / Math.max(stats.total, 1) * 100)}% ของทั้งหมด`}
          />
          <StatCard
            label="ไม่สำเร็จ"
            value={stats.fails}
            color="text-yellow-400"
            sub={`${Math.round(stats.fails / Math.max(stats.total, 1) * 100)}% ของทั้งหมด`}
          />
          <StatCard
            label="กิจกรรมบ่อยสุด"
            value={topEventLabel(stats.byEvent)}
            sub={`${topEventCount(stats.byEvent)} ครั้ง`}
          />
        </div>
      )}

      {/* Ref-code search bar */}
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-4">
        <p className="text-xs font-semibold text-[var(--color-text-muted)] mb-2 uppercase tracking-wide">
          🔍 ค้นหาด้วยเลขอ้างอิง (Ref Code)
        </p>
        <form onSubmit={handleRefSubmit} className="flex items-center gap-2">
          <input
            type="text"
            value={refInput}
            onChange={(e) => setRefInput(e.target.value.toUpperCase())}
            placeholder="เช่น ABC-00123 หรือ ABC"
            className="flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] placeholder-[var(--color-text-muted)]"
          />
          <button
            type="submit"
            disabled={!refInput.trim() || refLoading}
            className="px-4 py-2 rounded-lg bg-[var(--color-primary)] text-white text-sm font-semibold disabled:opacity-50 hover:opacity-90 transition-opacity"
          >
            {refLoading ? '...' : 'ค้นหา'}
          </button>
          {refSearch && (
            <button
              type="button"
              onClick={clearRefSearch}
              className="px-3 py-2 rounded-lg border border-[var(--color-border)] text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
            >
              ✕ ล้าง
            </button>
          )}
        </form>
      </div>

      {/* Search results */}
      {refSearch && (
        <div className="rounded-xl border-2 border-[var(--color-accent)]/40 bg-[var(--color-bg-card)] overflow-hidden">
          <div className="px-5 py-4 border-b border-[var(--color-border)]">
            <h3 className="font-semibold text-[var(--color-text)]">
              ผลลัพธ์: <span className="font-mono text-[var(--color-accent)]">{refSearch}</span>
            </h3>
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
              {refLoading ? 'กำลังค้นหา...' : `พบ ${refRows.length} รายการ`}
            </p>
          </div>
          {refLoading ? (
            <div className="flex items-center justify-center py-12">
              <p className="text-sm text-[var(--color-text-muted)] animate-pulse">กำลังค้นหา...</p>
            </div>
          ) : refRows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2">
              <span className="text-3xl">🔍</span>
              <p className="text-sm text-[var(--color-text-muted)]">ไม่พบรายการที่ตรงกับ {refSearch}</p>
            </div>
          ) : (
            <AuditHumanFeed rows={refRows} onRowClick={setDetail} />
          )}
        </div>
      )}

      {/* Filters + feed (hidden while ref search active) */}
      {!refSearch && (
        <>
          {/* Filters */}
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)]">
            <div className="p-4 flex flex-wrap gap-3 items-center">
              <select
                value={filterEvent}
                onChange={(e) => setFilterEvent(e.target.value)}
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
              >
                <option value="">ทุกประเภทกิจกรรม</option>
                <optgroup label="── การขาย ──">
                  <option value="create_order">สร้างออเดอร์</option>
                  <option value="update_order">แก้ไขออเดอร์</option>
                  <option value="void_order">ยกเลิกออเดอร์</option>
                </optgroup>
                <optgroup label="── สินค้า ──">
                  <option value="create_product">เพิ่มสินค้า</option>
                  <option value="update_product">แก้ไขสินค้า</option>
                  <option value="delete_product">ลบสินค้า</option>
                </optgroup>
                <optgroup label="── ลูกค้า ──">
                  <option value="create_customer">เพิ่มลูกค้า</option>
                  <option value="update_customer">แก้ไขลูกค้า</option>
                  <option value="delete_customer">ลบลูกค้า</option>
                </optgroup>
                <optgroup label="── ระบบ ──">
                  <option value="login">เข้าสู่ระบบ</option>
                  <option value="logout">ออกจากระบบ</option>
                  <option value="login_failed">เข้าสู่ระบบไม่สำเร็จ</option>
                  <option value="update_shop">แก้ไขข้อมูลร้าน</option>
                  <option value="update_subscription">Subscription</option>
                </optgroup>
              </select>

              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
              >
                <option value="">ทุกสถานะ</option>
                <option value={AuditStatus.SUCCESS}>✅ สำเร็จ</option>
                <option value={AuditStatus.FAIL}>⚠️ ไม่สำเร็จ</option>
                <option value={AuditStatus.ERROR}>❌ เกิดข้อผิดพลาด</option>
              </select>

              <div className="flex items-center gap-2">
                <input
                  type="date" value={filterFrom}
                  onChange={(e) => setFilterFrom(e.target.value)}
                  className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
                />
                <span className="text-[var(--color-text-muted)] text-xs">ถึง</span>
                <input
                  type="date" value={filterTo}
                  onChange={(e) => setFilterTo(e.target.value)}
                  className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
                />
              </div>

              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="text-xs text-[var(--color-primary)] hover:underline px-2 py-1.5 rounded-lg transition-colors"
                >
                  ล้างตัวกรอง
                </button>
              )}
              <span className="ml-auto text-xs text-[var(--color-text-muted)]">{rows.length} รายการ</span>
            </div>
          </div>

          {/* Feed */}
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] overflow-hidden">
            <div className="px-5 py-4 border-b border-[var(--color-border)]">
              <h3 className="font-semibold text-[var(--color-text)]">ประวัติกิจกรรม</h3>
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                กิจกรรมทั้งหมดในร้าน — คลิกเพื่อดูรายละเอียด
              </p>
            </div>

            {loading && rows.length === 0 ? (
              <div className="flex items-center justify-center py-16">
                <p className="text-sm text-[var(--color-text-muted)] animate-pulse">กำลังโหลดประวัติกิจกรรม...</p>
              </div>
            ) : (
              <>
                <AuditHumanFeed rows={rows} onRowClick={setDetail} />
                <div className="p-4 flex items-center justify-between border-t border-[var(--color-border)]">
                  <span className="text-xs text-[var(--color-text-muted)]">แสดง {rows.length} รายการ</span>
                  {hasMore && (
                    <button
                      type="button"
                      disabled={loading}
                      onClick={loadMore}
                      className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] px-3 py-1.5 rounded-lg hover:bg-[var(--color-bg-hover)] disabled:opacity-50 transition-colors"
                    >
                      {loading ? 'กำลังโหลด...' : 'โหลดเพิ่ม →'}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
