// Where and when a photo was taken, in the JPEG itself (EXIF): read from a camera's file, and written into a photo
// taken in field mode, so the location goes wherever the picture goes – Windows, Google Earth, GIS, a client's
// folder. A photo that has its camera's own location keeps it. Nothing else in the file is changed: the new GPS
// entries are added after what's there and the first directory re-pointed, so the camera's offsets all still hold.

export interface PhotoGps {
  lat: number;
  lng: number;
  /** Horizontal accuracy (m). */
  acc?: number;
}

export interface PhotoInfo {
  gps?: PhotoGps;
  /** When it was taken, by the camera's clock: 'YYYY-MM-DDTHH:mm:ss' (no time zone – the camera's local time). */
  taken?: string;
}

const isJpeg = (b: Uint8Array) => b.length > 4 && b[0] === 0xff && b[1] === 0xd8;

interface Segment {
  marker: number;
  /** Where the marker (FF xx) starts. */
  start: number;
  /** Where the segment's data starts (after the length). */
  data: number;
  /** Where the next segment starts. */
  end: number;
}

/** The segments before the image data (SOS). */
function segments(b: Uint8Array): Segment[] {
  const out: Segment[] = [];
  let o = 2;
  while (o + 4 <= b.length) {
    if (b[o] !== 0xff) break;
    let m = b[o + 1];
    let at = o;
    while (m === 0xff && at + 2 < b.length) {
      // fill bytes
      at++;
      m = b[at + 1];
    }
    if (m === 0xd9 || m === 0xda) break; // end of image, start of scan
    if (m >= 0xd0 && m <= 0xd7) {
      o = at + 2;
      continue;
    }
    const len = (b[at + 2] << 8) | b[at + 3];
    if (len < 2 || at + 2 + len > b.length) break;
    out.push({ marker: m, start: o, data: at + 4, end: at + 2 + len });
    o = at + 2 + len;
  }
  return out;
}

const EXIF_HEAD = [0x45, 0x78, 0x69, 0x66, 0, 0]; // "Exif\0\0"
const isExif = (b: Uint8Array, s: Segment) => s.marker === 0xe1 && s.end - s.data >= 14 && EXIF_HEAD.every((x, i) => b[s.data + i] === x);

/** A TIFF block (inside the APP1 segment) to read. */
class Tiff {
  readonly le: boolean;
  readonly view: DataView;
  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const order = String.fromCharCode(bytes[0], bytes[1]);
    if (order !== 'II' && order !== 'MM') throw new Error('not TIFF');
    this.le = order === 'II';
    if (this.u16(2) !== 42) throw new Error('not TIFF');
  }
  u16 = (o: number) => this.view.getUint16(o, this.le);
  u32 = (o: number) => this.view.getUint32(o, this.le);
  get ifd0(): number {
    return this.u32(4);
  }
  /** A directory's entries: [tag, type, count, value-or-offset field's position]. */
  entries(at: number): Array<{ tag: number; type: number; count: number; pos: number }> {
    if (at < 8 || at + 2 > this.bytes.length) return [];
    const n = this.u16(at);
    const out = [];
    for (let i = 0; i < n; i++) {
      const e = at + 2 + i * 12;
      if (e + 12 > this.bytes.length) break;
      out.push({ tag: this.u16(e), type: this.u16(e + 2), count: this.u32(e + 4), pos: e + 8 });
    }
    return out;
  }
  next(at: number): number {
    const n = this.u16(at);
    const p = at + 2 + n * 12;
    return p + 4 <= this.bytes.length ? this.u32(p) : 0;
  }
  /** Where an entry's value is: inline (4 bytes or less) or at its offset. */
  valueAt(e: { type: number; count: number; pos: number }): number {
    const size = (TYPE_SIZE[e.type] ?? 1) * e.count;
    return size <= 4 ? e.pos : this.u32(e.pos);
  }
  ascii(e: { type: number; count: number; pos: number }): string {
    const at = this.valueAt(e);
    let s = '';
    for (let i = 0; i < e.count && at + i < this.bytes.length && this.bytes[at + i]; i++) s += String.fromCharCode(this.bytes[at + i]);
    return s;
  }
  rationals(e: { type: number; count: number; pos: number }): number[] {
    const at = this.valueAt(e);
    const out: number[] = [];
    for (let i = 0; i < e.count && at + i * 8 + 8 <= this.bytes.length; i++) {
      const d = this.u32(at + i * 8 + 4);
      out.push(d ? this.u32(at + i * 8) / d : 0);
    }
    return out;
  }
}

/** Bytes per value, by TIFF type. */
const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
const TAG = { exifIfd: 0x8769, gpsIfd: 0x8825, dateTimeOriginal: 0x9003, latRef: 1, lat: 2, lngRef: 3, lng: 4 } as const;

