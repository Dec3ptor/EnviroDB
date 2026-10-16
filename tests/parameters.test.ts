import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { db, ensureBuiltIns } from '../src/db/db';
import { createDemoProject } from '../src/db/demo';
import { deleteParameter, newSchedule, parameterImpact, saveGuidelineSet, saveSchedule } from '../src/db/repo';
import type { GuidelineSet } from '../src/db/types';

let projectId = '';
beforeAll(async () => {
  await ensureBuiltIns();
  projectId = await createDemoProject();
});

const resultsFor = (pid: string) => db.results.where('[projectId+parameterId]').equals([projectId, pid]).count();

describe('deleting parameters', () => {
  it('removes a parameter from one project: its results and rules go, the library keeps it', async () => {
    const before = await resultsFor('tss');
    expect(before).toBeGreaterThan(0);
    const impact = await parameterImpact('tss', projectId);
    expect(impact.results).toBe(before);
    expect(impact.rules.map((r) => r.name).sort()).toEqual(['Discharge TSS limit', 'TSS trigger – two consecutive results']);
    expect(impact.guidelineSets).toEqual([]); // guideline sets are the library's, not the project's

    await deleteParameter('tss', projectId);
    expect(await resultsFor('tss')).toBe(0);
    expect((await db.rules.where('projectId').equals(projectId).toArray()).some((r) => r.parameterId === 'tss')).toBe(false);
    expect(await db.parameters.get('tss')).toBeTruthy();
    // other parameters' results are untouched, and samples with other results stay
    expect(await resultsFor('ph')).toBeGreaterThan(0);
    expect(await db.samples.where('projectId').equals(projectId).count()).toBeGreaterThan(0);
  });

  it('deletes a parameter from the library: everywhere, with schedules and your guideline sets updated – and it stays deleted', async () => {
    const sch = newSchedule(projectId, { name: 'Field', parameterIds: ['turbidity', 'ph'] });
    await saveSchedule(sch);
    const set: GuidelineSet = { id: 'gl-test', name: 'Site triggers', shortName: 'ST', builtIn: false, values: [{ parameterId: 'turbidity', max: 10, unit: 'NTU' }, { parameterId: 'ph', min: 6.5, max: 8.5, unit: 'pH' }], updatedAt: '' };
    await saveGuidelineSet(set);

    const impact = await parameterImpact('turbidity');
    expect(impact.projects).toHaveLength(1);
    expect(impact.results).toBe(await resultsFor('turbidity'));
    expect(impact.rules.map((r) => r.name)).toEqual(['Turbidity increase downstream']);
    expect(impact.schedules.map((s) => s.name)).toEqual(['Field']);
    expect(impact.guidelineSets.map((g) => g.name)).toEqual(['Site triggers']);

    await deleteParameter('turbidity');
    expect(await db.parameters.get('turbidity')).toBeUndefined();
    expect(await resultsFor('turbidity')).toBe(0);
    expect((await db.schedules.get(sch.id))?.parameterIds).toEqual(['ph']);
    expect((await db.guidelineSets.get('gl-test'))?.values.map((v) => v.parameterId)).toEqual(['ph']);
    // shared with the workspace as a deletion …
    expect((await db.syncState.get('parameters\u0001turbidity'))?.d).toBeTruthy();
    // … and the built-in parameter isn't put back the next time the app starts
    await ensureBuiltIns();
    expect(await db.parameters.get('turbidity')).toBeUndefined();
    expect(await db.parameters.get('ph')).toBeTruthy();
  });

  it('says when nothing uses a parameter', async () => {
    const impact = await parameterImpact('tss', projectId);
    expect(impact).toMatchObject({ results: 0, emptySamples: 0, rules: [], schedules: [] });
  });
});
