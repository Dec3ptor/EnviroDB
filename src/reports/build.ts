import type { ChartBlock, GuidelineSet, Parameter, ReportBlock, ReportTemplate, Result, ResultsTableBlock, Rule, Sample, Settings, Site } from '../db/types';
import { RULE_LEVELS } from '../db/types';
import type { ProjectBundle } from '../lib/analysis';
import { displayValue, evaluateAll, flagResults, keyParameters, statsTable, type CellFlag } from '../lib/analysis';
import type { RuleEvaluation } from '../lib/compliance';
import { STATUS_META } from '../lib/compliance';
import { addDays, addMonths, formatDate, formatDateLong, todayStr } from '../lib/dates';
import { guidelineFor } from '../lib/guidelines';
import { scheduleStep, frequencyLabel } from '../lib/schedule';
import { convert, unitLabel } from '../lib/units';
import { statLabel } from '../lib/stats';
import { fmtNum } from '../lib/values';
import { logoSizeMm } from '../lib/image';
import { buildChartSpec, chartOption } from '../charts/timeSeries';
import { FILLS, fillPlaceholders, parseMarkup, type Cell, type DocNode, type ReportDoc } from './model';
import { CELL_PAD_MM, longestWordMm, textWidthMm } from './measure';

export interface BuildOptions {
  bundle: ProjectBundle;
  template: ReportTemplate;
  period: { start: string; end: string; label: string };
  settings: Settings;
  promptTexts?: Record<string, string>;
  /** Render graphs (needs a browser). When false a placeholder is inserted. */
  renderChart?: (option: ReturnType<typeof chartOption>, widthCm: number, heightCm: number) => string;
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

/** Width inside the margins, in mm. */
export function usableWidthMm(t: ReportTemplate, orientation: Orientation = t.orientation): number {
  const [w, h] = PAGE_MM[t.pageSize] ?? PAGE_MM.A4;
  return (orientation === 'landscape' ? h : w) - 2 * t.marginMm;
}

/** Height inside the margins, less the header and footer, in mm. */
export function usableHeightMm(t: ReportTemplate, orientation: Orientation = t.orientation): number {
  const [w, h] = PAGE_MM[t.pageSize] ?? PAGE_MM.A4;
  return (orientation === 'landscape' ? w : h) - 2 * t.marginMm - 4;
}

/** Graph size in cm for a chart block on a page of the given orientation. */
export function chartSizeCm(blk: ChartBlock, t: ReportTemplate, orientation: Orientation): { widthCm: number; heightCm: number } {
  const width = usableWidthMm(t, orientation);
  const size = blk.size ?? 'full';
  if (size === 'custom') {
    const w = Math.min(blk.widthCm * 10, width);
    return { widthCm: w / 10, heightCm: (blk.heightCm * 10 * (w / (blk.widthCm * 10))) / 10 };
  }
  const aspect = blk.aspect ?? (blk.widthCm > 0 ? blk.heightCm / blk.widthCm : 0.5);
  const w = size === 'half' ? (width - CHART_GAP_MM) / 2 : width;
  const h = Math.min(w * aspect, usableHeightMm(t, orientation) * 0.62); // leave room for a heading and caption
  return { widthCm: w / 10, heightCm: h / 10 };
}

/** Default height of the title-page logo (mm). */
export const DEFAULT_LOGO_MM = 12;

/** Space between graphs placed side by side (mm). */
export const CHART_GAP_MM = 6;

function chunk<T>(list: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out.length ? out : [[]];
}

const flagFill = (f?: CellFlag) => (f ? (f.kind === 'limit' ? FILLS.limit : f.kind === 'guideline' ? FILLS.guideline : FILLS.check) : undefined);

function listText(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export function buildReport(opts: BuildOptions): ReportDoc {
  const { bundle: b, template: t, period, settings } = opts;
  const { start, end } = period;
  const project = b.project;
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
  const ctx: Record<string, string> = {
    'project.name': project.name,
    'project.code': project.code ?? '',
    'project.client': project.client ?? '',
    'project.consents': project.consents ?? '',
    'project.regulator': project.regulator ?? '',
    'project.location': project.location ?? '',
    'project.description': project.description ?? '',
    'period.start': formatDateLong(start),
    'period.end': formatDateLong(end),
    'period.label': period.label,
    today: formatDateLong(todayStr()),
    author: settings.author,
    company: settings.company,
    'count.samples': String(samplesInPeriod.length),
    'count.sites': String(sitesSampled.length),
    'count.exceedances': String(exceedCount),
    'count.rules': String(evals.length),
    'count.rulesExceeded': String(evals.filter((e) => e.status === 'exceeded').length),
  };
  const fill = (s: string | undefined) => fillPlaceholders(s ?? '', ctx);
  const numbering = t.numbering !== false;
  const hNum = [0, 0, 0];
  let tableNo = 0;
  let figNo = 0;
  const nodes: DocNode[] = [];
  let orientation: Orientation = t.orientation;
  let width = usableWidthMm(t, orientation);
  const big = Math.max(7, t.fontSize - 2.5); // font size for large data tables

  const tableCaption = (s: string) => (numbering ? `Table ${++tableNo}: ${s}` : s);
  const figCaption = (s: string) => (numbering ? `Figure ${++figNo}: ${s}` : s);
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
  const levelOrder = (l: string) => {
    const i = (RULE_LEVELS as readonly string[]).indexOf(l);
    return i < 0 ? RULE_LEVELS.length : i;
  };
  const tableRules = (mode: ResultsTableBlock['ruleColumns'], params: Parameter[], siteIds: string[]): Rule[] =>
    !mode || mode === 'none'
      ? []
      : b.rules.filter((r) => r.active && RULE_COLUMN_KINDS.has(r.kind) && params.some((p) => p.id === r.parameterId) && (mode === 'all' || /limit/i.test(r.level)) && (!r.siteIds.length || r.siteIds.some((id) => siteIds.includes(id))));
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
      if (siteIds.length > 1 && r.siteIds.length) q.push(r.siteIds.filter((id) => siteIds.includes(id)).map((id) => b.siteMap.get(id)?.code ?? '').join(', '));
      out.push(q.length ? `${num}\n(${q.join(', ')})` : num); // the bracket on its own line keeps the column narrow
    }
    return [...new Set(out)].join('\n');
  };
  const linesWidthMm = (text: string, pt: number) => Math.max(0, ...text.split('\n').map((line) => textWidthMm(line, pt)));
  const resultNotes = (sets: GuidelineSet[], highlight: boolean, consentBrackets = false) => {
    const n = ['“<” indicates a result below the laboratory detection limit.'];
    if (consentBrackets) n.push('Consent values in brackets are assessed on a statistic or consecutive results, or apply only at the sites named.');
    if (highlight) n.push(`Shading: red = consent limit exceeded; amber = trigger level${sets.length ? ` or ${sets.map((s) => s.shortName).join(' / ')} guideline` : ''} exceeded; purple = detection limit above the limit.`);
    if (project.hardnessAdjust && sets.some((s) => s.values.some((v) => v.hardness))) n.push('* Hardness-dependent guideline value shown at 30 mg/L CaCO3; results were compared with hardness-modified values (ANZECC 2000) where hardness was measured.');
    return n;
  };

