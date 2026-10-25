import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { ensureBuiltIns } from '../src/db/db';
import { createDemoProject } from '../src/db/demo';
import { applyGraphSettings, DEFAULT_GRAPH, followShared, graphSettings, hasOwn, reviveGraphs, reviveOne, shareLook } from '../src/charts/custom';
import { buildChartSpec, chartOption, NOTE_COLOR } from '../src/charts/timeSeries';
import { SERIES_LIGHT } from '../src/theme';
import type { ProjectBundle } from '../src/lib/analysis';
import { loadBundle } from './helpers';

let b: ProjectBundle;
beforeAll(async () => {
  await ensureBuiltIns();
  b = await loadBundle(await createDemoProject());
});
const specFor = (sites = b.sites) => buildChartSpec({ index: b.index, param: b.paramMap.get('ph')!, sites, siteIds: [], guidelineSets: [], rules: [], showRules: false });
type Opt = { series: Array<{ name: string; lineStyle: { width: number; color: string; opacity?: number }; showSymbol: boolean; symbolSize: number; markLine?: { data: Array<Record<string, unknown>> } }>; yAxis: Array<{ name: string; min: unknown; max: unknown }>; legend?: unknown };

describe('customising graphs', () => {
  it('a graph’s own settings sit over the shared ones over the defaults', () => {
    expect(graphSettings({}, undefined)).toEqual(DEFAULT_GRAPH);
    const g = graphSettings({ log: true, look: { kind: 'points', weight: 'bold' } }, { log: false, title: 'pH at the outlet' });
    expect(g).toMatchObject({ log: false, look: { kind: 'points', weight: 'bold' }, title: 'pH at the outlet', rules: true });
    // the look shared from one graph: no title, sites or notes
    expect(Object.keys(shareLook(g)).sort()).toEqual(['fontScale', 'legend', 'log', 'look', 'rules', 'trends', 'yAxis', 'yMax', 'yMin']);
    expect(followShared({ log: false, title: 'x', hidden: ['a'] })).toEqual({ title: 'x', hidden: ['a'] });
    expect(hasOwn({ hidden: [], refLines: [] })).toBe(false);
    expect(hasOwn({ title: 'x' })).toBe(true);
  });

  it('saved settings read back only as far as they make sense', () => {
    expect(reviveOne({ log: 'yes', look: { kind: 'bars', weight: 'bold' }, yAxis: 'set', yMin: 2, yMax: 'x', fontScale: 3, refLines: [{ value: 5, label: 'Baseline' }, { value: 'x' }], events: [{ date: '2026-03-01T00', label: 'Works' }], evil: 1 })).toEqual({
      yAxis: 'set',
      yMin: 2,
      refLines: [{ value: 5, label: 'Baseline' }],
      events: [{ date: '2026-03-01', label: 'Works' }],
    });
    expect(Object.keys(reviveGraphs({ ph: { title: 'pH' }, bad: 'x' })!)).toEqual(['ph']);
    expect(reviveGraphs([1])).toBeUndefined();
  });

  it('applied to a graph: title, sites left off, the axis and the notes', () => {
    const spec = specFor();
    const g = graphSettings({}, { title: 'pH at the stream sites', subtitle: 'Consent AUTH-1', hidden: [b.sites[0].id], yAxis: 'set', yMin: 5, yMax: 10, yLabel: 'pH units', refLines: [{ value: 7, label: 'Neutral' }], events: [{ date: '2026-03-01', label: 'Works' }, { date: 'soon', label: 'bad' }] });
    const out = applyGraphSettings(spec, g);
    expect(out.title).toBe('pH at the stream sites');
    expect(out.subtitle).toBe('Consent AUTH-1');
    expect(out.series.map((s) => s.id)).not.toContain(b.sites[0].id);
    expect(out.series.length).toBe(spec.series.length - 1);
    expect(out.yRange).toEqual({ min: 5, max: 10 });
    expect(out.events).toEqual([{ date: '2026-03-01', label: 'Works' }]);
    const opt = chartOption(out, { forExport: true, width: 600 }) as unknown as Opt;
    expect(opt.yAxis[0]).toMatchObject({ name: 'pH units', min: 5, max: 10 });
    const notes = opt.series.find((s) => s.name === '__notes')!.markLine!.data;
    expect(notes).toHaveLength(2);
    expect(notes[0]).toMatchObject({ yAxis: 7, label: { formatter: 'Neutral', color: NOTE_COLOR } });
    expect(notes[1]).toMatchObject({ xAxis: Date.UTC(2026, 2, 1), label: { formatter: 'Works' } });
    // "from zero" fixes only the bottom
    expect(applyGraphSettings(spec, graphSettings({}, { yAxis: 'zero' })).yRange).toEqual({ min: 0 });
    expect(applyGraphSettings(spec, graphSettings({}, { yAxis: 'auto', yMin: 5 })).yRange).toBeUndefined();
  });

  it('the look: points only, bold, no legend, larger text', () => {
    const spec = specFor();
    const plain = chartOption(spec, { forExport: true, width: 600 }) as unknown as Opt;
    expect(plain.series[0]).toMatchObject({ showSymbol: true, symbolSize: 8, lineStyle: { width: 2 } });
    expect(plain.legend).toBeDefined();
    const out = applyGraphSettings(spec, graphSettings({}, { look: { kind: 'points', weight: 'bold' }, legend: 'none', fontScale: 1.25 }));
    const opt = chartOption(out, { forExport: true, width: 600 }) as unknown as Opt;
    expect(opt.series[0]).toMatchObject({ showSymbol: true, symbolSize: 10, lineStyle: { width: 0, opacity: 0 } });
    expect(opt.legend).toBeUndefined();
    const linesOnly = chartOption(applyGraphSettings(spec, graphSettings({}, { look: { kind: 'linesOnly', weight: 'light' } })), { forExport: true, width: 600 }) as unknown as Opt;
    expect(linesOnly.series[0]).toMatchObject({ showSymbol: false, lineStyle: { width: 1.25 } });
  });

  it('a site’s own colour is used on the graph; otherwise its place in the list', () => {
    const sites = b.sites.map((s, i) => (i === 1 ? { ...s, colour: '#123456' } : s));
    const spec = specFor(sites);
    expect(spec.series.find((s) => s.id === sites[1].id)?.color).toBe('#123456');
    expect(spec.series.find((s) => s.id === sites[0].id)?.color).toBeUndefined();
    const opt = chartOption(spec, { forExport: true, width: 600 }) as unknown as Opt;
    expect(opt.series.find((s) => s.name === sites[1].code)?.lineStyle.color).toBe('#123456');
    expect(opt.series.find((s) => s.name === sites[0].code)?.lineStyle.color).toBe(SERIES_LIGHT[0]);
  });
});
