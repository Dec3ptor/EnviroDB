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
    const photos = (Array.isArray(v.photos) ? v.photos : []).filter(isObj).filter((ph) => typeof ph.dataUrl === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(ph.dataUrl)).slice(0, 20).map((ph) => ({ name: str(ph.name, 120) ?? 'photo.jpg', dataUrl: ph.dataUrl as string }));
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

// ------------------------------------------------------------ printed codes: a project's or a site's, kept for good

/** What the phone does when a site's printed code is scanned there. */
export interface FieldCodeFill {
  /** Fill in the time sampled: now. */
  time: boolean;
  /** Record the phone's location. */
  gps: boolean;
}

/**
 * A printed field code: a project's (its sites) or one site's. Unlike a sheet it has no day – scanned, it opens (or
 * adds to) that day's sheet on the phone, so the same printed code serves every round.
 */
export interface FieldCode {
  app: typeof FIELD_APP;
  kind: 'field-code';
  v: 1;
  project: FieldSheet['project'];
  /** A site's own code: the site it opens. */
  site?: string;
  sites: FieldSite[];
  measures: FieldMeasure[];
  observe: FieldSheet['observe'];
  fill: FieldCodeFill;
  made: string;
  appVersion: string;
}

// A printed code is read by a phone's camera from paper – maybe scuffed, at an angle – so it's kept small: an array
// rather than named fields, compressed, in capital letters and digits (which a QR code holds in fewer squares).
type Wire = [
  1,
  [string, string, string | null],
  number,
  Array<[string, string, string | null, number | null, number | null, string | null, number[] | null]>,
  Array<[string, string, string, number | null]>,
  number,
  number,
  string,
];

function toWire(c: FieldCode): Wire {
  const at = new Map(c.measures.map((m, i) => [m.id, i]));
  const o = c.observe;
  return [
    1,
    [c.project.id, c.project.name, c.project.code ?? null],
    c.site ? c.sites.findIndex((s) => s.id === c.site) : -1,
    c.sites.map((s) => [s.id, s.code, s.name ?? null, s.lat ?? null, s.lng ?? null, s.note ?? null, s.measures ? s.measures.map((id) => at.get(id)!).filter((i) => i !== undefined) : null]),
    c.measures.map((m) => [m.id, m.name, m.unit, m.dp ?? null]),
    (o.weather ? 1 : 0) | (o.flow ? 2 : 0) | (o.appearance ? 4 : 0) | (o.photos ? 8 : 0),
    (c.fill.time ? 1 : 0) | (c.fill.gps ? 2 : 0),
    c.appVersion,
  ];
}

function fromWire(w: unknown): unknown {
  if (!Array.isArray(w) || w[0] !== 1) throw new Error('This isn’t an EnviroDB field code.');
  const arr = (x: unknown) => (Array.isArray(x) ? x : []);
  const val = <T>(x: T | null) => (x === null ? undefined : x);
  const [, p, site, sites, measures, observe, fill, appVersion] = w as unknown[];
  const ms = arr(measures).map((m) => arr(m)).map(([id, name, unit, dp]) => ({ id, name, unit, dp: val(dp) }));
  const ss = arr(sites).map((x) => arr(x)).map(([id, code, name, lat, lng, note, own]) => ({ id, code, name: val(name), lat: val(lat), lng: val(lng), note: val(note), measures: Array.isArray(own) ? own.map((i) => (ms[i as number] as { id?: unknown } | undefined)?.id) : undefined }));
  const pp = arr(p);
  const bits = (n: unknown, k: number) => typeof n === 'number' && (n & k) !== 0;
  return {
    app: FIELD_APP,
    kind: 'field-code',
    project: { id: pp[0], name: pp[1], code: val(pp[2]) },
    site: typeof site === 'number' && site >= 0 ? (ss[site] as { id?: unknown } | undefined)?.id : undefined,
    sites: ss,
    measures: ms,
    observe: { weather: bits(observe, 1), flow: bits(observe, 2), appearance: bits(observe, 4), photos: bits(observe, 8) },
    fill: { time: bits(fill, 1), gps: bits(fill, 2) },
    made: '',
    appVersion,
  };
}

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function toBase32(bytes: Uint8Array): string {
  let out = '', bits = 0, value = 0;
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function fromBase32(text: string): Uint8Array {
  const out: number[] = [];
  let bits = 0, value = 0;
  for (const ch of text) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error('This isn’t an EnviroDB field code.');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}
async function squeeze(bytes: Uint8Array, t: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  return new Uint8Array(await new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(t)).arrayBuffer());
}

/** A printed code as the letters after `k=` in its link. */
export async function encodeCode(code: FieldCode): Promise<string> {
  return toBase32(await squeeze(new TextEncoder().encode(JSON.stringify(toWire(code))), new CompressionStream('deflate-raw')));
}

