// A monitoring bore's particulars: the top of casing (what depth to water is measured from), how far it stands
// above the ground, how deep the well is and where it's screened. With a top-of-casing level, a depth to water
// becomes a groundwater level (RL = top of casing − depth).

import type { Site } from '../db/types';

export type BoreDetails = NonNullable<Site['bore']>;

const m = (v: number | undefined, dp = 2) => (v === undefined || v === null || Number.isNaN(v) ? undefined : Number(v).toFixed(dp).replace(/\.?0+$/, ''));

/** One line: "TOC 123.45 m RL · stick-up 0.6 m · depth 12 m · screen 8–11 m". */
export function boreSummary(b: BoreDetails | undefined): string {
  if (!b) return '';
  const parts = [
    b.tocRl !== undefined ? `TOC ${m(b.tocRl)} m RL` : '',
    b.stickUp !== undefined ? `stick-up ${m(b.stickUp)} m` : '',
    b.depth !== undefined ? `depth ${m(b.depth)} m` : '',
    b.screenTop !== undefined || b.screenBottom !== undefined ? `screen ${m(b.screenTop) ?? '?'}–${m(b.screenBottom) ?? '?'} m` : '',
    b.diameter !== undefined ? `Ø ${m(b.diameter, 0)} mm` : '',
  ].filter(Boolean);
  return parts.join(' · ');
}

/** Groundwater level (m RL) from a depth to water below the top of casing; null without a top-of-casing level. */
export function levelFromDepth(b: BoreDetails | undefined, depthToWater: number): number | null {
  if (!b || b.tocRl === undefined || !Number.isFinite(depthToWater)) return null;
  return Math.round((b.tocRl - depthToWater) * 1000) / 1000;
}

/** Something to check a depth-to-water reading against: deeper than the well is a slip of the thumb. */
export function depthWarning(b: BoreDetails | undefined, depthToWater: number): string | null {
  if (!b) return null;
  if (depthToWater < 0) return 'A depth to water can’t be negative (artesian? note it).';
  if (b.depth !== undefined && depthToWater > b.depth) return `Deeper than the well (${m(b.depth)} m).`;
  return null;
}

export const hasBore = (b: BoreDetails | undefined) => !!b && Object.values(b).some((v) => v !== undefined && v !== null);
