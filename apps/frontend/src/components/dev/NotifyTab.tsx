'use client';

import React from 'react';
import {
  Card, SectionHeader, FieldLabel, DSelect, DInput, DTextarea, Btn, Badge, Mono,
  type Shop, type Notification,
} from './dev-ui';

interface NotifyTabProps {
  shops: Shop[];
  notifShopId: string;
  notifType: string;
  notifTitle: string;
  notifMessage: string;
  notifList: Record<string, Notification[]>;
  setNotifShopId: (v: string) => void;
  setNotifType: (v: string) => void;
  setNotifTitle: (v: string) => void;
  setNotifMessage: (v: string) => void;
  onLoadNotifications: (shopId: string) => void;
  onSendNotification: () => void;
}

export function NotifyTab({
  shops, notifShopId, notifType, notifTitle, notifMessage, notifList,
  setNotifShopId, setNotifType, setNotifTitle, setNotifMessage,
  onLoadNotifications, onSendNotification,
}: NotifyTabProps) {
  return (
    <div className="space-y-4">
      <Card>
        <SectionHeader title="ส่งแจ้งเตือนไปยังร้าน" desc="ระบบจะแสดงข้อความในหน้า dashboard ของร้าน" />
        <div className="p-6 space-y-4 max-w-md">
          <div>
            <FieldLabel>ร้าน</FieldLabel>
            <DSelect value={notifShopId} onChange={(e) => { setNotifShopId(e.target.value); onLoadNotifications(e.target.value); }}>
              {shops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </DSelect>
          </div>
          <div>
            <FieldLabel>ประเภท</FieldLabel>
            <DSelect value={notifType} onChange={(e) => setNotifType(e.target.value)}>
              <option value="renewal_reminder">🔔 เตือนต่ออายุ</option>
              <option value="payment_due">💳 ครบกำหนดชำระ</option>
              <option value="custom">✏️ อื่นๆ (custom)</option>
            </DSelect>
          </div>
          <div>
            <FieldLabel>หัวข้อ *</FieldLabel>
            <DInput placeholder="เช่น แจ้งเตือนต่ออายุบริการ" value={notifTitle} onChange={(e) => setNotifTitle(e.target.value)} />
          </div>
          <div>
            <FieldLabel>ข้อความ <span className="text-[var(--color-text-subtle)] font-normal">(ไม่บังคับ)</span></FieldLabel>
            <DTextarea placeholder="รายละเอียดเพิ่มเติม..." rows={3} value={notifMessage} onChange={(e) => setNotifMessage(e.target.value)} />
          </div>
          <Btn variant="primary" onClick={onSendNotification} disabled={!notifTitle.trim() || !notifShopId} className="w-full justify-center py-2">
            📤 ส่งแจ้งเตือน
          </Btn>
        </div>
      </Card>

      {/* Sent notifications list */}
      {notifList[notifShopId] && notifList[notifShopId].length > 0 && (
        <Card>
          <SectionHeader title="แจ้งเตือนที่ส่งไปแล้ว" />
          <div className="divide-y divide-[var(--color-border)]">
            {notifList[notifShopId].slice(0, 10).map((n) => (
              <div key={n.id} className="px-6 py-3 flex items-start gap-3">
                <span className="text-sm mt-0.5">
                  {n.type === 'renewal_reminder' ? '🔔' : n.type === 'payment_due' ? '💳' : '✏️'}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[var(--color-text)] truncate">{n.title}</p>
                  {n.message && <p className="text-xs text-[var(--color-text-muted)] truncate">{n.message}</p>}
                </div>
                <div className="shrink-0 text-right">
                  <Badge color="gray">{n.type}</Badge>
                  <p className="text-xs text-[var(--color-text-muted)] mt-1"><Mono>{new Date(n.created_at).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}</Mono></p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
