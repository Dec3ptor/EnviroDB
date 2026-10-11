import type { GuidelineSet, GuidelineValue, Parameter, Qualifier, Result } from '../db/types';
import type { DataIndex } from './dataIndex';
import { convert, sameDimension, unitLabel } from './units';
import { fmtNum } from './values';

// ------------------------------------------------------------ interval logic
// A reported result is treated as an interval of possible true values:
//   "12"     → [12, 12]
//   "< 0.01" → (-∞, 0.01)
//   "> 2420" → (2420, +∞)
// A test is a definite exceedance only if it holds for every value in the interval, definitely
// fine if it holds for none, and otherwise "inconclusive" (e.g. detection limit above the limit).

export interface Interval {
  lo: number;
  hi: number;
  loOpen: boolean;
  hiOpen: boolean;
}

export function toInterval(v: number, q: Qualifier): Interval {
  if (q === '<') return { lo: -Infinity, hi: v, loOpen: true, hiOpen: true };
  if (q === '>') return { lo: v, hi: Infinity, loOpen: true, hiOpen: true };
  return { lo: v, hi: v, loOpen: false, hiOpen: false };
}

export type Verdict = 'exceed' | 'ok' | 'inconclusive';
export type Op = '>' | '>=' | '<' | '<=';

function test(iv: Interval, op: Op, x: number): { all: boolean; none: boolean } {
  switch (op) {
    case '>':
      return { all: iv.lo > x || (iv.lo === x && iv.loOpen), none: iv.hi <= x };
    case '>=':
      return { all: iv.lo >= x, none: iv.hi < x || (iv.hi === x && iv.hiOpen) };
    case '<':
      return { all: iv.hi < x || (iv.hi === x && iv.hiOpen), none: iv.lo >= x };
    case '<=':
      return { all: iv.hi <= x, none: iv.lo > x || (iv.lo === x && iv.loOpen) };
  }
}

/** Evaluate "value <op> x". */
export function verdict(iv: Interval, op: Op, x: number): Verdict {
  const t = test(iv, op, x);
  return t.all ? 'exceed' : t.none ? 'ok' : 'inconclusive';
}

/** Evaluate "value outside [min, max]". */
export function verdictOutside(iv: Interval, min?: number, max?: number): Verdict {
  const below = min !== undefined ? test(iv, '<', min) : { all: false, none: true };
  const above = max !== undefined ? test(iv, '>', max) : { all: false, none: true };
  if (below.all || above.all) return 'exceed';
  if (below.none && above.none) return 'ok';
  return 'inconclusive';
}

// ------------------------------------------------------------ guideline comparison

export interface Limit {
  min?: number;
  max?: number;
  op: '>' | '>=';
  unit: string;
  adjusted: boolean; // hardness-modified
  hardness?: number;
}

/** ANZECC (2000) hardness modification, applied only where hardness exceeds 30 mg/L (capped at 400). */
export function hardnessModify(tv: number, exponent: number, hardness: number): number {
  if (!(hardness > 30)) return tv;
  const h = Math.min(hardness, 400);
  return tv * Math.pow(h / 30, exponent);
}

export function limitFor(gv: GuidelineValue, param: Parameter | undefined, opts: { hardness?: number; adjust: boolean }): Limit {
  let max = gv.max;
  let adjusted = false;
  if (opts.adjust && gv.hardness && max !== undefined && param?.hardnessExponent && opts.hardness !== undefined && opts.hardness > 30) {
    max = hardnessModify(max, param.hardnessExponent, opts.hardness);
    adjusted = true;
  }
  return { min: gv.min, max, op: gv.op ?? '>', unit: gv.unit, adjusted, hardness: adjusted ? opts.hardness : undefined };
}

export interface GuidelineHit {
  setId: string;
  setShort: string;
  verdict: Verdict;
  limit: Limit;
  /** Limit converted to the result's unit, for display. */
  limitInResultUnit?: { min?: number; max?: number };
}

