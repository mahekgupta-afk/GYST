import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { analyse } from '../lib/server/uploads';

const planted = readFileSync(__dirname + '/fixtures/planted.xlsx');

describe('server-side upload analysis (what gets stored in Neon)', () => {
  it('summarises the planted-errors file', () => {
    const a: any = analyse('planted.xlsx', planted);
    expect(a.error).toBeUndefined();
    expect(a.bookingCount).toBe(14);
    expect(a.red + a.amber + a.clear).toBe(14);
    expect(a.red).toBeGreaterThan(0);
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(a.results.find((r: any) => r.id === 'BK-007').issues.map((i: any) => i.rule)).toContain('R-05');
  });
  it('gives the same hash for the same bytes', () => {
    expect((analyse('a.xlsx', planted) as any).sha256).toBe((analyse('b.xlsx', planted) as any).sha256);
  });
  it('rejects wrong extensions, empty and non-spreadsheet files', () => {
    expect(analyse('notes.txt', planted)).toHaveProperty('error');
    expect(analyse('a.xlsx', Buffer.alloc(0))).toHaveProperty('error');
    expect(analyse('a.xlsx', Buffer.from('this is not a spreadsheet'))).toHaveProperty('error');
  });
  it('rejects files over 4 MB', () => {
    expect(analyse('big.xlsx', Buffer.alloc(4 * 1024 * 1024 + 1))).toHaveProperty('error');
  });
});
