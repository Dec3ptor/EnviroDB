// Parser for laboratory certificate-style spreadsheets (e.g. Hill Laboratories Excel results):
//
//   Client: …            Lab No: 3512345
//   Sample Name:          | SW1 12-Mar-2024 10:30 am | SW2 12-Mar-2024 11:00 am
//   Lab Number:           | 3512345.1                | 3512345.2
//   Individual Tests
//   Total Suspended Solids  g/m³ | < 3  | 12
//   Heavy metals, dissolved, trace As,Cd,Cr,Cu,Ni,Pb,Zn
//   Dissolved Zinc          g/m³ | 0.0021 | 0.0089
//
// Samples run across the columns and analytes down the rows, with a units column after the names.
// Sampling dates are taken from a "Date Sampled" row when present, otherwise from the sample name.

import { cellAt, cellText, cellValue, isEmpty, type SheetGrid } from './workbook';
import type { ParsedImport, RawSample } from './model';
import { extractDate, parseDateAny } from '../lib/dates';
import { normUnit } from '../lib/units';
import { parseValue } from '../lib/values';

const SAMPLE_ROW = /^(client\s+)?sample\s*(name|id|description|ref(erence)?)\s*:?$|^client\s+sample\s+id\s*:?$|^sample\s*:?$|^sample\s+location\s*:?$/i;
const LABNO_ROW = /^lab(oratory)?\s*(sample\s*)?(number|no\.?|#|id|ref)\s*:?$/i;
const DATE_ROW = /^(date|time)?\s*(sampled|collected|of\s+sampling|sampling\s+date)|^(sample|sampling|collection)\s+date|^date\s*\/?\s*time\s*sampled|^date\s*:?$/i;
const TIME_ROW = /^time\s*(sampled|collected)?\s*:?$/i;
const META_ROW = /^(sample\s*type|matrix|client\s*ref|order\s*no|quote\s*no|batch|received|date\s*received|date\s*reported|container|preservation|sample\s*condition|depth|units?\s*:?$)/i;
const STOP_ROW = /^(summary\s+of\s+methods|analyst'?s?\s+comments?|method\s+summary|notes?\s*:|these\s+samples|this\s+certificate|samples?\s+are\s+held|the\s+results|key\s*:|footnotes?)/i;
const LAB_NAMES: Array<[RegExp, string]> = [
  [/hill\s*lab(oratorie)?s?|r\s*j\s*hill/i, 'Hill Laboratories'],
  [/eurofins/i, 'Eurofins'],
  [/analytica/i, 'Analytica Laboratories'],
  [/watercare/i, 'Watercare Laboratory Services'],
  [/als\b/i, 'ALS'],
  [/asurequality/i, 'AsureQuality'],
];

export interface LabBlock {
  sampleRow: number;
  labRow: number | null;
  labelCol: number;
  unitCol: number | null;
  sampleCols: number[];
  endRow: number;
}

function labelOf(g: SheetGrid, r: number, maxCol = 4): { col: number; text: string } | null {
  for (let c = 0; c < Math.min(maxCol, g.rows[r]?.length ?? 0); c++) {
    const t = cellText(cellAt(g, r, c));
    if (t) return { col: c, text: t };
  }
  return null;
}

/** Find certificate-style blocks (a "Sample Name" row followed by analyte rows). */
export function findLabBlocks(g: SheetGrid): LabBlock[] {
  const blocks: LabBlock[] = [];
  for (let r = 0; r < g.nRows; r++) {
    const lab = labelOf(g, r);
    if (!lab || !SAMPLE_ROW.test(lab.text)) continue;
    const labelCol = lab.col;
    const valuesFrom = labelCol + 1;
    const rowCells = g.rows[r] ?? [];
    const sampleCols: number[] = [];
    for (let c = valuesFrom; c < rowCells.length; c++) if (!isEmpty(rowCells[c])) sampleCols.push(c);
    if (!sampleCols.length) continue;
    // Lab number row within the next few rows
    let labRow: number | null = null;
    for (let k = r - 2; k <= r + 4; k++) {
      if (k < 0 || k === r) continue;
      const l = labelOf(g, k);
      if (l && LABNO_ROW.test(l.text)) {
        labRow = k;
        break;
      }
    }
    // Units column: a column between the label and the first sample column
    const first = sampleCols[0];
    let unitCol: number | null = null;
    if (first - labelCol >= 2) {
      let unitHits = 0, tested = 0;
      for (let k = r + 1; k < Math.min(g.nRows, r + 60); k++) {
        const u = cellText(cellAt(g, k, first - 1));
        if (!u) continue;
        tested++;
        if (normUnit(u).known || /^(ph|ph units|ntu|°c|% ?sat|mpn|cfu)/i.test(u)) unitHits++;
      }
      if (tested && unitHits / tested > 0.3) unitCol = first - 1;
    }
    // block ends at the next sample row or a stop row
    let end = g.nRows - 1;
    for (let k = r + 1; k < g.nRows; k++) {
      const l = labelOf(g, k);
      if (l && (SAMPLE_ROW.test(l.text) || STOP_ROW.test(l.text))) {
        end = k - 1;
        break;
      }
    }
    blocks.push({ sampleRow: r, labRow, labelCol, unitCol, sampleCols, endRow: end });
    r = end;
  }
  return blocks;
}

export function detectLabName(g: SheetGrid): string | undefined {
  for (let r = 0; r < Math.min(g.nRows, 40); r++) {
    for (const cell of g.rows[r] ?? []) {
      const t = cellText(cell);
      if (!t) continue;
      for (const [re, name] of LAB_NAMES) if (re.test(t)) return name;
    }
  }
  return undefined;
}

function headerValue(g: SheetGrid, re: RegExp): string | undefined {
  for (let r = 0; r < Math.min(g.nRows, 30); r++) {
    const row = g.rows[r] ?? [];
    for (let c = 0; c < row.length; c++) {
      const t = cellText(row[c]);
      if (!re.test(t)) continue;
      const inline = t.split(':').slice(1).join(':').trim();
      if (inline) return inline;
      for (let k = c + 1; k < Math.min(row.length, c + 4); k++) {
        const v = cellText(row[k]);
        if (v) return v;
      }
    }
  }
  return undefined;
}

export function parseLabSheet(g: SheetGrid): ParsedImport | null {
  const blocks = findLabBlocks(g);
  if (!blocks.length) return null;
  const labName = detectLabName(g);
  const labJob = headerValue(g, /^(lab\s*no\.?|lab\s*number|job\s*(no|number)|report\s*(no|number))\s*:?/i);
  const received = headerValue(g, /^date\s*received\s*:?/i);
  const warnings: string[] = [];
  const samples: RawSample[] = [];

  blocks.forEach((b, bi) => {
    const blockSamples: RawSample[] = b.sampleCols.map((c) => {
      const name = cellText(cellAt(g, b.sampleRow, c));
      const labNumber = b.labRow !== null ? cellText(cellAt(g, b.labRow, c)) : undefined;
      const ex = extractDate(name);
      return {
        key: `${g.name}#${bi}#${c}`,
        sampleName: name,
        labNumber: labNumber || undefined,
        labJob,
        siteText: ex ? ex.rest : name,
        date: ex?.date,
        dateSource: ex ? 'name' : 'none',
        sheet: g.name,
        results: [],
      };
    });
    let group: string | undefined;
    const start = Math.max(b.sampleRow, b.labRow ?? -1) + 1;
    const times: Record<number, string> = {};
    for (let r = start; r <= b.endRow; r++) {
      const label = cellText(cellAt(g, r, b.labelCol));
      if (!label) continue;
      if (STOP_ROW.test(label)) break;
      const hasValues = b.sampleCols.some((c) => !isEmpty(cellAt(g, r, c)));
      if (TIME_ROW.test(label) && hasValues) {
        b.sampleCols.forEach((c, i) => {
          const t = cellAt(g, r, c);
          if (typeof t.v === 'number' && t.v < 1) {
            const mins = Math.round(t.v * 1440);
            times[i] = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
          } else {
            const m = cellText(t).match(/(\d{1,2})[:.](\d{2})/);
            if (m) times[i] = `${m[1].padStart(2, '0')}:${m[2]}`;
          }
        });
        continue;
      }
      if (DATE_ROW.test(label) && hasValues) {
        b.sampleCols.forEach((c, i) => {
          const d = parseDateAny(cellValue(cellAt(g, r, c)));
          if (!d) return;
          // keep a time taken from the sample name when the date cell holds the same day without a time
          const cur = blockSamples[i].date;
          const keepNameTime = !!cur && cur.length > 10 && d.length === 10 && cur.slice(0, 10) === d;
          blockSamples[i].date = keepNameTime ? cur : d;
          blockSamples[i].dateSource = 'cell';
        });
        continue;
      }
      if (META_ROW.test(label) || LABNO_ROW.test(label) || SAMPLE_ROW.test(label)) continue;
      if (!hasValues) {
        group = label; // section heading, e.g. "Heavy metals, dissolved, trace"
        continue;
      }
      const unit = b.unitCol !== null ? cellText(cellAt(g, r, b.unitCol)) || undefined : undefined;
      b.sampleCols.forEach((c, i) => {
        const raw = cellValue(cellAt(g, r, c));
        const parsed = parseValue(raw);
        if (parsed.missing) return;
        blockSamples[i].results.push({ analyte: label, group, unit, raw, parsed });
      });
    }
    blockSamples.forEach((s, i) => {
      if (times[i] && s.date && s.date.length === 10) s.date = `${s.date}T${times[i]}`;
      if (!s.date && received) {
        const d = parseDateAny(received);
        if (d) {
          s.date = d.slice(0, 10);
          s.dateSource = 'header';
        }
      }
    });
    samples.push(...blockSamples.filter((s) => s.results.length));
  });

  if (samples.some((s) => s.dateSource === 'header')) warnings.push('Some samples had no sampling date in the file – the "Date Received" was used. Please check the dates.');
  if (samples.some((s) => !s.date)) warnings.push('Some samples have no sampling date – enter them before importing.');
  return { kind: 'lab', labName, labJob, samples, warnings };
}

/** How strongly a sheet looks like a certificate-style lab report (0 = not at all). */
export function labScore(g: SheetGrid): number {
  const blocks = findLabBlocks(g);
  if (!blocks.length) return 0;
  return 50 + blocks.reduce((s, b) => s + b.sampleCols.length, 0) + (blocks.some((b) => b.labRow !== null) ? 20 : 0) + (detectLabName(g) ? 20 : 0);
}
