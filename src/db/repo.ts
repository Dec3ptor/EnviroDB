import type { Table } from 'dexie';
import { db } from './db';
import { same } from '../sync/model';
import type {
  ExceedanceNote,
  GuidelineSet,
  MonitoringSchedule,
  Parameter,
  Project,
  ReportObligation,
  ReportTemplate,
  Rule,
  Site,
} from './types';
import { nowIso, slugify, uid } from '../lib/ids';
import { todayStr } from '../lib/dates';

// ------------------------------------------------------------ saving edits

/**
 * Saves a record edited on screen. Given `before` – the record as the screen had it – only the fields changed since
 * are written, onto the record as it is now, so a colleague's change to anything else in the meantime is kept.
 * (Without `before` the record is saved as it is: new records.) A record a colleague deleted meanwhile is put back.
 */
export async function saveEdited<T extends { id: string }>(table: Table<T, string>, next: T, before?: T): Promise<T> {
  if (!before) {
    await table.put(next);
    return next;
  }
  const changes: Record<string, unknown> = {};
  const a = before as Record<string, unknown>, b = next as Record<string, unknown>;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (!same(a[k], b[k])) changes[k] = b[k];
  return table.db.transaction('rw', table, async () => {
    const cur = await table.get(next.id);
    const saved = cur ? ({ ...cur, ...changes } as T) : next;
    if (!cur || Object.keys(changes).length) await table.put(saved);
    return saved;
  });
}

// ------------------------------------------------------------ projects

