import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { db, ensureBuiltIns } from '../src/db/db';
import { createDemoProject } from '../src/db/demo';
import { memoryFolder } from '../src/sync/folder';
import { addSamplePhotos, photoDir, photoUrl, removeSamplePhoto, samplePhotoPaths, withPhotoPaths } from '../src/lib/photos';
import { boreSummary, depthWarning, levelFromDepth } from '../src/lib/bore';
import { planField } from '../src/db/field';
import type { FieldResults } from '../src/field/model';
import { plansChanged, rememberLayouts, sheetFingerprint, withRememberedLayouts } from '../src/importers/layouts';
import type { SheetGrid } from '../src/importers/workbook';
import type { SheetPlan } from '../src/importers/detect';
import { sheetName, workbookSheets } from '../src/reports/workbook';
import { BUILT_IN_PARAMETERS } from '../src/data/parameters';
import { buildParamIndex, matchParameter } from '../src/lib/matching';
import { loadBundle } from './helpers';

let projectId: string;
beforeAll(async () => {
  await ensureBuiltIns();
  projectId = await createDemoProject();
});

describe('stage 4: photos', () => {
  it('a sample’s photos are a line in its notes', () => {
    expect(samplePhotoPaths('Field: fine\nField photos: a/b 1.jpg; a/b 2.jpg')).toEqual(['a/b 1.jpg', 'a/b 2.jpg']);
    expect(samplePhotoPaths('Field: fine')).toEqual([]);
    expect(withPhotoPaths('Field: fine\nField photos: a/b 1.jpg', ['a/b 1.jpg', 'a/b 3.jpg'])).toBe('Field: fine\nField photos: a/b 1.jpg; a/b 3.jpg');
    expect(withPhotoPaths('Field photos: a/b 1.jpg\nmore', [])).toBe('more');
    expect(withPhotoPaths(undefined, ['x.jpg'])).toBe('Field photos: x.jpg');
    expect(photoDir({ code: 'DEMO-001', name: 'Demo' }, '2026-10-25T09:30')).toBe('Field photos/DEMO-001/2026-10-25');
  });

  it('photos added from a computer go to the shared folder beside the phone’s, and come back as pictures', async () => {
    const folder = memoryFolder('Workspace');
    const sample = (await db.samples.where('projectId').equals(projectId).first())!;
    const site = (await db.sites.get(sample.siteId))!;
    const project = (await db.projects.get(projectId))!;
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    const files = [new File(['x'], 'IMG_1.png', { type: 'image/png' }), new File(['y'], 'IMG_2.png', { type: 'image/png' })];
    const r = await addSamplePhotos(sample, site, project, files, async () => png, folder);
    expect(r.added).toBe(2);
    expect(r.paths).toEqual([`Field photos/DEMO-001/${sample.date.slice(0, 10)}/${site.code} 1.png`, `Field photos/DEMO-001/${sample.date.slice(0, 10)}/${site.code} 2.png`]);
    const after = (await db.samples.get(sample.id))!;
    expect(samplePhotoPaths(after.notes)).toEqual(r.paths);
    expect(await folder.info(r.paths[0])).not.toBeNull();
    // a third doesn't overwrite the first two
    const r2 = await addSamplePhotos(after, site, project, [files[0]], async () => png, folder);
    expect(r2.paths[0]).toMatch(/ 3\.png$/);
    // without the folder: nothing kept, said plainly
    const r3 = await addSamplePhotos(after, site, project, files, async () => png, null);
    expect(r3.added).toBe(0);
    expect(r3.error).toMatch(/shared folder/);
    // off the sample (the file stays)
    await removeSamplePhoto((await db.samples.get(sample.id))!, r.paths[0]);
    expect(samplePhotoPaths((await db.samples.get(sample.id))!.notes)).toEqual([r.paths[1], r2.paths[0]]);
    expect(await folder.info(r.paths[0])).not.toBeNull();
    expect(await photoUrl('Field photos/nowhere.jpg', folder)).toBeNull();
    const h = await db.audit.where('projectId').equals(projectId).toArray();
    expect(h.some((e) => e.kind === 'sample' && /2 photos added/.test(e.text))).toBe(true);
  });
});

