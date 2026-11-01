// The phone's own store for field mode: the field sheets opened on it and what's been recorded at each site. Kept
// apart from the team's data – the phone isn't connected to the shared folder – until the results are sent.

import Dexie, { type Table } from 'dexie';
import { codeSheet, FIELD_APP, mergeSheets, newFieldSiteId, type FieldCode, type FieldMeasure, type FieldResults, type FieldSheet, type FieldSite, type FieldVisit } from './model';
import { groupByPlace, type PlacedAt } from './places';
import { mergeKeys, parseKeys, type TeamKey } from './lock';
import type { OutPhoto } from './package';
import { APP_VERSION } from '../lib/version';

export interface StoredSheet {
  id: string;
  sheet: FieldSheet;
  addedAt: string;
  /** When the results were last sent. */
  sentAt?: string;
  /** The team key it came locked with (its fingerprint): the results file is locked with it too. */
  lockedWith?: string;
}

export interface StoredVisit {
  /** `${sheetId}|${siteId}` */
  id: string;
  sheetId: string;
  visit: FieldVisit;
  updatedAt: string;
}

/** A photo taken on the phone: kept as the camera took it, with a small copy to show, and where and when. */
export interface StoredPhoto {
  id: string;
  sheetId: string;
  siteId: string;
  /** The picture, full size. */
  blob: Blob;
  type: string;
  size: number;
  /** A small copy to show (a data URL). */
  thumb: string;
  /** When it was taken (ISO). */
  at: string;
  gps?: { lat: number; lng: number; acc?: number };
  /** Where the location came from: this phone's GPS as the photo was taken, or the camera's own (a photo from the gallery). */
  gpsFrom?: 'phone' | 'camera';
}

const dataUrlBlob = (url: string): Blob => {
  const [head, b64] = url.split(',');
  const bin = atob(b64 ?? '');
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return new Blob([out], { type: /^data:([^;]+)/.exec(head)?.[1] ?? 'image/jpeg' });
};

class FieldDatabase extends Dexie {
  sheets!: Table<StoredSheet, string>;
  visits!: Table<StoredVisit, string>;
  prefs!: Table<{ key: string; value: string }, string>;
  photos!: Table<StoredPhoto, string>;
  constructor() {
    super('EnviroDB-field');
    this.version(1).stores({ sheets: 'id, addedAt', visits: 'id, sheetId', prefs: 'key' });
    // photos in their own table, at full size (before, they were small copies inside each site's record)
    this.version(2)
      .stores({ photos: 'id, sheetId, [sheetId+siteId]' })
      .upgrade(async (tx) => {
        const visits = (await tx.table('visits').toArray()) as StoredVisit[];
        for (const rec of visits) {
          const list = (rec.visit as { photos?: Array<{ name?: string; dataUrl?: string }> }).photos;
          if (!list?.length) continue;
          for (const [i, p] of list.entries()) {
            if (!p.dataUrl) continue;
            const blob = dataUrlBlob(p.dataUrl);
            const photo: StoredPhoto = { id: `${rec.id}|${i}|${Date.now()}`, sheetId: rec.sheetId, siteId: rec.visit.siteId, blob, type: blob.type, size: blob.size, thumb: p.dataUrl, at: rec.updatedAt };
            await tx.table('photos').put(photo);
          }
          const { photos: _p, ...visit } = rec.visit;
          void _p;
          await tx.table('visits').put({ ...rec, visit });
        }
      });
  }
}

export const fieldDb = new FieldDatabase();

/**
 * A sheet from the computer, kept on the phone. Opened again for the same day (made again on the computer), it takes
 * the new sheet's sites and readings – keeping any site recorded here that the new one leaves out (one scanned from
 * its printed code, say).
 */
