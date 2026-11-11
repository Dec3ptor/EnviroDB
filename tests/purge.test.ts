import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { db, ensureBuiltIns } from '../src/db/db';
import { createDemoProject } from '../src/db/demo';
import { commitField, defaultMeasures, makeSheet, planField } from '../src/db/field';
import { checkResults, checkSheet, type FieldResults } from '../src/field/model';
import { resultsOf } from '../src/field/db';
import { STABLE_RULES, casingVolume, checkPurge, litresPerMetre, purgeProgress, purgeSummary, ruleText, stability, usualRules, withTolerances, type PurgeLog, type PurgeReading } from '../src/lib/purge';
import { loadBundle } from './helpers';

const reading = (time: string, litres: number, values: Record<string, number>, level?: number): PurgeReading => ({ time, litres, values, ...(level !== undefined ? { level } : {}) });

describe('the water standing in a bore', () => {
  it('a metre of 50 mm casing holds 1.96 L; 100 mm, four times that', () => {
    expect(litresPerMetre(50)).toBeCloseTo(1.9635, 4);
    expect(litresPerMetre(100)).toBeCloseTo(7.854, 3);
    expect(litresPerMetre(25)).toBeCloseTo(0.4909, 4);
  });

  it('from the bore’s depth, the depth to water and the casing’s diameter', () => {
    // 5 m of water in 50 mm casing
    expect(casingVolume(12, 7, 50)).toBeCloseTo(9.817, 3);
    expect(casingVolume(12, 7, undefined)).toBeNull();
    expect(casingVolume(undefined, 7, 50)).toBeNull();
    expect(casingVolume(12, undefined, 50)).toBeNull();
    // the water level at or below the bottom: something's been mistyped
    expect(casingVolume(12, 12, 50)).toBeNull();
    expect(casingVolume(12, 13.5, 50)).toBeNull();
    expect(casingVolume(12, 7, 0)).toBeNull();
    expect(casingVolume(NaN, 7, 50)).toBeNull();
  });

  it('how far a purge has got: the volumes aimed for, the litres out, the drawdown', () => {
    const log: PurgeLog = { depth: 12, swl: 7, diameter: 50, readings: [reading('10:00', 5, {}), reading('10:05', 12, {}, 7.4), { time: '10:10', values: { 'ph-field': 6.8 } }] };
    const p = purgeProgress(log);
    expect(p.casing).toBeCloseTo(9.817, 3);
    expect(p.target).toBeCloseTo(29.45, 2); // three casing volumes unless said
    expect(p.purged).toBe(12);
    expect(p.volumesPurged).toBeCloseTo(1.222, 3);
    expect(p.drawdown).toBeCloseTo(0.4, 10);
    expect(purgeProgress({ ...log, volumes: 5 }).target).toBeCloseTo(49.09, 2);
    expect(purgeProgress({ readings: [] })).toEqual({ casing: null, target: null, purged: null, volumesPurged: null, drawdown: null });
  });
});

