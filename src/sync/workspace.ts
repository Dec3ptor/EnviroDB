// Keeps this browser connected to the workspace folder: the checks at start-up, connecting (or creating) a
// workspace, reading and writing changes every few seconds, who's connected, and what the screens show about it.
// Only one EnviroDB tab in a browser does the reading and writing; the others see its work through the database.

import { useSyncExternalStore } from 'react';
import { db } from '../db/db';
import { exportWorkspace } from '../db/backup';
import { todayStr } from '../lib/dates';
import { onLocalChange } from './capture';
import { setClockClient } from './hlc';
import { handleFolder, isNoPermission, isNotFound, type DirectoryHandle, type WorkspaceFolder } from './folder';
import {
  adoptLocalData, clearLocalCopy, createWorkspaceFile, dailySnapshot, flush, localData, pendingSegments, pull, readPeople, readWorkspaceFile, repairOwnFiles, writePresence,
  type Person, type SyncContext,
} from './engine';
import type { Conflict, RemoteChange } from './merge';
import { WORKSPACE_FILE, type WorkspaceFile } from './model';

export type WorkspacePhase =
  | 'starting'
  | 'unsupported' // no folder access in this browser
  | 'setup' // no folder chosen
  | 'reconnect' // the folder needs a click to allow access again
  | 'connecting'
  | 'create' // the folder is not a workspace yet
  | 'choose' // this browser holds data the workspace doesn't
  | 'ready'
  | 'offline'; // the folder can't be reached: the app waits

export interface WorkspaceChoice {
  kind: 'adopt' | 'switch';
  projects: number;
  records: number;
  /** switch: the workspace this browser held. */
  from?: { id: string; name: string };
  /** Changes made here that never reached that workspace. */
  unsaved: number;
}

export interface WorkspaceState {
  phase: WorkspacePhase;
  folderName?: string;
  workspace?: WorkspaceFile;
  myId: string;
  myName: string;
  people: Person[];
  /** What connecting is doing. */
  detail?: string;
  error?: string;
  /** create: the folder has nothing in it. */
  emptyFolder?: boolean;
  choice?: WorkspaceChoice;
  lastSync?: number;
  /** Files of changes made here still to be written to the folder. */
  pending: number;
  /** Another EnviroDB tab in this browser is doing the reading and writing. */
  follower?: boolean;
  /** A colleague's EnviroDB is newer: reloading the page updates this one. */
  newerApp?: boolean;
}

let state: WorkspaceState = { phase: 'starting', myId: '', myName: '', people: [], pending: 0 };
const subscribers = new Set<() => void>();

function set(patch: Partial<WorkspaceState>): void {
  state = { ...state, ...patch };
  subscribers.forEach((f) => f());
}

export const getWorkspaceState = () => state;

export function useWorkspace(): WorkspaceState {
  return useSyncExternalStore(
    (f) => {
      subscribers.add(f);
      return () => subscribers.delete(f);
    },
    () => state,
  );
}

// ------------------------------------------------------------ colleagues' changes, for the notices

export interface RemoteUpdate {
  changes: RemoteChange[];
  conflicts: Conflict[];
  /** Client id → name. */
  names: Map<string, string>;
}

const updateSubscribers = new Set<(u: RemoteUpdate) => void>();

export function onRemoteUpdate(fn: (u: RemoteUpdate) => void): () => void {
  updateSubscribers.add(fn);
  return () => updateSubscribers.delete(fn);
}

// ------------------------------------------------------------ this browser's details

async function local<T>(key: string): Promise<T | undefined> {
  return (await db.syncLocal.get(key))?.value as T | undefined;
}

async function setLocal(key: string, value: unknown): Promise<void> {
  if (value === undefined) await db.syncLocal.delete(key);
  else await db.syncLocal.put({ key, value });
}

async function clientId(): Promise<string> {
  let id = await local<string>('client');
  if (!id) {
    const random = globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 12) ?? Math.random().toString(36).slice(2, 14);
    id = `c${random}`;
    await setLocal('client', id);
  }
  return id;
}

