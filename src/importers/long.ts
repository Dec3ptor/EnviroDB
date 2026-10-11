// Parser for "long" (tidy) tables: one row per result with columns such as
// Site | Date | Analyte | Result | Units | Detection limit.

import { cellAt, cellText, cellValue, isEmpty, type SheetGrid } from './workbook';
import type { ParsedImport, RawSample } from './model';
import { parseDateAny } from '../lib/dates';
import { parseValue } from '../lib/values';

export interface LongConfig {
  sheet: string;
  headerRow: number;
  site: number | null;
  sample: number | null;
  date: number | null;
  analyte: number | null;
  value: number | null;
  unit: number | null;
  qualifier: number | null;
  dl: number | null;
  labNo: number | null;
}

const PATTERNS: Array<[keyof Omit<LongConfig, 'sheet' | 'headerRow'>, RegExp]> = [
  ['site', /^(site(\s*(name|code|id))?|location(\s*code)?|station|monitoring\s*point|sampling\s*point|bore|well|field\s*id)$/i],
  ['sample', /^(sample(\s*(name|id|no\.?|number|ref))?|client\s*sample\s*id|sample\s*description)$/i],
  ['date', /^(date(\s*sampled)?|sampl(e|ing)\s*date|date\s*\/?\s*time|collection\s*date|sampled\s*date|datetime|date_sampled)$/i],
  ['analyte', /^(analyte|parameter|determinand|test(\s*name)?|chem(ical)?\s*name|chemname|compound|variable|component|characteristic)$/i],
  ['value', /^(result|value|reading|concentration|result\s*value|reported\s*result|final\s*result|measurement)$/i],
  ['unit', /^(units?|uom|result\s*units?|output\s*unit)$/i],
  ['qualifier', /^(qualifier|prefix|operator|sign|<|result\s*qualifier)$/i],
  ['dl', /^(detection\s*limit|dl|mdl|lor|eql|pql|rl|limit\s*of\s*reporting|reporting\s*limit|lod)$/i],
  ['labNo', /^(lab(oratory)?\s*(no\.?|number|id|sample\s*(no|id))|lab\s*ref)$/i],
];

export function detectLong(g: SheetGrid): { config: LongConfig; score: number } {
  let best: { config: LongConfig; score: number } | null = null;
  for (let r = 0; r < Math.min(g.nRows, 30); r++) {
    const cfg: LongConfig = { sheet: g.name, headerRow: r, site: null, sample: null, date: null, analyte: null, value: null, unit: null, qualifier: null, dl: null, labNo: null };
    let score = 0;
    (g.rows[r] ?? []).forEach((cell, c) => {
      const t = cellText(cell);
      for (const [key, re] of PATTERNS) {
        if (cfg[key] === null && re.test(t)) {
          cfg[key] = c;
          score += key === 'analyte' || key === 'value' ? 10 : 3;
          break;
        }
      }
    });
    if (cfg.analyte === null || cfg.value === null) score = 0;
    if (!best || score > best.score) best = { config: cfg, score };
  }
  return best!;
}

export function parseLong(g: SheetGrid, cfg: LongConfig): ParsedImport {
  const map = new Map<string, RawSample>();
  const warnings: string[] = [];
  let skipped = 0;
  if (cfg.analyte === null || cfg.value === null) return { kind: 'long', samples: [], warnings: ['Choose the analyte and result columns.'] };
  for (let r = cfg.headerRow + 1; r < g.nRows; r++) {
    const row = g.rows[r] ?? [];
    if (row.every(isEmpty)) continue;
    const analyte = cellText(cellAt(g, r, cfg.analyte));
    if (!analyte) continue;
    const siteText = cfg.site !== null ? cellText(cellAt(g, r, cfg.site)) : cfg.sample !== null ? cellText(cellAt(g, r, cfg.sample)) : '';
    const sampleName = cfg.sample !== null ? cellText(cellAt(g, r, cfg.sample)) : siteText;
    const date = cfg.date !== null ? parseDateAny(cellValue(cellAt(g, r, cfg.date))) : null;
    if (!date || !siteText) {
      skipped++;
      continue;
    }
    const labNumber = cfg.labNo !== null ? cellText(cellAt(g, r, cfg.labNo)) : undefined;
    const key = `${siteText}|${date}|${sampleName}|${labNumber ?? ''}`;
    let s = map.get(key);
    if (!s) {
      s = { key: `${g.name}#${key}`, sampleName: sampleName || siteText, labNumber, siteText, date, dateSource: 'cell', sheet: g.name, results: [] };
      map.set(key, s);
    }
    let raw = cellValue(cellAt(g, r, cfg.value));
    const q = cfg.qualifier !== null ? cellText(cellAt(g, r, cfg.qualifier)) : '';
    if (q && /[<>]/.test(q) && raw !== null && raw !== undefined) raw = `${q.includes('<') ? '<' : '>'}${raw}`;
    const parsed = parseValue(raw);
    if (cfg.dl !== null && parsed.qualifier === '<' && parsed.value === null) {
      const dl = parseValue(cellValue(cellAt(g, r, cfg.dl)));
      if (dl.value !== null) {
        parsed.value = dl.value;
        parsed.dl = dl.value;
      }
    }
    if (parsed.missing) continue;
    const unit = cfg.unit !== null ? cellText(cellAt(g, r, cfg.unit)) || undefined : undefined;
    s.results.push({ analyte, unit, raw, parsed });
  }
  if (skipped) warnings.push(`${skipped} rows without a site or valid date were skipped.`);
  return { kind: 'long', samples: Array.from(map.values()), warnings };
}
