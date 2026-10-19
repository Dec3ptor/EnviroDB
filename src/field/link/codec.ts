// Sending data from the phone to the computer through QR codes the computer's camera reads.
//
// - Base45 (RFC 9285) turns bytes into the letters a QR code holds most densely ("alphanumeric" mode) – and that every
//   QR reader returns unchanged.
// - A fountain code (Luby transform): the data is cut into K blocks; the phone shows the K blocks in turn, then an
//   endless run of frames that each mix a few blocks together. The computer can rebuild the data from any K or so
//   frames it catches, whichever they are – frames the camera misses don't need to come round again.

// ------------------------------------------------------------ base45

const B45 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
const B45_AT = new Map([...B45].map((c, i) => [c, i]));

export function toBase45(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    let n = bytes[i] * 256 + bytes[i + 1];
    const c = n % 45;
    n = (n - c) / 45;
    const d = n % 45;
    out += B45[c] + B45[d] + B45[(n - d) / 45];
  }
  if (bytes.length % 2) {
    const n = bytes[bytes.length - 1];
    out += B45[n % 45] + B45[Math.floor(n / 45)];
  }
  return out;
}

export function fromBase45(text: string): Uint8Array {
  const out = new Uint8Array(Math.floor(text.length / 3) * 2 + (text.length % 3 === 2 ? 1 : 0));
  let o = 0;
  for (let i = 0; i < text.length; i += 3) {
    const v = [...text.slice(i, i + 3)].map((ch) => {
      const x = B45_AT.get(ch);
      if (x === undefined) throw new Error('Not a code from EnviroDB.');
      return x;
    });
    if (v.length === 3) {
      const n = v[0] + v[1] * 45 + v[2] * 2025;
      if (n > 0xffff) throw new Error('Not a code from EnviroDB.');
      out[o++] = n >> 8;
      out[o++] = n & 0xff;
    } else if (v.length === 2) {
      const n = v[0] + v[1] * 45;
      if (n > 0xff) throw new Error('Not a code from EnviroDB.');
      out[o++] = n;
    } else throw new Error('Not a code from EnviroDB.');
  }
  return out;
}

/** Bytes that fit in a QR code holding this many letters. */
export const bytesIn = (letters: number) => Math.floor(letters / 3) * 2 + (letters % 3 === 2 ? 1 : 0);

// ------------------------------------------------------------ the fountain code

/** A small, repeatable random number generator (mulberry32): the phone and computer pick the same blocks. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** How many blocks a mixed frame holds: enough that every block turns up in a few of the frames caught. */
const mixOf = (K: number) => Math.min(K, Math.max(3, Math.ceil(2 * Math.log(K)) + 8));

/** The blocks frame number i holds: block i for the first K frames, then a mix chosen by the frame number. */
export function blocksOf(i: number, K: number): number[] {
  if (i < K) return [i];
  const next = random(Math.imul(i, 2654435761) ^ (K << 7));
  const d = mixOf(K);
  const picked = new Set<number>();
  while (picked.size < d) picked.add(Math.floor(next() * K));
  return [...picked];
}

/** Bytes as 32-bit words (zero-padded), for quick mixing. */
const words = (b: Uint8Array, n: number) => {
  const w = new Uint32Array(n);
  new Uint8Array(w.buffer).set(b.subarray(0, n * 4));
  return w;
};
const xorWords = (a: Uint32Array, b: Uint32Array) => {
  for (let i = 0; i < a.length; i++) a[i] ^= b[i];
};

export class FountainEncoder {
  readonly K: number;
  private readonly blocks: Uint32Array[];
  private readonly n: number;
  constructor(
    readonly data: Uint8Array,
    readonly blockSize: number,
  ) {
    this.K = Math.max(1, Math.ceil(data.length / blockSize));
    this.n = Math.ceil(blockSize / 4);
    this.blocks = Array.from({ length: this.K }, (_, k) => words(data.subarray(k * blockSize, (k + 1) * blockSize), this.n));
  }
  /** Frame number i's payload. */
  frame(i: number): Uint8Array {
    const out = new Uint32Array(this.n);
    for (const b of blocksOf(i, this.K)) xorWords(out, this.blocks[b]);
    return new Uint8Array(out.buffer, 0, this.blockSize).slice();
  }
}

/**
 * Rebuilds the data by solving the frames as equations (Gaussian elimination over bits), so every frame caught that
 * adds anything new counts: K frames' worth of new information, and it's done.
 */
