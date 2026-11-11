import type { ImportBatch, MonitoringSchedule, ReportObligation, ReportSubmission, Result, Sample } from '../db/types';
import { addDays, addMonths, addMonthsEom, daysBetween, formatDate, todayStr, type PeriodChoice } from './dates';

// ------------------------------------------------------------ monitoring schedules

export function scheduleStep(start: string, k: number, every: number, unit: MonitoringSchedule['unit']): string {
  const n = Math.max(1, every) * k;
  switch (unit) {
    case 'day':
      return addDays(start, n);
    case 'week':
      return addDays(start, 7 * n);
    case 'month':
      return addMonths(start, n);
    case 'year':
      return addMonths(start, 12 * n);
  }
}

export interface SchedulePeriod {
  start: string;
  end: string;
  sampled: Record<string, string[]>; // siteId → sample dates
  missing: string[]; // site ids with no sample
}

export interface ScheduleStatus {
  schedule: MonitoringSchedule;
  current?: SchedulePeriod;
  outstanding: string[]; // sites still to be sampled in the current period
  dueBy?: string; // end of the current period when outstanding
  nextPeriodStart?: string;
  missed: Array<{ start: string; end: string; siteId: string }>;
  completedPeriods: number;
  totalPeriods: number;
}

export function frequencyLabel(every: number, unit: string): string {
  if (every === 1) return { day: 'Daily', week: 'Weekly', month: 'Monthly', year: 'Annually' }[unit] ?? unit;
  if (unit === 'month' && every === 3) return 'Quarterly';
  if (unit === 'month' && every === 6) return 'Six-monthly';
  if (unit === 'week' && every === 2) return 'Fortnightly';
  return `Every ${every} ${unit}s`;
}

/** Evaluate a schedule against the samples taken. Looks back `lookbackDays` for missed rounds. */
export function scheduleStatus(sch: MonitoringSchedule, samples: Sample[], resultsBySample: Map<string, Result[]> | null, today = todayStr(), lookbackDays = 730): ScheduleStatus {
  const relevant = samples.filter((s) => sch.siteIds.includes(s.siteId));
  const hasParams = (s: Sample) => {
    if (!sch.parameterIds.length || !resultsBySample) return true;
    const rs = resultsBySample.get(s.id) ?? [];
    return rs.some((r) => sch.parameterIds.includes(r.parameterId));
  };
  const periods: SchedulePeriod[] = [];
  const horizon = sch.endDate && sch.endDate < today ? sch.endDate : today;
  const from = addDays(today, -lookbackDays);
  for (let k = 0; k < 5000; k++) {
    const ps = scheduleStep(sch.startDate, k, sch.every, sch.unit);
    if (ps > horizon) break;
    const pe = addDays(scheduleStep(sch.startDate, k + 1, sch.every, sch.unit), -1);
    if (pe < from) continue;
    const sampled: Record<string, string[]> = {};
    for (const s of relevant) {
      const d = s.date.slice(0, 10);
      if (d >= ps && d <= pe && hasParams(s)) (sampled[s.siteId] ??= []).push(s.date);
    }
    periods.push({ start: ps, end: pe, sampled, missing: sch.siteIds.filter((id) => !sampled[id]) });
  }
  const current = periods.find((p) => p.start <= today && p.end >= today);
  const past = periods.filter((p) => p.end < today);
  const missed = past.flatMap((p) => p.missing.map((siteId) => ({ start: p.start, end: p.end, siteId })));
  return {
    schedule: sch,
    current,
    outstanding: current ? current.missing : [],
    dueBy: current && current.missing.length ? current.end : undefined,
    nextPeriodStart: current ? addDays(current.end, 1) : undefined,
    missed,
    completedPeriods: past.filter((p) => !p.missing.length).length,
    totalPeriods: past.length,
  };
}

// ------------------------------------------------------------ what a round is missing

/** The schedule's round a day falls in – none before it starts or after it ends. */
export function roundOf(sch: Pick<MonitoringSchedule, 'startDate' | 'endDate' | 'every' | 'unit'>, day: string): { start: string; end: string } | null {
  const d = day.slice(0, 10);
  if (d < sch.startDate || (sch.endDate && d > sch.endDate)) return null;
  for (let k = 0; k < 5000; k++) {
    const start = scheduleStep(sch.startDate, k, sch.every, sch.unit);
    if (start > d) return null;
    const end = addDays(scheduleStep(sch.startDate, k + 1, sch.every, sch.unit), -1);
    if (d <= end) return { start, end };
  }
  return null;
}

/** A site sampled in a round, without some of what the schedule names. */
export interface SiteGap {
  siteId: string;
  /** The days it was sampled in the round. */
  dates: string[];
  /** The scheduled parameters with no result. */
  missing: string[];
  /** A lab's results have come for its samples: what's missing was left off (else the lab may still be to report). */
  labIn: boolean;
}

