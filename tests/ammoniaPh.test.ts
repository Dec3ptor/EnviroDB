import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { db, ensureBuiltIns } from '../src/db/db';
import type { GuidelineSet, Parameter, Project, Result, Rule, Sample, Site } from '../src/db/types';
import { compareParams } from '../src/data/parameters';
import { buildIndex, samplePh } from '../src/lib/dataIndex';
import { evalContext, flagResults, type ProjectBundle } from '../src/lib/analysis';
import { evaluateRule } from '../src/lib/compliance';
import { ammoniaPhFactor, limitFor } from '../src/lib/guidelines';
import { ammoniaAtPh8 } from '../src/lib/npsfm';

// Made-up monitoring: total ammoniacal-N at one site, at four pHs. The ANZG 95% value is 0.9 mg/L at pH 8.
let params: Parameter[] = [];
let sets: GuidelineSet[] = [];
const sites: Site[] = [{ id: 'ds1', projectId: 'p', code: 'DS1', type: 'Surface water', role: '', aliases: [], active: true, order: 1 }];
const samples: Sample[] = [
  { id: 's1', projectId: 'p', siteId: 'ds1', date: '2026-01-10' },
  { id: 's2', projectId: 'p', siteId: 'ds1', date: '2026-02-10' },
  { id: 's3', projectId: 'p', siteId: 'ds1', date: '2026-03-10' },
  { id: 's4', projectId: 'p', siteId: 'ds1', date: '2026-04-10' },
];
const res = (id: string, sampleId: string, parameterId: string, value: number, unit: string): Result => {
  const s = samples.find((x) => x.id === sampleId)!;
  return { id, projectId: 'p', sampleId, siteId: s.siteId, date: s.date, parameterId, value, qualifier: '', unit };
};
const results: Result[] = [
  res('n1', 's1', 'nh4-n', 1.5, 'mg/L'), // pH 7: the value there is about 2.19 – fine (it would exceed 0.9)
  res('p1', 's1', 'ph', 7, 'pH'),
  res('n2', 's2', 'nh4-n', 0.5, 'g/m3'), // pH 9 (field reading only): the value there is 0.18 – exceeded (0.5 is under 0.9)
  res('p2', 's2', 'ph-field', 9, 'pH'),
  res('n3', 's3', 'nh4-n', 1.2, 'mg/L'), // no pH: the pH 8 value – exceeded
  res('n4', 's4', 'nh4-n', 0.8, 'mg/L'), // lab pH 8 wins over the field's 8.9 – fine
  res('p4', 's4', 'ph', 8, 'pH'),
  res('p4f', 's4', 'ph-field', 8.9, 'pH'),
];
const project: Project = { id: 'p', name: 'Example', status: 'active', guidelineSetIds: ['anzg-fw-95'], hardnessAdjust: true, ndHandling: 'dl', yearStartMonth: 7, percentileMethod: 'excel', createdAt: '', updatedAt: '' };
const rule = (patch: Partial<Rule>): Rule => ({ id: 'r', projectId: 'p', name: 'Rule', level: 'Trigger', kind: 'threshold', siteIds: ['ds1'], operator: '>', active: true, order: 1, ...patch });
const bundle = (p: Project = project): ProjectBundle => ({
  project: p,
  sites,
  siteMap: new Map(sites.map((s) => [s.id, s])),
  samples,
  params,
  paramMap: new Map(params.map((x) => [x.id, x])),
  guidelineSets: sets,
  setMap: new Map(sets.map((s) => [s.id, s])),
  rules: [],
  notes: [],
  schedules: [],
  obligations: [],
  index: buildIndex(samples, results, sites, params),
  qc: { sites: [], samples: [], records: [] },
  register: { conditions: [], assessments: [] },
  continuous: { series: [], days: [] },
});

beforeAll(async () => {
  await ensureBuiltIns();
  params = (await db.parameters.toArray()).sort(compareParams);
  sets = await db.guidelineSets.toArray();
});

