import type { EChartsCoreOption } from 'echarts/core';
import type { GuidelineSet, Parameter, Rule, Site } from '../db/types';
import type { DataIndex } from '../lib/dataIndex';
import { resultsFor } from '../lib/dataIndex';
import { guidelineFor } from '../lib/guidelines';
import { convert, unitLabel } from '../lib/units';
import { fmtNum } from '../lib/values';
import { formatDate, MONTH_SHORT, toUtcMs } from '../lib/dates';
import { statLabel } from '../lib/stats';
import { INK, SERIES_DARK, SERIES_LIGHT, STATUS } from '../theme';

export interface ChartPoint {
  t: number;
  v: number;
  nd: boolean;
  text: string;
  date: string;
}
export interface ChartSeries {
  id: string;
  name: string;
  colorIndex: number;
  points: ChartPoint[];
}
export interface ChartLine {
  value: number;
  label: string;
  kind: 'limit' | 'trigger' | 'guideline';
}
export interface ChartSpec {
  title: string;
  subtitle?: string;
  unit: string;
  series: ChartSeries[];
  lines: ChartLine[];
  log: boolean;
  hasNd: boolean;
  xMin?: number;
  xMax?: number;
}

export interface ChartInput {
  index: DataIndex;
  param: Parameter;
  sites: Site[]; // all project sites in order (for stable colours)
  siteIds: string[]; // [] = all with data
  start?: string;
  end?: string;
  guidelineSets: GuidelineSet[];
  rules: Rule[];
  showRules: boolean;
  log?: boolean;
  title?: string;
  subtitle?: string;
}

const isLimitLevel = (level: string) => /limit/i.test(level);

export function buildChartSpec(input: ChartInput): ChartSpec {
  const { index, param, sites } = input;
  const unit = param.unit;
  const siteOrder = new Map(sites.map((s, i) => [s.id, i]));
  const wanted = input.siteIds.length ? input.siteIds : sites.map((s) => s.id);
  const series: ChartSeries[] = [];
  let hasNd = false;
  for (const sid of wanted) {
    const site = sites.find((s) => s.id === sid);
    if (!site) continue;
    const pts: ChartPoint[] = [];
    for (const r of resultsFor(index, param.id, [sid], input.start, input.end)) {
      const v = convert(r.value, r.unit, unit);
      if (v === null) continue;
      if (input.log && v <= 0) continue;
      const nd = r.qualifier === '<';
      hasNd ||= nd;
      pts.push({ t: toUtcMs(r.date), v, nd, text: `${r.qualifier ? r.qualifier + ' ' : ''}${fmtNum(v)}`, date: r.date });
    }
    if (pts.length) series.push({ id: sid, name: site.code, colorIndex: siteOrder.get(sid) ?? 0, points: pts });
  }

  const lines: ChartLine[] = [];
  const addLine = (value: number | undefined, label: string, kind: ChartLine['kind']) => {
    if (value === undefined || !Number.isFinite(value)) return;
    if (input.log && value <= 0) return;
    const same = lines.find((l) => Math.abs(l.value - value) < 1e-12 && l.kind === kind);
    if (same) same.label = `${same.label} / ${label}`;
    else lines.push({ value, label, kind });
  };
  for (const set of input.guidelineSets) {
    const g = guidelineFor(set, param.id, unit);
    if (!g) continue;
    const suffix = g.hardness ? ' at 30 mg/L hardness' : '';
    if (g.max !== undefined) addLine(g.max, `${set.shortName} ${fmtNum(g.max)}${suffix}`, 'guideline');
    if (g.min !== undefined) addLine(g.min, `${set.shortName} min ${fmtNum(g.min)}`, 'guideline');
  }
  if (input.showRules) {
    for (const r of input.rules) {
      if (!r.active || r.parameterId !== param.id || r.kind === 'change' || r.kind === 'guideline') continue;
      if (r.siteIds.length && !r.siteIds.some((id) => wanted.includes(id))) continue;
      const ru = r.unit || unit;
      const kind = isLimitLevel(r.level) ? 'limit' : 'trigger';
      const prefix = r.kind === 'statistic' ? `${r.level} (${statLabel(r.statistic ?? 'mean', r.percentile)})` : r.level;
      if (r.operator === 'outside') {
        addLine(convert(r.min ?? NaN, ru, unit) ?? undefined, `${prefix} min ${fmtNum(r.min)}`, kind);
        addLine(convert(r.max ?? NaN, ru, unit) ?? undefined, `${prefix} max ${fmtNum(r.max)}`, kind);
      } else addLine(convert(r.value ?? NaN, ru, unit) ?? undefined, `${prefix} ${fmtNum(r.value)}`, kind);
    }
  }
  const siteNames = series.map((s) => s.name).join(', ');
  const xs = series.flatMap((s) => s.points.map((p) => p.t));
  return {
    title: input.title ?? param.name,
    subtitle: input.subtitle ?? siteNames,
    unit,
    series,
    lines,
    log: !!input.log,
    hasNd,
    xMin: input.start && input.start > '1901' ? toUtcMs(input.start) : xs.length ? Math.min(...xs) : undefined,
    xMax: input.end && input.end < '2199' ? toUtcMs(input.end) : xs.length ? Math.max(...xs) : undefined,
  };
}

