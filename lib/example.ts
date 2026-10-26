// The built-in example for "Try an example". It is a small workbook (a Bookings sheet and an Items sheet) built in memory
// and then read by the same parseWorkbook + rulebook that read a real upload, so nothing here is a hard-coded result.
// Dates are relative to the browser's today so the example never goes stale. Nothing from the example is stored or sent.
import { PF } from './pf';

type Cell = string | number | null;
const B = (id: string, seller: string, from: string, to: string, country: string, kind: string, date: string, priority: string, pallets: number, cartons: number, value: number, gross: number, appt: string): Cell[] =>
  [id, seller, from, 'United Kingdom', to, country, kind, date, priority, pallets, cartons, value, 'GBP', gross, appt];
const I = (id: string, sku: string, desc: string, hs: Cell, qty: number, price: number, upc: number, cartons: number, weight: number, coo: string): Cell[] =>
  [id, sku, desc, hs, qty, price, upc, cartons, weight, coo];

/** Rows for the two sheets. `today` is an ISO date (YYYY-MM-DD). */
export function exampleTables(today: string) {
  const d = (n: number) => PF.dmy(PF.addDays(today, n));
  const bookings = [
    // a) fully clean
    B('EX-001', 'Northfield Goods', 'Manchester', 'Frankfurt', 'Germany', 'Warehouse', d(3), 'Cheapest', 3, 90, 5400, 620, 'Yes'),
    // b) amber only: a warehouse delivery with no appointment (R-08)
    B('EX-002', 'Harbour & Co', 'London', 'Paris', 'France', 'Warehouse', d(4), 'Fastest', 2, 70, 5600, 340, 'No'),
    // c) several reds: declared value (R-02), carton maths (R-03), an aerosol (R-06) and a missing HS code (R-01)
    B('EX-003', 'Hexa Gadgets', 'London', 'Frankfurt', 'Germany', 'Warehouse', d(5), 'Balanced', 1, 45, 4000, 160, 'Yes'),
    // d) heavy: 750 kg a pallet is over Carrier A's limit, so the cheapest carrier is ruled out and another is recommended
    B('EX-004', 'Forge Hardware', 'Manchester', 'Hamburg', 'Germany', 'Warehouse', d(2), 'Cheapest', 2, 100, 7000, 1500, 'Yes'),
  ];
  const items = [
    I('EX-001', 'MUG-01', 'Ceramic coffee mug, 350 ml', '691200', 1080, 5, 12, 90, 0.5, 'United Kingdom'),
    I('EX-002', 'CAND-01', 'Soy wax candle, 200 g', '340600', 700, 8, 10, 70, 0.45, 'United Kingdom'),
    I('EX-003', 'SPRAY-01', 'Aerosol deodorant spray, 150 ml', '330720', 200, 12, 10, 20, 0.2, 'United Kingdom'),
    I('EX-003', 'TOTE-01', 'Cotton tote bag', null, 600, 4.5, 20, 25, 0.2, 'India'),
    I('EX-004', 'TOOL-01', 'Steel hand tool set', '820600', 700, 10, 7, 100, 1.35, 'Germany'),
  ];
  return { bookings, items };
}

/** Builds the example workbook with the xlsx module and reads it back exactly as an uploaded file is read. */
export function parseExample(XLSX: any, today: string = PF.todayISO()) {
  const t = exampleTables(today);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Bookings: one row per shipment. Enter data from row 3.'], PF.BH, ...t.bookings]), 'Bookings');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Items: one row per product in a booking. Enter data from row 3.'], PF.IH, ...t.items]), 'Items');
  const data = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return PF.parseWorkbook(XLSX, data);
}
