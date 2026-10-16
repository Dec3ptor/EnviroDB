import Dexie, { type Table } from 'dexie';
import type {
  CalendarMark,
  ExceedanceNote,
  GuidelineSet,
  ImportBatch,
  MetaRecord,
  MonitoringSchedule,
  Parameter,
  Project,
  ReportObligation,
  ReportTemplate,
  Result,
  Rule,
  Sample,
  Settings,
  Site,
} from './types';
import { BUILT_IN_PARAMETERS, splitPhysicalAndField } from '../data/parameters';
import { BUILT_IN_GUIDELINES } from '../data/guidelines';
import { BUILT_IN_TEMPLATES } from '../data/templates';
import { captureMiddleware, markUncaptured } from '../sync/capture';
import { isDeleted, isSharedRecord, rowKey, type DirtySegment, type SyncRow } from '../sync/model';
import type { SyncedFile } from '../sync/engine';

/** This browser's own workspace details: its client id, your name, the folder, the workspace it holds. */
export interface SyncLocal {
  key: string;
  value: unknown;
}

export class EnviroDatabase extends Dexie {
  projects!: Table<Project, string>;
  sites!: Table<Site, string>;
  parameters!: Table<Parameter, string>;
  samples!: Table<Sample, string>;
  results!: Table<Result, string>;
  guidelineSets!: Table<GuidelineSet, string>;
  rules!: Table<Rule, string>;
  notes!: Table<ExceedanceNote, string>;
  schedules!: Table<MonitoringSchedule, string>;
  obligations!: Table<ReportObligation, string>;
  imports!: Table<ImportBatch, string>;
  templates!: Table<ReportTemplate, string>;
  calendarMarks!: Table<CalendarMark, string>;
  meta!: Table<MetaRecord, string>;
  // the shared workspace: what changed when (syncState), what is still to be written to the folder (syncDirty),
  // colleagues' files already read (syncFiles) and this browser's own details (syncLocal)
  syncState!: Table<SyncRow, string>;
  syncDirty!: Table<DirtySegment, string>;
  syncFiles!: Table<SyncedFile, string>;
  syncLocal!: Table<SyncLocal, string>;

  constructor(name = 'EnviroDB') {
    super(name);
    this.use(captureMiddleware);
    this.version(1).stores({
      projects: 'id, status, updatedAt',
      sites: 'id, projectId',
      parameters: 'id, group',
      samples: 'id, projectId, siteId, importId, [projectId+date]',
      results: 'id, projectId, sampleId, importId, [projectId+parameterId]',
      guidelineSets: 'id',
      rules: 'id, projectId',
      notes: 'id, projectId, ruleId',
      schedules: 'id, projectId',
      obligations: 'id, projectId',
      imports: 'id, projectId, importedAt',
      templates: 'id',
      meta: 'key',
    });
    this.version(2).stores({
      syncState: 'tk, [s+mine]',
      syncDirty: 's',
      syncFiles: 'path',
      syncLocal: 'key',
    });
    this.version(3).stores({
      calendarMarks: 'id, projectId, item',
    });
  }
}

export const db = new EnviroDatabase();

export const DATA_TABLES = [
  'projects', 'sites', 'parameters', 'samples', 'results', 'guidelineSets', 'rules', 'notes', 'schedules', 'obligations', 'imports', 'templates', 'calendarMarks',
] as const;
export type DataTable = (typeof DATA_TABLES)[number];

export const DEFAULT_SETTINGS: Settings = {
  author: '',
  company: '',
  dateFormat: 'D MMM YYYY',
};

/** Before field and laboratory physical measurements were separate groups. */
const LEGACY_FIELD_GROUP = 'Physical & field';

/** Insert / refresh built-in reference data while keeping the user's own additions. */
export async function ensureBuiltIns(database: EnviroDatabase = db): Promise<void> {
  await migrateSettings(database);
  await forgetUnsharedSync(database);
  await database.transaction('rw', [database.parameters, database.guidelineSets, database.templates, database.syncState], async (tx) => {
    markUncaptured(tx.idbtrans); // the same in every browser: not a change to share
    const existing = new Map((await database.parameters.toArray()).map((p) => [p.id, p]));
    // built-in parameters someone deleted (here or in the workspace) stay deleted
    const states = await database.syncState.bulkGet(BUILT_IN_PARAMETERS.map((p) => rowKey('parameters', p.id)));
    const deleted = new Set(states.filter((r): r is SyncRow => !!r && isDeleted(r)).map((r) => r.k));
    const toPut: Parameter[] = [];
    for (const p of BUILT_IN_PARAMETERS) {
      const cur = existing.get(p.id);
      if (deleted.has(p.id)) continue;
      if (!cur) toPut.push(p);
      else {
        const aliases = Array.from(new Set([...cur.aliases, ...p.aliases]));
        // the user's names, units and groups are kept; the old combined group is split, and the built-in order followed
        const group = cur.group === LEGACY_FIELD_GROUP ? p.group : cur.group;
        if (aliases.length !== cur.aliases.length || cur.hardnessExponent !== p.hardnessExponent || !cur.builtIn || group !== cur.group || cur.order !== p.order) {
          toPut.push({ ...cur, aliases, hardnessExponent: p.hardnessExponent, builtIn: true, group, order: p.order });
        }
      }
      existing.delete(p.id);
    }
    // the user's own parameters in the old "Physical & field" group go to Field or Physical
    for (const cur of existing.values()) if (cur.group === LEGACY_FIELD_GROUP) toPut.push({ ...cur, group: splitPhysicalAndField(cur) });
    if (toPut.length) await database.parameters.bulkPut(toPut);
    await database.guidelineSets.bulkPut(BUILT_IN_GUIDELINES);
    await database.templates.bulkPut(BUILT_IN_TEMPLATES);
  });
}

