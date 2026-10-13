// Parser for "master sheet" style spreadsheets: one row per sampling event (dates down the rows),
// analytes across the columns, optionally a units row under the header and a site column
// (or one sheet per site). Transposed sheets (dates across the columns) are handled by transposing.
//
// Exports from monitoring databases often put labelled rows above the header instead, with a
// status and lab reference per row – and the labelled rows may sit a column to the left of their
// analytes when the export leaves a column out of them:
//
//   Sample:,,,SP1,SP1,SP1
//   Unit:,,,%,g/m³,µS/cm
//   Date,Status,Lab Reference,Processed Date,Ion balance,Zinc - Total,Electrical Conductivity (EC)
//   2026-03-01 01:00:00,Processed,26/1234-01,2026-03-20 16:00:54,0.5,0.012,410
//   2026-04-01 00:00:00,Missed,,,No Result,No Result,No Result

import { cellAt, cellText, cellValue, isEmpty, transpose, type SheetGrid } from './workbook';
import { PROVISIONAL_NOTE, type ParsedImport, type RawSample } from './model';
import { extractDate, parseDateAny } from '../lib/dates';
import { normUnit, sameDimension, splitHeaderUnit, unitDim } from '../lib/units';
import { parseValue } from '../lib/values';
import type { ParamIndex } from '../lib/matching';
import { matchParameter } from '../lib/matching';

export interface WideConfig {
  sheet: string;
  orientation: 'rows' | 'columns'; // rows = each row is a sample (dates per row)
  headerRow: number;
  unitRow: number | null;
  /** How many columns the units (and site) row is written to the left of its analytes – 0 when directly above or below. */
  shift?: number;
  firstDataRow: number;
  dateCol: number;
  timeCol: number | null;
  siteMode: 'column' | 'sheet' | 'fixed' | 'row';
  siteCol: number | null;
  /** Row naming the site over each analyte column ("Sample: | SP1 | SP1 …") when siteMode = row. */
  siteRow?: number | null;
  fixedSite: string; // site text (code) when siteMode = fixed
  sampleCol: number | null;
  /** Lab number / lab reference of each row. */
  labCol?: number | null;
  /** Sampling status of each row ("Processed", "At Lab", "Missed" …). */
  statusCol?: number | null;
  skipCols: number[];
}

