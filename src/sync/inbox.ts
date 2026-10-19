// The lab inbox: lab files waiting to be imported – from the workspace's Inbox folder (the team saves lab emails'
// attachments there, by hand or with an Outlook rule) and from each project's own lab folder inside the projects
// folder this browser has been shown. Files imported or set aside are remembered for the whole team (the inbox table);
// one changed since – a lab's amended report – is new again. Nothing leaves the computer: the folders are read here.

import { useSyncExternalStore } from 'react';
import { db, getSettings } from '../db/db';
import type { InboxFile, Project } from '../db/types';
import { sniffLabFile } from '../importers/sniff';
import { handleFolder, type DirectoryHandle, type WorkspaceFolder } from './folder';
import { currentWorkspaceFolder, getWorkspaceState } from './workspace';

/** The workspace's inbox folder. */
export const INBOX_DIR = 'Inbox';
const LAB_EXT = /\.(csv|tsv|txt|xlsx|xlsm|xls|pdf|zip|json)$/i;
/** Folders not worth looking in. */
const SKIP_DIR = /^(\.|~|_old$|old$|superseded$|archive[sd]?$|photos?$|images?$|cad$|gis$|drawings?$|node_modules$)/i;
const MAX_DEPTH = 6;
const MAX_ENTRIES = 5000;
/** Files older than this aren't new. */
const RECENT_DAYS = 400;
const CHECK_EVERY_MS = 10 * 60 * 1000;

export interface InboxCandidate {
  /** The InboxFile id it would have. */
  key: string;
  where: InboxFile['where'];
  path: string;
  name: string;
  size: number;
  modified: number;
  /** The project's folder it's in, or for the shared inbox the project it seems to be for. */
  projectId?: string;
  /** Whether it was found in that project's folder (true) or only guessed from its name. */
  projectKnown: boolean;
  labName?: string;
  why: string;
  /** An earlier version of it was imported. */
  amended: boolean;
}

export type RootAccess = 'none' | 'granted' | 'prompt' | 'unsupported';

export interface InboxState {
  checking: boolean;
  checkedAt?: string;
  /** New lab files, newest first. */
  files: InboxCandidate[];
  /** Files looked at that aren't lab results. */
  others: number;
  /** The projects folder this browser was shown. */
  root: { name?: string; access: RootAccess };
  /** Projects whose folder couldn't be found in it. */
  missing: Array<{ projectId: string; path: string }>;
  /** Whether the workspace has an Inbox folder. */
  hasInbox: boolean;
  error?: string;
  /** Counts files handed to an import (so an import page already open takes them). */
  queued: number;
}

let state: InboxState = { checking: false, files: [], others: 0, root: { access: 'none' }, missing: [], hasInbox: false, queued: 0 };
const subs = new Set<() => void>();
const set = (patch: Partial<InboxState>) => {
  state = { ...state, ...patch };
  subs.forEach((f) => f());
};
export const getInboxState = () => state;
export function useInbox(): InboxState {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => state,
  );
}

export const inboxKey = (where: InboxFile['where'], path: string, size: number, modified: number) => `${where}|${path}|${size}|${modified}`;

// ------------------------------------------------------------ the projects folder (this browser's)

