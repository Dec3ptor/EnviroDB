import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import Dexie from 'dexie';
import JSZip from 'jszip';
import { memoryFolder } from '../src/sync/folder';

const folder = memoryFolder('Workspace');
vi.mock('../src/sync/workspace', async (orig) => ({ ...(await orig<typeof import('../src/sync/workspace')>()), currentWorkspaceFolder: () => folder }));

const { db, ensureBuiltIns } = await import('../src/db/db');
const { createDemoProject } = await import('../src/db/demo');
const { addPhoto, addSite, addTeamKeys, deleteSheet, fieldDb, forgetTeamKeys, isJob, jobContents, knownProjects, newJob, nextPointCode, saveVisit, setPhotoGps } = await import('../src/field/db');
const { isJobFileName, jobFileName, jobZip, lockedJob, looksLikeJob, readJobFile, RESULTS_FILE } = await import('../src/field/package');
const { commitField, defaultAttach, planField, NEAR_M } = await import('../src/db/field');
const { readPhotoInfo } = await import('../src/lib/exif');
const { roundedNztm, siteLatLng } = await import('../src/lib/nztm');
const { samplePhotoPaths } = await import('../src/lib/photos');
const { newTeamKey } = await import('../src/field/lock');
const { sniffLabFile } = await import('../src/importers/sniff');
const { loadBundle } = await import('./helpers');

const jpeg = (name: string) => new Uint8Array(readFileSync(`tests/fixtures/photos/${name}.jpg`));
const blobOf = (b: Uint8Array) => new Blob([b as BlobPart], { type: 'image/jpeg' });

// ------------------------------------------------------------ before 1.29: photos inside the visits

describe('the phone’s store, from before 1.29', () => {
  it('moves the photos kept in each site’s record to their own table, full size', async () => {
    const old = new Dexie('EnviroDB-field');
    old.version(1).stores({ sheets: 'id, addedAt', visits: 'id, sheetId', prefs: 'key' });
    const url = `data:image/jpeg;base64,${Buffer.from(jpeg('plain')).toString('base64')}`;
    await old.table('visits').put({ id: 'old-sheet|s1', sheetId: 'old-sheet', updatedAt: '2026-10-01T10:00:00.000Z', visit: { siteId: 's1', values: { temp: 12 }, photos: [{ name: 'S1 1.jpg', dataUrl: url }] } });
    old.close();
    const photos = await fieldDb.photos.where('sheetId').equals('old-sheet').toArray();
    expect(photos).toHaveLength(1);
    expect(photos[0]).toMatchObject({ siteId: 's1', type: 'image/jpeg', size: jpeg('plain').length, thumb: url });
    const visit = (await fieldDb.visits.get('old-sheet|s1'))!.visit;
    expect(visit.photos).toBeUndefined();
    expect(visit.values).toEqual({ temp: 12 });
  });
});

// ------------------------------------------------------------ a job on the phone

let projectId = '';
let us1 = { id: '', lat: 0, lng: 0 };
beforeAll(async () => {
  await ensureBuiltIns();
  projectId = await createDemoProject();
  const s = (await db.sites.where('projectId').equals(projectId).toArray()).find((x) => x.code === 'US1')!;
  const ll = siteLatLng(s)!;
  us1 = { id: s.id, lat: ll.lat, lng: ll.lng };
});

