// Parser for "master sheet" style spreadsheets: one row per sampling event (dates down the rows),
// analytes across the columns, optionally a units row under the header and a site column
// (or one sheet per site). Transposed sheets (dates across the columns) are handled by transposing.

import { cellAt, cellText, cellValue, isEmpty, transpose, type SheetGrid } from './workbook';
import type { ParsedImport, RawSample } from './model';
import { extractDate, parseDateAny } from '../lib/dates';
import { normUnit, splitHeaderUnit } from '../lib/units';
import { parseValue } from '../lib/values';
import type { ParamIndex } from '../lib/matching';
import { matchParameter } from '../lib/matching';

export interface WideConfig {
  sheet: string;
  orientation: 'rows' | 'columns'; // rows = each row is a sample (dates per row)
  headerRow: number;
  unitRow: number | null;
  firstDataRow: number;
  dateCol: number;
  timeCol: number | null;
  siteMode: 'column' | 'sheet' | 'fixed';
  siteCol: number | null;
  fixedSite: string; // site text (code) when siteMode = fixed
  sampleCol: number | null;
  skipCols: number[];
}

const NON_ANALYTE = /^(comments?|notes?|remarks?|weather|sampler|sampled\s*by|collected\s*by|time|lab\s*(no|number|ref|id)|job\s*(no|number)|sample\s*(id|no\.?|number|name|ref|code|type)|field\s*notes|qa\/?qc|duplicate|easting|northing|latitude|longitude|lat|long|location|site(\s*(name|code|id))?|station|bore|well|date(\s*sampled)?|sampling\s*date|month|year|quarter|flow\s*conditions?|tide|observations?|photo|initials?|staff|by|event|round|matrix|depth\s*\(m\)|laboratory|lab)$/i;
const SITE_HEADER = /^(site(\s*(name|code|id|no))?|location|station|monitoring\s*(point|site|location)|sampling\s*(point|site|location)|bore(\s*id)?|well(\s*id)?|sample\s*point|point|sample\s*location)$/i;
const DATE_HEADER = /^(date(\s*sampled)?|sampl(e|ing)\s*date|date\s*\/\s*time|collection\s*date|date\s*collected|datetime|sample\s*date)$/i;
const TIME_HEADER = /^(time(\s*sampled)?|sampl(e|ing)\s*time)$/i;
const SAMPLE_HEADER = /^(sample\s*(id|no\.?|number|name|ref)|lab\s*(no|number|ref)|client\s*sample\s*id)$/i;

export function gridFor(g: SheetGrid, orientation: WideConfig['orientation']): SheetGrid {
  return orientation === 'columns' ? transpose(g) : g;
}

function dateLike(cell: ReturnType<typeof cellAt>): boolean {
  if (isEmpty(cell)) return false;
  if (cell.date) return true;
  if (typeof cell.v === 'number') return false;
  return !!parseDateAny(cell.v);
}

/** Best-guess configuration for a sheet. */
export function detectWide(g0: SheetGrid, index: ParamIndex, orientation?: WideConfig['orientation']): { config: WideConfig; score: number } {
  const tryOrient = (o: WideConfig['orientation']) => {
    const g = gridFor(g0, o);
    // header row: the row (in the first 40) with the most analyte-name matches
    let headerRow = 0, best = -1;
    for (let r = 0; r < Math.min(g.nRows, 40); r++) {
      let score = 0;
      for (const cell of g.rows[r] ?? []) {
        const t = cellText(cell);
        if (!t || typeof cell.v === 'number') continue;
        const m = matchParameter(t, index);
        if (m.confidence === 'exact' || m.confidence === 'high') score += 2;
        else if (m.confidence === 'low') score += 0.5;
      }
      if (score > best) {
        best = score;
        headerRow = r;
      }
    }
    // date column: most date-like cells below the header
    let dateCol = 0, dateBest = -1;
    for (let c = 0; c < g.nCols; c++) {
      let n = 0;
      for (let r = headerRow + 1; r < Math.min(g.nRows, headerRow + 200); r++) if (dateLike(cellAt(g, r, c))) n++;
      const hdr = cellText(cellAt(g, headerRow, c));
      if (DATE_HEADER.test(hdr)) n += 5;
      if (n > dateBest) {
        dateBest = n;
        dateCol = c;
      }
    }
    // units row directly below the header
    let unitRow: number | null = null;
    for (const r of [headerRow + 1, headerRow + 2]) {
      if (r >= g.nRows) break;
      const cells = (g.rows[r] ?? []).filter((x) => !isEmpty(x));
      if (!cells.length) continue;
      const known = cells.filter((x) => typeof x.v === 'string' && (normUnit(x.v).known || /^(ph( units)?|ntu|°c|% ?sat)$/i.test(String(x.v).trim()))).length;
      if (known / cells.length >= 0.4) {
        unitRow = r;
        break;
      }
    }
    let firstDataRow = (unitRow ?? headerRow) + 1;
    while (firstDataRow < g.nRows && !dateLike(cellAt(g, firstDataRow, dateCol))) firstDataRow++;
    if (firstDataRow >= g.nRows) firstDataRow = (unitRow ?? headerRow) + 1;

    let siteCol: number | null = null, timeCol: number | null = null, sampleCol: number | null = null;
    const skipCols: number[] = [];
    for (let c = 0; c < g.nCols; c++) {
      if (c === dateCol) continue;
      const hdr = cellText(cellAt(g, headerRow, c));
      if (siteCol === null && SITE_HEADER.test(hdr)) siteCol = c;
      else if (timeCol === null && TIME_HEADER.test(hdr)) timeCol = c;
      else if (sampleCol === null && SAMPLE_HEADER.test(hdr)) sampleCol = c;
      else if (!hdr || NON_ANALYTE.test(hdr)) skipCols.push(c);
    }
    const config: WideConfig = {
      sheet: g0.name,
      orientation: o,
      headerRow,
      unitRow,
      firstDataRow,
      dateCol,
      timeCol,
      siteMode: siteCol !== null ? 'column' : 'sheet',
      siteCol,
      fixedSite: '',
      sampleCol,
      skipCols,
    };
    return { config, score: Math.max(0, best) * 2 + Math.max(0, dateBest) };
  };
  if (orientation) return tryOrient(orientation);
  const a = tryOrient('rows');
  const b = g0.nCols > 2 ? tryOrient('columns') : { config: a.config, score: -1 };
  return b.score > a.score * 1.2 ? b : a;
}