export async function addSheet(sheet: FieldSheet, lockedWith?: string): Promise<void> {
  const cur = await fieldDb.sheets.get(sheet.id);
  let next = sheet;
  if (cur) {
    const recorded = new Set((await fieldDb.visits.where('sheetId').equals(sheet.id).toArray()).map((v) => v.visit.siteId));
    // sites recorded here, added here or placed here stay; others the computer's sheet leaves out go
    const kept = { ...cur.sheet, sites: cur.sheet.sites.filter((s) => recorded.has(s.id) || s.added || s.located || sheet.sites.some((x) => x.id === s.id)) };
    next = mergeSheets(kept, sheet, 'add');
  }
  await fieldDb.sheets.put({ id: sheet.id, sheet: next, addedAt: cur?.addedAt ?? new Date().toISOString(), sentAt: cur?.sentAt, lockedWith: lockedWith ?? cur?.lockedWith });
}

/**
 * A printed code scanned on `date`: its sites join that day's sheet for the project (started if there's none yet),
 * with last time's readings at each from what this phone recorded there before.
 */
export async function addFromCode(code: FieldCode, date: string, lockedWith?: string): Promise<FieldSheet> {
  const fresh = codeSheet(code, date);
  const before = (await fieldDb.visits.toArray()).filter((v) => v.sheetId.startsWith(`${code.project.id}:`) && v.sheetId.slice(code.project.id.length + 1) < date && Object.keys(v.visit.values).length);
  fresh.sites = fresh.sites.map((site) => {
    const mine = before.filter((v) => v.visit.siteId === site.id);
    const latest = mine.sort((a, b) => ((a.visit.time ?? a.sheetId) < (b.visit.time ?? b.sheetId) ? 1 : -1))[0];
    if (!latest) return site;
    const values = Object.fromEntries(fresh.measures.filter((m) => latest.visit.values[m.id] !== undefined).map((m) => [m.id, latest.visit.values[m.id]]));
    const day = (latest.visit.time ?? latest.sheetId.slice(code.project.id.length + 1)).slice(0, 10);
    return Object.keys(values).length ? { ...site, last: { date: day, values } } : site;
  });
  const cur = await fieldDb.sheets.get(fresh.id);
  const sheet = cur ? mergeSheets(cur.sheet, fresh, 'old') : fresh;
  await fieldDb.sheets.put({ id: sheet.id, sheet, addedAt: cur?.addedAt ?? new Date().toISOString(), sentAt: cur?.sentAt, lockedWith: lockedWith ?? cur?.lockedWith });
  return sheet;
}

export async function deleteSheet(id: string): Promise<void> {
  await fieldDb.transaction('rw', fieldDb.sheets, fieldDb.visits, fieldDb.photos, async () => {
    await fieldDb.visits.where('sheetId').equals(id).delete();
    await fieldDb.photos.where('sheetId').equals(id).delete();
    await fieldDb.sheets.delete(id);
  });
}

// ------------------------------------------------------------ jobs started on the phone

/** A job started on the phone (rather than a sheet from the computer). */
export const isJob = (sheet: Pick<FieldSheet, 'id'>) => sheet.id.startsWith('job-');

const pad = (n: number) => String(n).padStart(2, '0');
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** A new job: a name, the project (or none – the computer asks), the readings to take; photos always. */
export async function newJob(name: string, project: FieldSheet['project'] | null, measures: FieldMeasure[], by?: string): Promise<FieldSheet> {
  const id = `job-${crypto.getRandomValues(new Uint32Array(2)).join('')}`;
  const sheet: FieldSheet = {
    app: FIELD_APP,
    kind: 'field-sheet',
    v: 1,
    id,
    project: project ?? { id: '', name: '' },
    round: name.trim() || 'Field job',
    date: today(),
    sites: [],
    measures,
    observe: { weather: false, flow: false, appearance: false, photos: true },
    by: by || undefined,
    made: new Date().toISOString(),
    appVersion: APP_VERSION,
  };
  // a phone set up with the team key: its jobs go locked with it, as the team's sheets do
  const key = (await teamKeys())[0];
  await fieldDb.sheets.put({ id, sheet, addedAt: sheet.made, ...(key ? { lockedWith: key.id } : {}) });
  return sheet;
}

