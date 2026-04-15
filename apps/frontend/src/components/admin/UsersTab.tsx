'use client';

import { useState } from 'react';
import { Skeleton } from '@/components/ui/Skeleton';
import type { StaffItem } from '@/app/admin/adminReducer';

export interface ShopUser { user_id: string; email: string; role: string; branch_id: string | null; }
export interface Branch   { id: string; name: string; address?: string; }

const ROLE_LABELS: Record<string, string> = {
  owner: 'เจ้าของ', manager: 'ผู้จัดการ', cashier: 'แคชเชียร์', viewer: 'ผู้ดู',
};

interface Props {
  // ─── Email users ────────────────────────────────────────────────
  shopUsers: ShopUser[];
  usersLoading: boolean;
  inviteEmail: string; setInviteEmail: (v: string) => void;
  invitePassword: string; setInvitePassword: (v: string) => void;
  inviteRole: 'manager' | 'cashier' | 'viewer'; setInviteRole: (v: 'manager' | 'cashier' | 'viewer') => void;
  inviteBranchId: string; setInviteBranchId: (v: string) => void;
  inviteError: string | null;
  inviteSuccess: string | null;
  inviteCreated: { email: string; password: string } | null;
  setInviteCreated: (v: { email: string; password: string } | null) => void;
  inviting: boolean;
  editUserModal: ShopUser | null; setEditUserModal: (v: ShopUser | null) => void;
  editRole: 'manager' | 'cashier' | 'viewer'; setEditRole: (v: 'manager' | 'cashier' | 'viewer') => void;
  editBranchId: string; setEditBranchId: (v: string) => void;
  editSaving: boolean;
  branches: Branch[];
  inviteUser: () => void;
  openEditUser: (u: ShopUser) => void;
  saveEditUser: () => void;
  removeUser: (userId: string, email: string) => void;
  // ─── Staff (nickname + PIN) ──────────────────────────────────────
  staffList: StaffItem[];
  staffLoading: boolean;
  staffNickname: string; setStaffNickname: (v: string) => void;
  staffPin: string; setStaffPin: (v: string) => void;
  staffRole: 'manager' | 'cashier' | 'viewer'; setStaffRole: (v: 'manager' | 'cashier' | 'viewer') => void;
  staffBranchId: string; setStaffBranchId: (v: string) => void;
  staffError: string | null;
  staffSuccess: string | null;
  staffCreating: boolean;
  editStaffModal: StaffItem | null; setEditStaffModal: (v: StaffItem | null) => void;
  editStaffNickname: string; setEditStaffNickname: (v: string) => void;
  editStaffPin: string; setEditStaffPin: (v: string) => void;
  editStaffRole: 'manager' | 'cashier' | 'viewer'; setEditStaffRole: (v: 'manager' | 'cashier' | 'viewer') => void;
  editStaffBranchId: string; setEditStaffBranchId: (v: string) => void;
  editStaffSaving: boolean;
  editStaffError: string | null;
  createStaff: () => void;
  openEditStaff: (s: StaffItem) => void;
  saveEditStaffNickname: () => void;
  saveEditStaffPin: () => void;
  deleteStaff: (staffId: string, nickname: string) => void;
}

/** PIN validation: digits only, 4–13 chars */
function validPin(pin: string) { return /^\d{4,13}$/.test(pin); }

/** Toggle show/hide PIN */
function usePinVisible() {
  const [visible, setVisible] = useState(false);
  return { visible, toggle: () => setVisible((v) => !v) };
}

