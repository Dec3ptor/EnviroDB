// The monitoring calendar: a year of sampling rounds, reports and other jobs, month by month, for every project –
// laid out like a team's "monitoring schedule" spreadsheet, but filled in from each project's sampling schedules
// and reporting obligations. Results in EnviroDB and reports marked submitted count by themselves; the rest
// (results sent, still analysing, cancelled) is marked by hand.

import type { CalendarMark, CalendarStatus, MonitoringSchedule, Project, ReportObligation, Sample } from '../db/types';
import { addDays, addMonths, endOfMonth, MONTH_LONG, MONTH_SHORT, todayStr } from './dates';
import { frequencyLabel, obligationPeriod, scheduleStep } from './schedule';

/** Marks for sampling schedules, in turn. */
export const CALENDAR_SYMBOLS = ['●', '▲', '■', '◆', '★', '✚', '▼', '◉'];
/** Marks for extra jobs (an extra suite, a survey …). */
export const EXTRA_SYMBOLS = ['#', '%', '@', '$', '□', '✱', 'C', '!'];
export const REPORT_SYMBOL = 'R';

/** Where an item stands in a month: as marked, or 'todo' / 'overdue' when it isn't. */
export type CellState = CalendarStatus | 'todo' | 'overdue';

export const STATE_INFO: Record<CellState, { label: string; hint: string }> = {
  done: { label: 'Done', hint: 'Results sent or reported' },
  doing: { label: 'Doing', hint: 'Under way – e.g. still analysing the lab results' },
  cancelled: { label: 'Cancelled / on hold', hint: 'Not going ahead this time' },
  todo: { label: 'To do', hint: 'Not started' },
  overdue: { label: 'Overdue', hint: 'Its time has passed and nothing is in yet' },
};

export interface CalendarItem {
  /** The schedule's or obligation's id, or the extra job's `x-…` id. */
  key: string;
  kind: 'sampling' | 'report' | 'extra';
  projectId: string;
  symbol: string;
  label: string;
  /** e.g. "Quarterly · GW1, GW2, GW3" */
  detail?: string;
}

export interface CalendarEntry {
  item: CalendarItem;
  month: string;
  /** A later month of a sampling window: drawn as a band, without the mark. */
  window?: boolean;
  /** The round or reporting period it's for. */
  start: string;
  end: string;
  /** Reports: the due date. Sampling: when the round has to be done by. */
  due: string;
  state: CellState;
  /**
   * What EnviroDB knows by itself: results in for every site or some, the report marked submitted, or a round whose
   * results are in a report that's been submitted.
   */
  auto?: 'sampled' | 'partly' | 'submitted' | 'reported';
  /** The submitted report a round's results went into. */
  reportedIn?: string;
  /** Rounds in the month (weekly or daily sampling). */
  count?: number;
  mark?: CalendarMark;
}

export interface ProjectCalendar {
  project: Project;
  items: CalendarItem[];
  entries: CalendarEntry[];
  /** Reports due in the months shown. */
  reportsDue: Array<{ label: string; due: string; state: CellState }>;
}

export const monthOf = (date: string) => date.slice(0, 7);
const addMonth = (month: string, n: number) => addMonths(`${month}-01`, n).slice(0, 7);
const monthEnd = (month: string) => endOfMonth(`${month}-01`);

/** The twelve months (YYYY-MM) of a calendar year starting in `startMonth` (1–12). */
export function calendarMonths(year: number, startMonth = 1): string[] {
  return Array.from({ length: 12 }, (_, i) => addMonth(`${year}-${String(startMonth).padStart(2, '0')}`, i));
}

export function monthName(month: string, long = false): string {
  const m = Number(month.slice(5, 7)) - 1;
  return (long ? MONTH_LONG : MONTH_SHORT)[m] ?? month;
}

