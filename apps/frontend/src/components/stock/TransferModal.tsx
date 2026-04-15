'use client';

import { Branch, Product } from './stock-types';

interface Props {
  open: boolean;
  branches: Branch[];
  products: Product[];
  transferProductId: string; setTransferProductId: (v: string) => void;
  transferFromId: string; setTransferFromId: (v: string) => void;
  transferToId: string; setTransferToId: (v: string) => void;
  transferQty: string; setTransferQty: (v: string) => void;
  transferNote: string; setTransferNote: (v: string) => void;
  transferSaving: boolean;
  transferError: string | null;
  transferSuccess: string | null;
  onSave: () => void;
  onClose: () => void;
}

export function TransferModal({
  open, branches, products,
  transferProductId, setTransferProductId,
  transferFromId, setTransferFromId,
  transferToId, setTransferToId,
  transferQty, setTransferQty,
  transferNote, setTransferNote,
  transferSaving, transferError, transferSuccess,
  onSave, onClose,
}: Props) {
  if (!open) return null;
  return (
    <div className="inv__overlay" onClick={onClose}>
      <div className="inv__modal inv__modal--sm" onClick={e => e.stopPropagation()}>
        <div className="inv__modal-head">
          <div>
            <h2 className="inv__modal-title">🔄 โอนสต๊อกระหว่างสาขา</h2>
            <p className="inv__modal-sub">เลือกสินค้า ต้นทาง ปลายทาง และจำนวนที่ต้องการโอน</p>
          </div>
          <button type="button" className="inv__modal-x" onClick={onClose}>×</button>
        </div>
        {transferError   && <p className="inv__modal-err">{transferError}</p>}
        {transferSuccess && <p className="inv__modal-ok">{transferSuccess}</p>}
        <div className="inv__modal-body inv__add-form">
          <label>สินค้า <span className="inv__req">*</span></label>
          <select value={transferProductId} onChange={e => setTransferProductId(e.target.value)} className="inv__form-sel">
            <option value="">— เลือกสินค้า —</option>
            {products.map(p => <option key={p.id} value={p.id}>{p.name}{p.sku ? ` (${p.sku})` : ''} [{p.unit}]</option>)}
          </select>

          <label>สาขาต้นทาง <span className="inv__req">*</span></label>
          <select value={transferFromId} onChange={e => setTransferFromId(e.target.value)} className="inv__form-sel">
            <option value="">— เลือกสาขาต้นทาง —</option>
            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>

          <label>สาขาปลายทาง <span className="inv__req">*</span></label>
          <select value={transferToId} onChange={e => setTransferToId(e.target.value)} className="inv__form-sel">
            <option value="">— เลือกสาขาปลายทาง —</option>
            {branches.filter(b => b.id !== transferFromId).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>

          <label>จำนวนที่โอน <span className="inv__req">*</span></label>
          <input type="number" min="1" value={transferQty} onChange={e => setTransferQty(e.target.value)} className="inv__form-inp" placeholder="1" />

          <label>หมายเหตุ (ไม่บังคับ)</label>
          <input type="text" value={transferNote} onChange={e => setTransferNote(e.target.value)} className="inv__form-inp" placeholder="เช่น โอนเพราะสาขาหลักสต๊อกล้น" maxLength={200} />
        </div>
        <div className="inv__modal-foot">
          <button type="button" onClick={onClose} className="inv__btn-ghost">ยกเลิก</button>
          <button
            type="button"
            onClick={onSave}
            disabled={transferSaving || !transferProductId || !transferFromId || !transferToId}
            className="inv__btn-primary"
          >
            {transferSaving ? 'กำลังโอน...' : '🔄 โอนสต๊อก'}
          </button>
        </div>
      </div>
    </div>
  );
}
