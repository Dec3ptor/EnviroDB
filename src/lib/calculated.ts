// Calculated parameters: a parameter with a formula gets a value in every sample that has what the formula needs. The
// values are worked out as the data is shown – never stored – so nothing measured is ever changed: a measured value
// (from a lab, a phone, or typed in) always wins, and taking the formula off takes the calculated values away.

import type { NdHandling, Parameter, Result, Sample } from '../db/types';
import { evaluate, FormulaError, parseFormula, refText, renameRefs, type Node } from './formula';
import { convert, unitLabel } from './units';
import { fmtNum, statValue } from './values';

export interface Compiled {
  param: Parameter;
  formula: string;
  node: Node;
  /** Each parameter the formula names (as written) → its id. */
  inputs: Map<string, string>;
}

type AnySample = Pick<Sample, 'id' | 'projectId' | 'siteId' | 'date'>;

// a name as a formula may write it: any case and spacing, a hyphen for a dash, u for µ
const norm = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[‐-―−]/g, '-')
    .replace(/[µμ]/g, 'u')
    .replace(/\s+/g, ' ');

/** A parameter named in a formula: by its id, name, short name or another name it goes by. */
export function paramByRef(params: Parameter[], ref: string): Parameter | undefined {
  const k = norm(ref);
  return params.find((p) => p.id.toLowerCase() === k) ?? params.find((p) => norm(p.name) === k) ?? params.find((p) => !!p.short && norm(p.short) === k) ?? params.find((p) => p.aliases.some((a) => norm(a) === k));
}

/** A formula checked against the parameters: what it uses – or what's wrong with it (and where). */
export function compileFormula(param: Parameter, params: Parameter[], formula = param.formula ?? ''): Compiled | { error: string; at?: number } {
  try {
    const { node, refs } = parseFormula(formula.trim());
    const inputs = new Map<string, string>();
    for (const r of refs) {
      const p = paramByRef(params, r);
      if (!p) return { error: `There’s no parameter called “${r}”` };
      if (p.id === param.id) return { error: `${param.name} can’t be worked out from itself` };
      inputs.set(r, p.id);
    }
    return { param, formula: formula.trim(), node, inputs };
  } catch (e) {
    if (e instanceof FormulaError) return { error: e.message, at: e.at };
    throw e;
  }
}

/**
 * The calculated parameters, in the order to work them out (one another uses first). One with a formula that doesn't
 * work – or that's worked out from itself through others – is left out, with why.
 */
export function compileAll(params: Parameter[]): { order: Compiled[]; problems: Map<string, string> } {
  const problems = new Map<string, string>();
  const compiled = new Map<string, Compiled>();
  for (const p of params) {
    if (!p.formula?.trim()) continue;
    const c = compileFormula(p, params);
    if ('error' in c) problems.set(p.id, c.error);
    else compiled.set(p.id, c);
  }
  const order: Compiled[] = [];
  const state = new Map<string, 'on' | 'done'>();
  const stack: string[] = [];
  const visit = (id: string) => {
    const c = compiled.get(id);
    if (!c || state.get(id) === 'done') return;
    if (state.get(id) === 'on') {
      for (const x of stack.slice(stack.indexOf(id))) problems.set(x, 'It’s worked out from itself, through other calculated parameters');
      return;
    }
    state.set(id, 'on');
    stack.push(id);
    for (const dep of c.inputs.values()) visit(dep);
    stack.pop();
    state.set(id, 'done');
    order.push(c);
  };
  for (const id of compiled.keys()) visit(id);
  return { order: order.filter((c) => !problems.has(c.param.id)), problems };
}

/** Each sample's values (the first of each parameter, as the data shows it), and the parameters it has any result of. */
function bySample(results: Result[]) {
  const values = new Map<string, Map<string, Result>>();
  const own = new Map<string, Set<string>>();
  for (const r of results) {
    let o = own.get(r.sampleId);
    if (!o) own.set(r.sampleId, (o = new Set()));
    o.add(r.parameterId);
    if (r.excluded) continue;
    let m = values.get(r.sampleId);
    if (!m) values.set(r.sampleId, (m = new Map()));
    if (!m.has(r.parameterId)) m.set(r.parameterId, r);
  }
  return { values, own };
}

/** A sample's value of a parameter, in the parameter's unit – none when it hasn't one, or it's in a unit that can't be changed to it. */
function valueIn(r: Result | undefined, p: Parameter): number | null {
  return r && r.value !== null ? convert(r.value, r.unit, p.unit) : null;
}

