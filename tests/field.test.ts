import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { db, ensureBuiltIns, saveSettings } from '../src/db/db';
import { createDemoProject } from '../src/db/demo';
import { checkResults, checkSheet, decodeSheet, encodeSheet, readingWarning, type FieldResults } from '../src/field/model';
import { addSheet, fieldDb, resultsFileName, resultsOf, saveVisit } from '../src/field/db';
import { commitField, defaultMeasures, makeSheet, planField } from '../src/db/field';
import { sniffLabFile } from '../src/importers/sniff';
import { stableId } from '../src/lib/ids';
import { loadBundle } from './helpers';

describe('field sheets', () => {
  let projectId: string;
  beforeAll(async () => {
    await ensureBuiltIns();
    await saveSettings({ author: 'R. Tester' });
    projectId = await createDemoProject();
  });

  it('are made from the project, with last time’s readings, and travel in a link', async () => {
    const b = await loadBundle(projectId);
    const measures = defaultMeasures(b);
    expect(measures.length).toBeGreaterThan(0);
    expect(measures.every((id) => b.paramMap.get(id)?.group === 'Field')).toBe(true);
    const sheet = makeSheet(b, { round: 'October 2026 monitoring', date: '2026-10-20', siteIds: b.sites.map((s) => s.id), measureIds: measures, observe: { weather: true, flow: true, appearance: false, photos: true }, withLast: true, by: 'R. Tester' });
    expect(sheet.id).toBe(`${projectId}:2026-10-20`);
    expect(sheet.sites).toHaveLength(b.sites.length);
    expect(sheet.sites.some((s) => s.last && Object.keys(s.last.values).length)).toBe(true);
    expect(sheet.sites.every((s) => s.lat !== undefined)).toBe(true);
    // a bore's water level isn't asked for at a stream
    const gw = sheet.sites.find((s) => b.siteMap.get(s.id)?.type === 'Groundwater');
    const stream = sheet.sites.find((s) => b.siteMap.get(s.id)?.type === 'Surface water');
    if (measures.includes('swl') && gw && stream) {
      expect(stream.measures ?? measures).not.toContain('swl');
      expect(gw.measures ?? measures).toContain('swl');
    }
    const text = await encodeSheet(sheet);
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
    // a phone camera reads a QR code of the link easily
    expect(text.length).toBeLessThan(2000);
    expect(await decodeSheet(text)).toEqual(JSON.parse(JSON.stringify(sheet)));
  });

  it('are checked when they come in (from a link or a file)', () => {
    expect(() => checkSheet({ app: 'Other', kind: 'field-sheet' })).toThrow(/isn’t an EnviroDB field sheet/);
    const s = checkSheet({ app: 'EnviroDB', kind: 'field-sheet', id: 'x', project: { id: 'p', name: 'P', extra: 1 }, sites: [{ id: 's1', code: 'A', last: { date: '2026-01-01', values: { ph: 7, bad: 'x' } } }, { code: 'no id' }], measures: [{ id: 'ph', name: 'pH', unit: 'pH', min: 'no' }], evil: '<script>' });
    expect(s.sites).toEqual([{ id: 's1', code: 'A', name: undefined, lat: undefined, lng: undefined, note: undefined, last: { date: '2026-01-01', values: { ph: 7 } } }]);
    expect(s.measures[0]).toEqual({ id: 'ph', name: 'pH', unit: 'pH', dp: undefined, min: undefined, max: undefined });
    expect('evil' in s).toBe(false);
  });

  it('warn of a likely slip of the thumb', () => {
    const ph = { id: 'ph-field', name: 'pH', unit: 'pH' };
    expect(readingWarning(ph, 7.2, 7.1)).toBeNull();
    expect(readingWarning(ph, 72, 7.1)).toMatch(/Above 11/);
    expect(readingWarning(ph, 5.2, 7.1)).toMatch(/Last time 7.1/);
    expect(readingWarning({ id: 'ec-field', name: 'EC', unit: 'µS/cm' }, 2400, 210)).toMatch(/Last time 210/);
    expect(readingWarning({ id: 'ec-field', name: 'EC', unit: 'µS/cm' }, 260, 210)).toBeNull();
  });
});

