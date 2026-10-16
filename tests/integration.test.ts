import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { db, DEFAULT_SETTINGS, ensureBuiltIns } from '../src/db/db';
import { createDemoProject } from '../src/db/demo';
import { evaluateAll } from '../src/lib/analysis';
import { loadBundle } from './helpers';
import { buildReport, usableWidthMm } from '../src/reports/build';
import { toPdfDefinition } from '../src/reports/pdf';
import { docxBlob } from '../src/reports/docx';
import { BUILT_IN_TEMPLATES } from '../src/data/templates';
import { readWorkbook } from '../src/importers/workbook';
import { planSheets, parseWithPlan } from '../src/importers/detect';
import { buildParamIndex, matchParameter, matchSite } from '../src/lib/matching';
import { normUnit } from '../src/lib/units';
import { fmtNum } from '../src/lib/values';
import { analyteMapKey, PROVISIONAL_NOTE } from '../src/importers/model';
import { commitImport } from '../src/importers/commit';
import { exportProjectPackage, importProjectPackage } from '../src/db/backup';
import { AI_PROMPTS, DEFAULT_SECTIONS, buildAiInput, csvCell, withRequest } from '../src/lib/aiInput';
import { flagResults, pivot } from '../src/lib/analysis';
import { applyView, DEFAULT_SORT, passesFilter } from '../src/lib/tableView';
import { monthLabel, reviewCell, reviewLines, roundPeriods, samplingRounds } from '../src/lib/latest';
import { nextDueReport } from '../src/lib/schedule';
import { newObligation, newProject, newSite, saveProject, saveSite } from '../src/db/repo';
import { buildChartSpec, chartOption, thresholdStyles } from '../src/charts/timeSeries';
import * as echarts from 'echarts';


let projectId = '';
beforeAll(async () => {
  await ensureBuiltIns();
  projectId = await createDemoProject();
});

