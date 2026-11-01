import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { memoryFolder } from '../src/sync/folder';

const folder = memoryFolder('Workspace');
vi.mock('../src/sync/workspace', async (orig) => ({ ...(await orig<typeof import('../src/sync/workspace')>()), currentWorkspaceFolder: () => folder }));

const { db, ensureBuiltIns } = await import('../src/db/db');
const { createDemoProject } = await import('../src/db/demo');
const { addPhotosByPlace, fieldDb, jobContents, newJob } = await import('../src/field/db');
const { firstZipEntry, jobZipBlob, looksLikeJob, readJobFile, RESULTS_FILE } = await import('../src/field/package');
const { groupByPlace, localTime, PLACE_M } = await import('../src/field/places');
const { photosAsResults } = await import('../src/field/photoImport');
const { commitField, defaultAttach, defaultProject, planField, PROJECT_PHOTOS } = await import('../src/db/field');
const { readPhotoInfo, withPhotoGps } = await import('../src/lib/exif');
const { crc32, ZipWriter } = await import('../src/lib/zip');
const { siteLatLng } = await import('../src/lib/nztm');
const { photoCaption, photosFor, projectPhotos, samplePhotoPaths } = await import('../src/lib/photos');
const { loadBundle } = await import('./helpers');

const jpeg = (name: string) => new Uint8Array(readFileSync(`tests/fixtures/photos/${name}.jpg`));
/** A photo with the camera's location written in (the fixture has none of its own). */
const located = (lat: number, lng: number, from = 'plain') => withPhotoGps(jpeg(from), { lat, lng, acc: 4 });
const local = (s: string) => new Date(s).getTime();

// ------------------------------------------------------------ the zip, a file at a time

describe('the job file, built a file at a time', () => {
  it('a stored zip any tool opens: names, contents and check numbers right', async () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    // going on from part of the bytes gives the same as all at once
    const all = new TextEncoder().encode('Kōwhai Quarry stormwater');
    expect(crc32(all.subarray(9), crc32(all.subarray(0, 9)))).toBe(crc32(all));
    const z = new ZipWriter();
    await z.add('results.envirodb-field.json', '{"a":1}');
    await z.add('photos/P1 1.jpg', new Blob([jpeg('camera') as BlobPart]), new Date(2026, 9, 31, 9, 15, 22));
    await z.add('photos/Kōwhai 1.jpg', jpeg('gps'));
    await expect(z.add('photos/P1 1.jpg', 'again')).rejects.toThrow(/already/);
    const blob = z.finish();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(firstZipEntry(bytes)).toBe('results.envirodb-field.json');
    const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
    expect(Object.keys(zip.files)).toEqual(['results.envirodb-field.json', 'photos/P1 1.jpg', 'photos/Kōwhai 1.jpg']);
    expect(await zip.file('results.envirodb-field.json')!.async('string')).toBe('{"a":1}');
    expect(Array.from(await zip.file('photos/P1 1.jpg')!.async('uint8array'))).toEqual(Array.from(jpeg('camera')));
    expect(zip.file('photos/P1 1.jpg')!.date.getMinutes()).toBe(15);
    expect(await looksLikeJob(bytes)).toBe(true);
  });
});

// ------------------------------------------------------------ photos into places

