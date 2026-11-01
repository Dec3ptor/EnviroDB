// Field mode on the computer: make a round's field sheet for a phone, and add the results a phone sends back – each
// site's readings to the day's sample (the lab's results for that day join the same sample), what was seen to its
// notes, photos to the shared folder, and the round marked sampled.

import { db, getSettings } from './db';
import { SITE_TYPES, type ImportBatch, type Parameter, type Result, type Sample, type Site, type SiteType } from './types';
import type { ProjectBundle } from '../lib/analysis';
import { distanceM, FIELD_APP, readingWarning, type FieldCode, type FieldCodeFill, type FieldMeasure, type FieldNewSite, type FieldResults, type FieldSheet, type FieldVisit } from '../field/model';
import { stableId, uid } from '../lib/ids';
import { roundedNztm, siteLatLng } from '../lib/nztm';
import { convert, unitLabel } from '../lib/units';
import { APP_VERSION } from '../lib/version';
import { recordRound, touchProject } from './repo';
import { currentWorkspaceFolder } from '../sync/workspace';
import { isQcSite } from '../lib/qc';
import { logAudit } from './audit';
import { boreSummary, depthBelowGround, depthWarning, hasBore, levelFromDepth, waterColumn } from '../lib/bore';
import { photoDir, safeName, samplePhotoPaths } from '../lib/photos';
import { withPhotoGps } from '../lib/exif';
import { photoBytes } from '../field/package';

/** Field readings usually taken: the project's field parameters with results, or the common four. */
export function defaultMeasures(b: Pick<ProjectBundle, 'params' | 'index'>): string[] {
  const withData = new Set(b.index.paramIdsWithData);
  const field = b.params.filter((p) => p.group === 'Field' && withData.has(p.id)).map((p) => p.id);
  return field.length ? field : ['ph-field', 'temp', 'ec-field', 'do'].filter((id) => b.params.some((p) => p.id === id));
}

/** Readings taken only in bores. */
const GROUNDWATER_ONLY = new Set(['swl', 'gw-level', 'water-level-bgl', 'stick-up', 'bore-depth', 'dtw-bgl', 'gwl-rl', 'water-column', 'purge-vol']);
/** Readings that go with the static water level at a bore: optional, filled in from the bore's details, kept when measured. */
const WITH_SWL = ['stick-up', 'bore-depth'] as const;

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
  const ids = [...c.measureIds];
  // a static water level brings the stick-up and bore depth with it (optional on the phone, pre-filled from the bore)
  if (ids.includes('swl')) for (const id of WITH_SWL) if (!ids.includes(id) && b.paramMap.has(id)) ids.push(id);
  const params = ids.map((id) => b.paramMap.get(id)).filter((p): p is Parameter => !!p);
  const optional = new Set<string>(ids.includes('swl') ? WITH_SWL : []);
  const measures: FieldMeasure[] = params.map((p) => ({ id: p.id, name: p.name, unit: unitLabel(p.unit), dp: p.decimals, ...(optional.has(p.id) ? { optional: true } : {}) }));
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
      // a bore's particulars go with its directions: what the depth is measured from, how deep the well is
      const note = [s.description, hasBore(s.bore) ? `Bore: ${boreSummary(s.bore)}` : ''].filter(Boolean).join('\n') || undefined;
      // the bore's stick-up and depth, filled in on the phone to be checked or changed
      const preset: Record<string, number> = {};
      if (s.type === 'Groundwater' && ids.includes('swl')) {
        if (s.bore?.stickUp !== undefined && b.paramMap.has('stick-up')) preset['stick-up'] = s.bore.stickUp;
        if (s.bore?.depth !== undefined && b.paramMap.has('bore-depth')) preset['bore-depth'] = s.bore.depth;
      }
      return { id: s.id, code: s.code, name: s.name || undefined, ...(ll ? { lat: Number(ll.lat.toFixed(6)), lng: Number(ll.lng.toFixed(6)) } : {}), note, last, ...(measures ? { measures } : {}), ...(Object.keys(preset).length ? { preset } : {}) };
    }),
    measures,
    observe: c.observe,
    by: c.by || undefined,
    made: new Date().toISOString(),
    appVersion: APP_VERSION,
  };
}

