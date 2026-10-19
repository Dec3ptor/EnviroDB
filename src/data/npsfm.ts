// The National Objectives Framework attribute bands of the National Policy Statement for Freshwater Management 2020
// (as amended), Appendix 2A (attributes requiring limits on resource use) and 2B (attributes requiring action plans) –
// those EnviroDB can grade from discrete samples. The NPS-FM is under review: check the version in force, and these
// values against it, before relying on a grade.

export type Band = 'A' | 'B' | 'C' | 'D' | 'E';

/** A statistic and how its value places a band: the first step it meets, or `else`. */
export interface NpsfmStat {
  key: 'median' | 'max' | 'p95' | 'p92' | 'p83' | 'over540' | 'over260';
  label: string;
  /** Lower values are better (most); higher are better (clarity, invertebrate indices). */
  higherIsBetter?: boolean;
  /** Band thresholds in order: a value at or better than `limit` is in `band` (strictly less for `strict`). */
  steps: Array<{ limit: number; band: Band; strict?: boolean }>;
  else: Band;
}

export type WaterKind = 'river' | 'lake';
export type LakeType = 'stratified' | 'polymictic' | 'brackish';

export interface NpsfmAttribute {
  id: string;
  name: string;
  appendix: '2A' | '2B';
  water: WaterKind[];
  /** The analyte, and others that stand in for it (nitrate-N + nitrite-N for nitrate-N). */
  parameterIds: string[];
  /** The unit of the band values. */
  unit: string;
  stats: NpsfmStat[];
  /** The worst band that still meets the national bottom line (none: no bottom line). */
  bottomLine?: Band;
  bottomLineText?: string;
  /** Results needed for a firm grade (fewer: provisional). */
  minResults: number;
  /** How the grade is worked out, for the notes. */
  note: string;
  /** Statistics that differ by the site's class (suspended sediment class, lake type, periphyton class). */
  byClass?: 'sediment' | 'lake' | 'periphyton';
}

const lower = (key: NpsfmStat['key'], label: string, a: number, b: number, c: number, d?: number): NpsfmStat => ({
  key,
  label,
  steps: [
    { limit: a, band: 'A' },
    { limit: b, band: 'B' },
    { limit: c, band: 'C' },
    ...(d !== undefined ? [{ limit: d, band: 'D' as Band }] : []),
  ],
  else: d !== undefined ? 'E' : 'D',
});
const higher = (key: NpsfmStat['key'], label: string, a: number, b: number, c: number): NpsfmStat => ({
  key,
  label,
  higherIsBetter: true,
  steps: [
    { limit: a, band: 'A' },
    { limit: b, band: 'B' },
    { limit: c, band: 'C' },
  ],
  else: 'D',
});

/** Visual clarity bands (m, median) by suspended sediment class. */
export const CLARITY_BY_CLASS: Record<1 | 2 | 3 | 4, [number, number, number]> = {
  1: [1.78, 1.55, 1.34],
  2: [0.93, 0.76, 0.61],
  3: [2.95, 2.57, 2.22],
  4: [1.38, 1.17, 0.98],
};

/** Total nitrogen bands (mg/m³, annual median) by lake type. */
export const LAKE_TN: Record<LakeType, [number, number, number]> = {
  stratified: [160, 350, 750],
  brackish: [160, 350, 750],
  polymictic: [300, 500, 800],
};