function readGps(t: Tiff, at: number): PhotoGps | undefined {
  const es = t.entries(at);
  const get = (tag: number) => es.find((e) => e.tag === tag);
  const latE = get(TAG.lat), lngE = get(TAG.lng);
  if (!latE || !lngE || latE.type !== 5 || lngE.type !== 5) return undefined;
  const dms = (v: number[]) => (v[0] ?? 0) + (v[1] ?? 0) / 60 + (v[2] ?? 0) / 3600;
  let lat = dms(t.rationals(latE));
  let lng = dms(t.rationals(lngE));
  if (/^S/i.test(get(TAG.latRef) ? t.ascii(get(TAG.latRef)!) : '')) lat = -lat;
  if (/^W/i.test(get(TAG.lngRef) ? t.ascii(get(TAG.lngRef)!) : '')) lng = -lng;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return undefined;
  return { lat, lng };
}

/** The photo's location and time, where the camera recorded them. */
export function readPhotoInfo(bytes: Uint8Array): PhotoInfo {
  if (!isJpeg(bytes)) return {};
  for (const s of segments(bytes)) {
    if (!isExif(bytes, s)) continue;
    try {
      const t = new Tiff(bytes.subarray(s.data + 6, s.end));
      const ifd0 = t.entries(t.ifd0);
      const out: PhotoInfo = {};
      const gpsE = ifd0.find((e) => e.tag === TAG.gpsIfd);
      if (gpsE) out.gps = readGps(t, t.u32(gpsE.pos));
      const exifE = ifd0.find((e) => e.tag === TAG.exifIfd);
      const dto = exifE ? t.entries(t.u32(exifE.pos)).find((e) => e.tag === TAG.dateTimeOriginal) : undefined;
      const when = dto ? t.ascii(dto) : '';
      const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(when);
      if (m) out.taken = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
      return out;
    } catch {
      return {};
    }
  }
  return {};
}

// ------------------------------------------------------------ writing

