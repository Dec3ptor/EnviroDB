// Other ways to graph the results: each site's spread as a box plot, downstream against upstream (results paired by
// date), and one parameter against another. Each has its numbers worked out first (a spec – tested), then drawn.

import type { EChartsCoreOption } from 'echarts/core';
import type { NdHandling, Parameter, Site } from '../db/types';
import type { DataIndex } from '../lib/dataIndex';
import { resultsFor } from '../lib/dataIndex';
import { formatDate } from '../lib/dates';
import { boxSummary, spearman, type BoxSummary, type PercentileMethod } from '../lib/stats';
import { comparePaired, pairByDate, type PairedComparison, type TrendPoint } from '../lib/trends';
import { convert, unitLabel } from '../lib/units';
import { fmtNum, statValue } from '../lib/values';
import { INK, SERIES_DARK, SERIES_LIGHT } from '../theme';
import { thresholdStyles, type ChartLine, type ChartSpec, type RenderOpts } from './timeSeries';

const FONT = 'Roboto, system-ui, -apple-system, "Segoe UI", Arial, sans-serif';
const inkOf = (o: RenderOpts) => (o.dark && !o.forExport ? INK.dark : INK.light);
const paletteOf = (o: RenderOpts) => (o.dark && !o.forExport ? SERIES_DARK : SERIES_LIGHT);
/** A colour with some see-through (hex in, rgba out). */
const fade = (hex: string, a: number) => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${a})` : hex;
};

/** A range out to round numbers either side of some values (about five steps of 1, 2 or 5 × a power of ten). */
export function roundRange(lo: number, hi: number): [number, number] {
  const span = hi - lo || Math.abs(hi) || 1;
  const raw = span / 5;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
  const round = (v: number) => Number(v.toPrecision(12));
  const a = Math.floor(lo / step + 1e-9) * step;
  const b = Math.ceil(hi / step - 1e-9) * step;
  // (one value: a step either side of it, so there's an axis)
  return a === b ? [round(a - step), round(b + step)] : [round(a), round(b)];
}

function frame(o: RenderOpts, title: string, subtitle: string | undefined) {
  const ink = inkOf(o);
  const showTitle = o.showTitle ?? true;
  const fs = o.fontScale ?? 1;
  return {
    ink,
    fs,
    // (room under the title for the value axis's name, which sits at the axis's top)
    top: (showTitle ? (subtitle ? 50 : 32) : 12) + 20 * fs,
    base: {
      backgroundColor: o.forExport ? '#ffffff' : 'transparent',
      animation: !o.forExport,
      textStyle: { fontFamily: FONT, color: ink.primary },
      title: showTitle
        ? { text: title, subtext: subtitle, left: 4, top: 0, textStyle: { fontSize: 14 * fs, fontWeight: 600, color: ink.primary, fontFamily: FONT }, subtextStyle: { fontSize: 11 * fs, color: ink.secondary, fontFamily: FONT }, itemGap: 4 }
        : undefined,
    },
    axis: {
      axisLine: { lineStyle: { color: ink.axis } },
      axisTick: { lineStyle: { color: ink.axis } },
      axisLabel: { color: ink.secondary, fontSize: 11 * fs, fontFamily: FONT, hideOverlap: true },
      splitLine: { lineStyle: { color: ink.grid } },
      nameTextStyle: { color: ink.secondary, fontSize: 11.5 * fs, fontFamily: FONT },
    },
  };
}

/** Threshold lines across a graph, in the colours and dashes the other graphs give them. */
function thresholdMarks(lines: ChartLine[], o: RenderOpts, fs: number) {
  return thresholdStyles(lines, !!o.dark && !o.forExport).flatMap((t) =>
    t.values.map((v, i) => ({
      yAxis: v,
      lineStyle: { color: t.color, width: 1.6, type: (t.dash ?? 'solid') as 'solid' | number[] },
      label: { show: i === 0, formatter: t.text.length > 60 ? `${t.text.slice(0, 58)}…` : t.text, position: 'insideEndTop' as const, color: t.color, fontSize: 10 * fs, fontFamily: FONT },
    })),
  );
}

// ------------------------------------------------------------ each site's spread: box plots

export interface SiteBox extends BoxSummary {
  siteId: string;
  name: string;
  /** The site's colour (hex), or its place in the palette. */
  color?: string;
  colorIndex: number;
  /** How many of its values are below detection. */
  nd: number;
}

export interface BoxSpec {
  title: string;
  subtitle?: string;
  unit: string;
  boxes: SiteBox[];
  lines: ChartLine[];
  log: boolean;
}

/**
 * A box for each site of a graph: the quartiles and median of its results over the graph's dates, whiskers to the
 * furthest values within 1.5 box-heights, the rest as dots. Values below detection are taken as the project takes
 * them for statistics (`nd`).
 */
export function boxSpec(spec: ChartSpec, nd: NdHandling, method: PercentileMethod = 'excel'): BoxSpec {
  const boxes: SiteBox[] = [];
  for (const s of spec.series) {
    const values = s.points.map((p) => statValue(p.v, p.nd ? '<' : '', nd)).filter((v): v is number => v !== null && (!spec.log || v > 0));
    const b = boxSummary(values, method);
    if (b) boxes.push({ ...b, siteId: s.id, name: s.name, color: s.color, colorIndex: s.colorIndex, nd: s.points.filter((p) => p.nd).length });
  }
  const dates = spec.series.flatMap((s) => s.points.map((p) => p.date.slice(0, 10))).sort();
  return {
    title: spec.title,
    subtitle: dates.length ? `${formatDate(dates[0])} – ${formatDate(dates[dates.length - 1])}` : undefined,
    unit: spec.unit,
    boxes,
    lines: spec.lines,
    log: spec.log,
  };
}

export function boxOption(spec: BoxSpec, o: RenderOpts = {}): EChartsCoreOption {
  const f = frame(o, `${spec.title}${unitLabel(spec.unit) ? ` (${unitLabel(spec.unit)})` : ''}`, spec.subtitle);
  const palette = paletteOf(o);
  const colour = (b: SiteBox) => b.color ?? palette[b.colorIndex % palette.length];
  const outliers = spec.boxes.flatMap((b, i) => b.outliers.map((v) => ({ value: [i, v], itemStyle: { color: colour(b) } })));
  return {
    ...f.base,
    grid: { left: 12, right: 18, top: f.top, bottom: 8, containLabel: true },
    tooltip: {
      trigger: 'item',
      confine: true,
      formatter: (p: { seriesType?: string; dataIndex: number; value: number[] }) => {
        if (p.seriesType !== 'boxplot') return `${spec.boxes[p.value[0]]?.name ?? ''}: ${fmtNum(p.value[1])} ${unitLabel(spec.unit)}`;
        const b = spec.boxes[p.dataIndex];
        return `<b>${b.name}</b> – ${b.n} result${b.n === 1 ? '' : 's'}${b.nd ? `, ${b.nd} below detection` : ''}<br/>Highest ${fmtNum(b.max)}<br/>Upper quartile ${fmtNum(b.q3)}<br/>Median ${fmtNum(b.median)}<br/>Lower quartile ${fmtNum(b.q1)}<br/>Lowest ${fmtNum(b.min)}`;
      },
    },
    xAxis: { type: 'category', data: spec.boxes.map((b) => `${b.name}\nn = ${b.n}`), ...f.axis, splitLine: { show: false }, axisLabel: { ...f.axis.axisLabel, interval: 0, lineHeight: 15 * f.fs } },
    yAxis: { type: spec.log ? 'log' : 'value', name: unitLabel(spec.unit), nameLocation: 'end', nameGap: 8, scale: spec.log, ...f.axis, nameTextStyle: { ...f.axis.nameTextStyle, align: 'left' } },
    series: [
      {
        type: 'boxplot',
        boxWidth: ['18%', '52%'],
        data: spec.boxes.map((b) => ({ value: [b.low, b.q1, b.median, b.q3, b.high], itemStyle: { color: fade(colour(b), 0.22), borderColor: colour(b), borderWidth: 1.6 } })),
        markLine: spec.lines.length ? { silent: true, symbol: 'none', data: thresholdMarks(spec.lines, o, f.fs) } : undefined,
      },
      { type: 'scatter', data: outliers, symbolSize: 6 * f.fs, z: 3 },
    ],
  } as EChartsCoreOption;
}

/** What a box plot's parts are, for a caption or a key. */
export const BOX_KEY = 'Box: the middle half of the results, with the median; whiskers: the furthest results within 1.5 box-heights; dots: results beyond.';

// ------------------------------------------------------------ downstream against upstream

export interface PairPoint {
  /** Upstream and downstream values (a result below detection at its detection limit). */
  x: number;
  y: number;
  date: string;
  ndX: boolean;
  ndY: boolean;
}

export interface PairSpec {
  title: string;
  subtitle: string;
  unit: string;
  upName: string;
  downName: string;
  points: PairPoint[];
  comparison: PairedComparison;
  log: boolean;
}

/** A site's results of a parameter, in the parameter's unit, as the comparisons take them. */
function pointsOf(index: DataIndex, param: Parameter, siteId: string, start?: string, end?: string): TrendPoint[] {
  return resultsFor(index, param.id, [siteId], start, end).flatMap((r) => {
    const v = convert(r.value, r.unit, param.unit);
    return v === null ? [] : [{ date: r.date, value: v, nd: r.qualifier === '<' }];
  });
}

/** The comparison in words: "24 pairs · median 0.8 upstream, 1.4 downstream · higher downstream (p = 0.003)". */
export function pairVerdict(c: PairedComparison, unit: string): string {
  if (!c.n) return 'No results on the same days at both sites';
  const u = unitLabel(unit);
  const p = c.p === null ? '' : ` (p ${c.p < 0.001 ? '< 0.001' : `= ${c.p.toFixed(c.p < 0.01 ? 3 : 2)}`})`;
  const verdict = c.verdict === 'higher' ? `higher downstream${p}` : c.verdict === 'lower' ? `lower downstream${p}` : c.verdict === 'no-difference' ? `no significant difference${p}` : 'too few pairs to test';
  return `${c.n} pair${c.n === 1 ? '' : 's'} · median ${fmtNum(c.upMedian)} upstream, ${fmtNum(c.downMedian)} downstream${u ? ` ${u}` : ''} · ${verdict}`;
}

/** Downstream against upstream for a parameter: the results paired by date (within `days`), and how they compare. */
export function pairSpec(input: { index: DataIndex; param: Parameter; up: Pick<Site, 'id' | 'code'>; down: Pick<Site, 'id' | 'code'>; start?: string; end?: string; days?: number; log?: boolean }): PairSpec {
  const { index, param, up, down } = input;
  const days = input.days ?? 1;
  const ups = pointsOf(index, param, up.id, input.start, input.end);
  const downs = pointsOf(index, param, down.id, input.start, input.end);
  const points = pairByDate(ups, downs, days)
    .map(([u, d]) => ({ x: u.value, y: d.value, date: d.date, ndX: u.nd, ndY: d.nd }))
    .filter((p) => !input.log || (p.x > 0 && p.y > 0));
  const comparison = comparePaired(ups, downs, days);
  return { title: param.name, subtitle: pairVerdict(comparison, param.unit), unit: param.unit, upName: up.code, downName: down.code, points, comparison, log: !!input.log };
}

export function pairOption(spec: PairSpec, o: RenderOpts = {}): EChartsCoreOption {
  const f = frame(o, `${spec.title}: ${spec.downName} against ${spec.upName}`, spec.subtitle);
  const palette = paletteOf(o);
  const all = spec.points.flatMap((p) => [p.x, p.y]);
  const lo = all.length ? Math.min(...all) : 0;
  const hi = all.length ? Math.max(...all) : 1;
  // both axes the same, so the line of no change runs corner to corner – out to round numbers
  const [min, max] = spec.log ? [10 ** Math.floor(Math.log10(lo)), 10 ** Math.ceil(Math.log10(hi) + 1e-12)] : roundRange(lo, hi);
  const u = unitLabel(spec.unit);
  const axis = (name: string) => ({ type: spec.log ? ('log' as const) : ('value' as const), name: `${name}${u ? ` (${u})` : ''}`, min, max, ...f.axis });
  return {
    ...f.base,
    grid: { left: 14, right: 22, top: f.top, bottom: 30, containLabel: true },
    tooltip: {
      trigger: 'item',
      confine: true,
      formatter: (p: { data?: { point?: PairPoint } }) => {
        const pt = p.data?.point;
        return pt ? `${formatDate(pt.date.slice(0, 10))}<br/>${spec.upName} ${pt.ndX ? '< ' : ''}${fmtNum(pt.x)}<br/>${spec.downName} ${pt.ndY ? '< ' : ''}${fmtNum(pt.y)}` : 'No change: the same at both';
      },
    },
    xAxis: { ...axis(spec.upName), nameLocation: 'middle', nameGap: 26 },
    yAxis: { ...axis(spec.downName), nameLocation: 'end', nameGap: 8, nameTextStyle: { ...f.axis.nameTextStyle, align: 'left' } },
    series: [
      { type: 'line', data: [[min, min], [max, max]], symbol: 'none', lineStyle: { color: f.ink.muted, type: [6, 4], width: 1.2 }, silent: true, tooltip: { show: false } },
      {
        type: 'scatter',
        symbolSize: 9 * f.fs,
        data: spec.points.map((p) => ({ value: [p.x, p.y], point: p, itemStyle: p.ndX || p.ndY ? { color: f.ink.surface, borderColor: palette[0], borderWidth: 1.6 } : { color: fade(palette[0], 0.85) } })),
      },
    ],
  } as EChartsCoreOption;
}

// ------------------------------------------------------------ one parameter against another

export interface XyPoint {
  x: number;
  y: number;
  date: string;
  /** Either is below detection. */
  nd: boolean;
}

export interface XySeries {
  siteId: string;
  name: string;
  color?: string;
  colorIndex: number;
  points: XyPoint[];
}

export interface XySpec {
  title: string;
  subtitle: string;
  x: { name: string; unit: string; log: boolean };
  y: { name: string; unit: string; log: boolean };
  series: XySeries[];
  n: number;
  /** Spearman's rank correlation over every point (null: too few, or one doesn't vary). */
  rs: number | null;
}

/** How strongly two things go together, in a word, from Spearman's rank correlation. */
export function correlationText(rs: number | null, n: number): string {
  if (rs === null || n < 3) return n ? 'too few to say how they go together' : 'no samples with both';
  const a = Math.abs(rs);
  const strength = a >= 0.8 ? 'very strong' : a >= 0.6 ? 'strong' : a >= 0.4 ? 'moderate' : a >= 0.2 ? 'weak' : 'little or no';
  const way = a < 0.2 ? '' : rs > 0 ? ' – they rise together' : ' – one falls as the other rises';
  return `${strength} relationship (Spearman rₛ = ${rs.toFixed(2)})${way}`;
}

/**
 * One parameter against another: each sample that has both, at the sites chosen, over the dates. Values below
 * detection are plotted as the project takes them for statistics, and marked.
 */
export function xySpec(input: {
  index: DataIndex;
  x: Parameter;
  y: Parameter;
  /** All the project's sites, in order (for colours that stay put). */
  sites: Array<Pick<Site, 'id' | 'code' | 'colour'>>;
  /** [] = every site. */
  siteIds: string[];
  start?: string;
  end?: string;
  nd: NdHandling;
  logX?: boolean;
  logY?: boolean;
}): XySpec {
  const { index, x, y } = input;
  const wanted = input.siteIds.length ? new Set(input.siteIds) : null;
  const series: XySeries[] = [];
  input.sites.forEach((site, colorIndex) => {
    if (wanted && !wanted.has(site.id)) return;
    const ys = new Map(resultsFor(index, y.id, [site.id], input.start, input.end).map((r) => [r.sampleId, r]));
    const points: XyPoint[] = [];
    for (const rx of resultsFor(index, x.id, [site.id], input.start, input.end)) {
      const ry = ys.get(rx.sampleId);
      if (!ry) continue;
      const vx = statValue(convert(rx.value, rx.unit, x.unit), rx.qualifier, input.nd);
      const vy = statValue(convert(ry.value, ry.unit, y.unit), ry.qualifier, input.nd);
      if (vx === null || vy === null || (input.logX && vx <= 0) || (input.logY && vy <= 0)) continue;
      points.push({ x: vx, y: vy, date: rx.date, nd: rx.qualifier === '<' || ry.qualifier === '<' });
    }
    if (points.length) series.push({ siteId: site.id, name: site.code, color: site.colour, colorIndex, points: points.sort((a, b) => (a.date < b.date ? -1 : 1)) });
  });
  const all = series.flatMap((s) => s.points);
  const rs = spearman(all.map((p) => p.x), all.map((p) => p.y));
  return {
    title: `${y.name} against ${x.name}`,
    subtitle: `${all.length} sample${all.length === 1 ? '' : 's'} with both · ${correlationText(rs, all.length)}`,
    x: { name: x.name, unit: x.unit, log: !!input.logX },
    y: { name: y.name, unit: y.unit, log: !!input.logY },
    series,
    n: all.length,
    rs,
  };
}

export function xyOption(spec: XySpec, o: RenderOpts = {}): EChartsCoreOption {
  const f = frame(o, spec.title, spec.subtitle);
  const palette = paletteOf(o);
  const many = spec.series.length > 1;
  const name = (a: XySpec['x']) => `${a.name}${unitLabel(a.unit) ? ` (${unitLabel(a.unit)})` : ''}`;
  return {
    ...f.base,
    legend: many ? { top: f.top - 24 * f.fs, left: 4, itemWidth: 12, itemHeight: 12, textStyle: { color: f.ink.secondary, fontSize: 11.5 * f.fs, fontFamily: FONT }, icon: 'circle' } : undefined,
    grid: { left: 14, right: 22, top: f.top + (many ? 22 : 0), bottom: 30, containLabel: true },
    tooltip: {
      trigger: 'item',
      confine: true,
      formatter: (p: { seriesName?: string; data?: { point?: XyPoint } }) => {
        const pt = p.data?.point;
        return pt ? `<b>${p.seriesName ?? ''}</b> ${formatDate(pt.date.slice(0, 10))}<br/>${spec.x.name} ${fmtNum(pt.x)}<br/>${spec.y.name} ${fmtNum(pt.y)}${pt.nd ? '<br/>(one is below detection)' : ''}` : '';
      },
    },
    xAxis: { type: spec.x.log ? 'log' : 'value', name: name(spec.x), nameLocation: 'middle', nameGap: 26, scale: true, ...f.axis },
    yAxis: { type: spec.y.log ? 'log' : 'value', name: name(spec.y), nameLocation: 'end', nameGap: 8, scale: true, ...f.axis, nameTextStyle: { ...f.axis.nameTextStyle, align: 'left' } },
    series: spec.series.map((s) => {
      const c = s.color ?? palette[s.colorIndex % palette.length];
      return {
        type: 'scatter',
        name: s.name,
        symbolSize: 9 * f.fs,
        itemStyle: { color: fade(c, 0.85) },
        data: s.points.map((p) => ({ value: [p.x, p.y], point: p, ...(p.nd ? { itemStyle: { color: f.ink.surface, borderColor: c, borderWidth: 1.6 } } : {}) })),
      };
    }),
  } as EChartsCoreOption;
}
