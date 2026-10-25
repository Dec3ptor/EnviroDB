import { db, DATA_TABLES, DEFAULT_SETTINGS, ensureBuiltIns, getSettings, REPORT_WORK, saveSettings, type DataTable } from './db';
import type { MetaRecord, Project, Settings } from './types';
import { uid } from '../lib/ids';
import { todayStr } from '../lib/dates';
import { APP_VERSION } from '../data/releases';

export const BACKUP_APP = 'EnviroDB';
export const BACKUP_VERSION = 1;

export interface WorkspaceBackup {
  app: typeof BACKUP_APP;
  kind: 'workspace' | 'project';
  version: number;
  exportedAt: string;
  /** The EnviroDB version that made it. */
  appVersion?: string;
  data: Partial<Record<DataTable, unknown[]>>;
  /** Workspace backups: report work (commentary, figures, layout changes, site choices) and the settings. */
  meta?: MetaRecord[];
}

/**
 * Everything in the workspace. With `reportWork` (your own downloads), also your report work – commentary,
 * figures, layout changes and site choices; the team's daily copies leave it out, as it is each person's own.
 */
export async function exportWorkspace(opts: { reportWork?: boolean } = { reportWork: true }): Promise<WorkspaceBackup> {
  const data: WorkspaceBackup['data'] = {};
  let meta: MetaRecord[] = [];
  await db.transaction('r', [...DATA_TABLES.map((t) => db.table(t)), db.meta], async () => {
    for (const t of DATA_TABLES) {
      let rows = await db.table(t).toArray();
      if (t === 'guidelineSets' || t === 'templates') rows = rows.filter((r: { builtIn?: boolean }) => !r.builtIn);
      data[t] = rows;
    }
    // the team's settings and your own, together as before
    meta = [{ key: 'settings', value: await getSettings() }, ...(opts.reportWork ? (await db.meta.toArray()).filter((r) => REPORT_WORK.test(r.key)) : [])];
  });
  return { app: BACKUP_APP, kind: 'workspace', version: BACKUP_VERSION, exportedAt: new Date().toISOString(), appVersion: APP_VERSION, data, meta };
}

/**
 * Put back a backup's report work and settings. Replace: as they were saved. Merge: report work from the backup is
 * added (and wins for the same report); your current settings stay, with any that are blank filled in.
 */
async function restoreMeta(meta: MetaRecord[] | undefined, mode: 'replace' | 'merge'): Promise<void> {
  if (!Array.isArray(meta)) return;
  const work = meta.filter((r) => r && typeof r.key === 'string' && REPORT_WORK.test(r.key));
  const saved = meta.find((r) => r?.key === 'settings')?.value as Partial<Settings> | undefined;
  await db.transaction('rw', db.meta, async () => {
    // a team copy has no report work: yours stays as it is
    if (mode === 'replace' && work.length) {
      const old = (await db.meta.toCollection().primaryKeys()).filter((k) => typeof k === 'string' && REPORT_WORK.test(k));
      await db.meta.bulkDelete(old);
    }
    if (work.length) await db.meta.bulkPut(work);
  });
  if (!saved || typeof saved !== 'object') return;
  const cur = (await getSettings()) as unknown as Record<string, unknown>;
  const from = saved as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  if (mode === 'replace') {
    // as saved – but this browser's last backup date stays its own
    for (const k of new Set([...Object.keys(cur), ...Object.keys(from)])) if (k !== 'lastBackupAt') patch[k] = from[k] ?? (DEFAULT_SETTINGS as unknown as Record<string, unknown>)[k];
    // team keys are never lost to an older backup: without them, what phones locked with them wouldn't open
    patch.teamKey = keepTeamKeys(cur.teamKey as Settings['teamKey'], from.teamKey as Settings['teamKey']);
  } else {
    const blank = (v: unknown) => v === undefined || v === null || v === '';
    for (const [k, v] of Object.entries(from)) if (blank(cur[k]) && !blank(v)) patch[k] = v;
  }
  await saveSettings(patch as Partial<Settings>);
}

/** The team key as a backup had it (on or off), keeping every key this workspace has as well. */
export function keepTeamKeys(cur: Settings['teamKey'], from: Settings['teamKey']): Settings['teamKey'] {
  const keys = [...(from?.keys ?? [])];
  for (const k of cur?.keys ?? []) if (!keys.some((x) => x.id === k.id)) keys.push(k);
  return keys.length ? { on: !!from?.on && !!from.keys.length, keys } : undefined;
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeFileName(fileName);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** File names restricted to plain ASCII (macrons and en dashes make some browsers fall back to "download"). */
export function safeFileName(s: string) {
  return s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2012-\u2015]/g, '-')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
}

export async function downloadWorkspaceBackup(): Promise<void> {
  const backup = await exportWorkspace();
  downloadBlob(new Blob([JSON.stringify(backup)], { type: 'application/json' }), `EnviroDB-backup-${todayStr()}.json`);
  await saveSettings({ lastBackupAt: new Date().toISOString() });
}

