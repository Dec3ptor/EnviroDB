// Waste acceptance: whether a soil can go to a landfill of a class, by the two-step check – its total concentrations
// against a screening value and, where a total is over it, the concentration in the extract of a leaching test (TCLP)
// against the leachate limit. The criteria are a guideline set of the team's own: totals for the soil parameters
// (mg/kg), leachate limits for their TCLP counterparts (mg/L). EnviroDB has no criteria of its own.
//
// The screening value for a contaminant with a leachate limit and no total of its own can be worked out: a TCLP test
// extracts with twenty times the sample's weight of fluid, so even if all of the contaminant leached, the extract
// couldn't hold more than the total ÷ 20 – a total at or under 20 × the leachate limit can't fail the test.

import type { GuidelineSet, Parameter, Result, Sample, Site } from '../db/types';
import { convert } from './units';
import { fmtNum } from './values';

/** The fluid a TCLP test extracts with, for each part of sample by weight (US EPA Method 1311). */
export const TCLP_RATIO = 20;

export interface WasteCriterion {
  /** What pairs a total with its leachate limit: the water parameter both are counterparts of (or the parameter itself). */
  key: string;
  /** The contaminant, as the soil parameter names it without "(soil)". */
  name: string;
  soilId?: string;
  leachId?: string;
  /** The set's total concentration (mg/kg), and its leachate limit (mg/L). */
  total?: number;
  leach?: number;
  /** The total a sample is screened at (mg/kg): the set's, or 20 × the leachate limit – and which. */
  screen?: number;
  screenFrom?: 'set' | 'leach';
}

export interface WasteOptions {
  /** Where the set gives a leachate limit and no total: screen at 20 × the limit (else such a contaminant needs a TCLP result). */
  screen20: boolean;
  /**
   * What a total given beside a leachate limit is: a screening value – over it, a TCLP result under its limit still
   * passes (the usual way) – or a limit of its own, to be met as well.
   */
  totalIs: 'screen' | 'limit';
}

export const WASTE_DEFAULTS: WasteOptions = { screen20: true, totalIs: 'screen' };

const bare = (name: string) => name.replace(/\s*\((soil|TCLP|SPLP)\)\s*$/i, '').trim();