/** Compare one result with one guideline value. Returns null when units are incompatible. */
export function compareResult(r: Result, gv: GuidelineValue, set: GuidelineSet, param: Parameter | undefined, index: DataIndex | null, adjust: boolean): GuidelineHit | null {
  if (r.value === null) return null;
  const hardness = index?.hardness.get(r.sampleId);
  const limit = limitFor(gv, param, { hardness, adjust });
  const v = convert(r.value, r.unit, gv.unit);
  if (v === null) return null;
  const iv = toInterval(v, r.qualifier);
  let vd: Verdict = 'ok';
  if (limit.max !== undefined && limit.min !== undefined) vd = verdictOutside(iv, limit.min, limit.max);
  else if (limit.max !== undefined) vd = verdict(iv, limit.op, limit.max);
  else if (limit.min !== undefined) vd = verdict(iv, '<', limit.min);
  const back = (x?: number) => (x === undefined ? undefined : convert(x, gv.unit, r.unit) ?? undefined);
  return {
    setId: set.id,
    setShort: set.shortName,
    verdict: vd,
    limit,
    limitInResultUnit: { min: back(limit.min), max: back(limit.max) },
  };
}

/** All guideline comparisons for a result across several sets. */
export function compareAll(r: Result, sets: GuidelineSet[], param: Parameter | undefined, index: DataIndex | null, adjust: boolean): GuidelineHit[] {
  const out: GuidelineHit[] = [];
  for (const set of sets) {
    for (const gv of set.values) {
      if (gv.parameterId !== r.parameterId) continue;
      const hit = compareResult(r, gv, set, param, index, adjust);
      if (hit) out.push(hit);
    }
  }
  return out;
}

export function describeLimit(l: { min?: number; max?: number }, unit: string): string {
  const u = unitLabel(unit);
  if (l.min !== undefined && l.max !== undefined) return `${fmtNum(l.min)}–${fmtNum(l.max)} ${u}`;
  if (l.max !== undefined) return `${fmtNum(l.max)} ${u}`;
  if (l.min !== undefined) return `≥ ${fmtNum(l.min)} ${u}`;
  return '';
}

/** Guideline value for a parameter from a set, converted to `unit` (no hardness adjustment). */
export function guidelineFor(set: GuidelineSet, parameterId: string, unit: string): { min?: number; max?: number; hardness?: boolean } | null {
  const gv = set.values.find((v) => v.parameterId === parameterId);
  if (!gv) return null;
  const min = gv.min !== undefined ? convert(gv.min, gv.unit, unit) ?? undefined : undefined;
  const max = gv.max !== undefined ? convert(gv.max, gv.unit, unit) ?? undefined : undefined;
  if (min === undefined && max === undefined) return null;
  return { min, max, hardness: gv.hardness };
}

// ------------------------------------------------------------ display in a chosen unit

/** Units guideline concentrations can be shown in. */
export const GUIDELINE_UNITS = [
  { value: 'published', label: 'As published' },
  { value: 'g/m³', label: 'g/m³' },
  { value: 'mg/L', label: 'mg/L' },
  { value: 'µg/L', label: 'µg/L' },
];

/** A guideline value in the chosen concentration unit. Other units (pH, NTU, µS/cm, cfu…) are left as they are. */
export function guidelineInUnit(v: GuidelineValue, unit: string): { min?: number; max?: number; unit: string } {
  if (unit === 'published' || !v.unit || !sameDimension(v.unit, 'mg/L')) return { min: v.min, max: v.max, unit: v.unit };
  const c = (x?: number) => (x === undefined ? undefined : convert(x, v.unit, unit) ?? x);
  return { min: c(v.min), max: c(v.max), unit };
}

/** A number as a plain decimal (never 1e-5 style), keeping up to 6 significant figures. */
export function plainNumber(v: number | undefined): string {
  if (v === undefined || !Number.isFinite(v)) return '';
  if (v === 0) return '0';
  const s = Number(v.toPrecision(6));
  if (Math.abs(s) >= 1e-6) return String(s);
  return s.toFixed(Math.min(20, Math.ceil(-Math.log10(Math.abs(s))) + 5)).replace(/\.?0+$/, '');
}
