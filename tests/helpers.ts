import { db } from '../src/db/db';
import { buildIndex } from '../src/lib/dataIndex';
import type { ProjectBundle } from '../src/lib/analysis';
import { compareParams } from '../src/data/parameters';

/** Everything the report and analysis code needs about a project, read from the database. */
export async function loadBundle(projectId: string): Promise<ProjectBundle> {
  const project = (await db.projects.get(projectId))!;
  const sites = (await db.sites.where('projectId').equals(projectId).toArray()).sort((a, b) => a.order - b.order);
  const samples = (await db.samples.where('projectId').equals(projectId).toArray()).sort((a, b) => (a.date < b.date ? -1 : 1));
  const results = await db.results.where('projectId').equals(projectId).toArray();
  const params = (await db.parameters.toArray()).sort(compareParams);
  const sets = await db.guidelineSets.toArray();
  return {
    project,
    sites,
    siteMap: new Map(sites.map((s) => [s.id, s])),
    samples,
    params,
    paramMap: new Map(params.map((p) => [p.id, p])),
    guidelineSets: sets,
    setMap: new Map(sets.map((s) => [s.id, s])),
    rules: (await db.rules.where('projectId').equals(projectId).toArray()).sort((a, b) => a.order - b.order),
    notes: await db.notes.where('projectId').equals(projectId).toArray(),
    schedules: await db.schedules.where('projectId').equals(projectId).toArray(),
    obligations: await db.obligations.where('projectId').equals(projectId).toArray(),
    index: buildIndex(samples, results, sites, params),
  };
}
