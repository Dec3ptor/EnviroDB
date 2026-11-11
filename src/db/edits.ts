// Values typed into the Data tab: a result added to a sample, changed, or taken off – one at a time, or a block pasted
// from a spreadsheet – and a sample added by hand. Every change says what it was before (the first value a result had
// is kept on it, so a lab's value is never lost), goes in the project's history, and can be undone.

import { db } from './db';
import { logAudit, whoAmI } from './audit';
import { touchProject } from './repo';
import type { Parameter, Result, Sample } from './types';
import { nowIso, uid } from '../lib/ids';
import { parseValue } from '../lib/values';
import { formatDate } from '../lib/dates';

/** A result as typed: "12.5", "<0.005". */
export const typedText = (r: Pick<Result, 'value' | 'qualifier' | 'text'>) => (r.value === null ? (r.text ?? '') : `${r.qualifier}${r.value}`);

export interface CellChange {
  /** What happened, to say: "DS1 1 Nov 2026 Turbidity: 12 → 14 NTU". */
  said: string;
  undo: () => Promise<void>;
  /** A value where there was none, one changed, or one taken off. */
  kind: 'added' | 'changed' | 'removed';
}

type CellSample = Pick<Sample, 'id' | 'projectId' | 'siteId' | 'date'>;
type CellParam = Pick<Parameter, 'id' | 'name' | 'unit'>;

/**
 * A value typed into a sample's cell for a parameter: a number ("12.5"), or below detection ("<0.005") – added,
 * changed, or (empty) taken off. Null when nothing changes. Throws when what's typed isn't a value.
 */
export const setCellValue = (sample: CellSample, param: CellParam, typed: string, siteCode: string): Promise<CellChange | null> => changeCell(sample, param, typed, siteCode, false);

/** The change itself – `quiet`: one of many (the history gets one entry for them all). */
async function changeCell(sample: CellSample, param: CellParam, typed: string, siteCode: string, quiet: boolean): Promise<CellChange | null> {
  const log = async (text: string) => {
    if (!quiet) await logAudit(sample.projectId, 'result', text);
  };
  const touch = async () => {
    if (!quiet) await touchProject(sample.projectId);
  };
  const text = typed.trim();
  const before = await db.results.where('sampleId').equals(sample.id).filter((r) => r.parameterId === param.id && !r.excluded).first();
  const where = `${siteCode} ${formatDate(sample.date.slice(0, 10))} ${param.name}`;
  const unit = param.unit ? ` ${param.unit}` : '';
  if (!text) {
    if (!before) return null;
    await db.results.delete(before.id);
    await log(`${where}: ${typedText(before)}${unit} taken off`);
    await touch();
    return {
      kind: 'removed',
      said: `${where}: ${typedText(before)}${unit} taken off`,
      undo: async () => {
        await db.results.put(before);
        await log(`${where}: put back (${typedText(before)}${unit})`);
      },
    };
  }
  const v = parseValue(text);
  if (v.value === null) throw new Error(`“${text}” isn’t a value – type a number, or <0.005 for below detection.`);
  const now = { value: v.value, qualifier: v.qualifier, text, ...(v.qualifier === '<' ? { dl: v.value } : {}) };
  if (before && before.value === now.value && before.qualifier === now.qualifier && before.unit === param.unit) return null;
  const edited = { at: nowIso(), by: whoAmI() || undefined, was: before ? (before.edited?.was ?? typedText(before)) : '' };
  const next: Result = before
    ? { ...before, ...now, unit: param.unit, edited }
    : { id: uid('r'), projectId: sample.projectId, sampleId: sample.id, siteId: sample.siteId, date: sample.date, parameterId: param.id, ...now, unit: param.unit, edited };
  // the detection limit goes with a value below it, and only then
  delete next.dl;
  if (now.qualifier === '<') next.dl = now.value;
  await db.results.put(next);
  const said = before ? `${where}: ${typedText(before)} → ${text}${unit}` : `${where}: ${text}${unit} added`;
  await log(said);
  await touch();
  return {
    kind: before ? 'changed' : 'added',
    said,
    undo: async () => {
      if (before) await db.results.put(before);
      else await db.results.delete(next.id);
      await log(`${where}: change undone`);
    },
  };
}

export interface BlockChange {
  added: number;
  changed: number;
  /** Cells that couldn't be changed, each with why. */
  errors: string[];
  /** "14 values pasted: 10 added, 4 changed". */
  said: string;
  /** Puts every cell back as it was. */
  undo: () => Promise<void>;
}

/**
 * A block of values pasted into the Data tab: each cell as if typed, but one entry in the project's history and one
 * Undo for them all. Null when nothing changes.
 */
export async function setCellValues(projectId: string, cells: Array<{ sample: CellSample; param: CellParam; text: string; siteCode: string }>): Promise<BlockChange | null> {
  const done: CellChange[] = [];
  const errors: string[] = [];
  for (const c of cells) {
    if (!c.text.trim()) continue; // pasting never takes a value off
    try {
      const change = await changeCell(c.sample, c.param, c.text, c.siteCode, true);
      if (change) done.push(change);
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  if (!done.length) return errors.length ? { added: 0, changed: 0, errors, said: 'Nothing pasted', undo: async () => undefined } : null;
  const added = done.filter((d) => d.kind === 'added').length;
  const changed = done.length - added;
  const said = `${done.length} value${done.length === 1 ? '' : 's'} pasted: ${[added ? `${added} added` : '', changed ? `${changed} changed` : ''].filter(Boolean).join(', ')}`;
  // the first few are named in the history, so a paste can be traced
  await logAudit(projectId, 'result', `${said} – ${done.slice(0, 3).map((d) => d.said).join('; ')}${done.length > 3 ? ' …' : ''}`);
  await touchProject(projectId);
  return {
    added,
    changed,
    errors,
    said,
    undo: async () => {
      for (const d of [...done].reverse()) await d.undo();
      await logAudit(projectId, 'result', `Paste undone (${done.length} value${done.length === 1 ? '' : 's'})`);
      await touchProject(projectId);
    },
  };
}

/** A sample added by hand: a site on a day (and time) – or the one it has that day already. */
export async function addSample(projectId: string, siteId: string, date: string, siteCode: string): Promise<{ sample: Sample; added: boolean }> {
  const day = date.slice(0, 10);
  const there = await db.samples.where('projectId').equals(projectId).filter((s) => s.siteId === siteId && s.date.slice(0, 10) === day && !s.qc).first();
  if (there) return { sample: there, added: false };
  const sample: Sample = { id: uid('s'), projectId, siteId, date };
  await db.samples.put(sample);
  await logAudit(projectId, 'sample', `Sample added by hand: ${siteCode} ${formatDate(day)}`);
  await touchProject(projectId);
  return { sample, added: true };
}
