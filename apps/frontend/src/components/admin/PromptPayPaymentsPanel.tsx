'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchWithAuth } from '@/lib/supabase';
import { API_URL } from '@/lib/config';

type PaymentStatus = 'queued' | 'pending' | 'succeeded' | 'ambiguous' | 'expired' | 'cancelled';

interface HistoryRow {
  id: string;
  status: PaymentStatus;
  amount_satang: number;
  bank: string | null;
  payer_name: string | null;
  transaction_at: string | null;
  created_at: string;
}

interface PeriodTotals { count: number; succeeded_count: number; amount_satang: number }
/** เฉพาะรายการที่สำเร็จ */
interface BankRow { bank: string; count: number; amount_satang: number }

interface Stats {
  totals: { day: PeriodTotals; month: PeriodTotals; year: PeriodTotals };
  banks: BankRow[];
}

const PAGE_SIZE = 20;

const BANK_LABEL: Record<string, string> = {
  kbank: 'กสิกรไทย', ktb: 'กรุงไทย', scb: 'ไทยพาณิชย์', other: 'ธนาคารอื่น', unknown: 'ยังไม่ทราบ',
};

const STATUS_META: Record<PaymentStatus, { label: string; cls: string }> = {
  succeeded: { label: 'สำเร็จ',          cls: 'page-admin__status--paid' },
  pending:   { label: 'รอชำระ',          cls: 'page-admin__status--pending' },
  queued:    { label: 'รอคิว',           cls: 'page-admin__status--pending' },
  ambiguous: { label: 'ตรวจสอบไม่ได้',   cls: 'page-admin__status--refunded' },
  expired:   { label: 'หมดอายุ',         cls: 'page-admin__status--void' },
  cancelled: { label: 'ยกเลิก',          cls: 'page-admin__status--void' },
};

const bahtFmt = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateTimeFmt = new Intl.DateTimeFormat('th-TH', {
  timeZone: 'Asia/Bangkok', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
});
const bkkDateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' });

const baht = (satang: number): string => bahtFmt.format(satang / 100);
const todayBkk = (): string => bkkDateFmt.format(new Date());

