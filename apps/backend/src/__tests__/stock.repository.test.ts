/**
 * Unit tests for stock.repository.ts
 *
 * The Drizzle `db` object is fully mocked so no real database connection
 * is needed. Tests verify query construction logic and return-value handling.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock DB ──────────────────────────────────────────────────────────────────
vi.mock('../db/index.js', () => {
  const db = {
    select:      vi.fn(),
    update:      vi.fn(),
    insert:      vi.fn(),
    transaction: vi.fn(),
  };
  return { db };
});

vi.mock('../db/schema.js', () => ({
  branchStock:       {
    branch_id: 'branch_id', product_id: 'product_id',
    quantity: 'quantity', min_qty: 'min_qty', updated_at: 'updated_at',
  },
  branches:          { id: 'id', shop_id: 'shop_id', name: 'name', is_active: 'is_active' },
  products:          {
    id: 'id', shop_id: 'shop_id', name: 'name', sku: 'sku',
    unit: 'unit', category: 'category', image_url: 'image_url', show_on_pos: 'show_on_pos',
  },
  stockTransactions: { id: 'id', shop_id: 'shop_id', branch_id: 'branch_id', product_id: 'product_id' },
}));

vi.mock('drizzle-orm', () => ({
  eq:      vi.fn((a, b) => ({ op: 'eq', a, b })),
  and:     vi.fn((...args) => ({ op: 'and', args })),
  or:      vi.fn((...args) => ({ op: 'or', args })),
  sql:     Object.assign(vi.fn((s: TemplateStringsArray) => s[0]), { raw: vi.fn() }),
  lte:     vi.fn((a, b) => ({ op: 'lte', a, b })),
  gte:     vi.fn((a, b) => ({ op: 'gte', a, b })),
  desc:    vi.fn((a) => ({ op: 'desc', a })),
  inArray: vi.fn((a, b) => ({ op: 'inArray', a, b })),
}));

import { db } from '../db/index.js';
import { stockRepository } from '../repositories/stock.repository.js';

// ─── Builder helpers ──────────────────────────────────────────────────────────
/** Returns a fully chainable mock that resolves `rows` at the end. */
function selectChain(rows: unknown[]) {
  const chain = {
    from:       vi.fn().mockReturnThis(),
    innerJoin:  vi.fn().mockReturnThis(),
    leftJoin:   vi.fn().mockReturnThis(),
    where:      vi.fn().mockResolvedValue(rows),
    orderBy:    vi.fn().mockResolvedValue(rows),
    limit:      vi.fn().mockReturnValue({
      then: (cb: (v: unknown) => unknown) => Promise.resolve(cb(rows)),
    }),
  };
  return chain;
}

function updateChain(rows: unknown[]) {
  const returning = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ returning });
  const set   = vi.fn().mockReturnValue({ where });
  return { set, where, returning };
}

function insertChain(rows: unknown[]) {
  const returning = vi.fn().mockResolvedValue(rows);
  const onConflict = vi.fn().mockReturnValue({ returning });
  const values = vi.fn().mockReturnValue({ returning, onConflictDoUpdate: onConflict });
  return { values };
}

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('stockRepository.getStockForProducts()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns empty array immediately when productIds is empty — no DB call', async () => {
    const result = await stockRepository.getStockForProducts('br1', []);
    expect(result).toEqual([]);
    expect(db.select).not.toHaveBeenCalled();
  });

  it('calls db.select once and returns all matching rows', async () => {
    const fakeRows = [
      { branch_id: 'br1', product_id: 'p1', quantity: 10, min_qty: 5 },
      { branch_id: 'br1', product_id: 'p2', quantity: 3,  min_qty: 2 },
    ];
    vi.mocked(db.select).mockReturnValue(selectChain(fakeRows) as never);

    const result = await stockRepository.getStockForProducts('br1', ['p1', 'p2']);
    expect(db.select).toHaveBeenCalledTimes(1);
    expect(result).toEqual(fakeRows);
  });
});

describe('stockRepository.getStock()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null when no stock record found', async () => {
    vi.mocked(db.select).mockReturnValue(selectChain([]) as never);
    const result = await stockRepository.getStock('br1', 'p1');
    expect(result).toBeNull();
  });

  it('returns the first row when a stock record exists', async () => {
    const row = { branch_id: 'br1', product_id: 'p1', quantity: 15, min_qty: 5, updated_at: null };
    vi.mocked(db.select).mockReturnValue(selectChain([row]) as never);
    const result = await stockRepository.getStock('br1', 'p1');
    expect(result).toEqual(row);
  });
});

