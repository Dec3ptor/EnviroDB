// The client data pack's contents: what goes in it from the project, as the viewer reads it.

import type { PackSection, PackSettings, Parameter, Site } from '../db/types';
import { evaluateAll, flagResults, limitToSites, type ProjectBundle } from '../lib/analysis';
import { ruleParamIds, type RuleStatus } from '../lib/compliance';
import { buildChartSpec, type ChartLine } from '../charts/timeSeries';
import { convert, unitLabel } from '../lib/units';
import { siteLatLng } from '../lib/nztm';
import { addDays, addMonths, formatDate } from '../lib/dates';
import { SERIES_LIGHT } from '../theme';

export const PACK_FORMAT = 1;

/** What the viewer draws: compact, with sites, analytes and samples by their place in the lists. */
export interface PackData {
  format: number;
  pack: { version: number; made: string; app: string; company?: string };
  look: { title: string; subtitle?: string; intro?: string; footer?: string; accent: string; logo?: string; theme: 'light' | 'dark' | 'auto' };
  can: { limits: boolean; controls: boolean; download: boolean };
  sections: Array<Pick<PackSection, 'id' | 'type' | 'title' | 'text' | 'mode'>>;
  period: { start: string; end: string; label: string };
  sites: Array<{ code: string; name?: string; type?: string; color: string; lat?: number; lng?: number }>;
  params: Array<{ name: string; unit: string; group: string }>;
  /** [site, date, sample name] */
  samples: Array<[number, string, string?]>;
  /**
   * [sample, analyte, value (in the analyte's unit), qualifier, highlight, note, text]: highlight 1 above a consent
   * limit, 2 a trigger, 3 a guideline, 4 detection limit above a limit; note is its text in `notes`.
   */
  results: Array<[number, number, number | null, string?, number?, number?, string?]>;
  notes: string[];
  /** Each analyte's limit, trigger and guideline lines. */
  lines: ChartLine[][];
  compliance: Array<{ name: string; condition?: string; status: RuleStatus; summary: string }>;
  /** An aerial photo behind the map, and where it is (Web Mercator, 0–1). */
  map?: { image: string; box: [number, number, number, number]; attribution: string };
}

export const DEFAULT_SECTIONS: PackSection[] = [
  { id: 'summary', type: 'summary', title: 'Summary', on: true },
  { id: 'map', type: 'map', title: 'Monitoring sites', on: true },
  { id: 'graphs', type: 'graphs', title: 'Graphs', on: true, mode: 'picker' },
  { id: 'latest', type: 'latest', title: 'Latest results', on: true },
  { id: 'compliance', type: 'compliance', title: 'Consent compliance', on: true },
  { id: 'data', type: 'data', title: 'All results', on: true },
];

export const SECTION_TEXT: Record<PackSection['type'], string> = {
  summary: 'Summary – the period, samples and results at a glance',
  map: 'Site map – the sites on a map (or plan)',
  graphs: 'Graphs – each analyte over time, by site',
  latest: 'Latest results – each site’s latest sample',
  compliance: 'Consent compliance – each limit and trigger',
  data: 'All results – a table to search (and download)',
  text: 'Text – your own words',
};

/** The settings with what isn't set filled in. */
export function packSettings(s: PackSettings | undefined): Required<Pick<PackSettings, 'period' | 'theme' | 'limits' | 'controls' | 'download' | 'aerial' | 'accent'>> & PackSettings {
  const sections = s?.sections?.length ? s.sections : DEFAULT_SECTIONS;
  return { period: 'all', theme: 'light', limits: true, controls: true, download: true, aerial: true, accent: '#0f766e', years: 5, ...s, sections };
}

/** The sites in the pack: those chosen, or every monitoring site. */
export function packSites(b: ProjectBundle, s: PackSettings): Site[] {
  const chosen = new Set(s.siteIds ?? []);
  const list = chosen.size ? b.sites.filter((x) => chosen.has(x.id)) : b.sites;
  return list.length ? list : b.sites;
}

/** The analytes in the pack: those chosen, else those the consent sets limits for, else every one with results. */
export function packParams(b: ProjectBundle, s: PackSettings): Parameter[] {
  const withData = new Set(b.index.paramIdsWithData);
  const pick = (ids: Iterable<string>) => {
    const set = new Set(ids);
    return b.params.filter((p) => set.has(p.id) && withData.has(p.id));
  };
  if (s.parameterIds?.length) return pick(s.parameterIds);
  const consent = pick(b.rules.filter((r) => r.active).flatMap((r) => ruleParamIds(r, b.setMap)));
  return consent.length ? consent : pick(withData);
}

/** The dates the pack covers. */
export function packPeriod(b: ProjectBundle, s: PackSettings, siteIds: string[]): { start: string; end: string; label: string } {
  const keep = new Set(siteIds);
  const dates = b.samples.filter((x) => keep.has(x.siteId)).map((x) => x.date.slice(0, 10)).sort();
  const first = dates[0] ?? '1900-01-01';
  const last = dates[dates.length - 1] ?? '2199-12-31';
  if (s.period === 'custom' && s.start && s.end) return { start: s.start, end: s.end, label: `${formatDate(s.start)} to ${formatDate(s.end)}` };
  if (s.period === 'years') {
    const years = Math.max(1, s.years ?? 5);
    const start = addDays(addMonths(last, -12 * years), 1);
    return { start, end: last, label: `The last ${years === 1 ? 'year' : `${years} years`} (${formatDate(start)} to ${formatDate(last)})` };
  }
  return { start: first, end: last, label: dates.length ? `All results (${formatDate(first)} to ${formatDate(last)})` : 'All results' };
}

