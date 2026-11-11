// A project's files: lab quotes and result sheets, chains of custody, the consent … A file uploaded here is copied as
// it is into the team's shared folder – Project files/<project>/ – where everyone's EnviroDB, and File Explorer, finds
// it; a link points to one kept elsewhere: a SharePoint or web address, or a path on the network drive. A file can be
// linked to the data it's about – a lab job's samples, an import's, samples chosen, or a sampling round (its chain of
// custody, before there are any results) – and then shows with them.

import { db } from '../db/db';
import { logAudit, whoAmI } from '../db/audit';
import { saveEdited } from '../db/repo';
import type { CalendarRow, FileKind, FileLink, ImportBatch, Project, ProjectFile, Result, Sample } from '../db/types';
import { nowIso, uid } from './ids';
import { safeName } from './photos';
import { currentWorkspaceFolder } from '../sync/workspace';
import type { WorkspaceFolder } from '../sync/folder';
import { labOfText, peekText } from '../importers/sniff';
import { formatDate } from './dates';
import { cellValue, monthName } from './calendar';
import { roundMonths } from './rounds';

export const FILE_KINDS: Array<{ value: FileKind; label: string }> = [
  { value: 'results', label: 'Lab results' },
  { value: 'quote', label: 'Quote' },
  { value: 'coc', label: 'Chain of custody' },
  { value: 'field', label: 'Field sheet' },
  { value: 'consent', label: 'Consent' },
  { value: 'report', label: 'Report' },
  { value: 'correspondence', label: 'Correspondence' },
  { value: 'invoice', label: 'Invoice' },
  { value: 'other', label: 'Other' },
];

export const kindLabel = (k: FileKind): string => FILE_KINDS.find((x) => x.value === k)?.label ?? 'Other';

/** The shared folder's folder of projects' files. */
export const FILES_DIR = 'Project files';

/** Where a project's files go in the shared folder. */
export const projectFilesDir = (p: Pick<Project, 'code' | 'name'>): string => `${FILES_DIR}/${safeName(p.code || p.name || '') || 'Project'}`;

/**
 * Whether a path is one of the copies EnviroDB keeps (in Project files) – the only files it opens or deletes for a
 * project's file, whatever a record (synced from a colleague's computer, say) names.
 */
export const isKeptPath = (path: string | undefined): boolean => !!path && path.startsWith(`${FILES_DIR}/`) && !path.split('/').some((x) => x === '..' || x === '.' || x === '');

/** A record without the fields it hasn't got (nothing undefined is kept). */
const clean = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

// ------------------------------------------------------------ what a file is

/** Words in a file's name that say what it is – the first that fits. */
const NAME_HINTS: Array<[RegExp, FileKind]> = [
  [/\b(quote|quotes|quotation|quotations|estimate|pricing|prices|price list|rates|schedule of rates|fee proposal)\b/, 'quote'],
  [/\b(invoice|invoices|tax invoice|statement of account)\b/, 'invoice'],
  [/\b(coc|cocs|chain of custody|sample submission|submission form|analysis request)\b/, 'coc'],
  [/\b(field (sheet|sheets|notes|note|record|records|log|form)|sampling (sheet|record|log|form))\b/, 'field'],
  [/\b(consent|consents|permit|discharge permit)\b/, 'consent'],
  [/\b(certificate|coa|analysis|analyses|analytical|result|results|lab report|test report|esdat|final report|interim report)\b/, 'results'],
  [/\b(email|letter|memo|correspondence)\b/, 'correspondence'],
  [/\b(report|reports)\b/, 'report'],
];
/** What a document's first page says it is, when its name doesn't. */
const TEXT_HINTS: Array<[RegExp, FileKind]> = [
  [/\bquotation\b|\bquote (no|number|ref)/i, 'quote'],
  [/\btax invoice\b|\binvoice (no|number|date)/i, 'invoice'],
  [/chain of custody/i, 'coc'],
  [/certificate of analysis|analysis report|test report|laboratory report|lab(oratory)? job|date received/i, 'results'],
  [/resource consent|consent (no|number)/i, 'consent'],
];

