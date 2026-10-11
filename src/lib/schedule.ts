import type { MonitoringSchedule, ReportObligation, ReportSubmission, Result, Sample } from '../db/types';
import { addDays, addMonths, addMonthsEom, daysBetween, formatDate, todayStr } from './dates';

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
  const out: Array<{ key: string; start: string; end: string; label: string; obligationId: string; index: number }> = [];
  for (const o of obligations) {
    for (const p of obligationPeriods(o, today).slice(-4).reverse()) {
      out.push({ key: `obl:${o.id}:${p.index}`, start: p.periodStart, end: p.periodEnd, label: `${o.name}: ${formatDate(p.periodStart)} – ${formatDate(p.periodEnd)}`, obligationId: o.id, index: p.index });
    }
  }
  return out;
}

/** The report to prepare next: of the active obligations, the unsubmitted period (already ended) that is due soonest. */
export function nextDueReport(obligations: ReportObligation[], today = todayStr()): { obligation: ReportObligation; period: ObligationPeriod } | null {
  const due = obligations
    .filter((o) => o.active)
    .map((o) => ({ obligation: o, period: nextObligation(o, today) }))
    .filter((x): x is { obligation: ReportObligation; period: ObligationPeriod } => !!x.period && x.period.status !== 'in-progress')
    .sort((a, b) => (a.period.dueDate < b.period.dueDate ? -1 : 1));
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
