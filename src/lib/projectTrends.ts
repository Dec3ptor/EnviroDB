// Trends and upstream–downstream comparisons for a project's sites and analytes (the methods are in trends.ts).

import type { ProjectBundle } from './analysis';
import { resultsFor } from './dataIndex';
import { addDays, dayOf, todayStr } from './dates';
import { convert } from './units';
import { betterFor, comparePaired, trend, trendLinePoints, type PairedComparison, type SeasonChoice, type TrendPoint, type TrendResult } from './trends';

/** A site's results for an analyte, in the analyte's unit. */
export function trendPoints(b: Pick<ProjectBundle, 'index' | 'paramMap'>, siteId: string, parameterId: string, start?: string, end?: string): TrendPoint[] {
  const unit = b.paramMap.get(parameterId)?.unit;
  return resultsFor(b.index, parameterId, [siteId], start, end).flatMap((r) => {
    const v = convert(r.value, r.unit, unit);
    return v === null ? [] : [{ date: r.date, value: v, nd: r.qualifier === '<' }];
  });
}

/** How far back trends look. */
export type TrendSpan = '5y' | '10y' | 'all';
export const TREND_SPANS: Array<{ value: TrendSpan; label: string }> = [
  { value: '5y', label: '5 years' },
  { value: '10y', label: '10 years' },
  { value: 'all', label: 'All' },
];

/** The dates a trend covers: the span back from `end` (the latest results, or a report's end). */
export function trendRange(span: TrendSpan, end: string): { start?: string; end: string } {
  const years = span === '5y' ? 5 : span === '10y' ? 10 : 0;
  return { start: years ? addDays(`${+end.slice(0, 4) - years}${end.slice(4, 10)}`, 1) : undefined, end };
}

/** The latest results' date (or today). */
export const latestDate = (b: Pick<ProjectBundle, 'index'>) => (b.index.dates.max ? dayOf(b.index.dates.max) : todayStr());

export interface TrendRow {
  siteId: string;
  parameterId: string;
  result: TrendResult;
}

/** The trend at each site for each analyte with results. */
export function projectTrends(b: ProjectBundle, o: { siteIds?: string[]; parameterIds: string[]; start?: string; end?: string; seasons?: SeasonChoice }): TrendRow[] {
  const sites = o.siteIds?.length ? b.sites.filter((s) => o.siteIds!.includes(s.id)) : b.sites;
  const rows: TrendRow[] = [];
  for (const pid of o.parameterIds) {
    for (const s of sites) {
      const pts = trendPoints(b, s.id, pid, o.start, o.end);
      if (pts.length < 2) continue;
      rows.push({ siteId: s.id, parameterId: pid, result: trend(pts, { seasons: o.seasons, better: betterFor(pid) }) });
    }
  }
  return rows;
}

/** Trend lines for a graph's series (its sites), over the graph's dates. */
export function chartTrends(b: ProjectBundle, parameterId: string, siteIds: string[], start?: string, end?: string, seasons?: SeasonChoice) {
  return siteIds.flatMap((siteId) => {
    const r = trend(trendPoints(b, siteId, parameterId, start, end), { seasons, better: betterFor(parameterId) });
    return r.ok ? [{ seriesId: siteId, points: trendLinePoints(r), result: r }] : [];
  });
}

export interface SitePair {
  upId: string;
  downId: string;
}

/**
 * Upstream–downstream pairs to compare: the reference sites of "change from upstream" rules, then each upstream /
 * control site against each downstream / impact site.
 */
export function defaultPairs(b: Pick<ProjectBundle, 'sites' | 'rules'>): SitePair[] {
  const out: SitePair[] = [];
  const add = (upId: string, downId: string) => upId !== downId && !out.some((p) => p.upId === upId && p.downId === downId) && out.push({ upId, downId });
  for (const r of b.rules) if (r.kind === 'change' && r.referenceSiteId) for (const id of r.siteIds) add(r.referenceSiteId, id);
  const ups = b.sites.filter((s) => s.role === 'Upstream / control' || s.role === 'Background');
  const downs = b.sites.filter((s) => s.role === 'Downstream / impact');
  for (const u of ups) for (const d of downs) add(u.id, d.id);
  return out;
}

export interface PairRow {
  parameterId: string;
  c: PairedComparison;
}

/** Downstream against upstream for each analyte, results paired by date. */
export function compareSites(b: ProjectBundle, pair: SitePair, parameterIds: string[], start?: string, end?: string, days = 1): PairRow[] {
  return parameterIds
    .map((pid) => ({ parameterId: pid, c: comparePaired(trendPoints(b, pair.upId, pid, start, end), trendPoints(b, pair.downId, pid, start, end), days) }))
    .filter((r) => r.c.n > 0);
}
