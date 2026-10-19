// What the phone sends the computer over the link (Wi-Fi or QR codes): the readings, then the photos – each sealed
// with the key the phone read from the computer's screen (AES-GCM), so only that computer can open it, and any change
// on the way stops it opening.

import { fromBase64, gunzip, gzip, toBase64 } from '../../lib/issued';
import { checkResults, type FieldResults } from '../model';

/** The two things sent: the readings (small, first) and the photos. */
export const STREAM = { readings: 0, photos: 1 } as const;

export async function newKey(): Promise<Uint8Array> {
  return crypto.getRandomValues(new Uint8Array(32));
}

const importKey = (raw: Uint8Array) => crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
const aad = (session: number, stream: number) => {
  const a = new Uint8Array(5);
  new DataView(a.buffer).setUint32(0, session >>> 0);
  a[4] = stream;
  return a;
};

/** Sealed: a fresh 12-byte nonce, then the encrypted data with its check. */
export async function seal(raw: Uint8Array, session: number, stream: number, data: Uint8Array): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(session, stream) }, await importKey(raw), data as BufferSource));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return out;
}

export async function unseal(raw: Uint8Array, session: number, stream: number, sealed: Uint8Array): Promise<Uint8Array> {
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: sealed.slice(0, 12), additionalData: aad(session, stream) }, await importKey(raw), sealed.slice(12)));
  } catch {
    throw new Error('The results didn’t open: they weren’t sent for this code, or were changed on the way.');
  }
}

// ------------------------------------------------------------ the readings

/** The results without their photos (they follow on their own), compressed. */
export async function readingsBytes(results: FieldResults): Promise<Uint8Array> {
  const bare = { ...results, visits: results.visits.map(({ photos, ...v }) => ({ ...v, photoCount: photos?.length ?? 0 })) };
  return gzip(JSON.stringify(bare));
}

export async function readReadings(bytes: Uint8Array): Promise<{ results: FieldResults; photos: number }> {
  const raw = JSON.parse(await gunzip(bytes));
  const photos = Array.isArray(raw?.visits) ? raw.visits.reduce((n: number, v: { photoCount?: unknown }) => n + (typeof v?.photoCount === 'number' ? v.photoCount : 0), 0) : 0;
  return { results: checkResults(raw), photos };
}

// ------------------------------------------------------------ the photos

export interface LinkPhoto {
  siteId: string;
  name: string;
  /** image/jpeg, image/png or image/webp */
  type: string;
  bytes: Uint8Array;
}

const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function photosOf(results: FieldResults): LinkPhoto[] {
  return results.visits.flatMap((v) =>
    (v.photos ?? []).flatMap((p) => {
      const m = /^data:(image\/(?:jpeg|png|webp));base64,(.*)$/.exec(p.dataUrl);
      return m ? [{ siteId: v.siteId, name: p.name, type: m[1], bytes: fromBase64(m[2]) }] : [];
    }),
  );
}

const enc = new TextEncoder();
const dec = new TextDecoder();

/** [count ×2] then for each: [site][name][type] (each [length ×2][text]) and [length ×4][bytes]. */
export function packPhotos(list: LinkPhoto[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const head = new Uint8Array(2);
  new DataView(head.buffer).setUint16(0, list.length);
  parts.push(head);
  for (const p of list) {
    for (const s of [p.siteId, p.name, p.type]) {
      const t = enc.encode(s.slice(0, 200));
      const l = new Uint8Array(2);
      new DataView(l.buffer).setUint16(0, t.length);
      parts.push(l, t);
    }
    const l = new Uint8Array(4);
    new DataView(l.buffer).setUint32(0, p.bytes.length);
    parts.push(l, p.bytes);
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function unpackPhotos(bytes: Uint8Array): LinkPhoto[] {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 0;
  const need = (n: number) => {
    if (o + n > bytes.length) throw new Error('The photos arrived incomplete.');
  };
  need(2);
  const count = v.getUint16(0);
  o = 2;
  const out: LinkPhoto[] = [];
  for (let i = 0; i < count; i++) {
    const text = () => {
      need(2);
      const n = v.getUint16(o);
      o += 2;
      need(n);
      const s = dec.decode(bytes.subarray(o, o + n));
      o += n;
      return s;
    };
    const siteId = text();
    const name = text();
    const type = text();
    need(4);
    const n = v.getUint32(o);
    o += 4;
    need(n);
    const data = bytes.slice(o, o + n);
    o += n;
    if (PHOTO_TYPES.has(type)) out.push({ siteId, name, type, bytes: data });
  }
  return out;
}

/** The results with their photos back in place. */
export function withPhotos(results: FieldResults, photos: LinkPhoto[]): FieldResults {
  return checkResults({
    ...results,
    visits: results.visits.map((v) => {
      const mine = photos.filter((p) => p.siteId === v.siteId);
      return mine.length ? { ...v, photos: mine.map((p) => ({ name: p.name, dataUrl: `data:${p.type};base64,${toBase64(p.bytes)}` })) } : v;
    }),
  });
}
