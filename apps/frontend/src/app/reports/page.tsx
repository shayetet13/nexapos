'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { fetchWithAuth } from '@/lib/supabase';
import { AuthHeader } from '@/components/layout/AuthHeader';
import { GoToPOSLink } from '@/components/GoToPOSLink';
import { UpgradeGate } from '@/components/UpgradeGate';
import { useFeatureGate } from '@/hooks/useFeatureGate';
import '@/styles/pages/reports.css';
import { API_URL } from '@/lib/config';

/* ── Types ─────────────────────────────────────────────────── */
interface Shop   { id: string; name: string; role?: string; }
interface Branch { id: string; name: string; }

interface PnlRow {
  period:       string;
  order_count:  number;
  revenue:      number;
  cogs:         number;
  gross_profit: number;
  margin_pct:   number;
}
interface TopProduct {
  product_id:   string;
  product_name: string;
  qty_sold:     number;
  revenue:      number;
  cogs:         number;
  gross_profit: number;
}
interface PnlSummary {
  revenue:         number;
  cogs:            number;
  gross_profit:    number;
  margin_pct:      number;
  order_count:     number;
  avg_order_value: number;
}
interface PnlReport {
  summary:      PnlSummary;
  rows:         PnlRow[];
  top_products: TopProduct[];
}

/* ── Helpers ─────────────────────────────────────────────────── */
const THB = (v: number) =>
  v.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function monthStartStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