export function UsersTab({
  shopUsers, usersLoading,
  inviteEmail, setInviteEmail,
  invitePassword, setInvitePassword,
  inviteRole, setInviteRole,
  inviteBranchId, setInviteBranchId,
  inviteError, inviteSuccess,
  inviteCreated, setInviteCreated,
  inviting,
  editUserModal, setEditUserModal,
  editRole, setEditRole,
  editBranchId, setEditBranchId,
  editSaving,
  branches,
  inviteUser, openEditUser, saveEditUser, removeUser,
  staffList, staffLoading,
  staffNickname, setStaffNickname,
  staffPin, setStaffPin,
  staffRole, setStaffRole,
  staffBranchId, setStaffBranchId,
  staffError, staffSuccess, staffCreating,
  editStaffModal, setEditStaffModal,
  editStaffNickname, setEditStaffNickname,
  editStaffPin, setEditStaffPin,
  editStaffRole, setEditStaffRole,
  editStaffBranchId, setEditStaffBranchId,
  editStaffSaving, editStaffError,
  createStaff, openEditStaff, saveEditStaffNickname, saveEditStaffPin, deleteStaff,
}: Props) {
  const createPinVis = usePinVisible();
  const editPinVis   = usePinVisible();

  /** ข้อมูล modal แก้ไข staff — แสดง tab: ชื่อเล่น | PIN */
  const [editStaffTab, setEditStaffTab] = useState<'nickname' | 'pin'>('nickname');

  function handleOpenEditStaff(s: StaffItem) {
    setEditStaffTab('nickname');
    openEditStaff(s);
  }

  return (
    <div className="page-admin__tab-content">

      {/* ════ Section 1: Email users ════ */}
      <div className="page-admin__section">
        <h2 className="page-admin__title">ผู้ใช้ในระบบ (อีเมล)</h2>
        <p className="page-admin__section-desc">
          สำหรับเจ้าของร้านและผู้จัดการระดับสูงที่ต้องการเข้าถึงแดชบอร์ด
        </p>
      </div>

      {/* Invite email user form */}
      <div className="page-admin__card">
        <h3 className="page-admin__card-title">เพิ่มผู้ใช้ด้วยอีเมล</h3>
        <div className="page-admin__form">
          <div>
            <label className="page-admin__label">อีเมล</label>
            <input
              type="email"
              placeholder="employee@example.com"
              value={inviteEmail}
              onChange={(e) => { setInviteEmail(e.target.value); setInviteCreated(null); }}
              className="input-field"
            />
          </div>
          <div>
            <label className="page-admin__label">รหัสผ่าน</label>
            <input
              type="text"
              placeholder="เช่น abc123 (4–10 ตัว)"
              value={invitePassword}
              onChange={(e) => {
                const clean = e.target.value.replace(/[^a-z0-9]/g, '').slice(0, 10);
                setInvitePassword(clean);
              }}
              className="input-field"
              autoComplete="new-password"
            />
            <p className="page-admin__password-hint">
              ใช้ได้เฉพาะ <strong>a–z</strong> และ <strong>0–9</strong> · ยาว 4–10 ตัวอักษร
              {invitePassword.length > 0 && (
                <span className={`page-admin__pw-counter ${invitePassword.length >= 4 ? 'page-admin__pw-counter--ok' : 'page-admin__pw-counter--warn'}`}>
                  {' '}({invitePassword.length}/10)
                </span>
              )}
            </p>
          </div>
          <div className="page-admin__invite-row">
            <div className="page-admin__invite-field">
              <label className="page-admin__label">ตำแหน่ง</label>
              <select value={inviteRole} onChange={(e) => { setInviteRole(e.target.value as 'manager' | 'cashier' | 'viewer'); setInviteBranchId(''); }} className="page-admin__select">
                <option value="manager">ผู้จัดการ (manager)</option>
                <option value="cashier">แคชเชียร์ (cashier)</option>
                <option value="viewer">ผู้ดู (viewer)</option>
              </select>
            </div>
            {branches.length > 0 && (
              <div className="page-admin__invite-field">
                <label className="page-admin__label">สาขา{inviteRole === 'cashier' ? '' : ' (ไม่บังคับ)'}</label>
                <select value={inviteBranchId} onChange={(e) => setInviteBranchId(e.target.value)} className="page-admin__select">
                  <option value="">— ทุกสาขา —</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
            )}
          </div>
          <p className="page-admin__hint">
            {inviteRole === 'manager' && '👔 ผู้จัดการ: จัดการสินค้า + ดูออเดอร์ + แดชบอร์ด'}
            {inviteRole === 'cashier' && '🖥️ แคชเชียร์: ใช้ POS — ถ้าเลือกสาขา จะเข้า POS สาขานั้นอัตโนมัติ'}
            {inviteRole === 'viewer' && '👁️ ผู้ดู: ดูแดชบอร์ดเท่านั้น ไม่สามารถขายหรือแก้ไขได้'}
          </p>
          {inviteError   && <p className="page-admin__error">{inviteError}</p>}
          {inviteSuccess && <p className="page-admin__success">{inviteSuccess}</p>}
          {inviteCreated && (
            <div className="page-admin__credentials-box">
              <p className="page-admin__credentials-title">✅ บัญชีพร้อมใช้งาน — แจ้งพนักงาน:</p>
              <div className="page-admin__credentials-row">
                <span className="page-admin__credentials-label">อีเมล</span>
                <code className="page-admin__credentials-value">{inviteCreated.email}</code>
              </div>
              <div className="page-admin__credentials-row">
                <span className="page-admin__credentials-label">รหัสผ่าน</span>
                <code className="page-admin__credentials-value">{inviteCreated.password}</code>
              </div>
            </div>
          )}
          <div className="page-admin__form-actions">
            <button
              type="button"
              onClick={inviteUser}
              disabled={inviting || !inviteEmail.trim() || !/^[a-z0-9]{4,10}$/.test(invitePassword)}
              className="btn-primary"
            >
              {inviting ? 'กำลังเพิ่ม...' : '+ เพิ่มผู้ใช้'}
            </button>
          </div>
        </div>
      </div>

      {/* Email user list */}
      {usersLoading ? <Skeleton className="h-40 w-full" /> : (
        <ul className="page-admin__users-list">
          {shopUsers.map((u) => (
            <li key={u.user_id} className="page-admin__user-item">
              <div className="page-admin__user-info">
                <span className="page-admin__user-email">{u.email}</span>
                <span className={`page-admin__role-badge page-admin__role-badge--${u.role}`}>
                  {ROLE_LABELS[u.role] ?? u.role}
                </span>
                {u.branch_id && (
                  <span className="page-admin__user-branch">
                    {branches.find((b) => b.id === u.branch_id)?.name ?? u.branch_id}
                  </span>
                )}
              </div>
              {u.role !== 'owner' && (
                <div className="page-admin__list-actions">
                  <button type="button" onClick={() => openEditUser(u)} className="page-admin__btn-sm">แก้ไข</button>
                  <button type="button" onClick={() => removeUser(u.user_id, u.email)} className="page-admin__btn-sm page-admin__btn-danger">ลบ</button>
                </div>
              )}
            </li>
          ))}
          {shopUsers.length === 0 && <li className="page-admin__empty">ยังไม่มีผู้ใช้อื่น</li>}
        </ul>
      )}

      {/* ════ Section 2: Staff (nickname + PIN) ════ */}
      <div className="page-admin__section page-admin__section--staff">
        <h2 className="page-admin__title">พนักงาน (ชื่อเล่น + PIN)</h2>
        <p className="page-admin__section-desc">
          สำหรับแคชเชียร์และพนักงานที่ใช้หน้า POS — ไม่จำเป็นต้องมีอีเมล
        </p>
      </div>

      {/* Create staff form */}
      <div className="page-admin__card">
        <h3 className="page-admin__card-title">เพิ่มพนักงานใหม่</h3>
        <div className="page-admin__form">
          <div className="page-admin__invite-row">
            <div className="page-admin__invite-field">
              <label className="page-admin__label">ชื่อเล่น</label>
              <input
                type="text"
                placeholder="เช่น แมว, apple, staff_01"
                value={staffNickname}
                onChange={(e) => setStaffNickname(e.target.value.toLowerCase())}
                className="input-field"
                autoComplete="off"
                maxLength={50}
              />
              <p className="page-admin__hint" style={{ marginTop: 4 }}>
                ใช้ได้: ภาษาไทย · อังกฤษตัวเล็ก · ตัวเลข · _ เท่านั้น
              </p>
            </div>
            <div className="page-admin__invite-field">
              <label className="page-admin__label">PIN (4–13 หลัก)</label>
              <div className="page-admin__pin-input-wrap">
                <input
                  type={createPinVis.visible ? 'text' : 'password'}
                  placeholder="ตัวเลขเท่านั้น"
                  value={staffPin}
                  onChange={(e) => setStaffPin(e.target.value.replace(/\D/g, '').slice(0, 13))}
                  className="input-field"
                  inputMode="numeric"
                  autoComplete="new-password"
                />
                <button type="button" onClick={createPinVis.toggle} className="page-admin__pin-toggle" title="แสดง/ซ่อน PIN">
                  {createPinVis.visible ? '🙈' : '👁️'}
                </button>
              </div>
              {staffPin.length > 0 && !validPin(staffPin) && (
                <p className="page-admin__error-hint">PIN ต้องเป็นตัวเลข 4–13 หลัก ({staffPin.length} หลัก)</p>
              )}
            </div>
          </div>
          <div className="page-admin__invite-row">
            <div className="page-admin__invite-field">
              <label className="page-admin__label">ตำแหน่ง</label>
              <select value={staffRole} onChange={(e) => { setStaffRole(e.target.value as 'manager' | 'cashier' | 'viewer'); setStaffBranchId(''); }} className="page-admin__select">
                <option value="manager">ผู้จัดการ (manager)</option>
                <option value="cashier">แคชเชียร์ (cashier)</option>
                <option value="viewer">ผู้ดู (viewer)</option>
              </select>
            </div>
            {branches.length > 0 && (
              <div className="page-admin__invite-field">
                <label className="page-admin__label">สาขา (ไม่บังคับ)</label>
                <select value={staffBranchId} onChange={(e) => setStaffBranchId(e.target.value)} className="page-admin__select">
                  <option value="">— ทุกสาขา —</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
            )}
          </div>
          <p className="page-admin__hint">
            🖥️ พนักงานเข้าสู่ระบบที่หน้า <strong>เข้าสู่ระบบพนักงาน</strong> ด้วยชื่อเล่น + PIN เท่านั้น — ไม่ต้องระบุร้านหรืออีเมล
          </p>
          {staffError   && <p className="page-admin__error">{staffError}</p>}
          {staffSuccess && <p className="page-admin__success">{staffSuccess}</p>}
          <div className="page-admin__form-actions">
            <button
              type="button"
              onClick={createStaff}
              disabled={staffCreating || !staffNickname.trim() || !validPin(staffPin)}
              className="btn-primary"
            >
              {staffCreating ? 'กำลังเพิ่ม...' : '+ เพิ่มพนักงาน'}
            </button>
          </div>
        </div>
      </div>

      {/* Staff list */}
      {staffLoading ? <Skeleton className="h-40 w-full" /> : (
        <ul className="page-admin__users-list">
          {staffList.map((s) => (
            <li key={s.user_id} className="page-admin__user-item">
              <div className="page-admin__user-info">
                <span className="page-admin__staff-icon">👤</span>
                <span className="page-admin__user-email page-admin__user-nickname">{s.nickname}</span>
                <span className={`page-admin__role-badge page-admin__role-badge--${s.role}`}>
                  {ROLE_LABELS[s.role] ?? s.role}
                </span>
                {s.branch_id && (
                  <span className="page-admin__user-branch">
                    {branches.find((b) => b.id === s.branch_id)?.name ?? s.branch_id}
                  </span>
                )}
                <span className="page-admin__staff-pin-label">🔑 PIN</span>
              </div>
              <div className="page-admin__list-actions">
                <button type="button" onClick={() => handleOpenEditStaff(s)} className="page-admin__btn-sm">แก้ไข</button>
                <button type="button" onClick={() => deleteStaff(s.user_id, s.nickname)} className="page-admin__btn-sm page-admin__btn-danger">ลบ</button>
              </div>
            </li>
          ))}
          {staffList.length === 0 && <li className="page-admin__empty">ยังไม่มีพนักงาน — กดเพิ่มพนักงานด้านบน</li>}
        </ul>
      )}

      {/* ════ Edit email user modal ════ */}
      {editUserModal && (
        <div className="page-admin__modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setEditUserModal(null); }}>
          <div className="page-admin__modal">
            <h3 className="page-admin__card-title">แก้ไขสิทธิ์ — {editUserModal.email}</h3>
            <div className="page-admin__form">
              <div>
                <label className="page-admin__label">ตำแหน่ง</label>
                <select value={editRole} onChange={(e) => setEditRole(e.target.value as 'manager' | 'cashier' | 'viewer')} className="page-admin__select">
                  <option value="manager">ผู้จัดการ (manager)</option>
                  <option value="cashier">แคชเชียร์ (cashier)</option>
                  <option value="viewer">ผู้ดู (viewer)</option>
                </select>
              </div>
              {branches.length > 0 && (
                <div>
                  <label className="page-admin__label">สาขา (ไม่บังคับ)</label>
                  <select value={editBranchId} onChange={(e) => setEditBranchId(e.target.value)} className="page-admin__select">
                    <option value="">— ทุกสาขา —</option>
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
              )}
              <div className="page-admin__form-actions">
                <button type="button" onClick={() => setEditUserModal(null)} className="btn-secondary">ยกเลิก</button>
                <button type="button" onClick={saveEditUser} disabled={editSaving} className="btn-primary">
                  {editSaving ? 'กำลังบันทึก...' : 'บันทึก'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ════ Edit staff modal ════ */}
      {editStaffModal && (
        <div className="page-admin__modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setEditStaffModal(null); }}>
          <div className="page-admin__modal">
            <h3 className="page-admin__card-title">แก้ไขพนักงาน — {editStaffModal.nickname}</h3>

            {/* Tab switcher */}
            <div className="page-admin__staff-edit-tabs">
              <button
                type="button"
                className={`page-admin__staff-edit-tab${editStaffTab === 'nickname' ? ' page-admin__staff-edit-tab--active' : ''}`}
                onClick={() => setEditStaffTab('nickname')}
              >
                ✏️ เปลี่ยนชื่อเล่น
              </button>
              <button
                type="button"
                className={`page-admin__staff-edit-tab${editStaffTab === 'pin' ? ' page-admin__staff-edit-tab--active' : ''}`}
                onClick={() => setEditStaffTab('pin')}
              >
                🔑 เปลี่ยน PIN
              </button>
            </div>

            <div className="page-admin__form">
              {editStaffTab === 'nickname' ? (
                <div>
                  <label className="page-admin__label">ชื่อเล่นใหม่</label>
                  <input
                    type="text"
                    value={editStaffNickname}
                    onChange={(e) => setEditStaffNickname(e.target.value.toLowerCase())}
                    className="input-field"
                    autoComplete="off"
                    maxLength={50}
                  />
                  <p className="page-admin__hint" style={{ marginTop: 4 }}>
                    ใช้ได้: ภาษาไทย · อังกฤษตัวเล็ก · ตัวเลข · _
                  </p>
                </div>
              ) : (
                <div>
                  <label className="page-admin__label">PIN ใหม่ (4–13 หลัก)</label>
                  <div className="page-admin__pin-input-wrap">
                    <input
                      type={editPinVis.visible ? 'text' : 'password'}
                      placeholder="ตัวเลขเท่านั้น"
                      value={editStaffPin}
                      onChange={(e) => setEditStaffPin(e.target.value.replace(/\D/g, '').slice(0, 13))}
                      className="input-field"
                      inputMode="numeric"
                      autoComplete="new-password"
                    />
                    <button type="button" onClick={editPinVis.toggle} className="page-admin__pin-toggle" title="แสดง/ซ่อน PIN">
                      {editPinVis.visible ? '🙈' : '👁️'}
                    </button>
                  </div>
                  {editStaffPin.length > 0 && !validPin(editStaffPin) && (
                    <p className="page-admin__error-hint">PIN ต้องเป็นตัวเลข 4–13 หลัก</p>
                  )}
                </div>
              )}

              {editStaffError && <p className="page-admin__error">{editStaffError}</p>}

              <div className="page-admin__form-actions">
                <button type="button" onClick={() => setEditStaffModal(null)} className="btn-secondary">ยกเลิก</button>
                {editStaffTab === 'nickname' ? (
                  <button
                    type="button"
                    onClick={saveEditStaffNickname}
                    disabled={editStaffSaving || !editStaffNickname.trim()}
                    className="btn-primary"
                  >
                    {editStaffSaving ? 'กำลังบันทึก...' : 'บันทึกชื่อเล่น'}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={saveEditStaffPin}
                    disabled={editStaffSaving || !validPin(editStaffPin)}
                    className="btn-primary"
                  >
                    {editStaffSaving ? 'กำลังบันทึก...' : 'บันทึก PIN'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
