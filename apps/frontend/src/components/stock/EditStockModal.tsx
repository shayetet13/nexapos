'use client';

import { AllStockRow, ShopUnit } from './stock-types';

interface Props {
  editModal: { product_id: string; product_name: string; unit: string; rows: AllStockRow[] } | null;
  editQtyMap: Record<string, string>;
  editMinMap: Record<string, string>;
  editUnit: string;
  setEditQtyMap: (v: Record<string, string>) => void;
  setEditMinMap: (v: Record<string, string>) => void;
  setEditUnit: (v: string) => void;
  editSaving: boolean;
  shopUnits: ShopUnit[];
  onSave: () => void;
  onClose: () => void;
}

export function EditStockModal({
  editModal, editQtyMap, editMinMap, editUnit,
  setEditQtyMap, setEditMinMap, setEditUnit,
  editSaving, shopUnits, onSave, onClose,
}: Props) {
  if (!editModal) return null;
  return (
    <div className="inv__overlay" onClick={onClose}>
      <div className="inv__modal" onClick={e => e.stopPropagation()}>
        <div className="inv__modal-head">
          <div>
            <h2 className="inv__modal-title">✏️ แก้ไขสต๊อก</h2>
            <p className="inv__modal-sub">{editModal.product_name} · หน่วย: {editModal.unit}</p>
          </div>
          <button type="button" className="inv__modal-x" onClick={onClose}>×</button>
        </div>
        <div className="inv__modal-body">
          {/* Unit editor */}
          <div className="inv__unit-row-modal">
            <label>หน่วยนับ</label>
            {shopUnits.length > 0 ? (
              <select
                value={shopUnits.some(u => u.name === editUnit) ? editUnit : '__custom__'}
                onChange={e => {
                  if (e.target.value !== '__custom__') setEditUnit(e.target.value);
                }}
                className="inv__unit-sel"
              >
                {shopUnits.map(u => <option key={u.id} value={u.name}>{u.name}</option>)}
                {!shopUnits.some(u => u.name === editUnit) && (
                  <option value="__custom__">{editUnit} (ปัจจุบัน)</option>
                )}
              </select>
            ) : null}
            <input
              type="text"
              value={editUnit}
              onChange={e => setEditUnit(e.target.value)}
              placeholder="เช่น อัน, กล่อง, ถุง"
              className="inv__unit-inp-custom"
              style={shopUnits.length > 0 ? { maxWidth: 120 } : undefined}
            />
          </div>

          <table className="inv__edit-tbl">
            <thead>
              <tr>
                <th>สาขา</th>
                <th>สต๊อกปัจจุบัน</th>
                <th>ตั้งค่าใหม่</th>
                <th>แจ้งเตือนเมื่อเหลือ</th>
              </tr>
            </thead>
            <tbody>
              {editModal.rows.map(row => (
                <tr key={row.branch_id}>
                  <td className="inv__edit-branch">{row.branch_name}</td>
                  <td className="inv__edit-cur">
                    <span className={`inv__chip-qty${row.quantity <= row.min_qty ? ' inv__chip-qty--low' : row.quantity <= row.min_qty * 2 ? ' inv__chip-qty--warn' : ' inv__chip-qty--ok'}`}>
                      {row.quantity}
                    </span>
                  </td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      value={editQtyMap[row.branch_id] ?? ''}
                      onChange={e => setEditQtyMap({ ...editQtyMap, [row.branch_id]: e.target.value })}
                      className="inv__edit-inp"
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      value={editMinMap[row.branch_id] ?? ''}
                      onChange={e => setEditMinMap({ ...editMinMap, [row.branch_id]: e.target.value })}
                      className="inv__edit-inp"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="inv__modal-foot">
          <button type="button" onClick={onClose} className="inv__btn-ghost">ยกเลิก</button>
          <button type="button" onClick={onSave} disabled={editSaving} className="inv__btn-primary">
            {editSaving ? 'กำลังบันทึก...' : '💾 บันทึก'}
          </button>
        </div>
      </div>
    </div>
  );
}
