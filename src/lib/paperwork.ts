// A sampling round's paperwork, worked out: the samples to take and what the lab analyses each for – from the sampling
// schedules, or, where a schedule names no analytes, what the lab reported for the site last time – the field readings
// to take, and the sheets of bottle labels. Drawn as a PDF by reports/paperwork.ts.

import type { MonitoringSchedule, Parameter, Site } from '../db/types';
import { addDays, addMonths, daysBetween } from './dates';
import { scheduleStep } from './schedule';

const lastDayOf = (month: string) => addDays(addMonths(`${month}-01`, 1), -1);

/** Readings taken only in bores (a column for them is greyed out at the other sites). */
export const BORE_ONLY = new Set(['swl', 'gw-level', 'water-level-bgl', 'stick-up', 'bore-depth', 'dtw-bgl', 'gwl-rl', 'water-column', 'purge-vol']);

/**
 * The schedules with a round in these months ('YYYY-MM'): one that starts in them, or whose sampling window reaches
 * into them. Only schedules that are running (active, started, not ended before).
 */
export function schedulesDue(schedules: MonitoringSchedule[], months: string[]): MonitoringSchedule[] {
  if (!months.length) return [];
  const sorted = [...months].sort();
  const first = `${sorted[0]}-01`;
  const last = lastDayOf(sorted[sorted.length - 1]);
  const want = new Set(months);
  return schedules.filter((sch) => {
    if (!sch.active || sch.startDate > last || (sch.endDate && sch.endDate < first)) return false;
    const span = sch.unit === 'month' || sch.unit === 'year' ? Math.max(1, Math.round(sch.window ?? 1)) : 1;
    // rounds every few days or weeks: start near the months asked about (not from the schedule's first day)
    const stepDays = sch.unit === 'day' ? Math.max(1, sch.every) : sch.unit === 'week' ? 7 * Math.max(1, sch.every) : 0;
    const k0 = stepDays ? Math.max(0, Math.floor(daysBetween(sch.startDate, first) / stepDays) - 1) : 0;
    for (let k = k0; k < k0 + 4000; k++) {
      const start = scheduleStep(sch.startDate, k, sch.every, sch.unit);
      if (start > last || (sch.endDate && start > sch.endDate)) return false;
      for (let m = 0; m < span; m++) if (want.has(addMonths(`${start.slice(0, 7)}-01`, m).slice(0, 7))) return true;
    }
    return false;
  });
}

export interface PlanSample {
  /** Its name on the labels and the lab's list: the site's code, or an extra sample's name. */
  name: string;
  siteId?: string;
  /** The site's name, and what it is ("Surface water"). */
  siteName?: string;
  type?: string;
  /** What the lab analyses it for (parameter ids), in the parameters' order. */
  analytes: string[];
  /** The readings to take in the field (parameter ids). */
  field: string[];
  /** Where the analytes are from: the schedules, the site's last results, or nowhere (to write in). */
  from: 'schedule' | 'last' | 'none';
  /** Its analytes as a suite, by letter (see `suites`). */
  suite?: string;
  /** An extra sample: a duplicate, a blank. */
  extra?: boolean;
}

/** Samples analysed for the same things: named once, by letter. */
export interface Suite {
  letter: string;
  analytes: string[];
  /** The samples it's for. */
  samples: string[];
}

export interface RoundPlan {
  samples: PlanSample[];
  suites: Suite[];
  /** Every field reading to take, in the parameters' order. */
  field: string[];
}

