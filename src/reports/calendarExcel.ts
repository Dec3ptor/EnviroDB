import type { Cell } from 'exceljs';
import { cellState, cellText, legend, monthName, STATE_INFO, type CalendarEntry, type CellState, type ProjectCalendar } from '../lib/calendar';
import { formatDate } from '../lib/dates';
import { downloadBlob } from '../db/backup';

const FILL: Partial<Record<CellState, string>> = { done: 'FFD4EFD9', doing: 'FFFFE699', cancelled: 'FFFFD9D9' };
const BAND = 'FFEEF2F6';

/** The monitoring calendar as a spreadsheet: marks and colours by month, the key, notes and reports due beside them. */
export async function exportCalendarXlsx(calendars: ProjectCalendar[], months: string[], rows: 'projects' | 'items', yearLabel: string): Promise<void> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'EnviroDB';
  const ws = wb.addWorksheet(`Monitoring ${yearLabel}`, { views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }] });
  const head = ['Project', ...months.map((m) => `${monthName(m)}${m.endsWith('-01') && !months[0].endsWith('-01') ? ` ${m.slice(0, 4)}` : ''}`), 'Key / details', 'Notes', 'Reports due', 'Consents', 'Job number', 'PO', 'Folder'];
  ws.addRow(head);
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6F2F0' } };
  ws.columns = head.map((_, i) => ({ width: i === 0 ? 34 : i <= 12 ? 7 : i === 13 ? 48 : i === 14 ? 40 : i === 15 ? 30 : 18 }));

  const paint = (cell: Cell, entries: CalendarEntry[]) => {
    cell.value = cellText(entries);
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    const state = cellState(entries);
    const band = entries.length > 0 && entries.every((e) => e.window);
    const argb = band ? BAND : state ? FILL[state] : undefined;
    if (argb) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
    if (state === 'overdue') cell.font = { color: { argb: 'FFC92A2A' }, bold: true };
    const notes = entries.filter((e) => !e.window).map((e) => `${e.item.symbol} ${e.item.label}: ${STATE_INFO[e.state].label}${e.mark?.note ? ` – ${e.mark.note}` : ''}`);
    if (notes.length) cell.note = notes.join('\n');
  };
  const byMonth = (entries: CalendarEntry[]) => {
    const m = new Map<string, CalendarEntry[]>();
    for (const e of entries) m.set(e.month, [...(m.get(e.month) ?? []), e]);
    return m;
  };

  for (const c of calendars) {
    const p = c.project;
    const tail = [c.reportsDue.map((r) => `${r.label} – ${formatDate(r.due)}`).join('\n'), p.consents ?? '', p.code ?? '', p.purchaseOrder ?? '', p.folder ?? ''];
    if (rows === 'projects') {
      const row = ws.addRow([p.name, ...months.map(() => ''), legend(c.items), p.calendarNotes ?? '', ...tail]);
      const m = byMonth(c.entries);
      months.forEach((mo, i) => paint(row.getCell(i + 2), m.get(mo) ?? []));
      row.alignment = { vertical: 'top', wrapText: true };
      continue;
    }
    const group = ws.addRow([p.name, ...months.map(() => ''), '', p.calendarNotes ?? '', ...tail]);
    group.font = { bold: true };
    group.alignment = { vertical: 'top', wrapText: true };
    for (const it of c.items) {
      const row = ws.addRow([`   ${it.symbol}  ${it.label}`, ...months.map(() => ''), it.detail ?? '']);
      const m = byMonth(c.entries.filter((e) => e.item.key === it.key));
      months.forEach((mo, i) => paint(row.getCell(i + 2), m.get(mo) ?? []));
    }
  }

  ws.addRow([]);
  for (const s of ['done', 'doing', 'cancelled', 'overdue'] as CellState[]) {
    const row = ws.addRow([`${STATE_INFO[s].label} – ${STATE_INFO[s].hint.toLowerCase()}`]);
    const c = row.getCell(1);
    if (FILL[s]) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL[s]! } };
    if (s === 'overdue') c.font = { color: { argb: 'FFC92A2A' }, bold: true };
  }
  ws.addRow(['● ▲ ■ … sampling (each project’s key beside it) · R report due · # % @ extra jobs · grey: sampling window']);

  const buf = await wb.xlsx.writeBuffer();
  downloadBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `Monitoring calendar ${yearLabel}.xlsx`);
}
