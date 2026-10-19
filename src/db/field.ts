// Field mode on the computer: make a round's field sheet for a phone, and add the results a phone sends back – each
// site's readings to the day's sample (the lab's results for that day join the same sample), what was seen to its
// notes, photos to the shared folder, and the round marked sampled.

import { db, getSettings } from './db';
import type { ImportBatch, Parameter, Result, Sample, Site } from './types';
import type { ProjectBundle } from '../lib/analysis';
import { FIELD_APP, readingWarning, type FieldMeasure, type FieldResults, type FieldSheet, type FieldVisit } from '../field/model';
import { stableId, uid } from '../lib/ids';
import { siteLatLng } from '../lib/nztm';
import { convert, unitLabel } from '../lib/units';
import { APP_VERSION } from '../lib/version';
import { fromBase64 } from '../lib/issued';
import { recordRound, touchProject } from './repo';
import { currentWorkspaceFolder } from '../sync/workspace';
import { isQcSite } from '../lib/qc';

/** Field readings usually taken: the project's field parameters with results, or the common four. */
export function defaultMeasures(b: Pick<ProjectBundle, 'params' | 'index'>): string[] {
  const withData = new Set(b.index.paramIdsWithData);
  const field = b.params.filter((p) => p.group === 'Field' && withData.has(p.id)).map((p) => p.id);
  return field.length ? field : ['ph-field', 'temp', 'ec-field', 'do'].filter((id) => b.params.some((p) => p.id === id));
}

/** Readings taken only in bores. */
const GROUNDWATER_ONLY = new Set(['swl', 'gw-level', 'water-level-bgl']);

export interface SheetChoices {
  round: string;
  date: string;
  siteIds: string[];
  measureIds: string[];
  observe: FieldSheet['observe'];
  /** Last time's readings at each site, to compare with. */
  withLast: boolean;
  by?: string;
}

/** A round's field sheet: the same sheet (by project and day) when made again, so a phone keeps what it recorded. */
export function makeSheet(b: ProjectBundle, c: SheetChoices): FieldSheet {
  const params = c.measureIds.map((id) => b.paramMap.get(id)).filter((p): p is Parameter => !!p);
  const measures: FieldMeasure[] = params.map((p) => ({ id: p.id, name: p.name, unit: unitLabel(p.unit), dp: p.decimals }));
  const sites = c.siteIds.map((id) => b.siteMap.get(id)).filter((s): s is Site => !!s);
  return {
    app: FIELD_APP,
    kind: 'field-sheet',
    v: 1,
    id: `${b.project.id}:${c.date}`,
    project: { id: b.project.id, name: b.project.name, code: b.project.code || undefined },
    round: c.round.trim() || 'Monitoring',
    date: c.date,
    sites: sites.map((s) => {
      const ll = siteLatLng(s);
      let last: FieldSheet['sites'][number]['last'];
      if (c.withLast) {
        const values: Record<string, number> = {};
        let date = '';
        for (const p of params) {
          const list = b.index.byParam.get(p.id)?.get(s.id);
          const r = list?.[list.length - 1];
          const v = r ? convert(r.value, r.unit, p.unit) : null;
          if (r && v !== null) {
            values[p.id] = Number(v.toPrecision(4));
            if (r.date > date) date = r.date.slice(0, 10);
          }
        }
        if (Object.keys(values).length) last = { date, values };
      }
      // the readings taken here before – or, at a site with none yet, at sites like it (a bore's water level isn't
      // asked for at a stream)
      const had = (p: Parameter, ids: string[]) => ids.some((id) => b.index.byParam.get(p.id)?.get(id)?.length);
      let mine = params.filter((p) => had(p, [s.id]));
      if (!mine.length) {
        const alike = b.sites.filter((x) => x.type === s.type).map((x) => x.id);
        mine = params.filter((p) => had(p, alike));
        if (!mine.length) mine = params;
        mine = mine.filter((p) => !GROUNDWATER_ONLY.has(p.id) || s.type === 'Groundwater');
      }
      const measures = mine.length < params.length ? mine.map((p) => p.id) : undefined;
      return { id: s.id, code: s.code, name: s.name || undefined, ...(ll ? { lat: Number(ll.lat.toFixed(6)), lng: Number(ll.lng.toFixed(6)) } : {}), note: s.description || undefined, last, ...(measures ? { measures } : {}) };
    }),
    measures,
    observe: c.observe,
    by: c.by || undefined,
    made: new Date().toISOString(),
    appVersion: APP_VERSION,
  };
}

