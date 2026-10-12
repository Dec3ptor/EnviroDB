// Quick review of the latest sampling round: each site's latest sample, compared with limits,
// guidelines and the site's own history.

import type { Parameter, Result, Sample } from '../db/types';
import type { ProjectBundle } from './analysis';
import { resultsFor } from './dataIndex';
import { formatDate, formatDateLong, MONTH_LONG } from './dates';
import { percentile } from './stats';
import { convert } from './units';
import { fmtNum } from './values';

export interface Round {
  key: string; // 'latest' or 'YYYY-MM'
  label: string;
  samples: Sample[]; // one per site, in site order
}

/** "Latest sample at each site", then the recent months that have samples (latest sample per site in each). */
export function samplingRounds(b: Pick<ProjectBundle, 'samples' | 'sites' | 'index'>, months = 24): Round[] {
  const withData = b.samples.filter((s) => (b.index.bySample.get(s.id)?.length ?? 0) > 0);
  const pick = (list: Sample[]) =>
    b.sites
      .map((site) => list.filter((s) => s.siteId === site.id).reduce<Sample | undefined>((best, s) => (!best || s.date > best.date ? s : best), undefined))
      .filter((s): s is Sample => !!s);
  const rounds: Round[] = [];
  const latest = pick(withData);
  if (latest.length) rounds.push({ key: 'latest', label: 'Latest sample at each site', samples: latest });
  const keys = Array.from(new Set(withData.map((s) => s.date.slice(0, 7)))).sort().reverse().slice(0, months);
  for (const k of keys) {
    const samples = pick(withData.filter((s) => s.date.startsWith(k)));
    rounds.push({ key: k, label: `${MONTH_LONG[+k.slice(5, 7) - 1]} ${k.slice(0, 4)} (${samples.length} site${samples.length === 1 ? '' : 's'})`, samples });
  }
  return rounds;
}

export interface ReviewCell {
  result: Result;
  value: number | null; // in the parameter's unit
  previous?: { value: number; text: string; date: string };
  change?: number; // % change from the previous result
  usual?: { lo: number; hi: number; n: number }; // 5th–95th percentile of earlier results
  /** Median of the earlier results (with at least 3). */
  median?: number;
  unusual?: 'high' | 'low';
  record?: 'high' | 'low';
}

const MIN_HISTORY = 6;

/** A result in context: previous result and the site's usual range before this sample (from `since`, if given). */
export function reviewCell(b: Pick<ProjectBundle, 'index' | 'project'>, sample: Sample, p: Parameter, since?: string): ReviewCell | null {
  const r = (b.index.bySample.get(sample.id) ?? []).find((x) => x.parameterId === p.id);
  if (!r) return null;
  const value = convert(r.value, r.unit, p.unit);
  const cell: ReviewCell = { result: r, value };
  const earlier = resultsFor(b.index, p.id, [sample.siteId])
    .filter((x) => x.date < sample.date && (!since || x.date >= since))
    .map((x) => ({ x, v: convert(x.value, x.unit, p.unit) }))
    .filter((e): e is { x: Result; v: number } => e.v !== null);
  const prev = earlier[earlier.length - 1];
  if (prev) {
    cell.previous = { value: prev.v, text: `${prev.x.qualifier}${fmtNum(prev.v, p.decimals)}`, date: prev.x.date };
    if (value !== null && prev.x.qualifier !== '<' && r.qualifier !== '<' && prev.v !== 0) cell.change = ((value - prev.v) / Math.abs(prev.v)) * 100;
  }
  if (earlier.length >= 3) cell.median = percentile(earlier.map((e) => e.v), 50, b.project.percentileMethod) ?? undefined;
  if (earlier.length >= MIN_HISTORY && value !== null) {
    const vals = earlier.map((e) => e.v);
    const lo = percentile(vals, 5, b.project.percentileMethod) ?? Math.min(...vals);
    const hi = percentile(vals, 95, b.project.percentileMethod) ?? Math.max(...vals);
    cell.usual = { lo, hi, n: vals.length };
    if (r.qualifier !== '<' && value > hi) cell.unusual = 'high';
    else if (r.qualifier !== '<' && value < lo && !earlier.every((e) => e.x.qualifier === '<')) cell.unusual = 'low';
    if (r.qualifier !== '<' && value > Math.max(...vals)) cell.record = 'high';
    else if (r.qualifier !== '<' && value < Math.min(...vals)) cell.record = 'low';
  }
  return cell;
}