/* ── CSV export ─────────────────────────────────────────────── */
function downloadCsv(rows: PnlRow[], groupBy: string) {
  const header = ['ช่วงเวลา', 'จำนวนออเดอร์', 'รายได้ (฿)', 'ต้นทุน (฿)', 'กำไรขั้นต้น (฿)', 'อัตรากำไร (%)'];
  const lines  = rows.map((r) => [
    r.period,
    r.order_count,
    r.revenue.toFixed(2),
    r.cogs.toFixed(2),
    r.gross_profit.toFixed(2),
    r.margin_pct.toFixed(2),
  ].join(','));
  const csv = [header.join(','), ...lines].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `pnl-report-${groupBy}-${todayStr()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ═══════════════════════════════════════════════════════════ */
function ReportsPageInner() {
  const [shops, setShops]         = useState<Shop[]>([]);
  const [shopId, setShopId]       = useState<string | null>(null);
  const [branches, setBranches]   = useState<Branch[]>([]);
  const [loading, setLoading]     = useState(true);
  const [fetching, setFetching]   = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);

  const [fromDate, setFromDate] = useState(monthStartStr());
  const [toDate,   setToDate]   = useState(todayStr());
  const [groupBy,  setGroupBy]  = useState<'day' | 'month'>('day');
  const [branchId, setBranchId] = useState('');

  const [report, setReport] = useState<PnlReport | null>(null);

  useEffect(() => {
    async function init() {
      const res = await fetchWithAuth(`${API_URL}/api/v1/me/shops`);
      if (!res.ok) { setLoading(false); return; }
      const j = await res.json();
      const admin = ((j.data ?? []) as Shop[]).filter(s => s.role === 'owner' || s.role === 'manager');
      setShops(admin);
      if (admin.length > 0) setShopId(admin[0].id);
      setLoading(false);
    }
    init();
  }, []);

  useEffect(() => {
    if (!shopId) return;
    async function loadBranches() {
      const res = await fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/branches`);
      if (res.ok) { const j = await res.json(); setBranches(j.data ?? []); }
    }
    void loadBranches();
  }, [shopId]);

  const fetchReport = useCallback(async () => {
    if (!shopId) return;
    setFetching(true); setError(null);
    const params = new URLSearchParams({ fromDate, toDate, groupBy });
    if (branchId) params.set('branchId', branchId);
    const res = await fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/reports/pnl?${params}`);
    if (res.ok) {
      const j = await res.json();
      setReport(j.data);
    } else {
      const j = await res.json().catch(() => ({}));
      setError(j.error?.message ?? 'โหลดรายงานไม่สำเร็จ');
    }
    setFetching(false);
  }, [shopId, fromDate, toDate, groupBy, branchId]);

  const { hasFeature } = useFeatureGate(shopId);

  /* ── PDF Export ── */
  const exportPdf = async () => {
    if (!report) return;
    setPdfLoading(true);
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ]);
      const el = document.querySelector('.rpt__body') as HTMLElement;
      if (!el) { setPdfLoading(false); return; }
      const canvas = await html2canvas(el, {
        scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false,
      });
      const imgData = canvas.toDataURL('image/png');
      const pdf     = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pdfW    = pdf.internal.pageSize.getWidth();
      const pdfH    = pdf.internal.pageSize.getHeight();
      const imgH    = (canvas.height * pdfW) / canvas.width;
      let pos = 0;
      pdf.addImage(imgData, 'PNG', 0, 0, pdfW, imgH);
      pos += pdfH;
      while (pos < imgH) {
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, -pos, pdfW, imgH);
        pos += pdfH;
      }
      const shopName = shops.find(s => s.id === shopId)?.name ?? 'shop';
      pdf.save(`pnl-${shopName}-${fromDate}-${toDate}.pdf`);
    } catch (err) {
      console.error('PDF export error:', err);
    } finally {
      setPdfLoading(false);
    }
  };

  // Auto-fetch when shopId first loads
  useEffect(() => {
    if (shopId && hasFeature('reports_advanced')) fetchReport();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId, hasFeature]);

  /* ── Render ── */
  if (loading) return (
    <main className="rpt__page">
      <div className="rpt__header-wrap"><AuthHeader title="รายงาน P&L" /></div>
      <div className="rpt__loading">กำลังโหลด...</div>
    </main>
  );

  const s = report?.summary;

  return (
    <main className="rpt__page">
      <div className="rpt__header-wrap"><AuthHeader title="รายงาน P&L" /></div>

      <div className="rpt__body">
        {/* ─── Print-only header ─── */}
        <div className="rpt__print-header">
          <div className="rpt__print-title">รายงาน กำไร-ขาดทุน (P&L)</div>
          <div className="rpt__print-meta">
            {shops.find(s => s.id === shopId)?.name ?? ''} · {fromDate} ถึง {toDate}
            {' · '}พิมพ์เมื่อ {new Date().toLocaleString('th-TH')}
          </div>
        </div>

        {/* ─── Feature gate ─── */}
        {shopId && !hasFeature('reports_advanced') && (
          <UpgradeGate featureName="รายงานกำไร/ขาดทุน (P&L)" shopId={shopId} />
        )}

        {/* ─── TOPBAR ─── */}
        <div className="rpt__topbar">
          <div className="rpt__topbar-left">
            <h1 className="rpt__title">📊 รายงาน กำไร-ขาดทุน (P&L)</h1>
            {shops.length > 1 && (
              <select value={shopId ?? ''} onChange={e => setShopId(e.target.value || null)} className="rpt__select">
                {shops.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
            {shops.length === 1 && <span className="rpt__shop-name">{shops[0].name}</span>}
          </div>
        </div>

        {/* ─── FILTERS ─── */}
        <div className="rpt__filters">
          <div className="rpt__filter-group">
            <label className="rpt__filter-label">ตั้งแต่</label>
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="rpt__date-input" />
          </div>
          <div className="rpt__filter-group">
            <label className="rpt__filter-label">ถึง</label>
            <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="rpt__date-input" />
          </div>
          <div className="rpt__filter-group">
            <label className="rpt__filter-label">จัดกลุ่มตาม</label>
            <select value={groupBy} onChange={e => setGroupBy(e.target.value as 'day' | 'month')} className="rpt__select">
              <option value="day">วัน</option>
              <option value="month">เดือน</option>
            </select>
          </div>
          {branches.length > 1 && (
            <div className="rpt__filter-group">
              <label className="rpt__filter-label">สาขา</label>
              <select value={branchId} onChange={e => setBranchId(e.target.value)} className="rpt__select">
                <option value="">ทุกสาขา</option>
                {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          )}
          <button type="button" onClick={fetchReport} disabled={fetching} className="rpt__btn-primary">
            {fetching ? '⏳ กำลังโหลด...' : '🔍 ดูรายงาน'}
          </button>
          {report && report.rows.length > 0 && (
            <>
              <button type="button" onClick={() => downloadCsv(report.rows, groupBy)} className="rpt__btn-export">
                📥 CSV
              </button>
              <button type="button" onClick={() => window.print()} className="rpt__btn-export">
                🖨 พิมพ์
              </button>
              <button type="button" onClick={exportPdf} disabled={pdfLoading} className="rpt__btn-export">
                {pdfLoading ? '⏳...' : '📄 PDF'}
              </button>
            </>
          )}
        </div>

        {error && <p className="rpt__error">{error}</p>}

        {/* ─── SUMMARY CARDS ─── */}
        {s && (
          <div className="rpt__kpi-row">
            <div className="rpt__kpi-card rpt__kpi-card--blue">
              <p className="rpt__kpi-label">💰 รายได้รวม</p>
              <p className="rpt__kpi-val">฿{THB(s.revenue)}</p>
              <p className="rpt__kpi-sub">{s.order_count} ออเดอร์ · เฉลี่ย ฿{THB(s.avg_order_value)}</p>
            </div>
            <div className="rpt__kpi-card rpt__kpi-card--amber">
              <p className="rpt__kpi-label">🏭 ต้นทุนสินค้า (COGS)</p>
              <p className="rpt__kpi-val">฿{THB(s.cogs)}</p>
              <p className="rpt__kpi-sub">
                {s.revenue > 0 ? `${((s.cogs / s.revenue) * 100).toFixed(1)}% ของรายได้` : '—'}
              </p>
            </div>
            <div className={`rpt__kpi-card ${s.gross_profit >= 0 ? 'rpt__kpi-card--green' : 'rpt__kpi-card--red'}`}>
              <p className="rpt__kpi-label">📈 กำไรขั้นต้น</p>
              <p className="rpt__kpi-val">฿{THB(s.gross_profit)}</p>
              <p className="rpt__kpi-sub">Margin {s.margin_pct.toFixed(1)}%</p>
            </div>
            <div className="rpt__kpi-card rpt__kpi-card--purple">
              <p className="rpt__kpi-label">📉 Gross Margin</p>
              <p className={`rpt__kpi-val ${s.margin_pct >= 30 ? 'rpt__val--green' : s.margin_pct >= 10 ? 'rpt__val--amber' : 'rpt__val--red'}`}>
                {s.margin_pct.toFixed(1)}%
              </p>
              <p className="rpt__kpi-sub">
                {s.margin_pct >= 30 ? '✅ กำไรดี' : s.margin_pct >= 10 ? '⚠️ พอไหว' : '🔴 ต่ำมาก'}
              </p>
            </div>
          </div>
        )}

        {/* ─── NOTE: no cost_price ─── */}
        {s && s.cogs === 0 && s.revenue > 0 && (
          <div className="rpt__notice">
            💡 COGS = 0 เพราะยังไม่ได้กรอก <strong>ราคาต้นทุน</strong> ให้กับสินค้า — ไปที่ จัดการสินค้า แล้วกรอก &ldquo;ราคาต้นทุน&rdquo; เพื่อให้ P&L แม่นยำ
          </div>
        )}

        {/* ─── BREAKDOWN TABLE ─── */}
        {report && report.rows.length > 0 && (
          <div className="rpt__section">
            <h2 className="rpt__section-title">
              📋 รายละเอียดตาม{groupBy === 'day' ? 'วัน' : 'เดือน'}
            </h2>
            <div className="rpt-grid rpt-grid--breakdown">
              {/* header */}
              <div className="rpt-row rpt-row--head">
                <span className="rpt-cell">{groupBy === 'day' ? 'วันที่' : 'เดือน'}</span>
                <span className="rpt-cell rpt-cell--r">ออเดอร์</span>
                <span className="rpt-cell rpt-cell--r">รายได้ (฿)</span>
                <span className="rpt-cell rpt-cell--r">COGS (฿)</span>
                <span className="rpt-cell rpt-cell--r">กำไรขั้นต้น (฿)</span>
                <span className="rpt-cell rpt-cell--r">Margin %</span>
              </div>
              {/* data rows */}
              {report.rows.map((r) => (
                <div key={r.period} className={`rpt-row${r.gross_profit < 0 ? ' rpt-row--loss' : ''}`}>
                  <span className="rpt-cell rpt-cell--period">
                    {groupBy === 'day'
                      ? new Date(r.period).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: '2-digit' })
                      : new Date(r.period).toLocaleDateString('th-TH', { month: 'long', year: 'numeric' })}
                  </span>
                  <span className="rpt-cell rpt-cell--r rpt-cell--num">{r.order_count}</span>
                  <span className="rpt-cell rpt-cell--r rpt-cell--num">{THB(r.revenue)}</span>
                  <span className="rpt-cell rpt-cell--r rpt-cell--num rpt-cell--cogs">{THB(r.cogs)}</span>
                  <span className={`rpt-cell rpt-cell--r rpt-cell--num rpt-cell--gp ${r.gross_profit >= 0 ? 'rpt-pos' : 'rpt-neg'}`}>
                    {THB(r.gross_profit)}
                  </span>
                  <span className={`rpt-cell rpt-cell--r rpt-cell--num ${r.margin_pct >= 30 ? 'rpt-pos' : r.margin_pct >= 0 ? '' : 'rpt-neg'}`}>
                    {r.margin_pct.toFixed(1)}%
                  </span>
                </div>
              ))}
              {/* footer */}
              {s && (
                <div className="rpt-row rpt-row--foot">
                  <span className="rpt-cell rpt-cell--period">รวม</span>
                  <span className="rpt-cell rpt-cell--r rpt-cell--num">{s.order_count}</span>
                  <span className="rpt-cell rpt-cell--r rpt-cell--num">{THB(s.revenue)}</span>
                  <span className="rpt-cell rpt-cell--r rpt-cell--num rpt-cell--cogs">{THB(s.cogs)}</span>
                  <span className={`rpt-cell rpt-cell--r rpt-cell--num rpt-cell--gp ${s.gross_profit >= 0 ? 'rpt-pos' : 'rpt-neg'}`}>
                    {THB(s.gross_profit)}
                  </span>
                  <span className={`rpt-cell rpt-cell--r rpt-cell--num ${s.margin_pct >= 30 ? 'rpt-pos' : s.margin_pct >= 0 ? '' : 'rpt-neg'}`}>
                    {s.margin_pct.toFixed(1)}%
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ─── TOP PRODUCTS ─── */}
        {report && report.top_products.length > 0 && (
          <div className="rpt__section">
            <h2 className="rpt__section-title">🏆 สินค้าขายดี (Top 10)</h2>
            <div className="rpt-grid rpt-grid--products">
              {/* header */}
              <div className="rpt-row rpt-row--head">
                <span className="rpt-cell rpt-cell--r">#</span>
                <span className="rpt-cell">สินค้า</span>
                <span className="rpt-cell rpt-cell--r">จำนวนที่ขาย</span>
                <span className="rpt-cell rpt-cell--r">รายได้ (฿)</span>
                <span className="rpt-cell rpt-cell--r">COGS (฿)</span>
                <span className="rpt-cell rpt-cell--r">กำไรขั้นต้น (฿)</span>
              </div>
              {/* data rows */}
              {report.top_products.map((p, i) => (
                <div key={p.product_id} className="rpt-row">
                  <span className="rpt-cell rpt-cell--r rpt-cell--rank">{i + 1}</span>
                  <span className="rpt-cell rpt-cell--name">{p.product_name}</span>
                  <span className="rpt-cell rpt-cell--r rpt-cell--num">{p.qty_sold}</span>
                  <span className="rpt-cell rpt-cell--r rpt-cell--num">{THB(p.revenue)}</span>
                  <span className="rpt-cell rpt-cell--r rpt-cell--num rpt-cell--cogs">{THB(p.cogs)}</span>
                  <span className={`rpt-cell rpt-cell--r rpt-cell--num rpt-cell--gp ${p.gross_profit >= 0 ? 'rpt-pos' : 'rpt-neg'}`}>
                    {THB(p.gross_profit)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {report && report.rows.length === 0 && !fetching && (
          <div className="rpt__empty">
            <div className="rpt__empty-icon">📊</div>
            <p className="rpt__empty-title">ไม่มีข้อมูลในช่วงนี้</p>
            <p className="rpt__empty-sub">ลองเลือกช่วงวันที่ใหม่แล้วกด 🔍 ดูรายงาน</p>
          </div>
        )}

        {/* Footer links */}
        <div className="rpt__footer">
          <Link href="/dashboard" className="rpt__footer-link">← แดชบอร์ด</Link>
          <GoToPOSLink className="rpt__footer-link">🏪 ไปหน้า POS</GoToPOSLink>
          <Link href="/stock" className="rpt__footer-link">สต๊อก</Link>
          <Link href="/admin" className="rpt__footer-link">จัดการร้าน</Link>
        </div>
      </div>
    </main>
  );
}

export default function ReportsPage() {
  return (
    <Suspense fallback={
      <main className="rpt__page">
        <div className="rpt__loading">กำลังโหลด...</div>
      </main>
    }>
      <ReportsPageInner />
    </Suspense>
  );
}
