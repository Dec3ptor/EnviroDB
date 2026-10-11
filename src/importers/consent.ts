// Set up a project from its consent documents with the help of an AI tool. EnviroDB writes the
// instructions (what to extract and the exact JSON format), the user runs them in their own AI
// tool with the consent attached, and pastes the answer back here to review and import.
// Nothing is sent anywhere by EnviroDB.

import type { ChangeType, GuidelineSet, MonitoringSchedule, Operator, Parameter, Project, ReportObligation, Rule, RuleKind, Site, SiteRole, SiteType, StatName, WindowKind } from '../db/types';
import { RULE_LEVELS, SITE_ROLES, SITE_TYPES } from '../db/types';
import { PARAMETER_GROUPS } from '../data/parameters';
import { buildParamIndex, matchParameter, matchSite } from '../lib/matching';
import { addDays, addMonths, formatDate, MONTH_LONG, parseDateString, reportingYear, todayStr } from '../lib/dates';
import { normUnit, sameDimension, unitLabel } from '../lib/units';
import { slugify, uid } from '../lib/ids';

export const CONSENT_FORMAT = 'envirodb-consent-setup';

export interface ConsentContext {
  project: Project;
  sites: Site[];
  params: Parameter[];
  guidelineSets: GuidelineSet[];
}

// ------------------------------------------------------------ instructions for the AI

const KINDS: Record<RuleKind, string> = {
  threshold: 'each result is compared with a limit (a maximum, a minimum or a range)',
  statistic: 'a statistic over time (median, mean, percentile…) is compared with a limit',
  change: 'the change at a site compared with an upstream/reference site',
  consecutive: 'a number of results in a row breach a level',
  guideline: 'results are compared with a whole guideline set (e.g. ANZG 95% species protection)',
};

function exampleJson(today: string): string {
  const ry = reportingYear(today, 7);
  const lastRy = reportingYear(addDays(ry.start, -1), 7);
  const ex = {
    format: CONSENT_FORMAT,
    version: 1,
    project: {
      consents: 'AUTH-123456',
      regulator: 'Example Regional Council',
      client: 'Example Quarries Ltd',
      location: '123 Example Road, Exampletown',
      description: 'Discharge of treated quarry stormwater from a sediment pond to Example Stream.',
      yearStartMonth: 7,
    },
    sites: [
      { code: 'DP1', name: 'Sediment pond outlet', type: 'Discharge', role: 'Discharge point', source: 'Condition 4' },
      { code: 'US1', name: 'Example Stream, 50 m upstream of the outfall', type: 'Surface water', role: 'Upstream / control', source: 'Condition 4' },
      { code: 'DS1', name: 'Example Stream, 100 m downstream of the outfall', type: 'Surface water', role: 'Downstream / impact', source: 'Condition 4' },
    ],
    rules: [
      {
        name: 'Discharge TSS limit',
        condition: 'Condition 8(a)',
        level: 'Limit',
        kind: 'threshold',
        parameter: 'Total Suspended Solids',
        sites: ['DP1'],
        operator: '>',
        value: 100,
        unit: 'g/m3',
        action: 'Notify the Council within 24 hours and investigate the cause.',
        quote: 'The discharge shall not contain more than 100 g/m³ of total suspended solids.',
      },
      { name: 'Discharge pH range', condition: 'Condition 8(b)', level: 'Limit', kind: 'threshold', parameter: 'pH', sites: ['DP1'], operator: 'outside', min: 6.5, max: 8.5, unit: 'pH units', quote: 'The pH of the discharge shall be within the range 6.5 to 8.5.' },
      {
        name: 'Turbidity increase downstream',
        condition: 'Condition 10',
        level: 'Limit',
        kind: 'change',
        parameter: 'Turbidity',
        sites: ['DS1'],
        referenceSite: 'US1',
        changeType: 'percent',
        pairingDays: 0,
        operator: '>',
        value: 20,
        unit: '%',
        quote: 'The discharge shall not increase the turbidity of Example Stream by more than 20%, measured upstream and downstream on the same day.',
      },
      {
        name: 'Downstream nitrate – annual median',
        condition: 'Condition 11',
        level: 'Trigger',
        kind: 'statistic',
        parameter: 'Nitrate-N',
        sites: ['DS1'],
        statistic: 'median',
        window: 'year',
        minSamples: 4,
        operator: '>',
        value: 2.4,
        unit: 'mg/L',
        quote: 'The annual median nitrate-nitrogen concentration at DS1 shall not exceed 2.4 g/m³.',
        comment: 'Applied to each reporting year (July–June).',
      },
    ],
    schedules: [
      { name: 'Monthly discharge and stream sampling', sites: ['DP1', 'US1', 'DS1'], parameters: ['Total Suspended Solids', 'pH', 'Turbidity'], every: 1, unit: 'month', startDate: ry.start, notes: 'Condition 6', quote: 'Samples shall be collected monthly from DP1, US1 and DS1…' },
    ],
    reporting: [
      { name: 'Annual monitoring report', recipient: 'Example Regional Council', every: 1, unit: 'year', firstPeriodStart: lastRy.start, firstPeriodEnd: lastRy.end, firstDueDate: addMonths(lastRy.end, 3), notes: 'Condition 15', quote: 'An annual report for each year ending 30 June shall be provided by 30 September.' },
    ],
    notes: ['Condition 9: the discharge shall not cause a conspicuous change in colour or visual clarity in Example Stream (checked by visual inspection).'],
  };
  return JSON.stringify(ex, null, 2);
}

