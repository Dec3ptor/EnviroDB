// Reading a team's monitoring-schedule spreadsheet into the monitoring calendar: a row per job with the months across
// the top (Jan … Dec, starting in any month), the job, job code, PO and notes columns beside them, sampling windows as
// cells merged over months ("(_____)"), and fill colours for how each month went (green done, yellow doing, pink
// cancelled or on hold). A legend under the rows ("DONE", "TO DO" …) ends them.

import type { CellObject, WorkSheet } from '@e965/xlsx';
import { db } from '../db/db';
import { addCalendarRows, newProject } from '../db/repo';
import type { CalendarRow, CalendarStatus, CalendarTextField, MonthField, Project } from '../db/types';
import { MONTH_FIELDS, statusFromFill } from '../lib/calendar';
import { nowIso } from '../lib/ids';

export interface ImportedCalendarRow {
  /** The row in the spreadsheet (1 = the first). */
  line: number;
  row: Partial<CalendarRow> & { job: string };
  /** How each month went (Jan … Dec). */
  months: Array<CalendarStatus | undefined>;
  /** Colours of the other columns. */
  columns: Partial<Record<CalendarTextField, CalendarStatus>>;
}

export interface ImportedCalendar {
  sheet: string;
  rows: ImportedCalendarRow[];
  /** The columns found, by field. */
  found: CalendarTextField[];
  /** The year the sheet says it's for (e.g. "Monitoring schedule 2026"), if it does. */
  year?: number;
}

const MONTH_RES = [/^jan(uary)?$/, /^feb(ruary)?$/, /^mar(ch)?$/, /^apr(il)?$/, /^may$/, /^june?$/, /^july?$/, /^aug(ust)?$/, /^sept?(ember)?$/, /^oct(ober)?$/, /^nov(ember)?$/, /^dec(ember)?$/];
const monthOfLabel = (s: string) => MONTH_RES.findIndex((re) => re.test(s.trim().toLowerCase().replace(/\.$/, '')));