export interface PackContext {
  version: number;
  made: string;
  app: string;
  company?: string;
  map?: PackData['map'];
}

const FLAG_CODE = (kind: string, trigger?: boolean) => (kind === 'limit' ? (trigger ? 2 : 1) : kind === 'guideline' ? 3 : 4);

/** Everything the pack shows, from the project and how the pack is set up. */
export function buildPackData(b: ProjectBundle, settings: PackSettings, ctx: PackContext): PackData {
  const s = packSettings(settings);
  const sites = packSites(b, s);
  const siteIds = sites.map((x) => x.id);
  const params = packParams(b, s);
  const period = packPeriod(b, s, siteIds);
  const scoped = siteIds.length < b.sites.length ? limitToSites(b, siteIds) : b;
  const siteIdx = new Map(sites.map((x, i) => [x.id, i]));
  const paramIdx = new Map(params.map((p, i) => [p.id, i]));
  const setIds = (s.guidelineSetIds ?? []).filter((id) => b.setMap.has(id));
  const evals = s.limits ? evaluateAll(scoped, period.start, period.end) : [];
  const flags = flagResults(scoped, evals, setIds, period.start, period.end);

  const inPeriod = (d: string) => d.slice(0, 10) >= period.start && d.slice(0, 10) <= period.end;
  const packSamples = scoped.samples.filter((x) => siteIdx.has(x.siteId) && inPeriod(x.date));
  const samples: PackData['samples'] = [];
  const results: PackData['results'] = [];
  const notes: string[] = [];
  const noteIdx = new Map<string, number>();
  for (const smp of packSamples) {
    const rows = (scoped.index.bySample.get(smp.id) ?? []).filter((r) => paramIdx.has(r.parameterId));
    if (!rows.length) continue;
    const si = samples.length;
    samples.push(smp.sampleName ? [siteIdx.get(smp.siteId)!, smp.date, smp.sampleName] : [siteIdx.get(smp.siteId)!, smp.date]);
    for (const r of rows) {
      const p = params[paramIdx.get(r.parameterId)!];
      const v = r.value === null ? null : convert(r.value, r.unit, p.unit);
      const f = flags.get(r.id);
      let n: number | undefined;
      if (f) {
        const text = f.messages.join('; ');
        if (!noteIdx.has(text)) noteIdx.set(text, notes.push(text) - 1);
        n = noteIdx.get(text);
      }
      const row: unknown[] = [si, paramIdx.get(r.parameterId)!, v === null ? null : Number(v.toPrecision(12)), r.qualifier || '', f ? FLAG_CODE(f.kind, f.trigger) : 0, n ?? null, v === null ? r.text ?? '' : ''];
      // leave off what's blank at the end: no text, no note, no highlight, no qualifier
      const blank = [undefined, undefined, undefined, '', 0, null, ''];
      while (row.length > 3 && row[row.length - 1] === blank[row.length - 1]) row.pop();
      results.push(row as PackData['results'][number]);
    }
  }

  const sets = setIds.map((id) => b.setMap.get(id)!);
  const lines = params.map((p) =>
    buildChartSpec({ index: scoped.index, param: p, sites: scoped.sites, siteIds, start: period.start, end: period.end, guidelineSets: sets, rules: s.limits ? scoped.rules : [], setMap: b.setMap, showRules: s.limits }).lines.map((l) => ({ ...l })),
  );

  const colorOf = new Map(b.sites.map((x, i) => [x.id, SERIES_LIGHT[i % SERIES_LIGHT.length]]));
  return {
    format: PACK_FORMAT,
    pack: { version: ctx.version, made: ctx.made, app: ctx.app, company: ctx.company || undefined },
    look: {
      title: s.title?.trim() || b.project.name,
      subtitle: s.subtitle?.trim() || [b.project.client, b.project.consents && `Consent ${b.project.consents}`].filter(Boolean).join(' · ') || undefined,
      intro: s.intro?.trim() || undefined,
      footer: s.footer?.trim() || undefined,
      accent: s.accent,
      logo: s.logo || undefined,
      theme: s.theme,
    },
    can: { limits: s.limits, controls: s.controls, download: s.download },
    sections: (s.sections ?? DEFAULT_SECTIONS).filter((x) => x.on).map(({ id, type, title, text, mode }) => ({ id, type, title: title.trim() || SECTION_TEXT[type].split(' – ')[0], text, mode })),
    period,
    sites: sites.map((x) => {
      const ll = siteLatLng(x);
      return { code: x.code, name: x.name || undefined, type: x.type, color: colorOf.get(x.id) ?? SERIES_LIGHT[0], ...(ll ? { lat: Number(ll.lat.toFixed(6)), lng: Number(ll.lng.toFixed(6)) } : {}) };
    }),
    params: params.map((p) => ({ name: p.name, unit: unitLabel(p.unit), group: p.group })),
    samples,
    results,
    notes,
    lines,
    compliance: evals.map((e) => ({ name: e.rule.name, condition: e.rule.condition || undefined, status: e.status, summary: e.summary })),
    map: ctx.map,
  };
}