/** What a file most likely is: by its name, then its first page's words; a lab's file is lab results unless it says otherwise. */
export function guessKind(name: string, text = '', labFile = false): FileKind {
  const ext = /\.([a-z0-9]{1,5})$/i.exec(name)?.[1]?.toLowerCase() ?? '';
  if (ext === 'msg' || ext === 'eml') return 'correspondence';
  const words = ` ${name.replace(/\.[a-z0-9]{1,5}$/i, '').toLowerCase().replace(/[_.\-–—()[\],+:;]+/g, ' ').replace(/\s+/g, ' ')} `;
  for (const [re, kind] of NAME_HINTS) if (re.test(words)) return labFile && (kind === 'report' || kind === 'correspondence') ? 'results' : kind;
  const head = text.slice(0, 4000);
  for (const [re, kind] of TEXT_HINTS) if (re.test(head)) return kind;
  return labFile ? 'results' : 'other';
}

/** A number as it's compared: capitals and digits only ("23-14205" → "2314205"). */
export const refKey = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * Job, report and sample numbers in a text: runs of 5–12 digits, with up to four letters before them (ALS's
 * "EM2612345"), or "23-14205". Dates and phone numbers come too – they're only ever matched to the project's own jobs.
 */
export function numbersIn(text: string, max = 60): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/(?<![A-Za-z0-9])([A-Za-z]{0,4}\d{5,12}|\d{2,4}-\d{4,8})(?![0-9])/g)) {
    out.add(m[1].toUpperCase());
    if (out.size >= max) break;
  }
  return [...out];
}

/** A lab job of the project's: its samples, the days and sites they're from. */
export interface LabJob {
  /** As its samples have it. */
  job: string;
  lab?: string;
  sampleIds: string[];
  /** The days sampled, earliest first. */
  dates: string[];
  siteIds: string[];
}

/** The project's lab jobs, from its samples – the latest first. */
export function projectJobs(samples: Array<Pick<Sample, 'id' | 'labJob' | 'labName' | 'date' | 'siteId'>>): LabJob[] {
  const by = new Map<string, LabJob>();
  for (const s of samples) {
    const job = s.labJob?.trim();
    const k = job ? refKey(job) : '';
    if (!job || !k) continue;
    let j = by.get(k);
    if (!j) by.set(k, (j = { job, lab: s.labName, sampleIds: [], dates: [], siteIds: [] }));
    j.sampleIds.push(s.id);
    const day = s.date.slice(0, 10);
    if (!j.dates.includes(day)) j.dates.push(day);
    if (!j.siteIds.includes(s.siteId)) j.siteIds.push(s.siteId);
    j.lab ??= s.labName;
  }
  const last = (j: LabJob) => j.dates[j.dates.length - 1];
  return [...by.values()].map((j) => ({ ...j, dates: [...j.dates].sort() })).sort((a, b) => (last(a) < last(b) ? 1 : last(a) > last(b) ? -1 : 0));
}

/** Labs as a file's name or a quote names them ("Hill Labs quote.pdf"). */
const LAB_NAMES: Array<[RegExp, string]> = [
  [/\b(r\s*j\s*)?hill\s*lab(s|oratories|oratory)?\b/i, 'Hill Labs'],
  [/\beurofins\b/i, 'Eurofins'],
  [/\bALS\b/, 'ALS'],
  [/\banalytica\b/i, 'Analytica'],
  [/\bwatercare\b/i, 'Watercare'],
  [/\blinnaeus\b/i, 'Linnaeus'],
];

/** What a file seems to be, from its name and some of its text: its kind, the lab, the project's lab job, and the numbers in it. */
export function describeFile(name: string, text: string, jobs: LabJob[]): { kind: FileKind; lab?: string; ref?: string; numbers: string[] } {
  const all = `${name}\n${text}`;
  const numbers = numbersIn(all);
  const keys = new Map(jobs.map((j) => [refKey(j.job), j]));
  const job = numbers.map((n) => keys.get(refKey(n))).find(Boolean);
  const marked = labOfText(all);
  const lab = marked.labName ?? LAB_NAMES.find(([re]) => re.test(all))?.[1] ?? job?.lab;
  return { kind: guessKind(name, text, marked.hit || !!lab || !!job), lab, ref: job?.job, numbers };
}

