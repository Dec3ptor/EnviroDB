import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { db, ensureBuiltIns } from '../src/db/db';
import { mergeParameters, mergeSites, parameterMergeImpact, siteMergeImpact } from '../src/db/merge';
import { newProject, newRule, newSchedule, newSite, saveProject, saveRule, saveSchedule, saveSite } from '../src/db/repo';
import type { GuidelineSet, Parameter, ReportTemplate, Result, Sample } from '../src/db/types';

let n = 0;
const result = (s: Sample, parameterId: string, value: number, unit: string, extra: Partial<Result> = {}): Result => ({ id: `r${++n}`, projectId: s.projectId, sampleId: s.id, siteId: s.siteId, date: s.date, parameterId, value, qualifier: '', unit, ...extra });

describe('a parameter merged into another', () => {
  let projectId = '';
  let siteId = '';
  const samples: Sample[] = [];
  beforeAll(async () => {
    await ensureBuiltIns();
    const p = newProject({ name: 'Merge', code: 'MG-1' });
    await saveProject(p);
    projectId = p.id;
    const s = newSite(projectId, { code: 'SW1' });
    await saveSite(s);
    siteId = s.id;
    for (const date of ['2026-08-03', '2026-09-07', '2026-10-05', '2026-11-02']) samples.push({ id: `s-${date}`, projectId, siteId, date });
    await db.samples.bulkPut(samples);
    // a lab's name for dissolved zinc that became its own parameter, in µg/L
    await db.parameters.put({ id: 'zn-sol', name: 'Zinc (soluble)', short: 'Zn sol', group: 'Metals (dissolved)', unit: 'µg/L', aliases: ['Soluble Zinc', 'Zn-Sol'] });
    await db.parameters.put({ id: 'zn-x2', name: 'Twice zinc', group: 'Other', unit: 'µg/L', aliases: [], formula: '[Zinc (soluble)] * 2' });
    await db.results.bulkPut([
      result(samples[0], 'zn-sol', 12, 'µg/L'),
      // the same value in both, as each unit says it
      result(samples[1], 'zn-sol', 5, 'µg/L'),
      result(samples[1], 'zn-d', 0.005, 'mg/L'),
      // a different value in each
      result(samples[2], 'zn-sol', 9, 'µg/L'),
      result(samples[2], 'zn-d', 0.02, 'mg/L'),
      result(samples[3], 'zn-d', 0.03, 'mg/L'),
      result(samples[3], 'tss', 4, 'mg/L'),
    ]);
    await saveRule(newRule(projectId, { id: 'rule-zn', name: 'Zinc limit', parameterId: 'zn-sol', value: 50, unit: 'µg/L' }));
    await saveRule(newRule(projectId, { id: 'rule-gl', name: 'ANZG', kind: 'guideline', parameterIds: ['zn-sol', 'tss'] }));
    await saveSchedule(newSchedule(projectId, { id: 'sch-1', name: 'Monthly', siteIds: [siteId], parameterIds: ['tss', 'zn-sol', 'zn-d'] }));
    await db.guidelineSets.put({ id: 'gs-own', name: 'Site-specific values', shortName: 'SSV', values: [{ parameterId: 'zn-sol', max: 40, unit: 'µg/L' }, { parameterId: 'tss', max: 50, unit: 'mg/L' }], updatedAt: '' } as unknown as GuidelineSet);
    await db.guidelineSets.put({ id: 'gs-both', name: 'Both', shortName: 'Both', values: [{ parameterId: 'zn-sol', max: 1, unit: 'µg/L' }, { parameterId: 'zn-d', max: 2, unit: 'µg/L' }], updatedAt: '' } as unknown as GuidelineSet);
    await db.templates.put({
      id: 'tpl-m', name: 'Zinc report', orientation: 'portrait', pageSize: 'A4', marginMm: 20, fontSize: 10, accent: '#000', headerText: '', footerText: '', numbering: true, updatedAt: '',
      blocks: [
        { id: 'b1', type: 'statsTable', title: 'Stats', siteIds: [], parameterIds: ['tss', 'zn-sol', 'zn-d'], stats: ['n'] },
        { id: 'b2', type: 'calc', title: '', show: 'table', rows: [{ id: 'c1', stat: 'median', parameterId: 'zn-sol' }] },
        { id: 'b3', type: 'text', text: 'zn-sol is only a word here', prompt: false },
      ],
    } as unknown as ReportTemplate);
  });

  it('what it would do is said first – nothing is changed', async () => {
    const impact = await parameterMergeImpact('zn-sol', 'zn-d');
    // (the built-in dissolved zinc already goes by "zinc (soluble)" and "soluble zinc": only the new names come over)
    expect(impact).toMatchObject({ results: 3, same: 1, rules: 2, schedules: 1, templates: ['Zinc report'], formulas: ['Twice zinc'], names: ['Zn sol', 'Zn-Sol'] });
    expect([...impact.guidelineSets].sort()).toEqual(['Both', 'SSV']);
    expect(impact.blocked).toBeUndefined();
    expect(impact.projects).toEqual([{ id: projectId, name: 'Merge', results: 3 }]);
    expect(impact.clashes).toEqual([{ projectId, text: 'SW1 5 Oct 2026: 9 µg/L here, 0.02 mg/L there' }]);
    expect(impact.builtInValues).toEqual([]);
    expect(await db.results.where('projectId').equals(projectId).count()).toBe(7);
    expect(await db.parameters.get('zn-sol')).toBeTruthy();
  });

  it('different kinds of unit can’t be the same thing; nor a parameter and what it’s worked out from', async () => {
    expect((await parameterMergeImpact('zn-sol', 'turbidity')).blocked).toBe('Zinc (soluble) is in µg/L and Turbidity in NTU – they can’t be the same thing.');
    await expect(mergeParameters('zn-sol', 'turbidity')).rejects.toThrow(/can’t be the same thing/);
    expect((await parameterMergeImpact('zn-sol', 'zn-x2')).blocked).toMatch(/worked out from itself/);
    await expect(parameterMergeImpact('zn-sol', 'zn-sol')).rejects.toThrow(/different parameter/);
    await expect(parameterMergeImpact('zn-sol', 'nope')).rejects.toThrow(/isn’t in the library/);
  });

  it('everything that named it names the other; a sample with both keeps the other’s value', async () => {
    const done = await mergeParameters('zn-sol', 'zn-d');
    expect(done).toMatchObject({ moved: 1, same: 1, clashes: 1 });
    expect(await db.parameters.get('zn-sol')).toBeUndefined();
    const results = await db.results.where('projectId').equals(projectId).toArray();
    const of = (s: Sample) => results.filter((r) => r.sampleId === s.id && r.parameterId === 'zn-d').map((r) => [r.value, r.unit, !!r.excluded]);
    expect(of(samples[0])).toEqual([[12, 'µg/L', false]]); // moved, in its own unit
    expect(of(samples[1])).toEqual([[0.005, 'mg/L', false]]); // the same in both: one kept
    expect(of(samples[2]).sort()).toEqual([[0.02, 'mg/L', false], [9, 'µg/L', true]]); // kept apart, saying why
    expect(results.find((r) => r.excluded)!.excluded!.reason).toBe('Merged in from “Zinc (soluble)”: the sample already had a value for Dissolved Zinc (0.02 mg/L)');
    expect(results.some((r) => r.parameterId === 'zn-sol')).toBe(false);
    expect((await db.rules.get('rule-zn'))!.parameterId).toBe('zn-d');
    expect((await db.rules.get('rule-gl'))!.parameterIds).toEqual(['zn-d', 'tss']);
    expect((await db.schedules.get('sch-1'))!.parameterIds).toEqual(['tss', 'zn-d']);
    // your guideline set's value goes with it – unless the other has one already
    expect((await db.guidelineSets.get('gs-own'))!.values.map((v) => [v.parameterId, v.max])).toEqual([['zn-d', 40], ['tss', 50]]);
    expect((await db.guidelineSets.get('gs-both'))!.values.map((v) => [v.parameterId, v.max])).toEqual([['zn-d', 2]]);
    const tpl = (await db.templates.get('tpl-m'))!;
    expect((tpl.blocks[0] as { parameterIds: string[] }).parameterIds).toEqual(['tss', 'zn-d']);
    expect((tpl.blocks[1] as { rows: Array<{ parameterId: string }> }).rows[0].parameterId).toBe('zn-d');
    expect((tpl.blocks[2] as { text: string }).text).toBe('zn-sol is only a word here');
    expect((await db.parameters.get('zn-x2'))!.formula).toBe('[Dissolved Zinc] * 2');
    const into = (await db.parameters.get('zn-d')) as Parameter;
    for (const name of ['Zinc (soluble)', 'Zn sol', 'Soluble Zinc', 'Zn-Sol']) expect(into.aliases.map((x) => x.toLowerCase())).toContain(name.toLowerCase());
    expect(into.aliases).toContain('Zn-Sol');
    const history = (await db.audit.where('projectId').equals(projectId).toArray()).map((a) => a.text);
    expect(history).toContain('Parameter Zinc (soluble) merged into Dissolved Zinc (1 sample had both: the one merged in is kept, left out of the data)');
  });

  it('a built-in guideline that doesn’t carry over is said', async () => {
    await db.parameters.put({ id: 'my-zn', name: 'My zinc', group: 'Other', unit: 'mg/L', aliases: [] });
    // merging the built-in into your own: the published sets' values for it don't go with it
    const impact = await parameterMergeImpact('zn-d', 'my-zn');
    expect(impact.builtInValues.length).toBeGreaterThan(0);
    expect((await parameterMergeImpact('my-zn', 'zn-d')).builtInValues).toEqual([]);
  });
});

