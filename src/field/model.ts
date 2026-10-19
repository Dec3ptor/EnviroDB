// Field mode: the field sheet a computer makes for a sampling round (the sites, what to measure, last time's
// readings) and the results a phone sends back. Both are small files – or, for the sheet, a link – so the phone
// never needs the team's shared folder.

import { gunzip, gzip } from '../lib/issued';

export const FIELD_APP = 'EnviroDB';

/** What to measure at each site, with the range a reading is expected in (to catch a slip of the thumb). */
export interface FieldMeasure {
  /** The parameter's id. */
  id: string;
  name: string;
  unit: string;
  /** Decimals to show. */
  dp?: number;
  min?: number;
  max?: number;
}

export interface FieldSite {
  id: string;
  code: string;
  name?: string;
  lat?: number;
  lng?: number;
  /** How to get there, what to watch for. */
  note?: string;
  /** Last time's readings, by measure id, and when. */
  last?: { date: string; values: Record<string, number> };
  /** The readings taken here, when not all of them (a bore's water level isn't taken at a stream). */
  measures?: string[];
}

export interface FieldSheet {
  app: typeof FIELD_APP;
  kind: 'field-sheet';
  v: 1;
  id: string;
  project: { id: string; name: string; code?: string };
  /** e.g. "October 2026 monitoring". */
  round: string;
  /** The day planned. */
  date: string;
  sites: FieldSite[];
  measures: FieldMeasure[];
  /** Weather, flow and appearance to note at each site; photos. */
  observe: { weather: boolean; flow: boolean; appearance: boolean; photos: boolean };
  /** Who made it, when, with which EnviroDB. */
  by?: string;
  made: string;
  appVersion: string;
}

export const WEATHER = ['Fine', 'Overcast', 'Showers', 'Rain', 'Heavy rain'] as const;
export const FLOW = ['No flow', 'Low', 'Normal', 'High', 'Flood'] as const;
export const APPEARANCE = ['Clear', 'Slightly turbid', 'Turbid', 'Very turbid'] as const;
export const NOT_SAMPLED = ['Dry', 'No access', 'Unsafe', 'Other'] as const;

/** A site visited: when, the readings, what was seen; or why it wasn't sampled. */
export interface FieldVisit {
  siteId: string;
  /** 'YYYY-MM-DDTHH:mm' */
  time?: string;
  values: Record<string, number>;
  weather?: string;
  flow?: string;
  appearance?: string;
  notes?: string;
  notSampled?: string;
  gps?: { lat: number; lng: number; acc?: number };
  photos?: Array<{ name: string; dataUrl: string }>;
  done?: boolean;
}

export interface FieldResults {
  app: typeof FIELD_APP;
  kind: 'field-results';
  v: 1;
  sheet: Pick<FieldSheet, 'id' | 'project' | 'round' | 'date'>;
  /** Who did the sampling. */
  by?: string;
  sent: string;
  visits: FieldVisit[];
}

/** Usual ranges for the common field readings, to warn of a likely slip (not to judge the water). */
export const USUAL_RANGE: Record<string, [number, number]> = {
  'ph-field': [3, 11],
  ph: [3, 11],
  temp: [0, 35],
  'ec-field': [10, 60000],
  do: [0, 20],
  'do-sat': [0, 200],
  'turbidity-field': [0, 4000],
};

/** A reading to look at again: outside its usual range, or very different from last time. */
export function readingWarning(m: FieldMeasure, v: number, last?: number): string | null {
  const [lo, hi] = [m.min ?? USUAL_RANGE[m.id]?.[0], m.max ?? USUAL_RANGE[m.id]?.[1]];
  if (lo !== undefined && v < lo) return `Below ${lo} – check it`;
  if (hi !== undefined && v > hi) return `Above ${hi} – check it`;
  if (last !== undefined && Number.isFinite(last)) {
    if (m.id === 'ph-field' || m.id === 'ph') {
      if (Math.abs(v - last) >= 1.5) return `Last time ${last} – check it`;
    } else if (m.id === 'temp') {
      if (Math.abs(v - last) >= 12) return `Last time ${last} – check it`;
    } else if (last > 0 && v > 0 && (v / last >= 10 || last / v >= 10)) return `Last time ${last} – check it`;
  }
  return null;
}

// ------------------------------------------------------------ the sheet as a link (for a QR code)