describe('demo project', () => {
  it('evaluates consent rules', async () => {
    const b = await loadBundle(projectId);
    const evals = evaluateAll(b, '2023-07-01', '2026-06-30');
    expect(evals).toHaveLength(7);
    const tss = evals.find((e) => e.rule.name === 'Discharge TSS limit')!;
    expect(tss.status).toBe('exceeded');
    expect(tss.exceedances.every((x) => (x.value ?? 0) > 100)).toBe(true);
    const turb = evals.find((e) => e.rule.kind === 'change')!;
    expect(turb.assessed).toBeGreaterThan(20);
    const metals = evals.find((e) => e.rule.kind === 'guideline')!;
    expect(metals.assessed).toBeGreaterThan(50);
  });

  it('builds the annual report and converts it to PDF and Word definitions', async () => {
    const b = await loadBundle(projectId);
    const doc = buildReport({ bundle: b, template: BUILT_IN_TEMPLATES[0], period: { start: '2024-07-01', end: '2025-06-30', label: '2024/25' }, settings: { ...DEFAULT_SETTINGS, author: 'Test Author', company: 'Test Co' } });
    const kinds = doc.nodes.map((n) => n.t);
    expect(kinds[0]).toBe('title');
    expect(kinds.filter((k) => k === 'table').length).toBeGreaterThan(5);
    expect(kinds).toContain('image');
    const summary = doc.nodes.find((n) => n.t === 'p' && n.runs[0].text.startsWith('During the period'));
    expect(summary).toBeTruthy();
    const headings = doc.nodes.filter((n) => n.t === 'h').map((n) => (n.t === 'h' ? `${n.number ?? ''} ${n.text}` : ''));
    expect(headings[0]).toBe('1 Introduction');
    const dd = toPdfDefinition(doc);
    expect(Array.isArray(dd.content) && dd.content.length).toBeGreaterThan(20);
    const blob = await docxBlob(doc);
    expect(blob.size).toBeGreaterThan(5000);
  });

  it('keeps every report table within the page width (model and PDF)', async () => {
    const b = await loadBundle(projectId);
    for (const template of BUILT_IN_TEMPLATES) {
      const doc = buildReport({ bundle: b, template, period: { start: '2023-07-01', end: '2026-06-30', label: 'all' }, settings: DEFAULT_SETTINGS });
      // each table must fit the pages it is on (sections can be on landscape pages)
      let usable = usableWidthMm(template);
      let tables = 0;
      for (const n of doc.nodes) {
        if (n.t === 'pagebreak' && n.orientation) usable = usableWidthMm(template, n.orientation);
        if (n.t !== 'table') continue;
        tables++;
        const fixed = n.widths.reduce<number>((s, w) => s + (typeof w === 'number' ? w : 0), 0);
        expect(fixed, `${template.name}: ${n.caption}`).toBeLessThanOrEqual(usable + 0.5);
      }
      expect(tables).toBeGreaterThan(0);
      // pdfmake adds 3pt padding each side plus a 0.4pt rule to every column
      const def = toPdfDefinition(doc);
      const pt = (o: 'portrait' | 'landscape') => (usableWidthMm(template, o) * 72) / 25.4;
      let contentPt = pt(def.pageOrientation ?? template.orientation);
      const walk = (x: unknown): void => {
        if (Array.isArray(x)) return x.forEach(walk);
        if (!x || typeof x !== 'object') return;
        const o = x as { table?: { widths: Array<number | string> }; stack?: unknown[] };
        if (o.table) {
          const total = o.table.widths.reduce<number>((s, w) => s + (typeof w === 'number' ? w : 40) + 6.4, 0.4);
          expect(total).toBeLessThanOrEqual(contentPt + 1);
        }
        if (o.stack) walk(o.stack);
      };
      for (const item of def.content as Array<{ pageOrientation?: 'portrait' | 'landscape' }>) {
        if (item.pageOrientation) contentPt = pt(item.pageOrientation);
        walk(item);
      }
    }
  });

  it('limits a whole report to chosen sites (e.g. groundwater only)', async () => {
    const b = await loadBundle(projectId);
    const code = (c: string) => b.sites.find((s) => s.code === c)!.id;
    const annual = BUILT_IN_TEMPLATES.find((x) => x.id === 'tpl-annual')!;
    const period = { start: '2025-07-01', end: '2026-06-30', label: '2025/26' };
    const doc = buildReport({ bundle: b, template: annual, period, settings: DEFAULT_SETTINGS, siteIds: [code('GW1')] });
    const tables = doc.nodes.filter((n): n is Extract<typeof n, { t: 'table' }> => n.t === 'table');
    const text = JSON.stringify(doc.nodes);
    // every table and the summary are about GW1 only
    expect(tables.filter((t) => /Monitoring results/.test(t.caption ?? '')).map((t) => t.caption)).toEqual([expect.stringContaining('GW1')]);
    expect(tables.find((t) => t.caption?.includes('Monitoring sites'))!.body.map((r) => r[0].text)).toEqual(['GW1']);
    expect(tables.find((t) => t.caption?.includes('Compliance with consent'))!.body.map((r) => r[0].text)).toEqual(['Condition 14']); // the groundwater ammonia trigger
    for (const other of ['DP1', 'DS1', 'US1']) expect(text).not.toContain(other);
    expect((doc.nodes.find((n) => n.t === 'title') as { details: Array<[string, string]> }).details).toContainEqual(['Sites covered', 'GW1']);
    // a downstream rule is still assessed against an upstream site that isn't in the report
    const ds = buildReport({ bundle: b, template: annual, period, settings: DEFAULT_SETTINGS, siteIds: [code('DS1')] });
    const comp = ds.nodes.find((n): n is Extract<typeof n, { t: 'table' }> => n.t === 'table' && !!n.caption?.includes('Compliance with consent'))!;
    const turbidity = comp.body.find((r) => r[0].text === 'Condition 10')!;
    expect(turbidity.at(-1)!.text).toBe('Exceeded');
    // every site chosen = the normal report
    const all = buildReport({ bundle: b, template: annual, period, settings: DEFAULT_SETTINGS, siteIds: b.sites.map((s) => s.id) });
    expect((all.nodes.find((n) => n.t === 'title') as { details: Array<[string, string]> }).details.map(([k]) => k)).not.toContain('Sites covered');
  });

  it('limits a results table to chosen samples (filtered Data tab exports)', async () => {
    const b = await loadBundle(projectId);
    const dp1 = b.sites.find((s) => s.code === 'DP1')!;
    const picked = b.samples.filter((s) => s.siteId === dp1.id && s.date >= '2025-07-01' && s.date < '2026-07-01').slice(0, 2);
    const template = { ...BUILT_IN_TEMPLATES[0], blocks: [{ id: 'r', type: 'resultsTable' as const, siteIds: [], parameterIds: ['tss'], layout: 'parametersAsColumns' as const, guidelineSetIds: null, highlight: true, splitBySite: false, sampleIds: picked.map((s) => s.id) }] };
    const doc = buildReport({ bundle: b, template, period: { start: '2025-07-01', end: '2026-06-30', label: 'x' }, settings: DEFAULT_SETTINGS });
    const table = doc.nodes.find((n) => n.t === 'table');
    const sampleRows = table && table.t === 'table' ? table.body.filter((row) => row[1]?.text === 'DP1') : [];
    expect(sampleRows).toHaveLength(2);
  });

  it('round-trips a project package', async () => {
    const pkg = await exportProjectPackage(projectId);
    const copyId = await importProjectPackage(pkg);
    expect(copyId).not.toBe(projectId);
    const a = await db.results.where('projectId').equals(projectId).count();
    const c = await db.results.where('projectId').equals(copyId).count();
    expect(c).toBe(a);
    const copy = await db.projects.get(copyId);
    expect(copy?.name).toMatch(/\(imported\)$/);
    const rules = await db.rules.where('projectId').equals(copyId).toArray();
    const sites = new Set((await db.sites.where('projectId').equals(copyId).toArray()).map((s) => s.id));
    expect(rules.every((r) => r.siteIds.every((id) => sites.has(id)))).toBe(true);
  });
});

