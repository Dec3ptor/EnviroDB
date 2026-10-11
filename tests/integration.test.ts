import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { db, DEFAULT_SETTINGS, ensureBuiltIns } from '../src/db/db';
import { createDemoProject } from '../src/db/demo';
import { buildIndex } from '../src/lib/dataIndex';
import { evaluateAll, type ProjectBundle } from '../src/lib/analysis';
import { buildReport, usableWidthMm } from '../src/reports/build';
import { toPdfDefinition } from '../src/reports/pdf';
import { docxBlob } from '../src/reports/docx';
import { BUILT_IN_TEMPLATES } from '../src/data/templates';
import { readWorkbook } from '../src/importers/workbook';
import { planSheets, parseWithPlan } from '../src/importers/detect';
import { buildParamIndex, matchParameter, matchSite } from '../src/lib/matching';
import { analyteMapKey } from '../src/importers/model';
import { commitImport } from '../src/importers/commit';
import { exportProjectPackage, importProjectPackage } from '../src/db/backup';
import { AI_PROMPTS, DEFAULT_SECTIONS, buildAiInput, csvCell, withRequest } from '../src/lib/aiInput';
import { flagResults, pivot } from '../src/lib/analysis';
import { applyView, DEFAULT_SORT, passesFilter } from '../src/lib/tableView';
import { reviewCell, reviewLines, samplingRounds } from '../src/lib/latest';

async function loadBundle(projectId: string): Promise<ProjectBundle> {
  const project = (await db.projects.get(projectId))!;
  const sites = (await db.sites.where('projectId').equals(projectId).toArray()).sort((a, b) => a.order - b.order);
  const samples = (await db.samples.where('projectId').equals(projectId).toArray()).sort((a, b) => (a.date < b.date ? -1 : 1));
  const results = await db.results.where('projectId').equals(projectId).toArray();
  const params = (await db.parameters.toArray()).sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999));
  const sets = await db.guidelineSets.toArray();
  return {
    project,
    sites,
    siteMap: new Map(sites.map((s) => [s.id, s])),
    samples,
    params,
    paramMap: new Map(params.map((p) => [p.id, p])),
    guidelineSets: sets,
    setMap: new Map(sets.map((s) => [s.id, s])),
    rules: (await db.rules.where('projectId').equals(projectId).toArray()).sort((a, b) => a.order - b.order),
    notes: await db.notes.where('projectId').equals(projectId).toArray(),
    schedules: await db.schedules.where('projectId').equals(projectId).toArray(),
    obligations: await db.obligations.where('projectId').equals(projectId).toArray(),
    index: buildIndex(samples, results, sites, params),
  };
}

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
      const usable = usableWidthMm(template);
      const tables = doc.nodes.filter((n) => n.t === 'table');
      expect(tables.length).toBeGreaterThan(0);
      for (const n of tables) {
        if (n.t !== 'table') continue;
        const fixed = n.widths.reduce<number>((s, w) => s + (typeof w === 'number' ? w : 0), 0);
        expect(fixed, `${template.name}: ${n.caption}`).toBeLessThanOrEqual(usable + 0.5);
      }
      // pdfmake adds 3pt padding each side plus a 0.4pt rule to every column
      const contentPt = (usable * 72) / 25.4;
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
      walk(toPdfDefinition(doc).content);
    }
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
    expect(lines[0].startsWith('site,date,pH (pH units),')).toBe(true);
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
