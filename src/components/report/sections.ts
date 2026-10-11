import { arrayMove } from '@dnd-kit/sortable';
import type { ReportBlock } from '../../db/types';
import { pageOrientations, type Orientation } from '../../reports/build';

export type { Orientation };

/** A heading's section is the heading and everything up to the next heading at the same or a higher level. */
export function sectionRange(blocks: ReportBlock[], i: number): [number, number] {
  const b = blocks[i];
  if (b.type !== 'heading') return [i, i + 1];
  let j = i + 1;
  while (j < blocks.length) {
    const x = blocks[j];
    if (x.type === 'title' || (x.type === 'heading' && x.level <= b.level)) break;
    j++;
  }
  return [i, j];
}

/** Put a block – for a heading, its whole section – on pages of the given orientation (unset: as the pages around it). */
export function setPages(blocks: ReportBlock[], i: number, pages: Orientation | undefined): ReportBlock[] {
  return blocks.map((b, k) => (k === i ? { ...b, pages } : b));
}

/** Where a section at this heading level can go: before a heading at the same or a higher level, after a title, or at the end. */
function sectionStarts(blocks: ReportBlock[], level: number): number[] {
  const out: number[] = [];
  for (let i = 0; i <= blocks.length; i++) {
    const b = blocks[i] as ReportBlock | undefined;
    const title = b?.type === 'title';
    if (!b || title || (b.type === 'heading' && b.level <= level) || blocks[i - 1]?.type === 'title' || i === 0) out.push(i);
    if (i === 0 && title) out.pop(); // never before the title page
  }
  return out;
}

export const insertAt = (list: ReportBlock[], at: number, items: ReportBlock[]) => [...list.slice(0, at), ...items, ...list.slice(at)];

/**
 * Move a heading together with its section. `to` is the index it was dropped on; the section goes to the nearest
 * place between sections, so it never splits another section or picks up that section's content.
 */
export function moveSection(blocks: ReportBlock[], i: number, to: number): ReportBlock[] {
  const h = blocks[i];
  if (h.type !== 'heading') return arrayMove(blocks, i, to);
  const [a, z] = sectionRange(blocks, i);
  if (to >= a && to < z) return blocks;
  const rest = [...blocks.slice(0, a), ...blocks.slice(z)];
  const starts = sectionStarts(rest, h.level);
  const at = to > i ? (starts.find((s) => s >= to - (z - a) + 1) ?? rest.length) : ([...starts].reverse().find((s) => s <= to) ?? a);
  return insertAt(rest, at, blocks.slice(a, z));
}

/** Move a heading's section one place up or down past the next section; null when it can't move further. */
export function stepSection(blocks: ReportBlock[], i: number, d: -1 | 1): ReportBlock[] | null {
  const h = blocks[i];
  if (h.type !== 'heading') return null;
  const [a, z] = sectionRange(blocks, i);
  const rest = [...blocks.slice(0, a), ...blocks.slice(z)];
  const starts = sectionStarts(rest, h.level);
  const at = d > 0 ? starts.find((s) => s > a) : [...starts].reverse().find((s) => s < a);
  return at === undefined ? null : insertAt(rest, at, blocks.slice(a, z));
}

/** True when some pages are the other way round from the report's main orientation. */
export const hasMixedPages = (blocks: ReportBlock[], base: Orientation) => pageOrientations(blocks, base).some((o) => o !== base);

/** One orientation for every page: page breaks still start new pages, but no longer turn them. */
export const samePages = (blocks: ReportBlock[]): ReportBlock[] =>
  blocks.map((b) => (b.pages || (b.type === 'pageBreak' && b.orientation) ? { ...b, pages: undefined, ...(b.type === 'pageBreak' ? { orientation: undefined } : {}) } : b));
