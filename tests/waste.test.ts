import { describe, expect, it } from 'vitest';
import type { GuidelineSet, Parameter, Result, Sample, Site } from '../src/db/types';
import { parseCriteria, TCLP_RATIO, wasteCell, wasteCheck, wasteCriteria, wasteCsv, WASTE_DEFAULTS, type WasteCriterion } from '../src/lib/waste';

// (made-up criteria and results, to test the arithmetic – not any landfill's)
const P = (id: string, name: string, matrix?: 'soil' | 'tclp', of?: string): Parameter => ({ id, name, group: matrix === 'soil' ? 'Soil' : 'Leach tests', unit: matrix === 'soil' ? 'mg/kg' : 'mg/L', aliases: [], ...(matrix ? { matrix } : {}), ...(of ? { of } : {}) });
const params = new Map(
  [
    P('pb-t', 'Total Lead'),
    P('pb-t-soil', 'Lead (soil)', 'soil', 'pb-t'),
    P('pb-t-tclp', 'Lead (TCLP)', 'tclp', 'pb-t'),
    P('as-t-soil', 'Arsenic (soil)', 'soil', 'as-t'),
    P('as-t-tclp', 'Arsenic (TCLP)', 'tclp', 'as-t'),
    P('zn-t-soil', 'Zinc (soil)', 'soil', 'zn-t'),
    P('zn-t-tclp', 'Zinc (TCLP)', 'tclp', 'zn-t'),
    P('tph-soil', 'TPH (soil)', 'soil', 'tph-total'),
  ].map((p) => [p.id, p]),
);
const set: Pick<GuidelineSet, 'values'> = {
  values: [
    { parameterId: 'pb-t-soil', max: 100, unit: 'mg/kg' }, // a total and a leachate limit
    { parameterId: 'pb-t-tclp', max: 5, unit: 'mg/L' },
    { parameterId: 'as-t-tclp', max: 500, unit: 'µg/L' }, // a leachate limit only, in another unit: 0.5 mg/L
    { parameterId: 'tph-soil', max: 2, unit: 'g/kg' }, // a total only: 2,000 mg/kg
    { parameterId: 'pb-t', max: 0.01, unit: 'mg/L' }, // a water value: no part of this
  ],
};

describe('a guideline set read as waste acceptance criteria', () => {
  it('pairs each contaminant’s total with its leachate limit; a limit with no total is screened at 20 times it', () => {
    const c = wasteCriteria(set, params);
    expect(c.map((x) => [x.name, x.total, x.leach, x.screen, x.screenFrom, x.soilId, x.leachId])).toEqual([
      ['Arsenic', undefined, 0.5, 10, 'leach', 'as-t-soil', 'as-t-tclp'],
      ['Lead', 100, 5, 100, 'set', 'pb-t-soil', 'pb-t-tclp'],
      ['TPH', 2000, undefined, 2000, 'set', 'tph-soil', undefined],
    ]);
    expect(TCLP_RATIO).toBe(20);
    // without the 20 times: no total to screen arsenic at
    expect(wasteCriteria(set, params, { ...WASTE_DEFAULTS, screen20: false }).find((x) => x.name === 'Arsenic')!.screen).toBeUndefined();
  });
});

