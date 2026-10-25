import { createHash } from 'node:crypto';
import * as XLSX from 'xlsx';
import { PF } from '../pf';

export const MAX_BYTES = 4 * 1024 * 1024; // Vercel rejects request bodies over ~4.5 MB
const EXT = /\.(xlsx|xls|xlsm|ods)$/i;

export type Analysis = {
  sha256: string;
  bookingCount: number;
  red: number;
  amber: number;
  clear: number;
  results: { id: string; seller: string | null; status: string; red: number; amber: number; issues: { rule: string; sev: string; item: string | null; title: string }[] }[];
};

export type Rejected = { error: string };

/** Re-runs the same parser and rules engine the browser uses, so what is stored matches what the user saw. */
export function analyse(name: string, bytes: Buffer): Analysis | Rejected {
  if (!EXT.test(name)) return { error: 'Only .xlsx, .xls, .xlsm and .ods files are accepted.' };
  if (bytes.length === 0) return { error: 'The file is empty.' };
  if (bytes.length > MAX_BYTES) return { error: 'The file is larger than 4 MB.' };
  let parsed: any;
  try {
    parsed = PF.parseWorkbook(XLSX, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  } catch {
    return { error: 'The file could not be read as a spreadsheet.' };
  }
  if (parsed.error) return { error: String(parsed.error) };
  if (!parsed.bookings.length) return { error: 'The Bookings sheet has no rows with a Booking ID.' };

  const results = parsed.bookings.map((b: any) => {
    const ev = PF.evaluate(b);
    return {
      id: String(b.id), seller: b.seller ?? null, status: ev.status, red: ev.counts.red, amber: ev.counts.amber,
      issues: ev.issues.map((i: any) => ({ rule: i.rule, sev: i.sev, item: i.item ?? null, title: i.title })),
    };
  });
  return {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bookingCount: results.length,
    red: results.filter((r: any) => r.status === 'blocked').length,
    amber: results.filter((r: any) => r.status === 'warning').length,
    clear: results.filter((r: any) => r.status === 'clear').length,
    results,
  };
}
