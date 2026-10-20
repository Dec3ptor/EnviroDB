import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { db, ensureBuiltIns } from '../src/db/db';
import { createDemoProject } from '../src/db/demo';
import { checkResults, distanceM, wayTo, type FieldSite } from '../src/field/model';
import { addSheet, addSite, fieldDb, resultsOf, saveVisit, updateSite } from '../src/field/db';
import { commitField, makeSheet, planField } from '../src/db/field';
import { siteLatLng } from '../src/lib/nztm';
import { stableId } from '../src/lib/ids';
import { loadBundle } from './helpers';

let projectId: string;
beforeAll(async () => {
  await ensureBuiltIns();
  projectId = await createDemoProject();
});

const sheetFor = async () => {
  const b = await loadBundle(projectId);
  return makeSheet(b, { round: 'October 2026 monitoring', date: '2026-10-21', siteIds: b.sites.map((s) => s.id), measureIds: ['ph-field', 'temp'], observe: { weather: true, flow: false, appearance: false, photos: false }, withLast: false });
};
const newPoint = (patch: Partial<FieldSite> = {}): FieldSite => ({ id: 'new-abc123', code: 'SW9', name: 'Tributary at the ford', type: 'Surface water', note: 'Through the gate by the woolshed', added: true, lat: -37.7105, lng: 175.4071, located: { at: '2026-10-21T09:00:00Z', how: 'gps', acc: 6 }, ...patch });

