// Two of the same thing made one: a parameter merged into another (a lab's name for zinc that became its own
// parameter, say), or a site into another of its project. Everything that named the one names the other – results,
// rules, schedules, your guideline sets, report templates, formulas – and its names are kept as the other's, so the
// next import matches. What a merge would do is said first (`…Impact`); it can only be undone from a backup.

import { db } from './db';
import { logAudit, whoAmI } from './audit';
import type { Parameter, ReportTemplate, Result, Site } from './types';
import { nowIso } from '../lib/ids';
import { compileFormula } from '../lib/calculated';
import { refText, renameRefs } from '../lib/formula';
import { convert, sameDimension, unitLabel } from '../lib/units';
import { formatDate } from '../lib/dates';

const uniq = <T>(xs: T[]): T[] => [...new Set(xs)];
const lower = (s: string) => s.trim().toLowerCase();

// ------------------------------------------------------------ parameters

export interface ParameterMergeImpact {
  /** Results that become the other parameter's, by project. */
  projects: Array<{ id: string; name: string; results: number }>;
  results: number;
  /** Samples with a result for both: the same value (the one merged in is dropped) … */
  same: number;
  /** … or a different one (the other parameter's stays; the one merged in is kept with the sample, left out of the data). */
  clashes: Array<{ projectId: string; text: string }>;
  rules: number;
  schedules: number;
  /** Your guideline sets with a value for it: the value becomes the other parameter's (unless it has one already). */
  guidelineSets: string[];
  /** Built-in guideline sets with a value for it and none for the other: those values don't apply any more. */
  builtInValues: string[];
  templates: string[];
  /** Calculated parameters whose formulas name it: they'll name the other. */
  formulas: string[];
  /** Names the other parameter takes on. */
  names: string[];
  /** Why they can't be merged (different kinds of unit …) – none when they can. */
  blocked?: string;
}

/** Sections' and rows' parameters in a report template, rewritten by `fix` – the template as it would be, or null when nothing changes. */
function retemplate(t: ReportTemplate, from: string, into: string): ReportTemplate | null {
  let changed = false;
  const walk = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(walk);
    if (!x || typeof x !== 'object') return x;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
      if ((k === 'parameterId' || k === 'paramId') && v === from) {
        out[k] = into;
        changed = true;
      } else if ((k === 'parameterIds' || k === 'excludeParameterIds' || k === 'paramIds') && Array.isArray(v) && v.includes(from)) {
        out[k] = uniq(v.map((id) => (id === from ? into : id)));
        changed = true;
      } else out[k] = walk(v);
    }
    return out;
  };
  const blocks = walk(t.blocks) as ReportTemplate['blocks'];
  return changed ? { ...t, blocks } : null;
}

const typed = (r: Pick<Result, 'value' | 'qualifier' | 'text' | 'unit'>) => `${r.value === null ? (r.text ?? '') : `${r.qualifier}${r.value}`} ${unitLabel(r.unit)}`.trim();

