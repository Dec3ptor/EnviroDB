import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, db, ensureBuiltIns } from '../src/db/db';
import { createDemoProject } from '../src/db/demo';
import { BUILT_IN_TEMPLATES } from '../src/data/templates';
import { readWorkbook } from '../src/importers/workbook';
import { dailyValues, findContinuous, guessKind, overlayFor, rainAround, seriesDays, seriesRange, toYears, unitOf } from '../src/lib/continuous';
import { addSeriesDays, deleteSeries } from '../src/db/continuous';
import { chartOption, chartOverlay } from '../src/charts/timeSeries';
import { buildReport } from '../src/reports/build';
import type { ChartBlock, ReportTemplate } from '../src/db/types';
import { snapshotBundle, snapshotContent } from '../src/lib/issued';
import { loadBundle } from './helpers';
import { buildPackData } from '../src/pack/model';

const csv = async (text: string) => readWorkbook(new TextEncoder().encode(text).buffer as ArrayBuffer, 'gauge.csv');

describe('reading a gauge’s file', () => {
  it('finds 15-minute rainfall and makes daily totals (a midnight reading is the day before’s)', async () => {
    const grids = await csv(['Site: Kowhai at Quarry Rd', 'Time,Rainfall (mm)', '05/03/2024 23:45:00,1.5', '06/03/2024 00:00:00,0.5', '06/03/2024 00:15:00,2', '06/03/2024 10:00:00,3', '07/03/2024 09:00:00,0'].join('\n'));
    const t = findContinuous(grids)!;
    expect(t.columns).toHaveLength(1);
    expect(t.columns[0]).toMatchObject({ name: 'Rainfall', unit: 'mm', kind: 'rainfall', count: 5 });
    expect(t.subDaily).toBe(true);
    const days = dailyValues(grids[t.sheet], t, t.columns[0].col, 'rainfall');
    expect([...days]).toEqual([
      ['2024-03-05', { v: 2 }],
      ['2024-03-06', { v: 5 }],
      ['2024-03-07', { v: 0 }],
    ]);
  });

  it('reads NIWA CliFlo’s layout: its dates, the amount, not the station or period', async () => {
    const grids = await csv(['Station information:', 'Name,Agent Number', 'Hamilton Aws,26117', '', 'Station,Date(NZST),Amount(mm),Period(Hrs),Freq', 'Hamilton Aws,20240301:0900,4.2,24,D', 'Hamilton Aws,20240302:0900,0,24,D', 'Hamilton Aws,20240303:0900,12.6,24,D'].join('\n'));
    const t = findContinuous(grids)!;
    expect(t.columns.map((c) => c.name)).toEqual(['Amount']);
    expect(t.columns[0].kind).toBe('rainfall');
    const days = dailyValues(grids[t.sheet], t, t.columns[0].col, 'rainfall');
    expect(days.get('2024-03-03')).toEqual({ v: 12.6 });
  });

  it('reads flow with separate date and time columns: the daily mean and highest', async () => {
    const grids = await csv(['Date,Time,Flow [m3/s],Quality', '2024-07-01,06:00,1.2,600', '2024-07-01,18:00,3.4,600', '2024-07-02,06:00,2,600'].join('\n'));
    const t = findContinuous(grids)!;
    expect(t.timeCol).toBe(1);
    expect(t.columns.map((c) => [c.name, c.unit, c.kind])).toEqual([['Flow', 'm³/s', 'flow']]);
    const days = dailyValues(grids[t.sheet], t, t.columns[0].col, 'flow');
    expect(days.get('2024-07-01')).toEqual({ v: 2.3, hi: 3.4 });
  });

  it('guesses what the records are', () => {
    expect(guessKind('Stage', 'm')).toBe('level');
    expect(guessKind('Value', 'mm')).toBe('rainfall');
    expect(guessKind('Discharge', 'L/s')).toBe('flow');
    expect(unitOf('Amount(mm)')).toBe('mm');
    expect(findContinuous([])).toBeNull();
  });

  it('keeps daily values by year, merges new days, and says how wet it was around a sample', () => {
    const first = new Map([
      ['2023-12-30', { v: 4 }],
      ['2024-01-01', { v: 10 }],
      ['2024-01-02', { v: 2 }],
    ]);
    let years = toYears('p', 's', first);
    expect(years.map((y) => [y.id, y.v.length])).toEqual([
      ['s|2023', 365],
      ['s|2024', 366],
    ]);
    years = toYears('p', 's', new Map([['2024-01-02', { v: 5 }], ['2024-01-04', { v: 1 }]]), years);
    expect(seriesDays(years)).toEqual([
      ['2023-12-30', 4],
      ['2024-01-01', 10],
      ['2024-01-02', 5],
      ['2024-01-04', 1],
    ]);
    expect(seriesRange(years)).toEqual({ first: '2023-12-30', last: '2024-01-04', days: 4 });
    expect(rainAround(years, '2024-01-02T10:30')).toEqual({ day: 5, before: 14, complete: false });
    expect(rainAround(years, '2024-01-04').before).toBe(15);
    expect(seriesDays(years, '2024-01-01', '2024-01-02')).toHaveLength(2);
  });
});