type Picker = (opts?: { id?: string; mode?: 'read' | 'readwrite' }) => Promise<DirectoryHandle>;
const picker = () => (globalThis as unknown as { showDirectoryPicker?: Picker }).showDirectoryPicker;

/** Whether this browser can work with a folder (Edge and Chrome on a computer can). */
export const workspaceSupported = () => typeof picker() === 'function';

// ------------------------------------------------------------ connecting

let handle: DirectoryHandle | null = null;
let candidate: { folder: WorkspaceFolder; ws?: WorkspaceFile } | null = null;
let ctx: SyncContext | null = null;

/** At start-up: connect again to the folder used last time, or say what is needed. */
export async function startWorkspace(): Promise<void> {
  const myId = await clientId();
  setClockClient(myId);
  set({ myId, myName: (await local<string>('name')) ?? '' });
  if (!workspaceSupported()) return set({ phase: 'unsupported' });
  const saved = await local<DirectoryHandle>('handle');
  if (!saved) return set({ phase: 'setup' });
  handle = saved;
  const folder = handleFolder(saved);
  const perm = await folder.permission(false).catch(() => 'prompt' as PermissionState);
  if (perm === 'granted') return open(folder);
  set({ phase: 'reconnect', folderName: saved.name, workspace: await local<WorkspaceFile>('workspaceFile') });
}

export async function setMyName(name: string): Promise<void> {
  const myName = name.trim();
  await setLocal('name', myName);
  set({ myName });
  if (ctx && leader) await writePresence(ctx, myName).catch(() => undefined);
}

/** Choose the workspace folder (a button: the browser shows its folder picker). */
export async function chooseFolder(): Promise<void> {
  const pick = picker();
  if (!pick) return;
  let h: DirectoryHandle;
  try {
    h = await pick({ id: 'envirodb-workspace', mode: 'readwrite' });
  } catch (e) {
    if ((e as Error).name === 'AbortError') return;
    set({ error: (e as Error).message });
    return;
  }
  handle = h;
  await open(handleFolder(h));
}

/** Allow access to the folder used last time (a button: the browser may ask). */
export async function reconnect(): Promise<void> {
  if (!handle) return set({ phase: 'setup' });
  const folder = handleFolder(handle);
  const perm = await folder.permission(true).catch(() => 'denied' as PermissionState);
  if (perm === 'granted') await open(folder);
  else set({ phase: 'reconnect', folderName: handle.name, error: 'The browser was not allowed to use the folder.' });
}

/** Try again after a problem. */
export async function retry(): Promise<void> {
  if (ctx) {
    schedule(0);
    return;
  }
  if (candidate) await open(candidate.folder);
  else if (handle) await open(handleFolder(handle));
  else set({ phase: 'setup' });
}

async function open(folder: WorkspaceFolder): Promise<void> {
  stopLoops();
  ctx = null;
  set({ phase: 'connecting', folderName: folder.name, detail: 'Opening the folder…', error: undefined, choice: undefined });
  try {
    const ws = await readWorkspaceFile(folder);
    if (!ws) {
      candidate = { folder };
      const entries = (await folder.list('')).filter((e) => !e.name.startsWith('.') && e.name.toLowerCase() !== 'desktop.ini');
      return set({ phase: 'create', emptyFolder: entries.length === 0 });
    }
    await decide(folder, ws);
  } catch (e) {
    failed(e, folder);
  }
}

/** Make the chosen folder a new workspace. */
export async function createWorkspace(name: string): Promise<void> {
  if (!candidate) return;
  const { folder } = candidate;
  set({ phase: 'connecting', detail: 'Creating the workspace…', error: undefined });
  try {
    await decide(folder, await createWorkspaceFile(folder, name, state.myName));
  } catch (e) {
    failed(e, folder);
  }
}

