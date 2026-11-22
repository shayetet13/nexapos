'use client';

interface Props {
  item: { id: string; name: string } | null;
  onConfirm: (id: string) => void;
  onClose: () => void;
}

export function ConfirmDeleteModal({ item, onConfirm, onClose }: Props) {
  if (!item) return null;
  return (
    <div className="inv__overlay" onClick={onClose}>
      <div className="inv__modal inv__modal--sm inv__modal--confirm" onClick={e => e.stopPropagation()}>
        <p className="inv__confirm-icon">🗑️</p>
        <h3 className="inv__confirm-title">ลบสินค้านี้?</h3>
        <p className="inv__confirm-sub">«{item.name}» จะถูกลบออกจากระบบถาวร</p>
        <div className="inv__modal-foot">
          <button type="button" onClick={onClose} className="inv__btn-ghost">ยกเลิก</button>
          <button type="button" onClick={() => onConfirm(item.id)} className="inv__btn-danger">ลบเลย</button>
        </div>
      </div>
    </div>
  );
}