/** The marks a project's sampling schedules have on the calendar: their own, or one in turn. */
export function scheduleSymbols(schedules: MonitoringSchedule[]): Map<string, string> {
  const sorted = [...schedules].sort((a, b) => a.startDate.localeCompare(b.startDate) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const taken = new Set(sorted.map((s) => s.symbol).filter(Boolean));
  const free = CALENDAR_SYMBOLS.filter((s) => !taken.has(s));
  let i = 0;
  return new Map(sorted.map((s) => [s.id, s.symbol || free[i++ % Math.max(1, free.length)] || CALENDAR_SYMBOLS[0]]));
}

function stateOf(mark: CalendarMark | undefined, auto: CalendarEntry['auto'], due: string, today: string): CellState {
  if (mark?.status) return mark.status;
  if (auto === 'submitted' || auto === 'reported') return 'done';
  // results in, not yet marked done: still being worked on (done is for results sent or reported)
  if (auto === 'sampled') return 'doing';
  return due < today ? 'overdue' : 'todo';
}

interface Input {
  project: Project;
  schedules: MonitoringSchedule[];
  obligations: ReportObligation[];
  samples: Pick<Sample, 'siteId' | 'date'>[];
  marks: CalendarMark[];
  siteCodes?: Map<string, string>;
}

/** A project's year on the calendar: what's due each month, and where it stands. */
export function projectCalendar(input: Input, months: string[], today = todayStr()): ProjectCalendar {
  const { project } = input;
  const first = `${months[0]}-01`;
  const last = monthEnd(months[months.length - 1]);
  const shown = new Set(months);
  const marks = new Map(input.marks.map((m) => [m.id, m]));
  const symbols = scheduleSymbols(input.schedules);
  const items: CalendarItem[] = [];
  const entries: CalendarEntry[] = [];
  // reports submitted, and the periods they cover: a round with its results in, inside one, has been reported
  const submitted = input.obligations.flatMap((ob) => ob.submissions.map((x) => ({ name: ob.name, start: x.periodStart, end: x.periodEnd })));
  const reportedIn = (start: string, end: string) => submitted.find((x) => x.start <= start && x.end >= end)?.name;

  for (const sch of input.schedules) {
    if (!sch.active) continue;
    const sites = sch.siteIds.map((id) => input.siteCodes?.get(id) ?? '').filter(Boolean);
    const item: CalendarItem = {
      key: sch.id,
      kind: 'sampling',
      projectId: project.id,
      symbol: symbols.get(sch.id)!,
      label: sch.name,
      detail: [frequencyLabel(sch.every, sch.unit), sites.length ? sites.join(', ') : ''].filter(Boolean).join(' · '),
    };
    items.push(item);
    const siteSet = new Set(sch.siteIds);
    const days = input.samples.filter((s) => siteSet.has(s.siteId)).map((s) => ({ siteId: s.siteId, day: s.date.slice(0, 10) }));
    const fine = sch.unit === 'day' || sch.unit === 'week';
    const byMonth = new Map<string, { n: number; sampled: number; partly: number; start: string; end: string }>();
    for (let k = 0; k < 20000; k++) {
      const ps = scheduleStep(sch.startDate, k, sch.every, sch.unit);
      if (ps > last || (sch.endDate && ps > sch.endDate)) break;
      const pe = addDays(scheduleStep(sch.startDate, k + 1, sch.every, sch.unit), -1);
      if (pe < first) continue;
      const got = new Set(days.filter((d) => d.day >= ps && d.day <= pe).map((d) => d.siteId));
      const report = got.size ? reportedIn(ps, pe) : undefined;
      const auto: CalendarEntry['auto'] = report ? 'reported' : siteSet.size && got.size >= siteSet.size ? 'sampled' : got.size ? 'partly' : undefined;
      const month = monthOf(ps);
      if (fine) {
        const m = byMonth.get(month) ?? { n: 0, sampled: 0, partly: 0, start: ps, end: pe };
        m.n++;
        if (auto === 'sampled' || auto === 'reported') m.sampled++;
        else if (auto === 'partly') m.partly++;
        m.end = pe;
        byMonth.set(month, m);
        continue;
      }
      // the window to sample in: the month the round starts, or as many months as the schedule says
      const w = Math.max(1, Math.round(sch.window ?? 1));
      const due = sch.window ? [pe, monthEnd(addMonth(month, w - 1))].sort()[0] : pe;
      const mark = marks.get(`${sch.id}|${month}`);
      const state = stateOf(mark, auto, due, today);
      if (shown.has(month)) entries.push({ item, month, start: ps, end: pe, due, state, auto, reportedIn: report, mark });
      for (let j = 1; j < w; j++) {
        const wm = addMonth(month, j);
        if (`${wm}-01` > pe) break;
        if (shown.has(wm)) entries.push({ item, month: wm, window: true, start: ps, end: pe, due, state, auto, reportedIn: report, mark });
      }
    }
    for (const [month, m] of byMonth) {
      if (!shown.has(month)) continue;
      const report = m.sampled === m.n ? reportedIn(m.start, m.end) : undefined;
      const auto: CalendarEntry['auto'] = report ? 'reported' : m.sampled === m.n ? 'sampled' : m.sampled || m.partly ? 'partly' : undefined;
      const mark = marks.get(`${sch.id}|${month}`);
      entries.push({ item, month, start: m.start, end: m.end, due: m.end, state: stateOf(mark, auto, m.end, today), auto, reportedIn: report, count: m.n, mark });
    }
  }

  const reportsDue: ProjectCalendar['reportsDue'] = [];
  for (const ob of input.obligations) {
    if (!ob.active) continue;
    const item: CalendarItem = { key: ob.id, kind: 'report', projectId: project.id, symbol: REPORT_SYMBOL, label: ob.name, detail: ob.recipient ? `To ${ob.recipient}` : undefined };
    items.push(item);
    for (let k = 0; k < (ob.every ? 600 : 1); k++) {
      const p = obligationPeriod(ob, k, today);
      if (p.dueDate > last) break;
      const month = monthOf(p.dueDate);
      if (!shown.has(month)) continue;
      const mark = marks.get(`${ob.id}|${month}`);
      const auto = p.submission ? 'submitted' : undefined;
      const state = stateOf(mark, auto, p.dueDate, today);
      entries.push({ item, month, start: p.periodStart, end: p.periodEnd, due: p.dueDate, state, auto, mark });
      reportsDue.push({ label: ob.name, due: p.dueDate, state });
    }
  }

  // extra jobs marked on the calendar
  for (const m of input.marks) {
    if (!m.item.startsWith('x-') || !shown.has(m.month)) continue;
    const item: CalendarItem = { key: m.item, kind: 'extra', projectId: project.id, symbol: m.symbol || '#', label: m.label || 'Extra job' };
    items.push(item);
    const end = monthEnd(m.month);
    entries.push({ item, month: m.month, start: `${m.month}-01`, end, due: end, state: stateOf(m, undefined, end, today), mark: m });
  }

  entries.sort((a, b) => a.month.localeCompare(b.month) || KIND_ORDER[a.item.kind] - KIND_ORDER[b.item.kind] || symbolRank(a.item.symbol) - symbolRank(b.item.symbol) || a.item.label.localeCompare(b.item.label));
  reportsDue.sort((a, b) => a.due.localeCompare(b.due));
  return { project, items, entries, reportsDue };
}

const KIND_ORDER: Record<CalendarItem['kind'], number> = { sampling: 0, extra: 1, report: 2 };
const symbolRank = (s: string) => {
  const i = [...CALENDAR_SYMBOLS, ...EXTRA_SYMBOLS].indexOf(s);
  return i < 0 ? 99 : i;
};

/** How a month of a row looks: the state of what's due, all together. */
export function cellState(entries: CalendarEntry[]): CellState | null {
  const due = entries.filter((e) => !e.window);
  const all = due.length ? due : entries;
  if (!all.length) return null;
  const states = new Set(all.map((e) => e.state));
  if (states.has('overdue')) return 'overdue';
  if (states.has('doing')) return 'doing';
  if (states.has('todo')) return 'todo';
  if (states.has('done')) return 'done';
  return 'cancelled';
}

/** The marks shown in a month, e.g. "●▲R" (a weekly round as "●×4"). */
export function cellText(entries: CalendarEntry[]): string {
  return entries
    .filter((e) => !e.window)
    .map((e) => (e.count && e.count > 1 ? `${e.item.symbol}×${e.count}` : e.item.symbol))
    .join('');
}

/** The key for a project's marks: "● = Monthly – GW2 (Monthly · GW2)". */
export function legend(items: CalendarItem[]): string {
  return items
    .filter((i) => i.kind !== 'extra')
    .map((i) => `${i.symbol} = ${i.label}${i.kind === 'sampling' && i.detail ? ` (${i.detail})` : ''}`)
    .join('; ');
}
