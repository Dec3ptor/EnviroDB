import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { db, ensureBuiltIns } from '../src/db/db';
import type { ParsedImport, RawResult, RawSample } from '../src/importers/model';
import { parseValue } from '../src/lib/values';
import { codeFor, quickCheck, quickCounts, quickFlags, saveQuickCheck } from '../src/lib/quickCheck';

// Made-up lab results: two samples upstream and downstream, one undated, an analyte EnviroDB doesn't know.
const res = (analyte: string, raw: string, unit?: string, group?: string): RawResult => ({ analyte, raw, unit, group, parsed: parseValue(raw) });
const sample = (key: string, name: string, date: string | undefined, results: RawResult[]): RawSample => ({ key, sampleName: name, siteText: name, date, sheet: 'Results', results });
const parsed: ParsedImport = {
  kind: 'lab',
  labName: 'Example Lab',
  labJob: '1234567',
  warnings: [],
  samples: [
    sample('a', 'SW1 Upstream', '2026-09-01', [res('pH', '7.2'), res('Dissolved Zinc', '0.5', 'mg/L'), res('Unobtainium', '3', 'mg/L')]),
    sample('b', 'SW2 Downstream', '2026-09-01', [res('pH', '7.4'), res('Dissolved Zinc', '<0.001', 'mg/L')]),
    sample('c', 'SW2 Downstream', undefined, [res('Dissolved Zinc', '0.002', 'mg/L')]),
  ],
};

beforeAll(async () => {
  await ensureBuiltIns();
});

describe('quick check', () => {
  it('names sites from the samples', () => {
    expect([codeFor('SW1 Upstream'), codeFor('GW-12a deep'), codeFor('Stormwater pond'), codeFor('A very long sample name indeed')]).toEqual(['SW1', 'GW-12A', 'Stormwater pond', 'A very long samp']);
  });

  it('compares the results with the guideline sets chosen, with nothing saved', async () => {
    const before = await db.results.count();
    const q = quickCheck(parsed, await db.parameters.toArray(), await db.guidelineSets.toArray(), { guidelineSetIds: ['anzg-fw-95'], hardnessAdjust: true, today: '2026-10-16' });
    expect(q.bundle.sites.map((s) => [s.code, s.name])).toEqual([
      ['SW1', 'SW1 Upstream'],
      ['SW2', 'SW2 Downstream'],
    ]);
    expect(q.bundle.samples).toHaveLength(3);
    expect(q.undated).toBe(1);
    expect(q.unknown.map((u) => u.analyte)).toEqual(['Unobtainium']);
    expect(q.paramOf).toMatchObject({ 'Dissolved Zinc¦¦mg/L': 'zn-d', 'pH¦¦': 'ph' });
    // dissolved zinc upstream is far over the freshwater guideline; the others aren't
    const flags = quickFlags(q.bundle, ['anzg-fw-95']);
    const zn = q.bundle.index.byParam.get('zn-d')!;
    const flagged = [...zn.values()].flat().filter((r) => flags.get(r.id)?.kind === 'guideline');
    expect(flagged.map((r) => q.bundle.siteMap.get(r.siteId)!.code)).toEqual(['SW1']);
    expect(flags.get(flagged[0].id)!.messages[0]).toMatch(/^Exceeds ANZG FW 95%/);
    const [c] = quickCounts(q.bundle, ['anzg-fw-95']);
    expect(c.exceeded).toBe(1);
    expect(c.compared).toBeGreaterThanOrEqual(3);
    expect(await db.results.count()).toBe(before);
  });

  it('makes a project of the results', async () => {
    const q = quickCheck(parsed, await db.parameters.toArray(), await db.guidelineSets.toArray(), { guidelineSetIds: ['anzg-fw-95'], hardnessAdjust: true, today: '2026-10-16' });
    const id = await saveQuickCheck(q, parsed, { name: 'Lab job 1234567', fileName: 'results.csv', guidelineSetIds: ['anzg-fw-95'], hardnessAdjust: true, today: '2026-10-16' });
    expect(await db.projects.get(id)).toMatchObject({ name: 'Lab job 1234567', guidelineSetIds: ['anzg-fw-95'] });
    const sites = await db.sites.where('projectId').equals(id).sortBy('order');
    expect(sites.map((s) => s.code)).toEqual(['SW1', 'SW2']);
    const samples = await db.samples.where('projectId').equals(id).toArray();
    expect(samples.map((s) => s.date).sort()).toEqual(['2026-09-01', '2026-09-01', '2026-10-16']); // the undated one on the day
    const results = await db.results.where('projectId').equals(id).toArray();
    expect(results).toHaveLength(5); // the unknown analyte left out
  });
});