// ------------------------------------------------------------ printed codes

export interface CodeChoices {
  siteIds: string[];
  measureIds: string[];
  observe: FieldSheet['observe'];
  fill: FieldCodeFill;
  /** The sites' locations: shown on the phone (directions) and to check it's at the right site. */
  withLocation: boolean;
  /** The sites' descriptions (directions, access): anyone who scans a code can read them. */
  withNotes: boolean;
}

/**
 * Printed codes for a project: the project's (every site chosen) and one for each site. They hold no day and no
 * results, so they stay right from round to round; each site's asks only for its own readings.
 */
export function makeCodes(b: ProjectBundle, c: CodeChoices): { project: FieldCode; sites: FieldCode[] } {
  const sheet = makeSheet(b, { round: '', date: '', siteIds: c.siteIds, measureIds: c.measureIds, observe: c.observe, withLast: false });
  const sites = sheet.sites.map((s) => ({ id: s.id, code: s.code, name: s.name, ...(c.withLocation ? { lat: s.lat, lng: s.lng } : {}), ...(c.withNotes ? { note: s.note } : {}), measures: s.measures }));
  const base = { app: FIELD_APP as typeof FIELD_APP, kind: 'field-code' as const, v: 1 as const, project: sheet.project, observe: sheet.observe, fill: c.fill, made: sheet.made.slice(0, 10), appVersion: sheet.appVersion };
  return {
    project: { ...base, sites, measures: sheet.measures },
    sites: sites.map(({ measures, ...s }) => ({ ...base, site: s.id, sites: [s], measures: measures ? sheet.measures.filter((m) => measures.includes(m.id)) : sheet.measures })),
  };
}

// ------------------------------------------------------------ adding the results

export interface FieldRow {
  visit: FieldVisit;
  site: Site;
  /** The sample's date and time. */
  date: string;
  /** The readings; `derived` says how one was worked out from another (a level from a depth to water). */
  values: Array<{ param: Parameter; value: number; warning: string | null; derived?: string }>;
}

export interface FieldPlan {
  results: FieldResults;
  rows: FieldRow[];
  notSampled: Array<{ site: Site; reason: string }>;
  /** Sites and readings this project doesn't have (another project's sheet?). */
  unknownSites: string[];
  unknownParams: string[];
  /**
   * Monitoring points added on the phone: the site to add – or, when the project has a site with the same code (or
   * the file was added before), that site, which their readings go to.
   */
  newSites: Array<{ field: FieldNewSite; site: Site; existing: boolean; near: Array<{ site: Site; m: number }>; suggest: string | 'new'; /** joined that site when added before */ before?: boolean }>;
  /** Locations set on the phone: where, and how far that moves the site (null: it had no location). */
  located: Array<{ site: Site; lat: number; lng: number; acc?: number; how: 'gps' | 'map'; movedM: number | null }>;
}

