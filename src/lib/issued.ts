// Issued reports: what a report was built from, kept small enough to keep every revision.
//
// The samples and results are split by site and year, and each part is kept once under a fingerprint of what is in
// it, so a revision – or next month's report – shares every part that hasn't changed. Images are kept once each the
// same way. Everything else (the project, sites, rules, layout, commentary) is one small compressed part.

import type {
  ArchivePart,
  ConditionAssessment,
  ConsentCondition,
  ContinuousSeries,
  ExceedanceNote,
  FigureImage,
  GuidelineSet,
  IssueSnapshot,
  MonitoringSchedule,
  Parameter,
  Project,
  QaRecord,
  ReportObligation,
  ReportTemplate,
  Result,
  Rule,
  Sample,
  SeriesYear,
  Settings,
  Site,
} from '../db/types';
import { overlayFor } from './continuous';
import type { ProjectBundle } from './analysis';
import { buildIndex } from './dataIndex';
import { compareParams } from '../data/parameters';
import { isQcSite } from './qc';
import { fmtNum } from './values';
import { formatDate } from './dates';

export const SNAPSHOT_VERSION = 1;

// ------------------------------------------------------------ bytes

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function through(bytes: Uint8Array, t: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(t);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export const gzip = (text: string) => through(new TextEncoder().encode(text), new CompressionStream('gzip'));
export const gunzip = async (bytes: Uint8Array) => new TextDecoder().decode(await through(bytes, new DecompressionStream('gzip')));

/** SHA-256 as hex: a file's fingerprint (any change to the file changes it). */
export async function sha256(data: Uint8Array | string | Blob): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data;
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
  let out = '';
  for (const b of h) out += b.toString(16).padStart(2, '0');
  return out;
}

// ------------------------------------------------------------ what a report was built from

/** A sample in a part, without what the part already says (project and site). */
export type SampleRow = Omit<Sample, 'projectId' | 'siteId' | 'importId'>;
/** A result: parameter, value, qualifier, unit, then text, detection limit and why it was left out (when there are). */
export type ResultRow = [string, number | null, string, string, (string | null)?, (number | null)?, (Result['excluded'] | null)?];

/** The samples and results of one site in one year. */
export interface DataPart {
  site: string;
  year: string;
  samples: SampleRow[];
  /** Each sample's results, in the order of `samples`. */
  results: ResultRow[][];
}

export interface SnapshotContent {
  v: number;
  /** The day it was issued: the report's date. */
  issuedOn: string;
  project: Project;
  /** Every site, quality control ones included. */
  sites: Site[];
  parameters: Parameter[];
  guidelineSets: GuidelineSet[];
  rules: Rule[];
  notes: ExceedanceNote[];
  schedules: MonitoringSchedule[];
  obligations: ReportObligation[];
  qa: QaRecord[];
  conditions: ConsentCondition[];
  assessments: ConditionAssessment[];
  /** The layout as issued, changes made on the Reports tab included. */
  template: ReportTemplate;
  period: { start: string; end: string; label: string };
  siteIds?: string[];
  promptTexts: Record<string, string>;
  figures: Record<string, FigureImage[]>;
  settings: Partial<Settings>;
  /** QA/QC decisions name results by id: the result each named (sample, parameter, which of them). */
  resultRefs: Record<string, [string, string, number]>;
  /** The rainfall or flow records the report's graphs show. */
  continuous?: { series: ContinuousSeries[]; days: SeriesYear[] };
  /** The samples and results the project had, by site and year. */
  data: DataPart[];
}

export interface SnapshotInput {
  bundle: ProjectBundle;
  template: ReportTemplate;
  period: { start: string; end: string; label: string };
  settings: Settings;
  promptTexts?: Record<string, string>;
  figures?: Record<string, FigureImage[]>;
  siteIds?: string[];
  issuedOn: string;
}

const day = (d: string) => d.slice(0, 10);

function resultRow(r: Result): ResultRow {
  const row: unknown[] = [r.parameterId, r.value, r.qualifier, r.unit, r.text ?? null, r.dl ?? null, r.excluded ?? null];
  while (row.length > 4 && row[row.length - 1] === null) row.pop();
  return row as ResultRow;
}

