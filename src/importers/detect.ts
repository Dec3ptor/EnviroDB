import type { SheetGrid } from './workbook';
import { labScore, parseLabSheet } from './lab';
import { detectWide, parseWide, type WideConfig } from './wide';
import { detectLong, parseLong, type LongConfig } from './long';
import type { ParsedImport, RawResult, RawSample } from './model';
import { analyteKey, fractionOf, type ParamIndex } from '../lib/matching';
import { detectExport, EMPTY_CONTEXT, labKey, parseExport, type ExportFormat, type ImportContext } from './labExports';

export type SheetPlan =
  | { mode: 'lab'; sheet: string; score: number }
  | { mode: 'wide'; sheet: string; score: number; config: WideConfig }
  | { mode: 'long'; sheet: string; score: number; config: LongConfig }
  /** `only`: a PDF report beside the lab's spreadsheet – just these of its results are read (those the spreadsheet hasn't). */
  | { mode: 'export'; sheet: string; score: number; format: ExportFormat; only?: string[] }
  | { mode: 'skip'; sheet: string; score: number };

/** Work out the most likely layout of each sheet. */
export function planSheets(grids: SheetGrid[], index: ParamIndex): SheetPlan[] {
  return grids.map((g) => {
    const ex = detectExport(g);
    if (ex) return { mode: 'export', sheet: g.name, score: 100, format: ex.format };
    const lab = labScore(g);
    const long = detectLong(g);
    const wide = detectWide(g, index);
    if (lab >= 60 && lab >= long.score) return { mode: 'lab', sheet: g.name, score: lab };
    if (long.score >= 26 && long.score > wide.score / 3) return { mode: 'long', sheet: g.name, score: long.score, config: long.config };
    if (wide.score >= 12) return { mode: 'wide', sheet: g.name, score: wide.score, config: wide.config };
    if (lab > 0) return { mode: 'lab', sheet: g.name, score: lab };
    return { mode: 'skip', sheet: g.name, score: 0 };
  });
}

/**
 * A result as two files of one lab name it: the sample's lab number and the test. The test's name alone, and with its
 * fraction where the file gives one ("Zinc" dissolved and total are two results).
 */
export function resultKeys(s: Pick<RawSample, 'labNumber' | 'sampleName'>, r: Pick<RawResult, 'analyte' | 'group'>): { name: string; fraction: string } {
  const sample = labKey(s.labNumber ?? s.sampleName);
  return { name: `${sample}|${analyteKey(r.analyte)}`, fraction: fractionOf(r.group) };
}

export function parseWithPlan(grids: SheetGrid[], plans: SheetPlan[], ctx: ImportContext = EMPTY_CONTEXT): ParsedImport {
  const out: ParsedImport = { kind: 'wide', samples: [], warnings: [], left: [] };
  const kinds = new Set<string>();
  for (const plan of plans) {
    const g = grids.find((x) => x.name === plan.sheet);
    if (!g || plan.mode === 'skip') continue;
    let p: ParsedImport | null = null;
    if (plan.mode === 'lab') p = parseLabSheet(g);
    else if (plan.mode === 'wide') p = parseWide(g, plan.config);
    else if (plan.mode === 'long') p = parseLong(g, plan.config);
    else if (plan.mode === 'export') p = parseExport(g, ctx);
    if (!p) continue;
    if (plan.mode === 'export' && plan.only) {
      // a PDF beside the lab's spreadsheet: only what the spreadsheet hasn't
      const only = new Set(plan.only);
      const key = (s: RawSample, r: RawResult) => `${resultKeys(s, r).name}|${resultKeys(s, r).fraction}`;
      p = { ...p, samples: p.samples.map((s) => ({ ...s, results: s.results.filter((r) => only.has(key(s, r))) })).filter((s) => s.results.length), left: (p.left ?? []).filter((x) => x.why !== 'unreadable') };
    }
    kinds.add(p.kind);
    out.samples.push(...p.samples);
    out.left!.push(...(p.left ?? []));
    out.warnings.push(...p.warnings.map((w) => (plans.filter((x) => x.mode !== 'skip').length > 1 ? `${plan.sheet}: ${w}` : w)));
    out.labName ??= p.labName;
    out.labJob ??= p.labJob;
  }
  out.kind = kinds.has('lab') ? 'lab' : kinds.has('long') ? 'long' : 'wide';
  return out;
}