async function decide(folder: WorkspaceFolder, ws: WorkspaceFile): Promise<void> {
  const linked = await local<{ id: string; name: string }>('workspace');
  if (linked?.id === ws.id) return connect(folder, ws);
  const data = await localData(db);
  if (linked || data.records > 0) {
    candidate = { folder, ws };
    const choice: WorkspaceChoice = linked ? { kind: 'switch', ...data, from: linked, unsaved: await pendingSegments(db) } : { kind: 'adopt', ...data, unsaved: 0 };
    return set({ phase: 'choose', workspace: ws, choice });
  }
  return connect(folder, ws);
}

/**
 * What to do with what this browser holds that the workspace doesn't: add it to the workspace, or remove it from
 * this browser (switching workspaces always removes the old one's copy – it stays in its own folder).
 */
export async function resolveChoice(decision: 'add' | 'remove' | 'cancel'): Promise<void> {
  const c = candidate;
  if (decision === 'cancel' || !c?.ws) {
    candidate = null;
    return set({ phase: 'setup', choice: undefined, workspace: undefined });
  }
  set({ phase: 'connecting', detail: decision === 'add' ? 'Adding this browser’s projects to the workspace…' : 'Clearing this browser’s copy…', choice: undefined });
  try {
    if (decision === 'add') await adoptLocalData(db);
    else await clearLocalCopy(db);
    await connect(c.folder, c.ws!);
  } catch (e) {
    failed(e, c.folder);
  }
}

async function connect(folder: WorkspaceFolder, ws: WorkspaceFile): Promise<void> {
  candidate = { folder, ws };
  if (handle) await setLocal('handle', handle).catch(() => undefined); // a folder the browser can't keep is asked for next time
  await setLocal('workspace', { id: ws.id, name: ws.name });
  await setLocal('workspaceFile', ws);
  const c: SyncContext = { db, folder, clientId: state.myId, workspace: ws };
  set({ phase: 'connecting', workspace: ws, folderName: folder.name, detail: 'Reading the workspace…' });
  const res = await pull(c, { onProgress: (done, total) => total > 3 && set({ detail: `Reading colleagues’ changes – ${done} of ${total} files…` }) });
  await repairOwnFiles(c);
  await flush(c);
  await writePresence(c, state.myName);
  lastPresence = Date.now();
  ctx = c;
  candidate = null;
  set({ phase: 'ready', people: await readPeople(c), lastSync: Date.now(), pending: await pendingSegments(db), error: undefined, detail: undefined, newerApp: res.newer });
  startLoops();
}

function describe(e: unknown): string {
  const err = e as Error;
  if (isNotFound(e)) return err.message?.includes('workspace file') ? err.message : 'The folder can’t be found – it may have been moved, renamed or deleted, or the drive is not connected.';
  return err?.message || String(e);
}

function failed(e: unknown, folder: WorkspaceFolder): void {
  candidate = candidate ?? { folder };
  if (isNoPermission(e)) set({ phase: 'reconnect', error: 'The browser needs your permission again to use the folder.' });
  else set({ phase: 'offline', error: describe(e) });
}

/** Stop using the folder (this browser keeps its copy until another folder is chosen). */
export function useAnotherFolder(): void {
  stopLoops();
  ctx = null;
  candidate = null;
  set({ phase: 'setup', error: undefined, people: [] });
}

/** Remove this browser's copy and forget the workspace (it stays as it is in the folder). */
export async function leaveWorkspace(): Promise<void> {
  stopLoops();
  ctx = null;
  candidate = null;
  handle = null;
  await clearLocalCopy(db);
  for (const k of ['workspace', 'workspaceFile', 'handle']) await setLocal(k, undefined);
  set({ phase: 'setup', workspace: undefined, folderName: undefined, people: [], pending: 0 });
}

// ------------------------------------------------------------ keeping in step

