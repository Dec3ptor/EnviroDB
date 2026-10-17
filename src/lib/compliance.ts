import type { GuidelineSet, GuidelineValue, NdHandling, Operator, Parameter, Project, Qualifier, Result, Rule, Site } from '../db/types';
import type { DataIndex } from './dataIndex';
import { resultsFor } from './dataIndex';
import { addDays, dayOf, daysBetween, formatDate, reportingYear } from './dates';
import { compareResult, describeLimit, limitFor, toInterval, verdict, verdictOutside, type Verdict } from './guidelines';
import { computeStat, statLabel, type PercentileMethod } from './stats';
import { convert, unitLabel } from './units';
import { fmtNum, fmtResult, statValue } from './values';

export interface Exceedance {
  key: string; // stable id for notes
  ruleId: string;
  siteId: string;
  parameterId: string;
  date: string;
  value: number | null;
  qualifier: Qualifier;
  unit: string;
  limitText: string;
  detail: string;
  inconclusive?: boolean;
  resultId?: string;
}

export type RuleStatus = 'compliant' | 'exceeded' | 'inconclusive' | 'no-data';

export interface RuleEvaluation {
  rule: Rule;
  status: RuleStatus;
  assessed: number;
  exceedances: Exceedance[];
  inconclusive: Exceedance[];
  summary: string;
  description: string;
}

export interface EvalContext {
  project: Project;
  index: DataIndex;
  sites: Site[];
  params: Map<string, Parameter>;
  guidelineSets: Map<string, GuidelineSet>;
  start: string;
  end: string;
}

const OP_TEXT: Record<Operator, string> = { '>': '>', '>=': '≥', '<': '<', '<=': '≤', outside: 'outside' };

export function siteLabel(sites: Site[] | Map<string, Site>, id: string): string {
  const s = sites instanceof Map ? sites.get(id) : sites.find((x) => x.id === id);
  return s ? s.code : '?';
}

function ruleUnit(rule: Rule, param?: Parameter): string {
  return rule.unit || param?.unit || '';
}

export function thresholdText(rule: Rule, unit: string): string {
  const u = unitLabel(unit);
  if (rule.operator === 'outside') return `outside ${fmtNum(rule.min)}–${fmtNum(rule.max)} ${u}`.trim();
  return `${OP_TEXT[rule.operator]} ${fmtNum(rule.value)}${rule.changeType === 'percent' ? '%' : ` ${u}`}`.trim();
}

// ------------------------------------------------------------ limits taken from a guideline set

/** Rule kinds whose limit can be a guideline set's value for their parameter. */
export const GUIDELINE_LIMIT_KINDS: ReadonlySet<Rule['kind']> = new Set(['threshold', 'statistic', 'consecutive']);

/** The guideline value a rule's limit comes from, when it takes it from a set (and the set has one for its parameter). */
export function guidelineLimitValue(rule: Rule, sets?: Map<string, GuidelineSet>): GuidelineValue | undefined {
  if (!rule.limitSetId || !rule.parameterId || !GUIDELINE_LIMIT_KINDS.has(rule.kind)) return undefined;
  const gv = sets?.get(rule.limitSetId)?.values.find((v) => v.parameterId === rule.parameterId);
  return gv && (gv.min !== undefined || gv.max !== undefined) ? gv : undefined;
}

/**
 * A rule that takes its limit from a guideline set, with that value filled in: the operator, value or range, in the
 * rule's unit (or the guideline's, when they can't be converted). Hardness modification only for each result's own
 * test (limits and consecutive results) and only for hardness-dependent values. Other rules come back as they are.
 */
