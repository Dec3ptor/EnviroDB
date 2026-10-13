import { useCallback, useMemo, useRef, useState } from 'react';
import { same } from '../sync/model';

/**
 * An editable copy of a saved record. The fields you haven't touched keep following the saved record – so a
 * colleague's change shows up while you edit – and `changes` holds only what you changed, for saving with the
 * saved record as `before` (saveProject(value, saved) …), which keeps their changes to everything else.
 */
export function useEditable<T extends object>(saved: T) {
  const [edits, setEdits] = useState<Record<string, unknown>>({});
  const value = useMemo(() => ({ ...saved, ...edits }) as T, [saved, edits]);
  const current = useRef({ saved, value });
  current.current = { saved, value };
  const setValue = useCallback((next: T | ((cur: T) => T)) => {
    const { saved: s, value: v } = current.current;
    const n = (typeof next === 'function' ? (next as (cur: T) => T)(v) : next) as Record<string, unknown>;
    const base = s as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of new Set([...Object.keys(base), ...Object.keys(n)])) if (!same(base[k], n[k])) out[k] = n[k];
    setEdits(out);
  }, []);
  const changes = useMemo(() => {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(edits)) if (!same((saved as Record<string, unknown>)[k], x)) out[k] = x;
    return out as Partial<T>;
  }, [saved, edits]);
  const reset = useCallback(() => setEdits({}), []);
  return [value, setValue, { dirty: Object.keys(changes).length > 0, changes, reset }] as const;
}
