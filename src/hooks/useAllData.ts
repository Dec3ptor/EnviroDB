import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { Project } from '../db/types';
import { buildIndex } from '../lib/dataIndex';
import { isQcSite } from '../lib/qc';
import type { ProjectBundle } from '../lib/analysis';
import { compareParams } from '../data/parameters';

/** Loads every project's data (for the dashboard). */
export function useAllBundles(): { bundles: ProjectBundle[]; projects: Project[]; loading: boolean } {
  const projects = useLiveQuery(() => db.projects.toArray(), []);
  const sites = useLiveQuery(() => db.sites.toArray(), []);
  const samples = useLiveQuery(() => db.samples.toArray(), []);
  const results = useLiveQuery(() => db.results.toArray(), []);
  const params = useLiveQuery(() => db.parameters.toArray(), []);
  const sets = useLiveQuery(() => db.guidelineSets.toArray(), []);
  const rules = useLiveQuery(() => db.rules.toArray(), []);
  const notes = useLiveQuery(() => db.notes.toArray(), []);
  const schedules = useLiveQuery(() => db.schedules.toArray(), []);
  const obligations = useLiveQuery(() => db.obligations.toArray(), []);
  const qa = useLiveQuery(() => db.qa.toArray(), []);

  return useMemo(() => {
    if (!projects || !sites || !samples || !results || !params || !sets || !rules || !notes || !schedules || !obligations || !qa) return { bundles: [], projects: [], loading: true };
    const by = <T extends { projectId: string }>(list: T[]) => {
      const m = new Map<string, T[]>();
      for (const x of list) {
        const l = m.get(x.projectId) ?? [];
        l.push(x);
        m.set(x.projectId, l);
      }
      return m;
    };
    const sitesBy = by(sites), samplesBy = by(samples), resultsBy = by(results), rulesBy = by(rules), notesBy = by(notes), schBy = by(schedules), oblBy = by(obligations), qaBy = by(qa);
    const sortedParams = [...params].sort(compareParams);
    const paramMap = new Map(sortedParams.map((p) => [p.id, p]));
    const setMap = new Map(sets.map((s) => [s.id, s]));
    const bundles = projects.map<ProjectBundle>((project) => {
      const all = [...(sitesBy.get(project.id) ?? [])].sort((a, b) => a.order - b.order || a.code.localeCompare(b.code));
      const ps = all.filter((s) => !isQcSite(s));
      const qcSites = all.filter((s) => isQcSite(s));
      const qcIds = new Set(qcSites.map((s) => s.id));
      // an archived project is out of the working set: its results aren't loaded or indexed here (open it to see them)
      const archived = project.status === 'archived';
      const allSamples = archived ? [] : [...(samplesBy.get(project.id) ?? [])].sort((a, b) => (a.date < b.date ? -1 : 1));
      const isQc = (s: (typeof allSamples)[number]) => !!s.qc || qcIds.has(s.siteId);
      return {
        project,
        sites: ps,
        siteMap: new Map(all.map((s) => [s.id, s])),
        samples: allSamples.filter((s) => !isQc(s)),
        params: sortedParams,
        paramMap,
        guidelineSets: sets,
        setMap,
        rules: [...(rulesBy.get(project.id) ?? [])].sort((a, b) => a.order - b.order),
        notes: notesBy.get(project.id) ?? [],
        schedules: schBy.get(project.id) ?? [],
        obligations: oblBy.get(project.id) ?? [],
        index: buildIndex(allSamples, archived ? [] : resultsBy.get(project.id) ?? [], all, sortedParams),
        qc: { sites: qcSites, samples: allSamples.filter(isQc), records: qaBy.get(project.id) ?? [] },
      };
    });
    return { bundles, projects, loading: false };
  }, [projects, sites, samples, results, params, sets, rules, notes, schedules, obligations, qa]);
}