describe('report due next', () => {
  it('picks the same report every time when two are due on the same day', async () => {
    const [a, q] = ['tpl-annual', 'tpl-quarterly'].map((id) => newObligation(projectId, { templateId: id }));
    // the 2025/26 annual report and the Jul–Sep 2026 quarterly summary are both due 31 Oct 2026
    const annualOb = { ...a, firstPeriodStart: '2024-07-01', firstPeriodEnd: '2025-06-30', firstDueDate: '2025-10-31', submissions: [{ periodStart: '2024-07-01', periodEnd: '2025-06-30', submittedOn: '2025-10-20' }] };
    const quarterlyOb = { ...q, name: 'Quarterly data summary', every: 3, unit: 'month' as const, firstPeriodStart: '2026-07-01', firstPeriodEnd: '2026-09-30', firstDueDate: '2026-10-31' };
    for (const list of [[annualOb, quarterlyOb], [quarterlyOb, annualOb]]) {
      const next = nextDueReport(list, '2026-10-11');
      expect(next?.obligation.templateId).toBe('tpl-annual');
      expect(next?.period.dueDate).toBe('2026-10-31');
    }
  });
});

describe('graph limit, trigger and guideline lines', () => {
  it('styles every line differently and keeps their labels in a key below the plot', async () => {
    const b = await loadBundle(projectId);
    const chart = (pid: string, sets: string[] = []) =>
      buildChartSpec({ index: b.index, param: b.paramMap.get(pid)!, sites: b.sites, siteIds: [], guidelineSets: sets.map((id) => b.setMap.get(id)!), rules: b.rules, showRules: true });
    const tss = chart('tss');
    expect(tss.lines.map((l) => [l.kind, l.text])).toEqual([
      ['limit', 'Limit 100 mg/L (Condition 8(a), at DP1)'],
      ['trigger', 'Trigger 1 50 mg/L (Condition 9, at DP1)'],
    ]);
    // a range is one key entry with two lines
    expect(chart('ph').lines).toEqual([{ kind: 'limit', values: [6, 9], text: 'Limit 6–9 pH units (Condition 8(b), at DP1)' }]);
    // two guideline sets, in the chart's unit
    const zn = chart('zn-d', ['anzg-fw-95', 'anzg-fw-99']);
    expect(zn.lines.map((l) => l.text)).toEqual([expect.stringMatching(/^ANZG FW 95% 0\.008 \S+ \(at 30 mg\/L hardness\)$/), expect.stringMatching(/^ANZG FW 99% 0\.0024 \S+ \(at 30 mg\/L hardness\)$/)]);

    // no two lines look the same (colour + dash pattern)
    const styles = thresholdStyles([...tss.lines, ...zn.lines]);
    expect(styles.map((s) => s.text.split(' ')[0])).toEqual(['Limit', 'Trigger', 'ANZG', 'ANZG']); // limits first, then triggers, then guidelines
    expect(new Set(styles.map((s) => `${s.color} ${JSON.stringify(s.dash)}`)).size).toBe(styles.length);

    // nothing is written over the data; the key wraps to the width
    type Opt = { series: Array<{ name: string; markLine?: { label: { show: boolean }; data: Array<{ label?: unknown }> } }>; graphic: Array<{ bottom: number }>; grid: { bottom: number } };
    const wide = chartOption(tss, { forExport: true, width: 1200 }) as unknown as Opt;
    const ml = wide.series.find((s) => s.name === '__thresholds')!.markLine!;
    expect(ml.label.show).toBe(false);
    expect(ml.data.some((d) => d.label)).toBe(false);
    expect(JSON.stringify(wide.graphic)).toContain('Limit 100 mg/L (Condition 8(a), at DP1)');
    const rows = (o: Opt) => new Set(o.graphic.map((g) => g.bottom)).size;
    const narrow = chartOption(tss, { forExport: true, width: 360 }) as unknown as Opt;
    expect(rows(wide)).toBe(1);
    expect(rows(narrow)).toBeGreaterThan(1);
    expect(narrow.grid.bottom).toBeGreaterThan(wide.grid.bottom); // the plot makes room for the key
  });

  it('fits the axes to the sites shown when one is switched off in the key', async () => {
    const b = await loadBundle(projectId);
    const spec = buildChartSpec({ index: b.index, param: b.paramMap.get('ec')!, sites: b.sites, siteIds: [], guidelineSets: [], rules: b.rules, showRules: false });
    expect(spec.series.length).toBeGreaterThan(1);
    const top = [...spec.series].sort((x, y) => Math.max(...y.points.map((p) => p.v)) - Math.max(...x.points.map((p) => p.v)))[0];
    const yMax = (hidden: Set<string>) => {
      const chart = echarts.init(null as unknown as HTMLElement, undefined, { renderer: 'svg', ssr: true, width: 600, height: 300 });
      try {
        const opt = chartOption(spec, { forExport: true, width: 600, hidden }) as { legend?: Array<{ selected?: Record<string, boolean> }> | { selected?: Record<string, boolean> } };
        chart.setOption({ ...(opt as object), animation: false });
        const legend = Array.isArray(opt.legend) ? opt.legend[0] : opt.legend;
        if (hidden.size) expect(legend?.selected?.[top.name]).toBe(false);
        return (chart as unknown as { getModel(): { getComponent(t: string): { axis: { scale: { getExtent(): [number, number] } } } } }).getModel().getComponent('yAxis').axis.scale.getExtent()[1];
      } finally {
        chart.dispose();
      }
    };
    const all = yMax(new Set());
    const without = yMax(new Set([top.name]));
    const othersMax = Math.max(...spec.series.filter((x) => x !== top).flatMap((x) => x.points.map((p) => p.v)));
    expect(without).toBeLessThan(all);
    expect(without).toBeGreaterThanOrEqual(othersMax);
  });

  it('draws small guideline values exactly where they belong (not rounded to 2 decimals)', async () => {
    const b = await loadBundle(projectId);
    const as = buildChartSpec({ index: b.index, param: b.paramMap.get('as-d')!, sites: b.sites, siteIds: [], guidelineSets: [b.setMap.get('anzg-fw-95')!, b.setMap.get('anzg-fw-99')!], rules: b.rules, showRules: true });
    expect(as.lines.flatMap((l) => l.values).map((v) => +v.toFixed(6))).toEqual([0.013, 0.0008]);
    const chart = echarts.init(null as unknown as HTMLElement, undefined, { renderer: 'svg', ssr: true, width: 600, height: 300 });
    try {
      chart.setOption({ ...(chartOption(as, { forExport: true, width: 600 }) as object), animation: false });
      const drawn = [...chart.renderToSVGString().matchAll(/<path d="M[\d.]+ ([\d.]+)L[\d.]+ [\d.]+"[^>]*stroke-dasharray/g)].map((m) => +m[1]).filter((y) => y > 20); // skip the key samples
      const expected = [0.013, 0.0008].map((v) => chart.convertToPixel({ yAxisIndex: 0 }, v) as number);
      expect(drawn.length).toBe(2);
      drawn.forEach((y, i) => expect(Math.abs(y - expected[i])).toBeLessThan(1));
    } finally {
      chart.dispose();
    }
  });
});