async function parameterMergeWork(fromId: string, intoId: string) {
  const [from, into] = await db.parameters.bulkGet([fromId, intoId]);
  if (!from || !into) throw new Error('One of the parameters isn’t in the library any more.');
  if (from.id === into.id) throw new Error('Choose a different parameter to merge it into.');
  const params = await db.parameters.toArray();
  const moving = await db.results.filter((r) => r.parameterId === fromId).toArray();
  // the samples that have the other parameter too
  const sampleIds = uniq(moving.map((r) => r.sampleId));
  const there = new Map<string, Result>();
  for (const r of await db.results.where('sampleId').anyOf(sampleIds).toArray()) if (r.parameterId === intoId && !r.excluded && !there.has(r.sampleId)) there.set(r.sampleId, r);
  const move: Result[] = [];
  const drop: Result[] = [];
  const clash: Array<{ mine: Result; theirs: Result }> = [];
  for (const r of moving) {
    const other = there.get(r.sampleId);
    if (!other || r.excluded) move.push(r);
    else {
      const mine = r.value === null ? null : convert(r.value, r.unit, other.unit);
      // the same value, as near as the two units can say it
      const same = r.qualifier === other.qualifier && mine !== null && other.value !== null && Math.abs(mine - other.value) <= Math.abs(other.value) * 1e-9;
      if (same) drop.push(r);
      else clash.push({ mine: r, theirs: other });
    }
  }
  const rules = (await db.rules.toArray()).filter((r) => r.parameterId === fromId || r.parameterIds?.includes(fromId));
  const schedules = (await db.schedules.toArray()).filter((s) => s.parameterIds.includes(fromId));
  const sets = (await db.guidelineSets.toArray()).filter((g) => g.values.some((v) => v.parameterId === fromId));
  const templates = (await db.templates.toArray()).map((t) => retemplate(t, fromId, intoId)).filter((t): t is ReportTemplate => !!t);
  // formulas that name it, by any of its names
  const formulas: Array<{ param: Parameter; formula: string }> = [];
  for (const q of params) {
    if (q.id === fromId || !q.formula?.trim()) continue;
    const c = compileFormula(q, params);
    if ('error' in c) continue;
    const refs = [...c.inputs].filter(([, id]) => id === fromId).map(([ref]) => ref);
    if (refs.length) formulas.push({ param: q, formula: renameRefs(q.formula, refs, refText(into)) });
  }
  const has = new Set([into.name, into.short ?? '', ...into.aliases].map(lower));
  const names = uniq([from.name, from.short ?? '', ...from.aliases].map((x) => x.trim()).filter((x) => x && !has.has(lower(x))));
  let blocked: string | undefined;
  if (from.unit && into.unit && !sameDimension(from.unit, into.unit)) blocked = `${from.name} is in ${unitLabel(from.unit)} and ${into.name} in ${unitLabel(into.unit)} – they can’t be the same thing.`;
  else if (into.formula?.trim() && formulas.some((f) => f.param.id === into.id)) blocked = `${into.name} is worked out from ${from.name}: merging them would leave it worked out from itself.`;
  return { from, into, move, drop, clash, rules, schedules, sets, templates, formulas, names, blocked };
}

/** What merging one parameter into another would do. */
export async function parameterMergeImpact(fromId: string, intoId: string): Promise<ParameterMergeImpact> {
  const w = await parameterMergeWork(fromId, intoId);
  const projects = new Map((await db.projects.toArray()).map((p) => [p.id, p.name]));
  const counts = new Map<string, number>();
  for (const r of [...w.move, ...w.drop, ...w.clash.map((c) => c.mine)]) counts.set(r.projectId, (counts.get(r.projectId) ?? 0) + 1);
  const sites = new Map((await db.sites.bulkGet(uniq(w.clash.map((c) => c.mine.siteId)))).filter((s): s is Site => !!s).map((s) => [s.id, s.code]));
  return {
    projects: [...counts].map(([id, results]) => ({ id, name: projects.get(id) ?? 'A project', results })),
    results: w.move.length + w.drop.length + w.clash.length,
    same: w.drop.length,
    clashes: w.clash.map((c) => ({ projectId: c.mine.projectId, text: `${sites.get(c.mine.siteId) ?? ''} ${formatDate(c.mine.date.slice(0, 10))}: ${typed(c.mine)} here, ${typed(c.theirs)} there`.trim() })),
    rules: w.rules.length,
    schedules: w.schedules.length,
    guidelineSets: w.sets.filter((g) => !g.builtIn).map((g) => g.shortName || g.name),
    builtInValues: w.sets.filter((g) => g.builtIn && !g.values.some((v) => v.parameterId === intoId)).map((g) => g.shortName || g.name),
    templates: w.templates.map((t) => t.name),
    formulas: w.formulas.map((f) => f.param.name),
    names: w.names,
    blocked: w.blocked,
  };
}

/**
 * One parameter merged into another, everywhere: its results become the other's (a sample with a value for both keeps
 * the other's – the same value merged in is dropped, a different one is kept with the sample, left out of the data and
 * saying why); rules, schedules, your guideline sets, report templates and formulas name the other; its names become
 * the other's other names; and it's deleted. Returns what was done.
 */
