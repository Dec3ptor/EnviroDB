// The monitoring calendar: the team's "monitoring schedule" spreadsheet kept in EnviroDB – a row per job, a column per
// month with what's planned (● ▲ R # …, or a sampling window "(" … ")"), the key and notes beside it – and linked to
// the projects: a row for a project shares its job number, PO, consents and folder, shows the months results came in,
// and can be filled in from the project's sampling schedules and reports. The plan is the same every year; the
// colours (done, doing, cancelled) are kept for each year.

import type { CalendarMark, CalendarRow, CalendarStatus, CalendarTextField, MonitoringSchedule, MonthField, Project, ReportObligation, Sample, Site } from '../db/types';
import { daysBetween, MONTH_LONG, MONTH_SHORT } from './dates';
import { frequencyLabel, obligationPeriod, scheduleStep } from './schedule';

export const MONTH_FIELDS: MonthField[] = ['m01', 'm02', 'm03', 'm04', 'm05', 'm06', 'm07', 'm08', 'm09', 'm10', 'm11', 'm12'];
export const isMonthField = (f: string): f is MonthField => /^m(0[1-9]|1[0-2])$/.test(f);
/** The month (YYYY-MM) of a month field in a year. */
export const monthKey = (year: number, f: MonthField) => `${year}-${f.slice(1)}`;
export const fieldOfMonth = (month: string) => `m${month.slice(5, 7)}` as MonthField;

export function monthName(month: string, long = false): string {
  const m = Number(month.slice(5, 7)) - 1;
  return (long ? MONTH_LONG : MONTH_SHORT)[m] ?? month;
}

/** Marks for sampling (a project's schedules have one each, in turn), then for reports and other jobs. */
export const CALENDAR_SYMBOLS = ['●', '▲', '■', '◆', '★', '✚', '▼', '◉'];
export const REPORT_SYMBOL = 'R';
export const OTHER_SYMBOLS = ['R', '#', '%', '@', '$', '□', 'C'];

export const STATUS_INFO: Record<CalendarStatus, { label: string; hint: string; fill: string }> = {
  done: { label: 'Done', hint: 'Don’t mark it green until the results are sent or reported', fill: 'E2F0D9' },
  doing: { label: 'Currently doing', hint: 'e.g. still to analyse the lab results', fill: 'FFE699' },
  cancelled: { label: 'Cancelled / on hold', hint: 'Not going ahead', fill: 'FFD9D9' },
};
export const HIGHLIGHT_FILL = 'FFFF00';
export const STATUSES: CalendarStatus[] = ['done', 'doing', 'cancelled'];

/** The columns of the calendar, as in the spreadsheet; a row for a project shows the project's own for some. */
export interface CalendarColumn {
  field: CalendarTextField;
  label: string;
  width: number;
  /** The project's field shown (and changed) for a row with a project. */
  project?: 'code' | 'purchaseOrder' | 'consents' | 'folder';
  /** Before the months. */
  lead?: boolean;
}
export const CALENDAR_COLUMNS: CalendarColumn[] = [
  { field: 'job', label: 'Job', width: 210, lead: true },
  { field: 'jobCode', label: 'Job code', width: 128, project: 'code', lead: true },
  { field: 'purchaseOrder', label: 'Purchase order', width: 118, project: 'purchaseOrder', lead: true },
  { field: 'details', label: 'Monitoring schedule details', width: 270 },
  { field: 'notes', label: 'Monitoring notes', width: 250 },
  { field: 'reportDue', label: 'Annual report due', width: 170 },
  { field: 'managementPlan', label: 'Management plan', width: 150 },
  { field: 'other', label: 'Notes', width: 220 },
  { field: 'consents', label: 'Consents', width: 160, project: 'consents' },
  { field: 'folder', label: 'Folder link', width: 130, project: 'folder' },
];
export const COLUMN_MAP = new Map(CALENDAR_COLUMNS.map((c) => [c.field, c]));

