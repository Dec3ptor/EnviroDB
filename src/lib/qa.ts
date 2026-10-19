// QA/QC checks on a project's results: field duplicates (RPD), blanks, ion balance, parts bigger than the whole
// (dissolved > total …), EC and TDS, field against lab readings, impossible values, holding times, the lab's own
// comments, detection limits above limits or raised, results unlike a site's history, and samples (or groups of
// analytes) that look swapped between sites. Pure: given the samples and results, it says what to look at and why.
//
// Duplicates and blanks are QC samples – at a site of type "Quality control", or marked on the sample – and are
// kept out of the monitoring data (statistics, compliance, graphs and reports).

import type { Parameter, QaRecord, Result, Sample, Settings, Site } from '../db/types';
import type { ProjectBundle } from './analysis';
import { ruleParamIds, withGuidelineLimit } from './compliance';
import { addDays, dayOf, daysBetween, toUtcMs } from './dates';
import { unitLabel, convert } from './units';
import { fmtNum } from './values';

import { isQcSample } from './qc';
export { QC_SITE_TYPE, isQcSample, isQcSite } from './qc';

const QC_NAME = /\b(dup(licate)?s?|qc|qa|blanks?|rinsate|trip|equip(ment)?)\b|^(dup|qc|qa|fb|tb|eb)[\s_-]?\d/i;
/** A sample name or site code that reads like a QC sample: "DUP1", "Field blank", "QC 2". */
export const looksLikeQc = (name: string) => QC_NAME.test(name.trim());
const BLANK_NAME = /blank|rinsate|equip|\btrip\b|^(fb|tb|eb)[\s_-]?\d/i;

export function qcKind(s: Pick<Sample, 'qc' | 'sampleName'>, site?: Pick<Site, 'code' | 'name'> | null): 'duplicate' | 'blank' {
  return s.qc ?? (BLANK_NAME.test(`${s.sampleName ?? ''} ${site?.code ?? ''} ${site?.name ?? ''}`) ? 'blank' : 'duplicate');
}

// ------------------------------------------------------------------ the findings

export type QaKind =
  | 'duplicate'
  | 'duplicate-link'
  | 'blank'
  | 'ion-balance'
  | 'part-whole'
  | 'ec-tds'
  | 'field-lab'
  | 'impossible'
  | 'holding'
  | 'lab-comment'
  | 'dl-limit'
  | 'dl-raised'
  | 'outlier'
  | 'swap';

/** What each check looks for, and how – for the QA/QC tab and reports. */
export const QA_KINDS: Record<QaKind, { title: string; about: string }> = {
  swap: { title: 'Possible bottle swaps', about: 'Two samples from the same round that each look like the other site’s usual results – swapped by the sampler, or by the lab for some analytes.' },
  outlier: { title: 'Unlike earlier results', about: 'A result far from the site’s other results (more than 3.5 robust standard deviations, on a log scale for concentrations) and outside their range.' },
  duplicate: { title: 'Field duplicates', about: 'Relative percent difference between a sample and its duplicate. Limits: 30% for results over 20× the detection limit, 50% for 10–20×, none closer to it.' },
  'duplicate-link': { title: 'Duplicates to pair up', about: 'A duplicate whose original sample isn’t set. A likely one is suggested from how alike the results are.' },
  blank: { title: 'Blanks', about: 'Anything found above the detection limit in a field, trip or equipment blank.' },
  'ion-balance': { title: 'Ion balance', about: 'Major cations against anions (meq/L). Expected within ±5%, or ±10% for low-ionic waters (anions under 3 meq/L).' },
  'part-whole': { title: 'Part bigger than the whole', about: 'Dissolved higher than total, ammonia or nitrate higher than total nitrogen, DRP higher than total phosphorus, E. coli higher than faecal coliforms … by more than 10% and the detection limit.' },
  'ec-tds': { title: 'EC and TDS', about: 'Total dissolved solids divided by conductivity – usually 0.55–0.75 (mg/L per µS/cm). Flagged outside 0.5–0.9.' },
  'field-lab': { title: 'Field against lab', about: 'Field meter readings against the lab’s for the same sample: EC more than 25% apart, pH more than 1 unit.' },
  impossible: { title: 'Impossible values', about: 'pH outside 0–14, negative concentrations.' },
  holding: { title: 'Holding times', about: 'Time from sampling to the lab receiving the sample, against usual holding times: micro 24 h; BOD, nitrate, nitrite, DRP, turbidity and colour 48 h; solids, ammonia and sulphide 7 days.' },
  'lab-comment': { title: 'Lab comments', about: 'Comments the lab made on the results.' },
  'dl-limit': { title: 'Detection limit above a limit', about: 'Below detection, but the detection limit is higher than a consent limit or guideline value – compliance can’t be shown.' },
  'dl-raised': { title: 'Raised detection limits', about: 'A detection limit at least 5× the usual one for the analyte (often a diluted sample).' },
};

export const QA_KIND_ORDER: QaKind[] = ['swap', 'outlier', 'duplicate', 'duplicate-link', 'blank', 'part-whole', 'ion-balance', 'ec-tds', 'field-lab', 'impossible', 'holding', 'lab-comment', 'dl-limit', 'dl-raised'];

export interface QaFinding {
  /** Stable: the same problem has the same key next time (decisions are kept by it). */
  key: string;
  kind: QaKind;
  /** 'check': needs a look; 'note': for information. */
  severity: 'check' | 'note';
  /** The sampling date (YYYY-MM-DD). */
  date: string;
  siteIds: string[];
  sampleIds: string[];
  /** The results it's about: those that could be left out. */
  resultIds: string[];
  parameterIds: string[];
  title: string;
  /** One line per result or reason. */
  lines: string[];
  /** For swaps: the two samples, and the analytes when only some look swapped. */
  swap?: { a: string; b: string; parameterIds?: string[] };
  /** For duplicates to pair: the likely original. */
  primary?: string;
  /** What was decided, when it has been. */
  record?: QaRecord;
}

