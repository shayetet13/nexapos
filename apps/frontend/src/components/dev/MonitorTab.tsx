'use client';

import React from 'react';
import {
  Card, SectionHeader, Badge, Btn, Mono, Empty, formatCode, ROLE_COLORS,
  type Shop, type Branch, type ShopUser, type DevStaffItem,
} from './dev-ui';

interface MonitorTabProps {
  shops: Shop[];
  expandedShop: string | null;
  monitorBranches: Record<string, Branch[]>;
  monitorUsers: Record<string, ShopUser[]>;
  monitorStaff: Record<string, DevStaffItem[]>;
  onLoadMonitorBranches: (shopId: string) => void;
  onToggleBranch: (branch: Branch, shopId: string) => void;
  onDeleteBranch: (branchId: string, shopId: string) => void;
  onDeleteUser: (userId: string, shopId: string) => void;
  onDeleteStaff: (userId: string, shopId: string) => void;
  onGoToSubscription: (shopId: string) => void;
  onGoToNotify: (shopId: string) => void;
}

export function MonitorTab({
  shops, expandedShop, monitorBranches, monitorUsers, monitorStaff,
  onLoadMonitorBranches, onToggleBranch, onDeleteBranch, onDeleteUser, onDeleteStaff,
  onGoToSubscription, onGoToNotify,
}: MonitorTabProps) {
  return (
    <Card>
      <SectionHeader title="ร้านทั้งหมดในระบบ" desc="คลิก ▼ เพื่อดูสาขา, ผู้ใช้, และพนักงาน" />
      {shops.length === 0 ? (
        <div className="p-6"><Empty>ยังไม่มีร้านในระบบ</Empty></div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">ชื่อร้าน</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">รหัสร้าน</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">จังหวัด</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">สร้าง</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {shops.map((s) => (
                <React.Fragment key={s.id}>
                  {/* ─ Shop row ─ */}
                  <tr className="hover:bg-[var(--color-bg-hover)] transition-colors">
                    <td className="px-4 py-3 font-medium text-[var(--color-text)]">{s.name}</td>
                    <td className="px-4 py-3">
                      {s.shop_code
                        ? <span className="font-mono text-xs text-[var(--color-primary)] font-semibold">{formatCode(s.shop_code)}</span>
                        : <span className="text-xs text-[var(--color-text-subtle)]">—</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--color-text-muted)]">
                      {s.province ?? '—'}{s.district ? ` › ${s.district}` : ''}
                    </td>
                    <td className="px-4 py-3"><Mono>{new Date(s.created_at).toLocaleDateString('th-TH')}</Mono></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 justify-end">
                        <Btn variant="ghost" onClick={() => onLoadMonitorBranches(s.id)} className="text-xs">
                          {expandedShop === s.id ? '▲ ซ่อน' : '▼ ดูรายละเอียด'}
                        </Btn>
                        <Btn variant="ghost" onClick={() => onGoToSubscription(s.id)} className="text-xs">💳</Btn>
                        <Btn variant="ghost" onClick={() => onGoToNotify(s.id)} className="text-xs">🔔</Btn>
                      </div>
                    </td>
                  </tr>

                  {/* ─ Expanded panel ─ */}
                  {expandedShop === s.id && (
                    <tr key={`${s.id}-detail`}>
                      <td colSpan={5} className="bg-[var(--color-bg)] px-4 py-4">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

                          {/* Branches */}
                          <div className="space-y-2">
                            <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
                              สาขา ({monitorBranches[s.id]?.length ?? 0})
                            </p>
                            {(monitorBranches[s.id]?.length ?? 0) === 0
                              ? <Empty>ยังไม่มีสาขา</Empty>
                              : (
                                <div className="space-y-1.5">
                                  {monitorBranches[s.id]?.map((b) => (
                                    <div key={b.id} className="flex items-center gap-2 p-2.5 rounded-lg bg-[var(--color-bg-card)] border border-[var(--color-border)]">
                                      <Badge color={b.is_active ? 'green' : 'gray'}>{b.is_active ? 'เปิด' : 'ปิด'}</Badge>
                                      <span className="flex-1 text-sm text-[var(--color-text)] truncate">{b.name}</span>
                                      {b.address && <span className="text-xs text-[var(--color-text-muted)] truncate max-w-[100px]">{b.address}</span>}
                                      <Mono>{b.id.slice(0, 6)}…</Mono>
                                      <div className="flex gap-1 shrink-0">
                                        <Btn variant={b.is_active ? 'warn' : 'success'} className="text-xs px-2 py-1" onClick={() => onToggleBranch(b, s.id)}>
                                          {b.is_active ? 'ปิด' : 'เปิด'}
                                        </Btn>
                                        <Btn variant="danger" className="text-xs px-2 py-1" onClick={() => onDeleteBranch(b.id, s.id)}>ลบ</Btn>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                          </div>

                          {/* Email users */}
                          <div className="space-y-2">
                            <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
                              ผู้ใช้ (อีเมล) ({monitorUsers[s.id]?.length ?? 0})
                            </p>
                            {(monitorUsers[s.id]?.length ?? 0) === 0
                              ? <Empty>ยังไม่มีผู้ใช้</Empty>
                              : (
                                <div className="space-y-1.5">
                                  {monitorUsers[s.id]?.map((u) => (
                                    <div key={u.user_id} className="flex items-center gap-2 p-2.5 rounded-lg bg-[var(--color-bg-card)] border border-[var(--color-border)]">
                                      <Badge color={ROLE_COLORS[u.role] ?? 'gray'}>{u.role}</Badge>
                                      <span className="flex-1 text-sm text-[var(--color-text)] truncate">{u.email}</span>
                                      {u.branch_id && (
                                        <Mono>
                                          {monitorBranches[s.id]?.find((b) => b.id === u.branch_id)?.name ?? u.branch_id.slice(0, 6) + '…'}
                                        </Mono>
                                      )}
                                      <Btn variant="danger" className="text-xs px-2 py-1 shrink-0" onClick={() => onDeleteUser(u.user_id, s.id)}>ลบ</Btn>
                                    </div>
                                  ))}
                                </div>
                              )}
                          </div>

                          {/* Staff (nickname + PIN) */}
                          <div className="space-y-2">
                            <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
                              พนักงาน PIN ({monitorStaff[s.id]?.length ?? 0})
                            </p>
                            {(monitorStaff[s.id]?.length ?? 0) === 0
                              ? <Empty>ยังไม่มีพนักงาน PIN</Empty>
                              : (
                                <div className="space-y-1.5">
                                  {monitorStaff[s.id]?.map((st) => (
                                    <div key={st.user_id} className="flex items-center gap-2 p-2.5 rounded-lg bg-[var(--color-bg-card)] border border-[var(--color-border)]">
                                      <Badge color={ROLE_COLORS[st.role] ?? 'gray'}>{st.role}</Badge>
                                      <span className="flex-1 text-sm font-medium text-[var(--color-text)] truncate">
                                        👤 {st.nickname}
                                      </span>
                                      {st.branch_id && (
                                        <Mono>
                                          {monitorBranches[s.id]?.find((b) => b.id === st.branch_id)?.name ?? st.branch_id.slice(0, 6) + '…'}
                                        </Mono>
                                      )}
                                      <Btn variant="danger" className="text-xs px-2 py-1 shrink-0" onClick={() => onDeleteStaff(st.user_id, s.id)}>ลบ</Btn>
                                    </div>
                                  ))}
                                </div>
                              )}
                          </div>

                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