export async function mergeParameters(fromId: string, intoId: string): Promise<{ moved: number; same: number; clashes: number; into: Parameter }> {
  const by = whoAmI() || undefined;
  let out = { moved: 0, same: 0, clashes: 0, into: null as unknown as Parameter };
  const touched = new Set<string>();
  let said = '';
  await db.transaction('rw', [db.projects, db.parameters, db.results, db.samples, db.sites, db.rules, db.schedules, db.guidelineSets, db.templates], async () => {
    const w = await parameterMergeWork(fromId, intoId);
    if (w.blocked) throw new Error(w.blocked);
    const at = nowIso();
    for (const r of w.move) await db.results.update(r.id, { parameterId: intoId });
    await db.results.bulkDelete(w.drop.map((r) => r.id));
    for (const c of w.clash)
      await db.results.update(c.mine.id, { parameterId: intoId, excluded: { reason: `Merged in from “${w.from.name}”: the sample already had a value for ${w.into.name} (${typed(c.theirs)})`, by, at } });
    for (const r of w.rules)
      await db.rules.update(r.id, {
        ...(r.parameterId === fromId ? { parameterId: intoId } : {}),
        ...(r.parameterIds?.includes(fromId) ? { parameterIds: uniq(r.parameterIds.map((id) => (id === fromId ? intoId : id))) } : {}),
      });
    for (const s of w.schedules) await db.schedules.update(s.id, { parameterIds: uniq(s.parameterIds.map((id) => (id === fromId ? intoId : id))) });
    for (const g of w.sets) {
      // a built-in set is left as published; yours gives its value to the other parameter, unless it has one
      if (g.builtIn) continue;
      const taken = g.values.some((v) => v.parameterId === intoId);
      await db.guidelineSets.update(g.id, { values: taken ? g.values.filter((v) => v.parameterId !== fromId) : g.values.map((v) => (v.parameterId === fromId ? { ...v, parameterId: intoId } : v)), updatedAt: at });
    }
    for (const t of w.templates) await db.templates.update(t.id, { blocks: t.blocks, updatedAt: at });
    for (const f of w.formulas) await db.parameters.update(f.param.id, { formula: f.formula });
    // its names go by the other from now on (and come off anything else that had them)
    const names = w.names;
    if (names.length) {
      for (const other of await db.parameters.toArray()) {
        if (other.id === fromId || other.id === intoId) continue;
        const kept = other.aliases.filter((a) => !names.some((n) => lower(n) === lower(a)));
        if (kept.length !== other.aliases.length) await db.parameters.update(other.id, { aliases: kept });
      }
      const removed = (w.into.removedAliases ?? []).filter((x) => !names.some((n) => lower(n) === x));
      await db.parameters.update(intoId, { aliases: uniq([...w.into.aliases, ...names]), removedAliases: removed.length ? removed : undefined });
    }
    await db.parameters.delete(fromId);
    for (const r of [...w.move, ...w.drop, ...w.clash.map((c) => c.mine)]) touched.add(r.projectId);
    for (const r of w.rules) touched.add(r.projectId);
    for (const s of w.schedules) touched.add(s.projectId);
    for (const id of touched) await db.projects.update(id, { updatedAt: at });
    out = { moved: w.move.length, same: w.drop.length, clashes: w.clash.length, into: (await db.parameters.get(intoId))! };
    said = `Parameter ${w.from.name} merged into ${w.into.name}`;
  });
  for (const id of touched) await logAudit(id, 'setup', `${said}${out.clashes ? ` (${out.clashes} sample${out.clashes === 1 ? '' : 's'} had both: the one merged in is kept, left out of the data)` : ''}`);
  return out;
}

// ------------------------------------------------------------ sites

export interface SiteMergeImpact {
  samples: number;
  results: number;
  /** Days with a sample at both sites: both samples are kept. */
  sharedDays: string[];
  rules: number;
  schedules: number;
  /** Rows of the monitoring calendar that name it. */
  calendarRows: number;
  /** Names the other site takes on (the next import of them goes to it). */
  names: string[];
  /** The site merged in has its own coordinates or bore details; the other's are kept (or these, where it has none). */
  details: string[];
  blocked?: string;
}