// ------------------------------------------------------------ adding the results

export interface FieldRow {
  visit: FieldVisit;
  site: Site;
  /** The sample's date and time. */
  date: string;
  values: Array<{ param: Parameter; value: number; warning: string | null }>;
}

export interface FieldPlan {
  results: FieldResults;
  rows: FieldRow[];
  notSampled: Array<{ site: Site; reason: string }>;
  /** Sites and readings this project doesn't have (another project's sheet?). */
  unknownSites: string[];
  unknownParams: string[];
}

/** What adding a results file would do. */
export function planField(b: Pick<ProjectBundle, 'siteMap' | 'paramMap'>, results: FieldResults): FieldPlan {
  const rows: FieldRow[] = [];
  const notSampled: FieldPlan['notSampled'] = [];
  const unknownSites: string[] = [];
  const unknownParams = new Set<string>();
  for (const v of results.visits) {
    const site = b.siteMap.get(v.siteId);
    if (!site) {
      unknownSites.push(v.siteId);
      continue;
    }
    if (v.notSampled) {
      notSampled.push({ site, reason: v.notSampled });
      continue;
    }
    const values: FieldRow['values'] = [];
    for (const [pid, value] of Object.entries(v.values)) {
      const param = b.paramMap.get(pid);
      if (!param) {
        unknownParams.add(pid);
        continue;
      }
      values.push({ param, value, warning: readingWarning({ id: pid, name: param.name, unit: param.unit }, value) });
    }
    const date = v.time && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v.time) ? v.time.slice(0, 16) : results.sheet.date;
    if (values.length || v.notes || v.weather || v.flow || v.appearance || v.photos?.length) rows.push({ visit: v, site, date, values });
  }
  return { results, rows, notSampled, unknownSites, unknownParams: [...unknownParams] };
}

const FIELD_LINE = /^(Field( photos| location)?): /;

/** What was seen at the site, for the sample's notes. */
function fieldNotes(v: FieldVisit, by: string | undefined, photos: string[]): string[] {
  const seen = [v.weather && `weather ${v.weather.toLowerCase()}`, v.flow && `flow ${v.flow.toLowerCase()}`, v.appearance && v.appearance.toLowerCase()].filter(Boolean).join(', ');
  const lines = [`Field: ${[seen, v.notes?.trim()].filter(Boolean).join('. ') || 'sampled'}${by ? ` (${by})` : ''}`];
  if (v.gps) lines.push(`Field location: ${v.gps.lat}, ${v.gps.lng}${v.gps.acc ? ` (±${v.gps.acc} m)` : ''}`);
  if (photos.length) lines.push(`Field photos: ${photos.join('; ')}`);
  return lines;
}

const safe = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim();

