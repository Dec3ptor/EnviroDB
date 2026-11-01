// Photos into places: those taken the same day within a few steps of each other make one point, placed where they were
// taken – by the location the camera wrote into them, never by where the phone is now (back at the office, say).
// Photos without a location make one point a day, for the computer to say where they go. Used on the phone (photos
// from the gallery) and on the computer (photos dropped on the Import page).

import { distanceM } from './model';

/** How close (m) photos must be to make one place: a few steps, more than a phone's GPS wanders. */
export const PLACE_M = 25;

export interface PlacedAt {
  lat: number;
  lng: number;
  acc?: number;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** A moment as local time, the way cameras write it: 'YYYY-MM-DDTHH:mm:ss'. */
export function localTime(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** When a photo was taken: what the camera wrote in it, else the file's date. */
export const takenOf = (camera: string | undefined, file: { lastModified?: number }) => camera ?? localTime(new Date(file.lastModified || Date.now()));

/** A place: an existing point (its id) or a new one, its day, where it is (none: the day's photos without a location). */
export interface Place<T> {
  id?: string;
  day: string;
  at?: PlacedAt;
  items: T[];
}

/**
 * The photos by place, in the order taken: each joins a place that day within PLACE_M of it (the nearest; one of
 * `existing` – the points there already – or one made by an earlier photo), or starts one where it was taken.
 */
export function groupByPlace<T>(items: T[], info: (t: T) => { gps?: PlacedAt; taken: string }, existing: Array<{ id: string; day: string; at?: PlacedAt }> = []): Place<T>[] {
  const places: Place<T>[] = existing.map((e) => ({ id: e.id, day: e.day, ...(e.at ? { at: e.at } : {}), items: [] }));
  const known = items.map((t) => ({ t, ...info(t) }));
  known.sort((a, b) => (a.taken < b.taken ? -1 : a.taken > b.taken ? 1 : 0));
  for (const { t, gps, taken } of known) {
    const day = taken.slice(0, 10);
    const here = gps
      ? places
          .filter((p) => p.day === day && p.at)
          .map((p) => ({ p, m: distanceM(p.at!, gps) }))
          .filter((x) => x.m <= PLACE_M)
          .sort((a, b) => a.m - b.m)[0]?.p
      : places.find((p) => p.day === day && !p.at);
    if (here) here.items.push(t);
    else places.push({ day, ...(gps ? { at: gps } : {}), items: [t] });
  }
  return places.filter((p) => p.items.length);
}
