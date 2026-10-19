// Issuing reports: keeping what each was built from (compressed, each part once), the files' fingerprints and its
// revisions; rebuilding a report as issued; finding which issued report a file is.

import { db, DEFAULT_SETTINGS, getSettings } from './db';
import type { IssuedReport } from './types';
import { uid } from '../lib/ids';
import { APP_VERSION } from '../lib/version';
import { packSnapshot, snapshotBundle, unpackSnapshot, type SnapshotContent } from '../lib/issued';
import type { BuildOptions } from '../reports/build';
import { setSubmitted } from './repo';

const nowIso = () => new Date().toISOString();

/** The parts already kept, and their size. */
async function storedSizes(keys: string[]): Promise<Map<string, number>> {
  const recs = await db.archive.bulkGet(keys);
  return new Map(recs.flatMap((r): Array<[string, number]> => (r ? [[r.id, r.z.length]] : [])));
}

export interface IssueInput {
  content: SnapshotContent;
  templateId: string;
  report: string;
  obligationId?: string;
  revision: string;
  purpose?: string;
  to?: string;
  reason?: string;
  files: IssuedReport['files'];
  /** The revision this one replaces. */
  previous?: IssuedReport;
  /** Mark the reporting obligation's period submitted on the day. */
  markSubmitted?: boolean;
}

/** Keep a report as issued: locked, with what it was built from. */
export async function issueReport(x: IssueInput): Promise<IssuedReport> {
  const { content } = x;
  const { ref, parts } = await packSnapshot(content, storedSizes);
  const by = (await getSettings()).author || undefined;
  const at = nowIso();
  const rec: IssuedReport = {
    id: uid('iss'),
    projectId: content.project.id,
    templateId: x.templateId,
    report: x.report,
    period: content.period,
    siteIds: content.siteIds,
    obligationId: x.obligationId,
    revision: x.revision.trim() || 'Rev 0',
    purpose: x.purpose?.trim() || undefined,
    to: x.to?.trim() || undefined,
    reason: x.reason?.trim() || x.previous?.revising?.reason || undefined,
    by,
    at,
    appVersion: APP_VERSION,
    files: x.files,
    snapshot: ref,
    updatedAt: at,
  };
  await db.transaction('rw', [db.issues, db.archive], async () => {
    if (parts.length) await db.archive.bulkPut(parts);
    await db.issues.put(rec);
    if (x.previous?.revising) await db.issues.update(x.previous.id, { revising: undefined, updatedAt: at });
  });
  if (x.markSubmitted && x.obligationId) await setSubmitted(x.obligationId, { periodStart: content.period.start, periodEnd: content.period.end }, content.issuedOn);
  return rec;
}

/** Unlock an issued report to prepare a revision. */
export async function startRevision(issue: IssuedReport, reason: string): Promise<void> {
  const by = (await getSettings()).author || undefined;
  await db.issues.update(issue.id, { revising: { reason: reason.trim() || undefined, by, at: nowIso() }, updatedAt: nowIso() });
}

/** Lock it again without a new revision. */
export async function cancelRevision(issue: IssuedReport): Promise<void> {
  await db.issues.update(issue.id, { revising: undefined, updatedAt: nowIso() });
}

/**
 * Take back an issue made by mistake. What it was built from stays in the archive – parts are shared with other
 * issues, and a colleague may be issuing with the same parts at this moment.
 */
export async function deleteIssue(issue: IssuedReport): Promise<void> {
  await db.issues.delete(issue.id);
}

// a few unpacked, kept while the Reports tab is open
const unpacked = new Map<string, Promise<SnapshotContent>>();

/** What an issued report was built from. */
export function loadIssued(issue: IssuedReport): Promise<SnapshotContent> {
  const k = `${issue.id}|${issue.snapshot.head}`;
  let p = unpacked.get(k);
  if (!p) {
    p = unpackSnapshot(issue.snapshot, (keys) => db.archive.bulkGet(keys));
    p.catch(() => unpacked.delete(k));
    unpacked.set(k, p);
    if (unpacked.size > 6) unpacked.delete(unpacked.keys().next().value!);
  }
  return p;
}

/** The report builder's options for an issued report, as it was issued. */
export function issuedBuildOptions(content: SnapshotContent, issue: Pick<IssuedReport, 'revision'>): Omit<BuildOptions, 'renderChart'> {
  return {
    bundle: snapshotBundle(content),
    template: content.template,
    period: content.period,
    settings: { ...DEFAULT_SETTINGS, ...content.settings },
    promptTexts: content.promptTexts,
    figures: content.figures,
    siteIds: content.siteIds,
    today: content.issuedOn,
    issue: { revision: issue.revision },
  };
}

/** The issued report a file is, by its fingerprint – from any project. */
export async function findIssuedFile(sha256: string): Promise<{ issue: IssuedReport; file: IssuedReport['files'][number] } | null> {
  for (const issue of await db.issues.toArray()) {
    const file = issue.files.find((f) => f.sha256 === sha256);
    if (file) return { issue, file };
  }
  return null;
}