export function withGuidelineLimit(rule: Rule, sets?: Map<string, GuidelineSet>): Rule {
  const gv = guidelineLimitValue(rule, sets);
  if (!gv) return rule;
  const unit = rule.unit && convert(1, gv.unit, rule.unit) !== null ? rule.unit : gv.unit;
  const c = (x?: number) => (x === undefined ? undefined : convert(x, gv.unit, unit) ?? undefined);
  const hardnessAdjust = !!rule.hardnessAdjust && !!gv.hardness && rule.kind !== 'statistic';
  const base = { ...rule, unit, hardnessAdjust, value: undefined, min: undefined, max: undefined };
  if (gv.min !== undefined && gv.max !== undefined) return { ...base, operator: 'outside', min: c(gv.min), max: c(gv.max) };
  if (gv.max !== undefined) return { ...base, operator: gv.op ?? '>', value: c(gv.max) };
  return { ...base, operator: '<', value: c(gv.min) };
}

/** " (ANZG FW 95%)" after a limit taken from a guideline set; "" otherwise. */
export function limitSource(rule: Rule, sets?: Map<string, GuidelineSet>): string {
  const set = guidelineLimitValue(rule, sets) ? sets?.get(rule.limitSetId!) : undefined;
  if (!set) return '';
  return ` (${set.shortName}${rule.hardnessAdjust ? ', hardness-modified' : ''})`;
}

/** The parameters a rule covers: its parameter, or for a guideline rule the analytes chosen (or every analyte in its set). */
export function ruleParamIds(rule: Rule, sets?: Map<string, GuidelineSet>): string[] {
  if (rule.kind !== 'guideline') return rule.parameterId ? [rule.parameterId] : [];
  const inSet = (rule.guidelineSetId ? sets?.get(rule.guidelineSetId)?.values.map((v) => v.parameterId) : undefined) ?? [];
  return rule.parameterIds?.length ? rule.parameterIds.filter((id) => inSet.includes(id)) : inSet;
}

/**
 * Rules for tables and graphs of limits: a guideline rule that names its analytes becomes a limit for each of them,
 * at that analyte's value in the set; rules that take a limit from a set have it filled in.
 */
export function expandRules(rules: Rule[], sets?: Map<string, GuidelineSet>): Rule[] {
  const out: Rule[] = [];
  for (const r of rules) {
    if (r.kind !== 'guideline') out.push(withGuidelineLimit(r, sets));
    else if (r.parameterIds?.length && r.guidelineSetId)
      for (const pid of ruleParamIds(r, sets)) {
        const one = withGuidelineLimit({ ...r, id: `${r.id}|${pid}`, kind: 'threshold', parameterId: pid, limitSetId: r.guidelineSetId, guidelineSetId: undefined, parameterIds: undefined, unit: undefined }, sets);
        if (one.limitSetId && guidelineLimitValue(one, sets)) out.push(one);
      }
  }
  return out;
}

