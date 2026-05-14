'use client';

import { useEffect, useState, useCallback, useMemo, Suspense } from 'react';
import { toast } from 'sonner';
import Link from 'next/link';
import { QRCodeSVG } from 'qrcode.react';
import { fetchWithAuth } from '@/lib/supabase';
import { AuthHeader } from '@/components/layout/AuthHeader';
import { GoToPOSLink } from '@/components/GoToPOSLink';
import '@/styles/pages/stock.css';
import '@/styles/pages/consumables.css';
import { API_URL } from '@/lib/config';
import {
  Shop, Branch, Product, AllStockRow, StockTxRow, ShopUnit, ProductStock, TX_LABELS,
} from '@/components/stock/stock-types';
import { EditStockModal }    from '@/components/stock/EditStockModal';
import { TransferModal }     from '@/components/stock/TransferModal';
import { ConfirmDeleteModal } from '@/components/stock/ConfirmDeleteModal';
import { NewProductModal }   from '@/components/stock/NewProductModal';
import { AddStockModal }     from '@/components/stock/AddStockModal';
import { ConsumablesTab }    from '@/components/stock/ConsumablesTab';

/* ═══════════════════════════════════════════════════════ */
function StockPageInner() {
  const [shops, setShops]       = useState<Shop[]>([]);
  const [shopId, setShopId]     = useState<string | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [allStock, setAllStock] = useState<AllStockRow[]>([]);
  const [shopUnits, setShopUnits] = useState<ShopUnit[]>([]);
  const [loading, setLoading]   = useState(true);
  const [stockLoading, setStockLoading] = useState(false);

  /* view / filter */
  const [view, setView]               = useState<'stock' | 'history' | 'consumables'>('stock');
  const [search, setSearch]           = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [catFilter, setCatFilter]     = useState('');
  const [showUnits, setShowUnits]     = useState(false);

  /* add-stock modal */
  const [addOpen, setAddOpen]         = useState(false);
  const [addProductId, setAddProductId] = useState('');
  const [addBranchId, setAddBranchId] = useState('');
  const [addQty, setAddQty]           = useState('0');
  const [addMin, setAddMin]           = useState('5');
  const [addSaving, setAddSaving]     = useState(false);
  const [addError, setAddError]       = useState<string | null>(null);

  /* new product modal */
  const [newProdOpen, setNewProdOpen]         = useState(false);
  const [newProdName, setNewProdName]         = useState('');
  const [newProdPrice, setNewProdPrice]       = useState('');
  const [newProdUnit, setNewProdUnit]         = useState('อัน');
  const [newProdSku, setNewProdSku]           = useState('');
  const [newProdCat, setNewProdCat]           = useState('');
  const [newProdQty, setNewProdQty]           = useState<Record<string, string>>({});
  const [newProdSaving, setNewProdSaving]     = useState(false);
  const [newProdError, setNewProdError]       = useState<string | null>(null);
  const [newProdShowOnPos, setNewProdShowOnPos] = useState(true);

  /* edit modal */
  const [editModal, setEditModal] = useState<{ product_id: string; product_name: string; unit: string; rows: AllStockRow[] } | null>(null);
  const [editQtyMap, setEditQtyMap] = useState<Record<string, string>>({});
  const [editMinMap, setEditMinMap] = useState<Record<string, string>>({});
  const [editUnit, setEditUnit]     = useState('');
  const [editSaving, setEditSaving] = useState(false);

  /* history */
  const [history, setHistory]     = useState<StockTxRow[]>([]);
  const [histLoading, setHistLoading] = useState(false);
  const [histBranch, setHistBranch] = useState('');
  const [histFrom, setHistFrom]   = useState('');
  const [histTo, setHistTo]       = useState('');

  /* confirm delete */
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);

  /* alert expand (warn / low KPI cards) */
  const [alertExpand, setAlertExpand] = useState<'warn' | 'low' | null>(null);

  /* units */
  const [newUnit, setNewUnit]     = useState('');
  const [unitSaving, setUnitSaving] = useState(false);

  /* withdrawal QR modal */
  const [wdQrOpen, setWdQrOpen]         = useState(false);
  const [wdQrBranch, setWdQrBranch]     = useState<string>('');

  /* transfer modal */
  const [transferOpen, setTransferOpen]           = useState(false);
  const [transferProductId, setTransferProductId] = useState('');
  const [transferFromId, setTransferFromId]       = useState('');
  const [transferToId, setTransferToId]           = useState('');
  const [transferQty, setTransferQty]             = useState('1');
  const [transferNote, setTransferNote]           = useState('');
  const [transferSaving, setTransferSaving]       = useState(false);
  const [transferError, setTransferError]         = useState<string | null>(null);
  const [transferSuccess, setTransferSuccess]     = useState<string | null>(null);

  /* ── Init ── */
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
    async function loadShopData() {
      const [brRes, prRes, unitRes] = await Promise.all([
        fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/branches`),
        fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/products`),
        fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/units`),
      ]);
      if (brRes.ok)   { const j = await brRes.json();   setBranches(j.data ?? []); }
      if (prRes.ok)   { const j = await prRes.json();   setProducts(j.data ?? []); }
      if (unitRes.ok) { const j = await unitRes.json(); setShopUnits(j.data ?? []); }
      if (shopId) fetchStock(shopId);
    }
    void loadShopData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId]);

  async function fetchStock(sid: string) {
    setStockLoading(true);
    const res = await fetchWithAuth(`${API_URL}/api/v1/shops/${sid}/stock`);
    if (res.ok) { const j = await res.json(); setAllStock(j.data ?? []); }
    setStockLoading(false);
  }

  /* ── History ── */
  const loadHistory = useCallback(async () => {
    if (!shopId) return;
    setHistLoading(true);
    const p = new URLSearchParams({ limit: '200' });
    if (histBranch) p.set('branchId', histBranch);
    if (histFrom)   p.set('fromDate', histFrom);
    if (histTo)     p.set('toDate', histTo);
    const res = await fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/stock/transactions?${p}`);
    if (res.ok) { const j = await res.json(); setHistory(j.data ?? []); }
    setHistLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId, histBranch, histFrom, histTo]);

  useEffect(() => { if (view === 'history') loadHistory(); }, [view, loadHistory]);

  /* ── Derived data ── */
  const productStocks = useMemo((): ProductStock[] => {
    const map: Record<string, ProductStock> = {};
    allStock.forEach(row => {
      if (!map[row.product_id]) {
        map[row.product_id] = { product_id: row.product_id, product_name: row.product_name,
          sku: row.sku, unit: row.unit, category: row.category, image_url: row.image_url,
          show_on_pos: row.show_on_pos,
          branches: [], totalQty: 0, isLow: false, isWarn: false };
      }
      map[row.product_id].branches.push(row);
      map[row.product_id].totalQty += row.quantity;
      if (row.quantity <= row.min_qty) map[row.product_id].isLow = true;
      else if (row.quantity <= row.min_qty * 2) map[row.product_id].isWarn = true;
    });
    return Object.values(map);
  }, [allStock]);

  const filtered = useMemo(() => {
    return productStocks
      .filter(p => {
        const mSearch  = !search    || p.product_name.toLowerCase().includes(search.toLowerCase()) || (p.sku ?? '').toLowerCase().includes(search.toLowerCase());
        const mCat     = !catFilter || p.category === catFilter;
        const mBranch  = !branchFilter || p.branches.some(b => b.branch_id === branchFilter);
        return mSearch && mCat && mBranch;
      })
      .map(p => ({ ...p, branches: branchFilter ? p.branches.filter(b => b.branch_id === branchFilter) : p.branches }));
  }, [productStocks, search, catFilter, branchFilter]);

  const categories = useMemo(() => [...new Set(allStock.map(r => r.category).filter(Boolean) as string[])], [allStock]);

  /* Stock scoped to branch filter for KPI calculations */
  const kpiStock = useMemo(
    () => branchFilter ? allStock.filter(r => r.branch_id === branchFilter) : allStock,
    [allStock, branchFilter],
  );

  const kpi = useMemo(() => ({
    skus:  new Set(kpiStock.map(r => r.product_id)).size,
    total: kpiStock.reduce((s, r) => s + r.quantity, 0),
    low:   kpiStock.filter(r => r.quantity <= r.min_qty).length,
    warn:  kpiStock.filter(r => r.quantity > r.min_qty && r.quantity <= r.min_qty * 2).length,
  }), [kpiStock]);

  const warnItems = useMemo(
    () => kpiStock.filter(r => r.quantity > r.min_qty && r.quantity <= r.min_qty * 2)
           .sort((a, b) => a.quantity - b.quantity),
    [kpiStock],
  );
  const lowItems = useMemo(
    () => kpiStock.filter(r => r.quantity <= r.min_qty)
           .sort((a, b) => a.quantity - b.quantity),
    [kpiStock],
  );

  /* ── Actions ── */
  function openEdit(ps: ProductStock) {
    const rows = allStock.filter(r => r.product_id === ps.product_id);
    const qm: Record<string, string> = {};
    const mm: Record<string, string> = {};
    rows.forEach(r => { qm[r.branch_id] = String(r.quantity); mm[r.branch_id] = String(r.min_qty); });
    setEditQtyMap(qm); setEditMinMap(mm); setEditUnit(ps.unit);
    setEditModal({ product_id: ps.product_id, product_name: ps.product_name, unit: ps.unit, rows });
  }

  async function deleteProduct(productId: string) {
    if (!shopId) return;
    const res = await fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/products/${productId}`, {
      method: 'DELETE',
    });
    setConfirmDelete(null);
    if (res.ok) {
      toast.success('ลบสินค้าเรียบร้อยแล้ว');
      fetchStock(shopId);
    } else {
      const json = await res.json().catch(() => ({})) as { error?: { message?: string } };
      toast.error(json?.error?.message ?? 'ลบสินค้าไม่สำเร็จ');
    }
  }

  async function saveNewProduct() {
    if (!shopId) return;
    if (!newProdName.trim()) { setNewProdError('กรุณากรอกชื่อสินค้า'); return; }
    if (newProdShowOnPos && (!newProdPrice || isNaN(Number(newProdPrice)) || Number(newProdPrice) < 0)) { setNewProdError('กรุณากรอกราคาขายที่ถูกต้อง'); return; }
    setNewProdError(null); setNewProdSaving(true);

    const res = await fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name:        newProdName.trim(),
        price:       newProdPrice ? String(Number(newProdPrice).toFixed(2)) : undefined,
        unit:        newProdUnit.trim() || 'อัน',
        sku:         newProdSku.trim() || undefined,
        category:    newProdCat.trim() || undefined,
        show_on_pos: newProdShowOnPos,
      }),
    });

    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setNewProdError(j.error?.message ?? 'สร้างสินค้าไม่สำเร็จ');
      setNewProdSaving(false);
      return;
    }

    const { data: product } = await res.json();
    // Set initial stock per branch
    const stockPs = branches
      .map(b => {
        const qty = parseInt(newProdQty[b.id] ?? '', 10);
        if (isNaN(qty) || qty <= 0) return null;
        return fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/branches/${b.id}/products/${product.id}/stock`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ quantity: qty }),
        });
      })
      .filter(Boolean) as Promise<Response>[];
    await Promise.all(stockPs);

    setNewProdSaving(false);
    setNewProdOpen(false);
    setNewProdName(''); setNewProdPrice(''); setNewProdUnit('อัน');
    setNewProdSku(''); setNewProdCat(''); setNewProdQty({}); setNewProdShowOnPos(true);
    toast.success(newProdShowOnPos ? 'เพิ่มสินค้าใหม่เรียบร้อยแล้ว' : 'เพิ่มสินค้าสต็อกภายในเรียบร้อยแล้ว');
    fetchStock(shopId);
  }

  async function saveEdit() {
    if (!editModal || !shopId) return;
    setEditSaving(true);
    const ps: Promise<Response>[] = [];

    // Update unit if changed
    const trimmedUnit = editUnit.trim();
    if (trimmedUnit && trimmedUnit !== editModal.unit) {
      ps.push(fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/products/${editModal.product_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unit: trimmedUnit }),
      }));
    }

    // Update stock per branch
    editModal.rows.forEach(row => {
      const qty = parseInt(editQtyMap[row.branch_id] ?? '', 10);
      const min = parseInt(editMinMap[row.branch_id] ?? '', 10);
      if (!isNaN(qty) && qty >= 0)
        ps.push(fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/branches/${row.branch_id}/products/${row.product_id}/stock`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quantity: qty }) }));
      if (!isNaN(min) && min >= 0)
        ps.push(fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/stock/min-qty`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ branch_id: row.branch_id, product_id: row.product_id, min_qty: min }) }));
    });
    await Promise.all(ps);
    setEditSaving(false); setEditModal(null);
    toast.success('บันทึกสต๊อกเรียบร้อยแล้ว');
    fetchStock(shopId);
  }

  async function saveAdd() {
    if (!addProductId || !addBranchId || !shopId) { setAddError('กรุณาเลือกสินค้าและสาขา'); return; }
    setAddError(null); setAddSaving(true);
    const qty = parseInt(addQty, 10);
    const min = parseInt(addMin, 10);
    const ps: Promise<Response>[] = [];
    if (!isNaN(qty) && qty >= 0)
      ps.push(fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/branches/${addBranchId}/products/${addProductId}/stock`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quantity: qty }) }));
    if (!isNaN(min) && min >= 0)
      ps.push(fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/stock/min-qty`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ branch_id: addBranchId, product_id: addProductId, min_qty: min }) }));
    await Promise.all(ps);
    setAddSaving(false); setAddOpen(false);
    setAddProductId(''); setAddBranchId(''); setAddQty('0'); setAddMin('5');
    toast.success('บันทึกสต๊อกเรียบร้อยแล้ว');
    fetchStock(shopId);
  }

  async function addUnit() {
    if (!newUnit.trim() || !shopId) return;
    setUnitSaving(true);
    const res = await fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/units`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newUnit.trim() }) });
    if (res.ok) { const j = await res.json(); setShopUnits(p => [...p, j.data]); setNewUnit(''); }
    setUnitSaving(false);
  }

  async function deleteUnit(id: string) {
    if (!shopId) return;
    const res = await fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/units/${id}`, { method: 'DELETE' });
    if (res.ok) setShopUnits(p => p.filter(u => u.id !== id));
  }

  async function saveTransfer() {
    if (!transferProductId || !transferFromId || !transferToId || !shopId) {
      setTransferError('กรุณาเลือกสินค้า สาขาต้นทาง และสาขาปลายทาง'); return;
    }
    if (transferFromId === transferToId) {
      setTransferError('สาขาต้นทางและปลายทางต้องเป็นคนละสาขา'); return;
    }
    const qty = parseInt(transferQty, 10);
    if (isNaN(qty) || qty < 1) { setTransferError('จำนวนต้องมากกว่า 0'); return; }

    setTransferError(null); setTransferSuccess(null); setTransferSaving(true);

    const res = await fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/stock/transfer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from_branch_id: transferFromId,
        to_branch_id:   transferToId,
        product_id:     transferProductId,
        quantity:       qty,
        note:           transferNote.trim() || undefined,
      }),
    });

    const j = await res.json().catch(() => ({}));
    setTransferSaving(false);
    if (!res.ok) {
      toast.error(j.error?.message ?? 'โอนสต๊อกไม่สำเร็จ');
      setTransferError(j.error?.message ?? 'โอนสต๊อกไม่สำเร็จ');
    } else {
      toast.success('โอนสต๊อกสำเร็จ');
      setTransferQty('1'); setTransferNote('');
      fetchStock(shopId);
      setTimeout(() => { setTransferOpen(false); setTransferSuccess(null); }, 800);
    }
  }

  /* ═══ RENDER ═══ */
  if (loading) return (
    <main className="inv__page">
      <div className="inv__header-wrap"><AuthHeader title="จัดการสต๊อก" /></div>
      <div className="inv__loading"><span className="inv__loading-dot" />กำลังโหลด...</div>
    </main>
  );

  return (
    <main className="inv__page">
      <div className="inv__header-wrap"><AuthHeader title="จัดการสต๊อก" /></div>

      <div className="inv__body">

        {/* ─── TOPBAR ─────────────────────────────────────── */}
        <div className="inv__topbar">
          <div className="inv__topbar-left">
            <h1 className="inv__page-title">📦 สต๊อกสินค้า</h1>
            {shops.length > 1 && (
              <select value={shopId ?? ''} onChange={e => setShopId(e.target.value || null)} className="inv__shop-select">
                {shops.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
            {shops.length === 1 && <span className="inv__shop-name">{shops[0].name}</span>}
          </div>
          <div className="inv__topbar-right">
            <button type="button" onClick={() => setShowUnits(v => !v)} className={`inv__btn-ghost${showUnits ? ' inv__btn-ghost--active' : ''}`}>
              🔧 หน่วยนับ
            </button>
            <button type="button" onClick={() => window.print()} className="inv__btn-ghost">🖨 พิมพ์</button>
            <button
              type="button"
              className="inv__btn-transfer"
              onClick={() => { setTransferError(null); setTransferSuccess(null); setTransferProductId(''); setTransferFromId(branches[0]?.id ?? ''); setTransferToId(branches[1]?.id ?? ''); setTransferQty('1'); setTransferNote(''); setTransferOpen(true); }}
            >
              🔄 โอนสต๊อก
            </button>
            <button
              type="button"
              className="inv__btn-ghost"
              onClick={() => { setNewProdError(null); setNewProdName(''); setNewProdPrice('0'); setNewProdUnit(shopUnits[0]?.name ?? 'อัน'); setNewProdSku(''); setNewProdCat(''); setNewProdQty({}); setNewProdShowOnPos(false); setNewProdOpen(true); }}
            >
              🗃️ สต็อกสินค้าภายใน
            </button>
            <button
              type="button"
              className="inv__btn-ghost"
              onClick={() => { setWdQrBranch(branches[0]?.id ?? ''); setWdQrOpen(true); }}
            >
              📱 QR เบิกสต๊อก
            </button>
            <GoToPOSLink className="inv__btn-ghost">🛒 ไปหน้า POS</GoToPOSLink>
            <button
              type="button"
              className="inv__btn-primary"
              onClick={() => { setNewProdError(null); setNewProdName(''); setNewProdPrice(''); setNewProdUnit(shopUnits[0]?.name ?? 'อัน'); setNewProdSku(''); setNewProdCat(''); setNewProdQty({}); setNewProdShowOnPos(true); setNewProdOpen(true); }}
            >
              ➕ เพิ่มสินค้าใหม่
            </button>
          </div>
        </div>

        {/* ─── KPI CARDS ───────────────────────────────────── */}
        <div className="inv__kpi-row">
          <div className="inv__kpi-card">
            <div className="inv__kpi-icon inv__kpi-icon--blue">📦</div>
            <div className="inv__kpi-body">
              <p className="inv__kpi-label">SKU ทั้งหมด</p>
              <p className="inv__kpi-val">{kpi.skus}</p>
              <p className="inv__kpi-sub">
                {branchFilter ? (branches.find(b => b.id === branchFilter)?.name ?? 'สาขาที่เลือก') : 'ทุกสาขา'}
              </p>
            </div>
          </div>
          <div className="inv__kpi-card">
            <div className="inv__kpi-icon inv__kpi-icon--teal">📊</div>
            <div className="inv__kpi-body">
              <p className="inv__kpi-label">จำนวนรวม</p>
              <p className="inv__kpi-val">{kpi.total.toLocaleString('th-TH')}</p>
              <p className="inv__kpi-sub">
                {branchFilter ? (branches.find(b => b.id === branchFilter)?.name ?? 'สาขาที่เลือก') : 'ทุกสาขา'}
              </p>
            </div>
          </div>
          <div
            className={`inv__kpi-card inv__kpi-card--warn${kpi.warn > 0 ? ' inv__kpi-card--clickable' : ''}${alertExpand === 'warn' ? ' inv__kpi-card--active' : ''}`}
            onClick={() => kpi.warn > 0 && setAlertExpand(v => v === 'warn' ? null : 'warn')}
            role={kpi.warn > 0 ? 'button' : undefined}
            aria-expanded={alertExpand === 'warn'}
          >
            <div className="inv__kpi-icon inv__kpi-icon--amber">⚠️</div>
            <div className="inv__kpi-body">
              <p className="inv__kpi-label">ใกล้หมด</p>
              <p className="inv__kpi-val inv__kpi-val--amber">{kpi.warn}</p>
              <p className="inv__kpi-sub">{kpi.warn > 0 ? (alertExpand === 'warn' ? '▲ ซ่อนรายการ' : '▼ ดูรายการ') : 'ระวังเติมสต๊อก'}</p>
            </div>
          </div>
          <div
            className={`inv__kpi-card inv__kpi-card--danger${kpi.low > 0 ? ' inv__kpi-card--clickable' : ''}${alertExpand === 'low' ? ' inv__kpi-card--active' : ''}`}
            onClick={() => kpi.low > 0 && setAlertExpand(v => v === 'low' ? null : 'low')}
            role={kpi.low > 0 ? 'button' : undefined}
            aria-expanded={alertExpand === 'low'}
          >
            <div className="inv__kpi-icon inv__kpi-icon--red">🔴</div>
            <div className="inv__kpi-body">
              <p className="inv__kpi-label">สินค้าหมด</p>
              <p className="inv__kpi-val inv__kpi-val--red">{kpi.low}</p>
              <p className="inv__kpi-sub">{kpi.low > 0 ? (alertExpand === 'low' ? '▲ ซ่อนรายการ' : '▼ ดูรายการ') : 'ต้องเติมด่วน'}</p>
            </div>
          </div>
        </div>

        {/* ─── ALERT PANELS ────────────────────────────────────── */}
        {alertExpand === 'warn' && warnItems.length > 0 && (
          <div className="inv__alert-panel inv__alert-panel--warn">
            <div className="inv__alert-header">
              <p className="inv__alert-heading">⚠️ รายการใกล้หมด ({warnItems.length} รายการ)</p>
              <button type="button" className="inv__alert-close" onClick={() => setAlertExpand(null)}>✕ ปิด</button>
            </div>
            <div className="inv__alert-list">
              {warnItems.map(r => (
                <div key={`${r.product_id}-${r.branch_id}`} className="inv__alert-row">
                  <span className="inv__alert-icon">⚠️</span>
                  <span className="inv__alert-product">{r.product_name}</span>
                  <span className="inv__alert-branch">📍 {r.branch_name}</span>
                  <span className="inv__alert-qty inv__alert-qty--warn">{r.quantity} / {r.min_qty}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {alertExpand === 'low' && lowItems.length > 0 && (
          <div className="inv__alert-panel inv__alert-panel--low">
            <div className="inv__alert-header">
              <p className="inv__alert-heading">🔴 สินค้าหมด ({lowItems.length} รายการ)</p>
              <button type="button" className="inv__alert-close" onClick={() => setAlertExpand(null)}>✕ ปิด</button>
            </div>
            <div className="inv__alert-list">
              {lowItems.map(r => (
                <div key={`${r.product_id}-${r.branch_id}`} className="inv__alert-row">
                  <span className="inv__alert-icon">🔴</span>
                  <span className="inv__alert-product">{r.product_name}</span>
                  <span className="inv__alert-branch">📍 {r.branch_name}</span>
                  <span className="inv__alert-qty inv__alert-qty--low">{r.quantity} / {r.min_qty}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ─── UNIT PANEL (collapsible) ─────────────────────── */}
        {showUnits && (
          <div className="inv__unit-panel">
            <p className="inv__unit-heading">🔧 จัดการหน่วยนับ</p>
            <div className="inv__unit-row">
              <input
                placeholder="ชื่อหน่วยใหม่ เช่น โหล, ลัง"
                value={newUnit}
                onChange={e => setNewUnit(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addUnit()}
                className="inv__unit-input"
              />
              <button type="button" onClick={addUnit} disabled={unitSaving || !newUnit.trim()} className="inv__btn-primary">
                {unitSaving ? '...' : '+ เพิ่ม'}
              </button>
            </div>
            <div className="inv__unit-tags">
              {shopUnits.map(u => (
                <span key={u.id} className="inv__unit-tag">
                  {u.name}
                  <button type="button" onClick={() => deleteUnit(u.id)} className="inv__unit-del">×</button>
                </span>
              ))}
              {shopUnits.length === 0 && <span className="inv__unit-empty">ยังไม่มีหน่วยกำหนดเอง</span>}
            </div>
          </div>
        )}

        {/* ─── TOOLBAR (tabs + filters) ─────────────────────── */}
        <div className="inv__toolbar">
          <div className="inv__tabs">
            <button type="button" className={`inv__tab${view === 'stock' ? ' inv__tab--active' : ''}`} onClick={() => setView('stock')}>
              📦 สต๊อกสินค้า
            </button>
            <button type="button" className={`inv__tab${view === 'history' ? ' inv__tab--active' : ''}`} onClick={() => setView('history')}>
              📋 ประวัติการเปลี่ยนแปลง
            </button>
            <button type="button" className={`inv__tab${view === 'consumables' ? ' inv__tab--active' : ''}`} onClick={() => setView('consumables')}>
              🧴 วัตถุดิบ &amp; BOM
            </button>
          </div>

          {view === 'stock' && (
            <div className="inv__filters">
              <input
                placeholder="🔍 ค้นหาสินค้า / SKU..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="inv__search"
              />
              <select value={catFilter} onChange={e => setCatFilter(e.target.value)} className="inv__filter-sel">
                <option value="">ทุกหมวด</option>
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <select value={branchFilter} onChange={e => setBranchFilter(e.target.value)} className="inv__filter-sel">
                <option value="">ทุกสาขา</option>
                {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          )}

          {view === 'history' && (
            <div className="inv__filters">
              <select value={histBranch} onChange={e => setHistBranch(e.target.value)} className="inv__filter-sel">
                <option value="">ทุกสาขา</option>
                {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <input type="date" value={histFrom} onChange={e => setHistFrom(e.target.value)} className="inv__date-input" />
              <span className="inv__sep">—</span>
              <input type="date" value={histTo} onChange={e => setHistTo(e.target.value)} className="inv__date-input" />
              <button type="button" onClick={loadHistory} className="inv__btn-primary">🔍 ค้นหา</button>
            </div>
          )}
        </div>

        {/* ─── STOCK LIST ───────────────────────────────────── */}
        {view === 'stock' && (
          <div className="inv__list">
            {stockLoading ? (
              <div className="inv__skels">
                {[1,2,3,4,5].map(n => <div key={n} className="inv__skel" />)}
              </div>
            ) : filtered.length === 0 ? (
              <div className="inv__empty">
                <div className="inv__empty-icon">📦</div>
                <p className="inv__empty-title">ไม่พบสินค้า</p>
                <p className="inv__empty-sub">
                  {allStock.length === 0 ? 'กด ➕ เพิ่มสต๊อก เพื่อเริ่มต้น' : 'ลองเปลี่ยนตัวกรองการค้นหา'}
                </p>
              </div>
            ) : (
              filtered.map(ps => {
                const statusClass = ps.isLow ? ' inv__card--low' : ps.isWarn ? ' inv__card--warn' : '';
                return (
                  <div key={ps.product_id} className={`inv__card${statusClass}`}>
                    {/* Status strip */}
                    {(ps.isLow || ps.isWarn) && (
                      <div className={`inv__card-strip${ps.isLow ? ' inv__card-strip--low' : ' inv__card-strip--warn'}`} />
                    )}

                    {/* Product info */}
                    <div className="inv__card-product">
                      {ps.image_url
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={ps.image_url} alt={ps.product_name} className="inv__card-img" />
                        : <div className="inv__card-img inv__card-img--empty"><span>📦</span></div>}
                      <div className="inv__card-meta">
                        <p className="inv__card-name">{ps.product_name}</p>
                        <div className="inv__card-tags">
                          {ps.sku     && <span className="inv__tag inv__tag--sku">{ps.sku}</span>}
                          {ps.category && <span className="inv__tag inv__tag--cat">{ps.category}</span>}
                          <span className="inv__tag inv__tag--unit">{ps.unit}</span>
                          {!ps.show_on_pos && <span className="inv__tag inv__tag--hidden">🗃️ ภายใน</span>}
                        </div>
                      </div>
                    </div>

                    {/* Branch stocks */}
                    <div className="inv__card-branches">
                      {ps.branches.map(b => {
                        const low  = b.quantity <= b.min_qty;
                        const warn = !low && b.quantity <= b.min_qty * 2;
                        return (
                          <div key={b.branch_id} className="inv__branch-chip">
                            <span className="inv__chip-branch">{b.branch_name}</span>
                            <span className={`inv__chip-qty${low ? ' inv__chip-qty--low' : warn ? ' inv__chip-qty--warn' : ' inv__chip-qty--ok'}`}>
                              {b.quantity}
                            </span>
                            <span className="inv__chip-min">/{b.min_qty}</span>
                          </div>
                        );
                      })}
                      {ps.branches.length === 0 && <span className="inv__no-branch">ยังไม่มีสต๊อก</span>}
                    </div>

                    {/* Actions */}
                    <div className="inv__card-actions">
                      <span className="inv__card-total">{ps.totalQty.toLocaleString('th-TH')}</span>
                      <button type="button" className="inv__card-edit-btn" onClick={() => openEdit(ps)}>✏️ แก้ไข</button>
                      <button type="button" className="inv__card-edit-btn inv__card-edit-btn--del" onClick={() => setConfirmDelete({ id: ps.product_id, name: ps.product_name })}>🗑️ ลบ</button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* ─── HISTORY ──────────────────────────────────────── */}
        {view === 'history' && (
          <div className="inv__hist-wrap">
            {histLoading ? (
              <div className="inv__skels">
                {[1,2,3,4,5,6].map(n => <div key={n} className="inv__skel" />)}
              </div>
            ) : history.length === 0 ? (
              <div className="inv__empty">
                <div className="inv__empty-icon">📋</div>
                <p className="inv__empty-title">ยังไม่มีประวัติ</p>
                <p className="inv__empty-sub">เลือกช่วงวันที่แล้วกด 🔍 ค้นหา</p>
              </div>
            ) : (
              <div className="inv__hist-table-wrap">
                <table className="inv__hist-table">
                  <thead>
                    <tr>
                      <th>วันที่ / เวลา</th>
                      <th>สินค้า</th>
                      <th>สาขา</th>
                      <th>ประเภท</th>
                      <th className="inv__th-num">ก่อน</th>
                      <th className="inv__th-num">เปลี่ยน</th>
                      <th className="inv__th-num">หลัง</th>
                      <th>หมายเหตุ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map(tx => (
                      <tr key={tx.id}>
                        <td className="inv__hist-date">
                          {new Date(tx.created_at).toLocaleString('th-TH', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td>
                          <p className="inv__hist-name">{tx.product_name}</p>
                          {tx.sku && <p className="inv__hist-sku">{tx.sku}</p>}
                        </td>
                        <td>{tx.branch_name}</td>
                        <td>
                          <span className={`inv__type inv__type--${tx.type}`}>
                            {TX_LABELS[tx.type] ?? tx.type}
                          </span>
                        </td>
                        <td className="inv__td-num">{tx.qty_before}</td>
                        <td className="inv__td-num">
                          <span className={tx.qty_change >= 0 ? 'inv__chg--pos' : 'inv__chg--neg'}>
                            {tx.qty_change >= 0 ? '+' : ''}{tx.qty_change}
                          </span>
                        </td>
                        <td className="inv__td-num inv__td-bold">{tx.qty_after}</td>
                        <td className="inv__hist-note">{tx.note || <span className="inv__muted">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ─── CONSUMABLES & BOM TAB ───────────────────────── */}
        {view === 'consumables' && shopId && (
          <ConsumablesTab shopId={shopId} products={products} />
        )}

        {/* ─── FOOTER LINKS ────────────────────────────────── */}
        <div className="inv__footer">
          <Link href="/admin" className="inv__footer-link">← จัดการร้าน</Link>
          <Link href="/dashboard" className="inv__footer-link">แดชบอร์ด</Link>
        </div>
      </div>

      {/* ═══ MODALS ═══════════════════════════════════════ */}
      <EditStockModal
        editModal={editModal}
        editQtyMap={editQtyMap}
        editMinMap={editMinMap}
        editUnit={editUnit}
        setEditQtyMap={setEditQtyMap}
        setEditMinMap={setEditMinMap}
        setEditUnit={setEditUnit}
        editSaving={editSaving}
        shopUnits={shopUnits}
        onSave={saveEdit}
        onClose={() => setEditModal(null)}
      />

      <TransferModal
        open={transferOpen}
        branches={branches}
        products={products}
        transferProductId={transferProductId} setTransferProductId={setTransferProductId}
        transferFromId={transferFromId} setTransferFromId={setTransferFromId}
        transferToId={transferToId} setTransferToId={setTransferToId}
        transferQty={transferQty} setTransferQty={setTransferQty}
        transferNote={transferNote} setTransferNote={setTransferNote}
        transferSaving={transferSaving}
        transferError={transferError}
        transferSuccess={transferSuccess}
        onSave={saveTransfer}
        onClose={() => setTransferOpen(false)}
      />

      <ConfirmDeleteModal
        item={confirmDelete}
        onConfirm={deleteProduct}
        onClose={() => setConfirmDelete(null)}
      />

      <NewProductModal
        open={newProdOpen}
        branches={branches}
        categories={categories}
        shopUnits={shopUnits}
        newProdName={newProdName} setNewProdName={setNewProdName}
        newProdPrice={newProdPrice} setNewProdPrice={setNewProdPrice}
        newProdUnit={newProdUnit} setNewProdUnit={setNewProdUnit}
        newProdSku={newProdSku} setNewProdSku={setNewProdSku}
        newProdCat={newProdCat} setNewProdCat={setNewProdCat}
        newProdQty={newProdQty} setNewProdQty={setNewProdQty}
        newProdShowOnPos={newProdShowOnPos} setNewProdShowOnPos={setNewProdShowOnPos}
        newProdSaving={newProdSaving}
        newProdError={newProdError}
        onSave={saveNewProduct}
        onClose={() => setNewProdOpen(false)}
      />

      <AddStockModal
        open={addOpen}
        branches={branches}
        products={products}
        addProductId={addProductId} setAddProductId={setAddProductId}
        addBranchId={addBranchId} setAddBranchId={setAddBranchId}
        addQty={addQty} setAddQty={setAddQty}
        addMin={addMin} setAddMin={setAddMin}
        addSaving={addSaving}
        addError={addError}
        onSave={saveAdd}
        onClose={() => { setAddOpen(false); }}
      />

      {/* ─── QR เบิกสต๊อก Modal ───────────────────────── */}
      {wdQrOpen && shopId && (
        <div className="wdqr-overlay" onClick={() => setWdQrOpen(false)}>
          <div className="wdqr-modal" onClick={e => e.stopPropagation()}>
            <div className="wdqr-header">
              <h2 className="wdqr-title">📱 QR เบิกสต๊อก</h2>
              <button type="button" className="wdqr-close" onClick={() => setWdQrOpen(false)}>✕</button>
            </div>

            {/* Branch selector */}
            {branches.length > 1 && (
              <div>
                <label className="wdqr-branch-label">เลือกสาขา</label>
                <select
                  className="wdqr-select"
                  value={wdQrBranch}
                  onChange={e => setWdQrBranch(e.target.value)}
                >
                  {branches.map(b => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
            )}

            {/* QR Code */}
            {wdQrBranch && (() => {
              const qrUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/withdraw?shop=${shopId}&branch=${wdQrBranch}`;
              const branchName = branches.find(b => b.id === wdQrBranch)?.name ?? 'สาขา';
              return (
                <div className="wdqr-body">
                  <div className="wdqr-code-wrap">
                    <QRCodeSVG value={qrUrl} size={200} level="M" />
                  </div>
                  <p className="wdqr-meta">
                    สาขา: <strong>{branchName}</strong><br />
                    <span className="wdqr-url">{qrUrl}</span>
                  </p>
                  <p className="wdqr-hint">
                    พนักงานสแกนเพื่อเปิดฟอร์มเบิกสต๊อก<br />แคชเชียร์จะได้รับแจ้งเตือนและกดอนุมัติที่เครื่อง POS
                  </p>
                  <button
                    type="button"
                    className="wdqr-print-btn"
                    onClick={() => {
                      const win = window.open('', '_blank', 'width=400,height=500');
                      if (!win) return;
                      win.document.write(`
                        <!DOCTYPE html><html><head>
                        <title>QR เบิกสต๊อก — ${branchName}</title>
                        <style>body{margin:0;font-family:system-ui,sans-serif;background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;gap:1rem;padding:2rem}h2{margin:0;font-size:1.1rem}p{margin:0;font-size:0.8rem;color:#555;text-align:center}</style>
                        </head><body>
                        <h2>📱 QR เบิกสต๊อก</h2>
                        <p>สาขา: <strong>${branchName}</strong></p>
                        <div id="qr"></div>
                        <p style="font-size:0.7rem;color:#888;word-break:break-all">${qrUrl}</p>
                        <script src="https://cdn.jsdelivr.net/npm/qrcode/build/qrcode.min.js"></script>
                        <script>QRCode.toCanvas(document.createElement('canvas'),${JSON.stringify(qrUrl)},{width:220},function(err,canvas){if(!err)document.getElementById('qr').appendChild(canvas)});window.onload=function(){window.print()}</script>
                        </body></html>
                      `);
                      win.document.close();
                    }}
                  >
                    🖨 พิมพ์ QR
                  </button>
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </main>
  );
}

export default function StockPage() {
  return (
    <Suspense fallback={
      <main className="inv__page">
        <div className="inv__loading"><span className="inv__loading-dot" />กำลังโหลด...</div>
      </main>
    }>
      <StockPageInner />
    </Suspense>
  );
}
