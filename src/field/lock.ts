// The team key: an optional lock on what goes between the computer and the team's phones – field sheets' links and
// files, printed field codes and the phones' results files. Locked (AES-256-GCM), they open only on a computer of the
// workspace and on phones set up for the team; anyone else who scans a code learns nothing from it, and a code that
// opens came from the team. Off unless the team turns it on.
//
// A locked piece: [version][key id: 5 bytes][iv: 12 bytes][ciphertext and its 16-byte tag], the first 18 bytes also
// bound into the tag with what the piece is (a sheet, a code, results), so one can't pass for another.

const VERSION = 1;
const ID_BYTES = 5;
const IV_BYTES = 12;
const HEAD = 1 + ID_BYTES + IV_BYTES;

export interface TeamKey {
  /** Its fingerprint: 8 letters and digits, from the key itself. */
  id: string;
  /** The key: 32 random bytes, base64url. */
  key: string;
  /** When it was made (ISO). */
  made: string;
}

/** What a locked piece is. */
export type LockedKind = 'sheet' | 'code' | 'results';

// ------------------------------------------------------------ text for links and QR codes

export function b64url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function fromB64url(t: string): Uint8Array {
  const s = atob(t.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
/** Capitals and digits: a QR code holds them in fewer squares than other text. */
export function toBase32(bytes: Uint8Array): string {
  let out = '', bits = 0, value = 0;
  for (const b of bytes) {
    value = ((value << 8) | b) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function fromBase32(text: string, what = 'This isn’t an EnviroDB field code.'): Uint8Array {
  const out: number[] = [];
  let bits = 0, value = 0;
  for (const ch of text) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error(what);
    value = ((value << 5) | i) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

// ------------------------------------------------------------ keys

const subtle = () => {
  if (!globalThis.crypto?.subtle) throw new Error('This browser can’t lock or open field codes here (it needs a secure https:// page).');
  return globalThis.crypto.subtle;
};

async function fingerprint(raw: Uint8Array): Promise<string> {
  const label = new TextEncoder().encode('EnviroDB team key\u0000');
  const all = new Uint8Array(label.length + raw.length);
  all.set(label);
  all.set(raw, label.length);
  return toBase32(new Uint8Array(await subtle().digest('SHA-256', all)).subarray(0, ID_BYTES));
}

/** A new team key. */
export async function newTeamKey(): Promise<TeamKey> {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  return { id: await fingerprint(raw), key: b64url(raw), made: new Date().toISOString() };
}

/** A key's fingerprint as people read it out: "K7QD-2XAM". */
export const showKeyId = (id: string) => `${id.slice(0, 4)}-${id.slice(4)}`;

const imported = new Map<string, Promise<CryptoKey>>();
function cryptoKey(k: TeamKey): Promise<CryptoKey> {
  let p = imported.get(k.key);
  if (!p) {
    const raw = fromB64url(k.key);
    if (raw.length !== 32) throw new Error('The team key is damaged.');
    p = subtle().importKey('raw', raw as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
    imported.set(k.key, p);
  }
  return p;
}

const kindBytes = (kind: LockedKind) => new TextEncoder().encode(`EnviroDB field ${kind}`);
const aad = (head: Uint8Array, kind: LockedKind) => {
  const k = kindBytes(kind);
  const out = new Uint8Array(k.length + head.length);
  out.set(k);
  out.set(head, k.length);
  return out;
};

/** Locked with the key: only a holder of the key can read it, or change it unnoticed. */
export async function lock(bytes: Uint8Array, key: TeamKey, kind: LockedKind): Promise<Uint8Array> {
  const head = new Uint8Array(HEAD);
  head[0] = VERSION;
  head.set(fromBase32(key.id).subarray(0, ID_BYTES), 1);
  head.set(crypto.getRandomValues(new Uint8Array(IV_BYTES)), 1 + ID_BYTES);
  const sealed = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: head.subarray(1 + ID_BYTES) as BufferSource, additionalData: aad(head, kind) as BufferSource }, await cryptoKey(key), bytes as BufferSource));
  const out = new Uint8Array(HEAD + sealed.length);
  out.set(head);
  out.set(sealed, HEAD);
  return out;
}

/** Why a locked piece didn't open. */
export class LockedError extends Error {
  constructor(
    message: string,
    /** 'no-key': this device has no key for it (not set up, or set up before a new key); 'damaged': it's been changed. */
    readonly reason: 'no-key' | 'damaged',
    /** The fingerprint of the key it was locked with. */
    readonly keyId: string,
  ) {
    super(message);
  }
}

/** The key a locked piece needs (its fingerprint). */
export function lockedWith(bytes: Uint8Array): string {
  if (bytes.length < HEAD + 16 || bytes[0] !== VERSION) throw new LockedError('It isn’t locked the way EnviroDB locks things.', 'damaged', '');
  return toBase32(bytes.subarray(1, 1 + ID_BYTES));
}

/** A locked piece opened with whichever of the keys it was locked with. */
export async function unlock(bytes: Uint8Array, keys: TeamKey[], kind: LockedKind): Promise<Uint8Array> {
  const id = lockedWith(bytes);
  const key = keys.find((k) => k.id === id);
  if (!key) throw new LockedError(`It’s locked with a team key (${showKeyId(id)}) this device doesn’t have.`, 'no-key', id);
  const head = bytes.subarray(0, HEAD);
  try {
    return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: head.subarray(1 + ID_BYTES) as BufferSource, additionalData: aad(head, kind) as BufferSource }, await cryptoKey(key), bytes.subarray(HEAD) as BufferSource));
  } catch {
    throw new LockedError('It didn’t open with the team key – it’s been changed or damaged.', 'damaged', id);
  }
}

