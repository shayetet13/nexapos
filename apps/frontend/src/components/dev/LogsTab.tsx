'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { fetchWithAuth } from '@/lib/supabase';
import { API_URL } from '@/lib/config';
import { Card, SectionHeader, Btn, DInput, DSelect, Empty, type Shop } from './dev-ui';
import { AuditHumanFeed, type AuditRow as AdminAuditRow } from '@/components/admin/AuditTab';

// ─── Types ────────────────────────────────────────────────────────────────────

interface LogRow {
  id:          string;
  shop_id:     string;
  shop_name:   string;
  action:      string;
  entity_type: string;
  entity_id:   string;
  payload:     unknown;
  user_id:     string | null;
  created_at:  string;
}

interface AuditRow {
  id:             string;
  event:          string;
  status:         'success' | 'fail' | 'error';
  request_id:     string;
  shop_id:        string | null;
  user_id:        string | null;
  role:           string | null;
  ip_address:     string | null;
  method:         string | null;
  endpoint:       string | null;
  execution_time: number | null;
  error_message:  string | null;
  metadata:       Record<string, unknown>;
  created_at:     string;
}

interface LogsTabProps {
  shops: Shop[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

type ActionColor = 'blue' | 'yellow' | 'red' | 'green' | 'purple' | 'gray';

function actionBadgeColor(action: string): ActionColor {
  const a = action.toLowerCase();
  if (a.includes('create') || a.includes('add') || a.includes('register')) return 'blue';
  if (a.includes('update') || a.includes('edit') || a.includes('change'))  return 'yellow';
  if (a.includes('delete') || a.includes('remove') || a.includes('void'))  return 'red';
  if (a.includes('pay') || a.includes('order') || a.includes('sale'))      return 'green';
  if (a.includes('login') || a.includes('logout') || a.includes('auth'))   return 'purple';
  return 'gray';
}

const ACTION_COLOR_MAP: Record<ActionColor, string> = {
  blue:   'bg-blue-500/15 text-blue-400 border-blue-500/30',
  yellow: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  red:    'bg-red-500/15 text-red-400 border-red-500/30',
  green:  'bg-green-500/15 text-green-400 border-green-500/30',
  purple: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  gray:   'bg-gray-500/15 text-gray-400 border-gray-500/30',
};

const AUDIT_STATUS_MAP: Record<string, string> = {
  success: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  fail:    'bg-yellow-500/15  text-yellow-400  border-yellow-500/30',
  error:   'bg-red-500/15     text-red-400     border-red-500/30',
};

function ActionBadge({ action }: { action: string }) {
  const color = actionBadgeColor(action);
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${ACTION_COLOR_MAP[color]}`}>
      {action}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls = AUDIT_STATUS_MAP[status] ?? AUDIT_STATUS_MAP.fail;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${cls}`}>
      {status}
    </span>
  );
}

