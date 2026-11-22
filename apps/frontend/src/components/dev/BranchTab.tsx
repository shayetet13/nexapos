'use client';

import React from 'react';
import {
  Card, SectionHeader, FieldLabel, DInput, DSelect, Btn, Badge, Mono,
  type Shop, type Branch,
} from './dev-ui';

interface BranchTabProps {
  shops: Shop[];
  branches: Branch[];
  branchShopId: string;
  branchName: string;
  branchAddress: string;
  setBranchShopId: (v: string) => void;
  setBranchName: (v: string) => void;
  setBranchAddress: (v: string) => void;
  onAddBranch: () => void;
}

export function BranchTab({
  shops, branches, branchShopId, branchName, branchAddress,
  setBranchShopId, setBranchName, setBranchAddress, onAddBranch,
}: BranchTabProps) {
  return (
    <Card>
      <SectionHeader title="เพิ่มสาขา" desc="เลือกร้านแล้วใส่ชื่อสาขา" />
      <div className="p-6 space-y-4 max-w-md">
        <div>
          <FieldLabel>ร้าน</FieldLabel>
          <DSelect value={branchShopId} onChange={(e) => setBranchShopId(e.target.value)}>
            {shops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </DSelect>
        </div>
        <div>
          <FieldLabel>ชื่อสาขา *</FieldLabel>
          <DInput placeholder="เช่น สาขาหลัก, สาขาสยาม" value={branchName} onChange={(e) => setBranchName(e.target.value)} />
        </div>
        <div>
          <FieldLabel>ที่อยู่ <span className="text-[var(--color-text-subtle)] font-normal">(ไม่บังคับ)</span></FieldLabel>
          <DInput placeholder="เช่น 123 ถ.สุขุมวิท กรุงเทพฯ" value={branchAddress} onChange={(e) => setBranchAddress(e.target.value)} />
        </div>
        <Btn variant="primary" onClick={onAddBranch} disabled={!branchName.trim()} className="w-full justify-center py-2">
          + สร้างสาขา
        </Btn>
      </div>

      {/* Branches list */}
      {branches.length > 0 && (
        <>
          <div className="border-t border-[var(--color-border)] px-6 py-3">
            <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">สาขาปัจจุบัน ({branches.length})</p>
          </div>
          <div className="px-6 pb-6 space-y-2">
            {branches.map((b) => (
              <div key={b.id} className="flex items-center gap-3 p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)]">
                <Badge color={b.is_active ? 'green' : 'gray'}>{b.is_active ? 'เปิด' : 'ปิด'}</Badge>
                <span className="flex-1 text-sm font-medium text-[var(--color-text)]">{b.name}</span>
                {b.address && <span className="text-xs text-[var(--color-text-muted)]">{b.address}</span>}
                <Mono>{b.id.slice(0, 8)}…</Mono>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}