describe('whether the readings have settled', () => {
  it('each of the last three within its criterion of each other – in its unit, or as a share of their mean', () => {
    const readings = [
      reading('10:00', 4, { 'ph-field': 7.2, 'ec-field': 380, temp: 15.0 }),
      reading('10:05', 8, { 'ph-field': 6.8, 'ec-field': 400, temp: 14.3 }),
      reading('10:10', 12, { 'ph-field': 6.84, 'ec-field': 405, temp: 14.2 }),
      reading('10:15', 16, { 'ph-field': 6.88, 'ec-field': 415, temp: 14.2 }),
    ];
    const s = stability(readings);
    expect(s.enough).toBe(true);
    expect(s.stable).toBe(false);
    const by = Object.fromEntries(s.checks.map((c) => [c.id, c]));
    // pH: 6.80, 6.84, 6.88 – 0.08 apart, within 0.1
    expect(by['ph-field']).toMatchObject({ values: [6.8, 6.84, 6.88], ok: true });
    expect(by['ph-field'].spread).toBeCloseTo(0.08, 10);
    // EC: 15 apart; 3% of their mean (406.7) is 12.2
    expect(by['ec-field'].ok).toBe(false);
    expect(by['ec-field'].allowed).toBeCloseTo(12.2, 1);
    expect(by.temp).toMatchObject({ ok: true });
    // one more reading, and the EC has settled too
    const more = stability([...readings, reading('10:20', 20, { 'ph-field': 6.86, 'ec-field': 412, temp: 14.2 })]);
    expect(more.stable).toBe(true);
  });

  it('exactly the tolerance apart counts as within it', () => {
    expect(stability([reading('1', 1, { 'ph-field': 7.0 }), reading('2', 2, { 'ph-field': 7.05 }), reading('3', 3, { 'ph-field': 7.1 })]).stable).toBe(true);
    expect(stability([reading('1', 1, { 'ph-field': 7.0 }), reading('2', 2, { 'ph-field': 7.05 }), reading('3', 3, { 'ph-field': 7.11 })]).stable).toBe(false);
  });

  it('fewer than three readings of something aren’t judged; with none judged, nothing’s settled', () => {
    const two = stability([reading('1', 1, { 'ph-field': 7 }), reading('2', 2, { 'ph-field': 7 })]);
    expect(two).toEqual({ stable: false, enough: false, checks: [] });
    // a reading that skipped the DO: its last three DO values are still the last three taken
    const s = stability([reading('1', 1, { do: 2.0, temp: 14 }), reading('2', 2, { do: 2.1, temp: 14 }), reading('3', 3, { temp: 14 }), reading('4', 4, { do: 2.2, temp: 14 })]);
    expect(s.checks.find((c) => c.id === 'do')).toMatchObject({ values: [2, 2.1, 2.2], ok: true });
    // readings with nothing the criteria know: nothing to judge
    expect(stability([reading('1', 1, { other: 1 }), reading('2', 2, { other: 1 }), reading('3', 3, { other: 1 })]).enough).toBe(false);
  });

  it('criteria of one’s own, over the usual', () => {
    const tight = withTolerances({ 'ph-field': 0.05, temp: -1, nope: 3 });
    expect(tight.find((r) => r.id === 'ph-field')!.tol).toBe(0.05);
    expect(tight.find((r) => r.id === 'temp')!.tol).toBe(STABLE_RULES.find((r) => r.id === 'temp')!.tol);
    expect(usualRules(withTolerances(undefined))).toBe(true);
    expect(usualRules(tight)).toBe(false);
    const readings = [reading('1', 1, { 'ph-field': 6.8 }), reading('2', 2, { 'ph-field': 6.84 }), reading('3', 3, { 'ph-field': 6.88 })];
    expect(stability(readings).stable).toBe(true);
    expect(stability(readings, tight).stable).toBe(false);
    expect(ruleText({ tol: 0.1, kind: 'abs' })).toBe('within 0.1');
    expect(ruleText({ tol: 3, kind: 'pct' })).toBe('within 3%');
    expect(ruleText({ tol: 0.3, kind: 'abs', unit: 'mg/L' })).toBe('within 0.3 mg/L');
  });
});

describe('the purge in a line', () => {
  const settled = [reading('10:00', 10, { 'ph-field': 6.8 }), reading('10:05', 20, { 'ph-field': 6.82 }), reading('10:10', 29.5, { 'ph-field': 6.81 }, 7.35)];
  it('what was taken out, in casing volumes, and whether the readings settled', () => {
    expect(purgeSummary({ depth: 12, swl: 7, diameter: 50, readings: settled })).toBe('Purged 29.5 L (3 casing volumes of 9.8 L); readings settled after 3; drawdown 0.35 m');
    expect(purgeSummary({ depth: 12, swl: 7, diameter: 50, readings: [reading('10:00', 9.8, { 'ph-field': 6.8 })] })).toBe('Purged 9.8 L (1 casing volume of 9.8 L); 1 reading taken');
    const unsettled = [...settled.slice(0, 2), reading('10:10', 29.5, { 'ph-field': 7.4 })];
    expect(purgeSummary({ readings: unsettled })).toBe('Purged 29.5 L; readings not settled after 3 (pH)');
    expect(purgeSummary({ depth: 12, swl: 7, diameter: 50, readings: [] })).toBe('Casing volume 9.8 L');
    expect(purgeSummary({ readings: [] })).toBe('');
    // judged by the criteria it carries
    expect(purgeSummary({ readings: unsettled, rules: withTolerances({ 'ph-field': 1 }) })).toBe('Purged 29.5 L; readings settled after 3');
  });
});

describe('a purge log from a file', () => {
  it('is checked: numbers only, a sensible size', () => {
    const got = checkPurge({
      depth: 12, swl: '7', diameter: 50, volumes: 3, extra: 'x',
      readings: [{ time: '10:00', litres: 5, level: 'deep', values: { 'ph-field': 6.8, bad: 'x', ok: 2 }, more: 1 }, 'nope', { time: 12, values: null }],
      rules: [{ id: 'ph-field', label: 'pH', tol: 0.05, kind: 'abs' }, { id: 'ec-field', tol: -1 }, { tol: 2 }, { id: 'do-sat', tol: 5, kind: 'pct', unit: 3 }],
    })!;
    expect(got).toEqual({
      depth: 12, diameter: 50, volumes: 3,
      readings: [{ time: '10:00', litres: 5, values: { 'ph-field': 6.8, ok: 2 } }, { time: '', values: {} }],
      rules: [{ id: 'ph-field', label: 'pH', tol: 0.05, kind: 'abs' }, { id: 'do-sat', label: 'do-sat', tol: 5, kind: 'pct' }],
    });
    expect(checkPurge(undefined)).toBeUndefined();
    expect(checkPurge('x')).toBeUndefined();
    expect(checkPurge({ readings: [] })).toBeUndefined();
    expect(checkPurge({ readings: Array.from({ length: 100 }, () => ({ time: '1', values: {} })) })!.readings).toHaveLength(60);
  });
});

