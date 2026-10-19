// The compliance register: every condition of the project's consents, what EnviroDB can tell about each over a
// period – its limits and triggers, its sampling, its reports – and the grade given (council-style: full compliance,
// low risk, moderate or significant non-compliance) with the reasoning. EnviroDB suggests; a person grades.

import type { ComplianceGrade, ConditionAssessment, ConsentCondition, MonitoringSchedule } from '../db/types';
import type { ProjectBundle } from './analysis';
import { evaluateAll, isLimitLevel } from './analysis';
import { addDays, dayOf, formatDate, todayStr } from './dates';
import { obligationPeriods, scheduleStep } from './schedule';

export const GRADE_TEXT: Record<ComplianceGrade, string> = {
  full: 'Full compliance',
  low: 'Low risk non-compliance',
  moderate: 'Moderate non-compliance',
  significant: 'Significant non-compliance',
  na: 'Not applicable',
};
export const GRADE_COLOR: Record<ComplianceGrade, string> = { full: 'teal', low: 'yellow', moderate: 'orange', significant: 'red', na: 'gray' };
export const GRADE_ORDER: ComplianceGrade[] = ['na', 'full', 'low', 'moderate', 'significant'];

export const KIND_TEXT: Record<ConsentCondition['kind'], string> = {
  limit: 'Limits & triggers',
  monitoring: 'Monitoring',
  reporting: 'Reporting',
  notification: 'Notification',
  management: 'Management',
  administrative: 'Administrative',
  other: 'Other',
};

export interface AutoStatus {
  /** What EnviroDB found: complied, not complied, something to check, no data, or nothing it can assess. */
  status: 'complied' | 'not-complied' | 'check' | 'no-data' | 'pending' | 'manual';
  lines: string[];
  /** The grade it suggests (a person decides). */
  suggested?: ComplianceGrade;
}

/** Sampling rounds of a schedule that fall in a period, and the sites missed in each. */
function scheduleRounds(sch: MonitoringSchedule, b: Pick<ProjectBundle, 'samples' | 'index'>, start: string, end: string) {
  const rounds: Array<{ start: string; end: string; missed: string[] }> = [];
  for (let k = 0; k < 5000; k++) {
    const ps = scheduleStep(sch.startDate, k, sch.every, sch.unit);
    if (ps > end || (sch.endDate && ps > sch.endDate)) break;
    const pe = addDays(scheduleStep(sch.startDate, k + 1, sch.every, sch.unit), -1);
    if (ps < start || pe > end) continue;
    const missed = sch.siteIds.filter(
      (sid) =>
        !b.samples.some((s) => {
          if (s.siteId !== sid || dayOf(s.date) < ps || dayOf(s.date) > pe) return false;
          if (!sch.parameterIds.length) return true;
          return (b.index.bySample.get(s.id) ?? []).some((r) => sch.parameterIds.includes(r.parameterId));
        }),
    );
    rounds.push({ start: ps, end: pe, missed });
  }
  return rounds;
}

