// Formulas for calculated parameters – "[DO % saturation] / 100 * DO_SAT([Temperature])" – read by EnviroDB's own
// parser and worked out by its own evaluator. Nothing in a formula is ever run as code (the app's security policy
// wouldn't allow it anyway): a formula can only do arithmetic on a sample's values, so one pasted from anywhere – an
// AI's answer included – can't do anything else.

export class FormulaError extends Error {
  /** Where in the formula (a character position). */
  at: number;
  constructor(message: string, at: number) {
    super(message);
    this.at = at;
  }
}

type Tok = { t: 'num'; v: number; at: number } | { t: 'ref'; name: string; at: number } | { t: 'id'; name: string; at: number } | { t: 'op'; v: string; at: number };

export type Node =
  | { k: 'num'; v: number }
  | { k: 'ref'; name: string; at: number }
  | { k: 'neg'; a: Node }
  | { k: 'bin'; op: string; a: Node; b: Node }
  | { k: 'call'; fn: string; args: Node[]; at: number };

const MAX_LEN = 2000;

// what a formula pasted from Word or an AI may have for an operator (a parameter's name keeps its own: "TPH C7–C9")
const ALT_OPS: Record<string, string> = { '×': '*', '÷': '/', '−': '-', '–': '-', '≤': '<=', '≥': '>=', '≠': '<>' };

/** Where the parameter name opened at `from` (a "[") ends: its "]" – names may have brackets of their own ("Benzo[a]pyrene"). */
function refEnd(s: string, from: number): number {
  let depth = 0;
  for (let i = from; i < s.length; i++) {
    if (s[i] === '[') depth++;
    else if (s[i] === ']' && --depth === 0) return i;
  }
  return -1;
}

function tokens(s: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const num = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(s.slice(i));
    if (num) {
      out.push({ t: 'num', v: Number(num[0]), at: i });
      i += num[0].length;
      continue;
    }
    if (c === '[') {
      const end = refEnd(s, i);
      if (end < 0) throw new FormulaError('A [ isn’t closed with ]', i);
      const name = s.slice(i + 1, end).trim();
      if (!name) throw new FormulaError('Put a parameter’s name between [ and ]', i);
      out.push({ t: 'ref', name, at: i });
      i = end + 1;
      continue;
    }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i));
    if (id) {
      out.push({ t: 'id', name: id[0].toUpperCase(), at: i });
      i += id[0].length;
      continue;
    }
    if (ALT_OPS[c]) {
      out.push({ t: 'op', v: ALT_OPS[c], at: i });
      i++;
      continue;
    }
    const two = s.slice(i, i + 2);
    if (['<=', '>=', '<>', '!=', '=='].includes(two)) {
      out.push({ t: 'op', v: two === '!=' ? '<>' : two === '==' ? '=' : two, at: i });
      i += 2;
      continue;
    }
    if ('+-*/^(),<>='.includes(c)) {
      out.push({ t: 'op', v: c, at: i });
      i++;
      continue;
    }
    throw new FormulaError(`“${c}” can’t be used here`, i);
  }
  return out;
}

