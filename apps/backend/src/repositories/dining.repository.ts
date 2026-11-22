import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { diningSessions, diningTables, branches } from '../db/schema.js';

export async function countOpenSessionsForTable(diningTableId: string): Promise<number> {
  const [r] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(diningSessions)
    .where(and(eq(diningSessions.dining_table_id, diningTableId), eq(diningSessions.status, 'open')));
  return Number(r?.c ?? 0);
}

export const diningRepository = {
  listTables(shopId: string, branchId: string) {
    return db
      .select()
      .from(diningTables)
      .where(
        and(
          eq(diningTables.shop_id, shopId),
          eq(diningTables.branch_id, branchId),
        ),
      )
      .orderBy(asc(diningTables.sort_order), asc(diningTables.label));
  },

  getTableById(tableId: string, shopId: string) {
    return db
      .select()
      .from(diningTables)
      .where(and(eq(diningTables.id, tableId), eq(diningTables.shop_id, shopId)))
      .then((rows) => rows[0] ?? null);
  },

  async insertTable(shopId: string, data: {
    branch_id: string;
    label: string;
    capacity?: number;
    sort_order?: number;
    is_active?: boolean;
  }) {
    const [row] = await db
      .insert(diningTables)
      .values({
        shop_id:     shopId,
        branch_id:   data.branch_id,
        label:       data.label,
        capacity:    data.capacity ?? null,
        sort_order:  data.sort_order ?? 0,
        is_active:   data.is_active ?? true,
      })
      .returning();
    return row ?? null;
  },

  async updateTable(
    tableId: string,
    shopId: string,
    data: { label?: string; capacity?: number | null; sort_order?: number; is_active?: boolean },
  ) {
    const [row] = await db
      .update(diningTables)
      .set({ ...data, updated_at: new Date() })
      .where(and(eq(diningTables.id, tableId), eq(diningTables.shop_id, shopId)))
      .returning();
    return row ?? null;
  },

  async deleteTable(tableId: string, shopId: string) {
    const [row] = await db
      .delete(diningTables)
      .where(and(eq(diningTables.id, tableId), eq(diningTables.shop_id, shopId)))
      .returning();
    return row ?? null;
  },
};

export const diningSessionRepository = {
  create(shopId: string, data: { branch_id: string; dining_table_id: string; guest_count?: number | null }) {
    return db
      .insert(diningSessions)
      .values({
        shop_id:         shopId,
        branch_id:       data.branch_id,
        dining_table_id: data.dining_table_id,
        status:          'open',
        guest_count:     data.guest_count ?? null,
        opened_at:       new Date(),
      })
      .returning()
      .then((rows) => rows[0] ?? null);
  },

  getById(sessionId: string, shopId: string) {
    return db
      .select()
      .from(diningSessions)
      .where(and(eq(diningSessions.id, sessionId), eq(diningSessions.shop_id, shopId)))
      .then((rows) => rows[0] ?? null);
  },

  listOpen(shopId: string, branchId: string) {
    return db
      .select({
        session:    diningSessions,
        tableLabel: diningTables.label,
        branchName: branches.name,
      })
      .from(diningSessions)
      .innerJoin(diningTables, eq(diningTables.id, diningSessions.dining_table_id))
      .innerJoin(branches, eq(branches.id, diningSessions.branch_id))
      .where(
        and(
          eq(diningSessions.shop_id, shopId),
          eq(diningSessions.branch_id, branchId),
          eq(diningSessions.status, 'open'),
        ),
      )
      .orderBy(desc(diningSessions.opened_at));
  },

  setClosed(sessionId: string, shopId: string) {
    return db
      .update(diningSessions)
      .set({ status: 'closed', closed_at: new Date(), updated_at: new Date() })
      .where(and(eq(diningSessions.id, sessionId), eq(diningSessions.shop_id, shopId)))
      .returning()
      .then((rows) => rows[0] ?? null);
  },
};