/** What adding a results file would do. */
export function planField(b: Pick<ProjectBundle, 'siteMap' | 'paramMap' | 'project' | 'sites'> & { imports?: ImportBatch[] }, results: FieldResults): FieldPlan {
  const rows: FieldRow[] = [];
  const notSampled: FieldPlan['notSampled'] = [];
  const unknownSites: string[] = [];
  const unknownParams = new Set<string>();
  const byCode = new Map(b.sites.map((s) => [s.code.trim().toLowerCase(), s]));
  const order = Math.max(0, ...b.sites.map((s) => s.order ?? 0));
  const located: FieldPlan['located'] = [];
  const moved = (site: Site, p: { lat: number; lng: number }) => {
    const was = siteLatLng(site);
    return was ? distanceM(was, p) : null;
  };
  // where each new point is: its own location, or where it was recorded
  const placeOf = (n: FieldNewSite) => (n.lat !== undefined && n.lng !== undefined ? { lat: n.lat, lng: n.lng } : results.visits.find((v) => v.siteId === n.id)?.gps ?? null);
  const placed = b.sites.flatMap((s) => {
    const ll = siteLatLng(s);
    return ll && !isQcSite(s) ? [{ site: s, ll }] : [];
  });
  // the site each of the phone's points joined when the job was added before (the latest time): that one again
  const went = new Map<string, string>();
  const earlier = (b.imports ?? []).filter((x) => x.kind === 'field' && x.fieldPoints).sort((x, y) => (x.importedAt < y.importedAt ? -1 : 1));
  for (const batch of earlier) for (const [point, site] of Object.entries(batch.fieldPoints!)) if (b.siteMap.has(site)) went.set(point, site);
  const newSites: FieldPlan['newSites'] = (results.newSites ?? []).map((n, i) => {
    // named after the phone's id, so the same file added again doesn't add the site twice; a point the phone named
    // (P1 …) isn't taken for a site with the same code
    const id = stableId('site', b.project.id, n.id);
    const already = b.siteMap.get(id) ?? (n.auto ? undefined : byCode.get(n.code.trim().toLowerCase()));
    const here = placeOf(n);
    const near = here ? placed.map((p) => ({ site: p.site, m: distanceM(p.ll, here) })).sort((x, y) => x.m - y.m) : [];
    if (already) {
      if (n.lat !== undefined && n.lng !== undefined && !siteLatLng(already)) located.push({ site: already, lat: n.lat, lng: n.lng, acc: n.acc, how: n.how ?? 'map', movedM: null });
      return { field: n, site: already, existing: true, near, suggest: already.id };
    }
    const nz = n.lat !== undefined && n.lng !== undefined ? roundedNztm(n.lat, n.lng) : null;
    const type: SiteType = (SITE_TYPES as readonly string[]).includes(n.type ?? '') ? (n.type as SiteType) : 'Other';
    const site: Site = { id, projectId: b.project.id, code: n.code, name: n.name, type, role: '', aliases: [], active: true, order: order + 1 + i, description: n.note, ...(nz ? nz : {}) };
    // where it went before; else, a point the phone named a few steps from a site: most likely that site
    const before = went.get(n.id);
    const suggest = before ?? (n.auto && near[0] && near[0].m <= NEAR_M ? near[0].site.id : 'new');
    return { field: n, site, existing: false, near, suggest, ...(before ? { before: true } : {}) };
  });
  for (const l of results.located ?? []) {
    const site = b.siteMap.get(l.siteId);
    if (!site) continue;
    const d = moved(site, l);
    if (d === null || d >= 1) located.push({ site, lat: l.lat, lng: l.lng, acc: l.acc, how: l.how, movedM: d });
  }
  const siteOf = (id: string) => b.siteMap.get(id) ?? newSites.find((n) => n.field.id === id)?.site;
  for (const v of results.visits) {
    const site = siteOf(v.siteId);
    if (!site) {
      unknownSites.push(v.siteId);
      continue;
    }
    if (v.notSampled) {
      notSampled.push({ site, reason: v.notSampled });
      continue;
    }
    const values: FieldRow['values'] = [];
    // the bore as measured today: the phone's stick-up and depth over the site's
    const bore = { ...(site.bore ?? {}), ...(v.values['stick-up'] !== undefined ? { stickUp: v.values['stick-up'] } : {}), ...(v.values['bore-depth'] !== undefined ? { depth: v.values['bore-depth'] } : {}) };
    for (const [pid, value] of Object.entries(v.values)) {
      const param = b.paramMap.get(pid);
      if (!param) {
        unknownParams.add(pid);
        continue;
      }
      values.push({ param, value, warning: (pid === 'swl' ? depthWarning(bore, value) : null) ?? readingWarning({ id: pid, name: param.name, unit: param.unit }, value) });
    }
    // from the static water level: depth below ground (with the stick-up), the level (with the top of casing), the water column (with the depth)
    const swl = values.find((x) => x.param.id === 'swl');
    if (swl) {
      const add = (id: string, value: number | null, how: string) => {
        const param = b.paramMap.get(id);
        if (param && value !== null && !values.some((x) => x.param.id === id)) values.push({ param, value, warning: null, derived: how });
      };
      add('dtw-bgl', depthBelowGround(bore, swl.value), `from SWL ${swl.value} m less the stick-up ${bore.stickUp} m`);
      add('gwl-rl', levelFromDepth(bore, swl.value), `from TOC ${bore.tocRl} m RL less SWL ${swl.value} m`);
      add('water-column', waterColumn(bore, swl.value), `from the bore depth ${bore.depth} m less SWL ${swl.value} m`);
    }
    const date = v.time && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v.time) ? v.time.slice(0, 16) : results.sheet.date;
    if (values.length || v.notes || v.weather || v.flow || v.appearance || v.photos?.length) rows.push({ visit: v, site, date, values });
  }
  return { results, rows, notSampled, unknownSites, unknownParams: [...unknownParams], newSites, located };
}