describe('from the field sheet to the sample', () => {
  let projectId = '';
  beforeAll(async () => {
    await ensureBuiltIns();
    projectId = await createDemoProject();
  });

  it('a bore’s depth and casing diameter go to the phone with the sheet', async () => {
    const gwId = (await db.sites.where('projectId').equals(projectId).toArray()).find((s) => s.code === 'GW1')!.id;
    await db.sites.update(gwId, { bore: { depth: 12, stickUp: 0.6 } });
    const b = await loadBundle(projectId);
    const sheet = makeSheet(b, { round: 'November 2026', date: '2026-11-12', siteIds: b.sites.map((s) => s.id), measureIds: [...new Set([...defaultMeasures(b), 'swl', 'ph-field'])], observe: { weather: true, flow: false, appearance: false, photos: false }, withLast: false });
    const gw = sheet.sites.find((s) => s.id === gwId)!;
    expect(gw.bore).toEqual({ depth: 12 });
    expect(sheet.sites.find((s) => s.code === 'US1')!.bore).toBeUndefined();
    // it survives the journey, checked
    const read = checkSheet(JSON.parse(JSON.stringify({ ...sheet, sites: sheet.sites.map((s) => (s.id === gwId ? { ...s, bore: { depth: 12, diameter: 50, junk: 'x' } } : s)) })));
    expect(read.sites.find((s) => s.id === gwId)!.bore).toEqual({ depth: 12, diameter: 50 });
  });

  it('the purge comes back with the sample: its log, a line in the notes, the volume as a result, the casing’s diameter on the site', async () => {
    const b = await loadBundle(projectId);
    const gw = b.sites.find((s) => s.code === 'GW1')!;
    const sheet = makeSheet(b, { round: 'November 2026', date: '2026-11-12', siteIds: [gw.id], measureIds: ['swl', 'ph-field', 'ec-field', 'temp'], observe: { weather: false, flow: false, appearance: false, photos: false }, withLast: false });
    const purge: PurgeLog = { depth: 12, swl: 7, diameter: 50, readings: [reading('10:00', 10, { 'ph-field': 6.8, 'ec-field': 400 }), reading('10:05', 20, { 'ph-field': 6.82, 'ec-field': 402 }), reading('10:10', 29.5, { 'ph-field': 6.81, 'ec-field': 401 })] };
    const sent = resultsOf(sheet, [{ siteId: gw.id, time: '2026-11-12T10:15', values: { swl: 7, 'ph-field': 6.81, 'ec-field': 401, 'purge-vol': 29.5 }, purge, done: true }], 'R. Tester');
    const results = checkResults(JSON.parse(JSON.stringify(sent))) as FieldResults;
    expect(results.visits[0].purge).toEqual(purge);
    const plan = planField(b, results);
    expect(plan.unknownParams).toEqual([]);
    await commitField(projectId, plan, 'results.json');
    const sample = (await db.samples.where('projectId').equals(projectId).toArray()).find((s) => s.siteId === gw.id && s.date.startsWith('2026-11-12'))!;
    expect(sample.purge).toEqual(purge);
    expect(sample.notes!.split('\n')).toContain('Field purge: Purged 29.5 L (3 casing volumes of 9.8 L); readings settled after 3');
    const got = await db.results.where('sampleId').equals(sample.id).toArray();
    expect(got.find((r) => r.parameterId === 'purge-vol')).toMatchObject({ value: 29.5, unit: 'L' });
    // the site had no casing diameter: the one typed in on the phone is kept; its depth stays as it was
    expect((await db.sites.get(gw.id))!.bore).toMatchObject({ depth: 12, diameter: 50, stickUp: 0.6 });
    // sent again (a correction on the phone): one purge line, not two
    const again = { ...results, visits: [{ ...results.visits[0], purge: { ...purge, readings: purge.readings.slice(0, 2) } }] };
    await commitField(projectId, planField(await loadBundle(projectId), again), 'results.json');
    const after = (await db.samples.get(sample.id))!;
    expect(after.notes!.split('\n').filter((l) => l.startsWith('Field purge: '))).toEqual(['Field purge: Purged 20 L (2 casing volumes of 9.8 L); 2 readings taken']);
    expect(after.purge!.readings).toHaveLength(2);
  });

  it('a visit with only a purge log still makes its sample', async () => {
    const b = await loadBundle(projectId);
    const gw = b.sites.find((s) => s.code === 'GW1')!;
    const sheet = makeSheet(b, { round: 'December 2026', date: '2026-12-10', siteIds: [gw.id], measureIds: ['swl'], observe: { weather: false, flow: false, appearance: false, photos: false }, withLast: false });
    const sent = resultsOf(sheet, [{ siteId: gw.id, values: {}, purge: { readings: [reading('09:00', 5, {})] } }], '');
    expect(sent.visits).toHaveLength(1);
    const plan = planField(b, checkResults(JSON.parse(JSON.stringify(sent))) as FieldResults);
    expect(plan.rows).toHaveLength(1);
  });
});