export interface RoundGaps {
  schedule: MonitoringSchedule;
  start: string;
  end: string;
  /** Scheduled sites with no sample in the round. */
  notSampled: string[];
  /** Sites sampled, missing some of what's scheduled. */
  incomplete: SiteGap[];
  /** Sites with everything scheduled. */
  complete: string[];
  /** Accepted as it is (the schedule's `accepted`). */
  accepted: boolean;
}

/**
 * What a round of a schedule is missing: the sites not sampled and, at the sites that were, the scheduled parameters
 * with no result – a value typed in, a field reading or a calculated value counts; a result left out after a QA check
 * was still reported. `isLab` says whether a result came in a lab's file.
 */
export function roundGaps(sch: MonitoringSchedule, round: { start: string; end: string }, samples: Sample[], resultsOf: (sampleId: string) => Result[], isLab: (r: Result) => boolean): RoundGaps {
  const out: RoundGaps = { schedule: sch, start: round.start, end: round.end, notSampled: [], incomplete: [], complete: [], accepted: !!sch.accepted?.includes(round.start) };
  for (const siteId of sch.siteIds) {
    const mine = samples.filter((s) => s.siteId === siteId && s.date.slice(0, 10) >= round.start && s.date.slice(0, 10) <= round.end);
    if (!mine.length) {
      out.notSampled.push(siteId);
      continue;
    }
    const results = mine.flatMap((s) => resultsOf(s.id));
    const reported = new Set(results.map((r) => r.parameterId));
    const missing = sch.parameterIds.filter((id) => !reported.has(id));
    if (missing.length) out.incomplete.push({ siteId, dates: [...new Set(mine.map((s) => s.date.slice(0, 10)))].sort(), missing, labIn: results.some(isLab) });
    else out.complete.push(siteId);
  }
  return out;
}

/** Whether a result came in a lab's file (not from a phone in the field, typed in, or calculated). */
export function fromLab(imports: Array<Pick<ImportBatch, 'id' | 'kind'>>): (r: Result) => boolean {
  const kinds = new Map(imports.map((b) => [b.id, b.kind]));
  return (r) => !!r.importId && kinds.get(r.importId) !== 'field';
}

/**
 * What a round is missing, in words: "Not sampled: GW1", "DS1 (9 Oct 2026): no result for Dissolved Zinc, TSS". For a
 * site sampled but with nothing from the lab yet, the line says so.
 */
export function gapLines(g: RoundGaps, siteCode: (id: string) => string, paramName: (id: string) => string): string[] {
  const out: string[] = [];
  if (g.notSampled.length) out.push(`Not sampled: ${g.notSampled.map(siteCode).join(', ')}`);
  for (const s of g.incomplete) {
    const names = s.missing.map(paramName);
    const what = names.length > 6 ? `${names.slice(0, 5).join(', ')} and ${names.length - 5} more` : names.join(', ');
    out.push(`${siteCode(s.siteId)} (${s.dates.map((d) => formatDate(d)).join(', ')}): no result for ${what}${s.labIn ? '' : ' – nothing from the lab yet'}`);
  }
  return out;
}

/** Whether a round has anything to say: a site not sampled, or something scheduled not reported. */
export const hasGaps = (g: RoundGaps): boolean => g.notSampled.length > 0 || g.incomplete.length > 0;

/**
 * The rounds to look at for gaps now: each active schedule's current round and the one before, where sampling has
 * begun (a round nobody has sampled yet is the calendar's business, not a gap).
 */
export function recentGaps(schedules: MonitoringSchedule[], samples: Sample[], resultsOf: (sampleId: string) => Result[], isLab: (r: Result) => boolean, today = todayStr()): RoundGaps[] {
  const out: RoundGaps[] = [];
  for (const sch of schedules) {
    if (!sch.active || !sch.siteIds.length) continue;
    const now = roundOf(sch, today) ?? (sch.endDate && today > sch.endDate ? roundOf(sch, sch.endDate) : null);
    if (!now) continue;
    const before = roundOf(sch, addDays(now.start, -1));
    for (const round of [now, before]) {
      if (!round) continue;
      const g = roundGaps(sch, round, samples, resultsOf, isLab);
      if (g.complete.length + g.incomplete.length > 0 && hasGaps(g)) out.push(g);
    }
  }
  return out;
}

// ------------------------------------------------------------ reporting obligations

export interface ObligationPeriod {
  index: number;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  submission?: ReportSubmission;
  status: 'submitted' | 'overdue' | 'due-soon' | 'upcoming' | 'in-progress';
  daysToDue: number;
}

