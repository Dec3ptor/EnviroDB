// Trends and comparisons, done the way NZ water quality trends usually are (LAWA; Snelder & Fraser 2021; LWPTrends):
//
// - Values are put in time steps first – months, quarters or years, by how often the site is sampled – one value
//   (the median) per step, so a burst of extra samples doesn't weigh more.
// - The Mann-Kendall test says whether values tend to rise or fall; when results vary with the season (a
//   Kruskal-Wallis test, p < 0.05) the seasonal Kendall test compares each season only with itself.
// - Sen's slope is the size of the trend (units per year), with a 90% confidence interval; as a percentage of the
//   median it's the change per year.
// - Below detection: for the test, everything under the highest detection limit counts as equal (tied); for the
//   slope, non-detects are half their detection limit (slopes are marked approximate when many are).
// - The result is put as the probability the trend is improving, in LAWA's words: very likely improving (90% or
//   more), likely improving (67–90%), indeterminate, likely degrading, very likely degrading (10% or less).
//
// Upstream against downstream: results paired by date, the Wilcoxon signed-rank test on the differences.

export interface TrendPoint {
  /** 'YYYY-MM-DD…' */
  date: string;
  /** The value, or the detection limit for a non-detect. */
  value: number;
  nd: boolean;
}

/** Which way is better for an analyte: lower (most), higher (dissolved oxygen, clarity), or neither (pH, temperature). */
export type Better = 'lower' | 'higher' | 'none';
const BETTER: Record<string, Better> = {
  do: 'higher',
  'do-sat': 'higher',
  clarity: 'higher',
  ph: 'none',
  'ph-field': 'none',
  temp: 'none',
  flow: 'none',
  swl: 'none',
  orp: 'none',
  salinity: 'none',
};
export const betterFor = (parameterId: string): Better => BETTER[parameterId] ?? 'lower';

export type SeasonChoice = 'auto' | 'none' | 'months' | 'quarters';

export type TrendCategory =
  | 'very-likely-improving'
  | 'likely-improving'
  | 'indeterminate'
  | 'likely-degrading'
  | 'very-likely-degrading'
  | 'very-likely-increasing'
  | 'likely-increasing'
  | 'likely-decreasing'
  | 'very-likely-decreasing'
  | 'not-assessed';

export const CATEGORY_TEXT: Record<TrendCategory, string> = {
  'very-likely-improving': 'Very likely improving',
  'likely-improving': 'Likely improving',
  indeterminate: 'Indeterminate',
  'likely-degrading': 'Likely degrading',
  'very-likely-degrading': 'Very likely degrading',
  'very-likely-increasing': 'Very likely increasing',
  'likely-increasing': 'Likely increasing',
  'likely-decreasing': 'Likely decreasing',
  'very-likely-decreasing': 'Very likely decreasing',
  'not-assessed': 'Not assessed',
};

export interface TrendResult {
  ok: boolean;
  /** Why it wasn't assessed. */
  reason?: string;
  /** Values used (one per time step) and results behind them. */
  n: number;
  nRaw: number;
  /** First and last dates, and the span in years. */
  from?: string;
  to?: string;
  years: number;
  /** Time steps: 12 (months), 4 (quarters) or 1 (years, or each sample when sampled less often). */
  step: 'month' | 'quarter' | 'year' | 'sample';
  /** The seasonal Kendall test was used (results vary with the season). */
  seasonal: boolean;
  /** The seasonality test's p (Kruskal-Wallis), when done. */
  seasonalityP?: number;
  /** Share of values below detection (0–1). */
  censored: number;
  S: number;
  varS: number;
  Z: number;
  /** Two-sided p of the Mann-Kendall test. */
  p: number;
  /** Probability the values are rising. */
  pIncreasing: number;
  /** Probability the trend is improving (rising for higher-is-better analytes); undefined when neither is better. */
  pImproving?: number;
  /** Sen's slope (units per year) with a 90% confidence interval. */
  slope: number | null;
  slopeLo: number | null;
  slopeHi: number | null;
  /** Median of the values. */
  median: number | null;
  /** Sen's slope as a percentage of the median, per year. */
  pctPerYear: number | null;
  /** The slope involves many non-detects: a rough size only. */
  approximate: boolean;
  category: TrendCategory;
  /** The Sen's slope line: value at a time (UTC ms). */
  line?: { t0: number; v0: number; perMs: number };
}