export interface WideColumn {
  col: number;
  header: string;
  analyte: string;
  unit?: string;
  skip: boolean;
}

export function wideColumns(g0: SheetGrid, cfg: WideConfig): WideColumn[] {
  const g = gridFor(g0, cfg.orientation);
  const special = new Set([cfg.dateCol, cfg.timeCol, cfg.siteMode === 'column' ? cfg.siteCol : null, cfg.sampleCol].filter((x): x is number => x !== null));
  const cols: WideColumn[] = [];
  for (let c = 0; c < g.nCols; c++) {
    if (special.has(c)) continue;
    const header = cellText(cellAt(g, cfg.headerRow, c));
    if (!header) continue;
    const split = splitHeaderUnit(header);
    const unitCell = cfg.unitRow !== null ? cellText(cellAt(g, cfg.unitRow, c)) : '';
    cols.push({ col: c, header, analyte: split.name, unit: unitCell || split.unit, skip: cfg.skipCols.includes(c) });
  }
  return cols;
}

export function parseWide(g0: SheetGrid, cfg: WideConfig): ParsedImport {
  const g = gridFor(g0, cfg.orientation);
  const cols = wideColumns(g0, cfg).filter((c) => !c.skip);
  const samples: RawSample[] = [];
  const warnings: string[] = [];
  let noDate = 0;
  for (let r = cfg.firstDataRow; r < g.nRows; r++) {
    const row = g.rows[r] ?? [];
    if (row.every(isEmpty)) continue;
    const dateCell = cellAt(g, r, cfg.dateCol);
    let date = parseDateAny(dateCell.date ? dateCell.v : cellValue(dateCell));
    if (!date && typeof dateCell.v === 'string') date = extractDate(dateCell.v)?.date ?? null;
    if (!date) {
      noDate++;
      continue; // guideline / statistics / blank rows
    }
    if (cfg.timeCol !== null && date.length === 10) {
      const t = cellAt(g, r, cfg.timeCol);
      if (typeof t.v === 'number' && t.v > 0 && t.v < 1) {
        const mins = Math.round(t.v * 1440);
        date = `${date}T${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
      } else {
        const m = cellText(t).match(/(\d{1,2})[:.](\d{2})\s*(am|pm)?/i);
        if (m) {
          let hh = +m[1];
          if (m[3]?.toLowerCase() === 'pm' && hh < 12) hh += 12;
          if (m[3]?.toLowerCase() === 'am' && hh === 12) hh = 0;
          if (hh < 24) date = `${date}T${String(hh).padStart(2, '0')}:${m[2]}`;
        }
      }
    }
    let siteText = '';
    if (cfg.siteMode === 'column' && cfg.siteCol !== null) siteText = cellText(cellAt(g, r, cfg.siteCol));
    else if (cfg.siteMode === 'sheet') siteText = g0.name;
    else siteText = cfg.fixedSite;
    if (!siteText) continue;
    const sampleName = cfg.sampleCol !== null ? cellText(cellAt(g, r, cfg.sampleCol)) : '';
    const s: RawSample = {
      key: `${g0.name}#${r}`,
      sampleName: sampleName || `${siteText} ${date.slice(0, 10)}`,
      labNumber: undefined,
      siteText,
      date,
      dateSource: 'cell',
      sheet: g0.name,
      results: [],
    };
    for (const c of cols) {
      const raw = cellValue(cellAt(g, r, c.col));
      const parsed = parseValue(raw);
      if (parsed.missing) continue;
      s.results.push({ analyte: c.analyte, unit: c.unit, raw, parsed });
    }
    if (s.results.length) samples.push(s);
  }
  if (!samples.length) warnings.push('No rows with a valid date were found – check the date column and first data row.');
  else if (noDate > 3) warnings.push(`${noDate} rows without a valid date were skipped (e.g. guideline or statistics rows).`);
  return { kind: 'wide', samples, warnings };
}
