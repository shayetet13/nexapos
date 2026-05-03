'use client';

import { useCallback, useEffect, useState } from 'react';
import { fetchWithAuth } from '@/lib/supabase';
import type { DiningTableLite } from '@/components/dining/DiningFloor';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

type Row = DiningTableLite & { capacity?: number | null; sort_order?: number; is_active?: boolean };

export function DiningTablesManagerModal({
  shopId,
  branchId,
  open,
  onClose,
  isOwner,
  onChanged,
}: {
  shopId: string;
  branchId: string;
  open: boolean;
  onClose: () => void;
  /** มีสิทธิ์ DELETE ที่ backend (เฉพาะ owner) */
  isOwner: boolean;
  onChanged: () => void;
}) {
  const [rows, setRows]       = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [labelIn, setLabelIn] = useState('');
  const [capacityIn, setCapacityIn] = useState('');
  const [adding, setAdding]   = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/dining-tables?branchId=${branchId}`);
      if (!res.ok) {
        setError('โหลดโต๊ะไม่สำเร็จ');
        setRows([]);
      } else {
        const j = await res.json() as { data?: Row[] };
        setRows(j.data ?? []);
      }
    } catch {
      setError('เครือข่ายผิดพลาด');
    } finally {
      setLoading(false);
    }
  }, [shopId, branchId]);

  useEffect(() => {
    if (!open || !shopId || !branchId) return;
    void load();
  }, [open, shopId, branchId, load]);

  async function addTable() {
    const label = labelIn.trim();
    if (!label) {
      setError('ใส่ชื่อ/หมายเลขโต๊ะ');
      return;
    }
    setAdding(true);
    setError(null);
    try {
      const capRaw = capacityIn.trim();
      const body: Record<string, string | number | boolean> = { branch_id: branchId, label };
      if (capRaw !== '') body.capacity = Number(capRaw);
      const res = await fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/dining-tables`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });
      const j = await res.json() as { error?: { message?: string } };
      if (!res.ok) {
        setError(j.error?.message ?? 'เพิ่มโต๊ะไม่สำเร็จ');
      } else {
        setLabelIn('');
        setCapacityIn('');
        onChanged();
        await load();
      }
    } catch {
      setError('เพิ่มโต๊ะไม่สำเร็จ');
    } finally {
      setAdding(false);
    }
  }

  async function patchLabel(tableId: string, label: string) {
    const res = await fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/dining-tables/${tableId}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ label }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError((j as { error?: { message?: string } }).error?.message ?? 'บันทึกไม่สำเร็จ');
      await load();
    } else {
      onChanged();
      await load();
    }
  }

  async function removeTable(tableId: string) {
    if (!isOwner) return;
    if (!confirm('ลบโต๊ะนี้จากระบบ? (โต๊ะที่มีเซสชันเปิดอยู่ลบไม่ได้)')) return;
    const res = await fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/dining-tables/${tableId}`, {
      method: 'DELETE',
    });
    if (res.status === 204 || res.ok) {
      onChanged();
      await load();
    } else {
      const j = await res.json().catch(() => ({}));
      setError((j as { error?: { message?: string } }).error?.message ?? 'ลบไม่สำเร็จ');
      await load();
    }
  }

  if (!open) return null;

  return (
    <>
      <div className="dining-modal__backdrop" aria-hidden="true" onClick={onClose} />
      <div className="dining-modal" role="dialog" aria-labelledby="dining-tables-title">
        <div className="dining-modal__head">
          <h2 id="dining-tables-title">จัดการโต๊ะ</h2>
          <button type="button" className="dining-modal__close" onClick={onClose} aria-label="ปิด">
            ✕
          </button>
        </div>
        <div className="dining-modal__body">
          <p className="dining-modal__hint">
            ตั้งโต๊ะตามเลขหมายในร้าน (เช่น A1, 12) พนักงานจะเห็นที่หน้าเปิดบิล
          </p>

          <div className="dining-modal__add">
            <label className="dining-modal__label" htmlFor="dt-label">โต๊ะใหม่</label>
            <div className="dining-modal__add-row">
              <input
                id="dt-label"
                className="input-field dining-modal__input"
                placeholder="เช่น A3, VIP-1"
                value={labelIn}
                onChange={(e) => setLabelIn(e.target.value)}
                maxLength={80}
              />
              <input
                className="input-field dining-modal__input-cap"
                type="number"
                min={1}
                max={99}
                placeholder="ที่นั่ง"
                aria-label="จำนวนที่นั่ง (ไม่บังคับ)"
                value={capacityIn}
                onChange={(e) => setCapacityIn(e.target.value)}
              />
              <button type="button" className="btn-primary dining-modal__add-btn" onClick={() => void addTable()} disabled={adding}>
                {adding ? 'กำลังเพิ่ม…' : 'เพิ่มโต๊ะ'}
              </button>
            </div>
          </div>

          {error && <p className="dining-modal__err">{error}</p>}

          {loading ? (
            <p className="dining-modal__muted">กำลังโหลด…</p>
          ) : rows.length === 0 ? (
            <p className="dining-modal__muted">ยังไม่มีโต๊ะ — เพิ่มโต๊ะแรกด้านบน</p>
          ) : (
            <ul className="dining-modal__list">
              {rows.map((r) => (
                <li key={r.id} className="dining-modal__row">
                  <TableRowEditable
                    label={r.label}
                    capacity={r.capacity ?? undefined}
                    onSave={(lbl) => { void patchLabel(r.id, lbl); }}
                  />
                  {isOwner && (
                    <button type="button" className="dining-modal__del" onClick={() => void removeTable(r.id)}>
                      ลบ
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {!isOwner && (
            <p className="dining-modal__footnote">ลบโต๊ะได้เฉพาะเจ้าของร้าน • ผู้จัดการเพิ่มและเปลี่ยนชื่อได้</p>
          )}
        </div>
      </div>
    </>
  );
}

function TableRowEditable({
  label,
  capacity,
  onSave,
}: {
  label: string;
  capacity?: number;
  onSave: (label: string) => void;
}) {
  const [v, setV] = useState(label);
  useEffect(() => { setV(label); }, [label]);
  return (
    <div className="dining-modal__row-edit">
      <input
        className="input-field dining-modal__row-input"
        value={v}
        onChange={(e) => setV(e.target.value)}
        maxLength={80}
      />
      {capacity != null && <span className="dining-modal__cap-pill">{capacity} ที่นั่ง</span>}
      <button type="button" className="dining-modal__save" onClick={() => v.trim() && v !== label && onSave(v.trim())}>
        บันทึก
      </button>
    </div>
  );
}