const sampleRow = (s: Sample): SampleRow => {
  const { projectId: _p, siteId: _s, importId: _i, ...rest } = s;
  return rest;
};

/** Everything a report is built from, as it is now: what an issue keeps. */
export function snapshotContent(input: SnapshotInput): SnapshotContent {
  const { bundle: b, template, period, settings } = input;
  // every sample, not just those to the period's end: some sections (the QA/QC checks) look at a site's whole record
  const samples = [...b.samples, ...(b.qc?.samples ?? [])].sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : x.id < y.id ? -1 : 1));
  // the result ids QA/QC decisions name, to name them again when the report is rebuilt
  const named = new Set<string>();
  for (const rec of b.qc?.records ?? []) {
    for (const id of rec.resultIds ?? []) named.add(id);
    for (const k of rec.key.split('|')) named.add(k);
  }
  const resultRefs: Record<string, [string, string, number]> = {};
  const parts = new Map<string, DataPart>();
  const usedParams = new Set<string>();
  for (const s of samples) {
    const year = s.date.slice(0, 4) || 'undated';
    const k = `${s.siteId}|${year}`;
    let part = parts.get(k);
    if (!part) parts.set(k, (part = { site: s.siteId, year, samples: [], results: [] }));
    // in the order the project has them (some sections list things in that order)
    const rows = b.index.allBySample.get(s.id) ?? [];
    const seen = new Map<string, number>();
    for (const r of rows) {
      const n = seen.get(r.parameterId) ?? 0;
      seen.set(r.parameterId, n + 1);
      usedParams.add(r.parameterId);
      if (named.has(r.id)) resultRefs[r.id] = [s.id, r.parameterId, n];
    }
    part.samples.push(sampleRow(s));
    part.results.push(rows.map(resultRow));
  }
  // the parameters and guideline sets the report can use: those with results, and those its rules and layout name
  const named2 = JSON.stringify([b.project, b.rules, template]);
  // their other names (for importing) only where the report's text might name them so (a calculation)
  const words = JSON.stringify([template, input.promptTexts ?? {}]).toLowerCase();
  const parameters = b.params.filter((p) => usedParams.has(p.id) || named2.includes(`"${p.id}"`)).map((p) => ({ ...p, aliases: p.aliases.filter((a) => words.includes(a.toLowerCase())) }));
  const guidelineSets = b.guidelineSets.filter((g) => named2.includes(`"${g.id}"`));
  // the team key never goes into a report's record
  const { lastBackupAt: _l, defaultTemplateId: _d, guidelineUnit: _g, teamKey: _t, ...kept } = settings;
  return {
    v: SNAPSHOT_VERSION,
    issuedOn: input.issuedOn,
    project: b.project,
    sites: [...b.sites, ...(b.qc?.sites ?? [])],
    parameters,
    guidelineSets,
    rules: b.rules,
    notes: b.notes,
    schedules: b.schedules,
    obligations: b.obligations,
    qa: b.qc?.records ?? [],
    conditions: b.register?.conditions ?? [],
    assessments: b.register?.assessments ?? [],
    template,
    period: { start: period.start, end: period.end, label: period.label },
    siteIds: input.siteIds?.length ? [...input.siteIds] : undefined,
    promptTexts: input.promptTexts ?? {},
    figures: input.figures ?? {},
    settings: kept,
    resultRefs,
    continuous: usedContinuous(b, template),
    data: [...parts.values()].sort((x, y) => (x.site < y.site ? -1 : x.site > y.site ? 1 : x.year < y.year ? -1 : 1)),
  };
}

/** The rainfall and flow records a layout's graphs show. */
function usedContinuous(b: ProjectBundle, template: ReportTemplate): SnapshotContent['continuous'] {
  const used = new Map<string, { series: ContinuousSeries; years: SeriesYear[] }>();
  for (const blk of template.blocks) {
    if (blk.type !== 'chart') continue;
    const o = overlayFor(blk.overlay, b.continuous);
    if (o) used.set(o.series.id, o);
  }
  if (!used.size) return undefined;
  return { series: [...used.values()].map((o) => o.series), days: [...used.values()].flatMap((o) => o.years) };
}