export interface QaOptions {
  /** RPD limit (%) for duplicates over 20× the detection limit. */
  rpdLimit: number;
  /** RPD limit (%) for duplicates 10–20× the detection limit. */
  rpdLimitNearDl: number;
  /** How far from the site's other results (robust standard deviations) is unusual. */
  outlierZ: number;
}
export const QA_DEFAULTS: QaOptions = { rpdLimit: 30, rpdLimitNearDl: 50, outlierZ: 3.5 };

export interface QaInput {
  /** All the project's samples and results – QC samples and left-out results included. */
  samples: Sample[];
  results: Result[];
  sites: Site[];
  params: Map<string, Parameter>;
  /** Consent limits and guideline values by parameter, in the parameter's unit (for detection limits above them). */
  limits?: Map<string, Array<{ value: number; label: string }>>;
  /** Findings for samples taken in this range (all of the project's results are used as history). */
  start?: string;
  end?: string;
  options?: Partial<QaOptions>;
}

export interface DuplicateRow {
  dup: Sample;
  primary?: Sample;
  /** The original was suggested, not set. */
  guessed: boolean;
  parameterId: string;
  a?: Result;
  b?: Result;
  rpd: number | null;
  limit: number | null;
  /** null: no limit applies (below detection, near it, or micro). */
  pass: boolean | null;
}

export interface QaResult {
  findings: QaFinding[];
  duplicates: DuplicateRow[];
  /** The QC samples in the range. */
  qcSamples: Sample[];
}

// ------------------------------------------------------------------ values

interface Val {
  r: Result;
  /** In the parameter's unit; the detection limit for a non-detect. */
  v: number;
  nd: boolean;
  dl?: number;
}

function inUnit(r: Result, unit: string): Val | null {
  if (r.value === null || !Number.isFinite(r.value)) return null;
  const v = convert(r.value, r.unit, unit);
  if (v === null) return null;
  const nd = r.qualifier === '<';
  const rawDl = nd ? r.value : r.dl;
  const dl = rawDl !== undefined && rawDl !== null ? convert(rawDl, r.unit, unit) ?? undefined : undefined;
  return { r, v, nd, dl };
}

/** Parameters measured on a linear scale (the rest are concentrations, compared on a log scale). */
const LINEAR = new Set(['ph', 'ph-field', 'temp', 'do', 'do-sat', 'orp', 'swl']);
const LINEAR_FLOOR: Record<string, number> = { ph: 0.15, 'ph-field': 0.15, temp: 1, do: 0.5, 'do-sat': 5, orp: 20, swl: 0.1 };
const MICRO = /micro|bacteri/i;

const med = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};

interface Series {
  /** Value on the comparison scale, by sample; non-detects as half the detection limit. */
  pts: Array<{ sampleId: string; day: string; x: number; raw: number; nd: boolean }>;
}

interface Stats {
  med: number;
  /** Robust spread (scaled MAD, with a floor). */
  s: number;
  lo: number;
  hi: number;
  n: number;
  /** Range of the raw values, for messages. */
  rawLo: number;
  rawHi: number;
  /** How many were below detection, and the highest detected. */
  nd: number;
  maxDetected?: number;
}

const scaleOf = (pid: string) => (LINEAR.has(pid) ? 'linear' : 'log');
const toScale = (pid: string, v: number) => (scaleOf(pid) === 'linear' ? v : Math.log10(Math.max(v, 1e-9)));

function statsOf(pid: string, pts: Series['pts']): Stats | null {
  if (pts.length < 2) return null;
  const xs = pts.map((p) => p.x);
  const m = med(xs);
  const mad = med(xs.map((x) => Math.abs(x - m))) * 1.4826;
  const floor = scaleOf(pid) === 'linear' ? Math.max(LINEAR_FLOOR[pid] ?? 0, Math.abs(m) * 0.02) : 0.1;
  const raws = pts.map((p) => p.raw);
  const detected = pts.filter((p) => !p.nd).map((p) => p.raw);
  return {
    med: m,
    s: Math.max(mad, floor),
    lo: Math.min(...xs),
    hi: Math.max(...xs),
    n: pts.length,
    rawLo: Math.min(...raws),
    rawHi: Math.max(...raws),
    nd: pts.length - detected.length,
    maxDetected: detected.length ? Math.max(...detected) : undefined,
  };
}

// ------------------------------------------------------------------ the checks

const HOLDING_HOURS: Record<string, number> = {
  ecoli: 24, fc: 24, tc: 24, entero: 24,
  bod5: 48, cbod5: 48, 'no3-n': 48, 'no2-n': 48, nnn: 48, drp: 48, turbidity: 48, 'colour-true': 48,
  tss: 168, vss: 168, tds: 168, 'nh4-n': 168, sulphide: 168,
};

const PART_WHOLE: Array<[string, string]> = [
  ['nh4-n', 'tkn'], ['tkn', 'tn'], ['nnn', 'tn'], ['no3-n', 'nnn'], ['no2-n', 'nnn'], ['nh4-n', 'tn'], ['drp', 'tp'],
  ['vss', 'tss'], ['doc', 'toc'], ['cbod5', 'bod5'], ['bod5', 'cod'], ['ecoli', 'fc'], ['fc', 'tc'],
];

