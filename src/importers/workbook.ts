import type * as XLSXTypes from '@e965/xlsx';
import { formatDate, fromExcelSerial } from '../lib/dates';

export interface Cell {
  v: string | number | boolean | null;
  /** True when Excel stores the number as a date/time. */
  date?: boolean;
  /** Formatted text as shown in Excel. */
  w?: string;
}

export interface SheetGrid {
  name: string;
  rows: Cell[][];
  nRows: number;
  nCols: number;
  /** Read from a PDF report (rows made from its results tables). */
  pdf?: boolean;
  /** The file it came from, when several are imported at once. */
  file?: string;
}

const EMPTY: Cell = { v: null };

export function cellAt(g: SheetGrid, r: number, c: number): Cell {
  return g.rows[r]?.[c] ?? EMPTY;
}

export function cellText(cell: Cell | undefined): string {
  if (!cell || cell.v === null || cell.v === undefined) return '';
  if (cell.date && typeof cell.v === 'number') {
    if (cell.v >= 0 && cell.v < 1) {
      const mins = Math.round(cell.v * 1440);
      return `${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
    }
    const d = fromExcelSerial(cell.v);
    return d ? formatDate(d, { time: true }) : String(cell.v);
  }
  if (cell.w !== undefined && typeof cell.v === 'number') return cell.w.trim();
  return String(cell.v).trim();
}

export function isEmpty(cell: Cell | undefined): boolean {
  return !cell || cell.v === null || cell.v === undefined || (typeof cell.v === 'string' && cell.v.trim() === '');
}

/** Value for result parsing: numbers stay numbers, text stays text. */
export function cellValue(cell: Cell | undefined): unknown {
  if (!cell) return null;
  return cell.v;
}

/** Text of a CSV file: UTF-8 when it is valid UTF-8, otherwise Windows-1252 (Hill's CSVs write "°" as one byte). */
export function decodeText(data: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data).replace(/^\uFEFF/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(data);
  }
}

/** Read an Excel (.xlsx/.xlsm/.xls/.xlsb/.ods) or CSV file into simple grids. SheetJS is loaded on demand. */
export async function readWorkbook(data: ArrayBuffer, fileName: string): Promise<SheetGrid[]> {
  const XLSX: typeof XLSXTypes = await import('@e965/xlsx');
  const isText = /\.(csv|txt|tsv)$/i.test(fileName);
  const wb = isText
    ? XLSX.read(decodeText(data), { type: 'string', raw: true, dense: true })
    : XLSX.read(data, { type: 'array', cellDates: false, cellNF: true, cellText: true, dense: true });
  const out: SheetGrid[] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const dense = (ws as unknown as { '!data'?: Array<Array<XLSXTypes.CellObject | undefined> | undefined> })['!data'] ?? [];
    const rows: Cell[][] = [];
    let nCols = 0;
    for (let r = 0; r < dense.length; r++) {
      const src = dense[r];
      const row: Cell[] = [];
      if (src) {
        for (let c = 0; c < src.length; c++) {
          const cell = src[c];
          if (!cell || cell.v === undefined || cell.t === 'z') {
            row[c] = EMPTY;
            continue;
          }
          if (cell.t === 'e') {
            row[c] = { v: null, w: cell.w };
            continue;
          }
          const isDate = cell.t === 'n' && !!cell.z && XLSX.SSF.is_date(cell.z as string);
          row[c] = { v: cell.v as Cell['v'], date: isDate || undefined, w: cell.w };
        }
        // trim trailing empties
        let last = row.length - 1;
        while (last >= 0 && isEmpty(row[last])) last--;
        row.length = last + 1;
        nCols = Math.max(nCols, row.length);
      }
      rows[r] = row;
    }
    // merged cells: every cell of the merge reads as its first – a heading over several columns, a site or date
    // over several rows. Across a row only in rows without numbers or dates (headings), so a note merged across a
    // row of results isn't copied into every column.
    const headingRow = (r: number) => (rows[r] ?? []).every((x) => isEmpty(x) || (typeof x.v === 'string' && !x.date));
    for (const m of (ws['!merges'] ?? []) as XLSXTypes.Range[]) {
      const top = rows[m.s.r]?.[m.s.c];
      if (!top || isEmpty(top)) continue;
      if (m.e.c > m.s.c && !headingRow(m.s.r)) continue;
      // a merge reaching to Excel's last row or column (a whole-column merge) only as far as the sheet's data
      const lastR = Math.min(m.e.r, rows.length - 1, m.s.r + 5000);
      const lastC = Math.min(m.e.c, m.s.c + 1000);
      for (let r = m.s.r; r <= lastR; r++) {
        if (!rows[r]) rows[r] = [];
        for (let c = m.s.c; c <= lastC; c++) if ((r !== m.s.r || c !== m.s.c) && isEmpty(rows[r][c])) rows[r][c] = top;
        nCols = Math.max(nCols, rows[r].length);
      }
    }
    // fill holes
    for (let r = 0; r < rows.length; r++) {
      if (!rows[r]) rows[r] = [];
      for (let c = 0; c < rows[r].length; c++) if (!rows[r][c]) rows[r][c] = EMPTY;
    }
    // drop trailing empty rows
    let lastRow = rows.length - 1;
    while (lastRow >= 0 && rows[lastRow].every(isEmpty)) lastRow--;
    rows.length = lastRow + 1;
    if (rows.length) out.push({ name, rows, nRows: rows.length, nCols });
  }
  return out;
}

export function transpose(g: SheetGrid): SheetGrid {
  const rows: Cell[][] = [];
  for (let c = 0; c < g.nCols; c++) {
    const row: Cell[] = [];
    for (let r = 0; r < g.nRows; r++) row.push(cellAt(g, r, c));
    rows.push(row);
  }
  return { name: g.name, rows, nRows: g.nCols, nCols: g.nRows };
}

export function columnLetter(c: number): string {
  let s = '';
  let n = c + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