// ------------------------------------------------------------ packing it small

const IMAGE = '@@envirodb-image:';

/** Swap each embedded image (a long data URL) for its key, gathering the images. */
function takeImages(x: unknown, keyOf: (url: string) => string, found: Map<string, string>): unknown {
  if (typeof x === 'string') {
    if (x.length > 256 && x.startsWith('data:')) {
      const key = keyOf(x);
      found.set(key, x);
      return IMAGE + key;
    }
    return x;
  }
  if (Array.isArray(x)) return x.map((v) => takeImages(v, keyOf, found));
  if (x && typeof x === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(x)) if (v !== undefined) out[k] = takeImages(v, keyOf, found);
    return out;
  }
  return x;
}

function putImages(x: unknown, images: Map<string, string>): unknown {
  if (typeof x === 'string') return x.startsWith(IMAGE) ? (images.get(x.slice(IMAGE.length)) ?? '') : x;
  if (Array.isArray(x)) return x.map((v) => putImages(v, images));
  if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, putImages(v, images)]));
  return x;
}

const partKey = async (projectId: string, text: string) => `${projectId}:${(await sha256(text)).slice(0, 32)}`;

/** The fingerprint of each site's and year's data, as an issue keeps them: to see quickly whether any has changed. */
export async function dataKeys(content: SnapshotContent): Promise<IssueSnapshot['data']> {
  return Promise.all(content.data.map(async (d) => ({ key: await partKey(content.project.id, JSON.stringify(d)), site: d.site, year: d.year })));
}

/**
 * Pack what a report was built from into parts for the archive. `stored` says which parts are kept already (and
 * their size): only the others are compressed and returned to keep.
 */
export async function packSnapshot(content: SnapshotContent, stored: (keys: string[]) => Promise<Map<string, number>>, year = content.issuedOn.slice(0, 4)): Promise<{ ref: IssueSnapshot; parts: ArchivePart[] }> {
  const projectId = content.project.id;
  // images first: each kept once, named by its own fingerprint
  const urls = new Set<string>();
  takeImages({ ...content, data: [] }, (u) => (urls.add(u), u), new Map());
  const imageKey = new Map<string, string>();
  for (const u of urls) imageKey.set(u, await partKey(projectId, u));
  const images = new Map<string, string>();
  const head = takeImages({ ...content, data: undefined }, (u) => imageKey.get(u)!, images);
  const headText = JSON.stringify(head);
  const plan: Array<{ key: string; kind: ArchivePart['kind']; text: string }> = [{ key: await partKey(projectId, headText), kind: 'head', text: headText }];
  const data = await dataKeys(content);
  content.data.forEach((d, i) => plan.push({ key: data[i].key, kind: 'data', text: JSON.stringify(d) }));
  for (const [key, url] of images) plan.push({ key, kind: 'image', text: url });
  // the same part twice (two identical sites' years) is kept once
  const unique = [...new Map(plan.map((p) => [p.key, p])).values()];
  const have = await stored(unique.map((p) => p.key));
  const parts: ArchivePart[] = [];
  let bytes = 0, raw = 0, added = 0;
  for (const p of unique) {
    raw += p.text.length;
    if (have.has(p.key)) {
      bytes += have.get(p.key)!;
      continue;
    }
    const z = p.kind === 'image' ? p.text : toBase64(await gzip(p.text));
    parts.push({ id: p.key, projectId, kind: p.kind, z, n: p.text.length, y: year });
    bytes += z.length;
    added += z.length;
  }
  return { ref: { v: SNAPSHOT_VERSION, head: plan[0].key, data, images: [...images.keys()], bytes, raw, added }, parts };
}

/** Some parts haven't arrived from the shared folder yet (or were never kept here). */
export class MissingParts extends Error {
  constructor(public missing: number) {
    super(`${missing} part${missing === 1 ? '' : 's'} of what this report was built from ${missing === 1 ? 'hasn’t' : 'haven’t'} reached this computer yet – it may still be on its way from the shared folder.`);
  }
}

