'use client';

import { useEffect, useState, useCallback } from 'react';
import { fetchWithAuth } from '@/lib/supabase';
import { API_URL } from '@/lib/config';
import type { Product } from './stock-types';
import { UnitPickerModal } from './UnitPickerModal';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { toast as sonnerToast } from 'sonner';

/* ── Types ──────────────────────────────────────────────────────────── */
export interface Consumable {
  id:       string;
  name:     string;
  unit:     string;
  quantity: number;
  min_qty:  number;
}
export interface BomEntry {
  consumable_id:   string;
  consumable_name: string;
  unit:            string;
  qty_per_unit:    string;
}
// per-product BOM map: productId → BomEntry[]
type BomMap = Record<string, BomEntry[]>;

interface Props {
  shopId:   string;
  products: Product[];
}

/* ── Helpers ──────────────────────────────────────────────────────── */
function stockLevel(c: Consumable): 'ok' | 'warn' | 'low' {
  if (c.quantity <= 0) return 'low';
  if (c.quantity <= c.min_qty) return 'warn';
  return 'ok';
}
const LEVEL_ICON  = { ok: '', warn: '⚠️', low: '🔴' };
const LEVEL_CLASS = { ok: '', warn: 'csm-row--warn', low: 'csm-row--low' };

function groupByCategory(products: Product[]): Record<string, Product[]> {
  const map: Record<string, Product[]> = {};
  for (const p of products) {
    const cat = p.category || 'ไม่มีหมวดหมู่';
    if (!map[cat]) map[cat] = [];
    map[cat].push(p);
  }
  return map;
}

