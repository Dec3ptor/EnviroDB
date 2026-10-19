// Sampling rounds on the monitoring calendar: for each planned month (or sampling window), how far the round has got –
// sampled, sent to the lab, results back, results sent on – and what's overdue. Stages ticked by hand are kept on the
// month's calendar mark; EnviroDB fills in what it knows: results imported (with the lab and its job number), the
// days sampled, and reports sent that cover the month. The month's colour follows: under way, then done once sent.

import type { CalendarMark, CalendarRow, CalendarStatus, Settings } from '../db/types';
import type { CalendarEdit } from '../db/repo';
import { MONTH_FIELDS, REPORT_SYMBOL, markId, monthKey, monthText, rowMonths, windowRange, windowsOf, type CalendarSheet, type ResultsIn } from './calendar';
import { addDays, formatDate } from './dates';

export const DEFAULT_LAB_DAYS = 10;
export const DEFAULT_SEND_DAYS = 5;

export type StageKey = 'sampled' | 'lab' | 'results' | 'sent';
export const STAGES: Array<{ key: StageKey; label: string }> = [
  { key: 'sampled', label: 'Sampled' },
  { key: 'lab', label: 'Sent to the lab' },
  { key: 'results', label: 'Results back' },
  { key: 'sent', label: 'Results sent' },
];

export interface RoundStage {
  done: boolean;
  /** When (YYYY-MM-DD), if known. */
  date?: string;
  /** How EnviroDB knows, when it wasn't ticked by hand: "imported 9 Oct", "in the Annual report sent 3 Feb". */
  from?: string;
}

export interface Round {
  rowId: string;
  /** The month the round is kept on (a window's first month). */
  month: string;
  /** The months it covers: one, or a sampling window's. */
  months: string[];
  planned: boolean;
  stages: Record<StageKey, RoundStage>;
  lab?: string;
  labRef?: string;
  sentTo?: string;
  cancelled: boolean;
  /** Anything recorded: a stage, results, or the month coloured. */
  started: boolean;
  /** Stages ticked or the month coloured by hand (not just results that came in). */
  tracked: boolean;
  done: boolean;
  /** What's late. */
  overdue?: { kind: 'sample' | 'lab' | 'send'; text: string; due: string };
  /** What's next, and when by. */
  next?: { text: string; due?: string };
}

/** The working days (Monday–Friday) after `from`, up to and including `to`. */
export function workingDaysBetween(from: string, to: string): number {
  if (to <= from) return 0;
  let n = 0;
  for (let d = addDays(from, 1); d <= to; d = addDays(d, 1)) {
    const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (wd !== 0 && wd !== 6) n++;
  }
  return n;
}

/** The date `n` working days after `date`. */
export function addWorkingDays(date: string, n: number): string {
  let d = date;
  for (let k = 0; k < n; ) {
    d = addDays(d, 1);
    const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (wd !== 0 && wd !== 6) k++;
  }
  return d;
}

const lastDay = (month: string) => addDays(`${nextMonth(month)}-01`, -1);
function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/** Results over several months, as one. */
function joinResults(list: Array<ResultsIn | undefined>): ResultsIn | undefined {
  const got = list.filter(Boolean) as ResultsIn[];
  if (!got.length) return undefined;
  const uniq = (xs: string[]) => [...new Set(xs)];
  const received = got.map((r) => r.received).filter(Boolean).sort()[0];
  return { days: uniq(got.flatMap((r) => r.days)).sort(), sites: uniq(got.flatMap((r) => r.sites)), labs: uniq(got.flatMap((r) => r.labs)), jobs: uniq(got.flatMap((r) => r.jobs)), received };
}

export interface RoundOptions {
  today: string;
  labDays?: number;
  sendDays?: number;
}

export const roundOptions = (settings: Pick<Settings, 'labTurnaroundDays' | 'sendResultsDays'>, today: string): RoundOptions => ({
  today,
  labDays: settings.labTurnaroundDays ?? DEFAULT_LAB_DAYS,
  sendDays: settings.sendResultsDays ?? DEFAULT_SEND_DAYS,
});

/** Sampling planned in a month: a mark other than R (a report due), or a sampling window. */
export function samplingPlanned(row: CalendarRow, index: number, windows = windowsOf(rowMonths(row))): boolean {
  if (windows[index]?.inWindow) return true;
  return !!monthText(row[MONTH_FIELDS[index]] ?? '')
    .replace(new RegExp(`(^|\\s)${REPORT_SYMBOL}(?=\\s|$)`, 'g'), ' ')
    .trim();
}

/** The months a round on a row covers: the month, or the whole sampling window it's in. */
export function roundMonths(row: CalendarRow, month: string): string[] {
  const year = Number(month.slice(0, 4));
  const i = Number(month.slice(5, 7)) - 1;
  const [a, b] = windowRange(windowsOf(rowMonths(row)), i);
  return MONTH_FIELDS.slice(a, b + 1).map((f) => monthKey(year, f));
}