describe('photos into places', () => {
  const at = { lat: -37.7115, lng: 175.409 };
  const step = (m: number) => ({ lat: at.lat + m / 111_320, lng: at.lng });
  it('by day, then within a few steps of the first photo there; those without a location, one place a day', () => {
    const photos = [
      { k: 'a2', gps: step(8), taken: '2026-10-30T09:10:00' },
      { k: 'a1', gps: at, taken: '2026-10-30T09:00:00' },
      { k: 'b', gps: step(PLACE_M + 15), taken: '2026-10-30T09:20:00' },
      { k: 'none1', taken: '2026-10-30T11:00:00' },
      { k: 'none2', taken: '2026-10-30T12:00:00' },
      { k: 'next', gps: at, taken: '2026-10-31T08:00:00' },
    ];
    const places = groupByPlace(photos, (p) => p);
    expect(places.map((p) => [p.day, p.at ? 'placed' : 'no location', p.items.map((i) => i.k)])).toEqual([
      ['2026-10-30', 'placed', ['a1', 'a2']],
      ['2026-10-30', 'placed', ['b']],
      ['2026-10-30', 'no location', ['none1', 'none2']],
      ['2026-10-31', 'placed', ['next']],
    ]);
    // the points there already, the same day: photos join them
    const joined = groupByPlace([{ gps: step(5), taken: '2026-10-30T15:00:00' }], (p) => p, [{ id: 'P1', day: '2026-10-30', at }, { id: 'P9', day: '2026-10-29', at }]);
    expect(joined.map((p) => p.id)).toEqual(['P1']);
    expect(localTime(new Date(2026, 0, 5, 7, 8, 9))).toBe('2026-01-05T07:08:09');
  });
});

// ------------------------------------------------------------ on the phone: photos from the gallery

describe('photos from the gallery, on the phone', () => {
  const x = { lat: -37.7115, lng: 175.409 };
  const far = { lat: -37.7215, lng: 175.409 };
  const pic = (b: Uint8Array, taken: string, gps?: { lat: number; lng: number }) => ({ blob: new Blob([b as BlobPart], { type: 'image/jpeg' }), type: 'image/jpeg', size: b.length, thumb: '', taken, ...(gps ? { gps } : {}) });

  it('each placed where it was taken – never where the phone is – a point a place, its time when its first photo was', async () => {
    const job = await newJob('Photos', null, []);
    const r = await addPhotosByPlace(job.id, [
      pic(located(x.lat, x.lng), '2026-10-30T09:10:00', x),
      pic(located(x.lat, x.lng), '2026-10-30T09:00:00', x),
      pic(located(far.lat, far.lng), '2026-10-30T10:00:00', far),
      pic(jpeg('plain'), '2026-10-30T11:00:00'),
      pic(jpeg('plain'), '2026-10-31T08:00:00'),
    ]);
    expect(r).toMatchObject({ added: 5, points: 4, joined: 0, placed: 3, unplaced: 2 });
    const sheet = (await fieldDb.sheets.get(job.id))!.sheet;
    // a job of photos takes their day
    expect(sheet.date).toBe('2026-10-30');
    expect(sheet.sites.map((s) => [s.code, s.fromPhotos, s.located?.how ?? 'no location', s.lat ?? null])).toEqual([
      ['P1', true, 'photo', x.lat],
      ['P2', true, 'photo', far.lat],
      ['P3', true, 'no location', null],
      ['P4', true, 'no location', null],
    ]);
    const visits = await fieldDb.visits.where('sheetId').equals(job.id).toArray();
    expect(visits.map((v) => [sheet.sites.find((s) => s.id === v.visit.siteId)!.code, v.visit.time]).sort()).toEqual([
      ['P1', '2026-10-30T09:00'],
      ['P2', '2026-10-30T10:00'],
      ['P3', '2026-10-30T11:00'],
      ['P4', '2026-10-31T08:00'],
    ]);
    // more later: one taken by P1 that day joins it
    const again = await addPhotosByPlace(job.id, [pic(located(x.lat + 0.00004, x.lng), '2026-10-30T13:00:00', { lat: x.lat + 0.00004, lng: x.lng })]);
    expect(again).toMatchObject({ added: 1, points: 0, joined: 1 });
    expect((await fieldDb.photos.where('sheetId').equals(job.id).toArray()).filter((p) => p.siteId === sheet.sites[0].id)).toHaveLength(3);
    // the job file: the photos read as kept, one at a time, each with its own location
    const c = (await jobContents(job.id, 'Sam'))!;
    expect(c.photos.every((p) => p.blob && !p.bytes)).toBe(true);
    const done: number[] = [];
    const file = await jobZipBlob(c.sheet, c.results, c.photos, (n) => done.push(n));
    expect(done).toEqual([1, 2, 3, 4, 5, 6]);
    const { results } = await readJobFile(new Uint8Array(await file.arrayBuffer()), []);
    const p1 = results.visits.find((v) => v.siteId === sheet.sites[0].id)!;
    expect(p1.photos!.map((p) => p.name)).toEqual(['P1 1.jpg', 'P1 2.jpg', 'P1 3.jpg']);
    expect(readPhotoInfo(p1.photos![0].bytes!).gps!.lat).toBeCloseTo(x.lat, 6);
    expect(results.newSites!.map((n) => [n.code, n.how ?? null])).toEqual([
      ['P1', 'photo'],
      ['P2', 'photo'],
      ['P3', null],
      ['P4', null],
    ]);
  });
});

