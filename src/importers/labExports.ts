// Lab exports with a row per result: Linnaeus (KTP) analysis reports saved as CSV, ALS "CSV_Simple" files, and ALS
// ESdat chemistry files (with or without the ESdat sample file). The lab's sample numbers change every round, so the
// site comes from the name the samples were sent in under ("2026000101 - Upstream" → "Upstream"); results for the same
// site and day from different labs (pH and conductivity from Linnaeus, the rest from ALS) end up in one sample.

import { cellText, isEmpty, type SheetGrid } from './workbook';
import { parseValue } from '../lib/values';
import { parseDateAny } from '../lib/dates';
import type { ParsedImport, RawResult, RawSample } from './model';

export type ExportFormat = 'linnaeus' | 'als' | 'esdat' | 'esdat-samples';

export const EXPORT_LABELS: Record<ExportFormat, string> = {
  linnaeus: 'Linnaeus analysis report (CSV)',
  als: 'ALS results (CSV, one row per result)',
  esdat: 'ALS ESdat chemistry file',
  'esdat-samples': 'ESdat sample file (site names and dates)',
};

/** What one file says about samples another file only numbers: site name and sampling date by lab number. */
export interface SampleInfo {
  clientRef: string;
  date?: string;
}
export interface ImportContext {
  samples: Map<string, SampleInfo>;
}
export const EMPTY_CONTEXT: ImportContext = { samples: new Map() };

/** A lab number written any way ("NH2600001-001", "NH2600001001") as one key. */
export const labKey = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** The lab job a sample number belongs to: "NH2600001001" → "NH2600001". */
export function labJobOf(labNumber: string): string | undefined {
  return labNumber.match(/^([A-Z]{2}\d{7})/)?.[1];
}

/**
 * The site in a client sample reference. Samples go to the lab as "<number> - <site>" (or, sent on to another lab,
 * "NH2600001_002; 2026000102 Pond Outlet"); the numbers change every round, the site name doesn't.
 */
export function siteFromClientRef(ref: string): string {
  const last = ref.split(/;\s*/).pop()!.replace(/\s+/g, ' ').trim();
  const name = last.replace(/^[A-Z]{0,3}\d{6,}(?:[-_]\d+)*(?:\s*[-–:]\s*|\s+)/, '').trim();
  return name || last;
}

/** ALS surrogates: recoveries (%) of compounds added by the lab to check the method, not results. */
const SURROGATE = /-d\d+\b|surrogate|fluorobiphenyl|fluorophenol|tribromophenol|terphenyl/i;
/** An ALS sample number, as written in another lab's report ("NH2600001_003"). */
const ALS_NUMBER = /^[A-Z]{2}\d{7}[-_]\d{3}$/;
/** A reference to another lab's report in place of a result ("NH2600001_2_AA"). */
const REPORT_REF = /^[A-Z]{2}\d{7}(?:_[0-9A-Z]+)*$/;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

interface Header {
  format: ExportFormat;
  row: number;
  cols: Map<string, number>;
}

function headerAt(g: SheetGrid, r: number): Map<string, number> {
  const cols = new Map<string, number>();
  (g.rows[r] ?? []).forEach((c, i) => {
    const t = norm(cellText(c));
    if (t && !cols.has(t)) cols.set(t, i);
  });
  return cols;
}

const has = (cols: Map<string, number>, ...names: string[]) => names.every((n) => cols.has(norm(n)));

function formatOf(cols: Map<string, number>): ExportFormat | null {
  if (has(cols, 'SAMPLE_ID', 'NAME') && [...cols.keys()].some((k) => k.startsWith('paramunits'))) return 'linnaeus';
  if (has(cols, 'ClientSampleReference', 'SampleDate', 'AnalyteDescription', 'Unit') && (has(cols, 'TextResult') || has(cols, 'NumericResult'))) return 'als';
  if (has(cols, 'SampleCode', 'OriginalChemName', 'Result', 'Result_Unit')) return 'esdat';
  if (has(cols, 'SampleCode', 'Sampled_Date_Time')) return 'esdat-samples';
  return null;
}

/** The export a sheet is, from its header row (within the first rows). */
export function detectExport(g: SheetGrid): Header | null {
  for (let r = 0; r < Math.min(g.nRows, 30); r++) {
    const cols = headerAt(g, r);
    const format = cols.size >= 3 ? formatOf(cols) : null;
    if (format) return { format, row: r, cols };
  }
  return null;
}

function column(cols: Map<string, number>, ...names: string[]): number {
  for (const n of names) {
    const c = cols.get(norm(n));
    if (c !== undefined) return c;
  }
  return -1;
}

const text = (g: SheetGrid, r: number, c: number) => (c < 0 ? '' : cellText(g.rows[r]?.[c]));
const lines = (s: string) => s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

