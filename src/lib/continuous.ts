// Continuous data – rainfall, flow, water level – from a gauge's data file (a council's export, NIWA's CliFlo, a
// logger's CSV): find the dates and values in it, make daily values, and read them back for graphs and samples.

import type { ContinuousSeries, SeriesKind, SeriesYear } from '../db/types';
import { cellAt, cellText, isEmpty, type SheetGrid } from '../importers/workbook';
import { fromExcelSerial, parseDateAny } from './dates';

export const KIND_TEXT: Record<SeriesKind, string> = { rainfall: 'Rainfall', flow: 'Flow', level: 'Water level', other: 'Other' };

/** A column of values found in the file. */
export interface FoundColumn {
  col: number;
  name: string;
  unit: string;
  kind: SeriesKind;
  count: number;
}

/** Where a file's records are: the sheet, the date (and time) columns, and the columns of values. */
export interface FoundTable {
  sheet: number;
  sheetName: string;
  firstRow: number;
  dateCol: number;
  timeCol: number;
  columns: FoundColumn[];
  rows: number;
  /** More than one reading a day. */
  subDaily: boolean;
  first: string;
  last: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** A date (and time) in a cell: anything a spreadsheet holds, and CliFlo's "20240305:0900". */
function cellDate(g: SheetGrid, r: number, c: number): string | null {
  const cell = cellAt(g, r, c);
  if (isEmpty(cell)) return null;
  if (typeof cell.v === 'number') return cell.date || (cell.v > 20000 && cell.v < 80000) ? fromExcelSerial(cell.v) : null;
  const t = String(cell.v).trim();
  const m = t.match(/^(\d{4})(\d{2})(\d{2})[:T ]?(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`;
  return parseDateAny(t);
}

/** A time of day in a cell ("13:15", "1:15 PM", or Excel's fraction of a day). */
function cellTime(g: SheetGrid, r: number, c: number): string | null {
  const cell = cellAt(g, r, c);
  if (isEmpty(cell)) return null;
  if (typeof cell.v === 'number' && cell.v >= 0 && cell.v < 1) {
    const mins = Math.round(cell.v * 1440);
    return `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`;
  }
  const m = cellText(cell).match(/^(\d{1,2})[:.](\d{2})(?:[:.]\d{2})?\s*(am|pm)?$/i);
  if (!m) return null;
  let h = Number(m[1]);
  if (m[3]?.toLowerCase() === 'pm' && h < 12) h += 12;
  if (m[3]?.toLowerCase() === 'am' && h === 12) h = 0;
  return h < 24 ? `${pad(h)}:${m[2]}` : null;
}

function cellNumber(g: SheetGrid, r: number, c: number): number | null {
  const cell = cellAt(g, r, c);
  if (isEmpty(cell)) return null;
  if (typeof cell.v === 'number') return cell.date ? null : cell.v;
  const t = String(cell.v).trim().replace(/,/g, '');
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
}

/** What kind of record a column holds, from its heading and unit. */
export function guessKind(name: string, unit: string): SeriesKind {
  const t = `${name} ${unit}`.toLowerCase();
  if (/rain|precip/.test(t)) return 'rainfall';
  if (/flow|discharge|cumec|m3\/s|m³\/s|l\/s|\bl\/sec/.test(t)) return 'flow';
  if (/level|stage|height|depth|\bwl\b/.test(t)) return 'level';
  if (/^\s*mm\s*$/.test(unit)) return 'rainfall';
  return 'other';
}

const UNIT_IN = /[([]\s*([^()[\]]{1,12}?)\s*[)\]]/;
/** "Amount(mm)" → mm; "Flow [m3/s]" → m³/s. */
export function unitOf(heading: string): string {
  const u = heading.match(UNIT_IN)?.[1] ?? '';
  return u.replace(/m3\/s/i, 'm³/s').replace(/^cumecs?$/i, 'm³/s');
}

const SKIP = /station|agent|site\s*(no|id|number)|\bid\b|freq|period|quality|qual|flag|code|comment/i;

/** Find the records in a file's sheets: the first sheet with a column of dates beside columns of numbers. */
export function findContinuous(grids: SheetGrid[]): FoundTable | null {
  for (let gi = 0; gi < grids.length; gi++) {
    const g = grids[gi];
    // the first row with a date and a number, its date column being dates in most of the next rows
    for (let r = 0; r < Math.min(g.nRows, 80); r++) {
      for (let c = 0; c < Math.min(g.nCols, 8); c++) {
        if (!cellDate(g, r, c)) continue;
        const sample = Array.from({ length: Math.min(20, g.nRows - r) }, (_, i) => r + i);
        if (sample.filter((x) => cellDate(g, x, c)).length < sample.length * 0.8) continue;
        const timeCol = [c + 1, c - 1].find((tc) => tc >= 0 && sample.filter((x) => cellTime(g, x, tc)).length >= sample.length * 0.8) ?? -1;
        const header = r > 0 ? r - 1 : -1;
        const columns: FoundColumn[] = [];
        for (let vc = 0; vc < g.nCols; vc++) {
          if (vc === c || vc === timeCol) continue;
          const numbers = sample.filter((x) => cellNumber(g, x, vc) !== null).length;
          if (numbers < Math.max(1, sample.length * 0.5)) continue;
          const name = header >= 0 ? cellText(cellAt(g, header, vc)) : '';
          if (name && SKIP.test(name)) continue;
          const vals = sample.map((x) => cellNumber(g, x, vc)).filter((v): v is number => v !== null);
          // a column that never changes and is a whole number is a station number, not a reading
          if (!name && vals.length > 3 && vals.every((v) => v === vals[0] && Number.isInteger(v) && v > 1000)) continue;
          const unit = unitOf(name);
          columns.push({ col: vc, name: name.replace(UNIT_IN, '').trim() || `Column ${vc + 1}`, unit, kind: guessKind(name, unit), count: 0 });
        }
        if (!columns.length) continue;
        let rows = 0, first = '', last = '';
        const perDay = new Map<string, number>();
        for (let x = r; x < g.nRows; x++) {
          const d = readingDate(g, x, c, timeCol);
          if (!d) continue;
          rows++;
          if (!first || d < first) first = d;
          if (!last || d > last) last = d;
          perDay.set(d.slice(0, 10), (perDay.get(d.slice(0, 10)) ?? 0) + 1);
          for (const col of columns) if (cellNumber(g, x, col.col) !== null) col.count++;
        }
        const subDaily = [...perDay.values()].some((n) => n > 1);
        return { sheet: gi, sheetName: g.name, firstRow: r, dateCol: c, timeCol, columns: columns.filter((x) => x.count), rows, subDaily, first, last };
      }
    }
  }
  return null;
}

function readingDate(g: SheetGrid, r: number, dateCol: number, timeCol: number): string | null {
  const d = cellDate(g, r, dateCol);
  if (!d) return null;
  if (timeCol < 0 || d.length > 10) return d;
  const t = cellTime(g, r, timeCol);
  return t ? `${d.slice(0, 10)}T${t}` : d;
}

/** A day's value: rainfall the total, the others the mean and the highest. */
export interface DayValue {
  v: number;
  hi?: number;
}

/**
 * The daily values of one column. Rainfall readings are totals for the time just ended, so a reading at exactly
 * midnight belongs to the day before (when there are several a day).
 */
export function dailyValues(g: SheetGrid, t: FoundTable, col: number, kind: SeriesKind): Map<string, DayValue> {
  const sums = new Map<string, { sum: number; n: number; hi: number }>();
  for (let r = t.firstRow; r < g.nRows; r++) {
    const d = readingDate(g, r, t.dateCol, t.timeCol);
    const v = cellNumber(g, r, col);
    if (!d || v === null || !Number.isFinite(v)) continue;
    let day = d.slice(0, 10);
    if (kind === 'rainfall' && t.subDaily && /T00:00/.test(d)) day = shiftDay(day, -1);
    const cur = sums.get(day) ?? { sum: 0, n: 0, hi: -Infinity };
    cur.sum += v;
    cur.n++;
    cur.hi = Math.max(cur.hi, v);
    sums.set(day, cur);
  }
  const out = new Map<string, DayValue>();
  for (const [day, s] of [...sums].sort(([a], [b]) => (a < b ? -1 : 1))) {
    out.set(day, kind === 'rainfall' ? { v: round(s.sum) } : { v: round(s.sum / s.n), hi: round(s.hi) });
  }
  return out;
}

const round = (v: number) => Number(v.toPrecision(6));

function shiftDay(day: string, n: number): string {
  const t = Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)) + n * 864e5;
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

const dayOfYear = (day: string) => (Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)) - Date.UTC(+day.slice(0, 4), 0, 1)) / 864e5;
const yearLength = (y: number) => (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 366 : 365);

/** Daily values as a series' year records, merged into those it already has (new days replace old ones). */
export function toYears(projectId: string, seriesId: string, days: Map<string, DayValue>, existing: SeriesYear[] = []): SeriesYear[] {
  const byYear = new Map<string, SeriesYear>(existing.map((y) => [y.year, { ...y, v: [...y.v], hi: y.hi ? [...y.hi] : undefined }]));
  for (const [day, val] of days) {
    const year = day.slice(0, 4);
    let rec = byYear.get(year);
    if (!rec) {
      rec = { id: `${seriesId}|${year}`, projectId, seriesId, year, v: Array<number | null>(yearLength(+year)).fill(null) };
      byYear.set(year, rec);
    }
    const i = dayOfYear(day);
    rec.v[i] = val.v;
    if (val.hi !== undefined) {
      rec.hi ??= Array(rec.v.length).fill(null);
      rec.hi[i] = val.hi;
    }
  }
  return [...byYear.values()].sort((a, b) => (a.year < b.year ? -1 : 1));
}

/** Every day with a value, in order: [day, value]. */
export function seriesDays(years: SeriesYear[], from?: string, to?: string): Array<[string, number]> {
  const out: Array<[string, number]> = [];
  for (const y of [...years].sort((a, b) => (a.year < b.year ? -1 : 1))) {
    if ((from && y.year < from.slice(0, 4)) || (to && y.year > to.slice(0, 4))) continue;
    const start = Date.UTC(+y.year, 0, 1);
    y.v.forEach((v, i) => {
      if (v === null || v === undefined) return;
      const d = new Date(start + i * 864e5);
      const day = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
      if ((from && day < from.slice(0, 10)) || (to && day > to.slice(0, 10))) return;
      out.push([day, v]);
    });
  }
  return out;
}

/** The first and last days with records. */
export function seriesRange(years: SeriesYear[]): { first?: string; last?: string; days: number } {
  const all = seriesDays(years);
  return { first: all[0]?.[0], last: all[all.length - 1]?.[0], days: all.length };
}

/** How wet it was when a sample was taken: rain on the day, and in the days before (when there are records). */
export function rainAround(years: SeriesYear[], date: string, daysBefore = 3): { day: number | null; before: number | null; complete: boolean } {
  const day = date.slice(0, 10);
  const byYear = new Map(years.map((y) => [y.year, y]));
  const at = (d: string) => byYear.get(d.slice(0, 4))?.v[dayOfYear(d)] ?? null;
  const today = at(day);
  let before = 0, seen = 0;
  for (let i = 1; i <= daysBefore; i++) {
    const v = at(shiftDay(day, -i));
    if (v !== null) (before += v), seen++;
  }
  return { day: today, before: seen ? round(before) : null, complete: seen === daysBefore && today !== null };
}

/** The rainfall series (with their days) of a project. */
export function rainSeries(c: { series: ContinuousSeries[]; days: SeriesYear[] } | undefined): Array<{ series: ContinuousSeries; years: SeriesYear[] }> {
  if (!c) return [];
  return c.series.filter((s) => s.kind === 'rainfall').map((series) => ({ series, years: c.days.filter((d) => d.seriesId === series.id) }));
}

/** A graph's background records: one series ("series:<id>"), or the project's first of a kind ("kind:rainfall"). */
export function overlayFor(choice: string | undefined, c: { series: ContinuousSeries[]; days: SeriesYear[] } | undefined): { series: ContinuousSeries; years: SeriesYear[] } | null {
  if (!choice || !c?.series.length) return null;
  const at = choice.indexOf(':');
  const how = choice.slice(0, at), what = choice.slice(at + 1);
  const series = how === 'series' ? c.series.find((x) => x.id === what) : [...c.series].sort((a, b) => a.name.localeCompare(b.name)).find((x) => x.kind === what);
  return series ? { series, years: c.days.filter((d) => d.seriesId === series.id) } : null;
}