/** Unpack what a report was built from. */
export async function unpackSnapshot(ref: IssueSnapshot, getParts: (keys: string[]) => Promise<Array<ArchivePart | undefined>>): Promise<SnapshotContent> {
  const keys = [ref.head, ...ref.data.map((d) => d.key), ...ref.images];
  const got = await getParts(keys);
  const missing = got.filter((p) => !p).length;
  if (missing) throw new MissingParts(missing);
  const byKey = new Map(got.map((p) => [p!.id, p!]));
  const text = async (key: string) => gunzip(fromBase64(byKey.get(key)!.z));
  const images = new Map(ref.images.map((k) => [k, byKey.get(k)!.z]));
  const head = putImages(JSON.parse(await text(ref.head)), images) as SnapshotContent;
  const data = await Promise.all(ref.data.map(async (d) => JSON.parse(await text(d.key)) as DataPart));
  return { ...head, data };
}

// ------------------------------------------------------------ rebuilding the report

/** A result's id when rebuilt: the same for the same result every time. */
const rebuiltId = (sampleId: string, parameterId: string, n: number) => `${sampleId}~${parameterId}~${n}`;

export function snapshotSamples(content: SnapshotContent): { samples: Sample[]; results: Result[] } {
  const projectId = content.project.id;
  const samples: Sample[] = [];
  const results: Result[] = [];
  for (const part of content.data) {
    part.samples.forEach((row, i) => {
      const s: Sample = { ...row, projectId, siteId: part.site };
      samples.push(s);
      const seen = new Map<string, number>();
      for (const r of part.results[i] ?? []) {
        const [parameterId, value, qualifier, unit, text, dl, excluded] = r;
        const n = seen.get(parameterId) ?? 0;
        seen.set(parameterId, n + 1);
        const res: Result = { id: rebuiltId(s.id, parameterId, n), projectId, sampleId: s.id, siteId: part.site, date: s.date, parameterId, value, qualifier: qualifier as Result['qualifier'], unit };
        if (text != null) res.text = text;
        if (dl != null) res.dl = dl;
        if (excluded) res.excluded = excluded;
        results.push(res);
      }
    });
  }
  return { samples, results };
}

/** The project as it was when the report was issued, for the report builder. */
export function snapshotBundle(content: SnapshotContent): ProjectBundle {
  const { samples, results } = snapshotSamples(content);
  const sites = [...content.sites].sort((a, b) => a.order - b.order || a.code.localeCompare(b.code));
  const params = [...content.parameters].sort(compareParams);
  const qcSites = new Set(sites.filter((s) => isQcSite(s)).map((s) => s.id));
  const isQc = (s: Sample) => !!s.qc || qcSites.has(s.siteId);
  // as the app orders them: by date, samples on the same date in the order the database keeps them (by id)
  const byDate = [...samples].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  // QA/QC decisions name the results by their ids then: name them by the rebuilt ones
  const ids = new Map(Object.entries(content.resultRefs ?? {}).map(([old, [sid, pid, n]]) => [old, rebuiltId(sid, pid, n)]));
  const rename = (id: string) => ids.get(id) ?? id;
  const records = content.qa.map((r) => ({ ...r, key: r.key.split('|').map(rename).join('|'), resultIds: r.resultIds?.map(rename) }));
  return {
    project: content.project,
    sites: sites.filter((s) => !qcSites.has(s.id)),
    siteMap: new Map(sites.map((s) => [s.id, s])),
    samples: byDate.filter((s) => !isQc(s)),
    params,
    paramMap: new Map(params.map((p) => [p.id, p])),
    guidelineSets: content.guidelineSets,
    setMap: new Map(content.guidelineSets.map((g) => [g.id, g])),
    rules: [...content.rules].sort((a, b) => a.order - b.order),
    notes: content.notes,
    schedules: content.schedules,
    obligations: content.obligations,
    index: buildIndex(samples, results, sites, params),
    qc: { sites: sites.filter((s) => qcSites.has(s.id)), samples: byDate.filter(isQc), records },
    register: { conditions: content.conditions, assessments: content.assessments },
    continuous: content.continuous ?? { series: [], days: [] },
  };
}

// ------------------------------------------------------------ revisions