function assertBackup(obj: unknown): asserts obj is WorkspaceBackup {
  const b = obj as WorkspaceBackup;
  if (!b || b.app !== BACKUP_APP || typeof b.data !== 'object') throw new Error('This file is not an EnviroDB backup or project file.');
  if (b.version > BACKUP_VERSION) throw new Error('This file was created by a newer version of EnviroDB.');
}

/** Restore a workspace backup. 'replace' wipes current data first; 'merge' adds/overwrites by id. */
export async function restoreWorkspace(obj: unknown, mode: 'replace' | 'merge'): Promise<void> {
  assertBackup(obj);
  if (obj.kind === 'project') {
    await importProjectPackage(obj);
    return;
  }
  await db.transaction('rw', DATA_TABLES.map((t) => db.table(t)), async () => {
    if (mode === 'replace') for (const t of DATA_TABLES) await db.table(t).clear();
    for (const t of DATA_TABLES) {
      const rows = obj.data[t];
      if (Array.isArray(rows) && rows.length) await db.table(t).bulkPut(rows);
    }
  });
  await restoreMeta(obj.meta, mode);
  await ensureBuiltIns();
}

// ------------------------------------------------------------ single-project packages (share with a colleague)

export async function exportProjectPackage(projectId: string): Promise<WorkspaceBackup> {
  const project = await db.projects.get(projectId);
  if (!project) throw new Error('Project not found');
  const [sites, samples, results, rules, notes, schedules, obligations, imports, calendarRows, qa, conditions, assessments, issues, archive, series, seriesDays, audit] = await Promise.all([
    db.sites.where('projectId').equals(projectId).toArray(),
    db.samples.where('projectId').equals(projectId).toArray(),
    db.results.where('projectId').equals(projectId).toArray(),
    db.rules.where('projectId').equals(projectId).toArray(),
    db.notes.where('projectId').equals(projectId).toArray(),
    db.schedules.where('projectId').equals(projectId).toArray(),
    db.obligations.where('projectId').equals(projectId).toArray(),
    db.imports.where('projectId').equals(projectId).toArray(),
    db.calendarRows.where('projectId').equals(projectId).toArray(),
    db.qa.where('projectId').equals(projectId).toArray(),
    db.conditions.where('projectId').equals(projectId).toArray(),
    db.assessments.where('projectId').equals(projectId).toArray(),
    db.issues.where('projectId').equals(projectId).toArray(),
    db.archive.where('projectId').equals(projectId).toArray(),
    db.series.where('projectId').equals(projectId).toArray(),
    db.seriesDays.where('projectId').equals(projectId).toArray(),
    db.audit.where('projectId').equals(projectId).toArray(),
  ]);
  const calendarMarks = calendarRows.length ? await db.calendarMarks.where('item').anyOf(calendarRows.map((r) => r.id)).toArray() : [];
  const usedParams = new Set(results.map((r) => r.parameterId));
  rules.forEach((r) => r.parameterId && usedParams.add(r.parameterId));
  const parameters = (await db.parameters.toArray()).filter((p) => usedParams.has(p.id));
  const setIds = new Set([...project.guidelineSetIds, ...rules.flatMap((r) => [r.guidelineSetId, r.limitSetId]).filter(Boolean)] as string[]);
  const guidelineSets = (await db.guidelineSets.toArray()).filter((g) => !g.builtIn && setIds.has(g.id));
  const tplIds = new Set(obligations.map((o) => o.templateId).filter(Boolean) as string[]);
  const templates = (await db.templates.toArray()).filter((t) => !t.builtIn && tplIds.has(t.id));
  return {
    app: BACKUP_APP,
    kind: 'project',
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    data: { projects: [project], sites, samples, results, rules, notes, schedules, obligations, imports, parameters, guidelineSets, templates, calendarRows, calendarMarks, qa, conditions, assessments, issues, archive, series, seriesDays, audit },
  };
}

export async function downloadProjectPackage(projectId: string): Promise<void> {
  const pkg = await exportProjectPackage(projectId);
  const p = pkg.data.projects![0] as Project;
  downloadBlob(new Blob([JSON.stringify(pkg)], { type: 'application/json' }), `${safeFileName(p.name)} - EnviroDB project.json`);
}