// ------------------------------------------------------------ on the computer: photos dropped on Import

let projectId = '';
let us1 = { id: '', lat: 0, lng: 0 };
beforeAll(async () => {
  await ensureBuiltIns();
  projectId = await createDemoProject();
  const s = (await db.sites.where('projectId').equals(projectId).toArray()).find((x) => x.code === 'US1')!;
  const ll = siteLatLng(s)!;
  us1 = { id: s.id, lat: ll.lat, lng: ll.lng };
});

describe('photos dropped on the computer', () => {
  const drop = () => [
    { name: 'IMG_0001.jpg', bytes: located(us1.lat + 0.00005, us1.lng), lastModified: local('2026-10-30T10:00:00') },
    { name: 'IMG_0002.jpg', bytes: located(us1.lat + 0.00006, us1.lng), lastModified: local('2026-10-30T10:05:00') },
    { name: 'IMG_0003.jpg', bytes: located(us1.lat + 0.01, us1.lng), lastModified: local('2026-10-30T11:00:00') },
    { name: 'IMG_0004.jpg', bytes: jpeg('plain'), lastModified: local('2026-10-30T12:00:00') },
    { name: 'IMG_0005.HEIC', bytes: new Uint8Array(10), lastModified: local('2026-10-30T12:30:00') },
  ];
  const bundle = async () => ({ ...(await loadBundle(projectId)), imports: await db.imports.where('projectId').equals(projectId).toArray() });

  it('grouped by where they were taken: by a site, they join its sample for the day; elsewhere, or with no location, kept with the project', async () => {
    const { results, skipped } = photosAsResults(drop(), 'Sam');
    expect(skipped).toEqual(['IMG_0005.HEIC']);
    expect(results!.sheet).toMatchObject({ round: 'Photos', date: '2026-10-30', project: { id: '' } });
    expect(results!.newSites!.map((n) => [n.code, n.how ?? null])).toEqual([
      ['P1', 'photo'],
      ['P2', 'photo'],
      ['P3', null],
    ]);
    const plan = planField(await bundle(), results!);
    expect(plan.newSites.map((n) => [n.field.code, n.photosOnly, n.suggest === us1.id ? 'US1' : n.suggest])).toEqual([
      ['P1', true, 'US1'],
      ['P2', true, 'project'],
      ['P3', true, 'project'],
    ]);
    const res = await commitField(projectId, plan, '4 photos', { attach: defaultAttach(plan), project: defaultProject(plan) });
    expect(res).toMatchObject({ samples: 1, results: 0, photos: 4, projectPhotos: 2, sitesAdded: 0 });
    expect(res.batch.photos!.map((p) => [p.path, p.label, p.lat !== undefined])).toEqual([
      ['Field photos/DEMO-001/2026-10-30/Photos 1.jpg', 'Photos', true],
      ['Field photos/DEMO-001/2026-10-30/Photos 2.jpg', 'Photos', false],
    ]);
    expect(Object.values(res.batch.fieldPoints!).sort()).toEqual([PROJECT_PHOTOS, PROJECT_PHOTOS, us1.id].sort());
    // US1's sample that day: the two photos taken by it, with their notes line
    const sample = (await db.samples.where('projectId').equals(projectId).toArray()).find((s) => s.siteId === us1.id && s.date.startsWith('2026-10-30'))!;
    expect(samplePhotoPaths(sample.notes)).toEqual(['Field photos/DEMO-001/2026-10-30/US1 1.jpg', 'Field photos/DEMO-001/2026-10-30/US1 2.jpg']);
    expect(sample.notes).toContain('Field: photos taken (Sam)');
    expect(readPhotoInfo(folder.files.get('Field photos/DEMO-001/2026-10-30/Photos 1.jpg')!.bytes!).gps!.lat).toBeCloseTo(us1.lat + 0.01, 6);
    // no new sites for places photographed
    expect((await db.sites.where('projectId').equals(projectId).toArray()).some((s) => /^P\d$/.test(s.code))).toBe(false);
  });

  it('the project’s own photos show for reports – with any site chosen – captioned with what they’re of', async () => {
    const b = await bundle();
    const all = projectPhotos(b.samples, new Map(b.sites.map((s, i) => [s.id, i])), b.imports);
    const own = all.filter((p) => !p.siteId);
    expect(own.map((p) => [p.label, p.date.slice(0, 10)])).toEqual([
      ['Photos', '2026-10-30'],
      ['Photos', '2026-10-30'],
    ]);
    // the day's site photos first, the project's own after
    expect(all.filter((p) => p.date.startsWith('2026-10-30')).map((p) => (p.siteId ? 'site' : 'project'))).toEqual(['site', 'site', 'project', 'project']);
    const ds1 = b.sites.find((s) => s.code === 'DS1')!;
    const inReport = photosFor(all, { start: '2026-10-01', end: '2026-10-31' }, [ds1.id]);
    expect(inReport.filter((p) => !p.siteId)).toHaveLength(2);
    expect(inReport.some((p) => p.siteId === us1.id)).toBe(false);
    expect(photoCaption(undefined, own[0].date, own[0].label)).toBe('Photos, 30 October 2026');
  });

  it('dropped again: the same places, each where it went before – nothing doubles', async () => {
    const files = folder.files.size;
    const samples = await db.samples.count();
    const { results } = photosAsResults(drop(), 'Sam');
    const plan = planField(await bundle(), results!);
    expect(plan.newSites.map((n) => [n.suggest === us1.id ? 'US1' : n.suggest, n.before])).toEqual([
      ['US1', true],
      ['project', true],
      ['project', true],
    ]);
    const res = await commitField(projectId, plan, '4 photos', { attach: defaultAttach(plan), project: defaultProject(plan) });
    expect(res.photos).toBe(4);
    expect(folder.files.size).toBe(files);
    expect(await db.samples.count()).toBe(samples);
  });

  it('a point with readings isn’t kept with the project: its readings need a site', async () => {
    const { results } = photosAsResults([{ name: 'a.jpg', bytes: located(us1.lat + 0.02, us1.lng), lastModified: local('2026-10-29T10:00:00') }]);
    const withReading = { ...results!, visits: results!.visits.map((v) => ({ ...v, values: { temp: 12 } })) };
    const plan = planField(await bundle(), withReading);
    expect(plan.newSites[0]).toMatchObject({ photosOnly: false, suggest: 'new' });
    const res = await commitField(projectId, plan, 'one', { project: new Set([plan.newSites[0].field.id]), newSites: new Set() });
    expect(res.projectPhotos).toBe(0);
  });
});

describe('a job file is known by its first file', () => {
  it('without reading the rest', async () => {
    const job = await newJob('Quick', null, []);
    await addPhotosByPlace(job.id, [{ blob: new Blob([jpeg('plain') as BlobPart]), type: 'image/jpeg', size: 1, thumb: '', taken: '2026-10-30T09:00:00' }]);
    const c = (await jobContents(job.id, ''))!;
    const head = new Uint8Array(await (await jobZipBlob(c.sheet, c.results, c.photos)).slice(0, 200).arrayBuffer());
    expect(firstZipEntry(head)).toBe(RESULTS_FILE);
    expect(await looksLikeJob(head)).toBe(true);
  });
});
