// Files dropped on the import page: spreadsheets, lab PDF reports and zips of them – a lab's emailed results as they
// come. Results that are in both a lab's PDF and its spreadsheet are taken from the spreadsheet; the PDF still names
// the samples of a spreadsheet that only numbers them (ALS ESdat files).

import { readWorkbook, type SheetGrid } from './workbook';
import { importContext, labKey, parseExport, type ImportContext, type SampleInfo } from './labExports';
import { pdfReportGrid, pdfSampleInfo, readLabPdf, readPdfWords } from './pdfTables';
import { planSheets, resultKeys, type SheetPlan } from './detect';
import type { ParamIndex } from '../lib/matching';

export interface InputFile {
  name: string;
  data: ArrayBuffer;
}

export interface ReadFiles {
  grids: SheetGrid[];
  context: ImportContext;
  /** What happened to files that couldn't be used. */
  notes: string[];
  /** The files read (those in zips included). */
  names: string[];
}

const SHEET = /\.(xlsx|xlsm|xls|xlsb|ods|csv|txt|tsv)$/i;
const PDF = /\.pdf$/i;
const ZIP = /\.zip$/i;

async function unzip(file: InputFile): Promise<InputFile[]> {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(file.data);
  const out: InputFile[] = [];
  for (const entry of Object.values(zip.files)) {
    const base = entry.name.split('/').pop() ?? '';
    if (entry.dir || entry.name.startsWith('__MACOSX/') || base.startsWith('.') || !(SHEET.test(base) || PDF.test(base))) continue;
    out.push({ name: base, data: await entry.async('arraybuffer') });
  }
  return out;
}

/** Reads the files (and the files in zips) into sheets, PDF reports into sheets of their results. */
export async function readImportFiles(files: InputFile[]): Promise<ReadFiles> {
  const flat: InputFile[] = [];
  const notes: string[] = [];
  for (const f of files) {
    if (!ZIP.test(f.name)) flat.push(f);
    else {
      const inner = await unzip(f);
      if (!inner.length) notes.push(`${f.name}: no spreadsheets or PDF reports in it.`);
      flat.push(...inner);
    }
  }
  const several = flat.length > 1;
  const grids: SheetGrid[] = [];
  const infos: Array<[string, SampleInfo]> = [];
  const taken = new Set<string>();
  const unique = (name: string) => {
    let n = name;
    for (let i = 2; taken.has(n); i++) n = `${name} (${i})`;
    taken.add(n);
    return n;
  };
  for (const f of flat) {
    try {
      if (PDF.test(f.name)) {
        const rep = readLabPdf(await readPdfWords(f.data));
        if (!rep) {
          notes.push(`${f.name}: no lab results table found – left out.`);
          continue;
        }
        grids.push({ ...pdfReportGrid(rep, unique(f.name)), file: f.name });
        infos.push(...pdfSampleInfo(rep));
      } else if (SHEET.test(f.name)) {
        const gs = await readWorkbook(f.data, f.name);
        for (const g of gs) grids.push({ ...g, name: unique(several ? (gs.length > 1 ? `${f.name} › ${g.name}` : f.name) : g.name), file: f.name });
      } else notes.push(`${f.name}: not a spreadsheet, PDF or zip – left out.`);
    } catch (e) {
      notes.push(`${f.name}: couldn't be read (${(e as Error).message}).`);
    }
  }
  return { grids, context: importContext(grids, infos), notes, names: flat.map((f) => f.name) };
}

/**
 * How each sheet is read to start with. A PDF report whose results are all in a spreadsheet from the lab is left out
 * (the spreadsheet has the same results, exactly) – and where the spreadsheet has its samples but not every result of
 * theirs, the PDF is read for those; so are a workbook's other sheets beside a lab export.
 */
export function defaultPlans(grids: SheetGrid[], ctx: ImportContext, index: ParamIndex): { plans: SheetPlan[]; notes: string[] } {
  const plans = planSheets(grids, index);
  const notes: string[] = [];
  const inSheets = new Map<string, string>();
  // each result the lab's spreadsheets have: by sample and test, with the fractions it's given in
  const have = new Map<string, Set<string>>();
  // the same lab file twice (ALS send ESdat files as CSV and as Excel): the results once
  const seen = new Map<string, string>();
  const twice = new Set<number>();
  grids.forEach((g, i) => {
    if (g.pdf || plans[i].mode !== 'export') return;
    const samples = parseExport(g, ctx)?.samples ?? [];
    const sig = samples.map((s) => `${labKey(s.labNumber ?? s.sampleName)}:${s.results.map((r) => `${r.analyte}=${r.parsed.text}`).join(',')}`).join(';');
    if (sig && seen.has(sig)) {
      twice.add(i);
      notes.push(`${g.name}: the same results as ${seen.get(sig)}, so they're read once.`);
      return;
    }
    if (sig) seen.set(sig, g.name);
    for (const s of samples) {
      if (!s.labNumber) continue;
      inSheets.set(labKey(s.labNumber), g.file ?? g.name);
      for (const r of s.results) {
        const k = resultKeys(s, r);
        have.set(k.name, (have.get(k.name) ?? new Set()).add(k.fraction));
      }
    }
  });
  const exportFiles = new Set(grids.filter((g, i) => !g.pdf && plans[i].mode === 'export').map((g) => g.file));
  return {
    plans: plans.map((p, i) => {
      const g = grids[i];
      if (twice.has(i)) return { mode: 'skip', sheet: p.sheet, score: 0 };
      if (g.pdf && p.mode === 'export') {
        const samples = parseExport(g, ctx)?.samples ?? [];
        const nums = samples.map((s) => labKey(s.labNumber ?? ''));
        const from = nums.length && nums.every((n) => inSheets.has(n)) ? inSheets.get(nums[0]) : undefined;
        if (from) {
          // what the PDF has for those samples that the spreadsheet hasn't: a test it doesn't list, or a fraction of one
          const extra = samples.flatMap((s) =>
            s.results.flatMap((r) => {
              const k = resultKeys(s, r);
              const fractions = have.get(k.name);
              const there = !!fractions && (!k.fraction || fractions.has(k.fraction) || fractions.has(''));
              return there ? [] : [{ key: `${k.name}|${k.fraction}`, analyte: r.analyte }];
            }),
          );
          if (!extra.length) {
            notes.push(`${g.name}: the same results are in ${from}, so they're taken from there (the PDF still gives the site names and dates).`);
            return { mode: 'skip', sheet: p.sheet, score: 0 };
          }
          const names = [...new Set(extra.map((x) => x.analyte))];
          notes.push(`${g.name}: ${extra.length === 1 ? '1 result isn’t' : `${extra.length} results aren’t`} in ${from} – ${names.slice(0, 6).join(', ')}${names.length > 6 ? ` and ${names.length - 6} more` : ''} – so ${extra.length === 1 ? 'it’s' : 'they’re'} read from the PDF; the rest are taken from ${from}.`);
          return { ...p, only: extra.map((x) => x.key) };
        }
      }
      if (!g.pdf && p.mode !== 'export' && p.mode !== 'skip' && g.file && exportFiles.has(g.file)) {
        notes.push(`${g.name}: this sheet isn’t read – the file’s results are taken from its lab export sheet. If it has other results, choose how it’s laid out below.`);
        return { mode: 'skip', sheet: p.sheet, score: 0 };
      }
      return p;
    }),
    notes,
  };
}