/** Every check, for the samples in the range. */
export function runQa(input: QaInput): QaResult {
  const opt = { ...QA_DEFAULTS, ...input.options };
  const siteMap = new Map(input.sites.map((s) => [s.id, s]));
  const P = input.params;
  const inRange = (d: string) => (!input.start || dayOf(d) >= input.start) && (!input.end || dayOf(d) <= input.end);
  const used = input.results.filter((r) => !r.excluded);
  const bySample = new Map<string, Result[]>();
  for (const r of used) bySample.set(r.sampleId, [...(bySample.get(r.sampleId) ?? []), r]);
  // duplicates are compared result for result, left-out ones too (the comparison is about the sampling and the lab)
  const allBySample = new Map<string, Result[]>();
  for (const r of input.results) allBySample.set(r.sampleId, [...(allBySample.get(r.sampleId) ?? []), r]);
  const qc = (s: Sample) => isQcSample(s, siteMap.get(s.siteId));
  const monitoring = input.samples.filter((s) => !qc(s));
  const qcSamples = input.samples.filter((s) => qc(s) && inRange(s.date));
  const window = monitoring.filter((s) => inRange(s.date) && bySample.has(s.id));
  const sampleById = new Map(input.samples.map((s) => [s.id, s]));
  const findings: QaFinding[] = [];

  const pName = (pid: string) => P.get(pid)?.short ?? P.get(pid)?.name ?? pid;
  const unitOf = (pid: string) => P.get(pid)?.unit ?? '';
  const fmt = (pid: string, v: number, nd = false) => `${nd ? '<' : ''}${fmtNum(v, P.get(pid)?.decimals)}`;
  const withUnit = (pid: string, v: number, nd = false) => `${fmt(pid, v, nd)} ${unitLabel(unitOf(pid))}`.trim();
  const code = (siteId: string) => siteMap.get(siteId)?.code ?? '?';
  /** A sample's values by parameter, in the parameters' units. */
  const valuesOf = (sampleId: string, all = false) => {
    const m = new Map<string, Val>();
    for (const r of (all ? allBySample : bySample).get(sampleId) ?? []) {
      const v = inUnit(r, unitOf(r.parameterId));
      if (v) m.set(r.parameterId, v);
    }
    return m;
  };
  const vals = new Map<string, Map<string, Val>>();
  const V = (sampleId: string) => {
    let m = vals.get(sampleId);
    if (!m) vals.set(sampleId, (m = valuesOf(sampleId)));
    return m;
  };
  const allVals = new Map<string, Map<string, Val>>();
  const VA = (sampleId: string) => {
    let m = allVals.get(sampleId);
    if (!m) allVals.set(sampleId, (m = valuesOf(sampleId, true)));
    return m;
  };
  const add = (f: Omit<QaFinding, 'date'> & { date: string }) => findings.push({ ...f, date: dayOf(f.date) });

  // ---------------------------------------------------------------- history, by site and parameter
  const series = new Map<string, Series['pts']>();
  for (const s of monitoring) {
    for (const [pid, v] of V(s.id)) {
      if (v.v <= 0 && scaleOf(pid) === 'log' && !v.nd) continue;
      const raw = v.nd ? v.v / 2 : v.v;
      const k = `${s.siteId}|${pid}`;
      const list = series.get(k) ?? [];
      list.push({ sampleId: s.id, day: dayOf(s.date), x: toScale(pid, raw), raw, nd: v.nd });
      series.set(k, list);
    }
  }
  /** The site's results for a parameter on other days. */
  const history = (siteId: string, pid: string, day: string) => (series.get(`${siteId}|${pid}`) ?? []).filter((p) => p.day !== day);
  const statsCache = new Map<string, Stats | null>();
  const histStats = (siteId: string, pid: string, day: string) => {
    const k = `${siteId}|${pid}|${day}`;
    if (!statsCache.has(k)) statsCache.set(k, statsOf(pid, history(siteId, pid, day)));
    return statsCache.get(k)!;
  };
  const usualText = (pid: string, st: Stats) =>
    st.nd * 2 > st.n
      ? `mostly below detection before${st.maxDetected !== undefined ? `, highest ${fmt(pid, st.maxDetected)}` : ''}`
      : `usually ${fmt(pid, scaleOf(pid) === 'linear' ? st.med : 10 ** st.med)}, ${fmt(pid, st.rawLo)}–${fmt(pid, st.rawHi)} before`;

  // ---------------------------------------------------------------- duplicates
  const duplicates: DuplicateRow[] = [];
  for (const d of qcSamples) {
    if (qcKind(d, siteMap.get(d.siteId)) !== 'duplicate') continue;
    let primary = d.qcOf ? sampleById.get(d.qcOf) : undefined;
    let guessed = false;
    if (!primary) {
      const g = guessPrimary(d, monitoring, V);
      primary = g ? sampleById.get(g) : undefined;
      guessed = !!primary;
      add({
        key: `duplicate-link|${d.id}`,
        kind: 'duplicate-link',
        severity: 'check',
        date: d.date,
        siteIds: primary ? [primary.siteId] : [],
        sampleIds: [d.id],
        resultIds: [],
        parameterIds: [],
        title: primary ? `${d.sampleName || code(d.siteId)} looks like a duplicate of ${code(primary.siteId)}` : `${d.sampleName || code(d.siteId)}: which sample is it a duplicate of?`,
        lines: [primary ? 'Its results are closest to that sample’s. Confirm it, or choose another.' : 'No sample that day is clearly like it. Choose the original.'],
        primary: primary?.id,
      });
    }
    if (!primary) continue;
    const a = VA(primary.id);
    const b = VA(d.id);
    const failed: string[] = [];
    const failedIds: string[] = [];
    for (const pid of new Set([...a.keys(), ...b.keys()])) {
      const x = a.get(pid);
      const y = b.get(pid);
      const row: DuplicateRow = { dup: d, primary, guessed, parameterId: pid, a: x?.r, b: y?.r, rpd: null, limit: null, pass: null };
      duplicates.push(row);
      if (!x || !y || (x.nd && y.nd)) continue;
      const mean = (x.v + y.v) / 2;
      if (mean <= 0) continue;
      row.rpd = (Math.abs(x.v - y.v) / mean) * 100;
      const dl = Math.max(x.dl ?? 0, y.dl ?? 0);
      if (MICRO.test(P.get(pid)?.group ?? '')) continue;
      row.limit = dl > 0 ? (mean >= 20 * dl ? opt.rpdLimit : mean >= 10 * dl ? opt.rpdLimitNearDl : null) : !x.nd && !y.nd ? opt.rpdLimit : null;
      if (row.limit === null) continue;
      row.pass = row.rpd <= row.limit;
      if (!row.pass) {
        failed.push(`${pName(pid)}: ${withUnit(pid, x.v, x.nd)} and ${fmt(pid, y.v, y.nd)} in the duplicate – RPD ${Math.round(row.rpd)}% (limit ${row.limit}%)`);
        failedIds.push(x.r.id);
      }
    }
    if (failed.length)
      add({
        key: `duplicate|${d.id}`,
        kind: 'duplicate',
        severity: 'check',
        date: d.date,
        siteIds: [primary.siteId],
        sampleIds: [primary.id, d.id],
        resultIds: failedIds,
        parameterIds: [],
        title: `Duplicate of ${code(primary.siteId)} differs for ${failed.length} analyte${failed.length === 1 ? '' : 's'}`,
        lines: failed,
      });
  }

  // ---------------------------------------------------------------- blanks
  for (const s of qcSamples) {
    if (qcKind(s, siteMap.get(s.siteId)) !== 'blank') continue;
    const found: string[] = [];
    const pids: string[] = [];
    for (const [pid, v] of V(s.id)) {
      if (v.nd || v.v <= 0 || (v.dl !== undefined && v.v <= v.dl)) continue;
      if (pid === 'ph' || pid === 'ec' || P.get(pid)?.group === 'Field') continue;
      // the samples that day, for scale
      const same = monitoring.filter((m) => dayOf(m.date) === dayOf(s.date)).map((m) => V(m.id).get(pid)).filter((x): x is Val => !!x && !x.nd);
      const range = same.length ? ` (samples that day: ${fmt(pid, Math.min(...same.map((x) => x.v)))}–${fmt(pid, Math.max(...same.map((x) => x.v)))})` : '';
      found.push(`${pName(pid)}: ${withUnit(pid, v.v)}${range}`);
      pids.push(pid);
    }
    if (found.length)
      add({ key: `blank|${s.id}`, kind: 'blank', severity: 'check', date: s.date, siteIds: [], sampleIds: [s.id], resultIds: [], parameterIds: pids, title: `Found in the blank${s.sampleName ? ` (${s.sampleName})` : ''}: ${found.length} analyte${found.length === 1 ? '' : 's'}`, lines: found });
  }

  // ---------------------------------------------------------------- each sample in the range
  const ndTypical = typicalDl(used, P);
  for (const s of window) {
    const v = V(s.id);
    const get = (...ids: string[]) => {
      for (const id of ids) {
        const x = v.get(id);
        if (x) return x;
      }
      return undefined;
    };
    const site = code(s.siteId);
    const base = { date: s.date, siteIds: [s.siteId], sampleIds: [s.id] };

    // ion balance
    const ca = get('ca-d', 'ca-t'), mg = get('mg-d', 'mg-t'), na = get('na-d', 'na-t'), k = get('k-d', 'k-t');
    const cl = get('cl'), so4 = get('so4'), alk = get('alkalinity'), hco3 = get('bicarbonate');
    if (ca && mg && na && k && cl && so4 && (alk || hco3)) {
      const mgl = (x: Val | undefined) => (!x || x.nd ? 0 : convert(x.r.value, x.r.unit, 'mg/L') ?? 0);
      const cat = mgl(ca) / 20.04 + mgl(mg) / 12.153 + mgl(na) / 22.99 + mgl(k) / 39.098 + mgl(get('nh4-n')) / 14.007;
      const an = (alk ? mgl(alk) / 50.04 : mgl(hco3) / 61.017) + mgl(cl) / 35.453 + mgl(so4) / 48.03 + mgl(get('nnn', 'no3-n')) / 14.007 + mgl(get('f')) / 18.998;
      if (cat + an > 0) {
        const diff = ((cat - an) / (cat + an)) * 100;
        const allowed = an < 3 ? 10 : 5;
        if (Math.abs(diff) > allowed)
          add({
            ...base,
            key: `ion-balance|${s.id}`,
            kind: 'ion-balance',
            severity: 'check',
            resultIds: [],
            parameterIds: [],
            title: `Ion balance ${diff > 0 ? '+' : ''}${diff.toFixed(1)}% at ${site}`,
            lines: [`Cations ${cat.toFixed(2)} meq/L, anions ${an.toFixed(2)} meq/L – expected within ±${allowed}%. An analyte may be wrong or missing.`],
          });
      }
    }

    // parts bigger than the whole
    const pw: Array<[string, string]> = [...PART_WHOLE];
    // a metal's fractions: dissolved ≤ acid soluble ≤ total
    for (const pid of v.keys()) {
      const m = /^(.+)-(d|as)$/.exec(pid);
      if (!m) continue;
      for (const whole of m[2] === 'd' ? [`${m[1]}-as`, `${m[1]}-t`] : [`${m[1]}-t`]) if (v.has(whole)) pw.push([pid, whole]);
    }
    for (const [partId, wholeId] of pw) {
      const part = v.get(partId), whole = v.get(wholeId);
      if (!part || !whole || part.nd) continue;
      const pv = convert(part.r.value, part.r.unit, unitOf(wholeId));
      if (pv === null) continue;
      const slack = Math.max(part.dl ?? 0, whole.dl ?? 0, whole.nd ? whole.v : 0);
      if (pv > whole.v * 1.1 && pv - whole.v > slack)
        add({
          ...base,
          key: `part-whole|${s.id}|${partId}|${wholeId}`,
          kind: 'part-whole',
          severity: 'check',
          resultIds: [part.r.id, whole.r.id],
          parameterIds: [partId, wholeId],
          title: `${P.get(partId)?.name ?? partId} higher than ${P.get(wholeId)?.name ?? wholeId} at ${site}`,
          lines: [`${pName(partId)} ${withUnit(wholeId, pv)} against ${pName(wholeId)} ${withUnit(wholeId, whole.v, whole.nd)}${whole.nd ? '' : ` (${Math.round((pv / whole.v - 1) * 100)}% higher)`}.`],
        });
    }

    // EC and TDS
    const ec = get('ec'), tds = get('tds');
    if (ec && tds && !ec.nd && !tds.nd) {
      const ecv = convert(ec.r.value, ec.r.unit, 'µS/cm'), tdsv = convert(tds.r.value, tds.r.unit, 'mg/L');
      if (ecv && tdsv && ecv > 0) {
        const ratio = tdsv / ecv;
        if (ratio < 0.5 || ratio > 0.9)
          add({ ...base, key: `ec-tds|${s.id}`, kind: 'ec-tds', severity: 'check', resultIds: [ec.r.id, tds.r.id], parameterIds: ['ec', 'tds'], title: `TDS/EC ratio ${ratio.toFixed(2)} at ${site}`, lines: [`TDS ${fmtNum(tdsv)} mg/L, EC ${fmtNum(ecv)} µS/cm – usually 0.55–0.75.`] });
      }
    }

    // field against lab
    const fec = get('ec-field');
    if (ec && fec && !ec.nd && !fec.nd) {
      const a = convert(ec.r.value, ec.r.unit, 'µS/cm') ?? 0, b = convert(fec.r.value, fec.r.unit, 'µS/cm') ?? 0;
      if (Math.max(a, b) > 0 && Math.abs(a - b) / Math.max(a, b) > 0.25 && Math.abs(a - b) > 30)
        add({ ...base, key: `field-lab|${s.id}|ec`, kind: 'field-lab', severity: 'check', resultIds: [ec.r.id, fec.r.id], parameterIds: ['ec', 'ec-field'], title: `Field and lab EC differ at ${site}`, lines: [`Lab ${fmtNum(a)} µS/cm, field ${fmtNum(b)} µS/cm. A swapped bottle, or the meter’s calibration?`] });
    }
    const ph = get('ph'), fph = get('ph-field');
    if (ph && fph && Math.abs(ph.v - fph.v) > 1)
      add({ ...base, key: `field-lab|${s.id}|ph`, kind: 'field-lab', severity: 'note', resultIds: [ph.r.id, fph.r.id], parameterIds: ['ph', 'ph-field'], title: `Field and lab pH differ at ${site}`, lines: [`Lab ${fmtNum(ph.v, 1)}, field ${fmtNum(fph.v, 1)}. Lab pH drifts as samples age; check the meter if it keeps happening.`] });

    // impossible values
    for (const [pid, x] of v) {
      const bad = (pid === 'ph' || pid === 'ph-field') && (x.v < 0 || x.v > 14) ? 'pH outside 0–14' : x.v < 0 && !['temp', 'orp', 'swl', 'flow'].includes(pid) ? 'a negative concentration' : null;
      if (bad) add({ ...base, key: `impossible|${x.r.id}`, kind: 'impossible', severity: 'check', resultIds: [x.r.id], parameterIds: [pid], title: `${pName(pid)} ${fmt(pid, x.v)} at ${site}`, lines: [`${bad[0].toUpperCase()}${bad.slice(1)} – a typing or import error?`] });
    }

    // holding times
    if (s.receivedOn) {
      const timed = s.date.length > 10 && s.receivedOn.length > 10;
      const hours = timed ? (toUtcMs(s.receivedOn) - toUtcMs(s.date)) / 3.6e6 : Math.max(0, daysBetween(dayOf(s.date), dayOf(s.receivedOn)) - 1) * 24;
      const late = [...v.keys()].filter((pid) => HOLDING_HOURS[pid] !== undefined && hours > HOLDING_HOURS[pid]);
      if (late.length) {
        const days = daysBetween(dayOf(s.date), dayOf(s.receivedOn));
        add({
          ...base,
          key: `holding|${s.id}`,
          kind: 'holding',
          severity: 'check',
          resultIds: late.map((pid) => v.get(pid)!.r.id),
          parameterIds: late,
          title: `Received ${timed ? `${Math.round(hours)} hours` : `${days} days`} after sampling at ${site}`,
          lines: late.map((pid) => `${pName(pid)}: usual holding time ${HOLDING_HOURS[pid] < 72 ? `${HOLDING_HOURS[pid]} h` : `${HOLDING_HOURS[pid] / 24} days`}`),
        });
      }
    }

    // the lab's comments
    (s.notes ?? '')
      .split('\n')
      .filter((l) => /^lab comment/i.test(l))
      .forEach((l) => {
        const serious = /holding|temperature|°c|warm|preserv|caution|interfer|matrix|dilut|insufficient|broken|leak|outside|exceed/i.test(l);
        add({ ...base, key: `lab-comment|${s.id}|${hash(l)}`, kind: 'lab-comment', severity: serious ? 'check' : 'note', resultIds: [], parameterIds: [], title: `Lab comment on ${site}`, lines: [l.replace(/^lab comment\s*/i, '')] });
      });

    // non-detects with raised detection limits
    const raised: string[] = [];
    const raisedIds: string[] = [];
    for (const [pid, x] of v) {
      const t = ndTypical.get(pid);
      if (x.nd && t && x.v >= 5 * t) {
        raised.push(`${pName(pid)} ${withUnit(pid, x.v, true)} (usually <${fmt(pid, t)})`);
        raisedIds.push(x.r.id);
      }
    }
    if (raised.length) add({ ...base, key: `dl-raised|${s.id}`, kind: 'dl-raised', severity: 'note', resultIds: raisedIds, parameterIds: [], title: `Raised detection limits at ${site}`, lines: raised });

    // unlike the site's other results
    const odd: string[] = [];
    const oddIds: string[] = [];
    const oddPids: string[] = [];
    for (const [pid, x] of v) {
      if (x.nd || (x.v <= 0 && scaleOf(pid) === 'log')) continue;
      const st = histStats(s.siteId, pid, dayOf(s.date));
      if (!st || st.n < 6) continue;
      const xs = toScale(pid, x.v);
      const z = (xs - st.med) / st.s;
      const margin = scaleOf(pid) === 'linear' ? 0 : 0.08;
      if (Math.abs(z) < opt.outlierZ || (xs <= st.hi + margin && xs >= st.lo - margin)) continue;
      const ratio = scaleOf(pid) === 'log' ? x.v / 10 ** st.med : 0;
      const units = ratio > 300 && ratio < 3000 ? ' – about 1000× usual: µg/L reported as mg/L?' : ratio > 0 && ratio < 1 / 300 && ratio > 1 / 3000 ? ' – about 1000× lower than usual: mg/L reported as µg/L?' : '';
      odd.push(`${pName(pid)} ${withUnit(pid, x.v)} (${usualText(pid, st)})${units}`);
      oddIds.push(x.r.id);
      oddPids.push(pid);
    }
    if (odd.length) add({ ...base, key: `outlier|${s.id}`, kind: 'outlier', severity: 'check', resultIds: oddIds, parameterIds: oddPids, title: `${odd.length} result${odd.length === 1 ? '' : 's'} unlike ${site}’s others`, lines: odd });
  }

  // ---------------------------------------------------------------- detection limits above limits (by analyte and day)
  if (input.limits?.size) {
    const byKey = new Map<string, { pid: string; day: string; items: Array<{ s: Sample; x: Val }>; limit: { value: number; label: string } }>();
    for (const s of window) {
      for (const [pid, x] of V(s.id)) {
        if (!x.nd) continue;
        const lims = input.limits.get(pid);
        if (!lims?.length) continue;
        const lowest = lims.reduce((a, b) => (b.value < a.value ? b : a));
        if (!(x.v > lowest.value)) continue;
        const k = `${pid}|${dayOf(s.date)}`;
        const e = byKey.get(k) ?? { pid, day: dayOf(s.date), items: [], limit: lowest };
        e.items.push({ s, x });
        byKey.set(k, e);
      }
    }
    for (const [k, e] of byKey)
      add({
        key: `dl-limit|${k}`,
        kind: 'dl-limit',
        severity: 'check',
        date: e.day,
        siteIds: [...new Set(e.items.map((i) => i.s.siteId))],
        sampleIds: e.items.map((i) => i.s.id),
        resultIds: e.items.map((i) => i.x.r.id),
        parameterIds: [e.pid],
        title: `${pName(e.pid)}: detection limit above the ${e.limit.label}`,
        lines: [`${e.items.map((i) => `${code(i.s.siteId)} ${fmt(e.pid, i.x.v, true)}`).join(', ')} ${unitLabel(unitOf(e.pid))} – the ${e.limit.label} is ${withUnit(e.pid, e.limit.value)}. Ask the lab for a lower detection limit next time.`],
      });
  }

  // ---------------------------------------------------------------- swaps between sites in the same round
  const swaps = findSwaps(window, V, histStats, P, code);
  // results a swap explains aren't unusual on their own
  for (const sw of swaps) {
    const pids = sw.swap?.parameterIds ? new Set(sw.swap.parameterIds) : null;
    for (let i = findings.length - 1; i >= 0; i--) {
      const f = findings[i];
      if (f.kind !== 'outlier' || !sw.sampleIds.includes(f.sampleIds[0])) continue;
      const keep = f.parameterIds.map((_, k) => k).filter((k) => pids && !pids.has(f.parameterIds[k]));
      if (!keep.length) findings.splice(i, 1);
      else {
        const n = keep.length;
        findings[i] = { ...f, parameterIds: keep.map((k) => f.parameterIds[k]), resultIds: keep.map((k) => f.resultIds[k]), lines: keep.map((k) => f.lines[k]), title: `${n} result${n === 1 ? '' : 's'} unlike ${code(f.siteIds[0])}’s others` };
      }
    }
  }
  findings.push(...swaps);

  findings.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0) || QA_KIND_ORDER.indexOf(a.kind) - QA_KIND_ORDER.indexOf(b.kind));
  return { findings, duplicates, qcSamples };
}

