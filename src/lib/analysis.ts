import type { ExceedanceNote, GuidelineSet, MonitoringSchedule, Parameter, Project, QaRecord, ReportObligation, Result, Rule, Sample, Site } from '../db/types';
import type { DataIndex } from './dataIndex';
import { buildIndex, resultsFor } from './dataIndex';
import { evaluateRules, ruleParamIds, type EvalContext, type RuleEvaluation } from './compliance';
import { compareAll, describeLimit, type GuidelineHit } from './guidelines';
import { computeStat, percentile } from './stats';
import { convert, unitLabel } from './units';
import { fmtNum, statValue } from './values';

/** Everything the analysis/report code needs about a project. */
export interface ProjectBundle {
  project: Project;
  /** The monitoring sites (quality control sites are in `qc`). */
  sites: Site[];
  /** Every site, quality control ones included. */
  siteMap: Map<string, Site>;
  /** The monitoring samples (duplicates and blanks are in `qc`). */
  samples: Sample[];
  params: Parameter[];
  paramMap: Map<string, Parameter>;
  guidelineSets: GuidelineSet[];
  setMap: Map<string, GuidelineSet>;
  rules: Rule[];
  notes: ExceedanceNote[];
  schedules: MonitoringSchedule[];
  obligations: ReportObligation[];
  index: DataIndex;
  /** QA/QC: the quality control sites and samples (duplicates and blanks), and the decisions made. */
  qc?: { sites: Site[]; samples: Sample[]; records: QaRecord[] };
}

/**
 * The project limited to some sites, e.g. a groundwater report without the discharge. Results, rules and
 * schedules are trimmed to those sites. The reference site of a "change from upstream" rule keeps its results in
 * the index, so the rule can still be assessed, but it is not one of the sites shown.
 */
export function limitToSites<B extends ProjectBundle>(b: B, siteIds: string[]): B {
  const keep = new Set(siteIds);
  const sites = b.sites.filter((s) => keep.has(s.id));
  const rules = b.rules
    .filter((r) => !r.siteIds.length || r.siteIds.some((id) => keep.has(id)))
    .map((r) => (r.siteIds.length ? { ...r, siteIds: r.siteIds.filter((id) => keep.has(id)) } : r));
  const refs = new Set(rules.flatMap((r) => (r.kind === 'change' && r.referenceSiteId && !keep.has(r.referenceSiteId) ? [r.referenceSiteId] : [])));
  const indexed = b.samples.filter((s) => keep.has(s.siteId) || refs.has(s.siteId));
  return {
    ...b,
    sites,
    siteMap: new Map([...sites, ...(b.qc?.sites ?? [])].map((s) => [s.id, s])),
    samples: b.samples.filter((s) => keep.has(s.siteId)),
    rules,
    schedules: b.schedules.map((sch) => ({ ...sch, siteIds: sch.siteIds.filter((id) => keep.has(id)) })).filter((sch) => sch.siteIds.length),
    index: buildIndex(indexed, indexed.flatMap((s) => b.index.bySample.get(s.id) ?? []), [...sites, ...b.sites.filter((s) => refs.has(s.id))], b.params),
  };
}

export function evalContext(b: ProjectBundle, start: string, end: string): EvalContext {
  return { project: b.project, index: b.index, sites: b.sites, params: b.paramMap, guidelineSets: b.setMap, start, end };
}

export function evaluateAll(b: ProjectBundle, start: string, end: string, rules = b.rules): RuleEvaluation[] {
  return evaluateRules(rules, evalContext(b, start, end));
}

export interface CellFlag {
  kind: 'limit' | 'guideline' | 'check';
  messages: string[];
  /** A guideline highlight from the sets compared: the first of them exceeded (each set has its own colour). */
  set?: number;
  /** A consent trigger level was exceeded (amber, whatever sets were also exceeded). */
  trigger?: boolean;
}