describe('stage 4: bores', () => {
  it('a level from a depth to water, and a depth deeper than the well', () => {
    const bore = { tocRl: 123.456, stickUp: 0.6, depth: 12, screenTop: 8, screenBottom: 11 };
    expect(levelFromDepth(bore, 4.32)).toBe(119.136);
    expect(levelFromDepth({ depth: 12 }, 4.32)).toBeNull();
    expect(levelFromDepth(undefined, 4.32)).toBeNull();
    expect(depthWarning(bore, 13)).toMatch(/Deeper than the well \(12 m\)/);
    expect(depthWarning(bore, 5)).toBeNull();
    expect(depthWarning(bore, -1)).toMatch(/negative/);
    expect(boreSummary(bore)).toBe('TOC 123.46 m RL · stick-up 0.6 m · depth 12 m · screen 8–11 m');
  });

  it('depth to water and purge volume are parameters of their own; a lab’s "depth to water" no longer means the level', () => {
    const index = buildParamIndex(BUILT_IN_PARAMETERS);
    expect(matchParameter('Depth to water', index).parameterId).toBe('dtw');
    expect(matchParameter('DTW (m bTOC)', index).parameterId).toBe('dtw');
    expect(matchParameter('Purge volume', index).parameterId).toBe('purge-vol');
    expect(matchParameter('Groundwater level', index).parameterId).toBe('swl');
    expect(matchParameter('SWL', index).parameterId).toBe('swl');
  });

  it('field readings at a bore with a top-of-casing level bring the groundwater level with them', async () => {
    const gw = (await db.sites.where('projectId').equals(projectId).filter((s) => s.code === 'GW1').first())!;
    await db.sites.update(gw.id, { bore: { tocRl: 50, depth: 10 } });
    const b = await loadBundle(projectId);
    const results: FieldResults = {
      app: 'EnviroDB',
      kind: 'field-results',
      v: 1,
      sheet: { id: `${projectId}:2026-10-25`, project: { id: projectId, name: 'Demo' }, round: 'Oct', date: '2026-10-25' },
      sent: '2026-10-25T10:00',
      visits: [
        { siteId: gw.id, values: { dtw: 3.25, 'purge-vol': 12 }, done: true },
        { siteId: b.sites.find((s) => s.code === 'US1')!.id, values: { temp: 14.2 }, done: true },
      ],
    } as FieldResults;
    const plan = planField(b, results);
    const row = plan.rows.find((r) => r.site.id === gw.id)!;
    const swl = row.values.find((v) => v.param.id === 'swl');
    expect(swl?.value).toBe(46.75);
    expect(swl?.derived).toMatch(/from 3.25 m below TOC 50 m RL/);
    expect(row.values.find((v) => v.param.id === 'purge-vol')?.value).toBe(12);
    // too deep: warned, not stopped
    const deep = planField(b, { ...results, visits: [{ siteId: gw.id, values: { dtw: 11 }, done: true }] } as FieldResults);
    expect(deep.rows[0].values.find((v) => v.param.id === 'dtw')?.warning).toMatch(/Deeper than the well/);
    // no level at a stream
    expect(plan.rows.find((r) => r.site.code === 'US1')!.values.map((v) => v.param.id)).toEqual(['temp']);
  });
});

const grid = (name: string, rows: Array<Array<string | number | null>>): SheetGrid => ({ name, rows: rows.map((r) => r.map((v) => ({ v }))), nRows: rows.length, nCols: Math.max(...rows.map((r) => r.length)) });