const b64url = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64url = (t: string) => {
  const s = atob(t.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
};

/** The sheet, compressed, as text for a link's # part (which browsers never send to the server). */
export async function encodeSheet(sheet: FieldSheet): Promise<string> {
  return b64url(await gzip(JSON.stringify(sheet)));
}

export async function decodeSheet(text: string): Promise<FieldSheet> {
  return checkSheet(JSON.parse(await gunzip(fromB64url(text.trim()))));
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const str = (x: unknown, max = 300) => (typeof x === 'string' ? x.slice(0, max) : undefined);
const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : undefined);

/** A field sheet read from a link or a file: only what a sheet has, of the right kinds (it came from outside). */
export function checkSheet(x: unknown): FieldSheet {
  if (!isObj(x) || x.app !== FIELD_APP || x.kind !== 'field-sheet') throw new Error('This isn’t an EnviroDB field sheet.');
  const p = isObj(x.project) ? x.project : {};
  const sites = (Array.isArray(x.sites) ? x.sites : []).filter(isObj).slice(0, 200).map((s): FieldSite => {
    const last = isObj(s.last) && isObj(s.last.values) ? { date: str(s.last.date, 20) ?? '', values: Object.fromEntries(Object.entries(s.last.values).filter(([, v]) => num(v) !== undefined).slice(0, 50)) as Record<string, number> } : undefined;
    const measures = Array.isArray(s.measures) ? s.measures.filter((m): m is string => typeof m === 'string').slice(0, 40) : undefined;
    return { id: str(s.id, 80) ?? '', code: str(s.code, 40) ?? '?', name: str(s.name, 120), lat: num(s.lat), lng: num(s.lng), note: str(s.note, 1000), last, ...(measures ? { measures } : {}) };
  });
  const measures = (Array.isArray(x.measures) ? x.measures : []).filter(isObj).slice(0, 40).map((m): FieldMeasure => ({ id: str(m.id, 80) ?? '', name: str(m.name, 120) ?? '', unit: str(m.unit, 30) ?? '', dp: num(m.dp), min: num(m.min), max: num(m.max) }));
  const o = isObj(x.observe) ? x.observe : {};
  return {
    app: FIELD_APP,
    kind: 'field-sheet',
    v: 1,
    id: str(x.id, 80) ?? '',
    project: { id: str(p.id, 80) ?? '', name: str(p.name, 200) ?? 'Project', code: str(p.code, 60) },
    round: str(x.round, 200) ?? '',
    date: str(x.date, 20) ?? '',
    sites: sites.filter((s) => s.id),
    measures: measures.filter((m) => m.id),
    observe: { weather: o.weather !== false, flow: !!o.flow, appearance: !!o.appearance, photos: !!o.photos },
    by: str(x.by, 120),
    made: str(x.made, 40) ?? '',
    appVersion: str(x.appVersion, 20) ?? '',
  };
}

/** Field results read from a file: checked the same way. */
export function checkResults(x: unknown): FieldResults {
  if (!isObj(x) || x.app !== FIELD_APP || x.kind !== 'field-results') throw new Error('This isn’t an EnviroDB field results file.');
  const sh = isObj(x.sheet) ? x.sheet : {};
  const p = isObj(sh.project) ? sh.project : {};
  const visits = (Array.isArray(x.visits) ? x.visits : []).filter(isObj).slice(0, 500).map((v): FieldVisit => {
    const g = isObj(v.gps) && num(v.gps.lat) !== undefined && num(v.gps.lng) !== undefined ? { lat: num(v.gps.lat)!, lng: num(v.gps.lng)!, acc: num(v.gps.acc) } : undefined;
    const photos = (Array.isArray(v.photos) ? v.photos : []).filter(isObj).filter((ph) => typeof ph.dataUrl === 'string' && /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(ph.dataUrl)).slice(0, 20).map((ph) => ({ name: str(ph.name, 120) ?? 'photo.jpg', dataUrl: ph.dataUrl as string }));
    return {
      siteId: str(v.siteId, 80) ?? '',
      time: str(v.time, 20),
      values: isObj(v.values) ? (Object.fromEntries(Object.entries(v.values).filter(([, n]) => num(n) !== undefined).slice(0, 50)) as Record<string, number>) : {},
      weather: str(v.weather, 40),
      flow: str(v.flow, 40),
      appearance: str(v.appearance, 60),
      notes: str(v.notes, 4000),
      notSampled: str(v.notSampled, 200),
      gps: g,
      photos: photos.length ? photos : undefined,
      done: !!v.done,
    };
  });
  return {
    app: FIELD_APP,
    kind: 'field-results',
    v: 1,
    sheet: { id: str(sh.id, 80) ?? '', project: { id: str(p.id, 80) ?? '', name: str(p.name, 200) ?? '', code: str(p.code, 60) }, round: str(sh.round, 200) ?? '', date: str(sh.date, 20) ?? '' },
    by: str(x.by, 120),
    sent: str(x.sent, 40) ?? '',
    visits: visits.filter((v) => v.siteId),
  };
}