describe('a job started on the phone', () => {
  it('needs only a name; points are named P1, P2 …; photos full size with where they were taken', async () => {
    const job = await newJob('Culvert inspection', null, [{ id: 'temp', name: 'Temperature', unit: '°C' }], 'Sam');
    expect(isJob(job)).toBe(true);
    expect(job).toMatchObject({ round: 'Culvert inspection', project: { id: '', name: '' }, sites: [], observe: { photos: true, weather: false } });
    expect(nextPointCode(job)).toBe('P1');
    // P1 a few metres from US1, with a reading and two photos; P2 far away, photos only
    const near = { lat: us1.lat + 0.0001, lng: us1.lng };
    await addSite(job.id, { id: 'p1', code: 'P1', type: 'Other', added: true, auto: true, lat: near.lat, lng: near.lng, located: { at: '2026-11-01T09:00:00Z', how: 'gps', acc: 4 } });
    await addSite(job.id, { id: 'p2', code: 'P2', type: 'Other', added: true, auto: true, lat: us1.lat + 0.01, lng: us1.lng, located: { at: '2026-11-01T09:30:00Z', how: 'gps', acc: 6 } });
    const sheet = (await fieldDb.sheets.get(job.id))!.sheet;
    expect(nextPointCode(sheet)).toBe('P3');
    await saveVisit(job.id, { siteId: 'p1', time: '2026-11-01T09:01', values: { temp: 14.5 }, notes: 'Culvert partly blocked' });
    await addPhoto({ sheetId: job.id, siteId: 'p1', blob: blobOf(jpeg('camera')), type: 'image/jpeg', size: jpeg('camera').length, thumb: '', at: '2026-11-01T09:02:00.000Z', gps: { ...near, acc: 4 }, gpsFrom: 'phone' });
    const second = await addPhoto({ sheetId: job.id, siteId: 'p1', blob: blobOf(jpeg('plain')), type: 'image/jpeg', size: jpeg('plain').length, thumb: '', at: '2026-11-01T09:03:00.000Z' });
    await setPhotoGps(second, { ...near, acc: 5 }, 'phone'); // the location came a moment later
    await addPhoto({ sheetId: job.id, siteId: 'p2', blob: blobOf(jpeg('gps')), type: 'image/jpeg', size: jpeg('gps').length, thumb: '', at: '2026-11-01T09:31:00.000Z', gps: { lat: -37.5, lng: 175.25 }, gpsFrom: 'camera' });
    const c = (await jobContents(job.id, 'Sam'))!;
    // P2 had only photos: it goes too
    expect(c.results.visits.map((v) => v.siteId)).toEqual(['p1', 'p2']);
    expect(c.results.newSites!.map((n) => [n.code, n.auto])).toEqual([['P1', true], ['P2', true]]);
    expect(c.photos.map((p) => p.name)).toEqual(['P1 1.jpg', 'P1 2.jpg', 'P2 1.jpg']);
    expect(c.photos[1]).toMatchObject({ lat: near.lat, acc: 5 });
    // kept as the camera took it, read only when it goes
    expect(c.photos[0].bytes).toBeUndefined();
    expect(Array.from(new Uint8Array(await c.photos[0].blob!.arrayBuffer()))).toEqual(Array.from(jpeg('camera')));
  });

  it('on a phone set up with the team key, a job goes locked with it', async () => {
    const key = await newTeamKey();
    await addTeamKeys([key]);
    const job = await newJob('Locked one', null, []);
    expect((await fieldDb.sheets.get(job.id))!.lockedWith).toBe(key.id);
    await forgetTeamKeys();
    const open = await newJob('Open one', null, []);
    expect((await fieldDb.sheets.get(open.id))!.lockedWith).toBeUndefined();
    await deleteSheet(job.id);
    await deleteSheet(open.id);
  });

  it('knows a project from a sheet the phone opened, with its sites', async () => {
    await fieldDb.sheets.put({ id: 'p:2026-10-01', addedAt: '2026-10-01', sheet: { app: 'EnviroDB', kind: 'field-sheet', v: 1, id: 'p:2026-10-01', project: { id: 'prj', name: 'Quarry', code: 'Q1' }, round: 'Oct', date: '2026-10-01', sites: [{ id: 'a', code: 'SW1' }, { id: 'b', code: 'P9', added: true }], measures: [], observe: { weather: true, flow: false, appearance: false, photos: true }, made: '', appVersion: '' } });
    const known = await knownProjects();
    expect(known.map((k) => [k.project.code, k.sites.map((s) => s.code)])).toEqual([['Q1', ['SW1']]]);
  });
});

// ------------------------------------------------------------ the job file

