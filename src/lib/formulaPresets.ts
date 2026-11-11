// Ready-made calculations for the formula box: the usual things worked out from other results – dissolved oxygen in
// mg/L from % saturation, total nitrogen from its parts, a load from a concentration and a flow. Each names what it
// needs; the library's parameters are put in for them (the ones with results first), with a factor where a
// parameter is kept in another unit than the formula takes.

import type { Parameter } from '../db/types';
import { refText } from './formula';
import { unitFactor, unitLabel } from './units';
import { fmtNum } from './values';

export interface PresetInput {
  /** Its place in the formula: {key}. */
  key: string;
  /** What it is, when the library has nothing for it: written into the formula to be replaced. */
  label: string;
  /** The library's parameters it usually is, the likeliest first. */
  ids: string[];
  /** The unit the formula takes it in; a parameter in another unit of the same kind is converted. */
  unit: string;
}

export interface Preset {
  id: string;
  group: string;
  title: string;
  /** What it works out and where the formula is from, in a sentence. */
  about: string;
  /** The parameter it makes – used for the fields left blank. */
  make: { name: string; short?: string; unit: string; group: string; decimals?: number };
  /** The library's own parameter for it, when it has one: the formula belongs on that (it fills in where the lab gave no value). */
  target?: string;
  inputs: PresetInput[];
  /** With {key} where each input goes. */
  formula: string;
}

const N = { key: 'x', unit: 'mg/L' };

