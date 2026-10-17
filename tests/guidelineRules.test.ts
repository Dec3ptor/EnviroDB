import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { db, ensureBuiltIns } from '../src/db/db';
import type { GuidelineSet, Parameter, Project, Result, Rule, Sample, Site } from '../src/db/types';
import { compareParams } from '../src/data/parameters';
import { buildIndex } from '../src/lib/dataIndex';
import { consentParameterIds, evalContext, keyParameters, type ProjectBundle } from '../src/lib/analysis';
import { describeRule, evaluateRule, exceededWhen, expandRules, ruleParamIds, withGuidelineLimit } from '../src/lib/compliance';
import { buildChartSpec } from '../src/charts/timeSeries';

// Made-up monitoring: dissolved zinc and copper at an upstream and a downstream site, with hardness.
let params: Parameter[] = [];
let sets: GuidelineSet[] = [];
const sites: Site[] = [
  { id: 'us1', projectId: 'p', code: 'US1', type: 'Surface water', role: '', aliases: [], active: true, order: 1 },
  { id: 'ds1', projectId: 'p', code: 'DS1', type: 'Surface water', role: '', aliases: [], active: true, order: 2 },
];
const samples: Sample[] = [
  { id: 's1', projectId: 'p', siteId: 'ds1', date: '2026-01-10' },
  { id: 's2', projectId: 'p', siteId: 'ds1', date: '2026-02-10' },
  { id: 's3', projectId: 'p', siteId: 'us1', date: '2026-01-10' },
];
const res = (id: string, sampleId: string, parameterId: string, value: number, unit: string): Result => {
  const s = samples.find((x) => x.id === sampleId)!;
  return { id, projectId: 'p', sampleId, siteId: s.siteId, date: s.date, parameterId, value, qualifier: '', unit };
};
const results: Result[] = [
  res('zn1', 's1', 'zn-d', 0.01, 'mg/L'), // 10 µg/L at 30 mg/L hardness: over 8
  res('h1', 's1', 'hardness', 30, 'mg/L'),
  res('cu1', 's1', 'cu-d', 0.002, 'mg/L'), // 2 µg/L: over 1.4
  res('zn2', 's2', 'zn-d', 0.015, 'mg/L'), // 15 µg/L, but at 120 mg/L hardness the value is about 26
  res('h2', 's2', 'hardness', 120, 'mg/L'),
  res('zn3', 's3', 'zn-d', 0.02, 'mg/L'),
];
const project: Project = { id: 'p', name: 'Example', status: 'active', guidelineSetIds: [], hardnessAdjust: false, ndHandling: 'dl', yearStartMonth: 7, percentileMethod: 'excel', createdAt: '', updatedAt: '' };
const rule = (patch: Partial<Rule>): Rule => ({ id: 'r', projectId: 'p', name: 'Rule', level: 'Trigger', kind: 'threshold', siteIds: ['ds1'], operator: '>', active: true, order: 1, ...patch });
let b: ProjectBundle;
const ev = (r: Rule) => evaluateRule(r, evalContext(b, '2025-07-01', '2026-06-30'));

beforeAll(async () => {
  await ensureBuiltIns();
  params = (await db.parameters.toArray()).sort(compareParams);
  sets = await db.guidelineSets.toArray();
  b = {
    project,
    sites,
    siteMap: new Map(sites.map((s) => [s.id, s])),
    samples,
    params,
    paramMap: new Map(params.map((p) => [p.id, p])),
    guidelineSets: sets,
    setMap: new Map(sets.map((s) => [s.id, s])),
    rules: [],
    notes: [],
    schedules: [],
    obligations: [],
    index: buildIndex(samples, results, sites, params),
  };
});

describe('guideline rules for chosen analytes', () => {
  it('compares only the analytes chosen', () => {
    const all = ev(rule({ kind: 'guideline', guidelineSetId: 'anzg-fw-95', hardnessAdjust: true }));
    expect(all.exceedances.map((e) => e.resultId).sort()).toEqual(['cu1', 'zn1']);
    const zinc = rule({ kind: 'guideline', guidelineSetId: 'anzg-fw-95', parameterIds: ['zn-d'], hardnessAdjust: true });
    const e = ev(zinc);
    expect(e.exceedances.map((x) => x.resultId)).toEqual(['zn1']);
    expect(e.assessed).toBe(2);
    expect(e.description).toMatch(/^Dissolved Zinc results exceeding .*95%.* \(hardness-modified\) at DS1$/i);
    expect(exceededWhen(zinc, b.paramMap, sites, b.setMap)).toMatch(/^a Dissolved Zinc result at DS1 is above its/i);
  });

  it('counts only those analytes as the consent’s', () => {
    const zinc = rule({ kind: 'guideline', guidelineSetId: 'anzg-fw-95', parameterIds: ['zn-d', 'not-in-set'] });
    expect(ruleParamIds(zinc, b.setMap)).toEqual(['zn-d']);
    const withRule = { ...b, rules: [zinc] };
    expect([...consentParameterIds(withRule)]).toEqual(['zn-d']);
    expect(keyParameters(withRule)).toEqual(['zn-d']);
  });

  it('shows the chosen analytes as limits in tables and graphs', () => {
    const [one, ...rest] = expandRules([rule({ kind: 'guideline', guidelineSetId: 'anzg-fw-95', parameterIds: ['zn-d'], hardnessAdjust: true })], b.setMap);
    expect(rest).toHaveLength(0);
    expect(one).toMatchObject({ kind: 'threshold', parameterId: 'zn-d', limitSetId: 'anzg-fw-95', operator: '>', value: 8, unit: 'µg/L', hardnessAdjust: true });
    // a guideline rule over the whole set stays out of the limit tables (its set has its own columns)
    expect(expandRules([rule({ kind: 'guideline', guidelineSetId: 'anzg-fw-95' })], b.setMap)).toHaveLength(0);
    const spec = buildChartSpec({ index: b.index, param: b.paramMap.get('zn-d')!, sites, siteIds: [], guidelineSets: [], rules: [one], setMap: b.setMap, showRules: true });
    expect(spec.lines.map((l) => l.text)).toEqual([expect.stringMatching(/^Trigger 0\.008 (mg\/L|g\/m³) \(at DS1, ANZG.*95%, at 30 mg\/L hardness\)$/)]);
  });
});