/** Import a project package. If the project already exists it is imported as a copy with new ids. */
export async function importProjectPackage(obj: unknown): Promise<string> {
  assertBackup(obj);
  const d = obj.data;
  const project = (d.projects?.[0] as Project | undefined) ?? null;
  if (!project) throw new Error('The file contains no project.');
  const exists = !!(await db.projects.get(project.id));
  const map = new Map<string, string>();
  const remap = (id: string | undefined) => {
    if (!id || !exists) return id;
    if (!map.has(id)) map.set(id, uid('x'));
    return map.get(id)!;
  };
  type Row = Record<string, unknown> & { id: string };
  const rows = (t: DataTable) => (d[t] ?? []) as Row[];
  const newProjectId = remap(project.id)!;
  await db.transaction('rw', DATA_TABLES.map((t) => db.table(t)), async () => {
    // reference data: parameters keep ids (merge aliases), custom sets/templates are added if missing
    for (const p of rows('parameters')) {
      const cur = await db.parameters.get(p.id);
      if (!cur) await db.parameters.put(p as never);
      else await db.parameters.update(p.id, { aliases: Array.from(new Set([...cur.aliases, ...((p.aliases as string[]) ?? [])])) });
    }
    for (const g of rows('guidelineSets')) if (!(await db.guidelineSets.get(g.id))) await db.guidelineSets.put(g as never);
    for (const t of rows('templates')) if (!(await db.templates.get(t.id))) await db.templates.put(t as never);

    await db.projects.put({ ...project, id: newProjectId, name: exists ? `${project.name} (imported)` : project.name });
    const put = async (t: DataTable, fix: (r: Row) => Row) => {
      const list = rows(t).map(fix);
      if (list.length) await db.table(t).bulkPut(list);
    };
    await put('sites', (r) => ({ ...r, id: remap(r.id)!, projectId: newProjectId }));
    await put('audit', (r) => ({ ...r, id: exists ? uid('aud') : r.id, projectId: newProjectId }));
    await put('imports', (r) => ({ ...r, id: remap(r.id)!, projectId: newProjectId }));
    await put('samples', (r) => ({ ...r, id: remap(r.id)!, projectId: newProjectId, siteId: remap(r.siteId as string)!, importId: remap(r.importId as string), qcOf: remap(r.qcOf as string) }));
    await put('results', (r) => ({
      ...r, id: remap(r.id)!, projectId: newProjectId, sampleId: remap(r.sampleId as string)!, siteId: remap(r.siteId as string)!, importId: remap(r.importId as string),
    }));
    await put('rules', (r) => ({
      ...r, id: remap(r.id)!, projectId: newProjectId, siteIds: ((r.siteIds as string[]) ?? []).map((s) => remap(s)!), referenceSiteId: remap(r.referenceSiteId as string),
    }));
    await put('notes', (r) => {
      const ruleId = remap(r.ruleId as string)!;
      return { ...r, id: `${ruleId}|${r.key}`, projectId: newProjectId, ruleId };
    });
    await put('schedules', (r) => ({ ...r, id: remap(r.id)!, projectId: newProjectId, siteIds: ((r.siteIds as string[]) ?? []).map((s) => remap(s)!) }));
    await put('obligations', (r) => ({ ...r, id: remap(r.id)!, projectId: newProjectId }));
    await put('calendarRows', (r) => ({ ...r, id: remap(r.id)!, projectId: newProjectId, siteIds: (r.siteIds as string[] | undefined)?.map((s) => remap(s)!) }));
    await put('calendarMarks', (r) => {
      const item = remap(r.item as string)!;
      return { ...r, id: r.field ? `${item}|${String(r.month).slice(0, 4)}|${r.field}` : `${item}|${r.month}`, item };
    });
    // the compliance register: conditions and their grades (which name the conditions)
    await put('conditions', (r) => ({
      ...r,
      id: remap(r.id)!,
      projectId: newProjectId,
      ruleIds: (r.ruleIds as string[] | undefined)?.map((x) => remap(x)!),
      scheduleIds: (r.scheduleIds as string[] | undefined)?.map((x) => remap(x)!),
      obligationIds: (r.obligationIds as string[] | undefined)?.map((x) => remap(x)!),
    }));
    await put('assessments', (r) => {
      const conditionId = remap(r.conditionId as string)!;
      return { ...r, id: `${conditionId}|${r.start}|${r.end}`, projectId: newProjectId, conditionId };
    });
    // continuous data: the series and their daily values (which name the series)
    await put('series', (r) => ({ ...r, id: remap(r.id)!, projectId: newProjectId }));
    await put('seriesDays', (r) => {
      const seriesId = remap(r.seriesId as string)!;
      return { ...r, id: `${seriesId}|${r.year}`, projectId: newProjectId, seriesId };
    });
    // issued reports and what they were built from – not into a copy: the issues are the original project's
    if (!exists) {
      await put('issues', (r) => r);
      await put('archive', (r) => r);
    }
    // the QA/QC log: its keys name samples, which a copy renames
    const ids = (list: unknown) => (list as string[] | undefined)?.map((x) => (exists && map.has(x) ? map.get(x)! : x));
    await put('qa', (r) => {
      const key = String(r.key).split('|').map((x) => (exists && map.has(x) ? map.get(x)! : x)).join('|');
      const swap = r.swap as { a: string; b: string; parameterIds?: string[] } | undefined;
      return { ...r, id: `${newProjectId}|${key}`, projectId: newProjectId, key, siteIds: ids(r.siteIds), resultIds: ids(r.resultIds), swap: swap && { ...swap, a: ids([swap.a])![0], b: ids([swap.b])![0] } };
    });
  });
  return newProjectId;
}

export async function readJsonFile(file: File): Promise<unknown> {
  const text = await file.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Could not read the file – it is not valid JSON.');
  }
}