/** The revision after these: Rev 0 → Rev 1, Draft A → Draft B. */
export function nextRevision(previous: string[]): string {
  const last = previous[previous.length - 1]?.trim();
  if (!last) return 'Rev 0';
  const num = last.match(/^(.*?)(\d+)$/);
  if (num) return `${num[1]}${Number(num[2]) + 1}`;
  const letter = last.match(/^(|.*\s)([A-Y])$/);
  if (letter) return `${letter[1]}${String.fromCharCode(letter[2].charCodeAt(0) + 1)}`;
  return `${last} (${previous.length + 1})`;
}

/** Bytes as "84 KB". */
export function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

// ------------------------------------------------------------ what has changed since

export type ChangeArea = 'results' | 'samples' | 'sites' | 'rules' | 'guidelines' | 'project' | 'layout' | 'commentary' | 'figures' | 'qa' | 'register' | 'notes' | 'other';

export interface IssueChange {
  area: ChangeArea;
  text: string;
  /** About data in the report's period (rather than the earlier data it compares with). */
  inPeriod?: boolean;
}

export interface IssueDiff {
  changes: IssueChange[];
  /** Results in the report's sites: changed, added and removed – and how many of them are in its period. */
  results: { changed: number; added: number; removed: number; inPeriod: number };
  /** The data in the report's period changed. */
  dataInPeriod: boolean;
  summary: string;
}

export const AREA_TEXT: Record<ChangeArea, string> = {
  results: 'Results',
  samples: 'Samples',
  sites: 'Sites',
  rules: 'Consent limits and triggers',
  guidelines: 'Guideline values',
  project: 'Project details',
  layout: 'Layout',
  commentary: 'Commentary',
  figures: 'Figures',
  qa: 'QA/QC decisions',
  register: 'Compliance register',
  notes: 'Exceedance notes',
  other: 'Other',
};

/** The sites a report covers: those chosen (and the upstream sites their rules compare with), else every one. */
export function reportSites(content: SnapshotContent): Set<string> {
  if (!content.siteIds?.length) return new Set(content.sites.map((s) => s.id));
  const keep = new Set(content.siteIds);
  for (const r of content.rules) if (r.kind === 'change' && r.referenceSiteId && (!r.siteIds.length || r.siteIds.some((id) => keep.has(id)))) keep.add(r.referenceSiteId);
  // its quality control sites too (duplicates and blanks)
  for (const s of content.sites) if (isQcSite(s)) keep.add(s.id);
  return keep;
}

