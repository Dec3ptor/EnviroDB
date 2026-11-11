// One project put back from a backup of the whole workspace – a daily copy in the shared folder's backups folder, or a
// backup downloaded – without touching the others: what's been deleted since put back (everything changed since is
// left as it is now), or the project as it was brought in beside the one there is, to compare.

import { db, DATA_TABLES, type DataTable } from './db';
import { logAudit } from './audit';
import { BACKUP_APP, BACKUP_VERSION, importProjectPackage, type WorkspaceBackup } from './backup';
import type { Project, ReportTemplate, Result, Rule } from './types';
import { BACKUPS_DIR } from '../sync/model';
import type { WorkspaceFolder } from '../sync/folder';
import { formatDate } from '../lib/dates';

type Row = Record<string, unknown> & { id: string };
const rowsOf = (b: WorkspaceBackup, t: DataTable): Row[] => (Array.isArray(b.data[t]) ? (b.data[t] as Row[]) : []);

/** The tables that hold a project's own records, each with the project's id. */
const PROJECT_TABLES: DataTable[] = ['sites', 'samples', 'results', 'rules', 'notes', 'schedules', 'obligations', 'imports', 'calendarRows', 'qa', 'conditions', 'assessments', 'issues', 'archive', 'series', 'seriesDays', 'audit', 'files'];

/** What each kind of record is called, one and many. */
const NAMES: Partial<Record<DataTable, [string, string]>> = {
  sites: ['site', 'sites'],
  samples: ['sample', 'samples'],
  results: ['result', 'results'],
  rules: ['consent rule', 'consent rules'],
  notes: ['exceedance note', 'exceedance notes'],
  schedules: ['sampling schedule', 'sampling schedules'],
  obligations: ['reporting obligation', 'reporting obligations'],
  imports: ['import', 'imports'],
  calendarRows: ['calendar row', 'calendar rows'],
  calendarMarks: ['calendar mark', 'calendar marks'],
  qa: ['QA/QC decision', 'QA/QC decisions'],
  conditions: ['consent condition', 'consent conditions'],
  assessments: ['compliance grade', 'compliance grades'],
  issues: ['issued report', 'issued reports'],
  series: ['rainfall or flow record', 'rainfall or flow records'],
  files: ['file', 'files'],
  parameters: ['parameter', 'parameters'],
  guidelineSets: ['guideline set', 'guideline sets'],
  templates: ['report template', 'report templates'],
};

const SNAPSHOT = /^EnviroDB backup (\d{4}-\d{2}-\d{2}).*\.json$/;