describe('the two steps', () => {
  const [arsenic, lead, tph] = wasteCriteria(set, params);
  const t = (value: number, nd = false) => ({ value, nd });

  it('a total within the screening value passes; over it, a TCLP result decides', () => {
    expect(wasteCell(lead, t(80), undefined)).toMatchObject({ status: 'pass', why: 'total 80 mg/kg is within the screening value of 100' });
    expect(wasteCell(lead, t(100), undefined).status).toBe('pass'); // at the value is within it
    expect(wasteCell(lead, t(230), undefined)).toMatchObject({ status: 'need-leach', why: 'total 230 mg/kg is over the screening value of 100: a TCLP result decides (limit 5 mg/L)' });
    expect(wasteCell(lead, t(230), t(2.4))).toMatchObject({ status: 'pass-leach', why: 'TCLP 2.4 mg/L is within the limit of 5' });
    expect(wasteCell(lead, t(1100), t(8))).toMatchObject({ status: 'fail', why: 'TCLP 8 mg/L is over the limit of 5' });
    // a leach result alone is enough
    expect(wasteCell(lead, undefined, t(0.2)).status).toBe('pass-leach');
    expect(wasteCell(lead, undefined, undefined)).toMatchObject({ status: 'none', why: 'not tested' });
  });

  it('a leachate limit with no total: screened at 20 times the limit, or needing the test', () => {
    expect(wasteCell(arsenic, t(8), undefined)).toMatchObject({ status: 'pass', why: 'total 8 mg/kg is within the screening value of 10 (20 × the leachate limit)' });
    expect(wasteCell(arsenic, t(45), undefined).status).toBe('need-leach');
    const strict = wasteCriteria(set, params, { ...WASTE_DEFAULTS, screen20: false }).find((x) => x.name === 'Arsenic')!;
    expect(wasteCell(strict, t(8), undefined)).toMatchObject({ status: 'need-leach', why: 'the criteria give a leachate limit (0.5 mg/L) and no total to screen at: a TCLP result is needed' });
  });

  it('a total with no leachate limit is a limit: over it fails', () => {
    expect(wasteCell(tph, t(1500), undefined)).toMatchObject({ status: 'pass', why: 'total 1500 mg/kg is within the limit of 2000' });
    expect(wasteCell(tph, t(2600), undefined)).toMatchObject({ status: 'fail', why: 'total 2600 mg/kg is over the limit of 2000' });
  });

  it('a non-detect is within a limit its detection limit is under – and can’t be told where it’s over', () => {
    expect(wasteCell(lead, t(2, true), undefined)).toMatchObject({ status: 'pass', why: 'total < 2 mg/kg is within the screening value of 100' });
    expect(wasteCell(lead, t(200, true), undefined).status).toBe('unclear');
    expect(wasteCell(lead, t(230), t(10, true))).toMatchObject({ status: 'unclear', why: 'TCLP < 10 mg/L: the detection limit is above the limit of 5' });
  });

  it('where the total is a limit of its own, a TCLP result under its limit doesn’t save a total over it', () => {
    const both = { ...WASTE_DEFAULTS, totalIs: 'limit' as const };
    expect(wasteCell(lead, t(230), t(2.4), both)).toMatchObject({ status: 'fail', why: 'total 230 mg/kg is over the limit of 100' });
    expect(wasteCell(lead, t(80), t(2.4), both).status).toBe('pass-leach');
    expect(wasteCell(lead, t(80), undefined, both).status).toBe('pass');
  });
});

