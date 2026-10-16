// Quick check: lab results from any file compared with guideline values, without a project. Nothing is saved
// unless the results are made into a project.

import type { GuidelineSet, Parameter, Project, Result, Sample, Site } from '../db/types';
import { analyteMapKey, type ParsedImport } from '../importers/model';
import { compareParams } from '../data/parameters';
import { buildIndex } from './dataIndex';
import { buildParamIndex, matchParameter } from './matching';
import { flagResults, type CellFlag, type ProjectBundle } from './analysis';

export const QUICK_PROJECT = 'quick-check';
/** Every date: a quick check covers all the results in the files. */
export const ALL_TIME = { start: '0000-01-01', end: '9999-12-31' };

/** A short site code from a sample's name, e.g. "SW1" from "SW1 Upstream". */
export function codeFor(text: string): string {
  const t = text.trim();
  const m = t.match(/^([A-Za-z]{1,6}[-_ ]?\d{1,4}[A-Za-z]?)\b/);
  if (m) return m[1].replace(/\s+/g, '').toUpperCase();
  return t.length <= 16 ? t : t.slice(0, 16).replace(/[\s\-_,;:/.]+$/, '');
}

export interface QuickCheck {
  /** The results as a project that isn't saved. */
  bundle: ProjectBundle;
  /** Each sample (by key) at its site, to make a project of it. */
  siteOf: Record<string, string>;
  /** Each analyte (by key) as the parameter it was matched to (none: not compared). */
  paramOf: Record<string, string | null>;
  /** Analytes EnviroDB couldn't tell the parameter of: shown, not compared. */
  unknown: Array<{ key: string; analyte: string; group?: string; unit?: string; count: number }>;
  /** Samples the file gave no date for (dated today here). */
  undated: number;
  undatedIds: Set<string>;
}

/** The parsed files as a project to compare – sites from the samples' names, parameters matched by name. */
export function quickCheck(parsed: ParsedImport, params: Parameter[], sets: GuidelineSet[], opts: { guidelineSetIds: string[]; hardnessAdjust: boolean; today: string }): QuickCheck {
  const index = buildParamIndex(params);
  const paramMap = new Map(params.map((p) => [p.id, p]));
  const paramOf: Record<string, string | null> = {};
  const unknown = new Map<string, QuickCheck['unknown'][number]>();
  const sites: Site[] = [];
  const siteByText = new Map<string, Site>();
  const codes = new Set<string>();
  const siteOf: Record<string, string> = {};
  const samples: Sample[] = [];
  const results: Result[] = [];
  const undatedIds = new Set<string>();
  parsed.samples.forEach((raw, i) => {
    const text = (raw.siteText || raw.sampleName || `Sample ${i + 1}`).trim();
    let site = siteByText.get(text.toLowerCase());
    if (!site) {
      let code = codeFor(text) || `S${sites.length + 1}`;
      for (let n = 2; codes.has(code.toLowerCase()); n++) code = `${codeFor(text)}-${n}`;
      codes.add(code.toLowerCase());
      site = { id: `q-site-${sites.length + 1}`, projectId: QUICK_PROJECT, code, name: text === code ? undefined : text, type: 'Other', role: '', aliases: [], active: true, order: sites.length };
      sites.push(site);
      siteByText.set(text.toLowerCase(), site);
    }
    siteOf[raw.key] = site.id;
    if (!raw.date) undatedIds.add(`q-s-${i + 1}`);
    const sample: Sample = { id: `q-s-${i + 1}`, projectId: QUICK_PROJECT, siteId: site.id, date: raw.date ?? opts.today, sampleName: raw.sampleName, labName: raw.labName ?? parsed.labName, labNumber: raw.labNumber, labJob: raw.labJob ?? parsed.labJob };
    samples.push(sample);
    const seen = new Set<string>();
    raw.results.forEach((rr, j) => {
      const key = analyteMapKey(rr);
      if (!(key in paramOf)) {
        const m = matchParameter(rr.analyte, index, rr.group);
        paramOf[key] = m.confidence === 'exact' || m.confidence === 'high' ? m.parameterId : null;
      }
      const pid = paramOf[key];
      if (!pid) {
        const u = unknown.get(key) ?? { key, analyte: rr.analyte, group: rr.group, unit: rr.unit, count: 0 };
        u.count++;
        unknown.set(key, u);
        return;
      }
      if (seen.has(pid)) return; // the same parameter twice in a sample: the first
      seen.add(pid);
      results.push({
        id: `q-r-${i + 1}-${j + 1}`,
        projectId: QUICK_PROJECT,
        sampleId: sample.id,
        siteId: site!.id,
        date: sample.date,
        parameterId: pid,
        value: rr.parsed.value,
        qualifier: rr.parsed.qualifier,
        unit: rr.unit ?? paramMap.get(pid)?.unit ?? '',
        text: rr.parsed.text || undefined,
        dl: rr.parsed.dl,
      });
    });
  });
  const sorted = [...params].sort(compareParams);
  const now = new Date().toISOString();
  const project: Project = {
    id: QUICK_PROJECT,
    name: 'Quick check',
    status: 'active',
    guidelineSetIds: opts.guidelineSetIds,
    hardnessAdjust: opts.hardnessAdjust,
    ndHandling: 'dl',
    yearStartMonth: 7,
    percentileMethod: 'excel',
    createdAt: now,
    updatedAt: now,
  };
  const bundle: ProjectBundle = {
    project,
    sites,
    siteMap: new Map(sites.map((s) => [s.id, s])),
    samples: samples.sort((a, b) => a.date.localeCompare(b.date)),
    params: sorted,
    paramMap,
    guidelineSets: sets,
    setMap: new Map(sets.map((s) => [s.id, s])),
    rules: [],
    notes: [],
    schedules: [],
    obligations: [],
    index: buildIndex(samples, results, sites, sorted),
  };
  return { bundle, siteOf, paramOf, unknown: [...unknown.values()].sort((a, b) => a.analyte.localeCompare(b.analyte)), undated: undatedIds.size, undatedIds };
}

