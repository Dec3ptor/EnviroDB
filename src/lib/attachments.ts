// The lab's own reports at the back of a report: which of the project's files go in – those of the kinds asked for
// that are about the period's samples, or its sampling rounds – and their pages as pictures, read from the shared
// folder when the report is built.

import type { FileKind, ProjectFile, Sample } from '../db/types';
import { formatDate } from './dates';
import { hasPages, pagesOf, type FilePages, type PageImage } from './pdfPages';
import { kindLabel, linkedSampleIds, roundName, roundSpan, sharedCopy, type RoundRows } from './projectFiles';

/** A file put in a report: which, and what it's about. */
export interface AttachedRef {
  fileId: string;
  name: string;
  kind: FileKind;
  /** Where its copy is in the shared folder. */
  path?: string;
  size?: number;
  type?: string;
  /** What it's about, in words: "Hill Labs job 3300139 – 3 samples, 9 Oct 2026". */
  about?: string;
  /** The lab jobs of the samples it's about. */
  jobs?: string[];
}

/** The same with its pages – or why it has none. */
export interface AttachedDoc extends AttachedRef {
  pages: PageImage[];
  /** Pages left off (a very long document). */
  more?: number;
  /** Why it isn't in: a link, not a PDF, not in the shared folder. */
  missing?: string;
  /** It never could go in (a link, a spreadsheet) – rather than one that should have and couldn't be read. */
  unprintable?: boolean;
}

const KIND_ORDER: FileKind[] = ['results', 'coc', 'field'];

export interface PeriodFilesInput {
  files: ProjectFile[];
  /** The kinds of file wanted. */
  kinds: FileKind[];
  period: { start: string; end: string };
  /** Every sample of the project (QC samples too). */
  samples: Array<Pick<Sample, 'id' | 'labJob' | 'date' | 'siteId' | 'qc' | 'labName'>>;
  byImport: Map<string, Set<string>>;
  rows?: RoundRows;
  /** Only these sites' samples count (every site when none). */
  siteIds?: string[];
}

/**
 * The files a report of this period takes: each file of the kinds wanted that's linked to a sample taken in the
 * period (at the report's sites) – or to a sampling round in it, whose samples aren't in yet. In the order sampled,
 * a round's lab results before its chain of custody and field sheets.
 */
export function periodFiles(input: PeriodFilesInput): AttachedRef[] {
  const { period } = input;
  const kinds = new Set(input.kinds);
  const sites = input.siteIds?.length ? new Set(input.siteIds) : null;
  const byId = new Map(input.samples.map((s) => [s.id, s]));
  const out: Array<{ ref: AttachedRef; when: string }> = [];
  for (const f of input.files) {
    if (!kinds.has(f.kind) || !f.linked) continue;
    const mine = linkedSampleIds(f, input.samples, input.byImport, input.rows)
      .map((id) => byId.get(id)!)
      .filter((s) => s.date.slice(0, 10) >= period.start && s.date.slice(0, 10) <= period.end && (!sites || !!s.qc || sites.has(s.siteId)));
    let when = '';
    let about = '';
    let jobs: string[] = [];
    if (mine.length) {
      const days = [...new Set(mine.map((s) => s.date.slice(0, 10)))].sort();
      when = days[0];
      jobs = [...new Set(mine.map((s) => s.labJob?.trim() ?? '').filter(Boolean))];
      const lab = f.lab ?? mine.find((s) => s.labName)?.labName;
      const dayText = days.length === 1 ? formatDate(days[0]) : `${formatDate(days[0])} – ${formatDate(days[days.length - 1])}`;
      about = [[lab, jobs.length === 1 ? `job ${jobs[0]}` : ''].filter(Boolean).join(' '), `${mine.length} sample${mine.length === 1 ? '' : 's'}, ${dayText}`].filter(Boolean).join(' – ');
    } else if (f.linked.kind === 'round') {
      // a round in the period with no samples in yet: its paperwork still belongs
      const months = roundSpan(f.linked, input.rows).months;
      if (!months.some((m) => m >= period.start.slice(0, 7) && m <= period.end.slice(0, 7))) continue;
      when = `${months[0]}-01`;
      about = `the ${roundName(f.linked, input.rows)} round`;
    } else continue;
    out.push({ ref: { fileId: f.id, name: f.name, kind: f.kind, path: f.path, size: f.size, type: f.type, about: about || undefined, ...(jobs.length ? { jobs } : {}) }, when });
  }
  const rank = (k: FileKind) => (KIND_ORDER.indexOf(k) + 1 || 9);
  return out.sort((a, b) => a.when.localeCompare(b.when) || rank(a.ref.kind) - rank(b.ref.kind) || a.ref.name.localeCompare(b.ref.name)).map((x) => x.ref);
}

