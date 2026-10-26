// A small page-layout helper on top of jsPDF, shared by the check report and the booking confirmation.
// Only the standard PDF fonts are used, so text is first reduced to characters those fonts can show.
import type { jsPDF } from 'jspdf';

/** Standard PDF fonts show Western European characters only: swap the few typographic ones we use for plain equivalents. */
export function pdfSafe(s: unknown): string {
  return String(s ?? '')
    .replace(/[‘’‛]/g, "'").replace(/[“”]/g, '"').replace(/[–—−]/g, '-')
    .replace(/→/g, '->').replace(/←/g, '<-').replace(/×/g, 'x').replace(/÷/g, '/').replace(/…/g, '...')
    .replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/[  ]/g, ' ').replace(/[✓✔]/g, 'OK').replace(/[✗✘]/g, 'X')
    .replace(/[^\x09\x0A\x20-\x7E¡-ÿ]/g, '');
}

export const COLORS = { ink: [17, 24, 39], grey: [90, 100, 115], line: [210, 215, 224], brand: [246, 199, 68], navy: [15, 25, 41], red: [190, 40, 40], amber: [166, 105, 0], green: [20, 120, 70] } as const;
type RGB = readonly [number, number, number];
export type Col = { header: string; width: number; align?: 'left' | 'right' };

export class Page {
  doc: jsPDF; y = 0; readonly m = 40; readonly w: number; readonly h: number; private footer: string;
  constructor(doc: jsPDF, footer: string) { this.doc = doc; this.footer = footer; this.w = doc.internal.pageSize.getWidth(); this.h = doc.internal.pageSize.getHeight(); this.y = this.m; }
  get inner() { return this.w - this.m * 2; }
  private set(color: RGB) { this.doc.setTextColor(color[0], color[1], color[2]); }

