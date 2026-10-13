import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { EnviroDatabase, ensureBuiltIns, getSettings, saveSettings } from '../src/db/db';
import type { Project, Sample, Site } from '../src/db/types';
import { markUncaptured } from '../src/sync/capture';
import { saveEdited } from '../src/db/repo';
import { setClockClient } from '../src/sync/hlc';
import { memoryFolder } from '../src/sync/folder';
import {
  adoptLocalData, clearLocalCopy, createWorkspaceFile, dailySnapshot, flush, localData, pull, readPeople, repairOwnFiles, segmentPath, writePresence, type SyncContext,
} from '../src/sync/engine';
import { applyChanges } from '../src/sync/merge';
import { decodeEntry, rowKey, type Change, type ChangesFile } from '../src/sync/model';

let n = 0;
let folder: ReturnType<typeof memoryFolder>;
let ctxA: SyncContext;
let ctxB: SyncContext;

/** Run as one of the two people (the clock stamps changes with their client id). */
async function as<T>(ctx: SyncContext, fn: (db: EnviroDatabase) => Promise<T>): Promise<T> {
  setClockClient(ctx.clientId);
  return fn(ctx.db as EnviroDatabase);
}

async function client(id: string): Promise<SyncContext> {
  const db = new EnviroDatabase(`sync-test-${++n}-${id}`);
  await ensureBuiltIns(db);
  return { db, folder, clientId: id, workspace: (await createWorkspaceFile(folder, 'Test workspace', id)) };
}

/** Both write what they changed, then both read the other's. */
async function exchange() {
  await as(ctxA, () => flush(ctxA));
  await as(ctxB, () => flush(ctxB));
  const a = await as(ctxA, () => pull(ctxA));
  const b = await as(ctxB, () => pull(ctxB));
  return { a, b };
}

const project = (patch: Partial<Project> = {}): Project => ({
  id: 'p1', name: 'Quarry discharge', code: 'Q-1', client: 'Client Ltd', status: 'active', guidelineSetIds: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...patch,
} as Project);
const site = (patch: Partial<Site> = {}): Site => ({ id: 's1', projectId: 'p1', code: 'DP1', aliases: [], order: 1, ...patch } as Site);

beforeEach(async () => {
  folder = memoryFolder();
  ctxA = await client('ca');
  // both use the same workspace file
  ctxB = { ...(await client('cb')), workspace: ctxA.workspace };
  folder.files.set('envirodb-workspace.json', { text: JSON.stringify(ctxA.workspace), lastModified: Date.now() });
});

describe('recording changes', () => {
  it('stamps each changed field – and nothing for built-in reference data, saves that change nothing, or this browser’s own records', async () => {
    expect(await A_().syncState.count()).toBe(0); // built-ins are the same everywhere
    await as(ctxA, (db) => db.projects.put(project()));
    const row = (await A_().syncState.get(rowKey('projects', 'p1')))!;
    expect(Object.keys(row.f).sort()).toEqual(['client', 'code', 'createdAt', 'guidelineSetIds', 'name', 'status', 'updatedAt']);
    expect(row).toMatchObject({ s: 'projects', mine: 1 });
    expect(row.c).toBeTruthy();
    expect(await A_().syncDirty.get('projects')).toBeTruthy();

    await as(ctxA, (db) => db.projects.put(project()));
    expect((await A_().syncState.get(rowKey('projects', 'p1')))!.f).toEqual(row.f);
    await as(ctxA, (db) => db.projects.update('p1', { name: 'Renamed' }));
    const after = (await A_().syncState.get(rowKey('projects', 'p1')))!;
    expect(Object.entries(after.f).filter(([k, s]) => s !== row.f[k]).map(([k]) => k)).toEqual(['name']);

    // the team's settings field by field; your own settings and bookkeeping stay here
    await as(ctxA, (db) => saveSettings({ company: 'Acme Ltd', author: 'Ann' }, db));
    await as(ctxA, (db) => db.meta.put({ key: 'autosaveLast', value: 'x' }));
    expect(Object.keys((await A_().syncState.get(rowKey('meta', 'settings')))!.f)).toEqual(['.company']);
    expect(await A_().syncState.get(rowKey('meta', 'mySettings'))).toBeUndefined();
    expect(await A_().syncState.get(rowKey('meta', 'autosaveLast'))).toBeUndefined();
  });
});

