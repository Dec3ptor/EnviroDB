import { describe, expect, it } from 'vitest';
import { betterFor, chiSqP, comparePaired, kruskalWallis, likelihoodText, normCdf, trend, trendLinePoints, type TrendPoint, type TrendResult } from '../src/lib/trends';

const pt = (date: string, value: number, nd = false): TrendPoint => ({ date, value, nd });
/** Monthly results from Jan 2018, value by month index. */
const monthly = (n: number, f: (i: number) => number, nd?: (i: number) => boolean) =>
  Array.from({ length: n }, (_, i) => pt(`${2018 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-15`, f(i), nd?.(i) ?? false));
// a repeatable wobble
const noise = (i: number) => Math.sin(i * 12.9898) * 43758.5453 - Math.floor(Math.sin(i * 12.9898) * 43758.5453) - 0.5;

describe('distributions', () => {
  it('normal and chi-square tails', () => {
    expect(normCdf(1.959964)).toBeCloseTo(0.975, 6);
    expect(normCdf(-1.644854)).toBeCloseTo(0.05, 6);
    expect(normCdf(0)).toBeCloseTo(0.5, 8);
    expect(chiSqP(3.841459, 1)).toBeCloseTo(0.05, 5);
    expect(chiSqP(5.991465, 2)).toBeCloseTo(0.05, 5);
    expect(chiSqP(19.67514, 11)).toBeCloseTo(0.05, 5);
  });
  it('Kruskal-Wallis', () => {
    // ranks 1–3 against 4–6: H = 3.857, p = 0.0495
    expect(kruskalWallis([[1, 2, 3], [4, 5, 6]])).toBeCloseTo(0.0495, 3);
    expect(kruskalWallis([[1, 4, 5], [2, 3, 6]])).toBeGreaterThan(0.5);
  });
});

describe('trends', () => {
  it('a steady rise: Mann-Kendall S, variance, p and Sen’s slope', () => {
    // one result a year for 10 years: 1, 2, … 10
    const r = trend(Array.from({ length: 10 }, (_, i) => pt(`${2010 + i}-06-15`, i + 1)), { seasons: 'none' });
    expect(r.ok).toBe(true);
    expect(r.step).toBe('year');
    expect(r.S).toBe(45);
    expect(r.varS).toBe(125);
    expect(r.Z).toBeCloseTo(44 / Math.sqrt(125), 6);
    expect(r.p).toBeCloseTo(8.3e-5, 5);
    expect(r.slope).toBeCloseTo(1, 2);
    expect(r.category).toBe('very-likely-degrading'); // higher is worse for most analytes
    expect(trend(Array.from({ length: 10 }, (_, i) => pt(`${2010 + i}-06-15`, i + 1)), { better: 'higher' }).category).toBe('very-likely-improving');
    expect(trend(Array.from({ length: 10 }, (_, i) => pt(`${2010 + i}-06-15`, i + 1)), { better: 'none' }).category).toBe('very-likely-increasing');
  });

  it('no trend in noise', () => {
    const r = trend(monthly(60, (i) => 10 + noise(i)));
    expect(r.ok).toBe(true);
    expect(r.step).toBe('month');
    expect(['indeterminate', 'likely-improving', 'likely-degrading']).toContain(r.category);
    expect(Math.abs(r.pctPerYear!)).toBeLessThan(3);
  });

  it('a seasonal pattern: the seasonal Kendall test finds the trend under it', () => {
    // a big summer/winter swing, rising 0.2 a year
    const r = trend(monthly(72, (i) => 10 + 4 * Math.cos((2 * Math.PI * (i % 12)) / 12) + 0.2 * (i / 12) + noise(i) * 0.3));
    expect(r.seasonal).toBe(true);
    expect(r.seasonalityP!).toBeLessThan(0.001);
    expect(r.slope!).toBeCloseTo(0.2, 1);
    expect(r.category).toBe('very-likely-degrading');
    expect(r.slopeLo!).toBeLessThan(r.slope!);
    expect(r.slopeHi!).toBeGreaterThan(r.slope!);
  });

  it('values below detection: tied for the test, halved for the slope', () => {
    // falling to below detection
    const r = trend(monthly(60, (i) => (i > 40 ? 0.01 : 0.2 - i * 0.004), (i) => i > 40), { seasons: 'none' });
    expect(r.ok).toBe(true);
    expect(r.censored).toBeCloseTo(19 / 60, 2);
    expect(r.approximate).toBe(true);
    expect(r.category).toBe('very-likely-improving');
    // mostly below detection: not assessed
    const nd = trend(monthly(60, (i) => (i % 15 === 0 ? 0.05 : 0.01), (i) => i % 15 !== 0));
    expect(nd.ok).toBe(false);
    expect(nd.reason).toMatch(/above the detection limit/);
  });

  it('a high detection limit can turn the test against the slope: said, and the size marked rough', () => {
    // falling, but one sample's detection limit (1.0, diluted) is above most values – the test ties them all, and
    // sees only the later high values
    const spikes = new Set([48, 51, 54, 57]);
    const r = trend(monthly(60, (i) => (i === 5 ? 1.0 : spikes.has(i) ? 1.2 + i / 100 : 0.9 - i * 0.01), (i) => i === 5), { seasons: 'none' });
    expect(r.ok).toBe(true);
    expect(r.censored).toBeLessThan(0.15);
    expect(r.S).toBeGreaterThan(0);
    expect(r.slope).toBeLessThan(0);
    expect(r.disagree).toBe(true);
    expect(r.approximate).toBe(true);
    // a clean fall: no disagreement
    const clean = trend(monthly(60, (i) => 0.9 - i * 0.01 + noise(i) * 0.05), { seasons: 'none' });
    expect(clean.disagree).toBe(false);
    expect(clean.approximate).toBe(false);
  });

  it('gives the chance of the direction it names (not “20% improving” for a degrading trend)', () => {
    const r = (x: Partial<TrendResult>) => ({ ok: true, pIncreasing: 0.5, ...x }) as TrendResult;
    expect(likelihoodText(r({ pImproving: 0.2, pIncreasing: 0.8, category: 'likely-degrading' }))).toBe('80% degrading');
    expect(likelihoodText(r({ pImproving: 0.95, category: 'very-likely-improving' }))).toBe('95% improving');
    // rounded down, so never a category's threshold it isn't in
    expect(likelihoodText(r({ pImproving: 0.896, category: 'likely-improving' }))).toBe('89% improving');
    expect(likelihoodText(r({ pImproving: 0.104, category: 'likely-degrading' }))).toBe('89% degrading');
    // indeterminate: the side it leans to
    expect(likelihoodText(r({ pImproving: 0.45, category: 'indeterminate' }))).toBe('55% degrading');
    // pH, temperature: rising or falling
    expect(likelihoodText(r({ pIncreasing: 0.25, category: 'likely-decreasing' }))).toBe('75% falling');
    expect(likelihoodText({ ...r({}), ok: false })).toBe('');
    // from a real trend
    const up = trend(Array.from({ length: 10 }, (_, i) => pt(`${2010 + i}-06-15`, i + 1)));
    expect(up.category).toBe('very-likely-degrading');
    expect(likelihoodText(up)).toMatch(/^9\d% degrading$/);
  });

  it('says why it can’t assess', () => {
    expect(trend([pt('2020-01-01', 1)]).reason).toBe('Too few results.');
    expect(trend(monthly(14, (i) => i)).reason).toBe('Less than two years of results.');
    expect(trend(Array.from({ length: 5 }, (_, i) => pt(`${2015 + i}-06-15`, i))).reason).toMatch(/at least 8 are needed/);
  });

  it('one value per time step', () => {
    // three results in each month count once
    const pts = monthly(36, (i) => i).flatMap((p) => [p, { ...p, date: p.date.replace('-15', '-16'), value: p.value + 100 }, { ...p, date: p.date.replace('-15', '-17'), value: p.value - 100 }]);
    const r = trend(pts);
    expect(r.n).toBe(36);
    expect(r.nRaw).toBe(108);
  });

  it('draws the slope through the middle of the values', () => {
    const r = trend(Array.from({ length: 10 }, (_, i) => pt(`${2010 + i}-06-15`, i + 1)));
    const line = trendLinePoints(r, 2);
    expect(line).toHaveLength(3);
    expect(line[1][1]).toBeCloseTo(5.5, 1);
  });

  it('knows which way is better', () => {
    expect(betterFor('tss')).toBe('lower');
    expect(betterFor('do')).toBe('higher');
    expect(betterFor('ph')).toBe('none');
  });
});