/** What goes over a document in the report: "Lab results: Hill 3300139.pdf – Hill Labs job 3300139 – 3 samples, 9 Oct 2026". */
export const attachedTitle = (d: AttachedRef): string => `${kindLabel(d.kind)}: ${d.name}${d.about ? ` – ${d.about}` : ''}`;

/** The most pages of one document put in a report. */
export const ATTACHED_MAX_PAGES = 60;

// a few documents' pages, kept while reports are being worked on (drawing them again takes seconds)
const drawn = new Map<string, Promise<FilePages>>();
const KEPT = 10;

/** The files' pages, read from the shared folder: PDFs and pictures (anything else, or one that's gone, says why not). */
export async function loadAttachments(refs: AttachedRef[], read: (ref: AttachedRef) => Promise<File | null> = (r) => sharedCopy(r)): Promise<AttachedDoc[]> {
  const out: AttachedDoc[] = [];
  for (const ref of refs) {
    if (!ref.path) {
      out.push({ ...ref, pages: [], missing: 'a link – only a file kept with the project can be put in', unprintable: true });
      continue;
    }
    if (!hasPages(ref)) {
      out.push({ ...ref, pages: [], missing: 'not a PDF or a picture', unprintable: true });
      continue;
    }
    const key = `${ref.path}|${ref.size ?? ''}`;
    let got = drawn.get(key);
    if (!got) {
      got = (async () => {
        const file = await read(ref);
        if (!file) throw new Error('not in the shared folder');
        return pagesOf(file, { dpi: 170, maxPages: ATTACHED_MAX_PAGES, quality: 0.85 });
      })();
      drawn.set(key, got);
      got.catch(() => drawn.delete(key));
      if (drawn.size > KEPT) drawn.delete(drawn.keys().next().value!);
    }
    try {
      const { pages, total } = await got;
      out.push({ ...ref, pages, more: total > pages.length ? total - pages.length : undefined, missing: pages.length ? undefined : 'it has no pages' });
    } catch (e) {
      out.push({ ...ref, pages: [], missing: (e as Error).message || 'it couldn’t be read' });
    }
  }
  return out;
}

/** The documents that can go in: files kept with the project that are PDFs or pictures. */
export const printable = (refs: Record<string, AttachedRef[]>): Record<string, AttachedRef[]> => Object.fromEntries(Object.entries(refs).map(([k, v]) => [k, v.filter((r) => !!r.path && hasPages(r))]));

/** The same documents: nothing to read again. */
export const sameRefs = (a: AttachedRef[] | undefined, b: AttachedRef[] | undefined): boolean =>
  !!a && !!b && a.length === b.length && a.every((x, i) => x.fileId === b[i].fileId && x.path === b[i].path && x.size === b[i].size && x.about === b[i].about && x.name === b[i].name);

/** Each section's documents with their pages. */
export async function loadAllAttachments(refs: Record<string, AttachedRef[]> | undefined): Promise<Record<string, AttachedDoc[]> | undefined> {
  if (!refs) return undefined;
  const out: Record<string, AttachedDoc[]> = {};
  for (const [blockId, list] of Object.entries(refs)) out[blockId] = await loadAttachments(list);
  return out;
}

/** The documents that went in (those with pages) – what an issued report keeps. */
export function attachedRefs(docs: Record<string, AttachedDoc[]> | undefined): Record<string, AttachedRef[]> | undefined {
  if (!docs) return undefined;
  return Object.fromEntries(Object.entries(docs).map(([k, v]) => [k, v.filter((d) => d.pages.length).map(({ pages: _p, more: _m, missing: _x, unprintable: _u, ...ref }) => ref)]));
}