/** What a row shows in a column: its own, or for a row with a project, the project's (the job: its name if blank). */
export function cellValue(row: CalendarRow, field: CalendarTextField | MonthField, project?: Project): string {
  if (isMonthField(field)) return row[field] ?? '';
  const col = COLUMN_MAP.get(field);
  if (project && col?.project) return project[col.project] ?? '';
  if (field === 'job') return row.job || project?.name || '';
  return (row[field] as string | undefined) ?? '';
}

export const markId = (rowId: string, month: string, field?: CalendarTextField) => (field ? `${rowId}|${month.slice(0, 4)}|${field}` : `${rowId}|${month}`);

/** The colour of a row's month (YYYY-MM), or of another of its columns in a year. */
export function statusOf(marks: Map<string, CalendarMark>, rowId: string, month: string, field?: CalendarTextField): CalendarStatus | undefined {
  return marks.get(markId(rowId, month, field))?.status;
}

// ------------------------------------------------------------ months and sampling windows

export interface MonthWindow {
  /** In a sampling window: drawn with a line through it. */
  inWindow: boolean;
  /** Where the window starts and ends (a window running over the new year has no start in January, or end in December). */
  start: boolean;
  end: boolean;
  /** For a start: the months to its end (this one included). */
  span: number;
}

/** The sampling windows in a row's months: "(" opens one, ")" closes it, a ")" early in the year closes one from late in it. */
export function windowsOf(texts: string[]): MonthWindow[] {
  const out: MonthWindow[] = Array.from({ length: 12 }, () => ({ inWindow: false, start: false, end: false, span: 0 }));
  let open = false;
  let loneClose = -1;
  for (let i = 0; i < 12; i++) {
    if (open) out[i].inWindow = true;
    for (const ch of texts[i] ?? '') {
      if (ch === '(' && !open) {
        open = true;
        out[i].start = out[i].inWindow = true;
      } else if (ch === ')') {
        if (open) {
          open = false;
          out[i].end = out[i].inWindow = true;
        } else if (loneClose < 0) loneClose = i;
      }
    }
  }
  if (loneClose >= 0) {
    for (let i = 0; i <= loneClose; i++) out[i].inWindow = true;
    out[loneClose].end = true;
  }
  for (let i = 0; i < 12; i++) {
    if (!out[i].start) continue;
    let j = i;
    while (j < 11 && !out[j].end && out[j + 1].inWindow && !out[j + 1].start) j++;
    out[i].span = j - i + 1;
  }
  return out;
}

export const rowMonths = (row: CalendarRow) => MONTH_FIELDS.map((f) => row[f] ?? '');

