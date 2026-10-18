import type { ChartBlock, FigureImage, GuidelineSet, Letterhead, LetterheadItem, Parameter, ReportBlock, ReportTemplate, Result, ResultsTableBlock, Rule, Sample, Settings, Site } from '../db/types';
import { RULE_LEVELS } from '../db/types';
import type { ProjectBundle } from '../lib/analysis';
import { displayValue, evaluateAll, flagResults, isLimitLevel, keyParameters, limitToSites, statsTable, type CellFlag } from '../lib/analysis';
import type { RuleEvaluation } from '../lib/compliance';
import { describeRule, expandRules, ruleParamIds, STATUS_META } from '../lib/compliance';
import { addDays, addMonths, daysBetween, endOfMonth, formatDate, formatDateLong, MONTH_SHORT, todayStr, toUtcMs } from '../lib/dates';
import { monthLabel, reportPeriodLabel, reviewCell, type ReviewCell } from '../lib/latest';
import { guidelineFor } from '../lib/guidelines';
import { scheduleStep, frequencyLabel, nextObligation } from '../lib/schedule';
import { convert, unitLabel } from '../lib/units';
import { statLabel } from '../lib/stats';
import { fmtNum } from '../lib/values';
import { imageSize, logoSizeMm } from '../lib/image';
import { buildChartSpec, chartOption } from '../charts/timeSeries';
import { flagFillColour, SET_COLOURS, setColourIndex } from '../lib/highlight';
import { FILLS, TEXT_FLAGS, fillPlaceholders, inline, parseMarkup, type Cell, type CommentaryField, type DocNode, type PageGeometry, type ReportDoc, type ReportLook, type Run } from './model';
import { CELL_PAD_MM, fontWidthFactor, longestWordMm as longestWord, textWidthMm as textWidth } from './measure';
import { calcValue, fillCalcs } from './calc';
import { captionOf, fillCaption, tidyCaption } from './captions';

export interface BuildOptions {
  bundle: ProjectBundle;
  template: ReportTemplate;
  period: { start: string; end: string; label: string };
  settings: Settings;
  promptTexts?: Record<string, string>;
  /** Render graphs (needs a browser). When false a placeholder is inserted. */
  renderChart?: (option: ReturnType<typeof chartOption>, widthCm: number, heightCm: number) => string;
  /** Only these monitoring sites (unset or empty: every site), e.g. a groundwater report without the discharge. */
  siteIds?: string[];
  /** Images added for this report to its Figures sections, by section id. */
  figures?: Record<string, FigureImage[]>;
  /** A preview on screen: sections still waiting for something (images, who a letter is to) say so. */
  preview?: boolean;
}

const PAGE_MM: Record<string, [number, number]> = { A4: [210, 297], A3: [297, 420] };

export type Orientation = 'portrait' | 'landscape';

/**
 * The orientation of the pages each block is on. A page break can turn the pages from there on; a block with its
 * own `pages` setting – for a heading, its whole section – is on pages of that orientation, then the pages turn back.
 */
export function pageOrientations(blocks: ReportBlock[], base: Orientation): Orientation[] {
  let cur = base;
  const open: Array<{ level: number; restore: Orientation }> = []; // sections with their own orientation
  return blocks.map((b) => {
    if (b.type === 'heading' || b.type === 'title') {
      const level = b.type === 'heading' ? b.level : 0;
      while (open.length && open[open.length - 1].level >= level) cur = open.pop()!.restore;
    }
    if (b.type === 'pageBreak' && b.orientation) cur = b.orientation;
    if (!b.pages) return cur;
    if (b.type !== 'heading') return b.pages; // just this block
    open.push({ level: b.level, restore: cur });
    cur = b.pages;
    return cur;
  });
}

/** Page size in mm (portrait). */
export const pageSizeMm = (t: ReportTemplate): [number, number] => PAGE_MM[t.pageSize] ?? PAGE_MM.A4;

/** The letterhead a template is printed on: the one in Settings, or for a letter without one, the template's own logo and footer. */
export function letterheadFor(t: ReportTemplate, settings: Pick<Settings, 'letterhead'>): Letterhead | undefined {
  if (t.letterhead && settings.letterhead) return settings.letterhead;
  if (t.style !== 'letter') return undefined;
  const m = t.marginMm;
  const logo: LetterheadItem[] = t.logo ? [{ kind: 'image', align: 'left', dataUrl: t.logo, ...logoSizeMm(t.logo, t.logoHeightMm ?? DEFAULT_LOGO_MM, 80) }] : [];
  const small = { color: '#777777', sizePt: Math.max(7, t.fontSize - 2) };
  const footer: LetterheadItem[] = [
    ...(t.footerText ? [{ kind: 'text' as const, align: 'left' as const, runs: [{ text: t.footerText, ...small }] }] : []),
    { kind: 'text', align: 'right', runs: [{ text: '{page}', ...small }] },
  ];
  const header: LetterheadItem[] = t.headerText ? [{ kind: 'text', align: 'left', runs: [{ text: t.headerText, ...small }] }] : [];
  return { marginsMm: { top: m, right: m, bottom: m, left: m, header: m / 2, footer: m / 2 }, first: { header: logo.length ? logo : header, footer }, other: { header, footer } };
}

/** Margins and header / footer distances (mm): the letterhead's, or the template's margin all round. */
export function pageGeometry(t: ReportTemplate, letterhead?: Letterhead): PageGeometry {
  if (letterhead) return { ...letterhead.marginsMm, indent: letterhead.indentMm ?? 0 };
  const m = t.marginMm;
  return { top: m, right: m, bottom: m, left: m, header: m / 2, footer: m / 2, indent: 0 };
}

/** Width inside the margins (less a letterhead's text indent), in mm. */
export function usableWidthMm(t: ReportTemplate, orientation: Orientation = t.orientation, geo: PageGeometry = pageGeometry(t)): number {
  const [w, h] = pageSizeMm(t);
  return (orientation === 'landscape' ? h : w) - geo.left - geo.right - geo.indent;
}

/** Height inside the margins, less the header and footer, in mm. */
export function usableHeightMm(t: ReportTemplate, orientation: Orientation = t.orientation, geo: PageGeometry = pageGeometry(t)): number {
  const [w, h] = pageSizeMm(t);
  return (orientation === 'landscape' ? w : h) - geo.top - geo.bottom - 4;
}

/** Graph size in cm for a chart block on a page of the given orientation. */
export function chartSizeCm(blk: ChartBlock, t: ReportTemplate, orientation: Orientation, geo: PageGeometry = pageGeometry(t)): { widthCm: number; heightCm: number } {
  const width = usableWidthMm(t, orientation, geo);
  const size = blk.size ?? 'full';
  if (size === 'custom') {
    const w = Math.min(blk.widthCm * 10, width);
    return { widthCm: w / 10, heightCm: (blk.heightCm * 10 * (w / (blk.widthCm * 10))) / 10 };
  }
  const aspect = blk.aspect ?? (blk.widthCm > 0 ? blk.heightCm / blk.widthCm : 0.5);
  const w = size === 'half' ? (width - CHART_GAP_MM) / 2 : width;
  const h = Math.min(w * aspect, usableHeightMm(t, orientation, geo) * 0.62); // leave room for a heading and caption
  return { widthCm: w / 10, heightCm: h / 10 };
}

/** Default height of the title-page logo (mm). */
export const DEFAULT_LOGO_MM = 12;

/** Space between graphs placed side by side (mm). */
export const CHART_GAP_MM = 6;

/** Default height of signatures in a sign-off (mm), and the space between signatories side by side. */
export const DEFAULT_SIGNATURE_MM = 15;
export const SIGN_GAP_MM = 8;

function chunk<T>(list: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out.length ? out : [[]];
}

/** True when the period is exactly one calendar month. */
const wholeMonth = (start: string, end: string) => start.slice(0, 7) === end.slice(0, 7) && start.endsWith('-01') && addDays(end, 1).endsWith('-01');

/** Note on a result compared with the site's history. */
function historyNote(c: ReviewCell | null): string {
  if (!c) return '';
  if (c.record) return c.record === 'high' ? 'Highest on record' : 'Lowest on record';
  if (c.unusual) return c.unusual === 'high' ? 'Above usual range' : 'Below usual range';
  return '';
}

const flagFill = (f?: CellFlag) => flagFillColour(f);

/** What the shading means: red, amber for triggers and the first guideline set, then a colour per further set. */
function shadingNote(sets: GuidelineSet[]): string {
  const more = sets.slice(1).map((s, i) => `${SET_COLOURS[setColourIndex(i + 1)].name} = ${s.shortName} guideline exceeded; `).join('');
  return `Shading: red = consent limit exceeded; amber = trigger level${sets.length ? ` or ${sets[0].shortName} guideline` : ''} exceeded; ${more}purple = detection limit above the limit.`;
}