/** The project's lab job a file seems to be about – by its number, or the numbers in it – to offer linking it to. */
export function suggestedJob(f: Pick<ProjectFile, 'linked' | 'ref' | 'numbers' | 'name'>, jobs: LabJob[]): LabJob | undefined {
  if (f.linked || !jobs.length) return undefined;
  const byKey = new Map(jobs.map((j) => [refKey(j.job), j]));
  for (const n of [f.ref ?? '', ...(f.numbers ?? []), ...numbersIn(f.name)]) {
    const j = byKey.get(refKey(n));
    if (j) return j;
  }
  return undefined;
}

// ------------------------------------------------------------ the data a file is linked to

/** Which samples each import put results in: the samples it made, and those it added results to. */
export function samplesByImport(samples: Array<Pick<Sample, 'id' | 'importId'>>, results: Array<Pick<Result, 'sampleId' | 'importId'>>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const add = (importId: string | undefined, sampleId: string) => {
    if (!importId) return;
    let set = out.get(importId);
    if (!set) out.set(importId, (set = new Set()));
    set.add(sampleId);
  };
  for (const s of samples) add(s.importId, s.id);
  for (const r of results) add(r.importId, r.sampleId);
  return out;
}

/** A sampling round a file is linked to. */
export type RoundLink = Extract<FileLink, { kind: 'round' }>;
/** The monitoring calendar's rows, by id – what a round link's row is looked up in. */
export type RoundRows = ReadonlyMap<string, CalendarRow>;
/** A sample as the links see it: what a round goes by is its day and site. */
type LinkSample = Pick<Sample, 'id' | 'labJob'> & Partial<Pick<Sample, 'date' | 'siteId' | 'qc'>>;

/**
 * The months and sites of a round a file is linked to: the calendar row's round that starts that month – its whole
 * sampling window, the row's sites – or, with no row (or one since deleted), the month and every site.
 */
export function roundSpan(l: Pick<RoundLink, 'month' | 'row'>, rows?: RoundRows): { months: string[]; siteIds?: string[] } {
  const row = l.row ? rows?.get(l.row) : undefined;
  if (!row) return { months: [l.month] };
  return { months: roundMonths(row, l.month), siteIds: row.siteIds?.length ? row.siteIds : undefined };
}

/** Whether a sample is of a round: taken in its months, at its sites (a duplicate or blank goes with whatever round it's taken in). */
const inRound = (s: Partial<Pick<Sample, 'date' | 'siteId' | 'qc'>>, span: { months: string[]; siteIds?: string[] }): boolean =>
  !!s.date && span.months.includes(s.date.slice(0, 7)) && (!span.siteIds || !!s.qc || (!!s.siteId && span.siteIds.includes(s.siteId)));

/** A round in words: "October 2026", "October – December 2026"; with the row's job when the project has several rows. */
export function roundName(l: Pick<RoundLink, 'month' | 'row'>, rows?: RoundRows, withJob = false): string {
  const { months } = roundSpan(l, rows);
  const last = months[months.length - 1];
  const year = (m: string) => m.slice(0, 4);
  const when = months.length > 1 ? `${monthName(months[0], true)}${year(months[0]) === year(last) ? '' : ` ${year(months[0])}`} – ${monthName(last, true)} ${year(last)}` : `${monthName(l.month, true)} ${year(l.month)}`;
  const row = l.row ? rows?.get(l.row) : undefined;
  const job = withJob && row ? cellValue(row, 'job') : '';
  return job ? `${when} (${job})` : when;
}

/** A round's files, of a project's: those linked to the calendar row's round, or to one of its months alone. */
export function roundFiles(files: ProjectFile[], round: { row?: string; months: string[] }): ProjectFile[] {
  return files.filter((f) => {
    const l = f.linked;
    return l?.kind === 'round' && round.months.includes(l.month) && (!l.row || l.row === round.row);
  });
}

/** The forms printed with every round's paperwork (the lab's chain of custody, filled in for the project) – PDFs and pictures kept here. */
export const roundForms = (files: ProjectFile[]): ProjectFile[] => files.filter((f) => f.eachRound && !!f.path);

