// Lab reports as PDF – Linnaeus analysis reports, ALS certificates of analysis and Hill Laboratories certificates –
// read from where the words sit on each page: a column per sample, headed by its lab number, and a row per test.
// The results come out as rows laid out like ALS's CSV export, so they go through the same import steps as a
// spreadsheet; the sample names and dates also name the samples of an ALS ESdat file from the same job.

import type { Cell, SheetGrid } from './workbook';
import { extractDate } from '../lib/dates';
import { labKey, type SampleInfo } from './labExports';

/** A word on a page: its bottom-left corner (y grows up the page), width and height, in points. */
export interface PdfWord {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
export type PdfPage = PdfWord[];

export interface PdfSample {
  labNumber: string;
  /** The name the sample was sent in under, e.g. "2026000101 - Upstream". */
  clientRef: string;
  date?: string;
}
export interface PdfResult {
  labNumber: string;
  analyte: string;
  /** The report's section, e.g. "Elements in Water (Soluble)". */
  group?: string;
  unit?: string;
  value: string;
}
export interface PdfReport {
  lab: string;
  samples: PdfSample[];
  results: PdfResult[];
}

interface Phrase {
  text: string;
  x0: number;
  x1: number;
  y: number;
}
interface Line {
  y: number;
  phrases: Phrase[];
}

const mid = (p: { x0: number; x1: number }) => (p.x0 + p.x1) / 2;
const lineText = (l: Line) => l.phrases.map((p) => p.text).join(' ');

/** The page's words in lines, top to bottom, and each line's words in phrases: words close together read as one. */
export function pageLines(words: PdfPage): Line[] {
  const sorted = words.filter((w) => w.str.trim()).sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: Array<{ y: number; words: PdfWord[] }> = [];
  for (const w of sorted) {
    const last = rows[rows.length - 1];
    // superscripts ("g/m" "3") sit a little higher on the same line
    if (last && last.y - w.y <= 2.5) last.words.push(w);
    else rows.push({ y: w.y, words: [w] });
  }
  return rows.map(({ y, words: ws }) => {
    const phrases: Phrase[] = [];
    for (const w of ws.sort((a, b) => a.x - b.x)) {
      const cur = phrases[phrases.length - 1];
      const gap = cur ? w.x - cur.x1 : Infinity;
      const s = w.str.trim();
      if (cur && gap < 0.8) cur.text += s;
      else if (cur && gap < 4.5) cur.text += ` ${s}`;
      else phrases.push({ text: s, x0: w.x, x1: w.x + w.w, y: w.y });
      phrases[phrases.length - 1].x1 = Math.max(phrases[phrases.length - 1].x1, w.x + w.w);
    }
    return { y, phrases };
  });
}

interface Layout {
  lab: string;
  /** The lab number heading each sample's column. */
  anchor: RegExp;
  /** Whether the page is one of this lab's results pages. */
  is: (text: string) => boolean;
  /** Sample names and dates: above the lab numbers, from the line matching `edge`, or below them, down to it. */
  details: 'above' | 'below';
  edge: RegExp;
  /** Section headings among the tests (lines with no results), and the method code before their name. */
  section?: RegExp;
  sectionCode?: RegExp;
  /** Lines that end a table. */
  stop: RegExp;
}

const LAYOUTS: Layout[] = [
  {
    lab: 'ALS',
    anchor: /^[A-Z]{2}\d{7}-\d{3}$/,
    is: (t) => /Client Sample ID/.test(t),
    details: 'above',
    edge: /^(Sub-Matrix|Analytical Results)/i,
    section: /^[A-Za-z0-9]+_[A-Za-z0-9]+:/,
    sectionCode: /^[A-Za-z0-9]+_[A-Za-z0-9]+:\s*/,
    stop: /^(Page\b|Work Order|Analytical Results|Sub-Matrix)/i,
  },
  {
    lab: 'Linnaeus',
    anchor: /^\d{10}$/,
    is: (t) => /\bTest\b/.test(t) && /\bUnits\b/.test(t) && /linnaeus/i.test(t),
    details: 'below',
    edge: /^Test$/,
    stop: /^(Report ID|Comments:|Test Standards)/i,
  },
  {
    lab: 'Hill Laboratories',
    anchor: /^\d{5,8}\.\d{1,3}$/,
    is: (t) => /Lab Number:/.test(t) && /Sample Name:/.test(t),
    details: 'above',
    edge: /^Sample Name:?/i,
    section: /./,
    stop: /^(Analyst'?s Comments|Summary of Methods|Sample Type|Sample Name)/i,
  },
];

interface Columns {
  labels: string[];
  centres: number[];
  bounds: number[];
}

function columnsOf(anchors: Phrase[]): Columns {
  const sorted = [...anchors].sort((a, b) => mid(a) - mid(b));
  const centres = sorted.map(mid);
  const gaps = centres.slice(1).map((c, i) => c - centres[i]);
  const half = gaps.length ? Math.min(...gaps) / 2 : 45;
  const bounds = [centres[0] - half, ...centres.slice(1).map((c, i) => (c + centres[i]) / 2), centres[centres.length - 1] + half];
  return { labels: sorted.map((a) => a.text), centres, bounds };
}

/** The column a phrase is in: -1 left of the samples (test names, units …), -2 right of them. */
function columnAt(cols: Columns, p: Phrase): number {
  const c = mid(p);
  if (c < cols.bounds[0]) return -1;
  for (let i = 0; i < cols.centres.length; i++) if (c < cols.bounds[i + 1]) return i;
  return -2;
}

const FOOTNOTE = /^[øØ*#†‡^~¤§]+$/;
const FOOTNOTE_START = /^[øØ*#†‡^~¤§]+\s*/;
const FOOTNOTE_END = /\s*[*#†‡^]+$/;
const UNIT_LIKE = /[/%³]|^(pH|NTU|FNU|FAU|NTRU|PCU|CFU|MPN|ppm|ppb|mS|µS|μS|uS|°C|mV|g\/m|units?)\b/i;
const NOT_DONE = /^-{2,}$|^n\/?a$/i;

function readTable(lines: Line[], at: number, anchors: Phrase[], layout: Layout, next: number): { samples: PdfSample[]; results: PdfResult[] } {
  const cols = columnsOf(anchors);
  const anchorLine = lines[at];
  const top = Math.max(...anchors.map((a) => a.y));
  const bottom = Math.min(...anchors.map((a) => a.y));
  // the sample details
  let band: Line[];
  let resultsFrom: number;
  if (layout.details === 'above') {
    let edge = at;
    for (let i = at - 1; i >= 0 && lines[i].y - top < 140; i--) {
      if (layout.edge.test(lineText(lines[i]))) {
        edge = i;
        break;
      }
    }
    band = lines.slice(edge, at).filter((l) => l.y > top + 0.5);
    resultsFrom = lines.findIndex((l) => l.y < bottom - 0.5);
  } else {
    let edge = lines.findIndex((l, i) => i > at && layout.edge.test(lineText(l)));
    if (edge < 0) edge = at + 1;
    band = lines.slice(at, edge);
    resultsFrom = edge + 1;
  }
  const details = cols.labels.map(() => [] as Phrase[]);
  for (const l of band) for (const p of l.phrases) {
    const c = columnAt(cols, p);
    if (c >= 0 && !NOT_DONE.test(p.text)) details[c].push(p);
  }
  const samples: PdfSample[] = cols.labels.map((labNumber, c) => {
    const words = details[c].sort((a, b) => b.y - a.y || a.x0 - b.x0).map((p) => p.text).filter((t) => t !== labNumber);
    const all = words.join(' ').replace(/\s+/g, ' ').trim();
    const found = extractDate(all);
    return { labNumber, clientRef: (found ? found.rest : all).trim(), date: found?.date };
  });
  // the units column, where the report has one
  // the column headings left of the samples: units, and where the test names end (CAS number, LOR, units)
  const heads = [anchorLine, ...band].flatMap((l) => l.phrases).filter((p) => columnAt(cols, p) === -1);
  const unitHead = heads.find((p) => /^Units?$/.test(p.text));
  const others = heads.filter((p) => /^(CAS( Number)?|Units?|LOR|Method)$/i.test(p.text));
  const nameEdge = others.length ? Math.min(...others.map((p) => p.x0)) - 2 : cols.bounds[0];
  const rows = lines.slice(Math.max(resultsFrom, 0), Math.min(next, lines.length)).map((l) => {
    const labels = l.phrases.filter((p) => columnAt(cols, p) === -1 && !FOOTNOTE.test(p.text));
    const values = cols.labels.map(() => [] as string[]);
    for (const p of l.phrases) {
      const c = columnAt(cols, p);
      if (c >= 0) values[c].push(p.text);
    }
    const filled = values.map((v) => v.join(' ').trim());
    return { l, labels, names: labels.filter((p) => mid(p) < nameEdge), filled, hasValues: filled.some((v) => v && !/^Results?$/i.test(v)) };
  });
  const used = new Set<number>();
  const results: PdfResult[] = [];
  let group: string | undefined;
  let skip = false;
  for (let i = 0; i < rows.length; i++) {
    const { l, labels, names, filled, hasValues } = rows[i];
    if (layout.stop.test(lineText(l))) break;
    if (!labels.length || used.has(i)) continue;
    if (!hasValues) {
      // a section heading (method, or lab section)
      if (layout.section?.test(labels[0].text)) {
        const heading = labels.map((p) => p.text).join(' ');
        group = (layout.sectionCode ? heading.replace(layout.sectionCode, '') : heading).trim();
        skip = /surrogate/i.test(group);
      }
      continue;
    }
    if (skip) continue;
    // a row made taller by wrapped text has its name a line above or below its results
    let nameP = names[0];
    if (!nameP) {
      const j = [i - 1, i + 1, i - 2, i + 2].find((k) => rows[k] && !rows[k].hasValues && !used.has(k) && rows[k].names.length && Math.abs(rows[k].l.y - l.y) <= 10);
      if (j === undefined) continue;
      used.add(j);
      nameP = rows[j].names[0];
    }
    // footnote marks before a name ("ø" not accredited, "*"), and a long name running into the CAS number beside it
    const name = nameP.text.replace(FOOTNOTE_START, '').replace(/\s+(\d{2,7}-\d{2}-\d|-{2,})$/, '').replace(FOOTNOTE_END, '');
    const near = [l, ...[i - 1, i + 1].filter((k) => rows[k] && !rows[k].hasValues && Math.abs(rows[k].l.y - l.y) <= 10).map((k) => rows[k].l)];
    const pool = near.flatMap((x) => x.phrases.filter((p) => columnAt(cols, p) === -1 && p !== nameP));
    const unitPhrase = unitHead ? pool.find((p) => Math.abs(mid(p) - mid(unitHead)) < 25) : labels.filter((p) => p !== nameP).reverse().find((p) => UNIT_LIKE.test(p.text));
    filled.forEach((value, c) => {
      if (!value || NOT_DONE.test(value) || /^[A-Z]{2}\d{7}_/.test(value)) return;
      results.push({ labNumber: cols.labels[c], analyte: name, group, unit: unitPhrase?.text.replace(/\u03bc/g, '\u00b5'), value });
    });
  }
  return { samples, results };
}

/** The results tables of a lab's PDF report; null when it isn't one this can read. */
export function readLabPdf(pages: PdfPage[]): PdfReport | null {
  const samples = new Map<string, PdfSample>();
  const results: PdfResult[] = [];
  let lab = '';
  for (const words of pages) {
    const lines = pageLines(words);
    const all = lines.map(lineText).join('\n');
    const layout = LAYOUTS.find((l) => l.is(all) && lines.some((ln) => ln.phrases.some((p) => l.anchor.test(p.text))));
    if (!layout) continue;
    lab ||= layout.lab;
    // the tables on the page: lab numbers within a few lines of each other head one table
    const heads: Array<{ at: number; anchors: Phrase[] }> = [];
    lines.forEach((l, i) => {
      const found = l.phrases.filter((p) => layout.anchor.test(p.text));
      if (!found.length) return;
      const prev = heads[heads.length - 1];
      if (prev && lines[prev.at].y - l.y < 25) prev.anchors.push(...found);
      else heads.push({ at: i, anchors: found });
    });
    heads.forEach((h, k) => {
      // the next table's details start above its lab numbers (or at them, for details below)
      let next = k + 1 < heads.length ? heads[k + 1].at : lines.length;
      if (k + 1 < heads.length && layout.details === 'above') {
        const nextTop = lines[heads[k + 1].at].y;
        while (next > h.at + 1 && lines[next - 1].y - nextTop < 140 && !layout.edge.test(lineText(lines[next - 1]))) next--;
        if (next > h.at + 1 && layout.edge.test(lineText(lines[next - 1]))) next--;
      }
      const t = readTable(lines, h.at, h.anchors, layout, next);
      for (const s of t.samples) {
        const cur = samples.get(s.labNumber);
        if (!cur || (!cur.clientRef && s.clientRef) || (!cur.date && s.date)) samples.set(s.labNumber, { ...cur, ...s, clientRef: s.clientRef || cur?.clientRef || '', date: s.date ?? cur?.date });
      }
      results.push(...t.results);
    });
  }
  return samples.size ? { lab, samples: [...samples.values()], results } : null;
}

/** The report's results as rows laid out like ALS's CSV export (with the report's sections and lab added). */
export function pdfReportGrid(rep: PdfReport, name: string): SheetGrid {
  const header = ['LabSampleReference', 'ClientSampleReference', 'SampleDate', 'AnalyteReference', 'AnalyteDescription', 'TextResult', 'Unit', 'Group', 'Laboratory'];
  const byNumber = new Map(rep.samples.map((s) => [s.labNumber, s]));
  const rows = rep.results.map((r) => {
    const s = byNumber.get(r.labNumber);
    return [r.labNumber, s?.clientRef ?? '', s?.date ?? '', '', r.analyte, r.value, r.unit ?? '', r.group ?? '', rep.lab];
  });
  const cells = [header, ...rows].map((row) => row.map((v): Cell => ({ v: v || null })));
  return { name, rows: cells, nRows: cells.length, nCols: header.length, pdf: true };
}

/** Site names and dates of the report's samples, by lab number. */
export function pdfSampleInfo(rep: PdfReport): Array<[string, SampleInfo]> {
  return rep.samples.filter((s) => s.clientRef).map((s) => [labKey(s.labNumber), { clientRef: s.clientRef, date: s.date }]);
}

/** The words of each page of a PDF file. */
export async function readPdfWords(data: ArrayBuffer): Promise<PdfPage[]> {
  const { loadPdfJs } = await import('../lib/pdfjs');
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({ data: new Uint8Array(data) });
  const doc = await task.promise;
  try {
    const pages: PdfPage[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const tc = await page.getTextContent();
      pages.push(
        tc.items.flatMap((it) => ('str' in it && it.str.trim() ? [{ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, h: it.height }] : [])),
      );
    }
    return pages;
  } finally {
    await task.destroy();
  }
}