const A_ = () => ctxA.db as EnviroDatabase;
const B_ = () => ctxB.db as EnviroDatabase;

describe('two people in one workspace', () => {
  it('shares what one adds with the other, through files only the one writes', async () => {
    await as(ctxA, async (db) => {
      await db.projects.put(project());
      await db.sites.put(site());
      await db.samples.put({ id: 'smp1', projectId: 'p1', siteId: 's1', date: '2026-03-02' } as Sample);
    });
    const { b } = await exchange();
    expect([...folder.files.keys()].filter((k) => k.startsWith('clients/ca/')).sort()).toEqual([
      segmentPath('ca', 'data.p1.2026'), segmentPath('ca', 'project.p1'), segmentPath('ca', 'projects'),
    ].sort());
    expect(await B_().projects.get('p1')).toMatchObject({ name: 'Quarry discharge' });
    expect(await B_().sites.get('s1')).toMatchObject({ code: 'DP1' });
    expect(await B_().samples.get('smp1')).toMatchObject({ date: '2026-03-02' });
    expect(b.changes.map((c) => [c.t, c.action, c.by]).sort()).toEqual([['projects', 'added', 'ca'], ['samples', 'added', 'ca'], ['sites', 'added', 'ca']]);
    // what B received is A's to write, not B's
    expect((await B_().syncState.get(rowKey('projects', 'p1')))!.mine).toBe(0);
    expect(await B_().syncDirty.count()).toBe(0);
  });

  it('keeps both changes when two people change different things in the same record at once', async () => {
    await as(ctxA, (db) => db.projects.put(project()));
    await exchange();
    await as(ctxA, (db) => db.projects.update('p1', { name: 'Name from Ann' }));
    await as(ctxB, (db) => db.projects.update('p1', { client: 'Client from Bo' }));
    const { a, b } = await exchange();
    for (const db of [A_(), B_()]) expect(await db.projects.get('p1')).toMatchObject({ name: 'Name from Ann', client: 'Client from Bo' });
    expect([...a.conflicts, ...b.conflicts]).toEqual([]);
  });

  it('keeps the later change when both change the same thing, and tells the person whose change was replaced', async () => {
    await as(ctxA, (db) => db.projects.put(project()));
    await exchange();
    await as(ctxA, (db) => db.projects.update('p1', { name: 'Ann’s name' }));
    await as(ctxB, (db) => db.projects.update('p1', { name: 'Bo’s name' }));
    const { a, b } = await exchange();
    for (const db of [A_(), B_()]) expect((await db.projects.get('p1'))!.name).toBe('Bo’s name');
    expect(a.conflicts).toMatchObject([{ t: 'projects', k: 'p1', by: 'cb', fields: ['name'], deleted: false }]);
    expect(b.conflicts).toEqual([]);
  });

  it('deletes for everyone – a change made at the same time doesn’t bring it back – and making it again does', async () => {
    await as(ctxA, async (db) => {
      await db.projects.put(project());
      await db.sites.put(site());
    });
    await exchange();
    await as(ctxA, (db) => db.sites.delete('s1'));
    await as(ctxB, (db) => db.sites.update('s1', { name: 'Discharge point' }));
    const { b } = await exchange();
    for (const db of [A_(), B_()]) expect(await db.sites.get('s1')).toBeUndefined();
    expect(b.conflicts).toMatchObject([{ t: 'sites', k: 's1', by: 'ca', deleted: true }]);

    await as(ctxB, (db) => db.sites.put(site({ code: 'DP1-new' })));
    await exchange();
    for (const db of [A_(), B_()]) expect(await db.sites.get('s1')).toEqual(site({ code: 'DP1-new' }));
  });

  it('ends up the same whatever order the files are read in', async () => {
    await as(ctxA, async (db) => {
      await db.projects.put(project());
      await db.sites.bulkPut([site(), site({ id: 's2', code: 'US1' })]);
    });
    await exchange();
    await as(ctxA, async (db) => {
      await db.sites.update('s1', { code: 'A1' });
      await db.sites.delete('s2');
      await db.projects.update('p1', { name: 'A' });
    });
    await as(ctxB, async (db) => {
      await db.sites.update('s1', { name: 'B name' });
      await db.projects.update('p1', { name: 'B', code: 'B-code' });
      await db.sites.update('s2', { name: 'edited after the delete' });
    });
    await as(ctxA, () => flush(ctxA));
    await as(ctxB, () => flush(ctxB));
    const files = [...folder.files.entries()].filter(([k]) => k.startsWith('clients/') && !k.endsWith('client.json')).map(([, f]) => JSON.parse(f.text) as ChangesFile);
    const changes = (f: ChangesFile) => f.entries.map(decodeEntry).filter((c): c is Change => !!c);
    const read = async (order: ChangesFile[]) => {
      const db = new EnviroDatabase(`sync-test-${++n}-order`);
      await ensureBuiltIns(db);
      setClockClient('cz');
      for (const f of order) await applyChanges(db, changes(f), 'cz');
      return { projects: await db.projects.toArray(), sites: await db.sites.toArray() };
    };
    const one = await read(files);
    const other = await read([...files].reverse());
    expect(one).toEqual(other);
    expect(one.projects[0]).toMatchObject({ name: 'B', code: 'B-code' });
    expect(one.sites).toEqual([site({ code: 'A1', name: 'B name' })]);
  });

  it('gives one sample, not two, when two people import the same sampling at once', async () => {
    // imports name samples and results after what they are (see commitImport), so both make the same record
    await as(ctxA, (db) => db.samples.put({ id: 's_same', projectId: 'p1', siteId: 's1', date: '2026-03-02', labNumber: '1.1' } as Sample));
    await as(ctxB, (db) => db.samples.put({ id: 's_same', projectId: 'p1', siteId: 's1', date: '2026-03-02T09:30', sampleName: 'DP1 2 Mar' } as Sample));
    await exchange();
    for (const db of [A_(), B_()]) {
      expect(await db.samples.count()).toBe(1);
      expect(await db.samples.get('s_same')).toMatchObject({ labNumber: '1.1', sampleName: 'DP1 2 Mar', date: '2026-03-02T09:30' });
    }
  });

  it('saves only what was changed in a form, so a colleague’s change made while it was open stays', async () => {
    await as(ctxA, (db) => db.projects.put(project()));
    await exchange();
    const opened = (await A_().projects.get('p1'))!; // Ann opens the project form
    await as(ctxB, (db) => db.projects.update('p1', { client: 'Client from Bo' }));
    await exchange(); // Bo's change arrives while the form is open
    await as(ctxA, (db) => saveEdited(db.projects, { ...opened, name: 'Name from Ann' }, opened));
    await exchange();
    for (const db of [A_(), B_()]) expect(await db.projects.get('p1')).toMatchObject({ name: 'Name from Ann', client: 'Client from Bo' });
    // a form saving everything it has would have put the old client back
    expect(opened.client).toBe('Client Ltd');
  });

  it('shares the team’s settings and report commentary, section by section, but not your own settings', async () => {
    await as(ctxA, async (db) => {
      await saveSettings({ company: 'Acme Ltd', author: 'Ann Smith', signatureImage: 'data:image/png;base64,AAAA' }, db);
      await db.meta.put({ key: 'draft:p1:t1:2026-01-01:2026-12-31', value: { intro: 'Ann wrote the introduction.' } });
    });
    await exchange();
    expect(await getSettings(B_())).toMatchObject({ company: 'Acme Ltd', author: '' });
    expect((await getSettings(B_())).signatureImage).toBeUndefined();
    // both write in the same report at once, in different sections
    const write = (db: EnviroDatabase, section: string, text: string) =>
      db.transaction('rw', db.meta, async () => {
        const cur = (await db.meta.get('draft:p1:t1:2026-01-01:2026-12-31'))!.value as Record<string, string>;
        await db.meta.put({ key: 'draft:p1:t1:2026-01-01:2026-12-31', value: { ...cur, [section]: text } });
      });
    await as(ctxA, (db) => write(db, 'intro', 'Ann rewrote the introduction.'));
    await as(ctxB, (db) => write(db, 'summary', 'Bo wrote the summary.'));
    await exchange();
    for (const db of [A_(), B_()]) expect((await db.meta.get('draft:p1:t1:2026-01-01:2026-12-31'))!.value).toEqual({ intro: 'Ann rewrote the introduction.', summary: 'Bo wrote the summary.' });
  });
});