/** The samples a file is linked to (those still in the project). */
export function linkedSampleIds(f: Pick<ProjectFile, 'linked'>, samples: LinkSample[], byImport: Map<string, Set<string>>, rows?: RoundRows): string[] {
  const l = f.linked;
  if (!l) return [];
  if (l.kind === 'job') {
    const k = refKey(l.job);
    return samples.filter((s) => !!s.labJob && refKey(s.labJob) === k).map((s) => s.id);
  }
  if (l.kind === 'round') {
    const span = roundSpan(l, rows);
    return samples.filter((s) => inRound(s, span)).map((s) => s.id);
  }
  const have = new Set(samples.map((s) => s.id));
  if (l.kind === 'import') return [...(byImport.get(l.importId) ?? [])].filter((id) => have.has(id));
  return l.sampleIds.filter((id) => have.has(id));
}

/** Each sample's files: those linked to it. */
export function filesBySample(files: ProjectFile[], samples: LinkSample[], byImport: Map<string, Set<string>>, rows?: RoundRows): Map<string, ProjectFile[]> {
  const out = new Map<string, ProjectFile[]>();
  for (const f of files)
    for (const id of linkedSampleIds(f, samples, byImport, rows)) {
      const list = out.get(id);
      if (list) list.push(f);
      else out.set(id, [f]);
    }
  return out;
}

/**
 * The lab jobs with no result sheet on file: none of the job's samples has a file of lab results linked to it. Only
 * jobs sampled on or after `since` ('YYYY-MM-DD'), the latest first.
 */
export function jobsWithoutSheet(jobs: LabJob[], files: ProjectFile[], samples: LinkSample[], byImport: Map<string, Set<string>>, since = '', rows?: RoundRows): LabJob[] {
  const withSheet = new Set<string>();
  for (const f of files) if (f.kind === 'results') for (const id of linkedSampleIds(f, samples, byImport, rows)) withSheet.add(id);
  return jobs.filter((j) => j.dates[j.dates.length - 1] >= since && !j.sampleIds.some((id) => withSheet.has(id)));
}

/** Samples in words: "3 samples, 12 Oct 2026 – US1, DP1, DS1", or with the first and last days. */
export function sampleSummary(ids: string[], sampleOf: (id: string) => Pick<Sample, 'date' | 'siteId'> | undefined, siteCode: (siteId: string) => string | undefined): string {
  const list = ids.map(sampleOf).filter((s): s is Pick<Sample, 'date' | 'siteId'> => !!s);
  if (!list.length) return 'no samples';
  const days = [...new Set(list.map((s) => s.date.slice(0, 10)))].sort();
  const sites = [...new Set(list.map((s) => siteCode(s.siteId) ?? ''))].filter(Boolean);
  const when = days.length === 1 ? formatDate(days[0]) : `${formatDate(days[0])} – ${formatDate(days[days.length - 1])}`;
  return `${list.length} sample${list.length === 1 ? '' : 's'}, ${when}${sites.length ? ` – ${sites.slice(0, 6).join(', ')}${sites.length > 6 ? ' …' : ''}` : ''}`;
}

/** Whether a file is linked to this sample – `results`: the sample's (for a link to an import). */
export function fileIsAbout(f: Pick<ProjectFile, 'linked'>, sample: Pick<Sample, 'id' | 'labJob' | 'importId'> & Partial<Pick<Sample, 'date' | 'siteId' | 'qc'>>, results: Array<Pick<Result, 'importId'>>, rows?: RoundRows): boolean {
  const l = f.linked;
  if (!l) return false;
  if (l.kind === 'job') return !!sample.labJob && refKey(sample.labJob) === refKey(l.job);
  if (l.kind === 'round') return inRound(sample, roundSpan(l, rows));
  if (l.kind === 'import') return sample.importId === l.importId || results.some((r) => r.importId === l.importId);
  return l.sampleIds.includes(sample.id);
}

// ------------------------------------------------------------ links to files kept elsewhere

