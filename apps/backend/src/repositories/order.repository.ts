import { eq, and, gte, lte, sql, desc, SQL, ilike } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { db } from '../db/index.js';
import { orders, orderItems, products, branches, users, shops } from '../db/schema.js';

/** Generate globally unique 5-letter + 5-digit ref code (e.g. ABCDE12345) */
async function generateRefCode(): Promise<string> {
  const L = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const D = '0123456789';
  for (let attempt = 0; attempt < 5; attempt++) {
    let code = '';
    for (let i = 0; i < 5; i++) code += L[Math.floor(Math.random() * 26)];
    for (let i = 0; i < 5; i++) code += D[Math.floor(Math.random() * 10)];
    const existing = await db.select({ id: orders.id }).from(orders).where(eq(orders.ref_code, code)).limit(1);
    if (existing.length === 0) return code;
  }
  // Extremely unlikely fallback: use randomUUID prefix
  return randomUUID().replace(/-/g, '').slice(0, 5).toUpperCase() + String(Date.now()).slice(-5);
}

export const orderRepository = {
  /** Build shared WHERE conditions for orders list/count */
  buildConditions(shopId: string, opts: { status?: string; seq?: number; date?: string; ref?: string }): SQL {
    const parts: SQL[] = [eq(orders.shop_id, shopId)];
    if (opts.status) {
      parts.push(eq(orders.status, opts.status as 'pending' | 'paid' | 'void' | 'refunded'));
    }
    if (opts.seq) {
      parts.push(eq(orders.daily_seq, opts.seq));
    }
    if (opts.date) {
      // date format: YYYY-MM-DD, filter by Bangkok timezone date
      parts.push(sql`(${orders.created_at} AT TIME ZONE 'Asia/Bangkok')::date = ${opts.date}::date`);
    }
    if (opts.ref) {
      // Case-insensitive search on ref_code
      parts.push(ilike(orders.ref_code, opts.ref.trim()));
    }
    return and(...parts) as SQL;
  },

  /** Count total orders for a shop (optionally filtered by status/seq/date) */
  async countByShop(shopId: string, opts: { status?: string; seq?: number; date?: string; ref?: string } = {}): Promise<number> {
    const [row] = await db
      .select({ count: sql<string>`COUNT(*)::int` })
      .from(orders)
      .where(this.buildConditions(shopId, opts));
    return Number(row?.count ?? 0);
  },

  async create(data: {
    shop_id:         string;
    branch_id:       string;
    user_id:         string;
    customer_id?:    string;
    total:           string;
    discount?:       string;
    points_earned?:  number;
    points_redeemed?: number;
    payment_method?: 'cash' | 'card' | 'transfer' | 'other';
    cash_received?:  string;
  }) {
    // Cumulative order number per shop
    const [maxRow] = await db
      .select({ max: sql<number>`COALESCE(MAX(order_number), 0)::int` })
      .from(orders)
      .where(eq(orders.shop_id, data.shop_id));
    const nextOrderNumber = (maxRow?.max ?? 0) + 1;

    // Daily sequence per shop — resets at midnight Bangkok time (UTC+7)
    const [dailyRow] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(orders)
      .where(
        and(
          eq(orders.shop_id, data.shop_id),
          sql`(created_at AT TIME ZONE 'Asia/Bangkok')::date = (NOW() AT TIME ZONE 'Asia/Bangkok')::date`,
        )
      );
    const nextDailySeq = (dailyRow?.count ?? 0) + 1;
    const refCode = await generateRefCode();

    return db
      .insert(orders)
      .values({
        order_number:    nextOrderNumber,
        daily_seq:       nextDailySeq,
        receipt_token:   randomUUID(),
        ref_code:        refCode,
        shop_id:         data.shop_id,
        branch_id:       data.branch_id,
        user_id:         data.user_id,
        customer_id:     data.customer_id ?? null,
        total:           data.total,
        discount:        data.discount ?? '0',
        points_earned:   data.points_earned ?? 0,
        points_redeemed: data.points_redeemed ?? 0,
        payment_method:  data.payment_method ?? null,
        cash_received:   data.cash_received ?? null,
        status: 'paid',
      })
      .returning()
      .then((rows) => rows[0] ?? null);
  },

  createItems(items: Array<{
    order_id: string;
    product_id: string;
    quantity: number;
    unit_price: string;
    subtotal: string;
  }>) {
    return db.insert(orderItems).values(items).returning();
  },

  getById(orderId: string, shopId: string) {
    return db
      .select()
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.shop_id, shopId)))
      .then((rows) => rows[0] ?? null);
  },

  getItemsByOrderId(orderId: string) {
    return db.select().from(orderItems).where(eq(orderItems.order_id, orderId));
  },

  listByShop(shopId: string, opts: { limit?: number; offset?: number; status?: string; seq?: number; date?: string; ref?: string } = {}) {
    const limit = opts.limit ?? 50;
    const offset = opts.offset ?? 0;
    const conditions = this.buildConditions(shopId, opts);
    const refundUsers = db.$with('refund_users').as(
      db.select({ id: users.id, email: users.email }).from(users),
    );
    return db
      .with(refundUsers)
      .select({
        id: orders.id,
        order_number:  orders.order_number,
        daily_seq:     orders.daily_seq,
        ref_code:      orders.ref_code,
        receipt_token: orders.receipt_token,
        branch_id: orders.branch_id,
        branch_name: branches.name,
        user_id: orders.user_id,
        user_email: sql<string>`COALESCE(${users.email}, '—')`.as('user_email'),
        status: orders.status,
        total: orders.total,
        payment_method: orders.payment_method,
        created_at: orders.created_at,
        refund_type:        orders.refund_type,
        refund_reason:      orders.refund_reason,
        refunded_at:        orders.refunded_at,
        refunded_by:        orders.refunded_by,
        refunded_by_email:  sql<string | null>`(SELECT email FROM users WHERE id = ${orders.refunded_by})`.as('refunded_by_email'),
      })
      .from(orders)
      .innerJoin(branches, eq(branches.id, orders.branch_id))
      .leftJoin(users, eq(users.id, orders.user_id))
      .where(conditions)
      .orderBy(desc(orders.created_at))
      .limit(limit)
      .offset(offset);
  },

  /** ออเดอร์ของสาขานี้วันนี้ เรียงใหม่สุดก่อน */
  listTodayByBranch(shopId: string, branchId: string) {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    return db
      .select({
        id:             orders.id,
        order_number:   orders.order_number,
        daily_seq:      orders.daily_seq,
        receipt_token:  orders.receipt_token,
        status:         orders.status,
        total:          orders.total,
        payment_method: orders.payment_method,
        created_at:     orders.created_at,
      })
      .from(orders)
      .where(
        and(
          eq(orders.shop_id, shopId),
          eq(orders.branch_id, branchId),
          gte(orders.created_at, startOfToday),
        )
      )
      .orderBy(desc(orders.created_at));
  },

  /** นับออเดอร์วันนี้ของร้าน (ใช้เป็นเลขลำดับ) */
  async countTodayByShop(shopId: string): Promise<number> {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const [row] = await db
      .select({ count: sql<string>`COUNT(*)::int` })
      .from(orders)
      .where(
        and(
          eq(orders.shop_id, shopId),
          gte(orders.created_at, startOfToday),
        )
      );
    return Number(row?.count ?? 0);
  },

  async getSalesSummary(shopId: string, period: 'day' | 'month' | 'year', branchId?: string | null) {
    const now = new Date();
    // date range in Bangkok timezone
    let fromDate: Date;
    let toDate: Date = new Date(now.getTime() + 24 * 60 * 60 * 1000); // tomorrow (upper bound)

    const bkk = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
    if (period === 'day') {
      fromDate = new Date(bkk.getFullYear(), bkk.getMonth(), bkk.getDate());
      toDate   = new Date(fromDate.getTime() + 24 * 60 * 60 * 1000);
    } else if (period === 'month') {
      fromDate = new Date(bkk.getFullYear(), bkk.getMonth(), 1);
      toDate   = new Date(bkk.getFullYear(), bkk.getMonth() + 1, 1);
    } else {
      fromDate = new Date(bkk.getFullYear(), 0, 1);
      toDate   = new Date(bkk.getFullYear() + 1, 0, 1);
    }

    const [row] = await db
      .select({
        order_count: sql<number>`COUNT(DISTINCT ${orders.id})::int`,
        revenue:     sql<string>`COALESCE(SUM(${orders.total})::numeric, 0)`,
        discount:    sql<string>`COALESCE(SUM(${orders.discount})::numeric, 0)`,
        cogs:        sql<string>`COALESCE(SUM(${orderItems.quantity} * CAST(${products.cost_price} AS NUMERIC)), 0)`,
      })
      .from(orders)
      .innerJoin(orderItems, eq(orderItems.order_id, orders.id))
      .innerJoin(products,   eq(products.id, orderItems.product_id))
      .where(
        and(
          eq(orders.shop_id, shopId),
          eq(orders.status, 'paid'),
          gte(orders.created_at, fromDate),
          lte(orders.created_at, toDate),
          branchId ? eq(orders.branch_id, branchId) : undefined,
        ),
      );

    const revenue = Number(row?.revenue ?? 0);
    const cogs    = Number(row?.cogs    ?? 0);
    const gp      = revenue - cogs;
    return {
      orderCount:  Number(row?.order_count ?? 0),
      revenue,
      discount:    Number(row?.discount ?? 0),
      cogs,
      grossProfit: gp,
      marginPct:   revenue > 0 ? Math.round((gp / revenue) * 10000) / 100 : 0,
    };
  },

  async getPnlReport(
    shopId: string,
    opts: {
      fromDate: Date;
      toDate:   Date;
      branchId?: string;
      groupBy:  'day' | 'month';
    },
  ) {
    const { fromDate, toDate, branchId, groupBy } = opts;
    // Use sql.raw so the literal 'day'/'month' is embedded directly,
    // not parameterised — PostgreSQL requires the same expression in
    // SELECT and GROUP BY to match (parameterised $1 ≠ $2 even if equal).
    const truncLit = sql.raw(`'${groupBy === 'month' ? 'month' : 'day'}'`);
    const periodExpr = sql<string>`DATE_TRUNC(${truncLit}, ${orders.created_at})::date`;

    const conds = [
      eq(orders.shop_id, shopId),
      eq(orders.status, 'paid'),
      gte(orders.created_at, fromDate),
      lte(orders.created_at, toDate),
    ];
    if (branchId) conds.push(eq(orders.branch_id, branchId));

    // ── Grouped rows: revenue + COGS per period ──────────────────
    const rows = await db
      .select({
        period:      periodExpr,
        order_count: sql<number>`COUNT(DISTINCT ${orders.id})::int`,
        revenue:     sql<string>`COALESCE(SUM(${orders.total})::numeric, 0)`,
        cogs:        sql<string>`COALESCE(SUM(${orderItems.quantity} * CAST(${products.cost_price} AS NUMERIC)), 0)`,
      })
      .from(orders)
      .innerJoin(orderItems, eq(orderItems.order_id, orders.id))
      .innerJoin(products,   eq(products.id, orderItems.product_id))
      .where(and(...conds))
      .groupBy(periodExpr)
      .orderBy(periodExpr);

    // ── Top-10 products: qty sold, revenue, COGS ─────────────────
    const topProducts = await db
      .select({
        product_id:   orderItems.product_id,
        product_name: products.name,
        qty_sold:     sql<number>`SUM(${orderItems.quantity})::int`,
        revenue:      sql<string>`COALESCE(SUM(${orderItems.subtotal})::numeric, 0)`,
        cogs:         sql<string>`COALESCE(SUM(${orderItems.quantity} * CAST(${products.cost_price} AS NUMERIC)), 0)`,
      })
      .from(orderItems)
      .innerJoin(orders,   eq(orders.id, orderItems.order_id))
      .innerJoin(products, eq(products.id, orderItems.product_id))
      .where(and(...conds))
      .groupBy(orderItems.product_id, products.name)
      .orderBy(sql`SUM(${orderItems.subtotal}) DESC`)
      .limit(10);

    // ── Summary totals ────────────────────────────────────────────
    let totalRevenue = 0;
    let totalCogs    = 0;
    let totalOrders  = 0;

    const mappedRows = rows.map((r) => {
      const rev  = Number(r.revenue);
      const cogs = Number(r.cogs);
      const gp   = rev - cogs;
      totalRevenue += rev;
      totalCogs    += cogs;
      totalOrders  += r.order_count;
      return {
        period:       String(r.period),
        order_count:  r.order_count,
        revenue:      rev,
        cogs,
        gross_profit: gp,
        margin_pct:   rev > 0 ? Math.round((gp / rev) * 10000) / 100 : 0,
      };
    });

    const totalGp  = totalRevenue - totalCogs;
    const marginPct = totalRevenue > 0 ? Math.round((totalGp / totalRevenue) * 10000) / 100 : 0;

    return {
      summary: {
        revenue:      totalRevenue,
        cogs:         totalCogs,
        gross_profit: totalGp,
        margin_pct:   marginPct,
        order_count:  totalOrders,
        avg_order_value: totalOrders > 0 ? Math.round((totalRevenue / totalOrders) * 100) / 100 : 0,
      },
      rows: mappedRows,
      top_products: topProducts.map((p) => {
        const rev  = Number(p.revenue);
        const cogs = Number(p.cogs);
        return {
          product_id:   p.product_id,
          product_name: p.product_name,
          qty_sold:     p.qty_sold,
          revenue:      rev,
          cogs,
          gross_profit: rev - cogs,
        };
      }),
    };
  },

  getWithItems(orderId: string, shopId: string) {
    return db
      .select({
        order_id:       orders.id,
        order_number:   orders.order_number,
        daily_seq:      orders.daily_seq,
        receipt_token:  orders.receipt_token,
        status:         orders.status,
        total:          orders.total,
        payment_method: orders.payment_method,
        created_at:     orders.created_at,
        branch_id:      orders.branch_id,
        branch_name:    branches.name,
        staff_email:    users.email,
        item_id:        orderItems.id,
        product_id:     orderItems.product_id,
        product_name:   products.name,
        quantity:       orderItems.quantity,
        unit_price:     orderItems.unit_price,
        subtotal:       orderItems.subtotal,
      })
      .from(orders)
      .innerJoin(branches,    eq(branches.id,    orders.branch_id))
      .innerJoin(users,       eq(users.id,       orders.user_id))
      .innerJoin(orderItems,  eq(orderItems.order_id, orders.id))
      .innerJoin(products,    eq(products.id,    orderItems.product_id))
      .where(and(eq(orders.id, orderId), eq(orders.shop_id, shopId)));
  },

  /** Public receipt — no auth, access by receipt_token UUID only */
  async getByReceiptToken(token: string) {
    // Validate UUID format to prevent injection
    if (!/^[0-9a-f-]{36}$/i.test(token)) return null;

    const rows = await db
      .select({
        order_id:       orders.id,
        order_number:   orders.order_number,
        daily_seq:      orders.daily_seq,
        ref_code:       orders.ref_code,
        receipt_token:  orders.receipt_token,
        status:         orders.status,
        total:          orders.total,
        payment_method: orders.payment_method,
        cash_received:  orders.cash_received,
        created_at:     orders.created_at,
        branch_id:      orders.branch_id,
        branch_name:    branches.name,
        branch_address: branches.address,
        shop_id:        orders.shop_id,
        shop_name:      shops.name,
        shop_logo_url:  shops.logo_url,
        vat_enabled:           shops.vat_enabled,
        shop_phone:            shops.phone,
        shop_tax_id:           shops.tax_id,
        shop_address:          shops.address,
        shop_opening_hours:    shops.opening_hours,
        shop_working_days:     shops.working_days,
        shop_google_review_url: shops.google_review_url,
        discount:         orders.discount,
        points_earned:    orders.points_earned,
        points_redeemed:  orders.points_redeemed,
        staff_email:      users.email,
        item_id:        orderItems.id,
        product_id:     orderItems.product_id,
        product_name:   products.name,
        quantity:       orderItems.quantity,
        unit_price:     orderItems.unit_price,
        subtotal:       orderItems.subtotal,
      })
      .from(orders)
      .innerJoin(branches,   eq(branches.id,          orders.branch_id))
      .innerJoin(shops,      eq(shops.id,             orders.shop_id))
      .innerJoin(users,      eq(users.id,             orders.user_id))
      .innerJoin(orderItems, eq(orderItems.order_id,  orders.id))
      .innerJoin(products,   eq(products.id,          orderItems.product_id))
      .where(eq(orders.receipt_token, token));

    if (rows.length === 0) return null;

    const first = rows[0]!;
    return {
      order_id:      first.order_id,
      order_number:  first.order_number,
      daily_seq:     first.daily_seq,
      ref_code:      first.ref_code      ?? null,
      receipt_token: first.receipt_token,
      status:        first.status,
      total:         first.total,
      payment_method: first.payment_method,
      created_at:    first.created_at,
      branch_id:     first.branch_id,
      branch_name:   first.branch_name,
      branch_address: first.branch_address,
      shop_id:       first.shop_id,
      shop_name:     first.shop_name,
      shop_logo_url: first.shop_logo_url,
      vat_enabled:           first.vat_enabled,
      shop_phone:            first.shop_phone            ?? null,
      shop_tax_id:           first.shop_tax_id           ?? null,
      shop_address:          first.shop_address          ?? null,
      shop_opening_hours:    first.shop_opening_hours    ?? null,
      shop_working_days:     first.shop_working_days     ?? null,
      shop_google_review_url: first.shop_google_review_url ?? null,
      discount:         first.discount,
      cash_received:    first.cash_received,
      points_earned:    first.points_earned,
      points_redeemed:  first.points_redeemed,
      staff_name:       first.staff_email?.split('@')[0] ?? '',
      items: rows.map((r) => ({
        id:           r.item_id,
        product_id:   r.product_id,
        product_name: r.product_name,
        quantity:     r.quantity,
        unit_price:   r.unit_price,
        subtotal:     r.subtotal,
      })),
    };
  },

  updateStatus(orderId: string, shopId: string, status: 'void' | 'refunded') {
    return db
      .update(orders)
      .set({ status, updated_at: new Date() })
      .where(and(eq(orders.id, orderId), eq(orders.shop_id, shopId)))
      .returning()
      .then((rows) => rows[0] ?? null);
  },

  saveRefundOtp(orderId: string, shopId: string, otp: string, expiresAt: Date) {
    return db
      .update(orders)
      .set({ refund_otp: otp, refund_otp_expires_at: expiresAt, updated_at: new Date() })
      .where(and(eq(orders.id, orderId), eq(orders.shop_id, shopId)))
      .returning()
      .then((rows) => rows[0] ?? null);
  },

  applyRefund(
    orderId: string,
    shopId: string,
    data: { reason: string; refund_type: 'money_mistake' | 'product_return'; refunded_by: string; cash_received?: number },
  ) {
    return db
      .update(orders)
      .set({
        status:                'refunded',
        refund_reason:         data.reason,
        refund_type:           data.refund_type,
        refunded_at:           new Date(),
        refunded_by:           data.refunded_by,
        refund_otp:            null,
        refund_otp_expires_at: null,
        cash_received:         data.cash_received != null ? String(data.cash_received) : null,
        updated_at:            new Date(),
      })
      .where(and(eq(orders.id, orderId), eq(orders.shop_id, shopId)))
      .returning()
      .then((rows) => rows[0] ?? null);
  },

  async getStats(shopId: string, opts?: { fromDate?: Date; toDate?: Date; branchId?: string }) {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek  = new Date(startOfToday);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfYear  = new Date(now.getFullYear(), 0, 1);

    const { fromDate, toDate, branchId } = opts ?? {};
    const branchCond = branchId ? [eq(orders.branch_id, branchId)] : [];

    // ── Summary (always current time, optional branch) ──
    const fetchSummary = async (from: Date) => {
      const [row] = await db
        .select({
          total: sql<string>`COALESCE(SUM(${orders.total})::numeric, 0)`,
          count: sql<string>`COUNT(*)::int`,
        })
        .from(orders)
        .where(and(eq(orders.shop_id, shopId), eq(orders.status, 'paid'), gte(orders.created_at, from), ...branchCond));
      return { total: String(row?.total ?? '0'), orderCount: Number(row?.count ?? 0) };
    };

    const [daily, weekly, monthly, yearly] = await Promise.all([
      fetchSummary(startOfToday),
      fetchSummary(startOfWeek),
      fetchSummary(startOfMonth),
      fetchSummary(startOfYear),
    ]);

    // ── Monthly COGS → gross profit ──────────────────────────────────
    const [monthlyCogsRow] = await db
      .select({
        cogs: sql<string>`COALESCE(SUM(${orderItems.quantity} * CAST(${products.cost_price} AS NUMERIC)), 0)`,
      })
      .from(orderItems)
      .innerJoin(orders,   eq(orders.id,   orderItems.order_id))
      .innerJoin(products, eq(products.id, orderItems.product_id))
      .where(and(
        eq(orders.shop_id, shopId),
        eq(orders.status, 'paid'),
        gte(orders.created_at, startOfMonth),
        ...branchCond,
      ));
    const monthlyCogs   = Number(monthlyCogsRow?.cogs ?? 0);
    const monthlyRevenue = Number(monthly.total);
    const monthlyGrossProfit = monthlyRevenue - monthlyCogs;

    // ── Period conditions (custom date range or default = this month) ──
    const periodFrom = fromDate ?? startOfMonth;
    const periodTo   = toDate   ?? now;
    const periodBase = [
      eq(orders.shop_id, shopId),
      eq(orders.status, 'paid'),
      gte(orders.created_at, periodFrom),
      lte(orders.created_at, periodTo),
      ...branchCond,
    ];

    // Period revenue + order count
    const [periodRow] = await db
      .select({
        total: sql<string>`COALESCE(SUM(${orders.total})::numeric, 0)`,
        count: sql<string>`COUNT(*)::int`,
      })
      .from(orders)
      .where(and(...periodBase));

    // Period total items sold (all products, not just top 10)
    const [qtyRow] = await db
      .select({ totalQty: sql<number>`COALESCE(SUM(${orderItems.quantity})::int, 0)` })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.order_id))
      .where(and(...periodBase));

    // Top products for selected period
    const topProducts = await db
      .select({
        product_id: orderItems.product_id,
        name:     products.name,
        quantity: sql<number>`SUM(${orderItems.quantity})::int`,
        subtotal: sql<string>`SUM(${orderItems.subtotal})::numeric`,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.order_id))
      .innerJoin(products, eq(products.id, orderItems.product_id))
      .where(and(...periodBase))
      .groupBy(orderItems.product_id, products.name)
      .orderBy(sql`SUM(${orderItems.quantity}) DESC`)
      .limit(10);

    // Payment breakdown for selected period
    const paymentBreakdown = await db
      .select({
        method: orders.payment_method,
        count:  sql<string>`COUNT(*)::int`,
        total:  sql<string>`COALESCE(SUM(${orders.total})::numeric, 0)`,
      })
      .from(orders)
      .where(and(...periodBase))
      .groupBy(orders.payment_method);

    // ── Money Mistake Stats (over / under received) ──────────────────
    const fetchMoneyMistake = async (from: Date, to?: Date) => {
      const conditions = [
        eq(orders.shop_id, shopId),
        eq(orders.refund_type, 'money_mistake'),
        sql`${orders.cash_received} IS NOT NULL`,
        gte(orders.refunded_at, from),
        ...branchCond,
      ];
      if (to) conditions.push(lte(orders.refunded_at, to));

      const [row] = await db
        .select({
          over_total:  sql<string>`COALESCE(SUM(CASE WHEN ${orders.cash_received}::numeric > ${orders.total}::numeric THEN ${orders.cash_received}::numeric - ${orders.total}::numeric ELSE 0 END), 0)`,
          under_total: sql<string>`COALESCE(SUM(CASE WHEN ${orders.cash_received}::numeric < ${orders.total}::numeric THEN ${orders.total}::numeric - ${orders.cash_received}::numeric ELSE 0 END), 0)`,
          over_count:  sql<string>`COUNT(CASE WHEN ${orders.cash_received}::numeric > ${orders.total}::numeric THEN 1 END)::int`,
          under_count: sql<string>`COUNT(CASE WHEN ${orders.cash_received}::numeric < ${orders.total}::numeric THEN 1 END)::int`,
        })
        .from(orders)
        .where(and(...conditions));
      return {
        over_total:  Number(row?.over_total  ?? 0),
        under_total: Number(row?.under_total ?? 0),
        over_count:  Number(row?.over_count  ?? 0),
        under_count: Number(row?.under_count ?? 0),
      };
    };

    const [mmDaily, mmMonthly, mmYearly] = await Promise.all([
      fetchMoneyMistake(startOfToday),
      fetchMoneyMistake(startOfMonth),
      fetchMoneyMistake(startOfYear),
    ]);

    return {
      period: {
        total:      String(periodRow?.total ?? '0'),
        orderCount: Number(periodRow?.count ?? 0),
        totalQty:   Number(qtyRow?.totalQty ?? 0),
      },
      daily,
      weekly,
      monthly: {
        ...monthly,
        cogs:         monthlyCogs,
        gross_profit: monthlyGrossProfit,
      },
      yearly,
      paymentBreakdown: paymentBreakdown.map((r) => ({
        method: r.method ?? 'other',
        count:  Number(r.count),
        total:  String(r.total),
      })),
      topProducts: topProducts.map((p) => ({
        productId: p.product_id,
        name:      p.name,
        quantity:  Number(p.quantity),
        subtotal:  String(p.subtotal),
      })),
      moneyMistake: {
        daily:   mmDaily,
        monthly: mmMonthly,
        yearly:  mmYearly,
      },
    };
  },
};
