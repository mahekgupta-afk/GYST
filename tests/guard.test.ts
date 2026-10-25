import { describe, it, expect } from 'vitest';
import { dropInventedTotals } from '../lib/server/guard';

describe('dropInventedTotals', () => {
  it('drops totals the seller never stated', () => {
    const r = dropInventedTotals({ cartons: 60, declaredValue: 3000, pallets: null }, { items: [] }, '600 coasters, £5 each, 10 to a carton');
    expect(r.cartons).toBeNull();
    expect(r.declaredValue).toBeNull();
  });
  it('keeps totals the seller did state', () => {
    const r = dropInventedTotals({ pallets: 3, grossWeight: 1250 }, { items: [] }, '3 pallets, 1,250 kg in total');
    expect(r.pallets).toBe(3);
    expect(r.grossWeight).toBe(1250);
  });
  it('keeps number words', () => {
    expect(dropInventedTotals({ pallets: 2 }, { items: [] }, 'two pallets').pallets).toBe(2);
  });
  it('allows edits to a known total (add a pallet)', () => {
    expect(dropInventedTotals({ pallets: 4 }, { pallets: 3, items: [] }, 'add a pallet').pallets).toBe(4);
  });
});
