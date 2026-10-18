// How a page is set up – the graphs chosen, the data filters, the report being written – kept while you go to another
// tab and come back, and in this browser for next time. Each person's own; nothing here goes to the workspace.

import { useCallback, useState } from 'react';
import { periodPresets, todayStr } from '../lib/dates';

const PREFIX = 'envirodb.view.';
const memory = new Map<string, unknown>();

function load<T>(key: string | null): T | undefined {
  if (!key) return undefined;
  if (memory.has(key)) return memory.get(key) as T;
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) return undefined;
    const v = JSON.parse(raw) as T;
    memory.set(key, v);
    return v;
  } catch {
    return undefined;
  }
}

function store(key: string, v: unknown) {
  memory.set(key, v);
  try {
    if (v === undefined) localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, JSON.stringify(v));
  } catch {
    /* kept for this visit only */
  }
}

/**
 * Like useState, but kept under `key` (e.g. "prj_1:charts.params"); `revive` checks a kept value is still usable
 * (returning undefined starts afresh). A null key keeps nothing.
 */
export function useViewState<T>(key: string | null, initial: T | (() => T), revive?: (v: T) => T | undefined): [T, (v: T | ((prev: T) => T)) => void] {
  const fresh = () => {
    const kept = load<T>(key);
    const v = kept === undefined ? undefined : revive ? revive(kept) : kept;
    return v === undefined ? (typeof initial === 'function' ? (initial as () => T)() : initial) : v;
  };
  const [state, setState] = useState<{ key: string | null; value: T }>(() => ({ key, value: fresh() }));
  // another project: its own settings
  let current = state;
  if (state.key !== key) {
    current = { key, value: fresh() };
    setState(current);
  }
  const set = useCallback(
    (v: T | ((prev: T) => T)) =>
      setState((s) => {
        const value = typeof v === 'function' ? (v as (p: T) => T)(s.value) : v;
        if (s.key) store(s.key, value);
        return { key: s.key, value };
      }),
    [],
  );
  return [current.value, set];
}

/** Whether something is kept under this key. */
export function hasViewState(key: string): boolean {
  return load(key) !== undefined;
}

/** Keep a value before the page reads it – e.g. a link that opens a particular report. */
export function seedViewState(key: string, value: unknown) {
  store(key, value);
}

/** Forget what's kept for these keys (e.g. after "Reset"). */
export function clearViewState(keys: string[]) {
  for (const k of keys) store(k, undefined);
}

/** A kept period: the usual periods ("Last 12 months", "This reporting year") move on with the date. */
export function revivePeriod<P extends { key: string; start: string; end: string; label: string }>(yearStartMonth: number) {
  return (p: P): P | undefined => {
    if (!p || typeof p.key !== 'string' || typeof p.start !== 'string' || typeof p.end !== 'string') return undefined;
    const preset = periodPresets(todayStr(), yearStartMonth).find((x) => x.key === p.key);
    return preset ? ({ key: preset.key, start: preset.start, end: preset.end, label: preset.label } as P) : p;
  };
}

/** A kept list of ids, keeping only those still there. */
export function reviveIds(exists: (id: string) => boolean) {
  return (ids: string[]): string[] | undefined => (Array.isArray(ids) ? ids.filter((id) => typeof id === 'string' && exists(id)) : undefined);
}