const NON_ANALYTE = /^(comments?|notes?|remarks?|weather|sampler|sampled\s*by|collected\s*by|time|lab\s*(no|number|ref|id)|job\s*(no|number)|sample\s*(id|no\.?|number|name|ref|code|type)|field\s*notes|qa\/?qc|duplicate|easting|northing|latitude|longitude|lat|long|location|site(\s*(name|code|id))?|station|bore|well|date(\s*sampled)?|sampling\s*date|month|year|quarter|flow\s*conditions?|tide|observations?|photo|initials?|staff|by|event|round|matrix|depth\s*\(m\)|laboratory|lab)$/i;
const SITE_HEADER = /^(site(\s*(name|code|id|no))?|location|station|monitoring\s*(point|site|location)|sampling\s*(point|site|location)|bore(\s*id)?|well(\s*id)?|sample\s*point|point|sample\s*location)$/i;
const DATE_HEADER = /^(date(\s*sampled)?|sampl(e|ing)\s*date|date\s*\/\s*time|collection\s*date|date\s*collected|datetime|sample\s*date)$/i;
const TIME_HEADER = /^(time(\s*sampled)?|sampl(e|ing)\s*time)$/i;
const SAMPLE_HEADER = /^(sample\s*(id|no\.?|number|name|ref)|client\s*sample\s*id)$/i;
const LAB_HEADER = /^(lab(oratory)?\s*(sample\s*)?(no\.?|number|ref(erence)?|id|#)|lab\s*job(\s*(no\.?|number))?|coc(\s*(no\.?|number))?)$/i;
const STATUS_HEADER = /^((sample|sampling|result|lab|analysis)\s*)?status$/i;
// when the lab processed or reported the sample – not the sampling date
const ADMIN_HEADER = /^(((date|time)\s*)?(processed|reported|received|analy[sz]ed|registered|entered|approved|modified|updated)(\s*(date|on|at))?)$/i;
// lab checks rather than results
const QC_HEADER = /ion\s*balance|cation\s*[-/]?\s*anion|anion\s*[-/]?\s*cation|charge\s*balance/i;
const UNIT_LABEL = /^units?\s*:?$/i;
const SITE_LABEL = /^(sample(\s*(point|location|site|name))?|site(\s*(name|code|id))?|location|station|sampling\s*(point|site|location)|monitoring\s*(point|site|location)|point)\s*:?$/i;

// Sampling status of a row. Rows without results that are missed or still to come are left out; results
// still at the lab are imported with a note.
const FINAL_STATUS = /^(processed|complete(d)?|final(i[sz]ed)?|reported|approved|validated|verified|done|closed|released|authori[sz]ed|signed\s*off)$/i;
const MISSED_STATUS = /^(missed|not\s*(sampled|taken|collected|accessible)|no\s*(sample|access|flow)|cancel+ed|skipped|dry|abandoned)$/i;
const UPCOMING_STATUS = /^(due|overdue|waiting|scheduled|planned|pending|upcoming|to\s*do|booked|not\s*due|open)$/i;
const PROVISIONAL_STATUS = /^(at\s*(the\s*)?lab|in\s*lab|with\s*(the\s*)?lab|received|in\s*progress|in\s*analysis|being\s*analy[sz]ed|provisional|preliminary|interim|partial(ly)?(\s*complete)?|awaiting\s*\w+|submitted|sent|draft|unverified|not\s*verified)$/i;

export function gridFor(g: SheetGrid, orientation: WideConfig['orientation']): SheetGrid {
  return orientation === 'columns' ? transpose(g) : g;
}

function dateLike(cell: ReturnType<typeof cellAt>): boolean {
  if (isEmpty(cell)) return false;
  if (cell.date) return true;
  if (typeof cell.v === 'number') return false;
  return !!parseDateAny(cell.v);
}

const isUnitText = (t: string) => normUnit(t).known || /^(ph( units)?|ntu|°c|% ?sat|deg\.? ?c)$/i.test(t.trim());

/** The first text in a row, within its first few columns – the label of a labelled row. */
function rowLabel(g: SheetGrid, r: number, maxCol = 4): string {
  for (let c = 0; c < Math.min(maxCol, g.rows[r]?.length ?? 0); c++) {
    const t = cellText(cellAt(g, r, c));
    if (t) return t;
  }
  return '';
}

/** Share of a row's cells (other than a "Units:" label) that are units. */
function unitShare(g: SheetGrid, r: number): { share: number; known: number } {
  const cells = (g.rows[r] ?? []).map((x) => cellText(x)).filter((t) => t && !UNIT_LABEL.test(t));
  if (!cells.length) return { share: 0, known: 0 };
  const known = cells.filter(isUnitText).length;
  return { share: known / cells.length, known };
}

/** Columns a row of units is written to the left of its analytes: the shift that gives the matched analytes units of their kind. */
function bestShift(g: SheetGrid, headerRow: number, row: number, cols: number[], index: ParamIndex): number {
  const want = new Map<number, string>();
  for (const c of cols) {
    const m = matchParameter(cellText(cellAt(g, headerRow, c)), index);
    if (!m.parameterId || (m.confidence !== 'exact' && m.confidence !== 'high')) continue;
    const unit = index.params.find((p) => p.id === m.parameterId)?.unit;
    if (unit && normUnit(unit).known) want.set(c, unit);
  }
  const filled = (g.rows[row] ?? []).map((x, c) => (cellText(x) && !UNIT_LABEL.test(cellText(x)) ? c : -1)).filter((c) => c >= 0);
  let best = 0, bestScore = -Infinity;
  for (const d of [0, 1, -1, 2, -2]) {
    let s = 0;
    want.forEach((pu, c) => {
      const u = cellText(cellAt(g, row, c - d));
      if (!u || UNIT_LABEL.test(u)) {
        if (unitDim(pu) === 'ph') s += 0.25; // pH has no unit
        return;
      }
      if (normUnit(u).known) s += sameDimension(u, pu) ? 1 : -1;
    });
    // on a tie, the shift that lines the row up with the analyte columns
    if (filled.length && cols.length) {
      if (filled[0] + d === cols[0]) s += 0.1;
      if (filled[filled.length - 1] + d === cols[cols.length - 1]) s += 0.1;
    }
    if (s > bestScore + 1e-9) {
      bestScore = s;
      best = d;
    }
  }
  return best;
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
    // units row: directly below the header, or a labelled row above it
    let unitRow: number | null = null;
    for (const r of [headerRow + 1, headerRow + 2]) {
      if (r >= g.nRows) break;
      if ((g.rows[r] ?? []).every(isEmpty)) continue;
      if (unitShare(g, r).share >= 0.4) {
        unitRow = r;
        break;
      }
    }
    if (unitRow === null) {
      for (const r of [headerRow - 1, headerRow - 2, headerRow - 3]) {
        if (r < 0) break;
        const u = unitShare(g, r);
        if ((u.share >= 0.4 && u.known >= 2) || (UNIT_LABEL.test(rowLabel(g, r)) && u.known >= 1)) {
          unitRow = r;
          break;
        }
      }
    }

    let siteCol: number | null = null, timeCol: number | null = null, sampleCol: number | null = null, labCol: number | null = null, statusCol: number | null = null;
    const named: number[] = [];
    for (let c = 0; c < g.nCols; c++) {
      if (c === dateCol) continue;
      const hdr = cellText(cellAt(g, headerRow, c));
      if (siteCol === null && SITE_HEADER.test(hdr)) siteCol = c;
      else if (timeCol === null && TIME_HEADER.test(hdr)) timeCol = c;
      else if (sampleCol === null && SAMPLE_HEADER.test(hdr)) sampleCol = c;
      else if (labCol === null && LAB_HEADER.test(hdr)) labCol = c;
      else if (statusCol === null && STATUS_HEADER.test(hdr)) statusCol = c;
      else if (hdr && !ADMIN_HEADER.test(hdr)) named.push(c);
    }
    const shift = unitRow !== null ? bestShift(g, headerRow, unitRow, named, index) : 0;

    // a row naming the site over the analytes ("Sample: | SP1 | SP1 …"), when there is no site column
    let siteRow: number | null = null;
    if (siteCol === null && named.length) {
      for (const r of [headerRow - 1, headerRow - 2, headerRow - 3, headerRow - 4, headerRow + 1, headerRow + 2]) {
        if (r < 0 || r >= g.nRows || r === unitRow) continue;
        if (!SITE_LABEL.test(rowLabel(g, r))) continue;
        const covered = named.filter((c) => cellText(cellAt(g, r, c - shift))).length;
        if (covered >= named.length / 2) {
          siteRow = r;
          break;
        }
      }
    }

    let firstDataRow = Math.max(headerRow, unitRow ?? -1, siteRow ?? -1) + 1;
    while (firstDataRow < g.nRows && !dateLike(cellAt(g, firstDataRow, dateCol))) firstDataRow++;
    if (firstDataRow >= g.nRows) firstDataRow = Math.max(headerRow, unitRow ?? -1, siteRow ?? -1) + 1;

    // columns that are not results: ids and notes, processing dates and lab checks (columns without a value are left out when read)
    const skipCols: number[] = [];
    for (let c = 0; c < g.nCols; c++) {
      if ([dateCol, siteCol, timeCol, sampleCol, labCol, statusCol].includes(c)) continue;
      const hdr = cellText(cellAt(g, headerRow, c));
      if (!hdr || NON_ANALYTE.test(hdr) || ADMIN_HEADER.test(hdr) || QC_HEADER.test(hdr)) skipCols.push(c);
    }
    const config: WideConfig = {
      sheet: g0.name,
      orientation: o,
      headerRow,
      unitRow,
      shift,
      firstDataRow,
      dateCol,
      timeCol,
      siteMode: siteCol !== null ? 'column' : siteRow !== null ? 'row' : 'sheet',
      siteCol,
      siteRow,
      fixedSite: '',
      sampleCol,
      labCol,
      statusCol,
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
  /** Site written over the column (siteMode = row). */
  site?: string;
  skip: boolean;
  /** Skipped because it holds no results: only text such as "Completed", or dates. */
  noValues?: boolean;
}

/** True when a column has no results below the header – blank, words such as "Completed" or "No Result", or dates. */
function holdsNoValues(g: SheetGrid, col: number, firstRow: number): boolean {
  let values = 0, filled = 0, dates = 0;
  for (let r = firstRow; r < Math.min(g.nRows, firstRow + 1000); r++) {
    const cell = cellAt(g, r, col);
    if (isEmpty(cell)) continue;
    filled++;
    if (dateLike(cell)) dates++;
    else if (!parseValue(cellValue(cell)).missing) values++;
  }
  return !values || dates / filled >= 0.8;
}

export function wideColumns(g0: SheetGrid, cfg: WideConfig): WideColumn[] {
  const g = gridFor(g0, cfg.orientation);
  const shift = cfg.shift ?? 0;
  const special = new Set([cfg.dateCol, cfg.timeCol, cfg.siteMode === 'column' ? cfg.siteCol : null, cfg.sampleCol, cfg.labCol ?? null, cfg.statusCol ?? null].filter((x): x is number => x !== null));
  const cols: WideColumn[] = [];
  for (let c = 0; c < g.nCols; c++) {
    if (special.has(c)) continue;
    const header = cellText(cellAt(g, cfg.headerRow, c));
    if (!header) continue;
    const split = splitHeaderUnit(header);
    let unitCell = cfg.unitRow !== null ? cellText(cellAt(g, cfg.unitRow, c - shift)) : '';
    if (UNIT_LABEL.test(unitCell)) unitCell = '';
    const site = cfg.siteMode === 'row' && cfg.siteRow != null ? cellText(cellAt(g, cfg.siteRow, c - shift)) : undefined;
    const skipped = cfg.skipCols.includes(c);
    const noValues = !skipped && holdsNoValues(g, c, cfg.firstDataRow);
    cols.push({ col: c, header, analyte: split.name, unit: unitCell || split.unit, site: site && !SITE_LABEL.test(site) ? site : undefined, skip: skipped || noValues, noValues });
  }
  // a column without a site of its own belongs with its neighbour on the left (as under merged cells)
  if (cfg.siteMode === 'row') {
    let last = cols.find((c) => c.site)?.site;
    for (const c of cols) {
      if (c.site) last = c.site;
      else c.site = last;
    }
  }
  return cols;
}

/** What a row's status says about its results. */
function statusKind(status: string): 'final' | 'missed' | 'upcoming' | 'provisional' | 'other' {
  if (!status || FINAL_STATUS.test(status)) return 'final';
  if (MISSED_STATUS.test(status)) return 'missed';
  if (UPCOMING_STATUS.test(status)) return 'upcoming';
  if (PROVISIONAL_STATUS.test(status)) return 'provisional';
  return 'other';
}

export function parseWide(g0: SheetGrid, cfg: WideConfig): ParsedImport {
  const g = gridFor(g0, cfg.orientation);
  const cols = wideColumns(g0, cfg).filter((c) => !c.skip);
  // the columns of each site (one group unless a row of sites names several)
  const groups = new Map<string, typeof cols>();
  for (const c of cols) {
    const k = cfg.siteMode === 'row' ? c.site ?? '' : '';
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }
  const samples: RawSample[] = [];
  const warnings: string[] = [];
  let noDate = 0, missed = 0, upcoming = 0, provisional = 0;
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
    const status = cfg.statusCol != null ? cellText(cellAt(g, r, cfg.statusCol)) : '';
    const kind = statusKind(status);
    const labNumber = cfg.labCol != null ? cellText(cellAt(g, r, cfg.labCol)) || undefined : undefined;
    const sampleName = cfg.sampleCol !== null ? cellText(cellAt(g, r, cfg.sampleCol)) : '';
    let any = false;
    for (const [site, groupCols] of groups) {
      let siteText = '';
      if (cfg.siteMode === 'column' && cfg.siteCol !== null) siteText = cellText(cellAt(g, r, cfg.siteCol));
      else if (cfg.siteMode === 'sheet') siteText = g0.name;
      else if (cfg.siteMode === 'row') siteText = site;
      else siteText = cfg.fixedSite;
      if (!siteText) continue;
      const s: RawSample = {
        key: groups.size > 1 ? `${g0.name}#${r}#${site}` : `${g0.name}#${r}`,
        sampleName: sampleName || `${siteText} ${date.slice(0, 10)}`,
        labNumber,
        siteText,
        date,
        dateSource: 'cell',
        sheet: g0.name,
        results: [],
        status: status || undefined,
      };
      for (const c of groupCols) {
        const raw = cellValue(cellAt(g, r, c.col));
        const parsed = parseValue(raw);
        if (parsed.missing) continue;
        s.results.push({ analyte: c.analyte, unit: c.unit, raw, parsed });
      }
      if (!s.results.length) continue;
      if (kind === 'provisional') {
        s.provisional = true;
        s.notes = `${PROVISIONAL_NOTE} the file showed “${status}” when these results were imported.`;
      } else if (kind !== 'final') s.notes = `Status in the file: “${status}”.`;
      samples.push(s);
      any = true;
    }
    if (any && kind === 'provisional') provisional++;
    if (!any && kind === 'missed') missed++;
    if (!any && kind === 'upcoming') upcoming++;
  }
  // "2024-03-01 00:00:00", or 01:00 in daylight saving, is a date written with a clock time – not a sampling time
  const timed = samples.filter((s) => s.date!.length > 10);
  if (cfg.timeCol === null && timed.length) {
    const midnightOnly = timed.every((s) => /T0[01]:00$/.test(s.date!));
    for (const s of timed) if (midnightOnly || s.date!.endsWith('T00:00')) s.date = s.date!.slice(0, 10);
  }
  if (!samples.length) warnings.push('No rows with a valid date and results were found – check the date column and first data row.');
  else if (noDate > 3) warnings.push(`${noDate} rows without a valid date were skipped (e.g. guideline or statistics rows).`);
  const rows = (n: number) => (n === 1 ? '1 row' : `${n} rows`);
  if (missed) warnings.push(`${rows(missed)} marked as missed or not sampled had no results and ${missed === 1 ? 'was' : 'were'} left out.`);
  if (upcoming) warnings.push(`${rows(upcoming)} still due or waiting to be sampled ${upcoming === 1 ? 'was' : 'were'} left out.`);
  if (provisional) warnings.push(`${provisional === 1 ? '1 sample was' : `${provisional} samples were`} still with the lab – ${provisional === 1 ? 'it is' : 'they are'} imported with a note that the results may be provisional. Import the file again once the lab has finished to update them.`);
  return { kind: 'wide', samples, warnings };
}
