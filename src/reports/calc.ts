// Calculated values for reports: a statistic of a parameter's results in the report's period – the median nitrate-N
// at DS1, the highest TSS anywhere, how many results were over a limit – for a Calculations section, or written
// into text with {{calc:median:no3-n:DS1}}.

import type { CalcRow, CalcStat, Parameter, Result, TableCalc, TableStat } from '../db/types';
import type { CellFlag, ProjectBundle } from '../lib/analysis';
import { resultsFor } from '../lib/dataIndex';
import { computeStat, ordinal, percentile } from '../lib/stats';
import { convert, unitLabel } from '../lib/units';
import { fmtNum, statValue } from '../lib/values';

export const CALC_STATS: Record<CalcStat, string> = {
  mean: 'Mean',
  median: 'Median',
  min: 'Lowest',
  max: 'Highest',
  p95: '95th percentile',
  count: 'Number of results',
  latest: 'Latest',
  exceed: 'Results over a limit or guideline',
};

export interface CalcValue {
  label: string;
  /** As written in the report, with its unit: "0.82 mg/L", "<0.005 mg/L", "12". */
  text: string;
  value: number | null;
  /** Results it is worked out from. */
  n: number;
}

/** A parameter named by its id, name, short name or one of its aliases. */
export function findParameter(b: Pick<ProjectBundle, 'params' | 'paramMap'>, name: string): Parameter | undefined {
  const k = name.trim().toLowerCase();
  return b.paramMap.get(name.trim()) ?? b.params.find((p) => p.id === k || p.name.toLowerCase() === k || p.short?.toLowerCase() === k || p.aliases.some((a) => a.toLowerCase() === k));
}

type CalcSpec = Pick<CalcRow, 'label' | 'stat' | 'parameterId' | 'sites'>;

/** A project's sites named by code (or name); none named: every site. */
export function sitesByCode(b: Pick<ProjectBundle, 'sites'>, codes: string[]): string[] {
  const want = codes.map((c) => c.trim().toLowerCase()).filter(Boolean);
  if (!want.length) return b.sites.map((s) => s.id);
  return b.sites.filter((s) => want.includes(s.code.toLowerCase()) || want.includes((s.name ?? '').toLowerCase())).map((s) => s.id);
}

export function calcLabel(b: ProjectBundle, row: CalcSpec): string {
  if (row.label?.trim()) return row.label.trim();
  const p = b.paramMap.get(row.parameterId);
  const what = row.stat === 'count' || row.stat === 'exceed' ? `${CALC_STATS[row.stat]} for ${p?.name ?? row.parameterId}` : `${CALC_STATS[row.stat]} ${p?.name ?? row.parameterId}`;
  const sites = row.sites.map((c) => c.trim()).filter(Boolean);
  return `${what}${sites.length ? ` at ${sites.join(', ')}` : ''}`;
}

/** Works out a statistic of a parameter's results at some sites (all when none are given) between two dates. */
export function calcValue(b: ProjectBundle, row: CalcSpec, start: string, end: string, flags?: Map<string, CellFlag>): CalcValue {
  const label = calcLabel(b, row);
  const p = b.paramMap.get(row.parameterId);
  if (!p) return { label, text: '–', value: null, n: 0 };
  const siteIds = sitesByCode(b, row.sites);
  if (!siteIds.length) return { label, text: '–', value: null, n: 0 };
  const rs = resultsFor(b.index, p.id, siteIds, start, end);
  const conv = rs.map((r) => ({ r, v: convert(r.value, r.unit, p.unit) })).filter((x): x is { r: (typeof rs)[number]; v: number } => x.v !== null);
  const unit = unitLabel(p.unit);
  const withUnit = (v: number | null, q = '') => (v === null ? '–' : `${q}${fmtNum(v, p.decimals)}${unit ? ` ${unit}` : ''}`);
  const n = conv.length;
  if (row.stat === 'count') return { label, text: String(n), value: n, n };
  if (row.stat === 'exceed') {
    const k = flags ? rs.filter((r) => flags.get(r.id) && flags.get(r.id)!.kind !== 'check').length : 0;
    return { label, text: String(k), value: k, n };
  }
  if (!n) return { label, text: '–', value: null, n: 0 };
  if (row.stat === 'min' || row.stat === 'max' || row.stat === 'latest') {
    const pick =
      row.stat === 'latest'
        ? conv.reduce((m, x) => (x.r.date > m.r.date ? x : m))
        : conv.reduce((m, x) => ((row.stat === 'min' ? x.v < m.v : x.v > m.v) ? x : m));
    return { label, text: withUnit(pick.v, pick.r.qualifier === '<' ? '<' : pick.r.qualifier === '>' ? '>' : ''), value: pick.v, n };
  }
  const vals = conv.map((x) => statValue(x.v, x.r.qualifier, b.project.ndHandling)).filter((x): x is number => x !== null);
  const v = row.stat === 'p95' ? percentile(vals, 95, b.project.percentileMethod) : computeStat(row.stat, vals, 50, b.project.percentileMethod);
  // every result below the detection limit: the statistic is "below" too
  const allNd = conv.every((x) => x.r.qualifier === '<');
  return { label, text: withUnit(v, allNd ? '<' : ''), value: v, n };
}