/** The instructions the user pastes into their AI tool, together with the consent documents. */
export function buildConsentPrompt(ctx: ConsentContext, opts: { consentText?: string; notes?: string; today?: string } = {}): string {
  const today = opts.today ?? todayStr();
  const L: string[] = [];
  L.push('# Task: turn resource consent conditions into EnviroDB set-up data');
  L.push('');
  L.push(
    'You are helping an environmental scientist in New Zealand set up consent compliance monitoring in EnviroDB, a monitoring database. Read the resource consent(s) and any monitoring plan attached to or included in this message, and extract every monitoring requirement into the JSON format below so that EnviroDB can import it.',
  );
  L.push('');
  L.push(`Today's date is ${formatDate(today, { format: 'D MMM YYYY' })}.`);
  L.push('');
  L.push('## What to extract');
  L.push('- **sites**: every monitoring location (discharge points, upstream and downstream receiving-water sites, bores and so on).');
  L.push('- **rules**: every numeric limit, trigger level or standard that monitoring results can be checked against – one rule per parameter. A rule can apply to several sites.');
  L.push('- **schedules**: how often each site must be sampled, and for which parameters.');
  L.push('- **reporting**: every report the consent requires, with the period it covers and when it is due.');
  L.push('- **project**: consent number(s), regulator, consent holder, location and a one-sentence description of the activity.');
  L.push(
    '- **notes**: requirements that do not fit the format, for example narrative conditions ("no conspicuous change in colour or clarity"), event-based sampling (after heavy rain), notification duties, management plan reviews and the consent expiry date. Start each note with its condition number.',
  );
  L.push('');
  L.push('## Ground rules');
  L.push("- Be complete and exact. Use the numbers, units and site references the consent gives. Don't invent limits that aren't there.");
  L.push('- Put the consent\'s exact wording for each rule, schedule and report in "quote" so the user can check it.');
  L.push('- If something is ambiguous (for example whether a metal limit is for the dissolved or total fraction), make your best interpretation and explain it in "comment".');
  L.push('- Leave out fields that don\'t apply. Use numbers for numbers (not strings) and dates as YYYY-MM-DD.');
  L.push("- Reply with the JSON only, in one ```json code block. Don't shorten or summarise it because it's long.");
  L.push('');
  L.push('## Example (format only – the content is made up)');
  L.push('```json');
  L.push(exampleJson(today));
  L.push('```');
  L.push('');
  L.push('## Field reference');
  L.push('### project');
  L.push('consents, regulator, client (the consent holder), location, description – text. yearStartMonth – 1 to 12, the first month of the monitoring/reporting year if the consent sets one (7 = July–June).');
  L.push('### sites');
  L.push('- code: a short code such as "DS1". Reuse the code of an existing site (listed below) when the consent means the same place.');
  L.push('- name: a descriptive name. description: the location as described in the consent.');
  L.push(`- type: one of ${SITE_TYPES.map((t) => `"${t}"`).join(', ')}.`);
  L.push(`- role: one of ${SITE_ROLES.filter(Boolean).map((r) => `"${r}"`).join(', ')}, or leave it out.`);
  L.push('- easting, northing: NZTM 2000 coordinates, if given. source: the condition that defines the site.');
  L.push('### rules');
  L.push('- name: a short name. condition: the condition reference, e.g. "Condition 8(a)".');
  L.push(`- level: ${RULE_LEVELS.map((l) => `"${l}"`).join(', ')}. Use "Limit" for consent limits and standards, and the trigger levels the consent names otherwise.`);
  L.push('- kind:');
  (Object.keys(KINDS) as RuleKind[]).forEach((k) => L.push(`  - "${k}": ${KINDS[k]}`));
  L.push('- parameter: use the exact name from the parameter list below when it matches; otherwise the name as written in the consent. For metals, say "Dissolved …" or "Total …".');
  L.push('- sites: the codes of the sites the rule applies to. An empty list means all sites.');
  L.push('- operator: the condition that counts as a breach – ">" (above a maximum), ">=" (at or above), "<" (below a minimum), "<=" (at or below), or "outside" (outside a range: give min and max).');
  L.push('- value: the limit. min, max: the range for "outside". unit: the unit of the limit, e.g. "g/m3", "mg/L", "µg/L", "NTU", "pH units", "cfu/100mL", "%".');
  L.push('- statistic rules: statistic ("mean", "median", "percentile", "max", "min", "geomean"), percentile (e.g. 95), window ("year" = each reporting year, "period" = each reporting period, "rolling-days", "rolling-samples"), windowSize (days or samples for rolling windows), minSamples.');
  L.push('- change rules: referenceSite (the upstream/control site code), changeType ("percent" = percentage increase, "absolute" = increase in the parameter\'s unit, "abs-diff" = change in either direction), pairingDays (how many days apart the paired samples can be; 0 = same day).');
  L.push('- consecutive rules: consecutive (how many results in a row, e.g. 2).');
  L.push('- guideline rules: guidelineSet (an id from the list below) and hardnessAdjust (true to hardness-modify hardness-dependent metals).');
  L.push('- action: what the consent requires if the rule is breached or triggered. effectiveFrom, effectiveTo: dates, if the rule only applies for part of the time.');
  L.push('- quote, comment: as described above.');
  L.push('### schedules');
  L.push('- name, sites (codes), parameters (names; an empty list means any sample counts).');
  L.push('- every + unit: e.g. 1 + "month", 3 + "month" for quarterly, 2 + "week" for fortnightly. unit is one of "day", "week", "month", "year".');
  L.push('- startDate: when this sampling started or starts, if known. notes: the condition reference and any details (e.g. "within 24 hours after more than 25 mm of rain"). quote, comment.');
  L.push('### reporting');
  L.push('- name, recipient.');
  L.push('- every + unit: e.g. 1 + "year", 3 + "month". Use every 0 for a one-off report. unit is "month" or "year".');
  L.push(`- firstPeriodStart, firstPeriodEnd: the most recent reporting period that has already ended (today is ${formatDate(today, { format: 'D MMM YYYY' })}). firstDueDate: when the report for that period is due.`);
  L.push('- notes: the condition reference and any required content. quote, comment.');
  L.push('');
  L.push('## Parameters EnviroDB knows');
  const groups = new Map<string, string[]>();
  for (const p of ctx.params) {
    const g = PARAMETER_GROUPS.includes(p.group) ? p.group : 'Other';
    groups.set(g, [...(groups.get(g) ?? []), p.name]);
  }
  for (const g of PARAMETER_GROUPS) if (groups.has(g)) L.push(`- ${g}: ${groups.get(g)!.join('; ')}`);
  L.push('');
  L.push('## Existing monitoring sites in this project');
  if (ctx.sites.length) ctx.sites.forEach((s) => L.push(`- ${s.code}${s.name ? ` – ${s.name}` : ''} (${[s.type, s.role].filter(Boolean).join(', ')})`));
  else L.push('None yet.');
  L.push('');
  L.push('## Guideline sets (ids for "guideline" rules)');
  ctx.guidelineSets.forEach((g) => L.push(`- ${g.id}: ${g.name}`));
  const consent = opts.consentText?.trim();
  if (consent) {
    L.push('', '## Consent text', consent);
  }
  const notes = opts.notes?.trim();
  if (notes) {
    L.push('', '## Notes from the user', notes);
  }
  if (!consent) {
    L.push('', '## Consent documents', 'The consent documents are attached to this message. If nothing is attached, ask for them before answering.');
  }
  return `${L.join('\n')}\n`;
}