export function newProject(patch: Partial<Project> = {}): Project {
  const now = nowIso();
  return {
    id: uid('prj'),
    name: 'New project',
    status: 'active',
    guidelineSetIds: ['anzg-fw-95'],
    hardnessAdjust: true,
    ndHandling: 'dl',
    percentileMethod: 'excel',
    yearStartMonth: 7,
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}

export async function saveProject(p: Project, before?: Project): Promise<void> {
  await saveEdited(db.projects, { ...p, updatedAt: nowIso() }, before);
}

export async function touchProject(projectId: string): Promise<void> {
  await db.projects.update(projectId, { updatedAt: nowIso() });
}

export async function deleteProject(projectId: string): Promise<void> {
  await db.transaction('rw', [db.projects, db.sites, db.samples, db.results, db.rules, db.notes, db.schedules, db.obligations, db.imports], async () => {
    await db.results.where('projectId').equals(projectId).delete();
    await db.samples.where('projectId').equals(projectId).delete();
    await db.sites.where('projectId').equals(projectId).delete();
    await db.rules.where('projectId').equals(projectId).delete();
    await db.notes.where('projectId').equals(projectId).delete();
    await db.schedules.where('projectId').equals(projectId).delete();
    await db.obligations.where('projectId').equals(projectId).delete();
    await db.imports.where('projectId').equals(projectId).delete();
    await db.projects.delete(projectId);
  });
}

// ------------------------------------------------------------ sites

export function newSite(projectId: string, patch: Partial<Site> = {}): Site {
  return { id: uid('site'), projectId, code: '', type: 'Surface water', role: '', aliases: [], active: true, order: 0, ...patch };
}

export async function saveSite(s: Site, before?: Site): Promise<void> {
  await saveEdited(db.sites, s, before);
  await touchProject(s.projectId);
}

export async function deleteSite(siteId: string): Promise<void> {
  await db.transaction('rw', [db.sites, db.samples, db.results], async () => {
    const samples = await db.samples.where('siteId').equals(siteId).primaryKeys();
    await db.results.where('sampleId').anyOf(samples).delete();
    await db.samples.bulkDelete(samples);
    await db.sites.delete(siteId);
  });
}

export async function addSiteAlias(siteId: string, alias: string): Promise<void> {
  const a = alias.trim();
  if (!a) return;
  const s = await db.sites.get(siteId);
  if (!s) return;
  const lower = [s.code, s.name ?? '', ...s.aliases].map((x) => x.toLowerCase());
  if (lower.includes(a.toLowerCase())) return;
  await db.sites.update(siteId, { aliases: [...s.aliases, a] });
}

// ------------------------------------------------------------ parameters

export async function saveParameter(p: Parameter, before?: Parameter): Promise<void> {
  await saveEdited(db.parameters, p, before);
}

export async function createParameter(name: string, unit: string, group = 'Other'): Promise<Parameter> {
  let id = slugify(name) || uid('p');
  if (await db.parameters.get(id)) id = `${id}-${uid().slice(0, 4)}`;
  const p: Parameter = { id, name, group, unit, aliases: [name], order: 10000 };
  await db.parameters.put(p);
  return p;
}

export async function addParameterAlias(paramId: string, alias: string): Promise<void> {
  const a = alias.trim();
  if (!a) return;
  const p = await db.parameters.get(paramId);
  if (!p) return;
  if ([p.name, ...p.aliases].some((x) => x.toLowerCase() === a.toLowerCase())) return;
  await db.parameters.update(paramId, { aliases: [...p.aliases, a] });
}

/** What deleting a parameter – from the library, or from one project – takes with it. */
export interface ParameterImpact {
  /** Projects with results for it, and how many. */
  projects: Array<{ id: string; name: string; results: number }>;
  results: number;
  /** Samples with no other results, which go too. */
  emptySamples: number;
  /** Rules for it alone (limits, triggers …), which go with it. */
  rules: Array<{ id: string; name: string; projectId: string }>;
  /** Sampling schedules that name it; they keep their other parameters. */
  schedules: Array<{ id: string; name: string; projectId: string }>;
  /** Your own guideline sets with a value for it (library deletions only; built-in sets are left as published). */
  guidelineSets: Array<{ id: string; name: string }>;
  /** Report templates with sections that choose it; those sections leave it out. */
  templates: Array<{ id: string; name: string }>;
}

const blockParams = (b: ReportTemplate['blocks'][number]): string[] => ('parameterIds' in b && Array.isArray(b.parameterIds) ? b.parameterIds : []);

async function parameterWork(paramId: string, projectId?: string) {
  const projects = projectId ? (await db.projects.bulkGet([projectId])).filter((p): p is Project => !!p) : await db.projects.toArray();
  const results = (await Promise.all(projects.map((p) => db.results.where('[projectId+parameterId]').equals([p.id, paramId]).toArray()))).flat();
  // samples whose only results are these
  const sampleIds = [...new Set(results.map((r) => r.sampleId))];
  const others = new Set((await db.results.where('sampleId').anyOf(sampleIds).toArray()).filter((r) => r.parameterId !== paramId).map((r) => r.sampleId));
  const emptySamples = sampleIds.filter((id) => !others.has(id));
  const inScope = (x: { projectId: string }) => !projectId || x.projectId === projectId;
  const rules = (await db.rules.toArray()).filter((r) => r.parameterId === paramId && inScope(r));
  const schedules = (await db.schedules.toArray()).filter((s) => s.parameterIds.includes(paramId) && inScope(s));
  const sets = projectId ? [] : (await db.guidelineSets.toArray()).filter((g) => !g.builtIn && g.values.some((v) => v.parameterId === paramId));
  const templates = projectId ? [] : (await db.templates.toArray()).filter((t) => t.blocks.some((b) => blockParams(b).includes(paramId)));
  return { projects, results, emptySamples, rules, schedules, sets, templates };
}

export async function parameterImpact(paramId: string, projectId?: string): Promise<ParameterImpact> {
  const w = await parameterWork(paramId, projectId);
  const counts = new Map<string, number>();
  for (const r of w.results) counts.set(r.projectId, (counts.get(r.projectId) ?? 0) + 1);
  return {
    projects: w.projects.filter((p) => counts.has(p.id)).map((p) => ({ id: p.id, name: p.name, results: counts.get(p.id)! })),
    results: w.results.length,
    emptySamples: w.emptySamples.length,
    rules: w.rules.map((r) => ({ id: r.id, name: r.name || r.condition || r.level, projectId: r.projectId })),
    schedules: w.schedules.map((s) => ({ id: s.id, name: s.name, projectId: s.projectId })),
    guidelineSets: w.sets.map((g) => ({ id: g.id, name: g.name })),
    templates: w.templates.map((t) => ({ id: t.id, name: t.name })),
  };
}

/**
 * Deletes a parameter's results (and samples left with none), its rules and their notes, and takes it off sampling
 * schedules – in one project, or (without `projectId`) everywhere, along with your guideline sets' values for it and
 * the parameter itself. Report templates keep their choice: a section leaves out a parameter that isn't there.
 */
export async function deleteParameter(paramId: string, projectId?: string): Promise<void> {
  await db.transaction('rw', [db.projects, db.parameters, db.results, db.samples, db.rules, db.notes, db.schedules, db.guidelineSets, db.templates], async () => {
    const w = await parameterWork(paramId, projectId);
    await db.results.bulkDelete(w.results.map((r) => r.id));
    await db.samples.bulkDelete(w.emptySamples);
    await db.rules.bulkDelete(w.rules.map((r) => r.id));
    if (w.rules.length) await db.notes.where('ruleId').anyOf(w.rules.map((r) => r.id)).delete();
    for (const s of w.schedules) await db.schedules.update(s.id, { parameterIds: s.parameterIds.filter((id) => id !== paramId) });
    for (const g of w.sets) await db.guidelineSets.update(g.id, { values: g.values.filter((v) => v.parameterId !== paramId), updatedAt: nowIso() });
    if (!projectId) await db.parameters.delete(paramId);
    const touched = new Set([...w.results.map((r) => r.projectId), ...w.rules.map((r) => r.projectId)]);
    for (const id of touched) await db.projects.update(id, { updatedAt: nowIso() });
  });
}

// ------------------------------------------------------------ rules, notes, schedules, obligations

export function newRule(projectId: string, patch: Partial<Rule> = {}): Rule {
  return { id: uid('rule'), projectId, name: '', level: 'Limit', kind: 'threshold', siteIds: [], operator: '>', active: true, order: Date.now(), ...patch };
}
export async function saveRule(r: Rule, before?: Rule) {
  await saveEdited(db.rules, r, before);
  await touchProject(r.projectId);
}
export async function deleteRule(id: string) {
  await db.rules.delete(id);
  await db.notes.where('ruleId').equals(id).delete();
}

export async function saveNote(n: Omit<ExceedanceNote, 'id' | 'updatedAt'>, before?: ExceedanceNote) {
  await saveEdited(db.notes, { ...n, id: `${n.ruleId}|${n.key}`, updatedAt: nowIso() }, before);
}

export function newSchedule(projectId: string, patch: Partial<MonitoringSchedule> = {}): MonitoringSchedule {
  return { id: uid('sch'), projectId, name: 'Monthly monitoring', siteIds: [], parameterIds: [], every: 1, unit: 'month', startDate: `${todayStr().slice(0, 7)}-01`, active: true, ...patch };
}
export async function saveSchedule(s: MonitoringSchedule, before?: MonitoringSchedule) {
  await saveEdited(db.schedules, s, before);
}
export async function deleteSchedule(id: string) {
  await db.schedules.delete(id);
}

export function newObligation(projectId: string, patch: Partial<ReportObligation> = {}): ReportObligation {
  const y = +todayStr().slice(0, 4);
  return {
    id: uid('obl'),
    projectId,
    name: 'Annual monitoring report',
    every: 1,
    unit: 'year',
    firstPeriodStart: `${y - 1}-07-01`,
    firstPeriodEnd: `${y}-06-30`,
    firstDueDate: `${y}-09-30`,
    active: true,
    submissions: [],
    templateId: 'tpl-annual',
    ...patch,
  };
}
export async function saveObligation(o: ReportObligation, before?: ReportObligation) {
  await saveEdited(db.obligations, o, before);
}
/** Marks a reporting period submitted (or not), starting from the obligation as saved now. */
export async function setSubmitted(obligationId: string, period: { periodStart: string; periodEnd: string }, submittedOn: string | null) {
  await db.transaction('rw', db.obligations, async () => {
    const o = await db.obligations.get(obligationId);
    if (!o) return;
    const others = o.submissions.filter((s) => s.periodEnd !== period.periodEnd);
    await db.obligations.update(obligationId, { submissions: submittedOn ? [...others, { periodStart: period.periodStart, periodEnd: period.periodEnd, submittedOn }] : others });
  });
}
export async function deleteObligation(id: string) {
  await db.obligations.delete(id);
}

// ------------------------------------------------------------ guideline sets & templates

export async function saveGuidelineSet(g: GuidelineSet, before?: GuidelineSet) {
  await saveEdited(db.guidelineSets, { ...g, updatedAt: nowIso() }, before);
}
export async function duplicateGuidelineSet(g: GuidelineSet, name?: string): Promise<GuidelineSet> {
  const copy: GuidelineSet = { ...structuredClone(g), id: uid('gl'), name: name ?? `${g.name} (copy)`, shortName: `${g.shortName} (copy)`, builtIn: false, family: 'Custom', updatedAt: nowIso() };
  await db.guidelineSets.put(copy);
  return copy;
}
export async function deleteGuidelineSet(id: string) {
  await db.guidelineSets.delete(id);
}

/** Saves a template (see saveEdited) and returns it as saved. */
export async function saveTemplate(t: ReportTemplate, before?: ReportTemplate): Promise<ReportTemplate> {
  return saveEdited(db.templates, { ...t, updatedAt: nowIso() }, before);
}
export async function duplicateTemplate(t: ReportTemplate, name?: string): Promise<ReportTemplate> {
  const copy: ReportTemplate = {
    ...structuredClone(t),
    id: uid('tpl'),
    name: name ?? `${t.name} (custom)`,
    builtIn: false,
    blocks: t.blocks.map((b) => ({ ...structuredClone(b), id: uid('b') })),
    updatedAt: nowIso(),
  };
  await db.templates.put(copy);
  return copy;
}
export async function deleteTemplate(id: string) {
  await db.templates.delete(id);
}

// ------------------------------------------------------------ imports / data

export async function deleteImport(importId: string): Promise<void> {
  await db.transaction('rw', [db.samples, db.results, db.imports], async () => {
    await db.results.where('importId').equals(importId).delete();
    // remove samples left without results
    const samples = await db.samples.where('importId').equals(importId).toArray();
    for (const s of samples) {
      const n = await db.results.where('sampleId').equals(s.id).count();
      if (!n) await db.samples.delete(s.id);
    }
    await db.imports.delete(importId);
  });
}

export async function deleteSamples(sampleIds: string[]): Promise<void> {
  await db.transaction('rw', [db.samples, db.results], async () => {
    await db.results.where('sampleId').anyOf(sampleIds).delete();
    await db.samples.bulkDelete(sampleIds);
  });
}