/** The formula worked out for one sample's values: the answer (null: none), what it was worked out from, and whether a value it needed was missing. */
function workOut(c: Compiled, have: Map<string, Result>, paramMap: Map<string, Parameter>, nd: NdHandling) {
  const used = new Map<string, string>();
  let missed = false;
  const value = evaluate(c.node, (ref) => {
    const id = c.inputs.get(ref)!;
    const r = have.get(id);
    const q = paramMap.get(id);
    const v = q ? valueIn(r, q) : null;
    const x = v === null ? null : statValue(v, r!.qualifier, nd);
    if (x === null || !q || !r) {
      missed = true;
      return undefined;
    }
    const unit = unitLabel(q.unit);
    used.set(id, `${q.name} ${r.qualifier === '<' ? `<${fmtNum(v)} (taken as ${fmtNum(x)})` : r.calc ? `${fmtNum(x)} (calculated)` : fmtNum(x)}${unit ? ` ${unit}` : ''}`);
    return x;
  });
  return { value: value === null ? null : Number(value.toPrecision(7)), from: [...used.values()].join(', '), missed };
}

const calcResult = (s: AnySample, c: Compiled, value: number, from: string): Result => ({
  id: `calc|${s.id}|${c.param.id}`,
  projectId: s.projectId,
  sampleId: s.id,
  siteId: s.siteId,
  date: s.date,
  parameterId: c.param.id,
  value,
  qualifier: '',
  unit: c.param.unit,
  calc: { formula: c.formula, from },
});

/**
 * The calculated values for these samples: each calculated parameter, in each sample that has every value its formula
 * needs and no value of its own for it (measured – or left out – wins). Inputs are taken in their parameters' units;
 * one below detection as the project counts those (`nd`), and said so.
 */
export function calculatedResults(samples: AnySample[], results: Result[], params: Parameter[], nd: NdHandling, compiled?: Compiled[]): Result[] {
  const order = compiled ?? compileAll(params).order;
  if (!order.length) return [];
  const paramMap = new Map(params.map((p) => [p.id, p]));
  const { values, own } = bySample(results);
  const out: Result[] = [];
  for (const c of order) {
    for (const s of samples) {
      if (own.get(s.id)?.has(c.param.id)) continue;
      const have = values.get(s.id);
      if (!have) continue;
      const w = workOut(c, have, paramMap, nd);
      if (w.value === null) continue;
      const res = calcResult(s, c, w.value, w.from);
      out.push(res);
      have.set(c.param.id, res);
    }
  }
  return out;
}

/** The results with the calculated values added (as the app shows them). */
export function withCalculated(samples: AnySample[], results: Result[], params: Parameter[], nd: NdHandling): Result[] {
  const calc = calculatedResults(samples, results, params, nd);
  return calc.length ? [...results, ...calc] : results;
}

// ------------------------------------------------------------ a formula explained, before it's saved

export interface InputUse {
  param: Parameter;
  /** How the formula names it (in brackets) – one way or more. */
  refs: string[];
  /** Samples with a value of it the formula can use. */
  samples: number;
  /** Samples whose value is in a unit that can't be changed to the parameter's (so isn't used) – and those units. */
  otherUnit: number;
  otherUnits: string[];
}

export interface FormulaCheck {
  sample: AnySample;
  from: string;
  worked: number;
  measured: number;
}

export interface FormulaReport {
  inputs: InputUse[];
  /** The values it works out: in samples without one of their own. */
  results: Result[];
  /** Samples with a value of their own (measured, typed in, or left out) – kept. */
  measured: number;
  /** Samples with what it needs whose answer isn't a number (dividing by 0, the square root of a negative …). */
  noAnswer: number;
  /** Where a value is measured and the formula works it out too: both, to see they agree. */
  checks: FormulaCheck[];
}

/**
 * What a formula does in a project: each parameter it uses and how many samples have it, the values it works out,
 * and – where the value's measured too – how close it comes. `results` without the parameter's own calculated values.
 */