/** A web address that may be opened – http or https, nothing else – or null. */
export function webAddress(s: string | undefined): string | null {
  const t = (s ?? '').trim();
  if (!/^https?:\/\//i.test(t)) return null;
  try {
    const u = new URL(t);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

/** A path as File Explorer gives it – "G:\…", "\\server\…", a file:/// address, or with the quotes "Copy as path" adds – tidied. */
export function tidyPath(s: string): string {
  let t = s.trim().replace(/^"(.*)"$/, '$1').trim();
  if (/^file:\/\//i.test(t)) {
    try {
      t = decodeURIComponent(t.replace(/^file:\/\/\/?/i, ''));
    } catch {
      t = t.replace(/^file:\/\/\/?/i, '');
    }
    if (/^[a-z]:\//i.test(t)) t = t.replace(/\//g, '\\');
    else if (!/^[a-z]:/i.test(t)) t = `\\\\${t.replace(/\//g, '\\')}`;
  }
  return t;
}

/** What a link or path is to, as a name: its last part ("…/Quote%202026.pdf?web=1" → "Quote 2026.pdf"). */
export function nameOfTarget(target: string): string {
  const web = webAddress(target);
  let last = '';
  if (web) last = new URL(web).pathname.split('/').filter(Boolean).pop() ?? new URL(web).hostname;
  else last = target.split(/[\\/]+/).filter(Boolean).pop() ?? target;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/** Where a path is inside the projects folder (named `rootName`): "G:\Projects\Clients\Kōwhai\Quote.pdf" → "Clients/Kōwhai/Quote.pdf". */
export function insideProjectsFolder(path: string, rootName?: string): string | undefined {
  if (!rootName || webAddress(path)) return undefined;
  const parts = path.split(/[\\/]+/).filter(Boolean);
  const at = parts.findIndex((x) => x.toLowerCase() === rootName.toLowerCase());
  return at >= 0 && at < parts.length - 1 ? parts.slice(at + 1).join('/') : undefined;
}

/** A link or path that can be kept: a web address, or a path – anything else ("javascript:", "data:" …) isn't. */
export function linkTarget(s: string): string | null {
  const web = webAddress(s);
  if (web) return web;
  const path = tidyPath(s);
  if (!path) return null;
  // a scheme other than a drive letter: not a path, and not a web address
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) && !/^[a-z]:([\\/]|$)/i.test(path)) return null;
  return path;
}

// ------------------------------------------------------------ adding, changing and taking off

/** The first pages' words of a PDF – none when it can't be read. */
async function pdfText(file: Blob, pages = 3): Promise<string> {
  if (file.size > 40 * 1024 * 1024) return '';
  try {
    const { loadPdfJs } = await import('./pdfjs');
    const pdfjs = await loadPdfJs();
    const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
    try {
      const doc = await task.promise;
      let out = '';
      for (let n = 1; n <= Math.min(pages, doc.numPages); n++) {
        const tc = await (await doc.getPage(n)).getTextContent();
        out += `${tc.items.map((it) => ('str' in it ? it.str : '')).join(' ')}\n`;
      }
      return out;
    } finally {
      await task.destroy();
    }
  } catch {
    return '';
  }
}

/** Some of a file's text, to tell what it is: a PDF's first pages, a spreadsheet's or CSV's start. */
export async function fileText(file: File): Promise<string> {
  if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') return pdfText(file);
  if (/\.(txt|md|log)$/i.test(file.name)) return file.slice(0, 64 * 1024).text();
  return peekText(file);
}

/** A name not yet taken in the folder: "Quote.pdf", then "Quote (2).pdf" … */
export async function freePath(folder: WorkspaceFolder, dir: string, name: string): Promise<string> {
  const clean = safeName(name).replace(/[. ]+$/, '') || 'File';
  const dot = clean.lastIndexOf('.');
  const [stem, ext] = dot > 0 ? [clean.slice(0, dot), clean.slice(dot)] : [clean, ''];
  for (let n = 1; n < 500; n++) {
    const path = `${dir}/${n === 1 ? clean : `${stem} (${n})${ext}`}`;
    if (!(await folder.info(path).catch(() => null))) return path;
  }
  return `${dir}/${stem} ${uid('f').slice(-6)}${ext}`;
}

export interface AddedFiles {
  added: ProjectFile[];
  /** There already (the same name and size). */
  skipped: string[];
  /** There already, and now linked (when the files are added to a round). */
  relinked: ProjectFile[];
  errors: string[];
}

/**
 * Files uploaded to a project: each copied as it is into the shared folder (Project files/<project>/), and listed with
 * what it seems to be – a quote, lab results – its lab, and the numbers in it, to offer the lab job it's about. One
 * there already (the same name and size) is left. Nothing is linked to data until you choose to.
 */
export async function addProjectFiles(
  project: Pick<Project, 'id' | 'code' | 'name'>,
  files: File[],
  opts: {
    jobs?: LabJob[];
    folder?: WorkspaceFolder | null;
    readText?: (f: File) => Promise<string>;
    /** What the files are about, when they're added to it (a round's paperwork): they're linked as they're added. */
    linked?: FileLink;
    /** What they are, when their names and words don't say (a round's: its chain of custody). */
    kind?: FileKind;
  } = {},
): Promise<AddedFiles> {
  const folder = opts.folder === undefined ? currentWorkspaceFolder() : opts.folder;
  const out: AddedFiles = { added: [], skipped: [], relinked: [], errors: [] };
  if (!folder?.writeBlob) {
    out.errors.push('The shared folder isn’t connected, so files can’t be kept here – add a link to them instead.');
    return out;
  }
  const have = await db.files.where('projectId').equals(project.id).toArray();
  const dir = projectFilesDir(project);
  const by = whoAmI() || undefined;
  for (const file of files) {
    const there = have.find((f) => f.path && f.name === file.name && f.size === file.size);
    if (there) {
      // here already: linked to what it's added to now, if it wasn't linked to anything
      if (opts.linked && !there.linked) {
        const next = { ...there, linked: opts.linked, kind: there.kind === 'other' && opts.kind ? opts.kind : there.kind };
        await saveEdited(db.files, next, there);
        have[have.indexOf(there)] = next;
        out.relinked.push(next);
      } else out.skipped.push(file.name);
      continue;
    }
    try {
      const path = await freePath(folder, dir, file.name);
      await folder.writeBlob(path, file);
      const text = await (opts.readText ?? fileText)(file).catch(() => '');
      const d = describeFile(file.name, text, opts.jobs ?? []);
      const f = clean<ProjectFile>({
        id: uid('file'),
        projectId: project.id,
        name: file.name,
        kind: d.kind === 'other' && opts.kind ? opts.kind : d.kind,
        path,
        size: file.size,
        type: file.type || undefined,
        lab: d.lab,
        ref: d.ref,
        numbers: d.numbers.length ? d.numbers : undefined,
        linked: opts.linked,
        addedAt: nowIso(),
        addedBy: by,
      });
      await db.files.put(f);
      have.push(f);
      out.added.push(f);
    } catch (e) {
      out.errors.push(`${file.name}: ${(e as Error).message}`);
    }
  }
  if (out.added.length) await logAudit(project.id, 'file', out.added.length === 1 ? `File added: ${out.added[0].name}` : `${out.added.length} files added: ${out.added.map((f) => f.name).join(', ')}`);
  return out;
}

/** A link to a file kept elsewhere: a web address (SharePoint, OneDrive …) or a path on the network drive. */
export async function addProjectLink(projectId: string, target: string, details: Partial<Pick<ProjectFile, 'name' | 'kind' | 'lab' | 'ref' | 'date' | 'notes'>> = {}, jobs: LabJob[] = []): Promise<ProjectFile> {
  const href = linkTarget(target);
  if (!href) throw new Error('Paste a web link (https://…) or a path (G:\\… or \\\\server\\…).');
  const name = details.name?.trim() || nameOfTarget(href);
  const d = describeFile(name, href, jobs);
  const f = clean<ProjectFile>({
    id: uid('file'),
    projectId,
    name,
    kind: details.kind ?? d.kind,
    href,
    lab: details.lab?.trim() || d.lab,
    ref: details.ref?.trim() || d.ref,
    date: details.date,
    notes: details.notes?.trim() || undefined,
    numbers: d.numbers.length ? d.numbers : undefined,
    addedAt: nowIso(),
    addedBy: whoAmI() || undefined,
  });
  await db.files.put(f);
  await logAudit(projectId, 'file', `Link added: ${name}`);
  return f;
}

/** A file's details changed (only what was changed here – a colleague's changes to the rest stay). */
export async function saveProjectFile(next: ProjectFile, before: ProjectFile): Promise<void> {
  if (next.href !== before.href) {
    const href = next.href ? linkTarget(next.href) : null;
    if (!href) throw new Error('Paste a web link (https://…) or a path (G:\\… or \\\\server\\…).');
    next = { ...next, href };
  }
  await saveEdited(db.files, clean({ ...next, name: next.name.trim() || before.name }), before);
  await logAudit(next.projectId, 'file', `File details changed: ${next.name}`);
}

/** Link a file to the data it's about – or (none) take the link off. */
export async function linkProjectFile(f: ProjectFile, linked: FileLink | undefined, said?: string): Promise<void> {
  const next = { ...f, linked };
  if (!linked) delete next.linked;
  await saveEdited(db.files, next, f);
  await logAudit(f.projectId, 'file', linked ? `${f.name} linked to ${said ?? 'data'}` : `${f.name} no longer linked to data`);
}

/** The file itself, from the shared folder (null: not there, or the folder isn't connected). */
export async function sharedCopy(f: Pick<ProjectFile, 'path'>, folder: WorkspaceFolder | null = currentWorkspaceFolder()): Promise<File | null> {
  if (!f.path || !isKeptPath(f.path) || !folder) return null;
  return folder.file(f.path).catch(() => null);
}

/** Bigger than this, a file taken off can't be put back with Undo (it isn't held in memory). */
const UNDO_MAX = 150 * 1024 * 1024;

/** Take a file off the project – its copy in the shared folder goes too. Returns how to put it back (Undo). */
export async function removeProjectFile(f: ProjectFile, folder: WorkspaceFolder | null = currentWorkspaceFolder()): Promise<() => Promise<void>> {
  // the copy held in memory first (the folder's file can't be read once it's gone)
  let held: Blob | null = null;
  const kept = isKeptPath(f.path);
  try {
    const copy = kept && folder ? await folder.file(f.path!) : null;
    if (copy && copy.size <= UNDO_MAX) held = new Blob([await copy.arrayBuffer()], { type: copy.type });
  } catch {
    // not there, or not readable: it can still go, and the record can come back
  }
  await db.files.delete(f.id);
  if (kept && folder) await folder.remove(f.path!).catch(() => undefined);
  await logAudit(f.projectId, 'file', `File removed: ${f.name}`);
  return async () => {
    if (held && kept && folder?.writeBlob) await folder.writeBlob(f.path!, held);
    await db.files.put(f);
    await logAudit(f.projectId, 'file', `File put back: ${f.name}`);
  };
}

/** A file an import read: one dropped on the page, or one from a zip. */
export type ImportedFile = File | { name: string; data: ArrayBuffer };

/**
 * The files an import read, kept with the project: each copied to the shared folder and linked to the import's
 * results. One kept before (the same name and size – imported again) is linked to this import instead of copied again.
 */
export async function keepImportFiles(project: Pick<Project, 'id' | 'code' | 'name'>, files: ImportedFile[], batch: Pick<ImportBatch, 'id'>, info: { lab?: string; job?: string } = {}, folder: WorkspaceFolder | null = currentWorkspaceFolder()): Promise<number> {
  if (!folder?.writeBlob || !files.length) return 0;
  const have = await db.files.where('projectId').equals(project.id).toArray();
  const dir = projectFilesDir(project);
  const linked: FileLink = { kind: 'import', importId: batch.id };
  let kept = 0;
  for (const x of files) {
    const blob = x instanceof Blob ? x : new Blob([x.data]);
    const there = have.find((f) => f.path && f.name === x.name && f.size === blob.size);
    if (there) {
      await saveEdited(db.files, { ...there, linked, fromImport: batch.id }, there);
      kept++;
      continue;
    }
    const path = await freePath(folder, dir, x.name);
    await folder.writeBlob(path, blob);
    const numbers = numbersIn(x.name);
    await db.files.put(
      clean<ProjectFile>({
        id: uid('file'),
        projectId: project.id,
        name: x.name,
        kind: 'results',
        path,
        size: blob.size,
        type: (x instanceof File && x.type) || undefined,
        lab: info.lab,
        ref: info.job,
        numbers: numbers.length ? numbers : undefined,
        linked,
        fromImport: batch.id,
        addedAt: nowIso(),
        addedBy: whoAmI() || undefined,
      }),
    );
    kept++;
  }
  if (kept) await logAudit(project.id, 'file', kept === 1 ? `Lab file kept with the project: ${files[0].name}` : `${kept} lab files kept with the project`);
  return kept;
}

/** How big a file is, in words: "120 KB", "3.4 MB". */
export function fileSize(bytes?: number): string {
  if (bytes === undefined) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