/** What EnviroDB can tell about a condition over a period. */
export function autoStatus(c: ConsentCondition, b: ProjectBundle, start: string, end: string, today = todayStr()): AutoStatus {
  const lines: string[] = [];
  const found: Array<AutoStatus['status']> = [];
  const suggest: ComplianceGrade[] = [];
  const code = (id: string) => b.siteMap.get(id)?.code ?? '?';

  // limits and triggers
  const rules = b.rules.filter((r) => c.ruleIds?.includes(r.id) && r.active);
  if (rules.length) {
    for (const ev of evaluateAll(b, start, end, rules)) {
      const limit = isLimitLevel(ev.rule.level);
      if (ev.status === 'exceeded') {
        const n = ev.exceedances.length;
        const when = ev.exceedances.slice(0, 4).map((x) => `${code(x.siteId)} ${formatDate(x.date)}`).join(', ');
        lines.push(`${ev.rule.name}: ${limit ? 'exceeded' : 'trigger exceeded'} ${n === 1 ? 'once' : `${n} times`} (${when}${n > 4 ? ' …' : ''})${limit ? '' : ' – check the response required was carried out'}.`);
        found.push(limit ? 'not-complied' : 'check');
        // a person decides whether it was significant (the effects, not just the count)
        if (limit) suggest.push('moderate');
      } else if (ev.status === 'inconclusive') {
        lines.push(`${ev.rule.name}: ${ev.inconclusive.length} result${ev.inconclusive.length === 1 ? '' : 's'} with the detection limit above the limit – compliance can’t be confirmed.`);
        found.push('check');
      } else if (ev.status === 'no-data') {
        lines.push(`${ev.rule.name}: no results in the period.`);
        found.push('no-data');
      } else {
        lines.push(`${ev.rule.name}: complied (${ev.summary}).`);
        found.push('complied');
      }
    }
  }

  // sampling
  for (const sch of b.schedules.filter((s) => c.scheduleIds?.includes(s.id) && s.active)) {
    const rounds = scheduleRounds(sch, b, start, end);
    if (!rounds.length) continue;
    const required = rounds.length * sch.siteIds.length;
    const missed = rounds.flatMap((r) => r.missed.map((sid) => `${code(sid)} ${formatDate(r.start, { format: 'D MMM YYYY' }).replace(/^\d+ /, '')}`));
    if (missed.length) {
      lines.push(`${sch.name}: ${missed.length} of ${required} samples not taken (${missed.slice(0, 5).join(', ')}${missed.length > 5 ? ' …' : ''}).`);
      found.push('not-complied');
      suggest.push('low');
    } else {
      lines.push(`${sch.name}: all ${required} samples taken.`);
      found.push('complied');
    }
  }

  // reports
  for (const ob of b.obligations.filter((o) => c.obligationIds?.includes(o.id) && o.active)) {
    const due = obligationPeriods(ob, today, 200).filter((p) => p.dueDate >= start && p.dueDate <= end);
    for (const p of due) {
      const what = `${ob.name} (${formatDate(p.periodStart)} – ${formatDate(p.periodEnd)})`;
      if (p.submission) {
        const late = Math.round((Date.parse(p.submission.submittedOn) - Date.parse(p.dueDate)) / 86400000);
        if (late > 0) {
          lines.push(`${what}: sent ${formatDate(p.submission.submittedOn)}, ${late} day${late === 1 ? '' : 's'} late (due ${formatDate(p.dueDate)}).`);
          found.push('not-complied');
          suggest.push('low');
        } else {
          lines.push(`${what}: sent ${formatDate(p.submission.submittedOn)} (due ${formatDate(p.dueDate)}).`);
          found.push('complied');
        }
      } else if (p.dueDate < today) {
        lines.push(`${what}: not sent – due ${formatDate(p.dueDate)}.`);
        found.push('not-complied');
        suggest.push('low');
      } else {
        lines.push(`${what}: due ${formatDate(p.dueDate)}.`);
        found.push('pending');
      }
    }
  }

  if (!found.length) {
    if (c.ruleIds?.length || c.scheduleIds?.length || c.obligationIds?.length) return { status: 'no-data', lines: lines.length ? lines : ['Nothing due in the period.'] };
    return { status: 'manual', lines: c.evidence ? [`Shown by: ${c.evidence}`] : [] };
  }
  const status: AutoStatus['status'] = found.includes('not-complied') ? 'not-complied' : found.includes('check') ? 'check' : found.includes('pending') ? 'pending' : found.every((f) => f === 'no-data') ? 'no-data' : 'complied';
  const suggested = status === 'complied' ? 'full' : status === 'not-complied' ? suggest.reduce((w, g) => (GRADE_ORDER.indexOf(g) > GRADE_ORDER.indexOf(w) ? g : w), 'low' as ComplianceGrade) : undefined;
  return { status, lines, suggested };
}

export interface RegisterRow {
  condition: ConsentCondition;
  auto: AutoStatus;
  assessment?: ConditionAssessment;
  /** The grade that stands: given, or full compliance worked out by EnviroDB (marked `auto`). */
  grade?: ComplianceGrade;
  auto_?: boolean;
}

export const assessmentId = (conditionId: string, start: string, end: string) => `${conditionId}|${start}|${end}`;

/** The register over a period: each active condition with what EnviroDB found and the grade given. */
export function registerRows(conditions: ConsentCondition[], assessments: ConditionAssessment[], b: ProjectBundle, start: string, end: string, today = todayStr()): RegisterRow[] {
  const byId = new Map(assessments.map((a) => [a.id, a]));
  return conditions
    .filter((c) => c.active)
    .sort((a, c) => a.order - c.order || compareRefs(a.ref, c.ref))
    .map((condition) => {
      const auto = autoStatus(condition, b, start, end, today);
      const assessment = byId.get(assessmentId(condition.id, start, end));
      const grade = assessment?.grade ?? (auto.status === 'complied' ? 'full' : undefined);
      return { condition, auto, assessment, grade, auto_: !assessment && !!grade };
    });
}

