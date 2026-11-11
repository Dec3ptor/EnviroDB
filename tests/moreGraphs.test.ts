import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, ensureBuiltIns } from '../src/db/db';
import { createDemoProject } from '../src/db/demo';
import type { ReportTemplate } from '../src/db/types';
import type { ProjectBundle } from '../src/lib/analysis';
import { boxSummary, pearson, rankOf, spearman } from '../src/lib/stats';
import { comparePaired, pairByDate, type TrendPoint } from '../src/lib/trends';
import { buildChartSpec, type ChartSpec } from '../src/charts/timeSeries';
import { boxOption, boxSpec, correlationText, pairOption, pairSpec, pairVerdict, roundRange, xyOption, xySpec } from '../src/charts/moreGraphs';
import { buildReport } from '../src/reports/build';
import { loadBundle } from './helpers';

describe('a box plot’s numbers', () => {
  it('quartiles and median; whiskers to the furthest values within 1.5 box-heights; the rest are outliers', () => {
    const b = boxSummary([1, 2, 3, 4, 5, 6, 7, 8, 9, 40])!;
    expect(b).toMatchObject({ n: 10, min: 1, max: 40, median: 5.5, q1: 3.25, q3: 7.75 });
    // 1.5 × (7.75 − 3.25) = 6.75 beyond the box: up to 14.5, so 40 is out
    expect([b.low, b.high]).toEqual([1, 9]);
    expect(b.outliers).toEqual([40]);
    expect(boxSummary([])).toBeNull();
    expect(boxSummary([NaN, Infinity])).toBeNull();
    expect(boxSummary([5])).toMatchObject({ n: 1, min: 5, q1: 5, median: 5, q3: 5, max: 5, low: 5, high: 5, outliers: [] });
    // the same values every time: a flat box, no outliers
    expect(boxSummary([2, 2, 2, 2])).toMatchObject({ q1: 2, q3: 2, low: 2, high: 2, outliers: [] });
    // quartiles the NPS-FM way (Hazen)
    expect(boxSummary([1, 2, 3, 4], 'hazen')).toMatchObject({ q1: 1.5, median: 2.5, q3: 3.5 });
    expect(boxSummary([1, 2, 3, 4], 'excel')).toMatchObject({ q1: 1.75, median: 2.5, q3: 3.25 });
  });
});

