import type { SheetGrid } from './workbook';
import { labScore, parseLabSheet } from './lab';
import { detectWide, parseWide, type WideConfig } from './wide';
import { detectLong, parseLong, type LongConfig } from './long';
import type { ParsedImport } from './model';
import type { ParamIndex } from '../lib/matching';
import { detectExport, EMPTY_CONTEXT, parseExport, type ExportFormat, type ImportContext } from './labExports';

export type SheetPlan =
  | { mode: 'lab'; sheet: string; score: number }
  | { mode: 'wide'; sheet: string; score: number; config: WideConfig }
  | { mode: 'long'; sheet: string; score: number; config: LongConfig }
  | { mode: 'export'; sheet: string; score: number; format: ExportFormat }
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

export function parseWithPlan(grids: SheetGrid[], plans: SheetPlan[], ctx: ImportContext = EMPTY_CONTEXT): ParsedImport {
  const out: ParsedImport = { kind: 'wide', samples: [], warnings: [] };
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
    kinds.add(p.kind);
    out.samples.push(...p.samples);
    out.warnings.push(...p.warnings.map((w) => (plans.filter((x) => x.mode !== 'skip').length > 1 ? `${plan.sheet}: ${w}` : w)));
    out.labName ??= p.labName;
    out.labJob ??= p.labJob;
  }
  out.kind = kinds.has('lab') ? 'lab' : kinds.has('long') ? 'long' : 'wide';
  return out;
}