const json = (x: unknown) => JSON.stringify(x ?? null);
const without = <T extends object>(x: T, keys: string[]) => Object.fromEntries(Object.entries(x).filter(([k]) => !keys.includes(k)));
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What differs between what a report was built from and what it would be built from now (or a later revision's). */
export function diffSnapshots(old: SnapshotContent, cur: SnapshotContent): IssueDiff {
  const changes: IssueChange[] = [];
  const add = (area: ChangeArea, text: string, inPeriod?: boolean) => changes.push({ area, text, inPeriod });
  const { start, end } = old.period;
  const inPeriod = (date: string) => day(date) >= start && day(date) <= end;
  const siteCode = new Map([...old.sites, ...cur.sites].map((s) => [s.id, s.code]));
  const paramName = new Map([...old.parameters, ...cur.parameters].map((p) => [p.id, p.short || p.name]));
  const scope = reportSites(old);
  const at = (siteId: string, date: string) => `${siteCode.get(siteId) ?? 'a site'}, ${formatDate(day(date))}`;
  const shown = (r: ResultRow | undefined) => {
    if (!r) return '–';
    const v = r[4] && r[1] === null ? r[4] : `${r[2] || ''}${fmtNum(r[1])}`;
    return `${v} ${r[3] ?? ''}`.trim();
  };

  // ---- samples and results
  type Flat = { site: string; s: SampleRow; rows: Map<string, ResultRow> };
  const flatten = (c: SnapshotContent) => {
    const m = new Map<string, Flat>();
    for (const part of c.data) {
      if (!scope.has(part.site)) continue;
      part.samples.forEach((s, i) => {
        if (day(s.date) > end) return; // results since don't change what the report says of its period
        const rows = new Map<string, ResultRow>();
        const seen = new Map<string, number>();
        for (const r of part.results[i] ?? []) {
          const n = seen.get(r[0]) ?? 0;
          seen.set(r[0], n + 1);
          rows.set(n ? `${r[0]}~${n}` : r[0], r);
        }
        m.set(s.id, { site: part.site, s, rows });
      });
    }
    return m;
  };
  const a = flatten(old), b = flatten(cur);
  const counts = { changed: 0, added: 0, removed: 0, inPeriod: 0 };
  const count = (kind: 'changed' | 'added' | 'removed', n: number, date: string) => {
    counts[kind] += n;
    if (inPeriod(date)) counts.inPeriod += n;
  };
  const pname = (key: string) => paramName.get(key.split('~')[0]) ?? key;
  for (const [id, x] of a) {
    const y = b.get(id);
    if (!y) {
      add('samples', `Sample removed: ${at(x.site, x.s.date)} (${plural(x.rows.size, 'result')})`, inPeriod(x.s.date));
      count('removed', x.rows.size, x.s.date);
      continue;
    }
    if (y.site !== x.site) add('samples', `Sample of ${formatDate(day(x.s.date))} moved from ${siteCode.get(x.site) ?? 'a site'} to ${siteCode.get(y.site) ?? 'another site'}`, inPeriod(x.s.date) || inPeriod(y.s.date));
    else if (y.s.date !== x.s.date) add('samples', `Sample at ${at(x.site, x.s.date)} now dated ${formatDate(day(y.s.date))}`, inPeriod(x.s.date) || inPeriod(y.s.date));
    else if (json(without(x.s, ['date'])) !== json(without(y.s, ['date']))) add('samples', `Sample details changed: ${at(x.site, x.s.date)}`, inPeriod(x.s.date));
    for (const [k, r] of x.rows) {
      const r2 = y.rows.get(k);
      if (!r2) {
        add('results', `${at(x.site, x.s.date)} · ${pname(k)} ${shown(r)}: removed`, inPeriod(x.s.date));
        count('removed', 1, x.s.date);
      } else if (json(r) !== json(r2)) {
        const was = r[6], now = r2[6];
        // the value, unit, text and detection limit (rows leave off trailing blanks)
        const value = (x: ResultRow) => json([0, 1, 2, 3, 4, 5].map((i) => x[i] ?? null));
        const what = value(r) === value(r2) ? (now && !was ? `left out (${now.reason})` : !now && was ? 'back in' : 'reason for leaving it out changed') : `${shown(r)} → ${shown(r2)}${now && !was ? ', left out' : !now && was ? ', back in' : ''}`;
        add('results', `${at(x.site, x.s.date)} · ${pname(k)}: ${what}`, inPeriod(x.s.date));
        count('changed', 1, x.s.date);
      }
    }
    const extra = [...y.rows.keys()].filter((k) => !x.rows.has(k));
    if (extra.length) {
      add('results', `${at(y.site, y.s.date)}: ${extra.length > 3 ? plural(extra.length, 'result') : extra.map((k) => `${pname(k)} ${shown(y.rows.get(k))}`).join(', ')} added`, inPeriod(y.s.date));
      count('added', extra.length, y.s.date);
    }
  }
  for (const [id, y] of b) {
    if (a.has(id)) continue;
    add('samples', `Sample added: ${at(y.site, y.s.date)} (${plural(y.rows.size, 'result')})`, inPeriod(y.s.date));
    count('added', y.rows.size, y.s.date);
  }

  // ---- sites, project, rules, guideline values
  if (json(old.siteIds) !== json(cur.siteIds)) add('sites', 'The sites the report covers changed');
  const byId = <T extends { id: string }>(list: T[]) => new Map(list.map((x) => [x.id, x]));
  const cmp = <T extends { id: string }>(area: ChangeArea, x: T[], y: T[], name: (t: T) => string, ignore: string[], only?: (t: T) => boolean) => {
    const mx = byId(x.filter((t) => !only || only(t))), my = byId(y.filter((t) => !only || only(t)));
    for (const [id, t] of mx) {
      const u = my.get(id);
      if (!u) add(area, `Removed: ${name(t)}`);
      else if (json(without(t, ignore)) !== json(without(u, ignore))) add(area, `Changed: ${name(u)}`);
    }
    for (const [id, u] of my) if (!mx.has(id)) add(area, `Added: ${name(u)}`);
  };
  cmp('sites', old.sites, cur.sites, (s) => s.code, ['updatedAt'], (s) => scope.has(s.id));
  const PROJECT_FIELDS: Array<[keyof Project, string]> = [
    ['name', 'name'], ['code', 'project number'], ['client', 'client'], ['consents', 'consents'], ['regulator', 'regulator'], ['location', 'location'], ['description', 'description'],
    ['recipient', 'who letters go to'], ['salutation', 'letter greeting'], ['guidelineSetIds', 'guideline sets compared'], ['hardnessAdjust', 'hardness adjustment'], ['ndHandling', 'non-detect statistics'], ['percentileMethod', 'percentile method'], ['yearStartMonth', 'reporting year'],
  ];
  const projectChanged = PROJECT_FIELDS.filter(([k]) => json(old.project[k]) !== json(cur.project[k])).map(([, t]) => t);
  if (projectChanged.length) add('project', `Changed: ${projectChanged.join(', ')}`);
  cmp('rules', old.rules, cur.rules, (r) => r.name, ['updatedAt', 'order']);
  cmp('guidelines', old.guidelineSets, cur.guidelineSets, (g) => g.shortName || g.name, ['updatedAt', 'order']);

  // ---- the report itself: layout, commentary, figures
  const layoutOf = (t: ReportTemplate) => without(t, ['updatedAt', 'blocks', 'name', 'description']);
  const ob = byId(old.template.blocks), nb = byId(cur.template.blocks);
  const changedBlocks = [...ob.keys()].filter((id) => nb.has(id) && json(ob.get(id)) !== json(nb.get(id))).length;
  const addedBlocks = [...nb.keys()].filter((id) => !ob.has(id)).length;
  const removedBlocks = [...ob.keys()].filter((id) => !nb.has(id)).length;
  const moved = !changedBlocks && !addedBlocks && !removedBlocks && json(old.template.blocks.map((x) => x.id)) !== json(cur.template.blocks.map((x) => x.id));
  const layout = [
    changedBlocks && `${plural(changedBlocks, 'section')} changed`,
    addedBlocks && `${plural(addedBlocks, 'section')} added`,
    removedBlocks && `${plural(removedBlocks, 'section')} removed`,
    moved && 'sections moved',
    json(layoutOf(old.template)) !== json(layoutOf(cur.template)) && 'page settings changed',
  ].filter(Boolean);
  if (layout.length) add('layout', `${layout.join(', ')}`.replace(/^./, (c) => c.toUpperCase()));
  const promptKeys = new Set([...Object.keys(old.promptTexts), ...Object.keys(cur.promptTexts)]);
  const edited = [...promptKeys].filter((k) => (old.promptTexts[k] ?? '') !== (cur.promptTexts[k] ?? '')).length;
  if (edited) add('commentary', `Edited in ${plural(edited, 'section')}`);
  const figs = (c: SnapshotContent) => json(Object.fromEntries(Object.entries(c.figures).filter(([, v]) => v?.length)));
  if (figs(old) !== figs(cur)) add('figures', 'Images added, removed or changed');

  // ---- decisions made since: QA/QC, the register, exceedance notes
  const ours = (ids?: string[]) => !ids?.length || ids.some((id) => scope.has(id));
  const qa = byId(old.qa);
  // (results left out and samples swapped show as changes to the results)
  const decision = (r: QaRecord) => ours(r.siteIds) && r.status !== 'excluded' && r.status !== 'swapped';
  for (const r of cur.qa) {
    if (!decision(r)) continue;
    const was = qa.get(r.id);
    if (!was || was.status !== r.status || was.note !== r.note) add('qa', `${r.title}: ${r.status}${r.note ? ` – ${r.note}` : ''}`, r.date ? inPeriod(r.date) : undefined);
  }
  for (const r of old.qa) if (decision(r) && !cur.qa.some((x) => x.id === r.id)) add('qa', `Decision taken back: ${r.title}`, r.date ? inPeriod(r.date) : undefined);
  const condName = new Map([...old.conditions, ...cur.conditions].map((c) => [c.id, c.ref ? `Condition ${c.ref}` : c.title]));
  const grades = (c: SnapshotContent) => new Map(c.assessments.filter((x) => x.start === start && x.end === end).map((x) => [x.conditionId, x]));
  const ga = grades(old), gb = grades(cur);
  for (const id of new Set([...ga.keys(), ...gb.keys()])) {
    const x = ga.get(id), y = gb.get(id);
    if (x?.grade !== y?.grade || x?.note !== y?.note) add('register', `${condName.get(id) ?? 'A condition'}: ${x ? x.grade : 'not graded'} → ${y ? y.grade : 'not graded'}`);
  }
  cmp('register', old.conditions, cur.conditions, (c) => (c.ref ? `Condition ${c.ref}` : c.title), ['updatedAt', 'order']);
  const notesA = byId(old.notes), notesB = byId(cur.notes);
  const notesChanged = [...new Set([...notesA.keys(), ...notesB.keys()])].filter((id) => json(without(notesA.get(id) ?? {}, ['updatedAt'])) !== json(without(notesB.get(id) ?? {}, ['updatedAt']))).length;
  if (notesChanged) add('notes', `${plural(notesChanged, 'note')} added or changed`);
  for (const sr of old.continuous?.series ?? []) {
    const days = (c: SnapshotContent) => json((c.continuous?.days ?? []).filter((d) => d.seriesId === sr.id).sort((a, b) => (a.year < b.year ? -1 : 1)).map((d) => d.v));
    if (days(old) !== days(cur)) add('other', `${sr.name}: records changed`);
  }
  if (json(old.settings.letterhead) !== json(cur.settings.letterhead) && old.template.letterhead) add('other', 'The letterhead changed');
  if ((old.settings.company ?? '') !== (cur.settings.company ?? '')) add('other', 'The company name changed');

  const dataInPeriod = changes.some((c) => (c.area === 'results' || c.area === 'samples') && c.inPeriod);
  return { changes, results: counts, dataInPeriod, summary: diffSummary(changes, counts) };
}

/** How each kind of change reads in a summary. */
const AREA_PHRASE: Record<ChangeArea, string> = {
  results: '',
  samples: '',
  sites: 'site details changed',
  rules: 'consent limits or triggers changed',
  guidelines: 'guideline values changed',
  project: 'project details changed',
  layout: 'the layout changed',
  commentary: 'the commentary edited',
  figures: 'the figures changed',
  qa: 'QA/QC decisions made',
  register: 'compliance grades changed',
  notes: 'exceedance notes changed',
  other: 'the letterhead or company changed',
};

function diffSummary(changes: IssueChange[], c: IssueDiff['results']): string {
  if (!changes.length) return 'Nothing has changed since.';
  const parts: string[] = [];
  const n = c.changed + c.added + c.removed;
  if (n) {
    const kinds = (['changed', 'added', 'removed'] as const).filter((k) => c[k]);
    const verb = kinds.length === 1 ? kinds[0] : `${kinds.slice(0, -1).join(', ')} or ${kinds[kinds.length - 1]}`;
    const where = c.inPeriod === n ? ' in the period' : c.inPeriod ? `, ${c.inPeriod} of them in the period` : ' before the period';
    const detail = kinds.length > 1 ? ` (${kinds.map((k) => `${c[k]} ${k}`).join(', ')})` : '';
    parts.push(`${n === 1 ? 'a result' : `${n} results`} ${verb}${where}${detail}`);
  }
  const samples = changes.filter((x) => x.area === 'samples' && /moved|now dated|details/.test(x.text)).length;
  if (samples) parts.push(`${plural(samples, 'sample')} moved or changed`);
  for (const a of new Set(changes.map((x) => x.area))) if (AREA_PHRASE[a]) parts.push(AREA_PHRASE[a]);
  const text = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
  return `${text[0].toUpperCase()}${text.slice(1)}.`;
}
