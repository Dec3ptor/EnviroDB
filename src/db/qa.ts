// What's done about QA/QC findings: fine as it is, results left out (kept, struck through, out of the monitoring
// data), samples swapped back to their right sites, queried with the lab – each recorded in the project's QA/QC log
// with who, when and why, and undoable.

import { db, getSettings } from './db';
import type { QaRecord, Result, Sample } from './types';
import { formatDate } from '../lib/dates';
import type { QaFinding } from '../lib/qa';
import { touchProject } from './repo';

const nowIso = () => new Date().toISOString();
const who = async () => (await getSettings()).author || undefined;

/** The decision, for the log. `by`: who (read before a transaction – settings aren't in it). */
function decision(projectId: string, f: QaFinding, status: QaRecord['status'], note: string | undefined, by: string | undefined, extra: Partial<QaRecord> = {}): QaRecord {
  return {
    id: `${projectId}|${f.key}`,
    projectId,
    key: f.key,
    kind: f.kind,
    status,
    note: note?.trim() || undefined,
    title: f.title,
    lines: f.lines,
    date: f.date,
    siteIds: f.siteIds,
    resultIds: f.resultIds.length ? f.resultIds : undefined,
    by,
    at: nowIso(),
    ...extra,
  };
}

async function record(projectId: string, f: QaFinding, status: QaRecord['status'], note: string | undefined, extra: Partial<QaRecord> = {}): Promise<void> {
  await db.qa.put(decision(projectId, f, status, note, await who(), extra));
}

/** Fine as it is (why, for the record). */
export async function acceptFinding(projectId: string, f: QaFinding, note: string): Promise<void> {
  await record(projectId, f, 'accepted', note);
}

/** Asked the lab about it. */
export async function queryFinding(projectId: string, f: QaFinding, note?: string): Promise<void> {
  await record(projectId, f, 'queried', note);
}

/** Leave results out of the monitoring data (kept, and shown struck through), with the reason. */
export async function excludeResults(projectId: string, f: QaFinding, resultIds: string[], reason: string): Promise<void> {
  const by = await who();
  const excluded = { reason: reason.trim() || f.title, by, at: nowIso() };
  await db.transaction('rw', [db.results, db.qa, db.projects], async () => {
    for (const id of resultIds) await db.results.update(id, { excluded });
    await db.qa.put(decision(projectId, f, 'excluded', reason, by, { resultIds }));
    await touchProject(projectId);
  });
}

/** Put left-out results back (and take them off the decisions that left them out). */
export async function restoreResults(resultIds: string[]): Promise<void> {
  const ids = new Set(resultIds);
  await db.transaction('rw', db.results, db.qa, async () => {
    for (const id of resultIds) await db.results.update(id, { excluded: undefined });
    const recs = await db.qa.filter((r) => r.status === 'excluded' && !!r.resultIds?.some((x) => ids.has(x))).toArray();
    for (const r of recs) {
      const left = (r.resultIds ?? []).filter((x) => !ids.has(x));
      if (left.length) await db.qa.update(r.id, { resultIds: left });
      else await db.qa.delete(r.id);
    }
  });
}

/** Leave one result out by hand (seen in the data rather than found by a check). */
export async function excludeResult(r: Result, reason: string, label: string): Promise<void> {
  const excluded = { reason: reason.trim() || 'left out by hand', by: await who(), at: nowIso() };
  await db.transaction('rw', [db.results, db.qa, db.projects], async () => {
    await db.results.update(r.id, { excluded });
    await db.qa.put({
      id: `${r.projectId}|manual|${r.id}`,
      projectId: r.projectId,
      key: `manual|${r.id}`,
      kind: 'manual',
      status: 'excluded',
      note: reason.trim() || undefined,
      title: `${label} left out`,
      date: r.date.slice(0, 10),
      siteIds: [r.siteId],
      resultIds: [r.id],
      by: excluded.by,
      at: excluded.at,
    });
    await touchProject(r.projectId);
  });
}

const MEASURED: Array<keyof Result> = ['value', 'qualifier', 'unit', 'text', 'dl'];

/**
 * Swap two samples' sites (the bottles were labelled the wrong way round), or just some analytes' results between
 * them (the lab mixed up one set of bottles). Doing it again swaps them back.
 */