// the legend's cells: "DONE", "TO DO", "CURRENTLY DOING", "CANCELLED / ON HOLD", "Don't mark green until …"
const LEGEND = /^(done|to ?do|currently doing|doing|cancell?ed( ?\/ ?on hold)?|on hold|key|legend)$|^do ?n[o'’]?t mark/i;

function columnField(title: string, taken: Set<CalendarTextField>, hasMonitoringNotes: boolean): CalendarTextField | null {
  const t = title.trim().toLowerCase();
  if (!t) return null;
  const pick = (f: CalendarTextField) => (taken.has(f) ? null : f);
  if (/purchase|\bp\.?o\.?\b/.test(t)) return pick('purchaseOrder');
  if (/job\s*(code|no|number|#)|project\s*(code|no|number)|^code$|^job ?#/.test(t)) return pick('jobCode');
  if (/schedule\s*details|^details|key/.test(t)) return pick('details');
  if (/monitoring\s*notes/.test(t)) return pick('notes');
  if (/management\s*plan/.test(t)) return pick('managementPlan');
  if (/report/.test(t)) return pick('reportDue');
  if (/consent|permit/.test(t)) return pick('consents');
  if (/folder|link|path/.test(t)) return pick('folder');
  if (/^(notes?|comments?|other)$/.test(t)) return hasMonitoringNotes || taken.has('notes') ? pick('other') : pick('notes');
  if (/^(job|site|project|client|name|job name)$/.test(t)) return pick('job');
  return null;
}

/** A cell's text: as shown, line breaks kept. */
function textOf(cell: CellObject | undefined): string {
  if (!cell || cell.v === undefined || cell.v === null) return '';
  const raw = typeof cell.v === 'string' ? cell.v : cell.w ?? String(cell.v);
  return raw.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
}

/** The base colours of Excel's standard theme, for fills given as a theme colour (index 4–9: accents 1–6). */
const THEME = ['FFFFFF', '000000', 'E7E6E6', '44546A', '4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47'];

function fillOf(cell: CellObject | undefined): CalendarStatus | 'highlight' | null {
  const s = (cell as { s?: { patternType?: string; fgColor?: { rgb?: string; theme?: number }; bgColor?: { rgb?: string } } } | undefined)?.s;
  if (!s || (s.patternType && s.patternType === 'none')) return null;
  const rgb = s.fgColor?.rgb ?? (s.fgColor?.theme !== undefined ? THEME[s.fgColor.theme] : undefined);
  return statusFromFill(rgb);
}

/** A month cell's text as the calendar keeps it: the window's brackets and the marks, without the underscores drawn between. */
function monthCellText(raw: string): string {
  return raw
    .replace(/_+/g, ' ')
    .replace(/[━—–-]{2,}/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .trim();
}

export async function readCalendarWorkbook(data: ArrayBuffer): Promise<ImportedCalendar> {
  const XLSX = await import('@e965/xlsx');
  const wb = XLSX.read(data, { type: 'array', cellStyles: true });
  for (const name of wb.SheetNames) {
    const found = readCalendarSheet(XLSX, wb.Sheets[name], name);
    if (found) return found;
  }
  throw new Error('No sheet has the months (Jan … Dec) along a row – is this the monitoring schedule spreadsheet?');
}

type XLSXLib = typeof import('@e965/xlsx');

export function readCalendarSheet(XLSX: XLSXLib, ws: WorkSheet, sheet: string): ImportedCalendar | null {
  const ref = ws['!ref'];
  if (!ref) return null;
  const range = XLSX.utils.decode_range(ref);
  const at = (r: number, c: number) => ws[XLSX.utils.encode_cell({ r, c })] as CellObject | undefined;

  // the row with the twelve months, in order from any month
  let monthRow = -1;
  let monthCol = -1;
  let firstMonth = 0;
  for (let r = range.s.r; r <= Math.min(range.e.r, range.s.r + 12) && monthRow < 0; r++) {
    for (let c = range.s.c; c <= range.e.c - 11; c++) {
      const m0 = monthOfLabel(textOf(at(r, c)));
      if (m0 < 0) continue;
      let ok = true;
      for (let k = 1; k < 12 && ok; k++) ok = monthOfLabel(textOf(at(r, c + k))) === (m0 + k) % 12;
      if (ok) {
        monthRow = r;
        monthCol = c;
        firstMonth = m0;
        break;
      }
    }
  }
  if (monthRow < 0) return null;
  const monthOfCol = (c: number) => (c >= monthCol && c < monthCol + 12 ? (firstMonth + c - monthCol) % 12 : -1);

  // merged cells: a value spread over the cells it covers; over months, a sampling window
  const merges = ws['!merges'] ?? [];
  const mergedInto = new Map<string, { r: number; c: number }>();
  for (const m of merges) for (let r = m.s.r; r <= m.e.r; r++) for (let c = m.s.c; c <= m.e.c; c++) if (r !== m.s.r || c !== m.s.c) mergedInto.set(`${r}:${c}`, m.s);
  const cellAt = (r: number, c: number) => {
    const top = mergedInto.get(`${r}:${c}`);
    return top ? at(top.r, top.c) : at(r, c);
  };

  // the columns' titles: the header rows above the months (a title can be on any of them, merged down)
  const titleOf = (c: number) =>
    Array.from({ length: monthRow - range.s.r + 1 }, (_, i) => textOf(cellAt(range.s.r + i, c)))
      .filter(Boolean)
      .filter((t, i, a) => a.indexOf(t) === i)
      .join(' ');
  const fields = new Map<number, CalendarTextField>();
  const taken = new Set<CalendarTextField>();
  const titles = new Map<number, string>();
  for (let c = range.s.c; c <= range.e.c; c++) if (monthOfCol(c) < 0) titles.set(c, titleOf(c));
  const hasMonitoringNotes = [...titles.values()].some((t) => /monitoring\s*notes/i.test(t));
  for (const [c, t] of titles) {
    const f = columnField(t, taken, hasMonitoringNotes);
    if (f) {
      fields.set(c, f);
      taken.add(f);
    }
  }
  // the job: the column so titled, or the first one before the months without a title of its own
  if (!taken.has('job')) {
    for (let c = range.s.c; c < monthCol; c++) {
      if (fields.has(c)) continue;
      fields.set(c, 'job');
      taken.add('job');
      break;
    }
  }
  const jobCol = [...fields].find(([, f]) => f === 'job')?.[0] ?? range.s.c;

  const rows: ImportedCalendarRow[] = [];
  for (let r = monthRow + 1; r <= range.e.r; r++) {
    // the legend under the rows ends them
    const lead = [jobCol, jobCol + 1, jobCol + 2].map((c) => textOf(at(r, c)));
    if (lead.some((t) => LEGEND.test(t))) break;
    const row: ImportedCalendarRow['row'] = { job: '' };
    const columns: ImportedCalendarRow['columns'] = {};
    let any = false;
    for (const [c, f] of fields) {
      const cell = cellAt(r, c);
      let v = textOf(cell);
      if (f === 'folder') {
        const link = (cell as { l?: { Target?: string } } | undefined)?.l?.Target;
        if (link && !/^#/.test(link)) v = link.replace(/^file:\/\/\/?/i, '');
      }
      if (v) {
        any = true;
        if (f === 'job') row.job = v.replace(/\s+/g, ' ');
        else (row as Record<string, unknown>)[f] = v;
      }
      const fill = fillOf(cell);
      if (fill === 'highlight') row.highlight = [...(row.highlight ?? []), f];
      else if (fill) columns[f] = fill;
    }
    // months: their text, and windows where cells are merged over them
    const texts: string[] = Array(12).fill('');
    const months: Array<CalendarStatus | undefined> = Array(12).fill(undefined);
    for (let c = monthCol; c < monthCol + 12; c++) {
      const m = monthOfCol(c);
      const top = mergedInto.get(`${r}:${c}`);
      const cell = cellAt(r, c);
      const own = fillOf(at(r, c));
      const fill = own ?? (top ? fillOf(cell) : null);
      if (fill && fill !== 'highlight') months[m] = fill;
      else if (fill === 'highlight') months[m] = 'doing';
      if (top) continue; // covered by a merge: its text is in the first cell
      texts[m] = monthCellText(textOf(cell));
    }
    for (const g of merges) {
      if (g.s.r > r || g.e.r < r || g.s.c < monthCol || g.e.c >= monthCol + 12 || g.e.c === g.s.c) continue;
      const a = monthOfCol(g.s.c);
      const b = monthOfCol(g.e.c);
      const body = monthCellText(textOf(at(g.s.r, g.s.c))).replace(/[()]/g, '').trim();
      texts[a] = `(${body}`;
      texts[b] = `${texts[b] && b !== a ? texts[b] : ''})`;
    }
    texts.forEach((t, i) => {
      if (!t) return;
      any = true;
      row[MONTH_FIELDS[i] as MonthField] = t;
    });
    if (!any) continue;
    // a job shaded pink is on hold – its months are, too
    if (columns.job === 'cancelled') {
      row.onHold = true;
      delete columns.job;
      for (let i = 0; i < 12; i++) if (months[i] === 'cancelled') months[i] = undefined;
    }
    rows.push({ line: r + 1, row, months, columns });
  }
  // the year, if the heading over the months or the sheet's name has one
  const heading = [sheet, ...Array.from({ length: monthRow - range.s.r }, (_, i) => Array.from({ length: 12 }, (_, k) => textOf(cellAt(range.s.r + i, monthCol + k))).join(' '))].join(' ');
  const year = Number(heading.match(/\b(20\d\d)\b/)?.[1]) || undefined;
  return { sheet, rows, found: [...taken], year };
}

/** The project a row of the spreadsheet is likely for: the same job code, else the same name. */
export function suggestProject(row: ImportedCalendarRow['row'], projects: Project[]): Project | undefined {
  const norm = (s?: string) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const code = norm(row.jobCode);
  if (code.length >= 5) {
    const exact = projects.find((p) => norm(p.code) === code);
    if (exact) return exact;
    const near = projects.find((p) => norm(p.code).length >= 5 && (code.startsWith(norm(p.code)) || norm(p.code).startsWith(code)));
    if (near) return near;
  }
  const name = norm(row.job);
  if (name.length >= 4) {
    const exact = projects.find((p) => norm(p.name) === name);
    if (exact) return exact;
    return projects.find((p) => norm(p.name).length >= 4 && (norm(p.name).startsWith(name) || name.startsWith(norm(p.name))));
  }
  return undefined;
}

// ------------------------------------------------------------ onto the calendar

/** A job's rows, for one project between them: by the job's name (its code when it has none). */
export const jobKey = (row: ImportedCalendarRow['row']) => {
  const norm = (s?: string) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return norm(row.job) || `#${norm(row.jobCode)}`;
};

export interface CalendarImportOptions {
  /** The year the spreadsheet's colours are for. */
  year: number;
  /** Take the rows on the calendar now off first. */
  replace: boolean;
  /** A new project for each job not linked to one. */
  makeProjects: boolean;
}

/**
 * Puts a spreadsheet's rows on the calendar (after the rows there, or instead of them), linked to the projects given –
 * a project gets the job code, PO, consents and folder of its first row where it has none – with the colours for the
 * year given.
 */
export async function commitCalendarImport(rows: ImportedCalendarRow[], links: Array<string | null>, opts: CalendarImportOptions): Promise<{ rows: number; projects: number }> {
  return db.transaction('rw', db.calendarRows, db.calendarMarks, db.projects, async () => {
    const projects = new Map((await db.projects.toArray()).map((p) => [p.id, p]));
    const made = new Map<string, Project>();
    const linkOf = rows.map((r, i) => {
      if (links[i]) return links[i];
      if (!opts.makeProjects || !r.row.job) return null;
      const k = jobKey(r.row);
      if (!made.has(k)) made.set(k, newProject({ name: r.row.job, code: r.row.jobCode, purchaseOrder: r.row.purchaseOrder, consents: r.row.consents, folder: r.row.folder }));
      return made.get(k)!.id;
    });
    if (made.size) await db.projects.bulkPut([...made.values()]);
    for (const p of made.values()) projects.set(p.id, p);
    if (opts.replace) {
      const ids = (await db.calendarRows.toArray()).map((r) => r.id);
      await db.calendarMarks.where('item').anyOf(ids).delete();
      await db.calendarRows.bulkDelete(ids);
    }
    // what the projects are missing, from their first rows
    const filled = new Set<string>();
    for (let i = 0; i < rows.length; i++) {
      const id = linkOf[i];
      const p = id ? projects.get(id) : undefined;
      if (!p || filled.has(p.id) || made.has(jobKey(rows[i].row))) continue;
      filled.add(p.id);
      const r = rows[i].row;
      const set: Partial<Project> = {};
      if (r.jobCode && !p.code) set.code = r.jobCode;
      if (r.purchaseOrder && !p.purchaseOrder) set.purchaseOrder = r.purchaseOrder;
      if (r.consents && !p.consents) set.consents = r.consents;
      if (r.folder && !p.folder) set.folder = r.folder;
      if (Object.keys(set).length) await db.projects.update(p.id, { ...set, updatedAt: nowIso() });
    }
    const put = await addCalendarRows(
      rows.map((r, i) => {
        const id = linkOf[i];
        const p = id ? projects.get(id) : undefined;
        const same = p && p.name.trim().toLowerCase() === r.row.job.trim().toLowerCase();
        return { ...r.row, projectId: id ?? undefined, job: same ? '' : r.row.job };
      }),
    );
    const marks = put.flatMap((row, i) => {
      const src = rows[i];
      const out: Array<{ id: string; item: string; month: string; field?: CalendarTextField; status: CalendarStatus; updatedAt: string }> = [];
      src.months.forEach((st, m) => {
        if (!st) return;
        const month = `${opts.year}-${String(m + 1).padStart(2, '0')}`;
        out.push({ id: `${row.id}|${month}`, item: row.id, month, status: st, updatedAt: nowIso() });
      });
      for (const [field, st] of Object.entries(src.columns) as Array<[CalendarTextField, CalendarStatus]>) {
        out.push({ id: `${row.id}|${opts.year}|${field}`, item: row.id, month: String(opts.year), field, status: st, updatedAt: nowIso() });
      }
      return out;
    });
    if (marks.length) await db.calendarMarks.bulkPut(marks);
    return { rows: put.length, projects: made.size };
  });
}
