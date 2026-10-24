// What EnviroDB shows. The team switches whole features on or off (Settings → Team → Features), starting from the
// essentials; within a project, a view shows only once it has something to show (QA/QC when the project has it on,
// NPS-FM for a project with freshwater sites, trends after two years of results). Nothing switched off is deleted –
// its data stays, and switching it back on shows it again.

import type { Project, Settings, Site } from '../db/types';
import { siteClass } from './npsfm';

export type Feature = 'calendar' | 'field' | 'npsfm' | 'continuous' | 'packs' | 'ai';

export interface FeatureInfo {
  key: Feature;
  label: string;
  /** What it adds and where. */
  description: string;
  /** On for a team that hasn't chosen. */
  essential: boolean;
}

export const FEATURES: FeatureInfo[] = [
  { key: 'calendar', label: 'Monitoring calendar', description: 'The team’s year of monitoring jobs, like the monitoring schedule spreadsheet – in the sidebar and on the dashboard.', essential: true },
  { key: 'field', label: 'Field mode for phones', description: 'Field sheets and printed QR codes for phones, and results sent back from them – a project’s ⋯ menu → Field work. With the optional team key.', essential: false },
  { key: 'npsfm', label: 'NPS-FM attribute bands', description: 'Freshwater sites graded against the NPS-FM attribute bands – Compliance → NPS-FM, in projects with surface water sites.', essential: false },
  { key: 'continuous', label: 'Continuous data and rainfall', description: 'Logger and rainfall records, shown behind the results on graphs – set up in a project’s Setup tab.', essential: false },
  { key: 'packs', label: 'Client data packs', description: 'One HTML file of a project’s data for the client, with graphs, a map and tables – Reports → Client data pack.', essential: false },
  { key: 'ai', label: 'AI helpers', description: 'Copy a project’s data for an AI tool to write commentary, and set up consent limits from the consent document with one.', essential: false },
];

export type Features = Partial<Record<Feature, boolean>>;

const ESSENTIAL = new Map(FEATURES.map((f) => [f.key, f.essential]));

/** Whether a feature is on: as the team chose, or the essentials. */
export const featureOn = (s: Pick<Settings, 'features'>, f: Feature): boolean => s.features?.[f] ?? ESSENTIAL.get(f) ?? false;

/** Every feature on or off as a preset: the essentials, or everything. */
export const featurePreset = (all: boolean): Record<Feature, boolean> => Object.fromEntries(FEATURES.map((f) => [f.key, all || f.essential])) as Record<Feature, boolean>;

/** Which preset the switches match, if any. */
export function presetOf(s: Pick<Settings, 'features'>): 'essentials' | 'everything' | 'custom' {
  const on = FEATURES.map((f) => featureOn(s, f.key));
  if (on.every(Boolean)) return 'everything';
  if (FEATURES.every((f, i) => on[i] === f.essential)) return 'essentials';
  return 'custom';
}

// ------------------------------------------------------------ a project's views

/** A project's views: the tabs, and the views within them. */
export type ProjectView = 'overview' | 'schedule' | 'data' | 'qa' | 'charts' | 'trends' | 'map' | 'compliance' | 'npsfm' | 'reports' | 'pack' | 'setup';

export interface ProjectFacts {
  project: Pick<Project, 'qa'>;
  sites: Array<Pick<Site, 'type' | 'npsfm'>>;
  /** The days sampled ('YYYY-MM-DD…'), any order. */
  sampleDates: string[];
}

/** Trends need two years of results, and at least eight sampling days. */
export const TRENDS_MIN_DAYS = 8;
export const TRENDS_MIN_YEARS = 2;

/** Whether a project has enough results for trends. */
export function trendsReady(dates: string[]): { ready: boolean; days: number; years: number } {
  const days = [...new Set(dates.map((d) => d.slice(0, 10)))].sort();
  const years = days.length ? (Date.parse(days[days.length - 1]) - Date.parse(days[0])) / (365.25 * 864e5) : 0;
  return { ready: days.length >= TRENDS_MIN_DAYS && years >= TRENDS_MIN_YEARS, days: days.length, years };
}

/** Why a view isn't shown (for Setup and for a link to it), or null when it is. */
export function viewOff(view: ProjectView, f: ProjectFacts, s: Pick<Settings, 'features'>): string | null {
  switch (view) {
    case 'qa':
      return f.project.qa ? null : 'QA/QC checks are off for this project.';
    case 'npsfm':
      if (!featureOn(s, 'npsfm')) return 'NPS-FM attribute bands are switched off for the team.';
      return f.sites.some((x) => siteClass(x).water !== 'none') ? null : 'The project has no surface water sites to grade.';
    case 'pack':
      return featureOn(s, 'packs') ? null : 'Client data packs are switched off for the team.';
    case 'trends': {
      const t = trendsReady(f.sampleDates);
      return t.ready ? null : `Trends show after ${TRENDS_MIN_YEARS} years of results and ${TRENDS_MIN_DAYS} sampling days (so far ${t.days} day${t.days === 1 ? '' : 's'}).`;
    }
    default:
      return null;
  }
}

/** The project's tabs, each with its views (the first is the tab's own). */
export const PROJECT_TABS: Array<{ value: ProjectView; label: string; views: Array<{ value: ProjectView; label: string }> }> = [
  { value: 'overview', label: 'Overview', views: [{ value: 'overview', label: 'Summary' }, { value: 'schedule', label: 'Sampling & reporting' }] },
  { value: 'data', label: 'Data', views: [{ value: 'data', label: 'Results' }, { value: 'qa', label: 'QA/QC' }] },
  { value: 'charts', label: 'Graphs', views: [{ value: 'charts', label: 'Graphs' }, { value: 'trends', label: 'Trends' }] },
  { value: 'map', label: 'Map', views: [{ value: 'map', label: 'Map' }] },
  { value: 'compliance', label: 'Compliance', views: [{ value: 'compliance', label: 'Consent' }, { value: 'npsfm', label: 'NPS-FM' }] },
  { value: 'reports', label: 'Reports', views: [{ value: 'reports', label: 'Reports' }, { value: 'pack', label: 'Client data pack' }] },
  { value: 'setup', label: 'Setup', views: [{ value: 'setup', label: 'Setup' }] },
];

/** The tab a view is in. */
export const tabOf = (view: string): ProjectView => PROJECT_TABS.find((t) => t.views.some((v) => v.value === view))?.value ?? 'overview';

/** A tab's views that show for this project. */
export const visibleViews = (tab: ProjectView, f: ProjectFacts, s: Pick<Settings, 'features'>) => (PROJECT_TABS.find((t) => t.value === tab)?.views ?? []).filter((v) => !viewOff(v.value, f, s));