describe('upstream against downstream', () => {
  const days = Array.from({ length: 20 }, (_, i) => `2024-${String(1 + Math.floor(i / 2)).padStart(2, '0')}-${i % 2 ? '20' : '05'}`);
  it('finds a rise downstream', () => {
    const up = days.map((d, i) => pt(d, 10 + noise(i)));
    const down = days.map((d, i) => pt(d, 13 + noise(i + 50)));
    const c = comparePaired(up, down);
    expect(c.n).toBe(20);
    expect(c.verdict).toBe('higher');
    expect(c.higherDown).toBe(1);
    expect(c.medianDiff!).toBeCloseTo(3, 0);
  });
  it('Wilcoxon signed-rank p', () => {
    // differences 1 … 10, all up: W = 55, z = 2.752, p = 0.0059
    const up = days.slice(0, 10).map((d) => pt(d, 100));
    const down = days.slice(0, 10).map((d, i) => pt(d, 101 + i));
    expect(comparePaired(up, down).p!).toBeCloseTo(0.0059, 3);
  });
  it('pairs by date, and sees no difference in noise', () => {
    const up = days.map((d, i) => pt(d, 10 + noise(i)));
    const down = days.map((d, i) => pt(d.replace(/-(05|20)$/, (m) => (m === '-05' ? '-06' : '-21')), 10 + noise(i + 7)));
    const c = comparePaired(up, down);
    expect(c.n).toBe(20);
    expect(c.verdict).toBe('no-difference');
    expect(comparePaired(up, down, 0).n).toBe(0);
  });
  it('leaves out pairs both below detection', () => {
    const up = days.map((d) => pt(d, 0.01, true));
    const down = days.map((d, i) => pt(d, i % 2 ? 0.01 : 0.05, i % 2 === 1));
    const c = comparePaired(up, down);
    expect(c.bothNd).toBe(10);
    expect(c.verdict).toBe('higher');
  });
});