describe('copy for AI input', () => {
  const opts = { start: '2025-07-01', end: '2026-06-30', siteIds: [] as string[], paramIds: [] as string[], sections: DEFAULT_SECTIONS, hideNames: false, today: '2026-10-11' };

  it('packages the project, conditions, compliance, guidelines, statistics and results', async () => {
    const b = await loadBundle(projectId);
    const pack = buildAiInput(b, opts);
    const t = pack.text;
    if (process.env.AI_INPUT_DUMP) writeFileSync(process.env.AI_INPUT_DUMP, withRequest(t, AI_PROMPTS[1].text));
    expect(t.startsWith('# Environmental monitoring data – Demo – Kōwhai Quarry stormwater discharge\n')).toBe(true);
    for (const h of ['## How to read this data', '## Project', '## Monitoring sites', '## Consent conditions and triggers', '## Compliance assessment', '### Exceedances', '## Guideline values', '## Summary statistics', '## Monitoring schedule', '## Reporting obligations', '## Results'])
      expect(t, h).toContain(h);
    expect(t).toContain('Exceeded when: Total Suspended Solids > 100 mg/L at DP1');
    expect(t).toContain('The change is the percentage increase over the US1 result from the same day.');
    expect(t).toMatch(/\| Discharge TSS limit \(Condition 8\(a\)\) \| Limit \| Exceeded \| \d+ of 12 results exceeded \(DP1\)/);
    expect(t).toMatch(/\| 2026-03-\d\d \d\d:\d\d \| DP1 \| Total Suspended Solids \| 141 mg\/L \| > 100 mg\/L \| Discharge TSS limit \|/);
    expect(t).toContain('Exceeded when: a result at DS1 is above its ANZG (2018) Freshwater – 95% species protection value (hardness-modified)');
    expect(t).toContain('| Dissolved Zinc | 0.008* | mg/L |');

    // one CSV row per sample, every row with the same number of columns
    const csv = t.slice(t.indexOf('## Results'));
    const lines = csv.slice(csv.indexOf('```csv') + 7, csv.lastIndexOf('```')).trim().split('\n');
    expect(lines[0].startsWith('site,date,pH (field) (pH units),Groundwater Level (m),pH (pH units),')).toBe(true); // field measurements first
    expect(lines.length - 1).toBe(pack.samples);
    const cols = lines[0].split(',').length;
    expect(lines.every((l) => l.split(',').length === cols)).toBe(true);
    expect(lines.some((l) => /,<0\.000\d/.test(l))).toBe(true); // non-detects keep "<"
    const periodSamples = b.samples.filter((s) => s.date >= opts.start && s.date.slice(0, 10) <= opts.end).length;
    expect(pack.samples).toBe(periodSamples);
  });

  it('leaves out names and limits to the selected sites', async () => {
    const b = await loadBundle(projectId);
    const ds1 = b.sites.find((s) => s.code === 'DS1')!;
    const t = buildAiInput(b, { ...opts, hideNames: true, siteIds: [ds1.id] }).text;
    for (const name of ['Kōwhai', 'Demo Aggregates', 'AUTH-123456', 'Demo Regional Council', 'Sediment pond', 'DEMO-001']) expect(t, name).not.toContain(name);
    expect(t.startsWith('# Environmental monitoring data\n')).toBe(true);
    expect(t).not.toContain('Discharge TSS limit'); // DP1-only condition
    expect(t).toContain('Turbidity increase downstream');
    const csv = t.slice(t.indexOf('## Results'));
    const rows = csv.slice(csv.indexOf('```csv') + 7, csv.lastIndexOf('```')).trim().split('\n').slice(1);
    expect(rows.length).toBeGreaterThan(5);
    expect(rows.every((r) => r.startsWith('DS1,'))).toBe(true);

    // names typed into free text (conditions, actions, schedules) are replaced too
    const named = { ...b, rules: b.rules.map((r) => (r.name === 'Discharge TSS limit' ? { ...r, action: 'Notify Demo Regional Council and check the sediment pond outlet.' } : r)) };
    const t2 = buildAiInput(named, { ...opts, hideNames: true }).text;
    expect(t2).toContain('Required response: Notify [regulator] and check the DP1.');
  });

  it('includes only the chosen sections and appends the request last', async () => {
    const b = await loadBundle(projectId);
    const sections = { results: false, stats: true, compliance: false, rules: false, guidelines: false, schedule: false };
    const t = withRequest(buildAiInput(b, { ...opts, sections }).text, '  Which site has the highest zinc?  ');
    expect(t).toContain('## Summary statistics');
    for (const h of ['## Results', '## Compliance assessment', '## Consent conditions', '## Guideline values', '## Monitoring schedule']) expect(t, h).not.toContain(h);
    expect(t.endsWith('## My request\nWhich site has the highest zinc?\n')).toBe(true);
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
  });
});