describe('maps in field mode', () => {
  it('which way and how far a site is', () => {
    const here = { lat: -37.7116, lng: 175.4090 };
    expect(wayTo(here, here)).toBe('here');
    expect(wayTo(here, { lat: -37.7086, lng: 175.4090 })).toMatch(/^33\d m north$/);
    expect(wayTo(here, { lat: -37.7116, lng: 175.4290 })).toMatch(/^1\.8 km east$/);
    expect(wayTo(here, { lat: -37.7146, lng: 175.4050 })).toMatch(/ south-west$/);
  });

  it('on the phone: a site placed here and a new site go back with the results – and stay when the sheet is opened again', async () => {
    const sheet = await sheetFor();
    await addSheet(sheet);
    const us1 = sheet.sites[0];
    await updateSite(sheet.id, us1.id, { lat: -37.7117, lng: 175.4091, located: { at: '2026-10-21T08:30:00Z', how: 'map' } });
    await addSite(sheet.id, newPoint());
    await saveVisit(sheet.id, { siteId: 'new-abc123', time: '2026-10-21T09:05', values: { 'ph-field': 7.4 }, done: true });
    // the computer's sheet for the day opened again: the location placed here and the new site stay
    await addSheet(sheet);
    const kept = (await fieldDb.sheets.get(sheet.id))!.sheet;
    expect(kept.sites.find((s) => s.id === us1.id)).toMatchObject({ lat: -37.7117, lng: 175.4091, located: { how: 'map' } });
    expect(kept.sites.at(-1)).toMatchObject({ id: 'new-abc123', added: true, type: 'Surface water' });
    const visits = (await fieldDb.visits.where('sheetId').equals(sheet.id).toArray()).map((v) => v.visit);
    const res = resultsOf(kept, visits, 'R. Tester');
    expect(res.newSites).toEqual([{ id: 'new-abc123', code: 'SW9', name: 'Tributary at the ford', type: 'Surface water', lat: -37.7105, lng: 175.4071, acc: 6, how: 'gps', note: 'Through the gate by the woolshed' }]);
    expect(res.located).toEqual([{ siteId: us1.id, lat: -37.7117, lng: 175.4091, acc: undefined, how: 'map', at: '2026-10-21T08:30:00Z' }]);
    expect(res.visits.map((v) => v.siteId)).toEqual(['new-abc123']);
    // a new site with nothing recorded is kept too (the point was to add it)
    await addSite(sheet.id, newPoint({ id: 'new-empty', code: 'SW10', lat: undefined, lng: undefined, located: undefined }));
    await addSheet(sheet);
    expect((await fieldDb.sheets.get(sheet.id))!.sheet.sites.map((s) => s.code)).toContain('SW10');
  });

  it('checked when they come in: no places off the earth, no site without a code', () => {
    const r = checkResults({
      app: 'EnviroDB',
      kind: 'field-results',
      sheet: { id: 'x', project: { id: 'p', name: 'P' } },
      visits: [],
      newSites: [{ id: 'n1', code: ' SW9 ', lat: 200, lng: 175 }, { id: 'n2', code: '' }, { id: 'n3', code: 'GW9', lat: -37.7, lng: 175.4, how: 'teleport', evil: 1 }],
      located: [{ siteId: 's1', lat: -37.7, lng: 175.4, how: 'gps', acc: 5 }, { siteId: 's2', lat: 'x', lng: 1 }],
    });
    expect(r.newSites).toEqual([
      { id: 'n1', code: 'SW9', name: undefined, type: undefined, note: undefined },
      { id: 'n3', code: 'GW9', name: undefined, type: undefined, lat: -37.7, lng: 175.4, acc: undefined, how: undefined, note: undefined },
    ]);
    expect(r.located).toEqual([{ siteId: 's1', lat: -37.7, lng: 175.4, acc: 5, how: 'gps', at: '' }]);
  });

  it('on the computer: new sites and locations listed, added only when ticked, never twice', async () => {
    const b = await loadBundle(projectId);
    const us1 = b.sites[0];
    const before = siteLatLng(us1)!;
    const results = checkResults({
      app: 'EnviroDB',
      kind: 'field-results',
      sheet: { id: `${projectId}:2026-10-21`, project: { id: projectId, name: b.project.name }, round: 'October 2026 monitoring', date: '2026-10-21' },
      sent: '2026-10-21T12:00:00Z',
      visits: [
        { siteId: 'new-abc123', time: '2026-10-21T09:05', values: { 'ph-field': 7.4 }, done: true },
        { siteId: 'new-dup', time: '2026-10-21T09:30', values: { 'ph-field': 7.1 }, done: true },
      ],
      newSites: [
        { id: 'new-abc123', code: 'SW9', name: 'Tributary at the ford', type: 'Surface water', lat: -37.7105, lng: 175.4071, acc: 6, how: 'gps', note: 'Through the gate' },
        // made on the phone with a code the project has: its readings go to that site
        { id: 'new-dup', code: 'ds1', lat: -37.7, lng: 175.4 },
        { id: 'new-skip', code: 'SW10', type: 'Spaceship' },
      ],
      located: [{ siteId: us1.id, lat: before.lat + 0.0003, lng: before.lng, how: 'gps', acc: 4, at: '2026-10-21T08:30:00Z' }],
    });
    const plan = planField(b, results);
    expect(plan.newSites.map((n) => [n.field.code, n.existing, n.site.code])).toEqual([
      ['SW9', false, 'SW9'],
      ['ds1', true, 'DS1'],
      ['SW10', false, 'SW10'],
    ]);
    expect(plan.newSites[2].site.type).toBe('Other');
    const sw9 = plan.newSites[0].site;
    expect(sw9.id).toBe(stableId('site', projectId, 'new-abc123'));
    expect(siteLatLng(sw9)!.lat).toBeCloseTo(-37.7105, 4);
    expect(plan.located).toHaveLength(1);
    expect(plan.located[0].movedM).toBeGreaterThan(30);
    expect(plan.located[0].movedM).toBeLessThan(36);
    expect(plan.rows.map((r) => r.site.code)).toEqual(['SW9', 'DS1']);

    // SW10 unticked; SW9 and US1's location taken
    const done = await commitField(projectId, plan, 'field.json', { newSites: new Set(['new-abc123']), located: new Set([us1.id]) });
    expect(done).toMatchObject({ sitesAdded: 1, located: 1, samples: 2 });
    const saved = await db.sites.get(sw9.id);
    expect(saved).toMatchObject({ code: 'SW9', name: 'Tributary at the ford', type: 'Surface water', description: 'Through the gate', projectId });
    expect(await db.sites.where('projectId').equals(projectId).filter((s) => s.code === 'SW10').count()).toBe(0);
    expect(distanceM(siteLatLng((await db.sites.get(us1.id))!)!, { lat: before.lat + 0.0003, lng: before.lng })).toBeLessThan(2);
    expect(await db.results.where('projectId').equals(projectId).filter((r) => r.siteId === sw9.id).count()).toBe(1);
    expect(done.batch.notes).toMatch(/Sites added in the field: SW9\. Locations set in the field: US1\./);

    // the same file added again: SW9 is the project's now, not a second SW9
    const again = planField(await loadBundle(projectId), results);
    expect(again.newSites[0]).toMatchObject({ existing: true });
    await commitField(projectId, again, 'field.json');
    expect(await db.sites.where('projectId').equals(projectId).filter((s) => s.code === 'SW9').count()).toBe(1);
  });
});
