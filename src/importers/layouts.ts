// "Teach EnviroDB this lab file": when someone puts a sheet's layout right by hand (its header row, which column
// is the site, which the date …), the layout is kept against the shape of the sheet – the words in its first rows,
// not the numbers – and used by itself next time a file of the same shape comes in. Shared with the team.

import { db } from '../db/db';
import type { ImportLayout } from '../db/types';
import { whoAmI } from '../db/audit';
import { stableId } from '../lib/ids';
import { todayStr } from '../lib/dates';
import type { SheetPlan } from './detect';
import { cellText, type SheetGrid } from './workbook';

/**
 * The shape of a sheet: the words in its first rows, down to the first row of numbers – a lab's or a spreadsheet's
 * headings, with digits left out (codes and dates change from file to file; the labels don't).
 */
export function sheetFingerprint(g: SheetGrid): string {
  const words: string[] = [];
  let rowsSeen = 0;
  for (let r = 0; r < g.nRows && rowsSeen < 8; r++) {
    const texts: string[] = [];
    let filled = 0;
    let numeric = 0;
    for (let c = 0; c < g.nCols; c++) {
      const cell = g.rows[r]?.[c];
      const t = cellText(cell).toLowerCase().trim();
      if (!t) continue;
      filled++;
      if (typeof cell?.v === 'number' || /^[-+<>]?\d[\d.,]*$/.test(t)) {
        numeric++;
        continue;
      }
      // a label, not a value: letters in it, and not mostly digits
      if (!/[a-z]/.test(t) || t.replace(/[^0-9]/g, '').length > t.length / 2) continue;
      texts.push(t.replace(/\d+/g, '#').replace(/\s+/g, ' ').slice(0, 40));
    }
    // the first row that is mostly numbers is data: the shape is what comes before it
    if (filled >= 2 && numeric / filled >= 0.5) break;
    if (!texts.length) continue;
    rowsSeen++;
    words.push(`${r}:${texts.slice(0, 40).join('|')}`);
  }
  return stableId('fp', ...words);
}

const stripScore = (p: SheetPlan): ImportLayout['plan'] => {
  const { score: _s, ...rest } = p as SheetPlan & { score: number };
  void _s;
  return rest as ImportLayout['plan'];
};

/** Keep these sheets' layouts for files of the same shape – a sheet skipped (a notes sheet) is remembered as skipped. */
export async function rememberLayouts(grids: SheetGrid[], plans: SheetPlan[], fileName: string): Promise<ImportLayout[]> {
  const out: ImportLayout[] = [];
  const by = whoAmI();
  for (const plan of plans) {
    const g = grids.find((x) => x.name === plan.sheet);
    if (!g || g.pdf) continue;
    const fingerprint = sheetFingerprint(g);
    const was = await db.layouts.where('fingerprint').equals(fingerprint).first();
    const layout: ImportLayout = {
      id: was?.id ?? stableId('lay', fingerprint),
      fingerprint,
      sheetName: g.name,
      plan: stripScore(plan),
      fileName,
      learnedOn: todayStr(),
      by: by || undefined,
      uses: was?.uses ?? 0,
    };
    await db.layouts.put(layout);
    out.push(layout);
  }
  return out;
}

/** The plans with any remembered layout in place of the guess; which were remembered, and from what. */
export async function withRememberedLayouts(grids: SheetGrid[], plans: SheetPlan[]): Promise<{ plans: SheetPlan[]; remembered: Array<{ sheet: string; layout: ImportLayout }> }> {
  const remembered: Array<{ sheet: string; layout: ImportLayout }> = [];
  const out: SheetPlan[] = [];
  for (const plan of plans) {
    const g = grids.find((x) => x.name === plan.sheet);
    const layout = g && !g.pdf ? await db.layouts.where('fingerprint').equals(sheetFingerprint(g)).first() : undefined;
    if (!layout || !fits(layout.plan, g!)) {
      out.push(plan);
      continue;
    }
    out.push({ ...(layout.plan as SheetPlan), sheet: plan.sheet, score: 100 } as SheetPlan);
    remembered.push({ sheet: plan.sheet, layout });
    db.layouts.update(layout.id, { uses: (layout.uses ?? 0) + 1, lastUsed: todayStr() }).catch(() => undefined);
  }
  return { plans: out, remembered };
}

/** Whether a remembered layout still makes sense on this sheet (its rows and columns exist). */
function fits(plan: ImportLayout['plan'], g: SheetGrid): boolean {
  if (plan.mode === 'wide') return plan.config.headerRow < g.nRows;
  if (plan.mode === 'long') return plan.config.headerRow < g.nRows;
  return true;
}

export async function forgetLayout(id: string): Promise<void> {
  await db.layouts.delete(id);
}

/** Whether the plans differ from what was guessed – the sign that someone put a layout right. */
export function plansChanged(guessed: SheetPlan[], now: SheetPlan[]): boolean {
  return JSON.stringify(guessed.map(stripScore)) !== JSON.stringify(now.map(stripScore));
}
