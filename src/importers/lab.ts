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
//
// Hill's CSV export (SSFC) puts the analyte names one column to the left of the "Sample Name:" label, which
// sits above the units:
//
//   ,"Sample Name:","W1 28-Sept-2026 9:40 am", …
//   ,"Lab Number:","9100001.1", …
//   "Total Nitrogen","g/m3","6.5", …
//
// so the name and unit columns are found from the analyte rows themselves.

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

const looksLikeUnit = (u: string) => normUnit(u).known || /^(ph|ph units|ntu|°c|% ?sat|mpn|cfu|hazen)/i.test(u);

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
    // Analyte name and unit columns, from the rows that have results
    const first = sampleCols[0];
    const dataRows: number[] = [];
    for (let k = r + 1; k < Math.min(g.nRows, r + 120) && dataRows.length < 60; k++) {
      const l = labelOf(g, k);
      if (l && (SAMPLE_ROW.test(l.text) || STOP_ROW.test(l.text))) break;
      if (k !== labRow && sampleCols.some((c) => !isEmpty(cellAt(g, k, c)))) dataRows.push(k);
    }
    const columns = Array.from({ length: first }, (_, c) => {
      let filled = 0, units = 0, dates = 0;
      for (const k of dataRows) {
        const cell = cellAt(g, k, c);
        const t = cellText(cell);
        if (!t) continue;
        filled++;
        if (looksLikeUnit(t)) units++;
        if (cell.date || (typeof cell.v === 'string' && parseDateAny(cell.v))) dates++;
      }
      return { c, filled, units, dates };
    });
    // rows labelled with dates are sampling events, not analytes: a monitoring export with a "Sample:" row over its header
    if (columns.some((x) => x.filled >= 3 && x.dates / x.filled > 0.5)) continue;
    // units: the nearest column left of the samples that holds mostly units
    const unitCol = [...columns].reverse().find((x) => x.filled && x.units / x.filled > 0.3)?.c ?? null;
    // names: the column with the most text, other than the units (the leftmost on a tie)
    const names = columns.filter((x) => x.c !== unitCol && x.filled).sort((a, b) => b.filled - a.filled || a.c - b.c)[0];
    const nameCol = names?.c ?? labelCol;
    // block ends at the next sample row or a stop row
    let end = g.nRows - 1;
    for (let k = r + 1; k < g.nRows; k++) {
      const l = labelOf(g, k);
      if (l && (SAMPLE_ROW.test(l.text) || STOP_ROW.test(l.text))) {
        end = k - 1;
        break;
      }
    }
    blocks.push({ sampleRow: r, labRow, labelCol: nameCol, unitCol, sampleCols, endRow: end });
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
  const labJob = headerValue(g, /^(lab(oratory)?\s*(job\s*)?(no\.?|number)|job\s*(no|number)|report\s*(no|number))\s*:?/i);
  const received = headerValue(g, /^date\s*(received|registered)\s*:?/i);
  // the lab's numbered comments ("#1 Please interpret this result with caution …"), referred to from results ("< 2 #1")
  const comments = new Map<string, string>();
  for (const m of (headerValue(g, /^analyst'?s?\s+comments?\s*:?/i) ?? '').matchAll(/#(\d+)\s+([^#]+)/g)) comments.set(m[1], m[2].trim());
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
      const refs = new Map<string, string[]>();
      for (const r of s.results) {
        const n = String(r.raw ?? '').match(/#(\d+)\s*$/)?.[1];
        if (n && comments.has(n)) refs.set(n, [...(refs.get(n) ?? []), r.analyte]);
      }
      if (refs.size) s.notes = [...refs].map(([n, analytes]) => `Lab comment #${n} (${analytes.join(', ')}): ${comments.get(n)}`).join('\n');
      const got = received ? parseDateAny(received) : null;
      if (got) s.receivedOn = got;
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