/** The formula read: its tree, and the parameters it uses (as written, in brackets). */
export function parseFormula(src: string): { node: Node; refs: string[] } {
  if (src.length > MAX_LEN) throw new FormulaError('The formula is too long', MAX_LEN);
  const toks = tokens(src);
  if (!toks.length) throw new FormulaError('The formula is empty', 0);
  let p = 0;
  let depth = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => peek()?.t === 'op' && (peek() as { v: string }).v === v;
  const expect = (v: string) => {
    if (!isOp(v)) throw new FormulaError(`Expected “${v}”`, peek()?.at ?? src.length);
    p++;
  };
  const compare = (): Node => {
    const a = additive();
    const t = peek();
    if (t?.t === 'op' && ['<', '<=', '>', '>=', '=', '<>'].includes(t.v)) {
      p++;
      return { k: 'bin', op: t.v, a, b: additive() };
    }
    return a;
  };
  const additive = (): Node => {
    let a = term();
    while (isOp('+') || isOp('-')) {
      const op = (toks[p++] as { v: string }).v;
      a = { k: 'bin', op, a, b: term() };
    }
    return a;
  };
  const term = (): Node => {
    let a = unary();
    while (isOp('*') || isOp('/')) {
      const op = (toks[p++] as { v: string }).v;
      a = { k: 'bin', op, a, b: unary() };
    }
    return a;
  };
  const unary = (): Node => {
    if (isOp('-')) {
      p++;
      return { k: 'neg', a: unary() };
    }
    if (isOp('+')) {
      p++;
      return unary();
    }
    return power();
  };
  const power = (): Node => {
    const a = primary();
    if (isOp('^')) {
      p++;
      return { k: 'bin', op: '^', a, b: unary() };
    }
    return a;
  };
  const primary = (): Node => {
    const t = peek();
    if (!t) throw new FormulaError('The formula stops too soon', src.length);
    if (++depth > 60) throw new FormulaError('The formula is nested too deeply', t.at);
    try {
      if (t.t === 'num') {
        p++;
        return { k: 'num', v: t.v };
      }
      if (t.t === 'ref') {
        p++;
        return { k: 'ref', name: t.name, at: t.at };
      }
      if (t.t === 'id') {
        p++;
        if (!isOp('(')) throw new FormulaError(`“${t.name}” isn’t a function – put a parameter’s name in square brackets: [${t.name.toLowerCase()}]`, t.at);
        const fn = FUNCTIONS[t.name];
        if (!fn) throw new FormulaError(`There’s no function called ${t.name}`, t.at);
        p++;
        const args: Node[] = [];
        if (!isOp(')')) {
          args.push(compare());
          while (isOp(',')) {
            p++;
            args.push(compare());
          }
        }
        expect(')');
        if (args.length < fn.min || args.length > fn.max) throw new FormulaError(`${t.name} takes ${fn.min === fn.max ? fn.min : `${fn.min}–${fn.max === Infinity ? 'any number of' : fn.max}`} value${fn.max === 1 ? '' : 's'}`, t.at);
        return { k: 'call', fn: t.name, args, at: t.at };
      }
      if (isOp('(')) {
        p++;
        const e = compare();
        expect(')');
        return e;
      }
      throw new FormulaError(`“${t.t === 'op' ? t.v : ''}” can’t go here`, t.at);
    } finally {
      depth--;
    }
  };
  const node = compare();
  if (p < toks.length) throw new FormulaError('Something follows that doesn’t fit – a missing operator?', toks[p].at);
  const refs: string[] = [];
  const walk = (n: Node) => {
    if (n.k === 'ref' && !refs.includes(n.name)) refs.push(n.name);
    if (n.k === 'neg') walk(n.a);
    if (n.k === 'bin') {
      walk(n.a);
      walk(n.b);
    }
    if (n.k === 'call') n.args.forEach(walk);
  };
  walk(node);
  return { node, refs };
}

/** A parameter's name as a formula writes it, in brackets – its id when the name's own brackets don't pair up. */
export function refText(p: { id: string; name: string }): string {
  let depth = 0;
  for (const c of p.name) {
    if (c === '[') depth++;
    else if (c === ']' && --depth < 0) break;
  }
  return depth === 0 ? p.name : p.id;
}

/** The formula with the parameters it names as `from` (as written in it) named `to` instead. */
export function renameRefs(src: string, from: string[], to: string): string {
  const names = new Set(from);
  let out = '';
  let i = 0;
  while (i < src.length) {
    const end = src[i] === '[' ? refEnd(src, i) : -1;
    if (end < 0) {
      out += src[i++];
      continue;
    }
    const whole = src.slice(i, end + 1);
    out += names.has(whole.slice(1, -1).trim()) ? `[${to}]` : whole;
    i = end + 1;
  }
  return out;
}

/**
 * Oxygen's solubility in water, mg/L, at a temperature (°C), salinity (g/kg) and pressure (kPa): Benson & Krause
 * (1984) as in APHA 4500-O and the USGS tables – 9.09 mg/L at 20 °C in fresh water at sea level.
 */
export function doSaturation(tempC: number, salinity = 0, pressureKpa = 101.325): number {
  const T = tempC + 273.15;
  let ln = -139.34411 + 1.575701e5 / T - 6.642308e7 / T ** 2 + 1.2438e10 / T ** 3 - 8.621949e11 / T ** 4;
  if (salinity) ln -= salinity * (1.7674e-2 - 10.754 / T + 2140.7 / T ** 2);
  let c = Math.exp(ln);
  const P = pressureKpa / 101.325;
  if (Math.abs(P - 1) > 1e-9) {
    const pwv = Math.exp(11.8571 - 3840.7 / T - 216961 / T ** 2);
    const theta = 0.000975 - 1.426e-5 * tempC + 6.436e-8 * tempC ** 2;
    c *= (P * ((1 - pwv / P) * (1 - theta * P))) / ((1 - pwv) * (1 - theta));
  }
  return c;
}

