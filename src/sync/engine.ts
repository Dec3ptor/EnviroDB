// The workspace folder's contents and the two halves of keeping it in step:
//
//   envirodb-workspace.json          which workspace this is
//   clients/<client>/client.json     who that is and when they were last connected
//   clients/<client>/<segment>.json  the records that client changed, with the stamps of the changes
//   backups/EnviroDB backup <date>.json   a daily copy of everything
//
// Each browser writes only its own files, so OneDrive, SharePoint or a network drive never has two people saving
// the same file. Reading everyone else's files and merging them field by field (merge.ts) gives every browser the
// same data, whatever order the files arrive in.

import type { Dexie, Table } from 'dexie';
import { markUncaptured } from './capture';
import { stamp } from './hlc';
import { applyChanges, type Conflict, type RemoteChange } from './merge';
import { isNotFound, type FileInfo, type WorkspaceFolder } from './folder';
import {
  BACKUPS_DIR, CLIENTS_DIR, decodeEntry, encodeEntry, FILE_APP, FILE_FORMAT, fieldsOf, isSharedRecord, primaryKeyName, rowKey, segmentOf, SHARED_TABLES, WORKSPACE_FILE,
  type Change, type ChangesFile, type ClientFile, type DirtySegment, type FileEntry, type SyncRow, type WorkspaceFile,
} from './model';

export interface SyncedFile extends FileInfo {
  path: string;
}

export interface SyncContext {
  db: Dexie;
  folder: WorkspaceFolder;
  clientId: string;
  workspace: WorkspaceFile;
}

const tbl = <T>(db: Dexie, name: string) => db.table(name) as Table<T, string>;

const clientDir = (id: string) => `${CLIENTS_DIR}/${id}`;
export const segmentPath = (client: string, segment: string) => `${clientDir(client)}/${segment}.json`;

// ------------------------------------------------------------ the workspace file

function isWorkspaceFile(x: unknown): x is WorkspaceFile {
  const w = x as WorkspaceFile;
  return !!w && w.app === FILE_APP && w.kind === 'workspace' && typeof w.id === 'string' && !!w.id;
}

/** The folder's workspace file, or null when the folder is not a workspace (yet). */
export async function readWorkspaceFile(folder: WorkspaceFolder): Promise<WorkspaceFile | null> {
  const got = await folder.read(WORKSPACE_FILE);
  if (!got) return null;
  try {
    const w = JSON.parse(got.text);
    return isWorkspaceFile(w) ? w : null;
  } catch {
    return null;
  }
}

export async function createWorkspaceFile(folder: WorkspaceFolder, name: string, createdBy: string): Promise<WorkspaceFile> {
  const random = globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 16) ?? Math.random().toString(36).slice(2, 18);
  const w: WorkspaceFile = { app: FILE_APP, kind: 'workspace', format: FILE_FORMAT, id: `ws_${random}`, name: name.trim() || folder.name, createdAt: new Date().toISOString(), createdBy };
  await folder.write(WORKSPACE_FILE, JSON.stringify(w, null, 2));
  return w;
}

// ------------------------------------------------------------ reading colleagues' changes

export interface PullResult {
  changes: RemoteChange[];
  conflicts: Conflict[];
  /** Files read and merged. */
  files: number;
  /** Files that could not be read this time (still being synced, or locked) – tried again next time. */
  skipped: string[];
  /** A colleague's EnviroDB writes a newer file format: this page needs reloading. */
  newer: boolean;
}

export async function listClients(folder: WorkspaceFolder): Promise<string[]> {
  return (await folder.list(CLIENTS_DIR)).filter((e) => e.kind === 'directory').map((e) => e.name);
}

/**
 * Reads the files colleagues have changed since last time and merges them in. `full` reads every file again
 * (a safety net for a change a file's time and size don't show).
 */