export async function swapSamples(a: string, b: string, parameterIds?: string[], why?: string): Promise<void> {
  await db.transaction('rw', [db.samples, db.results, db.sites], async () => {
    const [A, B] = await Promise.all([db.samples.get(a), db.samples.get(b)]);
    if (!A || !B) throw new Error('One of the samples has gone.');
    const [ra, rb] = await Promise.all([db.results.where('sampleId').equals(a).toArray(), db.results.where('sampleId').equals(b).toArray()]);
    const code = async (id: string) => (await db.sites.get(id))?.code ?? '?';
    const today = formatDate(nowIso().slice(0, 10));
    if (!parameterIds) {
      const note = async (s: Sample, to: string) => [s.notes, `QA/QC ${today}: moved from ${await code(s.siteId)} to ${await code(to)} – bottles swapped${why ? ` (${why})` : ''}.`].filter(Boolean).join('\n');
      await db.samples.update(a, { siteId: B.siteId, notes: await note(A, B.siteId) });
      await db.samples.update(b, { siteId: A.siteId, notes: await note(B, A.siteId) });
      for (const r of ra) await db.results.update(r.id, { siteId: B.siteId });
      for (const r of rb) await db.results.update(r.id, { siteId: A.siteId });
      return;
    }
    // the measurements change places; the results stay with their samples
    for (const pid of parameterIds) {
      const x = ra.find((r) => r.parameterId === pid);
      const y = rb.find((r) => r.parameterId === pid);
      if (!x || !y) continue;
      const take = (r: Result) => Object.fromEntries(MEASURED.map((k) => [k, r[k]])) as Partial<Result>;
      await db.results.update(x.id, take(y));
      await db.results.update(y.id, take(x));
    }
    const names = parameterIds.length > 4 ? `${parameterIds.length} analytes` : parameterIds.join(', ');
    await db.samples.update(a, { notes: [A.notes, `QA/QC ${today}: ${names} swapped with ${await code(B.siteId)}${why ? ` (${why})` : ''}.`].filter(Boolean).join('\n') });
    await db.samples.update(b, { notes: [B.notes, `QA/QC ${today}: ${names} swapped with ${await code(A.siteId)}${why ? ` (${why})` : ''}.`].filter(Boolean).join('\n') });
  });
}

/** Swap as a finding suggests, and record it. */
export async function swapFinding(projectId: string, f: QaFinding, note: string): Promise<void> {
  if (!f.swap) return;
  await swapSamples(f.swap.a, f.swap.b, f.swap.parameterIds, note.trim() || undefined);
  await record(projectId, f, 'swapped', note, { swap: f.swap });
  await touchProject(projectId);
}

/** Undo a decision: left-out results go back, a swap is swapped back, and the finding is open again. */
export async function undoRecord(rec: QaRecord): Promise<void> {
  if (rec.status === 'excluded' && rec.resultIds?.length) await restoreResults(rec.resultIds);
  if (rec.status === 'swapped' && rec.swap) await swapSamples(rec.swap.a, rec.swap.b, rec.swap.parameterIds, 'undone');
  await db.qa.delete(rec.id);
}

/** Set (or clear) the original sample of a duplicate. */
export async function setDuplicateOf(sampleId: string, primaryId: string | undefined): Promise<void> {
  await db.samples.update(sampleId, { qcOf: primaryId });
}

/** Mark a sample as a QC sample (or not). */
export async function setSampleQc(sampleId: string, qc: Sample['qc'] | undefined): Promise<void> {
  await db.samples.update(sampleId, qc ? { qc } : { qc: undefined, qcOf: undefined });
}

/** Text for an email asking the lab to check results. */
export function labQueryText(findings: QaFinding[], opts: { project: string; jobs: string[] }): string {
  const lines = [
    `Hi,`,
    ``,
    `Could you please check the following results${opts.jobs.length ? ` (job${opts.jobs.length === 1 ? '' : 's'} ${opts.jobs.join(', ')})` : ''} for ${opts.project}:`,
    ``,
  ];
  for (const f of findings) {
    lines.push(`- ${formatDate(f.date)} – ${f.title}`);
    for (const l of f.lines) lines.push(`    ${l}`);
  }
  lines.push('', 'Could the samples have been swapped, or is there a transcription or unit error? Please let me know if a re-analysis or an amended report is possible.', '', 'Thanks');
  return lines.join('\n');
}
