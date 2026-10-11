import type { GuidelineSet, GuidelineValue } from '../db/types';

// Built-in guideline library.
// IMPORTANT: values are provided for convenience and must be checked against the current published
// source before being relied on for compliance. Every set is editable (or duplicate it and edit).
//
// Sources:
//  - ANZECC & ARMCANZ (2000) Australian and New Zealand Guidelines for Fresh and Marine Water Quality,
//    Table 3.4.1 (toxicant trigger values) and Table 3.4.4 (hardness algorithms).
//  - ANZG (2018) adopted the ANZECC (2000) toxicant values as default guideline values (DGVs). Revised DGVs
//    have since been published for some toxicants, e.g. boron in freshwater (2021: 340/940/1500/2500 µg/L),
//    and bioavailability-based revisions for zinc, copper, nickel and ammonia in freshwater are being
//    published (2024–2026). See waterquality.gov.au for the current DGVs.
//  - Water Services (Drinking Water Standards for New Zealand) Regulations 2022, Schedule (MAVs).

const UPDATED = '2026-10-01';
const LEVELS = ['99', '95', '90', '80'] as const;
type Level = (typeof LEVELS)[number];

// [parameterId, [99, 95, 90, 80] in µg/L, hardness-dependent?, note]
type Row = [string, [number | null, number | null, number | null, number | null], boolean, string?];

const FRESH_2000: Row[] = [
  ['al-d', [27, 55, 80, 150], false, 'pH > 6.5'],
  ['as-d', [0.8, 13, 42, 140], false, 'As(V) values. As(III): 1 / 24 / 94 / 360 µg/L'],
  ['b-d', [90, 370, 680, 1300], false],
  ['cd-d', [0.06, 0.2, 0.4, 0.8], true, 'Hardness-dependent (at 30 mg/L CaCO3)'],
  ['cr-d', [0.01, 1.0, 6, 40], false, 'Cr(VI) values applied to dissolved chromium (conservative)'],
  ['cu-d', [1.0, 1.4, 1.8, 2.5], true, 'Hardness-dependent (at 30 mg/L CaCO3). Revised DOC-based copper DGVs are being published by ANZG'],
  ['pb-d', [1.0, 3.4, 5.6, 9.4], true, 'Hardness-dependent (at 30 mg/L CaCO3)'],
  ['mn-d', [1200, 1900, 2500, 3600], false],
  ['hg-d', [0.06, 0.6, 1.9, 5.4], false, 'Inorganic mercury'],
  ['ni-d', [8, 11, 13, 17], true, 'Hardness-dependent (at 30 mg/L CaCO3)'],
  ['se-d', [5, 11, 18, 34], false, 'Total selenium'],
  ['ag-d', [0.02, 0.05, 0.1, 0.2], false],
  ['zn-d', [2.4, 8.0, 15, 31], true, 'Hardness-dependent (at 30 mg/L CaCO3). ANZG (2024) published revised bioavailability-based zinc DGVs'],
  ['nh4-n', [320, 900, 1430, 2300], false, 'Total ammonia-N at pH 8 – adjust for pH'],
  ['cn-t', [4, 7, 11, 18], false, 'As un-ionised HCN'],
  ['sulphide', [0.5, 1.0, 1.5, 2.6], false, 'As un-ionised H2S'],
  ['chlorine', [0.4, 3, 6, 13], false, 'As total residual chlorine'],
  ['benzene', [600, 950, 1300, 2000], false],
  ['xylene-o', [200, 350, 470, 640], false],
  ['naphthalene', [2.5, 16, 37, 85], false],
  ['phenol', [85, 320, 600, 1200], false],
];

const MARINE_2000: Row[] = [
  ['cd-d', [0.7, 5.5, 14, 36], false],
  ['cr-d', [0.14, 4.4, 20, 85], false, 'Cr(VI) values applied to dissolved chromium (conservative)'],
  ['co-d', [0.005, 1, 14, 150], false],
  ['cu-d', [0.3, 1.3, 3, 8], false],
  ['pb-d', [2.2, 4.4, 6.6, 12], false],
  ['hg-d', [0.1, 0.4, 0.7, 1.4], false, 'Inorganic mercury'],
  ['ni-d', [7, 70, 200, 560], false],
  ['ag-d', [0.8, 1.4, 1.8, 2.6], false],
  ['v-d', [50, 100, 160, 280], false],
  ['zn-d', [7, 15, 23, 43], false],
  ['nh4-n', [500, 910, 1200, 1700], false, 'Total ammonia-N at pH 8'],
  ['cn-t', [2, 4, 7, 14], false],
  ['benzene', [500, 700, 900, 1300], false],
  ['naphthalene', [50, 70, 90, 120], false],
];

