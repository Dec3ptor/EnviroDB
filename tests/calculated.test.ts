import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { db, ensureBuiltIns } from '../src/db/db';
import { newProject, newSite, saveProject, saveSite } from '../src/db/repo';
import { addSample, setCellValue } from '../src/db/edits';
import { doSaturation, evaluate, FormulaError, parseFormula } from '../src/lib/formula';
import { calculatedResults, compileAll, compileFormula, paramByRef } from '../src/lib/calculated';
import { pivot } from '../src/lib/analysis';
import type { Parameter, Result, Sample } from '../src/db/types';
import { loadBundle } from './helpers';

const calc = (src: string, values: Record<string, number> = {}) => evaluate(parseFormula(src).node, (r) => values[r]);

describe('formulas', () => {
  it('arithmetic as in maths, Excel’s functions, parameters in square brackets', () => {
    expect(calc('1 + 2 * 3')).toBe(7);
    expect(calc('(1 + 2) * 3')).toBe(9);
    expect(calc('2 ^ 3 ^ 2')).toBe(512);
    expect(calc('-2 ^ 2')).toBe(-4);
    expect(calc('10 / 4 − 1 × 2')).toBe(0.5);
    expect(calc('ROUND(PI(), 2) + ABS(-1) + SQRT(16) + MAX(1, 5, 3) + MIN(4, 2) + AVERAGE(1, 2, 3)')).toBeCloseTo(3.14 + 1 + 4 + 5 + 2 + 2, 10);
    expect(calc('LN(EXP(2)) + LOG10(1000) + LOG(8, 2) + POWER(2, 10)')).toBeCloseTo(2 + 3 + 3 + 1024, 10);
    expect(calc('IF([pH] < 7, 1, 2)', { pH: 6.5 })).toBe(1);
    expect(calc('IF([pH] >= 7, [a], [b])', { pH: 6, b: 9 })).toBe(9); // only the side taken needs its value
    expect(calc('[DO % saturation] / 100 * 9', { 'DO % saturation': 80 })).toBeCloseTo(7.2, 10);
    expect(parseFormula('[a] + [b] * [a]').refs).toEqual(['a', 'b']);
  });

  it('no value when one it needs is missing, or the answer isn’t a number', () => {
    expect(calc('[a] + 1', {})).toBeNull();
    expect(calc('1 / 0')).toBeNull();
    expect(calc('SQRT(-1)')).toBeNull();
  });

  it('says what’s wrong, and where', () => {
    const err = (src: string) => {
      try {
        parseFormula(src);
        return '';
      } catch (e) {
        return `${(e as FormulaError).message} @${(e as FormulaError).at}`;
      }
    };
    expect(err('temp * 2')).toMatch(/isn’t a function – put a parameter’s name in square brackets/);
    expect(err('[temp * 2')).toBe('A [ isn’t closed with ] @0');
    expect(err('NOPE(1)')).toMatch(/no function called NOPE/);
    expect(err('ROUND()')).toMatch(/ROUND takes 1–2 values/);
    expect(err('1 +')).toMatch(/stops too soon/);
    expect(err('1 2')).toMatch(/doesn’t fit/);
    expect(err('alert(1); [x]')).not.toBe(''); // nothing but arithmetic is ever understood
    expect(err('')).toMatch(/empty/);
  });

  it('DO_SAT: oxygen’s solubility as in APHA / the USGS tables', () => {
    expect(doSaturation(0)).toBeCloseTo(14.62, 2);
    expect(doSaturation(20)).toBeCloseTo(9.09, 2);
    expect(doSaturation(25)).toBeCloseTo(8.26, 2);
    // salt water, and up a hill
    expect(doSaturation(20, 35)).toBeCloseTo(7.37, 1);
    expect(doSaturation(20, 0, 90)).toBeLessThan(doSaturation(20) * 0.9);
    expect(calc('[DO %] / 100 * DO_SAT([Temp])', { 'DO %': 95, Temp: 14.2 })).toBeCloseTo(0.95 * doSaturation(14.2), 10);
  });
});

// ------------------------------------------------------------ calculated parameters