function EventBadge({ event }: { event: string }) {
  const color = actionBadgeColor(event);
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${ACTION_COLOR_MAP[color]}`}>
      {event}
    </span>
  );
}

function payloadPreview(payload: unknown): string {
  try {
    const str = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return str.length > 60 ? str.slice(0, 57) + '...' : str;
  } catch {
    return '–';
  }
}

function fmt(dateStr: string) {
  return new Date(dateStr).toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit',
  });
}

// ─── Activity Logs sub-tab ────────────────────────────────────────────────────

function ActivityLogs({ shops }: { shops: Shop[] }) {
  const [rows,    setRows]    = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [offset,  setOffset]  = useState(0);
  const [hasMore, setHasMore] = useState(true);

  const [filterShopId, setFilterShopId] = useState('');
  const [filterAction, setFilterAction] = useState('');
  const [limit,        setLimit]        = useState(50);

  const appendRef = useRef(false);

  const fetchLogs = useCallback(async (off: number, append: boolean) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(limit), offset: String(off) });
      if (filterShopId) params.set('shopId', filterShopId);
      if (filterAction) params.set('action', filterAction);

      const res  = await fetchWithAuth(`${API_URL}/api/v1/dev/logs-all?${params.toString()}`);
      const json = await res.json() as { success: boolean; data: LogRow[] };
      if (json.success) {
        const newRows = json.data;
        setHasMore(newRows.length === limit);
        setRows(append ? (prev) => [...prev, ...newRows] : newRows);
      }
    } finally {
      setLoading(false);
    }
  }, [filterShopId, filterAction, limit]);

  useEffect(() => {
    appendRef.current = false;
    setOffset(0);
    void fetchLogs(0, false);
  }, [fetchLogs]);

  const loadMore = () => { const n = offset + limit; setOffset(n); void fetchLogs(n, true); };

  return (
    <div className="space-y-5">
      <Card>
        <div className="p-4 flex flex-wrap gap-3 items-center">
          <DSelect value={filterShopId} onChange={(e) => setFilterShopId(e.target.value)} className="w-48">
            <option value="">ทุกร้าน</option>
            {shops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </DSelect>
          <DInput placeholder="Action (เช่น create_order)..." value={filterAction} onChange={(e) => setFilterAction(e.target.value)} className="max-w-xs" />
          <DSelect value={String(limit)} onChange={(e) => setLimit(Number(e.target.value))} className="w-24">
            {['25','50','100','200'].map((v) => <option key={v} value={v}>{v}</option>)}
          </DSelect>
          {(filterShopId || filterAction) && (
            <Btn variant="ghost" className="text-xs" onClick={() => { setFilterShopId(''); setFilterAction(''); }}>ล้าง</Btn>
          )}
          <span className="ml-auto text-xs text-[var(--color-text-muted)]">{rows.length} รายการ</span>
        </div>
      </Card>

      <Card>
        <SectionHeader title="Activity Logs" desc="Audit trail ทุกการกระทำในระบบ (legacy logs table)" />
        {loading && rows.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <p className="text-sm text-[var(--color-text-muted)] animate-pulse">กำลังโหลด...</p>
          </div>
        ) : rows.length === 0 ? (
          <Empty>ไม่พบ logs</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="logs-table w-full text-sm">
              <thead>
                <tr className="text-xs text-[var(--color-text-muted)] border-b border-[var(--color-border)]">
                  <th className="text-left px-4 py-2 whitespace-nowrap">เวลา</th>
                  <th className="text-left px-4 py-2">ร้าน</th>
                  <th className="text-left px-4 py-2">Action</th>
                  <th className="text-left px-4 py-2">Entity</th>
                  <th className="text-left px-4 py-2">User</th>
                  <th className="text-left px-4 py-2">Payload</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-[var(--color-border)] hover:bg-[var(--color-bg-hover)] transition-colors">
                    <td className="px-4 py-2.5 text-xs text-[var(--color-text-muted)] whitespace-nowrap">{fmt(row.created_at)}</td>
                    <td className="px-4 py-2.5 text-[var(--color-text)]">{row.shop_name}</td>
                    <td className="px-4 py-2.5"><ActionBadge action={row.action} /></td>
                    <td className="px-4 py-2.5 text-xs text-[var(--color-text-muted)]">
                      <span className="font-medium text-[var(--color-text)]">{row.entity_type}</span>
                      {row.entity_id && <span className="ml-1 font-mono opacity-60">{row.entity_id.slice(0, 8)}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-[var(--color-text-muted)] font-mono">
                      {row.user_id ? row.user_id.slice(0, 8) + '…' : '–'}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-[var(--color-text-muted)] font-mono max-w-xs truncate">
                      {payloadPreview(row.payload)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="p-4 flex items-center justify-between border-t border-[var(--color-border)]">
              <span className="text-xs text-[var(--color-text-muted)]">แสดง {rows.length} รายการ</span>
              {hasMore && (
                <Btn variant="ghost" className="text-xs" disabled={loading} onClick={loadMore}>
                  {loading ? 'กำลังโหลด...' : 'โหลดเพิ่ม →'}
                </Btn>
              )}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

// ─── Audit Logs sub-tab ───────────────────────────────────────────────────────

function AuditLogs({ shops }: { shops: Shop[] }) {
  const [rows,      setRows]      = useState<AuditRow[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [offset,    setOffset]    = useState(0);
  const [hasMore,   setHasMore]   = useState(true);
  const [detail,    setDetail]    = useState<AuditRow | null>(null);
  const [viewMode,  setViewMode]  = useState<'raw' | 'human'>('raw');

  const [filterShopId, setFilterShopId] = useState('');
  const [filterEvent,  setFilterEvent]  = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [limit,        setLimit]        = useState(50);

  const fetchAudit = useCallback(async (off: number, append: boolean) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ dev: '1', limit: String(limit), offset: String(off) });
      if (filterShopId) params.set('shop_id', filterShopId);
      if (filterEvent)  params.set('event',   filterEvent);
      if (filterStatus) params.set('status',  filterStatus);

      const res  = await fetchWithAuth(`/api/audit?${params.toString()}`);
      const json = await res.json() as { success: boolean; data: AuditRow[] };
      if (json.success) {
        const newRows = json.data;
        setHasMore(newRows.length === limit);
        setRows(append ? (prev) => [...prev, ...newRows] : newRows);
      }
    } finally {
      setLoading(false);
    }
  }, [filterShopId, filterEvent, filterStatus, limit]);

  useEffect(() => { setOffset(0); void fetchAudit(0, false); }, [fetchAudit]);

  const loadMore = () => { const n = offset + limit; setOffset(n); void fetchAudit(n, true); };

  return (
    <div className="space-y-5">
      {/* Detail modal */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setDetail(null)}>
          <div className="w-full max-w-xl rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-6 shadow-2xl overflow-y-auto max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex gap-2"><EventBadge event={detail.event} /><StatusBadge status={detail.status} /></div>
              <button type="button" className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]" onClick={() => setDetail(null)}>✕</button>
            </div>
            <dl className="grid grid-cols-2 gap-3 text-xs">
              {[
                ['Request ID', detail.request_id],
                ['Time', fmt(detail.created_at)],
                ['Method', detail.method ?? '–'],
                ['Endpoint', detail.endpoint ?? '–'],
                ['Exec ms', detail.execution_time != null ? `${detail.execution_time}ms` : '–'],
                ['User', detail.user_id ?? '–'],
                ['Role', detail.role ?? '–'],
                ['Shop', detail.shop_id ?? '–'],
                ['IP', detail.ip_address ?? '–'],
              ].map(([k, v]) => (
                <div key={k}><dt className="text-[var(--color-text-muted)]">{k}</dt><dd className="font-mono break-all">{v}</dd></div>
              ))}
            </dl>
            {detail.error_message && (
              <div className="mt-4 rounded-lg bg-red-500/10 border border-red-500/30 p-3 text-xs font-mono text-red-400">{detail.error_message}</div>
            )}
            <div className="mt-4">
              <p className="text-xs text-[var(--color-text-muted)] mb-1">Metadata</p>
              <pre className="rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)] p-3 text-xs font-mono overflow-x-auto whitespace-pre-wrap">
                {JSON.stringify(detail.metadata, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <Card>
        <div className="p-4 flex flex-wrap gap-3 items-center">
          <DSelect value={filterShopId} onChange={(e) => setFilterShopId(e.target.value)} className="w-48">
            <option value="">ทุกร้าน (global)</option>
            {shops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </DSelect>
          <DInput placeholder="Event (login, api_call, ...)" value={filterEvent} onChange={(e) => setFilterEvent(e.target.value)} className="w-44" />
          <DSelect value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="w-32">
            <option value="">ทุก status</option>
            <option value="success">success</option>
            <option value="fail">fail</option>
            <option value="error">error</option>
          </DSelect>
          <DSelect value={String(limit)} onChange={(e) => setLimit(Number(e.target.value))} className="w-24">
            {['25','50','100','200'].map((v) => <option key={v} value={v}>{v}</option>)}
          </DSelect>
          {(filterShopId || filterEvent || filterStatus) && (
            <Btn variant="ghost" className="text-xs" onClick={() => { setFilterShopId(''); setFilterEvent(''); setFilterStatus(''); }}>ล้าง</Btn>
          )}
          {/* Human / Raw toggle */}
          <button
            type="button"
            onClick={() => setViewMode((m) => m === 'raw' ? 'human' : 'raw')}
            className={`ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              viewMode === 'human'
                ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)] border-[var(--color-accent)]/40 hover:bg-[var(--color-accent)]/25'
                : 'bg-[var(--color-bg)] text-[var(--color-text-muted)] border-[var(--color-border)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg-hover)]'
            }`}
          >
            {viewMode === 'raw' ? '🌐 ภาษาคน' : '⚙️ Raw'}
          </button>
          <span className="text-xs text-[var(--color-text-muted)]">{rows.length} รายการ</span>
        </div>
      </Card>

      {/* Table / Human Feed */}
      <Card>
        <SectionHeader
          title="Audit Logs"
          desc={viewMode === 'human'
            ? 'มุมมองภาษาคน — แสดงว่าใครทำอะไร เมื่อไหร่'
            : 'Full audit trail: ทุก API call, login, error, action — global view'}
        />
        {loading && rows.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <p className="text-sm text-[var(--color-text-muted)] animate-pulse">กำลังโหลด audit logs...</p>
          </div>
        ) : rows.length === 0 ? (
          <Empty>ไม่พบ audit logs</Empty>
        ) : viewMode === 'human' ? (
          <>
            <AuditHumanFeed
              rows={rows as unknown as AdminAuditRow[]}
              onRowClick={(r) => setDetail(r as unknown as AuditRow)}
            />
            <div className="p-4 flex items-center justify-between border-t border-[var(--color-border)]">
              <span className="text-xs text-[var(--color-text-muted)]">แสดง {rows.length} รายการ</span>
              {hasMore && (
                <Btn variant="ghost" className="text-xs" disabled={loading} onClick={loadMore}>
                  {loading ? 'กำลังโหลด...' : 'โหลดเพิ่ม →'}
                </Btn>
              )}
            </div>
          </>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-[var(--color-text-muted)] border-b border-[var(--color-border)]">
                  <th className="text-left px-4 py-2 whitespace-nowrap">เวลา</th>
                  <th className="text-left px-4 py-2">Event</th>
                  <th className="text-left px-4 py-2">Status</th>
                  <th className="text-left px-4 py-2">Method / Endpoint</th>
                  <th className="text-left px-4 py-2">User</th>
                  <th className="text-left px-4 py-2">IP</th>
                  <th className="text-right px-4 py-2">ms</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-[var(--color-border)] hover:bg-[var(--color-bg-hover)] transition-colors cursor-pointer"
                    onClick={() => setDetail(row)}
                  >
                    <td className="px-4 py-2.5 text-xs text-[var(--color-text-muted)] whitespace-nowrap">{fmt(row.created_at)}</td>
                    <td className="px-4 py-2.5"><EventBadge event={row.event} /></td>
                    <td className="px-4 py-2.5"><StatusBadge status={row.status} /></td>
                    <td className="px-4 py-2.5 max-w-[180px]">
                      {row.method && <span className="text-xs font-mono text-[var(--color-text-muted)] mr-1">{row.method}</span>}
                      <span className="text-xs font-mono truncate block">{row.endpoint ?? '–'}</span>
                    </td>
                    <td className="px-4 py-2.5 text-xs font-mono text-[var(--color-text-muted)]">
                      {row.user_id ? row.user_id.slice(0, 8) + '…' : '–'}
                      {row.role && <span className="ml-1 text-[10px] px-1 rounded bg-[var(--color-bg)] border border-[var(--color-border)]">{row.role}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-xs font-mono text-[var(--color-text-muted)]">{row.ip_address ?? '–'}</td>
                    <td className="px-4 py-2.5 text-xs font-mono text-right">
                      {row.execution_time != null
                        ? <span className={row.execution_time > 500 ? 'text-yellow-400' : ''}>{row.execution_time}</span>
                        : '–'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="p-4 flex items-center justify-between border-t border-[var(--color-border)]">
              <span className="text-xs text-[var(--color-text-muted)]">แสดง {rows.length} รายการ</span>
              {hasMore && (
                <Btn variant="ghost" className="text-xs" disabled={loading} onClick={loadMore}>
                  {loading ? 'กำลังโหลด...' : 'โหลดเพิ่ม →'}
                </Btn>
              )}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

// ─── Main LogsTab — sub-tab switcher ─────────────────────────────────────────

export function LogsTab({ shops }: LogsTabProps) {
  const [subTab, setSubTab] = useState<'activity' | 'audit'>('audit');

  return (
    <div className="space-y-4">
      {/* Sub-tab bar */}
      <div className="flex gap-1 p-1 rounded-xl bg-[var(--color-bg)] border border-[var(--color-border)] w-fit">
        {([['audit', '🔍 Audit Logs'], ['activity', '📋 Activity Logs']] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setSubTab(id)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              subTab === id
                ? 'bg-[var(--color-bg-card)] text-[var(--color-text)] shadow-sm'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {subTab === 'audit'    && <AuditLogs    shops={shops} />}
      {subTab === 'activity' && <ActivityLogs shops={shops} />}
    </div>
  );
}