// ANZG (2021) boron in freshwater – supersedes the ANZECC (2000) boron values.
const FRESH_ANZG_OVERRIDES: Row[] = [['b-d', [340, 940, 1500, 2500], false, 'ANZG (2021) boron DGV']];

function buildSet(id: string, name: string, shortName: string, family: string, matrix: string, rows: Row[], level: Level, source: string, notes: string): GuidelineSet {
  const idx = LEVELS.indexOf(level);
  const values: GuidelineValue[] = [];
  for (const [parameterId, vals, hardness, note] of rows) {
    const v = vals[idx];
    if (v === null) continue;
    values.push({ parameterId, max: v, unit: 'µg/L', hardness: hardness || undefined, note });
  }
  return { id, name, shortName, family, matrix, source, notes, builtIn: true, values, updatedAt: UPDATED };
}

function merge(base: Row[], overrides: Row[]): Row[] {
  const map = new Map(base.map((r) => [r[0], r]));
  overrides.forEach((r) => map.set(r[0], r));
  return Array.from(map.values());
}

const ANZECC_SRC = 'ANZECC & ARMCANZ (2000) Australian and New Zealand Guidelines for Fresh and Marine Water Quality, Table 3.4.1';
const ANZG_SRC = 'ANZG (2018) Australian and New Zealand Guidelines for Fresh and Marine Water Quality – default guideline values (DGVs), incl. ANZG (2021) boron in freshwater';
const VERIFY = 'Check values against the current published guideline before relying on them for compliance. Hardness-dependent metals can be hardness-modified per sample (project setting).';

const sets: GuidelineSet[] = [];
for (const level of LEVELS) {
  sets.push(
    buildSet(`anzg-fw-${level}`, `ANZG (2018) Freshwater – ${level}% species protection`, `ANZG FW ${level}%`, 'ANZG (2018) default guideline values', 'Freshwater', merge(FRESH_2000, FRESH_ANZG_OVERRIDES), level, ANZG_SRC,
      `Toxicant DGVs for freshwater at ${level}% species protection (µg/L). ANZECC (2000) values except boron (ANZG 2021). Revised bioavailability-based DGVs for zinc (2024) and copper, nickel and ammonia (2026) should be calculated for site conditions where your consent references current ANZG DGVs. ${VERIFY}`),
  );
}
for (const level of LEVELS) {
  sets.push(
    buildSet(`anzecc-fw-${level}`, `ANZECC (2000) Freshwater – ${level}% species protection`, `ANZECC FW ${level}%`, 'ANZECC (2000) trigger values', 'Freshwater', FRESH_2000, level, ANZECC_SRC,
      `Original ANZECC (2000) freshwater toxicant trigger values at ${level}% protection (µg/L), for consents that reference ANZECC (2000) directly. ${VERIFY}`),
  );
}
for (const level of LEVELS) {
  sets.push(
    buildSet(`anzecc-mw-${level}`, `ANZECC (2000) Marine – ${level}% species protection`, `ANZECC MW ${level}%`, 'ANZECC (2000) trigger values', 'Marine', MARINE_2000, level, ANZECC_SRC,
      `ANZECC (2000) marine toxicant trigger values at ${level}% protection (µg/L). ${VERIFY}`),
  );
}