/** Writes TIFF values in the block's byte order. */
class Writer {
  private parts: number[] = [];
  constructor(private readonly le: boolean) {}
  get length() {
    return this.parts.length;
  }
  u8(v: number) {
    this.parts.push(v & 0xff);
  }
  u16(v: number) {
    if (this.le) this.parts.push(v & 0xff, (v >> 8) & 0xff);
    else this.parts.push((v >> 8) & 0xff, v & 0xff);
  }
  u32(v: number) {
    const b = [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
    this.parts.push(...(this.le ? b.reverse() : b));
  }
  raw(b: ArrayLike<number>) {
    for (let i = 0; i < b.length; i++) this.parts.push(b[i]);
  }
  pad() {
    if (this.parts.length % 2) this.parts.push(0);
  }
  bytes(): Uint8Array {
    return Uint8Array.from(this.parts);
  }
}

interface Entry {
  tag: number;
  type: number;
  count: number;
  /** Inline (4 bytes, already in the block's order) or data written after the directory. */
  inline?: number[];
  data?: (w: Writer) => void;
}

const ascii = (s: string) => Array.from(s + '\0', (c) => c.charCodeAt(0) & 0x7f);

/** Degrees as degrees, minutes and seconds (to 1/10 000 of a second – a few millimetres). */
function dms(v: number): Array<[number, number]> {
  const a = Math.abs(v);
  const d = Math.floor(a);
  const mFull = (a - d) * 60;
  const m = Math.floor(mFull);
  const s = Math.round((mFull - m) * 60 * 10000);
  return [
    [d, 1],
    [m, 1],
    [s, 10000],
  ];
}

/** The GPS directory's entries for a place (and time, UTC). */
function gpsEntries(le: boolean, gps: PhotoGps, at?: Date): Entry[] {
  const inline = (vals: number[]) => {
    const w = new Writer(le);
    vals.forEach((v) => w.u8(v));
    while (w.length < 4) w.u8(0);
    return Array.from(w.bytes());
  };
  const rationals = (vals: Array<[number, number]>) => (w: Writer) => vals.forEach(([n, d]) => (w.u32(n), w.u32(d)));
  const out: Entry[] = [
    { tag: 0x0000, type: 1, count: 4, inline: [2, 3, 0, 0] },
    { tag: 0x0001, type: 2, count: 2, inline: inline(ascii(gps.lat < 0 ? 'S' : 'N')) },
    { tag: 0x0002, type: 5, count: 3, data: rationals(dms(gps.lat)) },
    { tag: 0x0003, type: 2, count: 2, inline: inline(ascii(gps.lng < 0 ? 'W' : 'E')) },
    { tag: 0x0004, type: 5, count: 3, data: rationals(dms(gps.lng)) },
  ];
  if (at && !Number.isNaN(at.getTime())) {
    out.push({ tag: 0x0007, type: 5, count: 3, data: rationals([[at.getUTCHours(), 1], [at.getUTCMinutes(), 1], [at.getUTCSeconds(), 1]]) });
  }
  out.push({ tag: 0x0012, type: 2, count: 7, data: (w) => w.raw(ascii('WGS-84')) });
  if (at && !Number.isNaN(at.getTime())) {
    const p = (n: number) => String(n).padStart(2, '0');
    out.push({ tag: 0x001d, type: 2, count: 11, data: (w) => w.raw(ascii(`${at.getUTCFullYear()}:${p(at.getUTCMonth() + 1)}:${p(at.getUTCDate())}`)) });
  }
  if (gps.acc !== undefined && Number.isFinite(gps.acc) && gps.acc >= 0) out.push({ tag: 0x001f, type: 5, count: 1, data: rationals([[Math.round(gps.acc * 100), 100]]) });
  return out;
}

/**
 * Writes a directory at the writer's position (block offset `base` + position): its entries, the next-directory
 * offset, then the data of entries too big to sit inline.
 */
function writeIfd(w: Writer, base: number, entries: Entry[], next: number) {
  const sorted = [...entries].sort((a, b) => a.tag - b.tag);
  const start = base + w.length;
  let dataAt = start + 2 + sorted.length * 12 + 4;
  const later: Array<(w: Writer) => void> = [];
  w.u16(sorted.length);
  for (const e of sorted) {
    w.u16(e.tag);
    w.u16(e.type);
    w.u32(e.count);
    if (e.inline) w.raw(e.inline.slice(0, 4));
    else if (e.data) {
      const size = (TYPE_SIZE[e.type] ?? 1) * e.count;
      w.u32(dataAt);
      later.push(e.data);
      dataAt += size + (size % 2);
    }
  }
  w.u32(next);
  for (const d of later) {
    d(w);
    w.pad();
  }
}

/**
 * The photo with its location written in (and the time, as GPS time). Unchanged when it isn't a JPEG, already has a
 * location, or there's no room (an APP1 segment holds 64 KB).
 */
export function withPhotoGps(bytes: Uint8Array, gps: PhotoGps, at?: Date | string): Uint8Array {
  if (!isJpeg(bytes) || !Number.isFinite(gps.lat) || !Number.isFinite(gps.lng) || Math.abs(gps.lat) > 90 || Math.abs(gps.lng) > 180) return bytes;
  const when = at === undefined ? undefined : typeof at === 'string' ? new Date(at) : at;
  const segs = segments(bytes);
  const app1 = segs.find((s) => isExif(bytes, s));
  let tiff: Uint8Array;
  if (!app1) {
    // a new block: IFD0 holding only the pointer to the GPS directory
    const w = new Writer(true);
    w.raw([0x49, 0x49, 42, 0]);
    w.u32(8);
    const gpsAt = 8 + 2 + 12 + 4;
    writeIfd(w, 0, [{ tag: TAG.gpsIfd, type: 4, count: 1, inline: le32(gpsAt, true) }], 0);
    writeIfd(w, 0, gpsEntries(true, gps, when), 0);
    tiff = w.bytes();
  } else {
    let t: Tiff;
    try {
      t = new Tiff(bytes.subarray(app1.data + 6, app1.end));
    } catch {
      return bytes;
    }
    const ifd0 = t.entries(t.ifd0);
    const had = ifd0.find((e) => e.tag === TAG.gpsIfd);
    if (had && readGps(t, t.u32(had.pos))) return bytes; // the camera's own location stays
    // the old block as it is, then a new IFD0 (its entries and the GPS pointer) and the GPS directory after it
    const old = t.bytes;
    const w = new Writer(t.le);
    w.raw(old);
    w.pad();
    const newIfd0 = w.length;
    const kept: Entry[] = ifd0.filter((e) => e.tag !== TAG.gpsIfd).map((e) => ({ tag: e.tag, type: e.type, count: e.count, inline: Array.from(old.subarray(e.pos, e.pos + 4)) }));
    const gpsAt = newIfd0 + 2 + (kept.length + 1) * 12 + 4;
    writeIfd(w, 0, [...kept, { tag: TAG.gpsIfd, type: 4, count: 1, inline: le32(gpsAt, t.le) }], t.next(t.ifd0));
    writeIfd(w, 0, gpsEntries(t.le, gps, when), 0);
    tiff = w.bytes();
    // the header now points at the new IFD0
    const head = le32(newIfd0, t.le);
    tiff.set(head, 4);
  }
  const payload = 6 + tiff.length;
  if (payload + 2 > 0xffff) return bytes;
  const seg = new Uint8Array(4 + payload);
  seg.set([0xff, 0xe1, ((payload + 2) >> 8) & 0xff, (payload + 2) & 0xff]);
  seg.set(EXIF_HEAD, 4);
  seg.set(tiff, 10);
  // replacing the camera's segment, or after the JFIF header (or straight after the start)
  const from = app1 ? app1.start : segs[0]?.marker === 0xe0 ? segs[0].end : 2;
  const to = app1 ? app1.end : from;
  const out = new Uint8Array(bytes.length - (to - from) + seg.length);
  out.set(bytes.subarray(0, from));
  out.set(seg, from);
  out.set(bytes.subarray(to), from + seg.length);
  return out;
}

function le32(v: number, le: boolean): number[] {
  const b = [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
  return le ? b.reverse() : b;
}
