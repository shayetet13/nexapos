import { describe, it, expect } from 'vitest';
import { bkkDayStart, bkkMonthStart, bkkYearStart, parseBkkDate } from '../lib/bkk-time.js';

describe('bkk-time day boundaries', () => {
  it('bkkDayStart is 00:00 Bangkok (17:00Z the previous day)', () => {
    // 2026-03-10 08:30 Bangkok = 01:30Z
    expect(bkkDayStart(new Date('2026-03-10T01:30:00Z')).toISOString()).toBe('2026-03-09T17:00:00.000Z');
  });

  it('rolls to the next Bangkok day at 17:00Z', () => {
    // 2026-03-09 17:30Z = 2026-03-10 00:30 Bangkok
    expect(bkkDayStart(new Date('2026-03-09T17:30:00Z')).toISOString()).toBe('2026-03-09T17:00:00.000Z');
    // 2026-03-09 16:59Z = 2026-03-09 23:59 Bangkok
    expect(bkkDayStart(new Date('2026-03-09T16:59:00Z')).toISOString()).toBe('2026-03-08T17:00:00.000Z');
  });

  it('bkkMonthStart / bkkYearStart use Bangkok calendar boundaries', () => {
    // 2026-01-31 18:00Z = 2026-02-01 01:00 Bangkok → February already
    const now = new Date('2026-01-31T18:00:00Z');
    expect(bkkMonthStart(now).toISOString()).toBe('2026-01-31T17:00:00.000Z');
    expect(bkkYearStart(now).toISOString()).toBe('2025-12-31T17:00:00.000Z');
  });
});

describe('parseBkkDate', () => {
  it('parses YYYY-MM-DD as 00:00 Bangkok', () => {
    expect(parseBkkDate('2026-03-10')?.toISOString()).toBe('2026-03-09T17:00:00.000Z');
  });

  it.each(['', '2026-3-10', '2026-02-30', '2026-13-01', '10/03/2026', '2026-03-10T00:00'])(
    'rejects invalid input "%s"',
    (value) => {
      expect(parseBkkDate(value)).toBeNull();
    },
  );
});