/** "Dissolved copper, Dissolved lead and Dissolved zinc" – up to four names, then "and 3 more". */
function paramList(ids: string[], params: Map<string, Parameter>, joiner = 'and'): string {
  const names = ids.map((id) => params.get(id)?.name ?? id);
  if (names.length > 4) return `${names.slice(0, 3).join(', ')} ${joiner} ${names.length - 3} more`;
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} ${joiner} ${names[names.length - 1]}` : names.join('');
}

/** Human-readable statement of what a rule tests. */
export function describeRule(rule: Rule, params: Map<string, Parameter>, sites: Site[], sets?: Map<string, GuidelineSet>): string {
  rule = withGuidelineLimit(rule, sets);
  const p = rule.parameterId ? params.get(rule.parameterId) : undefined;
  const pname = p?.name ?? rule.parameterId ?? '';
  const unit = ruleUnit(rule, p);
  const where = rule.siteIds.length ? ` at ${rule.siteIds.map((id) => siteLabel(sites, id)).join(', ')}` : ' at all sites';
  const from = limitSource(rule, sets);
  switch (rule.kind) {
    case 'threshold':
      return `${pname} ${thresholdText(rule, unit)}${from}${where}`;
    case 'statistic': {
      const stat = statLabel(rule.statistic ?? 'mean', rule.percentile);
      const win =
        rule.window === 'rolling-days' ? `rolling ${rule.windowSize ?? 365}-day` : rule.window === 'rolling-samples' ? `rolling ${rule.windowSize ?? 12}-sample` : rule.window === 'year' ? 'annual' : 'period';
      return `${win} ${stat} of ${pname} ${thresholdText(rule, unit)}${from}${where}`;
    }
    case 'change': {
      const ref = rule.referenceSiteId ? siteLabel(sites, rule.referenceSiteId) : 'reference';
      const ct = rule.changeType === 'percent' ? 'increase' : rule.changeType === 'abs-diff' ? 'change' : 'increase';
      return `${pname} ${ct} relative to ${ref} ${thresholdText(rule, unit)}${where}`;
    }
    case 'consecutive':
      return `${rule.consecutive ?? 2} consecutive ${pname} results ${thresholdText(rule, unit)}${from}${where}`;
    case 'guideline': {
      const set = rule.guidelineSetId ? sets?.get(rule.guidelineSetId) : undefined;
      const only = rule.parameterIds?.length ? `${paramList(rule.parameterIds, params)} results` : 'Results';
      return `${only} exceeding ${set?.name ?? 'guideline'}${rule.hardnessAdjust ? ' (hardness-modified)' : ''}${where}`;
    }
  }
}

/** What counts as a breach, phrased to follow "Exceeded when:". */
export function exceededWhen(rule: Rule, params: Map<string, Parameter>, sites: Site[], sets?: Map<string, GuidelineSet>): string {
  if (rule.kind !== 'guideline') return describeRule(rule, params, sites, sets);
  const set = rule.guidelineSetId ? sets?.get(rule.guidelineSetId) : undefined;
  const where = rule.siteIds.length ? rule.siteIds.map((id) => siteLabel(sites, id)).join(', ') : 'any site';
  const only = rule.parameterIds?.length ? `${paramList(rule.parameterIds, params, 'or')} ` : '';
  return `a ${only}result at ${where} is above its ${set?.name ?? 'guideline'} value${rule.hardnessAdjust ? ' (hardness-modified)' : ''}`;
}

function sitesFor(rule: Rule, ctx: EvalContext): string[] {
  const ids = rule.siteIds.length ? rule.siteIds : ctx.sites.map((s) => s.id);
  return rule.kind === 'change' ? ids.filter((id) => id !== rule.referenceSiteId) : ids;
}

function window(rule: Rule, ctx: EvalContext): { start: string; end: string } {
  let start = ctx.start, end = ctx.end;
  if (rule.effectiveFrom && rule.effectiveFrom > start) start = rule.effectiveFrom;
  if (rule.effectiveTo && rule.effectiveTo < end) end = rule.effectiveTo;
  return { start, end };
}

function testValue(rule: Rule, iv: ReturnType<typeof toInterval>): Verdict {
  if (rule.operator === 'outside') return verdictOutside(iv, rule.min, rule.max);
  if (rule.value === undefined) return 'ok';
  return verdict(iv, rule.operator, rule.value);
}

function exKey(...parts: string[]) {
  return parts.join('|');
}

export function evaluateRule(rule: Rule, ctx: EvalContext): RuleEvaluation {
  rule = withGuidelineLimit(rule, ctx.guidelineSets);
  const description = describeRule(rule, ctx.params, ctx.sites, ctx.guidelineSets);
  const exceedances: Exceedance[] = [];
  const inconclusive: Exceedance[] = [];
  let assessed = 0;
  const { start, end } = window(rule, ctx);
  const p = rule.parameterId ? ctx.params.get(rule.parameterId) : undefined;
  const unit = ruleUnit(rule, p);
  const nd: NdHandling = ctx.project.ndHandling ?? 'dl';
  const pm: PercentileMethod = ctx.project.percentileMethod ?? 'excel';
  const siteIds = sitesFor(rule, ctx);
  const from = limitSource(rule, ctx.guidelineSets);
  const limitText = rule.kind === 'guideline' ? '' : `${thresholdText(rule, unit)}${from}`;
  // a hardness-dependent guideline limit, modified for each sample's hardness
  const hardGv = rule.hardnessAdjust ? guidelineLimitValue(rule, ctx.guidelineSets) : undefined;
  const ruleAt = (r: Result): { rule: Rule; limitText: string } => {
    if (!hardGv?.hardness) return { rule, limitText };
    const lim = limitFor(hardGv, p, { hardness: ctx.index.hardness.get(r.sampleId), adjust: true });
    const v = lim.adjusted && lim.max !== undefined ? convert(lim.max, hardGv.unit, unit) : null;
    if (v === null) return { rule, limitText };
    const at: Rule = rule.operator === 'outside' ? { ...rule, max: v } : { ...rule, value: v };
    return { rule: at, limitText: `${thresholdText(at, unit)} (${ctx.guidelineSets.get(rule.limitSetId!)?.shortName ?? 'guideline'} HMTV at ${fmtNum(lim.hardness)} mg/L hardness)` };
  };

  const push = (vd: Verdict, ex: Exceedance) => {
    if (vd === 'exceed') exceedances.push(ex);
    else if (vd === 'inconclusive') inconclusive.push({ ...ex, inconclusive: true });
  };

  if (rule.kind === 'threshold' && rule.parameterId) {
    for (const r of resultsFor(ctx.index, rule.parameterId, siteIds, start, end)) {
      const v = convert(r.value, r.unit, unit);
      if (v === null) continue;
      assessed++;
      const at = ruleAt(r);
      const vd = testValue(at.rule, toInterval(v, r.qualifier));
      push(vd, {
        key: exKey(r.siteId, r.date, r.parameterId),
        ruleId: rule.id, siteId: r.siteId, parameterId: r.parameterId, date: r.date, value: v, qualifier: r.qualifier, unit, limitText: at.limitText,
        detail: vd === 'inconclusive' ? `Detection limit (${fmtResult(v, r.qualifier)} ${unitLabel(unit)}) is above the limit` : `${fmtResult(v, r.qualifier)} ${unitLabel(unit)}`,
        resultId: r.id,
      });
    }
  }

  if (rule.kind === 'consecutive' && rule.parameterId) {
    const n = Math.max(2, rule.consecutive ?? 2);
    for (const sid of siteIds) {
      // include earlier data so a run that started before the period is detected
      const list = resultsFor(ctx.index, rule.parameterId, [sid], undefined, end);
      let run = 0;
      for (const r of list) {
        const v = convert(r.value, r.unit, unit);
        if (v === null) continue;
        const at = ruleAt(r);
        const vd = testValue(at.rule, toInterval(v, r.qualifier));
        run = vd === 'exceed' ? run + 1 : 0;
        if (dayOf(r.date) < start) continue;
        assessed++;
        if (run >= n) {
          exceedances.push({
            key: exKey(sid, r.date, r.parameterId, 'run'),
            ruleId: rule.id, siteId: sid, parameterId: r.parameterId, date: r.date, value: v, qualifier: r.qualifier, unit, limitText: at.limitText,
            detail: `${run} consecutive results ${at.limitText} (latest ${fmtResult(v, r.qualifier)} ${unitLabel(unit)})`,
            resultId: r.id,
          });
        }
      }
    }
  }

  if (rule.kind === 'statistic' && rule.parameterId) {
    const stat = rule.statistic ?? 'mean';
    const minN = rule.minSamples ?? 1;
    for (const sid of siteIds) {
      const windows: Array<{ s: string; e: string; label: string }> = [];
      if (rule.window === 'year') {
        let ry = reportingYear(start, ctx.project.yearStartMonth || 1);
        while (ry.start <= end) {
          windows.push({ s: ry.start, e: ry.end, label: ry.label });
          ry = reportingYear(addDays(ry.end, 1), ctx.project.yearStartMonth || 1);
        }
      } else if (rule.window === 'rolling-days' || rule.window === 'rolling-samples') {
        for (const r of resultsFor(ctx.index, rule.parameterId, [sid], start, end)) {
          if (windows.some((w) => w.e === dayOf(r.date))) continue;
          const e = dayOf(r.date);
          const s = rule.window === 'rolling-days' ? addDays(e, -(rule.windowSize ?? 365) + 1) : '';
          windows.push({ s, e, label: formatDate(e) });
        }
      } else {
        windows.push({ s: start, e: end, label: 'period' });
      }
      for (const w of windows) {
        let list = resultsFor(ctx.index, rule.parameterId, [sid], w.s || undefined, w.e);
        if (rule.window === 'rolling-samples') list = list.slice(-(rule.windowSize ?? 12));
        const vals = list
          .map((r) => {
            const v = convert(r.value, r.unit, unit);
            return v === null ? null : statValue(v, r.qualifier, nd);
          })
          .filter((x): x is number => x !== null);
        if (vals.length < minN || !vals.length) continue;
        const sv = computeStat(stat, vals, rule.percentile ?? 95, pm);
        if (sv === null) continue;
        assessed++;
        const vd = testValue(rule, toInterval(sv, ''));
        push(vd, {
          key: exKey(sid, w.e, rule.parameterId, 'stat'),
          ruleId: rule.id, siteId: sid, parameterId: rule.parameterId, date: w.e, value: sv, qualifier: '', unit, limitText,
          detail: `${statLabel(stat, rule.percentile)} ${fmtNum(sv)} ${unitLabel(unit)} (n = ${vals.length}${w.label !== 'period' ? `, ${w.label}` : ''})`,
        });
      }
    }
  }

  if (rule.kind === 'change' && rule.parameterId && rule.referenceSiteId) {
    const refList = resultsFor(ctx.index, rule.parameterId, [rule.referenceSiteId], addDays(start, -(rule.pairingDays ?? 0)), addDays(end, rule.pairingDays ?? 0));
    for (const r of resultsFor(ctx.index, rule.parameterId, siteIds, start, end)) {
      // closest reference sample within the pairing window
      let best: Result | undefined;
      let bestGap = Infinity;
      for (const ref of refList) {
        const gap = Math.abs(daysBetween(ref.date, r.date));
        if (gap <= (rule.pairingDays ?? 0) && gap < bestGap) {
          best = ref;
          bestGap = gap;
        }
      }
      if (!best) continue;
      const a = convert(r.value, r.unit, unit), b = convert(best.value, best.unit, unit);
      if (a === null || b === null) continue;
      if (r.qualifier === '<' && best.qualifier === '<') {
        assessed++;
        continue;
      }
      const av = statValue(a, r.qualifier, nd)!, bv = statValue(b, best.qualifier, nd)!;
      let change: number;
      if (rule.changeType === 'percent') {
        if (bv === 0) continue;
        change = ((av - bv) / bv) * 100;
      } else if (rule.changeType === 'abs-diff') change = Math.abs(av - bv);
      else change = av - bv;
      assessed++;
      const vd = testValue(rule, toInterval(change, ''));
      const ref = siteLabel(ctx.sites, rule.referenceSiteId);
      const site = siteLabel(ctx.sites, r.siteId);
      push(vd, {
        key: exKey(r.siteId, r.date, r.parameterId, 'chg'),
        ruleId: rule.id, siteId: r.siteId, parameterId: r.parameterId, date: r.date, value: change, qualifier: '', unit: rule.changeType === 'percent' ? '%' : unit, limitText,
        detail: `${site} ${fmtResult(a, r.qualifier)} vs ${ref} ${fmtResult(b, best.qualifier)} ${unitLabel(unit)} → ${change >= 0 ? '+' : ''}${fmtNum(change)}${rule.changeType === 'percent' ? '%' : ` ${unitLabel(unit)}`}`,
        resultId: r.id,
      });
    }
  }

  if (rule.kind === 'guideline' && rule.guidelineSetId) {
    const set = ctx.guidelineSets.get(rule.guidelineSetId);
    if (set) {
      const only = rule.parameterIds?.length ? new Set(rule.parameterIds) : null;
      for (const gv of set.values) {
        if (only && !only.has(gv.parameterId)) continue;
        const param = ctx.params.get(gv.parameterId);
        for (const r of resultsFor(ctx.index, gv.parameterId, siteIds, start, end)) {
          const hit = compareResult(r, gv, set, param, ctx.index, !!rule.hardnessAdjust);
          if (!hit) continue;
          assessed++;
          const lim = describeLimit(hit.limitInResultUnit ?? {}, r.unit);
          push(hit.verdict, {
            key: exKey(r.siteId, r.date, r.parameterId, set.id),
            ruleId: rule.id, siteId: r.siteId, parameterId: r.parameterId, date: r.date, value: r.value, qualifier: r.qualifier, unit: r.unit,
            limitText: `${set.shortName}: ${lim}${hit.limit.adjusted ? ` (HMTV at ${fmtNum(hit.limit.hardness)} mg/L hardness)` : ''}`,
            detail: `${param?.name ?? r.parameterId} ${fmtResult(r.value, r.qualifier)} ${unitLabel(r.unit)} vs ${lim}${hit.limit.adjusted ? ' (hardness-modified)' : ''}`,
            resultId: r.id,
          });
        }
      }
    }
  }

  exceedances.sort((a, b) => (a.date < b.date ? -1 : 1));
  const status: RuleStatus = exceedances.length ? 'exceeded' : inconclusive.length ? 'inconclusive' : assessed ? 'compliant' : 'no-data';
  return { rule, status, assessed, exceedances, inconclusive, summary: summarise(status, assessed, exceedances, inconclusive, rule, ctx), description };
}

function summarise(status: RuleStatus, assessed: number, ex: Exceedance[], inc: Exceedance[], rule: Rule, ctx: EvalContext): string {
  const noun = rule.kind === 'statistic' ? `${statLabel(rule.statistic ?? 'mean', rule.percentile)} ${assessed === 1 ? 'value' : 'values'}` : assessed === 1 ? 'result' : 'results';
  if (status === 'no-data') return 'No data in period';
  if (status === 'compliant') return `Complied – ${assessed} ${noun} assessed`;
  if (status === 'inconclusive') return `${inc.length} result${inc.length === 1 ? '' : 's'} with detection limit above the limit; otherwise complied (${assessed} assessed)`;
  const worst = ex.reduce<Exceedance | null>((w, e) => (w === null || (e.value ?? -Infinity) > (w.value ?? -Infinity) ? e : w), null);
  const sitesHit = Array.from(new Set(ex.map((e) => siteLabel(ctx.sites, e.siteId)))).join(', ');
  return `${ex.length} of ${assessed} ${noun} exceeded (${sitesHit})${worst && rule.kind !== 'guideline' ? `; highest ${fmtNum(worst.value)}${worst.unit === '%' ? '%' : ` ${unitLabel(worst.unit)}`} on ${formatDate(worst.date)}` : ''}`;
}

export function evaluateRules(rules: Rule[], ctx: EvalContext): RuleEvaluation[] {
  return rules.filter((r) => r.active).sort((a, b) => a.order - b.order).map((r) => evaluateRule(r, ctx));
}

export const STATUS_META: Record<RuleStatus, { label: string; color: string }> = {
  compliant: { label: 'Complied', color: 'green' },
  exceeded: { label: 'Exceeded', color: 'red' },
  inconclusive: { label: 'Check DL', color: 'yellow' },
  'no-data': { label: 'No data', color: 'gray' },
};

export const LEVEL_COLORS: Record<string, string> = {
  Limit: 'red',
  'Trigger 2': 'orange',
  'Trigger 1': 'yellow',
  Trigger: 'orange',
  Alert: 'yellow',
  Target: 'blue',
  Info: 'gray',
};