const P = (id: string, name: string, unit: string, formula?: string, extra: Partial<Parameter> = {}): Parameter => ({ id, name, group: 'Field', unit, aliases: [], ...(formula ? { formula } : {}), ...extra });
const S = (id: string): Sample => ({ id, projectId: 'p', siteId: 'site', date: '2026-10-01' });
const R = (sampleId: string, parameterId: string, value: number, unit: string, extra: Partial<Result> = {}): Result => ({ id: `${sampleId}-${parameterId}`, projectId: 'p', sampleId, siteId: 'site', date: '2026-10-01', parameterId, value, qualifier: '', unit, ...extra });

describe('calculated parameters', () => {
  const params = [P('temp', 'Temperature', '°C', undefined, { short: 'Temp' }), P('do-sat', 'Dissolved Oxygen Saturation', '% sat', undefined, { short: 'DO %' }), P('do', 'Dissolved Oxygen', 'mg/L', '[DO %] / 100 * DO_SAT([Temperature])')];

  it('a value in each sample with what the formula needs – a measured one always wins, nothing measured is touched', () => {
    const results = [
      R('a', 'temp', 14.2, '°C'),
      R('a', 'do-sat', 95, '% sat'),
      R('b', 'temp', 10, '°C'),
      R('b', 'do-sat', 100, '% sat'),
      R('b', 'do', 11.5, 'mg/L'), // measured: kept
      R('c', 'temp', 12, '°C'), // no DO %: nothing worked out
      R('d', 'temp', 12, '°C'),
      R('d', 'do-sat', 90, '% sat'),
      R('d', 'do', 1, 'mg/L', { excluded: { reason: 'meter fault', at: '' } }), // left out: not replaced
    ];
    const out = calculatedResults([S('a'), S('b'), S('c'), S('d')], results, params, 'dl');
    expect(out.map((r) => [r.sampleId, r.parameterId])).toEqual([['a', 'do']]);
    expect(out[0].value).toBeCloseTo(0.95 * doSaturation(14.2), 5);
    expect(out[0]).toMatchObject({ id: 'calc|a|do', unit: 'mg/L', calc: { formula: '[DO %] / 100 * DO_SAT([Temperature])', from: 'Dissolved Oxygen Saturation 95 % sat, Temperature 14.2 °C' } });
  });

  it('inputs in their own units; below detection as the project counts it; one worked out from another', () => {
    const ps = [P('zn', 'Zinc', 'mg/L'), P('cu', 'Copper', 'mg/L'), P('sum', 'Zn + Cu', 'mg/L', '[zn] + [cu]'), P('twice', 'Twice', 'mg/L', '[Zn + Cu] * 2')];
    const out = calculatedResults([S('a')], [R('a', 'zn', 50, 'µg/L'), R('a', 'cu', 0.002, 'mg/L', { qualifier: '<' })], ps, 'half');
    expect(out.map((r) => [r.parameterId, r.value])).toEqual([
      ['sum', 0.051],
      ['twice', 0.102],
    ]);
    expect(out[0].calc!.from).toBe('Zinc 0.05 mg/L, Copper <0.002 (taken as 0.001) mg/L');
  });

  it('a formula that doesn’t work is left out, with why – a loop too', () => {
    const ps = [P('x', 'X', '', '[y] + 1'), P('y', 'Y', '', '[x] + 1'), P('z', 'Z', '', '[nothing]'), P('w', 'W', '', '[w] * 2'), P('ok', 'OK', '', '[v] * 2'), P('v', 'V', '')];
    const { order, problems } = compileAll(ps);
    expect(order.map((c) => c.param.id)).toEqual(['ok']);
    expect(Object.fromEntries(problems)).toEqual({
      x: 'It’s worked out from itself, through other calculated parameters',
      y: 'It’s worked out from itself, through other calculated parameters',
      z: 'There’s no parameter called “nothing”',
      w: 'W can’t be worked out from itself',
    });
    expect(compileFormula(ps[0], ps, '[v] * ')).toMatchObject({ error: 'The formula stops too soon' });
    expect(paramByRef(params, 'do %')?.id).toBe('do-sat');
    expect(paramByRef(params, ' dissolved   oxygen ')?.id).toBe('do');
  });
});

// ------------------------------------------------------------ typed in, in the Data tab