/** A test's name without the lab's footnote marks ("Temperature on Site*": not accredited). */
const bareName = (name: string) => name.replace(/^[øØ*#†‡^]+\s*|\s*[*#†‡^]+$/g, '').trim();

function result(analyte: string, raw: string, unit?: string, group?: string): RawResult | null {
  const parsed = parseValue(raw);
  if (parsed.missing) return null;
  return { analyte: bareName(analyte), group, unit: unit || undefined, raw, parsed };
}

function sampleFor(map: Map<string, RawSample>, key: string, make: () => RawSample): RawSample {
  let s = map.get(key);
  if (!s) {
    s = make();
    map.set(key, s);
  }
  return s;
}

function parseLinnaeus(g: SheetGrid, h: Header): ParsedImport {
  const cId = column(h.cols, 'SAMPLE_ID');
  const cName = column(h.cols, 'NAME');
  const cUnit = [...h.cols].find(([k]) => k.startsWith('paramunits'))?.[1] ?? -1;
  const cDate = cId + 1 < cName ? cId + 1 : -1;
  const cValue = cUnit >= 0 ? cUnit + 1 : cName + 1;
  const samples = new Map<string, RawSample>();
  for (let r = h.row + 1; r < g.nRows; r++) {
    const id = text(g, r, cId);
    if (/^NAME\d*$/.test(id)) break; // the test methods under the results
    const analyte = text(g, r, cName);
    const value = text(g, r, cValue);
    if (!id || !analyte || !value || REPORT_REF.test(value) || /laborator(y|ies) report|subcontract/i.test(analyte)) continue;
    const [first, ...rest] = lines(id);
    const code = /^\d{5,}$/.test(first) ? first : '';
    const name = (code ? rest : [first, ...rest]).join(' ');
    const date = parseDateAny(lines(text(g, r, cDate)).join(' ')) ?? undefined;
    const s = sampleFor(samples, `${code}|${name}|${date ?? ''}`, () => ({
      key: `${g.name}|${code}|${name}|${date ?? ''}`,
      sampleName: code ? `${code} ${name}` : name,
      labNumber: code || undefined,
      siteText: siteFromClientRef(name),
      date,
      dateSource: date ? 'cell' : 'none',
      sheet: g.name,
      labName: 'Linnaeus',
      results: [],
    }));
    const res = result(analyte, value, text(g, r, cUnit));
    if (res) s.results.push(res);
  }
  return { kind: 'lab', labName: 'Linnaeus', samples: [...samples.values()].filter((s) => s.results.length), warnings: [] };
}

function parseAls(g: SheetGrid, h: Header, ctx: ImportContext): ParsedImport {
  const c = {
    lab: column(h.cols, 'LabSampleReference'),
    client: column(h.cols, 'ClientSampleReference'),
    date: column(h.cols, 'SampleDate'),
    ref: column(h.cols, 'AnalyteReference'),
    name: column(h.cols, 'AnalyteDescription'),
    text: column(h.cols, 'TextResult'),
    num: column(h.cols, 'NumericResult'),
    unit: column(h.cols, 'Unit'),
    group: column(h.cols, 'Group'),
    laboratory: column(h.cols, 'Laboratory'),
  };
  const samples = new Map<string, RawSample>();
  let surrogates = 0;
  for (let r = h.row + 1; r < g.nRows; r++) {
    if ((g.rows[r] ?? []).every(isEmpty)) continue;
    const labNumber = text(g, r, c.lab);
    if (norm(labNumber) === 'labsamplereference') continue; // the header again
    const analyte = text(g, r, c.name) || text(g, r, c.ref);
    const unit = text(g, r, c.unit);
    if (!analyte) continue;
    if (unit === '%' && SURROGATE.test(analyte)) {
      surrogates++;
      continue;
    }
    const info = labNumber ? ctx.samples.get(labKey(labNumber)) : undefined;
    let client = text(g, r, c.client) || info?.clientRef || labNumber;
    let date = parseDateAny(text(g, r, c.date)) ?? info?.date ?? undefined;
    // a sample sent on to another lab under the first lab's number ("NH2600001_003"): named by the first lab's files
    const via = ALS_NUMBER.test(siteFromClientRef(client)) ? ctx.samples.get(labKey(siteFromClientRef(client))) : undefined;
    if (via) {
      client = via.clientRef;
      date ??= via.date;
    }
    const ref = text(g, r, c.ref);
    // ALS codes say which fraction a metal was measured in: _WS_ dissolved (filtered), _WT_ total
    const group = text(g, r, c.group) || (/_WS_/.test(ref) ? 'Dissolved' : /_WT_/.test(ref) ? 'Total' : undefined);
    const lab = text(g, r, c.laboratory) || 'ALS';
    const s = sampleFor(samples, `${labNumber || client}|${date ?? ''}`, () => ({
      key: `${g.name}|${labNumber || client}|${date ?? ''}`,
      sampleName: client,
      labNumber: labNumber || undefined,
      labJob: labJobOf(labNumber),
      siteText: siteFromClientRef(client),
      date,
      dateSource: date ? 'cell' : 'none',
      sheet: g.name,
      labName: lab,
      results: [],
    }));
    const res = result(analyte, text(g, r, c.text) || text(g, r, c.num), unit, group);
    if (res) s.results.push(res);
  }
  const list = [...samples.values()].filter((s) => s.results.length);
  const warnings = surrogates ? [`Left out ${surrogates} surrogate recoveries (%) – the lab's own method checks, not results.`] : [];
  return { kind: 'lab', labName: list[0]?.labName ?? 'ALS', labJob: list.length ? list[0].labJob : undefined, samples: list, warnings };
}

function parseEsdat(g: SheetGrid, h: Header, ctx: ImportContext): ParsedImport {
  let cols = h.cols;
  const samples = new Map<string, RawSample>();
  let qc = 0;
  for (let r = h.row + 1; r < g.nRows; r++) {
    const row = g.rows[r] ?? [];
    if (row.every(isEmpty)) continue;
    if (norm(cellText(row[0])) === 'samplecode') {
      cols = headerAt(g, r); // a second table, with more columns
      continue;
    }
    const at = (...names: string[]) => text(g, r, column(cols, ...names));
    const code = at('SampleCode');
    if (!code) continue;
    // the lab's quality control, and other clients' samples in the same batch
    if (/^QC/i.test(code) || code.includes('_')) {
      qc++;
      continue;
    }
    const unit = at('Result_Unit');
    if (unit === '%') continue;
    const info = ctx.samples.get(labKey(code));
    const tf = at('Total_or_Filtered').toUpperCase();
    const s = sampleFor(samples, code, () => ({
      key: `${g.name}|${code}`,
      sampleName: info?.clientRef ?? code,
      labNumber: code,
      labJob: labJobOf(code),
      siteText: info ? siteFromClientRef(info.clientRef) : code,
      date: info?.date,
      dateSource: info?.date ? 'cell' : 'none',
      sheet: g.name,
      labName: 'ALS',
      results: [],
    }));
    const res = result(at('OriginalChemName', 'ChemName', 'ChemCode'), `${at('Prefix')}${at('Result')}`, unit, tf === 'F' ? 'Dissolved' : tf === 'T' ? 'Total' : undefined);
    if (res) s.results.push(res);
  }
  const list = [...samples.values()].filter((s) => s.results.length);
  const warnings: string[] = [];
  const unnamed = list.filter((s) => !ctx.samples.has(labKey(s.labNumber!)));
  if (unnamed.length) {
    const jobs = [...new Set(unnamed.map((s) => s.labJob).filter(Boolean))].join(', ');
    warnings.push(
      `This ESdat file only numbers the samples. Drop it together with the ALS PDF report${jobs ? ` for ${jobs}` : ''} (or the ESdat sample file) to fill in the site names and sampling dates – or choose them under Sites & dates.`,
    );
  }
  if (qc) warnings.push(`Left out ${qc} laboratory QC results (blanks, spikes, duplicates and other clients' samples).`);
  return { kind: 'lab', labName: 'ALS', labJob: list[0]?.labJob, samples: list, warnings };
}

/** Site names and dates from an ESdat sample file, by lab sample code. */
function esdatSamples(g: SheetGrid, h: Header): Array<[string, SampleInfo]> {
  const out: Array<[string, SampleInfo]> = [];
  for (let r = h.row + 1; r < g.nRows; r++) {
    const at = (...names: string[]) => text(g, r, column(h.cols, ...names));
    const code = at('SampleCode');
    if (!code) continue;
    const clientRef = at('Field_ID', 'Location_Code', 'Sample_Name', 'Client_Sample_ID', 'ClientSampleID');
    if (!clientRef) continue;
    out.push([labKey(code), { clientRef, date: parseDateAny(at('Sampled_Date_Time', 'Sampled_Date')) ?? undefined }]);
  }
  return out;
}

/** What the files of an import say about each other's samples (an ESdat sample file names the chemistry file's samples). */
export function importContext(grids: SheetGrid[], more: Array<[string, SampleInfo]> = []): ImportContext {
  const samples = new Map<string, SampleInfo>(more);
  for (const g of grids) {
    const h = detectExport(g);
    if (h?.format === 'esdat-samples') for (const [k, v] of esdatSamples(g, h)) samples.set(k, v);
    // ALS's own files name their samples, for other labs' reports that only give ALS's numbers
    if (h?.format === 'als')
      for (let r = h.row + 1; r < g.nRows; r++) {
        const num = text(g, r, column(h.cols, 'LabSampleReference'));
        const clientRef = text(g, r, column(h.cols, 'ClientSampleReference'));
        if (num && clientRef && !ALS_NUMBER.test(siteFromClientRef(clientRef)) && !samples.has(labKey(num)))
          samples.set(labKey(num), { clientRef, date: parseDateAny(text(g, r, column(h.cols, 'SampleDate'))) ?? undefined });
      }
  }
  return { samples };
}

export function parseExport(g: SheetGrid, ctx: ImportContext = EMPTY_CONTEXT): ParsedImport | null {
  const h = detectExport(g);
  if (!h) return null;
  switch (h.format) {
    case 'linnaeus':
      return parseLinnaeus(g, h);
    case 'als':
      return parseAls(g, h, ctx);
    case 'esdat':
      return parseEsdat(g, h, ctx);
    case 'esdat-samples':
      return { kind: 'lab', samples: [], warnings: [] };
  }
}