/** Result id → highlight, combining consent rule exceedances (red) and guideline exceedances (amber). */
export function flagResults(b: ProjectBundle, evals: RuleEvaluation[], guidelineSetIds: string[], start: string, end: string): Map<string, CellFlag> {
  const flags = new Map<string, CellFlag>();
  const add = (id: string, kind: CellFlag['kind'], msg: string, from?: { set?: number; trigger?: boolean }) => {
    let f = flags.get(id);
    const rank = { limit: 3, guideline: 2, check: 1 };
    if (!f) flags.set(id, (f = { kind, messages: [msg] }));
    else {
      if (rank[kind] > rank[f.kind]) f.kind = kind;
      if (!f.messages.includes(msg)) f.messages.push(msg);
    }
    if (kind === 'guideline' && from?.trigger) f.trigger = true;
    if (kind === 'guideline' && from?.set !== undefined) f.set = Math.min(f.set ?? Infinity, from.set);
  };
  for (const ev of evals) {
    const isLimit = /limit/i.test(ev.rule.level);
    for (const ex of ev.exceedances) if (ex.resultId) add(ex.resultId, isLimit ? 'limit' : 'guideline', `${ev.rule.level}: ${ev.rule.name}${ex.limitText ? ` (${ex.limitText})` : ''}`, { trigger: !isLimit });
    for (const ex of ev.inconclusive) if (ex.resultId) add(ex.resultId, 'check', `${ev.rule.name}: detection limit above limit`);
  }
  const sets = guidelineSetIds.map((id) => b.setMap.get(id)).filter((s): s is GuidelineSet => !!s);
  if (sets.length) {
    for (const pid of b.index.paramIdsWithData) {
      if (!sets.some((s) => s.values.some((v) => v.parameterId === pid))) continue;
      const param = b.paramMap.get(pid);
      for (const r of resultsFor(b.index, pid, undefined, start, end)) {
        for (const hit of compareAll(r, sets, param, b.index, b.project.hardnessAdjust)) {
          if (hit.verdict === 'exceed') add(r.id, 'guideline', guidelineMessage(hit, r), { set: Math.max(0, sets.findIndex((s) => s.id === hit.setId)) });
          else if (hit.verdict === 'inconclusive') add(r.id, 'check', `${hit.setShort}: detection limit above guideline`);
        }
      }
    }
  }
  return flags;
}

export function guidelineMessage(hit: GuidelineHit, r: Result): string {
  const lim = describeLimit(hit.limitInResultUnit ?? {}, r.unit);
  return `Exceeds ${hit.setShort} (${lim}${hit.limit.adjusted ? `, hardness-modified at ${fmtNum(hit.limit.hardness)} mg/L` : ''})`;
}

// ------------------------------------------------------------ pivot (samples × parameters)

export interface PivotRow {
  sample: Sample;
  site: Site;
  cells: Map<string, Result>;
  /** Results left out after a QA/QC check (with `withheld: true`), shown struck through. */
  withheld?: Map<string, Result>;
}

export interface PivotOptions {
  siteIds: string[];
  paramIds: string[];
  start: string;
  end: string;
  /** Include results left out after a QA/QC check (in `withheld`). */
  withheld?: boolean;
}

export function pivot(b: ProjectBundle, opts: PivotOptions): { columns: Parameter[]; rows: PivotRow[] } {
  const siteSet = new Set(opts.siteIds.length ? opts.siteIds : b.sites.map((s) => s.id));
  const paramFilter = opts.paramIds.length ? new Set(opts.paramIds) : null;
  const rows: PivotRow[] = [];
  const used = new Set<string>();
  for (const s of b.samples) {
    if (!siteSet.has(s.siteId)) continue;
    const d = s.date.slice(0, 10);
    if (d < opts.start || d > opts.end) continue;
    const site = b.siteMap.get(s.siteId);
    if (!site) continue;
    const cells = new Map<string, Result>();
    for (const r of b.index.bySample.get(s.id) ?? []) {
      if (paramFilter && !paramFilter.has(r.parameterId)) continue;
      cells.set(r.parameterId, r);
      used.add(r.parameterId);
    }
    const withheld = new Map<string, Result>();
    if (opts.withheld)
      for (const r of b.index.withheld?.get(s.id) ?? []) {
        if (paramFilter && !paramFilter.has(r.parameterId)) continue;
        withheld.set(r.parameterId, r);
        used.add(r.parameterId);
      }
    if (cells.size || withheld.size) rows.push(withheld.size ? { sample: s, site, cells, withheld } : { sample: s, site, cells });
  }
  const siteOrder = new Map(b.sites.map((s, i) => [s.id, i]));
  rows.sort((a, c) => (a.sample.date < c.sample.date ? -1 : a.sample.date > c.sample.date ? 1 : (siteOrder.get(a.site.id) ?? 0) - (siteOrder.get(c.site.id) ?? 0)));
  const columns = b.params.filter((p) => used.has(p.id) && (!paramFilter || paramFilter.has(p.id)));
  if (paramFilter) columns.sort((a, c) => opts.paramIds.indexOf(a.id) - opts.paramIds.indexOf(c.id));
  return { columns, rows };
}

/** Display value of a result in the parameter's unit. */
export function displayValue(r: Result, p?: Parameter): { value: number | null; text: string } {
  if (r.value === null) return { value: null, text: r.text ?? '' };
  const v = p ? convert(r.value, r.unit, p.unit) : r.value;
  const val = v ?? r.value;
  const t = fmtNum(val, p?.decimals);
  return { value: val, text: r.qualifier ? `${r.qualifier}${t}` : t };
}

export function displayUnit(p: Parameter): string {
  return unitLabel(p.unit);
}