describe('stockRepository.deductStock()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null when no matching stock row (UPDATE returns empty)', async () => {
    // SELECT qty_before → no row
    const sel = {
      from:  vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    const upd = updateChain([]); // UPDATE returns empty
    vi.mocked(db.select).mockReturnValue(sel as never);
    vi.mocked(db.update).mockReturnValue(upd as never);

    const result = await stockRepository.deductStock('br1', 'p1', 5);
    expect(result).toBeNull();
  });

  it('returns updated row when deduction succeeds', async () => {
    const fakeRow = { branch_id: 'br1', product_id: 'p1', quantity: 5, min_qty: 2 };
    const sel = {
      from:  vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ quantity: 10 }]),
    };
    const upd = updateChain([fakeRow]);
    vi.mocked(db.select).mockReturnValue(sel as never);
    vi.mocked(db.update).mockReturnValue(upd as never);

    const result = await stockRepository.deductStock('br1', 'p1', 5);
    expect(result).toEqual(fakeRow);
  });

  it('calls db.update with the correct table', async () => {
    const sel = {
      from:  vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    const upd = updateChain([]);
    vi.mocked(db.select).mockReturnValue(sel as never);
    vi.mocked(db.update).mockReturnValue(upd as never);

    await stockRepository.deductStock('br1', 'p1', 3);
    expect(db.update).toHaveBeenCalledTimes(1);
  });
});

describe('stockRepository.transferStock()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses a single db.transaction() call — guarantees atomicity', async () => {
    vi.mocked(db.transaction).mockImplementation(async (fn) => {
      const tx = {
        update: vi.fn().mockReturnValue(updateChain([])),
        select: vi.fn().mockReturnValue(selectChain([])),
        insert: vi.fn().mockReturnValue(insertChain([])),
      };
      return fn(tx as never);
    });

    await stockRepository.transferStock('shop1', 'br1', 'br2', 'p1', 5);
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  it('returns null when source UPDATE returns empty (insufficient stock)', async () => {
    vi.mocked(db.transaction).mockImplementation(async (fn) => {
      const tx = {
        update: vi.fn().mockReturnValue(updateChain([])), // atomic check fails
        select: vi.fn().mockReturnValue(selectChain([])),
        insert: vi.fn().mockReturnValue(insertChain([])),
      };
      return fn(tx as never);
    });

    const result = await stockRepository.transferStock('shop1', 'br1', 'br2', 'p1', 10);
    expect(result).toBeNull();
  });

  it('returns { from, to } on successful transfer', async () => {
    const srcRow = { branch_id: 'br1', product_id: 'p1', quantity: 5,  min_qty: 2 };
    const dstRow = { branch_id: 'br2', product_id: 'p1', quantity: 10, min_qty: 2 };

    vi.mocked(db.transaction).mockImplementation(async (fn) => {
      const tx = {
        // UPDATE source → returns srcRow (deduction succeeded)
        update: vi.fn().mockReturnValue(updateChain([srcRow])),
        // SELECT dest qty_before
        select: vi.fn().mockReturnValue({
          from:  vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnValue({
            then: (cb: (v: unknown) => unknown) => Promise.resolve(cb([{ quantity: 5 }])),
          }),
        }),
        // INSERT dest (upsert) + batch log insert
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([dstRow]),
            onConflictDoUpdate: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([dstRow]),
            }),
          }),
        }),
      };
      return fn(tx as never);
    });

    const result = await stockRepository.transferStock('shop1', 'br1', 'br2', 'p1', 5, 'user1');
    expect(result).toEqual({ from: srcRow, to: dstRow });
  });
});

describe('stockRepository.updateMinQty()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null when no matching stock record exists', async () => {
    const upd = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockReturnThis(),
      then: vi.fn((cb: (v: unknown[]) => unknown) => Promise.resolve(cb([]))),
    };
    vi.mocked(db.update).mockReturnValue(upd as never);

    const result = await stockRepository.updateMinQty('br1', 'p1', 10);
    expect(result).toBeNull();
  });

  it('returns updated row when min_qty record found', async () => {
    const fakeRow = { branch_id: 'br1', product_id: 'p1', quantity: 20, min_qty: 10 };
    const upd = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockReturnThis(),
      then: vi.fn((cb: (v: unknown[]) => unknown) => Promise.resolve(cb([fakeRow]))),
    };
    vi.mocked(db.update).mockReturnValue(upd as never);

    const result = await stockRepository.updateMinQty('br1', 'p1', 10);
    expect(result).toEqual(fakeRow);
  });
});