/** The projects this phone knows (from sheets and codes opened on it), each with its sites from the computer. */
export async function knownProjects(): Promise<Array<{ project: FieldSheet['project']; sites: FieldSite[] }>> {
  const sheets = (await fieldDb.sheets.orderBy('addedAt').reverse().toArray()).map((s) => s.sheet);
  const out = new Map<string, { project: FieldSheet['project']; sites: Map<string, FieldSite> }>();
  for (const s of sheets) {
    if (!s.project.id) continue;
    const cur = out.get(s.project.id) ?? { project: s.project, sites: new Map<string, FieldSite>() };
    // the computer's sites (not points added on a phone), the latest sheet's first
    for (const site of s.sites) if (!site.added && !cur.sites.has(site.id)) cur.sites.set(site.id, site);
    out.set(s.project.id, cur);
  }
  return [...out.values()].map((p) => ({ project: p.project, sites: [...p.sites.values()] }));
}

/** The next point name on a sheet: P1, P2 … (one not used yet). */
export const nextPointCode = (sheet: FieldSheet) => {
  const taken = new Set(sheet.sites.map((s) => s.code.trim().toLowerCase()));
  let n = 1;
  while (taken.has(`p${n}`)) n++;
  return `P${n}`;
};

/** A reading added to the sheet on the phone. */
export async function addMeasure(sheetId: string, m: FieldMeasure): Promise<void> {
  await fieldDb.transaction('rw', fieldDb.sheets, async () => {
    const cur = await fieldDb.sheets.get(sheetId);
    if (!cur || cur.sheet.measures.some((x) => x.id === m.id)) return;
    await fieldDb.sheets.put({ ...cur, sheet: { ...cur.sheet, measures: [...cur.sheet.measures, m] } });
  });
}

// ------------------------------------------------------------ photos

export async function addPhoto(p: Omit<StoredPhoto, 'id'>): Promise<string> {
  const id = `${p.sheetId}|${p.siteId}|${crypto.getRandomValues(new Uint32Array(2)).join('')}`;
  await fieldDb.photos.put({ ...p, id });
  return id;
}
export async function setPhotoGps(id: string, gps: StoredPhoto['gps'], gpsFrom: StoredPhoto['gpsFrom']): Promise<void> {
  await fieldDb.photos.update(id, { gps, gpsFrom });
}
export async function removePhoto(id: string): Promise<void> {
  await fieldDb.photos.delete(id);
}

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/**
 * What goes to the computer: the results (each site or point with something recorded – readings, notes or photos)
 * and the photos, full size, named after their site (SW1 1.jpg, SW1 2.jpg …) in the order taken.
 */
export async function jobContents(sheetId: string, by: string): Promise<{ sheet: FieldSheet; results: FieldResults; photos: OutPhoto[]; lockedWith?: string } | null> {
  const stored = await fieldDb.sheets.get(sheetId);
  if (!stored) return null;
  const visits = (await fieldDb.visits.where('sheetId').equals(sheetId).toArray()).map((v) => v.visit);
  const photos = (await fieldDb.photos.where('sheetId').equals(sheetId).toArray()).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  // a site with photos and nothing else recorded still goes
  for (const siteId of new Set(photos.map((p) => p.siteId))) if (!visits.some((v) => v.siteId === siteId)) visits.push({ siteId, values: {} });
  const results = resultsOf(stored.sheet, visits, by, new Set(photos.map((p) => p.siteId)));
  const sent = new Set(results.visits.map((v) => v.siteId));
  const count = new Map<string, number>();
  const out: OutPhoto[] = [];
  for (const p of photos) {
    if (!sent.has(p.siteId)) continue;
    const code = stored.sheet.sites.find((s) => s.id === p.siteId)?.code ?? 'Photo';
    const n = (count.get(p.siteId) ?? 0) + 1;
    count.set(p.siteId, n);
    // the picture as kept: read when it goes (a phone can't hold a big job's photos all at once)
    out.push({ siteId: p.siteId, name: `${code} ${n}.${EXT[p.type] ?? 'jpg'}`, type: p.type, blob: p.blob, ...(p.gps ? { lat: p.gps.lat, lng: p.gps.lng, ...(p.gps.acc !== undefined ? { acc: p.gps.acc } : {}) } : {}), at: p.at });
  }
  return { sheet: stored.sheet, results, photos: out, lockedWith: stored.lockedWith };
}

