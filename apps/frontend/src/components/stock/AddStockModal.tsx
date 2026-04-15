'use client';

import { Branch, Product } from './stock-types';

interface Props {
  open: boolean;
  branches: Branch[];
  products: Product[];
  addProductId: string; setAddProductId: (v: string) => void;
  addBranchId: string; setAddBranchId: (v: string) => void;
  addQty: string; setAddQty: (v: string) => void;
  addMin: string; setAddMin: (v: string) => void;
  addSaving: boolean;
  addError: string | null;
  onSave: () => void;
  onClose: () => void;
}

export function AddStockModal({
  open, branches, products,
  addProductId, setAddProductId,
  addBranchId, setAddBranchId,
  addQty, setAddQty,
  addMin, setAddMin,
  addSaving, addError,
  onSave, onClose,
}: Props) {
  if (!open) return null;
  return (
    <div className="inv__overlay" onClick={onClose}>
      <div className="inv__modal inv__modal--sm" onClick={e => e.stopPropagation()}>
        <div className="inv__modal-head">
          <div>
            <h2 className="inv__modal-title">➕ เพิ่ม / กำหนดสต๊อก</h2>
            <p className="inv__modal-sub">เลือกสินค้าและสาขา แล้วกำหนดจำนวน</p>
          </div>
          <button type="button" className="inv__modal-x" onClick={onClose}>×</button>
        </div>
        {addError && <p className="inv__modal-err">{addError}</p>}
        <div className="inv__modal-body inv__add-form">
          <label>สินค้า <span className="inv__req">*</span></label>
          <select value={addProductId} onChange={e => setAddProductId(e.target.value)} className="inv__form-sel">
            <option value="">— เลือกสินค้า —</option>
            {products.map(p => <option key={p.id} value={p.id}>{p.name}{p.sku ? ` (${p.sku})` : ''} [{p.unit}]</option>)}
          </select>
          <label>สาขา <span className="inv__req">*</span></label>
          <select value={addBranchId} onChange={e => setAddBranchId(e.target.value)} className="inv__form-sel">
            <option value="">— เลือกสาขา —</option>
            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <label>จำนวนสต๊อก</label>
          <input type="number" min="0" value={addQty} onChange={e => setAddQty(e.target.value)} className="inv__form-inp" placeholder="0" />
          <label>แจ้งเตือนเมื่อเหลือไม่เกิน</label>
          <input type="number" min="0" value={addMin} onChange={e => setAddMin(e.target.value)} className="inv__form-inp" placeholder="5" />
        </div>
        <div className="inv__modal-foot">
          <button type="button" onClick={onClose} className="inv__btn-ghost">ยกเลิก</button>
          <button type="button" onClick={onSave} disabled={addSaving || !addProductId || !addBranchId} className="inv__btn-primary">
            {addSaving ? 'กำลังบันทึก...' : '💾 บันทึกสต๊อก'}
          </button>
        </div>
      </div>
    </div>
  );
}