export interface RenderOpts {
  dark?: boolean;
  forExport?: boolean;
  showTitle?: boolean;
  fontScale?: number;
}

function utcDate(ms: number) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/** ECharts option following the dataviz mark specs: 2px lines, 8px markers with a surface ring, hairline grid. */
export function chartOption(spec: ChartSpec, opts: RenderOpts = {}): EChartsCoreOption {
  const ink = opts.dark && !opts.forExport ? INK.dark : INK.light;
  const palette = opts.dark && !opts.forExport ? SERIES_DARK : SERIES_LIGHT;
  const fs = opts.fontScale ?? 1;
  const showTitle = opts.showTitle ?? true;
  const unitText = unitLabel(spec.unit);
  const multi = spec.series.length > 1;
  const top = (showTitle ? (spec.subtitle ? 46 : 30) : 8) + (multi ? 26 : 0);
  const values = spec.series.flatMap((s) => s.points.map((p) => p.v));
  const dataMax = Math.max(0, ...values);
  const lineMax = Math.max(0, ...spec.lines.map((l) => l.value));
  // Start the axis at zero unless the data sit far from it (e.g. pH 6–9, temperature)
  const lo = Math.min(...values, ...spec.lines.map((l) => l.value));
  const hi = Math.max(dataMax, lineMax);
  const zeroBased = !(Number.isFinite(lo) && lo > 0 && lo > 0.5 * hi);
  const step = niceStep((hi - (Number.isFinite(lo) ? lo : 0)) / 5 || 1);
  const lineColor = (k: ChartLine['kind']) => (k === 'limit' ? STATUS.critical : k === 'trigger' ? STATUS.serious : ink.secondary);
  const series: unknown[] = spec.series.map((s) => {
    const color = palette[s.colorIndex % palette.length];
    return {
      type: 'line',
      name: s.name,
      showSymbol: true,
      symbol: 'circle',
      symbolSize: 8,
      lineStyle: { width: 2, color, cap: 'round', join: 'round' },
      itemStyle: { color, borderColor: ink.surface, borderWidth: 2 },
      emphasis: { focus: 'series', scale: 1.4 },
      connectNulls: true,
      z: 3,
      data: s.points.map((p) => ({
        value: [p.t, p.v],
        meta: p,
        itemStyle: p.nd ? { color: ink.surface, borderColor: color, borderWidth: 2 } : undefined,
      })),
    };
  });
  if (spec.lines.length) {
    series.push({
      type: 'line',
      name: '__thresholds',
      data: [],
      silent: true,
      markLine: {
        silent: true,
        symbol: 'none',
        animation: false,
        data: spec.lines.map((l) => ({
          yAxis: l.value,
          lineStyle: { type: [6, 4], width: 1.5, color: lineColor(l.kind) },
          label: { formatter: `${l.label} ${unitText}`, position: 'insideEndTop', color: ink.secondary, fontSize: 10.5 * fs, backgroundColor: ink.surface, padding: [1, 3], borderRadius: 2 },
        })),
      },
    });
  }
  const graphics: unknown[] = [];
  if (spec.hasNd) {
    graphics.push({
      type: 'text',
      left: 4,
      bottom: 2,
      style: { text: '○ Hollow markers: below detection limit (plotted at the limit)', fill: ink.muted, fontSize: 10 * fs },
    });
  }
  return {
    useUTC: true,
    animation: !opts.forExport,
    backgroundColor: ink.surface,
    textStyle: { fontFamily: 'Roboto, system-ui, -apple-system, "Segoe UI", Arial, sans-serif' },
    title: showTitle
      ? {
          text: spec.title,
          subtext: spec.subtitle,
          left: 0,
          top: 0,
          textStyle: { fontSize: 14 * fs, fontWeight: 600, color: ink.primary },
          subtextStyle: { fontSize: 11.5 * fs, color: ink.secondary },
          itemGap: 4,
        }
      : undefined,
    legend: multi
      ? {
          top: showTitle ? (spec.subtitle ? 44 : 28) : 4,
          left: 0,
          data: spec.series.map((s) => s.name),
          icon: 'path://M0,0 L24,0 L24,4 L0,4 Z',
          itemWidth: 18,
          itemHeight: 3,
          itemGap: 14,
          textStyle: { color: ink.secondary, fontSize: 11.5 * fs },
        }
      : undefined,
    grid: { left: 8, right: 16, top: top + 12, bottom: spec.hasNd ? 34 : 18, containLabel: true },
    tooltip: opts.forExport
      ? undefined
      : {
          trigger: 'axis',
          axisPointer: { type: 'line', lineStyle: { color: ink.axis, width: 1 } },
          backgroundColor: opts.dark ? '#262624' : '#ffffff',
          borderColor: opts.dark ? '#383835' : '#e1e0d9',
          textStyle: { color: ink.primary, fontSize: 12 },
          formatter: (params: Array<{ seriesName: string; color: string; data: { meta?: ChartPoint } }>) => {
            const rows = params.filter((p) => p.data?.meta);
            if (!rows.length) return '';
            const date = formatDate(rows[0].data.meta!.date, { time: true });
            const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
            return (
              `<div style="font-size:11px;color:${ink.secondary};margin-bottom:4px">${esc(date)}</div>` +
              rows
                .map(
                  (p) =>
                    `<div style="display:flex;align-items:center;gap:8px"><span style="display:inline-block;width:14px;height:2px;background:${p.color}"></span><b style="font-variant-numeric:tabular-nums">${esc(p.data.meta!.text)}</b> <span style="color:${ink.secondary}">${esc(unitText)} · ${esc(p.seriesName)}</span></div>`,
                )
                .join('')
            );
          },
        },
    xAxis: {
      type: 'time',
      min: spec.xMin,
      max: spec.xMax,
      axisLine: { lineStyle: { color: ink.axis } },
      axisTick: { lineStyle: { color: ink.axis } },
      axisLabel: {
        color: opts.forExport ? ink.secondary : ink.muted,
        fontSize: 11 * fs,
        hideOverlap: true,
        formatter: (val: number) => {
          // floating dates are fed as UTC (useUTC: true), so read them back in UTC
          const d = utcDate(val);
          const m = +d.slice(5, 7), day = +d.slice(8, 10);
          if (m === 1 && day === 1) return d.slice(0, 4);
          if (day === 1) return MONTH_SHORT[m - 1];
          return `${day} ${MONTH_SHORT[m - 1]}`;
        },
      },
      splitLine: { show: false },
    },
    yAxis: {
      type: spec.log ? 'log' : 'value',
      name: unitText,
      nameLocation: 'end',
      nameGap: 10,
      nameTextStyle: { color: ink.secondary, fontSize: 11 * fs, align: 'left' },
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: opts.forExport ? ink.secondary : ink.muted, fontSize: 11 * fs, formatter: (v: number) => fmtNum(v) },
      splitLine: { lineStyle: { color: ink.grid, width: 1, type: 'solid' } },
      max: spec.log ? undefined : zeroBased ? (v: { max: number }) => niceMax(Math.max(v.max, lineMax, dataMax) * 1.08) : Math.ceil((hi + step * 0.3) / step) * step,
      min: spec.log ? undefined : zeroBased ? (v: { min: number }) => (v.min >= 0 ? 0 : v.min) : Math.floor((lo - step * 0.3) / step) * step,
    },
    graphic: graphics,
    series,
  };
}

function niceStep(raw: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(Math.abs(raw) || 1)));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

function niceMax(v: number): number {
  if (!(v > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  const step = n <= 1 ? 1 : n <= 1.2 ? 1.2 : n <= 1.5 ? 1.5 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 3 ? 3 : n <= 4 ? 4 : n <= 5 ? 5 : n <= 6 ? 6 : n <= 8 ? 8 : 10;
  return step * p;
}
