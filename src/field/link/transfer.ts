// Sending the results across: over the Wi-Fi link when it connects, otherwise as a stream of QR codes the computer's
// camera reads. Both carry the same sealed readings and photos; the readings go first so they arrive within a second.

import { FountainEncoder, FRAME_HEAD, bytesIn, packFrame, readFrame, StreamReceiver, CODE } from './codec';
import { STREAM, packPhotos, photosOf, readReadings, readingsBytes, seal, unpackPhotos, unseal, withPhotos, type LinkPhoto } from './payload';
import { sendBytes } from './rtc';
import type { FieldResults } from '../model';

/** QR code sizes for the stream: a bigger code holds more but needs the phone closer or a sharper camera. */
export const CODE_SIZES = {
  small: { version: 10, letters: 395 },
  medium: { version: 15, letters: 758 },
  large: { version: 20, letters: 1249 },
} as const;
export type CodeSize = keyof typeof CODE_SIZES;

/** The data each frame carries at a size. */
export const blockSizeFor = (size: CodeSize) => bytesIn(CODE_SIZES[size].letters) - FRAME_HEAD;

/** Sealed, ready to send. */
export interface Outgoing {
  session: number;
  readings: Uint8Array;
  /** null: no photos. */
  photos: Uint8Array | null;
  photoCount: number;
}

export async function prepare(results: FieldResults, session: number, key: Uint8Array, photos: LinkPhoto[] = photosOf(results)): Promise<Outgoing> {
  return {
    session,
    readings: await seal(key, session, STREAM.readings, await readingsBytes(results)),
    photos: photos.length ? await seal(key, session, STREAM.photos, packPhotos(photos)) : null,
    photoCount: photos.length,
  };
}

// ------------------------------------------------------------ the QR stream (the phone)

/**
 * What the phone shows, frame by frame: the readings several times over first, then mostly photos – with the readings
 * now and then (in case the camera missed them) and the phone's reply code, so the computer can still try the Wi-Fi
 * link.
 */
export class FrameSchedule {
  private t = 0;
  private a = 0;
  private b = 0;
  readonly readings: FountainEncoder;
  readonly photos: FountainEncoder | null;
  private readonly first: number;
  constructor(
    readonly out: Outgoing,
    readonly size: CodeSize,
    private readonly answer: Uint8Array | null,
  ) {
    const block = blockSizeFor(size);
    this.readings = new FountainEncoder(out.readings, block);
    this.photos = out.photos ? new FountainEncoder(out.photos, block) : null;
    this.first = this.readings.K * 2 + 4;
  }
  /** Frames the computer needs at least, about (to estimate the time). */
  get needed(): number {
    return Math.ceil((this.readings.K + (this.photos?.K ?? 0)) * 1.1);
  }
  /** How many photo frames have been shown. */
  get photoFrames(): number {
    return this.b;
  }
  next(): Uint8Array {
    const t = this.t++;
    const slot = t % 20;
    if (t >= this.first && slot === 0 && this.answer) return this.answer;
    if (t < this.first || !this.photos || slot === 1 || slot === 11) return this.frame(STREAM.readings, this.readings, this.a++);
    return this.frame(STREAM.photos, this.photos, this.b++);
  }
  private frame(stream: number, e: FountainEncoder, index: number): Uint8Array {
    const data = stream === STREAM.readings ? this.out.readings : this.out.photos!;
    return packFrame({ session: this.out.session, stream, K: e.K, length: data.length, index }, e.frame(index));
  }
}

// ------------------------------------------------------------ the Wi-Fi link (the phone)

/** Sends over the link; resolves when the computer says it has everything. */
export async function sendOverLink(channel: RTCDataChannel, out: Outgoing, onProgress?: (fraction: number) => void): Promise<void> {
  const total = out.readings.length + (out.photos?.length ?? 0);
  const done = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The computer didn’t confirm it got the results.')), 120_000);
    channel.addEventListener('message', (e) => {
      try {
        const m = typeof e.data === 'string' ? JSON.parse(e.data) : null;
        if (m?.t === 'done') {
          clearTimeout(timer);
          resolve();
        } else if (m?.t === 'error') {
          clearTimeout(timer);
          reject(new Error(String(m.message ?? 'The computer couldn’t open the results.')));
        }
      } catch {
        /* not ours */
      }
    });
    channel.addEventListener('close', () => reject(new Error('The link closed.')), { once: true });
  });
  channel.send(JSON.stringify({ t: 'hello', session: out.session, sizes: [out.readings.length, out.photos?.length ?? 0] }));
  await sendBytes(channel, out.readings, (n) => onProgress?.(n / total));
  if (out.photos) await sendBytes(channel, out.photos, (n) => onProgress?.((out.readings.length + n) / total));
  await done;
}

