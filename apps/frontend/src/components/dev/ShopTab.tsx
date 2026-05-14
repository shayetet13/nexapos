'use client';

import React, { useState } from 'react';
import { PROVINCES, BKK_DISTRICTS, IS_BANGKOK } from '@/lib/thai-provinces';
import {
  Card, SectionHeader, FieldLabel, DInput, DSelect, Btn, Mono, formatCode,
  type Shop,
} from './dev-ui';

// ─── Status badge ─────────────────────────────────────────────────────────────

function ShopStatusBadge({ shop }: { shop: Shop }) {
  if (shop.is_banned) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-500/20 text-red-400 border border-red-500/40">
        🚫 แบนถาวร
      </span>
    );
  }
  if (!shop.is_active) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-yellow-500/20 text-yellow-400 border border-yellow-500/40">
        ⏸ ระงับ
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
      ✓ ใช้งาน
    </span>
  );
}

// ─── Ban modal ────────────────────────────────────────────────────────────────

interface BanModalProps {
  shop: Shop;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}

function BanModal({ shop, onConfirm, onClose }: BanModalProps) {
  const [reason, setReason] = useState('');
  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-red-500/40 bg-[var(--color-bg-card)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b border-red-500/20 bg-red-500/10 rounded-t-2xl">
          <p className="font-bold text-red-400 text-base">🚫 แบนร้านค้าถาวร</p>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">
            ร้าน <strong className="text-[var(--color-text)]">{shop.name}</strong> จะไม่สามารถเข้าใช้ระบบได้
          </p>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <FieldLabel>เหตุผลการแบน <span className="text-red-400">*</span></FieldLabel>
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="ระบุเหตุผล เช่น ละเมิดข้อกำหนด / ข้อมูลเท็จ / ฉ้อโกง"
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-red-500/50 placeholder-[var(--color-text-muted)]"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <Btn variant="ghost" onClick={onClose}>ยกเลิก</Btn>
            <Btn
              variant="danger"
              disabled={!reason.trim()}
              onClick={() => reason.trim() && onConfirm(reason.trim())}
            >
              🚫 ยืนยันการแบน
            </Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Delete confirmation modal ────────────────────────────────────────────────

interface DeleteModalProps {
  shop: Shop;
  onConfirm: () => void;
  onClose: () => void;
}

function DeleteModal({ shop, onConfirm, onClose }: DeleteModalProps) {
  const [typed, setTyped] = useState('');
  const confirmPhrase = shop.name;
  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-red-500/60 bg-[var(--color-bg-card)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b border-red-500/30 bg-red-500/15 rounded-t-2xl">
          <p className="font-bold text-red-300 text-base">🗑️ ลบร้านค้าถาวร</p>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">
            ข้อมูลทั้งหมด — ออเดอร์ สินค้า ลูกค้า พนักงาน — จะถูกลบถาวรและกู้คืนไม่ได้
          </p>
        </div>
        <div className="p-5 space-y-4">
          <div className="rounded-xl bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-300">
            ⚠️ กรุณาพิมพ์ <strong className="font-mono">{confirmPhrase}</strong> เพื่อยืนยัน
          </div>
          <DInput
            placeholder={`พิมพ์: ${confirmPhrase}`}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
          <div className="flex gap-2 justify-end">
            <Btn variant="ghost" onClick={onClose}>ยกเลิก</Btn>
            <Btn
              variant="danger"
              disabled={typed !== confirmPhrase}
              onClick={() => typed === confirmPhrase && onConfirm()}
            >
              🗑️ ลบถาวร
            </Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface ShopTabProps {
  shops:          Shop[];
  shopName:       string;
  shopProvince:   string;
  shopDistrict:   string;
  shopSearch:     string;
  filteredShops:  Shop[];
  q:              string;
  setShopName:    (v: string) => void;
  setShopProvince:(v: string) => void;
  setShopDistrict:(v: string) => void;
  setShopSearch:  (v: string) => void;
  onAddShop:      () => void;
  onToggleActive: (shop: Shop) => void;
  onBanShop:      (shop: Shop, reason: string) => void;
  onUnbanShop:    (shop: Shop) => void;
  onDeleteShop:   (shop: Shop) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ShopTab({
  shops, shopName, shopProvince, shopDistrict, shopSearch, filteredShops, q,
  setShopName, setShopProvince, setShopDistrict, setShopSearch, onAddShop,
  onToggleActive, onBanShop, onUnbanShop, onDeleteShop,
}: ShopTabProps) {
  const [banTarget,    setBanTarget]    = useState<Shop | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Shop | null>(null);

  return (
    <div className="space-y-4">
      {/* Modals */}
      {banTarget && (
        <BanModal
          shop={banTarget}
          onConfirm={(reason) => { onBanShop(banTarget, reason); setBanTarget(null); }}
          onClose={() => setBanTarget(null)}
        />
      )}
      {deleteTarget && (
        <DeleteModal
          shop={deleteTarget}
          onConfirm={() => { onDeleteShop(deleteTarget); setDeleteTarget(null); }}
          onClose={() => setDeleteTarget(null)}
        />
      )}

      {/* ── Create form ── */}
      <Card>
        <SectionHeader title="สร้างร้านใหม่" desc="กรอกข้อมูลร้านค้า ระบบจะ gen Shop ID อัตโนมัติ" />
        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <FieldLabel>ชื่อร้าน *</FieldLabel>
            <DInput placeholder="เช่น ร้านกาแฟสดใจดี" value={shopName} onChange={(e) => setShopName(e.target.value)} />
          </div>
          <div>
            <FieldLabel>จังหวัด</FieldLabel>
            <DSelect value={shopProvince} onChange={(e) => { setShopProvince(e.target.value); setShopDistrict(''); }}>
              <option value="">— เลือกจังหวัด —</option>
              {PROVINCES.map((p) => <option key={p.name} value={p.name}>{p.name} ({p.postal})</option>)}
            </DSelect>
          </div>
          {IS_BANGKOK(shopProvince) ? (
            <div>
              <FieldLabel>เขต *</FieldLabel>
              <DSelect value={shopDistrict} onChange={(e) => setShopDistrict(e.target.value)}>
                <option value="">— เลือกเขต —</option>
                {BKK_DISTRICTS.map((d) => <option key={d.name} value={d.name}>{d.name} ({d.postal})</option>)}
              </DSelect>
            </div>
          ) : shopProvince ? (
            <div className="flex items-end">
              <div className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-sm">
                <span className="text-[var(--color-text-muted)] text-xs">ปณ: </span>
                <span className="font-mono font-semibold text-[var(--color-primary)]">
                  {PROVINCES.find((p) => p.name === shopProvince)?.postal ?? '—'}
                </span>
                <span className="text-[var(--color-text-muted)] text-xs ml-2">→ Shop ID auto-gen</span>
              </div>
            </div>
          ) : <div />}
          <div className="md:col-span-2 flex justify-end">
            <Btn variant="primary" onClick={onAddShop} disabled={!shopName.trim()} className="px-6 py-2">
              + สร้างร้าน
            </Btn>
          </div>
        </div>
      </Card>

      {/* ── Search + table ── */}
      {shops.length > 0 && (
        <Card>
          <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center gap-3">
            <div className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] text-sm">🔍</span>
              <DInput
                className="pl-8 pr-8"
                placeholder="ค้นหา ชื่อร้าน / รหัสร้าน / เบอร์พร้อมเพย์ / รหัสไปรษณีย์"
                value={shopSearch}
                onChange={(e) => setShopSearch(e.target.value)}
              />
              {shopSearch && (
                <button onClick={() => setShopSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text)] text-xs">✕</button>
              )}
            </div>
            {q && (
              <span className="text-xs text-[var(--color-text-muted)] whitespace-nowrap shrink-0">
                {filteredShops.length}/{shops.length}
              </span>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)]">
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">รหัสร้าน</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">ชื่อร้าน</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">จังหวัด / เขต</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">พร้อมเพย์</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">สถานะ</th>
                  <th className="text-right px-4 py-2.5 text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {filteredShops.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-6 text-center text-sm text-[var(--color-text-muted)]">ไม่พบร้านที่ค้นหา</td></tr>
                ) : filteredShops.map((s) => (
                  <tr
                    key={s.id}
                    className={`transition-colors ${
                      s.is_banned ? 'bg-red-500/5 hover:bg-red-500/8' :
                      !s.is_active ? 'bg-yellow-500/5 hover:bg-yellow-500/8' :
                      'hover:bg-[var(--color-bg-hover)]'
                    }`}
                  >
                    <td className="px-4 py-3">
                      {s.shop_code
                        ? <span className="font-mono text-xs font-bold text-[var(--color-primary)]">{formatCode(s.shop_code)}</span>
                        : <span className="text-xs text-[var(--color-text-subtle)]">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-[var(--color-text)] font-medium">{s.name}</p>
                      {s.ban_reason && (
                        <p className="text-xs text-red-400 mt-0.5 truncate max-w-[180px]" title={s.ban_reason}>
                          เหตุผล: {s.ban_reason}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--color-text-muted)]">
                      {s.province ?? '—'}{s.district ? ` › ${s.district}` : ''}
                    </td>
                    <td className="px-4 py-3"><Mono>{s.promptpay_number ?? '—'}</Mono></td>
                    <td className="px-4 py-3">
                      <ShopStatusBadge shop={s} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        {/* Suspend / Unsuspend */}
                        {!s.is_banned && (
                          <button
                            type="button"
                            title={s.is_active ? 'ระงับชั่วคราว' : 'เปิดใช้งาน'}
                            onClick={() => onToggleActive(s)}
                            className={`px-2 py-1 rounded-lg text-xs font-medium transition-colors ${
                              s.is_active
                                ? 'bg-yellow-500/15 text-yellow-400 hover:bg-yellow-500/25'
                                : 'bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25'
                            }`}
                          >
                            {s.is_active ? '⏸ ระงับ' : '▶ เปิด'}
                          </button>
                        )}
                        {/* Ban / Unban */}
                        {s.is_banned ? (
                          <button
                            type="button"
                            title="ยกเลิกการแบน"
                            onClick={() => onUnbanShop(s)}
                            className="px-2 py-1 rounded-lg text-xs font-medium bg-blue-500/15 text-blue-400 hover:bg-blue-500/25 transition-colors"
                          >
                            ✓ ปลดแบน
                          </button>
                        ) : (
                          <button
                            type="button"
                            title="แบนถาวร"
                            onClick={() => setBanTarget(s)}
                            className="px-2 py-1 rounded-lg text-xs font-medium bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors"
                          >
                            🚫 แบน
                          </button>
                        )}
                        {/* Delete */}
                        <button
                          type="button"
                          title="ลบร้านถาวร"
                          onClick={() => setDeleteTarget(s)}
                          className="px-2 py-1 rounded-lg text-xs font-medium bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] hover:bg-red-500/20 hover:text-red-400 transition-colors"
                        >
                          🗑️
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