/** A guideline set read as waste acceptance criteria: each contaminant's total and leachate limit, paired. */
export function wasteCriteria(set: Pick<GuidelineSet, 'values'>, params: ReadonlyMap<string, Parameter>, opts: WasteOptions = WASTE_DEFAULTS): WasteCriterion[] {
  const by = new Map<string, WasteCriterion>();
  for (const v of set.values) {
    const p = params.get(v.parameterId);
    if (!p || v.max === undefined || (p.matrix !== 'soil' && p.matrix !== 'tclp')) continue;
    const key = p.of ?? p.id;
    const c = by.get(key) ?? { key, name: bare(p.name) };
    if (p.matrix === 'soil') {
      const total = convert(v.max, v.unit, 'mg/kg');
      if (total === null) continue;
      c.soilId = p.id;
      c.total = total;
      c.name = bare(p.name);
    } else {
      const leach = convert(v.max, v.unit, 'mg/L');
      if (leach === null) continue;
      c.leachId = p.id;
      c.leach = leach;
    }
    by.set(key, c);
  }
  // the counterparts the set doesn't name: a leachate limit's total is still looked up, and a total's TCLP result
  const twin = (key: string, matrix: 'soil' | 'tclp') => [...params.values()].find((p) => p.matrix === matrix && (p.of ?? p.id) === key)?.id;
  const out = [...by.values()].map((c) => {
    const soilId = c.soilId ?? twin(c.key, 'soil');
    const leachId = c.leachId ?? twin(c.key, 'tclp');
    const screen = c.total !== undefined ? c.total : c.leach !== undefined && opts.screen20 ? c.leach * TCLP_RATIO : undefined;
    return { ...c, soilId, leachId, ...(screen !== undefined ? { screen, screenFrom: c.total !== undefined ? ('set' as const) : ('leach' as const) } : {}) };
  });
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export type WasteStatus = 'pass' | 'pass-leach' | 'fail' | 'need-leach' | 'unclear' | 'none';

export interface WasteCell {
  criterion: WasteCriterion;
  /** The total (mg/kg) and the TCLP result (mg/L), with "<" for a non-detect, where the sample has them. */
  total?: { value: number; nd: boolean };
  leach?: { value: number; nd: boolean };
  status: WasteStatus;
  /** Why, in words. */
  why: string;
}

export type WasteVerdict = 'meets' | 'over' | 'test' | 'unclear' | 'no-data';

export interface WasteSample {
  sample: Sample;
  site: Site;
  cells: WasteCell[];
  verdict: WasteVerdict;
  /** What decides it: "Over: Lead (TCLP 2.4 mg/L, limit 1)", "TCLP needed: Lead, Zinc". */
  summary: string;
  /** Contaminants with a criterion and no result. */
  untested: string[];
}

const num = (v: number) => fmtNum(Number(v.toPrecision(3)));
const said = (x: { value: number; nd: boolean }, unit: string) => `${x.nd ? '< ' : ''}${num(x.value)} ${unit}`;

function reading(r: Result | undefined, to: string, fallback: string): { value: number; nd: boolean } | undefined {
  if (!r || r.value === null || r.excluded) return undefined;
  const v = convert(r.value, r.unit || fallback, to);
  return v === null ? undefined : { value: v, nd: r.qualifier === '<' };
}

/** One contaminant in one sample, by the two steps. */
export function wasteCell(c: WasteCriterion, total: WasteCell['total'], leach: WasteCell['leach'], opts: WasteOptions = WASTE_DEFAULTS): WasteCell {
  const cell = (status: WasteStatus, why: string): WasteCell => ({ criterion: c, ...(total ? { total } : {}), ...(leach ? { leach } : {}), status, why });
  // the total as a limit of its own: over it, nothing else helps
  if (opts.totalIs === 'limit' && c.total !== undefined && total && !total.nd && total.value > c.total) return cell('fail', `total ${said(total, 'mg/kg')} is over the limit of ${num(c.total)}`);
  // step two decides where there's a leach test result
  if (leach && c.leach !== undefined) {
    if (leach.nd && leach.value > c.leach) return cell('unclear', `TCLP ${said(leach, 'mg/L')}: the detection limit is above the limit of ${num(c.leach)}`);
    if (leach.value > c.leach) return cell('fail', `TCLP ${said(leach, 'mg/L')} is over the limit of ${num(c.leach)}`);
    if (opts.totalIs === 'limit' && c.total !== undefined && !total) return cell('unclear', `TCLP ${said(leach, 'mg/L')} is within the limit of ${num(c.leach)}; no total to compare with ${num(c.total)} mg/kg`);
    return cell('pass-leach', `TCLP ${said(leach, 'mg/L')} is within the limit of ${num(c.leach)}`);
  }
  if (!total) return cell('none', 'not tested');
  // step one: the total against the screening value
  if (c.screen === undefined) return cell('need-leach', `the criteria give a leachate limit (${num(c.leach!)} mg/L) and no total to screen at: a TCLP result is needed`);
  const from = c.screenFrom === 'leach' ? `${num(c.screen)} (${TCLP_RATIO} × the leachate limit)` : num(c.screen);
  if (total.nd && total.value > c.screen) return cell('unclear', `total ${said(total, 'mg/kg')}: the detection limit is above the screening value of ${from}`);
  if (total.value <= c.screen) return cell('pass', `total ${said(total, 'mg/kg')} is within ${c.leach !== undefined ? 'the screening value' : 'the limit'} of ${from}`);
  if (c.leach !== undefined) return cell('need-leach', `total ${said(total, 'mg/kg')} is over the screening value of ${from}: a TCLP result decides (limit ${num(c.leach)} mg/L)`);
  return cell('fail', `total ${said(total, 'mg/kg')} is over the limit of ${from}`);
}

const VERDICT_TEXT: Record<WasteVerdict, string> = { meets: 'Meets the criteria', over: 'Over the criteria', test: 'TCLP needed', unclear: 'Can’t be told', 'no-data': 'Nothing to compare' };
export const verdictText = (v: WasteVerdict): string => VERDICT_TEXT[v];

/** Soil and sediment samples against the criteria: each contaminant by the two steps, and what that makes of the sample. */
export function wasteCheck(samples: Sample[], resultsOf: (sampleId: string) => Result[], siteOf: (id: string) => Site | undefined, criteria: WasteCriterion[], opts: WasteOptions = WASTE_DEFAULTS): WasteSample[] {
  const out: WasteSample[] = [];
  for (const sample of samples) {
    const site = siteOf(sample.siteId);
    if (!site) continue;
    const results = new Map(resultsOf(sample.id).map((r) => [r.parameterId, r]));
    const cells = criteria.map((c) => wasteCell(c, c.soilId ? reading(results.get(c.soilId), 'mg/kg', 'mg/kg') : undefined, c.leachId ? reading(results.get(c.leachId), 'mg/L', 'mg/L') : undefined, opts));
    const of = (s: WasteStatus) => cells.filter((x) => x.status === s);
    const names = (xs: WasteCell[]) => xs.map((x) => x.criterion.name).join(', ');
    const over = of('fail'), test = of('need-leach'), unclear = of('unclear'), tested = cells.filter((x) => x.status !== 'none');
    const verdict: WasteVerdict = !tested.length ? 'no-data' : over.length ? 'over' : test.length ? 'test' : unclear.length ? 'unclear' : 'meets';
    const summary =
      verdict === 'over'
        ? `Over: ${over.map((x) => `${x.criterion.name} (${x.why})`).join('; ')}`
        : verdict === 'test'
          ? `TCLP needed: ${names(test)}`
          : verdict === 'unclear'
            ? `Can’t be told: ${unclear.map((x) => `${x.criterion.name} (${x.why})`).join('; ')}`
            : verdict === 'meets'
              ? `${tested.length} of ${cells.length} contaminants tested, all within the criteria`
              : 'No results for anything the criteria name';
    out.push({ sample, site, cells, verdict, summary, untested: of('none').map((x) => x.criterion.name) });
  }
  return out;
}

// ------------------------------------------------------------ criteria pasted in

export interface CriteriaRow {
  name: string;
  /** mg/kg */
  total?: number;
  /** mg/L */
  leach?: number;
}

/**
 * Criteria pasted from a spreadsheet or a table in a document: a contaminant a line, with its total concentration
 * and its leachate limit – either may be blank. Under headings, the columns are found by them ("Total", "mg/kg",
 * "Screening" / "TCLP", "Leachate", "mg/L"); without, they're name, total, leachate. Units in the headings are
 * heeded (µg/L, g/m³).
 */
export function parseCriteria(text: string): { rows: CriteriaRow[]; skipped: string[] } {
  // columns apart by tabs (from a spreadsheet), else by runs of spaces (from a document – a comma there is in a number,
  // "2,000"), else by commas or semicolons (a CSV, a number with a comma in it quoted)
  const how = /\t/.test(text) ? 'tab' : /\S {2,}\S/.test(text) ? 'spaces' : 'csv';
  const csv = (l: string) => (l.match(/("([^"]|"")*"|[^,;]*)(?:[,;]|$)/g) ?? []).slice(0, -1).map((c) => c.replace(/[,;]$/, '').replace(/^"|"$/g, '').replace(/""/g, '"'));
  const lines = text
    .split(/\r?\n/)
    .map((l) => (how === 'tab' ? l.split('\t') : how === 'spaces' ? l.trim().split(/\s{2,}/) : csv(l)).map((c) => c.trim()))
    .filter((l) => l.some(Boolean));
  if (!lines.length) return { rows: [], skipped: [] };
  const isNum = (c: string | undefined) => !!c && /^[<≤]?\s*\d[\d,]*\.?\d*$/.test(c.replace(/\s/g, ''));
  const num = (c: string | undefined) => (isNum(c) ? Number(c!.replace(/[<≤,\s]/g, '')) : undefined);
  const head = lines[0].map((h) => h.toLowerCase());
  const headed = !lines[0].slice(1).some(isNum);
  let cName = 0, cTotal = 1, cLeach = 2, fTotal = 1, fLeach = 1;
  if (headed) {
    const find = (re: RegExp) => head.findIndex((h, i) => i > 0 && re.test(h));
    const t = find(/total|screen|mg\s*\/\s*kg|soil|solid/);
    const l = find(/tclp|leach|mg\s*\/\s*l|g\s*\/\s*m\s*3|g\/m³|extract/);
    cName = Math.max(0, head.findIndex((h) => /contaminant|analyte|parameter|substance|compound|chemical|determinand|name/.test(h)));
    cTotal = t;
    cLeach = l;
    // a column of totals alone, or of leachate limits alone, under a heading that doesn't say which: by its unit
    if (t >= 0 && /[µu]g\s*\/\s*kg/.test(head[t])) fTotal = 0.001;
    if (t >= 0 && /\bg\s*\/\s*kg|%/.test(head[t]) && !/mg/.test(head[t])) fTotal = /%/.test(head[t]) ? 10000 : 1000;
    if (l >= 0 && /[µu]g\s*\/\s*l/.test(head[l])) fLeach = 0.001;
  }
  const rows: CriteriaRow[] = [];
  const skipped: string[] = [];
  for (const line of lines.slice(headed ? 1 : 0)) {
    const name = (line[cName] ?? '').replace(/\s+/g, ' ').trim();
    const total = cTotal >= 0 ? num(line[cTotal]) : undefined;
    const leach = cLeach >= 0 ? num(line[cLeach]) : undefined;
    if (!name || isNum(name) || (total === undefined && leach === undefined)) {
      if (name && !isNum(name)) skipped.push(name);
      continue;
    }
    rows.push({ name, ...(total !== undefined ? { total: total * fTotal } : {}), ...(leach !== undefined ? { leach: leach * fLeach } : {}) });
  }
  return { rows, skipped };
}

/** The check as CSV: a line a sample, a total and a TCLP column for each contaminant, and what each sample comes to. */
export function wasteCsv(rows: WasteSample[], criteria: WasteCriterion[], depth: (s: Sample) => string): string {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const val = (x: { value: number; nd: boolean } | undefined) => (x ? `${x.nd ? '<' : ''}${num(x.value)}` : '');
  const head = ['Site', 'Depth (m)', 'Date', 'Outcome', 'Why', ...criteria.flatMap((c) => [`${c.name} total (mg/kg)`, `${c.name} TCLP (mg/L)`])];
  const crit = ['Criteria', '', '', '', '', ...criteria.flatMap((c) => [c.screen !== undefined ? `${num(c.screen)}${c.screenFrom === 'leach' ? ' (20 x leachate limit)' : ''}` : '', c.leach !== undefined ? num(c.leach) : ''])];
  const lines = [head, crit, ...rows.map((r) => [r.site.code, depth(r.sample), r.sample.date.slice(0, 10), verdictText(r.verdict), r.summary, ...r.cells.flatMap((x) => [val(x.total), val(x.leach)])])];
  return lines.map((l) => l.map(esc).join(',')).join('\r\n') + '\r\n';
}