type Picker = (opts?: { id?: string; mode?: 'read' | 'readwrite'; startIn?: unknown }) => Promise<DirectoryHandle & ResolvingHandle>;
interface ResolvingHandle {
  resolve?(other: unknown): Promise<string[] | null>;
  queryPermission?(o: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission?(o: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
}
const picker = () => (globalThis as unknown as { showDirectoryPicker?: Picker }).showDirectoryPicker;

let root: (DirectoryHandle & ResolvingHandle) | null = null;

async function loadRoot(): Promise<void> {
  if (!picker()) return set({ root: { access: 'unsupported' } });
  const saved = (await db.syncLocal.get('projectsRoot'))?.value as (DirectoryHandle & ResolvingHandle) | undefined;
  if (!saved) return set({ root: { access: 'none' } });
  root = saved;
  const access = (await saved.queryPermission?.({ mode: 'read' })) ?? 'granted';
  set({ root: { name: saved.name, access: access === 'granted' ? 'granted' : 'prompt' } });
}

/** Show EnviroDB the folder the projects are kept in (each person once, in this browser). */
export async function connectProjectsRoot(): Promise<void> {
  const pick = picker();
  if (!pick) throw new Error('This browser can’t open folders – use Edge or Chrome on a computer.');
  const h = await pick({ id: 'envirodb-projects', mode: 'read' });
  root = h;
  await db.syncLocal.put({ key: 'projectsRoot', value: h }).catch(() => undefined); // kept if the browser can
  set({ root: { name: h.name, access: 'granted' } });
  void checkInbox();
}

/** After the browser restarts it asks again before EnviroDB can look in the projects folder (needs a click). */
export async function allowProjectsRoot(): Promise<void> {
  if (!root) return connectProjectsRoot();
  const p = (await root.requestPermission?.({ mode: 'read' })) ?? 'granted';
  set({ root: { name: root.name, access: p === 'granted' ? 'granted' : 'prompt' } });
  if (p === 'granted') void checkInbox();
}

/**
 * A project's lab folder, chosen in the projects folder: kept as its path inside it ("Clients/Kōwhai/Lab results"),
 * which everyone in the team can use from their own copy of the projects folder.
 */
export async function chooseProjectFolder(): Promise<string> {
  const pick = picker();
  if (!pick) throw new Error('This browser can’t open folders – use Edge or Chrome on a computer.');
  if (!root || state.root.access !== 'granted') throw new Error('Show EnviroDB your projects folder first.');
  const h = await pick({ id: 'envirodb-project-folder', mode: 'read', startIn: root });
  const parts = (await root.resolve?.(h)) ?? null;
  if (!parts) throw new Error(`“${h.name}” isn’t inside your projects folder (${root.name}). Choose a folder in it.`);
  return parts.join('/');
}

/**
 * Where to look for a project's lab files in the projects folder: its lab folder, or else its folder (the path on
 * the calendar) when that path runs through the projects folder – "G:\\Projects\\Clients\\Kōwhai" with a projects
 * folder called "Projects" gives "Clients/Kōwhai".
 */
export function projectFolderPath(p: Pick<Project, 'labFolder' | 'folder'>, rootName?: string): string | undefined {
  if (p.labFolder?.trim()) return p.labFolder.trim().replace(/^\/+|\/+$/g, '');
  if (!p.folder || !rootName || /^https?:/i.test(p.folder)) return undefined;
  const parts = p.folder.split(/[\\/]+/).filter(Boolean);
  const at = parts.findIndex((x) => x.toLowerCase() === rootName.toLowerCase());
  return at >= 0 && at < parts.length - 1 ? parts.slice(at + 1).join('/') : undefined;
}

// ------------------------------------------------------------ looking

interface Found {
  where: InboxFile['where'];
  path: string;
  file: File;
  projectId?: string;
}

async function walk(folder: WorkspaceFolder, dir: string, depth: number, out: Array<{ path: string; file: File }>, budget: { n: number }, since: number): Promise<void> {
  if (depth > MAX_DEPTH || budget.n <= 0) return;
  for (const e of await folder.list(dir)) {
    if (--budget.n <= 0) return;
    const path = dir ? `${dir}/${e.name}` : e.name;
    if (e.kind === 'directory') {
      if (!SKIP_DIR.test(e.name)) await walk(folder, path, depth + 1, out, budget, since);
    } else if (LAB_EXT.test(e.name) && !/^~\$|^\./.test(e.name)) {
      const file = await folder.file(path).catch(() => null);
      if (file && file.lastModified >= since) out.push({ path, file });
    }
  }
}

/** What a sniff found, by file version – each file is looked at once. */
const sniffed = new Map<string, Awaited<ReturnType<typeof sniffLabFile>>>();
/** Files to hand to the import, by key. */
const opened = new Map<string, File>();

/** Projects a file name mentions (its code, e.g. "DEMO-001"). */
function guessProject(name: string, projects: Project[]): string | undefined {
  const flat = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const hits = projects.filter((p) => p.code && p.code.replace(/[^a-z0-9]/gi, '').length >= 3 && flat.includes(p.code.toLowerCase().replace(/[^a-z0-9]/g, '')));
  return hits.length === 1 ? hits[0].id : undefined;
}

let running: Promise<void> | null = null;

/** Look in the inbox and the projects' folders for lab files not yet imported. */
export function checkInbox(): Promise<void> {
  running ??= look().finally(() => (running = null));
  return running;
}

async function look(): Promise<void> {
  set({ checking: true, error: undefined });
  try {
    if (state.root.access === 'none' && !root) await loadRoot();
    const projects = await db.projects.where('status').equals('active').toArray();
    const found = await findLabFiles({
      workspace: currentWorkspaceFolder(),
      root: root && state.root.access === 'granted' ? { name: root.name, folder: handleFolder(root) } : null,
      projects,
      done: await db.inbox.toArray(),
    });
    set({ ...found, checkedAt: new Date().toISOString() });
  } catch (e) {
    set({ error: (e as Error).message });
  } finally {
    set({ checking: false });
  }
}

export interface InboxSources {
  /** The workspace folder (its Inbox folder is looked in). */
  workspace: WorkspaceFolder | null;
  /** The projects folder, and its name (for projects whose folder path runs through it). */
  root: { name: string; folder: WorkspaceFolder } | null;
  projects: Project[];
  /** Files dealt with already. */
  done: InboxFile[];
  now?: number;
}

/** The lab files in the inbox and the projects' folders not yet imported or set aside. */
export async function findLabFiles(src: InboxSources): Promise<Pick<InboxState, 'files' | 'others' | 'missing' | 'hasInbox'>> {
  const since = (src.now ?? Date.now()) - RECENT_DAYS * 86400000;
  const found: Found[] = [];
  // the team's inbox, in the workspace folder
  let hasInbox = false;
  if (src.workspace) {
    const list: Array<{ path: string; file: File }> = [];
    hasInbox = (await src.workspace.list('')).some((e) => e.kind === 'directory' && e.name === INBOX_DIR);
    if (hasInbox) await walk(src.workspace, INBOX_DIR, 0, list, { n: MAX_ENTRIES }, 0);
    found.push(...list.map((x) => ({ where: 'inbox' as const, ...x })));
  }
  // each project's folder, in the projects folder
  const missing: InboxState['missing'] = [];
  if (src.root) {
    for (const p of src.projects) {
      const path = projectFolderPath(p, src.root.name);
      if (!path) continue;
      const list: Array<{ path: string; file: File }> = [];
      try {
        const top = path.split('/').slice(0, -1).join('/');
        const name = path.split('/').pop()!;
        if (!(await src.root.folder.list(top)).some((e) => e.kind === 'directory' && e.name === name)) {
          missing.push({ projectId: p.id, path });
          continue;
        }
        await walk(src.root.folder, path, 0, list, { n: MAX_ENTRIES }, since);
      } catch {
        missing.push({ projectId: p.id, path });
        continue;
      }
      found.push(...list.map((x) => ({ where: 'project' as const, projectId: p.id, ...x })));
    }
  }
  // what's been dealt with already
  const doneIds = new Set(src.done.map((d) => d.id));
  const importedPaths = new Set(src.done.filter((d) => d.status === 'imported').map((d) => `${d.where}|${d.path}`));
  const files: InboxCandidate[] = [];
  let others = 0;
  const seen = new Set<string>();
  for (const f of found) {
    const key = inboxKey(f.where, f.path, f.file.size, f.file.lastModified);
    if (doneIds.has(key) || seen.has(key)) continue;
    seen.add(key);
    let s = sniffed.get(key);
    if (!s) {
      s = await sniffLabFile(f.file, f.path).catch(() => ({ lab: false, why: 'could not be read' }));
      sniffed.set(key, s);
    }
    if (!s.lab) {
      others++;
      continue;
    }
    opened.set(key, f.file);
    files.push({
      key,
      where: f.where,
      path: f.path,
      name: f.file.name,
      size: f.file.size,
      modified: f.file.lastModified,
      projectId: f.projectId ?? (s.field?.projectId && src.projects.some((p) => p.id === s.field!.projectId) ? s.field.projectId : undefined) ?? guessProject(f.file.name, src.projects),
      projectKnown: !!f.projectId || !!(s.field?.projectId && src.projects.some((p) => p.id === s.field!.projectId)),
      labName: s.labName,
      why: s.why,
      amended: importedPaths.has(`${f.where}|${f.path}`),
    });
  }
  files.sort((a, b) => b.modified - a.modified);
  return { files, others, missing, hasInbox };
}

/** The files themselves, to import. */
export function inboxFiles(list: InboxCandidate[]): File[] {
  return list.map((c) => opened.get(c.key)).filter(Boolean) as File[];
}

async function record(list: InboxCandidate[], patch: Pick<InboxFile, 'status'> & Partial<InboxFile>): Promise<void> {
  const by = (await getSettings()).author || undefined;
  const at = new Date().toISOString();
  await db.inbox.bulkPut(list.map((c) => ({ id: c.key, where: c.where, path: c.path, name: c.name, size: c.size, modified: c.modified, projectId: patch.projectId ?? c.projectId, by, at, ...patch })));
  set({ files: state.files.filter((f) => !list.some((c) => c.key === f.key)) });
}

/** Set aside: not lab results to import. */
export const dismissInboxFiles = (list: InboxCandidate[]) => record(list, { status: 'dismissed' });

/** Imported into a project. */
export const markInboxImported = (list: InboxCandidate[], projectId: string, importId: string) => record(list, { status: 'imported', projectId, importId });

// ------------------------------------------------------------ handing files to the import

let pending: { projectId: string; files: File[]; from: InboxCandidate[] } | null = null;

/** Files from the inbox for a project's import (taken by the import page as it opens). */
export function queueInboxImport(projectId: string, from: InboxCandidate[]): void {
  pending = { projectId, files: inboxFiles(from), from };
  set({ queued: state.queued + 1 });
}

export function takeInboxImport(projectId: string): { files: File[]; from: InboxCandidate[] } | null {
  if (!pending || pending.projectId !== projectId) return null;
  const p = pending;
  pending = null;
  return p;
}

// ------------------------------------------------------------ keeping an eye on it

let started = false;

/** Look now and then while the workspace is connected (and when coming back to the tab). */
export function startInboxWatch(): void {
  if (started) return;
  started = true;
  let last = 0;
  const tick = () => {
    if (getWorkspaceState().phase !== 'ready' || Date.now() - last < 60000) return;
    last = Date.now();
    void checkInbox();
  };
  void loadRoot().then(() => setTimeout(tick, 4000));
  setInterval(tick, CHECK_EVERY_MS);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && Date.now() - last > 5 * 60000 && tick());
}
