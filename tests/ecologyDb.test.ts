import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { db, ensureBuiltIns } from '../src/db/db';
import { exportProjectPackage, exportWorkspace, importProjectPackage, type WorkspaceBackup } from '../src/db/backup';
import { deleteSurvey, likeTheLast, mergeTaxa, newSurvey, saveSurvey, saveSurveys, saveTaxon } from '../src/db/ecology';
import { deleteProject, newProject, newSite, saveProject, saveSite } from '../src/db/repo';
import { missingRecords, projectFromBackup, putBackMissing } from '../src/db/restoreProject';
import { ecoIndices, parseTable, taxonKey } from '../src/lib/ecology';
import { segmentOf, SHARED } from '../src/sync/model';
import { DEFAULT_SETTINGS } from '../src/db/db';
import { BUILT_IN_TEMPLATES } from '../src/data/templates';
import { buildReport } from '../src/reports/build';
import type { DocNode } from '../src/reports/model';
import type { ReportTemplate } from '../src/db/types';
import { diffSnapshots, snapshotBundle, snapshotContent } from '../src/lib/issued';
import { loadBundle } from './helpers';

let projectId = '';
let siteId = '';
beforeAll(async () => {
  await ensureBuiltIns();
  const p = newProject({ name: 'Stream health', code: 'EC-1', ecology: true });
  await saveProject(p);
  projectId = p.id;
  const s = newSite(projectId, { code: 'DS1' });
  await saveSite(s);
  siteId = s.id;
});

describe('ecology surveys, saved', () => {
  it('a survey is tidied as it’s saved; its taxa join the team’s list', async () => {
    const draft = newSurvey(projectId, { siteId, date: '2026-03-02', method: '  ', place: 'ignored at a site', records: [{ taxon: ' Deleatidium ', n: 4 }, { taxon: 'deleatidium', n: 6 }, { taxon: 'Aoteapsyche', code: 'A', note: ' big ' }, { taxon: '  ' }] });
    const saved = await saveSurvey(draft);
    expect(saved.records).toEqual([{ taxon: 'Deleatidium', n: 10 }, { taxon: 'Aoteapsyche', code: 'A', note: 'big' }]);
    expect(saved.method).toBeUndefined();
    expect(saved.place).toBeUndefined();
    expect((await db.surveys.get(saved.id))!.records).toHaveLength(2);
    expect((await db.taxa.toArray()).map((t) => t.id).sort()).toEqual(['aoteapsyche', 'deleatidium']);
    expect((await db.audit.where('projectId').equals(projectId).toArray()).map((a) => a.text)).toContain('Survey added: stream invertebrates, 2 Mar 2026 (2 taxa)');
  });

  it('the taxa list: scores typed in, or pasted – what a pasted list leaves blank stays', async () => {
    const del = (await db.taxa.get('deleatidium'))!;
    await saveTaxon({ ...del, group: 'Ephemeroptera', mci: 8, common: ' mayfly ' }, del);
    expect(await db.taxa.get('deleatidium')).toMatchObject({ group: 'Ephemeroptera', mci: 8, common: 'mayfly' });
    const r = await mergeTaxa([
      { id: 'deleatidium', name: 'Deleatidium', mciSb: 5.6 },
      { id: 'aoteapsyche', name: 'Aoteapsyche', group: 'Trichoptera', mci: 4 },
      { id: 'potamopyrgus', name: 'Potamopyrgus', mci: 4 },
    ]);
    expect(r).toEqual({ added: 1, changed: 2 });
    expect(await db.taxa.get('deleatidium')).toMatchObject({ group: 'Ephemeroptera', mci: 8, mciSb: 5.6 });
    // the same list again: nothing to do
    expect(await mergeTaxa([{ id: 'deleatidium', name: 'Deleatidium', mciSb: 5.6 }])).toEqual({ added: 0, changed: 0 });
    // the indices take them: scores 8 and 4 → MCI 120; both are EPT
    const survey = (await db.surveys.where('projectId').equals(projectId).first())!;
    const list = new Map((await db.taxa.toArray()).map((t) => [t.id, t]));
    const x = ecoIndices(survey, list);
    expect(x.mci).toBeCloseTo(120, 10);
    expect(x.ept).toMatchObject({ taxa: 2 });
    expect(x.qmciKind).toBe('SQMCI'); // one counted, one coded
    // renamed: its old entry goes
    const pot = (await db.taxa.get('potamopyrgus'))!;
    await saveTaxon({ ...pot, name: 'Potamopyrgus antipodarum' }, pot);
    expect(await db.taxa.get('potamopyrgus')).toBeUndefined();
    expect((await db.taxa.get(taxonKey('Potamopyrgus antipodarum')))!.mci).toBe(4);
  });

  it('deleted, with a way back', async () => {
    const extra = await saveSurvey(newSurvey(projectId, { place: 'Wetland', kind: 'Birds', date: '2026-04-01', records: [{ taxon: 'Pūkeko', n: 3 }] }));
    expect(extra.place).toBe('Wetland');
    const undo = await deleteSurvey(extra);
    expect(await db.surveys.get(extra.id)).toBeUndefined();
    await undo();
    expect((await db.surveys.get(extra.id))!.records[0].taxon).toBe('Pūkeko');
  });
});