describe('limits taken from a guideline value', () => {
  it('fills in the value, in the rule’s unit', () => {
    const r = withGuidelineLimit(rule({ parameterId: 'zn-d', limitSetId: 'anzg-fw-95', unit: 'mg/L', value: 99 }), b.setMap);
    expect(r).toMatchObject({ operator: '>', value: 0.008, unit: 'mg/L', hardnessAdjust: false });
    // a unit that doesn't convert: the guideline's own
    expect(withGuidelineLimit(rule({ parameterId: 'zn-d', limitSetId: 'anzg-fw-95', unit: 'NTU' }), b.setMap)).toMatchObject({ value: 8, unit: 'µg/L' });
    // a set without a value for the parameter: the rule as it was
    const none = rule({ parameterId: 'zn-d', limitSetId: 'no-such-set', value: 5, unit: 'mg/L' });
    expect(withGuidelineLimit(none, b.setMap)).toBe(none);
    // a range: pH 6.5–8.5 from a set of your own
    const own: GuidelineSet = { id: 'own', name: 'Our pH range', shortName: 'Ours', builtIn: false, values: [{ parameterId: 'ph', min: 6.5, max: 8.5, unit: 'pH' }], updatedAt: '' };
    expect(withGuidelineLimit(rule({ parameterId: 'ph', limitSetId: 'own' }), new Map([['own', own]]))).toMatchObject({ operator: 'outside', min: 6.5, max: 8.5 });
  });

  it('checks each result against the value, hardness-modified for its sample', () => {
    const plain = ev(rule({ parameterId: 'zn-d', limitSetId: 'anzg-fw-95', unit: 'mg/L' }));
    expect(plain.exceedances.map((e) => e.resultId)).toEqual(['zn1', 'zn2']);
    expect(plain.exceedances[0].limitText).toMatch(/^> 0\.008 (mg\/L|g\/m³) \(ANZG.*95%.*\)$/);
    expect(plain.description).toMatch(/^Dissolved Zinc > 0\.008 (mg\/L|g\/m³) \(ANZG.*95%.*\) at DS1$/i);

    const hard = ev(rule({ parameterId: 'zn-d', limitSetId: 'anzg-fw-95', unit: 'mg/L', hardnessAdjust: true }));
    expect(hard.exceedances.map((e) => e.resultId)).toEqual(['zn1']);
    expect(hard.assessed).toBe(2);
    expect(hard.description).toMatch(/hardness-modified/);
  });

  it('works for statistics and consecutive results', () => {
    // the median of 10 and 15 µg/L is over 8; hardness isn't applied to a statistic
    const med = ev(rule({ kind: 'statistic', statistic: 'median', window: 'period', parameterId: 'zn-d', limitSetId: 'anzg-fw-95', hardnessAdjust: true }));
    expect(med.status).toBe('exceeded');
    expect(med.rule.hardnessAdjust).toBe(false);
    expect(med.description).toMatch(/^period median of Dissolved Zinc > 8 µg\/L \(ANZG/i);
    const two = ev(rule({ kind: 'consecutive', consecutive: 2, parameterId: 'zn-d', limitSetId: 'anzg-fw-95' }));
    expect(two.exceedances.map((e) => e.resultId)).toEqual(['zn2']);
    const twoHard = ev(rule({ kind: 'consecutive', consecutive: 2, parameterId: 'zn-d', limitSetId: 'anzg-fw-95', hardnessAdjust: true }));
    expect(twoHard.exceedances).toHaveLength(0);
  });

  it('describes a typed limit as before', () => {
    expect(describeRule(rule({ parameterId: 'zn-d', value: 0.01, unit: 'mg/L' }), b.paramMap, sites, b.setMap)).toMatch(/^Dissolved Zinc > 0\.01 (mg\/L|g\/m³) at DS1$/i);
  });
});
