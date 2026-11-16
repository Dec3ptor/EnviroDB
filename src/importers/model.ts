import type { ParsedValue } from '../lib/values';

export interface RawResult {
  analyte: string; // as written in the file
  group?: string; // lab section heading, e.g. "Heavy metals, dissolved, trace"
  unit?: string;
  raw: unknown;
  parsed: ParsedValue;
}

export interface RawSample {
  key: string;
  sampleName: string;
  labNumber?: string;
  labJob?: string;
  /** Text used for matching to a site (sample name with the date removed, or a site column). */
  siteText: string;
  date?: string;
  dateSource?: 'cell' | 'name' | 'header' | 'none';
  sheet: string;
  results: RawResult[];
  /** Notes for the sample, e.g. the lab's comments on its results. */
  notes?: string;
  /** Sampling status given in the file ("Processed", "At Lab" …). */
  status?: string;
  /** The lab had not finished with the sample: its note starts with PROVISIONAL_NOTE, removed once final results are imported. */
  provisional?: boolean;
  /** The lab, when files from several labs are imported together. */
  labName?: string;
  /** When the lab received (registered) the sample, for holding times. */
  receivedOn?: string;
}

/** Start of the note on samples whose results were still with the lab when imported. */
export const PROVISIONAL_NOTE = 'Provisional:';

/**
 * Something in a file that isn't blank and wasn't read as a result – kept, and shown before the import, so nothing in
 * a file is left out unsaid.
 */
export interface LeftOut {
  /** The sheet or file. */
  sheet: string;
  /** The sample and the test it was for, as far as the file says. */
  sample?: string;
  analyte?: string;
  /** What the file has there. */
  text: string;
  /**
   * Why: the text isn't a number or a detection limit ("TNTC", "7.4 approx"); a line of results in a PDF with no test
   * beside it; two values under one sample in a PDF; a result with no sample to go to.
   */
  why: 'unreadable' | 'no-test' | 'two-values' | 'no-sample';
}

export interface ParsedImport {
  kind: 'lab' | 'wide' | 'long';
  labName?: string;
  labJob?: string;
  samples: RawSample[];
  warnings: string[];
  /** What the file has that wasn't read as results. */
  left?: LeftOut[];
}

/** A result cell that says something this can't read: noted (a master sheet can have thousands – the first of them). */
export function noteUnread(left: LeftOut[], parsed: { unread?: boolean; text: string }, where: Omit<LeftOut, 'text' | 'why'>): void {
  if (parsed.unread && left.length < 2000) left.push({ ...where, text: parsed.text.slice(0, 120), why: 'unreadable' });
}

/** Unique analyte key used for mapping (name + group + unit). */
export function analyteMapKey(r: Pick<RawResult, 'analyte' | 'group' | 'unit'>): string {
  return `${r.analyte}¦${r.group ?? ''}¦${r.unit ?? ''}`;
}