describe('how two things go together', () => {
  it('ranks (ties share the mean), Pearson and Spearman', () => {
    expect(rankOf([10, 30, 20, 30])).toEqual([1, 3.5, 2, 3.5]);
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 12);
    expect(pearson([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1, 12);
    expect(pearson([1, 2], [1, 2])).toBeNull();
    expect(pearson([1, 2, 3], [5, 5, 5])).toBeNull();
    // steadily rising, though not in a straight line: Spearman is 1, Pearson isn't
    const x = [1, 2, 3, 4, 5];
    const y = [1, 10, 100, 1000, 10000];
    expect(spearman(x, y)).toBeCloseTo(1, 12);
    expect(pearson(x, y)!).toBeLessThan(0.95);
    // by the textbook formula 1 − 6 Σd² / (n (n² − 1)): Σd² = 4 over 5 pairs → 0.8; Σd² = 8 → 0.6
    expect(spearman([1, 2, 3, 4, 5], [2, 1, 4, 3, 5])).toBeCloseTo(0.8, 12);
    expect(spearman([1, 2, 3, 4, 5], [3, 1, 2, 5, 4])).toBeCloseTo(0.6, 12);
  });

  it('in words', () => {
    expect(correlationText(0.86, 30)).toBe('very strong relationship (Spearman rₛ = 0.86) – they rise together');
    expect(correlationText(-0.45, 30)).toBe('moderate relationship (Spearman rₛ = -0.45) – one falls as the other rises');
    expect(correlationText(0.05, 30)).toBe('little or no relationship (Spearman rₛ = 0.05)');
    expect(correlationText(null, 2)).toBe('too few to say how they go together');
    expect(correlationText(null, 0)).toBe('no samples with both');
  });
});

describe('an axis out to round numbers', () => {
  it('about five steps of 1, 2 or 5 times a power of ten', () => {
    expect(roundRange(2.4, 146.1)).toEqual([0, 150]);
    expect(roundRange(6.75, 7.65)).toEqual([6.6, 7.8]);
    expect(roundRange(0, 100)).toEqual([0, 100]);
    expect(roundRange(0.003, 0.0171)).toEqual([0, 0.02]);
    expect(roundRange(-12, 31)).toEqual([-20, 40]);
    // one value: a range around it all the same
    expect(roundRange(5, 5)).toEqual([4, 6]);
  });
});

describe('results paired by date', () => {
  const pt = (date: string, value: number, nd = false): TrendPoint => ({ date, value, nd });
  it('each downstream result with the nearest upstream one within the days allowed, each used once', () => {
    const up = [pt('2026-01-05', 1), pt('2026-02-03', 2), pt('2026-03-10', 3)];
    const down = [pt('2026-01-05T11:00', 5), pt('2026-02-04', 6), pt('2026-02-05', 7), pt('2026-03-20', 8)];
    expect(pairByDate(up, down, 1).map(([u, d]) => [u.value, d.value])).toEqual([[1, 5], [2, 6]]);
    expect(pairByDate(up, down, 0).map(([u, d]) => [u.value, d.value])).toEqual([[1, 5]]);
    expect(pairByDate(up, down, 14).map(([u, d]) => [u.value, d.value])).toEqual([[1, 5], [2, 6], [3, 8]]);
    // the comparison is of the same pairs
    expect(comparePaired(up, down, 1).n).toBe(2);
  });
});

describe('graphs of a project’s results', () => {
  let b: ProjectBundle;
  let spec: ChartSpec;
  beforeAll(async () => {
    await ensureBuiltIns();
    b = await loadBundle(await createDemoProject());
    spec = buildChartSpec({ index: b.index, param: b.paramMap.get('tss')!, sites: b.sites, siteIds: [], guidelineSets: [], rules: b.rules, setMap: b.setMap, showRules: true });
  });

  it('by site: a box for each site with results, the limits across', () => {
    const box = boxSpec(spec, b.project.ndHandling, b.project.percentileMethod);
    expect(box.boxes.map((x) => x.name)).toEqual(spec.series.map((s) => s.name));
    for (const x of box.boxes) {
      const s = spec.series.find((y) => y.id === x.siteId)!;
      expect(x.n).toBe(s.points.length);
      expect(x.min).toBeLessThanOrEqual(x.q1);
      expect(x.q1).toBeLessThanOrEqual(x.median);
      expect(x.median).toBeLessThanOrEqual(x.q3);
      expect(x.q3).toBeLessThanOrEqual(x.max);
      expect(x.low).toBeGreaterThanOrEqual(x.min);
      expect(x.high).toBeLessThanOrEqual(x.max);
      expect(x.outliers.length + s.points.filter((p) => p.v >= x.low && p.v <= x.high).length).toBe(x.n);
    }
    expect(box.lines).toBe(spec.lines);
    expect(box.subtitle).toMatch(/^\d+ \w+ 20\d\d – \d+ \w+ 20\d\d$/);
    const option = boxOption(box, { forExport: true }) as { series: Array<{ type: string; data: unknown[]; markLine?: { data: unknown[] } }>; xAxis: { data: string[] } };
    expect(option.series[0].type).toBe('boxplot');
    expect(option.series[0].data).toHaveLength(box.boxes.length);
    expect(option.xAxis.data[0]).toBe(`${box.boxes[0].name}\nn = ${box.boxes[0].n}`);
    if (box.lines.length) expect(option.series[0].markLine!.data.length).toBeGreaterThan(0);
    // a result below detection counts as the project counts it
    const one: ChartSpec = { ...spec, series: [{ id: 's', name: 'S', colorIndex: 0, points: [{ t: 0, v: 4, nd: true, text: '< 4', date: '2026-01-01' }, { t: 1, v: 10, nd: false, text: '10', date: '2026-02-01' }] }] };
    expect(boxSpec(one, 'half').boxes[0]).toMatchObject({ min: 2, max: 10, nd: 1 });
    expect(boxSpec(one, 'dl').boxes[0].min).toBe(4);
    expect(boxSpec(one, 'zero').boxes[0].min).toBe(0);
    // on a log scale a value of nothing can't be shown
    expect(boxSpec({ ...one, log: true }, 'zero').boxes[0]).toMatchObject({ n: 1, min: 10 });
  });

  it('downstream against upstream: the pairs, and what they show', () => {
    const up = b.sites.find((s) => s.code === 'US1')!;
    const down = b.sites.find((s) => s.code === 'DS1')!;
    const pair = pairSpec({ index: b.index, param: b.paramMap.get('tss')!, up, down, days: 1 });
    expect(pair.points.length).toBe(pair.comparison.n);
    expect(pair.points.length).toBeGreaterThan(10);
    expect(pair.subtitle).toBe(pairVerdict(pair.comparison, pair.unit));
    expect(pair.subtitle).toMatch(/^\d+ pairs · median [\d.]+ upstream, [\d.]+ downstream mg\/L · /);
    const option = pairOption(pair, { forExport: true }) as { series: Array<{ type: string; data: unknown[] }>; xAxis: { min: number; max: number; name: string }; yAxis: { min: number; max: number; name: string } };
    // both axes the same, the line of no change corner to corner
    expect([option.xAxis.min, option.xAxis.max]).toEqual([option.yAxis.min, option.yAxis.max]);
    expect(option.series[0].data).toEqual([[option.xAxis.min, option.xAxis.min], [option.xAxis.max, option.xAxis.max]]);
    expect(option.series[1].data).toHaveLength(pair.points.length);
    expect(option.xAxis.name).toBe('US1 (mg/L)');
    expect(option.yAxis.name).toBe('DS1 (mg/L)');
    // the same site against itself on another day: nothing pairs on the same day twice
    expect(pairSpec({ index: b.index, param: b.paramMap.get('tss')!, up, down: b.sites.find((s) => s.code === 'GW1')!, days: 0 }).subtitle).toMatch(/pairs?|No results on the same days/);
  });

  it('the comparison in words', () => {
    const base = { n: 24, upMedian: 0.8, downMedian: 1.4, medianDiff: 0.6, higherDown: 0.9, bothNd: 0 };
    expect(pairVerdict({ ...base, p: 0.0031, verdict: 'higher' }, 'mg/L')).toBe('24 pairs · median 0.8 upstream, 1.4 downstream mg/L · higher downstream (p = 0.003)');
    expect(pairVerdict({ ...base, p: 0.4, verdict: 'no-difference' }, 'mg/L')).toBe('24 pairs · median 0.8 upstream, 1.4 downstream mg/L · no significant difference (p = 0.40)');
    expect(pairVerdict({ ...base, p: 0.00001, verdict: 'lower' }, '')).toBe('24 pairs · median 0.8 upstream, 1.4 downstream · lower downstream (p < 0.001)');
    expect(pairVerdict({ ...base, n: 1, p: null, verdict: 'too-few' }, 'NTU')).toBe('1 pair · median 0.8 upstream, 1.4 downstream NTU · too few pairs to test');
    expect(pairVerdict({ ...base, n: 0, p: null, verdict: 'too-few' }, 'NTU')).toBe('No results on the same days at both sites');
  });

  it('one against another: each sample that has both, by site', () => {
    const x = b.paramMap.get('turbidity')!;
    const y = b.paramMap.get('tss')!;
    const xy = xySpec({ index: b.index, x, y, sites: b.sites, siteIds: [], nd: b.project.ndHandling });
    expect(xy.title).toBe('Total Suspended Solids against Turbidity');
    expect(xy.n).toBe(xy.series.reduce((n, s) => n + s.points.length, 0));
    expect(xy.n).toBeGreaterThan(30);
    expect(xy.rs).not.toBeNull();
    expect(xy.subtitle).toMatch(new RegExp(`^${xy.n} samples with both · `));
    // only the sites chosen
    const one = xySpec({ index: b.index, x, y, sites: b.sites, siteIds: [b.sites[0].id], nd: b.project.ndHandling });
    expect(one.series.map((s) => s.name)).toEqual([b.sites[0].code]);
    // a site keeps its colour whichever are shown
    expect(one.series[0].colorIndex).toBe(xy.series.find((s) => s.siteId === b.sites[0].id)!.colorIndex);
    const option = xyOption(xy, { forExport: true }) as { series: Array<{ type: string; name: string; data: unknown[] }>; xAxis: { name: string; type: string }; legend?: unknown };
    expect(option.series.map((s) => s.name)).toEqual(xy.series.map((s) => s.name));
    expect(option.xAxis).toMatchObject({ name: 'Turbidity (NTU)', type: 'value' });
    expect(!!option.legend).toBe(xy.series.length > 1);
    expect((xyOption(xySpec({ index: b.index, x, y, sites: b.sites, siteIds: [], nd: 'half', logX: true, logY: true })) as { xAxis: { type: string }; yAxis: { type: string } }).xAxis.type).toBe('log');
    // nothing in common: no points, and it says so
    const none = xySpec({ index: b.index, x, y: { ...y, id: 'nope' }, sites: b.sites, siteIds: [], nd: 'half' });
    expect(none).toMatchObject({ n: 0, rs: null, series: [] });
    expect(none.subtitle).toBe('0 samples with both · no samples with both');
  });

  it('a report’s graphs can be box plots', () => {
    const template: ReportTemplate = { id: 't', name: 'T', orientation: 'portrait', pageSize: 'A4', marginMm: 20, fontSize: 10, accent: '#0f766e', headerText: '', footerText: '', numbering: true, updatedAt: '', blocks: [{ id: 'c', type: 'chart', graph: 'box', parameterIds: ['tss'], siteIds: [], range: 'all', showGuidelines: false, guidelineSetIds: null, showRules: true, logScale: false, widthCm: 16, heightCm: 8 }] };
    const seen: Array<{ series: Array<{ type: string }> }> = [];
    const doc = buildReport({ bundle: b, template, period: { start: '2026-01-01', end: '2026-12-31', label: '2026' }, settings: { ...DEFAULT_SETTINGS }, renderChart: (option) => (seen.push(option as never), 'data:image/png;base64,AAAA') });
    expect(doc.nodes.filter((n) => n.t === 'image')).toHaveLength(1);
    expect(seen[0].series[0].type).toBe('boxplot');
    // and over time, as before
    const time = { ...template, blocks: [{ ...template.blocks[0], graph: undefined }] } as ReportTemplate;
    seen.length = 0;
    buildReport({ bundle: b, template: time, period: { start: '2026-01-01', end: '2026-12-31', label: '2026' }, settings: { ...DEFAULT_SETTINGS }, renderChart: (option) => (seen.push(option as never), 'data:image/png;base64,AAAA') });
    expect(seen[0].series[0].type).not.toBe('boxplot');
  });
});
