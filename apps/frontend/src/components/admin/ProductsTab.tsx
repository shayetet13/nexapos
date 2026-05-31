'use client';

import Image from 'next/image';

export interface Product {
  id: string; name: string; sku: string | null; price: string; image_url: string | null;
  category: string | null; unit: string; cost_price: string | null; barcode: string | null;
  show_on_pos: boolean;
}

export interface StockRow { branch_id: string; branch_name: string; quantity: number; min_qty: number; }
export interface ShopUnit { id: string; name: string; }

interface Props {
  products: Product[];
  shopUnits: ShopUnit[];
  formOpen: boolean;
  editingId: string | null;
  formName: string; setFormName: (v: string) => void;
  formSku: string; setFormSku: (v: string) => void;
  formPrice: string; setFormPrice: (v: string) => void;
  formCostPrice: string; setFormCostPrice: (v: string) => void;
  formUnit: string; setFormUnit: (v: string) => void;
  formCategory: string; setFormCategory: (v: string) => void;
  formBarcode: string; setFormBarcode: (v: string) => void;
  formImagePreview: string | null;
  uploadError: string | null;
  saving: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  stockByProduct: Record<string, StockRow[]>;
  stockEdit: { productId: string; branchId: string; quantity: string } | null;
  setStockEdit: (v: { productId: string; branchId: string; quantity: string } | null) => void;
  openAdd: () => void;
  openEdit: (p: Product) => void;
  closeForm: () => void;
  saveProduct: () => void;
  deleteProduct: (id: string) => void;
  loadStock: (id: string) => void;
  saveStock: () => void;
  handleFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  setFormImageFile: (f: File | null) => void;
  setFormImageUrl: (v: string | null) => void;
  setFormImagePreview: (v: string | null) => void;
}

