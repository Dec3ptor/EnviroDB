import { describe, expect, it } from 'vitest';
import { addMonthsEom, extractDate, fromExcelSerial, parseDateAny, parseDateString, reportingYear } from '../src/lib/dates';
import { convert, normUnit, splitHeaderUnit } from '../src/lib/units';
import { parseValue } from '../src/lib/values';
import { percentile } from '../src/lib/stats';
import { BUILT_IN_PARAMETERS } from '../src/data/parameters';
import { buildParamIndex, matchParameter, matchSite } from '../src/lib/matching';
import { guidelineInUnit, hardnessModify, plainNumber, toInterval, verdict, verdictOutside } from '../src/lib/guidelines';
import type { Site } from '../src/db/types';

describe('dates', () => {
  it('parses NZ day-first dates', () => {
    expect(parseDateString('12/03/2024')).toBe('2024-03-12');
    expect(parseDateString('1/2/24')).toBe('2024-02-01');
    expect(parseDateString('12-Mar-2024')).toBe('2024-03-12');
    expect(parseDateString('12 March 2024 10:30 am')).toBe('2024-03-12T10:30');
    expect(parseDateString('2024-03-12T14:05:00')).toBe('2024-03-12T14:05');
    expect(parseDateString('Mar-2024')).toBe('2024-03-01');
    expect(parseDateString('31/02/2024')).toBeNull();
    expect(parseDateString('hello')).toBeNull();
  });
  it('converts Excel serials', () => {
    expect(fromExcelSerial(45363)).toBe('2024-03-12');
    expect(fromExcelSerial(45363.4375)).toBe('2024-03-12T10:30');
    expect(parseDateAny(45363)).toBe('2024-03-12');
  });
  it('extracts dates from sample names', () => {
    expect(extractDate('SW1 Upstream 12-Mar-2024 10:30 am')).toEqual({ date: '2024-03-12T10:30', rest: 'SW1 Upstream' });
    expect(extractDate('MW-3 14/02/2025')).toEqual({ date: '2025-02-14', rest: 'MW-3' });
    expect(extractDate('Downstream')).toBeNull();
  });
  it('handles reporting years and month-end arithmetic', () => {
    expect(reportingYear('2025-03-01', 7)).toEqual({ start: '2024-07-01', end: '2025-06-30', label: '2024/25' });
    expect(addMonthsEom('2025-06-30', 3)).toBe('2025-09-30');
    expect(addMonthsEom('2025-03-31', 3)).toBe('2025-06-30');
  });
});

describe('units', () => {
  it('normalises Hill Labs style units', () => {
    expect(normUnit('g/m³').key).toBe('g/m3');
    expect(normUnit('g/m3 as CaCO3')).toMatchObject({ key: 'g/m3', basis: 'as CaCO3' });
    expect(normUnit('µg/L').key).toBe('ug/l');
  });
  it('converts between units', () => {
    expect(convert(0.0021, 'g/m³', 'µg/L')).toBeCloseTo(2.1);
    expect(convert(25, 'mS/m', 'µS/cm')).toBeCloseTo(250);
    expect(convert(5, 'mg/L', 'mg/kg')).toBeNull();
    expect(convert(3, 'MPN/100mL', 'cfu/100mL')).toBe(3);
  });
  it('splits units out of headers', () => {
    expect(splitHeaderUnit('Dissolved Zinc (g/m3)')).toEqual({ name: 'Dissolved Zinc', unit: 'g/m3' });
    expect(splitHeaderUnit('TSS mg/L')).toEqual({ name: 'TSS', unit: 'mg/L' });
    expect(splitHeaderUnit('pH')).toEqual({ name: 'pH' });
  });
});

describe('values', () => {
  it('parses lab result text', () => {
    expect(parseValue('< 0.0010')).toMatchObject({ value: 0.001, qualifier: '<', dl: 0.001, missing: false });
    expect(parseValue('>2420')).toMatchObject({ value: 2420, qualifier: '>' });
    expect(parseValue('1,200')).toMatchObject({ value: 1200, qualifier: '' });
    expect(parseValue('0.5*')).toMatchObject({ value: 0.5 });
    expect(parseValue('ND')).toMatchObject({ value: null, qualifier: '<', missing: false });
    expect(parseValue('NS').missing).toBe(true);
    expect(parseValue('').missing).toBe(true);
    expect(parseValue(7.2)).toMatchObject({ value: 7.2 });
  });
});

describe('stats', () => {
  it('computes percentiles both ways', () => {
    const v = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(v, 50)).toBe(5.5);
    expect(percentile(v, 95)).toBeCloseTo(9.55);
    expect(percentile(v, 95, 'hazen')).toBe(10);
    expect(percentile(v, 50, 'hazen')).toBe(5.5);
  });
});

