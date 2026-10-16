// What is shared through a workspace folder, and how a record is split into fields that merge separately.

/** Tables shared with everyone in the workspace. */
export const SHARED_TABLES = [
  'projects', 'sites', 'parameters', 'samples', 'results', 'guidelineSets', 'rules', 'notes', 'schedules', 'obligations', 'imports', 'templates', 'meta',
] as const;
export type SharedTable = (typeof SHARED_TABLES)[number];
export const SHARED = new Set<string>(SHARED_TABLES);

/** Kept with each change: which fields changed when (and by whom, through the stamp), and when it was deleted. */
export const SYNC_TABLES = ['syncState', 'syncDirty'] as const;

/**
 * Meta records shared with the workspace: the team settings. The rest – report work (commentary, figures, layout
 * changes, site choices) included – stays in this browser: each person makes their own reports.
 */
export const SHARED_META = /^settings$/;

export function isSharedRecord(table: string, key: unknown): boolean {
  return SHARED.has(table) && (table !== 'meta' || (typeof key === 'string' && SHARED_META.test(key)));
}

/** Sync state of one record. */
export interface SyncRow {
  /** `${table}\u0001${key}` */
  tk: string;
  t: string;
  k: string;
  /** Segment (file) the record is written to. */
  s: string;
  /** Field → stamp of its last change. A field with a stamp but no value in the record was removed then. */
  f: Record<string, string>;
  /** For fields changed here: the colleague's change each one replaced – to tell knowingly replacing a change from not having seen it. */
  b?: Record<string, string>;
  /** When it was made (again): a record deleted after that stays deleted, whatever changes were made to it meanwhile. */
  c?: string;
  /** Stamp of its deletion: it is deleted when this is later than when it was made. */
  d?: string;
  /** 1 when a stamp is this client's: the record is written to this client's file. */
  mine: 0 | 1;
}

/** A segment with changes not yet written to this client's file; v is the stamp of the latest. */
export interface DirtySegment {
  s: string;
  v: string;
}

export const rowKey = (table: string, key: string) => `${table}\u0001${key}`;

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

/** The file a record is written to: one per kind of record for each project, results by year. */
export function segmentOf(table: string, rec: Record<string, unknown>): string {
  switch (table) {
    case 'projects':
    case 'parameters':
    case 'templates':
      return table;
    case 'guidelineSets':
      return 'guidelines';
    case 'samples':
    case 'results':
      return `data.${rec.projectId}.${String(rec.date ?? '').slice(0, 4) || 'undated'}`;
    case 'meta': {
      const key = String(rec.key);
      if (key === 'settings') return 'settings';
      const [kind, projectId] = key.split(':');
      return `${kind === 'figs' ? 'figures' : 'report'}.${projectId}`;
    }
    default:
      return `project.${rec.projectId}`;
  }
}

/**
 * A record as separately mergeable fields: its top-level properties, or for team settings and report work the
 * entries of the value (one per report section, setting …) so two people can change different ones at once.
 */
export function fieldsOf(table: string, rec: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (table === 'meta') {
    const v = rec.value;
    if (isPlainObject(v)) for (const [k, x] of Object.entries(v)) if (x !== undefined) out[`.${k}`] = x;
    else if (v !== undefined) out.value = v;
    return out;
  }
  for (const [k, x] of Object.entries(rec)) if (k !== 'id' && x !== undefined) out[k] = x;
  return out;
}

/** Inverse of fieldsOf. */
export function recordFrom(table: string, key: string, fields: Record<string, unknown>): Record<string, unknown> {
  if (table === 'meta') {
    const names = Object.keys(fields);
    if ('value' in fields && !names.some((n) => n.startsWith('.'))) return { key, value: fields.value };
    const value: Record<string, unknown> = {};
    for (const n of names) if (n.startsWith('.')) value[n.slice(1)] = fields[n];
    return { key, value };
  }
  return { id: key, ...fields };
}

export function primaryKeyName(table: string): string {
  return table === 'meta' ? 'key' : 'id';
}

