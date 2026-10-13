// Folding colleagues' changes into this browser's copy. Every field keeps the value with the latest stamp, so two
// people changing different fields of the same record both keep their change, and when they change the same field
// the later change wins everywhere – whatever order the files arrive in. A deletion removes what was there before
// it; a change made after it brings the record back.

import type { Dexie } from 'dexie';
import { markUncaptured } from './capture';
import { observe, stampClient, stampMs } from './hlc';
import { fieldsOf, latestFieldStamp, recordFrom, rowKey, same, segmentOf, type Change, type SyncRow } from './model';

interface State {
  f: Record<string, string>;
  /** Field → the change it replaced (see SyncRow.b). */
  b?: Record<string, string>;
  c?: string;
  d?: string;
  v: Record<string, unknown>;
}

const later = (a: string | undefined, b: string | undefined) => (a && b ? (a > b ? a : b) : a ?? b);

/** Merge two versions of a record. Ties keep `a` (the same stamp is the same change). */
export function mergeStates(a: State, b: State): State {
  const c = later(a.c, b.c);
  const d = later(a.d, b.d);
  // deleted after it was (last) made: nothing of it lives on, including changes made to it meanwhile
  if (d && (!c || d > c)) return { f: {}, c, d, v: {} };
  const f: Record<string, string> = {};
  const v: Record<string, unknown> = {};
  const bases: Record<string, string> = {};
  for (const n of new Set([...Object.keys(a.f), ...Object.keys(a.v), ...Object.keys(b.f), ...Object.keys(b.v)])) {
    // a field without a stamp (data from before the workspace) is older than any stamped change
    const sa = a.f[n] ?? (n in a.v ? '' : undefined);
    const sb = b.f[n] ?? (n in b.v ? '' : undefined);
    const fromB = sb !== undefined && (sa === undefined || sb > sa);
    const s = fromB ? sb : sa;
    const src = fromB ? b : a;
    // made again after a deletion: what it had before the deletion has gone
    if (d && (s ?? '') < d) continue;
    if (s) f[n] = s;
    if (n in src.v) v[n] = src.v[n];
    if (src.b?.[n]) bases[n] = src.b[n];
  }
  return Object.keys(bases).length ? { f, b: bases, c, d, v } : { f, c, d, v };
}

export interface RemoteChange {
  t: string;
  k: string;
  /** Client whose change it was (the latest stamp). */
  by: string;
  action: 'added' | 'changed' | 'deleted';
  rec: Record<string, unknown> | null;
}

export interface Conflict {
  t: string;
  k: string;
  by: string;
  /** Fields of this person's recent change that a colleague's later change replaced (empty when they deleted it). */
  fields: string[];
  deleted: boolean;
  rec: Record<string, unknown> | null;
}

export interface MergeOutcome {
  changes: RemoteChange[];
  conflicts: Conflict[];
}

function push<T>(map: Map<string, T[]>, key: string, item: T): void {
  const list = map.get(key);
  if (list) list.push(item);
  else map.set(key, [item]);
}

/** Fields kept up to date by the app itself rather than by anyone: never worth a notice. */
const BOOKKEEPING = new Set(['updatedAt', 'createdAt']);

/** How recent this person's change must be for a colleague's later change to it to be pointed out. */
export const CONFLICT_WINDOW_MS = 15 * 60000;

/**
 * Apply changes read from colleagues' files to the local database, in one transaction.
 * `me` is this client's id (to spot this person's own recent changes being replaced).
 */
