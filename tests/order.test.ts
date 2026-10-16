import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { BUILT_IN_PARAMETERS, PARAMETER_GROUPS, compareParams } from '../src/data/parameters';
import { EnviroDatabase, ensureBuiltIns } from '../src/db/db';
import { createDemoProject } from '../src/db/demo';
import { consentParameterIds, pivot } from '../src/lib/analysis';
import { loadBundle } from './helpers';

const ids = (list: Array<{ id: string }>) => list.map((p) => p.id);

describe('the order of analytes', () => {
  const sorted = [...BUILT_IN_PARAMETERS].sort(compareParams);

  it('lists field measurements first, then laboratory groups, dissolved metals before total metals', () => {
    const groups = sorted.map((p) => p.group).filter((g, i, a) => a.indexOf(g) === i);
    expect(groups).toEqual(PARAMETER_GROUPS.filter((g) => groups.includes(g)));
    expect(groups).not.toContain('Other');
    expect(ids(sorted).slice(0, 6)).toEqual(['ph-field', 'temp', 'ec-field', 'do', 'do-sat', 'turbidity-field']);
    const at = (id: string) => ids(sorted).indexOf(id);
    expect(at('swl')).toBeLessThan(at('ph')); // groundwater level is a field measurement
    expect(at('tss')).toBeLessThan(at('hardness'));
    expect(at('hardness')).toBeLessThan(at('nh4-n'));
    expect(at('drp')).toBeLessThan(at('ecoli'));
    expect(at('ecoli')).toBeLessThan(at('as-d'));
    const lastDissolved = Math.max(...sorted.flatMap((p, i) => (p.group === 'Metals (dissolved)' ? [i] : [])));
    const firstTotal = sorted.findIndex((p) => p.group === 'Metals (total)');
    expect(lastDissolved).toBeLessThan(firstTotal);
    expect(at('zn-t')).toBeLessThan(at('tph-c7-c9'));
  });

  it('puts parameters of unknown groups with Other, after everything else', () => {
    const odd = { id: 'x', name: 'Something', group: 'Not a group', order: 0 };
    const other = { id: 'y', name: 'Another', group: 'Other', order: 5 };
    expect([odd, ...sorted.slice(0, 3), other].sort(compareParams).slice(-2).map((p) => p.id)).toEqual(['x', 'y']);
  });

  it('moves an older database from the combined "Physical & field" group, keeping the user’s own groups', async () => {
    const old = new EnviroDatabase('order-migration');
    await ensureBuiltIns(old);
    const ph = (await old.parameters.get('ph'))!;
    await old.parameters.bulkPut([
      { ...ph, group: 'Physical & field', order: 0 },
      { ...(await old.parameters.get('ph-field'))!, group: 'Physical & field', order: 1 },
      { ...(await old.parameters.get('salinity'))!, group: 'General chemistry' }, // moved by the user
      { id: 'sonde-turb', name: 'Turbidity (field sonde)', group: 'Physical & field', unit: 'NTU', aliases: [], order: 10000 },
      { id: 'lab-colour', name: 'Apparent Colour', group: 'Physical & field', unit: 'Hazen units', aliases: [], order: 10000 },
    ]);
    await ensureBuiltIns(old);
    const get = async (id: string) => (await old.parameters.get(id))!;
    expect((await get('ph')).group).toBe('Physical');
    expect((await get('ph')).order).toBe(BUILT_IN_PARAMETERS.find((p) => p.id === 'ph')!.order);
    expect((await get('ph-field')).group).toBe('Field');
    expect((await get('salinity')).group).toBe('General chemistry');
    expect((await get('sonde-turb')).group).toBe('Field');
    expect((await get('lab-colour')).group).toBe('Physical');
    expect(await old.parameters.where('group').equals('Physical & field').count()).toBe(0);
    old.close();
  });
});

describe('consent parameters', () => {
  let projectId = '';
  beforeAll(async () => {
    await ensureBuiltIns();
    projectId = await createDemoProject();
  });

  it('finds the parameters with limits, with triggers, and everything the consent covers', async () => {
    const b = await loadBundle(projectId);
    const limits = consentParameterIds(b, 'limits');
    const triggers = consentParameterIds(b, 'triggers');
    const consent = consentParameterIds(b, 'consent');
    expect([...limits].sort()).toEqual(['ph', 'tss', 'turbidity']);
    for (const id of ['tss', 'no3-n', 'nh4-n', 'cu-d', 'zn-d']) expect(triggers.has(id)).toBe(true); // incl. the metals of the ANZG trigger
    expect(triggers.has('ph')).toBe(false);
    for (const id of [...limits, ...triggers]) expect(consent.has(id)).toBe(true);
    expect(consent.has('ecoli')).toBe(false);
    // a sampling schedule's required parameters are in the consent too
    const withSchedule = { ...b, schedules: [...b.schedules, { ...b.schedules[0], id: 's2', parameterIds: ['ecoli'], active: true }] };
    expect(consentParameterIds(withSchedule, 'consent').has('ecoli')).toBe(true);
    expect(consentParameterIds(withSchedule, 'limits').has('ecoli')).toBe(false);
    // inactive rules don't count
    const off = { ...b, rules: b.rules.map((r) => ({ ...r, active: false })), schedules: [] };
    expect(consentParameterIds(off, 'consent').size).toBe(0);
  });

  it('shows the data columns in the logical order whatever order they were picked in', async () => {
    const b = await loadBundle(projectId);
    const all = pivot(b, { siteIds: [], paramIds: [], start: '1900-01-01', end: '2199-12-31' }).columns;
    expect(ids(all)).toEqual(ids([...all].sort(compareParams)));
    expect(all.findIndex((p) => p.group === 'Field')).toBe(0);
  });
});