  /** Header band with the GYST name, then the document title. */
  masthead(title: string, sub?: string) {
    const d = this.doc;
    d.setFillColor(...COLORS.navy); d.rect(0, 0, this.w, 64, 'F');
    d.setFillColor(...COLORS.brand); d.roundedRect(this.m, 18, 28, 28, 6, 6, 'F');
    d.setFont('helvetica', 'bold'); d.setFontSize(15); d.setTextColor(COLORS.navy[0], COLORS.navy[1], COLORS.navy[2]); d.text('G', this.m + 14, 38, { align: 'center' });
    d.setFont('helvetica', 'bold'); d.setFontSize(15); d.setTextColor(255, 255, 255); d.text('GYST SHIPMENTS', this.m + 40, 36);
    d.setFont('helvetica', 'normal'); d.setFontSize(9); d.setTextColor(180, 195, 215); d.text('Get Your Ship Together', this.w - this.m, 36, { align: 'right' });
    this.y = 96;
    d.setFont('helvetica', 'bold'); d.setFontSize(20); this.set(COLORS.ink); d.text(pdfSafe(title), this.m, this.y); this.y += 20;
    if (sub) { d.setFont('helvetica', 'normal'); d.setFontSize(10); this.set(COLORS.grey); d.text(pdfSafe(sub), this.m, this.y); this.y += 16; }
    this.y += 6;
  }
  ensure(h: number) { if (this.y + h > this.h - 60) this.newPage(); }
  newPage() { this.doc.addPage(); this.y = this.m; }
  heading(t: string) {
    this.ensure(40); this.y += 8;
    this.doc.setFont('helvetica', 'bold'); this.doc.setFontSize(12.5); this.set(COLORS.ink); this.doc.text(pdfSafe(t), this.m, this.y);
    this.doc.setDrawColor(...COLORS.brand); this.doc.setLineWidth(2); this.doc.line(this.m, this.y + 5, this.m + 34, this.y + 5);
    this.y += 20;
  }
  paragraph(t: string, opts: { size?: number; color?: RGB; bold?: boolean } = {}) {
    const d = this.doc; d.setFont('helvetica', opts.bold ? 'bold' : 'normal'); d.setFontSize(opts.size ?? 10); this.set(opts.color ?? COLORS.ink);
    const lines = d.splitTextToSize(pdfSafe(t), this.inner) as string[];
    lines.forEach(l => { this.ensure(14); d.text(l, this.m, this.y); this.y += (opts.size ?? 10) * 1.4; });
    this.y += 3;
  }
  /** Label and value pairs in two columns. */
  facts(pairs: [string, string][]) {
    const d = this.doc, colW = this.inner / 2;
    for (let i = 0; i < pairs.length; i += 2) {
      const row = pairs.slice(i, i + 2);
      const heights = row.map(([, v]) => (d.splitTextToSize(pdfSafe(v), colW - 96) as string[]).length);
      this.ensure(Math.max(...heights) * 13 + 6);
      row.forEach(([k, v], c) => {
        const x = this.m + c * colW;
        d.setFont('helvetica', 'normal'); d.setFontSize(9); this.set(COLORS.grey); d.text(pdfSafe(k), x, this.y);
        d.setFont('helvetica', 'bold'); d.setFontSize(10); this.set(COLORS.ink);
        (d.splitTextToSize(pdfSafe(v), colW - 96) as string[]).forEach((l, n) => d.text(l, x + 96, this.y + n * 13));
      });
      this.y += Math.max(...heights) * 13 + 6;
    }
  }
  table(cols: Col[], rows: string[][], opts: { colorCol?: number } = {}) {
    const d = this.doc, pad = 4;
    const total = cols.reduce((s, c) => s + c.width, 0), k = this.inner / total;
    const widths = cols.map(c => c.width * k);
    const head = () => {
      this.ensure(22); d.setFillColor(238, 241, 247); d.rect(this.m, this.y - 11, this.inner, 18, 'F');
      d.setFont('helvetica', 'bold'); d.setFontSize(8.5); this.set(COLORS.ink);
      let x = this.m; cols.forEach((c, i) => { d.text(pdfSafe(c.header), c.align === 'right' ? x + widths[i] - pad : x + pad, this.y, { align: c.align === 'right' ? 'right' : 'left' }); x += widths[i]; });
      this.y += 14;
    };
    head();
    rows.forEach(r => {
      d.setFont('helvetica', 'normal'); d.setFontSize(8.5);
      const cells = r.map((t, i) => d.splitTextToSize(pdfSafe(t), widths[i] - pad * 2) as string[]);
      const h = Math.max(...cells.map(c => c.length)) * 11 + 6;
      if (this.y + h > this.h - 60) { this.newPage(); head(); }
      let x = this.m;
      cells.forEach((lines, i) => {
        let color: RGB = COLORS.ink;
        if (opts.colorCol === i) color = /^red/i.test(r[i]) ? COLORS.red : /^amber/i.test(r[i]) ? COLORS.amber : /^pass/i.test(r[i]) ? COLORS.green : COLORS.grey;
        d.setFont('helvetica', opts.colorCol === i ? 'bold' : 'normal'); this.set(color);
        lines.forEach((l, n) => d.text(l, cols[i].align === 'right' ? x + widths[i] - pad : x + pad, this.y + n * 11, { align: cols[i].align === 'right' ? 'right' : 'left' }));
        x += widths[i];
      });
      this.y += h; d.setDrawColor(...COLORS.line); d.setLineWidth(0.5); d.line(this.m, this.y - 8, this.m + this.inner, this.y - 8);
    });
    this.y += 4;
  }
  /** Page numbers and the footer line on every page. Call once, last. */
  finish() {
    const n = this.doc.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      this.doc.setPage(i); this.doc.setDrawColor(...COLORS.line); this.doc.setLineWidth(0.5); this.doc.line(this.m, this.h - 44, this.w - this.m, this.h - 44);
      this.doc.setFont('helvetica', 'normal'); this.doc.setFontSize(8); this.set(COLORS.grey);
      const lines = this.doc.splitTextToSize(pdfSafe(this.footer), this.inner - 60) as string[];
      lines.forEach((l, k) => this.doc.text(l, this.m, this.h - 30 + k * 10));
      this.doc.text('Page ' + i + ' of ' + n, this.w - this.m, this.h - 30, { align: 'right' });
    }
  }
}
