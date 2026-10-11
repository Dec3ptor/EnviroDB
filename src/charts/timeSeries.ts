import type { EChartsCoreOption } from 'echarts/core';
import type { GuidelineSet, Parameter, Rule, Site } from '../db/types';
import type { DataIndex } from '../lib/dataIndex';
import { resultsFor } from '../lib/dataIndex';
import { guidelineFor } from '../lib/guidelines';
import { convert, unitLabel } from '../lib/units';
import { fmtNum } from '../lib/values';
import { formatDate, MONTH_SHORT, toUtcMs } from '../lib/dates';
import { statLabel } from '../lib/stats';
import { INK, SERIES_DARK, SERIES_LIGHT } from '../theme';

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
  /** One line per value; a range (e.g. pH 6–9) has two. */
  values: number[];
  /** Text for the key, with the unit, e.g. "Limit 100 mg/L (Condition 8(a))". */
  text: string;
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

  const u = unitLabel(unit);
  const lines: ChartLine[] = [];
  const usable = (v: number | null | undefined): v is number => v !== undefined && v !== null && Number.isFinite(v) && (!input.log || v > 0);
  /** Add a line (or the two lines of a range); values are in the chart's unit. */
  const addLine = (lo: number | null | undefined, hi: number | null | undefined, name: string, kind: ChartLine['kind'], note = '') => {
    const values = [lo, hi].filter(usable);
    if (!values.length) return;
    const valueText = usable(lo) && usable(hi) ? `${fmtNum(lo)}–${fmtNum(hi)}` : usable(lo) ? `min ${fmtNum(lo)}` : fmtNum(hi!);
    const text = `${name} ${valueText} ${u}${note ? ` (${note})` : ''}`;
    const same = lines.find((l) => l.kind === kind && l.values.length === values.length && l.values.every((v, i) => Math.abs(v - values[i]) < 1e-12));
    if (same) same.text = `${same.text}; ${text}`;
    else lines.push({ values, text, kind });
  };
  for (const set of input.guidelineSets) {
    const g = guidelineFor(set, param.id, unit);
    if (g) addLine(g.min, g.max, set.shortName, 'guideline', g.hardness ? 'at 30 mg/L hardness' : '');
  }
  if (input.showRules) {
    const multiSite = series.length > 1;
    for (const r of input.rules) {
      if (!r.active || r.parameterId !== param.id || r.kind === 'change' || r.kind === 'guideline') continue;
      if (r.siteIds.length && !r.siteIds.some((id) => wanted.includes(id))) continue;
      const ru = r.unit || unit;
      const kind = isLimitLevel(r.level) ? 'limit' : 'trigger';
      const name = r.kind === 'statistic' ? `${r.level} (${statLabel(r.statistic ?? 'mean', r.percentile)})` : r.level;
      const at = multiSite && r.siteIds.length ? `at ${r.siteIds.map((id) => sites.find((s) => s.id === id)?.code ?? '').filter(Boolean).join(', ')}` : '';
      const note = [r.condition, at].filter(Boolean).join(', ');
      const inUnit = (v: number | undefined) => (v === undefined ? undefined : convert(v, ru, unit));
      if (r.operator === 'outside') addLine(inUnit(r.min), inUnit(r.max), name, kind, note);
      else addLine(undefined, inUnit(r.value), name, kind, note);
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
  /** Width of the chart in px, so the legend and key wrap to fit (unknown: one key entry per row). */
  width?: number;
}

const FONT = 'Roboto, system-ui, -apple-system, "Segoe UI", Arial, sans-serif';

/**
 * Limit / trigger / guideline line colours: red, amber and grey, stepped in lightness so they stay apart for
 * colour-blind readers and in grey-scale print (checked with the dataviz palette validator, all pairs).
 */
const LINE_COLORS = {
  light: { limit: '#d03b3b', trigger: '#d99400', guideline: '#3d3c39' },
  dark: { limit: '#e5534b', trigger: '#f2b632', guideline: '#e9e8e3' },
};
/** Each kind has its own dash pattern (null = solid); a second line of the same kind takes the next one. */
const DASHES: Record<ChartLine['kind'], Array<number[] | null>> = {
  limit: [null, [14, 4], [14, 4, 3, 4]],
  trigger: [[7, 4], [7, 3, 2, 3], [3, 3]],
  guideline: [[0.1, 4.5], [10, 3, 0.1, 3, 0.1, 3], [5, 6]],
};

export interface ThresholdStyle {
  text: string;
  values: number[];
  color: string;
  dash: number[] | null;
}

/** The threshold lines in key order – limits, triggers, then guidelines – each with its colour and dash pattern. */
export function thresholdStyles(lines: ChartLine[], dark = false): ThresholdStyle[] {
  const colors = dark ? LINE_COLORS.dark : LINE_COLORS.light;
  return (['limit', 'trigger', 'guideline'] as const).flatMap((kind) =>
    lines.filter((l) => l.kind === kind).map((l, i) => ({ text: l.text, values: l.values, color: colors[kind], dash: DASHES[kind][i % DASHES[kind].length] })),
  );
}

let measureCtx: CanvasRenderingContext2D | null | undefined;
/** Width of a line of text in px: measured in the browser, estimated elsewhere. */
function textWidth(text: string, px: number): number {
  if (measureCtx === undefined) {
    try {
      measureCtx = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
    } catch {
      measureCtx = null;
    }
  }
  if (!measureCtx) return text.length * px * 0.6;
  measureCtx.font = `${px}px ${FONT}`;
  return measureCtx.measureText(text).width * 1.04; // a little spare in case the web font isn't loaded yet
}

/** Pack items into rows no wider than `width`; one per row when the width is unknown. */
function packRows(widths: number[], width: number | undefined, gap: number): number[][] {
  const rows: number[][] = [];
  let x = 0;
  widths.forEach((w, i) => {
    if (width && rows.length && x + gap + w <= width) {
      rows[rows.length - 1].push(i);
      x += gap + w;
    } else {
      rows.push([i]);
      x = w;
    }
  });
  return rows;
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
  const avail = opts.width ? opts.width - 16 : undefined;
  // site legend at the top, wrapped to the width
  const legendFont = 11.5 * fs;
  const legendRows = multi ? packRows(spec.series.map((s) => 18 + 5 + textWidth(s.name, legendFont)), avail, 14).length : 0;
  const top = (showTitle ? (spec.subtitle ? 46 : 30) : 8) + (multi ? 26 * legendRows : 0);
  const values = spec.series.flatMap((s) => s.points.map((p) => p.v));
  const lineValues = spec.lines.flatMap((l) => l.values);
  const dataMax = Math.max(0, ...values);
  const lineMax = Math.max(0, ...lineValues);
  // Start the axis at zero unless the data sit far from it (e.g. pH 6–9, temperature)
  const lo = Math.min(...values, ...lineValues);
  const hi = Math.max(dataMax, lineMax);
  const zeroBased = !(Number.isFinite(lo) && lo > 0 && lo > 0.5 * hi);
  const step = niceStep((hi - (Number.isFinite(lo) ? lo : 0)) / 5 || 1);
  const styles = thresholdStyles(spec.lines, opts.dark && !opts.forExport);

  // The key below the plot: a sample of each threshold line with its label (never drawn over the data), and the
  // hollow marker used for results below the detection limit.
  const keyFont = 11 * fs;
  const rowH = Math.round(17 * fs);
  const swatch = 28;
  const keyItems = [
    ...styles.map((s) => ({ text: s.text, w: swatch, line: s })),
    ...(spec.hasNd ? [{ text: 'Below detection limit (plotted at the limit)', w: 12, line: null }] : []),
  ];
  const keyRows = packRows(
    keyItems.map((it) => it.w + 6 + textWidth(it.text, keyFont)),
    avail,
    18,
  );
  const keyH = keyRows.length ? keyRows.length * rowH + 4 : 0;
  const graphics: unknown[] = [];
  keyRows.forEach((row, r) => {
    let x = 8;
    for (const i of row) {
      const it = keyItems[i];
      const mid = rowH / 2;
      const w = it.w + 6 + textWidth(it.text, keyFont);
      graphics.push({
        type: 'group',
        left: x,
        bottom: 4 + (keyRows.length - 1 - r) * rowH,
        silent: true,
        children: [
          { type: 'rect', shape: { x: 0, y: 0, width: w, height: rowH }, style: { fill: 'transparent' } },
          it.line
            ? { type: 'line', shape: { x1: 1, y1: mid, x2: it.w - 1, y2: mid }, style: { stroke: it.line.color, lineWidth: 2, lineDash: it.line.dash ?? undefined, lineCap: 'round' } }
            : { type: 'circle', shape: { cx: 6, cy: mid, r: 3.5 }, style: { fill: ink.surface, stroke: ink.secondary, lineWidth: 2 } },
          { type: 'text', x: it.w + 6, y: mid, style: { text: it.text, fill: ink.secondary, font: `${keyFont}px ${FONT}`, verticalAlign: 'middle' } },
        ],
      });
      x += w + 18;
    }
  });
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
  if (styles.length) {
    series.push({
      type: 'line',
      name: '__thresholds',
      data: [],
      silent: true,
      z: 2, // under the data
      markLine: {
        silent: true,
        symbol: 'none',
        animation: false,
        precision: 20, // ECharts rounds marker values to 2 decimals by default, which put 0.013 mg/L at 0.01
        label: { show: false },
        data: styles.flatMap((s) => s.values.map((v) => ({ yAxis: v, lineStyle: { type: s.dash ?? 'solid', width: 2, color: s.color, cap: 'round' } }))),
      },
    });
  }
  return {
    useUTC: true,
    animation: !opts.forExport,
    backgroundColor: ink.surface,
    textStyle: { fontFamily: FONT },
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
          width: avail,
          data: spec.series.map((s) => s.name),
          icon: 'path://M0,0 L24,0 L24,4 L0,4 Z',
          itemWidth: 18,
          itemHeight: 3,
          itemGap: 14,
          textStyle: { color: ink.secondary, fontSize: legendFont },
        }
      : undefined,
    grid: { left: 8, right: 16, top: top + 12, bottom: keyH + 10, containLabel: true },
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