export const NPSFM_ATTRIBUTES: NpsfmAttribute[] = [
  {
    id: 'ecoli',
    name: 'E. coli',
    appendix: '2A',
    water: ['river', 'lake'],
    parameterIds: ['ecoli'],
    unit: 'cfu/100mL',
    stats: [
      { key: 'over540', label: '% over 540 /100 mL', steps: [{ limit: 5, band: 'A', strict: true }, { limit: 10, band: 'B' }, { limit: 20, band: 'C' }, { limit: 30, band: 'D' }], else: 'E' },
      { key: 'over260', label: '% over 260 /100 mL', steps: [{ limit: 20, band: 'A', strict: true }, { limit: 30, band: 'B' }, { limit: 34, band: 'C' }, { limit: 50, band: 'D' }], else: 'E' },
      { key: 'median', label: 'Median /100 mL', steps: [{ limit: 130, band: 'A' }, { limit: 260, band: 'D' }], else: 'E' },
      { key: 'p95', label: '95th percentile /100 mL', steps: [{ limit: 540, band: 'A' }, { limit: 1000, band: 'B' }, { limit: 1200, band: 'C' }], else: 'D' },
    ],
    minResults: 60,
    note: 'All four statistics: the band is the worst of them. At least 60 samples over up to 5 years. No national bottom line (councils set targets to improve).',
  },
  {
    id: 'nitrate',
    name: 'Nitrate (toxicity)',
    appendix: '2A',
    water: ['river'],
    parameterIds: ['no3-n', 'nnn'],
    unit: 'mg/L',
    stats: [lower('median', 'Annual median', 1.0, 2.4, 6.9), lower('p95', 'Annual 95th percentile', 1.5, 3.5, 9.8)],
    bottomLine: 'B',
    bottomLineText: '2.4 median, 3.5 95th percentile',
    minResults: 12,
    note: 'Nitrate-N (nitrate-N + nitrite-N where only that was measured).',
  },
  {
    id: 'ammonia',
    name: 'Ammonia (toxicity)',
    appendix: '2A',
    water: ['river', 'lake'],
    parameterIds: ['nh4-n'],
    unit: 'mg/L',
    stats: [lower('median', 'Annual median', 0.03, 0.24, 1.3), lower('max', 'Annual maximum', 0.05, 0.4, 2.2)],
    bottomLine: 'B',
    bottomLineText: '0.24 median, 0.40 maximum',
    minResults: 12,
    note: 'Ammoniacal-N adjusted to pH 8 with the sample’s pH (the pH dependence of the USEPA 2013 chronic criterion, which the NPS-FM conversion follows); unadjusted where no pH was measured.',
  },
  {
    id: 'periphyton',
    name: 'Periphyton (trophic state)',
    appendix: '2A',
    water: ['river'],
    parameterIds: ['peri-chla'],
    unit: 'mg/m²',
    stats: [lower('p92', '92nd percentile (default class)', 50, 120, 200)],
    bottomLine: 'C',
    bottomLineText: '200 mg chl-a/m²',
    minResults: 36,
    byClass: 'periphyton',
    note: 'Chlorophyll a: the 92nd percentile (83rd for productive-class rivers) of monthly samples over at least 3 years.',
  },
  {
    id: 'sediment',
    name: 'Suspended fine sediment',
    appendix: '2A',
    water: ['river'],
    parameterIds: ['clarity'],
    unit: 'm',
    stats: [higher('median', 'Median visual clarity', ...CLARITY_BY_CLASS[1])],
    bottomLine: 'C',
    bottomLineText: 'by suspended sediment class',
    minResults: 60,
    byClass: 'sediment',
    note: 'Median visual clarity (black disc) against the bands for the site’s suspended sediment class (1–4); monthly over 5 years.',
  },
  {
    id: 'lake-tn',
    name: 'Total nitrogen (lakes)',
    appendix: '2A',
    water: ['lake'],
    parameterIds: ['tn'],
    unit: 'mg/m³',
    stats: [lower('median', 'Annual median', ...LAKE_TN.stratified)],
    bottomLine: 'C',
    bottomLineText: '750 (seasonally stratified, brackish) or 800 (polymictic) mg/m³',
    minResults: 12,
    byClass: 'lake',
    note: 'Against the bands for the lake’s type (seasonally stratified and brackish, or polymictic).',
  },
  {
    id: 'lake-tp',
    name: 'Total phosphorus (lakes)',
    appendix: '2A',
    water: ['lake'],
    parameterIds: ['tp'],
    unit: 'mg/m³',
    stats: [lower('median', 'Annual median', 10, 20, 50)],
    bottomLine: 'C',
    bottomLineText: '50 mg/m³',
    minResults: 12,
    note: 'Annual median.',
  },
  {
    id: 'phytoplankton',
    name: 'Phytoplankton (trophic state)',
    appendix: '2A',
    water: ['lake'],
    parameterIds: ['chla'],
    unit: 'mg/m³',
    stats: [lower('median', 'Annual median', 2, 5, 12), lower('max', 'Annual maximum', 10, 25, 60)],
    bottomLine: 'C',
    bottomLineText: '12 median, 60 maximum mg chl-a/m³',
    minResults: 12,
    note: 'Chlorophyll a in the lake water.',
  },
  {
    id: 'drp',
    name: 'Dissolved reactive phosphorus',
    appendix: '2B',
    water: ['river'],
    parameterIds: ['drp'],
    unit: 'mg/L',
    stats: [lower('median', 'Median', 0.006, 0.01, 0.018), lower('p95', '95th percentile', 0.021, 0.03, 0.054)],
    minResults: 60,
    note: 'Monthly over 5 years. No national bottom line (an action plan attribute).',
  },
  {
    id: 'mci',
    name: 'Macroinvertebrates (MCI)',
    appendix: '2B',
    water: ['river'],
    parameterIds: ['mci'],
    unit: '',
    stats: [higher('median', 'Median MCI score', 130, 110, 90)],
    bottomLine: 'C',
    bottomLineText: 'MCI 90',
    minResults: 5,
    note: 'Macroinvertebrate Community Index, from annual samples.',
  },
  {
    id: 'qmci',
    name: 'Macroinvertebrates (QMCI)',
    appendix: '2B',
    water: ['river'],
    parameterIds: ['qmci'],
    unit: '',
    stats: [higher('median', 'Median QMCI score', 6.5, 5.5, 4.5)],
    bottomLine: 'C',
    bottomLineText: 'QMCI 4.5',
    minResults: 5,
    note: 'Quantitative MCI, from annual samples.',
  },
  {
    id: 'aspm',
    name: 'Macroinvertebrates (ASPM)',
    appendix: '2B',
    water: ['river'],
    parameterIds: ['aspm'],
    unit: '',
    stats: [higher('median', 'Median ASPM score', 0.6, 0.4, 0.3)],
    bottomLine: 'C',
    bottomLineText: 'ASPM 0.3',
    minResults: 5,
    note: 'Average Score Per Metric, from annual samples.',
  },
  {
    id: 'ecoli-contact',
    name: 'E. coli (primary contact sites)',
    appendix: '2B',
    water: ['river', 'lake'],
    parameterIds: ['ecoli'],
    unit: 'cfu/100mL',
    stats: [lower('p95', '95th percentile, bathing season', 130, 260, 540)],
    bottomLine: 'C',
    bottomLineText: '540 /100 mL',
    minResults: 20,
    note: 'Only for sites used for swimming: samples in the bathing season (1 November to 31 March).',
  },
];

/** Attributes EnviroDB can't grade from discrete samples – listed so the omission is plain. */
export const NPSFM_NOT_GRADED = [
  'Dissolved oxygen (needs continuous logging)',
  'Lake-bottom and mid-hypolimnetic dissolved oxygen',
  'Planktonic cyanobacteria (biovolume)',
  'Fish (index of biotic integrity)',
  'Deposited fine sediment (% cover)',
  'Ecosystem metabolism',
  'Submerged plants (natives and invasives)',
];

export const NPSFM_SOURCE = 'National Policy Statement for Freshwater Management 2020 (amended), Appendix 2A and 2B';

/** LAWA's band colours. */
export const BAND_COLOR: Record<Band, string> = { A: 'blue', B: 'teal', C: 'yellow', D: 'orange', E: 'red' };