describe('ecology with the rest of the project', () => {
  it('shared with the team: surveys with their project, the taxa list for everyone', () => {
    expect(SHARED.has('surveys')).toBe(true);
    expect(SHARED.has('taxa')).toBe(true);
    expect(segmentOf('surveys', { projectId: 'p1' })).toBe('project.p1');
    expect(segmentOf('taxa', { id: 'deleatidium' })).toBe('taxa');
  });

  it('a project’s file carries its surveys and the taxa they name; a copy has them at its own sites', async () => {
    const pkg = JSON.parse(JSON.stringify(await exportProjectPackage(projectId))) as WorkspaceBackup;
    expect((pkg.data.surveys as unknown[]).length).toBe(2);
    expect((pkg.data.taxa as Array<{ id: string }>).map((t) => t.id).sort()).toEqual(['aoteapsyche', 'deleatidium', 'pūkeko']);
    const copyId = await importProjectPackage(pkg);
    expect(copyId).not.toBe(projectId);
    const copied = await db.surveys.where('projectId').equals(copyId).toArray();
    expect(copied).toHaveLength(2);
    const copySites = new Set((await db.sites.where('projectId').equals(copyId).toArray()).map((s) => s.id));
    const atSite = copied.find((s) => s.siteId)!;
    expect(copySites.has(atSite.siteId!)).toBe(true);
    expect(atSite.siteId).not.toBe(siteId);
    await deleteProject(copyId);
    // deleting a project takes its surveys; the team's taxa stay
    expect(await db.surveys.where('projectId').equals(copyId).count()).toBe(0);
    expect(await db.taxa.count()).toBeGreaterThanOrEqual(3);
  });

  it('a survey deleted by mistake comes back from a backup', async () => {
    const backup = JSON.parse(JSON.stringify(await exportWorkspace({ reportWork: false }))) as WorkspaceBackup;
    const one = (await db.surveys.where('projectId').equals(projectId).toArray())[0];
    await deleteSurvey(one);
    const pkg = projectFromBackup(backup, projectId);
    const m = await missingRecords(pkg);
    expect(m.counts.map((c) => c.text)).toContain('1 ecology survey');
    await putBackMissing(pkg);
    expect(await db.surveys.get(one.id)).toBeTruthy();
  });
});

describe('a results table pasted in, saved as surveys', () => {
  it('a survey a column; the table’s groups fill in the taxa list’s blanks and never change the team’s own', async () => {
    const before = await db.surveys.where('projectId').equals(projectId).count();
    const table = parseTable('Taxon\tGroup\tCommonName\tDS1\t518903\nDeleatidium\tInsects\tMayfly\t12\t4\nZelandoperla\tPlecoptera\tStonefly\t3\t\nPotamopyrgus antipodarum\tSnails\t\t\t50\n')!;
    expect(table.columns.map((c) => c.header)).toEqual(['DS1', '518903']);
    const made = table.columns.map((c, i) => newSurvey(projectId, { date: '2026-05-0' + (i + 1), ...(i === 0 ? { siteId } : { place: c.header }), scores: ' Stark & Maxted 2007 ', records: c.records }));
    const r = await saveSurveys(made, table.taxa);
    expect(r).toEqual({ surveys: 2, taxaAdded: 1 }); // the stonefly is new
    expect(await db.surveys.where('projectId').equals(projectId).count()).toBe(before + 2);
    // Deleatidium's group and common name were the team's already: kept; the stonefly takes the table's
    expect(await db.taxa.get('deleatidium')).toMatchObject({ group: 'Ephemeroptera', common: 'mayfly', mci: 8 });
    expect(await db.taxa.get('zelandoperla')).toMatchObject({ group: 'Plecoptera', common: 'Stonefly' });
    // the snail had a score and no group: the table's group fills the blank
    expect(await db.taxa.get('potamopyrgus antipodarum')).toMatchObject({ mci: 4, group: 'Snails' });
    const saved = (await db.surveys.get(made[0].id))!;
    expect(saved.scores).toBe('Stark & Maxted 2007');
    expect(saved.records).toEqual([{ taxon: 'Deleatidium', n: 12 }, { taxon: 'Zelandoperla', n: 3 }]);
  });

  it('a new survey starts as the last of its kind was done', async () => {
    const all = await db.surveys.where('projectId').equals(projectId).toArray();
    expect(likeTheLast(all, 'Stream invertebrates')).toEqual({ scores: 'Stark & Maxted 2007' });
    expect(likeTheLast(all, 'Fish')).toEqual({});
    await saveSurvey(newSurvey(projectId, { siteId, date: '2026-06-01', method: 'Kick net', effort: '0.6 m²', bed: 'soft', scores: 'NEMS 2022', by: 'AB', records: [{ taxon: 'Deleatidium', n: 1 }] }));
    expect(likeTheLast(await db.surveys.where('projectId').equals(projectId).toArray(), 'Stream invertebrates')).toEqual({ method: 'Kick net', effort: '0.6 m²', bed: 'soft', scores: 'NEMS 2022' });
    // a survey of birds keeps no stream bed or score list
    const birds = await saveSurvey(newSurvey(projectId, { place: 'Bush', kind: 'Birds', date: '2026-06-02', bed: 'soft', scores: 'x', records: [{ taxon: 'Tūī', n: 2 }] }));
    expect(birds.bed).toBeUndefined();
    expect(birds.scores).toBeUndefined();
  });
});

