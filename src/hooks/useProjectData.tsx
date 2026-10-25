import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Center, Loader, Stack, Text, Button } from '@mantine/core';
import { Link } from 'react-router-dom';
import { db } from '../db/db';
import type { ConditionAssessment, ConsentCondition, ContinuousSeries, ExceedanceNote, GuidelineSet, ImportBatch, MonitoringSchedule, Parameter, Project, QaRecord, ReportObligation, Result, Rule, Sample, SeriesYear, Site } from '../db/types';
import { isQcSite } from '../lib/qc';
import { buildIndex, type DataIndex } from '../lib/dataIndex';
import { SERIES_LIGHT } from '../theme';
import { compareParams } from '../data/parameters';
import { withProjectUnits } from '../lib/units';

export interface ProjectData {
  project: Project;
  /** The monitoring sites (quality control sites are in `qc`). */
  sites: Site[];
  /** Every site, quality control ones included. */
  siteMap: Map<string, Site>;
  /** The monitoring samples (duplicates and blanks are in `qc`). */
  samples: Sample[];
  /** Every result, QC samples' and left-out ones included. */
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
  /** QA/QC: the quality control sites and samples (duplicates and blanks), and the decisions made. */
  qc: { sites: Site[]; samples: Sample[]; records: QaRecord[] };
  /** The compliance register: the consent's conditions and their grades. */
  register: { conditions: ConsentCondition[]; assessments: ConditionAssessment[] };
  /** Continuous data – rainfall, flow, level – as daily values. */
  continuous: { series: ContinuousSeries[]; days: SeriesYear[] };
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
  const qaRecords = useLiveQuery(() => db.qa.where('projectId').equals(projectId).toArray(), [projectId]);
  const conditions = useLiveQuery(() => db.conditions.where('projectId').equals(projectId).toArray(), [projectId]);
  const assessments = useLiveQuery(() => db.assessments.where('projectId').equals(projectId).toArray(), [projectId]);
  const series = useLiveQuery(() => db.series.where('projectId').equals(projectId).toArray(), [projectId]);
  const seriesDays = useLiveQuery(() => db.seriesDays.where('projectId').equals(projectId).toArray(), [projectId]);

  const value = useMemo<ProjectData | null>(() => {
    if (!project || !sites || !samples || !results || !rules || !notes || !schedules || !obligations || !imports || !params || !guidelineSets || !qaRecords || !conditions || !assessments || !series || !seriesDays) return null;
    const sortedSites = [...sites].sort((a, b) => a.order - b.order || a.code.localeCompare(b.code));
    // the parameters as this project writes them (g/m³ or mg/L)
    const sortedParams = withProjectUnits([...params].sort(compareParams), project.concUnit);
    const index = buildIndex(samples, results, sortedSites, sortedParams);
    const monitoringSites = sortedSites.filter((s) => !isQcSite(s));
    const qcSiteIds = new Set(sortedSites.filter((s) => isQcSite(s)).map((s) => s.id));
    const isQc = (s: Sample) => !!s.qc || qcSiteIds.has(s.siteId);
    const byDate = [...samples].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const colorIdx = new Map(monitoringSites.map((s, i) => [s.id, i]));
    return {
      project,
      sites: monitoringSites,
      siteMap: new Map(sortedSites.map((s) => [s.id, s])),
      samples: byDate.filter((s) => !isQc(s)),
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
      qc: { sites: sortedSites.filter((s) => qcSiteIds.has(s.id)), samples: byDate.filter(isQc), records: qaRecords },
      register: { conditions, assessments },
      continuous: { series: [...series].sort((a, b) => a.name.localeCompare(b.name)), days: seriesDays },
      siteColor: (id: string) => sortedSites.find((x) => x.id === id)?.colour ?? SERIES_LIGHT[(colorIdx.get(id) ?? 0) % SERIES_LIGHT.length],
    };
  }, [project, sites, samples, results, rules, notes, schedules, obligations, imports, params, guidelineSets, qaRecords, conditions, assessments, series, seriesDays]);

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
