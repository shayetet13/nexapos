import {
  pgTable,
  uuid,
  text,
  varchar,
  integer,
  decimal,
  timestamp,
  date,
  jsonb,
  boolean,
  primaryKey,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

export const shops = pgTable('shops', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** รหัสร้าน 10 หลัก: [ปณ 5][running 3][ปีพศ 2 หลักท้าย] เช่น 1010000169 */
  shop_code:   text('shop_code').unique(),
  province:    text('province'),    // ชื่อจังหวัด
  district:    text('district'),    // เขต (กรุงเทพ)
  postal_code: text('postal_code'), // รหัสไปรษณีย์ 5 หลัก
  name: text('name').notNull(),
  logo_url: text('logo_url'),
  vat_enabled: boolean('vat_enabled').notNull().default(true),
  // Printer config — managed via admin settings UI
  print_receipt_enabled: boolean('print_receipt_enabled').notNull().default(false),
  printer_width:         integer('printer_width'),  // 48 = 80mm, 32 = 58mm
  owner_firstname: text('owner_firstname'),
  owner_lastname: text('owner_lastname'),
  /** 'phone' = 10-digit mobile, 'id_card' = 13-digit national ID */
  promptpay_type: text('promptpay_type', { enum: ['phone', 'id_card'] }),
  /** AES-256-GCM encrypted: "<iv>:<authTag>:<ciphertext>" — decrypt via lib/crypto.ts */
  promptpay_number_encrypted: text('promptpay_number_encrypted'),
  membership_config: jsonb('membership_config'), // { points_per_10_baht, redemption_rate, tier_silver, tier_gold, enabled }
  telegram_chat_id:  text('telegram_chat_id'),
  // ── Receipt / Tax Invoice fields ──────────────────────────────────────────
  phone:             text('phone'),             // เบอร์โทรร้าน สำหรับใบเสร็จ
  tax_id:            text('tax_id'),            // เลขประจำตัวผู้เสียภาษี 13 หลัก
  address:           text('address'),           // ที่อยู่ร้าน (shop-level, แยกจาก branch address)
  opening_hours:     text('opening_hours'),     // เวลาเปิด/ปิด เช่น "09:00-22:00"
  working_days:      text('working_days'),      // วันทำการ เช่น "จันทร์-อาทิตย์"
  google_review_url: text('google_review_url'), // URL สำหรับ QR code รีวิว Google
  /** false = ร้านถูก suspend ชั่วคราวโดย dev admin (ไม่สามารถล็อกอินได้) */
  is_active: boolean('is_active').notNull().default(true),
  /** true = ร้านถูกแบนถาวร — จะแสดงหน้า "ร้านถูกระงับ" แทนหน้าปกติ */
  is_banned: boolean('is_banned').notNull().default(false),
  /** เหตุผลที่แบน/ระงับ (ใส่โดย dev admin เพื่อใช้แสดงให้เจ้าของร้านเห็น) */
  ban_reason: text('ban_reason'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const branches = pgTable(
  'branches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shop_id: uuid('shop_id').notNull().references(() => shops.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    address: text('address'),
    is_active: boolean('is_active').notNull().default(true),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('branches_shop_id_idx').on(t.shop_id)],
);

export const users = pgTable('users', {
  id:         uuid('id').primaryKey().defaultRandom(),
  email:      text('email').notNull().unique(),
  /** true = พนักงานที่สร้างด้วย nickname+PIN (ไม่ใช่ email จริง) */
  is_staff:   boolean('is_staff').notNull().default(false),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const userShopRoles = pgTable(
  'user_shop_roles',
  {
    user_id:   uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    shop_id:   uuid('shop_id').notNull().references(() => shops.id, { onDelete: 'cascade' }),
    role:      text('role', { enum: ['owner', 'manager', 'cashier', 'viewer'] }).notNull().default('cashier'),
    branch_id: uuid('branch_id').references(() => branches.id, { onDelete: 'set null' }),
    /** ชื่อเล่นพนักงาน (เฉพาะ staff account ที่สร้างด้วย PIN) — unique GLOBALLY (ป้องกัน login ผิดร้าน) */
    nickname:  text('nickname'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.user_id, t.shop_id] }),
    uniqueIndex('user_shop_roles_user_shop_idx').on(t.user_id, t.shop_id),
    // Global unique — nickname unique ทั้งระบบ ไม่ใช่แค่ per-shop
    // เพื่อให้ staff login ด้วยชื่อเล่นได้โดยไม่ต้องระบุ shopId
    uniqueIndex('user_shop_roles_nickname_global_idx').on(t.nickname),
  ]
);

export const products = pgTable(
  'products',
  {
    id:         uuid('id').primaryKey().defaultRandom(),
    shop_id:    uuid('shop_id').notNull().references(() => shops.id, { onDelete: 'cascade' }),
    name:       text('name').notNull(),
    sku:        text('sku'),
    price:      decimal('price', { precision: 12, scale: 2 }).notNull(),
    cost_price: decimal('cost_price', { precision: 12, scale: 2 }),
    unit:       text('unit').notNull().default('อัน'),
    category:   text('category'),
    barcode:    text('barcode'),
    image_url:   text('image_url'),
    show_on_pos: boolean('show_on_pos').notNull().default(true),
    /** Soft-delete: set to NOW() when product is removed. NULL = active. */
    deleted_at:  timestamp('deleted_at', { withTimezone: true }),
    created_at:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at:  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('products_shop_id_idx').on(t.shop_id),
    index('products_shop_pos_idx').on(t.shop_id, t.show_on_pos),
    index('products_shop_active_idx').on(t.shop_id, t.deleted_at),
  ],
);

export const branchStock = pgTable(
  'branch_stock',
  {
    branch_id:  uuid('branch_id').notNull().references(() => branches.id, { onDelete: 'cascade' }),
    product_id: uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
    quantity:   integer('quantity').notNull().default(0),
    min_qty:    integer('min_qty').notNull().default(5),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.branch_id, t.product_id] })]
);