/** Tooltip lines describing a cell's context. */
export function reviewLines(c: ReviewCell, p: Parameter, siteCode: string, unit: string): string[] {
  const out: string[] = [];
  if (c.previous) {
    const ch = c.change === undefined ? '' : ` (${c.change >= 0 ? '+' : ''}${fmtNum(c.change)}%)`;
    out.push(`Previous: ${c.previous.text} ${unit} on ${formatDate(c.previous.date)}${ch}`);
  } else out.push('First result at this site');
  if (c.usual) out.push(`Usual at ${siteCode}: ${fmtNum(c.usual.lo, p.decimals)}–${fmtNum(c.usual.hi, p.decimals)} ${unit} (5th–95th percentile of ${c.usual.n} earlier results)`);
  if (c.record === 'high') out.push(`Highest ${p.name} on record at ${siteCode}`);
  else if (c.record === 'low') out.push(`Lowest ${p.name} on record at ${siteCode}`);
  else if (c.unusual === 'high') out.push('Unusually high for this site');
  else if (c.unusual === 'low') out.push('Unusually low for this site');
  return out;
}

/** "September 2026" for a period within one month, "August – September 2026" across months of one year. */
export function monthLabel(start: string, end: string): string {
  const [ys, ms] = [+start.slice(0, 4), +start.slice(5, 7)];
  const [ye, me] = [+end.slice(0, 4), +end.slice(5, 7)];
  if (ys === ye && ms === me) return `${MONTH_LONG[ms - 1]} ${ys}`;
  if (ys === ye) return `${MONTH_LONG[ms - 1]} – ${MONTH_LONG[me - 1]} ${ys}`;
  return `${MONTH_LONG[ms - 1]} ${ys} – ${MONTH_LONG[me - 1]} ${ye}`;
}

/** A period as it reads in a report: "September 2026", "July to September 2026", "July 2025 to June 2026", or exact dates. */
export function reportPeriodLabel(start: string, end: string): string {
  const next = new Date(Date.UTC(+end.slice(0, 4), +end.slice(5, 7) - 1, +end.slice(8, 10) + 1)).toISOString().slice(0, 10);
  if (!start.endsWith('-01') || !next.endsWith('-01')) return `${formatDateLong(start)} to ${formatDateLong(end)}`;
  const [ys, ms] = [+start.slice(0, 4), +start.slice(5, 7)];
  const [ye, me] = [+end.slice(0, 4), +end.slice(5, 7)];
  if (ys === ye && ms === me) return `${MONTH_LONG[ms - 1]} ${ys}`;
  if (ys === ye) return `${MONTH_LONG[ms - 1]} to ${MONTH_LONG[me - 1]} ${ys}`;
  return `${MONTH_LONG[ms - 1]} ${ys} to ${MONTH_LONG[me - 1]} ${ye}`;
}

/** Period choices for the months with sampling, newest first: "Monitoring round – September 2026". */
export function roundPeriods(b: Pick<ProjectBundle, 'samples' | 'sites' | 'index'>, months = 12): Array<{ key: string; start: string; end: string; label: string }> {
  return samplingRounds(b, months)
    .filter((r) => r.key !== 'latest')
    .map((r) => {
      const [y, m] = [+r.key.slice(0, 4), +r.key.slice(5, 7)];
      const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
      return { key: `round:${r.key}`, start: `${r.key}-01`, end, label: `Monitoring round – ${MONTH_LONG[m - 1]} ${y}` };
    });
}

