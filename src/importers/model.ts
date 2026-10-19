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

export interface ParsedImport {
  kind: 'lab' | 'wide' | 'long';
  labName?: string;
  labJob?: string;
  samples: RawSample[];
  warnings: string[];
}

/** Unique analyte key used for mapping (name + group + unit). */
export function analyteMapKey(r: Pick<RawResult, 'analyte' | 'group' | 'unit'>): string {
  return `${r.analyte}¦${r.group ?? ''}¦${r.unit ?? ''}`;
}
