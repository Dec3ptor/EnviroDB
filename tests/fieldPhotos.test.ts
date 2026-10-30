import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { ensureBuiltIns } from '../src/db/db';
import { createDemoProject } from '../src/db/demo';
import { memoryFolder } from '../src/sync/folder';
import { photoAsFigure, photoCaption, photosFor, projectPhotos, withPhotoPaths } from '../src/lib/photos';
import { loadBundle } from './helpers';

const sample = (id: string, siteId: string, date: string, paths: string[], other = 'Field: fine') => ({ id, siteId, date, notes: withPhotoPaths(other, paths) });

describe('report figures from field photos', () => {
  const samples = [
    sample('s1', 'us1', '2026-03-10T09:10', ['Field photos/P/2026-03-10/US1 1.jpg', 'Field photos/P/2026-03-10/US1 2.jpg']),
    sample('s2', 'gw1', '2026-03-10T11:30', ['Field photos/P/2026-03-10/GW1 1.jpg']),
    sample('s3', 'ds1', '2026-03-10T10:20', ['Field photos/P/2026-03-10/DS1 1.jpg']),
    sample('s4', 'us1', '2025-06-12T09:00', ['Field photos/P/2025-06-12/US1 1.jpg']),
    sample('s5', 'us1', '2026-09-11T09:00', ['Field photos/P/2026-09-11/US1 1.jpg']),
    { id: 's6', siteId: 'ds1', date: '2026-04-01', notes: 'Field: no photos' },
    { id: 's7', siteId: 'ds1', date: '2026-04-02', notes: undefined },
  ];
  const order = new Map([['us1', 0], ['ds1', 1], ['gw1', 2]]);

  it('the project’s photos come from its samples’ notes: the latest day first, the sites in order, as taken', () => {
    const photos = projectPhotos(samples, order);
    expect(photos.map((p) => p.path.split('/').slice(2).join('/'))).toEqual([
      '2026-09-11/US1 1.jpg',
      '2026-03-10/US1 1.jpg',
      '2026-03-10/US1 2.jpg',
      '2026-03-10/DS1 1.jpg',
      '2026-03-10/GW1 1.jpg',
      '2025-06-12/US1 1.jpg',
    ]);
    expect(photos[3]).toEqual({ path: 'Field photos/P/2026-03-10/DS1 1.jpg', sampleId: 's3', siteId: 'ds1', date: '2026-03-10T10:20' });
    // the same photo noted twice is listed once
    expect(projectPhotos([...samples, sample('s8', 'us1', '2026-03-10', ['Field photos/P/2026-03-10/US1 1.jpg'])], order)).toHaveLength(6);
    expect(projectPhotos([])).toEqual([]);
  });

  it('a report’s photos are those in its period, at its sites when it covers only some', () => {
    const photos = projectPhotos(samples, order);
    const year = { start: '2025-07-01', end: '2026-06-30' };
    expect(photosFor(photos, year).map((p) => p.sampleId)).toEqual(['s1', 's1', 's3', 's2']);
    expect(photosFor(photos, year, ['gw1']).map((p) => p.sampleId)).toEqual(['s2']);
    expect(photosFor(photos, year, []).length).toBe(4); // none chosen: every site
    expect(photosFor(photos, { start: '2026-03-10', end: '2026-03-10' }).length).toBe(4); // the day itself counts
    expect(photosFor(photos, { start: '2027-01-01', end: '2027-12-31' })).toEqual([]);
  });

  it('a caption gives the site and the day', () => {
    expect(photoCaption({ code: 'GW1', name: 'Monitoring bore BH1' }, '2026-03-10T11:30')).toBe('GW1 – Monitoring bore BH1, 10 March 2026');
    expect(photoCaption({ code: 'US1' }, '2026-03-10')).toBe('US1, 10 March 2026');
    expect(photoCaption(undefined, '2026-03-10')).toBe('Site photo, 10 March 2026');
  });

  it('a photo becomes a figure read from the shared folder, remembering where it came from', async () => {
    const folder = memoryFolder('Workspace');
    await folder.writeBlob!('Field photos/P/2026-03-10/GW1 1.jpg', new Blob(['x'], { type: 'image/jpeg' }));
    const read: string[] = [];
    const fig = await photoAsFigure({ path: 'Field photos/P/2026-03-10/GW1 1.jpg' }, 'GW1, 10 March 2026', folder, async (f) => {
      read.push(f.name);
      return 'data:image/jpeg;base64,AAAA';
    });
    expect(read).toEqual(['GW1 1.jpg']);
    expect(fig).toMatchObject({ src: 'data:image/jpeg;base64,AAAA', caption: 'GW1, 10 March 2026', from: 'Field photos/P/2026-03-10/GW1 1.jpg' });
    expect(fig.id).toMatch(/^fig_/);
    // gone from the folder, or no folder: said plainly
    await expect(photoAsFigure({ path: 'Field photos/P/2026-03-10/GW1 9.jpg' }, '', folder, async () => '')).rejects.toThrow(/GW1 9\.jpg isn’t in the shared folder/);
    await expect(photoAsFigure({ path: 'x.jpg' }, '', null)).rejects.toThrow(/isn’t connected/);
  });
});

describe('with a project', () => {
  let projectId: string;
  beforeAll(async () => {
    await ensureBuiltIns();
    projectId = await createDemoProject();
  });
  it('the demo project has no field photos, so the picker stays out of the way', async () => {
    const b = await loadBundle(projectId);
    expect(projectPhotos(b.samples, new Map(b.sites.map((s, i) => [s.id, i])))).toEqual([]);
  });
});