// ------------------------------------------------------------ reading the answer

export type ConsentAnswer = Record<string, unknown>;

function lineCol(text: string, pos: number): string {
  const before = text.slice(0, pos);
  const line = before.split('\n').length;
  return `line ${line}`;
}

function tryParse(s: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(s) };
  } catch (e) {
    const msg = (e as Error).message;
    const m = msg.match(/position (\d+)/);
    return { ok: false, error: m ? `${msg.replace(/ in JSON at position \d+.*/, '')} (${lineCol(s, +m[1])})` : msg };
  }
}

/** Find and parse the JSON in an AI tool's answer (tolerates code fences, surrounding text and trailing commas). */
export function parseConsentAnswer(text: string): { data: ConsentAnswer } | { error: string } {
  const t = text.replace(/^﻿/, '').trim();
  if (!t) return { error: 'Paste the answer from your AI tool first.' };
  const candidates: string[] = [];
  for (const m of t.matchAll(/```[a-zA-Z]*\s*\n?([\s\S]*?)```/g)) candidates.push(m[1].trim());
  candidates.sort((a, b) => b.length - a.length);
  const first = t.search(/[[{]/);
  if (first >= 0) {
    const last = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
    if (last > first) candidates.push(t.slice(first, last + 1));
  }
  if (!candidates.length) return { error: "Couldn't find any JSON in the answer. Copy the whole answer, including the part between { and }." };
  let lastError = '';
  for (const c of candidates) {
    const variants = [c, c.replace(/,\s*([}\]])/g, '$1'), c.replace(/[“”]/g, '"').replace(/,\s*([}\]])/g, '$1')];
    for (const v of variants) {
      const r = tryParse(v);
      if (!r.ok) {
        lastError ||= r.error;
        continue;
      }
      const value = Array.isArray(r.value) ? { rules: r.value } : r.value;
      if (!value || typeof value !== 'object') continue;
      const o = value as ConsentAnswer;
      if (!['project', 'sites', 'rules', 'schedules', 'reporting', 'notes'].some((k) => k in o)) {
        lastError = "The JSON doesn't contain sites, rules, schedules or reporting – check you copied the right answer.";
        continue;
      }
      return { data: o };
    }
  }
  return { error: `The answer isn't complete, valid JSON (${lastError}). Make sure you copied all of it. If it was cut off, ask the AI tool to continue, or to "reply with valid JSON only".` };
}

