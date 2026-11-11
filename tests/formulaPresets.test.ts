import { describe, expect, it } from 'vitest';
import { BUILT_IN_PARAMETERS } from '../src/data/parameters';
import type { Parameter } from '../src/db/types';
import { compileFormula } from '../src/lib/calculated';
import { evaluate, parseFormula } from '../src/lib/formula';
import { FORMULA_PRESETS, fillPreset, presetGroups, presetNotes } from '../src/lib/formulaPresets';

const LIB = BUILT_IN_PARAMETERS as Parameter[];
const preset = (id: string) => FORMULA_PRESETS.find((p) => p.id === id)!;
/** A filled preset worked out with these values, by the parameters' ids. */
function work(id: string, values: Record<string, number>, lib = LIB): number | null {
  const filled = fillPreset(preset(id), lib);
  const target = { id: '__new__', name: 'X', group: 'Other', unit: '', aliases: [] } as Parameter;
  const c = compileFormula(target, lib, filled.formula);
  if ('error' in c) throw new Error(`${id}: ${c.error} in ${filled.formula}`);
  return evaluate(c.node, (ref) => values[c.inputs.get(ref)!]);
}

describe('ready-made calculations', () => {
  it('each is made with the library’s own parameters, and its formula is one the editor takes', () => {
    for (const p of FORMULA_PRESETS) {
      const filled = fillPreset(p, LIB);
      expect(filled.missing, p.id).toEqual([]);
      expect(filled.formula, p.id).not.toMatch(/[{}]/);
      expect(() => parseFormula(filled.formula), p.id).not.toThrow();
      const target = { id: '__new__', name: p.make.name, group: p.make.group, unit: p.make.unit, aliases: [] } as Parameter;
      expect('error' in compileFormula(target, LIB, filled.formula), `${p.id}: ${filled.formula}`).toBe(false);
      expect(presetNotes(filled), p.id).toEqual([]);
      // the library's own parameter for it is one the library has
      if (p.target) expect(LIB.some((x) => x.id === p.target), p.id).toBe(true);
    }
    expect(new Set(FORMULA_PRESETS.map((p) => p.id)).size).toBe(FORMULA_PRESETS.length);
    expect(presetGroups().flatMap((g) => g.items)).toHaveLength(FORMULA_PRESETS.length);
  });

  it('dissolved oxygen: mg/L from % saturation and back (9.09 mg/L at 20 °C in fresh water)', () => {
    expect(work('do-mgl', { 'do-sat': 100, temp: 20 })!).toBeCloseTo(9.09, 2);
    expect(work('do-mgl', { 'do-sat': 80, temp: 10 })!).toBeCloseTo(0.8 * 11.29, 1);
    expect(work('do-sat', { do: 9.092, temp: 20 })!).toBeCloseTo(100, 0);
    // a value it needs is missing: no answer
    expect(work('do-mgl', { 'do-sat': 100 })).toBeNull();
  });

  it('un-ionised ammonia: the share at the sample’s pH and temperature (Emerson et al. 1975)', () => {
    // published shares: 0.566 % at pH 7 and 25 °C, 5.38 % at pH 8 and 25 °C, 3.82 % at pH 8 and 20 °C
    expect(work('nh3-un', { 'nh4-n': 100, 'ph-field': 7, temp: 25 })!).toBeCloseTo(0.566, 1);
    expect(work('nh3-un', { 'nh4-n': 100, 'ph-field': 8, temp: 25 })!).toBeCloseTo(5.38, 1);
    expect(work('nh3-un', { 'nh4-n': 100, 'ph-field': 8, temp: 20 })!).toBeCloseTo(3.82, 1);
    // more of it in warmer, more alkaline water
    expect(work('nh3-un', { 'nh4-n': 1, 'ph-field': 9, temp: 25 })!).toBeGreaterThan(work('nh3-un', { 'nh4-n': 1, 'ph-field': 8, temp: 25 })!);
  });

  it('nitrogen: total, oxidised, inorganic and organic', () => {
    expect(work('tn', { tkn: 1.2, nnn: 0.8 })).toBeCloseTo(2.0, 10);
    expect(work('nnn', { 'no3-n': 0.75, 'no2-n': 0.05 })).toBeCloseTo(0.8, 10);
    expect(work('din', { 'nh4-n': 0.1, nnn: 0.8 })).toBeCloseTo(0.9, 10);
    expect(work('org-n', { tkn: 1.2, 'nh4-n': 0.1 })).toBeCloseTo(1.1, 10);
  });

  it('hardness, the sodium adsorption ratio, and a load', () => {
    expect(work('hardness', { 'ca-d': 40, 'mg-d': 10 })).toBeCloseTo(141.06, 2);
    // 10 meq/L of sodium over the root of 2 meq/L (half of 2 + 2)
    expect(work('sar', { 'na-d': 229.9, 'ca-d': 40.08, 'mg-d': 24.3 })!).toBeCloseTo(10 / Math.sqrt(2), 2);
    // 10 g/m³ at 100 L/s is 1 g/s: 86.4 kg a day
    expect(work('load', { tss: 10, flow: 100 })).toBeCloseTo(86.4, 10);
  });

  it('a parameter kept in another unit is changed to the unit the formula takes – and said', () => {
    const lib = LIB.map((p) => (p.id === 'flow' ? { ...p, unit: 'm³/s' } : p.id === 'tss' ? { ...p, unit: 'µg/L' } : p));
    const filled = fillPreset(preset('load'), lib);
    expect(filled.formula).toBe('([Total Suspended Solids] * 0.001) * ([Flow] * 1000) * 0.0864');
    expect(presetNotes(filled)).toEqual(['Total Suspended Solids is kept in µg/L: the formula changes it to mg/L.', 'Flow is kept in m³/s: the formula changes it to L/s.']);
    // 10 000 µg/L at 0.1 m³/s: the same 86.4 kg a day
    expect(work('load', { tss: 10000, flow: 0.1 }, lib)).toBeCloseTo(86.4, 8);
    // g/m³ is mg/L
    expect(fillPreset(preset('tn'), LIB.map((p) => (p.id === 'tkn' ? { ...p, unit: 'g/m³' } : p))).formula).toBe('[Total Kjeldahl Nitrogen] + [Nitrate-N + Nitrite-N]');
  });

  it('the parameters with results are used first; one the library hasn’t got is named, to be replaced', () => {
    // pH in the lab's results, none in the field: the lab's
    expect(fillPreset(preset('nh3-un'), LIB, (id) => (id === 'ph' ? 12 : 0)).used.map((u) => u.param.id)).toEqual(['nh4-n', 'ph', 'temp']);
    expect(fillPreset(preset('nh3-un'), LIB).used.map((u) => u.param.id)).toEqual(['nh4-n', 'ph-field', 'temp']);
    expect(fillPreset(preset('hardness'), LIB, (id) => (id.endsWith('-t') ? 3 : 0)).formula).toBe('2.497 * [Total Calcium] + 4.118 * [Total Magnesium]');
    const without = fillPreset(preset('tn'), LIB.filter((p) => p.id !== 'tkn'));
    expect(without.formula).toBe('[Total Kjeldahl Nitrogen] + [Nitrate-N + Nitrite-N]');
    expect(without.missing.map((m) => m.label)).toEqual(['Total Kjeldahl Nitrogen']);
    expect(presetNotes(without)[0]).toMatch(/no parameter for Total Kjeldahl Nitrogen/);
    // a unit of another kind can't be changed to it
    expect(fillPreset(preset('load'), LIB.map((p) => (p.id === 'flow' ? { ...p, unit: 'NTU' } : p))).missing.map((m) => m.key)).toEqual(['flow']);
    // never worked out from itself
    expect(fillPreset(preset('do-sat'), LIB, undefined, 'do').missing.map((m) => m.key)).toEqual(['do']);
  });
});
