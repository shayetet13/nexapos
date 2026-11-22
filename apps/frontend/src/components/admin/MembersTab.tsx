'use client';

import { fetchWithAuth } from '@/lib/supabase';
import { API_URL } from '@/lib/config';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { toast } from 'sonner';

export interface Member {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  birthday: string | null;
  points: number;
  total_spent: string;
  tier: string;
  notes: string | null;
  created_at: string;
}

interface Props {
  members: Member[];
  membersLoading: boolean;
  membersSearch: string; setMembersSearch: (v: string) => void;
  membersPage: number; setMembersPage: (v: number) => void;
  memberEdit: Member | null; setMemberEdit: (v: Member | null) => void;
  memberForm: { name: string; phone: string; email: string; birthday: string; notes: string };
  setMemberForm: React.Dispatch<React.SetStateAction<{ name: string; phone: string; email: string; birthday: string; notes: string }>>;
  memberSaving: boolean; setMemberSaving: (v: boolean) => void;
  memberError: string | null; setMemberError: (v: string | null) => void;
  filteredMembers: Member[];
  pagedMembers: Member[];
  membersPageCount: number;
  shopId: string | null;
  loadMembers: () => void;
}

export function MembersTab({
  members, membersLoading,
  membersSearch, setMembersSearch,
  membersPage, setMembersPage,
  memberEdit, setMemberEdit,
  memberForm, setMemberForm,
  memberSaving, setMemberSaving,
  memberError, setMemberError,
  filteredMembers, pagedMembers, membersPageCount,
  shopId, loadMembers,
}: Props) {
  const confirm = useConfirm();

  return (
    <div className="page-admin__tab-content">
      <div className="page-admin__section">
        <div>
          <h2 className="page-admin__title">สมาชิก</h2>
          <p className="page-admin__subtitle">ดูข้อมูลแต้ม ระดับ และยอดซื้อของลูกค้าได้อย่างเป็นระเบียบ</p>
        </div>
        <div className="page-admin__members-toolbar">
          <div className="page-admin__members-toolbar-left">
            <div className="page-admin__members-search">
              <label className="input-label" htmlFor="members-search">ค้นหา</label>
              <input
                id="members-search"
                type="text"
                placeholder="ค้นหาชื่อ หรือ เบอร์โทร..."
                value={membersSearch}
                onChange={(e) => {
                  setMembersSearch(e.target.value);
                  setMembersPage(1);
                }}
                className="input-field"
              />
            </div>
            <div className="page-admin__members-actions">
              <button
                type="button"
                onClick={() => {
                  const headers = ['ชื่อ', 'เบอร์โทร', 'อีเมล', 'ระดับ', 'แต้ม', 'ยอดซื้อ', 'วันเกิด'];
                  const rows = filteredMembers.map((m) => [
                    m.name,
                    m.phone ?? '',
                    m.email ?? '',
                    m.tier,
                    String(m.points),
                    m.total_spent,
                    m.birthday ?? '',
                  ]);
                  const csv = [headers.join(','), ...rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))].join('\n');
                  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `members-${new Date().toISOString().slice(0, 10)}.csv`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                disabled={members.length === 0}
                className="btn-secondary"
              >
                📥 Export CSV
              </button>
            </div>
          </div>
          <div className="page-admin__members-toolbar-right">
            <button type="button" onClick={loadMembers} disabled={membersLoading} className="btn-primary">
              {membersLoading ? '⏳ โหลด...' : '↺ รีเฟรช'}
            </button>
          </div>
        </div>
      </div>
      {membersLoading ? (
        <p className="page-admin__empty">กำลังโหลด...</p>
      ) : filteredMembers.length === 0 ? (
        <p className="page-admin__empty">ไม่มีสมาชิก{membersSearch.trim() ? ' ตามคำค้น' : ''}</p>
      ) : (
        <div className="page-admin__card page-admin__members-card">
          <div className="page-admin__members-header">
            <div className="page-admin__members-stat">
              <span className="page-admin__members-stat-label">จำนวนสมาชิกทั้งหมด</span>
              {' '}
              <span className="page-admin__members-stat-value">
                {members.length.toLocaleString()}{' '}สมาชิก
              </span>
            </div>
            <div className="page-admin__members-stat">
              <span className="page-admin__members-stat-label">แต้มรวมทั้งหมด</span>
              {' '}
              <span className="page-admin__members-stat-value">
                {members.reduce((sum, m) => sum + m.points, 0).toLocaleString()}{' '}แต้ม
              </span>
            </div>
          </div>
          <div className="page-admin__members-table-wrap">
            <table className="page-admin__members-table">
              <thead>
                <tr>
                  <th>สมาชิก</th>
                  <th>ระดับ / แต้ม</th>
                  <th>ยอดซื้อสะสม</th>
                  <th>วันเกิด</th>
                  <th>การจัดการ</th>
                </tr>
              </thead>
              <tbody>
                {pagedMembers.map((m) => {
                  const bd = m.birthday ? new Date(m.birthday + 'T12:00:00') : null;
                  const today = new Date();
                  let in7 = false;
                  if (bd) {
                    for (let i = 0; i < 7; i++) {
                      const d = new Date(today);
                      d.setDate(d.getDate() + i);
                      if (bd.getMonth() === d.getMonth() && bd.getDate() === d.getDate()) { in7 = true; break; }
                    }
                  }
                  return (
                    <tr key={m.id}>
                      <td>
                        <div className="page-admin__member-main">
                          <div className="page-admin__member-avatar">
                            {m.name.slice(0, 1).toUpperCase()}
                          </div>
                          <div className="page-admin__member-info">
                            <div className="page-admin__member-name">{m.name}</div>
                            <div className="page-admin__member-sub">
                              <span>{m.phone ?? '—'}</span>
                              {m.email && <span>· {m.email}</span>}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="page-admin__member-tier">
                          <span className={`page-admin__member-tier-pill page-admin__member-tier-pill--${m.tier}`}>
                            {m.tier.toUpperCase()}
                          </span>
                          <span className="page-admin__member-points">
                            ⭐ {m.points.toLocaleString()} แต้ม
                          </span>
                        </div>
                      </td>
                      <td className="page-admin__member-money">
                        ฿{Number(m.total_spent).toLocaleString('th-TH', { minimumFractionDigits: 0 })}
                      </td>
                      <td>
                        <div className="page-admin__member-birthday">
                          <span>
                            {m.birthday
                              ? new Date(m.birthday).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: 'numeric' })
                              : '—'}
                          </span>
                          {in7 && <span className="page-admin__member-birthday-badge" title="วันเกิดใน 7 วัน">🎂 ภายใน 7 วัน</span>}
                        </div>
                      </td>
                      <td>
                        <div className="page-admin__member-actions">
                          <button
                            type="button"
                            className="page-admin__table-btn"
                            onClick={() => {
                              setMemberEdit(m);
                              setMemberForm({
                                name: m.name,
                                phone: m.phone ?? '',
                                email: m.email ?? '',
                                birthday: m.birthday ?? '',
                                notes: m.notes ?? '',
                              });
                            }}
                          >
                            แก้ไข
                          </button>
                          <button
                            type="button"
                            className="page-admin__table-btn page-admin__table-btn--danger"
                            onClick={async () => {
                              if (!shopId) return;
                              const ok = await confirm({
                                title: 'ลบสมาชิก',
                                description: <><strong>{m.name || m.phone || 'สมาชิกนี้'}</strong> จะถูกลบออกจากระบบถาวร</>,
                                variant: 'danger',
                                icon: '👤',
                                confirmLabel: 'ลบสมาชิก',
                              });
                              if (!ok) return;
                              await fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/customers/${m.id}`, {
                                method: 'DELETE',
                              });
                              toast.success('ลบสมาชิกเรียบร้อยแล้ว');
                              loadMembers();
                            }}
                          >
                            ลบ
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {membersPageCount > 1 && (
            <div className="page-admin__pagination" style={{ marginTop: '0.75rem' }}>
              <div className="page-admin__pagination-buttons">
                <button
                  type="button"
                  onClick={() => setMembersPage(Math.max(1, membersPage - 1))}
                  disabled={membersPage <= 1}
                  className="page-admin__pagination-btn"
                >
                  ← ก่อนหน้า
                </button>
                <span style={{ padding: '0 0.75rem', fontSize: '0.85rem' }}>
                  {membersPage} / {membersPageCount}
                </span>
                <button
                  type="button"
                  onClick={() => setMembersPage(Math.min(membersPageCount, membersPage + 1))}
                  disabled={membersPage >= membersPageCount}
                  className="page-admin__pagination-btn"
                >
                  ถัดไป →
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Edit member modal */}
      {memberEdit && (
        <div className="page-admin__modal-overlay" onClick={() => setMemberEdit(null)}>
          <div className="page-admin__modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="page-admin__card-title">แก้ไขสมาชิก</h3>
            {memberError && <p className="page-admin__error">{memberError}</p>}
            <div className="page-admin__form">
              <label className="page-admin__label">ชื่อ</label>
              <input className="input-field" value={memberForm.name} onChange={(e) => setMemberForm((f) => ({ ...f, name: e.target.value }))} />
              <label className="page-admin__label">เบอร์โทร</label>
              <input className="input-field" value={memberForm.phone} onChange={(e) => setMemberForm((f) => ({ ...f, phone: e.target.value }))} />
              <label className="page-admin__label">อีเมล</label>
              <input type="email" className="input-field" value={memberForm.email} onChange={(e) => setMemberForm((f) => ({ ...f, email: e.target.value }))} />
              <label className="page-admin__label">วันเกิด</label>
              <input type="date" className="input-field" value={memberForm.birthday} onChange={(e) => setMemberForm((f) => ({ ...f, birthday: e.target.value }))} />
              <label className="page-admin__label">หมายเหตุ</label>
              <input className="input-field" value={memberForm.notes} onChange={(e) => setMemberForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
              <button type="button" className="btn-secondary" onClick={() => setMemberEdit(null)}>ยกเลิก</button>
              <button
                type="button"
                className="btn-primary"
                disabled={memberSaving}
                onClick={async () => {
                  if (!shopId || !memberEdit) return;
                  setMemberSaving(true); setMemberError(null);
                  const res = await fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/customers/${memberEdit.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      name: memberForm.name || undefined,
                      phone: memberForm.phone || undefined,
                      email: memberForm.email || undefined,
                      birthday: memberForm.birthday || undefined,
                      notes: memberForm.notes || undefined,
                    }),
                  });
                  const j = await res.json();
                  if (res.ok) {
                    setMemberEdit(null);
                    loadMembers();
                  } else setMemberError(j?.error?.message ?? 'บันทึกไม่สำเร็จ');
                  setMemberSaving(false);
                }}
              >
                {memberSaving ? 'กำลังบันทึก...' : 'บันทึก'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
