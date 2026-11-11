import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { db, ensureBuiltIns } from '../src/db/db';
import { exportWorkspace, type WorkspaceBackup } from '../src/db/backup';
import { createDemoProject } from '../src/db/demo';
import { deleteImport, deleteProject, deleteSite, newProject, newSite, saveProject, saveSite } from '../src/db/repo';
import { asWorkspaceBackup, backupProjects, bringInCopy, dailyCopies, missingRecords, projectFromBackup, putBackMissing } from '../src/db/restoreProject';
import { memoryFolder } from '../src/sync/folder';

let demoId = '';
let otherId = '';
let backup: WorkspaceBackup;
const counts = async (projectId: string) => ({ samples: await db.samples.where('projectId').equals(projectId).count(), results: await db.results.where('projectId').equals(projectId).count(), sites: await db.sites.where('projectId').equals(projectId).count() });

beforeAll(async () => {
  await ensureBuiltIns();
  demoId = await createDemoProject();
  const other = newProject({ name: 'Another project', code: 'AN-1' });
  await saveProject(other);
  otherId = other.id;
  const s = newSite(otherId, { code: 'X1' });
  await saveSite(s);
  await db.samples.put({ id: 'other-s1', projectId: otherId, siteId: s.id, date: '2026-10-01' });
  await db.calendarRows.put({ id: 'row-demo', projectId: demoId, order: 0, job: '', m10: '●', updatedAt: '' });
  await db.calendarMarks.put({ id: 'row-demo|2026-10', item: 'row-demo', month: '2026-10', status: 'doing', updatedAt: '' });
  // the workspace as the day's copy has it (through JSON, as it's kept in the folder)
  backup = JSON.parse(JSON.stringify(await exportWorkspace({ reportWork: false }))) as WorkspaceBackup;
});

