// "Copy for AI input": packages a project's monitoring data as plain text (Markdown with CSV
// blocks) that can be pasted into any AI chat tool together with a question. Nothing is sent
// anywhere – the user copies the text and decides where it goes.

import type { Result, Rule } from '../db/types';
import { evaluateAll, keyParameters, pivot, statsTable, type ProjectBundle } from './analysis';
import { compareSites, defaultPairs, projectTrends, trendRange } from './projectTrends';
import { CATEGORY_TEXT } from './trends';
import { exceededWhen, ruleParamIds, siteLabel, type Exceedance, type RuleStatus } from './compliance';
import { formatDate, MONTH_LONG, todayStr } from './dates';
import { guidelineFor } from './guidelines';
import { frequencyLabel, nextObligation, OBLIGATION_STATUS } from './schedule';
import { convert, unitLabel } from './units';
import { fmtNum } from './values';

export interface AiInputSections {
  results: boolean;
  stats: boolean;
  compliance: boolean;
  rules: boolean;
  guidelines: boolean;
  schedule: boolean;
  /** Trends and upstream–downstream comparisons worked out by EnviroDB (older choices don't have it: on). */
  trends?: boolean;
}

export const AI_SECTION_LABELS: Record<keyof AiInputSections, string> = {
  results: 'Results (one row per sample)',
  stats: 'Summary statistics',
  compliance: 'Compliance assessment & exceedances',
  rules: 'Consent conditions & triggers',
  guidelines: 'Guideline values',
  schedule: 'Monitoring schedule & reporting dates',
  trends: 'Trends & upstream vs downstream (worked out by EnviroDB)',
};

export const DEFAULT_SECTIONS: AiInputSections = { results: true, stats: true, compliance: true, rules: true, guidelines: true, schedule: true, trends: true };

export interface AiInputOptions {
  start: string;
  end: string;
  siteIds: string[]; // [] = all sites
  paramIds: string[]; // [] = all parameters with data
  sections: AiInputSections;
  /** Leave out project, client, consent, regulator and site names, locations and free-text notes. */
  hideNames: boolean;
  today?: string;
}

export interface AiInput {
  text: string;
  samples: number;
  results: number;
}

/** Ready-made requests. `allData` ones work best with the whole record, so they switch the period to all data. */
export const AI_PROMPTS: Array<{ label: string; text: string; allData?: boolean }> = [
  {
    label: 'Compliance summary',
    text: 'Summarise compliance with the consent conditions for this period. List each exceedance with its date, site, result and limit, and the follow-up recorded.',
  },
  {
    label: 'Explain exceedances',
    text: 'For each exceedance, look at the other results from the same sampling round, including the upstream/control sites, and suggest likely causes and follow-up actions. Say how confident you are in each.',
  },
  {
    label: 'Upstream vs downstream',
    text: 'Compare the downstream/impact sites with the upstream/control sites. Is there evidence the discharge is affecting water quality? Use the paired comparisons EnviroDB worked out where they are included (otherwise suitable paired statistics), and explain the results in plain language.',
  },
  {
    label: 'Trends over time',
    text: "Describe the trends over time at each site for the key parameters. Use the trend results EnviroDB worked out (Mann-Kendall with Sen's slope) where they're included; otherwise test for trends yourself. Report the direction, size and confidence of each trend in plain language, and any limitations such as non-detects or gaps.",
    allData: true,
  },
  {
    label: 'Check data quality',
    text: 'Check the data for anything unusual: outliers, likely transcription or unit errors, detection limits too high to assess compliance, and sampling rounds missed under the monitoring schedule.',
  },
  {
    label: 'Draft report text',
    text: 'Draft the results and discussion section of the monitoring report for this period in a formal technical style (NZ English). Refer to the consent conditions and use only the data provided.',
  },
  {
    label: 'Suggest triggers',
    text: 'Using the data from the upstream/control sites as a baseline, suggest site-specific trigger values (for example 80th and 95th percentiles) and compare them with the current triggers and guideline values.',
    allData: true,
  },
];

