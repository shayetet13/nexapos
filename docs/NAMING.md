# NexaPos — Naming Reference

> อ้างอิง "หน้าจอ/ส่วนต่างๆ เรียกว่าอะไรในโค้ด" · ใช้เปิดพร้อมกันขณะเขียนโค้ด

---

## Table of Contents

1. [Pages (Routes)](#1-pages-routes)
2. [Components](#2-components)
3. [Admin Page Tabs](#3-admin-page-tabs)
4. [POS Modals & Panels](#4-pos-modals--panels)
5. [Stock Page Components](#5-stock-page-components)
6. [Dev Page Components](#6-dev-page-components)
7. [Shared Types & Enums](#7-shared-types--enums)
8. [Custom Hooks](#8-custom-hooks)
9. [Lib Utilities](#9-lib-utilities)
10. [Database Entities → Thai Name](#10-database-entities--thai-name)
11. [API Response Format](#11-api-response-format)
12. [WebSocket Events](#12-websocket-events)
13. [CSS Class Naming Convention](#13-css-class-naming-convention)

---

## 1. Pages (Routes)

| เรียกว่าอะไร (ภาษาไทย) | URL Route | Root CSS Class | ไฟล์ | Auth |
|----------------------|-----------|---------------|------|------|
| หน้าแรก / Landing Page | `/` | `.lp-root` | `app/page.tsx` | ❌ |
| หน้า Login | `/login` | `.page-login` | `app/login/page.tsx` | ❌ |
| หน้า QR Login (desktop) | `/qr-login` | `.page-login-qr` | `app/qr-login/page.tsx` | ❌ |
| หน้า QR Auth (mobile scan) | `/qr-auth` | — | `app/qr-auth/page.tsx` | ❌ |
| หน้าสมัครบัญชี | `/register` | (multi-step) | `app/register/page.tsx` | ❌ |
| หน้าเพิ่มพนักงาน (invite) | `/register/[shopId]` | (invite form) | `app/register/[shopId]/page.tsx` | ❌ |
| หน้าลืมรหัสผ่าน | `/forgot-password` | — | `app/forgot-password/page.tsx` | ❌ |
| หน้าเลือกร้านค้า | `/select-shop` | `.page-select-shop` | `app/select-shop/page.tsx` | ✅ |
| หน้าเลือกสาขา | `/select-branch` | — | `app/select-branch/page.tsx` | ✅ |
| **หน้าขาย (POS)** | `/pos` | `.pos-wrap` | `app/pos/page.tsx` | ✅ |
| **แดชบอร์ด / ภาพรวม** | `/dashboard` | `.dash` | `app/dashboard/page.tsx` | ✅ owner/mgr |
| **จัดการร้าน (Admin)** | `/admin` | `.page-admin` | `app/admin/page.tsx` | ✅ owner/mgr |
| **จัดการสต๊อก** | `/stock` | `.inv__wrap` (inner) | `app/stock/page.tsx` | ✅ owner/mgr |
| **รายงาน P&L** | `/reports` | `.rpt__page` | `app/reports/page.tsx` | ✅ owner/mgr + feature |
| **หน้าจอลูกค้า / Customer Display** | `/pay` | `.pd-wrap` | `app/pay/page.tsx` | ❌ (display only) |
| หน้าใบเสร็จออนไลน์ | `/receipt/[token]` | `.rcpt-page` | `app/receipt/[token]/page.tsx` | ❌ |
| หน้าเบิกของ | `/withdraw` | `.withdraw-wrap` | `app/withdraw/page.tsx` | ✅ |
| หน้าคืนเงิน | `/refund` | — | `app/refund/page.tsx` | ✅ |
| หน้าการแจ้งเตือน | `/notifications` | — | `app/notifications/page.tsx` | ✅ |
| หน้าแพ็กเกจ / Subscription | `/subscription` | — | `app/subscription/page.tsx` | ✅ |
| หน้า Developer | `/dev` | — | `app/dev/page.tsx` | ✅ dev-only |
| หน้า QR Preview | `/dev/qr-preview` | — | `app/dev/qr-preview/page.tsx` | ❌ |
| ลงทะเบียนสมาชิก (self) | `/register/[shopId]` | — | `app/register/[shopId]/page.tsx` | ❌ |

> **หมายเหตุ:** Root CSS Class = className ของ element บนสุดใน return statement ของ page

---

## 2. Components

### Layout Components

| เรียกว่า | Component Name | ไฟล์ | ใช้ใน |
|---------|---------------|------|-------|
| แถบนำทางบน (ทุกหน้า admin/dash) | `AuthHeader` | `components/layout/AuthHeader.tsx` | dashboard, admin, stock, reports, notifications, subscription |

### POS Components

| เรียกว่า | Component Name | ไฟล์ |
|---------|---------------|------|
| ตะกร้าสินค้า | `CartPanel` | `components/pos/CartPanel.tsx` |
| Modal ชำระเงิน | `CheckoutModal` | `components/pos/CheckoutModal.tsx` |
| Modal ชำระสำเร็จ | `SuccessModal` | `components/pos/SuccessModal.tsx` |
| Modal รายละเอียดออเดอร์ | `OrderDetailModal` | `components/pos/OrderDetailModal.tsx` |
| แผงออเดอร์วันนี้ | `TodayOrdersPanel` | `components/pos/TodayOrdersPanel.tsx` |
| Modal login admin (override) | `AdminLoginModal` | `components/pos/AdminLoginModal.tsx` |
| Modal อนุมัติเบิกของ | `WithdrawalApprovalModal` | `components/pos/WithdrawalApprovalModal.tsx` |
| Modal link หน้าจอลูกค้า | `CustomerDisplayLinkModal` | `components/pos/CustomerDisplayLinkModal.tsx` |

### Admin Components

| เรียกว่า | Component Name | ไฟล์ |
|---------|---------------|------|
| Tab สินค้า | `ProductsTab` | `components/admin/ProductsTab.tsx` |
| Tab สต๊อก (admin) | `StockTab` | `components/admin/StockTab.tsx` |
| Tab ออเดอร์ | `OrdersTab` | `components/admin/OrdersTab.tsx` |
| Tab พนักงาน | `UsersTab` | `components/admin/UsersTab.tsx` |
| Tab สมาชิก | `MembersTab` | `components/admin/MembersTab.tsx` |
| Tab ตั้งค่าร้าน | `SettingsTab` | `components/admin/SettingsTab.tsx` |
| Tab QR พนักงาน | `StaffQrTab` | `components/admin/StaffQrTab.tsx` |
| Tab ประวัติการใช้งาน | `AuditTab` | `components/admin/AuditTab.tsx` |

### Stock Page Components

| เรียกว่า | Component Name | ไฟล์ |
|---------|---------------|------|
| Modal สร้างสินค้าใหม่ | `NewProductModal` | `components/stock/NewProductModal.tsx` |
| Modal เพิ่มสต๊อก | `AddStockModal` | `components/stock/AddStockModal.tsx` |
| Modal แก้ไขสต๊อก | `EditStockModal` | `components/stock/EditStockModal.tsx` |
| Modal โอนสต๊อก | `TransferModal` | `components/stock/TransferModal.tsx` |
| Modal ยืนยันลบ | `ConfirmDeleteModal` | `components/stock/ConfirmDeleteModal.tsx` |
| เลือกหน่วยนับ | `UnitPickerModal` | `components/stock/UnitPickerModal.tsx` |
| Tab วัตถุดิบสิ้นเปลือง | `ConsumablesTab` | `components/stock/ConsumablesTab.tsx` |

### Core / Shared Components

| เรียกว่า | Component Name | ไฟล์ |
|---------|---------------|------|
| แผงลูกค้า (POS sidebar) | `CustomersPanel` | `components/CustomersPanel.tsx` |
| แผงโปรโมชั่น (POS sidebar) | `PromotionsPanel` | `components/PromotionsPanel.tsx` |
| ลิงก์ไป POS | `GoToPOSLink` | `components/GoToPOSLink.tsx` |
| กระดิ่งแจ้งเตือน | `NotificationBell` | `components/NotificationBell.tsx` |
| ล็อค feature (ต้อง upgrade) | `UpgradeGate` | `components/UpgradeGate.tsx` |
| แถบติดตั้ง PWA | `PWAInstall` | `components/PWAInstall.tsx` |
| ปุ่มเปลี่ยนธีม | `ThemeSwitcher` | `components/ThemeSwitcher.tsx` |
| CSS ของปุ่มเปลี่ยนธีม | `ThemeSwitcherStyles` | `components/ThemeSwitcherStyles.tsx` |

### UI Primitives

| เรียกว่า | Component Name | ไฟล์ |
|---------|---------------|------|
| Loading placeholder | `Skeleton` | `components/ui/Skeleton.tsx` |
| ยืนยันก่อนลบ (dialog) | `ConfirmDialog` | `components/ui/ConfirmDialog.tsx` |

---

## 3. Admin Page Tabs

> หน้า `/admin` มี tab bar ด้านบน — แต่ละ tab render component ต่างกัน

| Tab Label (UI) | Component | Key |
|---------------|-----------|-----|
| 🛍 สินค้า | `ProductsTab` | `'products'` |
| 📦 สต๊อก | `StockTab` | `'stock'` |
| 🧾 ออเดอร์ | `OrdersTab` | `'orders'` |
| 👥 พนักงาน | `UsersTab` | `'users'` |
| 🎁 สมาชิก | `MembersTab` | `'members'` |
| ⚙️ ตั้งค่า | `SettingsTab` | `'settings'` |
| 📱 QR พนักงาน | `StaffQrTab` | `'staffqr'` |
| 🔍 ประวัติ | `AuditTab` | `'audit'` |

---

## 4. POS Modals & Panels

### CheckoutModal — วิธีชำระเงิน

```
CheckoutModal
├─ method = 'cash'      → cash input + change calculator
├─ method = 'transfer'  → bank transfer info
├─ method = 'qr'        → PromptPay QR (EMV standard)
│                           generatePromptPayPayload(amount, promptpayNumber)
└─ method = 'card'      → card payment confirmation
```

### SuccessModal — หลังชำระสำเร็จ

```
SuccessModal
├─ แสดง: order #, วันที่, วิธีชำระ, ยอดสุทธิ, เงินทอน, แต้มที่ได้
├─ auto-close หลัง 15 วินาที
└─ ปุ่ม: onPrint() → thermal printer / window.print()
```

### OrderDetailModal — รายละเอียดออเดอร์เก่า

```
OrderDetailModal
├─ shop name + branch
├─ order metadata (date, payment, status)
├─ items table (qty × unit_price = subtotal)
├─ totals (discount, VAT, grand total)
└─ ปุ่ม "🖨️ Export PDF" → window.print()
```

### TodayOrdersPanel — ประวัติออเดอร์วันนี้

```
TodayOrdersPanel (slide-in from right)
├─ filter by status (all / paid / void)
├─ แต่ละรายการ: time, #seq, amount, status badge
└─ click → เปิด OrderDetailModal
```

---

## 5. Stock Page Components

> หน้า `/stock` ใช้ component จาก `components/stock/`

| UI Section | Component | Notes |
|-----------|-----------|-------|
| หน้า stock หลัก | `StockPage` (page.tsx) | `.inv__wrap` (inner container) |
| Tab สต๊อกสินค้า | (inline in page) | `.stk__root` |
| Tab วัตถุดิบ | `ConsumablesTab` | |
| ฟอร์มสร้างสินค้า | `NewProductModal` | |
| ฟอร์มแก้ไข/เพิ่มสต๊อก | `EditStockModal` / `AddStockModal` | |
| โอนสต๊อกข้ามสาขา | `TransferModal` | |
| ลบสินค้า | `ConfirmDeleteModal` | |
| เลือกหน่วยนับ | `UnitPickerModal` | |

---

## 6. Dev Page Components

> หน้า `/dev` — developer tools (owner dev-only)

| Tab | Component | ไฟล์ |
|-----|-----------|------|
| Overview | `OverviewTab` | `components/dev/OverviewTab.tsx` |
| Leaderboard | `LeaderboardTab` | `components/dev/LeaderboardTab.tsx` |
| Monitor | `MonitorTab` | `components/dev/MonitorTab.tsx` |
| ร้านค้า | `ShopTab` | `components/dev/ShopTab.tsx` |
| สาขา | `BranchTab` | `components/dev/BranchTab.tsx` |
| User | `UserTab` | `components/dev/UserTab.tsx` |
| Subscription | `SubscriptionTab` / `SubsManagerTab` | |
| Notifications | `NotifyTab` | |
| Reset | `ResetTab` | |
| Logs | `LogsTab` | |
| Analytics | `AnalyticsTab` | |
| Settings | `SettingsTab` (dev) | |

---

## 7. Shared Types & Enums

> ไฟล์: `packages/shared/src/types.ts`

### Branded ID Types
```typescript
type ShopId     = string & { readonly brand: unique symbol }
type BranchId   = string & { readonly brand: unique symbol }
type UserId     = string & { readonly brand: unique symbol }
type ProductId  = string & { readonly brand: unique symbol }
type OrderId    = string & { readonly brand: unique symbol }
type CustomerId = string & { readonly brand: unique symbol }
```

### Enums
```typescript
type Role = 'owner' | 'manager' | 'cashier' | 'viewer'

type OrderStatus = 'pending' | 'paid' | 'void' | 'refunded'

type PaymentMethod = 'cash' | 'card' | 'transfer' | 'other'

type CustomerTier = 'bronze' | 'silver' | 'gold'

type PlanBillingInterval = 'monthly' | 'yearly' | 'once'

type SubscriptionStatus = 'active' | 'cancelled' | 'past_due'

type StockTransactionType = 'manual_set' | 'manual_add' | 'sale_deduct' | 'adjustment'

type WithdrawalStatus = 'pending' | 'approved' | 'rejected'
```

### POS Types (`components/pos/pos-types.ts`)
```typescript
interface Product { id, name, price, cost_price, image_url, sku, category, show_on_pos, ... }
interface CartItem { product: Product, quantity: number }
interface PosStats { dailyTotal, orderCount, ... }
interface TodayOrder { id, orderNumber, dailySeq, total, status, paymentMethod, createdAt }
interface OrderDetail { order: Order, items: OrderItem[], branch, user }
```

### Helpers ใน pos-types
```typescript
generatePromptPayPayload(amount, promptpayNumber)  // สร้าง EMV QR string
bkkToday()                    // วันปัจจุบัน timezone Bangkok
isBirthdayToday(birthday)     // เช็กวันเกิดตรงวันนี้ไหม
isBirthdayWithin7Days(birthday) // เช็ก 7 วันหน้า
```

---

## 8. Custom Hooks

### `useShopBranch(options?)` — `hooks/useShopBranch.ts`

**ใช้:** Dashboard, Reports, Stock, Admin, POS

```typescript
const {
  shops,        // Shop[]
  shopId,       // string | null
  setShopId,    // (id: string) => void
  branches,     // Branch[]
  branchId,     // string
  setBranchId,  // (id: string) => void
  isLoading,    // boolean
  error,        // string | null
  reload,       // () => void
} = useShopBranch({ fetchBranches?: boolean, autoLoad?: boolean })
```

**Behavior:**
- Auto-load shops on mount
- Auto-load branches เมื่อ shopId เปลี่ยน
- Auto-select first active branch

---

### `useFeatureGate(shopId)` — `hooks/useFeatureGate.ts`

**ใช้:** Reports (gated), Stock, Subscription page

```typescript
const {
  features,       // string[]   — list of enabled features
  planId,         // string     — 'free' | 'basic' | 'pro' | ...
  planName,       // string
  isTrial,        // boolean
  trialDaysLeft,  // number | null
  hasFeature,     // (key: string) => boolean
} = useFeatureGate(shopId)
```

**Feature Keys ที่ใช้:**
- `'reports_advanced'` — หน้า Reports P&L
- `'membership'` — ระบบสมาชิก
- `'promotions'` — โปรโมชั่น/คอมโบ
- `'multi_branch'` — หลายสาขา

---

## 9. Lib Utilities

### `lib/supabase.ts`

```typescript
createSupabaseClient()        // get/create singleton Supabase client
getAuthToken()                // get fresh access token (auto-refresh)
fetchWithAuth(url, options)   // fetch() + Bearer token + 401 retry logic
```

**401 Flow:** auto-refresh → retry 1 ครั้ง → ถ้ายัง fail → redirect `/login`

### `lib/config.ts`

```typescript
API_URL        // Cloudflare Worker URL (http://localhost:4000 in dev)
API_URL_DIRECT // Direct Fastify URL (WebSocket + display)
WS_URL         // WebSocket URL (http→ws auto-convert)
```

### `lib/utils.ts`

```typescript
cn(...classes)  // classname combiner (filter + join)
```

### `lib/locales/th.ts`

Thai labels สำหรับ POS, forms, error messages, payment methods, order statuses

### `lib/thai-provinces.ts`

```typescript
IS_BANGKOK(province)  // boolean
```
รายชื่อ 77 จังหวัด + อำเภอ Bangkok

---

## 10. Database Entities → Thai Name

| ตาราง | ชื่อไทย | Primary Key |
|------|--------|-------------|
| `shops` | ร้านค้า | `id` UUID |
| `branches` | สาขา | `id` UUID |
| `users` | บัญชีผู้ใช้ | `id` UUID |
| `user_shop_roles` | สิทธิ์ผู้ใช้ต่อร้าน | composite (user_id, shop_id) |
| `products` | สินค้า | `id` UUID |
| `branch_stock` | สต๊อกรายสาขา | composite (branch_id, product_id) |
| `stock_transactions` | ประวัติสต๊อก | `id` UUID |
| `shop_units` | หน่วยนับสินค้า | `id` UUID |
| `consumables` | วัตถุดิบสิ้นเปลือง | `id` UUID |
| `product_consumables` | BOM (วัตถุดิบต่อสินค้า) | `id` UUID |
| `orders` | ออเดอร์ | `id` UUID |
| `order_items` | รายการสินค้าในออเดอร์ | `id` UUID |
| `customers` | ลูกค้า / สมาชิก | `id` UUID |
| `promotions` | โปรโมชั่น | `id` UUID |
| `combos` | เมนูคอมโบ | `id` UUID |
| `combo_items` | รายการในคอมโบ | `id` UUID |
| `subscriptions` | แพ็กเกจ/การสมัครสมาชิก | `id` UUID |
| `staff_qr_tokens` | QR token พนักงาน | `id` UUID |
| `staff_checkins` | บันทึกเข้า-ออก | `id` UUID |
| `qr_device_tokens` | token อุปกรณ์ (30d) | `token` UUID |
| `qr_login_sessions` | session QR login | `id` UUID |
| `withdrawal_requests` | คำขอเบิกของ | `id` UUID |
| `shop_notifications` | การแจ้งเตือนร้านค้า | `id` UUID |
| `shop_sales_snapshots` | snapshot ยอดขาย | `id` UUID |
| `logs` | action logs | `id` UUID |
| `events` | event stream | `id` UUID |
| `audit_logs` | audit trail (7d) | `id` UUID |
| `payment_logs` | payment events | `id` UUID |
| `app_settings` | system config | `key` TEXT |

---

## 11. API Response Format

### Success
```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "requestId": "uuid",
    "timestamp": "ISO8601"
  }
}
```

### Error
```json
{
  "success": false,
  "error": {
    "code": "VAL_001",
    "message": "Validation failed",
    "details": { ... }
  },
  "meta": {
    "requestId": "uuid",
    "timestamp": "ISO8601"
  }
}
```

### Error Codes
| Code | Status | Description |
|------|--------|-------------|
| `VAL_001` | 400 | Zod validation error |
| `AUTH_001` | 401 | Unauthorized / invalid token |
| `FORBIDDEN` | 403 | Insufficient role |
| `NOT_FOUND` | 404 | Resource not found |
| `CONFLICT` | 409 | Duplicate / constraint violation |
| `LIMIT_001` | 429 | Rate limit exceeded |
| `SYS_001` | 500 | Internal server error |

---

## 12. WebSocket Events

### POS → Backend → Customer Display

| Event | Payload | Customer Display แสดง |
|-------|---------|----------------------|
| `CHECKOUT_CASH` | `{ total, shopName }` | หน้าชำระเงินสด |
| `CHECKOUT_QR` | `{ total, qrData, shopName }` | QR PromptPay |
| `CHECKOUT_PAID` | `{ orderNumber, total }` | หน้าสำเร็จ |
| `CHECKOUT_CLOSE` | `{}` | กลับ idle |

### Backend → POS

| Event | Description |
|-------|-------------|
| `ORDER_CREATED` | refresh today orders + stats |
| `STOCK_UPDATE` | update stock indicator |
| `STOCK_LOW` | แสดง low stock banner |
| `MEMBER_REGISTERED` | สมาชิกใหม่สมัครตัวเอง |

---

## 13. CSS Class Naming Convention

### Pattern: BEM (Block__Element--Modifier)

```
.pos-wrap                    ← Block
.pos-wrap__header            ← Element (ใช้ __)
.pos-wrap__header--sticky    ← Modifier (ใช้ --)
```

### Prefix Rules

| Prefix | ใช้สำหรับ | ตัวอย่าง |
|--------|---------|---------|
| `.pos-` | หน้า POS | `.pos-wrap`, `.pos-topnav` |
| `.dash__` | หน้า Dashboard | `.dash__body`, `.dash__kpi-card` |
| `.page-admin__` | หน้า Admin | `.page-admin__tabs` |
| `.pd-` | Customer Display (/pay) | `.pd-wrap`, `.pd-idle` |
| `.rcpt-` | ใบเสร็จ | `.rcpt-page`, `.rcpt-bill` |
| `.rpt__` | หน้า Reports | `.rpt__page`, `.rpt-grid` |
| `.stk__` | Stock page | `.stk__root`, `.stk__table` |
| `.auth-header` | Header component | `.auth-header__left` |
| `.modal-` | Modal overlay | `.modal-overlay`, `.modal-content` |
| `.btn-` | Buttons | `.btn-primary`, `.btn-ghost` |
| `.lp-` | Landing page | `.lp-root`, `.lp-hero` |
| `.notif-bell` | Notification bell | `.notif-bell__panel` |
| `.cm` | CheckoutModal (root) | `.cm__qr-card` |
| `.sm2` | SuccessModal (root) | `.sm2__receipt` |
| `.theme-switcher` | ThemeSwitcher | `.theme-switcher--topnav` |
| `.promo-panel` | PromotionsPanel | `.promo-panel__item` |

### Modifier Classes

| Class | ความหมาย |
|-------|---------|
| `--active` | เลือกอยู่ / กดอยู่ |
| `--disabled` | ปิดการใช้งาน |
| `--loading` | กำลังโหลด |
| `--error` | มีข้อผิดพลาด |
| `--topnav` | variant สำหรับ top navigation |
| `--oos` | out-of-stock (สินค้าหมด) |
| `--connected` | WebSocket เชื่อมต่อแล้ว |
| `--connecting` | กำลังเชื่อมต่อ |
| `no-print` | ซ่อนเมื่อพิมพ์ (`@media print`) |
| `print-only` | แสดงเฉพาะเมื่อพิมพ์ |

---

*อัปเดตเมื่อ 2026-04 · อ่านประกอบกับ `CSS-GUIDE.md` และ `ARCHITECTURE.md`*
