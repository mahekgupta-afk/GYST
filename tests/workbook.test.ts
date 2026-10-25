import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { PF } from '../lib/pf';

describe('real xlsx upload (same path the browser uses)', () => {
  const buf = readFileSync(__dirname + '/fixtures/planted.xlsx');
  const res = PF.parseWorkbook(XLSX, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const rulesOf = (id: string) => PF.evaluate(res.bookings.find((b: any) => b.id === id)).issues.map((i: any) => i.rule);

  it('reads all 14 bookings with no parse error', () => {
    expect(res.error).toBeFalsy();
    expect(res.bookings).toHaveLength(14);
  });
  it('catches the planted errors', () => {
    expect(rulesOf('BK-002')).toContain('R-01');
    expect(rulesOf('BK-003')).toContain('R-02');
    expect(rulesOf('BK-004')).toContain('R-03');
    expect(rulesOf('BK-005')).toContain('R-04');
    expect(rulesOf('BK-006')).toContain('R-05');
    expect(rulesOf('BK-008')).toContain('R-06');
    expect(rulesOf('BK-014')).toHaveLength(0);
  });
});
