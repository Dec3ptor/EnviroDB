import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, updateReportWork } from '../db/db';
import { same } from '../sync/model';

const NONE = {};

interface Pending<T> {
  value: T | undefined;
  /** Saved: from now on the saved value shows (this person's, or a colleague's later one). */
  written: boolean;
}

/**
 * Report work kept as parts – commentary by section, figures by Figures section, layout changes by setting – that
 * several people may change at once. Shows what is saved, so colleagues' changes appear as they make them, with
 * this screen's own typing on top until it is saved; and saves one part at a time onto what is saved then, so a
 * colleague's change to another part is never undone.
 */
export function useSharedWork<T>(key: string) {
  const saved = useLiveQuery(async () => (key ? (((await db.meta.get(key))?.value as Record<string, T> | undefined) ?? {}) : {}), [key]);
  const [pending, setPending] = useState<{ key: string; parts: Record<string, Pending<T>> }>({ key, parts: {} });
  const seq = useRef(0);
  const parts = pending.key === key ? pending.parts : (NONE as Record<string, Pending<T>>);

  // once a part is saved, the saved value shows again
  useEffect(() => {
    setPending((cur) => {
      if (cur.key !== key || !Object.values(cur.parts).some((p) => p.written)) return cur;
      return { key, parts: Object.fromEntries(Object.entries(cur.parts).filter(([, p]) => !p.written)) };
    });
  }, [saved, key]);

  const value = useMemo(() => {
    const v: Record<string, T> = { ...(saved ?? {}) };
    for (const [p, x] of Object.entries(parts)) {
      if (x.value === undefined) delete v[p];
      else v[p] = x.value;
    }
    return v;
  }, [saved, parts]);

  /** Change one part (undefined removes it). */
  const setPart = useCallback(
    (part: string, x: T | undefined) => {
      if (!key) return;
      const n = ++seq.current;
      setPending((cur) => ({ key, parts: { ...(cur.key === key ? cur.parts : {}), [part]: { value: x, written: false } } }));
      void updateReportWork<Record<string, T>>(key, (cur) => {
        const next = { ...(cur ?? {}) };
        if (x === undefined) delete next[part];
        else next[part] = x;
        return Object.keys(next).length ? next : undefined;
      }).then(() => {
        if (n !== seq.current) return; // more typing on its way
        setPending((cur) => (cur.key === key ? { key, parts: Object.fromEntries(Object.entries(cur.parts).map(([p, v]) => [p, { ...v, written: true }])) } : cur));
      });
    },
    [key],
  );

  /** Change several parts: the ones that differ from what shows now. */
  const setAll = useCallback(
    (next: Record<string, T>) => {
      for (const p of new Set([...Object.keys(value), ...Object.keys(next)])) if (!same(value[p], next[p])) setPart(p, next[p]);
    },
    [value, setPart],
  );

  /** Remove it all. */
  const clear = useCallback(() => {
    if (!key) return;
    seq.current++;
    setPending({ key, parts: {} });
    void updateReportWork(key, () => undefined);
  }, [key]);

  return { value, setPart, setAll, clear, loading: saved === undefined };
}