describe('the job file', () => {
  it('a zip: the results, the photos full size with their locations written in, the points as a spreadsheet and a map file', async () => {
    const job = (await fieldDb.sheets.filter((s) => s.sheet.round === 'Culvert inspection').first())!;
    const c = (await jobContents(job.id, 'Sam'))!;
    const zipBytes = await jobZip(c.sheet, c.results, c.photos);
    const zip = await JSZip.loadAsync(zipBytes);
    expect(Object.keys(zip.files).sort()).toEqual(['Read me.txt', 'photos.csv', 'photos/P1 1.jpg', 'photos/P1 2.jpg', 'photos/P2 1.jpg', 'points.csv', 'points.geojson', RESULTS_FILE].sort());
    // each photo carries where it was taken; the camera's own location is kept
    const p11 = await zip.file('photos/P1 1.jpg')!.async('uint8array');
    expect(readPhotoInfo(p11).gps!.lat).toBeCloseTo(c.photos[0].lat!, 6);
    expect(readPhotoInfo(p11).taken).toBe('2026-10-31T09:15:22'); // the camera's time stays
    expect(readPhotoInfo(await zip.file('photos/P2 1.jpg')!.async('uint8array')).gps!.lat).toBeCloseTo(-37.5, 6);
    const points = await zip.file('points.csv')!.async('string');
    expect(points.split('\r\n')[0]).toBe('﻿Point,Name,Kind,Latitude,Longitude,Accuracy (m),Time,Temperature (°C),Not sampled,Notes,Photos');
    expect(points).toContain('P1,,Other,');
    expect(points).toContain(',14.5,,Culvert partly blocked,P1 1.jpg; P1 2.jpg');
    const geo = JSON.parse(await zip.file('points.geojson')!.async('string'));
    expect(geo.features.filter((f: { properties: { kind: string } }) => f.properties.kind === 'photo')).toHaveLength(3);
    // read back: the same results, each photo with its picture
    expect(await looksLikeJob(zipBytes)).toBe(true);
    const { results } = await readJobFile(zipBytes, []);
    expect(results.visits[0].photos!.map((p) => [p.name, p.file, p.bytes!.length > 0, p.lat !== undefined])).toEqual([
      ['P1 1.jpg', 'photos/P1 1.jpg', true, true],
      ['P1 2.jpg', 'photos/P1 2.jpg', true, true],
    ]);
    expect(Array.from(results.visits[0].photos![0].bytes!)).toEqual(Array.from(p11));
  });

  it('locked with the team key when the sheet came locked: opens only with it', async () => {
    const key = await newTeamKey();
    const job = (await fieldDb.sheets.filter((s) => s.sheet.round === 'Culvert inspection').first())!;
    const c = (await jobContents(job.id, 'Sam'))!;
    const locked = await lockedJob(await jobZip(c.sheet, c.results, c.photos), key);
    expect(await looksLikeJob(locked)).toBe(true);
    await expect(readJobFile(locked, [])).rejects.toThrow(/team key/);
    const { results, keyId } = await readJobFile(locked, [key]);
    expect(keyId).toBe(key.id);
    expect(results.visits).toHaveLength(2);
  });

  it('says at its start which project it’s for, so the inbox puts it with that project', async () => {
    const job = await newJob('Walkover', { id: 'prj-9', name: 'Quarry', code: 'Q1' }, []);
    await addSite(job.id, { id: 'w1', code: 'P1', type: 'Other', added: true, auto: true });
    await saveVisit(job.id, { siteId: 'w1', values: {}, notes: 'All fine' });
    const c = (await jobContents(job.id, 'Sam'))!;
    const bytes = await jobZip(c.sheet, c.results, c.photos);
    expect(await sniffLabFile(new File([bytes as BlobPart], jobFileName(c.sheet)))).toMatchObject({ labName: 'Field job', field: { projectId: 'prj-9' } });
    // one started without a project: chosen on the computer
    const loose = await newJob('Loose', null, []);
    await addSite(loose.id, { id: 'w2', code: 'P1', type: 'Other', added: true, auto: true });
    await saveVisit(loose.id, { siteId: 'w2', values: {}, notes: 'x' });
    const l = (await jobContents(loose.id, 'Sam'))!;
    const sniffed = await sniffLabFile(new File([(await jobZip(l.sheet, l.results, l.photos)) as BlobPart], jobFileName(l.sheet)));
    expect(sniffed.field).toEqual({ projectId: undefined });
    // renamed on the way (a second download, say): still a job, still for its project
    expect(isJobFileName('Field job - Q1 - Walkover - 2026-11-01.envirodb-field (1).zip')).toBe(true);
    expect(isJobFileName('Field job - Q1 - Walkover - 2026-11-01.envirodb-field(2).locked')).toBe(true);
    expect(await sniffLabFile(new File([bytes as BlobPart], 'walkover.zip'))).toMatchObject({ labName: 'Field job', field: { projectId: 'prj-9' } });
  });

  it('a lab’s zip isn’t one; the name says what it is; the inbox picks it up', async () => {
    const lab = new JSZip();
    lab.file('results.csv', 'a,b');
    expect(await looksLikeJob(await lab.generateAsync({ type: 'uint8array' }))).toBe(false);
    const name = jobFileName({ project: { id: '', name: 'Kōwhai Quarry', code: 'DEMO-001' }, round: 'Culvert inspection', date: '2026-11-01' });
    expect(name).toBe('Field job - DEMO-001 - Culvert inspection - 2026-11-01.envirodb-field.zip');
    expect(isJobFileName(name)).toBe(true);
    expect(jobFileName({ project: { id: '', name: '' }, round: 'Walkover', date: '2026-11-01' }, true)).toBe('Field job - Walkover - 2026-11-01.envirodb-field.locked');
    const sniffed = await sniffLabFile(new File([new Uint8Array(10)], name));
    expect(sniffed).toMatchObject({ lab: true, labName: 'Field job' });
  });
});