describe('rainfall in the project', () => {
  let projectId: string;
  beforeAll(async () => {
    await ensureBuiltIns();
    projectId = await createDemoProject();
  });

  it('is kept, added to, shown behind graphs and in reports, and kept with issued reports', async () => {
    const days = new Map<string, { v: number }>();
    for (let i = 0; i < 400; i++) {
      const d = new Date(Date.UTC(2025, 6, 1) + i * 864e5).toISOString().slice(0, 10);
      days.set(d, { v: i % 9 === 0 ? 30 : i % 3 === 0 ? 2 : 0 });
    }
    const s = await addSeriesDays(projectId, days, { name: 'Quarry rain gauge', kind: 'rainfall', unit: 'mm', source: 'gauge.csv' });
    expect(s).toMatchObject({ first: '2025-07-01', last: '2026-08-04' });
    expect(await db.seriesDays.where('seriesId').equals(s.id).count()).toBe(2);
    const more = await addSeriesDays(projectId, new Map([['2026-08-05', { v: 7 }]]), { name: '', kind: 'rainfall', unit: 'mm', source: 'more.csv' }, s);
    expect(more).toMatchObject({ id: s.id, name: 'Quarry rain gauge', last: '2026-08-05', source: 'gauge.csv; more.csv' });

    const b = await loadBundle(projectId);
    const o = overlayFor('kind:rainfall', b.continuous)!;
    expect(o.series.id).toBe(s.id);
    // behind a graph: bars hanging from the top on their own axis
    const overlay = chartOverlay(o.series, o.years, '2025-07-01', '2026-06-30');
    expect(overlay.points.every(([, v]) => v > 0)).toBe(true);
    const opt = chartOption({ title: 'TSS', unit: 'mg/L', series: [], lines: [], log: false, hasNd: false, overlay }) as { yAxis: Array<{ inverse?: boolean; position?: string }>; series: Array<{ type: string; yAxisIndex?: number }> };
    expect(opt.yAxis).toHaveLength(2);
    expect(opt.yAxis[1]).toMatchObject({ inverse: true, position: 'right' });
    expect(opt.series.some((x) => x.type === 'bar' && x.yAxisIndex === 1)).toBe(true);

    // a report's graphs with the rain gauge behind them
    const annual = BUILT_IN_TEMPLATES.find((t) => t.id === 'tpl-annual')! as ReportTemplate;
    const chart: ChartBlock = { id: 'g', type: 'chart', parameterIds: ['tss'], siteIds: [], range: 'period', showGuidelines: false, guidelineSetIds: null, showRules: true, logScale: false, widthCm: 16, heightCm: 8, overlay: 'kind:rainfall' };
    const template = { ...annual, blocks: [chart] };
    const options: unknown[] = [];
    const period = { start: '2025-07-01', end: '2026-06-30', label: '2025/26' };
    buildReport({ bundle: b, template, period, settings: DEFAULT_SETTINGS, renderChart: (opt) => (options.push(opt), 'data:image/png;base64,') });
    expect(options).toHaveLength(1);
    expect((options[0] as { series: Array<{ type: string }> }).series.some((x) => x.type === 'bar')).toBe(true);

    // an issued report keeps the records its graphs show
    const content = snapshotContent({ bundle: b, template, period, settings: DEFAULT_SETTINGS, issuedOn: '2026-07-20' });
    expect(content.continuous?.series.map((x) => x.name)).toEqual(['Quarry rain gauge']);
    expect(overlayFor('kind:rainfall', snapshotBundle(content).continuous)?.years.length).toBe(2);
    expect(snapshotContent({ bundle: b, template: annual, period, settings: DEFAULT_SETTINGS, issuedOn: '2026-07-20' }).continuous).toBeUndefined();

    // and in the client data pack: a value a day over its dates
    const pack = buildPackData(b, { overlay: `series:${s.id}` }, { version: 1, made: '2026-10-19', app: '1.9.0' });
    expect(pack.overlay).toMatchObject({ name: 'Quarry rain gauge', unit: 'mm', kind: 'rainfall', start: '2025-07-01' });
    expect(pack.overlay!.v[9]).toBe(30);
    expect(buildPackData(b, {}, { version: 1, made: '2026-10-19', app: '1.9.0' }).overlay).toBeUndefined();

    await deleteSeries(s.id);
    expect(await db.seriesDays.where('seriesId').equals(s.id).count()).toBe(0);
  });
});
