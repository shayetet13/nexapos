'use client';

import React from 'react';
import {
  Card, SectionHeader, FieldLabel, DInput, DSelect, Btn,
  type Shop, type Branch,
} from './dev-ui';

interface UserTabProps {
  shops: Shop[];
  userEmail: string;
  userPassword: string;
  userShopId: string;
  userRole: string;
  userBranchId: string;
  userBranches: Branch[];
  setUserEmail: (v: string) => void;
  setUserPassword: (v: string) => void;
  setUserShopId: (v: string) => void;
  setUserRole: (v: string) => void;
  setUserBranchId: (v: string) => void;
  onAddUser: () => void;
}

export function UserTab({
  shops, userEmail, userPassword, userShopId, userRole, userBranchId, userBranches,
  setUserEmail, setUserPassword, setUserShopId, setUserRole, setUserBranchId, onAddUser,
}: UserTabProps) {
  return (
    <Card>
      <SectionHeader title="เพิ่มผู้ใช้งาน" desc="สร้าง email + password สำหรับเจ้าของหรือพนักงาน" />
      <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl">
        <div className="md:col-span-2">
          <FieldLabel>ร้าน</FieldLabel>
          <DSelect value={userShopId} onChange={(e) => setUserShopId(e.target.value)}>
            {shops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </DSelect>
        </div>
        <div>
          <FieldLabel>อีเมล *</FieldLabel>
          <DInput type="email" placeholder="user@example.com" value={userEmail} onChange={(e) => setUserEmail(e.target.value)} />
        </div>
        <div>
          <FieldLabel>รหัสผ่าน *</FieldLabel>
          <DInput type="password" placeholder="อย่างน้อย 6 ตัวอักษร" value={userPassword} onChange={(e) => setUserPassword(e.target.value)} />
        </div>
        <div className="md:col-span-2">
          <FieldLabel>บทบาท</FieldLabel>
          <DSelect value={userRole} onChange={(e) => setUserRole(e.target.value)}>
            <option value="owner">เจ้าของร้าน (owner) — เข้าแดชบอร์ดได้</option>
            <option value="manager">ผู้จัดการ (manager) — เข้าแดชบอร์ดได้</option>
            <option value="cashier">แคชเชียร์ (cashier) — เข้า POS โดยตรง</option>
            <option value="viewer">ดูอย่างเดียว (viewer)</option>
          </DSelect>
        </div>
        {(userRole === 'cashier' || userRole === 'viewer') && (
          <div className="md:col-span-2">
            <FieldLabel>สาขาที่กำหนด <span className="text-[var(--color-text-subtle)] font-normal">(login แล้วไป POS สาขานี้เลย)</span></FieldLabel>
            <DSelect value={userBranchId} onChange={(e) => setUserBranchId(e.target.value)}>
              <option value="">— ไม่กำหนดสาขา (ให้เลือกเอง) —</option>
              {userBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </DSelect>
          </div>
        )}
        <div className="md:col-span-2 flex justify-end">
          <Btn variant="primary" onClick={onAddUser} disabled={!userEmail.trim() || !userPassword || !userShopId} className="px-6 py-2">
            + สร้างผู้ใช้
          </Btn>
        </div>
      </div>
    </Card>
  );
}
