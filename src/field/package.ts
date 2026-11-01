// The job file: everything a phone recorded, as one file to send back – the results, the photos at full size with
// their locations written in, and the points as a spreadsheet and a map file. A zip, so it opens anywhere: the photos
// are a folder of pictures even without EnviroDB. When the sheet came locked with the team key, the whole zip is
// locked with it too (then it opens only in EnviroDB).

import { checkResults, FIELD_APP, type FieldPhoto, type FieldResults, type FieldSheet, type FieldVisit } from './model';
import { lock, lockedWith, unlock, type TeamKey } from './lock';
import { unlockFile } from './model';
import { withPhotoGps } from '../lib/exif';
import { fromBase64 } from '../lib/issued';

export const JOB_SUFFIX = '.envirodb-field.zip';
export const LOCKED_SUFFIX = '.envirodb-field.locked';
/** The results inside a job file. */
export const RESULTS_FILE = 'results.envirodb-field.json';
const MAGIC = new TextEncoder().encode('EnviroDB-field-job-locked-1\n');

/** A job file, by its name (a zip renamed keeps the suffix; one kept elsewhere may not – see looksLikeJob). */
/** A job file's name – kept as the phone named it, or with " (1)" added on the way (a second download, say). */
export const isJobFileName = (name: string) => /\.envirodb-field(?:\s*\(\d+\))?\.(zip|locked)$/i.test(name);

/** A photo on the phone, ready to go: whose it is, where and when, and the picture. */
export interface OutPhoto {
  siteId: string;
  name: string;
  type: string;
  bytes: Uint8Array;
  lat?: number;
  lng?: number;
  acc?: number;
  at?: string;
}

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const safe = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim() || 'photo';

