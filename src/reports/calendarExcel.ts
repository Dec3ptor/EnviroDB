import type { Cell, Worksheet } from 'exceljs';
import type { CalendarRow, CalendarStatus } from '../db/types';
import type { CalendarSheet } from '../hooks/useCalendarSheet';
import { CALENDAR_COLUMNS, cellValue, HIGHLIGHT_FILL, markId, monthKey, monthText, MONTH_FIELDS, reportsToShow, rowMonths, STATUS_INFO, windowsOf } from '../lib/calendar';
import { formatDate, MONTH_SHORT } from '../lib/dates';
import { downloadBlob } from '../db/backup';

// The monitoring calendar as a spreadsheet laid out like a team's "Schedule All Monitoring" sheet: the job, job code
// and PO, the months (sampling windows as merged cells, "(_____)"), then the details and notes; months coloured
// for the year, and the legend underneath. It reads back in through the calendar's import.

const HEAD_FILL = 'FFF2F2F2';
const THIN = { style: 'thin' as const, color: { argb: 'FFBFBFBF' } };
const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };
const argb = (hex: string) => `FF${hex}`;
const solid = (hex: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: argb(hex) } });

const LEAD = CALENDAR_COLUMNS.filter((c) => c.lead);
const TAIL = CALENDAR_COLUMNS.filter((c) => !c.lead);
const WIDTHS: Record<string, number> = { job: 30, jobCode: 20, purchaseOrder: 18, details: 48, notes: 44, reportDue: 30, managementPlan: 22, other: 40, consents: 24, folder: 40 };
const TITLES: Record<string, string> = { purchaseOrder: 'Purchase Order No', details: 'Monitoring Schedule Details', reportDue: 'Annual Report Due', other: 'Notes' };

/** A window's cells as text: "(" and ")" at its ends with underscores between, as the spreadsheet draws them. */
function windowText(label: string, part: 'start' | 'mid' | 'end' | 'whole', span = 1): string {
  if (part === 'whole') {
    const n = Math.max(2, span * 5 - label.length);
    return `(${'_'.repeat(Math.floor(n / 2))}${label}${'_'.repeat(Math.ceil(n / 2))})`;
  }
  if (part === 'start') return `(__${label}${label ? '__' : '___'}`;
  if (part === 'end') return `${label ? `${label}__` : '____'})`;
  return label || '_____';
}

