import { db } from '../db/db';
import type { ImportBatch, Parameter, Result, Sample } from '../db/types';
import { addParameterAlias, addSiteAlias, touchProject } from '../db/repo';
import { uid } from '../lib/ids';
import { analyteMapKey, type ParsedImport } from './model';

export interface ImportMapping {
  sites: Record<string, string | null>; // sample key → site id
  dates: Record<string, string | undefined>; // sample key → date override
  include: Record<string, boolean>; // sample key → include?
  params: Record<string, string | null>; // analyte key → parameter id (null = skip)
  units: Record<string, string | undefined>; // analyte key → unit override
}

export interface CommitOptions {
  duplicates: 'replace' | 'skip' | 'keep';
  rememberAliases: boolean;
  fileName: string;
  labName?: string;
}

export interface CommitSummary extends ImportBatch {
  newSamples: number;
}

export async function commitImport(projectId: string, parsed: ParsedImport, mapping: ImportMapping, opts: CommitOptions): Promise<CommitSummary> {
  const params = new Map<string, Parameter>((await db.parameters.toArray()).map((p) => [p.id, p]));
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
      const k = `${s.siteId}|${s.date.slice(0, 10)}`;
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
      const k = `${siteId}|${date.slice(0, 10)}`;
      let sample = sampleBySiteDay.get(k);
      if (!sample) {
        sample = {
          id: uid('s'),
          projectId,
          siteId,
          date,
          sampleName: raw.sampleName,
          labName: opts.labName,
          labJob: raw.labJob ?? parsed.labJob,
          labNumber: raw.labNumber,
          importId: batch.id,
          notes: raw.notes,
        };
        sampleBySiteDay.set(k, sample);
        samplesToPut.push(sample);
        newSamples++;
      } else if (!touchedSampleIds.has(sample.id)) {
        // fill in missing details from this file
        const patch: Partial<Sample> = {};
        if (!sample.labNumber && raw.labNumber) patch.labNumber = raw.labNumber;
        if (!sample.labJob && (raw.labJob ?? parsed.labJob)) patch.labJob = raw.labJob ?? parsed.labJob;
        if (!sample.labName && opts.labName) patch.labName = opts.labName;
        if (sample.date.length === 10 && date.length > 10) patch.date = date;
        if (raw.notes && !(sample.notes ?? '').includes(raw.notes)) patch.notes = [sample.notes, raw.notes].filter(Boolean).join('\n');
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
          id: uid('r'),
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
    resultsToPut.forEach((res, k) => {
      const ex = existingByKey.get(k);
      if (ex?.length) {
        if (opts.duplicates === 'skip') {
          batch.skipped++;
          return;
        }
        toDelete.push(...ex.map((e) => e.id));
        batch.replaced++;
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