/** What's shown in a month: its marks and words, without the window's brackets. */
export function monthText(text: string): string {
  return text.replace(/[()_━]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Whether anything is planned in a month of a row (a mark, or a sampling window). */
export function plannedIn(row: CalendarRow, index: number, windows = windowsOf(rowMonths(row))): boolean {
  return !!monthText(row[MONTH_FIELDS[index]] ?? '') || windows[index].inWindow;
}

/** The months (indices) of the sampling window a month is in, or just that month. */
export function windowRange(windows: MonthWindow[], index: number): [number, number] {
  if (!windows[index]?.inWindow) return [index, index];
  let a = index;
  while (a > 0 && !windows[a].start && windows[a - 1].inWindow && !windows[a - 1].end) a--;
  let b = index;
  while (b < 11 && !windows[b].end && windows[b + 1].inWindow && !windows[b + 1].start) b++;
  return [a, b];
}

/** Adds a mark to a month's text, or takes it out (keeping a window's brackets where they are). */
export function toggleSymbol(text: string, symbol: string, on: boolean): string {
  if (!on) return text.split(symbol).join('').replace(/\s+/g, ' ').replace(/\(\s+/, '(').replace(/\s+\)/, ')').trim();
  if (text.includes(symbol)) return text;
  const close = text.endsWith(')') ? ')' : '';
  const body = close ? text.slice(0, -1) : text;
  return `${body}${symbol}${close}`;
}

/** Months a..b of a row as one sampling window (or, when they already are one, not). */
export function setWindow(texts: string[], a: number, b: number, on: boolean): string[] {
  const out = texts.map((t) => t ?? '');
  const strip = (t: string) => t.replace(/[()]/g, '').trim();
  const wins = windowsOf(out);
  // take out any window the months touch
  const [wa] = windowRange(wins, a);
  const [, wb] = windowRange(wins, b);
  for (let i = Math.min(a, wa); i <= Math.max(b, wb); i++) out[i] = strip(out[i]);
  if (on && b > a) {
    out[a] = `(${out[a]}`;
    out[b] = `${out[b]})`;
  }
  return out;
}

// ------------------------------------------------------------ filled in from a project

/** The marks a project's sampling schedules have on the calendar: their own, or one in turn. */
export function scheduleSymbols(schedules: MonitoringSchedule[]): Map<string, string> {
  const sorted = [...schedules].sort((a, b) => a.startDate.localeCompare(b.startDate) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const taken = new Set(sorted.map((s) => s.symbol).filter(Boolean));
  const free = CALENDAR_SYMBOLS.filter((s) => !taken.has(s));
  let i = 0;
  return new Map(sorted.map((s) => [s.id, s.symbol || free[i++ % Math.max(1, free.length)] || CALENDAR_SYMBOLS[0]]));
}

export interface RowPlan {
  months: Partial<Record<MonthField, string>>;
  /** The key to the marks. */
  details: string;
  reportDue: string;
}

/**
 * A row's months from a project's sampling schedules and reports, for a year: each schedule's mark in the months its
 * rounds start (every month for weekly or daily sampling), a window over the months it can be sampled in, R where a
 * report is due.
 */
export function planFromProject(schedules: MonitoringSchedule[], obligations: ReportObligation[], year: number, siteCodes = new Map<string, string>()): RowPlan {
  const first = `${year}-01-01`;
  const last = `${year}-12-31`;
  const marks: string[][] = Array.from({ length: 12 }, () => []);
  const opens = new Set<number>();
  const closes = new Set<number>();
  const busy = new Set<number>(); // months already in a window
  const key: string[] = [];
  const active = schedules.filter((s) => s.active).sort((a, b) => a.startDate.localeCompare(b.startDate) || a.name.localeCompare(b.name));
  const symbols = scheduleSymbols(active);
  const monthIndex = (date: string) => (Number(date.slice(0, 4)) - year) * 12 + Number(date.slice(5, 7)) - 1;
  for (const sch of active) {
    const sym = symbols.get(sch.id)!;
    const sites = sch.siteIds.map((id) => siteCodes.get(id)).filter(Boolean);
    key.push(`${sym} = ${sch.name} (${frequencyLabel(sch.every, sch.unit).toLowerCase()}${sites.length ? `: ${sites.join(', ')}` : ''})`);
    const span = sch.unit === 'month' || sch.unit === 'year' ? Math.max(1, Math.round(sch.window ?? 1)) : 1;
    for (let k = 0; k < 2000; k++) {
      const start = scheduleStep(sch.startDate, k, sch.every, sch.unit);
      if (start > last || (sch.endDate && start > sch.endDate)) break;
      const m0 = monthIndex(start);
      const m1 = m0 + span - 1;
      if (m1 < 0) continue;
      if (m0 >= 0 && !marks[m0].includes(sym)) marks[m0].push(sym);
      if (span > 1) {
        const months = Array.from({ length: m1 - m0 + 1 }, (_, i) => m0 + i).filter((m) => m >= 0 && m < 12);
        if (months.some((m) => busy.has(m))) continue;
        months.forEach((m) => busy.add(m));
        if (m0 >= 0) opens.add(m0);
        if (m1 < 12) closes.add(m1);
      }
    }
  }
  const due: string[] = [];
  for (const ob of obligations.filter((o) => o.active)) {
    const dates: string[] = [];
    for (let k = 0; k < (ob.every ? 600 : 1); k++) {
      const p = obligationPeriod(ob, k);
      if (p.dueDate > last) break;
      if (p.dueDate < first) continue;
      const m = monthIndex(p.dueDate);
      if (!marks[m].includes(REPORT_SYMBOL)) marks[m].push(REPORT_SYMBOL);
      dates.push(p.dueDate);
    }
    const day = (d: string, long: boolean) => `${Number(d.slice(8, 10))} ${(long ? MONTH_LONG : MONTH_SHORT)[Number(d.slice(5, 7)) - 1]}`;
    if (dates.length) due.push(`${ob.name} – ${dates.length === 1 ? day(dates[0], true) : dates.map((d) => day(d, false)).join(', ')}`);
  }
  if (due.length) key.push(`${REPORT_SYMBOL} = report due`);
  const months: Partial<Record<MonthField, string>> = {};
  MONTH_FIELDS.forEach((f, i) => {
    const t = `${opens.has(i) ? '(' : ''}${marks[i].join('')}${closes.has(i) ? ')' : ''}`;
    if (t) months[f] = t;
  });
  return { months, details: key.join('; '), reportDue: due.join('\n') };
}

/**
 * A new row for a project: its schedule filled in, its notes from the first calendar. (The reports due show by
 * themselves on a project's row, so they aren't written in.)
 */
export function rowForProject(project: Project, schedules: MonitoringSchedule[], obligations: ReportObligation[], year: number, siteCodes?: Map<string, string>): Partial<CalendarRow> {
  const plan = planFromProject(schedules, obligations, year, siteCodes);
  return { projectId: project.id, job: '', ...plan.months, details: plan.details || undefined, notes: project.calendarNotes || undefined };
}

/** The reports due a project's row shows: for each, the first not sent this year, or the last one sent. */
export function reportsToShow(reports: ReportDue[]): ReportDue[] {
  return [...new Set(reports.map((x) => x.obligationId))].map((id) => {
    const list = reports.filter((x) => x.obligationId === id);
    return list.find((x) => !x.submitted) ?? list[list.length - 1];
  });
}

// ------------------------------------------------------------ what EnviroDB knows

export interface ResultsIn {
  /** Days sampled (YYYY-MM-DD). */
  days: string[];
  /** Site ids sampled. */
  sites: string[];
  /** When the results came in: the first import of them (YYYY-MM-DD), if known. */
  received?: string;
  /** The labs and their job numbers, from the lab files. */
  labs: string[];
  jobs: string[];
}

export type CalendarSample = Pick<Sample, 'siteId' | 'date'> & Partial<Pick<Sample, 'importId' | 'labName' | 'labJob'>>;

/** An import this long after the sampling is of old results: when they came back isn't known from it. */
export const LATE_IMPORT_DAYS = 45;

/** The months (YYYY-MM) a row's project has results in, at its sites; `imported`: each import's date. */
export function resultsByMonth(samples: CalendarSample[], siteIds?: string[], imported?: Map<string, string>): Map<string, ResultsIn> {
  const only = siteIds?.length ? new Set(siteIds) : null;
  const out = new Map<string, ResultsIn>();
  const add = (list: string[], v?: string) => v && !list.includes(v) && list.push(v);
  for (const s of samples) {
    if (only && !only.has(s.siteId)) continue;
    const day = s.date.slice(0, 10);
    const m = out.get(day.slice(0, 7)) ?? { days: [], sites: [], labs: [], jobs: [] };
    add(m.days, day);
    add(m.sites, s.siteId);
    add(m.labs, s.labName?.trim());
    add(m.jobs, s.labJob?.trim());
    // when the results came in – unless the import came long after the sampling (old results imported later)
    const got = s.importId ? imported?.get(s.importId) : undefined;
    if (got && daysBetween(day, got) <= LATE_IMPORT_DAYS && (!m.received || got < m.received)) m.received = got;
    out.set(day.slice(0, 7), m);
  }
  for (const m of out.values()) m.days.sort();
  return out;
}

/** A report sent: the period it covers and when. */
export interface ReportSent {
  name: string;
  periodStart: string;
  periodEnd: string;
  submittedOn: string;
}

export interface ReportDue {
  obligationId: string;
  name: string;
  index: number;
  due: string;
  submitted?: string;
  /** The period it reports on. */
  periodStart?: string;
  periodEnd?: string;
}

/** A project's reports due in a year. */
export function reportsDueIn(obligations: ReportObligation[], year: number): ReportDue[] {
  const out: ReportDue[] = [];
  for (const ob of obligations.filter((o) => o.active)) {
    for (let k = 0; k < (ob.every ? 600 : 1); k++) {
      const p = obligationPeriod(ob, k);
      if (p.dueDate > `${year}-12-31`) break;
      if (p.dueDate.startsWith(String(year))) out.push({ obligationId: ob.id, name: ob.name, index: k, due: p.dueDate, submitted: p.submission?.submittedOn, periodStart: p.periodStart, periodEnd: p.periodEnd });
    }
  }
  return out.sort((a, b) => a.due.localeCompare(b.due));
}

/** The colour a spreadsheet cell's fill stands for: green done, yellow or orange doing, pink or red cancelled; bright yellow a highlight. */
export function statusFromFill(rgb: string | undefined): CalendarStatus | 'highlight' | null {
  const hex = (rgb ?? '').replace(/^#/, '').slice(-6);
  if (!/^[0-9a-f]{6}$/i.test(hex)) return null;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d < 0.06 || l > 0.97) return null; // white or grey
  const s = d / (1 - Math.abs(2 * l - 1));
  if (s < 0.15) return null;
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  if (h >= 70 && h < 170) return 'done';
  if (h >= 50 && h < 70) return l <= 0.6 && s > 0.9 ? 'highlight' : 'doing';
  if (h >= 18 && h < 50) return 'doing';
  if (h < 18 || h >= 320) return 'cancelled';
  return null;
}

// ------------------------------------------------------------ the sheet, with what EnviroDB knows

export interface CalendarSheet {
  /** In order. */
  rows: CalendarRow[];
  /** Every colour and note, by id. */
  marks: Map<string, CalendarMark>;
  projects: Map<string, Project>;
  sites: Map<string, Site>;
  /**
   * For rows with a project: the months results came in (at the row's sites), the reports due in the year, and the
   * reports sent (each with the period it covers).
   */
  facts: Map<string, { results: Map<string, ResultsIn>; reports: ReportDue[]; sent: ReportSent[] }>;
}

export interface SheetInput {
  rows: CalendarRow[];
  marks: CalendarMark[];
  projects: Project[];
  samples: Array<CalendarSample & Pick<Sample, 'projectId'>>;
  obligations: ReportObligation[];
  sites: Site[];
  /** Each import's date (YYYY-MM-DD), by id: when results came in. */
  imported?: Map<string, string>;
}

/** The calendar for a year: its rows in order, their colours, and for each row with a project what EnviroDB knows. */
export function buildSheet(input: SheetInput, year: number): CalendarSheet {
  const byProject = <T extends { projectId: string }>(list: T[]) => {
    const m = new Map<string, T[]>();
    for (const x of list) m.set(x.projectId, [...(m.get(x.projectId) ?? []), x]);
    return m;
  };
  const smp = byProject(input.samples);
  const obl = byProject(input.obligations);
  const projects = new Map(input.projects.map((p) => [p.id, p]));
  const facts: CalendarSheet['facts'] = new Map();
  for (const r of input.rows) {
    if (!r.projectId || !projects.has(r.projectId)) continue;
    const sent = (obl.get(r.projectId) ?? []).flatMap((ob) => ob.submissions.map((s) => ({ name: ob.name, periodStart: s.periodStart, periodEnd: s.periodEnd, submittedOn: s.submittedOn })));
    facts.set(r.id, { results: resultsByMonth(smp.get(r.projectId) ?? [], r.siteIds, input.imported), reports: reportsDueIn(obl.get(r.projectId) ?? [], year), sent });
  }
  return {
    rows: [...input.rows].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)),
    marks: new Map(input.marks.map((m) => [m.id, m])),
    projects,
    sites: new Map(input.sites.map((s) => [s.id, s])),
    facts,
  };
}