// ------------------------------------------------------------ setting up a phone

/**
 * Before the keys in the code that sets up a phone. Not a link – only EnviroDB's own scanner reads it – and with
 * small letters, so it's never taken for one of the phone link's codes (capitals, digits and a few marks).
 */
const SETUP = 'EnviroDB-team-key-1/';
const MAX_KEYS = 6;

/** The text for the code that sets up a phone: the team's keys, newest first. */
export function setupText(keys: TeamKey[]): string {
  const ks = keys.slice(0, MAX_KEYS);
  const all = new Uint8Array(32 * ks.length);
  ks.forEach((k, i) => all.set(fromB64url(k.key), 32 * i));
  return SETUP + toBase32(all);
}

export const isSetupText = (text: string) => text.trim().startsWith(SETUP);

/** The keys in a phone's set-up code, newest first. */
export async function readSetupText(text: string): Promise<TeamKey[]> {
  const t = text.trim();
  if (!t.startsWith(SETUP)) throw new Error('This isn’t an EnviroDB team key.');
  const all = fromBase32(t.slice(SETUP.length), 'This team key code is damaged.');
  if (!all.length || all.length % 32 || all.length > 32 * MAX_KEYS) throw new Error('This team key code is damaged.');
  const made = new Date().toISOString();
  const out: TeamKey[] = [];
  for (let i = 0; i < all.length; i += 32) {
    const raw = all.slice(i, i + 32);
    out.push({ id: await fingerprint(raw), key: b64url(raw), made });
  }
  return out;
}

/** Keys added to the ones kept: the new ones first, each once, at most a handful. */
export function mergeKeys(newer: TeamKey[], kept: TeamKey[]): TeamKey[] {
  const out: TeamKey[] = [];
  for (const k of [...newer, ...kept]) if (!out.some((x) => x.id === k.id)) out.push(k);
  return out.slice(0, MAX_KEYS);
}

/** Keys kept as text (on the phone): checked, since anything could be stored there. */
export function parseKeys(text: string): TeamKey[] {
  try {
    const raw = JSON.parse(text) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((k): k is TeamKey => !!k && typeof k.id === 'string' && /^[A-Z2-7]{8}$/.test(k.id) && typeof k.key === 'string' && /^[A-Za-z0-9_-]{43}$/.test(k.key))
      .map((k) => ({ id: k.id, key: k.key, made: typeof k.made === 'string' ? k.made : '' }))
      .slice(0, MAX_KEYS);
  } catch {
    return [];
  }
}