describe('ecology in a report', () => {
  const annual = BUILT_IN_TEMPLATES.find((t) => t.id === 'tpl-annual')!;
  const layout = (show: 'indices' | 'taxa', kinds: Array<'Stream invertebrates' | 'Birds'> = []): ReportTemplate => ({ ...annual, blocks: [{ id: 'eco', type: 'ecologyTable', show, kinds }] });
  const period = { start: '2026-05-01', end: '2026-05-31', label: 'May 2026' };
  const tables = (nodes: DocNode[]) => nodes.filter((n): n is Extract<DocNode, { t: 'table' }> => n.t === 'table');

  it('a line a survey for the period, with EPT and the MCI; nothing in a period without surveys', async () => {
    const b = await loadBundle(projectId);
    const doc = buildReport({ bundle: b, template: layout('indices'), period, settings: DEFAULT_SETTINGS });
    const [t] = tables(doc.nodes);
    expect(t.caption).toBe('Table 1: Ecology surveys, 1 May 2026 – 31 May 2026');
    expect(t.head[0].map((c) => c.text)).toEqual(['Date', 'Site', 'Taxa', 'Individuals', 'H′', 'EPT taxa', '% EPT taxa', 'MCI', 'QMCI']);
    // 1 May at DS1: Deleatidium 12 (8), Zelandoperla 3 (no score) – MCI 160 from the one scored
    expect(t.body[0].map((c) => c.text)).toEqual(['1 May 2026', 'DS1', '2', '15', '0.50', '2', '100%', '160', '8.00']);
    expect(t.body[1].map((c) => c.text).slice(0, 4)).toEqual(['2 May 2026', '518903', '2', '54']);
    expect(t.body[0][3].align).toBe('right');
    expect(t.notes).toContain('Tolerance scores: Stark & Maxted 2007.');
    expect(t.notes!.some((n) => n.startsWith('Left out of the MCI and QMCI, having no tolerance score: Zelandoperla'))).toBe(true);
    const none = buildReport({ bundle: b, template: layout('indices', ['Birds']), period, settings: DEFAULT_SETTINGS });
    expect(tables(none.nodes)).toHaveLength(0);
    expect(none.nodes.some((n) => n.t === 'p' && n.runs[0].text === 'No birds surveys were made in this period.')).toBe(true);
  });

  it('the taxa found, a column a survey – and a report for some sites has those sites’ surveys only', async () => {
    const b = await loadBundle(projectId);
    const doc = buildReport({ bundle: b, template: layout('taxa'), period, settings: DEFAULT_SETTINGS });
    const [t] = tables(doc.nodes);
    expect(t.caption).toBe('Table 1: Taxa found, 1 May 2026 – 31 May 2026');
    expect(t.head[0].map((c) => c.text)).toEqual(['Taxon', 'Group', 'DS1\n1 May 2026', '518903\n2 May 2026']);
    expect(t.body.map((r) => r.map((c) => c.text))).toEqual([
      ['Deleatidium', 'Ephemeroptera', '12', '4'],
      ['Zelandoperla', 'Plecoptera', '3', ''],
      ['Potamopyrgus antipodarum', 'Snails', '', '50'],
      ['Number of taxa', '', '2', '2'],
      ['EPT taxa', '', '2', '1'],
      ['MCI', '', '160', '120'],
      ['QMCI', '', '8.00', '4.30'],
    ]);
    expect(t.body[0][0].italic).toBe(true);
    expect(t.body[3][0].bold).toBe(true);
    // two sites, the report for one of them: the survey somewhere else isn't in it
    const other = newSite(projectId, { code: 'US1' });
    await saveSite(other);
    const both = await loadBundle(projectId);
    const one = buildReport({ bundle: both, template: layout('taxa'), period, settings: DEFAULT_SETTINGS, siteIds: [siteId] });
    expect(tables(one.nodes)[0].head[0].map((c) => c.text)).toEqual(['Taxon', 'Group', 'DS1\n1 May 2026']);
  });

  it('more surveys than a page takes across: the taxa run on to a second table, the notes under the last', async () => {
    const mine = newProject({ name: 'Many surveys', code: 'EC-2', ecology: true });
    await saveProject(mine);
    for (let i = 0; i < 9; i++) {
      const st = newSite(mine.id, { code: `S${i + 1}` });
      await saveSite(st);
      await saveSurvey(newSurvey(mine.id, { siteId: st.id, date: '2026-05-03', records: [{ taxon: 'Deleatidium', n: i + 1 }, { taxon: 'Zelandoperla', code: 'R' }] }));
    }
    const doc = buildReport({ bundle: await loadBundle(mine.id), template: layout('taxa'), period, settings: DEFAULT_SETTINGS });
    const made = tables(doc.nodes);
    expect(made.length).toBeGreaterThan(1);
    expect(made[0].caption).toBe('Table 1: Taxa found, 1 May 2026 – 31 May 2026');
    expect(made[1].caption).toBe('Table 2: Taxa found, 1 May 2026 – 31 May 2026 (continued)');
    // every survey is in one of them, once
    expect(made.flatMap((t) => t.head[0].slice(2).map((c) => c.text.split('\n')[0]))).toEqual(['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9']);
    expect(made.slice(0, -1).every((t) => !t.notes)).toBe(true);
    expect(made[made.length - 1].notes![0]).toMatch(/^Coded abundances/);
    // "All data": the caption gives the dates the surveys cover
    const all = buildReport({ bundle: await loadBundle(mine.id), template: layout('indices'), period: { start: '1900-01-01', end: '2199-12-31', label: 'All data' }, settings: DEFAULT_SETTINGS });
    expect(tables(all.nodes)[0].caption).toBe('Table 1: Ecology surveys, 3 May 2026 – 3 May 2026');
    await deleteProject(mine.id);
  });

  it('an issued report keeps the surveys it showed; a change to one since is said', async () => {
    const b = await loadBundle(projectId);
    const input = { bundle: b, template: layout('indices'), period, settings: DEFAULT_SETTINGS, issuedOn: '2026-06-10' };
    const content = JSON.parse(JSON.stringify(snapshotContent(input))) as ReturnType<typeof snapshotContent>;
    expect(content.ecology!.surveys.map((s) => s.date)).toEqual(expect.arrayContaining(['2026-05-01', '2026-05-02']));
    expect(content.ecology!.surveys).toHaveLength(2);
    expect(content.ecology!.taxa.map((t) => t.id).sort()).toEqual(['deleatidium', 'potamopyrgus antipodarum', 'zelandoperla']);
    // rebuilt from the record alone: the same table
    const again = buildReport({ bundle: snapshotBundle(content), template: content.template, period, settings: DEFAULT_SETTINGS });
    const now = buildReport({ bundle: b, template: layout('indices'), period, settings: DEFAULT_SETTINGS });
    expect(tables(again.nodes)[0].body.map((r) => r.map((c) => c.text))).toEqual(tables(now.nodes)[0].body.map((r) => r.map((c) => c.text)));
    // a layout without the section keeps no surveys
    expect(snapshotContent({ ...input, template: { ...annual, blocks: [] } }).ecology).toBeUndefined();
    // nothing changed: nothing said
    expect(diffSnapshots(content, snapshotContent(input)).changes.filter((c) => /ecology|taxa list/.test(c.text))).toEqual([]);
    // a score given since
    const stone = (await db.taxa.get('zelandoperla'))!;
    await saveTaxon({ ...stone, mci: 10 }, stone);
    const scored = diffSnapshots(content, snapshotContent({ ...input, bundle: await loadBundle(projectId) }));
    expect(scored.changes.map((c) => c.text)).toContain('The taxa list changed (groups or tolerance scores)');
    // a survey changed since
    const s = (await db.surveys.where('projectId').equals(projectId).toArray()).find((x) => x.date === '2026-05-01')!;
    await saveSurvey({ ...s, records: [...s.records, { taxon: 'Aoteapsyche', n: 7 }] }, s);
    const changed = diffSnapshots(content, snapshotContent({ ...input, bundle: await loadBundle(projectId) }));
    expect(changed.changes.map((c) => c.text)).toContain('1 ecology survey added, changed or removed');
  });
});
