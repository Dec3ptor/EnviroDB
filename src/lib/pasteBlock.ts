// Cells pasted from a spreadsheet into the Data tab: the block's rows and columns, where each cell lands from the cell
// pasted into, and what that would do – values added, values changed (said before anything is changed), cells that
// aren't values, cells that fall off the table.

import { parseValue } from './values';

/**
 * Text copied from a spreadsheet as rows of cells: tab-separated, a line each – a cell in "quotes" may hold tabs and
 * line breaks ("" is a quote). The empty line a spreadsheet puts at the end is dropped.
 */
export function parseBlock(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let i = 0;
  const t = text.replace(/\r\n?/g, '\n');
  const endCell = () => {
    row.push(cell.trim());
    cell = '';
  };
  while (i < t.length) {
    const ch = t[i];
    if (ch === '"' && cell === '') {
      // a quoted cell: to the closing quote
      let j = i + 1;
      let q = '';
      let closed = false;
      while (j < t.length) {
        if (t[j] === '"') {
          if (t[j + 1] === '"') {
            q += '"';
            j += 2;
            continue;
          }
          closed = true;
          break;
        }
        q += t[j++];
      }
      if (closed && (j + 1 >= t.length || t[j + 1] === '\t' || t[j + 1] === '\n')) {
        cell = q;
        i = j + 1;
        continue;
      }
    }
    if (ch === '\t') endCell();
    else if (ch === '\n') {
      endCell();
      rows.push(row);
      row = [];
    } else cell += ch;
    i++;
  }
  if (cell !== '' || row.length) {
    endCell();
    rows.push(row);
  }
  while (rows.length && rows[rows.length - 1].every((c) => c === '')) rows.pop();
  return rows;
}

/** More than one cell: a block to paste across the table (one cell is just typed in). */
export const isBlock = (block: string[][]): boolean => block.length > 1 || (block[0]?.length ?? 0) > 1;

/** A cell of the table a pasted value is for. */
export interface PasteTarget<T> {
  /** The cell: whatever the table needs to change it. */
  cell: T;
  /** What it has now, as typed ("12.5", "<0.005") – none: empty. */
  current?: string;
  /** It can't be typed into (a result left out after a QA/QC check). */
  blocked?: boolean;
  /** Where it is, in words: "DS1 9 Oct 2026 Turbidity". */
  label: string;
}

export interface PasteChange<T> {
  cell: T;
  label: string;
  /** What's pasted. */
  text: string;
  /** What it replaces. */
  before?: string;
}

export interface PastePlan<T> {
  /** Values put where there was none. */
  adds: Array<PasteChange<T>>;
  /** Values that replace another. */
  changes: Array<PasteChange<T>>;
  /** Cells that already have the value pasted. */
  same: number;
  /** Cells pasted that aren't values, as they were ("n/a") – nothing is done with them. */
  invalid: string[];
  /** Cells that fall beyond the table's last row or column. */
  outside: number;
  /** Cells that can't be typed into. */
  blocked: number;
  /** The block's size. */
  rows: number;
  cols: number;
}

const sameValue = (a: string, b: string): boolean => {
  const x = parseValue(a), y = parseValue(b);
  return x.value !== null && x.value === y.value && x.qualifier === y.qualifier;
};

/**
 * What pasting a block does, from the cell at (`row`, `col`) of the table as it's shown: across and down from there.
 * An empty cell in the block leaves its cell as it is (pasting never takes a value off). `target` gives the table's
 * cell at a place – null beyond its edge.
 */
export function planPaste<T>(block: string[][], at: { row: number; col: number }, target: (row: number, col: number) => PasteTarget<T> | null): PastePlan<T> {
  const plan: PastePlan<T> = { adds: [], changes: [], same: 0, invalid: [], outside: 0, blocked: 0, rows: block.length, cols: Math.max(0, ...block.map((r) => r.length)) };
  block.forEach((cells, r) =>
    cells.forEach((raw, c) => {
      const text = raw.trim();
      if (!text) return;
      const to = target(at.row + r, at.col + c);
      if (!to) {
        plan.outside++;
        return;
      }
      if (to.blocked) {
        plan.blocked++;
        return;
      }
      if (parseValue(text).value === null) {
        if (plan.invalid.length < 50) plan.invalid.push(text);
        return;
      }
      if (to.current !== undefined && to.current !== '') {
        if (sameValue(to.current, text)) plan.same++;
        else plan.changes.push({ cell: to.cell, label: to.label, text, before: to.current });
      } else plan.adds.push({ cell: to.cell, label: to.label, text });
    }),
  );
  return plan;
}

/** What a paste would do, in a sentence: "12 values to add, 3 to change". */
export function pasteSummary(p: Pick<PastePlan<unknown>, 'adds' | 'changes' | 'same' | 'invalid' | 'outside' | 'blocked'>): string {
  const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
  const parts = [p.adds.length ? `${n(p.adds.length, 'value')} to add` : '', p.changes.length ? `${n(p.changes.length, 'value')} to change` : ''].filter(Boolean);
  const notes = [
    p.same ? `${n(p.same, 'cell')} already ${p.same === 1 ? 'has its' : 'have their'} value` : '',
    p.invalid.length ? `${n(p.invalid.length, 'cell')} ${p.invalid.length === 1 ? 'isn’t a value' : 'aren’t values'} (${[...new Set(p.invalid)].slice(0, 4).join(', ')}${new Set(p.invalid).size > 4 ? ' …' : ''})` : '',
    p.outside ? `${n(p.outside, 'cell')} beyond the table’s edge` : '',
    p.blocked ? `${n(p.blocked, 'cell')} left out after a QA/QC check` : '',
  ].filter(Boolean);
  return `${parts.join(', ') || 'Nothing to paste'}${notes.length ? ` – ${notes.join('; ')}` : ''}`;
}