async function siteMergeWork(fromId: string, intoId: string) {
  const [from, into] = await db.sites.bulkGet([fromId, intoId]);
  if (!from || !into) throw new Error('One of the sites isn’t in the project any more.');
  if (from.id === into.id) throw new Error('Choose a different site to merge it into.');
  const samples = await db.samples.where('siteId').equals(fromId).toArray();
  const results = samples.length ? await db.results.where('sampleId').anyOf(samples.map((s) => s.id)).toArray() : [];
  const theirs = new Set((await db.samples.where('siteId').equals(intoId).toArray()).map((s) => s.date.slice(0, 10)));
  const sharedDays = uniq(samples.map((s) => s.date.slice(0, 10)).filter((d) => theirs.has(d))).sort();
  const rules = (await db.rules.where('projectId').equals(from.projectId).toArray()).filter((r) => r.siteIds.includes(fromId) || r.referenceSiteId === fromId);
  const schedules = (await db.schedules.where('projectId').equals(from.projectId).toArray()).filter((s) => s.siteIds.includes(fromId));
  const rows = (await db.calendarRows.where('projectId').equals(from.projectId).toArray()).filter((r) => r.siteIds?.includes(fromId));
  const has = new Set([into.code, into.name ?? '', ...into.aliases].map(lower));
  const names = uniq([from.code, from.name ?? '', ...from.aliases].map((x) => x.trim()).filter((x) => x && !has.has(lower(x))));
  const details = [
    from.easting !== undefined && from.northing !== undefined ? (into.easting !== undefined && into.northing !== undefined ? `${into.code}’s location is kept` : `${into.code} takes ${from.code}’s location`) : '',
    from.bore && Object.keys(from.bore).length ? (into.bore && Object.keys(into.bore).length ? `${into.code}’s bore details are kept` : `${into.code} takes ${from.code}’s bore details`) : '',
  ].filter(Boolean);
  const blocked = from.projectId !== into.projectId ? 'The two sites are in different projects.' : undefined;
  return { from, into, samples, results, sharedDays, rules, schedules, rows, names, details, blocked };
}

/** What merging one site into another would do. */
export async function siteMergeImpact(fromId: string, intoId: string): Promise<SiteMergeImpact> {
  const w = await siteMergeWork(fromId, intoId);
  return { samples: w.samples.length, results: w.results.length, sharedDays: w.sharedDays, rules: w.rules.length, schedules: w.schedules.length, calendarRows: w.rows.length, names: w.names, details: w.details, blocked: w.blocked };
}

/**
 * One site merged into another of its project: its samples and their results become the other's (a day sampled at
 * both keeps both samples); rules, schedules and calendar rows that named it name the other; its code and names
 * become the other's other names, so the next import of them goes there; and it's deleted.
 */
export async function mergeSites(fromId: string, intoId: string): Promise<{ samples: number; results: number; into: Site }> {
  let out = { samples: 0, results: 0, into: null as unknown as Site };
  let said = '';
  let projectId = '';
  await db.transaction('rw', [db.projects, db.sites, db.samples, db.results, db.rules, db.schedules, db.calendarRows], async () => {
    const w = await siteMergeWork(fromId, intoId);
    if (w.blocked) throw new Error(w.blocked);
    projectId = w.from.projectId;
    for (const s of w.samples) await db.samples.update(s.id, { siteId: intoId });
    for (const r of w.results) await db.results.update(r.id, { siteId: intoId });
    const swap = (ids: string[]) => uniq(ids.map((id) => (id === fromId ? intoId : id)));
    for (const r of w.rules) {
      // a rule that compared the two (downstream against upstream) can't compare a site with itself: its reference comes off
      const referenceSiteId = r.referenceSiteId === fromId ? intoId : r.referenceSiteId;
      const siteIds = swap(r.siteIds);
      await db.rules.update(r.id, { siteIds, referenceSiteId: referenceSiteId && siteIds.length === 1 && siteIds[0] === referenceSiteId ? undefined : referenceSiteId });
    }
    for (const s of w.schedules) await db.schedules.update(s.id, { siteIds: swap(s.siteIds) });
    for (const r of w.rows) await db.calendarRows.update(r.id, { siteIds: swap(r.siteIds ?? []), updatedAt: nowIso() });
    const patch: Partial<Site> = { aliases: uniq([...w.into.aliases, ...w.names]) };
    if ((w.into.easting === undefined || w.into.northing === undefined) && w.from.easting !== undefined && w.from.northing !== undefined) Object.assign(patch, { easting: w.from.easting, northing: w.from.northing });
    if (!(w.into.bore && Object.keys(w.into.bore).length) && w.from.bore) patch.bore = w.from.bore;
    if (!w.into.name && w.from.name) {
      patch.name = w.from.name;
      patch.aliases = patch.aliases!.filter((a) => lower(a) !== lower(w.from.name!));
    }
    if (!w.into.description && w.from.description) patch.description = w.from.description;
    await db.sites.update(intoId, patch);
    await db.sites.delete(fromId);
    await db.projects.update(projectId, { updatedAt: nowIso() });
    out = { samples: w.samples.length, results: w.results.length, into: (await db.sites.get(intoId))! };
    said = `Site ${w.from.code} merged into ${w.into.code}: ${w.samples.length} sample${w.samples.length === 1 ? '' : 's'}, ${w.results.length} result${w.results.length === 1 ? '' : 's'}`;
  });
  if (projectId) await logAudit(projectId, 'site', said);
  return out;
}