// ------------------------------------------------------------ mapping the answer to EnviroDB records

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
function num(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const m = v.replace(/,(?=\d{3}\b)/g, '').match(/-?\d+(\.\d+)?/);
    if (m) return Number(m[0]);
  }
  return undefined;
}
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function toDate(v: unknown): string | undefined {
  const s = str(v);
  if (!s) return undefined;
  return parseDateString(s)?.slice(0, 10) ?? undefined;
}

export const NEW_PARAM = 'new:';

export interface PlanBase {
  key: string;
  include: boolean;
  warnings: string[];
  quote?: string;
  comment?: string;
}
export interface PlanSite extends PlanBase {
  site: Site;
  /** Set when the consent's site is one the project already has – nothing to import. */
  existing?: Site;
  source?: string;
}
export interface PlanRule extends PlanBase {
  rule: Rule;
  /** Parameter name as given by the AI tool. */
  paramText: string;
  /** Possible matches when the parameter is uncertain. */
  paramChoices: string[];
}
export interface PlanSchedule extends PlanBase {
  schedule: MonitoringSchedule;
}
export interface PlanObligation extends PlanBase {
  obligation: ReportObligation;
}
export type ProjectField = 'consents' | 'regulator' | 'client' | 'location' | 'description' | 'yearStartMonth';
export interface PlanProjectField {
  field: ProjectField;
  label: string;
  current: string;
  proposed: string;
  include: boolean;
}
export interface ConsentPlan {
  project: PlanProjectField[];
  sites: PlanSite[];
  rules: PlanRule[];
  schedules: PlanSchedule[];
  obligations: PlanObligation[];
  notes: string[];
  includeNotes: boolean;
}

const FIELD_LABELS: Record<ProjectField, string> = {
  consents: 'Consent number(s)',
  regulator: 'Regulator',
  client: 'Client / consent holder',
  location: 'Location',
  description: 'Description',
  yearStartMonth: 'Reporting year starts',
};

function siteType(v: string): SiteType {
  const s = v.toLowerCase();
  const exact = SITE_TYPES.find((t) => t.toLowerCase() === s);
  if (exact) return exact;
  if (/ground|bore|well|piezo/.test(s)) return 'Groundwater';
  if (/storm/.test(s)) return 'Stormwater';
  if (/waste|effluent|sewage/.test(s)) return 'Wastewater';
  if (/leachate/.test(s)) return 'Leachate';
  if (/discharge|outfall|outlet/.test(s)) return 'Discharge';
  if (/marine|coastal|estuar|harbour|sea/.test(s)) return 'Marine';
  if (/sediment/.test(s)) return 'Sediment';
  if (/soil/.test(s)) return 'Soil';
  if (/air|dust/.test(s)) return 'Air';
  if (/stream|river|creek|lake|surface|wetland|drain/.test(s)) return 'Surface water';
  return 'Other';
}

function siteRole(v: string): SiteRole {
  const s = v.toLowerCase();
  const exact = SITE_ROLES.find((r) => r && r.toLowerCase() === s);
  if (exact) return exact;
  if (/upstream|control|reference/.test(s)) return 'Upstream / control';
  if (/downstream|impact|receiving/.test(s)) return 'Downstream / impact';
  if (/discharge|outfall|outlet/.test(s)) return 'Discharge point';
  if (/background/.test(s)) return 'Background';
  if (/compliance/.test(s)) return 'Compliance point';
  return '';
}

function ruleKind(v: string, r: Record<string, unknown>): RuleKind | null {
  const s = v.toLowerCase().replace(/[^a-z]/g, '');
  if (['threshold', 'limit', 'max', 'maximum', 'min', 'minimum', 'range', 'standard'].includes(s)) return 'threshold';
  if (['statistic', 'statistical', 'percentile', 'median', 'mean', 'average'].includes(s)) return 'statistic';
  if (['change', 'difference', 'increase', 'changefromreference', 'upstreamdownstream'].includes(s)) return 'change';
  if (['consecutive', 'consecutiveexceedances'].includes(s)) return 'consecutive';
  if (['guideline', 'guidelines', 'guidelineset'].includes(s)) return 'guideline';
  if (!s) {
    if (r.guidelineSet) return 'guideline';
    if (r.referenceSite) return 'change';
    if (r.statistic) return 'statistic';
    if (r.consecutive) return 'consecutive';
    return 'threshold';
  }
  return null;
}