describe('a site merged into another', () => {
  let projectId = '';
  let a = '';
  let b = '';
  let c = '';
  beforeAll(async () => {
    await ensureBuiltIns();
    const p = newProject({ name: 'Sites', code: 'ST-1' });
    await saveProject(p);
    projectId = p.id;
    const sa = newSite(projectId, { code: 'DS-1', name: 'Downstream', aliases: ['Down stream'], easting: 1800000, northing: 5800000, bore: { depth: 12 } });
    const sb = newSite(projectId, { code: 'DS1', aliases: [] });
    const sc = newSite(projectId, { code: 'US1' });
    for (const s of [sa, sb, sc]) await saveSite(s);
    [a, b, c] = [sa.id, sb.id, sc.id];
    const mk = (id: string, siteId: string, date: string): Sample => ({ id, projectId, siteId, date });
    const samples = [mk('m1', a, '2026-09-07'), mk('m2', a, '2026-10-05T09:00'), mk('m3', b, '2026-10-05T14:00'), mk('m4', b, '2026-11-02')];
    await db.samples.bulkPut(samples);
    await db.results.bulkPut([result(samples[0], 'tss', 4, 'mg/L'), result(samples[1], 'tss', 5, 'mg/L'), result(samples[1], 'ph', 7, 'pH units'), result(samples[2], 'tss', 6, 'mg/L')]);
    await saveRule(newRule(projectId, { id: 'rule-a', name: 'TSS at DS-1', parameterId: 'tss', siteIds: [a, c] }));
    await saveRule(newRule(projectId, { id: 'rule-ud', name: 'Increase', parameterId: 'tss', siteIds: [a], referenceSiteId: c }));
    await saveRule(newRule(projectId, { id: 'rule-self', name: 'DS-1 against DS1', parameterId: 'tss', siteIds: [a], referenceSiteId: b }));
    await saveSchedule(newSchedule(projectId, { id: 'sch-s', name: 'Monthly', siteIds: [a, b, c] }));
    await db.calendarRows.put({ id: 'row-s', projectId, siteIds: [a], order: 0, job: '', updatedAt: '' });
  });

  it('what it would do is said first', async () => {
    const impact = await siteMergeImpact(a, b);
    expect(impact).toMatchObject({ samples: 2, results: 3, sharedDays: ['2026-10-05'], rules: 3, schedules: 1, calendarRows: 1, names: ['DS-1', 'Downstream', 'Down stream'] });
    expect(impact.details).toEqual(['DS1 takes DS-1’s location', 'DS1 takes DS-1’s bore details']);
    expect(impact.blocked).toBeUndefined();
    await expect(siteMergeImpact(a, a)).rejects.toThrow(/different site/);
  });

  it('its samples, rules, schedules and calendar rows go to the other, with its names', async () => {
    const done = await mergeSites(a, b);
    expect(done).toMatchObject({ samples: 2, results: 3 });
    expect(await db.sites.get(a)).toBeUndefined();
    const samples = await db.samples.where('projectId').equals(projectId).toArray();
    expect(samples.every((s) => s.siteId === b)).toBe(true);
    // a day sampled at both keeps both samples
    expect(samples.filter((s) => s.date.startsWith('2026-10-05'))).toHaveLength(2);
    expect((await db.results.where('projectId').equals(projectId).toArray()).every((r) => r.siteId === b)).toBe(true);
    expect((await db.rules.get('rule-a'))!.siteIds).toEqual([b, c]);
    expect(await db.rules.get('rule-ud')).toMatchObject({ siteIds: [b], referenceSiteId: c });
    // a rule that compared the two can't compare a site with itself
    const self = (await db.rules.get('rule-self'))!;
    expect(self.siteIds).toEqual([b]);
    expect(self.referenceSiteId).toBeUndefined();
    expect((await db.schedules.get('sch-s'))!.siteIds).toEqual([b, c]);
    expect((await db.calendarRows.get('row-s'))!.siteIds).toEqual([b]);
    const into = (await db.sites.get(b))!;
    // the other had no name, location or bore details: it takes them; the code and other names are remembered
    expect(into).toMatchObject({ code: 'DS1', name: 'Downstream', easting: 1800000, northing: 5800000, bore: { depth: 12 } });
    expect(into.aliases).toEqual(['DS-1', 'Down stream']);
    expect((await db.audit.where('projectId').equals(projectId).toArray()).map((x) => x.text)).toContain('Site DS-1 merged into DS1: 2 samples, 3 results');
  });

  it('only within a project', async () => {
    const other = newProject({ name: 'Other', code: 'OT-1' });
    await saveProject(other);
    const far = newSite(other.id, { code: 'X1' });
    await saveSite(far);
    expect((await siteMergeImpact(c, far.id)).blocked).toBe('The two sites are in different projects.');
    await expect(mergeSites(c, far.id)).rejects.toThrow(/different projects/);
    expect(await db.sites.get(c)).toBeTruthy();
  });
});