export interface PlanInput {
  /** The project's sites, in its order. */
  sites: Array<Pick<Site, 'id' | 'code' | 'name' | 'type'>>;
  /** The schedules the round is for. */
  schedules: Array<Pick<MonitoringSchedule, 'id' | 'siteIds' | 'parameterIds'>>;
  /** Every parameter, in order. */
  params: Array<Pick<Parameter, 'id' | 'group' | 'formula'>>;
  /** The sites to sample (all the schedules' when not given) – a dry bore left out. */
  siteIds?: string[];
  /** What the lab reported for a site last time – used where its schedules name no analytes. */
  lastAnalytes?: (siteId: string) => string[];
  /** The field readings usually taken, where the schedules name none. */
  usualField?: string[];
  /** Extra samples, by name: "DUP1", "Field blank". */
  extras?: string[];
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
/** A, B … Z, AA, AB … */
export const suiteLetter = (i: number): string => (i < 26 ? LETTERS[i] : `${LETTERS[Math.floor(i / 26) - 1] ?? 'Z'}${LETTERS[i % 26]}`);

/**
 * The round's samples: each of the schedules' sites with what its schedules name for it – the lab's analytes and the
 * field readings apart (a calculated parameter is neither: it's worked out). A site whose schedule names nothing
 * takes what the lab reported for it last time. Samples analysed for the same things share a suite letter.
 */
export function planRound(input: PlanInput): RoundPlan {
  const order = new Map(input.params.map((p, i) => [p.id, i]));
  const byId = new Map(input.params.map((p) => [p.id, p]));
  const inOrder = (ids: string[]) => [...new Set(ids)].filter((id) => byId.has(id)).sort((a, b) => order.get(a)! - order.get(b)!);
  const isField = (id: string) => byId.get(id)?.group === 'Field';
  const measured = (id: string) => !byId.get(id)?.formula;
  const chosen = input.siteIds ? new Set(input.siteIds) : null;
  const samples: PlanSample[] = [];
  for (const site of input.sites) {
    const mine = input.schedules.filter((s) => s.siteIds.includes(site.id));
    if (!mine.length || (chosen && !chosen.has(site.id))) continue;
    const named = inOrder(mine.flatMap((s) => s.parameterIds)).filter(measured);
    let analytes = named.filter((id) => !isField(id));
    let field = named.filter(isField);
    let from: PlanSample['from'] = analytes.length ? 'schedule' : 'none';
    // a schedule that names nothing ("any sample counts"): as the lab reported last time
    if (!analytes.length && mine.some((s) => !s.parameterIds.length)) {
      analytes = inOrder(input.lastAnalytes?.(site.id) ?? []).filter((id) => measured(id) && !isField(id));
      if (analytes.length) from = 'last';
    }
    if (!field.length) field = inOrder(input.usualField ?? []).filter((id) => isField(id) && (!BORE_ONLY.has(id) || site.type === 'Groundwater'));
    samples.push({ name: site.code, siteId: site.id, siteName: site.name || undefined, type: site.type, analytes, field, from });
  }
  for (const raw of input.extras ?? []) {
    const name = raw.trim();
    if (name && !samples.some((s) => s.name.toLowerCase() === name.toLowerCase())) samples.push({ name, analytes: [], field: [], from: 'none', extra: true });
  }
  // the suites: each different list of analytes, lettered in the order they come
  const suites: Suite[] = [];
  for (const s of samples) {
    if (!s.analytes.length) continue;
    const key = s.analytes.join('|');
    let suite = suites.find((x) => x.analytes.join('|') === key);
    if (!suite) suites.push((suite = { letter: suiteLetter(suites.length), analytes: s.analytes, samples: [] }));
    suite.samples.push(s.name);
    s.suite = suite.letter;
  }
  return { samples, suites, field: inOrder(samples.flatMap((s) => s.field)) };
}

// ------------------------------------------------------------ label sheets

/** A sheet of labels (A4): how many across and down, each label's size, the margins and the gaps between – all mm. */
export interface LabelSheet {
  id: string;
  label: string;
  cols: number;
  rows: number;
  width: number;
  height: number;
  left: number;
  top: number;
  gapX: number;
  gapY: number;
}

/** The usual A4 label sheets, by how many are on a sheet (the sizes are the common Avery ones). */
export const LABEL_SHEETS: LabelSheet[] = [
  { id: '21', label: '21 a sheet – 63.5 × 38.1 mm (L7160)', cols: 3, rows: 7, width: 63.5, height: 38.1, left: 7.2, top: 15.15, gapX: 2.54, gapY: 0 },
  { id: '14', label: '14 a sheet – 99.1 × 38.1 mm (L7163)', cols: 2, rows: 7, width: 99.1, height: 38.1, left: 4.65, top: 15.15, gapX: 2.54, gapY: 0 },
  { id: '8', label: '8 a sheet – 99.1 × 67.7 mm (L7165)', cols: 2, rows: 4, width: 99.1, height: 67.7, left: 4.65, top: 13.1, gapX: 2.54, gapY: 0 },
  { id: '24', label: '24 a sheet – 63.5 × 33.9 mm (L7159)', cols: 3, rows: 8, width: 63.5, height: 33.9, left: 7.2, top: 12.9, gapX: 2.54, gapY: 0 },
  { id: '65', label: '65 a sheet – 38.1 × 21.2 mm (L7651)', cols: 5, rows: 13, width: 38.1, height: 21.2, left: 4.75, top: 10.7, gapX: 2.54, gapY: 0 },
];

export const labelSheet = (id: string | undefined): LabelSheet => LABEL_SHEETS.find((s) => s.id === id) ?? LABEL_SHEETS[0];

export interface BottleLabel {
  /** The sample's name – the biggest thing on the label. */
  name: string;
  siteName?: string;
  suite?: string;
  /** "2 of 3", when a sample has several labels. */
  count?: string;
}

/**
 * The labels to print: `each` for every sample (one per bottle), in the samples' order – after `skip` blanks, to
 * start part-way down a sheet that's been used.
 */
export function bottleLabels(samples: PlanSample[], each: number, skip = 0): Array<BottleLabel | null> {
  const n = Math.max(0, Math.min(24, Math.round(each)));
  const out: Array<BottleLabel | null> = Array.from({ length: Math.max(0, Math.round(skip)) }, () => null);
  for (const s of samples) for (let i = 1; i <= n; i++) out.push({ name: s.name, siteName: s.siteName, suite: s.suite, count: n > 1 ? `${i} of ${n}` : undefined });
  return out;
}

/** How many sheets the labels take. */
export const labelSheetsNeeded = (labels: number, sheet: LabelSheet): number => Math.ceil(labels / (sheet.cols * sheet.rows));
