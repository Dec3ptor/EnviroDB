import { db } from '../db/db';
import type { ImportBatch, Parameter, Result, Sample } from '../db/types';
import { addParameterAlias, addSiteAlias, touchProject } from '../db/repo';
import { stableId, uid } from '../lib/ids';
import { isQcSite } from '../lib/qc';
import { analyteMapKey, PROVISIONAL_NOTE, type ParsedImport } from './model';

export interface ImportMapping {
  sites: Record<string, string | null>; // sample key → site id
  dates: Record<string, string | undefined>; // sample key → date override
  include: Record<string, boolean>; // sample key → include?
  params: Record<string, string | null>; // analyte key → parameter id (null = skip)
  units: Record<string, string | undefined>; // analyte key → unit override
}

export interface CommitOptions {
  duplicates: 'replace' | 'skip' | 'keep';
  /**
   * Clear out what earlier lab files put on these samples first (for when an earlier import went wrong – an analyte
   * matched to the wrong parameter): their results go, and this file's take their place. Field readings from a phone
   * and results typed in stay.
   */
  clearEarlier?: boolean;
  rememberAliases: boolean;
  fileName: string;
  labName?: string;
}

export interface CommitSummary extends ImportBatch {
  newSamples: number;
}

export async function commitImport(projectId: string, parsed: ParsedImport, mapping: ImportMapping, opts: CommitOptions): Promise<CommitSummary> {
  const params = new Map<string, Parameter>((await db.parameters.toArray()).map((p) => [p.id, p]));
  // at a quality control site each sample is its own (DUP1 and DUP2 the same day are two samples), told apart by name
  const qcSites = new Set((await db.sites.where('projectId').equals(projectId).toArray()).filter((s) => isQcSite(s)).map((s) => s.id));
  const qcName = (siteId: string, name?: string) => (qcSites.has(siteId) ? (name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() : '');
  const batch: ImportBatch = {
    id: uid('imp'),
    projectId,
    fileName: opts.fileName,
    kind: parsed.kind,
    importedAt: new Date().toISOString(),
    samples: 0,
    results: 0,
    skipped: 0,
    replaced: 0,
  };
  let newSamples = 0;

  await db.transaction('rw', [db.samples, db.results, db.imports, db.projects], async () => {
    const existingSamples = await db.samples.where('projectId').equals(projectId).toArray();
    const sampleBySiteDay = new Map<string, Sample>();
    for (const s of existingSamples) {
      const k = `${s.siteId}|${s.date.slice(0, 10)}|${qcName(s.siteId, s.sampleName)}`;
      if (!sampleBySiteDay.has(k)) sampleBySiteDay.set(k, s);
    }
    const touchedSampleIds = new Set<string>();
    const samplesToPut: Sample[] = [];
    const resultsToPut = new Map<string, Result>(); // `${sampleId}|${parameterId}` → result (dedupe within file)
    const extraResults: Result[] = [];

    for (const raw of parsed.samples) {
      if (mapping.include[raw.key] === false) continue;
      const siteId = mapping.sites[raw.key];
      const date = mapping.dates[raw.key] ?? raw.date;
      if (!siteId || !date) {
        batch.skipped += raw.results.length;
        continue;
      }
      const qn = qcName(siteId, raw.sampleName);
      const k = `${siteId}|${date.slice(0, 10)}|${qn}`;
      let sample = sampleBySiteDay.get(k);
      if (!sample) {
        sample = {
          // named after its site and day, so two people importing the same results at once make one sample
          id: qn ? stableId('s', projectId, siteId, date.slice(0, 10), qn) : stableId('s', projectId, siteId, date.slice(0, 10)),
          projectId,
          siteId,
          date,
          sampleName: raw.sampleName,
          labName: raw.labName ?? opts.labName,
          labJob: raw.labJob ?? parsed.labJob,
          labNumber: raw.labNumber,
          importId: batch.id,
          notes: raw.notes,
          receivedOn: raw.receivedOn,
        };
        sampleBySiteDay.set(k, sample);
        samplesToPut.push(sample);
        newSamples++;
      } else if (!touchedSampleIds.has(sample.id)) {
        // fill in missing details from this file
        const patch: Partial<Sample> = {};
        if (!sample.labNumber && raw.labNumber) patch.labNumber = raw.labNumber;
        if (!sample.labJob && (raw.labJob ?? parsed.labJob)) patch.labJob = raw.labJob ?? parsed.labJob;
        if (!sample.labName && (raw.labName ?? opts.labName)) patch.labName = raw.labName ?? opts.labName;
        if (sample.date.length === 10 && date.length > 10) patch.date = date;
        if (!sample.receivedOn && raw.receivedOn) patch.receivedOn = raw.receivedOn;
        // final results replace provisional ones, and their note goes
        let notes = sample.notes;
        if (!raw.provisional && opts.duplicates !== 'skip' && notes?.includes(PROVISIONAL_NOTE)) notes = notes.split('\n').filter((l) => !l.startsWith(PROVISIONAL_NOTE)).join('\n') || undefined;
        if (raw.notes && !(notes ?? '').includes(raw.notes)) notes = [notes, raw.notes].filter(Boolean).join('\n');
        if (notes !== sample.notes) patch.notes = notes;
        if (Object.keys(patch).length) {
          Object.assign(sample, patch);
          samplesToPut.push(sample);
        }
      }
      touchedSampleIds.add(sample.id);
      batch.samples++;

      for (const rr of raw.results) {
        const akey = analyteMapKey(rr);
        const pid = mapping.params[akey];
        if (!pid) {
          batch.skipped++;
          continue;
        }
        const unit = mapping.units[akey] ?? rr.unit ?? params.get(pid)?.unit ?? '';
        const res: Result = {
          id: opts.duplicates === 'keep' ? uid('r') : stableId('r', sample.id, pid),
          projectId,
          sampleId: sample.id,
          siteId,
          date: sample.date,
          parameterId: pid,
          value: rr.parsed.value,
          qualifier: rr.parsed.qualifier,
          unit,
          text: rr.parsed.text || undefined,
          dl: rr.parsed.dl,
          importId: batch.id,
        };
        const rk = `${sample.id}|${pid}`;
        if (opts.duplicates === 'keep') extraResults.push(res);
        else resultsToPut.set(rk, res);
      }
    }

    // Duplicates against existing data
    const sampleIds = Array.from(touchedSampleIds);
    const existing = sampleIds.length ? await db.results.where('sampleId').anyOf(sampleIds).toArray() : [];
    const existingByKey = new Map<string, Result[]>();
    for (const r of existing) {
      const k = `${r.sampleId}|${r.parameterId}`;
      const list = existingByKey.get(k) ?? [];
      list.push(r);
      existingByKey.set(k, list);
    }
    const toDelete: string[] = [];
    const finalResults: Result[] = [...extraResults];
    if (opts.clearEarlier) {
      const kinds = new Map((await db.imports.where('projectId').equals(projectId).toArray()).map((b) => [b.id, b.kind]));
      const fromFile = (r: Result) => !!r.importId && kinds.get(r.importId) !== 'field';
      const cleared = existing.filter((r) => fromFile(r) && !resultsToPut.has(`${r.sampleId}|${r.parameterId}`));
      for (const r of cleared) toDelete.push(r.id);
      // what's left of those samples' earlier results to compare with: field readings and results typed in
      for (const [k, list] of existingByKey) {
        const keep = list.filter((r) => !fromFile(r) || resultsToPut.has(k));
        if (keep.length) existingByKey.set(k, keep);
        else existingByKey.delete(k);
      }
      if (cleared.length) batch.notes = `Cleared ${cleared.length} earlier result${cleared.length === 1 ? '' : 's'} on these samples first (from earlier files).`;
      batch.cleared = cleared.length;
    }
    resultsToPut.forEach((res, k) => {
      const ex = existingByKey.get(k);
      if (ex?.length) {
        if (opts.duplicates === 'skip') {
          batch.skipped++;
          return;
        }
        // the result itself is put again; others for the same analyte go
        toDelete.push(...ex.filter((e) => e.id !== res.id).map((e) => e.id));
        batch.replaced++;
        // left out after a QA/QC check: stays left out if the lab's value is the same (an amended one is looked at again)
        const was = ex.find((e) => e.excluded && e.value === res.value && e.qualifier === res.qualifier && e.unit === res.unit);
        if (was) res.excluded = was.excluded;
      }
      finalResults.push(res);
    });
    // keep sample dates consistent on results
    const sampleDate = new Map(samplesToPut.map((s) => [s.id, s.date]));
    for (const r of finalResults) if (sampleDate.has(r.sampleId)) r.date = sampleDate.get(r.sampleId)!;
    const deleted = new Set(toDelete);
    const stale = existing.filter((r) => sampleDate.has(r.sampleId) && !deleted.has(r.id) && r.date !== sampleDate.get(r.sampleId));
    for (const r of stale) await db.results.update(r.id, { date: sampleDate.get(r.sampleId)! });

    batch.results = finalResults.length;
    if (toDelete.length) await db.results.bulkDelete(toDelete);
    if (samplesToPut.length) await db.samples.bulkPut(samplesToPut);
    if (finalResults.length) await db.results.bulkPut(finalResults);
    await db.imports.put(batch);
  });

  if (opts.rememberAliases) {
    for (const raw of parsed.samples) {
      const siteId = mapping.sites[raw.key];
      if (siteId && mapping.include[raw.key] !== false && raw.siteText) await addSiteAlias(siteId, raw.siteText);
    }
    const seen = new Set<string>();
    for (const raw of parsed.samples) {
      for (const rr of raw.results) {
        const akey = analyteMapKey(rr);
        const pid = mapping.params[akey];
        if (!pid || seen.has(akey)) continue;
        seen.add(akey);
        await addParameterAlias(pid, rr.analyte);
      }
    }
  }
  await touchProject(projectId);
  return { ...batch, newSamples };
}
