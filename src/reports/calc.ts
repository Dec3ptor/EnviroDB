// Calculated values for reports: a statistic of a parameter's results in the report's period – the median nitrate-N
// at DS1, the highest TSS anywhere, how many results were over a limit – for a Calculations section, or written
// into text with {{calc:median:no3-n:DS1}}.

import type { CalcRow, CalcStat, Parameter } from '../db/types';
import type { CellFlag, ProjectBundle } from '../lib/analysis';
import { resultsFor } from '../lib/dataIndex';
import { computeStat, percentile } from '../lib/stats';
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