describe('the folder', () => {
  it('tries a file that is still arriving again later', async () => {
    await as(ctxA, (db) => db.projects.put(project()));
    await as(ctxA, () => flush(ctxA));
    const path = segmentPath('ca', 'projects');
    const full = folder.files.get(path)!.text;
    folder.files.set(path, { text: full.slice(0, 40), lastModified: Date.now() + 5 });
    const first = await as(ctxB, () => pull(ctxB));
    expect(first.skipped).toEqual([path]);
    expect(await B_().projects.count()).toBe(0);
    folder.files.set(path, { text: full, lastModified: Date.now() + 10 });
    await as(ctxB, () => pull(ctxB));
    expect(await B_().projects.count()).toBe(1);
  });

  it('keeps changes made while the folder can’t be reached, and writes them when it is back', async () => {
    folder.offline = true;
    await as(ctxA, (db) => db.projects.put(project()));
    await expect(as(ctxA, () => flush(ctxA))).rejects.toThrow();
    expect(await A_().syncDirty.count()).toBe(1);
    folder.offline = false;
    expect(await as(ctxA, () => flush(ctxA))).toBe(1);
    expect(await A_().syncDirty.count()).toBe(0);
    await as(ctxB, () => pull(ctxB));
    expect(await B_().projects.count()).toBe(1);
  });

  it('notices files from a newer EnviroDB instead of misreading them', async () => {
    folder.files.set(segmentPath('cz', 'projects'), { text: JSON.stringify({ app: 'EnviroDB', kind: 'changes', format: 99, workspace: ctxA.workspace.id, entries: [['projects', 'p9', 'x', 0, { name: 'From the future' }, 0]] }), lastModified: Date.now() });
    const res = await as(ctxB, () => pull(ctxB));
    expect(res.newer).toBe(true);
    expect(await B_().projects.count()).toBe(0);
  });

  it('writes again any of its files that went missing', async () => {
    await as(ctxA, (db) => db.projects.put(project()));
    await as(ctxA, () => flush(ctxA));
    folder.files.delete(segmentPath('ca', 'projects'));
    expect(await as(ctxA, () => repairOwnFiles(ctxA))).toBe(1);
    await as(ctxA, () => flush(ctxA));
    expect(folder.files.has(segmentPath('ca', 'projects'))).toBe(true);
  });

  it('lists who is connected and keeps a daily copy of everything', async () => {
    await writePresence(ctxA, 'Ann Smith');
    await writePresence(ctxB, 'Bo Jones');
    expect((await readPeople(ctxA)).map((p) => [p.name, p.me]).sort()).toEqual([['Ann Smith', true], ['Bo Jones', false]]);
    const backup = async () => ({ app: 'EnviroDB', kind: 'workspace' });
    expect(await dailySnapshot(ctxA, '2026-10-01', backup, 2)).toBe(true);
    expect(await dailySnapshot(ctxB, '2026-10-01', backup, 2)).toBe(false); // someone already did today
    await dailySnapshot(ctxA, '2026-10-02', backup, 2);
    await dailySnapshot(ctxA, '2026-10-03', backup, 2);
    expect([...folder.files.keys()].filter((k) => k.startsWith('backups/')).sort()).toEqual(['backups/EnviroDB backup 2026-10-02.json', 'backups/EnviroDB backup 2026-10-03.json']);
  });
});

describe('joining with data already in this browser', () => {
  it('adds it to the workspace, or clears it (built-in reference data stays)', async () => {
    // data from before workspaces: not recorded as changes
    await A_().transaction('rw', A_().projects, A_().sites, async (tx) => {
      markUncaptured(tx.idbtrans);
      await A_().projects.put(project());
      await A_().sites.put(site());
    });
    expect(await localData(A_())).toEqual({ projects: 1, records: 2 });
    expect(await as(ctxA, () => adoptLocalData(A_()))).toBe(2);
    await exchange();
    expect(await B_().sites.get('s1')).toMatchObject({ code: 'DP1' });

    const params = await B_().parameters.count();
    await clearLocalCopy(B_());
    expect(await localData(B_())).toEqual({ projects: 0, records: 0 });
    expect(await B_().parameters.count()).toBe(params);
    expect(await B_().syncState.count()).toBe(0);
  });
});