/** The results over each guideline set: how many of those it has a value for, and how many exceed it. */
export function quickCounts(b: ProjectBundle, setIds: string[]): Array<{ setId: string; compared: number; exceeded: number; resultIds: Set<string> }> {
  return setIds.map((setId) => {
    const set = b.setMap.get(setId);
    const withValue = new Set(set?.values.map((v) => v.parameterId));
    let compared = 0;
    for (const pid of b.index.paramIdsWithData) if (withValue.has(pid)) for (const list of b.index.byParam.get(pid)?.values() ?? []) compared += list.length;
    const flags = flagResults(b, [], [setId], ALL_TIME.start, ALL_TIME.end);
    const ids = new Set([...flags].filter(([, f]) => f.kind === 'guideline').map(([id]) => id));
    return { setId, compared, exceeded: ids.size, resultIds: ids };
  });
}

/** Every result's highlight against the sets chosen. */
export function quickFlags(b: ProjectBundle, setIds: string[]): Map<string, CellFlag> {
  return flagResults(b, [], setIds, ALL_TIME.start, ALL_TIME.end);
}

/** Makes a project of a quick check: a site for each sample name, the results, the guideline sets chosen. */
export async function saveQuickCheck(q: QuickCheck, parsed: ParsedImport, opts: { name: string; fileName: string; guidelineSetIds: string[]; hardnessAdjust: boolean; today: string }): Promise<string> {
  const [{ db }, { newProject, newSite }, { commitImport }] = await Promise.all([import('../db/db'), import('../db/repo'), import('../importers/commit')]);
  const project = newProject({ name: opts.name, guidelineSetIds: opts.guidelineSetIds, hardnessAdjust: opts.hardnessAdjust });
  const siteIds = new Map(q.bundle.sites.map((s, i) => [s.id, newSite(project.id, { code: s.code, name: s.name, type: 'Other', order: i + 1, aliases: s.name ? [s.name] : [] })]));
  await db.projects.put(project);
  await db.sites.bulkPut([...siteIds.values()]);
  await commitImport(
    project.id,
    parsed,
    {
      sites: Object.fromEntries(Object.entries(q.siteOf).map(([k, sid]) => [k, siteIds.get(sid)!.id])),
      dates: Object.fromEntries(parsed.samples.filter((s) => !s.date).map((s) => [s.key, opts.today])),
      include: {},
      params: q.paramOf,
      units: {},
    },
    { duplicates: 'replace', rememberAliases: false, fileName: opts.fileName, labName: parsed.labName },
  );
  return project.id;
}