export async function pull(ctx: SyncContext, opts: { full?: boolean; onProgress?: (done: number, total: number) => void } = {}): Promise<PullResult> {
  const { db, folder, clientId } = ctx;
  const out: PullResult = { changes: [], conflicts: [], files: 0, skipped: [], newer: false };
  const seen = new Map((await tbl<SyncedFile>(db, 'syncFiles').toArray()).map((f) => [f.path, f]));
  const todo: Array<{ path: string; info: FileInfo }> = [];
  for (const client of await listClients(folder)) {
    if (client === clientId) continue;
    for (const e of await folder.list(clientDir(client))) {
      if (e.kind !== 'file' || !e.name.endsWith('.json') || e.name === 'client.json') continue;
      const path = `${clientDir(client)}/${e.name}`;
      let info: FileInfo | null;
      try {
        info = await folder.info(path);
      } catch {
        out.skipped.push(path);
        continue;
      }
      if (!info) continue;
      const last = seen.get(path);
      if (!opts.full && last && last.lastModified === info.lastModified && last.size === info.size) continue;
      todo.push({ path, info });
    }
  }
  let done = 0;
  for (const { path } of todo) {
    opts.onProgress?.(done++, todo.length);
    let got: Awaited<ReturnType<WorkspaceFolder['read']>>;
    try {
      got = await folder.read(path);
    } catch (e) {
      if (!isNotFound(e)) out.skipped.push(path);
      continue;
    }
    if (!got) continue;
    let file: ChangesFile;
    try {
      file = JSON.parse(got.text);
    } catch {
      out.skipped.push(path); // still arriving
      continue;
    }
    if (file?.app === FILE_APP && file.kind === 'changes' && file.workspace === ctx.workspace.id) {
      if (file.format > FILE_FORMAT) {
        out.newer = true;
        continue;
      }
      const changes = (Array.isArray(file.entries) ? file.entries : []).map(decodeEntry).filter((c): c is Change => !!c);
      const res = await applyChanges(db, changes, clientId);
      out.changes.push(...res.changes);
      out.conflicts.push(...res.conflicts);
      out.files++;
    }
    await tbl<SyncedFile>(db, 'syncFiles').put({ path, lastModified: got.info.lastModified, size: got.info.size });
  }
  opts.onProgress?.(todo.length, todo.length);
  return out;
}

// ------------------------------------------------------------ writing this browser's changes

/** Segments with changes not yet in this client's files. */
export async function pendingSegments(db: Dexie): Promise<number> {
  return tbl<DirtySegment>(db, 'syncDirty').count();
}

/** This client's file for a segment: every record it has a change in, as it stands now. */
async function segmentFile(ctx: SyncContext, segment: string): Promise<ChangesFile> {
  const { db } = ctx;
  const entries = await db.transaction('r', [db.table('syncState'), ...SHARED_TABLES.map((t) => db.table(t))], async () => {
    const rows = await tbl<SyncRow>(db, 'syncState').where('[s+mine]').equals([segment, 1]).toArray();
    const byTable = new Map<string, SyncRow[]>();
    for (const r of rows) {
      const group = byTable.get(r.t);
      if (group) group.push(r);
      else byTable.set(r.t, [r]);
    }
    const list: FileEntry[] = [];
    for (const [t, group] of byTable) {
      const recs = (await db.table(t).bulkGet(group.map((r) => r.k))) as Array<Record<string, unknown> | undefined>;
      group.forEach((r, i) => list.push(encodeEntry(r, recs[i])));
    }
    return list;
  });
  return { app: FILE_APP, kind: 'changes', format: FILE_FORMAT, workspace: ctx.workspace.id, client: ctx.clientId, segment, written: new Date().toISOString(), entries };
}

/** Writes the segments changed here to this client's files. Returns how many files were written. */
export async function flush(ctx: SyncContext): Promise<number> {
  const { db, folder, clientId } = ctx;
  let n = 0;
  for (const { s, v } of await tbl<DirtySegment>(db, 'syncDirty').toArray()) {
    const file = await segmentFile(ctx, s);
    await folder.write(segmentPath(clientId, s), JSON.stringify(file));
    n++;
    // done, unless it changed again while being written
    await db.transaction('rw', db.table('syncDirty'), async () => {
      const cur = await tbl<DirtySegment>(db, 'syncDirty').get(s);
      if (cur && cur.v === v) await tbl<DirtySegment>(db, 'syncDirty').delete(s);
    });
  }
  return n;
}

/** Puts back any of this client's files that have gone missing from the folder (written again from this browser). */
export async function repairOwnFiles(ctx: SyncContext): Promise<number> {
  const { db, folder, clientId } = ctx;
  const have = new Set((await folder.list(clientDir(clientId))).map((e) => e.name));
  const pairs = (await tbl<SyncRow>(db, 'syncState').orderBy('[s+mine]').uniqueKeys()) as unknown as Array<[string, number]>;
  const missing = pairs.filter(([s, mine]) => mine === 1 && s && !have.has(`${s}.json`)).map(([s]) => s);
  if (missing.length) await tbl<DirtySegment>(db, 'syncDirty').bulkPut(missing.map((s) => ({ s, v: stamp() })));
  return missing.length;
}

// ------------------------------------------------------------ who's connected

export interface Person {
  id: string;
  name: string;
  lastSeen: string;
  me: boolean;
}

export async function writePresence(ctx: SyncContext, name: string): Promise<void> {
  const file: ClientFile = { app: FILE_APP, kind: 'client', format: FILE_FORMAT, workspace: ctx.workspace.id, id: ctx.clientId, name, lastSeen: new Date().toISOString() };
  await ctx.folder.write(`${clientDir(ctx.clientId)}/client.json`, JSON.stringify(file));
}

const peopleCache = new Map<string, { info: FileInfo; person: Person | null }>();