/** The daily copies in the shared folder, the latest first. */
export async function dailyCopies(folder: WorkspaceFolder | null): Promise<Array<{ path: string; date: string }>> {
  if (!folder) return [];
  const list = await folder.list(BACKUPS_DIR).catch(() => []);
  return list
    .filter((e) => e.kind === 'file' && SNAPSHOT.test(e.name))
    .map((e) => ({ path: `${BACKUPS_DIR}/${e.name}`, date: SNAPSHOT.exec(e.name)![1] }))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

/** A backup read: a copy of the whole workspace (a single project's file isn't one). */
export function asWorkspaceBackup(obj: unknown): WorkspaceBackup {
  const b = obj as WorkspaceBackup;
  if (!b || b.app !== BACKUP_APP || typeof b.data !== 'object') throw new Error('This file is not an EnviroDB backup.');
  if (b.version > BACKUP_VERSION) throw new Error('This backup was made by a newer version of EnviroDB.');
  if (b.kind !== 'workspace') throw new Error('This is one project’s file, not a backup of the workspace – bring it in from the Projects page.');
  return b;
}

export interface BackupProject {
  id: string;
  name: string;
  code?: string;
  samples: number;
  results: number;
  /** As it is in the workspace now – none: it isn't there (deleted since). */
  now?: { samples: number; results: number };
}

/** The projects in a backup, beside how each is now. */
export async function backupProjects(backup: WorkspaceBackup): Promise<BackupProject[]> {
  const count = (t: DataTable) => {
    const m = new Map<string, number>();
    for (const r of rowsOf(backup, t)) m.set(r.projectId as string, (m.get(r.projectId as string) ?? 0) + 1);
    return m;
  };
  const samples = count('samples');
  const results = count('results');
  const out: BackupProject[] = [];
  for (const p of rowsOf(backup, 'projects') as unknown as Project[]) {
    const there = await db.projects.get(p.id);
    out.push({
      id: p.id,
      name: p.name,
      code: p.code,
      samples: samples.get(p.id) ?? 0,
      results: results.get(p.id) ?? 0,
      now: there ? { samples: await db.samples.where('projectId').equals(p.id).count(), results: await db.results.where('projectId').equals(p.id).count() } : undefined,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * One project out of a backup of the workspace, as a project's own file: its records, the parameters its results
 * and rules name, and your own guideline sets and report templates it uses.
 */
export function projectFromBackup(backup: WorkspaceBackup, projectId: string): WorkspaceBackup {
  const project = rowsOf(backup, 'projects').find((p) => p.id === projectId);
  if (!project) throw new Error('The backup doesn’t have that project.');
  const data: WorkspaceBackup['data'] = { projects: [project] };
  for (const t of PROJECT_TABLES) data[t] = rowsOf(backup, t).filter((r) => r.projectId === projectId);
  const rowIds = new Set((data.calendarRows as Row[]).map((r) => r.id));
  data.calendarMarks = rowsOf(backup, 'calendarMarks').filter((m) => rowIds.has(m.item as string));
  const used = new Set((data.results as unknown as Result[]).map((r) => r.parameterId));
  for (const r of data.rules as unknown as Rule[]) {
    if (r.parameterId) used.add(r.parameterId);
    for (const id of r.parameterIds ?? []) used.add(id);
  }
  data.parameters = rowsOf(backup, 'parameters').filter((p) => used.has(p.id));
  const setIds = new Set([...(((project as unknown as Project).guidelineSetIds ?? []) as string[]), ...(data.rules as unknown as Rule[]).flatMap((r) => [r.guidelineSetId, r.limitSetId]).filter(Boolean)] as string[]);
  data.guidelineSets = rowsOf(backup, 'guidelineSets').filter((g) => setIds.has(g.id) && !g.builtIn);
  const tplIds = new Set((data.obligations as Row[]).map((o) => o.templateId).filter(Boolean) as string[]);
  data.templates = (rowsOf(backup, 'templates') as unknown as ReportTemplate[]).filter((t) => tplIds.has(t.id) && !t.builtIn) as unknown as Row[];
  return { app: BACKUP_APP, kind: 'project', version: backup.version, exportedAt: backup.exportedAt, appVersion: backup.appVersion, data };
}

export interface MissingRecords {
  /** The project itself isn't in the workspace. */
  project: boolean;
  /** How many records of each kind the backup has and the workspace hasn't. */
  counts: Array<{ table: DataTable; n: number; text: string }>;
  total: number;
  /** The samples among them, said: "9 Oct 2026 at DS1, US1 (2 samples)". */
  samples: string[];
}

async function missingRows(pkg: WorkspaceBackup): Promise<Map<DataTable, Row[]>> {
  const out = new Map<DataTable, Row[]>();
  for (const t of DATA_TABLES) {
    const rows = rowsOf(pkg, t);
    if (!rows.length) continue;
    const have = await db.table(t).bulkGet(rows.map((r) => r.id));
    const gone = rows.filter((_, i) => !have[i]);
    if (gone.length) out.set(t, gone);
  }
  return out;
}

/** What a project's file from a backup has that the workspace hasn't now: what's been deleted since. */
export async function missingRecords(pkg: WorkspaceBackup): Promise<MissingRecords> {
  const gone = await missingRows(pkg);
  const counts: MissingRecords['counts'] = [];
  for (const [table, rows] of gone) {
    const name = NAMES[table];
    if (!name) continue; // the history and what issued reports were built from come back too, unsaid
    counts.push({ table, n: rows.length, text: `${rows.length.toLocaleString()} ${rows.length === 1 ? name[0] : name[1]}` });
  }
  // the samples, by day, with their sites
  const sites = new Map(rowsOf(pkg, 'sites').map((s) => [s.id, s.code as string]));
  const days = new Map<string, Set<string>>();
  const perDay = new Map<string, number>();
  for (const s of gone.get('samples') ?? []) {
    const day = String(s.date).slice(0, 10);
    days.set(day, (days.get(day) ?? new Set()).add(sites.get(s.siteId as string) ?? '?'));
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
  }
  const samples = [...days].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([day, codes]) => `${formatDate(day)} at ${[...codes].sort().join(', ')} (${perDay.get(day)} sample${perDay.get(day) === 1 ? '' : 's'})`);
  return { project: !!gone.get('projects')?.length, counts, total: [...gone.values()].reduce((n, r) => n + r.length, 0), samples };
}

/**
 * Put back what a backup's project has and the workspace hasn't: every record deleted since, as it was. What's there
 * now is left as it is – nothing changed since the backup is undone. Returns how many records came back.
 */
export async function putBackMissing(pkg: WorkspaceBackup): Promise<number> {
  const project = rowsOf(pkg, 'projects')[0] as unknown as Project | undefined;
  if (!project) throw new Error('The file contains no project.');
  let n = 0;
  await db.transaction('rw', DATA_TABLES.map((t) => db.table(t)), async () => {
    const gone = await missingRows(pkg);
    for (const [t, rows] of gone) {
      await db.table(t).bulkPut(rows);
      n += rows.length;
    }
    if (gone.get('projects')?.length) {
      // a deleted project's rows on the monitoring calendar were kept, without it: they're its rows again
      for (const r of rowsOf(pkg, 'calendarRows')) {
        const now = await db.calendarRows.get(r.id);
        if (now && !now.projectId) await db.calendarRows.update(r.id, { projectId: project.id, updatedAt: new Date().toISOString() });
      }
    } else if (n) await db.projects.update(project.id, { updatedAt: new Date().toISOString() });
  });
  if (n) await logAudit(project.id, 'project', `${n.toLocaleString()} record${n === 1 ? '' : 's'} put back from the backup of ${formatDate(pkg.exportedAt.slice(0, 10))}`);
  return n;
}

/**
 * The project as the backup has it, brought in beside the one in the workspace (with new ids, named for the backup's
 * day) – to compare, or to copy from. A project that isn't in the workspace comes back as itself.
 */
export async function bringInCopy(pkg: WorkspaceBackup): Promise<string> {
  const project = rowsOf(pkg, 'projects')[0] as unknown as Project | undefined;
  if (!project) throw new Error('The file contains no project.');
  const exists = !!(await db.projects.get(project.id));
  const id = await importProjectPackage(pkg);
  if (exists) await db.projects.update(id, { name: `${project.name} (as of ${formatDate(pkg.exportedAt.slice(0, 10))})` });
  return id;
}