describe('analyte matching', () => {
  const idx = buildParamIndex(BUILT_IN_PARAMETERS);
  it('matches common names', () => {
    expect(matchParameter('Dissolved Zinc', idx).parameterId).toBe('zn-d');
    expect(matchParameter('Zinc (dissolved)', idx).parameterId).toBe('zn-d');
    expect(matchParameter('Zn - Dissolved', idx).parameterId).toBe('zn-d');
    expect(matchParameter('Total Recoverable Copper', idx).parameterId).toBe('cu-t');
    expect(matchParameter('Total Ammoniacal-N', idx).parameterId).toBe('nh4-n');
    expect(matchParameter('Total Suspended Solids', idx).parameterId).toBe('tss');
    expect(matchParameter('TSS (g/m3)', idx).parameterId).toBe('tss');
    expect(matchParameter('Electrical Conductivity (EC)', idx).parameterId).toBe('ec');
    expect(matchParameter('Escherichia coli', idx).parameterId).toBe('ecoli');
    expect(matchParameter('Total Hardness', idx).parameterId).toBe('hardness');
    expect(matchParameter('Dissolved As', idx).parameterId).toBe('as-d');
    expect(matchParameter('Nitrate-N + Nitrite-N', idx).parameterId).toBe('nnn');
  });
  it('uses lab section context', () => {
    expect(matchParameter('Zinc', idx, 'Heavy metals, dissolved, trace As,Cd,Cr,Cu,Ni,Pb,Zn').parameterId).toBe('zn-d');
  });
  it('flags ambiguous metals', () => {
    const m = matchParameter('Zn', idx);
    expect(m.parameterId).toBeNull();
    expect(m.candidates).toEqual(['zn-t', 'zn-d']);
  });
});

describe('site matching', () => {
  const sites = [
    { id: 'a', code: 'SW1', aliases: ['Upstream'] },
    { id: 'b', code: 'SW10', aliases: [] },
    { id: 'c', code: 'MW-3', name: 'Bore 3', aliases: [] },
  ] as unknown as Site[];
  it('matches whole tokens', () => {
    expect(matchSite('SW1 Upstream', sites).siteId).toBe('a');
    expect(matchSite('SW10', sites).siteId).toBe('b');
    expect(matchSite('MW3', sites).siteId).toBe('c');
    expect(matchSite('mw 3 north', sites).siteId).toBe('c');
    expect(matchSite('Upstream', sites).siteId).toBe('a');
    expect(matchSite('Something else', sites).siteId).toBeNull();
  });
});

describe('guideline comparison', () => {
  it('treats non-detects as intervals', () => {
    expect(verdict(toInterval(12, ''), '>', 10)).toBe('exceed');
    expect(verdict(toInterval(0.001, '<'), '>', 0.008)).toBe('ok');
    expect(verdict(toInterval(0.01, '<'), '>', 0.008)).toBe('inconclusive');
    expect(verdict(toInterval(1, '<'), '>=', 1)).toBe('ok');
    expect(verdictOutside(toInterval(6.2, ''), 6.5, 8.5)).toBe('exceed');
    expect(verdictOutside(toInterval(7, ''), 6.5, 8.5)).toBe('ok');
  });
  it('hardness-modifies trigger values (ANZECC 2000)', () => {
    expect(hardnessModify(8, 0.85, 30)).toBe(8);
    expect(hardnessModify(8, 0.85, 20)).toBe(8);
    expect(hardnessModify(8, 0.85, 90)).toBeCloseTo(8 * Math.pow(3, 0.85));
    expect(hardnessModify(8, 0.85, 1000)).toBeCloseTo(8 * Math.pow(400 / 30, 0.85));
  });
});

describe('guideline display units', () => {
  it('converts concentrations to the chosen unit and leaves other units alone', () => {
    expect(guidelineInUnit({ parameterId: 'zn-d', max: 8, unit: 'µg/L' }, 'g/m³')).toEqual({ min: undefined, max: 0.008, unit: 'g/m³' });
    expect(guidelineInUnit({ parameterId: 'b-d', max: 940, unit: 'µg/L' }, 'mg/L').max).toBeCloseTo(0.94, 12);
    expect(guidelineInUnit({ parameterId: 'no3-n', max: 2.4, unit: 'g/m3' }, 'µg/L').max).toBeCloseTo(2400, 9);
    expect(guidelineInUnit({ parameterId: 'ph', min: 6.5, max: 8.5, unit: 'pH' }, 'g/m³')).toEqual({ min: 6.5, max: 8.5, unit: 'pH' });
    expect(guidelineInUnit({ parameterId: 'ecoli', max: 260, unit: 'cfu/100mL' }, 'g/m³').unit).toBe('cfu/100mL');
    expect(guidelineInUnit({ parameterId: 'zn-d', max: 8, unit: 'µg/L' }, 'published')).toEqual({ min: undefined, max: 8, unit: 'µg/L' });
  });

  it('prints small values as plain decimals', () => {
    expect(plainNumber(1.4 * 0.001)).toBe('0.0014');
    expect(plainNumber(0.06 * 0.001)).toBe('0.00006');
    expect(plainNumber(0.00023 * 0.000001)).toBe('0.00000000023');
    expect(plainNumber(2500)).toBe('2500');
    expect(plainNumber(undefined)).toBe('');
  });
});