export function obligationPeriod(ob: ReportObligation, k: number, today = todayStr()): ObligationPeriod {
  const step = ob.unit === 'year' ? 12 * ob.every : ob.every;
  const periodStart = addMonths(ob.firstPeriodStart, k * step);
  const periodEnd = addMonthsEom(ob.firstPeriodEnd, k * step);
  const dueDate = addMonthsEom(ob.firstDueDate, k * step);
  const submission = ob.submissions.find((s) => s.periodEnd === periodEnd);
  const daysToDue = daysBetween(today, dueDate);
  let status: ObligationPeriod['status'];
  if (submission) status = 'submitted';
  else if (daysToDue < 0) status = 'overdue';
  else if (periodEnd >= today) status = 'in-progress';
  else if (daysToDue <= 30) status = 'due-soon';
  else status = 'upcoming';
  return { index: k, periodStart, periodEnd, dueDate, submission, status, daysToDue };
}

/** Periods from the first up to the first one whose period hasn't ended yet (max `limit`). */
export function obligationPeriods(ob: ReportObligation, today = todayStr(), limit = 60): ObligationPeriod[] {
  const out: ObligationPeriod[] = [];
  if (!ob.every) return [obligationPeriod(ob, 0, today)];
  for (let k = 0; k < limit; k++) {
    const p = obligationPeriod(ob, k, today);
    out.push(p);
    if (p.periodEnd >= today) break;
  }
  return out;
}

/** The next report that needs attention: earliest unsubmitted period whose due date is soonest. */
export function nextObligation(ob: ReportObligation, today = todayStr()): ObligationPeriod | null {
  const periods = obligationPeriods(ob, today);
  const open = periods.filter((p) => p.status !== 'submitted');
  if (!open.length) {
    if (!ob.every) return null;
    return obligationPeriod(ob, periods.length, today);
  }
  return open[0];
}

/** Recent reporting periods of each obligation (newest first), as presets for period pickers. */
export function obligationPresets(obligations: ReportObligation[], today = todayStr()) {
  const out: Array<PeriodChoice & { obligationId: string; index: number }> = [];
  for (const o of obligations) {
    for (const p of obligationPeriods(o, today).slice(-4).reverse()) {
      const st = OBLIGATION_STATUS[p.status];
      out.push({
        key: `obl:${o.id}:${p.index}`,
        start: p.periodStart,
        end: p.periodEnd,
        label: `${o.name}: ${formatDate(p.periodStart)} – ${formatDate(p.periodEnd)}`,
        obligationId: o.id,
        index: p.index,
        group: o.name,
        short: `${formatDate(p.periodStart)} – ${formatDate(p.periodEnd)}`,
        note: p.status === 'submitted' || p.status === 'in-progress' ? st.label : p.status === 'overdue' ? `Overdue – due ${formatDate(p.dueDate)}` : `Due ${formatDate(p.dueDate)}`,
        noteColor: st.color,
      });
    }
  }
  return out;
}

/** The report to prepare next: of the active obligations, the unsubmitted period (already ended) that is due soonest. */
/** Earliest due first; for the same due date, the period that started first (an annual report before a quarterly one). */
export const byDueDate = (a: ObligationPeriod, b: ObligationPeriod) => a.dueDate.localeCompare(b.dueDate) || a.periodStart.localeCompare(b.periodStart);

export function nextDueReport(obligations: ReportObligation[], today = todayStr()): { obligation: ReportObligation; period: ObligationPeriod } | null {
  const due = obligations
    .filter((o) => o.active)
    .map((o) => ({ obligation: o, period: nextObligation(o, today) }))
    .filter((x): x is { obligation: ReportObligation; period: ObligationPeriod } => !!x.period && x.period.status !== 'in-progress')
    .sort((a, b) => byDueDate(a.period, b.period) || a.obligation.name.localeCompare(b.obligation.name));
  return due[0] ?? null;
}

export const OBLIGATION_STATUS: Record<ObligationPeriod['status'], { label: string; color: string }> = {
  submitted: { label: 'Submitted', color: 'green' },
  overdue: { label: 'Overdue', color: 'red' },
  'due-soon': { label: 'Due soon', color: 'orange' },
  'in-progress': { label: 'Period in progress', color: 'blue' },
  upcoming: { label: 'Upcoming', color: 'gray' },
};

// ------------------------------------------------------------ calendar export

function icsDate(d: string) {
  return d.slice(0, 10).replace(/-/g, '');
}
function icsEscape(s: string) {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

export function buildIcs(events: Array<{ uid: string; date: string; title: string; description?: string }>): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//EnviroDB//Deadlines//EN', 'CALSCALE:GREGORIAN'];
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}@envirodb`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDate(e.date)}`,
      `DTEND;VALUE=DATE:${icsDate(addDays(e.date, 1))}`,
      `SUMMARY:${icsEscape(e.title)}`,
      ...(e.description ? [`DESCRIPTION:${icsEscape(e.description)}`] : []),
      'BEGIN:VALARM',
      'TRIGGER:-P7D',
      'ACTION:DISPLAY',
      `DESCRIPTION:${icsEscape(e.title)}`,
      'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
