// A zip with its files stored as they are – photos are compressed already – built one file at a time into a Blob, so
// a job with hundreds of full-size photos never needs them all in memory at once (a phone's browser can't hold that).
// Any zip tool opens it, and so does EnviroDB's reader.

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** The zip's check number of some bytes (`crc`: of the bytes before them, to go on from). */
export function crc32(data: Uint8Array, crc = 0): number {
  let c = (crc ^ 0xffffffff) >>> 0;
  for (let i = 0; i < data.length; i++) c = TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const enc = new TextEncoder();
const LIMIT = 0xffffffff;

/** Date and time as a zip keeps them (the local time, to 2 seconds). */
function dosTime(d: Date): { time: number; date: number } {
  const y = Math.max(1980, d.getFullYear());
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}

export class ZipWriter {
  private parts: BlobPart[] = [];
  private central: Uint8Array[] = [];
  private offset = 0;
  private names = new Set<string>();

  /**
   * A file. A Blob goes in as it is (read once, a slice at a time, for its check number); bytes are copied into a
   * Blob straight away, so they can be let go of.
   */
  async add(name: string, data: Uint8Array | Blob | string, date: Date = new Date()): Promise<void> {
    if (this.names.has(name)) throw new Error(`${name} is in the zip already.`);
    this.names.add(name);
    let crc = 0;
    let size = 0;
    let part: Blob;
    if (data instanceof Blob) {
      for (let at = 0; at < data.size; at += 1 << 20) crc = crc32(new Uint8Array(await data.slice(at, at + (1 << 20)).arrayBuffer()), crc);
      size = data.size;
      part = data;
    } else {
      const bytes = typeof data === 'string' ? enc.encode(data) : data;
      crc = crc32(bytes);
      size = bytes.length;
      part = new Blob([bytes as BlobPart]);
    }
    const file = enc.encode(name);
    const { time, date: day } = dosTime(date);
    if (this.offset + 30 + file.length + size > LIMIT || this.names.size > 0xfffe) throw new Error('The job is too big for one file (over 4 GB) – send it in parts.');
    const local = new Uint8Array(30 + file.length);
    const l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true);
    l.setUint16(4, 20, true);
    l.setUint16(6, 0x0800, true); // names in UTF-8
    l.setUint16(8, 0, true); // stored
    l.setUint16(10, time, true);
    l.setUint16(12, day, true);
    l.setUint32(14, crc, true);
    l.setUint32(18, size, true);
    l.setUint32(22, size, true);
    l.setUint16(26, file.length, true);
    l.setUint16(28, 0, true);
    local.set(file, 30);
    const head = new Uint8Array(46 + file.length);
    const c = new DataView(head.buffer);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint16(10, 0, true);
    c.setUint16(12, time, true);
    c.setUint16(14, day, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, size, true);
    c.setUint32(24, size, true);
    c.setUint16(28, file.length, true);
    c.setUint32(42, this.offset, true);
    head.set(file, 46);
    this.parts.push(local, part);
    this.central.push(head);
    this.offset += local.length + size;
  }

  /** The zip. */
  finish(): Blob {
    const size = this.central.reduce((n, h) => n + h.length, 0);
    const end = new Uint8Array(22);
    const e = new DataView(end.buffer);
    e.setUint32(0, 0x06054b50, true);
    e.setUint16(8, this.central.length, true);
    e.setUint16(10, this.central.length, true);
    e.setUint32(12, size, true);
    e.setUint32(16, this.offset, true);
    return new Blob([...this.parts, ...this.central, end] as BlobPart[], { type: 'application/zip' });
  }
}
