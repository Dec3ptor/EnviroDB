import type { NdHandling, Qualifier } from '../db/types';
import { parseDateAny } from './dates';
import { normUnit, unitLabel } from './units';

export interface ParsedValue {
  value: number | null;
  qualifier: Qualifier;
  text: string;
  dl?: number;
  /** True when the cell holds no result (blank, "NS", "-", "Dry" …) and should not be imported. */
  missing: boolean;
  /**
   * The cell says something, and it isn't a result this can read ("TNTC", "7.4 approx") – as opposed to saying there
   * is no result. It isn't imported either, but it's shown, so nothing in a file is left out unsaid.
   */
  unread?: boolean;
  /** A unit written after the number in the cell itself ("412 µS/cm"), for a result with no other unit. */
  unit?: string;
}

const MISSING = new Set([
  '', '-', '--', '—', '–', 'na', 'n/a', 'n.a.', 'ns', 'n/s', 'not sampled', 'no sample', 'nt', 'not tested', 'ntd',
  'dry', 'x', '#n/a', '#value!', '#ref!', '#div/0!', 'nil sample', 'no data', 'nd*', 'ins', 'insufficient sample',
  'not analysed', 'not analyzed', 'tba', 'tbc', 'pending', 'np', 'nr', 'n/r', 'not reported', 'blank', 'void', 'invalid', '?', '*',
  'is', 'i.s.', 'i/s', 'lnr', 'nm', 'n/m', 'null', 'nil', 'none', 'missed', 'completed', 'complete', 'done', 'ok', 'yes', 'y', 'n',
]);

/** Words that say there is no result (and why): "No result", "Not required", "Insufficient sample", "See comments". */
const NO_RESULT = /^(no|not|nil|none|insufficient|unable|awaiting|await|pending|cancel+ed|missed|missing|see|refer|sample\s+(lost|broken|not|damaged)|lost|broken|frozen|bottle|lab\s+error|subcontracted|sent\s+to)\b/i;
/** Only marks, no letters or digits: "----", "****", "..", "[ ]". */
const ONLY_MARKS = /^[\s\-–—_*.·•~=+/\\()[\]{}|#?!]+$/;

const NONDETECT_WORDS = /^(nd|n\.d\.|bdl|bql|<\s*dl|<\s*lor|<\s*mdl|<\s*pql|<\s*rl|<\s*lod|<\s*loq|not detected|none detected|non[- ]?detect(ed)?|undetected|below (the )?(detection|reporting|quantitation)( limit)?|less than (the )?(detection|reporting) limit|trace)$/i;

function toNumber(s: string): number | null {
  // "- 0.5": the sign belongs to the number
  let t = s.trim().replace(/^([-+])\s+(?=[\d.])/, '$1');
  // thousands apart: "1 200", "12 345.6" – a space anywhere else isn't part of a number ("7.4 6.9" is two)
  if (/^[-+]?\d{1,3}(?:[   ]\d{3})+(?:\.\d+)?$/.test(t)) t = t.replace(/[   ]/g, '');
  t = t.replace(/,(?=\d{3}(\D|$))/g, '');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** "at 20°C", "@ 21.5 °C": the temperature a reading was taken at, written after it. */
const AT_TEMPERATURE = /\s*(?:@|at)\s*-?\d+(?:\.\d+)?\s*(?:°|º|deg(?:rees)?\.?)?\s*C\.?$/i;

/** Whether what follows a number in a cell is its unit ("µS/cm", "pH Units", "g/m3 as CaCO3"). */
function unitAfter(rest: string): string | null {
  const r = rest.trim();
  if (!r || r.length > 24) return null;
  if (/^ph(\s*units?)?$/i.test(r) || /^units?$/i.test(r)) return 'pH';
  return normUnit(r).known ? unitLabel(r) : null;
}

/** Parse a lab/spreadsheet result cell: 12, "0.0021", "< 0.0010", ">2420", "ND", "NS", "1,200", "0.5*", "412 µS/cm". */
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
  let core = text.replace(/\s*\([^)]*\)\s*$/, '').replace(/[*#^†‡]+\d*\s*$/, '').replace(AT_TEMPERATURE, '').replace(/\s+[A-Za-z]{1,2}$/, '').trim();

  let qualifier: Qualifier = '';
  const q = core.match(/^(<=|>=|≤|≥|<|>|less than|greater than|lt|gt)\s*/i);
  if (q) {
    const sym = q[1].toLowerCase();
    qualifier = sym.startsWith('<') || sym === '≤' || sym === 'less than' || sym === 'lt' ? '<' : '>';
    core = core.slice(q[0].length).trim();
  }
  let n = toNumber(core);
  let unit: string | undefined;
  // "Not detected (see note 2)", "ND*": a non-detect with something after it
  if (n === null && !qualifier && NONDETECT_WORDS.test(core)) return { value: null, qualifier: '<', text, missing: false };
  if (n === null) {
    // the unit written after the number: "412 µS/cm", "7.4 pH Units", "0.5mg/L" (taken from the text before its flags were stripped)
    const whole = text.replace(/\s*\([^)]*\)\s*$/, '').replace(/[*#^†‡]+\d*\s*$/, '').replace(AT_TEMPERATURE, '').replace(/^(<=|>=|≤|≥|<|>|less than|greater than|lt|gt)\s*/i, '').trim();
    const m = whole.match(/^(.*?\d)\s*([^\d\s.,].*)$/);
    const u = m ? unitAfter(m[2]) : null;
    if (m && u) {
      n = toNumber(m[1]);
      if (n !== null) unit = u;
    }
    // or before it, as when a report's units column runs into its first result: "pH Units 7.4"
    if (n === null) {
      const lead = whole.match(/^(\D.*?)\s+((?:<=|>=|≤|≥|<|>)?\s*[-+]?[\d.,]+)$/);
      const lu = lead ? unitAfter(lead[1]) : null;
      if (lead && lu) {
        const lq = lead[2].match(/^(<=|>=|≤|≥|<|>)\s*/);
        const ln = toNumber(lq ? lead[2].slice(lq[0].length) : lead[2]);
        if (ln !== null) {
          n = ln;
          unit = lu;
          if (lq && !qualifier) qualifier = lq[1].startsWith('<') || lq[1] === '≤' ? '<' : '>';
        }
      }
    }
  }
  if (n === null) {
    if (qualifier === '<') return { value: null, qualifier, text, missing: false };
    // says there's no result, or isn't a result at all (a date, a row of dashes): nothing to import, nothing to say
    if (NO_RESULT.test(lower) || ONLY_MARKS.test(text) || parseDateAny(text)) return { value: null, qualifier: '', text, missing: true };
    return { value: null, qualifier: '', text, missing: true, unread: true };
  }
  return { value: n, qualifier, text, dl: qualifier === '<' ? n : undefined, missing: false, ...(unit ? { unit } : {}) };
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
  // 3 significant figures, trailing zeros trimmed – written out in full, never "5e-5"
  return plainDecimal(Number(v.toPrecision(3)));
}

/** A number written out in full: 0.00005, not 5e-5. */
export function plainDecimal(x: number): string {
  const s = String(x);
  if (!/e/i.test(s)) return s;
  const places = Math.min(100, Math.max(0, Math.ceil(-Math.log10(Math.abs(x))) + 3));
  return x.toFixed(places).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

export function fmtResult(value: number | null, qualifier: Qualifier, text?: string, decimals?: number): string {
  if (value === null) return text ?? '';
  return `${qualifier ? qualifier + ' ' : ''}${fmtNum(value, decimals)}`;
}