function listText(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * The sites a section shows: those chosen for it that are in the report – or, when none are chosen (or none of them
 * are in this report, e.g. a template saved from another project), `fallback` – less any it leaves out. `from` is
 * where chosen ones are found.
 */
export function sectionSites(blk: { siteIds: string[]; excludeSiteIds?: string[] }, fallback: Site[], from: Site[] = fallback): Site[] {
  const chosen = blk.siteIds.length ? from.filter((s) => blk.siteIds.includes(s.id)) : [];
  const sites = chosen.length ? chosen : fallback;
  const out = blk.excludeSiteIds?.length ? sites.filter((s) => !blk.excludeSiteIds!.includes(s.id)) : sites;
  return out.length === sites.length ? sites : out;
}

/** A section's parameters less those it leaves out. */
function leaveOut<T extends { id: string }>(params: T[], blk: { excludeParameterIds?: string[] }): T[] {
  return blk.excludeParameterIds?.length ? params.filter((p) => !blk.excludeParameterIds!.includes(p.id)) : params;
}

export function buildReport(opts: BuildOptions): ReportDoc {
  const { template: t, period, settings } = opts;
  const subset = !!opts.siteIds?.length && opts.siteIds.length < opts.bundle.sites.length;
  const b = subset ? limitToSites(opts.bundle, opts.siteIds!) : opts.bundle;
  const { start, end } = period;
  const project = b.project;
  const letterhead = letterheadFor(t, settings);
  const geo = pageGeometry(t, letterhead);
  const letter = t.style === 'letter';
  const look: ReportLook = {
    style: letter ? 'letter' : 'report',
    accent: t.accent,
    headingColor: (t.letterhead && letterhead?.headingColor) || t.accent,
    textColor: t.letterhead ? letterhead?.textColor : undefined,
    font: t.letterhead ? letterhead?.font : undefined,
    headingFont: t.letterhead ? letterhead?.headingFont : undefined,
    tableHeader: t.tableHeader ?? (letter ? 'grey' : 'accent'),
    highlight: t.highlightStyle ?? (letter ? 'text' : 'fill'),
  };
  // columns are sized for the widest of the PDF's font and the font the Word document names
  const fontK = Math.max(1, fontWidthFactor(look.font));
  const textWidthMm = (x: string, pt: number, bold = false) => textWidth(x, pt, bold) * fontK;
  const longestWordMm = (x: string, pt: number, bold = false) => longestWord(x, pt, bold) * fontK;
  const evals = evaluateAll(b, start, end);
  const flagCache = new Map<string, Map<string, CellFlag>>();
  const flagsFor = (setIds: string[]) => {
    const k = setIds.join(',');
    if (!flagCache.has(k)) flagCache.set(k, flagResults(b, evals, setIds, start, end));
    return flagCache.get(k)!;
  };
  const defaultSets = project.guidelineSetIds;
  const samplesInPeriod = b.samples.filter((s) => s.date.slice(0, 10) >= start && s.date.slice(0, 10) <= end);
  const sitesSampled = b.sites.filter((s) => samplesInPeriod.some((x) => x.siteId === s.id));
  const exceedCount = evals.reduce((n, e) => n + e.exceedances.length, 0);
  // "All data" runs from 1900 to 2199: say the dates the data actually covers
  const dates = b.samples.map((x) => x.date.slice(0, 10)).sort();
  const shownStart = start <= '1900-01-01' && dates.length ? dates[0] : start;
  const shownEnd = end >= '2199-12-31' && dates.length ? dates[dates.length - 1] : end;
  const ctx: Record<string, string> = {
    'project.name': project.name,
    'project.code': project.code ?? '',
    'project.client': project.client ?? '',
    'project.consents': project.consents ?? '',
    'project.regulator': project.regulator ?? '',
    'project.location': project.location ?? '',
    'project.description': project.description ?? '',
    'project.recipient': project.recipient ?? '',
    'project.salutation': project.salutation?.trim() || 'Dear Sir / Madam,',
    'period.start': formatDateLong(shownStart),
    'period.end': formatDateLong(shownEnd),
    'period.label': reportPeriodLabel(shownStart, shownEnd),
    'period.month': monthLabel(shownStart, shownEnd),
    today: formatDateLong(todayStr()),
    author: settings.author,
    company: settings.company,
    'count.samples': String(samplesInPeriod.length),
    'count.sites': String(sitesSampled.length),
    'count.exceedances': String(exceedCount),
    'count.rules': String(evals.length),
    'count.rulesExceeded': String(evals.filter((e) => e.status === 'exceeded').length),
  };
  // placeholders, then calculations ({{calc:median:no3-n:DS1}})
  const fill = (s: string | undefined) => fillCalcs(fillPlaceholders(s ?? '', ctx), b, start, end, flagsFor(defaultSets));
  const numbering = t.numbering !== false;
  const numberHeadings = t.numberHeadings ?? numbering;
  const hNum = [0, 0, 0];
  const nodes: DocNode[] = [];
  const commentary: CommentaryField[] = [];
  let orientation: Orientation = t.orientation;
  let width = usableWidthMm(t, orientation, geo);
  const big = Math.max(7, t.fontSize - 2.5); // font size for large data tables
  let heading = ''; // the heading the current block comes under (labels the commentary boxes)

  // Numbers for tables and figures: each kind of figure (Figure, Photo, Plate …) is counted on its own. A section
  // with a reference name records its first number, so text can say {{table:name}} or {{fig:name}} – resolved at
  // the end, so text can refer to a table or figure further on.
  const counters = new Map<string, number>();
  const nextNumber = (label: string) => {
    const k = label.toLowerCase();
    counters.set(k, (counters.get(k) ?? 0) + 1);
    return counters.get(k)!;
  };
  // what {{table:name}} becomes ("Table 3") and where its link goes (an anchor on the caption or heading)
  const refs = new Map<string, Ref>();
  // each caption's link target, in the order made (two tables can have the same caption)
  const captionAnchors = new Map<string, string[]>();
  const mark = (caption: string, anchor: string) => captionAnchors.set(caption, [...(captionAnchors.get(caption) ?? []), anchor]);
  const anchorOf = (caption: string) => captionAnchors.get(caption)?.shift();
  let anchorSeq = 0;
  const newAnchor = () => `ref${++anchorSeq}`;
  let current: ReportBlock | null = null;
  const capSep = letter ? '. ' : ': ';
  const numbered = (label: string, kind: 'table' | 'fig', s: string) => {
    const anchor = newAnchor();
    // under a heading of its own: not numbered; text referring to it gives the heading
    if (current?.captionStyle === 'heading') {
      if (current.ref && !refs.has(`${kind}:${current.ref}`)) refs.set(`${kind}:${current.ref}`, { text: s, anchor });
      mark(s, anchor);
      return s;
    }
    if (!numbering) {
      mark(s, anchor);
      return s;
    }
    const n = `${label} ${nextNumber(label)}`;
    if (current?.ref && !refs.has(`${kind}:${current.ref}`)) refs.set(`${kind}:${current.ref}`, { text: n, anchor });
    const caption = s ? `${n}${capSep}${s}` : n;
    mark(caption, anchor);
    return caption;
  };
  const autoNotes: Record<string, string[]> = {};
  /**
   * After a section: its captions get their anchors, or – for a section under headings – become headings; and your
   * own notes go where its usual ones were (under its last table when it had none).
   */
  const finishSection = (blk: ReportBlock, from: number) => {
    const tables = nodes.slice(from).filter((n): n is Extract<DocNode, { t: 'table' }> => n.t === 'table');
    if (tables.length) {
      autoNotes[blk.id] = [...new Set(tables.flatMap((n) => n.notes ?? []))];
      if (blk.tableNotes !== undefined) {
        // a line with fill-ins is tidied of what an empty one leaves; others are kept as written
        const own = blk.tableNotes
          .split('\n')
          .map((line) => (/\[|\{\{/.test(line) ? tidyCaption(fill(fillCaption(line, capBase))) : line.trim()))
          .filter(Boolean);
        const noted = tables.filter((n) => n.notes?.length);
        for (const n of tables) n.notes = undefined;
        if (own.length) for (const n of noted.length ? noted : [tables[tables.length - 1]]) n.notes = own;
      }
    }
    const asHeading = blk.captionStyle === 'heading';
    for (let i = from; i < nodes.length; i++) {
      const n = nodes[i];
      if ((n.t === 'table' || n.t === 'image') && n.caption) {
        const anchor = anchorOf(n.caption);
        if (asHeading) {
          nodes.splice(i, 0, { t: 'h', level: 3, text: n.caption, anchor });
          n.caption = undefined;
          i++;
        } else n.anchor ??= anchor;
      } else if (n.t === 'figures') n.items.forEach((it) => it.caption && (it.anchor ??= anchorOf(it.caption)));
      else if (n.t === 'gallery') {
        n.items.forEach((it) => it.caption && (it.anchor ??= anchorOf(it.caption)));
        if (n.caption) n.anchor ??= anchorOf(n.caption);
      }
    }
  };
  // A section's caption: its wording, with this table's fill-ins ([site name], [date] …) and the report's own
  const capBase: Record<string, string> = {
    period: `${formatDate(start)} – ${formatDate(end)}`,
    periodname: ctx['period.label'],
    project: project.name,
    projectcode: project.code ?? '',
    consent: project.consents ?? '',
  };
  const siteFill = (s: Site | undefined): Record<string, string> => (s ? { site: s.name ? `${s.code} – ${s.name}` : s.code, sitecode: s.code, sitename: s.name ?? '', sitetype: s.type ?? '' } : { site: '', sitecode: '', sitename: '', sitetype: '' });
  const capText = (blk: ReportBlock, values: Record<string, string> = {}) => tidyCaption(fill(fillCaption(captionOf(blk), { ...capBase, ...values })));
  const tableCaption = (s: string) => numbered('Table', 'table', s);
  const figCaption = (s: string) => numbered('Figure', 'fig', s);
  /** How an exceedance stands out in a table cell: shading, or red text. */
  const flagged = (f?: CellFlag): Partial<Cell> => {
    if (!f) return {};
    if (look.highlight === 'text') return { color: f.kind === 'check' ? TEXT_FLAGS.check : TEXT_FLAGS.exceed, bold: f.kind === 'limit' };
    return { fill: flagFill(f), bold: f.kind !== 'check' };
  };
  const paramList = (ids: string[], samples: Sample[]): Parameter[] => {
    if (ids.length) return ids.map((id) => b.paramMap.get(id)).filter((p): p is Parameter => !!p);
    const used = new Set<string>();
    for (const s of samples) for (const r of b.index.bySample.get(s.id) ?? []) used.add(r.parameterId);
    return b.params.filter((p) => used.has(p.id));
  };
  const setsFor = (ids: string[] | null) => (ids ?? defaultSets).map((id) => b.setMap.get(id)).filter((s): s is GuidelineSet => !!s);
  const resultOf = (s: Sample, pid: string): Result | undefined => (b.index.bySample.get(s.id) ?? []).find((r) => r.parameterId === pid);
  const guidelineText = (set: GuidelineSet, p: Parameter) => {
    const g = guidelineFor(set, p.id, p.unit);
    if (!g) return '';
    const v = g.min !== undefined && g.max !== undefined ? `${fmtNum(g.min)}–${fmtNum(g.max)}` : g.max !== undefined ? fmtNum(g.max) : `≥${fmtNum(g.min)}`;
    return g.hardness && project.hardnessAdjust ? `${v}*` : v;
  };
  // Consent limits / triggers as comparison columns in results tables: one per level (Limit, Trigger 1 …)
  const RULE_COLUMN_KINDS = new Set(['threshold', 'consecutive', 'statistic']);
  // limits taken from guideline sets filled in; a guideline rule naming its analytes as a limit for each
  const limitRules = expandRules(b.rules, b.setMap);
  const levelOrder = (l: string) => {
    const i = (RULE_LEVELS as readonly string[]).indexOf(l);
    return i < 0 ? RULE_LEVELS.length : i;
  };
  const tableRules = (mode: ResultsTableBlock['ruleColumns'], params: Parameter[], siteIds: string[]): Rule[] =>
    !mode || mode === 'none'
      ? []
      : limitRules.filter((r) => r.active && RULE_COLUMN_KINDS.has(r.kind) && params.some((p) => p.id === r.parameterId) && (mode === 'all' || /limit/i.test(r.level)) && (!r.siteIds.length || r.siteIds.some((id) => siteIds.includes(id))));
  const ruleLevels = (rules: Rule[]) => [...new Set(rules.map((r) => r.level))].sort((x, y) => levelOrder(x) - levelOrder(y) || x.localeCompare(y));
  /** The consent value(s) at one level for a parameter, in the parameter's unit, e.g. "100", "6–9", "2.4\n(median)". */
  const ruleText = (rules: Rule[], level: string, p: Parameter, siteIds: string[]) => {
    const out: string[] = [];
    for (const r of rules) {
      if (r.level !== level || r.parameterId !== p.id) continue;
      const inUnit = (x: number | undefined) => (x === undefined ? null : convert(x, r.unit || p.unit, p.unit));
      const [lo, hi, v] = [inUnit(r.min), inUnit(r.max), inUnit(r.value)];
      const num = r.operator === 'outside' ? (lo !== null && hi !== null ? `${fmtNum(lo)}–${fmtNum(hi)}` : '') : v === null ? '' : r.operator === '<' || r.operator === '<=' ? `≥${fmtNum(v)}` : fmtNum(v);
      if (!num) continue;
      const q: string[] = [];
      if (r.kind === 'statistic') q.push(statLabel(r.statistic ?? 'mean', r.percentile));
      if (r.kind === 'consecutive') q.push(`${r.consecutive ?? 2} in a row`);
      if (r.limitSetId && r.hardnessAdjust) q.push('HMTV');
      if (siteIds.length > 1 && r.siteIds.length) q.push(r.siteIds.filter((id) => siteIds.includes(id)).map((id) => b.siteMap.get(id)?.code ?? '').join(', '));
      out.push(q.length ? `${num}\n(${q.join(', ')})` : num); // the bracket on its own line keeps the column narrow
    }
    return [...new Set(out)].join('\n');
  };
  const linesWidthMm = (text: string, pt: number) => Math.max(0, ...text.split('\n').map((line) => textWidthMm(line, pt)));
  const resultNotes = (sets: GuidelineSet[], highlight: boolean, consentBrackets = false) => {
    const n = ['“<” indicates a result below the laboratory detection limit.'];
    if (consentBrackets) n.push('Consent values in brackets are assessed on a statistic or consecutive results, or apply only at the sites named. HMTV: hardness-modified for each sample (the value shown is at 30 mg/L hardness).');
    if (highlight && look.highlight === 'text')
      n.push(`Red = consent limit (bold) or trigger level${sets.length ? ` or ${sets.map((s) => s.shortName).join(' / ')} guideline` : ''} exceeded; purple = detection limit above the limit.`);
    else if (highlight) n.push(shadingNote(sets));
    if (project.hardnessAdjust && sets.some((s) => s.values.some((v) => v.hardness))) n.push('* Hardness-dependent guideline value shown at 30 mg/L CaCO3; results were compared with hardness-modified values (ANZECC 2000) where hardness was measured.');
    return n;
  };

  const blockHandlers: { [K in ReportBlock['type']]: (blk: Extract<ReportBlock, { type: K }>) => void } = {
    spacer: (blk) => nodes.push({ t: 'space', mm: Math.max(1, Math.min(200, blk.heightMm || 10)) }),
    calc: (blk) => {
      const flags = flagsFor(defaultSets);
      const rows = blk.rows.filter((r) => b.paramMap.has(r.parameterId)).map((r) => calcValue(b, r, start, end, flags));
      if (!rows.length) {
        nodes.push({ t: 'p', runs: [{ text: 'No calculations chosen.', italic: true }] });
        return;
      }
      if (blk.show === 'list') {
        nodes.push({ t: 'ul', items: rows.map((r) => [{ text: `${r.label}: ` }, { text: r.text, bold: true }]) });
        return;
      }
      const head: Cell[][] = [[{ text: 'Calculation' }, { text: 'Value', align: 'right' }, { text: 'Results', align: 'right' }]];
      const body: Cell[][] = rows.map((r) => [{ text: r.label }, { text: r.text, align: 'right', bold: true }, { text: String(r.n), align: 'right' }]);
      nodes.push({ t: 'table', caption: tableCaption(capText(blk)), head, body, widths: ['*', width * 0.22, width * 0.12], fontSize: t.fontSize - 1 });
    },
    programmeTable: (blk) => {
      const list = b.schedules.filter((x) => x.active);
      if (!list.length) {
        nodes.push({ t: 'p', runs: [{ text: 'No sampling schedules have been set up for this project.', italic: true }] });
        return;
      }
      const head: Cell[][] = [[{ text: 'Monitoring' }, { text: 'Sites' }, { text: 'Frequency' }, { text: 'Parameters' }, { text: 'Notes' }]];
      const body: Cell[][] = list.map((x) => [
        { text: x.name, bold: true },
        { text: x.siteIds.map((id) => b.siteMap.get(id)?.code ?? '').filter(Boolean).join(', ') },
        { text: frequencyLabel(x.every, x.unit) },
        { text: x.parameterIds.length ? x.parameterIds.map((id) => b.paramMap.get(id)?.name ?? id).join(', ') : 'As required' },
        { text: x.notes ?? '' },
      ]);
      nodes.push({ t: 'table', caption: tableCaption(capText(blk)), head, body, widths: [width * 0.2, width * 0.18, width * 0.14, '*', width * 0.2], fontSize: t.fontSize - 1 });
    },
    tarpTable: (blk) => {
      const ofLevel = (l: string) => blk.levels === 'all' || (blk.levels === 'limits' ? isLimitLevel(l) : !isLimitLevel(l));
      const order = (l: string) => {
        const i = (RULE_LEVELS as readonly string[]).indexOf(l);
        return i < 0 ? 99 : i;
      };
      const list = b.rules.filter((r) => r.active && ofLevel(r.level)).sort((x, y) => order(x.level) - order(y.level) || x.order - y.order);
      if (!list.length) {
        nodes.push({ t: 'p', runs: [{ text: 'No consent limits or trigger levels have been set up for this project.', italic: true }] });
        return;
      }
      const head: Cell[][] = [[{ text: 'Level' }, { text: 'Condition' }, { text: 'Exceeded when' }, { text: 'Response required' }]];
      const body: Cell[][] = list.map((r) => [
        { text: r.level, bold: true, ...(isLimitLevel(r.level) ? { color: TEXT_FLAGS.exceed } : {}) },
        { text: [r.condition, r.name].filter(Boolean).join(' – ') },
        { text: describeRule(r, b.paramMap, b.sites, b.setMap) },
        { text: r.action || 'Record and review at the next monitoring round.' },
      ]);
      nodes.push({ t: 'table', caption: tableCaption(capText(blk)), head, body, widths: [width * 0.12, width * 0.24, width * 0.3, '*'], fontSize: t.fontSize - 1 });
    },
    reportingTable: (blk) => {
      const list = b.obligations.filter((o) => o.active);
      if (!list.length) {
        nodes.push({ t: 'p', runs: [{ text: 'No reporting requirements have been set up for this project.', italic: true }] });
        return;
      }
      const every = (o: (typeof list)[number]) => (!o.every ? 'Once' : o.unit === 'year' ? (o.every === 1 ? 'Annually' : `Every ${o.every} years`) : frequencyLabel(o.every, 'month'));
      const head: Cell[][] = [[{ text: 'Report' }, { text: 'Frequency' }, { text: 'Next due' }, { text: 'Submitted to' }, { text: 'Notes' }]];
      const body: Cell[][] = list.map((o) => {
        const next = nextObligation(o);
        return [
          { text: o.name, bold: true },
          { text: every(o) },
          { text: next ? `${formatDate(next.dueDate)} (for ${formatDate(next.periodStart)} – ${formatDate(next.periodEnd)})` : '–' },
          { text: o.recipient ?? '' },
          { text: o.notes ?? '' },
        ];
      });
      nodes.push({ t: 'table', caption: tableCaption(capText(blk)), head, body, widths: [width * 0.22, width * 0.13, width * 0.25, width * 0.17, '*'], fontSize: t.fontSize - 1 });
    },
    title: (blk) => {
      const details: Array<[string, string]> = (
        [
          ['Client', project.client ?? ''],
          ['Project number', project.code ?? ''],
          ['Consent(s)', project.consents ?? ''],
          ['Regulator', project.regulator ?? ''],
          ['Location', project.location ?? ''],
          ['Reporting period', `${formatDateLong(shownStart)} – ${formatDateLong(shownEnd)}`],
          ['Sites covered', subset ? b.sites.map((s) => s.code).join(', ') : ''],
          ['Prepared by', fill(blk.preparedBy)],
          ['Reviewed by', fill(blk.reviewedBy)],
          ['Date', formatDateLong(todayStr())],
        ] as Array<[string, string]>
      ).filter(([, v]) => v.trim());
      const logo = t.logo ? { dataUrl: t.logo, ...logoSizeMm(t.logo, t.logoHeightMm ?? DEFAULT_LOGO_MM, Math.min(80, width * 0.5)) } : undefined;
      nodes.push({ t: 'title', title: fill(blk.title), subtitle: fill(blk.subtitle), details: blk.showDetails ? details : [], logo, pageBreakAfter: blk.pageBreakAfter });
    },
    heading: (blk) => {
      const lvl = blk.level;
      hNum[lvl - 1]++;
      for (let i = lvl; i < 3; i++) hNum[i] = 0;
      const number = numberHeadings && lvl <= 2 ? hNum.slice(0, lvl).join('.') : undefined;
      nodes.push({ t: 'h', level: lvl, text: fill(blk.text), number });
    },
    text: (blk) => {
      const text = blk.prompt && opts.promptTexts?.[blk.id] !== undefined ? opts.promptTexts[blk.id] : blk.text;
      nodes.push(...parseMarkup(fill(text)));
    },
    summary: () => nodes.push(...summaryNodes(b, evals, samplesInPeriod, sitesSampled, start, end)),
    complianceTable: (blk) => {
      const list = blk.ruleIds.length ? evals.filter((e) => blk.ruleIds.includes(e.rule.id)) : evals;
      if (!list.length) {
        nodes.push({ t: 'p', runs: [{ text: 'No consent limits or trigger levels have been defined for this project.', italic: true }] });
        return;
      }
      const head: Cell[][] = [[{ text: 'Condition' }, { text: 'Requirement' }, { text: 'Level' }, { text: 'Assessed', align: 'right' }, { text: 'Exceedances', align: 'right' }, { text: 'Outcome' }]];
      const body: Cell[][] = list.map((e) => [
        { text: e.rule.condition || e.rule.name },
        { text: e.rule.condition ? `${e.rule.name}: ${e.description}` : e.description },
        { text: e.rule.level },
        { text: String(e.assessed), align: 'right' },
        { text: String(e.exceedances.length), align: 'right', bold: e.exceedances.length > 0 },
        look.highlight === 'text'
          ? { text: STATUS_META[e.status].label, bold: e.status === 'exceeded', color: e.status === 'exceeded' ? TEXT_FLAGS.exceed : e.status === 'inconclusive' ? TEXT_FLAGS.check : undefined }
          : { text: STATUS_META[e.status].label, bold: true, fill: e.status === 'compliant' ? FILLS.ok : e.status === 'exceeded' ? FILLS.limit : e.status === 'inconclusive' ? FILLS.check : undefined },
      ]);
      // size the short columns to their content so headers never break mid-word
      const fs = t.fontSize - 1;
      const fit = (texts: string[], bold = false, lo = 10, hi = 40) => Math.min(hi, Math.max(lo, ...texts.map((x) => longestWordMm(x, fs, bold)))) + CELL_PAD_MM;
      const widths = [
        Math.min(34, Math.max(18, ...body.map((r) => textWidthMm(r[0].text, fs)))) + CELL_PAD_MM,
        '*' as const,
        Math.min(26, Math.max(12, ...['Level', ...list.map((e) => e.rule.level)].map((x) => textWidthMm(x, fs, true)))) + CELL_PAD_MM,
        fit(['Assessed'], true),
        fit(['Exceedances'], true),
        fit(['Outcome', ...list.map((e) => STATUS_META[e.status].label)], true),
      ];
      nodes.push({ t: 'table', caption: tableCaption(capText(blk)), head, body, widths, fontSize: fs });
    },
    exceedances: (blk) => {
      const list = blk.ruleIds.length ? evals.filter((e) => blk.ruleIds.includes(e.rule.id)) : evals;
      const notes = new Map(b.notes.map((n) => [n.id, n]));
      type Row = { date: string; site: string; param: string; value: string; limit: string; rule: string; note: string };
      const rows: Row[] = [];
      for (const ev of list) {
        for (const ex of ev.exceedances) {
          const n = notes.get(`${ev.rule.id}|${ex.key}`);
          rows.push({
            date: ex.date,
            site: b.siteMap.get(ex.siteId)?.code ?? '',
            param: b.paramMap.get(ex.parameterId)?.name ?? ex.parameterId,
            value: ex.value === null ? '' : `${ex.qualifier}${fmtNum(ex.value)} ${ex.unit === '%' ? '%' : unitLabel(ex.unit)}`,
            limit: ex.limitText || ev.description,
            rule: `${ev.rule.level}${ev.rule.condition ? ` – ${ev.rule.condition}` : ''}`,
            note: n ? `${n.status === 'notified' ? `Notified${n.notifiedOn ? ` ${formatDate(n.notifiedOn)}` : ''}` : n.status === 'closed' ? 'Closed' : 'Open'}${n.text ? `: ${n.text}` : ''}` : '',
          });
        }
      }
      if (blk.includeGuidelines) {
        const gFlags = flagResults(b, [], defaultSets, start, end);
        for (const s of samplesInPeriod) {
          for (const r of b.index.bySample.get(s.id) ?? []) {
            const f = gFlags.get(r.id);
            if (!f || f.kind !== 'guideline') continue;
            const p = b.paramMap.get(r.parameterId);
            rows.push({ date: r.date, site: b.siteMap.get(r.siteId)?.code ?? '', param: p?.name ?? r.parameterId, value: `${displayValue(r, p).text} ${p ? unitLabel(p.unit) : r.unit}`, limit: f.messages.join('; ').replace(/^Exceeds /, ''), rule: 'Guideline', note: '' });
          }
        }
      }
      rows.sort((a, c) => (a.date < c.date ? -1 : a.date > c.date ? 1 : 0));
      if (!rows.length) {
        nodes.push({ t: 'p', runs: [{ text: 'No exceedances of consent limits or trigger levels were recorded during the period.' }] });
        return;
      }
      const head: Cell[][] = [[{ text: 'Date' }, { text: 'Site' }, { text: 'Parameter' }, { text: 'Result', align: 'right' }, { text: 'Limit' }, { text: 'Rule' }, ...(blk.includeNotes ? [{ text: 'Response / notes' }] : [])]];
      const body: Cell[][] = rows.map((r) => [
        { text: formatDate(r.date) },
        { text: r.site },
        { text: r.param },
        { text: r.value, align: 'right', bold: true },
        { text: r.limit },
        { text: r.rule },
        ...(blk.includeNotes ? [{ text: r.note }] : []),
      ]);
      const fs = t.fontSize - 1;
      const dateW = textWidthMm('00 Mmm 0000', fs) + CELL_PAD_MM; // dates on one line
      const siteW = Math.min(20, Math.max(10, ...rows.map((r) => textWidthMm(r.site, fs)))) + CELL_PAD_MM;
      const resultW = Math.min(30, Math.max(14, ...rows.map((r) => textWidthMm(r.value, fs, true)))) + CELL_PAD_MM;
      const ruleW = Math.min(32, Math.max(16, ...rows.map((r) => textWidthMm(r.rule, fs)))) + CELL_PAD_MM;
      const widths: Array<number | '*'> = blk.includeNotes ? [dateW, siteW, width * 0.16, resultW, width * 0.17, ruleW, '*'] : [dateW, siteW, width * 0.2, resultW, '*', ruleW];
      nodes.push({ t: 'table', caption: tableCaption(capText(blk)), head, body, widths, fontSize: fs });
    },
    resultsTable: (blk) => {
      const sites = sectionSites(blk, b.sites);
      const only = blk.sampleIds ? new Set(blk.sampleIds) : null;
      const blockSamples = only ? samplesInPeriod.filter((x) => only.has(x.id)) : samplesInPeriod;
      const sets = setsFor(blk.guidelineSetIds);
      const flags = blk.highlight ? flagsFor(sets.map((s) => s.id)) : new Map<string, CellFlag>();
      const groups: Array<{ site?: Site; samples: Sample[] }> = blk.splitBySite
        ? sites.map((s) => ({ site: s, samples: blockSamples.filter((x) => x.siteId === s.id) })).filter((g) => g.samples.length)
        : [{ samples: blockSamples.filter((x) => sites.some((s) => s.id === x.siteId)) }];
      if (!groups.length || groups.every((g) => !g.samples.length)) {
        nodes.push({ t: 'p', runs: [{ text: 'No results for the selected sites in this period.', italic: true }] });
        return;
      }
      const siteCode = (id: string) => b.siteMap.get(id)?.code ?? '';
      const pt = big;
      const PAD = CELL_PAD_MM;
      const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
      const valueCell = (s: Sample, p: Parameter): Cell => {
        const r = resultOf(s, p.id);
        if (!r) return { text: '–', align: 'center', color: '#999999' };
        return { text: displayValue(r, p).text, align: 'right', ...flagged(flags.get(r.id)) };
      };
      const dateHead = (s: Sample) => formatDate(s.date, { format: 'D MMM YYYY' });
      for (const g of groups) {
        const params = leaveOut(paramList(blk.parameterIds, g.samples), blk);
        if (!params.length) continue;
        const tableSiteIds = new Set(g.samples.map((s) => s.siteId));
        const wording = capText(blk, g.site ? siteFill(g.site) : { sites: listText(sites.filter((s) => tableSiteIds.has(s.id)).map((s) => s.code)) });
        const label = (i: number, n: number) => wording + (n > 1 ? ` (${i + 1} of ${n})` : '');
        // consent values for the sites in this table
        const tableSites = [...new Set(g.samples.map((s) => s.siteId))];
        const rules = tableRules(blk.ruleColumns, params, tableSites);
        const levels = ruleLevels(rules).filter((l) => params.some((p) => ruleText(rules, l, p, tableSites)));
        const consent = (l: string, p: Parameter) => ruleText(rules, l, p, tableSites);
        const bracketed = levels.some((l) => params.some((p) => consent(l, p).includes('(')));
        if (blk.layout === 'parametersAsRows') {
          // Fixed columns sized to their content, then as many sample columns as fit.
          let paramW = clamp(Math.max(...params.map((p) => textWidthMm(p.name, pt))) + PAD, 26, 44);
          const unitW = clamp(Math.max(...params.map((p) => textWidthMm(unitLabel(p.unit), pt))) + PAD, 9, 20);
          const setW = sets.map((s) => clamp(Math.max(longestWordMm(s.shortName, pt, true), ...params.map((p) => textWidthMm(guidelineText(s, p), pt))) + PAD, 11, 22));
          const levelW = levels.map((l) => clamp(Math.max(longestWordMm(l, pt, true), ...params.map((p) => linesWidthMm(consent(l, p), pt))) + PAD, 11, 26));
          const compareW = [...levelW, ...setW]; // consent columns first, then the guideline columns
          const sampleNeed = Math.max(
            11,
            longestWordMm(dateHead(g.samples[0]), pt, true) + PAD,
            ...g.samples.map((s) => textWidthMm(siteCode(s.siteId), pt, true) + PAD),
            ...g.samples.flatMap((s) => params.map((p) => textWidthMm(valueCell(s, p).text, pt, true) + PAD)),
          );
          let fixed = paramW + unitW + compareW.reduce((a, x) => a + x, 0);
          if (width - fixed < sampleNeed * 2) {
            paramW = 26;
            fixed = paramW + unitW + compareW.reduce((a, x) => a + x, 0);
          }
          const maxPer = Math.max(1, Math.floor((width - fixed) / sampleNeed));
          // spread samples evenly over the tables (e.g. 6 + 6 rather than 8 + 4)
          const per = Math.ceil(g.samples.length / Math.ceil(g.samples.length / maxPer));
          const parts = chunk(g.samples, per);
          parts.forEach((part, i) => {
            const sampleW = (width - fixed) / part.length > sampleNeed * 1.6 ? sampleNeed * 1.6 : (width - fixed) / part.length;
            const compareHeads = [...levels, ...sets.map((s) => s.shortName)].map((text) => ({ text, align: 'center' as const }));
            const head: Cell[][] = blk.splitBySite
              ? [[{ text: 'Parameter' }, { text: 'Unit' }, ...compareHeads, ...part.map((s) => ({ text: dateHead(s), align: 'center' as const }))]]
              : [
                  [{ text: 'Parameter' }, { text: 'Unit' }, ...compareHeads, ...part.map((s) => ({ text: siteCode(s.siteId), align: 'center' as const }))],
                  [{ text: '' }, { text: '' }, ...compareHeads.map(() => ({ text: '' })), ...part.map((s) => ({ text: dateHead(s), align: 'center' as const }))],
                ];
            const body: Cell[][] = params.map((p) => [
              { text: p.name },
              { text: unitLabel(p.unit) },
              ...levels.map((l) => ({ text: consent(l, p), align: 'center' as const, fill: FILLS.guidelineRow })),
              ...sets.map((s) => ({ text: guidelineText(s, p), align: 'center' as const, fill: FILLS.guidelineRow })),
              ...part.map((s) => valueCell(s, p)),
            ]);
            nodes.push({
              t: 'table',
              caption: tableCaption(label(i, parts.length)),
              head,
              body,
              widths: [paramW, unitW, ...compareW, ...part.map(() => sampleW)],
              fontSize: pt,
              notes: i === parts.length - 1 ? resultNotes(sets, blk.highlight, bracketed) : undefined,
            });
          });
        } else {
          // Samples down the rows: date + site, then as many parameter columns as fit.
          const dateW = textWidthMm('00/00/0000', pt) + PAD;
          const siteW = clamp(Math.max(...g.samples.map((s) => textWidthMm(siteCode(s.siteId), pt))) + PAD, 9, 20);
          const avail = width - dateW - siteW;
          const need = params.map((p) =>
            Math.max(
              11,
              longestWordMm(p.short ?? p.name, pt, true) + PAD,
              textWidthMm(unitLabel(p.unit), pt) + PAD,
              ...levels.map((l) => linesWidthMm(consent(l, p), pt) + PAD),
              ...sets.map((s) => textWidthMm(guidelineText(s, p), pt) + PAD),
              ...g.samples.map((s) => textWidthMm(valueCell(s, p).text, pt, true) + PAD),
            ),
          );
          const pack = (maxCount: number) => {
            const out: number[][] = [];
            let cur: number[] = [];
            let used = 0;
            need.forEach((w, k) => {
              if (cur.length && (used + w > avail || cur.length >= maxCount)) {
                out.push(cur);
                cur = [];
                used = 0;
              }
              cur.push(k);
              used += w;
            });
            if (cur.length) out.push(cur);
            return out;
          };
          // as few tables as possible, with the parameters spread evenly between them
          const greedy = pack(Infinity);
          const balanced = greedy.length > 1 ? pack(Math.ceil(params.length / greedy.length)) : greedy;
          const parts = balanced.length === greedy.length ? balanced : greedy;
          parts.forEach((idx, i) => {
            const part = idx.map((k) => params[k]);
            const sum = idx.reduce((a, k) => a + need[k], 0);
            const extra = Math.max(0, Math.min(avail - sum, idx.length * 8)) / idx.length;
            const head: Cell[][] = [
              [{ text: 'Date' }, { text: 'Site' }, ...part.map((p) => ({ text: p.short ?? p.name, align: 'center' as const }))],
              [{ text: '' }, { text: '' }, ...part.map((p) => ({ text: unitLabel(p.unit), align: 'center' as const }))],
            ];
            const body: Cell[][] = [];
            for (const l of levels) {
              if (!part.some((p) => consent(l, p))) continue;
              body.push([{ text: l, colSpan: 2, italic: true, fill: FILLS.guidelineRow }, { text: '' }, ...part.map((p) => ({ text: consent(l, p), align: 'center' as const, italic: true, fill: FILLS.guidelineRow }))]);
            }
            for (const s of sets) {
              if (!part.some((p) => guidelineFor(s, p.id, p.unit))) continue;
              body.push([{ text: s.shortName, colSpan: 2, italic: true, fill: FILLS.guidelineRow }, { text: '' }, ...part.map((p) => ({ text: guidelineText(s, p), align: 'center' as const, italic: true, fill: FILLS.guidelineRow }))]);
            }
            const guidelineRows = body.length;
            for (const s of g.samples) body.push([{ text: formatDate(s.date, { format: 'DD/MM/YYYY' }) }, { text: siteCode(s.siteId) }, ...part.map((p) => valueCell(s, p))]);
            nodes.push({
              t: 'table',
              caption: tableCaption(label(i, parts.length)),
              head,
              body,
              widths: [dateW, siteW, ...idx.map((k) => need[k] + extra)],
              fontSize: pt,
              keepRows: guidelineRows + 2,
              notes: i === parts.length - 1 ? resultNotes(sets, blk.highlight, bracketed) : undefined,
            });
          });
        }
      }
    },
    statsTable: (blk) => {
      const flags = flagsFor(defaultSets);
      // [] = every parameter with data; less any left out (an id that matches nothing when all are)
      let statsParams = blk.parameterIds;
      if (blk.excludeParameterIds?.length) {
        const from = blk.parameterIds.length ? blk.parameterIds : b.params.filter((p) => b.index.byParam.has(p.id)).map((p) => p.id);
        statsParams = from.filter((id) => !blk.excludeParameterIds!.includes(id));
        if (!statsParams.length) statsParams = ['(none)'];
      }
      const rows = statsTable(b, sectionSites(blk, b.sites).map((s) => s.id), statsParams, start, end, flags);
      if (!rows.length) {
        nodes.push({ t: 'p', runs: [{ text: 'No results in this period.', italic: true }] });
        return;
      }
      const cols: Array<{ key: (typeof blk.stats)[number]; label: string; get: (r: (typeof rows)[number]) => string }> = [
        { key: 'n', label: 'n', get: (r) => String(r.n) },
        { key: 'nd', label: 'n < DL', get: (r) => String(r.nd) },
        { key: 'min', label: 'Min', get: (r) => r.minText },
        { key: 'median', label: 'Median', get: (r) => fmtNum(r.median) },
        { key: 'mean', label: 'Mean', get: (r) => fmtNum(r.mean) },
        { key: 'p95', label: '95th %ile', get: (r) => fmtNum(r.p95) },
        { key: 'max', label: 'Max', get: (r) => r.maxText },
        { key: 'exceed', label: 'Exceed.', get: (r) => String(r.exceed) },
      ];
      const shown = cols.filter((c) => blk.stats.includes(c.key));
      const head: Cell[][] = [[{ text: 'Parameter' }, { text: 'Unit' }, { text: 'Site' }, ...shown.map((c) => ({ text: c.label, align: 'right' as const }))]];
      let lastParam = '';
      const body: Cell[][] = rows.map((r) => {
        const first = r.param.id !== lastParam;
        lastParam = r.param.id;
        return [
          { text: first ? r.param.name : '', bold: first },
          { text: first ? unitLabel(r.param.unit) : '' },
          { text: r.site.code },
          ...shown.map((c) => ({ text: c.get(r), align: 'right' as const, ...(c.key === 'exceed' && r.exceed > 0 ? (look.highlight === 'text' ? { color: TEXT_FLAGS.exceed } : { fill: FILLS.guideline }) : {}) })),
        ];
      });
      nodes.push({
        t: 'table',
        caption: tableCaption(capText(blk)),
        head,
        body,
        widths: (() => {
          const pW = Math.min(44, Math.max(26, ...rows.map((r) => textWidthMm(r.param.name, big, true))) + CELL_PAD_MM);
          const uW = Math.min(20, Math.max(9, ...rows.map((r) => textWidthMm(unitLabel(r.param.unit), big))) + CELL_PAD_MM);
          const sW = Math.min(20, Math.max(9, ...rows.map((r) => textWidthMm(r.site.code, big))) + CELL_PAD_MM);
          const rest = (width - pW - uW - sW) / shown.length;
          return [pW, uW, sW, ...shown.map(() => rest)];
        })(),
        fontSize: big,
        notes: [`Statistics treat non-detects as ${project.ndHandling === 'half' ? 'half the detection limit' : project.ndHandling === 'zero' ? 'zero' : 'the detection limit'}. Percentiles: ${project.percentileMethod === 'hazen' ? 'Hazen method' : 'Excel PERCENTILE.INC'}.${blk.stats.includes('exceed') ? ' Exceed. = results exceeding consent limits, triggers or the default guideline values.' : ''}`],
      });
    },
    chart: (blk) => {
      const pids = (blk.parameterIds.length ? blk.parameterIds : keyParameters(b, 6)).filter((id) => !blk.excludeParameterIds?.includes(id));
      const cStart = blk.range === 'all' ? undefined : blk.range === 'years' ? addDays(addMonths(end, -12 * (blk.years ?? 3)), 1) : start;
      const sets = blk.showGuidelines ? setsFor(blk.guidelineSetIds) : [];
      const size = chartSizeCm(blk, t, orientation, geo);
      const figures: Array<{ dataUrl: string; widthCm: number; heightCm: number; caption?: string }> = [];
      for (const pid of pids) {
        const p = b.paramMap.get(pid);
        if (!p) continue;
        // all of the project's sites for the colours, so a site keeps its colour when others are left out
        const chartSites = sectionSites(blk, b.sites).map((s) => s.id);
        if (!chartSites.length) continue;
        const spec = buildChartSpec({ index: b.index, param: p, sites: opts.bundle.sites, siteIds: chartSites, start: cStart, end, guidelineSets: sets, rules: limitRules, setMap: b.setMap, showRules: blk.showRules, log: blk.logScale });
        if (blk.markPeriod && blk.range !== 'period') spec.band = { from: toUtcMs(start), to: toUtcMs(addDays(end, 1)) };
        if (!spec.series.length) continue;
        const caption = figCaption(capText(blk, { parameter: p.name, unit: unitLabel(p.unit), sites: listText(spec.series.map((s) => s.name)), dates: `${formatDate(cStart ?? spec.series[0].points[0].date)} – ${formatDate(end)}` }));
        const option = chartOption({ ...spec, subtitle: undefined, title: `${p.name} (${unitLabel(p.unit)})` }, { forExport: true, width: Math.round((size.widthCm / 2.54) * 96) });
        const dataUrl = opts.renderChart ? opts.renderChart(option, size.widthCm, size.heightCm) : '';
        figures.push({ dataUrl, ...size, caption });
      }
      if (blk.size === 'half') chunk(figures, 2).forEach((items) => items.length && nodes.push({ t: 'figures', items }));
      else figures.forEach((f) => nodes.push({ t: 'image', ...f }));
    },
    roundReview: (blk) => {
      const sites = sectionSites(blk, b.sites);
      const sets = setsFor(blk.guidelineSetIds);
      const flags = blk.highlight ? flagsFor(sets.map((s) => s.id)) : new Map<string, CellFlag>();
      const since = blk.historyYears ? addMonths(start, -12 * blk.historyYears) : undefined;
      const show = new Set(blk.compare);
      const pt = big;
      const PAD = CELL_PAD_MM;
      const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
      const linesW = (s: string, bold = false) => Math.max(0, ...s.split('\n').map((line) => textWidthMm(line, pt, bold)));
      const made: Array<Extract<DocNode, { t: 'table' }>> = [];
      for (const site of sites) {
        // the site's latest sample in the period
        const sample = samplesInPeriod
          .filter((s) => s.siteId === site.id && (b.index.bySample.get(s.id)?.length ?? 0) > 0)
          .reduce<Sample | undefined>((best, s) => (!best || s.date > best.date ? s : best), undefined);
        if (!sample) continue;
        const params = leaveOut(paramList(blk.parameterIds, [sample]), blk);
        if (!params.length) continue;
        const rules = tableRules(blk.ruleColumns, params, [site.id]);
        const levels = ruleLevels(rules).filter((l) => params.some((p) => ruleText(rules, l, p, [site.id])));
        const head: Cell[] = [{ text: 'Parameter' }, { text: 'Unit' }, ...[...levels, ...sets.map((s) => s.shortName)].map((text) => ({ text, align: 'center' as const })), { text: 'Result', align: 'center' }];
        if (show.has('previous')) head.push({ text: 'Previous', align: 'center' });
        if (show.has('change')) head.push({ text: 'Change', align: 'center' });
        if (show.has('median')) head.push({ text: 'Earlier median', align: 'center' });
        if (show.has('range')) head.push({ text: 'Usual range', align: 'center' });
        if (show.has('note')) head.push({ text: 'Note' });
        const body: Cell[][] = params.map((p) => {
          const c = reviewCell(b, sample, p, since);
          const r = c?.result;
          const f = r ? flags.get(r.id) : undefined;
          const row: Cell[] = [
            { text: p.name },
            { text: unitLabel(p.unit) },
            ...levels.map((l) => ({ text: ruleText(rules, l, p, [site.id]), align: 'center' as const, fill: FILLS.guidelineRow })),
            ...sets.map((s) => ({ text: guidelineText(s, p), align: 'center' as const, fill: FILLS.guidelineRow })),
            r ? { text: displayValue(r, p).text, align: 'right', ...flagged(f) } : { text: '–', align: 'center', color: '#999999' },
          ];
          if (show.has('previous')) row.push({ text: c?.previous ? `${c.previous.text}\n${formatDate(c.previous.date, { format: 'D MMM YYYY' })}` : '–', align: 'right' });
          if (show.has('change')) {
            const ch = c?.change;
            row.push({ text: ch === undefined ? '' : `${ch >= 0 ? '+' : '−'}${fmtNum(Math.abs(ch) >= 10 ? Math.round(Math.abs(ch)) : Math.round(Math.abs(ch) * 10) / 10)}%`, align: 'right' });
          }
          if (show.has('median')) row.push({ text: c?.median === undefined ? '' : fmtNum(c.median, p.decimals), align: 'right' });
          if (show.has('range')) row.push({ text: c?.usual ? `${fmtNum(c.usual.lo, p.decimals)}–${fmtNum(c.usual.hi, p.decimals)}` : '', align: 'center' });
          if (show.has('note')) {
            const note = historyNote(c);
            row.push({ text: note, bold: !!(c?.record || c?.unusual) });
          }
          return row;
        });
        // column widths: sized to their content; the note column takes what is left
        const widths: Array<number | '*'> = head.map((h, k) => {
          if (show.has('note') && k === head.length - 1) return '*';
          const content = Math.max(...body.map((row) => linesW(row[k].text)));
          const need = Math.max(Math.max(...h.text.split(' ').map((w) => textWidthMm(w, pt, true))), content) + PAD;
          return k === 0 ? clamp(need, 26, 44) : k === 1 ? clamp(need, 9, 20) : clamp(need, 11, 26);
        });
        const table: Extract<DocNode, { t: 'table' }> = {
          t: 'table',
          caption: tableCaption(capText(blk, { ...siteFill(site), date: formatDate(sample.date, { format: 'D MMM YYYY' }) })),
          head: [head],
          body,
          widths,
          fontSize: pt,
        };
        made.push(table);
        nodes.push(table);
      }
      if (!made.length) {
        nodes.push({ t: 'p', runs: [{ text: 'No samples were collected in this period.', italic: true }] });
        return;
      }
      const notes = resultNotes(sets, blk.highlight, made.some((x) => x.body.some((row) => row.some((c) => c.fill === FILLS.guidelineRow && c.text.includes('(')))));
      const history = since ? `since ${formatDate(since, { format: 'D MMM YYYY' })}` : 'on record';
      if (show.has('previous') || show.has('change')) notes.push('Previous: the last result at the site before this one. Change: from the previous result (not given when either is below the detection limit).');
      if (show.has('median') || show.has('range') || show.has('note'))
        notes.push(`Earlier median and usual range (5th–95th percentile) use the site's results ${history} before this sample; the usual range needs at least 6 earlier results. Notes flag results outside the usual range or the highest / lowest on record.`);
      made[made.length - 1].notes = notes;
    },
    siteTable: (blk) => {
      if (!b.sites.length) return;
      const head: Cell[][] = [[{ text: 'Site' }, { text: 'Description' }, { text: 'Type' }, { text: 'Role' }, { text: 'Easting', align: 'right' }, { text: 'Northing', align: 'right' }]];
      const body: Cell[][] = b.sites.filter((s) => s.active).map((s: Site) => [
        { text: s.code, bold: true },
        { text: s.name ?? '' },
        { text: s.type },
        { text: s.role || '' },
        { text: s.easting ? String(s.easting) : '', align: 'right' },
        { text: s.northing ? String(s.northing) : '', align: 'right' },
      ]);
      nodes.push({ t: 'table', caption: tableCaption(capText(blk)), head, body, widths: [width * 0.1, '*', width * 0.14, width * 0.18, width * 0.12, width * 0.12], fontSize: t.fontSize - 1, notes: b.sites.some((s) => s.easting) ? ['Coordinates are NZTM2000.'] : undefined });
    },
    samplingTable: (blk) => {
      const required = requiredRounds(b, start, end);
      const head: Cell[][] = [[{ text: 'Site' }, { text: 'Samples', align: 'right' }, ...(required.size ? [{ text: 'Required', align: 'right' as const }, { text: 'Missed', align: 'right' as const }] : []), { text: 'Dates sampled' }]];
      const body: Cell[][] = b.sites
        .map((s) => {
          const ss = samplesInPeriod.filter((x) => x.siteId === s.id);
          const req = required.get(s.id);
          if (!ss.length && !req) return null;
          return [
            { text: s.code, bold: true },
            { text: String(ss.length), align: 'right' as const },
            ...(required.size ? [{ text: req ? String(req.required) : '–', align: 'right' as const }, { text: req ? String(req.missed) : '–', align: 'right' as const, ...(req && req.missed ? (look.highlight === 'text' ? { color: TEXT_FLAGS.exceed } : { fill: FILLS.guideline }) : {}) }] : []),
            { text: ss.map((x) => formatDate(x.date, { format: 'DD/MM/YYYY' })).join(', ') },
          ] as Cell[];
        })
        .filter((r): r is Cell[] => !!r);
      if (!body.length) {
        nodes.push({ t: 'p', runs: [{ text: 'No samples were collected during the period.', italic: true }] });
        return;
      }
      nodes.push({ t: 'table', caption: tableCaption(capText(blk)), head, body, widths: required.size ? [width * 0.1, width * 0.1, width * 0.1, width * 0.1, '*'] : [width * 0.12, width * 0.12, '*'], fontSize: t.fontSize - 1 });
    },
    letter: (blk) => {
      const lines = (x?: string) =>
        fill(x)
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean)
          .map(inline);
      const date = lines(blk.date);
      if (date.length) nodes.push({ t: 'lines', lines: date });
      const to = lines(blk.to);
      if (to.length) nodes.push({ t: 'lines', lines: to });
      else if (opts.preview) nodes.push({ t: 'note', text: 'Who is this letter to? Add their name and address under “Letter” on the Reports tab.' });
      const subject = fill(blk.subject).trim();
      if (subject) nodes.push({ t: 'p', runs: inline(subject).map((r) => ({ ...r, bold: true })) });
      const ref = lines(blk.reference);
      if (ref.length) nodes.push({ t: 'lines', lines: ref });
      const greeting = fill(blk.salutation).trim();
      if (greeting) nodes.push({ t: 'p', runs: inline(greeting) });
    },
    roundTable: (blk) => {
      const chosen = sectionSites(blk, b.sites.filter((s) => s.active), b.sites);
      const withData = (s: Sample) => (b.index.bySample.get(s.id)?.length ?? 0) > 0;
      // the earlier rounds: the last few, or the rounds chosen (each site's sample on the day, or the nearest within two weeks)
      const wanted = [...new Set((blk.previousDates ?? []).map((d) => d.slice(0, 10)))].sort().reverse();
      const day = (s: Sample) => s.date.slice(0, 10);
      const plan = chosen
        .map((site) => {
          const sample = samplesInPeriod.filter((s) => s.siteId === site.id && withData(s)).reduce<Sample | undefined>((best, s) => (!best || s.date > best.date ? s : best), undefined);
          const before = sample ? b.samples.filter((s) => s.siteId === site.id && s.date < sample.date && withData(s)).sort((x, y) => (x.date < y.date ? 1 : -1)) : [];
          let earlier: Array<{ date: string; sample?: Sample }>;
          if (wanted.length) {
            const used = new Set<string>();
            earlier = wanted
              .filter((d) => sample && d < day(sample))
              .map((d) => {
                const gap = (s: Sample) => Math.abs(daysBetween(day(s), d));
                const near = before.filter((s) => !used.has(s.id) && gap(s) <= 14).sort((x, y) => gap(x) - gap(y))[0];
                if (near) used.add(near.id);
                return { date: near ? day(near) : d, sample: near };
              });
          } else earlier = before.slice(0, Math.max(0, Math.min(24, blk.previous))).map((s) => ({ date: day(s), sample: s }));
          return { site, sample, earlier };
        })
        .filter((x) => x.sample || b.samples.some((s) => s.siteId === x.site.id)); // a site never sampled is left out
      if (!plan.some((x) => x.sample)) {
        nodes.push({ t: 'p', runs: [{ text: 'No samples were collected in this period.', italic: true }] });
        return;
      }
      // consent exceedances of this round's and the earlier rounds' results (the period's own evaluation covers only the period)
      const from = plan.flatMap((x) => x.earlier.flatMap((e) => (e.sample ? [day(e.sample)] : []))).sort()[0] ?? start;
      const wide = from < start ? evaluateAll(b, from, end) : evals;
      const ruleFlags = flagResults(b, wide, [], from < start ? from : start, end);
      const broken = new Map<string, Array<{ level: string; limit: string }>>();
      const limitOf = (rule: Rule, limitText: string) =>
        rule.kind === 'change' ? `${limitText} above ${b.siteMap.get(rule.referenceSiteId ?? '')?.code ?? 'the reference site'}`.trim() : rule.kind === 'consecutive' ? `${limitText}, ${rule.consecutive ?? 2} results in a row` : limitText;
      for (const ev of wide) for (const ex of ev.exceedances) if (ex.resultId) broken.set(ex.resultId, [...(broken.get(ex.resultId) ?? []), { level: ev.rule.level, limit: limitOf(ev.rule, ex.limitText) }]);
      const pt = big;
      const PAD = CELL_PAD_MM;
      const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
      const linesW = (x: string, bold = false) => Math.max(0, ...x.split('\n').map((line) => textWidthMm(line, pt, bold)));
      const monthYear = (d: string) => `${MONTH_SHORT[+d.slice(5, 7) - 1]}-${d.slice(2, 4)}`;
      const title = fill(blk.title);
      const asHeading = blk.siteLabel === 'heading' || blk.captionStyle === 'heading';
      const group = heading || title || 'Results';
      let lastTable: Extract<DocNode, { t: 'table' }> | undefined;
      let anyFlag = false;
      const summaryLine = (key: string, auto: string, label: string): DocNode | null => {
        if (!blk.summaries) return null;
        commentary.push({ key, label, group, auto });
        const text = fill(opts.promptTexts?.[key] ?? auto).trim();
        if (!text) return null;
        return { t: 'p', runs: /^summary\b/i.test(text) ? inline(text) : [{ text: 'Summary: ', bold: true }, ...inline(text)] };
      };
      for (const { site, sample, earlier } of plan) {
        const name = site.name ? `${site.code} – ${site.name}` : site.code;
        const key = `${blk.id}:${site.id}`;
        const label = capText(blk, { ...siteFill(site), date: sample ? formatDate(sample.date, { format: 'D MMM YYYY' }) : '' });
        if (asHeading) {
          const anchor = newAnchor();
          if (blk.ref && !refs.has(`table:${blk.ref}`)) refs.set(`table:${blk.ref}`, { text: label, anchor });
          nodes.push({ t: 'h', level: 3, text: label, anchor });
        }
        if (!sample) {
          const auto = 'Not sampled in this round.';
          if (blk.summaries) {
            commentary.push({ key, label: `${site.code} – not sampled`, group, auto });
            const text = fill(opts.promptTexts?.[key] ?? auto).trim();
            if (text) nodes.push({ t: 'p', runs: asHeading ? inline(text) : [{ text: `${name}: `, bold: true }, ...inline(text)] });
          } else nodes.push({ t: 'p', runs: asHeading ? [{ text: auto }] : [{ text: `${name}: `, bold: true }, { text: auto }] });
          continue;
        }
        const params = leaveOut(paramList(blk.parameterIds, [sample]), blk);
        if (!params.length) continue;
        const rules = blk.ruleColumns === 'none' ? [] : tableRules(blk.ruleColumns, params, [site.id]).filter((r) => !r.siteIds.length || r.siteIds.includes(site.id));
        const levels = ruleLevels(rules).filter((l) => params.some((p) => ruleText(rules, l, p, [site.id])));
        const siteRules = limitRules.filter((r) => r.active && RULE_COLUMN_KINDS.has(r.kind) && (!r.siteIds.length || r.siteIds.includes(site.id)));
        const rounds = [day(sample), ...earlier.map((e) => e.date)];
        let labels = rounds.map(monthYear);
        if (new Set(labels).size < labels.length) labels = rounds.map((d) => formatDate(d, { format: 'D MMM YYYY' }));
        const head: Cell[] = [
          { text: 'Parameter' },
          { text: 'Unit' },
          ...labels.map((text) => ({ text, align: 'center' as const })),
          ...levels.map((text) => ({ text, align: 'center' as const })),
          ...(blk.comment ? [{ text: 'Comment' }] : []),
        ];
        type Fact = { p: Parameter; trend: string; status: 'exceed' | 'ok' | 'check' | 'none'; value: string; broken: Array<{ level: string; limit: string }>; again: boolean; change?: number; record: boolean };
        const facts: Fact[] = [];
        const body: Cell[][] = params.map((p) => {
          const cur = resultOf(sample, p.id);
          const prev = earlier.map((e) => (e.sample ? resultOf(e.sample, p.id) : undefined));
          const row: Cell[] = [{ text: p.name }, { text: unitLabel(p.unit) }];
          for (const r of [cur, ...prev]) {
            const f = r ? ruleFlags.get(r.id) : undefined;
            if (f) anyFlag = true;
            row.push(r ? { text: displayValue(r, p).text, align: 'right', ...flagged(f) } : { text: '–', align: 'center', color: '#999999' });
          }
          for (const l of levels) row.push({ text: ruleText(rules, l, p, [site.id]), align: 'center', fill: FILLS.guidelineRow });
          const f = cur ? ruleFlags.get(cur.id) : undefined;
          const status: Fact['status'] = !cur ? 'none' : f?.kind === 'limit' || f?.kind === 'guideline' ? 'exceed' : f?.kind === 'check' ? 'check' : siteRules.some((r) => r.parameterId === p.id) ? 'ok' : 'none';
          const trend = cur ? trendOf(cur, prev[0], p) : '';
          // the change since the last earlier result shown (and when, if not the round before); still a compliance
          // comment when there is none
          const at = prev.findIndex(Boolean);
          const since = cur && at > 0 ? trendOf(cur, prev[at], p) : '';
          const change = !cur || !earlier.length ? '' : at < 0 ? 'No earlier result' : at === 0 ? trend : since && `${since} since ${labels[at + 1]}`;
          const comment = [change, status === 'exceed' ? 'Exceedance' : status === 'check' ? 'Detection limit above the trigger' : status === 'ok' ? 'Compliant' : ''].filter(Boolean).join(' – ');
          if (blk.comment) row.push({ text: comment, ...(status === 'exceed' || status === 'check' ? flagged(f) : {}) });
          if (cur) {
            const c = reviewCell(b, sample, p);
            facts.push({ p, trend, status, value: `${displayValue(cur, p).text} ${unitLabel(p.unit)}`.trim(), broken: broken.get(cur.id) ?? [], again: !!(prev[0] && ruleFlags.get(prev[0].id)?.kind !== undefined && ruleFlags.get(prev[0].id)?.kind !== 'check'), change: c?.change, record: c?.record === 'high' });
          }
          return row;
        });
        const widths: Array<number | '*'> = head.map((h, k) => {
          if (blk.comment && k === head.length - 1) return '*';
          const content = Math.max(...body.map((row) => linesW(row[k].text)));
          const need = Math.max(Math.max(...h.text.split(' ').map((w) => textWidthMm(w, pt, true))), content) + PAD + 0.8;
          return k === 0 ? clamp(need, 26, 46) : k === 1 ? clamp(need, 9, 20) : clamp(need, 11, 26);
        });
        // many rounds: the columns and the text shrink together to fit the page (the comment keeps room to read)
        const room = width - (blk.comment ? 30 : 0);
        const used = widths.reduce<number>((a, w) => a + (typeof w === 'number' ? w : 0), 0);
        const k = used > room ? Math.max(0.6, room / used) : 1;
        const table: Extract<DocNode, { t: 'table' }> = {
          t: 'table',
          caption: asHeading ? undefined : tableCaption(label),
          head: [head],
          body,
          widths: widths.map((w) => (typeof w === 'number' ? w * k : w)),
          fontSize: Math.max(5, pt * k),
        };
        nodes.push(table);
        lastTable = table;
        const line = summaryLine(key, siteSummary(facts), `${site.code} – summary`);
        if (line) nodes.push(line);
      }
      if (lastTable) {
        const notes = ['“<” indicates a result below the laboratory detection limit.'];
        if (anyFlag) notes.push(look.highlight === 'text' ? 'Red = a consent limit (bold) or trigger level exceeded.' : 'Shading: red = consent limit exceeded; amber = trigger level exceeded; purple = detection limit above the limit.');
        if (blk.comment) notes.push("Comment: the change since the previous result shown, and whether the result complies with the site's consent limits and trigger levels.");
        lastTable.notes = notes;
      }
    },
    triggerTable: (blk) => {
      const sites = sectionSites(blk, b.sites.filter((s) => s.active), b.sites);
      const ofLevel = (l: string) => blk.levels === 'all' || (blk.levels === 'limits' ? isLimitLevel(l) : !isLimitLevel(l));
      const rules = limitRules.filter((r) => r.active && RULE_COLUMN_KINDS.has(r.kind) && !!r.parameterId && b.paramMap.has(r.parameterId) && ofLevel(r.level) && (!r.siteIds.length || r.siteIds.some((id) => sites.some((s) => s.id === id))));
      const what = blk.levels === 'limits' ? 'Consent limits' : blk.levels === 'triggers' ? 'Trigger levels' : 'Consent limits and trigger levels';
      if (!rules.length) {
        nodes.push({ t: 'p', runs: [{ text: `No ${what.toLowerCase()} have been set up for this project.`, italic: true }] });
        return;
      }
      const params = b.params.filter((p) => rules.some((r) => r.parameterId === p.id));
      const levels = ruleLevels(rules);
      const showLevel = levels.length > 1;
      const perSite = rules.some((r) => r.siteIds.length);
      const cols = perSite ? sites.filter((s) => rules.some((r) => !r.siteIds.length || r.siteIds.includes(s.id))) : [];
      const at = (site: Site) => rules.filter((r) => !r.siteIds.length || r.siteIds.includes(site.id));
      const pt = big;
      const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
      const paramW = clamp(Math.max(...params.map((p) => textWidthMm(p.name, pt))) + CELL_PAD_MM, 26, 46);
      const unitW = clamp(Math.max(...params.map((p) => textWidthMm(unitLabel(p.unit), pt))) + CELL_PAD_MM, 9, 20);
      const levelW = showLevel ? clamp(Math.max(...levels.map((l) => textWidthMm(l, pt, true))) + CELL_PAD_MM, 12, 24) : 0;
      // the sites go across; as many to a table as fit
      const perTable = perSite ? Math.max(1, Math.floor((width - paramW - unitW - levelW) / 15)) : 1;
      const parts = perSite ? chunk(cols, Math.ceil(cols.length / Math.ceil(cols.length / perTable))) : [[]];
      parts.forEach((part, i) => {
        const head: Cell[] = [{ text: 'Parameter' }, { text: 'Unit' }, ...(showLevel ? [{ text: 'Level' }] : []), ...(perSite ? part.map((s) => ({ text: s.code, align: 'center' as const })) : [{ text: levels[0], align: 'center' as const }])];
        const body: Cell[][] = [];
        for (const p of params)
          for (const l of levels) {
            const values = perSite ? part.map((s) => ruleText(at(s), l, p, [s.id])) : [ruleText(rules, l, p, [])];
            if (values.every((v) => !v)) continue;
            body.push([{ text: p.name }, { text: unitLabel(p.unit) }, ...(showLevel ? [{ text: l }] : []), ...values.map((v) => (v ? { text: v, align: 'center' as const } : { text: '–', align: 'center' as const, color: '#999999' }))]);
          }
        const rest = (width - paramW - unitW - levelW) / Math.max(1, head.length - (showLevel ? 3 : 2));
        const bracketed = body.some((row) => row.some((c) => c.text.includes('(')));
        nodes.push({
          t: 'table',
          caption: tableCaption(`${capText(blk)}${parts.length > 1 ? ` (${i + 1} of ${parts.length})` : ''}`),
          head: [head],
          body,
          widths: [paramW, unitW, ...(showLevel ? [levelW] : []), ...head.slice(showLevel ? 3 : 2).map(() => Math.min(rest, 40))],
          fontSize: pt,
          notes: i === parts.length - 1 && bracketed ? [`Values in brackets are assessed on a statistic or consecutive results.${body.some((row) => row.some((c) => c.text.includes('HMTV'))) ? ' HMTV: hardness-modified for each sample (the value shown is at 30 mg/L hardness).' : ''}`] : undefined,
        });
      });
    },
    figures: (blk) => {
      const images = [...blk.images, ...(opts.figures?.[blk.id] ?? [])].filter((im) => im.src);
      if (!images.length) {
        if (opts.preview) nodes.push({ t: 'note', text: 'Figures: no images yet – add them on the Reports tab under “Figures for this report”.' });
        return;
      }
      const perRow = Math.max(1, Math.min(4, Math.round(blk.perRow) || 1));
      const gapMm = 5;
      const colWidthMm = (width - gapMm * (perRow - 1)) / perRow;
      const maxH = usableHeightMm(t, orientation, geo) * (perRow === 1 ? 0.7 : 0.45); // room for captions, and a row stays on one page
      const label = blk.label.trim() || 'Figure';
      const asHeading = blk.captionStyle === 'heading';
      const numberedAs = asHeading ? 'none' : blk.numbering;
      const group = numberedAs === 'group';
      const groupNo = group && numbering ? `${label} ${nextNumber(label)}` : '';
      const groupAnchor = newAnchor();
      const items = images.map((im, i) => {
        const px = imageSize(im.src);
        const aspect = px ? px.height / px.width : 0.75;
        let w = colWidthMm;
        let h = w * aspect;
        if (blk.heightMm > 0 && blk.heightMm < h) [h, w] = [blk.heightMm, blk.heightMm / aspect];
        if (h > maxH) [h, w] = [maxH, maxH / aspect];
        const text = fill(im.caption).trim();
        let caption: string | undefined;
        if (group) {
          const sub = `(${String.fromCharCode(97 + (i % 26))})`;
          caption = text ? `${sub} ${text}` : sub;
          if (im.ref) refs.set(`fig:${im.ref}`, { text: groupNo ? `${groupNo}${sub}` : sub, anchor: groupAnchor });
        } else if (numberedAs === 'each' && numbering) {
          const n = `${label} ${nextNumber(label)}`;
          const anchor = newAnchor();
          caption = text ? `${n}${capSep}${text}` : n;
          mark(caption, anchor);
          if (im.ref) refs.set(`fig:${im.ref}`, { text: n, anchor });
          if (blk.ref && !refs.has(`fig:${blk.ref}`)) refs.set(`fig:${blk.ref}`, { text: n, anchor });
        } else caption = text || undefined;
        return { dataUrl: im.src, widthMm: w, heightMm: h, caption };
      });
      const groupText = fill(blk.caption).trim();
      if (group && groupNo && blk.ref) refs.set(`fig:${blk.ref}`, { text: groupNo, anchor: groupAnchor });
      // under a heading of its own: the section's caption is the heading, above the pictures
      if (asHeading && groupText) {
        nodes.push({ t: 'h', level: 3, text: groupText, anchor: groupAnchor });
        if (blk.ref && !refs.has(`fig:${blk.ref}`)) refs.set(`fig:${blk.ref}`, { text: groupText, anchor: groupAnchor });
      }
      nodes.push({ t: 'gallery', perRow, colWidthMm, gapMm, border: !!blk.border, items, caption: group ? [groupNo, groupText].filter(Boolean).join(groupNo && groupText ? capSep : '') || undefined : undefined, anchor: group ? groupAnchor : undefined });
    },
    signatures: (blk) => {
      const items = blk.signatories
        .map((s) => {
          const image = s.self ? settings.signatureImage : s.image;
          const lines = fill(s.self ? (settings.signatureDetails ?? settings.company) : s.details)
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean)
            .map(inline);
          const date = fill(s.date).replace(/^\s*date\b\s*[:–-]?\s*/i, '').trim();
          return { role: fill(s.role).trim(), name: (s.self ? settings.author : fill(s.name)).trim(), lines, date: date || undefined, image };
        })
        .filter((s) => s.name || s.lines.length || s.image); // nobody named yet
      const closing = fill(blk.closing).trim();
      if (!items.length) {
        if (closing) nodes.push({ t: 'p', runs: inline(closing) });
        return;
      }
      const cols = Math.min(3, items.length);
      const colWidthMm = Math.min(80, (width - SIGN_GAP_MM * (cols - 1)) / cols);
      const imageHeightMm = Math.min(40, Math.max(8, blk.imageHeightMm ?? DEFAULT_SIGNATURE_MM)); // also while a size is being typed
      nodes.push({
        t: 'signatures',
        closing: closing ? inline(closing) : undefined,
        cols,
        colWidthMm,
        imageHeightMm,
        items: items.map(({ image, ...s }) => ({ ...s, image: image ? { dataUrl: image, ...logoSizeMm(image, imageHeightMm, colWidthMm - 2) } : undefined })),
      });
    },
    pageBreak: () => {}, // see below
  };

  const pages = pageOrientations(t.blocks, t.orientation);
  t.blocks.forEach((blk, i) => {
    // a new page where the orientation changes (a page break block always starts one)
    if (blk.type === 'pageBreak' || pages[i] !== orientation) nodes.push({ t: 'pagebreak', orientation: pages[i] });
    orientation = pages[i];
    width = usableWidthMm(t, orientation, geo);
    if (blk.type === 'heading') heading = fill(blk.text);
    current = blk;
    const h = blockHandlers[blk.type] as (x: ReportBlock) => void;
    const from = nodes.length;
    h(blk);
    finishSection(blk, from);
  });
  resolveRefs(nodes, refs);
  // placeholders in the letterhead's lines, e.g. {{company}} in a footer ({page} is left for the page number)
  const shownLetterhead: Letterhead | undefined = letterhead && {
    ...letterhead,
    ...Object.fromEntries(
      (['first', 'other'] as const).map((pg) => [
        pg,
        Object.fromEntries((['header', 'footer'] as const).map((part) => [part, letterhead[pg][part].map((it) => (it.kind === 'text' ? { ...it, runs: it.runs.map((r) => ({ ...r, text: fill(r.text) })) } : it))])),
      ]),
    ),
  };

  return {
    template: t,
    nodes,
    page: geo,
    look,
    letterhead: shownLetterhead,
    commentary,
    autoNotes,
    header: fill(t.headerText),
    footer: fill(t.footerText),
    title: `${project.name} – ${t.name}`,
    author: settings.author || settings.company,
    fileName: `${project.name} - ${t.name} - ${wholeMonth(shownStart, shownEnd) ? monthLabel(shownStart, shownEnd) : `${formatDate(shownStart, { format: 'D MMM YYYY' })} to ${formatDate(shownEnd, { format: 'D MMM YYYY' })}`}`.replace(/[\\/:*?"<>|]+/g, '-'),
  };
}

/**
 * How a result compares with the previous round's: Increase, Decrease or Stable (also when both are below detection) –
 * nothing when there is no previous result, so the comment just says whether it complies.
 */
export function trendOf(r: Result, prev: Result | undefined, p: Parameter): string {
  if (!prev) return '';
  const [a, z] = [displayValue(r, p), displayValue(prev, p)];
  if (a.text === z.text || (r.qualifier === '<' && prev.qualifier === '<')) return 'Stable';
  if (a.value === null || z.value === null) return '';
  return a.value > z.value ? 'Increase' : a.value < z.value ? 'Decrease' : 'Stable';
}

/** A first draft of the summary under a site's table, from its results this round. */
export function siteSummary(facts: Array<{ p: Parameter; trend: string; status: 'exceed' | 'ok' | 'check' | 'none'; value: string; broken: Array<{ level: string; limit: string }>; again: boolean; change?: number; record: boolean }>): string {
  const out: string[] = [];
  const ex = facts.filter((f) => f.status === 'exceed');
  for (const f of ex) {
    const first = f.broken[0];
    const what = first ? `the ${first.level.toLowerCase()}${first.limit ? ` (${first.limit})` : ''}` : 'its trigger';
    out.push(`${f.p.name} (${f.value}) ${f.again ? 'continues to exceed' : 'exceeded'} ${what}.`);
  }
  const ruled = facts.filter((f) => f.status !== 'none');
  if (ruled.length) out.push(ex.length ? (ruled.length > ex.length ? 'All other parameters remain compliant.' : '') : 'All parameters remain compliant.');
  const up = facts.filter((f) => f.status !== 'exceed' && f.trend === 'Increase' && (f.change ?? 0) >= 25);
  if (up.length) out.push(`${listText(up.slice(0, 4).map((f) => f.p.name))}${up.length > 4 ? ' and others' : ''} increased since the previous round${ruled.some((f) => up.includes(f)) ? ', but remain below their trigger levels' : ''}.`);
  const highs = facts.filter((f) => f.record);
  if (highs.length) out.push(`${listText(highs.slice(0, 3).map((f) => f.p.name))} ${highs.length === 1 ? 'was the highest result' : 'were the highest results'} on record at this site.`);
  return out.filter(Boolean).join(' ');
}

interface Ref {
  text: string;
  anchor?: string;
}

/**
 * "{{fig:site-plan}}" → "Figure 2" and "{{table:triggers}}" → "Table 1" everywhere in the report ("Figure ?" when no
 * such name); in text, a link to the table or figure.
 */
function resolveRefs(nodes: DocNode[], refs: Map<string, Ref>): void {
  const re = /\{\{\s*(fig|table):([\w.-]+)\s*\}\}/g;
  const missing = (kind: string) => (kind === 'fig' ? 'Figure ?' : 'Table ?');
  const fix = (text: string) => (text.includes('{{') ? text.replace(re, (_, kind: string, name: string) => refs.get(`${kind}:${name}`)?.text ?? missing(kind)) : text);
  // a run with references becomes runs: the text between them, and each reference as a link
  const fixRuns = (rs: Run[]): Run[] =>
    rs.flatMap((r) => {
      if (!r.text.includes('{{')) return [r];
      const out: Run[] = [];
      let at = 0;
      for (const m of r.text.matchAll(re)) {
        if (m.index! > at) out.push({ ...r, text: r.text.slice(at, m.index) });
        const ref = refs.get(`${m[1]}:${m[2]}`);
        out.push({ ...r, text: ref?.text ?? missing(m[1]), link: ref?.anchor });
        at = m.index! + m[0].length;
      }
      if (at < r.text.length) out.push({ ...r, text: r.text.slice(at) });
      return out;
    });
  for (const n of nodes) {
    switch (n.t) {
      case 'p':
        n.runs = fixRuns(n.runs);
        break;
      case 'ul':
        n.items = n.items.map(fixRuns);
        break;
      case 'lines':
        n.lines = n.lines.map(fixRuns);
        break;
      case 'h':
        n.text = fix(n.text);
        break;
      case 'note':
        n.text = fix(n.text);
        break;
      case 'table':
        if (n.caption) n.caption = fix(n.caption);
        n.notes = n.notes?.map(fix);
        break;
      case 'image':
        if (n.caption) n.caption = fix(n.caption);
        break;
      case 'gallery':
        if (n.caption) n.caption = fix(n.caption);
        n.items.forEach((it) => it.caption && (it.caption = fix(it.caption)));
        break;
    }
  }
}

/** Scheduled sampling rounds per site that fall wholly inside the period. */
function requiredRounds(b: ProjectBundle, start: string, end: string): Map<string, { required: number; missed: number }> {
  const out = new Map<string, { required: number; missed: number }>();
  for (const sch of b.schedules) {
    if (!sch.active) continue;
    for (let k = 0; k < 5000; k++) {
      const ps = scheduleStep(sch.startDate, k, sch.every, sch.unit);
      if (ps > end || (sch.endDate && ps > sch.endDate)) break;
      const pe = addDays(scheduleStep(sch.startDate, k + 1, sch.every, sch.unit), -1);
      if (ps < start || pe > end) continue;
      for (const sid of sch.siteIds) {
        const done = b.samples.some((s) => s.siteId === sid && s.date.slice(0, 10) >= ps && s.date.slice(0, 10) <= pe);
        const cur = out.get(sid) ?? { required: 0, missed: 0 };
        cur.required++;
        if (!done) cur.missed++;
        out.set(sid, cur);
      }
    }
  }
  return out;
}

function summaryNodes(
  b: ProjectBundle,
  evals: RuleEvaluation[],
  samples: Sample[],
  sites: Site[],
  start: string,
  end: string,
): DocNode[] {
  const out: DocNode[] = [];
  const labs = Array.from(new Set(samples.map((s) => s.labName).filter(Boolean))) as string[];
  if (!samples.length) {
    out.push({ t: 'p', runs: [{ text: `No samples were collected during the period ${formatDateLong(start)} to ${formatDateLong(end)}.` }] });
    return out;
  }
  out.push({
    t: 'p',
    runs: [
      {
        text: `During the period ${formatDateLong(start)} to ${formatDateLong(end)}, ${samples.length} sample${samples.length === 1 ? ' was' : 's were'} collected from ${sites.length} monitoring site${sites.length === 1 ? '' : 's'} (${listText(sites.map((s) => s.code))})${labs.length ? ` and analysed by ${listText(labs)}` : ''}.`,
      },
    ],
  });
  // sampling programme
  const req = requiredRounds(b, start, end);
  if (req.size) {
    const total = Array.from(req.values()).reduce((n, r) => n + r.required, 0);
    const missed = Array.from(req.values()).reduce((n, r) => n + r.missed, 0);
    out.push({
      t: 'p',
      runs: [
        {
          text: missed
            ? `${total - missed} of the ${total} sampling rounds required by the monitoring programme (${b.schedules.filter((s) => s.active).map((s) => `${frequencyLabel(s.every, s.unit).toLowerCase()} ${s.name.toLowerCase().includes('sampl') ? '' : 'sampling '}`.trim()).join('; ')}) were completed; ${missed} ${missed === 1 ? 'was' : 'were'} missed.`
            : `All ${total} sampling rounds required by the monitoring programme were completed.`,
        },
      ],
    });
  }
  // compliance
  if (evals.length) {
    const exceeded = evals.filter((e) => e.status === 'exceeded');
    if (!exceeded.length) out.push({ t: 'p', runs: [{ text: `All ${evals.length} consent limits and trigger levels assessed were complied with during the period.`, bold: false }] });
    else {
      out.push({ t: 'p', runs: [{ text: `${evals.length - exceeded.length} of the ${evals.length} consent limits and trigger levels assessed were complied with. Exceedances were recorded for:` }] });
      out.push({
        t: 'ul',
        items: exceeded.map((e) => [
          { text: `${e.rule.name}${e.rule.condition ? ` (${e.rule.condition})` : ''}`, bold: true },
          { text: ` – ${e.summary.charAt(0).toLowerCase()}${e.summary.slice(1)}.` },
        ]),
      });
    }
    const inc = evals.reduce((n, e) => n + e.inconclusive.length, 0);
    if (inc) out.push({ t: 'p', runs: [{ text: `${inc} result${inc === 1 ? '' : 's'} could not be assessed because the laboratory detection limit was above the relevant limit.` }] });
  }
  // guidelines
  const sets = b.project.guidelineSetIds.map((id) => b.setMap.get(id)).filter((s): s is GuidelineSet => !!s);
  if (sets.length) {
    const only = flagResults(b, [], sets.map((s) => s.id), start, end); // guideline comparisons only
    const comparable = new Map<string, Result>();
    for (const s of samples) for (const r of b.index.bySample.get(s.id) ?? []) if (sets.some((set) => set.values.some((v) => v.parameterId === r.parameterId))) comparable.set(r.id, r);
    const exceed = Array.from(only.entries()).filter(([id, f]) => comparable.has(id) && f.kind === 'guideline');
    const names = listText(sets.map((s) => s.name));
    if (comparable.size) {
      if (!exceed.length) out.push({ t: 'p', runs: [{ text: `None of the ${comparable.size} results with a guideline value exceeded the ${names}.` }] });
      else {
        const byParam = new Map<string, number>();
        for (const [id] of exceed) {
          const r = comparable.get(id)!;
          byParam.set(r.parameterId, (byParam.get(r.parameterId) ?? 0) + 1);
        }
        const parts = Array.from(byParam.entries()).map(([pid, n]) => `${b.paramMap.get(pid)?.name ?? pid} (${n})`);
        out.push({ t: 'p', runs: [{ text: `${exceed.length} of ${comparable.size} results exceeded the ${names}: ${listText(parts)}.` }] });
      }
    }
  }
  out.push(...comparisonNodes(b, evals, samples, start, end));
  return out;
}

/** The period of the same length just before: the year before a year, the quarter before a quarter … */
export function previousPeriod(start: string, end: string): { start: string; end: string } {
  if (start.endsWith('-01') && end === endOfMonth(end)) {
    const months = (Number(end.slice(0, 4)) - Number(start.slice(0, 4))) * 12 + Number(end.slice(5, 7)) - Number(start.slice(5, 7)) + 1;
    return { start: addMonths(start, -months), end: addDays(start, -1) };
  }
  const days = daysBetween(start, end) + 1;
  return { start: addDays(start, -days), end: addDays(start, -1) };
}

/** How the period compares with the one before: samples, consent rules exceeded, and the key parameters' medians. */
function comparisonNodes(b: ProjectBundle, evals: RuleEvaluation[], samples: Sample[], start: string, end: string): DocNode[] {
  const prev = previousPeriod(start, end);
  const before = b.samples.filter((s) => s.date.slice(0, 10) >= prev.start && s.date.slice(0, 10) <= prev.end);
  if (!before.length || !samples.length) return [];
  const sentences: string[] = [];
  const then = `the previous period (${formatDate(prev.start)} – ${formatDate(prev.end)})`;
  let first = `In ${then}, ${before.length} sample${before.length === 1 ? ' was' : 's were'} collected`;
  if (evals.length) {
    const prevEvals = evaluateAll(b, prev.start, prev.end);
    const now = evals.filter((e) => e.status === 'exceeded').length;
    const was = prevEvals.filter((e) => e.status === 'exceeded').length;
    first += was ? ` and ${was} consent limit${was === 1 ? ' or trigger level was' : 's or trigger levels were'} exceeded` : ' and no consent limits or trigger levels were exceeded';
    first += now === was ? (now ? ' – the same number as this period' : ', as in this period') : now > was ? ` (${now} this period)` : ` (${now || 'none'} this period)`;
  }
  sentences.push(`${first}.`);
  // the key parameters at the sites their rules are for (all sites when they have none)
  const phrases: string[] = [];
  for (const pid of keyParameters(b, 5)) {
    const p = b.paramMap.get(pid);
    if (!p) continue;
    const ruleSites = [...new Set(b.rules.filter((r) => r.active && ruleParamIds(r, b.setMap).includes(pid)).flatMap((r) => r.siteIds))];
    const codes = ruleSites.map((id) => b.siteMap.get(id)?.code).filter((c): c is string => !!c);
    const nowV = calcValue(b, { stat: 'median', parameterId: pid, sites: codes }, start, end);
    const wasV = calcValue(b, { stat: 'median', parameterId: pid, sites: codes }, prev.start, prev.end);
    if (nowV.value === null || wasV.value === null) continue;
    const ratio = wasV.value === 0 ? (nowV.value === 0 ? 1 : Infinity) : nowV.value / wasV.value;
    const word = ratio >= 1.2 ? 'higher' : ratio <= 0.8 ? 'lower' : 'similar';
    phrases.push(`the median ${p.name}${codes.length ? ` at ${listText(codes)}` : ''} ${word} (${nowV.text}, against ${wasV.text})`);
  }
  if (phrases.length) sentences.push(`Compared with then, ${listText(phrases)}.`);
  return [{ t: 'p', runs: [{ text: sentences.join(' ') }] }];
}

/** The automatic summary as text to edit: sentences and bullets, for a report's commentary. */
export function summaryText(bundle: ProjectBundle, start: string, end: string, siteIds?: string[]): string {
  const b = siteIds?.length && siteIds.length < bundle.sites.length ? limitToSites(bundle, siteIds) : bundle;
  const evals = evaluateAll(b, start, end);
  const samples = b.samples.filter((s) => s.date.slice(0, 10) >= start && s.date.slice(0, 10) <= end);
  const sites = b.sites.filter((s) => samples.some((x) => x.siteId === s.id));
  const runs = (rs: Run[]) => rs.map((r) => (r.bold ? `**${r.text.trim()}**${r.text.endsWith(' ') ? ' ' : ''}` : r.text)).join('');
  return summaryNodes(b, evals, samples, sites, start, end)
    .map((n) => (n.t === 'p' ? runs(n.runs) : n.t === 'ul' ? n.items.map((it) => `- ${runs(it)}`).join('\n') : ''))
    .filter(Boolean)
    .join('\n\n');
}