/** How close (m) a point the phone named has to be to a site to be taken for it, to start with. */
export const NEAR_M = 30;

/** Which of the phone's new sites and locations to take (all, unless said). */
export interface FieldChoices {
  /** The phone's ids of the new sites to add. */
  newSites?: Set<string>;
  /** The sites whose location to set. */
  located?: Set<string>;
  /** New points that join one of the project's sites instead (the phone's id → the site's id). */
  attach?: Map<string, string>;
}

/** What the choices make of the plan's new points to start with: those suggested to join a site, join it. */
export function defaultAttach(plan: FieldPlan): Map<string, string> {
  return new Map(plan.newSites.filter((n) => !n.existing && n.suggest !== 'new').map((n) => [n.field.id, n.suggest]));
}

const FIELD_LINE = /^(Field( photos| location)?): /;

/** What was seen at the site, for the sample's notes. */
function fieldNotes(v: FieldVisit, by: string | undefined, photos: string[]): string[] {
  const seen = [v.weather && `weather ${v.weather.toLowerCase()}`, v.flow && `flow ${v.flow.toLowerCase()}`, v.appearance && v.appearance.toLowerCase()].filter(Boolean).join(', ');
  const lines = [`Field: ${[seen, v.notes?.trim()].filter(Boolean).join('. ') || (!Object.keys(v.values).length && v.photos?.length ? 'photos taken' : 'sampled')}${by ? ` (${by})` : ''}`];
  if (v.gps) lines.push(`Field location: ${v.gps.lat}, ${v.gps.lng}${v.gps.acc ? ` (±${v.gps.acc} m)` : ''}`);
  if (photos.length) lines.push(`Field photos: ${photos.join('; ')}`);
  return lines;
}

const safe = safeName;

