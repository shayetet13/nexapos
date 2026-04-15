'use client';

import React from 'react';

// ─── Types ────────────────────────────────────────────────────────
export interface Shop {
  id: string; name: string; shop_code: string | null;
  province: string | null; district: string | null; postal_code: string | null;
  created_at: string; promptpay_number?: string | null;
  is_active:  boolean;
  is_banned:  boolean;
  ban_reason: string | null;
}
export interface Branch { id: string; name: string; address: string | null; is_active: boolean; }
export interface ShopUser { user_id: string; email: string; role: string; branch_id: string | null; }
export interface DevStaffItem { user_id: string; nickname: string; role: string; branch_id: string | null; created_at: string; }
export interface Subscription { id: string; shop_id: string; plan: string; billing_interval: string; status: string; expires_at: string | null; }
export interface Notification { id: string; type: string; title: string; message: string | null; created_at: string; }

export interface OverviewShop {
  id: string; name: string; shop_code: string | null; province: string | null;
  created_at: string;
  revenue_today: number; revenue_period: number; order_count_period: number;
  branch_count: number; user_count: number;
  subscription: { plan: string; status: string; billing_interval: string; expires_at: string | null } | null;
}
export interface OverviewData {
  period: string; offset: number; period_label: string;
  total_shops: number; total_branches: number; total_users: number;
  revenue_today: number; revenue_period: number;
  shops: OverviewShop[];
  trend: { label: string; total: number; count: number }[];
}
export interface LeaderboardEntry {
  rank: number; shop_id: string; shop_name: string;
  revenue: number; order_count: number;
}
export interface LeaderboardData {
  period: string; offset: number; mode: string;
  key: string; label: string; snapshot_at: string | null;
  entries: LeaderboardEntry[];
}

export type TabId = 'overview' | 'leaderboard' | 'monitor' | 'shop' | 'branch' | 'user' | 'subscription' | 'notify' | 'reset' | 'analytics' | 'subs' | 'logs' | 'settings';

// ─── Micro components ──────────────────────────────────────────────
export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-xl ${className}`}>
      {children}
    </div>
  );
}

export function SectionHeader({ title, desc }: { title: string; desc?: string }) {
  return (
    <div className="px-6 py-4 border-b border-[var(--color-border)]">
      <h2 className="text-sm font-semibold text-[var(--color-text)]">{title}</h2>
      {desc && <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{desc}</p>}
    </div>
  );
}

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">{children}</label>;
}

export function DInput({ className = '', ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm placeholder:text-[var(--color-text-subtle)] focus:outline-none focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)] transition-colors ${className}`}
    />
  );
}

export function DSelect({ className = '', children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { children: React.ReactNode }) {
  return (
    <select
      {...props}
      className={`w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm focus:outline-none focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)] transition-colors ${className}`}
    >
      {children}
    </select>
  );
}

export function DTextarea({ className = '', ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm placeholder:text-[var(--color-text-subtle)] focus:outline-none focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)] transition-colors resize-none ${className}`}
    />
  );
}

export function Btn({ children, variant = 'primary', className = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' | 'warn' | 'success' }) {
  const variants = {
    primary: 'bg-[var(--color-primary)] text-black hover:bg-[var(--color-primary-hover)] font-semibold',
    ghost:   'border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg-hover)]',
    danger:  'border border-red-500/40 text-red-400 hover:bg-red-500/10',
    warn:    'border border-yellow-500/40 text-yellow-400 hover:bg-yellow-500/10',
    success: 'border border-green-500/40 text-green-400 hover:bg-green-500/10',
  };
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Badge({ color, children }: { color: 'green' | 'red' | 'blue' | 'yellow' | 'purple' | 'gray'; children: React.ReactNode }) {
  const colors = {
    green:  'bg-green-500/15 text-green-400 border-green-500/30',
    red:    'bg-red-500/15 text-red-400 border-red-500/30',
    blue:   'bg-blue-500/15 text-blue-400 border-blue-500/30',
    yellow: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
    purple: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
    gray:   'bg-gray-500/15 text-gray-400 border-gray-500/30',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${colors[color]}`}>
      {children}
    </span>
  );
}

export function Toast({ msg, onClose }: { msg: { type: 'ok' | 'err'; text: string }; onClose: () => void }) {
  return (
    <div
      className={`fixed top-4 right-4 z-50 flex items-start gap-3 px-4 py-3 rounded-xl border shadow-lg text-sm max-w-sm transition-all
        ${msg.type === 'ok'
          ? 'bg-green-950 border-green-700 text-green-300'
          : 'bg-red-950 border-red-700 text-red-300'}`}
    >
      <span>{msg.type === 'ok' ? '✓' : '✕'}</span>
      <span className="flex-1">{msg.text}</span>
      <button onClick={onClose} className="opacity-60 hover:opacity-100 ml-1">✕</button>
    </div>
  );
}

export function Mono({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-xs text-[var(--color-text-muted)]">{children}</span>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-[var(--color-text-muted)] italic py-4 text-center">{children}</p>;
}

export function formatCode(code: string): string {
  if (code.length !== 10) return code;
  return `${code.slice(0, 5)}-${code.slice(5, 8)}-${code.slice(8, 10)}`;
}

export const ROLE_COLORS: Record<string, 'blue' | 'green' | 'yellow' | 'gray' | 'purple'> = {
  owner: 'blue', manager: 'green', cashier: 'yellow', viewer: 'gray',
};

// ─── Overview helpers ──────────────────────────────────────────────
export function thb(n: number): string {
  return new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', maximumFractionDigits: 0 }).format(n);
}
export function daysUntil(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86_400_000);
}

export function StatCard({ icon, label, value, sub, accent }: {
  icon: string; label: string; value: string; sub?: string; accent?: boolean;
}) {
  return (
    <Card className={`p-4 flex items-start gap-3 ${accent ? 'border-[var(--color-primary)]/40' : ''}`}>
      <span className="text-2xl leading-none mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs text-[var(--color-text-muted)] truncate">{label}</p>
        <p className={`text-lg font-bold leading-tight mt-0.5 ${accent ? 'text-[var(--color-primary)]' : 'text-[var(--color-text)]'}`}>{value}</p>
        {sub && <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{sub}</p>}
      </div>
    </Card>
  );
}

export const chartTooltipStyle = {
  background: 'var(--color-bg-card)',
  border: '1px solid var(--color-border)',
  borderRadius: '8px',
  fontSize: '12px',
  color: 'var(--color-text)',
} as const;
