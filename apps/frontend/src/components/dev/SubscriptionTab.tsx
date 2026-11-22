'use client';

import React from 'react';
import {
  Card, SectionHeader, FieldLabel, DInput, DSelect, Btn, Badge,
  type Shop, type Subscription,
} from './dev-ui';

interface SubscriptionTabProps {
  shops: Shop[];
  subShopId: string;
  subPlan: string;
  subInterval: 'monthly' | 'yearly' | 'once';
  subExpires: string;
  subscriptions: Record<string, Subscription | null>;
  setSubShopId: (v: string) => void;
  setSubPlan: (v: string) => void;
  setSubInterval: (v: 'monthly' | 'yearly' | 'once') => void;
  setSubExpires: (v: string) => void;
  onLoadSubscription: (shopId: string) => void;
  onSaveSubscription: () => void;
}

export function SubscriptionTab({
  shops, subShopId, subPlan, subInterval, subExpires, subscriptions,
  setSubShopId, setSubPlan, setSubInterval, setSubExpires,
  onLoadSubscription, onSaveSubscription,
}: SubscriptionTabProps) {
  return (
    <Card>
      <SectionHeader title="จัดการการต่ออายุ" desc="ตั้งค่าแผนและวันหมดอายุของแต่ละร้าน" />
      <div className="p-6 space-y-4 max-w-md">
        <div>
          <FieldLabel>ร้าน</FieldLabel>
          <DSelect value={subShopId} onChange={(e) => { setSubShopId(e.target.value); onLoadSubscription(e.target.value); }}>
            {shops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </DSelect>
        </div>

        {subscriptions[subShopId] && (
          <div className="flex flex-wrap gap-2 items-center p-3 rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)] text-xs">
            <Badge color="blue">{subscriptions[subShopId]?.plan}</Badge>
            <Badge color="gray">{subscriptions[subShopId]?.billing_interval}</Badge>
            <span className="text-[var(--color-text-muted)]">
              หมดอายุ: {subscriptions[subShopId]?.expires_at ? new Date(subscriptions[subShopId]!.expires_at!).toLocaleDateString('th-TH') : '—'}
            </span>
          </div>
        )}

        <div>
          <FieldLabel>แผน</FieldLabel>
          <DInput placeholder="เช่น basic, pro, enterprise" value={subPlan} onChange={(e) => setSubPlan(e.target.value)} />
        </div>
        <div>
          <FieldLabel>ประเภทการคิดเงิน</FieldLabel>
          <DSelect value={subInterval} onChange={(e) => setSubInterval(e.target.value as 'monthly' | 'yearly' | 'once')}>
            <option value="monthly">รายเดือน</option>
            <option value="yearly">รายปี</option>
            <option value="once">ครั้งเดียว</option>
          </DSelect>
        </div>
        <div>
          <FieldLabel>วันหมดอายุ <span className="text-[var(--color-text-subtle)] font-normal">(ไม่บังคับ)</span></FieldLabel>
          <DInput type="date" value={subExpires} onChange={(e) => setSubExpires(e.target.value)} />
        </div>
        <Btn variant="primary" onClick={onSaveSubscription} disabled={!subShopId} className="w-full justify-center py-2">
          บันทึกการต่ออายุ
        </Btn>
      </div>
    </Card>
  );
}
