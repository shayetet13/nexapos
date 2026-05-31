'use client';

import { createPortal } from 'react-dom';
import Link from 'next/link';
import { Skeleton } from '@/components/ui/Skeleton';

export type OrderStatus = 'pending' | 'paid' | 'void' | 'refunded';
export type PaymentMethod = 'cash' | 'card' | 'transfer' | 'other';

export interface Order {
  id: string;
  order_number?: number;
  daily_seq?: number;
  branch_name: string;
  user_email: string;
  status: OrderStatus;
  total: string;
  payment_method: PaymentMethod | null;
  created_at: string;
  ref_code?: string | null;
  receipt_token?: string | null;
  refunded_by_email?: string | null;
  refunded_at?: string | null;
  refund_type?: string | null;
  refund_reason?: string | null;
}

export interface OrderDetailItem {
  id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: string;
  subtotal: string;
}

export interface OrderDetail {
  id: string;
  order_number: number;
  daily_seq: number;
  status: OrderStatus;
  total: string;
  payment_method: PaymentMethod | null;
  created_at: string;
  branch_id: string;
  branch_name: string;
  user_email?: string | null;
  items: OrderDetailItem[];
}

const STATUS_LABELS: Record<OrderStatus, string> = { pending: 'รอดำเนินการ', paid: 'ชำระแล้ว', void: 'ยกเลิก', refunded: 'คืนเงิน' };
const PAYMENT_LABELS: Record<PaymentMethod, string> = { cash: 'เงินสด', card: 'บัตร', transfer: 'โอน', other: 'อื่นๆ' };

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('th-TH', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

interface MonthlyStats {
  revenue: number;
  orderCount: number;
  cogs: number;
  grossProfit: number;
}

interface Props {
  orders: Order[];
  ordersLoading: boolean;
  ordersError: string | null;
  orderDetailOpen: boolean; setOrderDetailOpen: (v: boolean) => void;
  orderDetail: OrderDetail | null; setOrderDetail: (v: OrderDetail | null) => void;
  orderDetailLoading: boolean;
  currentPage: number; setCurrentPage: React.Dispatch<React.SetStateAction<number>>;
  totalOrders: number;
  filterStatus: OrderStatus | 'all'; setFilterStatus: (v: OrderStatus | 'all') => void;
  searchSeq: string; setSearchSeq: (v: string) => void;
  searchDate: string; setSearchDate: (v: string) => void;
  ORDERS_PER_PAGE: number;
  totalPages: number;
  monthlyStats: MonthlyStats | null;
  monthlyStatsLoading: boolean;
  shopId: string | null;
  searchRef: string; setSearchRef: (v: string) => void;
  loadOrders: (page?: number, status?: OrderStatus | 'all', seq?: string, date?: string, ref?: string) => void;
  loadMonthlyStats: () => void;
  setMonthlyStats: (v: MonthlyStats | null) => void;
  loadOrderDetail: (orderId: string) => void;
}

export function OrdersTab({
  orders, ordersLoading, ordersError,
  orderDetailOpen, setOrderDetailOpen,
  orderDetail, setOrderDetail,
  orderDetailLoading,
  currentPage, setCurrentPage,
  totalOrders,
  filterStatus, setFilterStatus,
  searchSeq, setSearchSeq,
  searchDate, setSearchDate,
  searchRef, setSearchRef,
  ORDERS_PER_PAGE, totalPages,
  monthlyStats, monthlyStatsLoading,
  shopId,
  loadOrders, loadMonthlyStats, setMonthlyStats,
  loadOrderDetail,
}: Props) {
  return (
    <div className="page-admin__tab-content">
      {/* ── Header ── */}
      <div className="page-admin__section">
        <h2 className="page-admin__title">ออเดอร์</h2>
        <button
          type="button"
          onClick={() => { setCurrentPage(1); loadOrders(1, filterStatus, searchSeq || undefined, searchDate || undefined); }}
          className="page-admin__btn-sm"
          disabled={ordersLoading}
        >
          {ordersLoading ? '⏳' : '↺'} รีเฟรช
        </button>
      </div>

      {/* ── Search bar ── */}
      <div className="orders-search-bar">
        <div className="orders-search-field">
          <label className="orders-search-label" htmlFor="orders-search-seq">
            🔢 เลขออเดอร์
          </label>
          <input
            id="orders-search-seq"
            type="number"
            min={1}
            placeholder="เช่น 12"
            value={searchSeq}
            onChange={(e) => { setSearchSeq(e.target.value); setCurrentPage(1); }}
            className="orders-search-input"
          />
        </div>
        <div className="orders-search-field">
          <label className="orders-search-label" htmlFor="orders-search-date">
            📅 วันที่
          </label>
          <input
            id="orders-search-date"
            type="date"
            value={searchDate}
            onChange={(e) => { setSearchDate(e.target.value); setCurrentPage(1); }}
            className="orders-search-input"
          />
        </div>
        <div className="orders-search-field">
          <label className="orders-search-label" htmlFor="orders-search-ref">
            🔖 เลขอ้างอิง
          </label>
          <input
            id="orders-search-ref"
            type="text"
            placeholder="เช่น ABC12345"
            value={searchRef}
            onChange={(e) => { setSearchRef(e.target.value); setCurrentPage(1); }}
            className="orders-search-input"
            style={{ textTransform: 'uppercase' }}
          />
        </div>
        {(searchSeq || searchDate || searchRef) && (
          <button
            type="button"
            className="orders-search-clear"
            onClick={() => { setSearchSeq(''); setSearchDate(''); setSearchRef(''); setCurrentPage(1); }}
          >
            ✕ ล้างการค้นหา
          </button>
        )}
      </div>

      {/* ── Monthly summary cards (same source as dashboard) ── */}
      <div className="orders-monthly-header">
        <span className="orders-monthly-label">
          📅 สรุปเดือน{new Date().toLocaleString('th-TH', { month: 'long', year: 'numeric', calendar: 'buddhist' })}
        </span>
        <button
          type="button"
          className="orders-monthly-refresh"
          onClick={() => { setMonthlyStats(null); loadMonthlyStats(); }}
          disabled={monthlyStatsLoading}
          title="รีเฟรชยอดเดือนนี้"
        >
          {monthlyStatsLoading ? '⏳' : '↺'}
        </button>
      </div>
      <div className="orders-stats">
        {/* รายรับ */}
        <div className="orders-stat-card orders-stat-card--revenue">
          <span className="orders-stat-label">💰 รายรับเดือนนี้</span>
          {monthlyStatsLoading ? (
            <span className="orders-stat-value orders-stat-skeleton">—</span>
          ) : (
            <span className="orders-stat-value">
              ฿{(monthlyStats?.revenue ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 0 })}
            </span>
          )}
          <span className="orders-stat-sub">{monthlyStats?.orderCount ?? 0} ออเดอร์</span>
        </div>

        {/* กำไร/ขาดทุน */}
        {(() => {
          const gp = monthlyStats?.grossProfit ?? 0;
          const isProfit = gp >= 0;
          return (
            <div className={`orders-stat-card ${isProfit ? 'orders-stat-card--profit' : 'orders-stat-card--loss'}`}>
              <span className="orders-stat-label">{isProfit ? '📈 กำไรขั้นต้น' : '📉 ขาดทุน'}</span>
              {monthlyStatsLoading ? (
                <span className="orders-stat-value orders-stat-skeleton">—</span>
              ) : (
                <span className="orders-stat-value">
                  {isProfit ? '' : '−'}฿{Math.abs(gp).toLocaleString('th-TH', { minimumFractionDigits: 0 })}
                </span>
              )}
              <span className="orders-stat-sub">
                {monthlyStats && monthlyStats.revenue > 0
                  ? `margin ${Math.round((gp / monthlyStats.revenue) * 100)}%`
                  : 'ต้นทุน ฿' + (monthlyStats?.cogs ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 0 })}
              </span>
            </div>
          );
        })()}

        {/* ต้นทุน */}
        <div className="orders-stat-card orders-stat-card--cost">
          <span className="orders-stat-label">🏷️ ต้นทุนรวม</span>
          {monthlyStatsLoading ? (
            <span className="orders-stat-value orders-stat-skeleton">—</span>
          ) : (
            <span className="orders-stat-value">
              ฿{(monthlyStats?.cogs ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 0 })}
            </span>
          )}
          <span className="orders-stat-sub">ยอดทั้งหมด {totalOrders.toLocaleString('th-TH')} รายการ</span>
        </div>
      </div>

      {/* ── Status filter tabs ── */}
      <div className="orders-filter-tabs">
        {(['all', 'paid', 'pending', 'void', 'refunded'] as const).map((s) => (
          <button
            key={s}
            type="button"
            className={`orders-filter-tab${filterStatus === s ? ' orders-filter-tab--active' : ''}`}
            onClick={() => { setFilterStatus(s); setCurrentPage(1); }}
          >
            {s === 'all' ? 'ทั้งหมด' : STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      {/* ── Error ── */}
      {ordersError && (
        <div className="page-admin__error-banner">⚠ {ordersError}</div>
      )}

      {/* ── Table ── */}
      {ordersLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : orders.length === 0 ? (
        <div className="orders-empty">
          <span className="orders-empty-icon">🔍</span>
          {(searchSeq || searchDate || searchRef) ? (
            <>
              <p>ไม่พบออเดอร์ที่ค้นหา</p>
              <button type="button" className="page-admin__btn-sm" onClick={() => { setSearchSeq(''); setSearchDate(''); setSearchRef(''); }}>
                ล้างการค้นหา
              </button>
            </>
          ) : (
            <>
              <p>{filterStatus === 'all' ? 'ยังไม่มีออเดอร์' : `ไม่มีออเดอร์สถานะ "${STATUS_LABELS[filterStatus as OrderStatus]}"`}</p>
              {filterStatus !== 'all' && (
                <button type="button" className="page-admin__btn-sm" onClick={() => setFilterStatus('all')}>
                  ดูทั้งหมด
                </button>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="page-admin__orders-table-wrap">
          <table className="page-admin__orders-table">
            <thead>
              <tr>
                <th>#</th>
                <th>อ้างอิง</th>
                <th>วันที่</th>
                <th>สาขา</th>
                <th>ผู้ขาย</th>
                <th>ยอด</th>
                <th>ชำระ</th>
                <th>สถานะ</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr
                  key={o.id}
                  className={`${o.status === 'void' ? 'page-admin__order-row--void' : ''} cursor-pointer`}
                  onClick={() => loadOrderDetail(o.id)}
                >
                  <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.82rem', color: 'var(--color-text)' }}>
                    #{String(o.daily_seq ?? o.order_number ?? 0).padStart(4, '0')}
                  </td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--color-text-muted)', letterSpacing: '0.05em' }}>
                    {o.ref_code ?? '—'}
                  </td>
                  <td className="page-admin__order-date">{fmtDate(o.created_at)}</td>
                  <td style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', minWidth: 80 }}>
                    {o.branch_name}
                  </td>
                  <td className="page-admin__order-email" title={o.user_email}>{o.user_email}</td>
                  <td className="page-admin__order-total">฿{Number(o.total).toLocaleString('th-TH')}</td>
                  <td style={{ fontSize: '0.8rem', color: 'var(--color-text-subtle)' }}>
                    {o.payment_method ? PAYMENT_LABELS[o.payment_method] : '—'}
                  </td>
                  <td>
                    <span className={`page-admin__status page-admin__status--${o.status}`}>
                      {STATUS_LABELS[o.status]}
                    </span>
                  </td>
                  <td onClick={(e) => e.stopPropagation()} style={{ minWidth: 120 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                      {o.receipt_token && (
                        <Link
                          href={`/receipt/${o.receipt_token}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="page-admin__btn-sm"
                          style={{ textDecoration: 'none', display: 'inline-block' }}
                          title="ดูใบเสร็จ"
                        >
                          🧾
                        </Link>
                      )}
                      {o.status === 'paid' && shopId && (
                        <Link
                          href={`/refund?shopId=${shopId}&orderId=${o.id}`}
                          className="page-admin__btn-sm"
                          style={{ textDecoration: 'none', display: 'inline-block' }}
                        >
                          💰 คืนเงิน
                        </Link>
                      )}
                      {o.status === 'refunded' && o.refunded_by_email && (
                        <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ opacity: 0.6 }}>👤</span>
                          <span style={{ maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {o.refunded_by_email}
                          </span>
                          <span>{o.refund_type === 'money_mistake' ? '💵' : '📦'}</span>
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Pagination ── */}
      {totalOrders > ORDERS_PER_PAGE && (
        <div className="page-admin__pagination">
          <div className="page-admin__pagination-info">
            หน้า {currentPage} / {totalPages} &nbsp;·&nbsp; {totalOrders.toLocaleString('th-TH')} รายการ
          </div>
          <div className="page-admin__pagination-buttons">
            <button
              type="button"
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1 || ordersLoading}
              className="page-admin__pagination-btn"
            >
              ← ก่อนหน้า
            </button>
            <button
              type="button"
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages || ordersLoading}
              className="page-admin__pagination-btn"
            >
              ถัดไป →
            </button>
          </div>
        </div>
      )}

      {/* ── Order Detail Modal — rendered via Portal to escape ancestor transform/stacking context ── */}
      {orderDetailOpen && createPortal(
        <div className="page-admin__modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) { setOrderDetailOpen(false); setOrderDetail(null); } }}>
          <div className="order-detail-modal">
            <div className="order-detail-header">
              <h3>รายละเอียดออเดอร์</h3>
              <button className="order-detail-close" onClick={() => { setOrderDetailOpen(false); setOrderDetail(null); }}>✕</button>
            </div>

            {orderDetailLoading ? (
              <div className="text-center py-8"><Skeleton className="h-40 w-full" /></div>
            ) : orderDetail ? (
              <div>
                <div className="order-detail-info">
                  <div className="order-detail-row">
                    <span className="order-detail-label">เลขออเดอร์ (วันนี้)</span>
                    <span className="order-detail-value" style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '1.1rem' }}>
                      #{String(orderDetail.daily_seq ?? orderDetail.order_number).padStart(4, '0')}
                    </span>
                  </div>
                  <div className="order-detail-row">
                    <span className="order-detail-label">สาขา</span>
                    <span className="order-detail-value">{orderDetail.branch_name}</span>
                  </div>
                  <div className="order-detail-row">
                    <span className="order-detail-label">ผู้ขาย</span>
                    <span className="order-detail-value">{orderDetail.user_email ?? '—'}</span>
                  </div>
                  <div className="order-detail-row">
                    <span className="order-detail-label">วันที่</span>
                    <span className="order-detail-value">{new Date(orderDetail.created_at).toLocaleString('th-TH')}</span>
                  </div>
                  <div className="order-detail-row">
                    <span className="order-detail-label">ชำระด้วย</span>
                    <span className="order-detail-value">
                      {orderDetail.payment_method ? PAYMENT_LABELS[orderDetail.payment_method] : '—'}
                    </span>
                  </div>
                  <div className="order-detail-row">
                    <span className="order-detail-label">สถานะ</span>
                    <span className={`page-admin__status page-admin__status--${orderDetail.status}`}>
                      {STATUS_LABELS[orderDetail.status]}
                    </span>
                  </div>
                  <div className="order-detail-total">
                    <span>ยอดรวม</span>
                    <span>฿{Number(orderDetail.total).toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span>
                  </div>
                </div>

                <div className="order-items-title">รายการสินค้า ({orderDetail.items?.length ?? 0} รายการ)</div>
                <div className="max-h-64 overflow-y-auto">
                  <table className="order-items-table">
                    <thead>
                      <tr>
                        <th>สินค้า</th>
                        <th className="text-right">จำนวน</th>
                        <th className="text-right">ราคา/หน่วย</th>
                        <th className="text-right">รวม</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orderDetail.items?.map((item: OrderDetailItem) => (
                        <tr key={item.id}>
                          <td>{item.product_name}</td>
                          <td className="text-right">{item.quantity}</td>
                          <td className="text-right">฿{Number(item.unit_price).toLocaleString('th-TH')}</td>
                          <td className="text-right font-medium">฿{Number(item.subtotal).toLocaleString('th-TH')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="text-center py-6" style={{ color: 'var(--color-error)' }}>ไม่พบข้อมูลออเดอร์</div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
