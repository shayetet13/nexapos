'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { fetchWithAuth } from '@/lib/supabase';
import { AuthHeader } from '@/components/layout/AuthHeader';
import { GoToPOSLink } from '@/components/GoToPOSLink';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, Legend,
} from 'recharts';
import { API_URL, WS_URL } from '@/lib/config';
import type { ShopMode } from '@/lib/work-area';
import { workAreaHref } from '@/lib/work-area';

interface Shop { id: string; name: string; shop_mode?: ShopMode }
interface Branch { id: string; name: string; }
interface Stats {
  period:  { total: string; orderCount: number; totalQty: number };
  daily:   { total: string; orderCount: number };
  weekly:  { total: string; orderCount: number };
  monthly: { total: string; orderCount: number };
  yearly:  { total: string; orderCount: number };
  paymentBreakdown: Array<{ method: string; count: number; total: string }>;
  topProducts: Array<{ productId: string; name: string; quantity: number; subtotal: string }>;
  moneyMistake?: {
    daily:   { over_total: number; under_total: number; over_count: number; under_count: number };
    monthly: { over_total: number; under_total: number; over_count: number; under_count: number };
    yearly:  { over_total: number; under_total: number; over_count: number; under_count: number };
  };
}
interface LowStockItem {
  product_id: string; product_name: string; unit: string;
  branch_id: string; branch_name: string; quantity: number; min_qty: number;
}

interface MembershipSummary {
  enabled: boolean;
  totalMembers: number;
  totalPoints: number;
  birthdayLabel: string;
}

interface PromoSummary {
  presetCount: number;
  comboCount: number;
}

type DateMode = 'day' | 'month' | 'year' | 'custom';

const THAI_MONTHS = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
  'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];

interface SettingsSummary {
  printReceiptEnabled: boolean;
  printerWidth: 32 | 48 | null;
  promptpayConfigured: boolean;
}

interface SubscriptionInfo {
  subscription: {
    plan: string;
    status: string;
    expires_at: string | null;
    billing_interval: string;
  } | null;
  plan_config: {
    id: string;
    name: string;
    price_monthly: number;
    max_branches: number;
    max_products: number;
    color: string | null;
  };
  usage: { branches: number; products: number };
}

const PLAN_COLORS: Record<string, string> = {
  free: '#9ca3af', basic: '#3b82f6', pro: '#00d4ff', enterprise: '#a855f7',
};

const PAYMENT_LABELS: Record<string, string> = { cash: 'เงินสด', card: 'บัตร', transfer: 'โอน', other: 'อื่นๆ', qr: 'QR Code' };
const PAYMENT_COLORS: Record<string, string> = { cash: '#10b981', card: '#3b82f6', transfer: '#f59e0b', other: '#8b5cf6', qr: '#06b6d4' };
const BAR_COLORS = ['#6366f1','#8b5cf6','#a78bfa','#60a5fa','#34d399','#f59e0b','#fb923c','#f87171'];
const fmt = (n: number | string) => Number(n).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const pad = (n: number) => String(n).padStart(2, '0');