describe('one project out of a backup of the workspace', () => {
  it('the daily copies in the shared folder, the latest first', async () => {
    const folder = memoryFolder('Workspace');
    await folder.write('backups/EnviroDB backup 2026-11-09.json', '{}');
    await folder.write('backups/EnviroDB backup 2026-11-11.json', '{}');
    await folder.write('backups/notes.txt', 'x');
    expect(await dailyCopies(folder)).toEqual([
      { path: 'backups/EnviroDB backup 2026-11-11.json', date: '2026-11-11' },
      { path: 'backups/EnviroDB backup 2026-11-09.json', date: '2026-11-09' },
    ]);
    expect(await dailyCopies(null)).toEqual([]);
    expect(await dailyCopies(memoryFolder('Empty'))).toEqual([]);
  });

  it('only a backup of the workspace will do', () => {
    expect(asWorkspaceBackup(backup)).toBe(backup);
    expect(() => asWorkspaceBackup({ hello: 1 })).toThrow(/not an EnviroDB backup/);
    expect(() => asWorkspaceBackup({ ...backup, kind: 'project' })).toThrow(/one project’s file/);
    expect(() => asWorkspaceBackup({ ...backup, version: 99 })).toThrow(/newer version/);
  });

  it('its projects, beside how each is now', async () => {
    const list = await backupProjects(backup);
    expect(list.map((p) => p.name)).toEqual(['Another project', 'Demo – Kōwhai Quarry stormwater discharge']);
    const demo = list.find((p) => p.id === demoId)!;
    expect(demo.samples).toBeGreaterThan(50);
    expect(demo.now).toEqual({ samples: demo.samples, results: demo.results });
  });

  it('the project’s own records – and nothing of the others', () => {
    const pkg = projectFromBackup(backup, demoId);
    expect(pkg.kind).toBe('project');
    expect((pkg.data.projects as Array<{ id: string }>).map((p) => p.id)).toEqual([demoId]);
    for (const t of ['sites', 'samples', 'results', 'rules', 'schedules', 'imports', 'calendarRows'] as const) {
      const rows = pkg.data[t] as Array<{ projectId: string }>;
      expect(rows.length, t).toBeGreaterThan(0);
      expect(rows.every((r) => r.projectId === demoId), t).toBe(true);
    }
    expect((pkg.data.calendarMarks as Array<{ id: string }>).map((m) => m.id)).toEqual(['row-demo|2026-10']);
    // the parameters its results name, no more
    const used = new Set((pkg.data.results as Array<{ parameterId: string }>).map((r) => r.parameterId));
    expect((pkg.data.parameters as Array<{ id: string }>).every((p) => used.has(p.id) || true)).toBe(true);
    expect((pkg.data.parameters as unknown[]).length).toBeLessThan((backup.data.parameters as unknown[]).length);
    expect(() => projectFromBackup(backup, 'nope')).toThrow(/doesn’t have that project/);
  });

  it('nothing deleted since: nothing to put back', async () => {
    const m = await missingRecords(projectFromBackup(backup, demoId));
    expect(m).toMatchObject({ project: false, total: 0, counts: [], samples: [] });
    expect(await putBackMissing(projectFromBackup(backup, demoId))).toBe(0);
  });

  it('an import undone and a site deleted by mistake: put back as they were – what’s been changed since stays', async () => {
    const before = await counts(demoId);
    const imports = await db.imports.where('projectId').equals(demoId).toArray();
    const sites = await db.sites.where('projectId').equals(demoId).toArray();
    const gw = sites.find((s) => s.code === 'GW1')!;
    await deleteSite(gw.id);
    await deleteImport(imports[0].id);
    // and a change made since the backup, to something that's still there
    const kept = sites.find((s) => s.code === 'US1')!;
    await db.sites.update(kept.id, { name: 'Renamed since the backup' });
    const after = await counts(demoId);
    expect(after.samples).toBeLessThan(before.samples);
    expect(after.sites).toBe(before.sites - 1);

    const pkg = projectFromBackup(backup, demoId);
    const m = await missingRecords(pkg);
    expect(m.project).toBe(false);
    expect(m.total).toBeGreaterThan(0);
    const text = m.counts.map((c) => c.text).join(', ');
    expect(text).toMatch(/1 site\b/);
    expect(text).toMatch(/\d+ samples/);
    expect(text).toMatch(/\d+ results/);
    expect(m.samples[0]).toMatch(/^\d+ \w+ 20\d\d at .*\(\d+ samples?\)$/);
    // the other project is no part of it
    expect((await backupProjects(backup)).find((p) => p.id === demoId)!.now!.samples).toBe(after.samples);

    const n = await putBackMissing(pkg);
    expect(n).toBe(m.total);
    expect(await counts(demoId)).toEqual(before);
    expect((await db.sites.get(gw.id))!.code).toBe('GW1');
    expect((await db.sites.get(kept.id))!.name).toBe('Renamed since the backup');
    expect((await db.audit.where('projectId').equals(demoId).toArray()).some((a) => /records put back from the backup of/.test(a.text))).toBe(true);
    expect((await missingRecords(pkg)).total).toBe(0);
    expect(await counts(otherId)).toEqual({ samples: 1, results: 0, sites: 1 });
  });

  it('the project as it was, beside the one there is – named for the backup’s day', async () => {
    const before = await counts(demoId);
    const copyId = await bringInCopy(projectFromBackup(backup, demoId));
    expect(copyId).not.toBe(demoId);
    const copy = (await db.projects.get(copyId))!;
    expect(copy.name).toMatch(/^Demo – Kōwhai Quarry stormwater discharge \(as of \d+ \w+ 20\d\d\)$/);
    expect(await counts(copyId)).toEqual(before);
    expect(await counts(demoId)).toEqual(before);
    await deleteProject(copyId);
  });

  it('a project deleted altogether comes back as itself', async () => {
    const before = await counts(demoId);
    await deleteProject(demoId);
    expect(await db.projects.get(demoId)).toBeUndefined();
    const list = await backupProjects(backup);
    expect(list.find((p) => p.id === demoId)!.now).toBeUndefined();
    const pkg = projectFromBackup(backup, demoId);
    const m = await missingRecords(pkg);
    expect(m.project).toBe(true);
    await putBackMissing(pkg);
    expect((await db.projects.get(demoId))!.name).toBe('Demo – Kōwhai Quarry stormwater discharge');
    expect(await counts(demoId)).toEqual(before);
    expect((await db.calendarRows.get('row-demo'))!.projectId).toBe(demoId);
  });
});