export const FORMULA_PRESETS: Preset[] = [
  {
    id: 'do-mgl',
    group: 'Field',
    title: 'Dissolved oxygen in mg/L, from % saturation',
    about: 'The % saturation times oxygen’s solubility at the water’s temperature (Benson & Krause 1984, fresh water at sea level).',
    make: { name: 'Dissolved Oxygen', short: 'DO', unit: 'mg/L', group: 'Field', decimals: 2 },
    target: 'do',
    inputs: [
      { key: 'sat', label: 'Dissolved Oxygen Saturation', ids: ['do-sat'], unit: '% sat' },
      { key: 'temp', label: 'Temperature', ids: ['temp'], unit: '°C' },
    ],
    formula: '{sat} / 100 * DO_SAT({temp})',
  },
  {
    id: 'do-sat',
    group: 'Field',
    title: 'Dissolved oxygen % saturation, from mg/L',
    about: 'The concentration as a percentage of oxygen’s solubility at the water’s temperature (fresh water at sea level).',
    make: { name: 'Dissolved Oxygen Saturation', short: 'DO %', unit: '% sat', group: 'Field', decimals: 0 },
    target: 'do-sat',
    inputs: [
      { key: 'do', label: 'Dissolved Oxygen', ids: ['do'], unit: 'mg/L' },
      { key: 'temp', label: 'Temperature', ids: ['temp'], unit: '°C' },
    ],
    formula: '{do} / DO_SAT({temp}) * 100',
  },
  {
    id: 'nh3-un',
    group: 'Nutrients',
    title: 'Un-ionised ammonia-N, from total ammoniacal-N, pH and temperature',
    about: 'The share of total ammonia that is un-ionised (NH₃) at the sample’s pH and temperature: 1 / (1 + 10^(pKa − pH)), with pKa = 0.09018 + 2729.92 / T in kelvin (Emerson et al. 1975).',
    make: { name: 'Un-ionised Ammonia-N', short: 'NH3-N', unit: 'mg/L', group: 'Nutrients', decimals: 4 },
    inputs: [
      { ...N, key: 'nh4', label: 'Total Ammoniacal-N', ids: ['nh4-n'] },
      { key: 'ph', label: 'pH', ids: ['ph-field', 'ph'], unit: 'pH' },
      { key: 'temp', label: 'Temperature', ids: ['temp'], unit: '°C' },
    ],
    formula: '{nh4} / (1 + 10 ^ (0.09018 + 2729.92 / ({temp} + 273.15) - {ph}))',
  },
  {
    id: 'tn',
    group: 'Nutrients',
    title: 'Total nitrogen, from TKN and nitrate + nitrite',
    about: 'Total Kjeldahl nitrogen (organic nitrogen and ammonia) plus the oxidised nitrogen.',
    make: { name: 'Total Nitrogen', short: 'TN', unit: 'mg/L', group: 'Nutrients' },
    target: 'tn',
    inputs: [
      { ...N, key: 'tkn', label: 'Total Kjeldahl Nitrogen', ids: ['tkn'] },
      { ...N, key: 'nnn', label: 'Nitrate-N + Nitrite-N', ids: ['nnn'] },
    ],
    formula: '{tkn} + {nnn}',
  },
  {
    id: 'nnn',
    group: 'Nutrients',
    title: 'Nitrate-N + nitrite-N, from each',
    about: 'The oxidised nitrogen: nitrate-N plus nitrite-N.',
    make: { name: 'Nitrate-N + Nitrite-N', short: 'NNN', unit: 'mg/L', group: 'Nutrients' },
    target: 'nnn',
    inputs: [
      { ...N, key: 'no3', label: 'Nitrate-N', ids: ['no3-n'] },
      { ...N, key: 'no2', label: 'Nitrite-N', ids: ['no2-n'] },
    ],
    formula: '{no3} + {no2}',
  },
  {
    id: 'din',
    group: 'Nutrients',
    title: 'Dissolved inorganic nitrogen (DIN)',
    about: 'Total ammoniacal-N plus nitrate-N and nitrite-N.',
    make: { name: 'Dissolved Inorganic Nitrogen', short: 'DIN', unit: 'mg/L', group: 'Nutrients' },
    inputs: [
      { ...N, key: 'nh4', label: 'Total Ammoniacal-N', ids: ['nh4-n'] },
      { ...N, key: 'nnn', label: 'Nitrate-N + Nitrite-N', ids: ['nnn'] },
    ],
    formula: '{nh4} + {nnn}',
  },
  {
    id: 'org-n',
    group: 'Nutrients',
    title: 'Organic nitrogen, from TKN and ammonia',
    about: 'Total Kjeldahl nitrogen less the total ammoniacal-N.',
    make: { name: 'Organic Nitrogen', short: 'Org-N', unit: 'mg/L', group: 'Nutrients' },
    inputs: [
      { ...N, key: 'tkn', label: 'Total Kjeldahl Nitrogen', ids: ['tkn'] },
      { ...N, key: 'nh4', label: 'Total Ammoniacal-N', ids: ['nh4-n'] },
    ],
    formula: '{tkn} - {nh4}',
  },
  {
    id: 'hardness',
    group: 'General chemistry',
    title: 'Total hardness (as CaCO₃), from calcium and magnesium',
    about: '2.497 × calcium + 4.118 × magnesium, each in mg/L (APHA 2340 B).',
    make: { name: 'Total Hardness', short: 'Hardness', unit: 'mg/L', group: 'General chemistry', decimals: 0 },
    target: 'hardness',
    inputs: [
      { key: 'ca', label: 'Calcium', ids: ['ca-d', 'ca-t'], unit: 'mg/L' },
      { key: 'mg', label: 'Magnesium', ids: ['mg-d', 'mg-t'], unit: 'mg/L' },
    ],
    formula: '2.497 * {ca} + 4.118 * {mg}',
  },
  {
    id: 'sar',
    group: 'General chemistry',
    title: 'Sodium adsorption ratio (SAR)',
    about: 'Sodium over the square root of half the calcium plus magnesium, each in milliequivalents per litre (mg/L ÷ 22.99, 20.04 and 12.15).',
    make: { name: 'Sodium Adsorption Ratio', short: 'SAR', unit: '', group: 'General chemistry', decimals: 1 },
    inputs: [
      { key: 'na', label: 'Sodium', ids: ['na-d', 'na-t'], unit: 'mg/L' },
      { key: 'ca', label: 'Calcium', ids: ['ca-d', 'ca-t'], unit: 'mg/L' },
      { key: 'mg', label: 'Magnesium', ids: ['mg-d', 'mg-t'], unit: 'mg/L' },
    ],
    formula: '({na} / 22.99) / SQRT(({ca} / 20.04 + {mg} / 12.15) / 2)',
  },
  {
    id: 'load',
    group: 'Loads',
    title: 'A load in kg/day, from a concentration and the flow',
    about: 'Concentration (mg/L, the same as g/m³) times flow (L/s) times 0.0864 – the seconds in a day over a million. Put your own analyte in place of total suspended solids.',
    make: { name: 'Suspended Solids Load', short: 'TSS load', unit: 'kg/day', group: 'Physical', decimals: 1 },
    inputs: [
      { key: 'conc', label: 'Total Suspended Solids', ids: ['tss'], unit: 'mg/L' },
      { key: 'flow', label: 'Flow', ids: ['flow'], unit: 'L/s' },
    ],
    formula: '{conc} * {flow} * 0.0864',
  },
];

