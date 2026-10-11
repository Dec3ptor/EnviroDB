import Dexie, { type Table } from 'dexie';
import type {
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
import { BUILT_IN_PARAMETERS } from '../data/parameters';
import { BUILT_IN_GUIDELINES } from '../data/guidelines';
import { BUILT_IN_TEMPLATES } from '../data/templates';

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
  meta!: Table<MetaRecord, string>;

  constructor(name = 'EnviroDB') {
    super(name);
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
  }
}

export const db = new EnviroDatabase();

export const DATA_TABLES = [
  'projects', 'sites', 'parameters', 'samples', 'results', 'guidelineSets', 'rules', 'notes', 'schedules', 'obligations', 'imports', 'templates',
] as const;
export type DataTable = (typeof DATA_TABLES)[number];

export const DEFAULT_SETTINGS: Settings = {
  author: '',
  company: '',
  dateFormat: 'D MMM YYYY',
};

/** Insert / refresh built-in reference data while keeping the user's own additions. */
export async function ensureBuiltIns(database: EnviroDatabase = db): Promise<void> {
  await database.transaction('rw', database.parameters, database.guidelineSets, database.templates, async () => {
    const existing = new Map((await database.parameters.toArray()).map((p) => [p.id, p]));
    const toPut: Parameter[] = [];
    for (const p of BUILT_IN_PARAMETERS) {
      const cur = existing.get(p.id);
      if (!cur) toPut.push(p);
      else {
        const aliases = Array.from(new Set([...cur.aliases, ...p.aliases]));
        if (aliases.length !== cur.aliases.length || cur.hardnessExponent !== p.hardnessExponent || !cur.builtIn) {
          toPut.push({ ...cur, aliases, hardnessExponent: p.hardnessExponent, builtIn: true });
        }
      }
    }
    if (toPut.length) await database.parameters.bulkPut(toPut);
    await database.guidelineSets.bulkPut(BUILT_IN_GUIDELINES);
    await database.templates.bulkPut(BUILT_IN_TEMPLATES);
  });
}

export async function getSettings(database: EnviroDatabase = db): Promise<Settings> {
  const rec = await database.meta.get('settings');
  return { ...DEFAULT_SETTINGS, ...((rec?.value as Partial<Settings>) ?? {}) };
}

export async function saveSettings(patch: Partial<Settings>, database: EnviroDatabase = db): Promise<void> {
  const cur = await getSettings(database);
  await database.meta.put({ key: 'settings', value: { ...cur, ...patch } });
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