export class FountainDecoder {
  /** Rows by their first block: which blocks they mix (bits), and their data. */
  private readonly rows: Array<{ mix: Uint32Array; data: Uint32Array } | null>;
  private rank = 0;
  private readonly seen = new Set<number>();
  private readonly mixWords: number;
  private readonly dataWords: number;
  private out: Uint8Array | null = null;
  constructor(
    readonly K: number,
    readonly blockSize: number,
    readonly length: number,
  ) {
    this.rows = new Array(K).fill(null);
    this.mixWords = Math.ceil(K / 32);
    this.dataWords = Math.ceil(blockSize / 4);
  }
  get solved() {
    return this.rank;
  }
  get done() {
    return this.rank === this.K;
  }
  get framesSeen() {
    return this.seen.size;
  }
  /** Adds frame number i; true once everything is rebuilt. */
  add(i: number, payload: Uint8Array): boolean {
    if (this.done || this.seen.has(i) || payload.length !== this.blockSize) return this.done;
    this.seen.add(i);
    const mix = new Uint32Array(this.mixWords);
    for (const b of blocksOf(i, this.K)) mix[b >>> 5] ^= 1 << (b & 31);
    const data = words(payload, this.dataWords);
    // take away what's already known, lowest block first
    for (let w = 0; w < this.mixWords; w++) {
      while (mix[w]) {
        const bit = 31 - Math.clz32(mix[w] & -mix[w]);
        const b = (w << 5) | bit;
        const row = this.rows[b];
        if (!row) {
          this.rows[b] = { mix, data };
          this.rank++;
          return this.done;
        }
        xorWords(mix, row.mix);
        xorWords(data, row.data);
      }
    }
    return this.done; // nothing new
  }
  /** The data, once done. */
  result(): Uint8Array {
    if (!this.done) throw new Error('Not all of it has arrived yet.');
    if (this.out) return this.out;
    // back-substitution: from the last block down, clear every other block out of each row
    for (let b = this.K - 1; b >= 0; b--) {
      const row = this.rows[b]!;
      for (let w = b >>> 5; w < this.mixWords; w++) {
        let m = w === b >>> 5 ? row.mix[w] & ~((2 << (b & 31)) - 1) : row.mix[w];
        while (m) {
          const bit = 31 - Math.clz32(m & -m);
          m &= m - 1;
          const other = this.rows[(w << 5) | bit]!;
          xorWords(row.data, other.data);
        }
      }
    }
    const out = new Uint8Array(this.K * this.blockSize);
    this.rows.forEach((r, k) => out.set(new Uint8Array(r!.data.buffer, 0, this.blockSize), k * this.blockSize));
    return (this.out = out.slice(0, this.length));
  }
}

// ------------------------------------------------------------ what each QR code holds

/** The first byte of every code: what kind it is. */
export const CODE = { offer: 1, answer: 2, frame: 3 } as const;

/** A frame of a stream: [3][session ×4][stream][K ×2][length ×4][number ×4] then the payload. */
export const FRAME_HEAD = 16;

export interface Frame {
  session: number;
  stream: number;
  K: number;
  length: number;
  index: number;
  payload: Uint8Array;
}

export function packFrame(f: Omit<Frame, 'payload'>, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(FRAME_HEAD + payload.length);
  const v = new DataView(out.buffer);
  out[0] = CODE.frame;
  v.setUint32(1, f.session >>> 0);
  out[5] = f.stream;
  v.setUint16(6, f.K);
  v.setUint32(8, f.length);
  v.setUint32(12, f.index);
  out.set(payload, FRAME_HEAD);
  return out;
}

export function readFrame(bytes: Uint8Array): Frame | null {
  if (bytes.length <= FRAME_HEAD || bytes[0] !== CODE.frame) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { session: v.getUint32(1), stream: bytes[5], K: v.getUint16(6), length: v.getUint32(8), index: v.getUint32(12), payload: bytes.subarray(FRAME_HEAD) };
}

/** Rebuilds the streams a phone sends, from whichever frames the camera catches. */
export class StreamReceiver {
  private readonly decoders = new Map<number, FountainDecoder>();
  constructor(readonly session: number) {}
  /** Adds a frame; the stream number when that stream has just been rebuilt. */
  add(f: Frame): number | null {
    if (f.session !== this.session || !f.K) return null;
    let d = this.decoders.get(f.stream);
    if (!d || d.K !== f.K || d.length !== f.length || d.blockSize !== f.payload.length) {
      // a different sending (the phone started again with other data): start this stream again
      d = new FountainDecoder(f.K, f.payload.length, f.length);
      this.decoders.set(f.stream, d);
    }
    if (d.done) return null;
    return d.add(f.index, f.payload) ? f.stream : null;
  }
  progress(stream: number): { solved: number; K: number; frames: number } | null {
    const d = this.decoders.get(stream);
    return d ? { solved: d.solved, K: d.K, frames: d.framesSeen } : null;
  }
  result(stream: number): Uint8Array | null {
    const d = this.decoders.get(stream);
    return d?.done ? d.result() : null;
  }
}