describe('values typed into the Data tab', () => {
  let projectId = '';
  let siteId = '';
  beforeAll(async () => {
    await ensureBuiltIns();
    const p = newProject({ name: 'Edits', code: 'ED-1' });
    await saveProject(p);
    projectId = p.id;
    const s = newSite(projectId, { code: 'SW1' });
    await saveSite(s);
    siteId = s.id;
  });

  it('added, changed (the first value kept), taken off – each can be undone, and goes in the history', async () => {
    const { sample } = await addSample(projectId, siteId, '2026-10-02T09:30', 'SW1');
    const turb = (await db.parameters.get('turbidity'))!;
    const add = await setCellValue(sample, turb, '12', 'SW1');
    expect(add!.said).toBe('SW1 2 Oct 2026 Turbidity: 12 NTU added');
    let r = (await db.results.where('sampleId').equals(sample.id).toArray())[0];
    expect(r).toMatchObject({ value: 12, qualifier: '', unit: 'NTU', edited: { was: '' } });
    const change = await setCellValue(sample, turb, '14.5', 'SW1');
    expect(change!.said).toBe('SW1 2 Oct 2026 Turbidity: 12 → 14.5 NTU');
    expect(await setCellValue(sample, turb, '14.5', 'SW1')).toBeNull(); // nothing changed
    await setCellValue(sample, turb, '<0.5', 'SW1');
    r = (await db.results.get(r.id))!;
    expect(r).toMatchObject({ value: 0.5, qualifier: '<', dl: 0.5, edited: { was: '' } });
    await expect(setCellValue(sample, turb, 'cloudy', 'SW1')).rejects.toThrow(/isn’t a value/);
    const off = await setCellValue(sample, turb, '', 'SW1');
    expect(await db.results.get(r.id)).toBeUndefined();
    await off!.undo();
    expect((await db.results.get(r.id))!.value).toBe(0.5);
    await change!.undo(); // back to how it was before that change
    expect((await db.results.get(r.id))!.value).toBe(12);
    const history = (await db.audit.where('projectId').equals(projectId).toArray()).map((a) => a.text);
    expect(history).toContain('SW1 2 Oct 2026 Turbidity: 12 → 14.5 NTU');
    expect(history.some((t) => /Sample added by hand: SW1 2 Oct 2026/.test(t))).toBe(true);
  });

  it('a lab’s value changed by hand keeps what the lab said', async () => {
    const { sample } = await addSample(projectId, siteId, '2026-10-03', 'SW1');
    await db.results.put({ id: 'lab-1', projectId, sampleId: sample.id, siteId, date: sample.date, parameterId: 'tss', value: 8, qualifier: '', unit: 'mg/L', importId: 'imp-x' });
    const tss = (await db.parameters.get('tss'))!;
    await setCellValue(sample, tss, '9', 'SW1');
    await setCellValue(sample, tss, '10', 'SW1');
    expect(await db.results.get('lab-1')).toMatchObject({ value: 10, importId: 'imp-x', edited: { was: '8' } });
    // the same day again: the sample it has
    expect((await addSample(projectId, siteId, '2026-10-03T15:00', 'SW1')).added).toBe(false);
  });

  it('the project’s data shows a calculated parameter’s values – and an empty sample, and a column with no values yet, when asked', async () => {
    const { sample } = await addSample(projectId, siteId, '2026-10-04', 'SW1');
    await setCellValue(sample, (await db.parameters.get('temp'))!, '15', 'SW1');
    await setCellValue(sample, (await db.parameters.get('do-sat'))!, '92', 'SW1');
    await db.parameters.update('do', { formula: '[DO %] / 100 * DO_SAT([Temperature])' });
    const empty = (await addSample(projectId, siteId, '2026-10-05', 'SW1')).sample;
    const b = await loadBundle(projectId);
    const doNow = b.index.allBySample.get(sample.id)!.find((r) => r.parameterId === 'do')!;
    expect(doNow.value).toBeCloseTo(0.92 * doSaturation(15), 5);
    expect(doNow.calc).toBeDefined();
    // nothing stored
    expect(await db.results.where('sampleId').equals(sample.id).filter((r) => r.parameterId === 'do').count()).toBe(0);
    const grid = pivot(b, { siteIds: [], paramIds: [], start: '2026-10-01', end: '2026-10-31', empty: true, alwaysIds: ['ph'] });
    expect(grid.rows.some((r) => r.sample.id === empty.id)).toBe(true);
    expect(grid.columns.map((c) => c.id)).toContain('do');
    expect(grid.columns.map((c) => c.id)).toContain('ph');
    await db.parameters.update('do', { formula: undefined });
  });
});