/**
 * The overall grade: the worst of the conditions (not applicable ones aside). Until every condition is graded it's
 * provisional, and a condition not complied with but not yet graded counts at the grade EnviroDB suggests.
 */
export function overallGrade(rows: RegisterRow[]): { grade?: ComplianceGrade; graded: number; toGrade: number; provisional: boolean } {
  const graded = rows.filter((r) => r.grade && r.grade !== 'na');
  const toGrade = rows.filter((r) => !r.grade).length;
  const counted = [...graded.map((r) => r.grade!), ...rows.filter((r) => !r.grade && r.auto.suggested).map((r) => r.auto.suggested!)];
  const grade = counted.reduce<ComplianceGrade | undefined>((w, g) => (!w || GRADE_ORDER.indexOf(g) > GRADE_ORDER.indexOf(w) ? g : w), undefined);
  return { grade, graded: graded.length, toGrade, provisional: toGrade > 0 };
}

/** Condition numbers in their natural order: 2 before 10, 7(a) before 7(b). */
export function compareRefs(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

// ------------------------------------------------------------------ making the register

/** A condition's number as written in a rule ("Condition 8(a)" → "8(a)"). */
export const refOf = (s?: string) => (s ?? '').replace(/^\s*(conditions?|cond\.?|cl\.?|clause)\s*/i, '').trim();

/**
 * Conditions read from a consent's text: each starts on a line with its number ("7.", "7(b)", "Condition 12 –"),
 * and runs to the next. Sub-clauses on lines of their own ("(a) …") stay with their condition.
 */
export function parseConditions(text: string): Array<{ ref: string; title: string; text: string }> {
  const out: Array<{ ref: string; title: string; text: string }> = [];
  const head = /^\s*(?:condition\s+)?(\d{1,3}[A-Za-z]?(?:\s*\([a-z0-9]{1,4}\))*)\s*[.):–-]?\s+(\S.*)$/i;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(head);
    // a new condition: its number, then the wording (not a bare figure such as "100 g/m³" mid-text)
    if (m && !/^\d+(\.\d+)?\s*(g|mg|µg|m|%|l\/s|cfu|ntu)\b/i.test(line)) {
      out.push({ ref: m[1].replace(/\s+/g, ''), title: '', text: m[2] });
      continue;
    }
    if (out.length) out[out.length - 1].text += `\n${line}`;
  }
  for (const c of out) {
    const first = c.text.replace(/\s+/g, ' ').trim();
    const sentence = first.match(/^(.{20,160}?[.;:])(\s|$)/)?.[1] ?? first;
    c.title = sentence.length > 160 ? `${sentence.slice(0, 157)}…` : sentence;
  }
  return out;
}

/** Guess what kind of condition a wording is. */
export function guessKind(text: string): ConsentCondition['kind'] {
  const t = text.toLowerCase();
  if (/\b(shall not exceed|must not exceed|no greater than|not more than|limit|concentration|g\/m|mg\/l|percentile|trigger)\b/.test(t)) return 'limit';
  if (/\b(report|submit|forward|provide .* to the council|annual)\b/.test(t)) return 'reporting';
  if (/\b(notify|inform|advise) .*council|notification\b/.test(t)) return 'notification';
  if (/\b(sample|monitor|measure|test)\w*\b/.test(t)) return 'monitoring';
  if (/\b(management plan|maintain|operate|practicable)\b/.test(t)) return 'management';
  if (/\b(lapse|expire|review|charges?|administration|pursuant)\b/.test(t)) return 'administrative';
  return 'other';
}

/** Rules whose condition number matches a condition's. */
export function rulesForRef(ref: string, rules: ProjectBundle['rules']): string[] {
  const r = refOf(ref).toLowerCase();
  if (!r) return [];
  return rules.filter((x) => {
    const rr = refOf(x.condition).toLowerCase();
    return rr === r || rr.startsWith(`${r}(`);
  }).map((x) => x.id);
}

