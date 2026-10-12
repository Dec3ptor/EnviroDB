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

/** The rows that move together: a heading with its section, anything else on its own. */
const unitRange = (blocks: ReportBlock[], i: number): [number, number] => (blocks[i].type === 'heading' ? sectionRange(blocks, i) : [i, i + 1]);

/** Nothing goes above a title page at the top. */
const firstFree = (list: ReportBlock[]) => (list[0]?.type === 'title' ? 1 : 0);

/**
 * Drag and drop: move a block – a heading together with its section – to exactly where it was dropped. `to` is the
 * index of the row it was dropped on: it goes above that row when moving up and below it when moving down, so a
 * heading can go straight above a table.
 */
export function moveSection(blocks: ReportBlock[], i: number, to: number): ReportBlock[] {
  const [a, z] = unitRange(blocks, i);
  if (to >= a && to < z) return blocks;
  const rest = [...blocks.slice(0, a), ...blocks.slice(z)];
  const at = Math.max(firstFree(rest), to > i ? to - (z - a) + 1 : to);
  return insertAt(rest, at, blocks.slice(a, z));
}

/**
 * The arrows: a heading with content moves with its section past the next section (so sections swap places
 * without taking each other's content); anything else, including a heading on its own, moves one row.
 * Null when it can't move further.
 */
export function stepSection(blocks: ReportBlock[], i: number, d: -1 | 1): ReportBlock[] | null {
  const [a, z] = unitRange(blocks, i);
  const rest = [...blocks.slice(0, a), ...blocks.slice(z)];
  const h = blocks[i];
  let at: number | undefined;
  if (h.type === 'heading' && z - a > 1) {
    const starts = sectionStarts(rest, h.level);
    at = d > 0 ? starts.find((s) => s > a) : [...starts].reverse().find((s) => s < a);
  } else at = a + d;
  if (at === undefined || at < firstFree(rest) || at > rest.length) return null;
  return insertAt(rest, at, blocks.slice(a, z));
}

/** True when some pages are the other way round from the report's main orientation. */
export const hasMixedPages = (blocks: ReportBlock[], base: Orientation) => pageOrientations(blocks, base).some((o) => o !== base);

/** One orientation for every page: page breaks still start new pages, but no longer turn them. */
export const samePages = (blocks: ReportBlock[]): ReportBlock[] =>
  blocks.map((b) => (b.pages || (b.type === 'pageBreak' && b.orientation) ? { ...b, pages: undefined, ...(b.type === 'pageBreak' ? { orientation: undefined } : {}) } : b));