/** Deep equality of stored values (plain objects, arrays, strings, numbers …). */
export function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return Number.isNaN(a) && Number.isNaN(b);
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((x, i) => same(x, bb[i]));
  }
  const ao = a as Record<string, unknown>, bo = b as Record<string, unknown>;
  const ak = Object.keys(ao).filter((k) => ao[k] !== undefined), bk = Object.keys(bo).filter((k) => bo[k] !== undefined);
  return ak.length === bk.length && ak.every((k) => same(ao[k], bo[k]));
}

/** Latest stamp among a row's fields. */
export function latestFieldStamp(f: Record<string, string>): string {
  let m = '';
  for (const s of Object.values(f)) if (s > m) m = s;
  return m;
}

export function isDeleted(row: Pick<SyncRow, 'c' | 'd'>): boolean {
  return !!row.d && (!row.c || row.d > row.c);
}

// ------------------------------------------------------------ files

export const FILE_APP = 'EnviroDB';
export const FILE_FORMAT = 1;

/**
 * One record in a client's file: table, key, field stamps (one stamp when all are the same), deletion stamp, record,
 * creation stamp, and (when there are any) the colleagues' changes its fields replaced.
 */
export type FileEntry =
  | [string, string, string | Record<string, string>, string | 0, Record<string, unknown> | null, string | 0]
  | [string, string, string | Record<string, string>, string | 0, Record<string, unknown> | null, string | 0, Record<string, string>];

export interface ChangesFile {
  app: typeof FILE_APP;
  kind: 'changes';
  format: number;
  workspace: string;
  client: string;
  segment: string;
  written: string;
  entries: FileEntry[];
}

export interface ClientFile {
  app: typeof FILE_APP;
  kind: 'client';
  format: number;
  workspace: string;
  id: string;
  name: string;
  lastSeen: string;
}

export interface WorkspaceFile {
  app: typeof FILE_APP;
  kind: 'workspace';
  format: number;
  id: string;
  name: string;
  createdAt: string;
  createdBy: string;
}

export const WORKSPACE_FILE = 'envirodb-workspace.json';
export const CLIENTS_DIR = 'clients';
export const BACKUPS_DIR = 'backups';

export function encodeEntry(row: SyncRow, rec: Record<string, unknown> | undefined): FileEntry {
  const deleted = isDeleted(row) || !rec;
  const stamps = Object.values(row.f);
  // one stamp for the lot when every field of the record has it (and no removed field has a stamp of its own)
  const names = rec && !deleted ? Object.keys(fieldsOf(row.t, rec)) : [];
  const uniform = stamps.length > 0 && stamps.length === names.length && stamps.every((s) => s === stamps[0]) && names.every((n) => n in row.f);
  const entry: FileEntry = [row.t, row.k, uniform ? stamps[0] : row.f, row.d ?? 0, deleted ? null : rec!, row.c ?? 0];
  return row.b && Object.keys(row.b).length && !deleted ? [...entry, row.b] : entry;
}

export interface Change {
  t: string;
  k: string;
  f: Record<string, string>;
  b?: Record<string, string>;
  c?: string;
  d?: string;
  rec: Record<string, unknown> | null;
}

/** Reads an entry back; null when it is not one. */
export function decodeEntry(e: unknown): Change | null {
  if (!Array.isArray(e) || e.length < 5) return null;
  const [t, k, f, d, rec, c, b] = e as [string, string, unknown, unknown, Record<string, unknown> | null, unknown, unknown];
  if (typeof t !== 'string' || !isSharedRecord(t, k) || typeof k !== 'string') return null;
  if (rec !== null && !isPlainObject(rec)) return null;
  let stamps: Record<string, string> = {};
  if (typeof f === 'string') {
    if (rec) for (const n of Object.keys(fieldsOf(t, rec))) stamps[n] = f;
  } else if (isPlainObject(f)) stamps = Object.fromEntries(Object.entries(f).filter(([, s]) => typeof s === 'string')) as Record<string, string>;
  else return null;
  const bases = isPlainObject(b) ? (Object.fromEntries(Object.entries(b).filter(([, x]) => typeof x === 'string')) as Record<string, string>) : undefined;
  return { t, k, f: stamps, b: bases, c: typeof c === 'string' && c ? c : undefined, d: typeof d === 'string' && d ? d : undefined, rec };
}
