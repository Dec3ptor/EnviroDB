import type { Parameter, Result } from '../db/types';
import type { CellFlag, PivotRow } from '../lib/analysis';
import { flagFillColour, SET_COLOURS, setColourIndex } from '../lib/highlight';
import { displayValue } from '../lib/analysis';
import { formatDate } from '../lib/dates';
import { unitLabel } from '../lib/units';
import { downloadBlob, safeFileName } from '../db/backup';

const FILL = { limit: 'FFF9D0D0', guideline: 'FFFDE7C2', check: 'FFE9E6F7' } as const;

export interface PivotExport {
  title: string;
  columns: Parameter[];
  rows: PivotRow[];
  flags: Map<string, CellFlag>;
  guidelineNames: string[];
  layout: 'samplesAsRows' | 'parametersAsRows';
  fileName: string;
}

/** Styled Excel export of the results table, with exceedances shaded. */
export async function exportPivotXlsx(x: PivotExport): Promise<void> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'EnviroDB';
  const ws = wb.addWorksheet('Results');
  const head = { font: { bold: true }, fill: { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFE6F2F0' } } };
  const writeCell = (cell: import('exceljs').Cell, r: Result | undefined, p: Parameter) => {
    if (!r) return;
    const dv = displayValue(r, p);
    cell.value = r.qualifier || dv.value === null ? dv.text : dv.value;
    cell.alignment = { horizontal: 'right' };
    const f = x.flags.get(r.id);
    if (f) {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${flagFillColour(f)!.slice(1)}` } };
      cell.font = { bold: f.kind !== 'check' };
      cell.note = f.messages.join('\n');
    }
  };

  if (x.layout === 'samplesAsRows') {
    ws.addRow(['Date', 'Site', 'Lab number', ...x.columns.map((p) => p.name)]);
    ws.addRow(['', '', '', ...x.columns.map((p) => unitLabel(p.unit))]);
    for (const row of x.rows) {
      const xr = ws.addRow([formatDate(row.sample.date, { time: true }), row.site.code, row.sample.labNumber ?? '']);
      x.columns.forEach((p, i) => writeCell(xr.getCell(4 + i), row.cells.get(p.id), p));
    }
    ws.views = [{ state: 'frozen', xSplit: 2, ySplit: 2 }];
    ws.getColumn(1).width = 16;
    ws.getColumn(2).width = 10;
    ws.getColumn(3).width = 13;
    x.columns.forEach((_, i) => (ws.getColumn(4 + i).width = 12));
  } else {
    ws.addRow(['Parameter', 'Unit', ...x.rows.map((r) => r.site.code)]);
    ws.addRow(['', '', ...x.rows.map((r) => formatDate(r.sample.date))]);
    for (const p of x.columns) {
      const xr = ws.addRow([p.name, unitLabel(p.unit)]);
      x.rows.forEach((row, i) => writeCell(xr.getCell(3 + i), row.cells.get(p.id), p));
    }
    ws.views = [{ state: 'frozen', xSplit: 2, ySplit: 2 }];
    ws.getColumn(1).width = 34;
    ws.getColumn(2).width = 10;
    x.rows.forEach((_, i) => (ws.getColumn(3 + i).width = 12));
  }
  [1, 2].forEach((n) => ws.getRow(n).eachCell((c) => Object.assign(c, head)));

  const legend = wb.addWorksheet('Key');
  legend.addRow([x.title]).font = { bold: true, size: 13 };
  legend.addRow([]);
  const l1 = legend.addRow(['', 'Consent limit exceeded']);
  l1.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL.limit } };
  const l2 = legend.addRow(['', `Trigger level${x.guidelineNames.length ? ` or ${x.guidelineNames[0]}` : ''} exceeded`]);
  l2.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL.guideline } };
  // each further guideline set has its own colour
  x.guidelineNames.slice(1).forEach((name, i) => {
    const row = legend.addRow(['', `${name} exceeded`]);
    row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${SET_COLOURS[setColourIndex(i + 1)].fill.slice(1)}` } };
  });
  const l3 = legend.addRow(['', 'Detection limit above the limit / guideline – cannot assess']);
  l3.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL.check } };
  legend.addRow(['', '"<" = below the laboratory detection limit. Hover over shaded cells for details.']);
  legend.addRow(['', `Exported from EnviroDB on ${formatDate(new Date().toISOString().slice(0, 10))}`]);
  legend.getColumn(1).width = 6;
  legend.getColumn(2).width = 90;

  const buf = await wb.xlsx.writeBuffer();
  downloadBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${safeFileName(x.fileName)}.xlsx`);
}

export function exportPivotCsv(x: PivotExport): void {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines: string[] = [];
  lines.push(['Date', 'Site', 'Lab number', ...x.columns.map((p) => `${p.name} (${unitLabel(p.unit)})`)].map(esc).join(','));
  for (const row of x.rows) {
    lines.push(
      [row.sample.date.replace('T', ' '), row.site.code, row.sample.labNumber ?? '', ...x.columns.map((p) => {
        const r = row.cells.get(p.id);
        return r ? displayValue(r, p).text : '';
      })].map(esc).join(','),
    );
  }
  downloadBlob(new Blob([lines.join('\r\n')], { type: 'text/csv' }), `${safeFileName(x.fileName)}.csv`);
}