describe('the phone and back', () => {
  let projectId: string;
  beforeAll(async () => {
    await ensureBuiltIns();
    projectId = await createDemoProject();
  });

  it('records on the phone, sends a file, and the computer adds it to the day’s samples', async () => {
    const b = await loadBundle(projectId);
    const [s1, s2, s3] = b.sites;
    const sheet = makeSheet(b, { round: 'Round', date: '2026-10-20', siteIds: [s1.id, s2.id, s3.id], measureIds: ['ph-field', 'temp'], observe: { weather: true, flow: true, appearance: true, photos: true }, withLast: false });
    // on the phone
    await addSheet(checkSheet(JSON.parse(JSON.stringify(sheet))));
    await saveVisit(sheet.id, { siteId: s1.id, time: '2026-10-20T09:15', values: { 'ph-field': 7.4, temp: 14.2 }, weather: 'Fine', flow: 'Normal', notes: 'Slight sheen', done: true, gps: { lat: -37.78, lng: 175.27, acc: 6 }, photos: [{ name: 'a.jpg', dataUrl: 'data:image/jpeg;base64,/9j/4AAQ' }] });
    await saveVisit(sheet.id, { siteId: s2.id, values: { 'ph-field': 72 }, done: true });
    await saveVisit(sheet.id, { siteId: s3.id, values: {}, notSampled: 'Dry', done: true });
    const visits = (await fieldDb.visits.where('sheetId').equals(sheet.id).toArray()).map((v) => v.visit);
    const results = resultsOf(sheet, visits, 'Sam Sampler');
    expect(results.visits.map((v) => v.siteId)).toEqual([s1.id, s2.id, s3.id]);
    expect(resultsFileName(sheet)).toMatch(/^Field results - DEMO-001 - 2026-10-20\.envirodb-field\.json$/);
    const file = new File([JSON.stringify(results)], resultsFileName(sheet), { type: 'application/json' });
    // the inbox knows it, and which project it's for
    const sniff = await sniffLabFile(file);
    expect(sniff).toMatchObject({ lab: true, labName: 'Field results', field: { projectId } });

    // on the computer: the lab's sample for the day is already in
    const labSample = stableId('s', projectId, s1.id, '2026-10-20');
    await db.samples.put({ id: labSample, projectId, siteId: s1.id, date: '2026-10-20', labName: 'Hill Labs', notes: 'Lab job 123' });
    const plan = planField(b, checkResults(JSON.parse(await file.text())) as FieldResults);
    expect(plan.rows.map((r) => r.site.code)).toEqual([s1.code, s2.code]);
    expect(plan.notSampled).toEqual([{ site: s3, reason: 'Dry' }]);
    expect(plan.rows[1].values[0].warning).toMatch(/Above 11/);
    const done = await commitField(projectId, plan, file.name);
    expect(done).toMatchObject({ samples: 2, results: 3, photos: 0 });
    expect(done.photoError).toMatch(/shared folder isn’t connected/);
    const sample = (await db.samples.get(labSample))!;
    expect(sample.date).toBe('2026-10-20T09:15');
    expect(sample.notes).toBe('Lab job 123\nField: weather fine, flow normal. Slight sheen (Sam Sampler)\nField location: -37.78, 175.27 (±6 m)');
    expect((await db.results.get(stableId('r', labSample, 'ph-field')))?.value).toBe(7.4);
    const batch = (await db.imports.get(done.batch.id))!;
    expect(batch.kind).toBe('field');
    expect(batch.notes).toMatch(/Not sampled: .* \(Dry\)/);

    // sent again later (a corrected reading): replaces, doesn't repeat
    const again = { ...results, visits: results.visits.map((v) => (v.siteId === s1.id ? { ...v, values: { ...v.values, 'ph-field': 7.5 } } : v)) };
    await commitField(projectId, planField(b, again), file.name);
    const after = (await db.samples.get(labSample))!;
    expect(after.notes!.split('\n').filter((l) => l.startsWith('Field:'))).toHaveLength(1);
    expect((await db.results.get(stableId('r', labSample, 'ph-field')))?.value).toBe(7.5);
  });

  it('checks a results file and keeps only pictures that are pictures', () => {
    const r = checkResults({
      app: 'EnviroDB',
      kind: 'field-results',
      sheet: { id: 'x', project: { id: 'p', name: 'P' }, round: 'R', date: '2026-10-20' },
      visits: [{ siteId: 's', values: { ph: 7, x: 'no' }, photos: [{ name: 'ok.jpg', dataUrl: 'data:image/jpeg;base64,AAAA' }, { name: 'bad', dataUrl: 'javascript:alert(1)' }, { dataUrl: 'data:text/html;base64,PHNjcmlwdD4=' }] }],
    });
    expect(r.visits[0].values).toEqual({ ph: 7 });
    expect(r.visits[0].photos?.map((p) => p.name)).toEqual(['ok.jpg']);
    expect(() => checkResults({ app: 'EnviroDB', kind: 'field-sheet' })).toThrow();
  });
});