// ------------------------------------------------------------ statistics

export interface StatsRow {
  site: Site;
  param: Parameter;
  n: number;
  nd: number;
  min: number | null;
  max: number | null;
  mean: number | null;
  median: number | null;
  p95: number | null;
  exceed: number;
  minText: string;
  maxText: string;
}

export function statsTable(b: ProjectBundle, siteIds: string[], paramIds: string[], start: string, end: string, flags?: Map<string, CellFlag>): StatsRow[] {
  const sites = siteIds.length ? b.sites.filter((s) => siteIds.includes(s.id)) : b.sites;
  const params = paramIds.length ? (paramIds.map((id) => b.paramMap.get(id)).filter(Boolean) as Parameter[]) : b.params.filter((p) => b.index.byParam.has(p.id));
  const out: StatsRow[] = [];
  const nd = b.project.ndHandling;
  for (const p of params) {
    for (const site of sites) {
      const rs = resultsFor(b.index, p.id, [site.id], start, end);
      if (!rs.length) continue;
      const conv = rs
        .map((r) => ({ r, v: convert(r.value, r.unit, p.unit) }))
        .filter((x): x is { r: Result; v: number } => x.v !== null);
      const vals = conv.map((x) => statValue(x.v, x.r.qualifier, nd)!).filter((x) => x !== null);
      const detects = conv.filter((x) => x.r.qualifier !== '<');
      const minC = conv.reduce<(typeof conv)[number] | null>((m, x) => (m === null || x.v < m.v ? x : m), null);
      const maxC = conv.reduce<(typeof conv)[number] | null>((m, x) => (m === null || x.v > m.v ? x : m), null);
      out.push({
        site,
        param: p,
        n: conv.length,
        nd: conv.length - detects.length,
        min: minC?.v ?? null,
        max: maxC?.v ?? null,
        mean: computeStat('mean', vals),
        median: computeStat('median', vals, 50, b.project.percentileMethod),
        p95: percentile(vals, 95, b.project.percentileMethod),
        exceed: flags ? rs.filter((r) => flags.get(r.id) && flags.get(r.id)!.kind !== 'check').length : 0,
        minText: minC ? `${minC.r.qualifier === '<' ? '<' : ''}${fmtNum(minC.v, p.decimals)}` : '',
        maxText: maxC ? `${maxC.r.qualifier === '<' ? '<' : ''}${fmtNum(maxC.v, p.decimals)}` : '',
      });
    }
  }
  return out;
}

/** Parameters that have consent rules, falling back to the most-sampled parameters. */
/** Which parameters to show: everything the consent covers, or only those with a limit, or with a trigger (or alert). */
export type ConsentView = 'consent' | 'limits' | 'triggers';

export const isLimitLevel = (level: string) => /limit/i.test(level);
export const isTriggerLevel = (level: string) => /trigger|alert/i.test(level);

/**
 * Parameters the consent covers: those in its active rules – a limit, trigger or other condition, or every
 * parameter of a guideline set a rule compares with – and, for 'consent', those its sampling schedules require.
 */
export function consentParameterIds(b: Pick<ProjectBundle, 'rules' | 'schedules' | 'setMap'>, view: ConsentView = 'consent'): Set<string> {
  const out = new Set<string>();
  for (const r of b.rules) {
    if (!r.active) continue;
    if (view === 'limits' && !isLimitLevel(r.level)) continue;
    if (view === 'triggers' && !isTriggerLevel(r.level)) continue;
    ruleParamIds(r, b.setMap).forEach((id) => out.add(id));
  }
  if (view === 'consent') for (const s of b.schedules) if (s.active) s.parameterIds.forEach((id) => out.add(id));
  return out;
}

/** How many of each consent view's parameters have results. */
export function countWithData(sets: Record<ConsentView, Set<string>>, withData: Set<string>): Record<ConsentView, number> {
  const n = (ids: Set<string>) => [...ids].filter((id) => withData.has(id)).length;
  return { consent: n(sets.consent), limits: n(sets.limits), triggers: n(sets.triggers) };
}

export function keyParameters(b: ProjectBundle, max = 8): string[] {
  const ruled: string[] = [];
  for (const r of b.rules) {
    if (!r.active) continue;
    for (const id of ruleParamIds(r, b.setMap)) if (!ruled.includes(id) && (r.kind !== 'guideline' || b.index.byParam.has(id))) ruled.push(id);
  }
  const withData = ruled.filter((id) => b.index.byParam.has(id));
  if (withData.length) return withData.slice(0, max);
  const counts = Array.from(b.index.byParam.entries()).map(([id, m]) => [id, Array.from(m.values()).reduce((s, l) => s + l.length, 0)] as const);
  counts.sort((a, c) => c[1] - a[1]);
  return counts.slice(0, max).map(([id]) => id);
}
