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
