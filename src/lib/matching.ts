import type { Parameter, Site } from '../db/types';
import { BUILT_IN_PARAMETERS, ELEMENT_NAMES } from '../data/parameters';

/** The aliases each built-in parameter comes with (anything else on it was added by someone). */
const BUILT_IN_ALIASES = new Map(BUILT_IN_PARAMETERS.map((p) => [p.id, p.aliases]));
import { splitHeaderUnit } from './units';

// ------------------------------------------------------------ analyte names

const SYNONYMS: Record<string, string> = {
  diss: 'dissolved', dis: 'dissolved', filtered: 'dissolved', filt: 'dissolved', soluble: 'dissolved', sol: 'dissolved',
  tot: 'total', unfiltered: 'total', recoverable: 'total', rec: 'total', tr: 'total', acid: 'total',
  sulfate: 'sulphate', sulfide: 'sulphide', aluminum: 'aluminium', fecal: 'faecal', colour: 'color',
  ammoniacal: 'ammonia', ammonium: 'ammonia', nitrogen: 'n', phosphorus: 'p', oxidised: 'oxidized',
  and: '', the: '', as: '', of: '', in: '', by: '', lab: '', laboratory: '', conc: '', concentration: '', value: '',
  // "pH - onsite reading", "Total Dissolved Solids - Gravimetric", "Total Nitrogen (Calculation)"
  onsite: 'field', insitu: 'field', situ: 'field', reading: '', readings: '', measured: '', measurement: '',
  gravimetric: '', calculation: '', calculated: '', calc: '',
};

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[µμ]/g, 'u')
    .replace(/&/g, ' and ')
    .replace(/\+/g, ' plus ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

const BASIS = new Set(['caco3', 'n', 'p', 'no3', 'no2', 'so4', 'cl', 'hco3', 'nh4', 'nh3', 'po4', 's', 'cn']);

/** Drop "as CaCO3" / "as N" style basis phrases so "as" can still mean arsenic elsewhere. */
function dropBasis(toks: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < toks.length; i++) {
    if (toks[i] === 'as' && i + 1 < toks.length && BASIS.has(toks[i + 1])) {
      i++;
      continue;
    }
    out.push(toks[i]);
  }
  return out;
}

/** "acid soluble", "acid sol", "acid-extractable": one fraction of its own (not "acid" + "soluble"). */
function joinAcidSoluble(toks: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < toks.length; i++) {
    if (toks[i] === 'acid' && ['soluble', 'sol', 'extractable'].includes(toks[i + 1])) {
      out.push('acidsoluble');
      i++;
    } else out.push(toks[i]);
  }
  return out;
}

/** Canonical key: synonyms applied, element symbols expanded, duplicates removed, tokens sorted. */
export function analyteKey(name: string): string {
  const { name: bare } = splitHeaderUnit(name);
  const toks = joinAcidSoluble(dropBasis(tokens(bare)))
    .map((t) => (t === 'as' ? t : t in SYNONYMS ? SYNONYMS[t] : t))
    .map((t) => ELEMENT_NAMES[t] ?? t)
    .filter(Boolean);
  // A total/dissolved marker given as a lone "d"/"t" suffix (e.g. "Zn D", "Cu-T")
  const hasMetal = toks.some((t) => Object.values(ELEMENT_NAMES).includes(t));
  const mapped = toks.map((t) => (hasMetal && t === 'd' ? 'dissolved' : hasMetal && t === 't' ? 'total' : t));
  return Array.from(new Set(mapped)).sort().join(' ');
}

/** Plain normalisation (order preserved) for exact alias comparison. */
export function normName(s: string): string {
  return tokens(s).join(' ');
}

export interface ParamIndex {
  exact: Map<string, string>;
  keyed: Map<string, string[]>;
  params: Parameter[];
}

export function buildParamIndex(params: Parameter[]): ParamIndex {
  const exact = new Map<string, string>();
  const keyed = new Map<string, string[]>();
  const add = (k: string, id: string, map: Map<string, string[]>) => {
    const list = map.get(k) ?? [];
    if (!list.includes(id)) list.push(id);
    map.set(k, list);
  };
  // Names someone chose (their own parameters, and names added to built-in ones when matching a lab's file) take
  // precedence over the built-in names: built-ins first, then the rest overwrite.
  const own = (p: Parameter) => {
    const builtIn = p.builtIn ? new Set((BUILT_IN_ALIASES.get(p.id) ?? []).map(normName)) : null;
    return builtIn ? p.aliases.filter((a) => !builtIn.has(normName(a))) : p.aliases;
  };
  const ordered = [...params].sort((a, b) => Number(!!b.builtIn) - Number(!!a.builtIn));
  for (const p of ordered) {
    const mine = new Set(own(p));
    for (const n of [p.name, p.short ?? '', p.id, ...p.aliases.filter((a) => !mine.has(a))]) {
      if (!n) continue;
      exact.set(normName(n), p.id);
      add(analyteKey(n), p.id, keyed);
    }
  }
  for (const p of ordered)
    for (const n of own(p)) {
      if (!n) continue;
      exact.set(normName(n), p.id);
      add(analyteKey(n), p.id, keyed);
    }
  return { exact, keyed, params };
}

