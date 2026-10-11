// Unit normalisation and conversion. Hill Laboratories reports water results in g/m³ (= mg/L);
// guideline values are commonly in µg/L, so conversion is needed for every comparison.

type Dim = 'conc' | 'soil' | 'ec' | 'count' | 'turb' | 'ph' | 'temp' | 'pct' | 'flow' | 'length' | 'mv' | 'ppt' | 'chl';

interface UnitDef {
  dim: Dim;
  factor: number; // multiply to convert to the dimension's base unit
  label: string; // preferred display label
}

// Base units: conc=mg/L, soil=mg/kg, ec=µS/cm, count=per 100 mL, flow=L/s, length=m
const DEFS: Record<string, UnitDef> = {
  'mg/l': { dim: 'conc', factor: 1, label: 'mg/L' },
  'g/m3': { dim: 'conc', factor: 1, label: 'g/m³' },
  ppm: { dim: 'conc', factor: 1, label: 'ppm' },
  'ug/l': { dim: 'conc', factor: 1e-3, label: 'µg/L' },
  'mg/m3': { dim: 'conc', factor: 1e-3, label: 'mg/m³' },
  ppb: { dim: 'conc', factor: 1e-3, label: 'ppb' },
  'ng/l': { dim: 'conc', factor: 1e-6, label: 'ng/L' },
  'g/l': { dim: 'conc', factor: 1e3, label: 'g/L' },
  'kg/m3': { dim: 'conc', factor: 1e3, label: 'kg/m³' },

  'mg/kg': { dim: 'soil', factor: 1, label: 'mg/kg' },
  'ug/kg': { dim: 'soil', factor: 1e-3, label: 'µg/kg' },
  'g/kg': { dim: 'soil', factor: 1e3, label: 'g/kg' },
  'g/100g': { dim: 'soil', factor: 1e4, label: 'g/100g' },
  '%w/w': { dim: 'soil', factor: 1e4, label: '% w/w' },

  'us/cm': { dim: 'ec', factor: 1, label: 'µS/cm' },
  'ms/cm': { dim: 'ec', factor: 1e3, label: 'mS/cm' },
  'ms/m': { dim: 'ec', factor: 10, label: 'mS/m' },
  'ds/m': { dim: 'ec', factor: 1e3, label: 'dS/m' },
  's/m': { dim: 'ec', factor: 1e4, label: 'S/m' },

  'cfu/100ml': { dim: 'count', factor: 1, label: 'cfu/100mL' },
  'mpn/100ml': { dim: 'count', factor: 1, label: 'MPN/100mL' },
  '/100ml': { dim: 'count', factor: 1, label: '/100mL' },
  'org/100ml': { dim: 'count', factor: 1, label: 'org/100mL' },
  'cfu/ml': { dim: 'count', factor: 100, label: 'cfu/mL' },
  'mpn/ml': { dim: 'count', factor: 100, label: 'MPN/mL' },

  ntu: { dim: 'turb', factor: 1, label: 'NTU' },
  fnu: { dim: 'turb', factor: 1, label: 'FNU' },
  ph: { dim: 'ph', factor: 1, label: 'pH units' },
  degc: { dim: 'temp', factor: 1, label: '°C' },
  '%': { dim: 'pct', factor: 1, label: '%' },
  '%sat': { dim: 'pct', factor: 1, label: '% sat' },

  'l/s': { dim: 'flow', factor: 1, label: 'L/s' },
  'm3/s': { dim: 'flow', factor: 1e3, label: 'm³/s' },
  'm3/day': { dim: 'flow', factor: 1e3 / 86400, label: 'm³/day' },
  'm3/hr': { dim: 'flow', factor: 1e3 / 3600, label: 'm³/hr' },
  'ml/day': { dim: 'flow', factor: 1e6 / 86400, label: 'ML/day' },

  m: { dim: 'length', factor: 1, label: 'm' },
  cm: { dim: 'length', factor: 0.01, label: 'cm' },
  mm: { dim: 'length', factor: 0.001, label: 'mm' },
  mv: { dim: 'mv', factor: 1, label: 'mV' },
  ppt: { dim: 'ppt', factor: 1, label: 'ppt' },
  psu: { dim: 'ppt', factor: 1, label: 'PSU' },
};