/** A photo already taken (from the gallery), ready to keep: the picture, and where and when the camera says it was taken. */
export interface GalleryPhoto {
  blob: Blob;
  type: string;
  size: number;
  thumb: string;
  gps?: PlacedAt;
  /** Local time, 'YYYY-MM-DDTHH:mm:ss'. */
  taken: string;
}

/** A local time ('YYYY-MM-DDTHH:mm:ss') as an ISO moment. */
const isoOf = (local: string) => {
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
};

/**
 * Photos already taken, each kept with where it was taken: a point of the job that day within a few steps, or a new
 * point placed by the photos themselves – never by where the phone is now. Photos without a location make one point
 * a day. A point's time is when its first photo was taken; a job started from photos takes the day of the first.
 */
export async function addPhotosByPlace(sheetId: string, photos: GalleryPhoto[]): Promise<{ added: number; points: number; joined: number; placed: number; unplaced: number; placedPoints: number; firstPoint?: string }> {
  return fieldDb.transaction('rw', [fieldDb.sheets, fieldDb.visits, fieldDb.photos], async () => {
    const stored = await fieldDb.sheets.get(sheetId);
    if (!stored) throw new Error('The job isn’t on this phone any more.');
    const visits = new Map((await fieldDb.visits.where('sheetId').equals(sheetId).toArray()).map((v) => [v.visit.siteId, v.visit]));
    const sites = stored.sheet.sites;
    const existing = sites.map((x) => ({ id: x.id, day: (visits.get(x.id)?.time ?? stored.sheet.date).slice(0, 10), ...(x.lat !== undefined && x.lng !== undefined ? { at: { lat: x.lat, lng: x.lng } } : {}) }));
    const places = groupByPlace(photos, (p) => ({ gps: p.gps, taken: p.taken }), existing);
    const made: FieldSite[] = [];
    for (const place of places) {
      if (place.id) continue;
      const first = place.items[0];
      const site: FieldSite = {
        id: newFieldSiteId(),
        code: nextPointCode({ ...stored.sheet, sites: [...sites, ...made] }),
        type: 'Other',
        added: true,
        auto: true,
        fromPhotos: true,
        ...(place.at ? { lat: place.at.lat, lng: place.at.lng, located: { at: isoOf(first.taken), how: 'photo' as const, ...(place.at.acc !== undefined ? { acc: place.at.acc } : {}) } } : {}),
      };
      made.push(site);
      place.id = site.id;
    }
    const firstDay = places.map((p) => p.day).sort()[0];
    await fieldDb.sheets.put({ ...stored, sheet: { ...stored.sheet, sites: [...sites, ...made], ...(!sites.length && firstDay ? { date: firstDay } : {}) } });
    for (const place of places) {
      for (const p of place.items) await fieldDb.photos.put({ id: `${sheetId}|${place.id}|${crypto.getRandomValues(new Uint32Array(2)).join('')}`, sheetId, siteId: place.id!, blob: p.blob, type: p.type, size: p.size, thumb: p.thumb, at: isoOf(p.taken), ...(p.gps ? { gps: p.gps, gpsFrom: 'camera' as const } : {}) });
      // the point's time: when its first photo was taken (unless it has one)
      const cur = visits.get(place.id!) ?? { siteId: place.id!, values: {} };
      if (!cur.time) await saveVisit(sheetId, { ...cur, time: place.items[0].taken.slice(0, 16) });
    }
    const located = (x: GalleryPhoto) => !!x.gps;
    return {
      added: photos.length,
      points: made.length,
      joined: places.filter((p) => !made.some((m) => m.id === p.id)).length,
      placed: photos.filter(located).length,
      unplaced: photos.filter((x) => !located(x)).length,
      // the points the photos with a location went to
      placedPoints: places.filter((p) => p.at).length,
      firstPoint: places[0]?.id,
    };
  });
}

