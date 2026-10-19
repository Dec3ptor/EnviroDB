// Grading sites against the NPS-FM's attribute bands (definitions in data/npsfm.ts): the statistics of the results
// over a period (percentiles by the Hazen method), each placed in a band, the attribute's band the worst of them,
// and whether it meets the national bottom line.

import { CLARITY_BY_CLASS, LAKE_TN, NPSFM_ATTRIBUTES, type Band, type NpsfmAttribute, type NpsfmStat } from '../data/npsfm';
import type { Site } from '../db/types';
import type { ProjectBundle } from './analysis';
import { resultsFor } from './dataIndex';
import { percentile } from './stats';
import { convert } from './units';

export type SiteClass = NonNullable<Site['npsfm']>;

export interface NpsfmPoint {
  date: string;
  /** In the attribute's unit; the detection limit for a non-detect (graded at the limit). */
  value: number;
  nd: boolean;
  /** The sample's pH (for ammonia). */
  ph?: number;
}

export interface StatGrade {
  key: NpsfmStat['key'];
  label: string;
  value: number | null;
  band: Band | null;
}

export interface AttributeGrade {
  attribute: NpsfmAttribute;
  band: Band | null;
  stats: StatGrade[];
  n: number;
  from?: string;
  to?: string;
  /** Graded, but on fewer results than the NPS-FM asks for (or another caveat). */
  provisional?: string;
  /** Why it wasn't graded. */
  reason?: string;
  /** Meets the national bottom line (undefined: the attribute has none, or no grade). */
  meetsBottomLine?: boolean;
  /** The analyte used. */
  parameterId?: string;
  /** Ammonia: how many results were adjusted to pH 8. */
  adjusted?: number;
}

const ORDER: Band[] = ['A', 'B', 'C', 'D', 'E'];
const worst = (bands: Band[]) => bands.reduce((w, b) => (ORDER.indexOf(b) > ORDER.indexOf(w) ? b : w), 'A' as Band);

/** The band a statistic's value is in. */
export function statBand(stat: NpsfmStat, value: number): Band {
  for (const s of stat.steps) {
    const ok = stat.higherIsBetter ? value >= s.limit : s.strict ? value < s.limit : value <= s.limit;
    if (ok) return s.band;
  }
  return stat.else;
}

/** The pH dependence of ammonia's chronic toxicity (USEPA 2013). */
const phTerm = (ph: number) => 0.0278 / (1 + 10 ** (7.688 - ph)) + 1.1994 / (1 + 10 ** (ph - 7.688));
/** Ammoniacal-N at a sample's pH, as the equally toxic concentration at pH 8 (the NPS-FM's bands are for pH 8). */
export const ammoniaAtPh8 = (value: number, ph: number) => value * (phTerm(8) / phTerm(Math.min(9, Math.max(6, ph))));

/** How a site is graded: as set, or a river for a surface water site. */
export function siteClass(site: Pick<Site, 'type' | 'npsfm'>): SiteClass {
  const c = site.npsfm ?? {};
  return { ...c, water: c.water ?? (site.type === 'Surface water' ? 'river' : 'none') };
}

/** The attributes a site is graded on. */
export const attributesFor = (cls: SiteClass) => (cls.water && cls.water !== 'none' ? NPSFM_ATTRIBUTES.filter((a) => a.water.includes(cls.water as 'river' | 'lake') && (a.id !== 'ecoli-contact' || cls.primaryContact)) : []);

/** The statistics for an attribute at a site of this class (some depend on its class). */
function statsFor(a: NpsfmAttribute, cls: SiteClass): NpsfmStat[] | string {
  if (a.byClass === 'sediment') {
    if (!cls.sedimentClass) return 'Set the site’s suspended sediment class (1–4).';
    const [x, y, z] = CLARITY_BY_CLASS[cls.sedimentClass];
    return [{ ...a.stats[0], label: `Median visual clarity (class ${cls.sedimentClass})`, steps: [{ limit: x, band: 'A' }, { limit: y, band: 'B' }, { limit: z, band: 'C' }] }];
  }
  if (a.byClass === 'lake') {
    if (!cls.lakeType) return 'Set the lake type (seasonally stratified, polymictic or brackish).';
    const [x, y, z] = LAKE_TN[cls.lakeType];
    return [{ ...a.stats[0], label: `Annual median (${cls.lakeType})`, steps: [{ limit: x, band: 'A' }, { limit: y, band: 'B' }, { limit: z, band: 'C' }] }];
  }
  if (a.byClass === 'periphyton' && cls.periphyton === 'productive') return [{ ...a.stats[0], key: 'p83', label: '83rd percentile (productive class)' }];
  return a.stats;
}