const ALIASES: Record<string, string> = {
  'g.m-3': 'g/m3', 'gm-3': 'g/m3', 'g/m^3': 'g/m3', 'gm3': 'g/m3', 'g/cubicm': 'g/m3',
  'mgl-1': 'mg/l', 'mg.l-1': 'mg/l', 'mg/litre': 'mg/l', 'mg/liter': 'mg/l', 'mgl': 'mg/l', 'mg/l)': 'mg/l',
  'ugl-1': 'ug/l', 'ug.l-1': 'ug/l', 'mcg/l': 'ug/l', 'ugl': 'ug/l',
  'ngl-1': 'ng/l',
  'mgkg-1': 'mg/kg', 'mg.kg-1': 'mg/kg', 'mg/kgdrywt': 'mg/kg', 'mg/kgdw': 'mg/kg', 'mg/kgdry': 'mg/kg', 'mg/kgdryweight': 'mg/kg',
  'ug/kgdrywt': 'ug/kg', 'ug/kgdw': 'ug/kg',
  'uscm-1': 'us/cm', 'us.cm-1': 'us/cm', 'umho/cm': 'us/cm', 'umhos/cm': 'us/cm',
  'mscm-1': 'ms/cm', 'msm-1': 'ms/m', 'ms.m-1': 'ms/m',
  'cfu/100mls': 'cfu/100ml', 'cfuper100ml': 'cfu/100ml', 'mpn/100mls': 'mpn/100ml', 'mpnper100ml': 'mpn/100ml',
  'n/100ml': '/100ml', 'no./100ml': '/100ml', 'no/100ml': '/100ml', 'per100ml': '/100ml', '100ml-1': '/100ml',
  'phunits': 'ph', 'phunit': 'ph', 'phu': 'ph', 'su': 'ph', 'unitless': 'ph',
  '°c': 'degc', 'oc': 'degc', 'c': 'degc', 'deg.c': 'degc', 'degreesc': 'degc', 'celsius': 'degc', '℃': 'degc',
  '%saturation': '%sat', 'percentsat': '%sat', '%s': '%sat', '%dosat': '%sat',
  'percent': '%', 'pct': '%',
  'l/sec': 'l/s', 'ls-1': 'l/s', 'litres/s': 'l/s', 'm3/d': 'm3/day', 'm3d-1': 'm3/day', 'cumecs': 'm3/s', 'm3/h': 'm3/hr',
  'mbgl': 'm', 'mbtoc': 'm', 'mrl': 'm', 'mamsl': 'm', 'mbgs': 'm', 'mbmp': 'm',
  'g/100gasrcvd': 'g/100g', 'g/100gdrywt': 'g/100g',
};

export interface NormUnit {
  key: string; // registry key or the cleaned raw string
  basis?: string; // e.g. "as CaCO3", "as N"
  known: boolean;
}

/** Normalise a unit string: "g/m³ as CaCO3" → { key: 'g/m3', basis: 'as CaCO3' }. */
export function normUnit(raw: string | undefined | null): NormUnit {
  if (!raw) return { key: '', known: false };
  let s = String(raw).trim();
  let basis: string | undefined;
  const asMatch = s.match(/\bas\s+([A-Za-z0-9-]+)\s*$/i);
  if (asMatch) {
    basis = `as ${asMatch[1]}`;
    s = s.slice(0, asMatch.index).trim();
  }
  s = s
    .replace(/[µμ]/g, 'u')
    .replace(/³/g, '3')
    .replace(/[()[\]]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();
  if (s === '' && basis) s = '';
  const key = DEFS[s] ? s : ALIASES[s] ?? s;
  return { key, basis, known: !!DEFS[key] };
}

export function unitLabel(raw: string | undefined | null): string {
  const n = normUnit(raw);
  if (!n.known) return raw ?? '';
  return DEFS[n.key].label;
}

/** Conversion factor from one unit to another, or null when incompatible/unknown. */
const factorCache = new Map<string, number | null>();
export function unitFactor(from: string | undefined, to: string | undefined): number | null {
  const ck = `${from}→${to}`;
  if (factorCache.has(ck)) return factorCache.get(ck)!;
  let result: number | null = null;
  const a = normUnit(from), b = normUnit(to);
  if (a.key === b.key) result = 1;
  else if (a.known && b.known && DEFS[a.key].dim === DEFS[b.key].dim) result = DEFS[a.key].factor / DEFS[b.key].factor;
  else if (!a.key || !b.key) result = 1; // one side unitless: assume same
  factorCache.set(ck, result);
  return result;
}

export function convert(value: number | null | undefined, from: string | undefined, to: string | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const f = unitFactor(from, to);
  return f === null ? null : value * f;
}

export function sameDimension(a: string | undefined, b: string | undefined): boolean {
  return unitFactor(a, b) !== null;
}

/** Split a header like "Dissolved Zinc (g/m3)" or "TSS mg/L" into name + unit. */
export function splitHeaderUnit(header: string): { name: string; unit?: string } {
  const h = header.replace(/\s+/g, ' ').trim();
  const bracket = h.match(/^(.*?)[\s,]*[([]\s*([^()[\]]+?)\s*[)\]]\s*$/);
  if (bracket) {
    const u = bracket[2];
    if (normUnit(u).known || /^(ph|ntu|°c)$/i.test(u)) return { name: bracket[1].trim(), unit: u };
  }
  const tail = h.match(/^(.*?)[\s,-]+((?:[µμu]g|mg|ng|g)\s*\/\s*(?:l|m3|m³|kg)|g\.m-3|mS\/m|[µμu]S\/cm|NTU|FNU|cfu\/100\s*mL|MPN\/100\s*mL)$/i);
  if (tail) return { name: tail[1].trim(), unit: tail[2] };
  return { name: h };
}

export const COMMON_UNITS = ['mg/L', 'g/m³', 'µg/L', 'ng/L', 'mg/kg', 'µg/kg', 'µS/cm', 'mS/m', 'NTU', 'pH units', '°C', '%', '% sat', 'cfu/100mL', 'MPN/100mL', 'L/s', 'm³/day', 'm', 'mV', 'mg/m³'];
