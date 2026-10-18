// The consent limits and trigger levels as a table – a row per parameter and level, a column per site – for the
// Compliance tab and the report's trigger levels table alike.

import type { GuidelineSet, Parameter, Rule, Site } from '../db/types';
import { RULE_LEVELS } from '../db/types';
import { expandRules } from './compliance';
import { isLimitLevel } from './analysis';
import { statLabel } from './stats';
import { convert } from './units';
import { fmtNum } from './values';

/** Rules with a value per parameter: they make the table's cells. */
export const LIMIT_KINDS = new Set(['threshold', 'consecutive', 'statistic']);

const levelOrder = (l: string) => {
  const i = (RULE_LEVELS as readonly string[]).indexOf(l);
  return i < 0 ? RULE_LEVELS.length : i;
};

/** Levels in consent order: Limit, Trigger 2, Trigger 1 … */
export const sortLevels = (levels: Iterable<string>) => [...new Set(levels)].sort((x, y) => levelOrder(x) - levelOrder(y) || x.localeCompare(y));

/** A rule's value in the parameter's unit: "100", "6–9", "≥6.5", "2.4\n(median)", "50\n(2 in a row)". */
export function ruleValueText(r: Rule, p: Parameter, sitesNote?: string): string {
  const inUnit = (x: number | undefined) => (x === undefined ? null : convert(x, r.unit || p.unit, p.unit));
  const [lo, hi, v] = [inUnit(r.min), inUnit(r.max), inUnit(r.value)];
  const num = r.operator === 'outside' ? (lo !== null && hi !== null ? `${fmtNum(lo)}–${fmtNum(hi)}` : '') : v === null ? '' : r.operator === '<' || r.operator === '<=' ? `≥${fmtNum(v)}` : fmtNum(v);
  if (!num) return '';
  const q: string[] = [];
  if (r.kind === 'statistic') q.push(statLabel(r.statistic ?? 'mean', r.percentile));
  if (r.kind === 'consecutive') q.push(`${r.consecutive ?? 2} in a row`);
  if (r.limitSetId && r.hardnessAdjust) q.push('HMTV');
  if (sitesNote) q.push(sitesNote);
  return q.length ? `${num}\n(${q.join(', ')})` : num; // the bracket on its own line keeps a column narrow
}

export interface LimitCell {
  text: string;
  /** The rules behind it (a guideline rule's analytes have ids "rule|parameter"). */
  rules: Rule[];
}
export interface LimitRow {
  param: Parameter;
  level: string;
  /** One per column; null where nothing applies. */
  cells: Array<LimitCell | null>;
}
export interface LimitsTable {
  /** The site columns – none when every rule applies at every site (one column then). */
  sites: Site[];
  rows: LimitRow[];
  levels: string[];
  /** Active rules that aren't a value per parameter: changes from a reference site, comparisons with a whole guideline set. */
  other: Rule[];
}

export type LevelChoice = 'all' | 'limits' | 'triggers';

/** The table for these sites (the active ones, say), from a project's active rules. */
export function limitsTable(input: { rules: Rule[]; params: Parameter[]; setMap?: Map<string, GuidelineSet> }, sites: Site[], levels: LevelChoice = 'all'): LimitsTable {
  const ofLevel = (l: string) => levels === 'all' || (levels === 'limits' ? isLimitLevel(l) : !isLimitLevel(l));
  const known = new Set(input.params.map((p) => p.id));
  const rules = expandRules(input.rules, input.setMap).filter(
    (r) => r.active && LIMIT_KINDS.has(r.kind) && !!r.parameterId && known.has(r.parameterId) && ofLevel(r.level) && (!r.siteIds.length || r.siteIds.some((id) => sites.some((s) => s.id === id))),
  );
  const other = input.rules.filter((r) => r.active && ofLevel(r.level) && (r.kind === 'change' || (r.kind === 'guideline' && !r.parameterIds?.length)));
  const params = input.params.filter((p) => rules.some((r) => r.parameterId === p.id));
  const levelList = sortLevels(rules.map((r) => r.level));
  const perSite = rules.some((r) => r.siteIds.length);
  const cols = perSite ? sites.filter((s) => rules.some((r) => !r.siteIds.length || r.siteIds.includes(s.id))) : [];
  const cell = (rs: Rule[], p: Parameter): LimitCell | null => {
    const text = [...new Set(rs.map((r) => ruleValueText(r, p)).filter(Boolean))].join('\n');
    return text ? { text, rules: rs } : null;
  };
  const rows: LimitRow[] = [];
  for (const p of params)
    for (const level of levelList) {
      const here = rules.filter((r) => r.level === level && r.parameterId === p.id);
      const cells = perSite ? cols.map((s) => cell(here.filter((r) => !r.siteIds.length || r.siteIds.includes(s.id)), p)) : [cell(here, p)];
      if (cells.some(Boolean)) rows.push({ param: p, level, cells });
    }
  return { sites: cols, rows, levels: levelList, other };
}