/** input[type=date] ส่ง onChange ทุกค่าระหว่างพิมพ์ปี (0002-…, 0020-…) — รับเฉพาะวันที่สมเหตุสมผล */
const isPlausibleDate = (v: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(v) && v >= '2000-01-01';

type ApiErrorBody = { error?: { message?: string; details?: Record<string, string[]> } };

function firstError(body: ApiErrorBody | null, fallback: string): string {
  const detail = body?.error?.details ? Object.values(body.error.details).flat()[0] : undefined;
  return detail ?? body?.error?.message ?? fallback;
}

function TotalTile({ label, totals }: { label: string; totals: PeriodTotals }) {
  return (
    <div className="ppv-stat">
      <span className="ppv-stat__label">{label}</span>
      <strong className="ppv-stat__value">฿{baht(totals.amount_satang)}</strong>
      <span className="ppv-stat__meta">{totals.succeeded_count} สำเร็จ (สร้างทั้งหมด {totals.count})</span>
    </div>
  );
}

/** ประวัติ + สถิติ PromptPay auto-verify ของร้าน (owner/manager) — ข้อมูลทั้งหมด scope shop_id ที่ backend */
export function PromptPayPaymentsPanel({ shopId }: { shopId: string | null }) {
  const [from, setFrom] = useState(todayBkk);
  const [to, setTo] = useState(todayBkk);
  const [page, setPage] = useState(0);
  const [stats, setStats] = useState<Stats | null>(null);
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const latestRequest = useRef(0);

  const load = useCallback(async () => {
    if (!shopId) return;
    const base = `${API_URL}/api/v1/shops/${shopId}/promptpay-verify`;
    const range = `from=${from}&to=${to}`;
    const requestId = ++latestRequest.current;
    const isStale = () => requestId !== latestRequest.current;
    setLoading(true);
    setError(null);
    try {
      const [statsRes, listRes] = await Promise.all([
        fetchWithAuth(`${base}/stats?${range}`),
        fetchWithAuth(`${base}/payments?${range}&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`),
      ]);
      if (isStale()) return;
      if (statsRes.status === 403 || listRes.status === 403) { setForbidden(true); return; }
      if (!statsRes.ok || !listRes.ok) {
        const failed = statsRes.ok ? listRes : statsRes;
        const body = await failed.json().catch(() => null) as ApiErrorBody | null;
        if (!isStale()) setError(firstError(body, 'โหลดประวัติการชำระเงินไม่สำเร็จ'));
        return;
      }
      const statsJson = await statsRes.json() as { data: Stats };
      const listJson = await listRes.json() as { data: HistoryRow[]; meta: { total: number } };
      if (isStale()) return;
      setStats(statsJson.data);
      setRows(listJson.data);
      setTotal(listJson.meta.total);
    } catch {
      if (!isStale()) setError('เชื่อมต่อไม่ได้ กรุณาลองใหม่');
    } finally {
      if (!isStale()) setLoading(false);
    }
  }, [shopId, from, to, page]);

  useEffect(() => { setForbidden(false); }, [shopId]);
  useEffect(() => { void load(); }, [load]);

  if (!shopId || forbidden) return null;

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function changeRange(next: { from?: string; to?: string }) {
    if (next.from !== undefined) setFrom(next.from);
    if (next.to !== undefined) setTo(next.to);
    setPage(0);
  }

  return (
    <div className="page-admin__card">
      <h3 className="page-admin__card-title">ประวัติและสถิติ PromptPay (ตรวจสอบอัตโนมัติ)</h3>
      <p className="page-admin__section-desc">
        รายการที่สร้างผ่านการตรวจสอบอัตโนมัติ — แยกวันตามเวลาสร้างรายการ (เวลาไทย) ยอดเงินนับเฉพาะรายการที่สำเร็จ
      </p>

      {stats && (
        <div className="ppv-stats">
          <TotalTile label="วันนี้" totals={stats.totals.day} />
          <TotalTile label="เดือนนี้" totals={stats.totals.month} />
          <TotalTile label="ปีนี้" totals={stats.totals.year} />
        </div>
      )}

      <div className="ppv-range">
        <label className="ppv-range__field">
          <span className="page-admin__hint">ตั้งแต่</span>
          <input type="date" className="input-field" value={from} max={to}
            onChange={(e) => isPlausibleDate(e.target.value) && changeRange({ from: e.target.value })} />
        </label>
        <label className="ppv-range__field">
          <span className="page-admin__hint">ถึง</span>
          <input type="date" className="input-field" value={to} min={from}
            onChange={(e) => isPlausibleDate(e.target.value) && changeRange({ to: e.target.value })} />
        </label>
        <button type="button" className="page-admin__btn-sm" disabled={loading} onClick={() => void load()}>
          {loading ? 'กำลังโหลด…' : 'รีเฟรช'}
        </button>
      </div>

      {error && <p className="page-admin__hint ppv-error">{error}</p>}

      {stats && stats.banks.length > 0 && (
        <div className="ppv-banks">
          {stats.banks.map((b) => (
            <span key={b.bank} className="ppv-bank-chip">
              {BANK_LABEL[b.bank] ?? b.bank}: ฿{baht(b.amount_satang)} ({b.count} รายการ)
            </span>
          ))}
        </div>
      )}

      {rows.length === 0 && !loading ? (
        <p className="page-admin__hint">ไม่มีรายการในช่วงที่เลือก</p>
      ) : (
        <div className="page-admin__orders-table-wrap">
          <table className="page-admin__orders-table">
            <thead>
              <tr>
                <th>เวลาสร้าง</th>
                <th>ยอด</th>
                <th>สถานะ</th>
                <th>ธนาคาร</th>
                <th>ผู้โอน</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const meta = STATUS_META[r.status];
                return (
                  <tr key={r.id}>
                    <td>{dateTimeFmt.format(new Date(r.created_at))}</td>
                    <td>฿{baht(r.amount_satang)}</td>
                    <td><span className={`page-admin__status ${meta.cls}`}>{meta.label}</span></td>
                    <td>{r.bank ? (BANK_LABEL[r.bank] ?? r.bank) : '-'}</td>
                    <td>{r.payer_name ?? '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {total > PAGE_SIZE && (
        <div className="ppv-pager">
          <button type="button" className="page-admin__btn-sm" disabled={page === 0 || loading}
            onClick={() => setPage((p) => Math.max(0, p - 1))}>ก่อนหน้า</button>
          <span className="page-admin__hint">หน้า {page + 1} / {pageCount} ({total} รายการ)</span>
          <button type="button" className="page-admin__btn-sm" disabled={page + 1 >= pageCount || loading}
            onClick={() => setPage((p) => p + 1)}>ถัดไป</button>
        </div>
      )}
    </div>
  );
}
