import type { NdHandling, Qualifier } from '../db/types';

export interface ParsedValue {
  value: number | null;
  qualifier: Qualifier;
  text: string;
  dl?: number;
  /** True when the cell holds no result (blank, "NS", "-", "Dry" …) and should not be imported. */
  missing: boolean;
}

const MISSING = new Set([
  '', '-', '--', '—', '–', 'na', 'n/a', 'n.a.', 'ns', 'n/s', 'not sampled', 'no sample', 'nt', 'not tested', 'ntd',
  'dry', 'x', '#n/a', '#value!', '#ref!', '#div/0!', 'nil sample', 'no data', 'nd*', 'ins', 'insufficient sample',
  'not analysed', 'not analyzed', 'tba', 'pending', 'np', 'nr', 'not reported', 'blank', 'void', 'invalid', '?', '*',
]);

const NONDETECT_WORDS = /^(nd|n\.d\.|bdl|bql|<\s*dl|<\s*lor|<\s*mdl|<\s*pql|<\s*rl|<\s*lod|<\s*loq|not detected|undetected|below detection( limit)?|trace)$/i;

function toNumber(s: string): number | null {
  const t = s.replace(/,(?=\d{3}(\D|$))/g, '').replace(/\s+/g, '');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Parse a lab/spreadsheet result cell: 12, "0.0021", "< 0.0010", ">2420", "ND", "NS", "1,200", "0.5*". */
export function parseValue(raw: unknown): ParsedValue {
  if (raw === null || raw === undefined) return { value: null, qualifier: '', text: '', missing: true };
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? { value: raw, qualifier: '', text: String(raw), missing: false } : { value: null, qualifier: '', text: '', missing: true };
  }
  if (typeof raw === 'boolean' || raw instanceof Date) return { value: null, qualifier: '', text: String(raw), missing: true };

  const text = String(raw).trim();
  const lower = text.toLowerCase();
  if (MISSING.has(lower)) return { value: null, qualifier: '', text, missing: true };
  if (NONDETECT_WORDS.test(lower)) return { value: null, qualifier: '<', text, missing: false };

  // Strip trailing flags/footnote markers and bracketed comments: "0.5*", "12 #1", "7.2 (field)", "0.03 J"
  let core = text.replace(/\s*\([^)]*\)\s*$/, '').replace(/[*#^†‡]+\d*\s*$/, '').replace(/\s+[A-Za-z]{1,2}$/, '').trim();

  let qualifier: Qualifier = '';
  const q = core.match(/^(<=|>=|≤|≥|<|>|less than|greater than|lt|gt)\s*/i);
  if (q) {
    const sym = q[1].toLowerCase();
    qualifier = sym.startsWith('<') || sym === '≤' || sym === 'less than' || sym === 'lt' ? '<' : '>';
    core = core.slice(q[0].length).trim();
  }
  const n = toNumber(core);
  if (n === null) {
    if (qualifier === '<') return { value: null, qualifier, text, missing: false };
    return { value: null, qualifier: '', text, missing: true };
  }
  return { value: n, qualifier, text, dl: qualifier === '<' ? n : undefined, missing: false };
}

/** Value used in statistics for a result, honouring the non-detect setting. */
export function statValue(value: number | null, qualifier: Qualifier, nd: NdHandling): number | null {
  if (value === null) return null;
  if (qualifier !== '<') return value;
  if (nd === 'half') return value / 2;
  if (nd === 'zero') return 0;
  return value;
}

/** Pretty-print a number with sensible significant figures. */
export function fmtNum(v: number | null | undefined, decimals?: number): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '';
  if (decimals !== undefined) return v.toFixed(decimals);
  const a = Math.abs(v);
  if (a === 0) return '0';
  if (a >= 10000) return Math.round(v).toLocaleString('en-NZ');
  if (a >= 100) return String(Math.round(v * 10) / 10);
  // 3 significant figures, trailing zeros trimmed
  const s = Number(v.toPrecision(3));
  if (a < 0.0001) return s.toExponential(2);
  return String(s);
}

export function fmtResult(value: number | null, qualifier: Qualifier, text?: string, decimals?: number): string {
  if (value === null) return text ?? '';
  return `${qualifier ? qualifier + ' ' : ''}${fmtNum(value, decimals)}`;
}
