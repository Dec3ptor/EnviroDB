import type { Parameter, Result, Sample, Site } from '../db/types';
import { convert } from './units';
import { isQcSite } from './qc';

/**
 * Results organised for fast lookup: parameter → site → results sorted by date. Only the monitoring data: results
 * left out after a QA/QC check, and QC samples (duplicates and blanks), are kept apart (`allBySample`, `withheld`).
 */
export interface DataIndex {
  byParam: Map<string, Map<string, Result[]>>;
  bySample: Map<string, Result[]>;
  /** Every result of each sample – left out ones and QC samples' included (to edit a sample). */
  allBySample: Map<string, Result[]>;
  /** Results left out after a QA/QC check, by sample. */
  withheld: Map<string, Result[]>;
  sampleById: Map<string, Sample>;
  siteById: Map<string, Site>;
  paramById: Map<string, Parameter>;
  /** Hardness (mg/L as CaCO3) per sample: measured, or calculated from Ca and Mg. */
  hardness: Map<string, number>;
  dates: { min?: string; max?: string };
  paramIdsWithData: string[];
}

export function buildIndex(samples: Sample[], results: Result[], sites: Site[], params: Parameter[]): DataIndex {
  const byParam = new Map<string, Map<string, Result[]>>();
  const bySample = new Map<string, Result[]>();
  const allBySample = new Map<string, Result[]>();
  const withheld = new Map<string, Result[]>();
  const push = (m: Map<string, Result[]>, k: string, r: Result) => {
    const l = m.get(k);
    if (l) l.push(r);
    else m.set(k, [r]);
  };
  // QC samples: marked on the sample, or at a quality control site
  const qcSites = new Set(sites.filter((s) => isQcSite(s)).map((s) => s.id));
  const qcSamples = new Set(samples.filter((s) => s.qc || qcSites.has(s.siteId)).map((s) => s.id));
  let min: string | undefined, max: string | undefined;
  for (const r of results) {
    push(allBySample, r.sampleId, r);
    if (qcSamples.has(r.sampleId) || qcSites.has(r.siteId)) continue;
    if (r.excluded) {
      push(withheld, r.sampleId, r);
      continue;
    }
    let m = byParam.get(r.parameterId);
    if (!m) byParam.set(r.parameterId, (m = new Map()));
    let list = m.get(r.siteId);
    if (!list) m.set(r.siteId, (list = []));
    list.push(r);
    let sl = bySample.get(r.sampleId);
    if (!sl) bySample.set(r.sampleId, (sl = []));
    sl.push(r);
    if (!min || r.date < min) min = r.date;
    if (!max || r.date > max) max = r.date;
  }
  byParam.forEach((m) => m.forEach((list) => list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))));

  const hardness = new Map<string, number>();
  bySample.forEach((list, sampleId) => {
    const find = (id: string) => list.find((r) => r.parameterId === id && r.value !== null);
    const h = find('hardness');
    if (h && h.qualifier !== '<') {
      const v = convert(h.value, h.unit, 'mg/L');
      if (v !== null) {
        hardness.set(sampleId, v);
        return;
      }
    }
    const ca = find('ca-d') ?? find('ca-t');
    const mg = find('mg-d') ?? find('mg-t');
    if (ca && mg) {
      const cav = convert(ca.value, ca.unit, 'mg/L');
      const mgv = convert(mg.value, mg.unit, 'mg/L');
      if (cav !== null && mgv !== null) hardness.set(sampleId, 2.497 * cav + 4.118 * mgv);
    }
  });

  return {
    byParam,
    bySample,
    allBySample,
    withheld,
    sampleById: new Map(samples.map((s) => [s.id, s])),
    siteById: new Map(sites.map((s) => [s.id, s])),
    paramById: new Map(params.map((p) => [p.id, p])),
    hardness,
    dates: { min, max },
    paramIdsWithData: Array.from(byParam.keys()),
  };
}

/** Results for a parameter, optionally limited to some sites and a date range. */
export function resultsFor(index: DataIndex, parameterId: string, siteIds?: string[], start?: string, end?: string): Result[] {
  const m = index.byParam.get(parameterId);
  if (!m) return [];
  const out: Result[] = [];
  const sites = siteIds && siteIds.length ? siteIds : Array.from(m.keys());
  for (const sid of sites) {
    const list = m.get(sid);
    if (!list) continue;
    for (const r of list) {
      const d = r.date.slice(0, 10);
      if (start && d < start) continue;
      if (end && d > end) continue;
      out.push(r);
    }
  }
  return out;
}