export const shopUnits = pgTable('shop_units', {
  id:         uuid('id').primaryKey().defaultRandom(),
  shop_id:    uuid('shop_id').notNull().references(() => shops.id, { onDelete: 'cascade' }),
  name:       text('name').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    order_number:  integer('order_number').notNull(),  // Cumulative per shop (never resets)
    daily_seq:     integer('daily_seq').notNull().default(1), // Daily sequence per shop (resets 00:15 Asia/Bangkok, POS)
    receipt_token: uuid('receipt_token').notNull().defaultRandom(), // Public token for QR receipt link
    ref_code:      varchar('ref_code', { length: 10 }),              // Unique 5-letter + 5-digit reference code
    shop_id:    uuid('shop_id').notNull().references(() => shops.id, { onDelete: 'cascade' }),
    branch_id:  uuid('branch_id').notNull().references(() => branches.id, { onDelete: 'cascade' }),
    user_id:    uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    customer_id:     uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    status: text('status', { enum: ['pending', 'paid', 'void', 'refunded'] }).notNull().default('pending'),
    total: decimal('total', { precision: 12, scale: 2 }).notNull(),
    discount:        decimal('discount', { precision: 12, scale: 2 }).notNull().default('0'),
    points_earned:   integer('points_earned').notNull().default(0),
    points_redeemed: integer('points_redeemed').notNull().default(0),
    payment_method: text('payment_method', { enum: ['cash', 'card', 'transfer', 'other'] }),
    // Refund fields
    refund_reason:         text('refund_reason'),
    refund_type:           text('refund_type', { enum: ['money_mistake', 'product_return'] }),
    refunded_at:           timestamp('refunded_at', { withTimezone: true }),
    refunded_by:           uuid('refunded_by').references(() => users.id, { onDelete: 'set null' }),
    refund_otp:            varchar('refund_otp', { length: 4 }),
    refund_otp_expires_at: timestamp('refund_otp_expires_at', { withTimezone: true }),
    cash_received:         decimal('cash_received', { precision: 12, scale: 2 }),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('orders_shop_branch_created_idx').on(t.shop_id, t.branch_id, t.created_at),
    uniqueIndex('orders_shop_order_number_idx').on(t.shop_id, t.order_number), // Ensure unique order number per shop
    uniqueIndex('orders_ref_code_idx').on(t.ref_code), // Global unique ref code
  ]
);

export const customers = pgTable(
  'customers',
  {
    id:          uuid('id').primaryKey().defaultRandom(),
    shop_id:     uuid('shop_id').notNull().references(() => shops.id, { onDelete: 'cascade' }),
    name:        text('name').notNull(),
    phone:       text('phone'),
    email:       text('email'),
    birthday:    date('birthday'),
    points:      integer('points').notNull().default(0),
    total_spent: decimal('total_spent', { precision: 12, scale: 2 }).notNull().default('0'),
    tier:        text('tier', { enum: ['bronze', 'silver', 'gold'] }).notNull().default('bronze'),
    notes:       text('notes'),
    created_at:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at:  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('customers_shop_id_idx').on(t.shop_id),
    index('customers_name_search_idx').on(t.shop_id, t.name),
    uniqueIndex('customers_shop_phone_unique').on(t.shop_id, t.phone),
  ],
);

