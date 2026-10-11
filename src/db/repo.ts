import { db } from './db';
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

export async function saveProject(p: Project): Promise<void> {
  await db.projects.put({ ...p, updatedAt: nowIso() });
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

export async function saveSite(s: Site): Promise<void> {
  await db.sites.put(s);
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

export async function saveParameter(p: Parameter): Promise<void> {
  await db.parameters.put(p);
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

// ------------------------------------------------------------ rules, notes, schedules, obligations

export function newRule(projectId: string, patch: Partial<Rule> = {}): Rule {
  return { id: uid('rule'), projectId, name: '', level: 'Limit', kind: 'threshold', siteIds: [], operator: '>', active: true, order: Date.now(), ...patch };
}
export async function saveRule(r: Rule) {
  await db.rules.put(r);
  await touchProject(r.projectId);
}
export async function deleteRule(id: string) {
  await db.rules.delete(id);
  await db.notes.where('ruleId').equals(id).delete();
}

export async function saveNote(n: Omit<ExceedanceNote, 'id' | 'updatedAt'>) {
  await db.notes.put({ ...n, id: `${n.ruleId}|${n.key}`, updatedAt: nowIso() });
}

export function newSchedule(projectId: string, patch: Partial<MonitoringSchedule> = {}): MonitoringSchedule {
  return { id: uid('sch'), projectId, name: 'Monthly monitoring', siteIds: [], parameterIds: [], every: 1, unit: 'month', startDate: `${todayStr().slice(0, 7)}-01`, active: true, ...patch };
}
export async function saveSchedule(s: MonitoringSchedule) {
  await db.schedules.put(s);
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
export async function saveObligation(o: ReportObligation) {
  await db.obligations.put(o);
}
export async function deleteObligation(id: string) {
  await db.obligations.delete(id);
}

// ------------------------------------------------------------ guideline sets & templates

export async function saveGuidelineSet(g: GuidelineSet) {
  await db.guidelineSets.put({ ...g, updatedAt: nowIso() });
}
export async function duplicateGuidelineSet(g: GuidelineSet, name?: string): Promise<GuidelineSet> {
  const copy: GuidelineSet = { ...structuredClone(g), id: uid('gl'), name: name ?? `${g.name} (copy)`, shortName: `${g.shortName} (copy)`, builtIn: false, family: 'Custom', updatedAt: nowIso() };
  await db.guidelineSets.put(copy);
  return copy;
}
export async function deleteGuidelineSet(id: string) {
  await db.guidelineSets.delete(id);
}

export async function saveTemplate(t: ReportTemplate) {
  await db.templates.put({ ...t, updatedAt: nowIso() });
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