export async function applyChanges(database: Dexie, incoming: Change[], me: string, now = Date.now()): Promise<MergeOutcome> {
  const out: MergeOutcome = { changes: [], conflicts: [] };
  if (!incoming.length) return out;
  // several files can hold the same record: fold them first
  const byKey = new Map<string, { t: string; k: string; st: State }>();
  for (const c of incoming) {
    const tk = rowKey(c.t, c.k);
    const st: State = { f: c.f, b: c.b, c: c.c, d: c.d, v: c.rec ? fieldsOf(c.t, c.rec) : {} };
    const cur = byKey.get(tk);
    byKey.set(tk, { t: c.t, k: c.k, st: cur ? mergeStates(cur.st, st) : st });
    observe(later(later(c.c, c.d), latestFieldStamp(c.f)));
  }
  const tables = [...new Set([...byKey.values()].map((x) => x.t))];
  await database.transaction('rw', [...tables.map((t) => database.table(t)), database.table('syncState')], async (tx) => {
    markUncaptured(tx.idbtrans);
    const tks = [...byKey.keys()];
    const rows = (await database.table('syncState').bulkGet(tks)) as Array<SyncRow | undefined>;
    const localByTable = new Map<string, Map<string, Record<string, unknown> | undefined>>();
    for (const t of tables) {
      const keys = [...byKey.values()].filter((x) => x.t === t).map((x) => x.k);
      const recs = (await database.table(t).bulkGet(keys)) as Array<Record<string, unknown> | undefined>;
      localByTable.set(t, new Map(keys.map((k, i) => [k, recs[i]])));
    }
    const puts = new Map<string, Record<string, unknown>[]>();
    const dels = new Map<string, string[]>();
    const rowPuts: SyncRow[] = [];
    tks.forEach((tk, i) => {
      const { t, k, st: remote } = byKey.get(tk)!;
      const row = rows[i];
      const localRec = localByTable.get(t)!.get(k);
      const local: State = { f: row?.f ?? {}, b: row?.b, c: row?.c, d: row?.d, v: localRec ? fieldsOf(t, localRec) : {} };
      const merged = mergeStates(local, remote);
      const alive = Object.keys(merged.v).length > 0;
      const nextRec = alive ? recordFrom(t, k, merged.v) : null;
      const recChanged = alive ? !localRec || !same(nextRec, localRec) : !!localRec;
      // this person's recent change deleted, or replaced by a colleague who hadn't seen it (their change replaced an older one)
      const replaced = Object.keys(local.f).filter((n) => {
        if (BOOKKEEPING.has(n)) return false;
        const mine = local.f[n];
        if (stampClient(mine) !== me || now - stampMs(mine) >= CONFLICT_WINDOW_MS || merged.f[n] === mine || same(local.v[n], merged.v[n])) return false;
        return !alive || (merged.b?.[n] ?? '') < mine;
      });
      if (replaced.length) {
        const winner = alive ? replaced.map((n) => merged.f[n]).filter(Boolean).sort().pop() : merged.d;
        out.conflicts.push({ t, k, by: winner ? stampClient(winner) : '', fields: alive ? replaced : [], deleted: !alive, rec: nextRec ?? localRec ?? null });
      }
      if (recChanged) {
        if (nextRec) push(puts, t, nextRec);
        else push(dels, t, k);
        const latest = alive ? latestFieldStamp(merged.f) : merged.d ?? '';
        out.changes.push({ t, k, by: latest ? stampClient(latest) : '', action: !alive ? 'deleted' : localRec ? 'changed' : 'added', rec: nextRec ?? localRec ?? null });
      }
      const stamps = [...Object.values(merged.f), merged.c ?? '', merged.d ?? ''];
      const nextRow: SyncRow = {
        tk,
        t,
        k,
        s: nextRec ? segmentOf(t, nextRec) : row?.s ?? (localRec ? segmentOf(t, localRec) : ''),
        f: merged.f,
        mine: stamps.some((s) => s && stampClient(s) === me) ? 1 : 0,
      };
      if (merged.b) nextRow.b = merged.b;
      if (merged.c) nextRow.c = merged.c;
      if (merged.d) nextRow.d = merged.d;
      if (!row || !same(row, nextRow)) rowPuts.push(nextRow);
    });
    for (const [t, list] of puts) await database.table(t).bulkPut(list);
    for (const [t, keys] of dels) await database.table(t).bulkDelete(keys);
    if (rowPuts.length) await database.table('syncState').bulkPut(rowPuts);
  });
  return out;
}