export const promotions = pgTable('promotions', {
  id:         uuid('id').primaryKey().defaultRandom(),
  shop_id:    uuid('shop_id').notNull().references(() => shops.id, { onDelete: 'cascade' }),
  name:       text('name').notNull(),
  type:       text('type').notNull(), // 'percent' | 'fixed'
  value:      decimal('value', { precision: 10, scale: 2 }).notNull(),
  color:      text('color'),
  is_active:  boolean('is_active').notNull().default(true),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const combos = pgTable('combos', {
  id:         uuid('id').primaryKey().defaultRandom(),
  shop_id:    uuid('shop_id').notNull().references(() => shops.id, { onDelete: 'cascade' }),
  name:       text('name').notNull(),
  price:      decimal('price', { precision: 12, scale: 2 }).notNull(),
  is_active:  boolean('is_active').notNull().default(true),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const comboItems = pgTable('combo_items', {
  id:         uuid('id').primaryKey().defaultRandom(),
  combo_id:   uuid('combo_id').notNull().references(() => combos.id, { onDelete: 'cascade' }),
  product_id: uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  quantity:   integer('quantity').notNull().default(1),
});

export const orderItems = pgTable(
  'order_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    order_id: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
    product_id: uuid('product_id').notNull().references(() => products.id, { onDelete: 'restrict' }),
    quantity: integer('quantity').notNull(),
    unit_price: decimal('unit_price', { precision: 12, scale: 2 }).notNull(),
    subtotal: decimal('subtotal', { precision: 12, scale: 2 }).notNull(),
    note: text('note'),
  },
  (t) => [index('order_items_order_id_idx').on(t.order_id)],
);

export const logs = pgTable('logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  shop_id: uuid('shop_id').notNull().references(() => shops.id, { onDelete: 'cascade' }),
  action: text('action').notNull(),
  entity_type: text('entity_type').notNull(),
  entity_id: text('entity_id').notNull(),
  payload: jsonb('payload').notNull().default({}),
  user_id: uuid('user_id').references(() => users.id),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const events = pgTable('events', {
  id: uuid('id').primaryKey().defaultRandom(),
  shop_id: uuid('shop_id').notNull().references(() => shops.id, { onDelete: 'cascade' }),
  branch_id: uuid('branch_id').references(() => branches.id),
  type: text('type').notNull(),
  payload: jsonb('payload').notNull().default({}),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  shop_id: uuid('shop_id').notNull().references(() => shops.id, { onDelete: 'cascade' }).unique(),
  plan: text('plan').notNull(),
  billing_interval: text('billing_interval', { enum: ['monthly', 'yearly', 'once'] }).notNull().default('monthly'),
  status: text('status', { enum: ['active', 'cancelled', 'past_due'] }).notNull().default('active'),
  expires_at:     timestamp('expires_at', { withTimezone: true }),
  is_whitelisted: boolean('is_whitelisted').notNull().default(false),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const stockTransactions = pgTable(
  'stock_transactions',
  {
    id:         uuid('id').primaryKey().defaultRandom(),
    shop_id:    uuid('shop_id').notNull().references(() => shops.id, { onDelete: 'cascade' }),
    branch_id:  uuid('branch_id').notNull().references(() => branches.id, { onDelete: 'cascade' }),
    product_id: uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
    type:       text('type').notNull().default('manual_set'), // 'manual_set' | 'manual_add' | 'sale_deduct' | 'adjustment'
    qty_before: integer('qty_before').notNull().default(0),
    qty_change: integer('qty_change').notNull(),
    qty_after:  integer('qty_after').notNull(),
    note:       text('note'),
    created_by: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('stock_tx_shop_branch_idx').on(t.shop_id, t.branch_id, t.created_at)],
);

export const shopNotifications = pgTable('shop_notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  shop_id: uuid('shop_id').notNull().references(() => shops.id, { onDelete: 'cascade' }),
  branch_id:   uuid('branch_id').references(() => branches.id, { onDelete: 'set null' }),
  branch_name: text('branch_name'),
  product_id:  uuid('product_id').references(() => products.id, { onDelete: 'cascade' }),
  customer_id: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
  type: text('type').notNull(), // 'renewal_reminder' | 'payment_due' | 'low_stock' | 'birthday' | 'custom'
  title: text('title').notNull(),
  message: text('message'),
  read_at: timestamp('read_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Daily/weekly/monthly/yearly revenue snapshots per shop (taken at 23:00 Bangkok) */
export const shopSalesSnapshots = pgTable(
  'shop_sales_snapshots',
  {
    id:          uuid('id').primaryKey().defaultRandom(),
    shop_id:     uuid('shop_id').notNull().references(() => shops.id, { onDelete: 'cascade' }),
    /** 'day' | 'week' | 'month' | 'year' */
    period_type: text('period_type').notNull(),
    /** '2026-03-07' | '2026-W10' | '2026-03' | '2026' */
    period_key:  text('period_key').notNull(),
    revenue:     decimal('revenue', { precision: 12, scale: 2 }).notNull().default('0'),
    order_count: integer('order_count').notNull().default(0),
    rank:        integer('rank'),
    snapshot_at: timestamp('snapshot_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('shop_sales_snapshots_unique_idx').on(t.shop_id, t.period_type, t.period_key),
  ]
);

export const appSettings = pgTable('app_settings', {
  key:        text('key').primaryKey(),
  value:      text('value').notNull().default(''),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const consumables = pgTable(
  'consumables',
  {
    id:         uuid('id').primaryKey().defaultRandom(),
    shop_id:    uuid('shop_id').notNull().references(() => shops.id, { onDelete: 'cascade' }),
    name:       text('name').notNull(),
    unit:       text('unit').notNull().default('ชิ้น'),
    quantity:   decimal('quantity', { precision: 12, scale: 3 }).notNull().default('0'),
    min_qty:    decimal('min_qty', { precision: 12, scale: 3 }).notNull().default('0'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('consumables_shop_id_idx').on(t.shop_id)],
);

export const productConsumables = pgTable(
  'product_consumables',
  {
    id:            uuid('id').primaryKey().defaultRandom(),
    product_id:    uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
    consumable_id: uuid('consumable_id').notNull().references(() => consumables.id, { onDelete: 'cascade' }),
    qty_per_unit:  decimal('qty_per_unit', { precision: 12, scale: 3 }).notNull().default('1'),
  },
  (t) => [
    uniqueIndex('product_consumables_unique_idx').on(t.product_id, t.consumable_id),
    index('product_consumables_product_idx').on(t.product_id),
  ],
);

export const staffQrTokens = pgTable(
  'staff_qr_tokens',
  {
    id:         uuid('id').primaryKey().defaultRandom(),
    user_id:    uuid('user_id').notNull(),  // references auth.users (no FK in drizzle for auth schema)
    shop_id:    uuid('shop_id').notNull().references(() => shops.id, { onDelete: 'cascade' }),
    branch_id:  uuid('branch_id').references(() => branches.id, { onDelete: 'set null' }),
    token:      uuid('token').notNull().defaultRandom(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('staff_qr_tokens_token_idx').on(t.token),
    uniqueIndex('staff_qr_tokens_user_shop_idx').on(t.user_id, t.shop_id),
    index('staff_qr_tokens_shop_idx').on(t.shop_id),
  ],
);

export const staffCheckins = pgTable(
  'staff_checkins',
  {
    id:             uuid('id').primaryKey().defaultRandom(),
    user_id:        uuid('user_id').notNull(),  // references auth.users
    shop_id:        uuid('shop_id').notNull().references(() => shops.id, { onDelete: 'cascade' }),
    branch_id:      uuid('branch_id').references(() => branches.id, { onDelete: 'set null' }),
    checked_in_at:  timestamp('checked_in_at', { withTimezone: true }).notNull().defaultNow(),
    checked_out_at: timestamp('checked_out_at', { withTimezone: true }),
  },
  (t) => [
    index('staff_checkins_shop_date_idx').on(t.shop_id, t.checked_in_at),
    index('staff_checkins_user_idx').on(t.user_id, t.checked_in_at),
  ],
);

export type WithdrawalItem = {
  type: 'consumable' | 'product';
  id: string;
  name: string;
  unit: string;
  qty: number;
};

export const withdrawalRequests = pgTable(
  'withdrawal_requests',
  {
    id:          uuid('id').primaryKey().defaultRandom(),
    shop_id:     uuid('shop_id').notNull().references(() => shops.id, { onDelete: 'cascade' }),
    branch_id:   uuid('branch_id').notNull().references(() => branches.id, { onDelete: 'cascade' }),
    staff_name:  text('staff_name').notNull(),
    note:        text('note'),
    status:      text('status', { enum: ['pending', 'approved', 'rejected'] }).notNull().default('pending'),
    items:       jsonb('items').notNull().default([]).$type<WithdrawalItem[]>(),
    approved_by: uuid('approved_by'),
    approved_at: timestamp('approved_at', { withTimezone: true }),
    rejected_at: timestamp('rejected_at', { withTimezone: true }),
    created_at:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('withdrawal_shop_status_idx').on(t.shop_id, t.status),
    index('withdrawal_branch_date_idx').on(t.branch_id, t.created_at),
  ],
);

/** Long-lived device tokens for QR auth — phone stores this after first confirm.
 *  Second scan: phone sends X-QR-Device-Token instead of Supabase JWT.
 *  Expires in 30 days. Refreshed on each use. */
export const qrDeviceTokens = pgTable('qr_device_tokens', {
  token:      uuid('token').primaryKey().defaultRandom(),
  user_id:    uuid('user_id').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
});

/** Ephemeral QR login sessions — POS shows QR, phone scans & confirms, POS auto-logs in */
export const qrLoginSessions = pgTable(
  'qr_login_sessions',
  {
    id:           uuid('id').primaryKey().defaultRandom(),
    token:        uuid('token').unique().notNull().defaultRandom(),
    status:       text('status', { enum: ['pending', 'confirmed', 'used', 'expired'] }).notNull().default('pending'),
    user_id:      uuid('user_id'),
    shop_id:      uuid('shop_id'),
    branch_id:    uuid('branch_id'),
    login_token:  uuid('login_token').unique(),
    confirmed_at: timestamp('confirmed_at', { withTimezone: true }),
    created_at:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expires_at:   timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('qr_login_sessions_token_idx').on(t.token)],
);

export const paymentLogs = pgTable('payment_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  shop_id: uuid('shop_id').notNull().references(() => shops.id, { onDelete: 'cascade' }),
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  currency: text('currency').notNull().default('THB'),
  status: text('status').notNull(),
  external_id: text('external_id'),
  metadata: jsonb('metadata'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── Audit Logs ────────────────────────────────────────────────────────────────
export const auditLogs = pgTable(
  'audit_logs',
  {
    id:             uuid('id').primaryKey().defaultRandom(),
    shop_id:        uuid('shop_id').references(() => shops.id, { onDelete: 'cascade' }),
    request_id:     text('request_id').notNull(),
    session_id:     text('session_id'),
    event:          text('event').notNull(),
    user_id:        uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    role:           text('role'),
    ip_address:     text('ip_address'),
    user_agent:     text('user_agent'),
    method:         text('method'),
    endpoint:       text('endpoint'),
    status:         text('status').notNull().default('success'),
    execution_time: integer('execution_time'),
    error_message:  text('error_message'),
    metadata:       jsonb('metadata').notNull().default({}),
    created_at:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_logs_shop_id_idx').on(t.shop_id),
    index('audit_logs_user_id_idx').on(t.user_id),
    index('audit_logs_event_idx').on(t.event),
    index('audit_logs_status_idx').on(t.status),
    index('audit_logs_created_at_idx').on(t.created_at),
    index('audit_logs_request_id_idx').on(t.request_id),
  ],
);

/** OTP สำหรับยืนยัน email ตอนสมัครสมาชิก */
export const emailOtps = pgTable('email_otps', {
  id:         uuid('id').primaryKey().defaultRandom(),
  email:      text('email').notNull(),
  otp_code:   varchar('otp_code', { length: 6 }).notNull(),
  ref_code:   varchar('ref_code', { length: 8 }).notNull(),
  verified:   boolean('verified').notNull().default(false),
  expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('email_otps_email_idx').on(t.email)]);

/** Token สำหรับ reset password — อายุ 2 นาที */
export const passwordResetTokens = pgTable('password_reset_tokens', {
  id:         uuid('id').primaryKey().defaultRandom(),
  email:      text('email').notNull(),
  user_id:    uuid('user_id').notNull(),
  used:       boolean('used').notNull().default(false),
  expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('pwd_reset_email_idx').on(t.email)]);