export async function buildCalendarWorkbook(sheet: CalendarSheet, rows: CalendarRow[], year: number): Promise<ArrayBuffer> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'EnviroDB';
  const ws = wb.addWorksheet('Schedule All Monitoring', {
    views: [{ state: 'frozen', xSplit: 1, ySplit: 3 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  const nLead = LEAD.length;
  const col = (i: number) => i + 1; // 1-based
  const monthCol = (m: number) => col(nLead + m);
  const tailCol = (i: number) => col(nLead + 12 + i);
  ws.columns = [...LEAD.map((c) => ({ width: WIDTHS[c.field] })), ...MONTH_FIELDS.map(() => ({ width: 8 })), ...TAIL.map((c) => ({ width: WIDTHS[c.field] }))];

  // the three header rows: titles merged down, the months numbered and named
  const head = (r: number, c: number, v: string | number) => {
    const cell = ws.getCell(r, c);
    cell.value = v;
    cell.font = { bold: true };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.fill = solid(HEAD_FILL.slice(2));
    cell.border = BORDER;
    return cell;
  };
  LEAD.forEach((c, i) => {
    head(1, col(i), TITLES[c.field] ?? c.label);
    head(2, col(i), '');
    head(3, col(i), '');
    ws.mergeCells(1, col(i), 3, col(i));
  });
  head(1, monthCol(0), `Monitoring Schedule ${year}`);
  for (let m = 1; m < 12; m++) head(1, monthCol(m), '');
  ws.mergeCells(1, monthCol(0), 1, monthCol(11));
  MONTH_FIELDS.forEach((_, m) => {
    head(2, monthCol(m), m + 1);
    head(3, monthCol(m), MONTH_SHORT[m]);
  });
  TAIL.forEach((c, i) => {
    head(1, tailCol(i), TITLES[c.field] ?? c.label);
    head(2, tailCol(i), '');
    head(3, tailCol(i), '');
    ws.mergeCells(1, tailCol(i), 3, tailCol(i));
  });

  let r = 4;
  for (const row of rows) {
    const project = row.projectId ? sheet.projects.get(row.projectId) : undefined;
    const statusAt = (m: number): CalendarStatus | undefined => sheet.marks.get(markId(row.id, monthKey(year, MONTH_FIELDS[m])))?.status;
    const paint = (cell: Cell, status?: CalendarStatus, highlight = false) => {
      const hex = row.onHold ? STATUS_INFO.cancelled.fill : status ? STATUS_INFO[status].fill : highlight ? HIGHLIGHT_FILL : null;
      if (hex) cell.fill = solid(hex);
      cell.border = BORDER;
    };
    const text = (c: number, field: (typeof CALENDAR_COLUMNS)[number]['field']) => {
      const cell = ws.getCell(r, c);
      let v = cellValue(row, field, project);
      // a project's reports due, when the row doesn't say
      if (field === 'reportDue' && !v) v = reportsToShow(sheet.facts.get(row.id)?.reports ?? []).map((x) => `${x.name} – ${formatDate(x.due)}${x.submitted ? ` (sent ${formatDate(x.submitted)})` : ''}`).join('\n');
      cell.value = field === 'folder' && /^https?:\/\//i.test(v) ? { text: v, hyperlink: v } : v || null;
      cell.alignment = { vertical: 'top', wrapText: true };
      paint(cell, sheet.marks.get(markId(row.id, String(year), field))?.status, row.highlight?.includes(field));
    };
    LEAD.forEach((c, i) => text(col(i), c.field));
    TAIL.forEach((c, i) => text(tailCol(i), c.field));

    const texts = rowMonths(row);
    const windows = windowsOf(texts);
    for (let m = 0; m < 12; m++) {
      const cell = ws.getCell(r, monthCol(m));
      const w = windows[m];
      const label = monthText(texts[m]);
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      paint(cell, statusAt(m));
      const note = sheet.marks.get(markId(row.id, monthKey(year, MONTH_FIELDS[m])))?.note;
      if (note) cell.note = note;
      if (!w.inWindow) {
        cell.value = label || null;
        continue;
      }
      // a window inside the year, coloured alike and marked only in its first month: merged, as the spreadsheet has it
      if (w.start && w.span > 1) {
        const months = Array.from({ length: w.span }, (_, k) => m + k);
        const alike = months.every((k) => statusAt(k) === statusAt(m)) && months.slice(1).every((k) => !monthText(texts[k])) && windows[m + w.span - 1].end;
        if (alike) {
          cell.value = windowText(label, 'whole', w.span);
          for (const k of months.slice(1)) paint(ws.getCell(r, monthCol(k)), statusAt(k));
          ws.mergeCells(r, monthCol(m), r, monthCol(m + w.span - 1));
          m += w.span - 1;
          continue;
        }
      }
      cell.value = windowText(label, w.start && w.end ? 'whole' : w.start ? 'start' : w.end ? 'end' : 'mid');
    }
    r++;
  }

  // the legend, as in the spreadsheet
  r++;
  const legend: Array<[string, string, string | null]> = [
    ['Don’t mark green until results sent or reported', 'DONE', STATUS_INFO.done.fill],
    ['●', 'TO DO', null],
    ['If still to analyse lab results', 'CURRENTLY DOING', STATUS_INFO.doing.fill],
    ['', 'CANCELLED / ON HOLD', STATUS_INFO.cancelled.fill],
  ];
  for (const [a, b, fill] of legend) {
    const ca = ws.getCell(r, 1);
    ca.value = a || null;
    if (fill) ca.fill = solid(fill);
    ca.border = BORDER;
    ws.getCell(r, 2).value = b;
    ws.getCell(r, 2).font = { bold: true };
    r++;
  }
  ws.getCell(r + 1, 1).value = 'Exported from EnviroDB’s monitoring calendar';
  ws.getCell(r + 1, 1).font = { italic: true, color: { argb: 'FF808080' } };
  setPrintArea(ws, r);
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

function setPrintArea(ws: Worksheet, lastRow: number) {
  ws.pageSetup.printTitlesRow = '1:3';
  ws.pageSetup.printArea = `A1:${ws.getColumn(LEAD.length + 12 + TAIL.length).letter}${lastRow}`;
}

export async function downloadCalendarXlsx(sheet: CalendarSheet, rows: CalendarRow[], year: number): Promise<void> {
  const buf = await buildCalendarWorkbook(sheet, rows, year);
  downloadBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `Monitoring schedule ${year}.xlsx`);
}