/** Add a phone's results: readings to each site's sample for the day, notes, photos, and the round marked sampled. */
export async function commitField(projectId: string, plan: FieldPlan, fileName: string): Promise<{ batch: ImportBatch; samples: number; results: number; photos: number; photoError?: string }> {
  const { results } = plan;
  const by = results.by || (await getSettings()).author || undefined;
  // photos first, into the shared folder (the database keeps where they are, not the pictures)
  const folder = currentWorkspaceFolder();
  const photoPaths = new Map<FieldVisit, string[]>();
  let photos = 0;
  let photoError: string | undefined;
  const project = await db.projects.get(projectId);
  for (const row of plan.rows) {
    const list = row.visit.photos ?? [];
    if (!list.length) continue;
    if (!folder?.writeBlob) {
      photoError = 'The photos weren’t kept: the shared folder isn’t connected.';
      continue;
    }
    const dir = `Field photos/${safe(project?.code || project?.name || 'Project')}/${row.date.slice(0, 10)}`;
    const paths: string[] = [];
    for (let i = 0; i < list.length; i++) {
      const type = /^data:(image\/(?:jpeg|png|webp));/.exec(list[i].dataUrl)?.[1] ?? 'image/jpeg';
      const path = `${dir}/${safe(row.site.code)} ${i + 1}.${type === 'image/jpeg' ? 'jpg' : type.slice(6)}`;
      try {
        await folder.writeBlob(path, new Blob([fromBase64(list[i].dataUrl.split(',')[1] ?? '') as BlobPart], { type }));
        paths.push(path);
        photos++;
      } catch (e) {
        photoError = `Some photos weren’t kept: ${(e as Error).message}`;
      }
    }
    photoPaths.set(row.visit, paths);
  }

  const batch: ImportBatch = {
    id: uid('imp'),
    projectId,
    fileName,
    kind: 'field',
    importedAt: new Date().toISOString(),
    samples: 0,
    results: 0,
    skipped: 0,
    replaced: 0,
    notes: [`Field results${by ? ` from ${by}` : ''}${results.sent ? `, sent ${results.sent.slice(0, 10)}` : ''}.`, plan.notSampled.length ? `Not sampled: ${plan.notSampled.map((n) => `${n.site.code} (${n.reason})`).join(', ')}.` : ''].filter(Boolean).join(' '),
  };
  await db.transaction('rw', [db.samples, db.results, db.imports, db.projects, db.sites], async () => {
    const qcSites = new Set((await db.sites.where('projectId').equals(projectId).toArray()).filter((s) => isQcSite(s)).map((s) => s.id));
    const existing = await db.samples.where('projectId').equals(projectId).toArray();
    const resultsToPut: Result[] = [];
    for (const row of plan.rows) {
      const day = row.date.slice(0, 10);
      // the day's sample at the site (the lab's results for the day join it too)
      let sample: Sample | undefined = existing.find((s) => s.siteId === row.site.id && s.date.slice(0, 10) === day && !s.qc && !qcSites.has(s.siteId));
      const notes = fieldNotes(row.visit, by, photoPaths.get(row.visit) ?? []);
      if (!sample) {
        sample = { id: stableId('s', projectId, row.site.id, day), projectId, siteId: row.site.id, date: row.date, importId: batch.id, notes: notes.join('\n') };
        existing.push(sample);
      } else {
        const kept = (sample.notes ?? '').split('\n').filter((l) => l.trim() && !FIELD_LINE.test(l));
        sample = { ...sample, date: sample.date.length === 10 && row.date.length > 10 ? row.date : sample.date, notes: [...kept, ...notes].join('\n') };
      }
      await db.samples.put(sample);
      batch.samples++;
      for (const { param, value } of row.values) {
        resultsToPut.push({ id: stableId('r', sample.id, param.id), projectId, sampleId: sample.id, siteId: row.site.id, date: sample.date, parameterId: param.id, value, qualifier: '', unit: param.unit, importId: batch.id });
      }
    }
    if (resultsToPut.length) {
      const before = await db.results.bulkGet(resultsToPut.map((r) => r.id));
      batch.replaced = before.filter(Boolean).length;
      await db.results.bulkPut(resultsToPut);
    }
    batch.results = resultsToPut.length;
    await db.imports.put(batch);
    await touchProject(projectId);
  });
  // the round: sampled on the day (when the project is on the monitoring calendar)
  const day = plan.rows[0]?.date.slice(0, 10) ?? results.sheet.date;
  const row = await db.calendarRows.where('projectId').equals(projectId).first();
  if (row && day) {
    const month = day.slice(0, 7);
    const mark = await db.calendarMarks.get(`${row.id}|${month}`);
    if (!mark?.sampledOn) await recordRound(row.id, month, { sampledOn: day }).catch(() => undefined);
  }
  return { batch, samples: batch.samples, results: batch.results, photos, photoError };
}
