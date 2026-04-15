'use client';

export interface AllStockRow {
  product_id: string; product_name: string; sku: string | null;
  unit: string; category: string | null; image_url: string | null;
  branch_id: string; branch_name: string; quantity: number; min_qty: number;
  updated_at: string | null;
}

export interface StockTxRow {
  id: string; branch_id: string; branch_name: string;
  product_id: string; product_name: string; sku: string | null; unit: string;
  type: string; qty_before: number; qty_change: number; qty_after: number;
  note: string | null; created_at: string;
}

export interface Branch { id: string; name: string; address?: string; }
export interface Product {
  id: string; name: string; sku: string | null; price: string; image_url: string | null;
  category: string | null; unit: string; cost_price: string | null; barcode: string | null;
  show_on_pos: boolean;
}
export interface ShopUnit { id: string; name: string; }

const TX_TYPE_LABELS: Record<string, string> = { manual_set: 'ตั้งค่า', manual_add: 'เพิ่ม', sale_deduct: 'ขาย', adjustment: 'ปรับปรุง' };

interface StockSummary {
  totalProducts: number;
  totalQty: number;
  lowCount: number;
  warnCount: number;
  byBranch: Record<string, { name: string; total: number; low: number }>;
}

interface Props {
  allStock: AllStockRow[];
  stockLoading: boolean;
  stockSearch: string; setStockSearch: (v: string) => void;
  stockBranchFilter: string; setStockBranchFilter: (v: string) => void;
  stockEditModal: AllStockRow | null; setStockEditModal: (v: AllStockRow | null) => void;
  stockEditQty: string; setStockEditQty: (v: string) => void;
  stockEditMin: string; setStockEditMin: (v: string) => void;
  stockEditMode: 'set' | 'add' | 'remove'; setStockEditMode: (v: 'set' | 'add' | 'remove') => void;
  stockSaving: boolean;
  stockSubView: 'list' | 'history'; setStockSubView: (v: 'list' | 'history') => void;
  stockHistory: StockTxRow[];
  histLoading: boolean;
  histFromDate: string; setHistFromDate: (v: string) => void;
  histToDate: string; setHistToDate: (v: string) => void;
  histBranchFilter: string; setHistBranchFilter: (v: string) => void;
  addStockOpen: boolean; setAddStockOpen: (v: boolean) => void;
  addStockProductId: string; setAddStockProductId: (v: string) => void;
  addStockBranchId: string; setAddStockBranchId: (v: string) => void;
  addStockQty: string; setAddStockQty: (v: string) => void;
  addStockMin: string; setAddStockMin: (v: string) => void;
  addStockSaving: boolean;
  addStockError: string | null;
  shopUnits: ShopUnit[];
  newUnitName: string; setNewUnitName: (v: string) => void;
  unitSaving: boolean;
  branches: Branch[];
  products: Product[];
  stockSummary: StockSummary;
  saveStockModal: () => void;
  saveAddStock: () => void;
  addUnit: () => void;
  deleteUnit: (id: string) => void;
  loadStockHistory: () => void;
}

