export type PercentileMethod = 'excel' | 'hazen';

/** Percentile of an unsorted array. 'excel' = PERCENTILE.INC (R type 7); 'hazen' = R type 5 (used by NZ NPS-FM). */
export function percentile(values: number[], p: number, method: PercentileMethod = 'excel'): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  const n = v.length;
  if (!n) return null;
  if (n === 1) return v[0];
  const q = Math.min(Math.max(p, 0), 100) / 100;
  let h: number;
  if (method === 'hazen') {
    h = n * q + 0.5; // 1-based rank
    if (h <= 1) return v[0];
    if (h >= n) return v[n - 1];
  } else {
    h = (n - 1) * q + 1;
  }
  const lo = Math.floor(h);
  const frac = h - lo;
  const a = v[lo - 1];
  const b = v[Math.min(lo, n - 1)];
  return a + frac * (b - a);
}

export function median(values: number[]): number | null {
  return percentile(values, 50, 'excel');
}

export function mean(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x));
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
}

export function geomean(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x) && x > 0);
  if (!v.length) return null;
  return Math.exp(v.reduce((s, x) => s + Math.log(x), 0) / v.length);
}

export function min(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x));
  return v.length ? Math.min(...v) : null;
}

export function max(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x));
  return v.length ? Math.max(...v) : null;
}

export function stdev(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x));
  if (v.length < 2) return null;
  const m = v.reduce((s, x) => s + x, 0) / v.length;
  return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1));
}

export function computeStat(
  name: 'mean' | 'median' | 'percentile' | 'max' | 'min' | 'geomean',
  values: number[],
  p = 95,
  method: PercentileMethod = 'excel',
): number | null {
  switch (name) {
    case 'mean':
      return mean(values);
    case 'median':
      return method === 'hazen' ? percentile(values, 50, 'hazen') : median(values);
    case 'percentile':
      return percentile(values, p, method);
    case 'max':
      return max(values);
    case 'min':
      return min(values);
    case 'geomean':
      return geomean(values);
  }
}

export function statLabel(name: string, p?: number): string {
  switch (name) {
    case 'mean':
      return 'mean';
    case 'median':
      return 'median';
    case 'percentile':
      return `${ordinal(p ?? 95)} percentile`;
    case 'max':
      return 'maximum';
    case 'min':
      return 'minimum';
    case 'geomean':
      return 'geometric mean';
    default:
      return name;
  }
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// ------------------------------------------------------------ box plots, and how two things go together

export interface BoxSummary {
  n: number;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  /** The whiskers' ends: the furthest values within 1.5 times the box's height of it (Tukey). */
  low: number;
  high: number;
  /** The values beyond the whiskers. */
  outliers: number[];
}

/** A box plot's numbers for some values – null when there are none. */
export function boxSummary(values: number[], method: PercentileMethod = 'excel'): BoxSummary | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const q1 = percentile(v, 25, method)!;
  const med = percentile(v, 50, method)!;
  const q3 = percentile(v, 75, method)!;
  const reach = 1.5 * (q3 - q1);
  const inside = v.filter((x) => x >= q1 - reach && x <= q3 + reach);
  // (with few values the quartiles can sit inside the furthest ones: the whiskers never end inside the box)
  const low = Math.min(inside.length ? inside[0] : q1, q1);
  const high = Math.max(inside.length ? inside[inside.length - 1] : q3, q3);
  return { n: v.length, min: v[0], q1, median: med, q3, max: v[v.length - 1], low, high, outliers: v.filter((x) => x < low || x > high) };
}

/** The ranks of some values, 1 for the smallest; equal values share the mean of their ranks. */
export function rankOf(values: number[]): number[] {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const out = new Array<number>(values.length);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1].v === order[i].v) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[order[k].i] = r;
    i = j + 1;
  }
  return out;
}

/** Pearson's correlation of two lists – null with fewer than three pairs, or when either doesn't vary. */
export function pearson(x: number[], y: number[]): number | null {
  const n = Math.min(x.length, y.length);
  if (n < 3) return null;
  const mx = x.slice(0, n).reduce((s, v) => s + v, 0) / n;
  const my = y.slice(0, n).reduce((s, v) => s + v, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}

/** Spearman's rank correlation: how steadily one rises with the other (−1 to 1), whatever the shape. */
export const spearman = (x: number[], y: number[]): number | null => {
  const n = Math.min(x.length, y.length);
  return pearson(rankOf(x.slice(0, n)), rankOf(y.slice(0, n)));
};
