// Photos dropped on the computer's Import page – from the phone's camera roll in OneDrive, a camera's card, an email –
// each read for where and when it was taken (the location its camera wrote into it), grouped by place as a phone's
// job is, then reviewed the same way: with a site nearby, as a new site, or kept with the project.

import { readPhotoInfo } from '../lib/exif';
import { FIELD_APP, type FieldNewSite, type FieldPhoto, type FieldResults, type FieldVisit } from './model';
import { groupByPlace, takenOf } from './places';

/** A photo, by its name. */
export const PHOTO_FILE = /\.(jpe?g|png|webp|heic|heif)$/i;
const TYPES: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

export interface DroppedPhoto {
  name: string;
  bytes: Uint8Array;
  lastModified?: number;
}

/**
 * The photos as results to review, one point a place (named P1, P2 … in the order taken). The same photos dropped
 * again make the same points, so nothing doubles. `skipped`: photos that can't be read here (HEIC).
 */
export function photosAsResults(files: DroppedPhoto[], by?: string): { results: FieldResults | null; skipped: string[] } {
  const skipped: string[] = [];
  const read = files.flatMap((f) => {
    const type = TYPES[f.name.split('.').pop()?.toLowerCase() ?? ''];
    if (!type) {
      skipped.push(f.name);
      return [];
    }
    let info: ReturnType<typeof readPhotoInfo> = {};
    try {
      if (type === 'image/jpeg') info = readPhotoInfo(f.bytes);
    } catch {
      // a damaged photo: kept, without what the camera wrote
    }
    return [{ f, type, gps: info.gps, taken: takenOf(info.taken, f) }];
  });
  if (!read.length) return { results: null, skipped };
  const places = groupByPlace(read, (x) => ({ gps: x.gps, taken: x.taken }));
  const idOf = (p: (typeof places)[number]) => `pc-${p.day}-${p.at ? `${p.at.lat.toFixed(5)},${p.at.lng.toFixed(5)}` : 'none'}`;
  const newSites: FieldNewSite[] = places.map((p, i) => ({ id: idOf(p), code: `P${i + 1}`, type: 'Other', auto: true, ...(p.at ? { lat: p.at.lat, lng: p.at.lng, ...(p.at.acc !== undefined ? { acc: p.at.acc } : {}), how: 'photo' as const } : {}) }));
  const visits: FieldVisit[] = places.map((p) => ({
    siteId: idOf(p),
    values: {},
    time: p.items[0].taken.slice(0, 16),
    photos: p.items.map((x): FieldPhoto => {
      const at = new Date(x.taken);
      return { name: x.f.name, type: x.type, bytes: x.f.bytes, ...(x.gps ? { lat: x.gps.lat, lng: x.gps.lng, ...(x.gps.acc !== undefined ? { acc: x.gps.acc } : {}) } : {}), ...(Number.isNaN(at.getTime()) ? {} : { at: at.toISOString() }) };
    }),
  }));
  const first = places.map((p) => p.day).sort()[0];
  return {
    results: { app: FIELD_APP, kind: 'field-results', v: 1, sheet: { id: `photos-${first}`, project: { id: '', name: '' }, round: 'Photos', date: first }, ...(by ? { by } : {}), sent: new Date().toISOString(), visits, newSites },
    skipped,
  };
}
