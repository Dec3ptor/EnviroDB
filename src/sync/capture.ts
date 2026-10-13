// Records every change made in this browser to shared data, field by field, in the same database transaction as
// the change itself – so nothing can be saved without the workspace learning about it, whichever screen saved it.
// Implemented as a Dexie DBCore middleware: it sits above Dexie's own layers, so live queries still see the writes.

import type { DBCore, DBCoreTransaction, Middleware } from 'dexie';
import { clockClient, stamp, stampClient } from './hlc';
import { fieldsOf, isSharedRecord, rowKey, same, segmentOf, SHARED, type DirtySegment, type SyncRow } from './model';

const UNCAPTURED = '__envUncaptured';

/**
 * Marks a transaction whose writes are not changes by the person using this browser: built-in reference data,
 * changes read from colleagues' files, or clearing this browser's copy. Pass Dexie's `tx.idbtrans`.
 */
export function markUncaptured(idbtrans: unknown): void {
  (idbtrans as Record<string, boolean>)[UNCAPTURED] = true;
}

type Listener = (segments: string[]) => void;
const listeners = new Set<Listener>();

/** Called after a transaction with changes to shared data has been saved, with the segments it touched. */
export function onLocalChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function afterCommit(trans: DBCoreTransaction, fn: () => void): void {
  const t = trans as unknown as { addEventListener?: IDBTransaction['addEventListener'] };
  if (typeof t.addEventListener === 'function') t.addEventListener('complete', fn);
  else fn();
}

/**
 * Writes the sync state of the records a request changed. Dexie keeps track of the transaction through its own
 * promises, so this (and the middleware) chains them with then() – an await of a plain promise here would lose it.
 */
function record(down: DBCore, trans: DBCoreTransaction, table: string, keys: unknown[], before: unknown[], after: readonly unknown[] | null, take: boolean[]): PromiseLike<void> | void {
  const state = down.table('syncState');
  const idx = keys.map((_, i) => i).filter((i) => take[i]);
  if (!idx.length) return;
  const tks = idx.map((i) => rowKey(table, String(keys[i])));
  return state.getMany({ trans, keys: tks }).then((found) => {
    const rows = found as Array<SyncRow | undefined>;
    const out: SyncRow[] = [];
    const dirty = new Map<string, string>();
    idx.forEach((i, j) => {
      const prev = before[i] as Record<string, unknown> | undefined;
      const next = after ? (after[i] as Record<string, unknown> | undefined) : undefined;
      if (!prev && !next) return; // deleting what is not there
      const old = rows[j];
      const row: SyncRow = old ? { ...old, f: { ...old.f } } : { tk: tks[j], t: table, k: String(keys[i]), s: '', f: {}, mine: 0 };
      if (row.b && !Object.keys(row.b).length) delete row.b;
      const st = stamp();
      if (!next) {
        row.d = st;
        if (!row.s) row.s = segmentOf(table, prev!);
      } else {
        const a = prev ? fieldsOf(table, prev) : {};
        const b = fieldsOf(table, next);
        let changed = false;
        const me = clockClient();
        for (const n of new Set([...Object.keys(a), ...Object.keys(b)])) {
          if (same(a[n], b[n])) continue;
          // the colleague's change this replaces (after this person's own earlier change, the one that replaced)
          const was = row.f[n];
          if (was && stampClient(was) !== me) row.b = { ...row.b, [n]: was };
          else if (!was && row.b?.[n]) row.b = Object.fromEntries(Object.entries(row.b).filter(([x]) => x !== n));
          row.f[n] = st;
          changed = true;
        }
        if (!changed) return;
        if (!prev) {
          row.c = st;
          // made again after being deleted: only what it has now lives on
          if (row.d) for (const [n, s] of Object.entries(row.f)) if (s < row.d) delete row.f[n];
        }
        const s = segmentOf(table, next);
        if (row.s && row.s !== s) dirty.set(row.s, st); // moved to another file (e.g. a sample's year changed)
        row.s = s;
      }
      row.mine = 1;
      dirty.set(row.s, st);
      out.push(row);
    });
    if (!out.length) return;
    const marks: DirtySegment[] = [...dirty].map(([s, v]) => ({ s, v }));
    return state
      .mutate({ trans, type: 'put', values: out })
      .then(() => down.table('syncDirty').mutate({ trans, type: 'put', values: marks }))
      .then(() => {
        const segments = [...dirty.keys()];
        afterCommit(trans, () => listeners.forEach((l) => l(segments)));
      });
  });
}

export const captureMiddleware: Middleware<DBCore> = {
  stack: 'dbcore',
  name: 'EnviroDB workspace changes',
  level: 10,
  create(down) {
    return {
      ...down,
      transaction(stores, mode, options) {
        const scope = mode === 'readwrite' && stores.some((s) => SHARED.has(s)) && !stores.includes('syncState') ? [...stores, 'syncState', 'syncDirty'] : stores;
        return down.transaction(scope, mode, options);
      },
      table(name) {
        const table = down.table(name);
        if (!SHARED.has(name)) return table;
        return {
          ...table,
          mutate(req) {
            if ((req.trans as unknown as Record<string, unknown>)[UNCAPTURED]) return table.mutate(req);
            const go = (keys: unknown[]) => {
              const shared = keys.map((k) => isSharedRecord(name, k));
              if (!shared.some(Boolean)) return table.mutate(req);
              return table.getMany({ trans: req.trans, keys }).then((before) =>
                table.mutate(req).then((res) => {
                  const failed = res.failures ?? {};
                  const after = req.type === 'add' || req.type === 'put' ? req.values : null;
                  const done = record(down, req.trans, name, keys, before, after, shared.map((x, i) => x && !failed[i]));
                  return done ? done.then(() => res) : res;
                }),
              );
            };
            if (req.type === 'deleteRange') {
              return table.query({ trans: req.trans, values: false, query: { index: table.schema.primaryKey, range: req.range } }).then((r) => go(r.result as unknown[]));
            }
            return go(req.type === 'delete' ? req.keys : req.keys ?? req.values.map((v) => table.schema.primaryKey.extractKey!(v)));
          },
        };
      },
    };
  },
};