describe('data table sort and filter', () => {
  it('sorts by a parameter, filters by value, exceedances and text', async () => {
    const b = await loadBundle(projectId);
    const [start, end] = ['2025-07-01', '2026-06-30'];
    const { rows } = pivot(b, { siteIds: [], paramIds: [], start, end });
    const flags = flagResults(b, evaluateAll(b, start, end), b.project.guidelineSetIds, start, end);
    const order = new Map(b.sites.map((s, i) => [s.id, i]));
    const view = (o: Partial<Parameters<typeof applyView>[3]>) => applyView(rows, b.paramMap, flags, { sort: DEFAULT_SORT, filters: [], show: 'all', search: '', ...o }, order);
    const tss = (r: (typeof rows)[number]) => r.cells.get('tss');

    const byTss = view({ sort: { key: 'tss', dir: 'desc' } });
    expect(byTss).toHaveLength(rows.length);
    expect(tss(byTss[0])?.value).toBe(170);
    const withTss = byTss.filter((r) => tss(r));
    expect(byTss.slice(withTss.length).every((r) => !tss(r))).toBe(true); // blanks last
    const vals = withTss.map((r) => r.cells.get('tss')!.value!);
    expect(vals).toEqual([...vals].sort((a, c) => c - a));

    expect(view({ filters: [{ paramId: 'tss', op: '>', value: 100 }] }).map((r) => tss(r)?.value).sort()).toEqual([141, 170]);
    // "<3" is certainly below 5 but can't be said to be above 2
    const nd = rows.find((r) => tss(r)?.qualifier === '<')!;
    expect(passesFilter(nd, { paramId: 'tss', op: '<', value: 5 }, b.paramMap.get('tss'))).toBe(true);
    expect(passesFilter(nd, { paramId: 'tss', op: '>', value: 2 }, b.paramMap.get('tss'))).toBe(false);
    expect(view({ filters: [{ paramId: 'zn-d', op: 'nd' }] }).every((r) => r.cells.get('zn-d')?.qualifier === '<')).toBe(true);

    const limit = view({ show: 'limit' });
    expect(limit.length).toBeGreaterThan(0);
    expect(limit.every((r) => Array.from(r.cells.values()).some((x) => flags.get(x.id)?.kind === 'limit'))).toBe(true);
    expect(view({ show: 'exceed' }).length).toBeGreaterThanOrEqual(limit.length);
    expect(view({ search: 'gw1' }).every((r) => r.site.code === 'GW1')).toBe(true);
    const newest = view({ sort: { key: 'date', dir: 'desc' } });
    expect(newest[0].sample.date >= newest[newest.length - 1].sample.date).toBe(true);
  });
});