function operator(v: string): Operator | null {
  const s = v.toLowerCase().replace(/\s+/g, ' ').trim();
  const map: Record<string, Operator> = {
    '>': '>', gt: '>', above: '>', 'greater than': '>', exceeds: '>', max: '>', maximum: '>',
    '>=': '>=', '≥': '>=', '=>': '>=', gte: '>=', 'at or above': '>=',
    '<': '<', lt: '<', below: '<', 'less than': '<', min: '<', minimum: '<',
    '<=': '<=', '≤': '<=', '=<': '<=', lte: '<=', 'at or below': '<=',
    outside: 'outside', range: 'outside', between: 'outside', 'outside range': 'outside',
  };
  return map[s] ?? null;
}

function statName(v: string): { stat: StatName; percentile?: number } | null {
  const s = v.toLowerCase();
  const p = s.match(/(\d{1,2}(\.\d)?)\s*(st|nd|rd|th)?\s*(%ile|percentile)/);
  if (p) return { stat: 'percentile', percentile: Number(p[1]) };
  if (/geo/.test(s)) return { stat: 'geomean' };
  if (/median/.test(s)) return { stat: 'median' };
  if (/mean|average/.test(s)) return { stat: 'mean' };
  if (/percentile/.test(s)) return { stat: 'percentile' };
  if (/max/.test(s)) return { stat: 'max' };
  if (/min/.test(s)) return { stat: 'min' };
  return null;
}

function windowKind(v: string): WindowKind | null {
  const s = v.toLowerCase().replace(/[^a-z]/g, '');
  if (['year', 'annual', 'yearly', 'reportingyear', 'calendaryear'].includes(s)) return 'year';
  if (['period', 'reportingperiod'].includes(s)) return 'period';
  if (['rollingdays', 'rolling', 'rollingday'].includes(s)) return 'rolling-days';
  if (['rollingsamples', 'rollingsample'].includes(s)) return 'rolling-samples';
  return null;
}

function changeType(v: string): ChangeType | null {
  const s = v.toLowerCase().replace(/[^a-z]/g, '');
  if (['percent', 'percentage', 'pct'].includes(s)) return 'percent';
  if (['absolute', 'increase', 'abs'].includes(s)) return 'absolute';
  if (['absdiff', 'difference', 'change', 'eitherway', 'absolutedifference'].includes(s)) return 'abs-diff';
  return null;
}

function level(v: string): string {
  const s = v.trim();
  if (!s) return 'Limit';
  const exact = RULE_LEVELS.find((l) => l.toLowerCase() === s.toLowerCase());
  if (exact) return exact;
  if (/limit|standard|condition/i.test(s)) return 'Limit';
  const trig = s.match(/trigger\D*([12])\b/i);
  if (trig) return `Trigger ${trig[1]}`;
  if (/trigger/i.test(s)) return 'Trigger';
  if (/alert|warning|early/i.test(s)) return 'Alert';
  if (/target|guideline|objective/i.test(s)) return 'Target';
  return s;
}

function frequency(v: Record<string, unknown>): { every: number; unit: 'day' | 'week' | 'month' | 'year' } | null {
  const unitText = str(v.unit).toLowerCase();
  const every = num(v.every);
  const units: Record<string, 'day' | 'week' | 'month' | 'year'> = { day: 'day', days: 'day', daily: 'day', week: 'week', weeks: 'week', weekly: 'week', month: 'month', months: 'month', monthly: 'month', year: 'year', years: 'year', yearly: 'year', annual: 'year', annually: 'year' };
  if (units[unitText]) return { every: every ?? 1, unit: units[unitText] };
  const f = str(v.frequency ?? v.unit).toLowerCase();
  if (/fortnight/.test(f)) return { every: 2, unit: 'week' };
  if (/quarter/.test(f)) return { every: 3, unit: 'month' };
  if (/six.?month|half.?year|bi.?annual/.test(f)) return { every: 6, unit: 'month' };
  if (/month/.test(f)) return { every: 1, unit: 'month' };
  if (/week/.test(f)) return { every: 1, unit: 'week' };
  if (/annual|year/.test(f)) return { every: 1, unit: 'year' };
  if (/dai/.test(f)) return { every: 1, unit: 'day' };
  return null;
}

