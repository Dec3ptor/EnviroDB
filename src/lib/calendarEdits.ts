// What the monitoring calendar's cells change: typing in a cell, clearing or pasting, colouring months, adding marks
// and windows – as edits to rows, colours (marks) and the projects whose details the rows show.

import type { CalendarMark, CalendarRow, CalendarStatus, CalendarTextField, MonthField, Project } from '../db/types';
import type { CalendarEdit } from '../db/repo';
import { CALENDAR_COLUMNS, COLUMN_MAP, isMonthField, MONTH_FIELDS, markId, monthKey, rowMonths, setWindow, toggleSymbol, windowRange, windowsOf, type CalendarColumn } from './calendar';

export type SheetColumn =
  | { kind: 'text'; key: CalendarTextField; width: number; label: string; col: CalendarColumn }
  | { kind: 'month'; key: MonthField; width: number; label: string; month: number };

export const MONTH_WIDTH = 52;

/** The calendar's columns, as in the spreadsheet: job, job code and PO, the months, then the rest (the job always). */
export function sheetColumns(hidden: Set<string> = new Set()): SheetColumn[] {
  const text = (c: CalendarColumn): SheetColumn => ({ kind: 'text', key: c.field, width: c.width, label: c.label, col: c });
  const shown = CALENDAR_COLUMNS.filter((c) => c.field === 'job' || !hidden.has(c.field));
  const months: SheetColumn[] = MONTH_FIELDS.map((f, i) => ({ kind: 'month', key: f, width: MONTH_WIDTH, label: '', month: i }));
  return [...shown.filter((c) => c.lead).map(text), ...months, ...shown.filter((c) => !c.lead).map(text)];
}

/** The edit that puts a value in a cell: the row's field, or the project's for the details a row shows from it. */
export function cellEdit(row: CalendarRow, key: CalendarTextField | MonthField, value: string, project?: Project): CalendarEdit {
  const v = value.replace(/\r\n?/g, '\n');
  const blank = v.trim() === '';
  const col = COLUMN_MAP.get(key as CalendarTextField);
  if (project && col?.project) return { t: 'project', id: project.id, set: { [col.project]: blank ? undefined : v.trim() } };
  if (key === 'job') return { t: 'row', id: row.id, set: { job: project && v.trim() === project.name ? '' : v.trim() } };
  return { t: 'row', id: row.id, set: { [key]: blank ? undefined : isMonthField(key) ? v.trim() : v } };
}

/** The colours of cells, toggled: set unless every one of them has it already (then cleared). Months take in their whole window. */
export function statusEdits(
  targets: Array<{ row: CalendarRow; key: CalendarTextField | MonthField }>,
  status: CalendarStatus | undefined,
  year: number,
  marks: Map<string, CalendarMark>,
): CalendarEdit[] {
  const ids = new Map<string, { row: CalendarRow; month: string; field?: CalendarTextField }>();
  for (const { row, key } of targets) {
    if (isMonthField(key)) {
      const i = MONTH_FIELDS.indexOf(key);
      const [a, b] = windowRange(windowsOf(rowMonths(row)), i);
      for (let m = a; m <= b; m++) ids.set(markId(row.id, monthKey(year, MONTH_FIELDS[m])), { row, month: monthKey(year, MONTH_FIELDS[m]) });
    } else ids.set(markId(row.id, String(year), key as CalendarTextField), { row, month: String(year), field: key as CalendarTextField });
  }
  const all = [...ids.keys()];
  const clear = !status || all.every((id) => marks.get(id)?.status === status);
  return all.map((id) => {
    const { row, month, field } = ids.get(id)!;
    const cur = marks.get(id);
    const next = clear ? undefined : status;
    const mark: CalendarMark | null = next || cur?.note ? { ...(cur ?? { id, item: row.id, month, ...(field ? { field } : {}) }), status: next, updatedAt: '' } : null;
    return { t: 'mark', id, mark };
  });
}

/** A month's note for a year (none: taken off). */
export function noteEdit(row: CalendarRow, month: string, note: string, marks: Map<string, CalendarMark>): CalendarEdit {
  const id = markId(row.id, month);
  const cur = marks.get(id);
  const text = note.trim() || undefined;
  return { t: 'mark', id, mark: text || cur?.status ? { ...(cur ?? { id, item: row.id, month }), note: text, updatedAt: '' } : null };
}

/** Puts a mark in the months given, or – when every one has it – takes it out. */
export function symbolEdits(targets: Array<{ row: CalendarRow; key: MonthField }>, symbol: string): CalendarEdit[] {
  const on = !targets.every(({ row, key }) => (row[key] ?? '').includes(symbol));
  return targets.map(({ row, key }) => cellEdit(row, key, toggleSymbol(row[key] ?? '', symbol, on)));
}

/** Months a..b of each row as a sampling window – or, when they all are one already, not. */
export function windowEdits(rows: CalendarRow[], a: number, b: number): CalendarEdit[] {
  const isWindow = (row: CalendarRow) => {
    const w = windowsOf(rowMonths(row));
    const [wa, wb] = windowRange(w, a);
    return w[a].inWindow && wa === a && wb === b;
  };
  const on = !rows.every(isWindow);
  return rows.map((row) => {
    const texts = setWindow(rowMonths(row), a, b, on);
    const set: Partial<CalendarRow> = {};
    MONTH_FIELDS.forEach((f, i) => {
      if ((row[f] ?? '') !== texts[i]) set[f] = texts[i] || undefined;
    });
    return { t: 'row', id: row.id, set };
  });
}

/** Text copied from cells, tab-separated (cells with tabs, line breaks or quotes quoted, as Excel does). */
export function toTsv(grid: string[][]): string {
  const q = (s: string) => (/[\t\n"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return grid.map((r) => r.map(q).join('\t')).join('\n');
}

/** Cells pasted: Excel's tab-separated text, quoted cells with line breaks included. */
export function fromTsv(text: string): string[][] {
  const rows: string[][] = [[]];
  let cell = '';
  let quoted = false;
  const s = text.replace(/\r\n?/g, '\n').replace(/\n$/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === '\t') {
      rows[rows.length - 1].push(cell);
      cell = '';
    } else if (ch === '\n') {
      rows[rows.length - 1].push(cell);
      rows.push([]);
      cell = '';
    } else cell += ch;
  }
  rows[rows.length - 1].push(cell);
  return rows;
}