/** The usual detection limit of each analyte (median of the non-detects), where there are a few. */
function typicalDl(results: Result[], P: Map<string, Parameter>): Map<string, number> {
  const by = new Map<string, number[]>();
  for (const r of results) {
    if (r.qualifier !== '<' || r.value === null) continue;
    const v = convert(r.value, r.unit, P.get(r.parameterId)?.unit ?? r.unit);
    if (v === null || v <= 0) continue;
    by.set(r.parameterId, [...(by.get(r.parameterId) ?? []), v]);
  }
  const out = new Map<string, number>();
  for (const [pid, xs] of by) if (xs.length >= 3) out.set(pid, med(xs));
  return out;
}

/** The sample a duplicate is most like, that day or the day either side (when one clearly is). */
export function guessPrimary(dup: Sample, monitoring: Sample[], V: (id: string) => Map<string, Val>): string | undefined {
  const day = dayOf(dup.date);
  const near = new Set([addDays(day, -1), day, addDays(day, 1)]);
  const d = V(dup.id);
  const scored: Array<{ id: string; score: number }> = [];
  for (const s of monitoring) {
    if (!near.has(dayOf(s.date))) continue;
    const a = V(s.id);
    const diffs: number[] = [];
    for (const [pid, x] of d) {
      const y = a.get(pid);
      if (!y || x.nd || y.nd || x.v <= 0 || y.v <= 0) continue;
      diffs.push(Math.abs(Math.log10(x.v / y.v)));
    }
    if (diffs.length >= 3) scored.push({ id: s.id, score: med(diffs) + (dayOf(s.date) === day ? 0 : 0.05) });
  }
  scored.sort((a, b) => a.score - b.score);
  const [best, next] = scored;
  if (!best || best.score > 0.2) return undefined;
  if (next && next.score < Math.max(best.score * 1.5, best.score + 0.03)) return undefined;
  return best.id;
}