// ------------------------------------------------------------ the computer: receiving either way

export interface Received {
  results: FieldResults;
  /** Photos the phone said it has, and whether they've arrived. */
  photoCount: number;
  photos: LinkPhoto[] | null;
}

/** Puts together what arrives – by link or by camera – and opens it with the key. */
export class Receiver {
  readonly stream: StreamReceiver;
  private readings: { results: FieldResults; photos: number } | null = null;
  private photos: LinkPhoto[] | null = null;
  private sizes: [number, number] | null = null;
  private buffer: Uint8Array | null = null;
  private filled = 0;
  constructor(
    readonly session: number,
    private readonly key: Uint8Array,
    private readonly onChange: (r: Received | null, how: { via: 'link' | 'camera'; error?: string }) => void,
  ) {
    this.stream = new StreamReceiver(session);
  }

  get received(): Received | null {
    return this.readings ? { results: this.photos ? withPhotos(this.readings.results, this.photos) : this.readings.results, photoCount: this.readings.photos, photos: this.photos } : null;
  }
  get complete(): boolean {
    return !!this.readings && (this.readings.photos === 0 || !!this.photos);
  }

  /**
   * A QR code the camera read (its bytes): 'answer' for the phone's reply code, 'frame' for part of the results,
   * 'other' for a code made for another receiving (the phone scanned an older code).
   */
  async code(bytes: Uint8Array): Promise<'answer' | 'frame' | 'other' | null> {
    if (bytes[0] === CODE.answer) return bytes.length > 4 && new DataView(bytes.buffer, bytes.byteOffset).getUint32(1) === this.session >>> 0 ? 'answer' : 'other';
    const f = readFrame(bytes);
    if (!f) return null;
    if (f.session !== this.session >>> 0) return 'other';
    const stream = this.stream.add(f);
    if (stream !== null) await this.opened(stream, this.stream.result(stream)!, 'camera');
    else this.onChange(this.received, { via: 'camera' });
    return 'frame';
  }

  /** A message over the link. Returns a reply to send, if any. */
  async message(data: string | ArrayBuffer): Promise<string | null> {
    if (typeof data === 'string') {
      const m = JSON.parse(data);
      if (m?.t !== 'hello' || m.session !== this.session || !Array.isArray(m.sizes)) return JSON.stringify({ t: 'error', message: 'This isn’t the computer the phone scanned.' });
      const [a, b] = m.sizes.map((n: unknown) => Math.max(0, Math.min(Number(n) || 0, 512 * 1024 * 1024)));
      this.sizes = [a, b];
      this.buffer = new Uint8Array(a + b);
      this.filled = 0;
      return null;
    }
    if (!this.buffer || !this.sizes) return null;
    const piece = new Uint8Array(data);
    const room = Math.min(piece.length, this.buffer.length - this.filled);
    this.buffer.set(piece.subarray(0, room), this.filled);
    const before = this.filled;
    this.filled += room;
    const [a, b] = this.sizes;
    try {
      if (before < a && this.filled >= a) await this.opened(STREAM.readings, this.buffer.slice(0, a), 'link');
      if (b && before < a + b && this.filled >= a + b) await this.opened(STREAM.photos, this.buffer.slice(a, a + b), 'link');
      this.onChange(this.received, { via: 'link' });
    } catch (e) {
      return JSON.stringify({ t: 'error', message: (e as Error).message });
    }
    return this.complete ? JSON.stringify({ t: 'done' }) : null;
  }

  /** Bytes of the link transfer so far, of all of it. */
  get linkProgress(): number {
    return this.buffer && this.buffer.length ? this.filled / this.buffer.length : 0;
  }

  private async opened(stream: number, sealed: Uint8Array, via: 'link' | 'camera') {
    try {
      const plain = await unseal(this.key, this.session, stream, sealed);
      if (stream === STREAM.readings && !this.readings) this.readings = await readReadings(plain);
      else if (stream === STREAM.photos && !this.photos) this.photos = unpackPhotos(plain);
      this.onChange(this.received, { via });
    } catch (e) {
      this.onChange(this.received, { via, error: (e as Error).message });
      throw e;
    }
  }
}
