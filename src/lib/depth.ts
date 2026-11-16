// Soil and sediment samples are taken at depths: several from one test pit or core on one day ("TP1 0.1 m", "TP1 0.5 m",
// "BH2 1.0–1.2 m"). The depth is read from the sample's name as the lab reports it, and each depth is its own sample.

/** A sample's depth below the ground (or the bed), in metres: where it starts and, for an interval, where it ends. */
export interface Depth {
  top: number;
  bottom?: number;
}

const NUM = String.raw`(\d+(?:\.\d+)?)`;
const UNIT = String.raw`(mm|cm|m)`;
const SEP = String.raw`\s*(?:-|–|—|to)\s*`;
/** Before a depth: the start, a space or a separator – never a letter or a digit ("BH2m" isn't 2 m). */
const BEFORE = String.raw`(?:^|[\s_@(,;/\-–])`;

const PATTERNS: Array<{ re: RegExp; unit: 'given' | 'm' }> = [
  // an interval with its unit: "0.1-0.3m", "100 – 200 mm", "0.5 to 1.0 m"
  { re: new RegExp(`${BEFORE}${NUM}${SEP}${NUM}\\s*${UNIT}\\b(?:\\s*(?:bgl|bgs|b\\.g\\.l\\.?|deep|depth))?\\)?`, 'i'), unit: 'given' },
  // one depth with its unit: "0.5m", "500 mm", "1.2 m bgl", "(0.5 m)"
  { re: new RegExp(`${BEFORE}${NUM}\\s*${UNIT}\\b(?:\\s*(?:bgl|bgs|b\\.g\\.l\\.?|deep|depth))?\\)?`, 'i'), unit: 'given' },
  // after an "@": "TP1 @ 0.5", "TP1 @ 0.1-0.3"
  { re: new RegExp(`@\\s*${NUM}(?:${SEP}${NUM})?\\)?`, 'i'), unit: 'm' },
  // an interval of decimals at the end, no unit: "TP1 0.1-0.3", "HA2_0.0-0.1"
  { re: new RegExp(`${BEFORE}(\\d+\\.\\d+)${SEP}(\\d+\\.\\d+)\\)?\\s*$`), unit: 'm' },
  // a decimal at the end, no unit: "TP1 0.5", "TP1-0.5", "HA2_0.3" (a whole number there could be anything)
  { re: new RegExp(`${BEFORE}(\\d+\\.\\d+)\\)?\\s*$`), unit: 'm' },
];

const TO_M: Record<string, number> = { mm: 0.001, cm: 0.01, m: 1 };
const round = (v: number) => Math.round(v * 1000) / 1000;

/**
 * The depth in a sample's name, and the name without it (the site, for matching): "TP1 0.5m" → 0.5 m at "TP1";
 * "BH2 1.0-1.2 m" → 1.0–1.2 m at "BH2". Null when the name has no depth.
 */
export function parseDepth(name: string): { depth: Depth; rest: string } | null {
  for (const { re, unit } of PATTERNS) {
    const m = re.exec(name);
    if (!m) continue;
    const nums = m.slice(1).filter((x) => x !== undefined && /^\d/.test(x)).map(Number);
    const u = unit === 'given' ? TO_M[(m.slice(1).find((x) => x !== undefined && /^(mm|cm|m)$/i.test(x)) ?? 'm').toLowerCase()] : 1;
    const top = round(nums[0] * u);
    const bottom = nums.length > 1 ? round(nums[1] * u) : undefined;
    if (!Number.isFinite(top) || top < 0 || top > 500 || (bottom !== undefined && (bottom <= top || bottom > 500))) continue;
    // the name without the depth, and without what joined it on
    const start = m.index + (/^[\s_@(,;/\-–]/.test(m[0]) ? 1 : 0);
    const rest = `${name.slice(0, start)} ${name.slice(m.index + m[0].length)}`.replace(/\s+/g, ' ').replace(/[\s_@(,;/\-–]+$/, '').replace(/^[\s_@),;/\-–]+/, '').trim();
    return { depth: bottom !== undefined ? { top, bottom } : { top }, rest };
  }
  return null;
}

const show = (v: number) => (Number.isInteger(v * 10) ? v.toFixed(1) : String(round(v)));

/** A depth in words: "0.5 m", "1.0–1.2 m". */
export function depthText(d: Depth | undefined): string {
  if (!d) return '';
  return d.bottom !== undefined ? `${show(d.top)}–${show(d.bottom)} m` : `${show(d.top)} m`;
}

/** A depth for a column headed "Depth (m)": the number, or "0.1–0.3" for an interval. */
export const depthCell = (d: Depth | undefined): number | string => (!d ? '' : d.bottom !== undefined ? `${show(d.top)}–${show(d.bottom)}` : d.top);

/** A depth as part of a sample's identity: one site, one day, one depth is one sample. */
export const depthKey = (d: Depth | undefined): string => (d ? `${round(d.top)}${d.bottom !== undefined ? `-${round(d.bottom)}` : ''}` : '');

/** A depth typed in: "0.5", "0.5 m", "0.1-0.3", "100 mm" – null when it isn't one, undefined when blank. */
export function readDepth(text: string): Depth | null | undefined {
  const t = text.trim();
  if (!t) return undefined;
  const m = new RegExp(`^${NUM}(?:${SEP}${NUM})?\\s*${UNIT}?$`, 'i').exec(t);
  if (!m) return null;
  const u = TO_M[(m[3] ?? 'm').toLowerCase()];
  const top = round(Number(m[1]) * u);
  const bottom = m[2] !== undefined ? round(Number(m[2]) * u) : undefined;
  if (top < 0 || top > 500 || (bottom !== undefined && bottom <= top)) return null;
  return bottom !== undefined ? { top, bottom } : { top };
}

/** Whether a site's samples have depths: soil and sediment. */
export const hasDepths = (site: { type: string } | undefined): boolean => site?.type === 'Soil' || site?.type === 'Sediment';

/** Samples in the order they're read down a hole: by day, then from the top. */
export function byDepth<T extends { date: string; depth?: Depth }>(a: T, b: T): number {
  return a.date.slice(0, 10) < b.date.slice(0, 10) ? -1 : a.date.slice(0, 10) > b.date.slice(0, 10) ? 1 : (a.depth?.top ?? -1) - (b.depth?.top ?? -1);
}
