'use client';

import { Branch, ShopUnit } from './stock-types';

interface Props {
  open: boolean;
  branches: Branch[];
  categories: string[];
  shopUnits: ShopUnit[];
  newProdName: string; setNewProdName: (v: string) => void;
  newProdPrice: string; setNewProdPrice: (v: string) => void;
  newProdUnit: string; setNewProdUnit: (v: string) => void;
  newProdSku: string; setNewProdSku: (v: string) => void;
  newProdCat: string; setNewProdCat: (v: string) => void;
  newProdQty: Record<string, string>; setNewProdQty: (v: Record<string, string>) => void;
  newProdShowOnPos: boolean; setNewProdShowOnPos: (v: boolean) => void;
  newProdSaving: boolean;
  newProdError: string | null;
  onSave: () => void;
  onClose: () => void;
}

export function NewProductModal({
  open, branches, categories, shopUnits,
  newProdName, setNewProdName,
  newProdPrice, setNewProdPrice,
  newProdUnit, setNewProdUnit,
  newProdSku, setNewProdSku,
  newProdCat, setNewProdCat,
  newProdQty, setNewProdQty,
  newProdShowOnPos,
  newProdSaving, newProdError,
  onSave, onClose,
}: Props) {
  if (!open) return null;
  return (
    <div className="inv__overlay" onClick={onClose}>
      <div className="inv__modal" onClick={e => e.stopPropagation()}>
        <div className="inv__modal-head">
          <div>
            <h2 className="inv__modal-title">
              {newProdShowOnPos ? '🆕 เพิ่มสินค้าใหม่' : '🗃️ เพิ่มสินค้าสต็อกภายใน'}
            </h2>
            <p className="inv__modal-sub">
              {newProdShowOnPos
                ? 'สร้างสินค้าและกำหนดสต๊อกเริ่มต้น'
                : 'สินค้านี้จะไม่แสดงที่หน้า POS — ใช้สำหรับติดตามสต็อกภายในเท่านั้น'}
            </p>
          </div>
          <button type="button" className="inv__modal-x" onClick={onClose}>×</button>
        </div>
        {!newProdShowOnPos && (
          <div className="inv__modal-notice">
            🚫 สินค้านี้จะ<strong>ไม่โชว์ที่หน้า POS</strong> แต่จะโชว์ในรายงานสต็อกทั้งหมด และตัดสต็อกอัตโนมัติเมื่อมีการใช้งาน
          </div>
        )}
        {newProdError && <p className="inv__modal-err">{newProdError}</p>}
        <div className="inv__modal-body inv__add-form">
          <label>ชื่อสินค้า <span className="inv__req">*</span></label>
          <input autoFocus type="text" value={newProdName} onChange={e => setNewProdName(e.target.value)} className="inv__form-inp" placeholder="เช่น ชาดำเย็น" />

          <label>
            ราคาขาย (บาท)
            {newProdShowOnPos ? <span className="inv__req"> *</span> : <span className="inv__optional"> (ไม่บังคับ)</span>}
          </label>
          <input type="number" min="0" step="0.01" value={newProdPrice} onChange={e => setNewProdPrice(e.target.value)} className="inv__form-inp" placeholder={newProdShowOnPos ? '0.00' : 'เว้นว่างได้ ถ้าไม่มีราคาขาย'} />

          <label>หน่วย</label>
          {shopUnits.length > 0 ? (
            <select value={newProdUnit} onChange={e => setNewProdUnit(e.target.value)} className="inv__form-sel">
              {shopUnits.map(u => <option key={u.id} value={u.name}>{u.name}</option>)}
            </select>
          ) : (
            <input type="text" value={newProdUnit} onChange={e => setNewProdUnit(e.target.value)} className="inv__form-inp" placeholder="อัน" />
          )}

          <label>SKU / รหัสสินค้า</label>
          <input type="text" value={newProdSku} onChange={e => setNewProdSku(e.target.value)} className="inv__form-inp" placeholder="ไม่บังคับ" />

          <label>หมวดหมู่</label>
          <input type="text" value={newProdCat} onChange={e => setNewProdCat(e.target.value)} className="inv__form-inp" placeholder="เช่น เครื่องดื่ม" list="cat-list" />
          <datalist id="cat-list">
            {categories.map(c => <option key={c} value={c} />)}
          </datalist>

          {branches.length > 0 && (
            <>
              <label>สต๊อกเริ่มต้นแต่ละสาขา</label>
              {branches.map(b => (
                <div key={b.id} className="inv__new-branch-row">
                  <span className="inv__new-branch-name">{b.name}</span>
                  <input
                    type="number" min="0"
                    value={newProdQty[b.id] ?? ''}
                    onChange={e => setNewProdQty({ ...newProdQty, [b.id]: e.target.value })}
                    className="inv__form-inp inv__form-inp--sm"
                    placeholder="0"
                  />
                </div>
              ))}
            </>
          )}
        </div>
        <div className="inv__modal-foot">
          <button type="button" onClick={onClose} className="inv__btn-ghost">ยกเลิก</button>
          <button type="button" onClick={onSave} disabled={newProdSaving} className="inv__btn-primary">
            {newProdSaving ? 'กำลังบันทึก...' : '💾 สร้างสินค้า'}
          </button>
        </div>
      </div>
    </div>
  );
}