/** Add a phone's results: readings to each site's sample for the day, notes, photos, and the round marked sampled. */
export async function commitField(projectId: string, plan: FieldPlan, fileName: string, choices: FieldChoices = {}): Promise<{ batch: ImportBatch; samples: number; results: number; photos: number; photoError?: string; sitesAdded: number; located: number }> {
  const { results } = plan;
  // new points that join one of the project's sites
  const attached = new Map<string, Site>();
  for (const n of plan.newSites) {
    const to = !n.existing ? choices.attach?.get(n.field.id) : undefined;
    const site = to ? await db.sites.get(to) : undefined;
    if (site && site.projectId === projectId) attached.set(n.site.id, site);
  }
  // new sites left out: so are their readings
  const addSites = plan.newSites.filter((n) => !n.existing && !attached.has(n.site.id) && (!choices.newSites || choices.newSites.has(n.field.id)));
  const leftOut = new Set(plan.newSites.filter((n) => !n.existing && !attached.has(n.site.id) && !addSites.includes(n)).map((n) => n.site.id));
  const setPlaces = plan.located.filter((l) => !choices.located || choices.located.has(l.site.id));
  const retarget = <T extends { site: Site }>(r: T): T => (attached.has(r.site.id) ? { ...r, site: attached.get(r.site.id)! } : r);
  plan = { ...plan, rows: plan.rows.filter((r) => !leftOut.has(r.site.id)).map(retarget), notSampled: plan.notSampled.filter((n) => !leftOut.has(n.site.id)).map(retarget) };
  const by = results.by || (await getSettings()).author || undefined;
  // photos first, into the shared folder at full size, each with where it was taken written in (the database keeps
  // where they are, not the pictures)
  const folder = currentWorkspaceFolder();
  const photoPaths = new Map<FieldRow, string[]>();
  let photos = 0;
  let photoError: string | undefined;
  const project = await db.projects.get(projectId);
  const used = new Set<string>();
  for (const row of plan.rows) {
    const list = row.visit.photos ?? [];
    if (!list.length) continue;
    if (!folder?.writeBlob) {
      photoError = 'The photos weren’t kept: the shared folder isn’t connected.';
      continue;
    }
    const dir = photoDir(project ?? { code: '', name: 'Project' }, row.date);
    const paths: string[] = [];
    for (const p of list) {
      let bytes = photoBytes(p);
      if (!bytes) continue;
      const type = p.type ?? 'image/jpeg';
      const gps = p.lat !== undefined && p.lng !== undefined ? { lat: p.lat, lng: p.lng, acc: p.acc } : row.visit.gps;
      if (gps) bytes = withPhotoGps(bytes, gps, p.at);
      const ext = type === 'image/jpeg' ? 'jpg' : type.slice(6);
      try {
        // the next free name – a photo added before (the same file sent again) keeps its own
        let path = '';
        let same = false;
        for (let n = 1; n < 2000 && !path; n++) {
          const cand = `${dir}/${safe(row.site.code)} ${n}.${ext}`;
          if (used.has(cand)) continue;
          const info = await folder.info(cand).catch(() => null);
          if (!info) path = cand;
          else if (info.size === bytes.length) [path, same] = [cand, true];
        }
        if (!path) throw new Error('too many photos at the site that day');
        if (!same) await folder.writeBlob(path, new Blob([bytes as BlobPart], { type }));
        used.add(path);
        paths.push(path);
        photos++;
      } catch (e) {
        photoError = `Some photos weren’t kept: ${(e as Error).message}`;
      }
    }
    photoPaths.set(row, paths);
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
    notes: [
      `Field results${by ? ` from ${by}` : ''}${results.sent ? `, sent ${results.sent.slice(0, 10)}` : ''}.`,
      plan.notSampled.length ? `Not sampled: ${plan.notSampled.map((n) => `${n.site.code} (${n.reason})`).join(', ')}.` : '',
      addSites.length ? `Sites added in the field: ${addSites.map((n) => n.site.code).join(', ')}.` : '',
      setPlaces.length ? `Locations set in the field: ${setPlaces.map((l) => l.site.code).join(', ')}.` : '',
    ]
      .filter(Boolean)
      .join(' '),
    // where the points that joined a site went: the same next time the job is added
    ...(attached.size ? { fieldPoints: Object.fromEntries(plan.newSites.filter((n) => attached.has(n.site.id)).map((n) => [n.field.id, attached.get(n.site.id)!.id])) } : {}),
  };
  await db.transaction('rw', [db.samples, db.results, db.imports, db.projects, db.sites], async () => {
    // the sites added in the field, and the locations set there
    for (const n of addSites) if (!(await db.sites.get(n.site.id))) await db.sites.put(n.site);
    for (const l of setPlaces) {
      const { easting, northing } = roundedNztm(l.lat, l.lng);
      await db.sites.update(l.site.id, { easting, northing });
    }
    // a bore's stick-up or depth measured in the field fills in what the site didn't have
    for (const row of plan.rows) {
      const su = row.values.find((x) => x.param.id === 'stick-up')?.value;
      const dp = row.values.find((x) => x.param.id === 'bore-depth')?.value;
      const had = row.site.bore ?? {};
      const bore = { ...had, ...(su !== undefined && had.stickUp === undefined ? { stickUp: su } : {}), ...(dp !== undefined && had.depth === undefined ? { depth: dp } : {}) };
      if (JSON.stringify(bore) !== JSON.stringify(had)) await db.sites.update(row.site.id, { bore });
    }
    const qcSites = new Set((await db.sites.where('projectId').equals(projectId).toArray()).filter((s) => isQcSite(s)).map((s) => s.id));
    const existing = await db.samples.where('projectId').equals(projectId).toArray();
    const resultsToPut: Result[] = [];
    // the rows for each site and day together (two points that join the same site make one sample)
    const groups = new Map<string, FieldRow[]>();
    for (const row of plan.rows) {
      const k = `${row.site.id}|${row.date.slice(0, 10)}`;
      groups.set(k, [...(groups.get(k) ?? []), row]);
    }
    for (const rowsHere of groups.values()) {
      const site = rowsHere[0].site;
      const day = rowsHere[0].date.slice(0, 10);
      const when = rowsHere.map((r) => r.date).find((d) => d.length > 10) ?? rowsHere[0].date;
      // the day's sample at the site (the lab's results for the day join it too)
      let sample: Sample | undefined = existing.find((s) => s.siteId === site.id && s.date.slice(0, 10) === day && !s.qc && !qcSites.has(s.siteId));
      // what was seen replaces what an earlier file said; the photos add to those the sample has
      const before = samplePhotoPaths(sample?.notes);
      const paths = [...new Set([...before, ...rowsHere.flatMap((r) => photoPaths.get(r) ?? [])])];
      const notes = [...rowsHere.flatMap((r) => fieldNotes(r.visit, by, [])), ...(paths.length ? [`Field photos: ${paths.join('; ')}`] : [])];
      if (!sample) {
        sample = { id: stableId('s', projectId, site.id, day), projectId, siteId: site.id, date: when, importId: batch.id, notes: notes.join('\n') };
        existing.push(sample);
      } else {
        const kept = (sample.notes ?? '').split('\n').filter((l) => l.trim() && !FIELD_LINE.test(l));
        sample = { ...sample, date: sample.date.length === 10 && when.length > 10 ? when : sample.date, notes: [...kept, ...notes].join('\n') };
      }
      await db.samples.put(sample);
      batch.samples++;
      for (const row of rowsHere)
        for (const { param, value, derived } of row.values) {
          resultsToPut.push({ id: stableId('r', sample.id, param.id), projectId, sampleId: sample.id, siteId: site.id, date: sample.date, parameterId: param.id, value, qualifier: '', unit: param.unit, importId: batch.id, ...(derived ? { comment: `Worked out ${derived}` } : {}) });
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
  await logAudit(projectId, 'import', `Field results added from ${fileName}: ${batch.results} readings, ${batch.samples} sites`);
  // the round: sampled on the day (when the project is on the monitoring calendar)
  const day = plan.rows[0]?.date.slice(0, 10) ?? results.sheet.date;
  const row = await db.calendarRows.where('projectId').equals(projectId).first();
  if (row && day) {
    const month = day.slice(0, 7);
    const mark = await db.calendarMarks.get(`${row.id}|${month}`);
    if (!mark?.sampledOn) await recordRound(row.id, month, { sampledOn: day }).catch(() => undefined);
  }
  return { batch, samples: batch.samples, results: batch.results, photos, photoError, sitesAdded: addSites.length, located: setPlaces.length };
}