/* ══════════════════════════════════════════════════════════════════════ */
export function ConsumablesTab({ shopId, products }: Props) {
  const confirm    = useConfirm();
  const showToast  = (msg: string, ok = true) => ok ? sonnerToast.success(msg) : sonnerToast.error(msg);

  /* ── Section 1: Consumables ─────────────────────────────────────── */
  const [consumables, setConsumables] = useState<Consumable[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState<string | null>(null);
  const [adding,      setAdding]      = useState(false);
  const [addName,     setAddName]     = useState('');
  const [addUnit,     setAddUnit]     = useState('อัน');
  const [addQty,      setAddQty]      = useState('0');
  const [addMin,      setAddMin]      = useState('10');
  const [addSaving,   setAddSaving]   = useState(false);
  const [addError,    setAddError]    = useState<string | null>(null);
  const [editId,      setEditId]      = useState<string | null>(null);
  const [editQty,     setEditQty]     = useState('');
  const [editMin,     setEditMin]     = useState('');
  const [editSaving,  setEditSaving]  = useState(false);

  /* ── Section 2: BOM (per-product, inline) ────────────────────────── */
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [bomMap,      setBomMap]      = useState<BomMap>({});
  const [bomLoading,  setBomLoading]  = useState<Record<string, boolean>>({});
  const [bomSaving,   setBomSaving]   = useState<Record<string, boolean>>({});
  // addBom state: per-product
  const [addBomSel,   setAddBomSel]   = useState<Record<string, string>>({});
  const [addBomQty,   setAddBomQty]   = useState<Record<string, string>>({});

  /* ── Section 3: Volume Calculator ─────────────────────────────────── */
  const [calcTotal,     setCalcTotal]     = useState('1');
  const [calcTotalUnit, setCalcTotalUnit] = useState('ลิตร');
  const [calcPer,       setCalcPer]       = useState('100');
  const [calcPerUnit,   setCalcPerUnit]   = useState('ml');
  const [calcResult,    setCalcResult]    = useState<number | null>(null);
  const [calcError,     setCalcError]     = useState('');

  /* ── UNIT conversion map ─────────────────────────────────────────── */
  // Conversion to base unit (ml for volume, g for weight, unit for count)
  const UNIT_BASE: Record<string, number> = {
    // ── ปริมาตร (base: ml) ──────────────────────────────
    'ml':     1,
    'ซีซี':   1,        // cc = ml
    'ช้อนชา': 5,        // 1 ช้อนชา ≈ 5 ml
    'ช้อนโต๊ะ': 15,    // 1 ช้อนโต๊ะ ≈ 15 ml
    'ถ้วยตวง': 240,     // 1 ถ้วยตวง ≈ 240 ml
    'dl':     100,
    'ลิตร':   1000,
    'L':      1000,
    // ── น้ำหนัก (base: g) ───────────────────────────────
    'g':      1,
    'กรัม':   1,
    'ขีด':    100,      // 1 ขีด = 100 g
    'กก':     1000,
    'กิโล':   1000,
    'kg':     1000,
    'ก.':     1,
    // ── ความยาว (base: cm) ──────────────────────────────
    'cm':     1,
    'ซม':     1,
    'm':      100,
    'เมตร':   100,
    'นิ้ว':   2.54,
    'ฟุต':    30.48,
    // ── นับ (base: 1) ────────────────────────────────────
    'ชิ้น':   1,
    'อัน':    1,
    'ใบ':     1,
    'แผ่น':   1,
    'ม้วน':   1,
    'เส้น':   1,
    'เม็ด':   1,
    'ซอง':    1,
    'ถุง':    1,
    'กล่อง':  1,
    'แพ็ค':   1,
    'โหล':    12,
    'แพ':     1,
    'มัด':    1,
    'ขวด':    1,
    'กระป๋อง': 1,
    'ถัง':    1,
    'ถาด':    1,
    'ชุด':    1,
    'คู่':    2,
    'โต๊ะ':   1,
    'จาน':    1,
    'แก้ว':   1,
    'ชาม':    1,
    'กระสอบ': 1,
    'ลัง':    1,
    'หลอด':   1,
    'แท่ง':   1,
    'ห่อ':    1,
    'ตัว':    1,
    'ผืน':    1,
    'เล่ม':   1,
    'ฉบับ':   1,
  };

  /* ── Fetch consumables ───────────────────────────────────────────── */
  const fetchConsumables = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/consumables`);
      if (!res.ok) throw new Error('โหลดไม่สำเร็จ');
      const j = await res.json();
      setConsumables(j.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'เกิดข้อผิดพลาด');
    } finally { setLoading(false); }
  }, [shopId]);

  useEffect(() => { fetchConsumables(); }, [fetchConsumables]);

  /* ── Add consumable ─────────────────────────────────────────────── */
  async function handleAdd() {
    if (!addName.trim()) { setAddError('กรุณาระบุชื่อ'); return; }
    setAddSaving(true); setAddError(null);
    try {
      const res = await fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/consumables`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: addName.trim(), unit: addUnit, quantity: addQty, min_qty: addMin }),
      });
      if (!res.ok) { const j = await res.json(); throw new Error(j.error?.message ?? 'บันทึกไม่สำเร็จ'); }
      setAddName(''); setAddQty('0'); setAddMin('10'); setAdding(false);
      showToast('✅ เพิ่มวัตถุดิบสำเร็จ');
      await fetchConsumables();
    } catch (e) {
      setAddError(e instanceof Error ? e.message : 'เกิดข้อผิดพลาด');
    } finally { setAddSaving(false); }
  }

  async function saveEdit(c: Consumable) {
    setEditSaving(true);
    try {
      const res = await fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/consumables/${c.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity: editQty, min_qty: editMin }),
      });
      if (!res.ok) throw new Error('บันทึกไม่สำเร็จ');
      showToast('✅ อัปเดตสต็อกแล้ว');
      setEditId(null);
      await fetchConsumables();
    } catch { showToast('❌ บันทึกไม่สำเร็จ', false); } finally { setEditSaving(false); }
  }

  async function handleDelete(id: string) {
    const item = consumables.find((c) => c.id === id);
    const ok = await confirm({
      title: 'ลบวัตถุดิบ',
      description: <><strong>{item?.name ?? 'วัตถุดิบนี้'}</strong> จะถูกลบออกจากระบบถาวร</>,
      variant: 'danger',
      icon: '🗑',
      confirmLabel: 'ลบวัตถุดิบ',
    });
    if (!ok) return;
    await fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/consumables/${id}`, { method: 'DELETE' });
    sonnerToast.success('ลบวัตถุดิบเรียบร้อยแล้ว');
    await fetchConsumables();
  }

  /* ── BOM: toggle expand + fetch ─────────────────────────────────── */
  const fetchBomForProduct = useCallback(async (productId: string) => {
    setBomLoading(prev => ({ ...prev, [productId]: true }));
    try {
      const res = await fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/products/${productId}/bom`);
      if (!res.ok) throw new Error();
      const j = await res.json();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const entries: BomEntry[] = (j.data ?? []).map((r: any) => ({
        consumable_id:   r.consumable_id,
        consumable_name: r.name,
        unit:            r.unit,
        qty_per_unit:    String(r.qty_per_unit),
      }));
      setBomMap(prev => ({ ...prev, [productId]: entries }));
    } catch { /* ignore */ } finally {
      setBomLoading(prev => ({ ...prev, [productId]: false }));
    }
  }, [shopId]);

  function toggleExpand(productId: string) {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(productId)) {
        next.delete(productId);
      } else {
        next.add(productId);
        if (!bomMap[productId]) fetchBomForProduct(productId);
      }
      return next;
    });
  }

  function toggleCategory(catProducts: Product[], expand: boolean) {
    setExpandedIds(prev => {
      const next = new Set(prev);
      for (const p of catProducts) {
        if (expand) {
          next.add(p.id);
          if (!bomMap[p.id]) fetchBomForProduct(p.id);
        } else {
          next.delete(p.id);
        }
      }
      return next;
    });
  }

  /* ── BOM: add entry to local state ─────────────────────────────── */
  function addBomEntry(productId: string) {
    const selId = addBomSel[productId] || '';
    if (!selId) return;
    const c = consumables.find(x => x.id === selId);
    if (!c) return;
    const current = bomMap[productId] ?? [];
    if (current.find(b => b.consumable_id === selId)) return;
    setBomMap(prev => ({
      ...prev,
      [productId]: [...(prev[productId] ?? []), {
        consumable_id: c.id, consumable_name: c.name,
        unit: c.unit, qty_per_unit: addBomQty[productId] || '1',
      }],
    }));
    setAddBomSel(prev => ({ ...prev, [productId]: '' }));
    setAddBomQty(prev => ({ ...prev, [productId]: '1' }));
  }

  function updateBomQty(productId: string, consumableId: string, val: string) {
    setBomMap(prev => ({
      ...prev,
      [productId]: (prev[productId] ?? []).map(b =>
        b.consumable_id === consumableId ? { ...b, qty_per_unit: val } : b
      ),
    }));
  }

  function removeBomEntry(productId: string, consumableId: string) {
    setBomMap(prev => ({
      ...prev,
      [productId]: (prev[productId] ?? []).filter(b => b.consumable_id !== consumableId),
    }));
  }

  /* ── BOM: save ───────────────────────────────────────────────────── */
  async function saveBom(productId: string) {
    setBomSaving(prev => ({ ...prev, [productId]: true }));
    try {
      const entries = bomMap[productId] ?? [];
      const res = await fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/products/${productId}/bom`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: entries.map(b => ({ consumable_id: b.consumable_id, qty_per_unit: b.qty_per_unit || '1' })) }),
      });
      if (!res.ok) throw new Error();
      showToast('✅ บันทึก BOM สำเร็จ');
    } catch {
      showToast('❌ บันทึก BOM ไม่สำเร็จ', false);
    } finally { setBomSaving(prev => ({ ...prev, [productId]: false })); }
  }

  /* ── Volume Calculator ──────────────────────────────────────────── */
  function runCalc() {
    setCalcError('');
    const total = parseFloat(calcTotal);
    const per   = parseFloat(calcPer);
    if (!total || !per || per <= 0) { setCalcError('กรุณากรอกค่าให้ถูกต้อง'); return; }
    const totalBase = total * (UNIT_BASE[calcTotalUnit] ?? 1);
    const perBase   = per   * (UNIT_BASE[calcPerUnit]   ?? 1);
    setCalcResult(Math.floor(totalBase / perBase));
  }

  /* ── Category grouping ──────────────────────────────────────────── */
  const grouped = groupByCategory(products);
  const categories = Object.keys(grouped).sort();

  /* ═══════════════════════════════════════════════════════ RENDER ═══ */
  return (
    <div className="csm-wrap">


      {/* ╔══════════════════════╗ */}
      {/* ║  1. วัตถุดิบ         ║ */}
      {/* ╚══════════════════════╝ */}
      <section className="csm-section">
        <div className="csm-section__head">
          <div>
            <h2 className="csm-section__title">🧴 วัตถุดิบ / อุปกรณ์สิ้นเปลือง</h2>
            <p className="csm-section__sub">ไม่แสดงในหน้า POS · หักอัตโนมัติเมื่อขาย</p>
          </div>
          <button type="button" className="csm-btn-add" onClick={() => { setAdding(true); setAddError(null); }}>
            + เพิ่มวัตถุดิบ
          </button>
        </div>

        {adding && (
          <div className="csm-add-form">
            <input className="csm-input" placeholder="ชื่อวัตถุดิบ เช่น กล่องใส่อาหาร"
              value={addName} onChange={e => setAddName(e.target.value)} autoFocus />
            <input className="csm-input csm-input--sm" placeholder="หน่วย"
              value={addUnit} onChange={e => setAddUnit(e.target.value)} />
            <div className="csm-add-form__qty-group">
              <label className="csm-label">สต๊อกเริ่มต้น</label>
              <input type="number" min="0" className="csm-input csm-input--xs" value={addQty} onChange={e => setAddQty(e.target.value)} />
            </div>
            <div className="csm-add-form__qty-group">
              <label className="csm-label">แจ้งเตือนเมื่อเหลือ</label>
              <input type="number" min="0" className="csm-input csm-input--xs" value={addMin} onChange={e => setAddMin(e.target.value)} />
            </div>
            {addError && <span className="csm-error">{addError}</span>}
            <div className="csm-add-form__actions">
              <button type="button" className="csm-btn-save" onClick={handleAdd} disabled={addSaving}>
                {addSaving ? '⏳' : '💾 บันทึก'}
              </button>
              <button type="button" className="csm-btn-cancel" onClick={() => setAdding(false)}>ยกเลิก</button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="csm-loading">กำลังโหลด...</div>
        ) : error ? (
          <div className="csm-error-box">{error}</div>
        ) : consumables.length === 0 ? (
          <div className="csm-empty">
            <span className="csm-empty__icon">📦</span>
            <p>ยังไม่มีวัตถุดิบ</p>
            <p className="csm-empty__sub">กดปุ่ม &quot;+ เพิ่มวัตถุดิบ&quot; เพื่อเริ่มต้น</p>
          </div>
        ) : (
          <div className="csm-list">
            {consumables.map(c => {
              const level = stockLevel(c);
              const isEditing = editId === c.id;
              return (
                <div key={c.id} className={`csm-row ${LEVEL_CLASS[level]}`}>
                  <div className="csm-row__name">
                    {LEVEL_ICON[level] && <span className="csm-row__alert">{LEVEL_ICON[level]}</span>}
                    <span className="csm-row__label">{c.name}</span>
                  </div>
                  {isEditing ? (
                    <div className="csm-row__edit">
                      <div className="csm-row__edit-group">
                        <label className="csm-label">สต๊อก</label>
                        <input type="number" min="0" className="csm-input csm-input--xs"
                          value={editQty} onChange={e => setEditQty(e.target.value)} autoFocus />
                        <span className="csm-row__unit">{c.unit}</span>
                      </div>
                      <div className="csm-row__edit-group">
                        <label className="csm-label">แจ้งเตือน</label>
                        <input type="number" min="0" className="csm-input csm-input--xs"
                          value={editMin} onChange={e => setEditMin(e.target.value)} />
                      </div>
                      <button type="button" className="csm-btn-save csm-btn-save--sm" onClick={() => saveEdit(c)} disabled={editSaving}>
                        {editSaving ? '⏳' : '✓'}
                      </button>
                      <button type="button" className="csm-btn-cancel csm-btn-cancel--sm" onClick={() => setEditId(null)}>✕</button>
                    </div>
                  ) : (
                    <div className="csm-row__info">
                      <span className="csm-row__qty">{Number(c.quantity).toLocaleString()}</span>
                      <span className="csm-row__unit">{c.unit}</span>
                      <span className="csm-row__min">แจ้งเตือน: {c.min_qty}</span>
                      <button type="button" className="csm-icon-btn" title="แก้ไข"
                        onClick={() => { setEditId(c.id); setEditQty(String(c.quantity)); setEditMin(String(c.min_qty)); }}>✏️</button>
                      <button type="button" className="csm-icon-btn csm-icon-btn--del" title="ลบ" onClick={() => handleDelete(c.id)}>🗑️</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ╔══════════════════════╗ */}
      {/* ║  2. เครื่องคำนวณ    ║ */}
      {/* ╚══════════════════════╝ */}
      <section className="csm-section">
        <div className="csm-section__head">
          <div>
            <h2 className="csm-section__title">🧮 เครื่องคำนวณปริมาณ</h2>
            <p className="csm-section__sub">คำนวณจากปริมาณรวม ÷ ขนาดต่อหน่วย → จำนวนที่ได้</p>
          </div>
        </div>

        <div className="csm-calc-wrap">
          {/* Row 1: ปริมาณรวม */}
          <div className="csm-calc-group">
            <label className="csm-label csm-label--lg">ปริมาณรวม</label>
            <div className="csm-calc-row">
              <input type="number" min="0" step="0.01" className="csm-input csm-calc-input"
                value={calcTotal} onChange={e => setCalcTotal(e.target.value)} placeholder="เช่น 1" />
              <UnitPickerModal value={calcTotalUnit} onChange={setCalcTotalUnit} label="ปริมาณรวม" />
            </div>
          </div>

          <div className="csm-calc-divider">÷</div>

          {/* Row 2: ขนาดต่อหน่วย */}
          <div className="csm-calc-group">
            <label className="csm-label csm-label--lg">ขนาดต่อหน่วย</label>
            <div className="csm-calc-row">
              <input type="number" min="0" step="0.01" className="csm-input csm-calc-input"
                value={calcPer} onChange={e => setCalcPer(e.target.value)} placeholder="เช่น 100" />
              <UnitPickerModal value={calcPerUnit} onChange={setCalcPerUnit} label="ขนาดต่อหน่วย" />
            </div>
          </div>

          <button type="button" className="csm-btn-save csm-calc-btn" onClick={runCalc}>
            ⚡ คำนวณ
          </button>

          {calcError && <span className="csm-error">{calcError}</span>}

          {calcResult !== null && (
            <div className="csm-calc-result">
              <span className="csm-calc-result__num">{calcResult.toLocaleString()}</span>
              <span className="csm-calc-result__label">หน่วย</span>
              <span className="csm-calc-result__formula">
                ({calcTotal} {calcTotalUnit} ÷ {calcPer} {calcPerUnit})
              </span>
            </div>
          )}
        </div>
      </section>

      {/* ╔══════════════════════╗ */}
      {/* ║  3. ตั้งค่า BOM      ║ */}
      {/* ╚══════════════════════╝ */}
      <section className="csm-section">
        <div className="csm-section__head">
          <div>
            <h2 className="csm-section__title">🔗 ตั้งค่า BOM ต่อสินค้า</h2>
            <p className="csm-section__sub">เลือกสินค้าที่ต้องการกำหนด — แบ่งตามหมวดหมู่</p>
          </div>
          {expandedIds.size > 0 && (
            <button type="button" className="csm-btn-cancel"
              onClick={() => setExpandedIds(new Set())}>
              ยุบทั้งหมด
            </button>
          )}
        </div>

        {products.length === 0 ? (
          <div className="csm-empty">
            <span className="csm-empty__icon">🛒</span>
            <p>ยังไม่มีสินค้า</p>
          </div>
        ) : consumables.length === 0 ? (
          <div className="csm-error-box">⚠️ กรุณาเพิ่มวัตถุดิบก่อน แล้วค่อยตั้ง BOM</div>
        ) : (
          <div className="csm-bom-tree">
            {categories.map(cat => {
              const catProducts = grouped[cat];
              const allExpanded = catProducts.every(p => expandedIds.has(p.id));
              const someExpanded = catProducts.some(p => expandedIds.has(p.id));

              return (
                <div key={cat} className="csm-bom-cat">
                  {/* Category header */}
                  <div className="csm-bom-cat__head">
                    <label className="csm-bom-cat__label">
                      <input
                        type="checkbox"
                        className="csm-checkbox"
                        checked={allExpanded}
                        ref={el => { if (el) el.indeterminate = someExpanded && !allExpanded; }}
                        onChange={e => toggleCategory(catProducts, e.target.checked)}
                      />
                      <span className="csm-bom-cat__name">📂 {cat}</span>
                      <span className="csm-bom-cat__count">{catProducts.length} สินค้า</span>
                    </label>
                  </div>

                  {/* Products in category */}
                  <div className="csm-bom-cat__products">
                    {catProducts.map(product => {
                      const isOpen    = expandedIds.has(product.id);
                      const entries   = bomMap[product.id] ?? [];
                      const isLoading = bomLoading[product.id];
                      const isSaving  = bomSaving[product.id];
                      const hasBom    = entries.length > 0;
                      const available = consumables.filter(c => !entries.find(b => b.consumable_id === c.id));

                      return (
                        <div key={product.id} className={`csm-bom-product ${isOpen ? 'csm-bom-product--open' : ''}`}>
                          {/* Product row */}
                          <div className="csm-bom-product__head" onClick={() => toggleExpand(product.id)}>
                            <input
                              type="checkbox"
                              className="csm-checkbox"
                              checked={isOpen}
                              onChange={() => toggleExpand(product.id)}
                              onClick={e => e.stopPropagation()}
                            />
                            <span className="csm-bom-product__name">{product.name}</span>
                            {product.category && (
                              <span className="csm-bom-product__cat">{product.category}</span>
                            )}
                            {hasBom && !isOpen && (
                              <span className="csm-bom-badge">
                                🔗 {entries.length} วัตถุดิบ: {entries.map(e => `${e.consumable_name} ×${e.qty_per_unit}`).join(', ')}
                              </span>
                            )}
                            {!hasBom && !isLoading && (
                              <span className="csm-bom-badge csm-bom-badge--none">ยังไม่ตั้งค่า</span>
                            )}
                            <span className="csm-bom-product__toggle">{isOpen ? '▲' : '▼'}</span>
                          </div>

                          {/* Expanded BOM editor */}
                          {isOpen && (
                            <div className="csm-bom-editor">
                              {isLoading ? (
                                <div className="csm-loading">กำลังโหลด...</div>
                              ) : (
                                <>
                                  {/* Current BOM entries */}
                                  {entries.length === 0 ? (
                                    <div className="csm-bom-empty">ยังไม่มีการตั้งค่า — เพิ่มวัตถุดิบด้านล่าง</div>
                                  ) : (
                                    <div className="csm-bom-list">
                                      {entries.map(entry => (
                                        <div key={entry.consumable_id} className="csm-bom-row">
                                          <span className="csm-bom-row__name">{entry.consumable_name}</span>
                                          <span className="csm-bom-row__sep">×</span>
                                          <input
                                            type="number" min="0.001" step="0.001"
                                            className="csm-input csm-input--xs"
                                            value={entry.qty_per_unit}
                                            onChange={e => updateBomQty(product.id, entry.consumable_id, e.target.value)}
                                          />
                                          <span className="csm-bom-row__unit">{entry.unit}</span>
                                          <span className="csm-bom-row__label">/ ออเดอร์</span>
                                          <button type="button" className="csm-bom-row__remove"
                                            onClick={() => removeBomEntry(product.id, entry.consumable_id)}>✕</button>
                                        </div>
                                      ))}
                                    </div>
                                  )}

                                  {/* Add entry */}
                                  {available.length > 0 && (
                                    <div className="csm-bom-add">
                                      <select
                                        className="csm-select csm-select--sm"
                                        style={{ flex: 1, minWidth: 160 }}
                                        value={addBomSel[product.id] || ''}
                                        onChange={e => setAddBomSel(prev => ({ ...prev, [product.id]: e.target.value }))}
                                      >
                                        <option value="">+ เพิ่มวัตถุดิบ...</option>
                                        {available.map(c => (
                                          <option key={c.id} value={c.id}>{c.name} ({c.unit})</option>
                                        ))}
                                      </select>
                                      <input
                                        type="number" min="0.001" step="0.001"
                                        className="csm-input csm-input--xs"
                                        placeholder="จำนวน"
                                        value={addBomQty[product.id] || '1'}
                                        onChange={e => setAddBomQty(prev => ({ ...prev, [product.id]: e.target.value }))}
                                      />
                                      <button type="button" className="csm-btn-add csm-btn-add--sm"
                                        disabled={!addBomSel[product.id]}
                                        onClick={() => addBomEntry(product.id)}>
                                        เพิ่ม
                                      </button>
                                    </div>
                                  )}

                                  <div className="csm-bom-foot">
                                    <button type="button" className="csm-btn-save csm-btn-save--lg"
                                      onClick={() => saveBom(product.id)} disabled={isSaving}>
                                      {isSaving ? '⏳ กำลังบันทึก...' : '💾 บันทึก BOM'}
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