const CALC_TOKEN = /\{\{\s*calc:([a-z0-9]+):([^:}]+?)(?::([^}]*?))?\s*\}\}/gi;

/**
 * Fills {{calc:STAT:PARAMETER:SITES}} in text – e.g. {{calc:median:no3-n:DS1,DS2}} or {{calc:max:TSS}} (all sites) –
 * with the value for the period.
 */
export function fillCalcs(text: string, b: ProjectBundle, start: string, end: string, flags?: Map<string, CellFlag>): string {
  if (!text.includes('calc:')) return text;
  return text.replace(CALC_TOKEN, (whole, stat: string, param: string, sites?: string) => {
    const s = stat.toLowerCase() as CalcStat;
    if (!(s in CALC_STATS)) return whole;
    const p = findParameter(b, param);
    if (!p) return '–';
    const codes = (sites ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    return calcValue(b, { stat: s, parameterId: p.id, sites: codes }, start, end, flags).text;
  });
}

/** The placeholder for a calculation, to put in text. */
export function calcToken(stat: CalcStat, parameterId: string, siteCodes: string[]): string {
  return `{{calc:${stat}:${parameterId}${siteCodes.length ? `:${siteCodes.join(',')}` : ''}}}`;
}

// ---------------------------------------------------------------- calculation columns in tables

export const TABLE_STATS: Record<TableStat, string> = {
  mean: 'Mean',
  median: 'Median',
  min: 'Minimum',
  max: 'Maximum',
  p95: '95th percentile',
  percentile: 'Another percentile',
  sum: 'Total',
  count: 'Number of results',
  geomean: 'Geometric mean',
};

const SHORT: Record<TableStat, string> = { mean: 'Mean', median: 'Median', min: 'Min', max: 'Max', p95: '95th %ile', percentile: '', sum: 'Total', count: 'No.', geomean: 'Geomean' };

/** What a calculation is worked out from, in a heading: "", "period", "5 yr", "all". */
export function calcOverShort(c: TableCalc): string {
  return c.over === 'period' ? 'period' : c.over === 'years' ? `${c.years ?? 5} yr` : c.over === 'all' ? 'all' : '';
}

/** A calculation column's heading: its own label, or "Mean", "80th %ile", "Mean (5 yr)" … */
export function calcHead(c: TableCalc): string {
  if (c.label?.trim()) return c.label.trim();
  const name = c.stat === 'percentile' ? `${ordinal(c.percentile ?? 90)} %ile` : SHORT[c.stat];
  const over = calcOverShort(c);
  return over ? `${name} (${over})` : name;
}

/** A statistic of a parameter's results, as written in a table cell (no unit: the table has a unit column). */
export function tableCalcValue(b: ProjectBundle, p: Parameter, rs: Result[], c: TableCalc): string {
  const conv = rs.map((r) => ({ r, v: convert(r.value, r.unit, p.unit) })).filter((x): x is { r: Result; v: number } => x.v !== null);
  if (c.stat === 'count') return String(conv.length);
  if (!conv.length) return '–';
  if (c.stat === 'min' || c.stat === 'max') {
    const pick = conv.reduce((m, x) => ((c.stat === 'min' ? x.v < m.v : x.v > m.v) ? x : m));
    return `${pick.r.qualifier === '<' ? '<' : pick.r.qualifier === '>' ? '>' : ''}${fmtNum(pick.v, p.decimals)}`;
  }
  const vals = conv.map((x) => statValue(x.v, x.r.qualifier, b.project.ndHandling)).filter((x): x is number => x !== null);
  const v =
    c.stat === 'sum'
      ? vals.reduce((a, x) => a + x, 0)
      : c.stat === 'p95'
        ? percentile(vals, 95, b.project.percentileMethod)
        : c.stat === 'percentile'
          ? percentile(vals, c.percentile ?? 90, b.project.percentileMethod)
          : computeStat(c.stat, vals, 50, b.project.percentileMethod);
  if (v === null || !Number.isFinite(v)) return '–';
  // every result below the detection limit: the statistic is "below" too
  return `${conv.every((x) => x.r.qualifier === '<') ? '<' : ''}${fmtNum(v, p.decimals)}`;
}

/** The note under a table with calculation columns: what they're worked out from, and how. */
export function calcNotes(b: ProjectBundle, calcs: TableCalc[], shown: string, end: string): string[] {
  if (!calcs.length) return [];
  const from = (c: TableCalc) =>
    c.over === 'period' ? 'the results in the report period' : c.over === 'years' ? `the results in the ${c.years ?? 5} years to ${end}` : c.over === 'all' ? `all the results to ${end}` : shown;
  const groups = new Map<string, string[]>();
  for (const c of calcs) groups.set(from(c), [...(groups.get(from(c)) ?? []), calcHead(c)]);
  const nd = b.project.ndHandling === 'half' ? 'half the detection limit' : b.project.ndHandling === 'zero' ? 'zero' : 'the detection limit';
  const pct = calcs.some((c) => c.stat === 'p95' || c.stat === 'percentile' || c.stat === 'median') ? `; percentiles by the ${b.project.percentileMethod === 'hazen' ? 'Hazen' : 'Excel PERCENTILE.INC'} method` : '';
  return [`${[...groups].map(([f, heads]) => `${heads.join(', ')}: worked out from ${f}`).join('; ')} – results below the detection limit as ${nd}${pct}.`];
}