describe('monitoring round report', () => {
  it('names months and lists the sampling months as periods', () => {
    expect(monthLabel('2026-09-01', '2026-09-30')).toBe('September 2026');
    expect(monthLabel('2026-08-01', '2026-09-30')).toBe('August – September 2026');
    expect(monthLabel('2025-12-01', '2026-01-31')).toBe('December 2025 – January 2026');
  });

  it("reports the latest round, titled by its month, against each site's earlier results", async () => {
    const b = await loadBundle(projectId);
    const round = roundPeriods(b, 12)[0];
    expect(round.key).toMatch(/^round:\d{4}-\d{2}$/);
    expect(round.start.endsWith('-01')).toBe(true);
    const tpl = BUILT_IN_TEMPLATES.find((t) => t.id === 'tpl-round')!;
    expect(tpl.period).toBe('latestRound');
    const options: unknown[] = [];
    const doc = buildReport({ bundle: b, template: tpl, period: round, settings: DEFAULT_SETTINGS, renderChart: (o) => (options.push(o), 'data:image/png;base64,') });
    const month = monthLabel(round.start, round.end);
    expect((doc.nodes[0] as { subtitle?: string }).subtitle).toBe(`Monitoring results – ${month}`);
    expect(doc.fileName).toContain(month);
    // one comparison table per site sampled that month
    const tables = doc.nodes.filter((n): n is Extract<typeof n, { t: 'table' }> => n.t === 'table' && !!n.caption?.includes('Results compared with earlier monitoring'));
    const sampled = new Set(b.samples.filter((s) => s.date.slice(0, 10) >= round.start && s.date.slice(0, 10) <= round.end).map((s) => s.siteId));
    expect(tables.length).toBe(sampled.size);
    const dp1 = tables.find((t) => t.caption!.includes('DP1'))!;
    const head = dp1.head[0].map((c) => c.text);
    expect(head.slice(-6)).toEqual(['Result', 'Previous', 'Change', 'Earlier median', 'Usual range', 'Note']);
    expect(head).toContain('Limit');
    // the TSS row agrees with the review of that sample
    const site = b.sites.find((s) => s.code === 'DP1')!;
    const sample = b.samples.filter((s) => s.siteId === site.id && s.date.slice(0, 10) >= round.start && s.date.slice(0, 10) <= round.end).sort((x, y) => (x.date < y.date ? 1 : -1))[0];
    const tss = b.paramMap.get('tss')!;
    const cell = reviewCell(b, sample, tss)!;
    const row = dp1.body.find((r) => r[0].text === 'Total Suspended Solids')!.map((c) => c.text);
    const at = (h: string) => row[head.indexOf(h)];
    expect(at('Previous').split('\n')[0]).toBe(cell.previous!.text);
    expect(at('Usual range')).toBe(cell.usual ? `${fmtNum(cell.usual.lo, tss.decimals)}–${fmtNum(cell.usual.hi, tss.decimals)}` : '');
    expect(at('Earlier median')).toBe(cell.median === undefined ? '' : fmtNum(cell.median, tss.decimals));
    expect(tables.at(-1)!.notes!.join(' ')).toMatch(/usual range \(5th–95th percentile\)/); // notes go under the last table
    // graphs shade this round
    expect(options.length).toBeGreaterThan(0);
    expect(JSON.stringify(options[0])).toContain('"name":"__band"');
    expect(doc.nodes.some((n) => n.t === 'image' && /shaded band is the reporting period/.test(n.caption ?? ''))).toBe(true);
  });

  it('lets you choose the columns and how far back to compare', async () => {
    const b = await loadBundle(projectId);
    const round = roundPeriods(b, 12)[0];
    const block = BUILT_IN_TEMPLATES.find((t) => t.id === 'tpl-round')!.blocks.find((x) => x.type === 'roundReview')!;
    const build = (patch: object) => {
      const tpl = { ...BUILT_IN_TEMPLATES.find((t) => t.id === 'tpl-round')!, id: 'x', blocks: [{ ...block, ...patch, ruleColumns: 'none', guidelineSetIds: [] } as typeof block] };
      return buildReport({ bundle: b, template: tpl, period: round, settings: DEFAULT_SETTINGS }).nodes.filter((n): n is Extract<typeof n, { t: 'table' }> => n.t === 'table');
    };
    expect(build({ compare: ['previous'] })[0].head[0].map((c) => c.text)).toEqual(['Parameter', 'Unit', 'Result', 'Previous']);
    // a shorter history gives a usual range from fewer results, or none
    const all = build({ compare: ['range'], historyYears: 0 });
    const oneYear = build({ compare: ['range'], historyYears: 1 });
    expect(all.at(-1)!.notes!.join(' ')).toMatch(/on record/);
    expect(oneYear.at(-1)!.notes!.join(' ')).toMatch(/since \d{1,2} \w{3} \d{4}/);
    expect(JSON.stringify(oneYear.map((t) => t.body))).not.toBe(JSON.stringify(all.map((t) => t.body)));
  });
});

describe('latest results review', () => {
  it('finds rounds and puts each result in the context of the site history', async () => {
    const b = await loadBundle(projectId);
    const rounds = samplingRounds(b);
    expect(rounds[0].key).toBe('latest');
    expect(rounds[0].samples.map((s) => b.siteMap.get(s.siteId)!.code)).toEqual(['US1', 'DP1', 'DS1', 'GW1']);
    expect(rounds[1].key > rounds[2].key).toBe(true); // newest month first
    const may24 = samplingRounds(b, 60).find((r) => r.key === '2024-05')!;
    const dp1 = may24.samples.find((s) => b.siteMap.get(s.siteId)!.code === 'DP1')!;
    const tss = reviewCell(b, dp1, b.paramMap.get('tss')!)!;
    expect(tss.value).toBe(312);
    expect([tss.unusual, tss.record]).toEqual(['high', 'high']);
    expect(tss.previous && tss.previous.date < dp1.date).toBe(true);
    expect(tss.usual!.n).toBeGreaterThanOrEqual(6);
    const lines = reviewLines(tss, b.paramMap.get('tss')!, 'DP1', 'mg/L');
    expect(lines[0]).toMatch(/^Previous: \d+ mg\/L on .+ \(\+\d+(\.\d)?%\)$/);
    expect(lines).toContain('Highest Total Suspended Solids on record at DP1');
    // the very first sample has no history
    const first = b.samples.find((s) => b.siteMap.get(s.siteId)!.code === 'DP1')!;
    const firstCell = reviewCell(b, first, b.paramMap.get('tss')!)!;
    expect([firstCell.previous, firstCell.usual, firstCell.unusual]).toEqual([undefined, undefined, undefined]);
  });
});