describe('the ammonia guideline at each sample’s pH', () => {
  it('follows ANZECC (2000) table 8.3.7: 2.57 at pH 6, 2.18 at pH 7, 0.9 at pH 8, 0.18 at pH 9 (mg/L, 95%)', () => {
    const at = (ph: number) => 900 * ammoniaPhFactor(ph);
    // the table's rows, to its own rounding
    for (const [ph, tv] of [[6.0, 2570], [6.5, 2460], [7.0, 2180], [7.5, 1610], [8.0, 900], [8.5, 400], [9.0, 180]] as const) expect(Math.abs(at(ph) - tv)).toBeLessThan(12);
    expect(ammoniaPhFactor(8)).toBe(1);
    // beyond the table: its ends
    expect(ammoniaPhFactor(5)).toBe(ammoniaPhFactor(6));
    expect(ammoniaPhFactor(10)).toBe(ammoniaPhFactor(9));
    // the NPS-FM's conversion to pH 8 is the same relationship, the other way round
    expect(ammoniaAtPh8(2.18, 7)).toBeCloseTo(0.9, 1);
  });

  it('a set’s ammonia value is marked, and taken at the pH given', () => {
    const gv = sets.find((s) => s.id === 'anzg-fw-95')!.values.find((v) => v.parameterId === 'nh4-n')!;
    expect(gv).toMatchObject({ max: 900, unit: 'µg/L', ph: true });
    expect(sets.find((s) => s.id === 'anzecc-mw-95')!.values.find((v) => v.parameterId === 'nh4-n')!.ph).toBeUndefined(); // marine: as published, at pH 8
    expect(limitFor(gv, undefined, { adjust: true, ph: 7 })).toMatchObject({ ph: 7, adjusted: false });
    expect(limitFor(gv, undefined, { adjust: true, ph: 7 }).max!).toBeCloseTo(2186, 0);
    expect(limitFor(gv, undefined, { adjust: true }).max).toBe(900); // no pH: as given
    expect(limitFor(gv, undefined, { adjust: true, ph: 7, adjustPh: false })).toMatchObject({ max: 900 });
    // another parameter's value isn't touched
    const zn = sets.find((s) => s.id === 'anzg-fw-95')!.values.find((v) => v.parameterId === 'zn-d')!;
    expect(limitFor(zn, undefined, { adjust: false, ph: 9 }).max).toBe(zn.max);
  });

  it('the sample’s pH: the lab’s, else the field reading', () => {
    const b = bundle();
    expect([...b.index.ph]).toEqual([['s1', 7], ['s2', 9], ['s4', 8]]);
    expect(samplePh([res('x', 's1', 'ph', 71, 'pH')])).toBeUndefined(); // not a pH
  });

  it('highlights results by it: under the pH 8 value but over at pH 9; over it but fine at pH 7', () => {
    const flags = flagResults(bundle(), [], ['anzg-fw-95'], '2025-07-01', '2026-06-30');
    expect([...flags.keys()].sort()).toEqual(['n2', 'n3']);
    expect(flags.get('n2')!.messages[0]).toMatch(/^Exceeds ANZG FW 95% \(0\.18 .*at the sample’s pH 9\.0\)$/);
    expect(flags.get('n3')!.messages[0]).toMatch(/^Exceeds ANZG FW 95% \(0\.9 [^,]*\)$/);
    // switched off for the project: the pH 8 value for every sample
    const off = flagResults(bundle({ ...project, phAdjust: false }), [], ['anzg-fw-95'], '2025-07-01', '2026-06-30');
    expect([...off.keys()].sort()).toEqual(['n1', 'n3']);
  });

  it('consent rules that use the guideline value follow it too – a statistic stays at pH 8', () => {
    const b = bundle();
    const ctx = evalContext(b, '2025-07-01', '2026-06-30');
    const guideline = evaluateRule(rule({ kind: 'guideline', guidelineSetId: 'anzg-fw-95', parameterIds: ['nh4-n'] }), ctx);
    expect(guideline.exceedances.map((e) => e.resultId)).toEqual(['n2', 'n3']);
    expect(guideline.exceedances[0].limitText).toBe('ANZG FW 95%: 0.18 g/m³ (at the sample’s pH 9.0)');
    const limit = evaluateRule(rule({ parameterId: 'nh4-n', limitSetId: 'anzg-fw-95', unit: 'mg/L' }), ctx);
    expect(limit.exceedances.map((e) => e.resultId)).toEqual(['n2', 'n3']);
    expect(limit.exceedances[0].limitText).toBe('> 0.18 mg/L (ANZG FW 95% at the sample’s pH 9.0)');
    expect(limit.exceedances[1].limitText).toBe('> 0.9 mg/L (ANZG FW 95%, at each sample’s pH)');
    const median = evaluateRule(rule({ kind: 'statistic', statistic: 'median', window: 'year', parameterId: 'nh4-n', limitSetId: 'anzg-fw-95', unit: 'mg/L', minSamples: 1 }), ctx);
    expect(median.exceedances.map((e) => e.limitText)).toEqual(['> 0.9 mg/L (ANZG FW 95%, at pH 8)']);
  });
});