// ------------------------------------------------------------------ distributions

/** Standard normal cumulative probability (Abramowitz & Stegun 26.2.17, error < 7.5e-8). */
export function normCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp((-z * z) / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - p : p;
}

/** The regularised lower incomplete gamma function P(a, x). */
function gammaP(a: number, x: number): number {
  if (x <= 0) return 0;
  const lnGa = lnGamma(a);
  if (x < a + 1) {
    let sum = 1 / a;
    let term = sum;
    for (let n = 1; n < 500; n++) {
      term *= x / (a + n);
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-14) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - lnGa);
  }
  // continued fraction for Q, then P = 1 − Q
  let b = x + 1 - a;
  let c = 1e300;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return 1 - Math.exp(-x + a * Math.log(x) - lnGa) * h;
}

function lnGamma(x: number): number {
  const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x;
  const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let ser = 1.000000000190015;
  for (const c of g) ser += c / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

/** Chi-square upper tail probability. */
export const chiSqP = (x: number, df: number) => 1 - gammaP(df / 2, x / 2);

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};

/** Ranks (1-based, ties averaged). */
function ranks(xs: number[]): number[] {
  const idx = xs.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const r = new Array<number>(xs.length);
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return r;
}

/** Sizes of groups of equal values. */
function tieGroups(xs: number[]): number[] {
  const m = new Map<number, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m.values()].filter((t) => t > 1);
}

/** Kruskal-Wallis test: do the groups differ? Returns p. */
export function kruskalWallis(groups: number[][]): number {
  const gs = groups.filter((g) => g.length);
  if (gs.length < 2) return 1;
  const all = gs.flat();
  const N = all.length;
  const r = ranks(all);
  let k = 0;
  let H = 0;
  for (const g of gs) {
    const sum = r.slice(k, k + g.length).reduce((a, b) => a + b, 0);
    H += (sum * sum) / g.length;
    k += g.length;
  }
  H = (12 / (N * (N + 1))) * H - 3 * (N + 1);
  const ties = tieGroups(all).reduce((t, x) => t + x ** 3 - x, 0);
  const corr = 1 - ties / (N ** 3 - N);
  if (corr <= 0) return 1;
  return chiSqP(H / corr, gs.length - 1);
}

// ------------------------------------------------------------------ the trend

const YEAR_MS = 365.25 * 86400000;
const toMs = (date: string) => Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10) || 1, +date.slice(11, 13) || 0, +date.slice(14, 16) || 0);

interface Step {
  /** Time (UTC ms) – the middle of the values in the step. */
  t: number;
  year: number;
  season: number;
  value: number;
  nd: boolean;
}