export async function saveVisit(sheetId: string, visit: FieldVisit): Promise<void> {
  await fieldDb.visits.put({ id: `${sheetId}|${visit.siteId}`, sheetId, visit, updatedAt: new Date().toISOString() });
}

export async function getPref(key: string): Promise<string> {
  return (await fieldDb.prefs.get(key))?.value ?? '';
}
export async function setPref(key: string, value: string): Promise<void> {
  await fieldDb.prefs.put({ key, value });
}

/** The team's keys this phone was set up with, newest first (none unless it was set up). */
export async function teamKeys(): Promise<TeamKey[]> {
  return parseKeys(await getPref('teamKeys'));
}
/** Setting the phone up for the team: the keys join any it has (newest first). */
export async function addTeamKeys(keys: TeamKey[]): Promise<TeamKey[]> {
  const next = mergeKeys(keys, await teamKeys());
  await setPref('teamKeys', JSON.stringify(next));
  return next;
}
export async function forgetTeamKeys(): Promise<void> {
  await fieldDb.prefs.delete('teamKeys');
}

/** What was recorded on a sheet, as the file to send back: the visits, sites added here, locations set here. */
export function resultsOf(sheet: FieldSheet, visits: FieldVisit[], by: string, withPhotos: Set<string> = new Set()): FieldResults {
  const order = new Map(sheet.sites.map((s, i) => [s.id, i]));
  const added = sheet.sites.filter((s) => s.added);
  const located = sheet.sites.filter((s) => s.located && !s.added && s.lat !== undefined && s.lng !== undefined);
  return {
    app: FIELD_APP,
    kind: 'field-results',
    v: 1,
    sheet: { id: sheet.id, project: sheet.project, round: sheet.round, date: sheet.date },
    by: by.trim() || undefined,
    sent: new Date().toISOString(),
    visits: visits.filter((v) => order.has(v.siteId) && (v.done || v.notSampled || Object.keys(v.values).length || v.notes || withPhotos.has(v.siteId))).sort((a, b) => order.get(a.siteId)! - order.get(b.siteId)!),
    ...(added.length ? { newSites: added.map((s) => ({ id: s.id, code: s.code, name: s.name, type: s.type, lat: s.lat, lng: s.lng, acc: s.located?.acc, how: s.located?.how, note: s.note, ...(s.auto ? { auto: true } : {}) })) } : {}),
    ...(located.length ? { located: located.map((s) => ({ siteId: s.id, lat: s.lat!, lng: s.lng!, acc: s.located!.acc, how: s.located!.how, at: s.located!.at })) } : {}),
  };
}

/** Changes a site on a sheet kept on the phone (its location, say). */
export async function updateSite(sheetId: string, siteId: string, patch: Partial<FieldSite>): Promise<void> {
  await fieldDb.transaction('rw', fieldDb.sheets, async () => {
    const cur = await fieldDb.sheets.get(sheetId);
    if (!cur) return;
    await fieldDb.sheets.put({ ...cur, sheet: { ...cur.sheet, sites: cur.sheet.sites.map((s) => (s.id === siteId ? { ...s, ...patch } : s)) } });
  });
}

/** A new monitoring point, added to the sheet (at the end). */
export async function addSite(sheetId: string, site: FieldSite): Promise<void> {
  await fieldDb.transaction('rw', fieldDb.sheets, async () => {
    const cur = await fieldDb.sheets.get(sheetId);
    if (!cur) return;
    await fieldDb.sheets.put({ ...cur, sheet: { ...cur.sheet, sites: [...cur.sheet.sites.filter((s) => s.id !== site.id), site] } });
  });
}

export const resultsFileName = (sheet: FieldSheet) =>
  `Field results - ${sheet.project.code || sheet.project.name} - ${sheet.date}.envirodb-field.json`
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‒-―]/g, '-')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/[\\/:*?"<>|]+/g, '-');