export interface ParamMatch {
  parameterId: string | null;
  confidence: 'exact' | 'high' | 'low' | 'none';
  candidates: string[];
}

function dice(a: string, b: string): number {
  const bigrams = (s: string) => {
    const out = new Map<string, number>();
    const t = s.replace(/\s+/g, ' ');
    for (let i = 0; i < t.length - 1; i++) {
      const g = t.slice(i, i + 2);
      out.set(g, (out.get(g) ?? 0) + 1);
    }
    return out;
  };
  const A = bigrams(a), B = bigrams(b);
  let inter = 0, total = 0;
  A.forEach((n, g) => {
    inter += Math.min(n, B.get(g) ?? 0);
    total += n;
  });
  B.forEach((n) => (total += n));
  return total ? (2 * inter) / total : 0;
}

/** Match an analyte name (optionally with lab section/group context) to a parameter. */
export function matchParameter(name: string, index: ParamIndex, group?: string): ParamMatch {
  const { name: bare } = splitHeaderUnit(name);
  const n = normName(bare);
  if (!n) return { parameterId: null, confidence: 'none', candidates: [] };
  const ex = index.exact.get(n);
  if (ex) return { parameterId: ex, confidence: 'exact', candidates: [ex] };

  // Group context: lab sections like "Heavy metals, dissolved, trace" disambiguate "Zinc".
  if (group) {
    const g = normName(group);
    // "acid soluble" before "soluble": a different fraction
    const fraction = /acid ?(soluble|sol|extractable)\b/.test(g) ? 'acid soluble' : /dissolved|filtered|soluble/.test(g) ? 'dissolved' : /total|recoverable|acid/.test(g) ? 'total' : '';
    if (fraction) {
      const k = analyteKey(`${fraction} ${bare}`);
      const hit = index.keyed.get(k);
      if (hit?.length === 1) return { parameterId: hit[0], confidence: 'high', candidates: hit };
    }
  }

  const key = analyteKey(bare);
  const hits = index.keyed.get(key);
  if (hits?.length === 1) return { parameterId: hits[0], confidence: 'high', candidates: hits };
  if (hits && hits.length > 1) return { parameterId: null, confidence: 'low', candidates: hits };

  // "Total Oxidised Nitrogen (NO2N + NO3N)", "Total Nitrogen (TN)": the name without its note in brackets
  const plain = bare.replace(/\s*[([][^()[\]]*[)\]]\s*$/, '').trim();
  if (plain && plain !== bare) {
    const m = matchParameter(plain, index, group);
    if (m.confidence === 'exact' || m.confidence === 'high') return { ...m, confidence: 'high' };
  }

  // Fuzzy: compare canonical keys
  const scored: Array<[string, number]> = [];
  index.keyed.forEach((ids, k) => {
    const s = dice(key, k);
    if (s >= 0.6) ids.forEach((id) => scored.push([id, s]));
  });
  // Metal without a fraction, e.g. "Zinc" or "Zn" → offer both total and dissolved
  const toks = key.split(' ');
  if (toks.length === 1 && Object.values(ELEMENT_NAMES).includes(toks[0])) {
    const sym = Object.entries(ELEMENT_NAMES).find(([, v]) => v === toks[0])?.[0];
    if (sym) {
      const both = [`${sym}-t`, `${sym}-d`].filter((id) => index.params.some((p) => p.id === id));
      return { parameterId: null, confidence: 'low', candidates: both };
    }
  }
  scored.sort((a, b) => b[1] - a[1]);
  const cands = Array.from(new Set(scored.map(([id]) => id))).slice(0, 5);
  if (scored.length && scored[0][1] >= 0.9 && (scored.length === 1 || scored[0][1] - scored[1][1] > 0.05)) {
    return { parameterId: scored[0][0], confidence: 'high', candidates: cands };
  }
  return { parameterId: null, confidence: cands.length ? 'low' : 'none', candidates: cands };
}

// ------------------------------------------------------------ site names

function compact(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function siteKeys(site: Site): string[] {
  return [site.code, site.name ?? '', ...site.aliases].filter((s) => s && s.trim().length > 0);
}

/**
 * Match a sample name such as "SW1 Upstream 12-Mar-2024 10:30 am" to a site.
 * Whole-token matching so "SW1" never matches "SW10".
 */
export function matchSite(sampleName: string, sites: Site[]): { siteId: string | null; score: number } {
  const name = sampleName.trim();
  if (!name) return { siteId: null, score: 0 };
  const nc = compact(name);
  const toks = tokens(name);
  // token n-grams (joined without separators) so "SW-1", "SW 1" and "SW1" all compare equal
  const grams = new Set<string>();
  for (let i = 0; i < toks.length; i++) {
    let acc = '';
    for (let j = i; j < Math.min(toks.length, i + 6); j++) {
      acc += toks[j];
      grams.add(acc);
    }
  }
  let best: { siteId: string | null; score: number } = { siteId: null, score: 0 };
  for (const site of sites) {
    for (const key of siteKeys(site)) {
      const kc = compact(key);
      if (!kc) continue;
      let score = 0;
      if (kc === nc) score = 1000 + kc.length;
      else if (grams.has(kc)) score = 100 + kc.length;
      if (score > best.score) best = { siteId: site.id, score };
    }
  }
  return best;
}