describe('stage 4: teaching a layout', () => {
  const header = ['Site', 'Sampled', 'pH', 'Turbidity', 'E. coli'];
  const fileA = grid('Sheet1', [['Acme Labs – results', null, null, null, null], header, ['', '', 'pH', 'NTU', 'cfu/100mL'], ['SW1', 45000, 7.2, 3.1, 120], ['SW2', 45000, 7.4, 2.2, 80]]);
  const fileB = grid('Sheet1', [['Acme Labs – results', null, null, null, null], header, ['', '', 'pH', 'NTU', 'cfu/100mL'], ['SW1', 45031, 7.1, 5.5, 200], ['SW2', 45031, 7.3, 1.9, 60], ['SW3', 45031, 7.0, 4.4, 90]]);
  const other = grid('Sheet1', [['Something else', 'Date'], ['x', 1]]);

  it('a sheet’s shape is its words, not its numbers', () => {
    expect(sheetFingerprint(fileA)).toBe(sheetFingerprint(fileB));
    expect(sheetFingerprint(fileA)).not.toBe(sheetFingerprint(other));
  });

  it('a layout put right is used by itself for the next file of the same shape, and can be forgotten', async () => {
    const guessed: SheetPlan[] = [{ mode: 'lab', sheet: 'Sheet1', score: 40 }];
    const fixed: SheetPlan[] = [{ mode: 'wide', sheet: 'Sheet1', score: 0, config: { headerRow: 1, unitRow: 2, firstDataRow: 3, dateCol: 1, siteMode: 'column', siteCol: 0, orientation: 'rows' } as never }];
    expect(plansChanged(guessed, guessed)).toBe(false);
    expect(plansChanged(guessed, fixed)).toBe(true);
    const kept = await rememberLayouts([fileA], fixed, 'acme-oct.xlsx');
    expect(kept).toHaveLength(1);
    const next = await withRememberedLayouts([fileB], [{ mode: 'lab', sheet: 'Sheet1', score: 40 }]);
    expect(next.remembered).toHaveLength(1);
    expect(next.remembered[0].layout.fileName).toBe('acme-oct.xlsx');
    expect(next.plans[0].mode).toBe('wide');
    expect((next.plans[0] as Extract<SheetPlan, { mode: 'wide' }>).config.headerRow).toBe(1);
    // another shape: the guess stands
    const none = await withRememberedLayouts([other], [{ mode: 'lab', sheet: 'Sheet1', score: 10 }]);
    expect(none.remembered).toEqual([]);
    expect(none.plans[0].mode).toBe('lab');
    // a skipped sheet (a notes sheet) is remembered as skipped
    expect(await rememberLayouts([other], [{ mode: 'skip', sheet: 'Sheet1', score: 0 }], 'x.xlsx')).toHaveLength(1);
    expect(await db.layouts.count()).toBe(2);
    const skipped = await withRememberedLayouts([other], [{ mode: 'lab', sheet: 'Sheet1', score: 10 }]);
    expect(skipped.plans[0].mode).toBe('skip');
    expect(skipped.remembered).toHaveLength(1);
  });
});

describe('stage 4: the project workbook', () => {
  it('a sheet for each site: dates down, the parameters it has results for across', async () => {
    const b = await loadBundle(projectId);
    const sheets = workbookSheets(b);
    expect(sheets.map((s) => s.site.code)).toEqual(b.sites.map((s) => s.code));
    const us1 = sheets.find((s) => s.site.code === 'US1')!;
    expect(us1.rows.length).toBeGreaterThan(10);
    expect(us1.rows.map((r) => r.sample.date)).toEqual([...us1.rows.map((r) => r.sample.date)].sort());
    expect(us1.params.map((p) => p.id)).toContain('ph');
    // a parameter only measured at the bore isn't a column at the stream
    const gw = sheets.find((s) => s.site.code === 'GW1')!;
    expect(gw.params.some((p) => p.id === 'swl')).toBe(true);
    expect(us1.params.some((p) => p.id === 'swl')).toBe(false);
    // just the chosen sites
    expect(workbookSheets(b, [gw.site.id]).map((s) => s.site.code)).toEqual(['GW1']);
  });

  it('sheet names Excel accepts, unique', () => {
    const taken = new Set<string>();
    expect(sheetName('SW1', taken)).toBe('SW1');
    expect(sheetName('sw1', taken)).toBe('sw1 (2)');
    expect(sheetName('A/B: upstream [main] *', taken)).toBe('A-B- upstream -main- -');
    expect(sheetName('A very long site code that goes on and on', taken).length).toBeLessThanOrEqual(31);
  });
});