export function explainFormula(samples: AnySample[], results: Result[], params: Parameter[], nd: NdHandling, c: Compiled): FormulaReport {
  const paramMap = new Map(params.map((p) => [p.id, p]));
  const { values, own } = bySample(results);
  const inputs: InputUse[] = [];
  for (const [ref, id] of c.inputs) {
    const there = inputs.find((u) => u.param.id === id);
    if (there) {
      there.refs.push(ref);
      continue;
    }
    const param = paramMap.get(id);
    if (!param) continue;
    const use: InputUse = { param, refs: [ref], samples: 0, otherUnit: 0, otherUnits: [] };
    for (const s of samples) {
      const r = values.get(s.id)?.get(id);
      if (!r || r.value === null) continue;
      if (valueIn(r, param) !== null) use.samples++;
      else {
        use.otherUnit++;
        if (!use.otherUnits.includes(r.unit)) use.otherUnits.push(r.unit);
      }
    }
    inputs.push(use);
  }
  const out: Result[] = [];
  const checks: FormulaCheck[] = [];
  let measured = 0;
  let noAnswer = 0;
  for (const s of samples) {
    const mine = !!own.get(s.id)?.has(c.param.id);
    if (mine) measured++;
    const have = values.get(s.id);
    if (!have) continue;
    const w = workOut(c, have, paramMap, nd);
    if (mine) {
      const m = have.get(c.param.id);
      const mv = m && !m.qualifier && !m.calc ? valueIn(m, c.param) : null;
      if (w.value !== null && mv !== null) checks.push({ sample: s, from: w.from, worked: w.value, measured: mv });
      continue;
    }
    if (w.value !== null) out.push(calcResult(s, c, w.value, w.from));
    else if (!w.missed) noAnswer++;
  }
  return { inputs, results: out, measured, noAnswer, checks };
}

/** How far apart the worked-out and measured values typically are (the median), as a difference and a share of the measured value. */
export function typicalGap(checks: FormulaCheck[]): { diff: number; share: number | null } | null {
  if (!checks.length) return null;
  const median = (xs: number[]) => {
    const a = [...xs].sort((x, y) => x - y);
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  };
  const shares = checks.filter((k) => k.measured !== 0).map((k) => Math.abs(k.worked - k.measured) / Math.abs(k.measured));
  return { diff: median(checks.map((k) => Math.abs(k.worked - k.measured))), share: shares.length ? median(shares) : null };
}

// the words of a parameter's names that say what it is (not its unit, nor "field", "total" …)
const GENERIC = new Set(['field', 'lab', 'test', 'site', 'water', 'sample', 'reading', 'meter', 'probe', 'measured', 'calculated', 'conc', 'concentration', 'total', 'dissolved', 'free', 'soluble', 'acid', 'the', 'of', 'and', 'or', 'in', 'at', 'as', 'on', 'by', 'to', 'for', 'from', 'with', 'per', 'an', 'is', 'no', 'not', 'below', 'above']);
const words = (s: string) =>
  norm(s)
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
function nameWords(p: Pick<Parameter, 'name' | 'short' | 'aliases'>): Set<string> {
  const keys = new Set<string>();
  for (const raw of [p.name, p.short ?? '', ...p.aliases]) for (const w of words(raw)) if (w.length > 1 && !GENERIC.has(w)) keys.add(w);
  // the name's initials too: "Dissolved Oxygen" → do
  const named = words(p.name);
  if (named.length > 1) keys.add(named.map((w) => w[0]).join(''));
  return keys;
}

/**
 * Parameters that look like this one (by their names: "DO (%) (field)" for Dissolved Oxygen) – from `candidates`,
 * most alike first, then the most used (`count`).
 */
export function likeParams(p: Parameter, candidates: Parameter[], count: (id: string) => number, max = 3): Parameter[] {
  const mine = nameWords(p);
  return candidates
    .filter((q) => q.id !== p.id)
    .map((q) => ({ q, score: [...nameWords(q)].filter((w) => mine.has(w)).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || count(b.q.id) - count(a.q.id))
    .slice(0, max)
    .map((x) => x.q);
}

/**
 * The other parameters' formulas that name `before` in a way its change (a new name, a short name or other name taken
 * off) would lose – each named as it is now instead, so they keep working.
 */
export function formulasKept(params: Parameter[], before: Parameter, after: Parameter): Array<{ param: Parameter; formula: string }> {
  const was = params.map((p) => (p.id === before.id ? before : p));
  const now = params.map((p) => (p.id === after.id ? after : p));
  const out: Array<{ param: Parameter; formula: string }> = [];
  for (const q of was) {
    if (q.id === before.id || !q.formula?.trim()) continue;
    const c = compileFormula(q, was);
    if ('error' in c) continue;
    const lost = [...c.inputs].filter(([ref, id]) => id === before.id && paramByRef(now, ref)?.id !== after.id).map(([ref]) => ref);
    if (lost.length) out.push({ param: q, formula: renameRefs(q.formula, lost, refText(after)) });
  }
  return out;
}
