// Highlight colours for results. Consent limits are red and consent triggers amber; each guideline set compared
// gets its own colour, in the order the sets were chosen – the first shares the triggers' amber.

import type { CellFlag } from './analysis';

export interface HighlightColour {
  name: string;
  fill: string;
  ink: string;
}

export const LIMIT_COLOUR: HighlightColour = { name: 'red', fill: '#F9D0D0', ink: '#8A1C1C' };
export const CHECK_COLOUR: HighlightColour = { name: 'purple', fill: '#E9E6F7', ink: '#3D2E7A' };

/** One per guideline set (repeating after five). */
export const SET_COLOURS: HighlightColour[] = [
  { name: 'amber', fill: '#FDE7C2', ink: '#7A4B00' },
  { name: 'blue', fill: '#D6E6FB', ink: '#0B3D75' },
  { name: 'green', fill: '#D4EFD9', ink: '#155D27' },
  { name: 'pink', fill: '#F7D6EA', ink: '#7A1450' },
  { name: 'teal', fill: '#CFEEEE', ink: '#0B4F4F' },
];

export const setColourIndex = (k: number) => k % SET_COLOURS.length;

/** Which of the guideline colours a guideline highlight uses (0 = amber, as for triggers). */
export function guidelineColour(f: CellFlag): number {
  return f.trigger || f.set === undefined ? 0 : setColourIndex(f.set);
}

/** CSS class of a highlighted data-grid cell. */
export function cellClass(f?: CellFlag): string {
  if (!f) return '';
  if (f.kind === 'limit') return 'hl-limit';
  if (f.kind === 'check') return 'hl-check';
  const k = guidelineColour(f);
  return k ? `hl-g${k}` : 'hl-guideline';
}

/** Fill (#RRGGBB) of a highlighted cell in a report or spreadsheet. */
export function flagFillColour(f?: CellFlag): string | undefined {
  if (!f) return undefined;
  if (f.kind === 'limit') return LIMIT_COLOUR.fill;
  if (f.kind === 'check') return CHECK_COLOUR.fill;
  return SET_COLOURS[guidelineColour(f)].fill;
}