/** One value per time step: the middle one (a non-detect when that's below detection). */
function toSteps(points: TrendPoint[], step: TrendResult['step']): Step[] {
  if (step === 'sample') return points.map((p) => ({ t: toMs(p.date), year: +p.date.slice(0, 4), season: 0, value: p.value, nd: p.nd }));
  const groups = new Map<string, TrendPoint[]>();
  for (const p of points) {
    const y = +p.date.slice(0, 4);
    const m = +p.date.slice(5, 7) - 1;
    const season = step === 'month' ? m : step === 'quarter' ? Math.floor(m / 3) : 0;
    const k = `${y}|${season}`;
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  return [...groups.entries()].map(([k, list]) => {
    const [y, season] = k.split('|').map(Number);
    // non-detects rank by their detection limit, below detected values of the same size
    const sorted = [...list].sort((a, b) => a.value - b.value || Number(b.nd) - Number(a.nd));
    const mid = sorted[Math.floor((sorted.length - 1) / 2)];
    const ts = list.map((p) => toMs(p.date)).sort((a, b) => a - b);
    return { t: ts[Math.floor((ts.length - 1) / 2)], year: y, season, value: mid.value, nd: mid.nd };
  });
}

/** Mann-Kendall S and its variance (with ties) for values in time order. */
function mannKendall(ys: number[]): { S: number; varS: number } {
  const n = ys.length;
  let S = 0;
  for (let i = 0; i < n - 1; i++) for (let j = i + 1; j < n; j++) S += Math.sign(ys[j] - ys[i]);
  const ties = tieGroups(ys).reduce((t, x) => t + x * (x - 1) * (2 * x + 5), 0);
  return { S, varS: (n * (n - 1) * (2 * n + 5) - ties) / 18 };
}

export interface TrendOptions {
  seasons?: SeasonChoice;
  better?: Better;
  /** Fewest time steps to assess a trend (default 8). */
  minSteps?: number;
}

/** The trend in a site's results for an analyte. */
export function trend(raw: TrendPoint[], opts: TrendOptions = {}): TrendResult {
  const points = raw.filter((p) => Number.isFinite(p.value)).sort((a, b) => (a.date < b.date ? -1 : 1));
  const base: TrendResult = { ok: false, n: 0, nRaw: points.length, years: 0, step: 'sample', seasonal: false, censored: 0, S: 0, varS: 0, Z: 0, p: 1, pIncreasing: 0.5, slope: null, slopeLo: null, slopeHi: null, median: null, pctPerYear: null, approximate: false, category: 'not-assessed' };
  if (points.length < 2) return { ...base, reason: 'Too few results.' };
  const from = points[0].date.slice(0, 10);
  const to = points[points.length - 1].date.slice(0, 10);
  const years = (toMs(to) - toMs(from)) / YEAR_MS;
  // how often the site is sampled: results per year
  const perYear = points.length / Math.max(years, 1 / 12);
  const choice = opts.seasons ?? 'auto';
  const step: TrendResult['step'] = choice === 'months' ? 'month' : choice === 'quarters' ? 'quarter' : perYear >= 10 ? 'month' : perYear >= 3.5 ? 'quarter' : perYear >= 0.9 && years >= 6 ? 'year' : 'sample';
  const steps = toSteps(points, step).sort((a, b) => a.t - b.t);
  const n = steps.length;
  const detected = steps.filter((s) => !s.nd);
  const res = { ...base, n, from, to, years, step };
  const minSteps = opts.minSteps ?? 8;
  if (n < minSteps) return { ...res, reason: `${n} ${step === 'sample' ? 'results' : `${step}s with results`} – at least ${minSteps} are needed.` };
  if (years < 2) return { ...res, reason: 'Less than two years of results.' };
  if (detected.length < 5 || new Set(detected.map((s) => s.value)).size < 3) return { ...res, reason: 'Too few results above the detection limit.' };

  // for the test: everything under the highest detection limit is tied
  const maxDl = Math.max(0, ...steps.filter((s) => s.nd).map((s) => s.value));
  const testY = steps.map((s) => (s.nd || s.value < maxDl ? maxDl / 2 : s.value));
  // for the slope: non-detects at half their detection limit
  const slopeY = steps.map((s) => (s.nd ? s.value / 2 : s.value));
  const censored = steps.filter((s) => s.nd).length / n;

  // seasonal?
  const nSeasons = step === 'month' ? 12 : step === 'quarter' ? 4 : 1;
  let seasonal = choice === 'months' || choice === 'quarters';
  let seasonalityP: number | undefined;
  if (nSeasons > 1) {
    const groups = Array.from({ length: nSeasons }, (_, k) => slopeY.filter((_, i) => steps[i].season === k));
    seasonalityP = kruskalWallis(groups);
    if (choice === 'auto') seasonal = seasonalityP < 0.05;
  }
  if (choice === 'none') seasonal = false;

  // Mann-Kendall (each season on its own when seasonal)
  const blocks = seasonal ? Array.from({ length: nSeasons }, (_, k) => steps.map((s, i) => (s.season === k ? i : -1)).filter((i) => i >= 0)) : [steps.map((_, i) => i)];
  let S = 0;
  let varS = 0;
  const slopes: number[] = [];
  for (const idx of blocks) {
    if (idx.length < 2) continue;
    const mk = mannKendall(idx.map((i) => testY[i]));
    S += mk.S;
    varS += mk.varS;
    for (let a = 0; a < idx.length - 1; a++)
      for (let b = a + 1; b < idx.length; b++) {
        const dt = (steps[idx[b]].t - steps[idx[a]].t) / YEAR_MS;
        if (dt > 0) slopes.push((slopeY[idx[b]] - slopeY[idx[a]]) / dt);
      }
  }
  if (varS <= 0 || !slopes.length) return { ...res, censored, reason: 'The results don’t vary enough to test.' };
  const Z = S > 0 ? (S - 1) / Math.sqrt(varS) : S < 0 ? (S + 1) / Math.sqrt(varS) : 0;
  const p = 2 * (1 - normCdf(Math.abs(Z)));
  const pIncreasing = normCdf(Z);
  const better = opts.better ?? 'lower';
  const pImproving = better === 'none' ? undefined : better === 'lower' ? 1 - pIncreasing : pIncreasing;

  slopes.sort((a, b) => a - b);
  const slope = median(slopes)!;
  // 90% confidence interval (Gilbert 1987)
  const C = 1.645 * Math.sqrt(varS);
  const N = slopes.length;
  const lo = Math.round((N - C) / 2) - 1;
  const hi = Math.round((N + C) / 2);
  const slopeLo = lo >= 0 && lo < N ? slopes[lo] : null;
  const slopeHi = hi >= 0 && hi < N ? slopes[hi] : null;
  const med = median(slopeY)!;
  const tMed = median(steps.map((s) => s.t))!;
  const category = categorise(pIncreasing, pImproving);
  return {
    ...res,
    ok: true,
    seasonal,
    seasonalityP,
    censored,
    S,
    varS,
    Z,
    p,
    pIncreasing,
    pImproving,
    slope,
    slopeLo,
    slopeHi,
    median: med,
    pctPerYear: med > 0 ? (slope / med) * 100 : null,
    approximate: censored > 0.15,
    category,
    line: { t0: tMed, v0: med, perMs: slope / YEAR_MS },
  };
}

function categorise(pIncreasing: number, pImproving?: number): TrendCategory {
  if (pImproving !== undefined) {
    if (pImproving >= 0.9) return 'very-likely-improving';
    if (pImproving >= 0.67) return 'likely-improving';
    if (pImproving > 0.33) return 'indeterminate';
    if (pImproving > 0.1) return 'likely-degrading';
    return 'very-likely-degrading';
  }
  if (pIncreasing >= 0.9) return 'very-likely-increasing';
  if (pIncreasing >= 0.67) return 'likely-increasing';
  if (pIncreasing > 0.33) return 'indeterminate';
  if (pIncreasing > 0.1) return 'likely-decreasing';
  return 'very-likely-decreasing';
}

/** Whether a category is good, bad or neither news – for colours. */
export function categoryTone(c: TrendCategory): 'good' | 'bad' | 'neutral' | 'none' {
  if (c.endsWith('improving')) return 'good';
  if (c.endsWith('degrading')) return 'bad';
  if (c === 'not-assessed') return 'none';
  return 'neutral';
}

/** Points along the Sen's slope line, for a graph (several, so it's right on a log scale too). */
export function trendLinePoints(r: TrendResult, n = 24): Array<[number, number]> {
  if (!r.line || !r.from || !r.to) return [];
  const a = toMs(r.from);
  const b = toMs(r.to);
  const out: Array<[number, number]> = [];
  for (let i = 0; i <= n; i++) {
    const t = a + ((b - a) * i) / n;
    out.push([t, r.line.v0 + r.line.perMs * (t - r.line.t0)]);
  }
  return out;
}

// ------------------------------------------------------------------ upstream against downstream

export interface PairedComparison {
  /** Pairs of results (same day, or within the days allowed). */
  n: number;
  upMedian: number | null;
  downMedian: number | null;
  /** Median of downstream − upstream. */
  medianDiff: number | null;
  /** Share of pairs higher downstream (0–1). */
  higherDown: number;
  /** Wilcoxon signed-rank test, two-sided p. */
  p: number | null;
  verdict: 'higher' | 'lower' | 'no-difference' | 'too-few';
  /** Pairs where both were below detection (left out of the test). */
  bothNd: number;
}

/** Pairs results by date (the nearest within `days`), and compares downstream with upstream. */
export function comparePaired(up: TrendPoint[], down: TrendPoint[], days = 1): PairedComparison {
  const ups = [...up].sort((a, b) => (a.date < b.date ? -1 : 1));
  const used = new Set<number>();
  const pairs: Array<[TrendPoint, TrendPoint]> = [];
  for (const d of [...down].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    const td = toMs(d.date.slice(0, 10));
    let best = -1;
    let gap = Infinity;
    ups.forEach((u, i) => {
      if (used.has(i)) return;
      const g = Math.abs(toMs(u.date.slice(0, 10)) - td) / 86400000;
      if (g <= days && g < gap) {
        gap = g;
        best = i;
      }
    });
    if (best >= 0) {
      used.add(best);
      pairs.push([ups[best], d]);
    }
  }
  let bothNd = 0;
  const diffs: number[] = [];
  for (const [u, d] of pairs) {
    if (u.nd && d.nd) {
      bothNd++;
      continue;
    }
    // a non-detect below a detected value is lower; two values under one detection limit are equal
    const uv = u.nd ? u.value / 2 : u.value;
    const dv = d.nd ? d.value / 2 : d.value;
    diffs.push(u.nd && !d.nd && d.value <= u.value ? 0 : d.nd && !u.nd && u.value <= d.value ? 0 : dv - uv);
  }
  const n = pairs.length;
  const upMedian = median(pairs.map(([u]) => (u.nd ? u.value / 2 : u.value)));
  const downMedian = median(pairs.map(([, d]) => (d.nd ? d.value / 2 : d.value)));
  const nz = diffs.filter((x) => x !== 0);
  const higherDown = diffs.length ? diffs.filter((x) => x > 0).length / diffs.length : 0;
  const out: PairedComparison = { n, upMedian, downMedian, medianDiff: median(diffs), higherDown, p: null, verdict: 'too-few', bothNd };
  if (nz.length < 6) return out;
  const r = ranks(nz.map(Math.abs));
  const W = nz.reduce((t, x, i) => t + (x > 0 ? r[i] : 0), 0);
  const m = nz.length;
  const mean = (m * (m + 1)) / 4;
  const ties = tieGroups(nz.map(Math.abs)).reduce((t, x) => t + x ** 3 - x, 0);
  const sd = Math.sqrt((m * (m + 1) * (2 * m + 1)) / 24 - ties / 48);
  const z = sd > 0 ? (W - mean - Math.sign(W - mean) * 0.5) / sd : 0;
  const p = 2 * (1 - normCdf(Math.abs(z)));
  return { ...out, p, verdict: p >= 0.05 ? 'no-difference' : W > mean ? 'higher' : 'lower' };
}
