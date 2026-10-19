import { describe, expect, it } from 'vitest';
import { NPSFM_ATTRIBUTES } from '../src/data/npsfm';
import { ammoniaAtPh8, attributesFor, gradeAttribute, siteClass, statBand, type NpsfmPoint } from '../src/lib/npsfm';

const attr = (id: string) => NPSFM_ATTRIBUTES.find((a) => a.id === id)!;
/** Monthly results from 2021, by month index. */
const monthly = (n: number, f: (i: number) => number, extra: Partial<NpsfmPoint> = {}): NpsfmPoint[] =>
  Array.from({ length: n }, (_, i) => ({ date: `${2021 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-10`, value: f(i), nd: false, ...extra }));
const grade = (id: string, pts: NpsfmPoint[], cls = {}, pid = attr(id).parameterIds[0]) => gradeAttribute(attr(id), (p) => (p === pid ? pts : []), { water: 'river', ...cls });

describe('band edges', () => {
  it('lower is better: at a threshold is in the better band', () => {
    const nitrateMedian = attr('nitrate').stats[0];
    expect(statBand(nitrateMedian, 1.0)).toBe('A');
    expect(statBand(nitrateMedian, 1.01)).toBe('B');
    expect(statBand(nitrateMedian, 2.4)).toBe('B');
    expect(statBand(nitrateMedian, 6.9)).toBe('C');
    expect(statBand(nitrateMedian, 7)).toBe('D');
  });
  it('E. coli’s percentages: under 5% for A, then up to 10, 20, 30', () => {
    const over540 = attr('ecoli').stats[0];
    expect([4.9, 5, 10, 10.1, 20, 30, 30.1].map((v) => statBand(over540, v))).toEqual(['A', 'B', 'B', 'C', 'C', 'D', 'E']);
  });
});

describe('grading', () => {
  it('E. coli: the worst of the four statistics', () => {
    // mostly low, but one in eight over 540: the median says A, the % over 540 says C
    const pts = monthly(64, (i) => (i % 8 === 0 ? 700 : 60));
    const g = grade('ecoli', pts);
    expect(g.stats.map((s) => [s.key, s.band])).toEqual([
      ['over540', 'C'],
      ['over260', 'A'],
      ['median', 'A'],
      ['p95', 'B'],
    ]);
    expect(g.band).toBe('C');
    expect(g.meetsBottomLine).toBeUndefined(); // no bottom line for E. coli
    expect(g.provisional).toBeUndefined();
  });

  it('provisional on too few results', () => {
    expect(grade('ecoli', monthly(24, () => 50)).provisional).toBe('24 results – the NPS-FM asks for 60');
  });

  it('nitrate: national bottom line between B and C', () => {
    expect(grade('nitrate', monthly(24, () => 2.0)).meetsBottomLine).toBe(true);
    const c = grade('nitrate', monthly(24, () => 3.0));
    expect(c.band).toBe('C');
    expect(c.meetsBottomLine).toBe(false);
    // nitrate-N + nitrite-N stands in, with a note
    const nnn = grade('nitrate', monthly(24, () => 0.5), {}, 'nnn');
    expect(nnn.parameterId).toBe('nnn');
    expect(nnn.provisional).toMatch(/nitrate-N \+ nitrite-N used/);
  });

  it('ammonia: adjusted to pH 8 first', () => {
    expect(ammoniaAtPh8(1, 8)).toBeCloseTo(1, 9);
    expect(ammoniaAtPh8(1, 7)).toBeCloseTo(0.412, 3); // less toxic at pH 7
    expect(ammoniaAtPh8(1, 9)).toBeGreaterThan(2);
    // 0.5 mg/L at pH 7 is about 0.21 at pH 8: band B, not C
    const g = grade('ammonia', monthly(24, () => 0.5, { ph: 7 }));
    expect(g.stats[0].value).toBeCloseTo(0.206, 2);
    expect(g.band).toBe('B');
    expect(g.adjusted).toBe(24);
    // no pH: unadjusted, said so
    const raw = grade('ammonia', monthly(24, () => 0.5));
    expect(raw.band).toBe('C');
    expect(raw.provisional).toMatch(/24 results without a pH/);
  });

  it('visual clarity: by the site’s suspended sediment class', () => {
    const pts = monthly(60, () => 1.6);
    expect(grade('sediment', pts).reason).toMatch(/suspended sediment class/);
    expect(grade('sediment', pts, { sedimentClass: 1 }).band).toBe('B'); // 1.55–1.78
    expect(grade('sediment', pts, { sedimentClass: 2 }).band).toBe('A'); // ≥ 0.93
    expect(grade('sediment', pts, { sedimentClass: 3 }).band).toBe('D'); // < 2.22
  });

  it('lake total nitrogen: by lake type', () => {
    const pts = monthly(12, () => 400);
    expect(grade('lake-tn', pts, { water: 'lake' }).reason).toMatch(/lake type/);
    expect(grade('lake-tn', pts, { water: 'lake', lakeType: 'stratified' }).band).toBe('C');
    expect(grade('lake-tn', pts, { water: 'lake', lakeType: 'polymictic' }).band).toBe('B');
  });

  it('periphyton: 92nd percentile, 83rd for productive rivers', () => {
    const pts = monthly(36, (i) => (i % 10 === 0 ? 180 : 40));
    expect(grade('periphyton', pts).stats[0].key).toBe('p92');
    expect(grade('periphyton', pts, { periphyton: 'productive' }).stats[0].key).toBe('p83');
    expect(grade('periphyton', pts, { periphyton: 'productive' }).band).toBe('A');
  });

  it('invertebrate indices: higher is better', () => {
    expect(grade('mci', monthly(5, () => 115)).band).toBe('B');
    expect(grade('mci', monthly(5, () => 85)).meetsBottomLine).toBe(false);
  });

  it('primary contact E. coli: bathing season only', () => {
    // high in winter, low in summer
    const pts = monthly(60, (i) => ([10, 11, 0, 1, 2].includes(i % 12) ? 100 : 5000));
    const g = grade('ecoli-contact', pts);
    expect(g.n).toBe(25);
    expect(g.band).toBe('A');
  });
});

describe('which attributes a site gets', () => {
  it('surface water sites are rivers; groundwater isn’t graded', () => {
    expect(siteClass({ type: 'Surface water' }).water).toBe('river');
    expect(siteClass({ type: 'Groundwater' }).water).toBe('none');
    expect(attributesFor(siteClass({ type: 'Groundwater' }))).toEqual([]);
    const river = attributesFor(siteClass({ type: 'Surface water' })).map((a) => a.id);
    expect(river).toEqual(['ecoli', 'nitrate', 'ammonia', 'periphyton', 'sediment', 'drp', 'mci', 'qmci', 'aspm']);
    expect(attributesFor({ water: 'lake', primaryContact: true }).map((a) => a.id)).toEqual(['ecoli', 'ammonia', 'lake-tn', 'lake-tp', 'phytoplankton', 'ecoli-contact']);
  });
});