describe('importing lab results', () => {
  it("reads Hill's CSV export (SSFC): names left of the units, Windows-1252, lab comments", async () => {
    const buf = readFileSync(new URL('./fixtures/hill-ssfc-synthetic.csv', import.meta.url));
    const grids = await readWorkbook(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '9100001-SSFC-1.csv');
    const params = await db.parameters.toArray();
    const index = buildParamIndex(params);
    const plans = planSheets(grids, index);
    expect(plans[0].mode).toBe('lab');
    const parsed = parseWithPlan(grids, plans);
    expect(parsed.labName).toBe('Hill Laboratories');
    expect(parsed.labJob).toBe('9100001');
    expect(parsed.samples.map((s) => [s.siteText, s.date, s.labNumber])).toEqual([
      ['DP1', '2026-09-28T09:40', '9100001.1'],
      ['DS1', '2026-09-28T10:18', '9100001.2'],
      ['GW1', '2026-10-01T11:45', '9100001.3'],
    ]);
    const [dp1, , gw1] = parsed.samples;
    // analyte names (not the units) with their units; "-" (not tested) is skipped
    expect(dp1.results.map((r) => [r.analyte, r.unit])).toContainEqual(['Total Suspended Solids', 'g/m3']);
    expect(dp1.results.find((r) => r.analyte === 'Escherichia coli')).toMatchObject({ group: 'Faecal Coliforms and E. coli profile', unit: 'MPN / 100mL', parsed: { value: 2, qualifier: '<' } });
    expect(gw1.results.map((r) => r.analyte)).not.toContain('Total Suspended Solids');
    expect(gw1.results.find((r) => r.analyte === 'Bicarbonate')!.unit).toBe('g/m3 at 25°C'); // decoded as Windows-1252
    // every analyte and unit is recognised
    for (const r of parsed.samples.flatMap((s) => s.results)) {
      expect(matchParameter(r.analyte, index, r.group).parameterId, r.analyte).toBeTruthy();
      expect(normUnit(r.unit).known, r.unit).toBe(true);
    }
    // the lab's "#1" comment is kept with the sample it refers to
    expect(dp1.notes).toBe('Lab comment #1 (Faecal Coliforms, Escherichia coli): Example comment: the sample was > 10 °C on receipt at the lab.');
    expect(gw1.notes).toBeUndefined();
  });

  it('reads monitoring-database exports: site and unit rows over the header a column out, status and lab reference columns', async () => {
    // same layout as a real export, with made-up values
    const buf = readFileSync(new URL('./fixtures/monitoring-export-synthetic.csv', import.meta.url));
    const grids = await readWorkbook(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), 'export.csv');
    const params = await db.parameters.toArray();
    const index = buildParamIndex(params);
    const plans = planSheets(grids, index);
    expect(plans[0]).toMatchObject({ mode: 'wide', config: { headerRow: 2, unitRow: 1, shift: 1, siteMode: 'row', siteRow: 0, dateCol: 0, statusCol: 1, labCol: 2 } });
    const parsed = parseWithPlan(grids, plans);
    // the missed round and the rounds still to come are left out, and say so; dates without the 00:00 / 01:00 clock time
    expect(parsed.samples.map((s) => [s.siteText, s.date, s.labNumber, s.status])).toEqual([
      ['Wetland- Outlet SP2- M1', '2025-10-02', '25/90002-01', 'Processed'],
      ['Wetland- Outlet SP2- M1', '2025-11-03', '25/90003-01', 'Processed'],
      ['Wetland- Outlet SP2- M1', '2026-04-07', '26/90004-01', 'At Lab'],
      ['Wetland- Outlet SP2- M1', '2026-05-04', '26/90005-01', 'Processed'],
    ]);
    expect(parsed.warnings.join(' ')).toMatch(/1 row marked as missed.*2 rows still due or waiting.*1 sample was still with the lab/);
    const atLab = parsed.samples[2];
    expect(atLab.provisional).toBe(true);
    expect(atLab.notes).toMatch(new RegExp(`^${PROVISIONAL_NOTE}.*At Lab`));
    expect(parsed.samples[0].provisional).toBeUndefined();
    // every result column is recognised, with the unit written a column to its left; checks and "Completed" columns are not results
    const first = parsed.samples[0];
    const ids = Object.fromEntries(first.results.map((r) => [r.analyte, matchParameter(r.analyte, index).parameterId]));
    expect(ids).toEqual({
      'Alkalinity - Total': 'alkalinity',
      'Ammoniacal Nitrogen as N': 'nh4-n',
      Carbonate: 'co3',
      'Copper - Total': 'cu-t',
      'Electrical Conductivity (EC)': 'ec',
      'pH - onsite reading': 'ph-field',
      'Temperature - onsite reading': 'temp',
      'Total Dissolved Solids - Gravimetric': 'tds',
      'Total Nitrogen (Calculation)': 'tn',
      'Total Oxidised Nitrogen (NO2N + NO3N)': 'nnn',
      'Zinc Soluble': 'zn-d',
    });
    const unit = (a: string) => first.results.find((r) => r.analyte === a)?.unit;
    expect([unit('Alkalinity - Total'), unit('Electrical Conductivity (EC)'), unit('Temperature - onsite reading'), unit('pH - onsite reading')]).toEqual(['g CaCO3/m³', 'µS/cm', 'Deg C', undefined]);
    expect(normUnit('g CaCO3/m³')).toMatchObject({ key: 'g/m3', basis: 'as CaCO3', known: true });
    expect(parsed.samples[1].results.find((r) => r.analyte === 'Carbonate')!.parsed).toMatchObject({ value: 1, qualifier: '<' });
    expect(parsed.samples[1].results.find((r) => r.analyte === 'Zinc Soluble')!.parsed.value).toBe(0.0045);
    expect(atLab.results.map((r) => r.analyte)).not.toContain('Total Dissolved Solids - Gravimetric'); // "No Result"

    // importing it, then the same file once the lab has finished: results replaced and the provisional note gone
    const project = newProject({ name: 'Export test' });
    await saveProject(project);
    const site = newSite(project.id, { code: 'SP2', aliases: ['Wetland- Outlet SP2- M1'] });
    await saveSite(site);
    const mapping = {
      sites: Object.fromEntries(parsed.samples.map((s) => [s.key, matchSite(s.siteText, [site]).siteId])),
      dates: {},
      include: {},
      params: Object.fromEntries(parsed.samples.flatMap((s) => s.results.map((r) => [analyteMapKey(r), matchParameter(r.analyte, index).parameterId]))),
      units: {},
    };
    expect(Object.values(mapping.sites).every((x) => x === site.id)).toBe(true);
    const done = await commitImport(project.id, parsed, mapping, { duplicates: 'replace', rememberAliases: false, fileName: 'export.csv' });
    expect(done.newSamples).toBe(4);
    const stored = await db.samples.where('projectId').equals(project.id).sortBy('date');
    expect(stored[2].notes).toMatch(/^Provisional:/);
    expect(stored.map((s) => s.labNumber)).toEqual(['25/90002-01', '25/90003-01', '26/90004-01', '26/90005-01']);
    const later = readFileSync(new URL('./fixtures/monitoring-export-synthetic.csv', import.meta.url), 'utf8').replace('At Lab,26/90004-01,,No Result', 'Processed,26/90004-01,2026-04-30 10:00:00,0.2');
    const grids2 = await readWorkbook(new TextEncoder().encode(later).buffer, 'export.csv');
    const parsed2 = parseWithPlan(grids2, planSheets(grids2, index));
    expect(parsed2.samples.some((s) => s.provisional)).toBe(false);
    await commitImport(project.id, parsed2, mapping, { duplicates: 'replace', rememberAliases: false, fileName: 'export.csv' });
    const restored = await db.samples.where('projectId').equals(project.id).sortBy('date');
    expect(restored).toHaveLength(4);
    expect(restored[2].notes).toBeUndefined();
  });

  it('imports the Hill-layout example and replaces on re-import', async () => {
    const buf = readFileSync(new URL('../public/samples/example-lab-results-hill-layout.xlsx', import.meta.url));
    const grids = await readWorkbook(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), 'x.xlsx');
    const params = await db.parameters.toArray();
    const parsed = parseWithPlan(grids, planSheets(grids, buildParamIndex(params)));
    const b = await loadBundle(projectId);
    const index = buildParamIndex(params);
    const mapping = {
      sites: Object.fromEntries(parsed.samples.map((s) => [s.key, matchSite(s.siteText, b.sites).siteId])),
      dates: {},
      include: {},
      params: Object.fromEntries(parsed.samples.flatMap((s) => s.results.map((r) => [analyteMapKey(r), matchParameter(r.analyte, index, r.group).parameterId]))),
      units: {},
    };
    expect(Object.values(mapping.sites).every(Boolean)).toBe(true);
    const before = await db.results.where('projectId').equals(projectId).count();
    const first = await commitImport(projectId, parsed, mapping, { duplicates: 'replace', rememberAliases: true, fileName: 'x.xlsx', labName: parsed.labName });
    expect(first.results).toBe(37);
    expect(first.newSamples).toBe(3);
    const second = await commitImport(projectId, parsed, mapping, { duplicates: 'replace', rememberAliases: true, fileName: 'x.xlsx' });
    expect(second.replaced).toBe(37);
    expect(second.newSamples).toBe(0);
    const after = await db.results.where('projectId').equals(projectId).count();
    expect(after - before).toBe(37);
    const third = await commitImport(projectId, parsed, mapping, { duplicates: 'skip', rememberAliases: false, fileName: 'x.xlsx' });
    expect(third.results).toBe(0);
    expect(third.skipped).toBe(37);
    // the imported EC (mS/m) is converted for comparisons; TSS 112 g/m³ breaches the 100 mg/L limit
    const b2 = await loadBundle(projectId);
    const ev = evaluateAll(b2, '2026-03-12', '2026-03-12').find((e) => e.rule.name === 'Discharge TSS limit')!;
    expect(ev.exceedances.map((x) => x.value)).toEqual([112]);
  });
});