let timer: ReturnType<typeof setTimeout> | undefined;
let stopped = true;
let leader = false;
let release: (() => void) | null = null;
let lockAbort: AbortController | null = null;
let working = false;
let failures = 0;
let dirtySince = 0;
let lastFull = Date.now();
let lastPresence = 0;
let lastSnapshot = 0;

const FAST = 4000;
const HIDDEN = 30000;
const OFFLINE = 10000;
const FLUSH_DELAY = 1200;
const FLUSH_MAX_WAIT = 8000;

const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('envirodb-workspace') : null;
channel?.addEventListener('message', (e) => {
  if (e.data === 'changed' && leader) scheduleFlush();
});

onLocalChange(() => {
  if (leader) scheduleFlush();
  else channel?.postMessage('changed');
});

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => !document.hidden && leader && schedule(0));
  window.addEventListener('focus', () => leader && schedule(0));
}

function schedule(delay: number): void {
  if (stopped) return;
  clearTimeout(timer);
  timer = setTimeout(() => void work(), delay);
}

function scheduleFlush(): void {
  const now = Date.now();
  if (!dirtySince) dirtySince = now;
  set({ pending: Math.max(1, state.pending) });
  schedule(Math.max(0, Math.min(FLUSH_DELAY, dirtySince + FLUSH_MAX_WAIT - now)));
}

function startLoops(): void {
  stopLoops();
  stopped = false;
  const run = async () => {
    if (stopped) return;
    leader = true;
    set({ follower: false });
    schedule(0);
    await new Promise<void>((resolve) => (release = resolve));
    leader = false;
  };
  const locks = (globalThis.navigator as Navigator | undefined)?.locks;
  if (locks?.request) {
    lockAbort = new AbortController();
    set({ follower: true });
    locks.request('envirodb-workspace', { signal: lockAbort.signal }, run).catch(() => undefined);
  } else void run();
}

function stopLoops(): void {
  stopped = true;
  clearTimeout(timer);
  lockAbort?.abort();
  lockAbort = null;
  release?.();
  release = null;
  leader = false;
}

/** Read and write now. */
export function syncNow(): void {
  schedule(0);
}

async function work(): Promise<void> {
  const c = ctx;
  if (stopped || !leader || !c || working) return;
  working = true;
  dirtySince = 0;
  try {
    if (!(await c.folder.info(WORKSPACE_FILE))) {
      throw Object.assign(new Error('The workspace file has gone from the folder – it may have been moved, renamed or deleted.'), { name: 'NotFoundError' });
    }
    await flush(c);
    const full = Date.now() - lastFull > 10 * 60000;
    const res = await pull(c, { full });
    if (full) lastFull = Date.now();
    if (Date.now() - lastPresence > 5 * 60000) {
      await writePresence(c, state.myName);
      lastPresence = Date.now();
    }
    const people = await readPeople(c);
    if (Date.now() - lastSnapshot > 60 * 60000) {
      lastSnapshot = Date.now();
      await dailySnapshot(c, todayStr(), exportWorkspace).catch(() => undefined);
    }
    failures = 0;
    set({ phase: 'ready', people, lastSync: Date.now(), pending: await pendingSegments(db), error: undefined, newerApp: state.newerApp || res.newer });
    if (res.changes.length || res.conflicts.length) {
      const names = new Map(people.map((p) => [p.id, p.name]));
      updateSubscribers.forEach((f) => f({ changes: res.changes, conflicts: res.conflicts, names }));
    }
  } catch (e) {
    if (isNoPermission(e)) {
      stopLoops();
      set({ phase: 'reconnect', error: 'The browser needs your permission again to use the folder.' });
    } else if (++failures >= 2 || isNotFound(e)) set({ phase: 'offline', error: describe(e) });
  } finally {
    working = false;
  }
  const hidden = typeof document !== 'undefined' && document.hidden;
  if (!stopped) schedule(state.phase === 'offline' ? OFFLINE : state.pending ? FLUSH_DELAY : hidden ? HIDDEN : FAST);
}
