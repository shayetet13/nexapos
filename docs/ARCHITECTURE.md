# NexaPos — Architecture Overview

> **Version:** 1.0 · **Updated:** 2026-04 · **Stack:** Next.js 15 · Fastify 5 · PostgreSQL · Supabase · Cloudflare Workers

---

## Table of Contents

1. [Stack Overview](#1-stack-overview)
2. [Monorepo Structure](#2-monorepo-structure)
3. [Database Schema (27 Tables)](#3-database-schema)
4. [API Routes Reference](#4-api-routes-reference)
5. [System Flows](#5-system-flows)
6. [Middleware Stack](#6-middleware-stack)
7. [Role Permissions](#7-role-permissions)
8. [Real-time Broadcasting](#8-real-time-broadcasting)
9. [Theme System](#9-theme-system)
10. [Security Standards](#10-security-standards)
11. [Cron Jobs](#11-cron-jobs)

---

## 1. Stack Overview

| Layer | Technology | Version |
|-------|-----------|---------|
| Frontend | Next.js App Router, React 19 | 15.x |
| Styling | TailwindCSS + custom CSS (BEM) | 3.x |
| Backend | Fastify, TypeScript | 5.x |
| ORM | Drizzle ORM | latest |
| Database | PostgreSQL via Supabase | 15+ |
| Auth | Supabase Auth + custom JWT claim | — |
| Validation | Zod (frontend + backend) | 3.x |
| Real-time | WebSocket (@fastify/websocket) | — |
| Proxy Layer | Cloudflare Workers | — |
| Monorepo | pnpm workspaces | 9.x |
| Runtime | Node.js 20 | 20 LTS |

---

## 2. Monorepo Structure

```
NexaPos/
├── apps/
│   ├── frontend/          ← Next.js 15 (port 3000)
│   │   └── src/
│   │       ├── app/           ← App Router pages
│   │       ├── components/    ← React components
│   │       ├── styles/        ← CSS files (BEM)
│   │       ├── lib/           ← utilities, supabase client
│   │       └── hooks/         ← custom hooks
│   ├── backend/           ← Fastify 5 (port 4000)
│   │   └── src/
│   │       ├── routes/        ← 18 route groups
│   │       ├── services/      ← business logic
│   │       ├── repositories/  ← DB access (Drizzle)
│   │       ├── middleware/    ← auth, internal-token
│   │       ├── lib/           ← crypto, ws-broadcast, cron
│   │       └── db/            ← schema.ts, migrations
│   └── worker/            ← Cloudflare Worker (proxy)
└── packages/
    └── shared/            ← Types + Zod schemas shared FE/BE
        └── src/
            ├── types.ts
            └── schemas.ts
```

### Package Names (pnpm workspace)
- `@nexapos/frontend`
- `@nexapos/backend`
- `@nexapos/worker`
- `@nexapos/shared`

---

## 3. Database Schema

> 27 tables · PostgreSQL · Drizzle ORM · File: `apps/backend/src/db/schema.ts`

---

### 3.1 Shops & Identity

#### `shops`
| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | auto-generated |
| `shop_code` | TEXT UNIQUE | 10-digit: [postal 5][seq 3][BE year 2] |
| `name` | TEXT NOT NULL | ชื่อร้านค้า |
| `logo_url` | TEXT | URL รูปโลโก้ |
| `province` | TEXT | จังหวัด |
| `district` | TEXT | อำเภอ |
| `postal_code` | TEXT | รหัสไปรษณีย์ |
| `vat_enabled` | BOOLEAN | เปิด/ปิด VAT |
| `owner_firstname` | TEXT | ชื่อเจ้าของ |
| `owner_lastname` | TEXT | นามสกุลเจ้าของ |
| `promptpay_type` | TEXT | `'phone'` \| `'id_card'` |
| `promptpay_number_encrypted` | TEXT | **AES-256-GCM encrypted** |
| `print_receipt_enabled` | BOOLEAN | เปิด/ปิดพิมพ์ใบเสร็จ |
| `printer_width` | INTEGER | 32 หรือ 48 chars |
| `membership_config` | JSONB | `{ points_per_10_baht, redemption_rate, tier_silver, tier_gold, birthday_benefit_type, ... }` |
| `telegram_chat_id` | TEXT | สำหรับส่ง OTP / แจ้งเตือน |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

#### `branches`
| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `shop_id` | UUID FK→shops CASCADE | |
| `name` | TEXT NOT NULL | ชื่อสาขา |
| `address` | TEXT | ที่อยู่ |
| `is_active` | BOOLEAN | |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

**Index:** `branches_shop_id_idx`

#### `users`
| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | sync กับ Supabase `auth.users` |
| `email` | TEXT UNIQUE | |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

#### `user_shop_roles`
| Column | Type | Notes |
|--------|------|-------|
| `user_id` | UUID FK→users CASCADE | |
| `shop_id` | UUID FK→shops CASCADE | |
| `role` | TEXT | `'owner'` \| `'manager'` \| `'cashier'` \| `'viewer'` |
| `branch_id` | UUID FK→branches SET NULL | optional branch restriction |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

**PK:** composite `(user_id, shop_id)`

---

### 3.2 Products & Stock

#### `products`
| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `shop_id` | UUID FK→shops CASCADE | |
| `name` | TEXT NOT NULL | ชื่อสินค้า |
| `sku` | TEXT | รหัสสินค้า |
| `barcode` | TEXT | barcode |
| `price` | DECIMAL(12,2) | ราคาขาย |
| `cost_price` | DECIMAL(12,2) | ต้นทุน (ใช้คำนวณ P&L) |
| `unit` | TEXT default 'อัน' | หน่วยนับ |
| `category` | TEXT | หมวดหมู่ |
| `image_url` | TEXT | รูปสินค้า |
| `show_on_pos` | BOOLEAN | แสดงบนหน้าขาย POS |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

**Indexes:** `products_shop_id_idx`, `products_shop_pos_idx` (shop_id + show_on_pos)

#### `branch_stock`
| Column | Type | Notes |
|--------|------|-------|
| `branch_id` | UUID FK→branches CASCADE | |
| `product_id` | UUID FK→products CASCADE | |
| `quantity` | INTEGER | สต๊อกปัจจุบัน |
| `min_qty` | INTEGER default 5 | แจ้งเตือนสต๊อกต่ำ |
| `updated_at` | TIMESTAMPTZ | |

**PK:** composite `(branch_id, product_id)`

#### `stock_transactions`
| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `shop_id` / `branch_id` / `product_id` | UUID FKs | |
| `type` | TEXT | `manual_set` \| `manual_add` \| `sale_deduct` \| `adjustment` |
| `qty_before` | INTEGER | |
| `qty_change` | INTEGER | + เพิ่ม / - ลด |
| `qty_after` | INTEGER | |
| `note` | TEXT | |
| `created_by` | UUID FK→users SET NULL | |
| `created_at` | TIMESTAMPTZ | |

**Index:** `(shop_id, branch_id, created_at)`

#### `shop_units`
หน่วยนับที่ร้านสร้างเอง — `(id, shop_id, name)`

#### `consumables`
วัตถุดิบสิ้นเปลือง (ไม่ขายตรง) — `(id, shop_id, name, unit, quantity DECIMAL, min_qty DECIMAL)`

#### `product_consumables` — BOM (Bill of Materials)
| Column | Type |
|--------|------|
| `id` | UUID PK |
| `product_id` | FK→products CASCADE |
| `consumable_id` | FK→consumables CASCADE |
| `qty_per_unit` | DECIMAL(12,3) |

**Unique:** `(product_id, consumable_id)`

---

### 3.3 Orders

#### `orders`
| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `order_number` | INTEGER | สะสมต่อเนื่องต่อร้าน (ไม่รีเซ็ต) |
| `daily_seq` | INTEGER | รีเซ็ตทุกเที่ยงคืน Bangkok UTC+7 |
| `receipt_token` | UUID | public token สำหรับ QR ใบเสร็จ |
| `shop_id` | FK→shops CASCADE | |
| `branch_id` | FK→branches CASCADE | |
| `user_id` | FK→users RESTRICT | พนักงานที่สร้างออเดอร์ |
| `customer_id` | FK→customers SET NULL | ลูกค้า (optional) |
| `status` | TEXT | `pending` \| `paid` \| `void` \| `refunded` |
| `total` | DECIMAL(12,2) | ยอดสุทธิ |
| `discount` | DECIMAL(12,2) | ส่วนลด |
| `points_earned` | INTEGER | แต้มที่ได้รับ |
| `points_redeemed` | INTEGER | แต้มที่ใช้แลก |
| `payment_method` | TEXT | `cash` \| `card` \| `transfer` \| `other` |
| `cash_received` | DECIMAL | เงินที่รับมา (กรณีจ่ายสด) |
| `refund_reason` | TEXT | |
| `refund_type` | TEXT | |
| `refunded_at` | TIMESTAMPTZ | |
| `refunded_by` | UUID | |
| `refund_otp` | TEXT | OTP 6 หลัก |
| `refund_otp_expires_at` | TIMESTAMPTZ | |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

**Indexes:**
- UNIQUE `(shop_id, order_number)`
- `(shop_id, branch_id, created_at)`

#### `order_items`
| Column | Type |
|--------|------|
| `id` | UUID PK |
| `order_id` | FK→orders CASCADE |
| `product_id` | FK→products RESTRICT |
| `quantity` | INTEGER |
| `unit_price` | DECIMAL(12,2) |
| `subtotal` | DECIMAL(12,2) |

**Index:** `order_items_order_id_idx`

---

### 3.4 Customers & Membership

#### `customers`
| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `shop_id` | FK→shops CASCADE | |
| `name` | TEXT NOT NULL | ชื่อลูกค้า |
| `phone` | TEXT | UNIQUE ต่อร้าน |
| `email` | TEXT | |
| `birthday` | DATE | วันเกิด (MM-DD) |
| `points` | INTEGER | แต้มสะสม |
| `total_spent` | DECIMAL(12,2) | ยอดสะสมทั้งหมด |
| `tier` | TEXT | `bronze` \| `silver` \| `gold` |
| `notes` | TEXT | |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

**Indexes:** `(shop_id, phone)` UNIQUE, `(shop_id, name)`

---

### 3.5 Promotions & Combos

#### `promotions`
`(id, shop_id, name, type: 'percent'|'fixed', value, color, is_active)`

#### `combos`
`(id, shop_id, name, price, is_active)`

#### `combo_items`
`(id, combo_id FK→combos CASCADE, product_id FK→products CASCADE, quantity)`

---

### 3.6 Subscriptions

#### `subscriptions`
| Column | Type |
|--------|------|
| `id` | UUID PK |
| `shop_id` | UUID FK UNIQUE |
| `plan` | TEXT |
| `billing_interval` | `'monthly'` \| `'yearly'` \| `'once'` |
| `status` | `'active'` \| `'cancelled'` \| `'past_due'` |
| `expires_at` | TIMESTAMPTZ |
| `is_whitelisted` | BOOLEAN |
| `created_at` / `updated_at` | TIMESTAMPTZ |

---

### 3.7 Staff & QR Login

#### `staff_qr_tokens`
`(id, user_id, shop_id, branch_id, token UUID)`
- Index: `token` UNIQUE, `(user_id, shop_id)` UNIQUE

#### `staff_checkins`
`(id, user_id, shop_id, branch_id, checked_in_at, checked_out_at)`

#### `qr_device_tokens`
`(token UUID PK, user_id, created_at, expires_at)` — 30-day TTL

#### `qr_login_sessions`
`(id, token UNIQUE, status: pending/confirmed/used/expired, user_id, shop_id, branch_id, login_token UNIQUE, confirmed_at, created_at, expires_at)`

---

### 3.8 Withdrawals & Notifications

#### `withdrawal_requests`
`(id, shop_id, branch_id, staff_name, note, status: pending/approved/rejected, items JSONB, approved_by, approved_at, rejected_at, created_at)`

#### `shop_notifications`
`(id, shop_id, branch_id, product_id, customer_id, type, title, message, read_at)`

---

### 3.9 Analytics & Audit

#### `shop_sales_snapshots`
`(id, shop_id, period_type: day/week/month/year, period_key, revenue, order_count, rank, snapshot_at)`
- UNIQUE `(shop_id, period_type, period_key)`

#### `logs`
`(id, shop_id, action, entity_type, entity_id, payload JSONB, user_id, created_at)`

#### `events`
`(id, shop_id, branch_id, type, payload JSONB, created_at)`

#### `audit_logs`
| Column | Notes |
|--------|-------|
| `event` | action type |
| `user_id` / `role` | who did it |
| `ip_address` / `user_agent` | where from |
| `method` / `endpoint` / `status` | what API |
| `execution_time` | ms |
| `metadata` | JSONB additional context |
| `request_id` / `session_id` | tracing |

> **Retention:** 7 days — weekly cron cleanup (Sunday 00:01 Bangkok)

#### `payment_logs`
`(id, shop_id, amount, currency default 'THB', status, external_id, metadata JSONB)`

#### `app_settings`
`(key TEXT PK, value, updated_at)` — system configuration

---

## 4. API Routes Reference

> Base: `/api/v1` · Auth: Supabase JWT Bearer token · File: `apps/backend/src/routes/`

### Authentication

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/register` | ❌ public | สมัครบัญชี + สร้างร้าน + สาขา (rate: 5/min) |

### Me & Shops

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/me/shops` | ✅ JWT | รายการร้านค้าของ user |
| GET | `/me/pos-assignment` | ✅ JWT | shop+branch ที่ assign ไว้ |
| GET | `/shops/:shopId/branches` | ✅ JWT | รายการสาขา |
| GET | `/shops/:shopId/stats` | ✅ JWT | สถิติยอดขาย (filter by date) |
| GET | `/shops/:shopId/settings` | ✅ owner/manager | การตั้งค่าร้าน (decrypt PromptPay) |
| PATCH | `/shops/:shopId/settings` | ✅ owner | อัปเดตการตั้งค่า (encrypt PromptPay) |
| GET | `/shops/:shopId/pos-config` | ✅ JWT | config สำหรับ POS (cache 5 min) |
| GET | `/shops/:shopId/payment` | ✅ JWT | payment config + PromptPay |
| POST | `/shops/:shopId/generate-code` | ✅ owner | สร้าง shop code 10 หลัก |
| GET | `/shops/:shopId/users` | ✅ owner/manager | รายการ staff |
| POST | `/shops/:shopId/users` | ✅ owner | เพิ่ม staff (สร้าง Supabase user ถ้าไม่มี) |
| PATCH | `/shops/:shopId/users/:userId` | ✅ owner | แก้ role/branch |
| DELETE | `/shops/:shopId/users/:userId` | ✅ owner | ลบ staff ออกจากร้าน |
| GET | `/shops/:shopId/notifications` | ✅ JWT | การแจ้งเตือน (max 50, unread first) |
| PATCH | `/shops/:shopId/notifications/:id/read` | ✅ JWT | อ่านแล้ว |
| PATCH | `/shops/:shopId/notifications/read-all` | ✅ JWT | อ่านทั้งหมด |
| POST | `/shops/:shopId/display` | ✅ JWT | broadcast event ไปหน้า display (rate: 60/min) |

### Products

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/shops/:shopId/products` | ✅ JWT | รายการสินค้า (?pos=true กรอง show_on_pos) |
| POST | `/shops/:shopId/products` | ✅ admin | สร้างสินค้า + init stock ทุกสาขา (plan limit check) |
| PATCH | `/shops/:shopId/products/:productId` | ✅ admin | แก้ไขสินค้า |
| PATCH | `/shops/:shopId/products/:productId/stock` | ✅ admin | ตั้งสต๊อก |
| GET | `/shops/:shopId/products/:productId/stock` | ✅ admin | ดูสต๊อกรายสาขา |
| PATCH | `/shops/:shopId/products/:productId/min-qty` | ✅ admin | ตั้ง min qty alert |
| POST | `/shops/:shopId/products/stock/transfer` | ✅ admin | โอนสต๊อกข้ามสาขา |

### Orders

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/shops/:shopId/orders` | ✅ cashier+ | สร้างออเดอร์ (rate: 60/min) |
| GET | `/shops/:shopId/orders` | ✅ JWT | รายการออเดอร์ (pagination + filter) |
| GET | `/shops/:shopId/orders/:orderId` | ✅ JWT | รายละเอียดออเดอร์ + รายการสินค้า |
| GET | `/shops/:shopId/orders/today` | ✅ JWT | ออเดอร์วันนี้รายสาขา |
| GET | `/shops/:shopId/orders/count` | ✅ JWT | นับออเดอร์ (filter ได้) |
| PATCH | `/shops/:shopId/orders/:orderId/status` | ✅ admin | เปลี่ยนสถานะ → void/refunded |
| POST | `/shops/:shopId/orders/:orderId/refund/request-otp` | ✅ admin | ขอ OTP คืนเงิน (rate: 5/min) |
| POST | `/shops/:shopId/orders/:orderId/refund/confirm-otp` | ✅ admin | ยืนยัน OTP คืนเงิน |

### Customers

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/shops/:shopId/customers` | ✅ JWT | รายการลูกค้า (?q=search, ?limit=) |
| GET | `/shops/:shopId/customers/:customerId` | ✅ JWT | ข้อมูลลูกค้า + ประวัติออเดอร์ |
| POST | `/shops/:shopId/customers` | ✅ JWT (feature) | สร้างลูกค้าใหม่ |
| PATCH | `/shops/:shopId/customers/:customerId` | ✅ JWT | แก้ไขข้อมูลลูกค้า |
| DELETE | `/shops/:shopId/customers/:customerId` | ✅ JWT | ลบลูกค้า |
| GET | `/shops/:shopId/customers/:customerId/orders` | ✅ JWT | ประวัติออเดอร์ของลูกค้า |

### Reports

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/shops/:shopId/reports/pnl` | ✅ admin + feature | P&L report (?fromDate, ?toDate, ?groupBy: day/month, ?branchId) max 366 days |

### Promotions & Combos

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/shops/:shopId/promotions` | ✅ JWT | โปรโมชั่น + combos พร้อม items |
| POST | `/shops/:shopId/promotions` | ✅ admin (feature) | สร้างโปรโมชั่น |
| PATCH | `/shops/:shopId/promotions/:promotionId` | ✅ admin | แก้ไข |
| DELETE | `/shops/:shopId/promotions/:promotionId` | ✅ admin | ลบ |
| POST | `/shops/:shopId/combos` | ✅ admin (feature) | สร้างคอมโบ |
| PATCH | `/shops/:shopId/combos/:comboId` | ✅ admin | แก้ไขคอมโบ |
| DELETE | `/shops/:shopId/combos/:comboId` | ✅ admin | ลบคอมโบ |

### Consumables & BOM

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/shops/:shopId/consumables` | ✅ JWT | รายการวัตถุดิบ |
| POST | `/shops/:shopId/consumables` | ✅ admin | สร้างวัตถุดิบ |
| PATCH | `/shops/:shopId/consumables/:id` | ✅ admin | แก้ไข |
| DELETE | `/shops/:shopId/consumables/:id` | ✅ admin | ลบ |
| GET | `/shops/:shopId/products/:productId/bom` | ✅ JWT | BOM ของสินค้า |
| PUT | `/shops/:shopId/products/:productId/bom` | ✅ admin | ตั้ง BOM ใหม่ทั้งหมด |

### Units

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/shops/:shopId/units` | ✅ JWT | หน่วยนับของร้าน |
| POST | `/shops/:shopId/units` | ✅ admin | สร้างหน่วยนับ |
| DELETE | `/shops/:shopId/units/:unitId` | ✅ admin | ลบ |

### Subscriptions

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/subscriptions/:shopId` | ✅ JWT | สถานะ subscription |
| POST | `/subscriptions/:shopId` | ✅ JWT | สร้าง/ต่ออายุ |

### Public (ไม่ต้อง auth)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/public/shops/:shopId` | ❌ | ชื่อร้าน + โลโก้ |
| POST | `/public/shops/:shopId/register` | ❌ (rate: 5/min) | ลงทะเบียนสมาชิกตัวเอง |
| GET | `/receipts/:receiptToken` | ❌ | ดูใบเสร็จ (public) |

### Staff QR

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/shops/:shopId/staff-qr/token` | ✅ JWT | รับ QR token |
| POST | `/shops/:shopId/staff-qr/checkin` | ✅ JWT | check-in |
| POST | `/shops/:shopId/staff-qr/checkout` | ✅ JWT | check-out |

### Withdrawals

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/shops/:shopId/withdrawals/items` | public | รายการที่เบิกได้ |
| POST | `/shops/:shopId/withdrawals` | public | ส่งคำขอเบิก |
| GET | `/public/withdrawals/:id/status` | public | ตรวจสอบสถานะ |
| PATCH | `/shops/:shopId/withdrawals/:id/approve` | ✅ admin | อนุมัติ |
| PATCH | `/shops/:shopId/withdrawals/:id/reject` | ✅ admin | ปฏิเสธ |

### QR Login Sessions

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/qr-sessions` | ❌ | สร้าง QR session |
| GET | `/qr-sessions/:token` | ❌ | ตรวจสอบสถานะ session |

### Audit

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/audit/logs` | ✅ owner/manager | ดู audit logs |

### WebSocket Endpoints

| Path | Auth | Description |
|------|------|-------------|
| `GET /ws` | ✅ JWT | POS real-time (orders, stock, display events) |
| `GET /ws-display` | ❌ | Customer Display รับ broadcast (read-only) |
| `GET /api/v1/ws-qr` | ❌ | QR login flow |

### Health

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | server health check |

---

## 5. System Flows

### Flow A: POS ขายสินค้า (Critical Path)

```
╔══════════════════════════════════════════════════════════════╗
║                    ORDER CREATION FLOW                       ║
╚══════════════════════════════════════════════════════════════╝

[Cashier] เลือกสินค้า → CartPanel
    │
    ▼ กด "ชำระเงิน"
[CheckoutModal] เลือกวิธีชำระ + ลูกค้า + แต้ม
    │
    ▼ POST /shops/:shopId/orders
[order.service.createOrder()]
    ├─ 1. Validate Zod schema (items[], payment_method, branch_id)
    ├─ 2. Fetch products + stock in parallel (2 queries)
    ├─ 3. Validate stock availability per item
    ├─ 4. Calculate:
    │       • points redemption → discount
    │       • birthday benefit (if today = customer birthday)
    │       • manual discount
    │       • VAT (if enabled)
    ├─ 5. BEGIN TRANSACTION
    │       • INSERT orders → get orderId, orderNumber, dailySeq, receiptToken
    │       • INSERT order_items[] (batch)
    ├─ 6. Deduct branch_stock per product
    │       → INSERT stock_transactions (type: sale_deduct)
    │       → Broadcast STOCK_UPDATE via WS
    ├─ 7. Deduct consumables via BOM (deductByBOM)
    ├─ 8. Update customer: points_earned, total_spent, tier recalculate
    ├─ 9. INSERT logs + events (fire-and-forget)
    ├─ 10. Broadcast CHECKOUT_PAID → /ws-display (Customer Display)
    └─ 11. Broadcast ORDER_CREATED → /ws (POS refresh today orders)
    │
    ▼ Response: { orderId, orderNumber, dailySeq, receiptToken }
[SuccessModal] แสดงยอด + ปุ่มพิมพ์
    │
    ├─ onPrint() → ESC/POS binary → thermal printer (bluetooth/USB/network)
    └─ หรือ window.print() → receipt modal → browser print dialog
```

### Flow B: QR Login

```
[Desktop /login] → สร้าง QR session (POST /qr-sessions)
    │
    ├─ แสดง QR code (WebSocket polling /ws-qr)
    │   └─ countdown 45 วินาที → auto-refresh
    │
[Mobile scan QR] → /qr-auth?t={token}
    │
    ▼ WS message: confirm session
[Backend] → สร้าง magic link → signInWithOtp
    │
[Desktop] รับ magic link → supabase.auth.verifyOtp()
    │
    ▼ Redirect based on role:
    ├─ dev user → /dev
    ├─ มี pos-assignment → /pos?shopId=&branchId=
    └─ ไม่มี → /select-shop
```

### Flow C: Customer Display Real-time

```
[POS Checkout] → Broadcast events → /ws-display
    │
    ├─ CHECKOUT_CASH → Customer Display: แสดงยอดเงินสด
    ├─ CHECKOUT_QR   → Customer Display: แสดง QR PromptPay
    ├─ CHECKOUT_PAID → Customer Display: แสดง "ชำระสำเร็จ"
    └─ CHECKOUT_CLOSE → Customer Display: กลับ idle screen
    │
[Customer Display /pay] ← WebSocket /ws-display (no auth)
    │
    ├─ Idle: scan rings animation + shop logo + "Ready to scan"
    ├─ Cash: ยอดชำระ + "กรุณาชำระเงิน"
    └─ QR: QR code PromptPay EMV + amount + countdown

[Reconnect] → Backend ส่ง last known state ทันที
```

### Flow D: Refund / คืนเงิน

```
[Admin] กดคืนเงิน → POST /orders/:id/refund/request-otp
    │
[Backend] → สร้าง OTP 6 หลัก + set expires_at
    │
    ▼ ส่ง OTP ทาง Telegram (shop telegram_chat_id)
    │
[Admin] กรอก OTP → POST /orders/:id/refund/confirm-otp
    │
[Backend] → Validate OTP + expiry
    │
    ▼ UPDATE order.status = 'refunded'
    ├─ INSERT logs (refund action)
    └─ INSERT notification (แจ้งเตือน)
```

### Flow E: Membership Points

```
[Order Paid]
    │
    ▼ calcPointsEarned(total, points_per_10_baht)
    │   e.g. total=100, rate=1pt/10฿ → 10 pts
    │
    ▼ UPDATE customer:
    ├─ points += points_earned
    ├─ points -= points_redeemed
    └─ total_spent += order.total
    │
    ▼ Tier recalculate:
    ├─ total_spent >= tier_gold   → 'gold'
    ├─ total_spent >= tier_silver → 'silver'
    └─ otherwise                  → 'bronze'
    │
    ▼ Birthday benefit (if isBirthdayToday()):
    ├─ type = 'free_item' → discount = item price
    └─ type = 'points'    → extra points
```

### Flow F: Stock Withdrawal (เบิกสต๊อก)

```
[Staff] → /withdraw page → เลือกสินค้า/วัตถุดิบ + จำนวน
    │
    ▼ POST /shops/:shopId/withdrawals
    ├─ INSERT withdrawal_requests (status: pending)
    └─ Broadcast notification → /ws
    │
[Admin POS] → WithdrawalApprovalModal รับ WS notification
    │
    ├─ PATCH /withdrawals/:id/approve
    │   ├─ Deduct branch_stock (if type=product)
    │   ├─ Deduct consumables (if type=consumable)
    │   └─ UPDATE status = 'approved'
    │
    └─ PATCH /withdrawals/:id/reject
        └─ UPDATE status = 'rejected'
```

### Flow G: Sales Snapshot (Daily Cron)

```
[Cron: 23:00 Bangkok daily]
    │
    ▼ startSnapshotCron()
    ├─ Aggregate orders → revenue, order_count per shop/period
    ├─ Calculate rank (leaderboard)
    └─ UPSERT shop_sales_snapshots
```

---

## 6. Middleware Stack

```
HTTP Request
    │
    ▼ [1] Rate Limit (@fastify/rate-limit)
    │   Global: 200 req/min per IP (in-memory)
    │   Order create: 60/min · Auth: 5/min · Payment: 10/min
    │
    ▼ [2] CORS (@fastify/cors)
    │   Allow: process.env.CORS_ORIGIN (default: http://localhost:3000)
    │   No wildcard on authenticated routes
    │
    ▼ [3] WebSocket Support (@fastify/websocket)
    │   Mounted at /ws, /ws-display, /ws-qr
    │
    ▼ [4] Internal Token (middleware/internal-token.ts)
    │   Header: X-Internal-Token (Cloudflare Worker → Fastify)
    │   Exempt: /ws*, /display, /withdrawals
    │
    ▼ [5] Route Matching
    │
    ▼ [6] Auth Middleware (middleware/auth.ts) [per-route]
    │   Verify Bearer token → Supabase auth.getUser()
    │   Attach: req.user = { userId, email, role }
    │   Throws: UnauthorizedError (401)
    │
    ▼ [7] Role Guard [per-route]
    │   requireOwnerShop  → role === 'owner'
    │   requireAdminShop  → role === 'owner' | 'manager'
    │   guardShop         → any role in shop
    │
    ▼ [8] Feature Gate [per-route]
    │   requireFeature('reports_advanced') → check subscription
    │
    ▼ [9] Route Handler
    │
    ▼ [10] Audit Log (onResponse hook, fire-and-forget)
        Skip: /health, /ws*, /audit
        Log: event, user_id, ip, endpoint, status, execution_time

Response ← Error Handler (AppError → { success, error: { code, message } })
```

---

## 7. Role Permissions

| Permission | owner | manager | cashier | viewer |
|-----------|:-----:|:-------:|:-------:|:------:|
| สร้างออเดอร์ | ✅ | ✅ | ✅ | ❌ |
| ดูออเดอร์วันนี้ | ✅ | ✅ | ✅ | ✅ |
| เพิ่ม/แก้ไขสินค้า | ✅ | ✅ | ❌ | ❌ |
| จัดการสต๊อก | ✅ | ✅ | ❌ | ❌ |
| ดูรายงาน P&L | ✅ | ✅ | ❌ | ❌ |
| จัดการลูกค้า/สมาชิก | ✅ | ✅ | ✅ | ❌ |
| อนุมัติ refund | ✅ | ✅ | ❌ | ❌ |
| อนุมัติ withdrawal | ✅ | ✅ | ❌ | ❌ |
| จัดการ staff | ✅ | ❌ | ❌ | ❌ |
| แก้การตั้งค่าร้าน | ✅ | ❌ | ❌ | ❌ |
| ดู audit log | ✅ | ✅ | ❌ | ❌ |
| จัดการ promotions | ✅ | ✅ | ❌ | ❌ |
| สร้าง branch | ✅ | ❌ | ❌ | ❌ |

---

## 8. Real-time Broadcasting

### Event Types

| Event | Sender | Receiver | Description |
|-------|--------|----------|-------------|
| `ORDER_CREATED` | Backend (post-order) | POS `/ws` | refresh today orders + stats |
| `STOCK_UPDATE` | Backend (deduct) | POS `/ws` | update stock indicator |
| `STOCK_LOW` | Backend (deduct) | POS `/ws` | แสดง low stock banner |
| `CHECKOUT_CASH` | POS → Backend | Display `/ws-display` | แสดงหน้า cash payment |
| `CHECKOUT_QR` | POS → Backend | Display `/ws-display` | แสดง QR PromptPay |
| `CHECKOUT_PAID` | Backend (post-order) | Display `/ws-display` | แสดงหน้าสำเร็จ |
| `CHECKOUT_CLOSE` | POS → Backend | Display `/ws-display` | กลับ idle |
| `MEMBER_REGISTERED` | Backend (public register) | POS `/ws` | แจ้งเตือนสมาชิกใหม่ |

### WebSocket Endpoints

```
GET /ws              JWT required  POS ↔ real-time (full duplex)
GET /ws-display      No auth       Customer Display ← broadcast only
GET /api/v1/ws-qr    No auth       QR login sessions
```

### Last-State Persistence
`ws-display` clients ที่ reconnect → ได้รับ last known state ทันที (stored in-memory per shopId)

---

## 9. Theme System

### Three Themes

| Theme | data-theme | BG Color | Primary |
|-------|-----------|----------|---------|
| Warm Dark (default) | `warm` | `#0c0806` | `#bf4422` |
| Light | `light` | `#faf7f4` | `#bf4422` |
| Ocean Dark | `ocean` | `#050d1a` | `#bf4422` |

### How Themes Work
1. **Init script** — inline ใน `<head>` ก่อน React hydrate → ป้องกัน flash
2. Mobile: ตาม OS dark/light mode อัตโนมัติ
3. Desktop: อ่านจาก `localStorage["nexapos-theme"]`
4. Set `data-theme` attribute บน `<html>`
5. CSS variables ใน `styles/variables.css` respond to `data-theme`

### Key CSS Variables
```css
--color-bg              /* พื้นหลังหลัก */
--color-bg-card         /* พื้นหลัง card */
--color-primary         /* สีหลัก (orange) */
--color-text            /* ตัวหนังสือหลัก */
--color-text-muted      /* ตัวหนังสือรอง */
--color-border          /* กรอบ */
--color-success         /* เขียว */
--color-error           /* แดง */
--color-warning         /* เหลือง */
```

---

## 10. Security Standards

| # | Standard | Implementation |
|---|---------|----------------|
| 1 | Authentication | Supabase Auth JWT · Bearer token · 15m access / 7d refresh |
| 2 | Authorization | RLS per shop_id · role guards in middleware |
| 3 | API Security | X-Internal-Token (CF Worker) · HMAC webhooks |
| 4 | Data Encryption | AES-256-GCM สำหรับ PromptPay/payment credentials |
| 5 | Transport | HTTPS only · HSTS · no mixed content |
| 6 | Input Validation | Zod schemas ทุก request body |
| 7 | SQL Injection | Drizzle ORM parameterized queries เสมอ |
| 8 | XSS | React auto-escape · no dangerouslySetInnerHTML |
| 9 | CSRF | SameSite=Strict cookies · X-CSRF-Token |
| 10 | Rate Limiting | Global + per-endpoint limits |
| 11 | CORS | Strict origin — no wildcard |
| 12 | Secrets | Environment variables + Zod-validated env.ts |
| 13 | Audit | Append-only audit_logs · 7-day retention |
| 14 | Session | HttpOnly; Secure; SameSite=Strict · max 3 concurrent |

---

## 11. Cron Jobs

| Job | Schedule (Bangkok) | Action |
|-----|-------------------|--------|
| `startSnapshotCron` | ทุกวัน 23:00 | snapshot ยอดขายรายวัน/เดือน/ปี + rank |
| `startBirthdayCron` | ทุกวัน เช้า | ส่งแจ้งเตือนวันเกิดลูกค้า |
| `startAuditCleanupCron` | ทุกอาทิตย์ 00:01 | ลบ audit_logs เก่ากว่า 7 วัน |

---

*เอกสารนี้ generate จากการอ่าน codebase จริง · อัปเดตทุกครั้งที่มี schema หรือ API เปลี่ยน*