/* ════════════════════════════════════════════════
   SALES REPORT COMPONENT (used for PDF export)
   Renders as a clean A4-style document
════════════════════════════════════════════════ */
function SalesReport({ stats, periodLabel, shopName, branchName }: {
  stats: Stats; periodLabel: string; shopName: string; branchName?: string;
}) {
  const topProducts  = stats.topProducts ?? [];
  const paymentBreak = stats.paymentBreakdown ?? [];
  const totalPayment = paymentBreak.reduce((s, r) => s + Number(r.total), 0);
  const avgOrder     = stats.period.orderCount > 0
    ? fmt(Number(stats.period.total) / stats.period.orderCount) : '0';

  return (
    <div className="rpt">
      {/* Header */}
      <div className="rpt__header">
        <div>
          <div className="rpt__title">รายงานสรุปยอดขาย</div>
          <div className="rpt__subtitle">{shopName}{branchName ? ` · ${branchName}` : ' · ทุกสาขา'}</div>
        </div>
        <div className="rpt__header-right">
          <div><strong>ช่วงเวลา:</strong> {periodLabel}</div>
          <div><strong>วันที่พิมพ์:</strong> {new Date().toLocaleString('th-TH')}</div>
        </div>
      </div>

      {/* KPI Summary */}
      <div className="rpt__kpi-grid">
        <div className="rpt__kpi">
          <div className="rpt__kpi-label">ยอดขายรวม</div>
          <div className="rpt__kpi-value rpt__kpi-value--main">฿{fmt(stats.period.total)}</div>
        </div>
        <div className="rpt__kpi">
          <div className="rpt__kpi-label">จำนวนออเดอร์</div>
          <div className="rpt__kpi-value">{stats.period.orderCount.toLocaleString()}</div>
          <div className="rpt__kpi-unit">ครั้ง</div>
        </div>
        <div className="rpt__kpi">
          <div className="rpt__kpi-label">สินค้าที่ขายได้</div>
          <div className="rpt__kpi-value">{stats.period.totalQty.toLocaleString()}</div>
          <div className="rpt__kpi-unit">ชิ้น</div>
        </div>
        <div className="rpt__kpi">
          <div className="rpt__kpi-label">เฉลี่ย / ออเดอร์</div>
          <div className="rpt__kpi-value">฿{avgOrder}</div>
          <div className="rpt__kpi-unit">บาท</div>
        </div>
      </div>

      {/* Summary comparison */}
      <div className="rpt__section">
        <div className="rpt__section-title">ภาพรวมยอดขาย (เปรียบเทียบช่วงเวลา)</div>
        <table className="rpt__table">
          <thead>
            <tr>
              <th>ช่วงเวลา</th>
              <th className="rpt__th-r">จำนวนออเดอร์</th>
              <th className="rpt__th-r">ยอดรวม (บาท)</th>
              <th className="rpt__th-r">เฉลี่ย / ออเดอร์</th>
            </tr>
          </thead>
          <tbody>
            {[
              { label: 'วันนี้',      stat: stats.daily   },
              { label: 'สัปดาห์นี้', stat: stats.weekly  },
              { label: 'เดือนนี้',   stat: stats.monthly },
              { label: 'ปีนี้',      stat: stats.yearly  },
            ].map(({ label, stat }) => (
              <tr key={label}>
                <td>{label}</td>
                <td className="rpt__td-r">{stat.orderCount.toLocaleString()}</td>
                <td className="rpt__td-r">฿{fmt(stat.total)}</td>
                <td className="rpt__td-r">
                  ฿{stat.orderCount > 0 ? fmt(Number(stat.total) / stat.orderCount) : '0'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Top Products */}
      {topProducts.length > 0 && (
        <div className="rpt__section">
          <div className="rpt__section-title">สินค้าขายดี Top {topProducts.length} รายการ — {periodLabel}</div>
          <table className="rpt__table">
            <thead>
              <tr>
                <th style={{ width: '2.5rem' }}>#</th>
                <th>ชื่อสินค้า</th>
                <th className="rpt__th-r">จำนวน (ชิ้น)</th>
                <th className="rpt__th-r">ยอดรวม (บาท)</th>
              </tr>
            </thead>
            <tbody>
              {topProducts.map((p, i) => (
                <tr key={p.productId} className={i % 2 === 0 ? 'rpt__tr-even' : ''}>
                  <td>{i + 1}</td>
                  <td>{p.name}</td>
                  <td className="rpt__td-r">{p.quantity.toLocaleString()}</td>
                  <td className="rpt__td-r">฿{fmt(p.subtotal)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2} className="rpt__tfoot-label">รวมทั้งหมด</td>
                <td className="rpt__td-r rpt__tfoot-val">
                  {topProducts.reduce((s, p) => s + p.quantity, 0).toLocaleString()}
                </td>
                <td className="rpt__td-r rpt__tfoot-val">
                  ฿{fmt(topProducts.reduce((s, p) => s + Number(p.subtotal), 0))}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Payment Breakdown */}
      {paymentBreak.length > 0 && (
        <div className="rpt__section">
          <div className="rpt__section-title">ช่องทางชำระเงิน — {periodLabel}</div>
          <table className="rpt__table">
            <thead>
              <tr>
                <th>ช่องทาง</th>
                <th className="rpt__th-r">จำนวนครั้ง</th>
                <th className="rpt__th-r">สัดส่วน (%)</th>
                <th className="rpt__th-r">ยอดรวม (บาท)</th>
              </tr>
            </thead>
            <tbody>
              {paymentBreak.map((r, i) => {
                const pct = totalPayment > 0 ? (Number(r.total) / totalPayment * 100).toFixed(1) : '0';
                return (
                  <tr key={i} className={i % 2 === 0 ? 'rpt__tr-even' : ''}>
                    <td>{PAYMENT_LABELS[r.method] ?? r.method}</td>
                    <td className="rpt__td-r">{r.count.toLocaleString()}</td>
                    <td className="rpt__td-r">{pct}%</td>
                    <td className="rpt__td-r">฿{fmt(r.total)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2} className="rpt__tfoot-label">รวม</td>
                <td className="rpt__td-r rpt__tfoot-val">100%</td>
                <td className="rpt__td-r rpt__tfoot-val">฿{fmt(totalPayment)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <div className="rpt__footer">สร้างโดยระบบ POS — พิมพ์เมื่อ {new Date().toLocaleString('th-TH')}</div>
    </div>
  );
}

/* ════════════════════════════════════════════════
   MAIN DASHBOARD PAGE
════════════════════════════════════════════════ */
export default function DashboardPage() {
  const [shops, setShops]                 = useState<Shop[]>([]);
  const [shopId, setShopId]               = useState<string | null>(null);
  const [branches, setBranches]           = useState<Branch[]>([]);
  const [stats, setStats]                 = useState<Stats | null>(null);
  const [lowStock, setLowStock]           = useState<LowStockItem[]>([]);
  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState<string | null>(null);
  const [lastUpdate, setLastUpdate]       = useState<Date>(new Date());
  const [pdfLoading, setPdfLoading]       = useState(false);
  const [membershipSummary, setMembershipSummary] = useState<MembershipSummary | null>(null);
  const [promoSummary, setPromoSummary]             = useState<PromoSummary | null>(null);
  const [settingsSummary, setSettingsSummary]       = useState<SettingsSummary | null>(null);
  const [subscriptionInfo, setSubscriptionInfo]     = useState<SubscriptionInfo | null>(null);

  /* ── Date selector ── */
  const [dateMode, setDateMode]     = useState<DateMode>('month');
  const [selDay, setSelDay]         = useState(() => new Date());
  const [selMonth, setSelMonth]     = useState(() => new Date().getMonth());
  const [selYear, setSelYear]       = useState(() => new Date().getFullYear());
  const [customFrom, setCustomFrom] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-01`;
  });
  const [customTo, setCustomTo] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  });
  const [selBranchId, setSelBranchId] = useState<string>('');

  const wsRef = useRef<WebSocket | null>(null);


  /* ── Date range ── */
  const dateRange = useMemo(() => {
    switch (dateMode) {
      case 'day': {
        const d  = selDay;
        const ds = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
        return { fromDate: ds, toDate: ds };
      }
      case 'month': {
        const last = new Date(selYear, selMonth + 1, 0).getDate();
        return {
          fromDate: `${selYear}-${pad(selMonth+1)}-01`,
          toDate:   `${selYear}-${pad(selMonth+1)}-${pad(last)}`,
        };
      }
      case 'year':
        return { fromDate: `${selYear}-01-01`, toDate: `${selYear}-12-31` };
      case 'custom':
        return {
          fromDate: customFrom || new Date().toISOString().slice(0, 10),
          toDate:   customTo   || new Date().toISOString().slice(0, 10),
        };
    }
  }, [dateMode, selDay, selMonth, selYear, customFrom, customTo]);

  const periodLabel = useMemo(() => {
    switch (dateMode) {
      case 'day':
        return selDay.toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
      case 'month': return `${THAI_MONTHS[selMonth]} ${selYear + 543}`;
      case 'year':  return `ปี ${selYear + 543}`;
      case 'custom': return customFrom === customTo ? customFrom : `${customFrom} – ${customTo}`;
    }
  }, [dateMode, selDay, selMonth, selYear, customFrom, customTo]);

  const navigate = useCallback((dir: 1 | -1) => {
    if (dateMode === 'day') {
      setSelDay(d => { const nd = new Date(d); nd.setDate(nd.getDate() + dir); return nd; });
    } else if (dateMode === 'month') {
      setSelMonth(m => {
        const nm = m + dir;
        if (nm < 0)  { setSelYear(y => y - 1); return 11; }
        if (nm > 11) { setSelYear(y => y + 1); return 0;  }
        return nm;
      });
    } else if (dateMode === 'year') {
      setSelYear(y => y + dir);
    }
  }, [dateMode]);

  /* ── Fetch helpers ── */
  const fetchStats = useCallback(async (sid: string, from: string, to: string, branchId?: string) => {
    const q = new URLSearchParams({ fromDate: from, toDate: to });
    if (branchId) q.set('branchId', branchId);
    const res = await fetchWithAuth(`${API_URL}/api/v1/shops/${sid}/stats?${q}`);
    if (!res.ok) return;
    const json = await res.json();
    setStats(json.data ?? null);
    setLastUpdate(new Date());
  }, []);

  const fetchLowStock = useCallback(async (sid: string, branchId?: string) => {
    const q = branchId ? `?branchId=${encodeURIComponent(branchId)}` : '';
    const res = await fetchWithAuth(`${API_URL}/api/v1/shops/${sid}/stock/low${q}`);
    if (!res.ok) return;
    setLowStock((await res.json()).data ?? []);
  }, []);

  const fetchSettingsAndMembership = useCallback(async (sid: string) => {
    try {
      const [settingsRes, membersRes, promosRes] = await Promise.all([
        fetchWithAuth(`${API_URL}/api/v1/shops/${sid}/settings`),
        fetchWithAuth(`${API_URL}/api/v1/shops/${sid}/customers?limit=500`),
        fetchWithAuth(`${API_URL}/api/v1/shops/${sid}/promotions`),
      ]);

      if (settingsRes.ok) {
        const sj = await settingsRes.json();
        const cfg = sj.data?.membership_config as {
          enabled?: boolean;
          birthday_benefit_type?: 'percent' | 'fixed';
          birthday_benefit_value?: number;
        } | null | undefined;
        const printEnabled: boolean = sj.data?.print_receipt_enabled === true;
        const widthRaw = sj.data?.printer_width as number | null | undefined;
        const printerWidth: 32 | 48 | null =
          widthRaw === 32 || widthRaw === 48 ? widthRaw : null;
        const promptpayConfigured =
          Boolean(sj.data?.promptpay_type) && Boolean(sj.data?.promptpay_number);

        setSettingsSummary({
          printReceiptEnabled: printEnabled,
          printerWidth,
          promptpayConfigured,
        });

        if (membersRes.ok) {
          const mj = await membersRes.json();
          const members = (mj.data ?? []) as Array<{ points: number }>;
          const totalMembers = members.length;
          const totalPoints = members.reduce(
            (sum, m) => sum + (typeof m.points === 'number' ? m.points : 0),
            0,
          );
          const birthdayLabel =
            cfg?.birthday_benefit_type && cfg.birthday_benefit_value
              ? cfg.birthday_benefit_type === 'percent'
                ? `${cfg.birthday_benefit_value}% ส่วนลดวันเกิด`
                : `฿${cfg.birthday_benefit_value.toLocaleString()} ส่วนลดวันเกิด`
              : 'ยังไม่ได้ตั้งค่า';

          setMembershipSummary({
            enabled: cfg?.enabled !== false,
            totalMembers,
            totalPoints,
            birthdayLabel,
          });
        } else {
          setMembershipSummary(null);
        }
      }

      if (promosRes.ok) {
        const pj = await promosRes.json();
        const presets = (pj.data?.promotions ?? []) as unknown[];
        const combos  = (pj.data?.combos ?? []) as unknown[];
        setPromoSummary({
          presetCount: presets.length,
          comboCount: combos.length,
        });
      } else {
        setPromoSummary(null);
      }
    } catch {
      // ไม่ให้แดชบอร์ดพังเพราะ section เสริม
    }
  }, []);

  const fetchSubscription = useCallback(async (sid: string) => {
    try {
      const res = await fetchWithAuth(`${API_URL}/api/v1/shops/${sid}/subscription`);
      if (res.ok) setSubscriptionInfo((await res.json()).data ?? null);
    } catch { /* non-critical */ }
  }, []);

/* ── Init ── */
  useEffect(() => {
    async function init() {
      const assignRes = await fetchWithAuth(`${API_URL}/api/v1/me/pos-assignment`);
      if (assignRes.ok) {
        const d = (await assignRes.json()).data ?? {};
        if (d.role === 'cashier' || d.role === 'viewer') {
          const mode = (d.shop_mode as ShopMode | undefined) ?? 'retail';
          window.location.href = d.branchId
            ? workAreaHref({
                shopId:     d.shopId,
                shopName:   d.shopName ?? '',
                branchId:   d.branchId,
                branchName: d.branchName ?? '',
                shopMode:   mode,
              })
            : '/select-shop';
          return;
        }
      }
      const resShops = await fetchWithAuth(`${API_URL}/api/v1/me/shops`);
      if (!resShops.ok) { setError('โหลดข้อมูลร้านไม่สำเร็จ'); setLoading(false); return; }
      const shopList = ((await resShops.json()).data ?? []) as Shop[];
      setShops(shopList);
      if (!shopList.length) { setLoading(false); return; }
      setShopId(shopList[0].id);
      setLoading(false);
    }
    init();
  }, []);

  useEffect(() => {
    if (!shopId) return;
    async function loadBranches() {
      const res = await fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/branches`);
      if (!res.ok) return;
      setBranches((await res.json()).data ?? []);
    }
    loadBranches();
  }, [shopId]);

  /* Re-fetch low stock whenever shop or branch filter changes */
  useEffect(() => {
    if (!shopId) return;
    fetchLowStock(shopId, selBranchId || undefined);
  }, [shopId, selBranchId, fetchLowStock]);

  useEffect(() => {
    if (!shopId) return;
    fetchStats(shopId, dateRange.fromDate, dateRange.toDate, selBranchId || undefined);
    fetchSettingsAndMembership(shopId);
  }, [shopId, dateRange, selBranchId, fetchStats, fetchSettingsAndMembership]);

  useEffect(() => {
    if (!shopId) return;
    fetchSubscription(shopId);
  }, [shopId, fetchSubscription]);

  useEffect(() => {
    if (!shopId) return;
    const ws = new WebSocket(`${WS_URL}/ws?shopId=${shopId}`);
    wsRef.current = ws;
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'ORDER_CREATED') fetchStats(shopId, dateRange.fromDate, dateRange.toDate, selBranchId || undefined);
        if (msg.type === 'STOCK_UPDATE' || msg.type === 'STOCK_LOW') fetchLowStock(shopId, selBranchId || undefined);
      } catch {}
    };
    return () => ws.close();
  }, [shopId, dateRange, selBranchId, fetchStats, fetchLowStock]);

  /* ── PDF Export (real report, not screenshot) ── */
  const exportPDF = async () => {
    if (!stats) return;
    setPdfLoading(true);
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ]);

      // Unhide the off-screen report container
      const container = document.getElementById('dash-pdf-container') as HTMLElement;
      if (!container) { setPdfLoading(false); return; }
      container.style.left = '-9999px';
      container.style.visibility = 'visible';
      container.style.opacity = '1';

      // Wait for DOM paint
      await new Promise(r => setTimeout(r, 300));

      const el = container.querySelector('.rpt') as HTMLElement;
      const canvas = await html2canvas(el, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
        width: 794,
        height: el.scrollHeight,
        windowWidth: 794,
      });

      // Re-hide
      container.style.left = '-99999px';
      container.style.visibility = 'hidden';
      container.style.opacity = '0';

      const imgData  = canvas.toDataURL('image/png');
      const pdf      = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pdfW     = pdf.internal.pageSize.getWidth();
      const pdfH     = pdf.internal.pageSize.getHeight();
      const imgH     = (canvas.height * pdfW) / canvas.width;
      let pos = 0;
      pdf.addImage(imgData, 'PNG', 0, 0, pdfW, imgH);
      pos += pdfH;
      while (pos < imgH) {
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, -pos, pdfW, imgH);
        pos += pdfH;
      }

      const shopName = currentShop?.name ?? 'shop';
      pdf.save(`รายงาน-${shopName}-${periodLabel}.pdf`);
    } catch (err) {
      console.error('PDF export error:', err);
    } finally {
      setPdfLoading(false);
    }
  };

  /* ── Derived ── */
  const paymentData   = (stats?.paymentBreakdown ?? []).map(r => ({
    name: PAYMENT_LABELS[r.method] ?? r.method, value: Number(r.total),
    count: r.count, color: PAYMENT_COLORS[r.method] ?? '#94a3b8',
  }));
  const topProducts   = stats?.topProducts ?? [];
  const totalPayment  = paymentData.reduce((s, x) => s + x.value, 0);
  const currentShop   = shops.find(s => s.id === shopId);
  const currentBranch = branches.find(b => b.id === selBranchId);

  /* ── Subscription derived values ── */
  const subPlan      = subscriptionInfo?.subscription?.plan ?? 'free';
  const subStatus    = subscriptionInfo?.subscription?.status ?? null;
  const subExpiresAt = subscriptionInfo?.subscription?.expires_at ?? null;
  const subColor     = PLAN_COLORS[subPlan] ?? '#9ca3af';
  const subDaysLeft  = subExpiresAt
    ? Math.ceil((new Date(subExpiresAt).getTime() - Date.now()) / 86_400_000)
    : null;
  const subMaxBranch = subscriptionInfo?.plan_config.max_branches ?? -1;
  const subMaxProd   = subscriptionInfo?.plan_config.max_products ?? -1;
  const subBranchPct = subMaxBranch > 0
    ? Math.min(100, ((subscriptionInfo?.usage.branches ?? 0) / subMaxBranch) * 100) : 0;
  const subProdPct   = subMaxProd > 0
    ? Math.min(100, ((subscriptionInfo?.usage.products ?? 0) / subMaxProd) * 100) : 0;

  /* ── Skeleton Loading ── */
  if (loading) return (
    <main className="dash">
      <AuthHeader title="แดชบอร์ด" />
      <div className="dash__body">
        <div className="dash__skel-topbar" />
        <div className="dash__skel-datebar" />
        <div className="dash__skel-hero" />
        <div className="dash__kpi-row">
          {[1,2,3].map(i => <div key={i} className="dash__skel-mini" />)}
        </div>
        <div className="dash__chart-row">
          <div className="dash__skel-chart" />
          <div className="dash__skel-chart" />
        </div>
      </div>
    </main>
  );

  return (
    <main className="dash">
      <div className="no-print"><AuthHeader title="แดชบอร์ด" /></div>

      {/* ════ OFF-SCREEN PDF REPORT (hidden until export) ════ */}
      <div id="dash-pdf-container" className="dash__pdf-container" aria-hidden="true">
        {stats && (
          <SalesReport
            stats={stats}
            periodLabel={periodLabel}
            shopName={currentShop?.name ?? 'ร้านค้า'}
            branchName={currentBranch?.name}
          />
        )}
      </div>

      <div className="dash__body">
        {error && <div className="dash__error">{error}</div>}

        {/* ════ TOP BAR ════ */}
        <div className="dash__topbar no-print">
          <div className="dash__topbar-info">
            <div className="dash__shop-avatar">🏪</div>
            <div className="dash__shop-meta">
              <span className="dash__shop-name">
                {currentShop?.name ?? 'ร้านค้าของฉัน'}
                {currentBranch && <span className="dash__branch-suffix"> · {currentBranch.name}</span>}
              </span>
              <span className="dash__shop-sub">
                {new Date().toLocaleDateString('th-TH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                {branches.length > 0 && <span className="dash__branch-pill">{branches.length} สาขา</span>}
              </span>
            </div>
          </div>
          <div className="dash__topbar-actions">
            <div className="dash__live-badge"><span className="dash__live-dot" /> Live</div>
            {shops.length > 1 && (
              <select className="dash__select" value={shopId ?? ''} onChange={e => setShopId(e.target.value || null)}>
                {shops.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
            {branches.length >= 1 && (
              <select className="dash__select" value={selBranchId} onChange={e => setSelBranchId(e.target.value)}>
                <option value="">ทุกสาขา</option>
                {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            )}
            <button className="dash__btn-print" onClick={() => window.print()}>🖨 พิมพ์</button>
            <button className="dash__btn-pdf" onClick={exportPDF} disabled={pdfLoading || !stats}>
              {pdfLoading ? '⏳ กำลังสร้าง PDF...' : '📄 ส่งออก PDF'}
            </button>
          </div>
        </div>

        {/* ════ DATE SELECTOR ════ */}
        <div className="dash__date-selector no-print">
          <div className="dash__mode-tabs">
            {(['day','month','year','custom'] as DateMode[]).map(m => (
              <button key={m}
                className={`dash__mode-tab${dateMode === m ? ' dash__mode-tab--active' : ''}`}
                onClick={() => setDateMode(m)}>
                {m === 'day' ? '📅 วัน' : m === 'month' ? '📆 เดือน' : m === 'year' ? '🗓 ปี' : '📋 กำหนดเอง'}
              </button>
            ))}
          </div>
          <div className="dash__nav-area">
            {dateMode !== 'custom' ? (
              <div className="dash__nav-row">
                <button className="dash__nav-btn" onClick={() => navigate(-1)}>‹</button>
                <div className="dash__period-display">
                  {dateMode === 'day' && (
                    <input type="date" className="dash__date-input-inline"
                      value={`${selDay.getFullYear()}-${pad(selDay.getMonth()+1)}-${pad(selDay.getDate())}`}
                      onChange={e => e.target.value && setSelDay(new Date(e.target.value + 'T12:00:00'))} />
                  )}
                  {dateMode === 'month' && (
                    <div className="dash__month-sel">
                      <select className="dash__inline-select" value={selMonth} onChange={e => setSelMonth(Number(e.target.value))}>
                        {THAI_MONTHS.map((m, i) => <option key={i} value={i}>{m}</option>)}
                      </select>
                      <select className="dash__inline-select" value={selYear} onChange={e => setSelYear(Number(e.target.value))}>
                        {Array.from({ length: 5 }, (_, i) => selYear - 2 + i).map(y => (
                          <option key={y} value={y}>{y + 543}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  {dateMode === 'year' && (
                    <select className="dash__inline-select" value={selYear} onChange={e => setSelYear(Number(e.target.value))}>
                      {Array.from({ length: 8 }, (_, i) => selYear - 4 + i).map(y => (
                        <option key={y} value={y}>{y + 543}</option>
                      ))}
                    </select>
                  )}
                </div>
                <button className="dash__nav-btn" onClick={() => navigate(1)}>›</button>
                <span className="dash__period-label-display">{periodLabel}</span>
              </div>
            ) : (
              <div className="dash__custom-range">
                <label className="dash__range-label">ตั้งแต่</label>
                <input type="date" className="dash__date-input" value={customFrom} onChange={e => setCustomFrom(e.target.value)} />
                <span className="dash__range-sep">–</span>
                <label className="dash__range-label">ถึง</label>
                <input type="date" className="dash__date-input" value={customTo} onChange={e => setCustomTo(e.target.value)} />
              </div>
            )}
            <span className="dash__update-time">🔄 {lastUpdate.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.</span>
          </div>
        </div>

        {/* ════ SUBSCRIPTION BANNER ════ */}
        {subscriptionInfo && shopId && (
          <div className="dash__sub-banner no-print" style={{ borderLeftColor: subColor }}>
            {/* Plan + status */}
            <div className="dash__sub-info">
              <span className="dash__sub-plan-badge" style={{ color: subColor, background: `${subColor}22`, borderColor: `${subColor}55` }}>
                💎 {subscriptionInfo.plan_config.name}
              </span>
              <span className={`dash__sub-status-pill ${subStatus === 'active' ? 'dash__sub-status-pill--active' : subStatus === 'cancelled' ? 'dash__sub-status-pill--cancelled' : subStatus === 'past_due' ? 'dash__sub-status-pill--warn' : 'dash__sub-status-pill--free'}`}>
                {subStatus === 'active' ? '● Active' : subStatus === 'cancelled' ? '✕ ยกเลิกแล้ว' : subStatus === 'past_due' ? '⚠ ค้างชำระ' : '○ Free'}
              </span>
            </div>

            {/* Expiry */}
            <div className="dash__sub-expiry">
              {subExpiresAt ? (
                <>
                  <span className="dash__sub-expiry-label">หมดอายุ</span>
                  <span className="dash__sub-expiry-date">
                    {new Date(subExpiresAt).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: '2-digit', month: 'short', year: 'numeric' })}
                  </span>
                  {subDaysLeft !== null && (
                    <span className={`dash__sub-days-pill ${subDaysLeft <= 0 ? 'dash__sub-days-pill--exp' : subDaysLeft <= 7 ? 'dash__sub-days-pill--danger' : subDaysLeft <= 30 ? 'dash__sub-days-pill--warn' : 'dash__sub-days-pill--ok'}`}>
                      {subDaysLeft <= 0 ? 'หมดอายุแล้ว' : `เหลือ ${subDaysLeft} วัน`}
                    </span>
                  )}
                </>
              ) : (
                <span className="dash__sub-expiry-label">ไม่มีวันหมดอายุ</span>
              )}
            </div>

            {/* Usage bars */}
            <div className="dash__sub-usage">
              <div className="dash__sub-usage-item">
                <div className="dash__sub-usage-lbl">
                  <span>🏢 สาขา</span>
                  <span>{subscriptionInfo.usage.branches} / {subMaxBranch < 0 ? '∞' : subMaxBranch}</span>
                </div>
                <div className="dash__sub-bar-track">
                  <div className="dash__sub-bar-fill" style={{
                    width: `${subMaxBranch < 0 ? 25 : subBranchPct}%`,
                    background: subBranchPct > 90 ? '#ef4444' : subBranchPct > 70 ? '#f59e0b' : subColor,
                  }} />
                </div>
              </div>
              <div className="dash__sub-usage-item">
                <div className="dash__sub-usage-lbl">
                  <span>📦 สินค้า</span>
                  <span>{subscriptionInfo.usage.products} / {subMaxProd < 0 ? '∞' : subMaxProd}</span>
                </div>
                <div className="dash__sub-bar-track">
                  <div className="dash__sub-bar-fill" style={{
                    width: `${subMaxProd < 0 ? 15 : subProdPct}%`,
                    background: subProdPct > 90 ? '#ef4444' : subProdPct > 70 ? '#f59e0b' : subColor,
                  }} />
                </div>
              </div>
            </div>

            {/* CTA */}
            <a href={`/subscription?shopId=${shopId}`} className="dash__sub-cta">
              ดูแผน & อัปเกรด →
            </a>
          </div>
        )}

        {/* ════ PRINT HEADER ════ */}
        <div className="print-only dash__print-header">
          <h1>รายงานสรุปยอดขาย — {periodLabel}</h1>
          <p>ร้าน: {currentShop?.name}{currentBranch ? ` · ${currentBranch.name}` : ' · ทุกสาขา'} | วันที่พิมพ์: {new Date().toLocaleString('th-TH')}</p>
        </div>

        <div className="dash__printable">
          {/* ════ HERO REVENUE CARD ════ */}
          {stats && (
            <div className="dash__hero-card">
              <div className="dash__hero-left">
                <span className="dash__hero-eyebrow">💰 ยอดขาย — {periodLabel}</span>
                <span className="dash__hero-amount">฿{fmt(stats.period.total)}</span>
                <div className="dash__hero-pills">
                  <span className="dash__hero-pill">🛒 {stats.period.orderCount.toLocaleString()} ออเดอร์</span>
                  <span className="dash__hero-pill">📦 {stats.period.totalQty.toLocaleString()} ชิ้น</span>
                  {stats.period.orderCount > 0 && (
                    <span className="dash__hero-pill">📈 เฉลี่ย ฿{fmt(Number(stats.period.total) / stats.period.orderCount)}/ออ.</span>
                  )}
                </div>
              </div>
              <div className="dash__hero-right">
                <div className="dash__hero-glyph">฿</div>
              </div>
              {/* decorative circles */}
              <div className="dash__hero-circle dash__hero-circle--1" />
              <div className="dash__hero-circle dash__hero-circle--2" />
            </div>
          )}

          {/* ════ 3 MINI KPI CARDS ════ */}
          {stats && (
            <div className="dash__kpi-row">
              <div className="dash__kpi-mini" style={{ borderLeftColor: '#3b82f6' }}>
                <div className="dash__kpi-mini-icon" style={{ background: '#dbeafe', color: '#1d4ed8' }}>🛒</div>
                <div className="dash__kpi-mini-body">
                  <div className="dash__kpi-mini-label">จำนวนออเดอร์</div>
                  <div className="dash__kpi-mini-value">{stats.period.orderCount.toLocaleString()}</div>
                  <div className="dash__kpi-mini-sub">ครั้ง ใน{periodLabel}</div>
                </div>
              </div>
              <div className="dash__kpi-mini" style={{ borderLeftColor: '#f59e0b' }}>
                <div className="dash__kpi-mini-icon" style={{ background: '#fef3c7', color: '#b45309' }}>📦</div>
                <div className="dash__kpi-mini-body">
                  <div className="dash__kpi-mini-label">สินค้าที่ขายได้</div>
                  <div className="dash__kpi-mini-value">{stats.period.totalQty.toLocaleString()}</div>
                  <div className="dash__kpi-mini-sub">ชิ้น / หน่วย</div>
                </div>
              </div>
              <div className="dash__kpi-mini" style={{ borderLeftColor: '#8b5cf6' }}>
                <div className="dash__kpi-mini-icon" style={{ background: '#ede9fe', color: '#6d28d9' }}>⭐</div>
                <div className="dash__kpi-mini-body">
                  <div className="dash__kpi-mini-label">สินค้าขายดีอันดับ 1</div>
                  <div className="dash__kpi-mini-value dash__kpi-mini-value--sm">{topProducts[0]?.name ?? '—'}</div>
                  <div className="dash__kpi-mini-sub">
                    {topProducts[0] ? `${topProducts[0].quantity} ชิ้น · ฿${fmt(topProducts[0].subtotal)}` : 'ยังไม่มีข้อมูล'}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ════ CHARTS ════ */}
          {stats && (
            <div className="dash__chart-row">
              <div className="dash__card dash__card--wide">
                <div className="dash__card-header">
                  <div className="dash__card-title-wrap">
                    <span className="dash__chip dash__chip--teal">📦</span>
                    <span className="dash__card-title">สินค้าขายดี</span>
                    <span className="dash__card-sub">Top {Math.min(topProducts.length, 8)} — {periodLabel}</span>
                  </div>
                </div>
                {topProducts.length === 0
                  ? <div className="dash__empty-chart">ยังไม่มีข้อมูลในช่วงนี้</div>
                  : (
                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart data={topProducts.slice(0, 8)} margin={{ top: 8, right: 8, left: 0, bottom: 48 }}>
                        <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#9ca3af' }} angle={-30} textAnchor="end" interval={0} />
                        <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} />
                        <Tooltip
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          formatter={(v: any, _n: any, props: any) => [`฿${fmt(v ?? 0)} (${props.payload?.quantity ?? 0} ชิ้น)`, 'ยอดขาย']}
                          contentStyle={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, color: '#111827', boxShadow: '0 8px 24px rgba(0,0,0,0.12)', fontSize: 13 }}
                        />
                        <Bar dataKey="subtotal" radius={[6, 6, 0, 0]}>
                          {topProducts.slice(0, 8).map((_e, i) => <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
              </div>

              <div className="dash__card">
                <div className="dash__card-header">
                  <div className="dash__card-title-wrap">
                    <span className="dash__chip dash__chip--violet">💳</span>
                    <span className="dash__card-title">ช่องทางชำระเงิน</span>
                  </div>
                  <span className="dash__card-badge">{periodLabel}</span>
                </div>
                {paymentData.length === 0
                  ? <div className="dash__empty-chart">ยังไม่มีข้อมูล</div>
                  : (
                    <>
                      <ResponsiveContainer width="100%" height={200}>
                        <PieChart>
                          <Pie data={paymentData} dataKey="value" nameKey="name"
                            cx="50%" cy="50%" outerRadius={80} innerRadius={32}
                            label={false} labelLine={false}>
                            {paymentData.map((e, i) => <Cell key={i} fill={e.color} />)}
                          </Pie>
                          <Tooltip
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            formatter={(v: any) => [`฿${fmt(v ?? 0)}`, 'ยอดรวม']}
                            contentStyle={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', fontSize: 13 }}
                          />
                          <Legend iconType="circle" wrapperStyle={{ fontSize: 12, color: '#6b7280' }} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="dash__payment-breakdown">
                        {paymentData.map((r, i) => {
                          const pct = totalPayment > 0 ? (r.value / totalPayment * 100).toFixed(1) : '0';
                          return (
                            <div key={i} className="dash__payment-row">
                              <span className="dash__payment-dot" style={{ background: r.color }} />
                              <span className="dash__payment-name">{r.name}</span>
                              <span className="dash__payment-meta">{r.count} ครั้ง · {pct}%</span>
                              <span className="dash__payment-total">฿{fmt(r.value)}</span>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
              </div>
            </div>
          )}

          {/* ════ SUMMARY GRID (ยอดขาย) ════ */}
          {stats && (
            <div className="dash__summary-section">
              <div className="dash__section-label">
                📅 ภาพรวม{currentBranch ? ` · ${currentBranch.name}` : ''} — เปรียบเทียบปัจจุบัน
              </div>
              <div className="dash__summary-grid">
                {([
                  { label: 'วันนี้',      stat: stats.daily,   colorVar: 'var(--dash-c-green)',  icon: '📅' },
                  { label: 'สัปดาห์นี้', stat: stats.weekly,  colorVar: 'var(--dash-c-blue)',   icon: '🗓' },
                  { label: 'เดือนนี้',   stat: stats.monthly, colorVar: 'var(--dash-c-violet)', icon: '📆' },
                  { label: 'ปีนี้',      stat: stats.yearly,  colorVar: 'var(--dash-c-amber)',  icon: '📊' },
                ]).map(({ label, stat, colorVar, icon }) => (
                  <div key={label} className="dash__summary-card" style={{ borderTopColor: colorVar }}>
                    <div className="dash__summary-head">
                      <span className="dash__summary-icon">{icon}</span>
                      <span className="dash__summary-label">{label}</span>
                    </div>
                    <span className="dash__summary-value" style={{ color: colorVar }}>฿{fmt(stat.total)}</span>
                    <div className="dash__summary-row">
                      <span className="dash__summary-orders">{stat.orderCount} ออเดอร์</span>
                      {stat.orderCount > 0 && (
                        <span className="dash__summary-avg">เฉลี่ย ฿{fmt(Number(stat.total) / stat.orderCount)}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ════ MONEY MISTAKE WIDGET ════ */}
          {stats?.moneyMistake && (() => {
            const mm = stats.moneyMistake;
            const hasData = mm.daily.over_total + mm.daily.under_total +
                            mm.monthly.over_total + mm.monthly.under_total +
                            mm.yearly.over_total + mm.yearly.under_total > 0;
            if (!hasData) return null;
            return (
              <div className="dash__summary-section">
                <div className="dash__section-label">
                  💸 ยอดรับเงินผิดพลาด — รับเกิน / รับขาด
                </div>
                <div className="dash-money-mistake__grid">
                  {([
                    { label: 'วันนี้',   data: mm.daily   },
                    { label: 'เดือนนี้', data: mm.monthly },
                    { label: 'ปีนี้',   data: mm.yearly  },
                  ]).map(({ label, data }) => (
                    <div key={label} className="dash-money-mistake__card">
                      <div className="dash-money-mistake__period">{label}</div>
                      <div className="dash-money-mistake__row dash-money-mistake__row--over">
                        <span>🔴 รับเกิน</span>
                        <span>฿{Number(data.over_total).toLocaleString('th-TH', { minimumFractionDigits: 2 })} <small>({data.over_count} ครั้ง)</small></span>
                      </div>
                      <div className="dash-money-mistake__row dash-money-mistake__row--under">
                        <span>🟡 รับขาด</span>
                        <span>฿{Number(data.under_total).toLocaleString('th-TH', { minimumFractionDigits: 2 })} <small>({data.under_count} ครั้ง)</small></span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* ════ SUMMARY GRID (ระบบสมาชิก / โปรโมชั่น / การตั้งค่า) ════ */}
          {(membershipSummary || promoSummary || settingsSummary) && (
            <div className="dash__summary-section">
              <div className="dash__section-label">
                ⚙️ ภาพรวมการตั้งค่าร้าน — สมาชิก / โปรโมชั่น / การชำระเงิน
              </div>
              <div className="dash__summary-grid">
                {membershipSummary && (
                  <div className="dash__summary-card" style={{ borderTopColor: membershipSummary.enabled ? 'var(--dash-c-green)' : 'var(--dash-c-red)' }}>
                    <div className="dash__summary-head">
                      <span className="dash__summary-icon">🎫</span>
                      <span className="dash__summary-label">ระบบสมาชิก</span>
                    </div>
                    <span className="dash__summary-value" style={{ color: membershipSummary.enabled ? 'var(--dash-c-green)' : 'var(--dash-c-red)' }}>
                      {membershipSummary.enabled ? 'เปิดใช้งาน' : 'ปิดอยู่'}
                    </span>
                    <div className="dash__summary-row">
                      <span className="dash__summary-orders">
                        {membershipSummary.totalMembers.toLocaleString()} สมาชิก
                      </span>
                      <span className="dash__summary-avg">
                        ⭐ {membershipSummary.totalPoints.toLocaleString()} แต้มรวม
                      </span>
                    </div>
                    <div className="dash__summary-row" style={{ marginTop: '0.25rem', fontSize: '0.78rem', color: 'var(--color-text-subtle)' }}>
                      {membershipSummary.birthdayLabel}
                    </div>
                  </div>
                )}

                {promoSummary && (
                  <div className="dash__summary-card" style={{ borderTopColor: 'var(--dash-c-violet)' }}>
                    <div className="dash__summary-head">
                      <span className="dash__summary-icon">🏷️</span>
                      <span className="dash__summary-label">โปรโมชั่น POS</span>
                    </div>
                    <span className="dash__summary-value" style={{ color: 'var(--dash-c-violet)' }}>
                      {promoSummary.presetCount + promoSummary.comboCount} รายการ
                    </span>
                    <div className="dash__summary-row">
                      <span className="dash__summary-orders">
                        {promoSummary.presetCount} ส่วนลดสำเร็จรูป
                      </span>
                      <span className="dash__summary-avg">
                        {promoSummary.comboCount} ชุดเซ็ต / คอมโบ
                      </span>
                    </div>
                  </div>
                )}

                {settingsSummary && (
                  <div className="dash__summary-card" style={{ borderTopColor: 'var(--dash-c-blue)' }}>
                    <div className="dash__summary-head">
                      <span className="dash__summary-icon">🧾</span>
                      <span className="dash__summary-label">การชำระเงิน & ใบเสร็จ</span>
                    </div>
                    <span className="dash__summary-value" style={{ color: 'var(--dash-c-blue)' }}>
                      {settingsSummary.printReceiptEnabled ? 'พิมพ์ใบเสร็จอัตโนมัติ' : 'ไม่พิมพ์อัตโนมัติ'}
                    </span>
                    <div className="dash__summary-row">
                      <span className="dash__summary-orders">
                        ขนาดกระดาษ: {settingsSummary.printerWidth ? `${settingsSummary.printerWidth} ตัวอักษร` : 'ยังไม่ตั้งค่า'}
                      </span>
                      <span className="dash__summary-avg">
                        PromptPay: {settingsSummary.promptpayConfigured ? 'ตั้งค่าแล้ว' : 'ยังไม่ตั้งค่า'}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ════ BOTTOM ROW ════ */}
          <div className="dash__bottom-row">
            {topProducts.length > 0 && (
              <div className="dash__card dash__card--table">
                <div className="dash__card-header">
                  <div className="dash__card-title-wrap">
                    <span className="dash__chip dash__chip--amber">🏆</span>
                    <span className="dash__card-title">Top 10 สินค้าขายดี</span>
                    <span className="dash__card-sub">{periodLabel}</span>
                  </div>
                  <span className="dash__card-badge">{topProducts.length} รายการ</span>
                </div>
                <div className="dash__table-scroll">
                  <table className="dash__table">
                    <thead>
                      <tr>
                        <th style={{ width: '3rem' }}>#</th>
                        <th>ชื่อสินค้า</th>
                        <th style={{ textAlign: 'right' }}>จำนวน (ชิ้น)</th>
                        <th style={{ textAlign: 'right' }}>ยอดรวม (บาท)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topProducts.map((p, i) => (
                        <tr key={p.productId}>
                          <td>
                            <span className={`dash__rank ${i===0?'dash__rank--gold':i===1?'dash__rank--silver':i===2?'dash__rank--bronze':'dash__rank--normal'}`}>
                              {i + 1}
                            </span>
                          </td>
                          <td className="dash__table-name">{p.name}</td>
                          <td className="dash__table-num">{p.quantity.toLocaleString()}</td>
                          <td className="dash__table-total">฿{fmt(p.subtotal)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={2} className="dash__table-foot-label">รวมทั้งหมด</td>
                        <td className="dash__table-num dash__table-foot-val">{topProducts.reduce((s,p)=>s+p.quantity,0).toLocaleString()}</td>
                        <td className="dash__table-total dash__table-foot-val">฿{fmt(topProducts.reduce((s,p)=>s+Number(p.subtotal),0))}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}

            <div className="dash__right-panel">
              {(() => {
                const outOfStock = lowStock.filter(item => item.quantity === 0);
                const nearEmpty  = lowStock.filter(item => item.quantity > 0);
                const branchSuffix = currentBranch ? ` · ${currentBranch.name}` : ' · ทุกสาขา';
                return (
                  <>
                    {/* ── สินค้าหมด ── */}
                    {outOfStock.length > 0 && (
                      <div className="dash__card dash__card--alert">
                        <div className="dash__card-header">
                          <div className="dash__card-title-wrap">
                            <span className="dash__chip dash__chip--red">🔴</span>
                            <span className="dash__card-title">สินค้าหมด</span>
                            <span className="dash__card-sub">{branchSuffix}</span>
                          </div>
                          <span className="dash__count-badge dash__count-badge--red">{outOfStock.length}</span>
                        </div>
                        <div className="dash__alert-list">
                          {outOfStock.slice(0, 15).map((item, i) => (
                            <div key={i} className="dash__alert-item dash__alert-item--empty">
                              <div className="dash__alert-left">
                                <span className="dash__alert-status-dot" style={{ background: '#ef4444' }} />
                                <div className="dash__alert-info">
                                  <span className="dash__alert-name">{item.product_name}</span>
                                  {!currentBranch && <span className="dash__alert-branch">📍 {item.branch_name}</span>}
                                </div>
                              </div>
                              <div className="dash__alert-right">
                                <span className="dash__alert-qty dash__alert-qty--zero">หมด</span>
                                <span className="dash__alert-min">เกณฑ์ {item.min_qty} {item.unit}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* ── สินค้าใกล้หมด ── */}
                    {nearEmpty.length > 0 && (
                      <div className="dash__card dash__card--alert">
                        <div className="dash__card-header">
                          <div className="dash__card-title-wrap">
                            <span className="dash__chip dash__chip--red">⚠️</span>
                            <span className="dash__card-title">สินค้าใกล้หมด</span>
                            <span className="dash__card-sub">{branchSuffix}</span>
                          </div>
                          <span className="dash__count-badge dash__count-badge--red">{nearEmpty.length}</span>
                        </div>
                        <div className="dash__alert-list">
                          {nearEmpty.slice(0, 15).map((item, i) => {
                            const pct = item.min_qty > 0 ? Math.round(item.quantity / item.min_qty * 100) : 0;
                            return (
                              <div key={i} className="dash__alert-item">
                                <div className="dash__alert-left">
                                  <span className="dash__alert-status-dot" style={{ background: '#f59e0b' }} />
                                  <div className="dash__alert-info">
                                    <span className="dash__alert-name">{item.product_name}</span>
                                    {!currentBranch && <span className="dash__alert-branch">📍 {item.branch_name}</span>}
                                  </div>
                                </div>
                                <div className="dash__alert-right">
                                  <span className="dash__alert-qty">{item.quantity} {item.unit}</span>
                                  <span className="dash__alert-min">เกณฑ์ {item.min_qty} · {pct}%</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}

              {lowStock.length === 0 && (
                <div className="dash__card dash__card--ok">
                  <span className="dash__ok-icon">✅</span>
                  <div>
                    <div className="dash__ok-title">สต๊อกสินค้าปกติ</div>
                    <div className="dash__ok-sub">ไม่มีรายการที่ต้องแจ้งเตือน</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>{/* end .dash__printable */}

        {shops.length === 0 && !error && <p className="dash__empty">ยังไม่มีร้านที่กำหนดให้</p>}

        <div className="dash__footer no-print">
          <GoToPOSLink className="dash__link">🏪 ไปหน้า POS</GoToPOSLink>
          <a href="/admin" className="dash__link">⚙️ จัดการร้าน</a>
          <a href="/admin?tab=stock" className="dash__link">📦 จัดการสต๊อก</a>
          <a href="/reports" className="dash__link">📊 รายงาน P&amp;L</a>
        </div>
      </div>
    </main>
  );
}