const FUNCTIONS: Record<string, { min: number; max: number; fn: (...a: number[]) => number; help: string }> = {
  ABS: { min: 1, max: 1, fn: Math.abs, help: 'ABS(x) – the value without its sign' },
  SQRT: { min: 1, max: 1, fn: Math.sqrt, help: 'SQRT(x) – square root' },
  EXP: { min: 1, max: 1, fn: Math.exp, help: 'EXP(x) – e to the power x' },
  LN: { min: 1, max: 1, fn: Math.log, help: 'LN(x) – natural logarithm' },
  LOG10: { min: 1, max: 1, fn: Math.log10, help: 'LOG10(x) – base-10 logarithm' },
  LOG: { min: 1, max: 2, fn: (x, b = 10) => Math.log(x) / Math.log(b), help: 'LOG(x, base) – logarithm (base 10 unless given)' },
  POWER: { min: 2, max: 2, fn: (a, b) => a ** b, help: 'POWER(x, y) – x to the power y (or x^y)' },
  ROUND: { min: 1, max: 2, fn: (x, d = 0) => Math.round(x * 10 ** d) / 10 ** d, help: 'ROUND(x, digits) – rounded' },
  MIN: { min: 1, max: Infinity, fn: Math.min, help: 'MIN(a, b, …) – the smallest' },
  MAX: { min: 1, max: Infinity, fn: Math.max, help: 'MAX(a, b, …) – the largest' },
  AVERAGE: { min: 1, max: Infinity, fn: (...a) => a.reduce((s, x) => s + x, 0) / a.length, help: 'AVERAGE(a, b, …) – the mean' },
  IF: { min: 3, max: 3, fn: (c, a, b) => (c ? a : b), help: 'IF(test, then, otherwise) – with < <= > >= = <>' },
  PI: { min: 0, max: 0, fn: () => Math.PI, help: 'PI() – 3.14159…' },
  DO_SAT: { min: 1, max: 3, fn: doSaturation, help: 'DO_SAT(temperature °C, salinity g/kg, pressure kPa) – oxygen’s solubility in mg/L (fresh water at sea level unless given)' },
};

/** The functions a formula can use, as help. */
export const FUNCTION_HELP = Object.values(FUNCTIONS).map((f) => f.help);

/**
 * The formula worked out with the values of the parameters it names (`value` gives each, by the name as written;
 * none when the sample hasn't got it). Null when a value it needs is missing or the answer isn't a number.
 */
export function evaluate(node: Node, value: (ref: string) => number | undefined): number | null {
  const ev = (n: Node): number => {
    switch (n.k) {
      case 'num':
        return n.v;
      case 'ref': {
        const v = value(n.name);
        if (v === undefined || !Number.isFinite(v)) throw MISSING;
        return v;
      }
      case 'neg':
        return -ev(n.a);
      case 'call': {
        // IF works out only the side it takes (the other may need a value the sample hasn't got)
        if (n.fn === 'IF') return ev(n.args[0]) ? ev(n.args[1]) : ev(n.args[2]);
        return FUNCTIONS[n.fn].fn(...n.args.map(ev));
      }
      case 'bin': {
        const a = ev(n.a);
        const b = ev(n.b);
        switch (n.op) {
          case '+':
            return a + b;
          case '-':
            return a - b;
          case '*':
            return a * b;
          case '/':
            return a / b;
          case '^':
            return a ** b;
          case '<':
            return a < b ? 1 : 0;
          case '<=':
            return a <= b ? 1 : 0;
          case '>':
            return a > b ? 1 : 0;
          case '>=':
            return a >= b ? 1 : 0;
          case '=':
            return a === b ? 1 : 0;
          case '<>':
            return a !== b ? 1 : 0;
        }
        return NaN;
      }
    }
  };
  try {
    const v = ev(node);
    return Number.isFinite(v) ? v : null;
  } catch (e) {
    if (e === MISSING) return null;
    throw e;
  }
}
const MISSING = new Error('missing');