/** Everyone who has connected to the workspace, most recently seen first. */
export async function readPeople(ctx: SyncContext): Promise<Person[]> {
  const out: Person[] = [];
  for (const id of await listClients(ctx.folder)) {
    const path = `${clientDir(id)}/client.json`;
    try {
      const info = await ctx.folder.info(path);
      if (!info) continue;
      const cached = peopleCache.get(path);
      let person = cached && cached.info.lastModified === info.lastModified && cached.info.size === info.size ? cached.person : undefined;
      if (person === undefined) {
        const got = await ctx.folder.read(path);
        const f = got ? (JSON.parse(got.text) as ClientFile) : null;
        person = f?.app === FILE_APP && f.kind === 'client' ? { id, name: String(f.name || 'Someone'), lastSeen: String(f.lastSeen ?? ''), me: id === ctx.clientId } : null;
        peopleCache.set(path, { info: got?.info ?? info, person });
      }
      if (person) out.push(person);
    } catch {
      /* being written: next time */
    }
  }
  return out.sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
}

// ------------------------------------------------------------ daily copies

const SNAPSHOT = /^EnviroDB backup (\d{4}-\d{2}-\d{2}).*\.json$/;

/** Writes today's copy of everything into backups/ if nobody has yet, keeping the latest `keep`. */
export async function dailySnapshot(ctx: SyncContext, today: string, makeBackup: () => Promise<unknown>, keep = 10): Promise<boolean> {
  const names = (await ctx.folder.list(BACKUPS_DIR)).filter((e) => e.kind === 'file' && SNAPSHOT.test(e.name)).map((e) => e.name);
  let wrote = false;
  if (!names.some((n) => SNAPSHOT.exec(n)?.[1] === today)) {
    const name = `EnviroDB backup ${today}.json`;
    await ctx.folder.write(`${BACKUPS_DIR}/${name}`, JSON.stringify(await makeBackup()));
    names.push(name);
    wrote = true;
  }
  const old = names.sort().slice(0, Math.max(0, names.length - keep));
  for (const n of old) await ctx.folder.remove(`${BACKUPS_DIR}/${n}`).catch(() => undefined);
  return wrote;
}

// ------------------------------------------------------------ this browser's data before it joins

const BUILT_IN_TABLES = new Set(['parameters', 'guidelineSets', 'templates']);

function sharedRecords(table: string, recs: Array<Record<string, unknown>>) {
  // built-in reference data, and a starter template not yet changed, are every browser's own
  return recs.filter((r) => !(BUILT_IN_TABLES.has(table) && r.builtIn) && !(table === 'templates' && r.starter) && isSharedRecord(table, r[primaryKeyName(table)]));
}

/** What this browser holds of its own: projects, and other work such as templates (built-in data and the team settings aside). */
export async function localData(db: Dexie): Promise<{ projects: number; records: number }> {
  let records = 0;
  for (const t of SHARED_TABLES) records += sharedRecords(t, await db.table(t).toArray()).filter((r) => !(t === 'meta' && r.key === 'settings')).length;
  return { projects: await db.table('projects').count(), records };
}

/** Makes everything this browser holds a change of its own, to be written to the workspace. */
export async function adoptLocalData(db: Dexie): Promise<number> {
  let n = 0;
  await db.transaction('rw', [...SHARED_TABLES.map((t) => db.table(t)), db.table('syncState'), db.table('syncDirty')], async (tx) => {
    markUncaptured(tx.idbtrans);
    const dirty = new Map<string, string>();
    for (const t of SHARED_TABLES) {
      const rows: SyncRow[] = [];
      for (const r of sharedRecords(t, await db.table(t).toArray())) {
        const k = String(r[primaryKeyName(t)]);
        const st = stamp();
        const s = segmentOf(t, r);
        rows.push({ tk: rowKey(t, k), t, k, s, f: Object.fromEntries(Object.keys(fieldsOf(t, r)).map((f) => [f, st])), c: st, mine: 1 });
        dirty.set(s, st);
      }
      if (rows.length) await tbl<SyncRow>(db, 'syncState').bulkPut(rows);
      n += rows.length;
    }
    await tbl<DirtySegment>(db, 'syncDirty').bulkPut([...dirty].map(([s, v]) => ({ s, v })));
  });
  return n;
}

/** Removes this browser's copy of shared data (built-in reference data stays) and what it knew of a workspace. */
export async function clearLocalCopy(db: Dexie): Promise<void> {
  await db.transaction('rw', [...SHARED_TABLES.map((t) => db.table(t)), db.table('syncState'), db.table('syncDirty'), db.table('syncFiles')], async (tx) => {
    markUncaptured(tx.idbtrans);
    for (const t of SHARED_TABLES) {
      const keys = sharedRecords(t, await db.table(t).toArray()).map((r) => r[primaryKeyName(t)] as string);
      if (keys.length) await db.table(t).bulkDelete(keys);
    }
    await db.table('syncState').clear();
    await db.table('syncDirty').clear();
    await db.table('syncFiles').clear();
  });
}