function statValue(key: NpsfmStat['key'], xs: number[]): number | null {
  if (!xs.length) return null;
  switch (key) {
    case 'median':
      return percentile(xs, 50, 'hazen');
    case 'max':
      return Math.max(...xs);
    case 'p95':
      return percentile(xs, 95, 'hazen');
    case 'p92':
      return percentile(xs, 92, 'hazen');
    case 'p83':
      return percentile(xs, 83, 'hazen');
    case 'over540':
      return (xs.filter((x) => x > 540).length / xs.length) * 100;
    case 'over260':
      return (xs.filter((x) => x > 260).length / xs.length) * 100;
  }
}

/** Grade one attribute from a site's results for its analytes (in the attribute's unit). */
export function gradeAttribute(a: NpsfmAttribute, pointsFor: (parameterId: string) => NpsfmPoint[], cls: SiteClass): AttributeGrade {
  const base: AttributeGrade = { attribute: a, band: null, stats: [], n: 0 };
  const pid = a.parameterIds.find((id) => pointsFor(id).length);
  if (!pid) return { ...base, reason: 'No results.' };
  let pts = pointsFor(pid);
  // primary contact: the bathing season only (1 November – 31 March)
  if (a.id === 'ecoli-contact') pts = pts.filter((p) => [11, 12, 1, 2, 3].includes(+p.date.slice(5, 7)));
  if (!pts.length) return { ...base, parameterId: pid, reason: 'No results in the bathing season.' };
  let adjusted = 0;
  const xs = pts.map((p) => {
    if (a.id === 'ammonia' && p.ph !== undefined) {
      adjusted++;
      return ammoniaAtPh8(p.value, p.ph);
    }
    return p.value;
  });
  const stats = statsFor(a, cls);
  const dates = pts.map((p) => p.date.slice(0, 10)).sort();
  if (typeof stats === 'string') return { ...base, parameterId: pid, n: pts.length, reason: stats };
  const graded: StatGrade[] = stats.map((s) => {
    const v = statValue(s.key, xs);
    return { key: s.key, label: s.label, value: v, band: v === null ? null : statBand(s, v) };
  });
  const band = worst(graded.map((g) => g.band).filter((b): b is Band => !!b));
  const caveats = [
    pts.length < a.minResults ? `${pts.length} results – the NPS-FM asks for ${a.minResults}` : '',
    pid !== a.parameterIds[0] ? 'nitrate-N + nitrite-N used for nitrate-N' : '',
    a.id === 'ammonia' && adjusted < pts.length ? `${pts.length - adjusted} result${pts.length - adjusted === 1 ? '' : 's'} without a pH, not adjusted` : '',
  ].filter(Boolean);
  return {
    attribute: a,
    band,
    stats: graded,
    n: pts.length,
    from: dates[0],
    to: dates[dates.length - 1],
    provisional: caveats.length ? caveats.join('; ') : undefined,
    meetsBottomLine: a.bottomLine ? ORDER.indexOf(band) <= ORDER.indexOf(a.bottomLine) : undefined,
    parameterId: pid,
    adjusted: a.id === 'ammonia' ? adjusted : undefined,
  };
}

export interface SiteGrades {
  site: Site;
  cls: SiteClass;
  grades: AttributeGrade[];
}

/** Every site's grades over a period. */
export function projectNpsfm(b: ProjectBundle, start?: string, end?: string): SiteGrades[] {
  return b.sites.map((site) => {
    const cls = siteClass(site);
    const pointsFor = (pid: string): NpsfmPoint[] => {
      const a = NPSFM_ATTRIBUTES.find((x) => x.parameterIds.includes(pid));
      const unit = a?.unit || b.paramMap.get(pid)?.unit || '';
      return resultsFor(b.index, pid, [site.id], start, end).flatMap((r) => {
        const v = unit ? convert(r.value, r.unit, unit) : r.value;
        if (v === null) return [];
        const same = b.index.bySample.get(r.sampleId) ?? [];
        const phR = same.find((x) => x.parameterId === 'ph' && x.value !== null) ?? same.find((x) => x.parameterId === 'ph-field' && x.value !== null);
        return [{ date: r.date, value: v, nd: r.qualifier === '<', ph: phR?.value ?? undefined }];
      });
    };
    return { site, cls, grades: attributesFor(cls).map((a) => gradeAttribute(a, pointsFor, cls)) };
  });
}