/** The photos with their locations written in (JPEGs without the camera's own) and names unique in the job file. */
export function readyPhotos(photos: OutPhoto[]): OutPhoto[] {
  const taken = new Set<string>();
  return photos.map((p) => {
    const ext = EXT[p.type] ?? 'jpg';
    const base = safe(p.name.replace(/\.\w{2,5}$/, ''));
    let name = `${base}.${ext}`;
    for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${base} (${i}).${ext}`;
    taken.add(name.toLowerCase());
    const bytes = p.lat !== undefined && p.lng !== undefined ? withPhotoGps(p.bytes, { lat: p.lat, lng: p.lng, acc: p.acc }, p.at) : p.bytes;
    return { ...p, name, bytes };
  });
}

/** The results with each visit's photos as entries naming their files (and where and when each was taken). */
export function withPhotoEntries(results: FieldResults, photos: OutPhoto[]): FieldResults {
  return {
    ...results,
    visits: results.visits.map((v) => {
      const mine = photos.filter((p) => p.siteId === v.siteId);
      const { photos: _old, ...rest } = v;
      void _old;
      return mine.length ? { ...rest, photos: mine.map((p): FieldPhoto => ({ name: p.name, type: p.type, file: `photos/${p.name}`, ...(p.lat !== undefined && p.lng !== undefined ? { lat: p.lat, lng: p.lng, ...(p.acc !== undefined ? { acc: p.acc } : {}) } : {}), ...(p.at ? { at: p.at } : {}) })) } : rest;
    }),
  };
}

const csvCell = (v: unknown) => {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (rows: unknown[][]) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
const round = (n: number | undefined, dp: number) => (n === undefined ? '' : Number(n.toFixed(dp)));

/** Where a visit was: its recorded location, or the site's. */
function placeOf(sheet: FieldSheet, v: FieldVisit): { lat: number; lng: number; acc?: number } | null {
  if (v.gps) return v.gps;
  const s = sheet.sites.find((x) => x.id === v.siteId);
  return s?.lat !== undefined && s?.lng !== undefined ? { lat: s.lat, lng: s.lng, acc: s.located?.acc } : null;
}

/** The points as a spreadsheet: one row each, the readings across, the photos named. */
export function pointsCsv(sheet: FieldSheet, results: FieldResults): string {
  const measures = sheet.measures.filter((m) => results.visits.some((v) => v.values[m.id] !== undefined));
  const head = ['Point', 'Name', 'Kind', 'Latitude', 'Longitude', 'Accuracy (m)', 'Time', ...measures.map((m) => `${m.name}${m.unit ? ` (${m.unit})` : ''}`), 'Not sampled', 'Notes', 'Photos'];
  const rows: unknown[][] = [head];
  for (const v of results.visits) {
    const s = sheet.sites.find((x) => x.id === v.siteId);
    const at = placeOf(sheet, v);
    rows.push([s?.code ?? v.siteId, s?.name ?? '', s?.type ?? '', round(at?.lat, 7), round(at?.lng, 7), round(at?.acc, 1), v.time?.replace('T', ' ') ?? '', ...measures.map((m) => v.values[m.id] ?? ''), v.notSampled ?? '', v.notes ?? '', (v.photos ?? []).map((p) => p.name).join('; ')]);
  }
  return csv(rows);
}

/** The photos as a spreadsheet: where and when each was taken. */
export function photosCsv(sheet: FieldSheet, results: FieldResults): string {
  const rows: unknown[][] = [['Photo', 'Point', 'Latitude', 'Longitude', 'Accuracy (m)', 'Taken']];
  for (const v of results.visits)
    for (const p of v.photos ?? []) rows.push([p.file ?? p.name, sheet.sites.find((x) => x.id === v.siteId)?.code ?? v.siteId, round(p.lat, 7), round(p.lng, 7), round(p.acc, 1), p.at ?? '']);
  return csv(rows);
}

/** The points and photos as GeoJSON (for GIS, Google Earth via a converter, or a map on the web). */
export function pointsGeoJson(sheet: FieldSheet, results: FieldResults): string {
  const features: unknown[] = [];
  for (const v of results.visits) {
    const s = sheet.sites.find((x) => x.id === v.siteId);
    const at = placeOf(sheet, v);
    if (at) {
      const readings = Object.fromEntries(sheet.measures.filter((m) => v.values[m.id] !== undefined).map((m) => [`${m.name}${m.unit ? ` (${m.unit})` : ''}`, v.values[m.id]]));
      features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [round(at.lng, 7), round(at.lat, 7)] }, properties: { kind: 'point', point: s?.code ?? v.siteId, name: s?.name, accuracy_m: at.acc, time: v.time, notes: v.notes, photos: (v.photos ?? []).map((p) => p.file ?? p.name), ...readings } });
    }
    for (const p of v.photos ?? [])
      if (p.lat !== undefined && p.lng !== undefined) features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [round(p.lng, 7), round(p.lat, 7)] }, properties: { kind: 'photo', photo: p.file ?? p.name, point: s?.code ?? v.siteId, accuracy_m: p.acc, taken: p.at } });
  }
  return JSON.stringify({ type: 'FeatureCollection', name: `${sheet.project.name || 'Field job'} – ${sheet.round}`, features }, null, 1);
}

const README = (sheet: FieldSheet, results: FieldResults, photos: number) =>
  [
    `EnviroDB field job: ${sheet.round}${sheet.project.name ? ` – ${sheet.project.name}` : ''}, ${sheet.date}`,
    results.by ? `Recorded by ${results.by}.` : '',
    '',
    'To add it to EnviroDB: save this file to the team’s Inbox folder (EnviroDB picks it up there), or drop it on EnviroDB’s Import page.',
    '',
    `photos/        ${photos} photo${photos === 1 ? '' : 's'} at full size, each with where it was taken written into it (GPS)`,
    'points.csv     the points: location, time, readings, notes and photos – opens in Excel',
    'photos.csv     each photo: where and when it was taken',
    'points.geojson the points and photos for GIS (QGIS, ArcGIS)',
    `${RESULTS_FILE}  what EnviroDB reads`,
    '',
  ]
    .filter((l, i, a) => l || a[i - 1])
    .join('\r\n');

/** The job file (a zip): the results, the photos at full size with their locations, and the points as files to open. */
export async function jobZip(sheet: FieldSheet, results: FieldResults, photos: OutPhoto[]): Promise<Uint8Array> {
  const ready = readyPhotos(photos);
  const withFiles = withPhotoEntries(results, ready);
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  // first, and not compressed: the inbox reads which project it's for from the file's start
  zip.file(RESULTS_FILE, JSON.stringify(withFiles, null, 1), { compression: 'STORE' });
  // pictures are already compressed: stored as they are
  for (const p of ready) zip.file(`photos/${p.name}`, p.bytes, { compression: 'STORE', date: p.at && !Number.isNaN(Date.parse(p.at)) ? new Date(p.at) : undefined });
  zip.file('points.csv', '﻿' + pointsCsv(sheet, withFiles));
  zip.file('photos.csv', '﻿' + photosCsv(sheet, withFiles));
  zip.file('points.geojson', pointsGeoJson(sheet, withFiles));
  zip.file('Read me.txt', README(sheet, withFiles, ready.length));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

/** The job file locked with the team key: a header EnviroDB knows, then the zip locked. */
export async function lockedJob(zip: Uint8Array, key: TeamKey): Promise<Uint8Array> {
  const sealed = await lock(zip, key, 'results');
  const out = new Uint8Array(MAGIC.length + sealed.length);
  out.set(MAGIC);
  out.set(sealed, MAGIC.length);
  return out;
}

const startsWith = (b: Uint8Array, head: Uint8Array) => b.length >= head.length && head.every((x, i) => b[i] === x);
const isZip = (b: Uint8Array) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
export const isLockedJob = (b: Uint8Array) => startsWith(b, MAGIC);
/** The team key a locked job file needs (its fingerprint). */
export const lockedJobKey = (b: Uint8Array) => lockedWith(b.subarray(MAGIC.length));

/** Whether a zip is a job file (looked at by what's inside, for one renamed on the way). */
export async function looksLikeJob(bytes: Uint8Array): Promise<boolean> {
  if (isLockedJob(bytes)) return true;
  if (!isZip(bytes)) return false;
  try {
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(bytes);
    return !!zip.file(RESULTS_FILE);
  } catch {
    return false;
  }
}

/**
 * A job file (or a locked one), or a results file from before 1.29, read back: the results, each photo with its
 * picture. `keyId`: the team key it was locked with.
 */
export async function readJobFile(bytes: Uint8Array, keys: TeamKey[]): Promise<{ results: FieldResults; keyId?: string }> {
  let data = bytes;
  let keyId: string | undefined;
  if (isLockedJob(data)) {
    const sealed = data.subarray(MAGIC.length);
    keyId = lockedWith(sealed);
    data = await unlock(sealed, keys, 'results');
  }
  if (isZip(data)) {
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(data);
    const entry = zip.file(RESULTS_FILE);
    if (!entry) throw new Error('This zip isn’t an EnviroDB field job (it has no results in it).');
    const raw = JSON.parse(await entry.async('string')) as unknown;
    if (!raw || typeof raw !== 'object' || (raw as { app?: unknown }).app !== FIELD_APP) throw new Error('This isn’t an EnviroDB field job.');
    const results = checkResults(raw);
    // each photo's picture from its file
    const visits = await Promise.all(
      results.visits.map(async (v) => {
        if (!v.photos?.length) return v;
        const photos: FieldPhoto[] = [];
        for (const p of v.photos) {
          const f = p.file ? zip.file(p.file) : null;
          if (f) photos.push({ ...p, bytes: await f.async('uint8array') });
          else if (p.dataUrl) photos.push(p);
        }
        return { ...v, photos: photos.length ? photos : undefined };
      }),
    );
    return { results: { ...results, visits }, keyId };
  }
  // a results file (JSON), as phones sent before 1.29 – perhaps locked
  const text = new TextDecoder().decode(data);
  const { content, keyId: k } = await unlockFile(JSON.parse(text), keys);
  return { results: checkResults(content), keyId: k };
}

/** The bytes of a photo from a results file, whichever way it came. */
export function photoBytes(p: FieldPhoto): Uint8Array | null {
  if (p.bytes) return p.bytes;
  const m = p.dataUrl ? /^data:image\/(?:jpeg|png|webp);base64,(.*)$/.exec(p.dataUrl) : null;
  return m ? fromBase64(m[1]) : null;
}

/** The job file's name: the project, the job and the day. */
export function jobFileName(sheet: Pick<FieldSheet, 'project' | 'round' | 'date'>, locked = false): string {
  const parts = ['Field job', sheet.project.code || sheet.project.name, sheet.round, sheet.date].filter(Boolean);
  return (
    parts
      .join(' - ')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[‒-―]/g, '-')
      .replace(/[^\x20-\x7E]/g, '')
      .replace(/[\\/:*?"<>|]+/g, '-')
      .slice(0, 150) + (locked ? LOCKED_SUFFIX : JOB_SUFFIX)
  );
}
