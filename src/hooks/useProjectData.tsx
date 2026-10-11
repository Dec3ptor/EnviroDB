import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Center, Loader, Stack, Text, Button } from '@mantine/core';
import { Link } from 'react-router-dom';
import { db } from '../db/db';
import type { ExceedanceNote, GuidelineSet, ImportBatch, MonitoringSchedule, Parameter, Project, ReportObligation, Result, Rule, Sample, Site } from '../db/types';
import { buildIndex, type DataIndex } from '../lib/dataIndex';
import { SERIES_LIGHT } from '../theme';

export interface ProjectData {
  project: Project;
  sites: Site[];
  siteMap: Map<string, Site>;
  samples: Sample[];
  results: Result[];
  params: Parameter[];
  paramMap: Map<string, Parameter>;
  guidelineSets: GuidelineSet[];
  setMap: Map<string, GuidelineSet>;
  rules: Rule[];
  notes: ExceedanceNote[];
  schedules: MonitoringSchedule[];
  obligations: ReportObligation[];
  imports: ImportBatch[];
  index: DataIndex;
  siteColor: (siteId: string) => string;
}

const Ctx = createContext<ProjectData | null>(null);

export function useProject(): ProjectData {
  const v = useContext(Ctx);
  if (!v) throw new Error('useProject must be used inside ProjectDataProvider');
  return v;
}

export function useParamsAndSets() {
  const params = useLiveQuery(() => db.parameters.toArray(), []);
  const sets = useLiveQuery(() => db.guidelineSets.toArray(), []);
  return { params: params ?? [], sets: sets ?? [] };
}

export function ProjectDataProvider({ projectId, children }: { projectId: string; children: ReactNode }) {
  const project = useLiveQuery(() => db.projects.get(projectId), [projectId], null as Project | null | undefined);
  const sites = useLiveQuery(() => db.sites.where('projectId').equals(projectId).toArray(), [projectId]);
  const samples = useLiveQuery(() => db.samples.where('projectId').equals(projectId).toArray(), [projectId]);
  const results = useLiveQuery(() => db.results.where('projectId').equals(projectId).toArray(), [projectId]);
  const rules = useLiveQuery(() => db.rules.where('projectId').equals(projectId).toArray(), [projectId]);
  const notes = useLiveQuery(() => db.notes.where('projectId').equals(projectId).toArray(), [projectId]);
  const schedules = useLiveQuery(() => db.schedules.where('projectId').equals(projectId).toArray(), [projectId]);
  const obligations = useLiveQuery(() => db.obligations.where('projectId').equals(projectId).toArray(), [projectId]);
  const imports = useLiveQuery(() => db.imports.where('projectId').equals(projectId).reverse().sortBy('importedAt'), [projectId]);
  const params = useLiveQuery(() => db.parameters.toArray(), []);
  const guidelineSets = useLiveQuery(() => db.guidelineSets.toArray(), []);

  const value = useMemo<ProjectData | null>(() => {
    if (!project || !sites || !samples || !results || !rules || !notes || !schedules || !obligations || !imports || !params || !guidelineSets) return null;
    const sortedSites = [...sites].sort((a, b) => a.order - b.order || a.code.localeCompare(b.code));
    const sortedParams = [...params].sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999) || a.name.localeCompare(b.name));
    const index = buildIndex(samples, results, sortedSites, sortedParams);
    const colorIdx = new Map(sortedSites.map((s, i) => [s.id, i]));
    return {
      project,
      sites: sortedSites,
      siteMap: new Map(sortedSites.map((s) => [s.id, s])),
      samples: [...samples].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
      results,
      params: sortedParams,
      paramMap: new Map(sortedParams.map((p) => [p.id, p])),
      guidelineSets,
      setMap: new Map(guidelineSets.map((g) => [g.id, g])),
      rules: [...rules].sort((a, b) => a.order - b.order),
      notes,
      schedules,
      obligations,
      imports,
      index,
      siteColor: (id: string) => SERIES_LIGHT[(colorIdx.get(id) ?? 0) % SERIES_LIGHT.length],
    };
  }, [project, sites, samples, results, rules, notes, schedules, obligations, imports, params, guidelineSets]);

  if (project === null) {
    return (
      <Center h={300}>
        <Stack align="center">
          <Text>Project not found.</Text>
          <Button component={Link} to="/projects">
            Back to projects
          </Button>
        </Stack>
      </Center>
    );
  }
  if (!value) {
    return (
      <Center h={300}>
        <Loader />
      </Center>
    );
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
