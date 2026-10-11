import type { GuidelineSet, Parameter, ReportBlock, ReportTemplate, Result, Sample, Settings, Site } from '../db/types';
import type { ProjectBundle } from '../lib/analysis';
import { displayValue, evaluateAll, flagResults, keyParameters, statsTable, type CellFlag } from '../lib/analysis';
import type { RuleEvaluation } from '../lib/compliance';
import { STATUS_META } from '../lib/compliance';
import { addDays, addMonths, formatDate, formatDateLong, todayStr } from '../lib/dates';
import { guidelineFor } from '../lib/guidelines';
import { scheduleStep, frequencyLabel } from '../lib/schedule';
import { unitLabel } from '../lib/units';
import { fmtNum } from '../lib/values';
import { buildChartSpec, chartOption } from '../charts/timeSeries';
import { FILLS, fillPlaceholders, parseMarkup, type Cell, type DocNode, type ReportDoc } from './model';

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

export function usableWidthMm(t: ReportTemplate): number {
  const [w, h] = PAGE_MM[t.pageSize] ?? PAGE_MM.A4;
  return (t.orientation === 'landscape' ? h : w) - 2 * t.marginMm;
}

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
  const width = usableWidthMm(t);
  const big = Math.max(7, t.fontSize - 2);

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
  const resultNotes = (sets: GuidelineSet[], highlight: boolean) => {
    const n = ['“<” indicates a result below the laboratory detection limit.'];
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
      nodes.push({ t: 'title', title: fill(blk.title), subtitle: fill(blk.subtitle), details: blk.showDetails ? details : [], logo: t.logo, pageBreakAfter: blk.pageBreakAfter });
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
      nodes.push({ t: 'table', caption: tableCaption(`Compliance with consent conditions, ${formatDate(start)} – ${formatDate(end)}`), head, body, widths: [width * 0.16, '*', width * 0.1, width * 0.09, width * 0.11, width * 0.11], fontSize: t.fontSize - 1 });
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
      const widths: Array<number | '*'> = blk.includeNotes ? [width * 0.11, width * 0.07, width * 0.15, width * 0.11, width * 0.18, width * 0.12, '*'] : [width * 0.12, width * 0.08, width * 0.2, width * 0.13, '*', width * 0.16];
      nodes.push({ t: 'table', caption: tableCaption(`Exceedances recorded, ${formatDate(start)} – ${formatDate(end)}`), head, body, widths, fontSize: t.fontSize - 1 });
    },
    resultsTable: (blk) => {
      const sites = blk.siteIds.length ? b.sites.filter((s) => blk.siteIds.includes(s.id)) : b.sites;
      const sets = setsFor(blk.guidelineSetIds);
      const flags = blk.highlight ? flagsFor(sets.map((s) => s.id)) : new Map<string, CellFlag>();
      const groups: Array<{ label: string; samples: Sample[] }> = blk.splitBySite
        ? sites.map((s) => ({ label: s.name ? `${s.code} (${s.name})` : s.code, samples: samplesInPeriod.filter((x) => x.siteId === s.id) })).filter((g) => g.samples.length)
        : [{ label: '', samples: samplesInPeriod.filter((x) => sites.some((s) => s.id === x.siteId)) }];
      if (!groups.length || groups.every((g) => !g.samples.length)) {
        nodes.push({ t: 'p', runs: [{ text: 'No results for the selected sites in this period.', italic: true }] });
        return;
      }
      const siteCode = (id: string) => b.siteMap.get(id)?.code ?? '';
      const title = fill(blk.title) || 'Monitoring results';
      for (const g of groups) {
        const params = paramList(blk.parameterIds, g.samples);
        if (!params.length) continue;
        if (blk.layout === 'parametersAsRows') {
          const fixed = 40 + 14 + 15 * sets.length;
          const per = Math.max(2, Math.floor((width - fixed) / 15));
          const parts = chunk(g.samples, per);
          parts.forEach((part, i) => {
            const head: Cell[][] = [
              [{ text: 'Parameter' }, { text: 'Unit' }, ...sets.map((s) => ({ text: s.shortName, align: 'center' as const })), ...part.map((s) => ({ text: siteCode(s.siteId), align: 'center' as const }))],
              [{ text: '' }, { text: '' }, ...sets.map(() => ({ text: '' })), ...part.map((s) => ({ text: formatDate(s.date, { format: 'DD/MM/YYYY' }), align: 'center' as const }))],
            ];
            const body: Cell[][] = params.map((p) => [
              { text: p.name },
              { text: unitLabel(p.unit) },
              ...sets.map((s) => ({ text: guidelineText(s, p), align: 'center' as const, fill: FILLS.guidelineRow })),
              ...part.map((s) => {
                const r = resultOf(s, p.id);
                if (!r) return { text: '–', align: 'center' as const, color: '#999999' };
                const f = flags.get(r.id);
                return { text: displayValue(r, p).text, align: 'right' as const, fill: flagFill(f), bold: !!f && f.kind !== 'check' };
              }),
            ]);
            const label = [title, g.label].filter(Boolean).join(' – ') + (parts.length > 1 ? ` (${i + 1} of ${parts.length})` : '');
            nodes.push({ t: 'table', caption: tableCaption(label), head, body, widths: [40, 14, ...sets.map(() => 15), ...part.map(() => '*' as const)], fontSize: big, notes: i === parts.length - 1 ? resultNotes(sets, blk.highlight) : undefined });
          });
        } else {
          const per = Math.max(2, Math.floor((width - 36) / 15));
          const parts = chunk(params, per);
          parts.forEach((part, i) => {
            const head: Cell[][] = [
              [{ text: 'Date' }, { text: 'Site' }, ...part.map((p) => ({ text: p.short ?? p.name, align: 'center' as const }))],
              [{ text: '' }, { text: '' }, ...part.map((p) => ({ text: unitLabel(p.unit), align: 'center' as const }))],
            ];
            const body: Cell[][] = [];
            for (const s of sets) {
              if (!part.some((p) => guidelineFor(s, p.id, p.unit))) continue;
              body.push([{ text: s.shortName, colSpan: 2, italic: true, fill: FILLS.guidelineRow }, { text: '' }, ...part.map((p) => ({ text: guidelineText(s, p), align: 'center' as const, italic: true, fill: FILLS.guidelineRow }))]);
            }
            for (const s of g.samples) {
              body.push([
                { text: formatDate(s.date, { format: 'DD/MM/YYYY' }) },
                { text: siteCode(s.siteId) },
                ...part.map((p) => {
                  const r = resultOf(s, p.id);
                  if (!r) return { text: '–', align: 'center' as const, color: '#999999' };
                  const f = flags.get(r.id);
                  return { text: displayValue(r, p).text, align: 'right' as const, fill: flagFill(f), bold: !!f && f.kind !== 'check' };
                }),
              ]);
            }
            const label = [title, g.label].filter(Boolean).join(' – ') + (parts.length > 1 ? ` (${i + 1} of ${parts.length})` : '');
            nodes.push({ t: 'table', caption: tableCaption(label), head, body, widths: [20, 14, ...part.map(() => '*' as const)], fontSize: big, notes: i === parts.length - 1 ? resultNotes(sets, blk.highlight) : undefined });
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
        widths: [42, 14, 14, ...shown.map(() => '*' as const)],
        fontSize: big,
        notes: [`Statistics treat non-detects as ${project.ndHandling === 'half' ? 'half the detection limit' : project.ndHandling === 'zero' ? 'zero' : 'the detection limit'}. Percentiles: ${project.percentileMethod === 'hazen' ? 'Hazen method' : 'Excel PERCENTILE.INC'}.${blk.stats.includes('exceed') ? ' Exceed. = results exceeding consent limits, triggers or the default guideline values.' : ''}`],
      });
    },
    chart: (blk) => {
      const pids = blk.parameterIds.length ? blk.parameterIds : keyParameters(b, 6);
      const cStart = blk.range === 'all' ? undefined : blk.range === 'years' ? addDays(addMonths(end, -12 * (blk.years ?? 3)), 1) : start;
      const sets = blk.showGuidelines ? setsFor(blk.guidelineSetIds) : [];
      for (const pid of pids) {
        const p = b.paramMap.get(pid);
        if (!p) continue;
        const spec = buildChartSpec({ index: b.index, param: p, sites: b.sites, siteIds: blk.siteIds, start: cStart, end, guidelineSets: sets, rules: b.rules, showRules: blk.showRules, log: blk.logScale });
        if (!spec.series.length) continue;
        const caption = figCaption(`${p.name} at ${listText(spec.series.map((s) => s.name))}${blk.range === 'period' ? '' : `, ${formatDate(cStart ?? spec.series[0].points[0].date)} – ${formatDate(end)}`}${blk.caption ? `. ${fill(blk.caption)}` : ''}`);
        const option = chartOption({ ...spec, subtitle: undefined, title: `${p.name} (${unitLabel(p.unit)})` }, { forExport: true });
        const dataUrl = opts.renderChart ? opts.renderChart(option, blk.widthCm, blk.heightCm) : '';
        nodes.push({ t: 'image', dataUrl, widthCm: blk.widthCm, heightCm: blk.heightCm, caption });
      }
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
    pageBreak: () => nodes.push({ t: 'pagebreak' }),
  };

  for (const blk of t.blocks) {
    const h = blockHandlers[blk.type] as (x: ReportBlock) => void;
    h(blk);
  }

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