const ND_TEXT = { dl: 'at the detection limit', half: 'at half the detection limit', zero: 'as zero' } as const;
const PCT_TEXT = { excel: 'Excel PERCENTILE.INC method', hazen: 'Hazen method' } as const;
const OUTCOME: Record<RuleStatus, string> = {
  compliant: 'Complied',
  exceeded: 'Exceeded',
  inconclusive: 'Not confirmed (detection limit above the limit)',
  'no-data': 'No data',
};
const NOTE_STATUS = { open: 'Open – investigating', notified: 'Regulator notified', closed: 'Closed – resolved' } as const;

const day = (date: string) => formatDate(date, { format: 'D MMM YYYY' });
const isoDate = (date: string) => date.replace('T', ' ');
const oneLine = (s: string) => s.replace(/\s*\n\s*/g, ' ').trim();

/** Quote a CSV cell when it contains a comma, quote or line break. */
export function csvCell(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
const csvRow = (cells: string[]) => cells.map(csvCell).join(',');

function mdCell(v: string): string {
  return oneLine(v).replace(/\|/g, '\\|');
}
function mdTable(head: string[], rows: string[][]): string[] {
  return [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.map(mdCell).join(' | ')} |`)];
}

/** A number as plain text, keeping the reported precision but dropping floating-point noise from unit conversion. */
function plain(v: number): string {
  return String(Number(v.toPrecision(12)));
}

function resultText(r: Result, unit: string): string {
  if (r.value === null) return r.text ?? '';
  const v = convert(r.value, r.unit, unit);
  if (v === null) return `${r.qualifier}${plain(r.value)} ${unitLabel(r.unit)}`; // incompatible unit: keep as reported
  return `${r.qualifier}${plain(v)}`;
}

/** Replaces project, client, consent, regulator, location and site names in free text. */
function makeRedactor(b: ProjectBundle, on: boolean): (s: string) => string {
  if (!on) return (s) => s;
  const p = b.project;
  const pairs: Array<[string, string]> = [];
  const add = (v: string | undefined, label: string) => {
    const t = v?.trim();
    if (t && t.length >= 3) pairs.push([t, label]);
  };
  add(p.name, '[project]');
  add(p.code, '[project code]');
  add(p.client, '[client]');
  add(p.regulator, '[regulator]');
  add(p.location, '[location]');
  add(p.consents, '[consent]');
  p.consents?.split(/[,;]|\band\b/).forEach((c) => add(c, '[consent]'));
  b.sites.forEach((s) => add(s.name, s.code));
  if (!pairs.length) return (s) => s;
  pairs.sort((a, c) => c[0].length - a[0].length);
  const labels = new Map(pairs.map(([t, l]) => [t.toLowerCase(), l]));
  const re = new RegExp(pairs.map(([t]) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi');
  return (s) => s.replace(re, (m) => labels.get(m.toLowerCase()) ?? m);
}

/** Active rules that apply to the selected sites/parameters, with copies limited to that selection for assessment. */
function scopeRules(b: ProjectBundle, siteIds: string[], paramIds: string[]) {
  const siteSel = siteIds.length ? new Set(siteIds) : null;
  const paramSel = paramIds.length ? new Set(paramIds) : null;
  const setMap = new Map(b.setMap);
  const pairs: Array<{ rule: Rule; scoped: Rule }> = [];
  for (const rule of b.rules) {
    if (!rule.active) continue;
    let scoped = rule;
    if (siteSel) {
      const targets = (rule.siteIds.length ? rule.siteIds : b.sites.map((s) => s.id)).filter((id) => siteSel.has(id) && id !== rule.referenceSiteId);
      if (!targets.length) continue;
      scoped = { ...scoped, siteIds: targets };
    }
    if (paramSel) {
      if (rule.kind === 'guideline') {
        const set = rule.guidelineSetId ? b.setMap.get(rule.guidelineSetId) : undefined;
        if (!set || !ruleParamIds(rule, b.setMap).some((id) => paramSel.has(id))) continue;
        setMap.set(set.id, { ...set, values: set.values.filter((v) => paramSel.has(v.parameterId)) });
      } else if (!rule.parameterId || !paramSel.has(rule.parameterId)) continue;
    }
    pairs.push({ rule, scoped });
  }
  return { pairs, bundle: { ...b, setMap } };
}

function ruleDetails(rule: Rule, b: ProjectBundle): string[] {
  const out: string[] = [];
  if (rule.kind === 'change' && rule.referenceSiteId) {
    const ref = siteLabel(b.sites, rule.referenceSiteId);
    const how = rule.changeType === 'percent' ? 'percentage increase over' : rule.changeType === 'abs-diff' ? 'difference (either direction) from' : 'increase over';
    out.push(`The change is the ${how} the ${ref} result from ${rule.pairingDays ? `within ${rule.pairingDays} days` : 'the same day'}.`);
  }
  if (rule.kind === 'statistic' && (rule.minSamples ?? 1) > 1) out.push(`Needs at least ${rule.minSamples} samples.`);
  if (rule.effectiveFrom || rule.effectiveTo) out.push(`Applies ${rule.effectiveFrom ? `from ${day(rule.effectiveFrom)}` : ''}${rule.effectiveFrom && rule.effectiveTo ? ' ' : ''}${rule.effectiveTo ? `until ${day(rule.effectiveTo)}` : ''}.`);
  return out;
}


function exceedanceResult(ex: Exceedance, rule: Rule): string {
  if (rule.kind !== 'threshold' && rule.kind !== 'guideline') return ex.detail;
  if (ex.value === null) return '';
  return `${ex.qualifier}${fmtNum(ex.value)} ${ex.unit === '%' ? '%' : unitLabel(ex.unit)}`.trim();
}

/** Build the text package for a project. Append the user's question with `withRequest`. */
export function buildAiInput(b: ProjectBundle, o: AiInputOptions): AiInput {
  const { project } = b;
  const S = o.sections;
  const today = o.today ?? todayStr();
  // "All data" → the actual date range of the data
  const all = o.start <= '1900-01-01' && o.end >= '2199-12-31';
  const start = all && b.index.dates.min ? b.index.dates.min.slice(0, 10) : o.start;
  const end = all && b.index.dates.max ? b.index.dates.max.slice(0, 10) : o.end;
  const period = `${day(start)} to ${day(end)}`;
  const redact = makeRedactor(b, o.hideNames);
  const sites = o.siteIds.length ? b.sites.filter((s) => o.siteIds.includes(s.id)) : b.sites;

  const { columns, rows } = pivot(b, { siteIds: o.siteIds, paramIds: o.paramIds, start, end });
  const siteOrder = new Map(b.sites.map((s, i) => [s.id, i]));
  rows.sort((x, y) => (siteOrder.get(x.site.id) ?? 0) - (siteOrder.get(y.site.id) ?? 0) || (x.sample.date < y.sample.date ? -1 : x.sample.date > y.sample.date ? 1 : 0));
  const resultCount = rows.reduce((n, r) => n + r.cells.size, 0);
  const samplesBySite = new Map<string, number>();
  rows.forEach((r) => samplesBySite.set(r.site.id, (samplesBySite.get(r.site.id) ?? 0) + 1));
  const scope = scopeRules(b, o.siteIds, o.paramIds);
  const paramName = (id: string) => b.paramMap.get(id)?.name ?? id;

  const L: string[] = [];
  const section = (title: string) => L.push('', `## ${title}`);

  L.push(o.hideNames ? '# Environmental monitoring data' : `# Environmental monitoring data – ${project.name}`);
  L.push(`Exported from EnviroDB on ${day(today)} for use with an AI assistant.`);
  L.push(`Period: ${all ? 'all data, ' : ''}${period}. Sites: ${sites.map((s) => s.code).join(', ') || 'none'}. ${rows.length} samples, ${resultCount} results${columns.length ? ` for ${columns.length} parameters` : ''}.`);

  section('How to read this data');
  L.push('- Dates are New Zealand local dates (YYYY-MM-DD, with the time where it was recorded).');
  L.push('- "<0.0005" means not detected: below the laboratory detection limit of 0.0005. ">" means above the upper reporting limit.');
  L.push('- Each parameter has one unit, given with its name. Results reported in other units (for example g/m³, which is the same as mg/L) have been converted.');
  if (S.results) L.push("- A blank cell means the parameter wasn't measured in that sample.");
  const calculated = [S.compliance && scope.pairs.length && 'compliance assessment', S.stats && 'summary statistics'].filter(Boolean);
  if (calculated.length) L.push(`- EnviroDB calculated the ${calculated.join(' and ')} from this data. In statistics, non-detects are counted ${ND_TEXT[project.ndHandling ?? 'dl']}; percentiles use the ${PCT_TEXT[project.percentileMethod ?? 'excel']}.`);
  if (S.compliance && scope.pairs.length) L.push("- A non-detect complies with a limit when its detection limit is at or below the limit. When the detection limit is above the limit, compliance can't be confirmed.");
  L.push("- If a question needs information that isn't here, say so instead of assuming it.");

  section('Project');
  if (!o.hideNames) {
    L.push(`- Name: ${project.name}${project.code ? ` (${project.code})` : ''}`);
    if (project.client) L.push(`- Client: ${project.client}`);
    if (project.consents) L.push(`- Consent: ${project.consents}`);
    if (project.regulator) L.push(`- Regulator: ${project.regulator}`);
    if (project.location) L.push(`- Location: ${project.location}`);
    if (project.description) L.push(`- Description: ${oneLine(project.description)}`);
  }
  L.push(`- The reporting year starts in ${MONTH_LONG[(project.yearStartMonth || 1) - 1]}.`);
  const other = (project.consentNotes ?? '').split('\n').map((l) => l.replace(/^[-•]\s*/, '').trim()).filter(Boolean);
  if (other.length) {
    L.push("- Other consent requirements (EnviroDB doesn't check these):");
    other.forEach((l) => L.push(`  - ${redact(l)}`));
  }

  section('Monitoring sites');
  L.push(
    ...mdTable(
      o.hideNames ? ['Site', 'Type', 'Role', 'Samples'] : ['Site', 'Name', 'Type', 'Role', 'Samples'],
      sites.map((s) => [s.code, ...(o.hideNames ? [] : [s.name ?? '']), s.type, s.role || '', String(samplesBySite.get(s.id) ?? 0)]),
    ),
  );

  if (S.rules) {
    section('Consent conditions and triggers');
    if (!scope.pairs.length) L.push(b.rules.some((r) => r.active) ? 'None apply to the selected sites and parameters.' : 'No consent conditions or triggers are set up for this project in EnviroDB.');
    scope.pairs.forEach(({ rule }, i) => {
      L.push(`${i + 1}. ${redact(rule.name)}${rule.condition ? ` (${redact(rule.condition)})` : ''} – ${rule.level}`);
      L.push(`   - Exceeded when: ${redact(exceededWhen(rule, b.paramMap, b.sites, b.setMap))}`);
      ruleDetails(rule, b).forEach((t) => L.push(`   - ${t}`));
      if (rule.action) L.push(`   - Required response: ${redact(oneLine(rule.action))}`);
    });
  }

  if (S.compliance && scope.pairs.length) {
    const evals = evaluateAll(scope.bundle, start, end, scope.pairs.map((p) => p.scoped));
    const notes = new Map(b.notes.map((n) => [`${n.ruleId}|${n.key}`, n]));
    const followUp = (ruleId: string, key: string) => {
      const n = notes.get(`${ruleId}|${key}`);
      if (!n) return '';
      const status = `${NOTE_STATUS[n.status]}${n.notifiedOn ? ` ${day(n.notifiedOn)}` : ''}`;
      return o.hideNames || !n.text.trim() ? status : `${status}: ${n.text}`;
    };
    section(`Compliance assessment (${period})`);
    L.push(...mdTable(['Condition', 'Level', 'Outcome', 'Details'], evals.map((ev) => [`${redact(ev.rule.name)}${ev.rule.condition ? ` (${redact(ev.rule.condition)})` : ''}`, ev.rule.level, OUTCOME[ev.status], ev.summary])));
    const byDate = (a: { x: Exceedance }, c: { x: Exceedance }) => (a.x.date < c.x.date ? -1 : a.x.date > c.x.date ? 1 : 0);
    const ex = evals.flatMap((ev) => ev.exceedances.map((x) => ({ ev, x }))).sort(byDate);
    L.push('', `### Exceedances (${ex.length})`);
    if (!ex.length) L.push('None in this period.');
    else
      L.push(
        ...mdTable(
          ['Date', 'Site', 'Parameter', 'Result', 'Limit', 'Condition', 'Follow-up'],
          ex.map(({ ev, x }) => [isoDate(x.date), siteLabel(b.sites, x.siteId), paramName(x.parameterId), exceedanceResult(x, ev.rule), x.limitText, redact(ev.rule.name), followUp(ev.rule.id, x.key)]),
        ),
      );
    const inc = evals.flatMap((ev) => ev.inconclusive.map((x) => ({ ev, x }))).sort(byDate);
    if (inc.length) {
      L.push('', `### Results that couldn't be confirmed as compliant (${inc.length})`, 'The detection limit was above the limit.');
      L.push(...mdTable(['Date', 'Site', 'Parameter', 'Result', 'Limit', 'Condition'], inc.map(({ ev, x }) => [isoDate(x.date), siteLabel(b.sites, x.siteId), paramName(x.parameterId), exceedanceResult(x, ev.rule), x.limitText, redact(ev.rule.name)])));
    }
  }

  if (S.guidelines) {
    const setIds = Array.from(new Set([...project.guidelineSetIds, ...scope.pairs.flatMap(({ rule }) => (rule.kind === 'guideline' && rule.guidelineSetId ? [rule.guidelineSetId] : rule.limitSetId ? [rule.limitSetId] : []))]));
    const inData = new Set(columns.map((c) => c.id));
    const blocks: string[] = [];
    let hardnessUsed = false;
    for (const id of setIds) {
      const set = b.setMap.get(id);
      if (!set) continue;
      const rowsOut: string[][] = [];
      for (const gv of set.values) {
        const param = b.paramMap.get(gv.parameterId);
        if (!param || !inData.has(param.id)) continue;
        const lim = guidelineFor(set, param.id, param.unit);
        if (!lim) continue;
        const hard = !!gv.hardness && !!param.hardnessExponent;
        hardnessUsed ||= hard;
        const value =
          lim.min !== undefined && lim.max !== undefined ? `${fmtNum(lim.min)}–${fmtNum(lim.max)}` : lim.max !== undefined ? `${fmtNum(lim.max)}${gv.op === '>=' ? ' (must be below)' : ''}` : `at least ${fmtNum(lim.min)}`;
        rowsOut.push([param.name, `${value}${hard ? '*' : ''}`, unitLabel(param.unit), hard ? String(param.hardnessExponent) : '', gv.note ?? '']);
      }
      if (!rowsOut.length) continue;
      blocks.push('', `### ${set.builtIn ? set.name : redact(set.name)}`);
      if (set.source) blocks.push(`Source: ${oneLine(set.source)}`);
      if (set.notes) blocks.push(`Notes: ${oneLine(set.builtIn ? set.notes : redact(set.notes))}`);
      blocks.push(...mdTable(['Parameter', 'Guideline value', 'Unit', 'Hardness exponent (a)', 'Note'], rowsOut));
    }
    if (blocks.length) {
      section('Guideline values');
      L.push('Converted to the units used in the results.');
      if (hardnessUsed) {
        const adjusted = project.hardnessAdjust || scope.pairs.some(({ rule }) => (rule.kind === 'guideline' || !!rule.limitSetId) && rule.hardnessAdjust);
        L.push(
          adjusted
            ? '* Hardness-dependent: the value applies at a hardness of 30 mg/L as CaCO3. EnviroDB adjusts it for each sample where hardness was measured or could be calculated from calcium and magnesium (ANZECC 2000: adjusted value = value × (H/30)^a for H above 30 mg/L, with H capped at 400 mg/L).'
            : "* Hardness-dependent: the value applies at a hardness of 30 mg/L as CaCO3. This project doesn't adjust it for hardness.",
        );
      }
      L.push(...blocks);
    }
  }

  if (S.stats) {
    const st = statsTable(b, o.siteIds, o.paramIds, start, end);
    if (st.length) {
      section(`Summary statistics (${period})`);
      L.push('```csv', csvRow(['site', 'parameter', 'unit', 'n', 'n_not_detected', 'min', 'median', 'mean', '95th_percentile', 'max']));
      for (const r of st) L.push(csvRow([r.site.code, r.param.name, unitLabel(r.param.unit), String(r.n), String(r.nd), r.minText, fmtNum(r.median), fmtNum(r.mean), fmtNum(r.p95), r.maxText]));
      L.push('```');
    }
  }

  if (S.trends !== false) {
    // over the last 10 years to the period's end (all the record), whatever period the results above cover
    const tEnd = b.index.dates.max && b.index.dates.max.slice(0, 10) < end ? b.index.dates.max.slice(0, 10) : end;
    const range = trendRange('10y', tEnd);
    const pids = o.paramIds.length ? o.paramIds : keyParameters(b, 8);
    const rows = projectTrends(b, { siteIds: o.siteIds, parameterIds: pids, start: range.start, end: range.end });
    if (rows.length) {
      section(`Trends (${day(range.start ?? start)} to ${day(range.end)})`);
      L.push(
        "Worked out by EnviroDB: the Mann-Kendall test (seasonal Kendall where results vary with the season) on one value per month or quarter, with Sen's slope. Non-detects are tied for the test and halved for the slope. probability_improving: how likely the trend is improving (for pH and temperature, probability_rising instead). Categories as LAWA: very likely ≥ 90%, likely 67–90%.",
      );
      L.push('```csv', csvRow(['site', 'parameter', 'unit', 'trend', 'sen_slope_per_year', 'percent_per_year', 'probability_improving', 'probability_rising', 'values', 'years', 'seasonal', 'percent_below_detection', 'note']));
      for (const { siteId, parameterId, result: r } of rows) {
        const p = b.paramMap.get(parameterId);
        L.push(
          csvRow([
            b.siteMap.get(siteId)?.code ?? '',
            p?.name ?? parameterId,
            unitLabel(p?.unit),
            CATEGORY_TEXT[r.category],
            r.ok && r.slope !== null ? plain(Number(r.slope.toPrecision(3))) : '',
            r.pctPerYear !== null ? r.pctPerYear.toFixed(1) : '',
            r.ok && r.pImproving !== undefined ? r.pImproving.toFixed(2) : '',
            r.ok ? r.pIncreasing.toFixed(2) : '',
            String(r.n),
            r.years.toFixed(1),
            r.ok ? (r.seasonal ? 'yes' : 'no') : '',
            r.ok ? String(Math.round(r.censored * 100)) : '',
            r.ok ? (r.approximate ? 'slope approximate (many non-detects)' : '') : r.reason ?? '',
          ]),
        );
      }
      L.push('```');
    }
    const pairs = defaultPairs(b).filter((x) => sites.some((s) => s.id === x.upId) && sites.some((s) => s.id === x.downId));
    for (const pair of pairs) {
      const cmp = compareSites(b, pair, pids, start, end, 1);
      if (!cmp.length) continue;
      const up = b.siteMap.get(pair.upId)?.code ?? '';
      const down = b.siteMap.get(pair.downId)?.code ?? '';
      section(`${down} compared with ${up} (${period})`);
      L.push(`Worked out by EnviroDB: results taken at both sites within a day of each other; the Wilcoxon signed-rank test on the differences (${down} − ${up}). Pairs both below detection are left out.`);
      L.push('```csv', csvRow(['parameter', 'unit', 'pairs', `${up}_median`, `${down}_median`, 'median_difference', 'share_higher_downstream', 'p_value', 'verdict']));
      for (const { parameterId, c } of cmp) {
        const p = b.paramMap.get(parameterId);
        L.push(
          csvRow([
            p?.name ?? parameterId,
            unitLabel(p?.unit),
            String(c.n),
            c.upMedian === null ? '' : plain(Number(c.upMedian.toPrecision(4))),
            c.downMedian === null ? '' : plain(Number(c.downMedian.toPrecision(4))),
            c.medianDiff === null ? '' : plain(Number(c.medianDiff.toPrecision(3))),
            c.n - c.bothNd ? c.higherDown.toFixed(2) : '',
            c.p === null ? '' : c.p.toFixed(4),
            c.verdict === 'higher' ? 'higher downstream' : c.verdict === 'lower' ? 'lower downstream' : c.verdict === 'no-difference' ? 'no clear difference' : 'too few pairs',
          ]),
        );
      }
      L.push('```');
    }
  }

  if (S.schedule) {
    const schedules = b.schedules
      .filter((s) => s.active && (!o.siteIds.length || s.siteIds.some((id) => o.siteIds.includes(id))))
      .sort((a, c) => a.name.localeCompare(c.name));
    if (schedules.length) {
      section('Monitoring schedule');
      for (const s of schedules) {
        const params = s.parameterIds.map(paramName);
        L.push(`- ${redact(s.name)}: ${frequencyLabel(s.every, s.unit).toLowerCase()} at ${s.siteIds.map((id) => siteLabel(b.sites, id)).join(', ')}${params.length ? ` for ${params.join(', ')}` : ''}, from ${day(s.startDate)}${s.endDate ? ` until ${day(s.endDate)}` : ''}.`);
      }
    }
    const obligations = b.obligations.filter((x) => x.active);
    if (obligations.length) {
      section('Reporting obligations');
      for (const ob of obligations) {
        const n = nextObligation(ob, today);
        const freq = ob.every ? frequencyLabel(ob.every, ob.unit).toLowerCase() : 'one-off';
        const next = n ? ` Next report: ${day(n.periodStart)} to ${day(n.periodEnd)}, due ${day(n.dueDate)} (${OBLIGATION_STATUS[n.status].label.toLowerCase()}).` : '';
        L.push(`- ${redact(ob.name)}${!o.hideNames && ob.recipient ? ` (to ${ob.recipient})` : ''}: ${freq}.${next}`);
      }
    }
  }

  if (S.results) {
    section('Results');
    if (!rows.length) L.push('No results in this period.');
    else {
      const withNotes = !o.hideNames && rows.some((r) => r.sample.notes?.trim());
      L.push('One row per sample, sorted by site and date. Column headers give the parameter and its unit.');
      L.push('```csv', csvRow(['site', 'date', ...columns.map((p) => `${p.name} (${unitLabel(p.unit)})`), ...(withNotes ? ['notes'] : [])]));
      for (const r of rows) {
        const cells = columns.map((p) => {
          const x = r.cells.get(p.id);
          return x ? resultText(x, p.unit) : '';
        });
        L.push(csvRow([r.site.code, isoDate(r.sample.date), ...cells, ...(withNotes ? [oneLine(r.sample.notes ?? '')] : [])]));
      }
      L.push('```');
    }
  }

  return { text: `${L.join('\n')}\n`, samples: rows.length, results: resultCount };
}

/** Add the user's question at the end, after the data. */
export function withRequest(text: string, request: string): string {
  const q = request.trim();
  return q ? `${text}\n## My request\n${q}\n` : text;
}

/** Rough token count, for a size hint (numbers and CSV tokenise less efficiently than prose). */
export function approxTokens(text: string): number {
  return Math.round(text.length / 3.2);
}
