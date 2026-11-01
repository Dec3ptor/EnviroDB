// Calculated parameters: a parameter with a formula gets a value in every sample that has what the formula needs. The
// values are worked out as the data is shown – never stored – so nothing measured is ever changed: a measured value
// (from a lab, a phone, or typed in) always wins, and taking the formula off takes the calculated values away.

import type { NdHandling, Parameter, Result, Sample } from '../db/types';
import { evaluate, FormulaError, parseFormula, type Node } from './formula';
import { convert, unitLabel } from './units';
import { fmtNum, statValue } from './values';

export interface Compiled {
  param: Parameter;
  formula: string;
  node: Node;
  /** Each parameter the formula names (as written) → its id. */
  inputs: Map<string, string>;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

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

/**
 * The calculated values for these samples: each calculated parameter, in each sample that has every value its formula
 * needs and no value of its own for it (measured – or left out – wins). Inputs are taken in their parameters' units;
 * one below detection as the project counts those (`nd`), and said so.
 */
export function calculatedResults(samples: Array<Pick<Sample, 'id' | 'projectId' | 'siteId' | 'date'>>, results: Result[], params: Parameter[], nd: NdHandling, compiled?: Compiled[]): Result[] {
  const order = compiled ?? compileAll(params).order;
  if (!order.length) return [];
  const paramMap = new Map(params.map((p) => [p.id, p]));
  // each sample's values (the first of each parameter, as the data shows it), and the parameters it has any result of
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
  const out: Result[] = [];
  for (const c of order) {
    for (const s of samples) {
      if (own.get(s.id)?.has(c.param.id)) continue;
      const have = values.get(s.id);
      if (!have) continue;
      const used = new Map<string, string>();
      const value = evaluate(c.node, (ref) => {
        const id = c.inputs.get(ref)!;
        const r = have.get(id);
        const q = paramMap.get(id);
        if (!r || r.value === null || !q) return undefined;
        const v = convert(r.value, r.unit, q.unit);
        const x = v === null ? null : statValue(v, r.qualifier, nd);
        if (x === null) return undefined;
        const unit = unitLabel(q.unit);
        used.set(id, `${q.name} ${r.qualifier === '<' ? `<${fmtNum(v)} (taken as ${fmtNum(x)})` : r.calc ? `${fmtNum(x)} (calculated)` : fmtNum(x)}${unit ? ` ${unit}` : ''}`);
        return x;
      });
      if (value === null) continue;
      const res: Result = {
        id: `calc|${s.id}|${c.param.id}`,
        projectId: s.projectId,
        sampleId: s.id,
        siteId: s.siteId,
        date: s.date,
        parameterId: c.param.id,
        value: Number(value.toPrecision(7)),
        qualifier: '',
        unit: c.param.unit,
        calc: { formula: c.formula, from: [...used.values()].join(', ') },
      };
      out.push(res);
      have.set(c.param.id, res);
    }
  }
  return out;
}

/** The results with the calculated values added (as the app shows them). */
export function withCalculated(samples: Array<Pick<Sample, 'id' | 'projectId' | 'siteId' | 'date'>>, results: Result[], params: Parameter[], nd: NdHandling): Result[] {
  const calc = calculatedResults(samples, results, params, nd);
  return calc.length ? [...results, ...calc] : results;
}
