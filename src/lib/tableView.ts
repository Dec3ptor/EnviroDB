// Sorting and filtering of the Data tab's samples × parameters table.

import type { Parameter, Result } from '../db/types';
import type { CellFlag, PivotRow } from './analysis';
import { formatDate } from './dates';
import { toInterval, verdict } from './guidelines';
import { convert } from './units';

export type SortKey = 'date' | 'site' | string; // string = parameter id
export interface SortState {
  key: SortKey;
  dir: 'asc' | 'desc';
}
export const DEFAULT_SORT: SortState = { key: 'date', dir: 'asc' };

export type FilterOp = '>' | '>=' | '<' | '<=' | 'detected' | 'nd' | 'present' | 'blank';
export const FILTER_OPS: Array<{ value: FilterOp; label: string; needsValue?: boolean }> = [
  { value: '>', label: 'is above (>)', needsValue: true },
  { value: '>=', label: 'is at least (≥)', needsValue: true },
  { value: '<', label: 'is below (<)', needsValue: true },
  { value: '<=', label: 'is at most (≤)', needsValue: true },
  { value: 'detected', label: 'was detected' },
  { value: 'nd', label: 'was not detected (<DL)' },
  { value: 'present', label: 'was measured' },
  { value: 'blank', label: 'was not measured' },
];

export interface ValueFilter {
  paramId: string;
  op: FilterOp;
  value?: number;
}

export type ShowRows = 'all' | 'exceed' | 'limit' | 'check';
export const SHOW_ROWS: Array<{ value: ShowRows; label: string }> = [
  { value: 'all', label: 'All samples' },
  { value: 'exceed', label: 'Samples with an exceedance' },
  { value: 'limit', label: 'Samples with a consent limit exceedance' },
  { value: 'check', label: 'Samples with a detection limit issue' },
];

export interface ViewOptions {
  sort: SortState;
  filters: ValueFilter[];
  show: ShowRows;
  search: string;
}

/** Value of a result in the parameter's unit (detection limit for non-detects). */
function cellValue(r: Result | undefined, p: Parameter | undefined): number | null {
  if (!r || r.value === null) return null;
  return p ? convert(r.value, r.unit, p.unit) ?? r.value : r.value;
}

/** Does a row's result for a parameter pass a value filter? Comparisons only pass when they're certain. */
export function passesFilter(row: PivotRow, f: ValueFilter, p: Parameter | undefined): boolean {
  const r = row.cells.get(f.paramId);
  switch (f.op) {
    case 'blank':
      return !r;
    case 'present':
      return !!r;
    case 'nd':
      return !!r && r.qualifier === '<';
    case 'detected':
      return !!r && r.qualifier !== '<';
    default: {
      const v = cellValue(r, p);
      if (v === null || f.value === undefined || !r) return false;
      return verdict(toInterval(v, r.qualifier), f.op, f.value) === 'exceed';
    }
  }
}

export function describeFilter(f: ValueFilter, p: Parameter | undefined, unit: string): string {
  const name = p?.short ?? p?.name ?? f.paramId;
  const op = FILTER_OPS.find((o) => o.value === f.op);
  if (op?.needsValue) return `${name} ${f.op.replace('>=', '≥').replace('<=', '≤')} ${f.value ?? ''} ${unit}`.trim();
  return `${name} ${op?.label ?? f.op}`;
}

/** Filter and sort the table rows. Blank cells always sort last. */
export function applyView(rows: PivotRow[], params: Map<string, Parameter>, flags: Map<string, CellFlag>, o: ViewOptions, siteOrder: Map<string, number>): PivotRow[] {
  const q = o.search.trim().toLowerCase();
  const out = rows.filter((row) => {
    if (o.show !== 'all') {
      const kinds = Array.from(row.cells.values()).map((r) => flags.get(r.id)?.kind);
      const hit = o.show === 'exceed' ? kinds.some((k) => k === 'limit' || k === 'guideline') : kinds.includes(o.show === 'limit' ? 'limit' : 'check');
      if (!hit) return false;
    }
    for (const f of o.filters) if (!passesFilter(row, f, params.get(f.paramId))) return false;
    if (q) {
      const s = row.sample;
      const hay = [s.sampleName, s.labJob, s.labNumber, s.labName, s.notes, row.site.code, row.site.name, s.date, formatDate(s.date)].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const byDate = (a: PivotRow, b: PivotRow) => (a.sample.date < b.sample.date ? -1 : a.sample.date > b.sample.date ? 1 : 0);
  const bySite = (a: PivotRow, b: PivotRow) => (siteOrder.get(a.site.id) ?? 0) - (siteOrder.get(b.site.id) ?? 0);
  const dir = o.sort.dir === 'asc' ? 1 : -1;
  if (o.sort.key === 'date') out.sort((a, b) => dir * (byDate(a, b) || bySite(a, b)));
  else if (o.sort.key === 'site') out.sort((a, b) => dir * (bySite(a, b) || byDate(a, b)));
  else {
    const p = params.get(o.sort.key);
    const key = (row: PivotRow) => {
      const r = row.cells.get(o.sort.key);
      const v = cellValue(r, p);
      // a non-detect sorts just below a detected value with the same number
      return v === null ? null : v - (r?.qualifier === '<' ? Math.abs(v) * 1e-9 : 0);
    };
    out.sort((a, b) => {
      const ka = key(a), kb = key(b);
      if (ka === null && kb === null) return byDate(a, b);
      if (ka === null) return 1;
      if (kb === null) return -1;
      return dir * (ka - kb) || byDate(a, b);
    });
  }
  return out;
}

export function sortLabel(s: SortState, params: Map<string, Parameter>): string {
  if (s.key === 'date') return s.dir === 'asc' ? 'Date (oldest first)' : 'Date (newest first)';
  if (s.key === 'site') return s.dir === 'asc' ? 'Site' : 'Site (reversed)';
  const p = params.get(s.key);
  return `${p?.short ?? p?.name ?? s.key} (${s.dir === 'desc' ? 'largest first' : 'smallest first'})`;
}