describe('samples against the criteria', () => {
  const site: Site = { id: 's', projectId: 'p', code: 'TP1', type: 'Soil', role: '', aliases: [], active: true, order: 0 };
  const sample = (id: string, top: number): Sample => ({ id, projectId: 'p', siteId: 's', date: '2026-03-12', depth: { top } });
  const res = (sampleId: string, parameterId: string, value: number, unit: string, qualifier: '' | '<' = ''): Result => ({ id: `${sampleId}${parameterId}`, projectId: 'p', sampleId, siteId: 's', date: '2026-03-12', parameterId, value, qualifier, unit });
  const results: Record<string, Result[]> = {
    a: [res('a', 'pb-t-soil', 80, 'mg/kg dry wt'), res('a', 'as-t-soil', 8000, 'µg/kg'), res('a', 'tph-soil', 150, 'mg/kg')],
    b: [res('b', 'pb-t-soil', 230, 'mg/kg dry wt'), res('b', 'as-t-soil', 45, 'mg/kg')],
    c: [res('c', 'pb-t-soil', 1100, 'mg/kg dry wt'), res('c', 'pb-t-tclp', 8, 'g/m3'), res('c', 'as-t-soil', 2, 'mg/kg', '<')],
    d: [res('d', 'zn-t-soil', 400, 'mg/kg')],
  };
  const criteria: WasteCriterion[] = wasteCriteria(set, params);
  const rows = wasteCheck([sample('a', 0.1), sample('b', 0.5), sample('c', 1), sample('d', 1.5)], (id) => results[id] ?? [], () => site, criteria);

  it('each sample comes to: meets, TCLP needed, over – or nothing to compare', () => {
    expect(rows.map((r) => [r.sample.id, r.verdict, r.summary])).toEqual([
      ['a', 'meets', '3 of 3 contaminants tested, all within the criteria'],
      ['b', 'test', 'TCLP needed: Arsenic, Lead'],
      ['c', 'over', 'Over: Lead (TCLP 8 mg/L is over the limit of 5)'],
      ['d', 'no-data', 'No results for anything the criteria name'],
    ]);
    // units are brought to mg/kg and mg/L: 8,000 µg/kg is 8 mg/kg
    expect(rows[0].cells.find((x) => x.criterion.name === 'Arsenic')!.total).toEqual({ value: 8, nd: false });
    expect(rows[1].untested).toEqual(['TPH']);
  });

  it('to a spreadsheet: the criteria, then a line a sample', () => {
    const lines = wasteCsv(rows, criteria, (s) => String(s.depth?.top ?? '')).trim().split('\r\n');
    expect(lines[0]).toBe('Site,Depth (m),Date,Outcome,Why,Arsenic total (mg/kg),Arsenic TCLP (mg/L),Lead total (mg/kg),Lead TCLP (mg/L),TPH total (mg/kg),TPH TCLP (mg/L)');
    expect(lines[1]).toBe('Criteria,,,,,10 (20 x leachate limit),0.5,100,5,2000,');
    expect(lines[3]).toBe('TP1,0.5,2026-03-12,TCLP needed,"TCLP needed: Arsenic, Lead",45,,230,,,');
    expect(lines[4]).toBe('TP1,1,2026-03-12,Over the criteria,Over: Lead (TCLP 8 mg/L is over the limit of 5),<2,,1100,8,,');
  });
});

describe('criteria pasted in', () => {
  it('a contaminant a line with its total and its leachate limit – either may be blank', () => {
    expect(parseCriteria('Lead\t100\t5\nArsenic\t\t0.5\nTPH\t2,000\t\nNotes: see table 3\n').rows).toEqual([
      { name: 'Lead', total: 100, leach: 5 },
      { name: 'Arsenic', leach: 0.5 },
      { name: 'TPH', total: 2000 },
    ]);
    expect(parseCriteria('Lead\t100\t5\nNotes: see table 3\n').skipped).toEqual(['Notes: see table 3']);
  });

  it('under headings the columns are found by them, whatever their order, and their units heeded', () => {
    const got = parseCriteria('Contaminant\tTCLP limit (µg/L)\tCAS\tTotal (mg/kg)\nLead\t5000\t7439-92-1\t100\nArsenic\t500\t7440-38-2\t\n');
    expect(got.rows).toEqual([
      { name: 'Lead', total: 100, leach: 5 },
      { name: 'Arsenic', leach: 0.5 },
    ]);
    // from a document: columns apart by spaces
    expect(parseCriteria('Substance      Screening criterion mg/kg      Leachate g/m3\nCadmium      20      1\n').rows).toEqual([{ name: 'Cadmium', total: 20, leach: 1 }]);
    // only totals
    expect(parseCriteria('Parameter,Limit mg/kg\nZinc,400\n').rows).toEqual([{ name: 'Zinc', total: 400 }]);
    // a CSV: every comma parts two columns, unless it's in quotes
    expect(parseCriteria('Lead,100,500\nTPH,"2,000",\n').rows).toEqual([{ name: 'Lead', total: 100, leach: 500 }, { name: 'TPH', total: 2000 }]);
    expect(parseCriteria('').rows).toEqual([]);
  });
});