export function ProductsTab({
  products, shopUnits,
  formOpen, editingId,
  formName, setFormName,
  formSku, setFormSku,
  formPrice, setFormPrice,
  formCostPrice, setFormCostPrice,
  formUnit, setFormUnit,
  formCategory, setFormCategory,
  formBarcode, setFormBarcode,
  formImagePreview,
  uploadError, saving,
  fileInputRef,
  stockByProduct, stockEdit, setStockEdit,
  openAdd, openEdit, closeForm, saveProduct, deleteProduct, loadStock, saveStock,
  handleFileChange, setFormImageFile, setFormImageUrl, setFormImagePreview,
}: Props) {
  return (
    <div className="page-admin__tab-content">
      <div className="page-admin__section">
        <h2 className="page-admin__title">สินค้า</h2>
        <button type="button" onClick={openAdd} className="btn-primary">+ เพิ่มสินค้า</button>
      </div>
      {formOpen && (
        <div className="page-admin__card">
          <h3 className="page-admin__card-title">{editingId ? 'แก้ไขสินค้า' : 'เพิ่มสินค้าใหม่'}</h3>
          <div className="page-admin__form">
            <input placeholder="ชื่อสินค้า *" value={formName} onChange={(e) => setFormName(e.target.value)} className="input-field" />
            <div className="page-admin__form-row">
              <input placeholder="รหัสสินค้า (SKU)" value={formSku} onChange={(e) => setFormSku(e.target.value)} className="input-field" />
              <input placeholder="บาร์โค้ด" value={formBarcode} onChange={(e) => setFormBarcode(e.target.value)} className="input-field" />
            </div>
            <div className="page-admin__form-row">
              <input type="number" step="0.01" placeholder="ราคาขาย *" value={formPrice} onChange={(e) => setFormPrice(e.target.value)} className="input-field" />
              <input type="number" step="0.01" placeholder="ราคาต้นทุน" value={formCostPrice} onChange={(e) => setFormCostPrice(e.target.value)} className="input-field" />
            </div>
            <div className="page-admin__form-row">
              <select value={formUnit} onChange={(e) => setFormUnit(e.target.value)} className="input-field">
                <option value="อัน">อัน</option>
                <option value="ชิ้น">ชิ้น</option>
                <option value="ขวด">ขวด</option>
                <option value="แก้ว">แก้ว</option>
                <option value="กิโลกรัม">กิโลกรัม</option>
                <option value="ลิตร">ลิตร</option>
                <option value="กล่อง">กล่อง</option>
                <option value="ถุง">ถุง</option>
                {shopUnits.filter((u) => !['อัน','ชิ้น','ขวด','แก้ว','กิโลกรัม','ลิตร','กล่อง','ถุง'].includes(u.name)).map((u) => (
                  <option key={u.id} value={u.name}>{u.name}</option>
                ))}
              </select>
              <input placeholder="หมวดหมู่ (เช่น เครื่องดื่ม)" value={formCategory} onChange={(e) => setFormCategory(e.target.value)} className="input-field" list="category-list" />
              <datalist id="category-list">
                {[...new Set(products.map((p) => p.category).filter(Boolean))].map((c) => (
                  <option key={c as string} value={c as string} />
                ))}
              </datalist>
            </div>
            <div className="page-admin__img-upload">
              <p className="page-admin__label">รูปสินค้า (ไม่บังคับ)</p>
              <input ref={fileInputRef} type="file" accept="image/*" className="page-admin__file-input" onChange={handleFileChange} />
              {formImagePreview ? (
                <div className="page-admin__img-preview-wrap">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={formImagePreview} alt="ตัวอย่าง" className="page-admin__img-preview" />
                  <div className="page-admin__img-preview-actions">
                    <button type="button" onClick={() => fileInputRef.current?.click()} className="page-admin__btn-sm">เปลี่ยนรูป</button>
                    <button type="button" onClick={() => { setFormImageFile(null); setFormImageUrl(null); setFormImagePreview(null); if (fileInputRef.current) fileInputRef.current.value = ''; }} className="page-admin__btn-sm page-admin__btn-danger">ลบรูป</button>
                  </div>
                </div>
              ) : (
                <button type="button" className="page-admin__img-placeholder" onClick={() => fileInputRef.current?.click()}>
                  <span className="page-admin__img-icon">+</span>
                  <span>เลือกรูปสินค้า</span>
                </button>
              )}
              {uploadError && <p className="page-admin__upload-error">{uploadError}</p>}
            </div>
            <div className="page-admin__form-actions">
              <button type="button" onClick={closeForm} className="btn-secondary">ยกเลิก</button>
              <button type="button" onClick={saveProduct} disabled={saving} className="btn-primary">{saving ? 'กำลังบันทึก...' : 'บันทึก'}</button>
            </div>
          </div>
        </div>
      )}
      <ul className="page-admin__list">
        {products.map((p) => (
          <li key={p.id} className="page-admin__list-item">
            <div className="page-admin__list-row">
              {p.image_url
                ? <Image src={p.image_url} alt={p.name} width={56} height={56} className="page-admin__list-thumb" />
                : <div className="page-admin__list-thumb page-admin__list-thumb--empty"><span>รูป</span></div>}
              <div className="page-admin__list-info">
                <div className="page-admin__list-main">
                  <span className="page-admin__list-name">{p.name}</span>
                  <span className="page-admin__list-meta">{p.sku || '—'} · ฿{p.price} · {p.unit}{p.category ? ` · ${p.category}` : ''}</span>
                </div>
                <div className="page-admin__list-actions">
                  <button type="button" onClick={() => loadStock(p.id)} className="page-admin__btn-sm">สต๊อก</button>
                  <button type="button" onClick={() => openEdit(p)} className="page-admin__btn-sm">แก้ไข</button>
                  <button type="button" onClick={() => deleteProduct(p.id)} className="page-admin__btn-sm page-admin__btn-danger">ลบ</button>
                </div>
              </div>
            </div>
            {stockByProduct[p.id] && (
              <div className="page-admin__stock">
                {stockByProduct[p.id].map((s) => (
                  <div key={s.branch_id} className="page-admin__stock-row">
                    <span>{s.branch_name}</span>
                    {stockEdit?.productId === p.id && stockEdit?.branchId === s.branch_id ? (
                      <>
                        <input type="number" min={0} value={stockEdit.quantity} onChange={(e) => setStockEdit(stockEdit ? { ...stockEdit, quantity: e.target.value } : null)} className="page-admin__input-sm" />
                        <button type="button" onClick={saveStock} className="page-admin__btn-sm">บันทึก</button>
                        <button type="button" onClick={() => setStockEdit(null)} className="page-admin__btn-sm">ยกเลิก</button>
                      </>
                    ) : (
                      <>
                        <span>{s.quantity}</span>
                        <button type="button" onClick={() => setStockEdit({ productId: p.id, branchId: s.branch_id, quantity: String(s.quantity) })} className="page-admin__btn-sm">ตั้งค่า</button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </li>
        ))}
        {products.length === 0 && <li className="page-admin__empty">ยังไม่มีสินค้า</li>}
      </ul>
    </div>
  );
}
