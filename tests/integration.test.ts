import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { db, DEFAULT_SETTINGS, ensureBuiltIns } from '../src/db/db';
import { createDemoProject } from '../src/db/demo';
import { buildIndex } from '../src/lib/dataIndex';
import { evaluateAll, type ProjectBundle } from '../src/lib/analysis';
import { buildReport } from '../src/reports/build';
import { toPdfDefinition } from '../src/reports/pdf';
import { docxBlob } from '../src/reports/docx';
import { BUILT_IN_TEMPLATES } from '../src/data/templates';
import { readWorkbook } from '../src/importers/workbook';
import { planSheets, parseWithPlan } from '../src/importers/detect';
import { buildParamIndex, matchParameter, matchSite } from '../src/lib/matching';
import { analyteMapKey } from '../src/importers/model';
import { commitImport } from '../src/importers/commit';
import { exportProjectPackage, importProjectPackage } from '../src/db/backup';

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