// ------------------------------------------------------------ on the computer

describe('adding a job on the computer', () => {
  it('a point the phone named, a few metres from a site, joins that site; one far away becomes a new site', async () => {
    const job = (await fieldDb.sheets.filter((s) => s.sheet.round === 'Culvert inspection').first())!;
    const c = (await jobContents(job.id, 'Sam'))!;
    const { results } = await readJobFile(await jobZip(c.sheet, c.results, c.photos), []);
    const b = await loadBundle(projectId);
    const plan = planField(b, results);
    const [p1, p2] = plan.newSites;
    expect(p1.near[0].site.code).toBe('US1');
    expect(p1.near[0].m).toBeLessThan(NEAR_M);
    expect(p1.suggest).toBe(us1.id);
    // photos only, far from any site: kept with the project to start with (made a new site here, below)
    expect(p2.suggest).toBe('project');
    const attach = defaultAttach(plan);
    expect([...attach]).toEqual([['p1', us1.id]]);
    const res = await commitField(projectId, plan, 'job.zip', { attach, newSites: new Set(['p2']) });
    expect(res).toMatchObject({ samples: 2, results: 1, photos: 3, sitesAdded: 1 });
    // US1: the reading, the notes and the photos – full size, located
    const sample = (await db.samples.where('projectId').equals(projectId).toArray()).find((s) => s.siteId === us1.id && s.date.startsWith('2026-11-01'))!;
    expect(sample.notes).toContain('Culvert partly blocked');
    const paths = samplePhotoPaths(sample.notes);
    expect(paths).toEqual(['Field photos/DEMO-001/2026-11-01/US1 1.jpg', 'Field photos/DEMO-001/2026-11-01/US1 2.jpg']);
    const saved = folder.files.get(paths[1])!.bytes!;
    expect(readPhotoInfo(saved).gps!.lat).toBeCloseTo(us1.lat + 0.0001, 6);
    expect((await db.results.where('sampleId').equals(sample.id).toArray()).map((r) => [r.parameterId, r.value])).toEqual([['temp', 14.5]]);
    // P2: a new site where it was taken, with its photo
    const p2Site = (await db.sites.where('projectId').equals(projectId).toArray()).find((s) => s.code === 'P2')!;
    expect(p2Site.easting).toBeGreaterThan(0);
    // sent again: nothing doubles – the same files, the same samples
    const before = folder.files.size;
    const again = await commitField(projectId, planField(await loadBundle(projectId), results), 'job.zip', { attach, newSites: new Set(['p2']) });
    expect(again.photos).toBe(3);
    expect(folder.files.size).toBe(before);
    const after = (await db.samples.get(sample.id))!;
    expect(samplePhotoPaths(after.notes)).toEqual(paths);
  });

  it('sent again, each point goes where it went before – even with a site nearer to it now', async () => {
    const job = await newJob('Re-send', null, []);
    const at = { lat: us1.lat + 0.00008, lng: us1.lng };
    await addSite(job.id, { id: 'r1', code: 'P1', type: 'Other', added: true, auto: true, ...at, located: { at: '', how: 'gps', acc: 4 } });
    await saveVisit(job.id, { siteId: 'r1', values: {}, notes: 'First look', time: '2026-11-03T08:00' });
    await addPhoto({ sheetId: job.id, siteId: 'r1', blob: blobOf(jpeg('camera')), type: 'image/jpeg', size: 1, thumb: '', at: '2026-11-03T08:01:00.000Z', gps: { ...at, acc: 4 } });
    const read = async () => {
      const c = (await jobContents(job.id, 'Sam'))!;
      return (await readJobFile(await jobZip(c.sheet, c.results, c.photos), [])).results;
    };
    const bundle = async () => ({ ...(await loadBundle(projectId)), imports: await db.imports.where('projectId').equals(projectId).toArray() });
    const first = planField(await bundle(), await read());
    expect(first.newSites[0].suggest).toBe(us1.id);
    const done = await commitField(projectId, first, 're-send.zip', { attach: defaultAttach(first) });
    expect(done.batch.fieldPoints).toEqual({ r1: us1.id });
    // a site added since, right where the point is
    const s = (await db.sites.get(us1.id))!;
    await db.sites.put({ ...s, id: 'site-nearer', code: 'NEW1', ...roundedNztm(at.lat, at.lng) });
    const files = folder.files.size;
    const again = planField(await bundle(), await read());
    expect(again.newSites[0].near[0].site.code).toBe('NEW1');
    expect(again.newSites[0]).toMatchObject({ suggest: us1.id, before: true });
    await commitField(projectId, again, 're-send.zip', { attach: defaultAttach(again) });
    expect(folder.files.size).toBe(files);
    const day = (await db.samples.where('projectId').equals(projectId).toArray()).filter((x) => x.date.startsWith('2026-11-03'));
    expect(day.map((x) => x.siteId)).toEqual([us1.id]);
    await db.sites.delete('site-nearer');
  });

  it('two points that join the same site make one sample, with both points’ photos and notes', async () => {
    const job = await newJob('Second visit', null, []);
    for (const [id, code] of [['q1', 'P1'], ['q2', 'P2']] as const) {
      await addSite(job.id, { id, code, type: 'Other', added: true, auto: true, lat: us1.lat + 0.00005, lng: us1.lng, located: { at: '', how: 'gps', acc: 3 } });
      await saveVisit(job.id, { siteId: id, values: {}, notes: `Note at ${code}`, time: '2026-11-02T10:00' });
      await addPhoto({ sheetId: job.id, siteId: id, blob: blobOf(jpeg(id === 'q1' ? 'bigendian' : 'plain')), type: 'image/jpeg', size: 1, thumb: '', at: `2026-11-02T10:0${id === 'q1' ? 1 : 2}:00.000Z`, gps: { lat: us1.lat, lng: us1.lng } });
    }
    const c = (await jobContents(job.id, 'Sam'))!;
    const { results } = await readJobFile(await jobZip(c.sheet, c.results, c.photos), []);
    const plan = planField(await loadBundle(projectId), results);
    await commitField(projectId, plan, 'second.zip', { attach: defaultAttach(plan) });
    const day = (await db.samples.where('projectId').equals(projectId).toArray()).filter((s) => s.siteId === us1.id && s.date.startsWith('2026-11-02'));
    expect(day).toHaveLength(1);
    expect(day[0].notes).toContain('Note at P1');
    expect(day[0].notes).toContain('Note at P2');
    expect(samplePhotoPaths(day[0].notes)).toHaveLength(2);
  });
});