export function StockTab({
  allStock, stockLoading,
  stockSearch, setStockSearch,
  stockBranchFilter, setStockBranchFilter,
  stockEditModal, setStockEditModal,
  stockEditQty, setStockEditQty,
  stockEditMin, setStockEditMin,
  stockEditMode, setStockEditMode,
  stockSaving,
  stockSubView, setStockSubView,
  stockHistory,
  histLoading,
  histFromDate, setHistFromDate,
  histToDate, setHistToDate,
  histBranchFilter, setHistBranchFilter,
  addStockOpen, setAddStockOpen,
  addStockProductId, setAddStockProductId,
  addStockBranchId, setAddStockBranchId,
  addStockQty, setAddStockQty,
  addStockMin, setAddStockMin,
  addStockSaving, addStockError,
  shopUnits, newUnitName, setNewUnitName, unitSaving,
  branches, products, stockSummary,
  saveStockModal, saveAddStock, addUnit, deleteUnit, loadStockHistory,
}: Props) {
  return (
    <div className="stk__root" style={{ display: 'none' }}>

      {/* ─── LEFT SIDEBAR ─────────────────────────────────── */}
      <aside className="stk__sidebar">
        {/* Summary card */}
        <div className="stk__summary-card">
          <p className="stk__summary-label">SKU ทั้งหมด</p>
          <p className="stk__summary-val">{stockSummary.totalProducts} รายการ</p>
          <div className="stk__summary-divider" />
          <p className="stk__summary-label">จำนวนสต๊อกรวม</p>
          <p className="stk__summary-val">{stockSummary.totalQty.toLocaleString('th-TH')}</p>
          <div className="stk__summary-divider" />
          <div className="stk__alert-row">
            <span className="stk__dot stk__dot--low" />
            <span className="stk__alert-text">ต่ำกว่าเกณฑ์</span>
            <span className="stk__alert-count stk__alert-count--low">{stockSummary.lowCount}</span>
          </div>
          <div className="stk__alert-row">
            <span className="stk__dot stk__dot--warn" />
            <span className="stk__alert-text">ใกล้หมด</span>
            <span className="stk__alert-count stk__alert-count--warn">{stockSummary.warnCount}</span>
          </div>
        </div>

        {/* Per-branch breakdown */}
        {Object.keys(stockSummary.byBranch).length > 0 && (
          <div className="stk__branch-card">
            <p className="stk__card-heading">🏪 สรุปตามสาขา</p>
            {Object.entries(stockSummary.byBranch).map(([bId, b]) => (
              <div key={bId} className="stk__branch-row">
                <span className="stk__branch-name">{b.name}</span>
                <span className="stk__branch-qty">{b.total.toLocaleString('th-TH')}</span>
                {b.low > 0 && <span className="stk__branch-low">⚠️ {b.low}</span>}
              </div>
            ))}
          </div>
        )}

        {/* Unit manager */}
        <div className="stk__unit-card">
          <p className="stk__card-heading">🔧 หน่วยนับ</p>
          <div className="stk__unit-add-row">
            <input
              placeholder="เพิ่มหน่วย เช่น โหล"
              value={newUnitName}
              onChange={(e) => setNewUnitName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addUnit()}
              className="stk__unit-input"
            />
            <button type="button" onClick={addUnit} disabled={unitSaving || !newUnitName.trim()} className="stk__unit-add-btn">
              {unitSaving ? '...' : '+'}
            </button>
          </div>
          <div className="stk__unit-tags">
            {shopUnits.map((u) => (
              <span key={u.id} className="stk__unit-tag">
                {u.name}
                <button type="button" onClick={() => deleteUnit(u.id)} className="stk__unit-tag-del" title="ลบ">×</button>
              </span>
            ))}
            {shopUnits.length === 0 && <span className="stk__unit-empty">ยังไม่มีหน่วยกำหนดเอง</span>}
          </div>
        </div>
      </aside>

      {/* ─── MAIN PANEL ───────────────────────────────────── */}
      <div className="stk__main">

        {/* Sub-tabs */}
        <div className="stk__subtabs">
          <button
            type="button"
            className={`stk__subtab${stockSubView === 'list' ? ' stk__subtab--active' : ''}`}
            onClick={() => setStockSubView('list')}
          >
            📦 สต๊อกสินค้า
          </button>
          <button
            type="button"
            className={`stk__subtab${stockSubView === 'history' ? ' stk__subtab--active' : ''}`}
            onClick={() => setStockSubView('history')}
          >
            📋 ประวัติการเปลี่ยนแปลง
          </button>

          {stockSubView === 'list' && (
            <div className="stk__controls">
              <input
                placeholder="🔍 ค้นหาสินค้า..."
                value={stockSearch}
                onChange={(e) => setStockSearch(e.target.value)}
                className="stk__search"
              />
              <select value={stockBranchFilter} onChange={(e) => setStockBranchFilter(e.target.value)} className="stk__branch-select">
                <option value="">ทุกสาขา</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <button
                type="button"
                className="stk__btn-add"
                onClick={() => { setAddStockProductId(''); setAddStockBranchId(branches[0]?.id ?? ''); setAddStockQty('0'); setAddStockMin('5'); setAddStockOpen(true); }}
              >
                ➕ เพิ่มสต๊อก
              </button>
              <button type="button" onClick={() => window.print()} className="stk__btn-print" title="พิมพ์">🖨</button>
            </div>
          )}

          {stockSubView === 'history' && (
            <div className="stk__controls">
              <select value={histBranchFilter} onChange={(e) => setHistBranchFilter(e.target.value)} className="stk__branch-select">
                <option value="">ทุกสาขา</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <input type="date" value={histFromDate} onChange={(e) => setHistFromDate(e.target.value)} className="stk__date-input" title="ตั้งแต่วันที่" />
              <input type="date" value={histToDate} onChange={(e) => setHistToDate(e.target.value)} className="stk__date-input" title="ถึงวันที่" />
              <button type="button" onClick={loadStockHistory} className="stk__btn-add">🔍 ค้นหา</button>
            </div>
          )}
        </div>

        {/* ── Stock list view ── */}
        {stockSubView === 'list' && (
          <div className="stk__table-wrap">
            {stockLoading ? (
              <div className="stk__skel-wrap">
                {[1,2,3,4].map((n) => <div key={n} className="stk__skel-row" />)}
              </div>
            ) : (
              <table className="stk__table">
                <thead>
                  <tr>
                    <th>สินค้า</th>
                    <th>หน่วย</th>
                    <th>หมวด</th>
                    <th>สาขา</th>
                    <th>สต๊อก</th>
                    <th>แจ้งเตือน</th>
                    <th>อัปเดต</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {allStock
                    .filter((row) =>
                      (!stockSearch || row.product_name.toLowerCase().includes(stockSearch.toLowerCase()) || (row.sku ?? '').toLowerCase().includes(stockSearch.toLowerCase())) &&
                      (!stockBranchFilter || row.branch_id === stockBranchFilter)
                    )
                    .map((row, i) => {
                      const isLow  = row.quantity <= row.min_qty;
                      const isWarn = !isLow && row.quantity <= row.min_qty * 2;
                      return (
                        <tr key={i} className={isLow ? 'stk__row--low' : isWarn ? 'stk__row--warn' : ''}>
                          <td>
                            <div className="stk__product-cell">
                              {row.image_url
                                // eslint-disable-next-line @next/next/no-img-element
                                ? <img src={row.image_url} alt={row.product_name} className="stk__thumb" />
                                : <div className="stk__thumb stk__thumb--empty" />}
                              <div>
                                <div className="stk__product-name">{row.product_name}</div>
                                {row.sku && <div className="stk__product-sku">{row.sku}</div>}
                              </div>
                            </div>
                          </td>
                          <td className="stk__td-center">{row.unit}</td>
                          <td className="stk__td-center">{row.category || <span className="stk__muted">—</span>}</td>
                          <td>{row.branch_name}</td>
                          <td className="stk__td-center">
                            <span className={`stk__qty-badge${isLow ? ' stk__qty-badge--low' : isWarn ? ' stk__qty-badge--warn' : ' stk__qty-badge--ok'}`}>
                              {row.quantity}
                            </span>
                          </td>
                          <td className="stk__td-center stk__muted">{row.min_qty}</td>
                          <td className="stk__td-date">
                            {row.updated_at
                              ? new Date(row.updated_at).toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: '2-digit' })
                              : <span className="stk__muted">—</span>}
                          </td>
                          <td>
                            <div className="stk__row-actions">
                              <button
                                type="button"
                                className="stk__edit-btn stk__edit-btn--add"
                                title="เพิ่มสต๊อก"
                                onClick={() => { setStockEditModal(row); setStockEditQty(''); setStockEditMin(String(row.min_qty)); setStockEditMode('add'); }}
                              >
                                +
                              </button>
                              <button
                                type="button"
                                className="stk__edit-btn stk__edit-btn--remove"
                                title="ลบสต๊อก"
                                disabled={row.quantity === 0}
                                onClick={() => { setStockEditModal(row); setStockEditQty(''); setStockEditMin(String(row.min_qty)); setStockEditMode('remove'); }}
                              >
                                −
                              </button>
                              <button
                                type="button"
                                className="stk__edit-btn"
                                title="ตั้งค่า"
                                onClick={() => { setStockEditModal(row); setStockEditQty(String(row.quantity)); setStockEditMin(String(row.min_qty)); setStockEditMode('set'); }}
                              >
                                ✏️
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  {allStock.filter((r) => (!stockSearch || r.product_name.toLowerCase().includes(stockSearch.toLowerCase())) && (!stockBranchFilter || r.branch_id === stockBranchFilter)).length === 0 && (
                    <tr>
                      <td colSpan={8} className="stk__empty">
                        {allStock.length === 0
                          ? 'ยังไม่มีสต๊อก — กด ➕ เพิ่มสต๊อก เพื่อกำหนดสต๊อกครั้งแรก'
                          : 'ไม่พบสินค้าที่ค้นหา'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ── History view ── */}
        {stockSubView === 'history' && (
          <div className="stk__table-wrap">
            {histLoading ? (
              <div className="stk__skel-wrap">
                {[1,2,3,4,5].map((n) => <div key={n} className="stk__skel-row" />)}
              </div>
            ) : (
              <table className="stk__table">
                <thead>
                  <tr>
                    <th>วันที่</th>
                    <th>สินค้า</th>
                    <th>สาขา</th>
                    <th>ประเภท</th>
                    <th>ก่อน</th>
                    <th>เปลี่ยน</th>
                    <th>หลัง</th>
                    <th>หมายเหตุ</th>
                  </tr>
                </thead>
                <tbody>
                  {stockHistory.map((tx) => (
                    <tr key={tx.id}>
                      <td className="stk__td-date">
                        {new Date(tx.created_at).toLocaleString('th-TH', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td>
                        <div className="stk__product-name">{tx.product_name}</div>
                        {tx.sku && <div className="stk__product-sku">{tx.sku}</div>}
                      </td>
                      <td>{tx.branch_name}</td>
                      <td>
                        <span className={`stk__type-badge stk__type-badge--${tx.type}`}>
                          {TX_TYPE_LABELS[tx.type] ?? tx.type}
                        </span>
                      </td>
                      <td className="stk__td-center stk__muted">{tx.qty_before}</td>
                      <td className="stk__td-center">
                        <span className={tx.qty_change >= 0 ? 'stk__change--pos' : 'stk__change--neg'}>
                          {tx.qty_change >= 0 ? '+' : ''}{tx.qty_change}
                        </span>
                      </td>
                      <td className="stk__td-center stk__bold">{tx.qty_after}</td>
                      <td className="stk__muted">{tx.note || '—'}</td>
                    </tr>
                  ))}
                  {stockHistory.length === 0 && !histLoading && (
                    <tr><td colSpan={8} className="stk__empty">ยังไม่มีประวัติ — ลองเลือกช่วงวันที่แล้วกด 🔍 ค้นหา</td></tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* ── Stock edit modal ── */}
      {stockEditModal && (
        <div className="stk__modal-overlay" onClick={() => setStockEditModal(null)}>
          <div className="stk__modal" onClick={(e) => e.stopPropagation()}>
            <div className="stk__modal-header">
              <h3 className="stk__modal-title">
                {stockEditMode === 'add' ? '➕ เพิ่มสต๊อก' : stockEditMode === 'remove' ? '➖ ลบสต๊อก' : '✏️ ตั้งค่าสต๊อก'}
              </h3>
              <button type="button" className="stk__modal-close" onClick={() => setStockEditModal(null)}>×</button>
            </div>
            <p className="stk__modal-meta">{stockEditModal.product_name} · {stockEditModal.branch_name}</p>
            <div className="stk__modal-body">
              {stockEditMode !== 'set' && (
                <p className="stk__modal-current">คงเหลือปัจจุบัน: <strong>{stockEditModal.quantity} {stockEditModal.unit}</strong></p>
              )}
              <label className="stk__form-label">
                {stockEditMode === 'add' ? `จำนวนที่จะเพิ่ม (${stockEditModal.unit})` : stockEditMode === 'remove' ? `จำนวนที่จะลบออก (${stockEditModal.unit})` : `จำนวนสต๊อก (${stockEditModal.unit})`}
              </label>
              <input type="number" min="0" value={stockEditQty} onChange={(e) => setStockEditQty(e.target.value)} className="input-field" autoFocus />
              {stockEditMode === 'set' && (
                <>
                  <label className="stk__form-label">แจ้งเตือนเมื่อเหลือไม่เกิน</label>
                  <input type="number" min="0" value={stockEditMin} onChange={(e) => setStockEditMin(e.target.value)} className="input-field" />
                </>
              )}
              <div className="stk__modal-actions">
                <button type="button" onClick={() => setStockEditModal(null)} className="btn-secondary">ยกเลิก</button>
                <button type="button" onClick={saveStockModal} disabled={stockSaving} className="btn-primary">
                  {stockSaving ? 'กำลังบันทึก...' : '💾 บันทึก'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Add-stock modal ── */}
      {addStockOpen && (
        <div className="stk__modal-overlay" onClick={() => setAddStockOpen(false)}>
          <div className="stk__modal" onClick={(e) => e.stopPropagation()}>
            <div className="stk__modal-header">
              <h3 className="stk__modal-title">➕ เพิ่ม / กำหนดสต๊อก</h3>
              <button type="button" className="stk__modal-close" onClick={() => setAddStockOpen(false)}>×</button>
            </div>
            <p className="stk__modal-meta">เลือกสินค้าและสาขา แล้วกำหนดจำนวนสต๊อก</p>
            {addStockError && <p className="stk__modal-error">{addStockError}</p>}
            <div className="stk__modal-body">
              <label className="stk__form-label">สินค้า <span className="stk__required">*</span></label>
              <select value={addStockProductId} onChange={(e) => setAddStockProductId(e.target.value)} className="input-field">
                <option value="">— เลือกสินค้า —</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}{p.sku ? ` (${p.sku})` : ''} [{p.unit}]</option>
                ))}
              </select>
              <label className="stk__form-label">สาขา <span className="stk__required">*</span></label>
              <select value={addStockBranchId} onChange={(e) => setAddStockBranchId(e.target.value)} className="input-field">
                <option value="">— เลือกสาขา —</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <label className="stk__form-label">จำนวนสต๊อก</label>
              <input type="number" min="0" value={addStockQty} onChange={(e) => setAddStockQty(e.target.value)} className="input-field" placeholder="0" />
              <label className="stk__form-label">แจ้งเตือนเมื่อเหลือไม่เกิน (min qty)</label>
              <input type="number" min="0" value={addStockMin} onChange={(e) => setAddStockMin(e.target.value)} className="input-field" placeholder="5" />
              <div className="stk__modal-actions">
                <button type="button" onClick={() => setAddStockOpen(false)} className="btn-secondary">ยกเลิก</button>
                <button
                  type="button"
                  onClick={saveAddStock}
                  disabled={addStockSaving || !addStockProductId || !addStockBranchId}
                  className="btn-primary"
                >
                  {addStockSaving ? 'กำลังบันทึก...' : '💾 บันทึกสต๊อก'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