function findSwaps(
  window: Sample[],
  V: (id: string) => Map<string, Val>,
  histStats: (siteId: string, pid: string, day: string) => Stats | null,
  P: Map<string, Parameter>,
  code: (siteId: string) => string,
): QaFinding[] {
  const out: QaFinding[] = [];
  const sorted = [...window].sort((a, b) => (dayOf(a.date) < dayOf(b.date) ? -1 : dayOf(a.date) > dayOf(b.date) ? 1 : code(a.siteId).localeCompare(code(b.siteId), undefined, { numeric: true })));
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const A = sorted[i], B = sorted[j];
      if (daysBetween(dayOf(A.date), dayOf(B.date)) > 3) break;
      if (A.siteId === B.siteId) continue;
      const va = V(A.id), vb = V(B.id);
      // analytes that tell the two sites apart, measured in both samples
      const info: Array<{ pid: string; zAa: number; zBb: number; zAb: number; zBa: number; line: string }> = [];
      for (const [pid, xa] of va) {
        const xb = vb.get(pid);
        if (!xb || xa.nd || xb.nd || P.get(pid)?.group === 'Field') continue;
        if (scaleOf(pid) === 'log' && (xa.v <= 0 || xb.v <= 0)) continue;
        const sa = histStats(A.siteId, pid, dayOf(A.date)), sb = histStats(B.siteId, pid, dayOf(B.date));
        if (!sa || !sb || sa.n < 5 || sb.n < 5) continue;
        if (Math.abs(sa.med - sb.med) / Math.max(sa.s, sb.s) < 2) continue;
        const za = toScale(pid, xa.v), zb = toScale(pid, xb.v);
        const z = (x: number, st: Stats) => Math.min(8, Math.abs(x - st.med) / st.s);
        info.push({
          pid,
          zAa: z(za, sa),
          zBb: z(zb, sb),
          zAb: z(za, sb),
          zBa: z(zb, sa),
          line: `${P.get(pid)?.short ?? P.get(pid)?.name ?? pid}${unitLabel(P.get(pid)?.unit) ? ` (${unitLabel(P.get(pid)?.unit)})` : ''}: ${code(A.siteId)} ${fmtNum(xa.v, P.get(pid)?.decimals)} (usually ${fmtNum(scaleOf(pid) === 'log' ? 10 ** sa.med : sa.med, P.get(pid)?.decimals)}), ${code(B.siteId)} ${fmtNum(xb.v, P.get(pid)?.decimals)} (usually ${fmtNum(scaleOf(pid) === 'log' ? 10 ** sb.med : sb.med, P.get(pid)?.decimals)})`,
        });
      }
      const score = (list: typeof info) => ({
        now: list.reduce((t, x) => t + x.zAa ** 2 + x.zBb ** 2, 0) / (2 * list.length),
        swapped: list.reduce((t, x) => t + x.zAb ** 2 + x.zBa ** 2, 0) / (2 * list.length),
      });
      const looksSwapped = (sc: { now: number; swapped: number }) => sc.now >= 6 && sc.swapped <= sc.now / 4 && sc.swapped <= 3;
      const [a, b] = A.id < B.id ? [A, B] : [B, A];
      const base = { kind: 'swap' as const, severity: 'check' as const, date: A.date, siteIds: [A.siteId, B.siteId], sampleIds: [A.id, B.id] };
      if (info.length >= 3 && looksSwapped(score(info))) {
        const pids = [...new Set([...va.keys(), ...vb.keys()])].filter((pid) => P.get(pid)?.group !== 'Field');
        out.push({
          ...base,
          key: `swap|${a.id}|${b.id}|all`,
          resultIds: [...pids.map((pid) => va.get(pid)?.r.id), ...pids.map((pid) => vb.get(pid)?.r.id)].filter((x): x is string => !!x),
          parameterIds: info.map((x) => x.pid),
          title: `Possible bottle swap: ${code(A.siteId)} ↔ ${code(B.siteId)}`,
          lines: [...info.slice(0, 8).map((x) => x.line), `Each sample is much more like the other site’s usual results (score ${score(info).now.toFixed(1)} as labelled, ${score(info).swapped.toFixed(1)} swapped).`],
          swap: { a: A.id, b: B.id },
        });
        continue;
      }
      // only some analytes swapped – the lab mixed up one set of bottles (e.g. the metals)
      const groups = new Map<string, typeof info>();
      for (const x of info) {
        const g = P.get(x.pid)?.group ?? 'Other';
        groups.set(g, [...(groups.get(g) ?? []), x]);
      }
      const swappedGroups = [...groups].filter(([, list]) => list.length >= 2 && looksSwapped(score(list)));
      if (!swappedGroups.length) continue;
      const inGroups = swappedGroups.flatMap(([, list]) => list);
      const rest = info.filter((x) => !inGroups.includes(x));
      if (rest.length && score(rest).now > 4) continue;
      const names = swappedGroups.map(([g]) => g);
      const pids = [...new Set([...va.keys(), ...vb.keys()])].filter((pid) => names.includes(P.get(pid)?.group ?? 'Other') && va.has(pid) && vb.has(pid));
      out.push({
        ...base,
        key: `swap|${a.id}|${b.id}|${names.join('+')}`,
        resultIds: [...pids.map((pid) => va.get(pid)!.r.id), ...pids.map((pid) => vb.get(pid)!.r.id)],
        parameterIds: pids,
        title: `Possible swap of the ${names.map((g) => g.toLowerCase()).join(' and ')} bottles: ${code(A.siteId)} ↔ ${code(B.siteId)}`,
        lines: [...inGroups.slice(0, 8).map((x) => x.line), `These analytes fit the other site; the rest fit their own.`],
        swap: { a: A.id, b: B.id, parameterIds: pids },
      });
    }
  }
  return out;
}

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * Puts what was decided on each finding (by key). A swap made goes from the findings (the samples now fit their
 * sites), so a swap found again means the results were put back as labelled (the lab file imported again): it's open.
 */