export async function decodeCode(text: string): Promise<FieldCode> {
  let json: string;
  try {
    json = new TextDecoder().decode(await squeeze(fromBase32(text.trim()), new DecompressionStream('deflate-raw')));
  } catch {
    throw new Error('This isn’t an EnviroDB field code.');
  }
  return checkCode(fromWire(JSON.parse(json)));
}

/** A field code read from a QR code: checked like a sheet (anyone can print a QR code). */
export function checkCode(x: unknown): FieldCode {
  if (!isObj(x) || x.app !== FIELD_APP || x.kind !== 'field-code') throw new Error('This isn’t an EnviroDB field code.');
  const s = checkSheet({ ...x, kind: 'field-sheet' });
  if (!s.project.id) throw new Error('This field code doesn’t say which project it’s for.');
  if (!s.sites.length) throw new Error('This field code has no sites.');
  const f = isObj(x.fill) ? x.fill : {};
  const site = str(x.site, 80);
  return {
    app: FIELD_APP,
    kind: 'field-code',
    v: 1,
    project: s.project,
    ...(site && s.sites.some((y) => y.id === site) ? { site } : {}),
    sites: s.sites.map((y) => ({ ...y, last: undefined })),
    measures: s.measures,
    observe: s.observe,
    fill: { time: f.time !== false, gps: !!f.gps },
    made: s.made,
    appVersion: s.appVersion,
  };
}

const ROUND_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** The day's sheet a printed code starts, named as the computer names a day's sheet (so the two become one). */
export function codeSheet(code: FieldCode, date: string): FieldSheet {
  return {
    app: FIELD_APP,
    kind: 'field-sheet',
    v: 1,
    id: `${code.project.id}:${date}`,
    project: code.project,
    round: `${ROUND_MONTHS[Number(date.slice(5, 7)) - 1] ?? ''} ${date.slice(0, 4)} monitoring`.trim(),
    date,
    sites: code.sites.map((s) => ({ ...s })),
    measures: code.measures,
    observe: code.observe,
    made: new Date().toISOString(),
    appVersion: code.appVersion,
  };
}

const defined = <T extends object>(o: T): Partial<T> => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

/**
 * Two sheets for the same project and day as one: every site of both (a site scanned from its printed code joins the
 * day's sheet), each site asked only its own readings. `lead` is the one whose order, round and site details come
 * first: the computer's sheet when it's opened again for the day ('add' – its readings and observations decide for
 * its sites); the phone's own when a printed code adds to it ('old' – so a code can't rename what's there, and its
 * readings and observations are added).
 */
export function mergeSheets(old: FieldSheet, add: FieldSheet, lead: 'old' | 'add'): FieldSheet {
  const [first, second] = lead === 'old' ? [old, add] : [add, old];
  const own = (sh: FieldSheet, id: string) => {
    const s = sh.sites.find((x) => x.id === id);
    return s ? (s.measures ?? sh.measures.map((m) => m.id)) : [];
  };
  const ids = [...first.sites.map((s) => s.id), ...second.sites.filter((s) => !first.sites.some((x) => x.id === s.id)).map((s) => s.id)];
  // the computer's sheet opened again decides its own sites' readings; a printed code adds to a site's
  const wanted = new Map(ids.map((id) => [id, new Set(first.sites.some((s) => s.id === id) && lead === 'add' ? own(first, id) : [...own(first, id), ...own(second, id)])]));
  const used = new Set([...wanted.values()].flatMap((w) => [...w]));
  const measures = [...first.measures, ...second.measures.filter((m) => !first.measures.some((x) => x.id === m.id))].filter((m) => used.has(m.id));
  const sites = ids.map((id): FieldSite => {
    const a = first.sites.find((x) => x.id === id);
    const b = second.sites.find((x) => x.id === id);
    const mine = measures.filter((m) => wanted.get(id)!.has(m.id)).map((m) => m.id);
    const site = { ...defined(b ?? ({} as FieldSite)), ...defined(a ?? ({} as FieldSite)) } as FieldSite;
    delete site.measures;
    return mine.length < measures.length ? { ...site, measures: mine } : site;
  });
  const or = (k: keyof FieldSheet['observe']) => (lead === 'add' ? add.observe[k] : old.observe[k] || add.observe[k]);
  return { ...first, sites, measures, observe: { weather: or('weather'), flow: or('flow'), appearance: or('appearance'), photos: or('photos') } };
}

/** Metres between two places (on a sphere: near enough to tell the right site from the wrong one). */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** A field link read from a QR code: a sheet's or a printed code's, as the field-mode page to go to. */
export function fieldLinkPath(text: string): string | null {
  const m = /#\/field\/(open\?s|code\?k)=([A-Za-z0-9_-]+)\s*$/.exec(text.trim());
  return m ? `/field/${m[1]}=${m[2]}` : null;
}