  const blockHandlers: { [K in ReportBlock['type']]: (blk: Extract<ReportBlock, { type: K }>) => void } = {
    title: (blk) => {
      const details: Array<[string, string]> = (
        [
          ['Client', project.client ?? ''],
          ['Project number', project.code ?? ''],
          ['Consent(s)', project.consents ?? ''],
          ['Regulator', project.regulator ?? ''],
          ['Location', project.location ?? ''],
          ['Reporting period', `${formatDateLong(start)} – ${formatDateLong(end)}`],
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
      const number = numbering && lvl <= 2 ? hNum.slice(0, lvl).join('.') : undefined;
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
        { text: STATUS_META[e.status].label, bold: true, fill: e.status === 'compliant' ? FILLS.ok : e.status === 'exceeded' ? FILLS.limit : e.status === 'inconclusive' ? FILLS.check : undefined },
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
      nodes.push({ t: 'table', caption: tableCaption(`Compliance with consent conditions, ${formatDate(start)} – ${formatDate(end)}`), head, body, widths, fontSize: fs });
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
      nodes.push({ t: 'table', caption: tableCaption(`Exceedances recorded, ${formatDate(start)} – ${formatDate(end)}`), head, body, widths, fontSize: fs });
    },
    resultsTable: (blk) => {
      const sites = blk.siteIds.length ? b.sites.filter((s) => blk.siteIds.includes(s.id)) : b.sites;
      const only = blk.sampleIds ? new Set(blk.sampleIds) : null;
      const blockSamples = only ? samplesInPeriod.filter((x) => only.has(x.id)) : samplesInPeriod;
      const sets = setsFor(blk.guidelineSetIds);
      const flags = blk.highlight ? flagsFor(sets.map((s) => s.id)) : new Map<string, CellFlag>();
      const groups: Array<{ label: string; samples: Sample[] }> = blk.splitBySite
        ? sites.map((s) => ({ label: s.name ? `${s.code} (${s.name})` : s.code, samples: blockSamples.filter((x) => x.siteId === s.id) })).filter((g) => g.samples.length)
        : [{ label: '', samples: blockSamples.filter((x) => sites.some((s) => s.id === x.siteId)) }];
      if (!groups.length || groups.every((g) => !g.samples.length)) {
        nodes.push({ t: 'p', runs: [{ text: 'No results for the selected sites in this period.', italic: true }] });
        return;
      }
      const siteCode = (id: string) => b.siteMap.get(id)?.code ?? '';
      const title = fill(blk.title) || 'Monitoring results';
      const pt = big;
      const PAD = CELL_PAD_MM;
      const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
      const valueCell = (s: Sample, p: Parameter): Cell => {
        const r = resultOf(s, p.id);
        if (!r) return { text: '–', align: 'center', color: '#999999' };
        const f = flags.get(r.id);
        return { text: displayValue(r, p).text, align: 'right', fill: flagFill(f), bold: !!f && f.kind !== 'check' };
      };
      const dateHead = (s: Sample) => formatDate(s.date, { format: 'D MMM YYYY' });
      for (const g of groups) {
        const params = paramList(blk.parameterIds, g.samples);
        if (!params.length) continue;
        const label = (i: number, n: number) => [title, g.label].filter(Boolean).join(' – ') + (n > 1 ? ` (${i + 1} of ${n})` : '');
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
      const rows = statsTable(b, blk.siteIds, blk.parameterIds, start, end, flags);
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
          ...shown.map((c) => ({ text: c.get(r), align: 'right' as const, fill: c.key === 'exceed' && r.exceed > 0 ? FILLS.guideline : undefined })),
        ];
      });
      nodes.push({
        t: 'table',
        caption: tableCaption(fill(blk.title) || 'Summary statistics'),
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
      const pids = blk.parameterIds.length ? blk.parameterIds : keyParameters(b, 6);
      const cStart = blk.range === 'all' ? undefined : blk.range === 'years' ? addDays(addMonths(end, -12 * (blk.years ?? 3)), 1) : start;
      const sets = blk.showGuidelines ? setsFor(blk.guidelineSetIds) : [];
      const size = chartSizeCm(blk, t, orientation);
      const figures: Array<{ dataUrl: string; widthCm: number; heightCm: number; caption?: string }> = [];
      for (const pid of pids) {
        const p = b.paramMap.get(pid);
        if (!p) continue;
        const spec = buildChartSpec({ index: b.index, param: p, sites: b.sites, siteIds: blk.siteIds, start: cStart, end, guidelineSets: sets, rules: b.rules, showRules: blk.showRules, log: blk.logScale });
        if (!spec.series.length) continue;
        const caption = figCaption(`${p.name} at ${listText(spec.series.map((s) => s.name))}${blk.range === 'period' ? '' : `, ${formatDate(cStart ?? spec.series[0].points[0].date)} – ${formatDate(end)}`}${blk.caption ? `. ${fill(blk.caption)}` : ''}`);
        const option = chartOption({ ...spec, subtitle: undefined, title: `${p.name} (${unitLabel(p.unit)})` }, { forExport: true, width: Math.round((size.widthCm / 2.54) * 96) });
        const dataUrl = opts.renderChart ? opts.renderChart(option, size.widthCm, size.heightCm) : '';
        figures.push({ dataUrl, ...size, caption });
      }
      if (blk.size === 'half') chunk(figures, 2).forEach((items) => items.length && nodes.push({ t: 'figures', items }));
      else figures.forEach((f) => nodes.push({ t: 'image', ...f }));
    },
    siteTable: () => {
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
      nodes.push({ t: 'table', caption: tableCaption('Monitoring sites'), head, body, widths: [width * 0.1, '*', width * 0.14, width * 0.18, width * 0.12, width * 0.12], fontSize: t.fontSize - 1, notes: b.sites.some((s) => s.easting) ? ['Coordinates are NZTM2000.'] : undefined });
    },
    samplingTable: () => {
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
            ...(required.size ? [{ text: req ? String(req.required) : '–', align: 'right' as const }, { text: req ? String(req.missed) : '–', align: 'right' as const, fill: req && req.missed ? FILLS.guideline : undefined }] : []),
            { text: ss.map((x) => formatDate(x.date, { format: 'DD/MM/YYYY' })).join(', ') },
          ] as Cell[];
        })
        .filter((r): r is Cell[] => !!r);
      if (!body.length) {
        nodes.push({ t: 'p', runs: [{ text: 'No samples were collected during the period.', italic: true }] });
        return;
      }
      nodes.push({ t: 'table', caption: tableCaption(`Samples collected, ${formatDate(start)} – ${formatDate(end)}`), head, body, widths: required.size ? [width * 0.1, width * 0.1, width * 0.1, width * 0.1, '*'] : [width * 0.12, width * 0.12, '*'], fontSize: t.fontSize - 1 });
    },
    pageBreak: () => {}, // see below
  };

  const pages = pageOrientations(t.blocks, t.orientation);
  t.blocks.forEach((blk, i) => {
    // a new page where the orientation changes (a page break block always starts one)
    if (blk.type === 'pageBreak' || pages[i] !== orientation) nodes.push({ t: 'pagebreak', orientation: pages[i] });
    orientation = pages[i];
    width = usableWidthMm(t, orientation);
    const h = blockHandlers[blk.type] as (x: ReportBlock) => void;
    h(blk);
  });

  return {
    template: t,
    nodes,
    header: fill(t.headerText),
    footer: fill(t.footerText),
    title: `${project.name} – ${t.name}`,
    author: settings.author || settings.company,
    fileName: `${project.name} - ${t.name} - ${formatDate(start, { format: 'D MMM YYYY' })} to ${formatDate(end, { format: 'D MMM YYYY' })}`.replace(/[\\/:*?"<>|]+/g, '-'),
  };
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
  return out;
}