/** Map an AI tool's answer to sites, rules, schedules and reporting dates for review. */
export function planConsentImport(answer: ConsentAnswer, ctx: ConsentContext, today = todayStr()): ConsentPlan {
  const { project } = ctx;
  const paramIndex = buildParamIndex(ctx.params);
  const paramById = new Map(ctx.params.map((p) => [p.id, p]));

  // ---- project details
  const pj = obj(answer.project);
  const fields: PlanProjectField[] = [];
  for (const field of ['consents', 'regulator', 'client', 'location', 'description', 'yearStartMonth'] as ProjectField[]) {
    let proposed = str(pj[field]);
    let current = String(project[field] ?? '');
    if (field === 'yearStartMonth') {
      const m = num(pj[field]);
      if (!m || m < 1 || m > 12) continue;
      proposed = MONTH_LONG[Math.round(m) - 1];
      current = MONTH_LONG[(project.yearStartMonth || 1) - 1];
    }
    if (!proposed || proposed === current) continue;
    fields.push({ field, label: FIELD_LABELS[field], current, proposed, include: !current.trim() });
  }

  // ---- sites
  const planSites: PlanSite[] = [];
  const findExisting = (code: string, name: string): Site | undefined => {
    const c = compact(code);
    const byCode = c ? ctx.sites.find((s) => compact(s.code) === c) : undefined;
    if (byCode) return byCode;
    if (name) {
      const m = matchSite(name, ctx.sites);
      if (m.siteId && m.score >= 1000) return ctx.sites.find((s) => s.id === m.siteId);
    }
    return undefined;
  };
  let order = Math.max(0, ...ctx.sites.map((s) => s.order));
  arr(answer.sites).forEach((raw, i) => {
    const s = obj(raw);
    const name = str(s.name);
    let code = str(s.code).slice(0, 20);
    if (!code && !name) return;
    if (!code) code = `Site ${ctx.sites.length + planSites.length + 1}`;
    if (planSites.some((p) => compact(p.site.code) === compact(code))) return; // listed twice
    const existing = findExisting(code, name);
    const warnings: string[] = [];
    const site: Site = {
      id: existing?.id ?? uid('site'),
      projectId: project.id,
      code: existing?.code ?? code,
      name: name || undefined,
      type: siteType(str(s.type) || name),
      role: siteRole(str(s.role) || name),
      aliases: existing ? existing.aliases : [],
      easting: num(s.easting),
      northing: num(s.northing),
      description: str(s.description) || undefined,
      active: true,
      order: existing?.order ?? ++order,
    };
    planSites.push({ key: `site${i}`, include: !existing, site, existing, warnings, source: str(s.source) || undefined, comment: str(s.comment) || undefined });
  });
  // a code mentioned in a rule/schedule but not listed as a site: add it as a new site
  const siteIdFor = (codeRaw: string, where: string[]): string | undefined => {
    const code = codeRaw.trim();
    if (!code) return undefined;
    const c = compact(code);
    const planned = planSites.find((p) => compact(p.site.code) === c || (p.site.name && compact(p.site.name) === c));
    if (planned) return planned.site.id;
    const existing = findExisting(code, code);
    if (existing) return existing.id;
    const site: Site = { id: uid('site'), projectId: project.id, code: code.slice(0, 20), type: 'Other', role: '', aliases: [], active: true, order: ++order };
    planSites.push({ key: `site-auto-${planSites.length}`, include: true, site, warnings: [`Not described as a site, but used by ${where.join(', ')}. Check its name and type after importing.`] });
    return site.id;
  };

  // ---- rules
  const setFor = (v: string): GuidelineSet | undefined => {
    const s = v.toLowerCase().trim();
    if (!s) return undefined;
    return ctx.guidelineSets.find((g) => g.id.toLowerCase() === s) ?? ctx.guidelineSets.find((g) => g.name.toLowerCase() === s || g.shortName.toLowerCase() === s);
  };
  const plannedRules: PlanRule[] = [];
  arr(answer.rules).forEach((raw, i) => {
    const r = obj(raw);
    const warnings: string[] = [];
    const kind = ruleKind(str(r.kind), r);
    const paramText = str(r.parameter ?? r.parameterName ?? r.analyte);
    const name = str(r.name) || [paramText, str(r.condition)].filter(Boolean).join(' – ') || `Rule ${i + 1}`;
    const rule: Rule = {
      id: uid('rule'),
      projectId: project.id,
      name,
      condition: str(r.condition) || undefined,
      level: str(r.level) ? level(str(r.level)) : kind === 'guideline' ? 'Trigger' : 'Limit',
      kind: kind ?? 'threshold',
      siteIds: [],
      operator: '>',
      active: true,
      order: i,
    };
    if (!kind) warnings.push(`Unknown rule type "${str(r.kind)}" – treated as a limit on each result.`);
    const ruleName = `rule "${name}"`;
    rule.siteIds = arr(r.sites ?? r.site)
      .map((c) => siteIdFor(str(c), [ruleName]))
      .filter((x): x is string => !!x);

    // parameter
    let paramChoices: string[] = [];
    if (rule.kind !== 'guideline') {
      if (!paramText) warnings.push('No parameter given – choose one.');
      else {
        const m = matchParameter(paramText, paramIndex);
        paramChoices = m.candidates;
        if (m.parameterId) rule.parameterId = m.parameterId;
        else if (m.candidates.length) {
          rule.parameterId = m.candidates[0];
          warnings.push(`Check the parameter: "${paramText}" could be ${m.candidates.map((id) => paramById.get(id)?.name ?? id).join(' or ')}.`);
        } else warnings.push(`EnviroDB doesn't know "${paramText}" – choose a parameter or add it as a new one.`);
      }
    }
    const param = rule.parameterId ? paramById.get(rule.parameterId) : undefined;

    // operator and values
    const op = operator(str(r.operator));
    const min = num(r.min), max = num(r.max), value = num(r.value);
    if (op) rule.operator = op;
    else if (min !== undefined || max !== undefined) rule.operator = 'outside';
    else if (str(r.operator)) warnings.push(`Unknown operator "${str(r.operator)}" – assumed ">" (above the limit).`);
    if (rule.operator === 'outside') {
      rule.min = min;
      rule.max = max;
      if (min === undefined && max === undefined) warnings.push('No range given.');
    } else {
      rule.value = value;
      if (value === undefined && rule.kind !== 'guideline') warnings.push('No limit value given.');
    }

    // unit
    const unitText = str(r.unit);
    const percentChange = rule.kind === 'change' && (changeType(str(r.changeType)) === 'percent' || (!str(r.changeType) && unitText === '%'));
    if (rule.kind !== 'guideline') {
      if (percentChange || !unitText) rule.unit = param?.unit;
      else if (normUnit(unitText).known || /^ph/i.test(unitText)) {
        rule.unit = unitLabel(unitText);
        if (param && !sameDimension(rule.unit, param.unit)) warnings.push(`The unit ${rule.unit} doesn't fit ${param.name} (${unitLabel(param.unit)}) – check it.`);
      } else {
        rule.unit = param?.unit ?? unitText;
        warnings.push(`Unit "${unitText}" not recognised${param ? ` – assumed ${unitLabel(param.unit)}` : ''}.`);
      }
    }

    // kind-specific
    if (rule.kind === 'statistic') {
      const st = statName(str(r.statistic));
      rule.statistic = st?.stat ?? 'mean';
      if (!st) warnings.push(`Statistic "${str(r.statistic)}" not recognised – assumed the mean.`);
      if (rule.statistic === 'percentile') rule.percentile = num(r.percentile) ?? st?.percentile ?? 95;
      const w = windowKind(str(r.window));
      rule.window = w ?? 'year';
      if (rule.window === 'rolling-days' || rule.window === 'rolling-samples') rule.windowSize = num(r.windowSize) ?? (rule.window === 'rolling-days' ? 365 : 12);
      rule.minSamples = num(r.minSamples) ?? 1;
    }
    if (rule.kind === 'change') {
      rule.changeType = changeType(str(r.changeType)) ?? (unitText === '%' ? 'percent' : 'absolute');
      rule.pairingDays = num(r.pairingDays) ?? 0;
      const ref = str(r.referenceSite ?? r.reference);
      rule.referenceSiteId = ref ? siteIdFor(ref, [ruleName]) : undefined;
      if (!rule.referenceSiteId) warnings.push('No reference (upstream) site given.');
    }
    if (rule.kind === 'consecutive') rule.consecutive = Math.max(2, Math.round(num(r.consecutive) ?? 2));
    if (rule.kind === 'guideline') {
      const set = setFor(str(r.guidelineSet ?? r.guideline));
      rule.guidelineSetId = set?.id;
      rule.hardnessAdjust = r.hardnessAdjust === true;
      if (!set) warnings.push(`Guideline set "${str(r.guidelineSet ?? r.guideline)}" not found.`);
    }
    rule.action = str(r.action) || undefined;
    rule.effectiveFrom = toDate(r.effectiveFrom);
    rule.effectiveTo = toDate(r.effectiveTo);
    plannedRules.push({ key: `rule${i}`, include: true, rule, paramText, paramChoices, warnings, quote: str(r.quote) || undefined, comment: str(r.comment) || undefined });
  });

  // ---- schedules
  const planSchedules: PlanSchedule[] = [];
  arr(answer.schedules).forEach((raw, i) => {
    const s = obj(raw);
    const warnings: string[] = [];
    const f = frequency(s);
    if (!f) warnings.push('Sampling frequency not given – assumed monthly.');
    const name = str(s.name) || 'Monitoring';
    const parameterIds: string[] = [];
    for (const p of arr(s.parameters)) {
      const text = str(p);
      if (!text) continue;
      const m = matchParameter(text, paramIndex);
      const id = m.parameterId ?? (m.candidates.length === 1 ? m.candidates[0] : undefined);
      if (id) parameterIds.includes(id) || parameterIds.push(id);
      else warnings.push(`Parameter "${text}" not recognised – left out of this schedule.`);
    }
    const start = toDate(s.startDate);
    if (str(s.startDate) && !start) warnings.push(`Start date "${str(s.startDate)}" not recognised.`);
    const schedule: MonitoringSchedule = {
      id: uid('sch'),
      projectId: project.id,
      name,
      siteIds: arr(s.sites ?? s.site)
        .map((c) => siteIdFor(str(c), [`schedule "${name}"`]))
        .filter((x): x is string => !!x),
      parameterIds,
      every: Math.max(1, Math.round(f?.every ?? 1)),
      unit: f?.unit ?? 'month',
      startDate: start ?? `${today.slice(0, 7)}-01`,
      endDate: toDate(s.endDate),
      notes: str(s.notes) || undefined,
      active: true,
    };
    if (!schedule.siteIds.length) warnings.push('No sites given – choose them after importing.');
    planSchedules.push({ key: `sch${i}`, include: true, schedule, warnings, quote: str(s.quote) || undefined, comment: str(s.comment) || undefined });
  });

  // ---- reporting
  const planObligations: PlanObligation[] = [];
  arr(answer.reporting ?? answer.reports).forEach((raw, i) => {
    const o = obj(raw);
    const warnings: string[] = [];
    const f = frequency(o);
    let every = Math.max(0, Math.round(num(o.every) ?? f?.every ?? 1));
    let unit: 'month' | 'year' = f?.unit === 'year' ? 'year' : 'month';
    if (f?.unit === 'week' || f?.unit === 'day') {
      warnings.push('Reports more often than monthly are set up as monthly.');
      every = 1;
      unit = 'month';
    }
    if (str(o.unit).toLowerCase().startsWith('year') || (f?.unit === 'year' && every)) unit = 'year';
    if (every === 12 && unit === 'month') {
      every = 1;
      unit = 'year';
    }
    const stepMonths = unit === 'year' ? 12 * Math.max(1, every) : Math.max(1, every);
    let ps = toDate(o.firstPeriodStart);
    let pe = toDate(o.firstPeriodEnd);
    if (ps && !pe) pe = addDays(addMonths(ps, stepMonths), -1);
    if (pe && !ps) ps = addMonths(addDays(pe, 1), -stepMonths);
    if (!ps || !pe) {
      const ry = reportingYear(addDays(reportingYear(today, project.yearStartMonth || 7).start, -1), project.yearStartMonth || 7);
      ps = ry.start;
      pe = ry.end;
      warnings.push('Reporting period not given – set to the last reporting year. Check the dates.');
    }
    let due = toDate(o.firstDueDate);
    if (!due) {
      due = addMonths(pe, 1);
      warnings.push('Due date not given – assumed one month after the period ends.');
    }
    const name = str(o.name) || 'Monitoring report';
    const obligation: ReportObligation = {
      id: uid('obl'),
      projectId: project.id,
      name,
      recipient: str(o.recipient) || undefined,
      every,
      unit,
      firstPeriodStart: ps,
      firstPeriodEnd: pe,
      firstDueDate: due,
      notes: str(o.notes) || undefined,
      templateId: unit === 'year' || every === 0 ? 'tpl-annual' : 'tpl-quarterly',
      active: true,
      submissions: [],
    };
    planObligations.push({ key: `obl${i}`, include: true, obligation, warnings, quote: str(o.quote) || undefined, comment: str(o.comment) || undefined });
  });

  const notes = arr(answer.notes)
    .map((n) => (typeof n === 'string' ? n.trim() : str(obj(n).text ?? obj(n).note)))
    .filter(Boolean);

  return { project: fields, sites: planSites, rules: plannedRules, schedules: planSchedules, obligations: planObligations, notes, includeNotes: notes.length > 0 };
}

/** Parameter id for a parameter to be created on import. */
export function newParamId(name: string): string {
  return `${NEW_PARAM}${slugify(name) || uid()}`;
}

/** Parameters to show for a plan (existing ones plus any to be created), keyed by id. */
export function planParams(plan: ConsentPlan, params: Parameter[]): Map<string, Parameter> {
  const map = new Map(params.map((p) => [p.id, p]));
  for (const r of plan.rules) {
    const id = r.rule.parameterId;
    if (id?.startsWith(NEW_PARAM) && !map.has(id)) map.set(id, { id, name: r.paramText, group: 'Other', unit: r.rule.unit ?? '', aliases: [r.paramText] });
  }
  return map;
}

/** What a planned rule still needs before it can be checked (it's imported paused until then). */
export function ruleBlockers(r: Rule): string[] {
  const out: string[] = [];
  if (r.kind === 'guideline') {
    if (!r.guidelineSetId) out.push('choose a guideline set');
  } else {
    if (!r.parameterId) out.push('choose a parameter');
    if (r.operator === 'outside' ? r.min === undefined && r.max === undefined : r.value === undefined) out.push('needs a limit value');
  }
  if (r.kind === 'change' && !r.referenceSiteId) out.push('needs a reference site');
  return out;
}