sets.push({
  id: 'anzecc-nz-lowland',
  name: 'ANZECC (2000) NZ lowland rivers – physical & chemical stressors',
  shortName: 'ANZECC NZ lowland',
  family: 'ANZECC (2000) physical & chemical stressors',
  matrix: 'Freshwater',
  source: 'ANZECC & ARMCANZ (2000) Tables 3.3.10 & 3.3.11 – default trigger values for slightly disturbed NZ lowland rivers',
  notes: `Default trigger values for physical and chemical stressors (nutrients as µg/L). ${VERIFY}`,
  builtIn: true,
  updatedAt: UPDATED,
  values: [
    { parameterId: 'tp', max: 33, unit: 'µg/L' },
    { parameterId: 'drp', max: 10, unit: 'µg/L', note: 'Filterable reactive phosphorus' },
    { parameterId: 'tn', max: 614, unit: 'µg/L' },
    { parameterId: 'nnn', max: 444, unit: 'µg/L', note: 'NOx' },
    { parameterId: 'nh4-n', max: 21, unit: 'µg/L', note: 'NH4+' },
    { parameterId: 'turbidity', max: 5.6, unit: 'NTU' },
    { parameterId: 'ph', min: 7.2, max: 7.8, unit: 'pH' },
    { parameterId: 'do-sat', min: 98, max: 105, unit: '% sat' },
  ],
});
sets.push({
  id: 'anzecc-nz-upland',
  name: 'ANZECC (2000) NZ upland rivers – physical & chemical stressors',
  shortName: 'ANZECC NZ upland',
  family: 'ANZECC (2000) physical & chemical stressors',
  matrix: 'Freshwater',
  source: 'ANZECC & ARMCANZ (2000) Tables 3.3.10 & 3.3.11 – default trigger values for slightly disturbed NZ upland rivers',
  notes: `Default trigger values for physical and chemical stressors (nutrients as µg/L). ${VERIFY}`,
  builtIn: true,
  updatedAt: UPDATED,
  values: [
    { parameterId: 'tp', max: 26, unit: 'µg/L' },
    { parameterId: 'drp', max: 9, unit: 'µg/L', note: 'Filterable reactive phosphorus' },
    { parameterId: 'tn', max: 295, unit: 'µg/L' },
    { parameterId: 'nnn', max: 167, unit: 'µg/L', note: 'NOx' },
    { parameterId: 'nh4-n', max: 10, unit: 'µg/L', note: 'NH4+' },
    { parameterId: 'turbidity', max: 4.1, unit: 'NTU' },
    { parameterId: 'ph', min: 7.3, max: 8.0, unit: 'pH' },
    { parameterId: 'do-sat', min: 99, max: 103, unit: '% sat' },
  ],
});

sets.push({
  id: 'dwsnz-2022',
  name: 'Drinking Water Standards for NZ (2022) – MAVs (selected)',
  shortName: 'DWSNZ MAV',
  family: 'Drinking water',
  matrix: 'Drinking water',
  source: 'Water Services (Drinking Water Standards for New Zealand) Regulations 2022 – Schedule, maximum acceptable values',
  notes: `Selected inorganic and microbiological MAVs (mg/L). Nitrate MAV is 50 mg/L as NO3 (= 11.3 mg/L as NO3-N; short-term). ${VERIFY}`,
  builtIn: true,
  updatedAt: UPDATED,
  values: [
    { parameterId: 'as-t', max: 0.01, unit: 'mg/L' },
    { parameterId: 'b-t', max: 2.4, unit: 'mg/L' },
    { parameterId: 'cd-t', max: 0.004, unit: 'mg/L' },
    { parameterId: 'cr-t', max: 0.05, unit: 'mg/L' },
    { parameterId: 'cu-t', max: 2, unit: 'mg/L' },
    { parameterId: 'pb-t', max: 0.01, unit: 'mg/L' },
    { parameterId: 'mn-t', max: 0.4, unit: 'mg/L' },
    { parameterId: 'hg-t', max: 0.007, unit: 'mg/L' },
    { parameterId: 'ni-t', max: 0.08, unit: 'mg/L' },
    { parameterId: 'no3-n', max: 11.3, unit: 'mg/L', note: '50 mg/L as NO3 (short-term)' },
    { parameterId: 'f', max: 1.5, unit: 'mg/L' },
    { parameterId: 'ecoli', max: 1, op: '>=', unit: 'cfu/100mL', note: 'Must be less than 1 per 100 mL' },
  ],
});

export const BUILT_IN_GUIDELINES: GuidelineSet[] = sets;