export const presetGroups = (): Array<{ group: string; items: Array<{ value: string; label: string }> }> => {
  const groups = new Map<string, Array<{ value: string; label: string }>>();
  for (const p of FORMULA_PRESETS) groups.set(p.group, [...(groups.get(p.group) ?? []), { value: p.id, label: p.title }]);
  return [...groups].map(([group, items]) => ({ group, items }));
};

export interface PresetFilled {
  formula: string;
  /** What it was made with: each input's parameter, and the factor it's multiplied by (1: none). */
  used: Array<{ input: PresetInput; param: Parameter; factor: number }>;
  /** Inputs the library has no parameter for (or only one in a unit that can't be converted): named in the formula to be replaced. */
  missing: PresetInput[];
}

/**
 * A preset's formula with the library's parameters in it: for each input the first of its usual parameters that has
 * results (`count`), else the first the library has. A parameter kept in another unit is multiplied to the unit the
 * formula takes ("([Flow] * 1000)" for a flow kept in m³/s).
 */
export function fillPreset(preset: Preset, params: Parameter[], count: (id: string) => number = () => 0, self?: string): PresetFilled {
  const byId = new Map(params.map((p) => [p.id, p]));
  const used: PresetFilled['used'] = [];
  const missing: PresetInput[] = [];
  let formula = preset.formula;
  for (const input of preset.inputs) {
    const have = input.ids.map((id) => byId.get(id)).filter((p): p is Parameter => !!p && p.id !== self);
    const param = have.find((p) => count(p.id) > 0) ?? have[0];
    const factor = param ? unitFactor(param.unit, input.unit) : null;
    let text: string;
    if (!param || factor === null) {
      missing.push(input);
      text = `[${input.label}]`;
    } else {
      used.push({ input, param, factor });
      const ref = `[${refText(param)}]`;
      text = Math.abs(factor - 1) < 1e-12 ? ref : `(${ref} * ${fmtNum(Number(factor.toPrecision(10)))})`;
    }
    formula = formula.split(`{${input.key}}`).join(text);
  }
  return { formula, used, missing };
}

/** What a filled preset needs said about it: units converted, inputs to choose. */
export function presetNotes(f: PresetFilled): string[] {
  const out: string[] = [];
  for (const u of f.used) if (Math.abs(u.factor - 1) >= 1e-12) out.push(`${u.param.name} is kept in ${unitLabel(u.param.unit)}: the formula changes it to ${unitLabel(u.input.unit)}.`);
  if (f.missing.length) out.push(`The library has no parameter for ${f.missing.map((m) => m.label).join(' or ')} – put yours in its place (Insert a parameter…).`);
  return out;
}