export function withRecords(findings: QaFinding[], records: QaRecord[]): QaFinding[] {
  const by = new Map(records.map((r) => [r.key, r]));
  return findings.map((f) => {
    const r = by.get(f.key);
    if (!r || r.status === 'swapped') return r ? { ...f, lines: [...f.lines, `Swapped before (${r.at.slice(0, 10)}) – the results are back as labelled, perhaps imported again.`] } : f;
    return { ...f, record: r };
  });
}

/** Open findings – not yet accepted, acted on or queried. */
export const openFindings = (findings: QaFinding[]) => findings.filter((f) => !f.record);

// ------------------------------------------------------------------ from a project

/** The consent limits and guideline values to compare detection limits with, by parameter (in its unit). */
export function qaLimits(b: Pick<ProjectBundle, 'rules' | 'project' | 'setMap' | 'paramMap'>): Map<string, Array<{ value: number; label: string }>> {
  const out = new Map<string, Array<{ value: number; label: string }>>();
  const add = (pid: string, value: number | undefined, unit: string | undefined, label: string) => {
    const p = b.paramMap.get(pid);
    if (!p || value === undefined) return;
    const v = convert(value, unit || p.unit, p.unit);
    if (v === null || v <= 0) return;
    out.set(pid, [...(out.get(pid) ?? []), { value: v, label }]);
  };
  for (const raw of b.rules) {
    if (!raw.active) continue;
    const r = withGuidelineLimit(raw, b.setMap);
    const level = r.level.toLowerCase().startsWith('limit') ? 'consent limit' : r.level.toLowerCase();
    if (r.kind === 'guideline') {
      const set = r.guidelineSetId ? b.setMap.get(r.guidelineSetId) : undefined;
      for (const pid of ruleParamIds(r, b.setMap)) {
        const gv = set?.values.find((v) => v.parameterId === pid);
        add(pid, gv?.max, gv?.unit, set?.shortName ?? level);
      }
    } else if (r.parameterId && (r.operator === '>' || r.operator === '>=')) add(r.parameterId, r.value, r.unit, level);
    else if (r.parameterId && r.operator === 'outside') add(r.parameterId, r.max, r.unit, level);
  }
  for (const id of b.project.guidelineSetIds) {
    const set = b.setMap.get(id);
    for (const gv of set?.values ?? []) add(gv.parameterId, gv.max, gv.unit, set!.shortName);
  }
  return out;
}

/** The QA/QC checks' input for a project: its monitoring and QC samples, every result, limits and settings. */
export function qaInputFor(
  b: ProjectBundle,
  range: { start?: string; end?: string } = {},
  settings: Partial<Pick<Settings, 'qaRpdLimit' | 'qaRpdLimitNearDl' | 'qaOutlierZ'>> = {},
): QaInput {
  return {
    samples: [...b.samples, ...(b.qc?.samples ?? [])],
    results: [...b.index.allBySample.values()].flat(),
    sites: [...b.sites, ...(b.qc?.sites ?? [])],
    params: b.paramMap,
    limits: qaLimits(b),
    start: range.start,
    end: range.end,
    options: {
      ...(settings.qaRpdLimit ? { rpdLimit: settings.qaRpdLimit } : {}),
      ...(settings.qaRpdLimitNearDl ? { rpdLimitNearDl: settings.qaRpdLimitNearDl } : {}),
      ...(settings.qaOutlierZ ? { outlierZ: settings.qaOutlierZ } : {}),
    },
  };
}