/** Settings that are each person's own, kept in this browser. The others (company, letterhead) are the team's. */
export const PERSONAL_SETTINGS: ReadonlyArray<keyof Settings> = ['author', 'signatureImage', 'signatureDetails', 'dateFormat', 'guidelineUnit', 'defaultTemplateId', 'lastBackupAt'];
const isPersonal = (k: string) => (PERSONAL_SETTINGS as readonly string[]).includes(k);
/** Meta record of this person's own settings (the team's are under "settings"). */
export const MY_SETTINGS = 'mySettings';

/** The settings in use: the team's, with this person's own on top. */
export function combineSettings(team: unknown, mine: unknown): Settings {
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const [k, v] of Object.entries((team ?? {}) as Record<string, unknown>)) if (!isPersonal(k) && v !== undefined) out[k] = v;
  for (const [k, v] of Object.entries((mine ?? {}) as Record<string, unknown>)) if (isPersonal(k) && v !== undefined) out[k] = v;
  return out as unknown as Settings;
}

export async function getSettings(database: EnviroDatabase = db): Promise<Settings> {
  const [team, mine] = await Promise.all([database.meta.get('settings'), database.meta.get(MY_SETTINGS)]);
  return combineSettings(team?.value, mine?.value);
}

/** Saves the settings given (undefined removes one) – only those, so a colleague's change to another stays. */
export async function saveSettings(patch: Partial<Settings>, database: EnviroDatabase = db): Promise<void> {
  const parts: Record<string, Record<string, unknown>> = { settings: {}, [MY_SETTINGS]: {} };
  for (const [k, v] of Object.entries(patch)) parts[isPersonal(k) ? MY_SETTINGS : 'settings'][k] = v;
  await database.transaction('rw', database.meta, async () => {
    for (const [key, part] of Object.entries(parts)) {
      if (!Object.keys(part).length) continue;
      const next = { ...(((await database.meta.get(key))?.value as Record<string, unknown> | undefined) ?? {}) };
      for (const [k, v] of Object.entries(part)) {
        if (v === undefined) delete next[k];
        else next[k] = v;
      }
      await database.meta.put({ key, value: next });
    }
  });
}

/** Report work used to be shared: what was kept for sharing it goes (the work itself stays in this browser). */
async function forgetUnsharedSync(database: EnviroDatabase): Promise<void> {
  const rows = await database.syncState.where('tk').between('meta\u0001', 'meta\u0001\uffff').toArray();
  const stale = rows.filter((r) => !isSharedRecord('meta', r.k)).map((r) => r.tk);
  if (stale.length) await database.syncState.bulkDelete(stale);
}

/** Settings used to be one record: this person's own move to their own record (once). */
async function migrateSettings(database: EnviroDatabase): Promise<void> {
  await database.transaction('rw', database.meta, async (tx) => {
    markUncaptured(tx.idbtrans);
    if (await database.meta.get(MY_SETTINGS)) return;
    const old = (await database.meta.get('settings'))?.value as Record<string, unknown> | undefined;
    const mine: Record<string, unknown> = {};
    const team: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(old ?? {})) if (v !== undefined) (isPersonal(k) ? mine : team)[k] = v;
    await database.meta.put({ key: MY_SETTINGS, value: mine });
    if (old) await database.meta.put({ key: 'settings', value: team });
  });
}

/** Report work kept with the settings rather than in the data tables: commentary, figures, layout changes and site choices. */
export const REPORT_WORK = /^(draft|figs|layout|sites):/;

/** Save a piece of report work (or remove it with undefined). */
export async function saveReportWork(key: string, value: unknown): Promise<void> {
  if (value === undefined) await db.meta.delete(key);
  else await db.meta.put({ key, value });
}

/**
 * Change a piece of report work starting from what is saved now, rather than from what a screen loaded earlier –
 * so a colleague's change to another part of it (another section's commentary, another figure) stays.
 */
export async function updateReportWork<T>(key: string, change: (current: T | undefined) => T | undefined): Promise<void> {
  await db.transaction('rw', db.meta, async () => {
    const next = change((await db.meta.get(key))?.value as T | undefined);
    if (next === undefined) await db.meta.delete(key);
    else await db.meta.put({ key, value: next });
  });
}

/** Ask the browser not to evict our data under storage pressure. */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (navigator.storage?.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch {
    /* ignore */
  }
  return false;
}