/** A month's round on a calendar row (or the window's it falls in); null when there's nothing to track. */
export function roundOf(sheet: CalendarSheet, row: CalendarRow, month: string, opts: RoundOptions): Round | null {
  const months = roundMonths(row, month);
  const first = months[0];
  const windows = windowsOf(rowMonths(row));
  const planned = months.some((m) => samplingPlanned(row, Number(m.slice(5, 7)) - 1, windows));
  const mark: Partial<CalendarMark> = sheet.marks.get(markId(row.id, first)) ?? {};
  const facts = sheet.facts.get(row.id);
  const res = joinResults(months.map((m) => facts?.results.get(m)));
  const hasStage = !!(mark.sampledOn || mark.labSentOn || mark.resultsOn || mark.resultsSentOn);
  if (!planned && !res && !hasStage && !mark.status) return null;

  const end = lastDay(months[months.length - 1]);
  // a report sent after the sampling, covering the round's months
  const sampledBy = mark.sampledOn ?? res?.days[0] ?? `${first}-01`;
  const report = facts?.sent.filter((s) => s.periodStart <= end && s.periodEnd >= `${first}-01` && s.submittedOn >= sampledBy).sort((a, b) => a.submittedOn.localeCompare(b.submittedOn))[0];
  const resultsDate = mark.resultsOn ?? res?.received ?? res?.days[res.days.length - 1];

  const stages: Record<StageKey, RoundStage> = {
    sampled: mark.sampledOn ? { done: true, date: mark.sampledOn } : res ? { done: true, date: res.days[0], from: `samples ${res.days.map((d) => formatDate(d)).join(', ')}` } : { done: !!(mark.labSentOn || mark.resultsOn) },
    lab: mark.labSentOn ? { done: true, date: mark.labSentOn } : { done: !!(res || mark.resultsOn), from: res ? 'the results are back' : undefined },
    results: mark.resultsOn ? { done: true, date: mark.resultsOn } : res ? { done: true, date: resultsDate, from: res.received ? `imported ${formatDate(res.received)}` : 'in EnviroDB' } : { done: false },
    sent: mark.resultsSentOn
      ? { done: true, date: mark.resultsSentOn }
      : mark.status === 'done'
        ? { done: true, from: 'marked done' }
        : report
          ? { done: true, date: report.submittedOn, from: `in the ${report.name} sent ${formatDate(report.submittedOn)}` }
          : { done: false },
  };
  const cancelled = mark.status === 'cancelled' || !!row.onHold;
  const done = stages.sent.done;
  const round: Round = {
    rowId: row.id,
    month: first,
    months,
    planned,
    stages,
    lab: mark.lab ?? res?.labs[0],
    labRef: mark.labRef ?? (res?.jobs.length ? res.jobs.join(', ') : undefined),
    sentTo: mark.sentTo,
    cancelled,
    started: hasStage || !!res || !!mark.status,
    tracked: hasStage || !!mark.status,
    done,
  };
  if (cancelled || done) return round;

  const { today } = opts;
  const labDays = opts.labDays ?? DEFAULT_LAB_DAYS;
  const sendDays = opts.sendDays ?? DEFAULT_SEND_DAYS;
  const lab = round.lab ? round.lab : 'the lab';
  if (stages.results.done && resultsDate) {
    const due = addWorkingDays(resultsDate, sendDays);
    if (today > due) round.overdue = { kind: 'send', text: `Results not sent – due ${formatDate(due)}`, due };
    else round.next = { text: `Send the results by ${formatDate(due)}`, due };
  } else if (stages.lab.done || stages.sampled.done) {
    const from = stages.lab.date ?? stages.sampled.date;
    const due = from ? addWorkingDays(from, labDays) : undefined;
    if (due && today > due) round.overdue = { kind: 'lab', text: `Results from ${lab} overdue – due ${formatDate(due)}`, due };
    else if (!stages.lab.done) round.next = { text: 'Send the samples to the lab' };
    else round.next = { text: due ? `Results due from ${lab} by ${formatDate(due)}` : `Results due from ${lab}`, due };
  } else if (planned && end < today) {
    round.overdue = { kind: 'sample', text: `Planned for ${months.length > 1 ? `${formatMonth(first)} – ${formatMonth(months[months.length - 1])}` : formatMonth(first)}, not sampled`, due: end };
  } else if (planned) round.next = { text: `Sample by ${formatDate(end)}`, due: end };
  return round;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const formatMonth = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

/** Every round under way or overdue on the calendar from `since` (YYYY-MM) to this month, most pressing first. */
export function openRounds(sheet: CalendarSheet, opts: RoundOptions, since: string): Round[] {
  const out: Round[] = [];
  const now = opts.today.slice(0, 7);
  for (const row of sheet.rows) {
    const project = row.projectId ? sheet.projects.get(row.projectId) : undefined;
    if (row.onHold || (project && project.status !== 'active')) continue;
    const seen = new Set<string>();
    for (const f of MONTH_FIELDS) {
      const month = monthKey(Number(now.slice(0, 4)), f);
      for (const m of [month, monthKey(Number(now.slice(0, 4)) - 1, f)]) {
        if (m < since || m > now) continue;
        const r = roundOf(sheet, row, m, opts);
        if (!r || seen.has(r.month) || r.done || r.cancelled) continue;
        seen.add(r.month);
        // rounds planned or being tracked (not results in an unplanned month, e.g. old data imported) that have begun or are overdue
        if ((r.planned || r.tracked) && (r.started || r.overdue)) out.push(r);
      }
    }
  }
  const rank = (r: Round) => (r.overdue ? 0 : r.next?.due ? 1 : 2);
  return out.sort((a, b) => rank(a) - rank(b) || (a.overdue?.due ?? a.next?.due ?? a.month).localeCompare(b.overdue?.due ?? b.next?.due ?? b.month));
}

export type RoundPatch = Partial<Pick<CalendarMark, 'sampledOn' | 'labSentOn' | 'lab' | 'labRef' | 'resultsOn' | 'resultsSentOn' | 'sentTo' | 'note'>> & {
  /** Untick "results sent" when it was only known from the colour. */
  notSent?: boolean;
  /** The round cancelled or on hold (true), or going ahead again (false). */
  cancelled?: boolean;
};

/**
 * The edits that record a round's stages: kept on the round's first month, and the colour of every month of it
 * following – under way once anything is recorded, done once the results are sent (cancelled stays cancelled).
 */
export function roundEdits(row: CalendarRow, month: string, patch: RoundPatch, marks: Map<string, CalendarMark>): CalendarEdit[] {
  const months = roundMonths(row, month);
  const id = markId(row.id, months[0]);
  const cur = marks.get(id);
  const { notSent, cancelled, ...fields } = patch;
  const next: CalendarMark = { ...(cur ?? { id, item: row.id, month: months[0] }), ...fields, updatedAt: '' };
  for (const k of Object.keys(fields) as Array<keyof typeof fields>) if (!next[k]) delete next[k];
  const anyStage = !!(next.sampledOn || next.labSentOn || next.resultsOn || next.resultsSentOn);
  const prev = cancelled === false && cur?.status === 'cancelled' ? undefined : cur?.status;
  const status: CalendarStatus | undefined =
    cancelled || prev === 'cancelled' ? 'cancelled' : next.resultsSentOn || (prev === 'done' && !notSent) ? 'done' : anyStage ? 'doing' : prev === 'done' && notSent ? undefined : prev;
  next.status = status;
  if (!status) delete next.status;
  const keep = (m: CalendarMark) => !!(m.status || m.note || m.sampledOn || m.labSentOn || m.lab || m.labRef || m.resultsOn || m.resultsSentOn || m.sentTo);
  const edits: CalendarEdit[] = [{ t: 'mark', id, mark: keep(next) ? next : null }];
  // the rest of a window takes the same colour
  for (const m of months.slice(1)) {
    const mid = markId(row.id, m);
    const other = marks.get(mid);
    const o: CalendarMark = { ...(other ?? { id: mid, item: row.id, month: m }), status, updatedAt: '' };
    if (!status) delete o.status;
    edits.push({ t: 'mark', id: mid, mark: keep(o) ? o : null });
  }
  return edits;
}

/** A line for the round: "Sent to Hill Labs 2 Oct (job 3456789) · results back 9 Oct · sent 12 Oct to the client". */
export function roundText(r: Round): string {
  const parts: string[] = [];
  const s = r.stages;
  if (s.sampled.done) parts.push(`sampled${s.sampled.date ? ` ${formatDate(s.sampled.date)}` : ''}`);
  if (s.lab.done && s.lab.date) parts.push(`sent to ${r.lab ?? 'the lab'} ${formatDate(s.lab.date)}${r.labRef ? ` (${r.labRef})` : ''}`);
  else if (s.lab.done && r.lab) parts.push(`${r.lab}${r.labRef ? ` (${r.labRef})` : ''}`);
  if (s.results.done) parts.push(`results back${s.results.date ? ` ${formatDate(s.results.date)}` : ''}`);
  if (s.sent.done) parts.push(`sent${s.sent.date ? ` ${formatDate(s.sent.date)}` : ''}${r.sentTo ? ` to ${r.sentTo}` : ''}${s.sent.from && !s.sent.date ? ` (${s.sent.from})` : ''}`);
  if (r.cancelled) parts.push('cancelled / on hold');
  const text = parts.join(' · ');
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}
