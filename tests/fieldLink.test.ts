import { describe, expect, it } from 'vitest';
import qrcode from 'qrcode-generator';
import { FountainDecoder, FountainEncoder, blocksOf, fromBase45, readFrame, toBase45, CODE } from '../src/field/link/codec';
import { fromSdp, packCode, toSdp, unpackCode, type LinkCode } from '../src/field/link/signal';
import { STREAM, newKey, packPhotos, photosOf, seal, unpackPhotos, unseal } from '../src/field/link/payload';
import { CODE_SIZES, FrameSchedule, Receiver, blockSizeFor, prepare, type Received } from '../src/field/link/transfer';
import { checkResults, type FieldResults } from '../src/field/model';

const bytes = (n: number, seed = 1) => {
  const out = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) out[i] = (x = (x * 1103515245 + 12345) >>> 0) >>> 24;
  return out;
};

describe('base45', () => {
  it('turns any bytes into QR letters and back (RFC 9285)', () => {
    expect(toBase45(new TextEncoder().encode('AB'))).toBe('BB8');
    expect(toBase45(new TextEncoder().encode('Hello!!'))).toBe('%69 VD92EX0');
    expect(new TextDecoder().decode(fromBase45('QED8WEX0'))).toBe('ietf!');
    for (const n of [0, 1, 2, 3, 100, 1001]) expect(fromBase45(toBase45(bytes(n, n + 7)))).toEqual(bytes(n, n + 7));
    expect(() => fromBase45('abc')).toThrow(/Not a code/);
    expect(() => fromBase45('GGW')).toThrow(/Not a code/); // over 65535
  });

  it('fits the stream sizes exactly', () => {
    for (const s of Object.values(CODE_SIZES)) {
      const fill = (n: number) => {
        const q = qrcode(s.version as 10, 'L');
        q.addData('A'.repeat(n), 'Alphanumeric');
        q.make();
      };
      expect(() => fill(s.letters)).not.toThrow();
      expect(() => fill(s.letters + 1)).toThrow();
    }
  });
});

describe('the fountain code', () => {
  it('shows each block once first, then mixes', () => {
    expect([0, 1, 2].map((i) => blocksOf(i, 3))).toEqual([[0], [1], [2]]);
    const mixed = Array.from({ length: 200 }, (_, i) => blocksOf(100 + i, 100));
    expect(mixed.every((b) => b.length >= 1 && b.every((x) => x >= 0 && x < 100) && new Set(b).size === b.length)).toBe(true);
    expect(mixed.reduce((n, b) => n + b.length, 0) / mixed.length).toBeGreaterThan(2);
    // the same on both ends
    expect(blocksOf(1234, 100)).toEqual(blocksOf(1234, 100));
  });

  it('rebuilds the data from whichever frames arrive – a third of them missed', () => {
    const data = bytes(50_000, 3);
    const e = new FountainEncoder(data, 500);
    expect(e.K).toBe(100);
    const d = new FountainDecoder(e.K, 500, data.length);
    let shown = 0;
    let caught = 0;
    for (let i = 0; !d.done && i < 2000; i++) {
      shown++;
      if (((i * 7919) % 3) === 0) continue; // the camera misses this one
      caught++;
      d.add(i, e.frame(i));
    }
    expect(d.done).toBe(true);
    expect(d.result()).toEqual(data);
    // close to the least possible: about K frames caught
    expect(caught).toBeLessThan(e.K * 1.6);
    expect(shown).toBeLessThan(e.K * 2.5);
  });

  it('a frame twice, or a stray one, does no harm', () => {
    const data = bytes(1000, 9);
    const e = new FountainEncoder(data, 300);
    const d = new FountainDecoder(e.K, 300, data.length);
    d.add(0, e.frame(0));
    d.add(0, e.frame(0));
    d.add(5, new Uint8Array(10)); // wrong size: ignored
    for (let i = 1; !d.done; i++) d.add(i, e.frame(i));
    expect(d.result()).toEqual(data);
  });
});

// a session description as Chrome makes it (data channel only)
const CHROME_OFFER = [
  'v=0',
  'o=- 6056227530234575224 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0',
  'a=extmap-allow-mixed',
  'a=msid-semantic: WMS',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 0.0.0.0',
  'a=candidate:3015235563 1 udp 2113937151 192.168.1.23 54321 typ host generation 0 network-cost 999',
  'a=candidate:3015235564 1 udp 2113939711 2001:db8::5 54322 typ host generation 0 network-cost 999',
  'a=candidate:3015235565 1 udp 2113939711 6c2f0b39-1d5a-4c3a-8d2b-2b0e4a9e6a11.local 54323 typ host generation 0',
  'a=candidate:1 1 tcp 1518280447 192.168.1.23 9 typ host tcptype active generation 0',
  'a=ice-ufrag:Xk3d',
  'a=ice-pwd:8u4Lr0Y7tTzKj2nQm5PaB1cE',
  'a=ice-options:trickle',
  'a=fingerprint:sha-256 0A:1B:2C:3D:4E:5F:60:71:82:93:A4:B5:C6:D7:E8:F9:0A:1B:2C:3D:4E:5F:60:71:82:93:A4:B5:C6:D7:E8:F9',
  'a=setup:actpass',
  'a=mid:0',
  'a=sctp-port:5000',
  'a=max-message-size:262144',
  '',
].join('\r\n');

describe('the Wi-Fi handshake codes', () => {
  it('keep what the other end needs, packed small, and make a description the browser takes', async () => {
    const key = await newKey();
    const code: LinkCode = { kind: 'offer', session: 0xdeadbeef, key, ...fromSdp(CHROME_OFFER) };
    expect(code.ufrag).toBe('Xk3d');
    expect(code.setup).toBe('actpass');
    expect(code.candidates).toEqual([
      { addr: '192.168.1.23', port: 54321 },
      { addr: '2001:db8::5', port: 54322 },
      { addr: '6c2f0b39-1d5a-4c3a-8d2b-2b0e4a9e6a11.local', port: 54323 },
    ]);
    const packed = packCode(code);
    expect(packed[0]).toBe(CODE.offer);
    expect(packed.length).toBeLessThan(200);
    const back = unpackCode(packed);
    expect(back).toEqual(code);
    // a small QR code
    expect(toBase45(packed).length).toBeLessThan(300);
    const sdp = toSdp(back);
    expect(sdp).toContain('a=fingerprint:sha-256 0A:1B:2C:3D:4E:5F:60:71:82:93:A4:B5:C6:D7:E8:F9:0A:1B:2C:3D:4E:5F:60:71:82:93:A4:B5:C6:D7:E8:F9');
    expect(sdp).toContain('a=candidate:1 1 udp 2122260223 192.168.1.23 54321 typ host generation 0');
    expect(sdp).toMatch(/a=group:BUNDLE 0\r\n[\s\S]*a=mid:0\r\n/);
    // the phone's reply has no key
    const answer = unpackCode(packCode({ ...code, kind: 'answer', key: undefined, setup: 'active' }));
    expect(answer.kind).toBe('answer');
    expect(answer.key).toBeUndefined();
  });

  it('refuses codes that aren’t ours, or that try to slip something into the description', () => {
    expect(() => unpackCode(new Uint8Array([9, 1, 2]))).toThrow(/Not a code/);
    const good = { kind: 'answer' as const, session: 1, ufrag: 'abcd', pwd: 'x'.repeat(22), fingerprint: new Uint8Array(32), setup: 'active' as const, mid: '0', candidates: [] };
    expect(() => unpackCode(packCode({ ...good, ufrag: 'ab\r\na=evil' }))).toThrow(/Not a code/);
    const sneaky = unpackCode(packCode({ ...good, candidates: [{ addr: 'x\r\na=evil', port: 1 }, { addr: '10.0.0.2', port: 5000 }] }));
    expect(sneaky.candidates).toEqual([{ addr: '10.0.0.2', port: 5000 }]);
  });
});

const RESULTS: FieldResults = checkResults({
  app: 'EnviroDB',
  kind: 'field-results',
  v: 1,
  sheet: { id: 'p1:2026-10-20', project: { id: 'p1', name: 'Demo', code: 'D-1' }, round: 'October', date: '2026-10-20' },
  by: 'Sam',
  sent: '2026-10-20T15:00:00Z',
  visits: [
    { siteId: 's1', time: '2026-10-20T09:15', values: { 'ph-field': 7.4 }, notes: 'Clear', done: true, photos: [{ name: 'a.jpg', dataUrl: `data:image/jpeg;base64,${Buffer.from(bytes(30_000, 4)).toString('base64')}` }] },
    { siteId: 's2', values: { 'ph-field': 7.1 }, done: true, photos: [{ name: 'b.webp', dataUrl: `data:image/webp;base64,${Buffer.from(bytes(20_000, 5)).toString('base64')}` }] },
    { siteId: 's3', values: {}, notSampled: 'Dry', done: true },
  ],
});

describe('sealed with the key from the computer’s screen', () => {
  it('opens only with that key, for that receiving and that part', async () => {
    const key = await newKey();
    const data = bytes(500, 2);
    const sealed = await seal(key, 7, STREAM.readings, data);
    expect(await unseal(key, 7, STREAM.readings, sealed)).toEqual(data);
    await expect(unseal(await newKey(), 7, STREAM.readings, sealed)).rejects.toThrow(/didn’t open/);
    await expect(unseal(key, 8, STREAM.readings, sealed)).rejects.toThrow(/didn’t open/);
    await expect(unseal(key, 7, STREAM.photos, sealed)).rejects.toThrow(/didn’t open/);
    const changed = sealed.slice();
    changed[40] ^= 1;
    await expect(unseal(key, 7, STREAM.readings, changed)).rejects.toThrow(/didn’t open/);
  });

  it('packs the photos and unpacks them', () => {
    const list = photosOf(RESULTS);
    expect(list.map((p) => [p.siteId, p.type, p.bytes.length])).toEqual([
      ['s1', 'image/jpeg', 30_000],
      ['s2', 'image/webp', 20_000],
    ]);
    expect(unpackPhotos(packPhotos(list))).toEqual(list);
    expect(() => unpackPhotos(packPhotos(list).slice(0, 100))).toThrow(/incomplete/);
  });
});

describe('sending the results across', () => {
  it('by QR codes: the readings first, then the photos – with a third of the frames missed', async () => {
    const key = await newKey();
    const session = 0x12345678;
    const out = await prepare(RESULTS, session, key);
    const schedule = new FrameSchedule(out, 'medium', new Uint8Array([CODE.answer, 0x12, 0x34, 0x56, 0x78, 0]));
    const seen: Array<Received | null> = [];
    const r = new Receiver(session, key, (x) => seen.push(x));
    let readingsAt = -1;
    let answers = 0;
    let n = 0;
    for (; !r.complete && n < 3000; n++) {
      const code = schedule.next();
      // through a QR code and back
      const read = fromBase45(toBase45(code));
      if (n % 3 === 1) continue;
      if ((await r.code(read)) === 'answer') answers++;
      if (readingsAt < 0 && r.received) readingsAt = n;
    }
    expect(r.complete).toBe(true);
    expect(readingsAt).toBeGreaterThanOrEqual(0);
    expect(readingsAt).toBeLessThan(10); // the readings within the first few frames
    expect(answers).toBeGreaterThan(0); // the phone's reply comes round now and then
    const got = r.received!;
    expect(got.photoCount).toBe(2);
    expect(got.results.visits.map((v) => [v.siteId, v.values, v.photos?.map((p) => p.dataUrl.length)])).toEqual(RESULTS.visits.map((v) => [v.siteId, v.values, v.photos?.map((p) => p.dataUrl.length)]));
    expect(got.results.visits[0].photos![0].dataUrl).toBe(RESULTS.visits[0].photos![0].dataUrl);
    // the time it took, near the least it could
    expect(n).toBeLessThan(schedule.needed * 1.9);
    expect(blockSizeFor('medium')).toBe(489);
  });

  it('ignores frames from another phone or receiving', async () => {
    const key = await newKey();
    const other = new FrameSchedule(await prepare(RESULTS, 99, key), 'small', null);
    const r = new Receiver(1, key, () => undefined);
    const kinds = new Set<string | null>();
    for (let i = 0; i < 50; i++) kinds.add(await r.code(other.next()));
    expect(r.received).toBeNull();
    expect([...kinds]).toEqual(['other']); // told apart, so the computer can say the phone scanned an older code
    // frames sealed with another key are refused when they're put together
    const forged = new FrameSchedule(await prepare(RESULTS, 1, await newKey()), 'small', null);
    const errors: string[] = [];
    const r2 = new Receiver(1, key, (_x, how) => how.error && errors.push(how.error));
    for (let i = 0; i < 50; i++) await r2.code(forged.next()).catch(() => undefined);
    expect(r2.received).toBeNull();
    expect(errors[0]).toMatch(/didn’t open/);
  });

  it('over the Wi-Fi link: a hello, then the pieces – and a done when it’s all there', async () => {
    const key = await newKey();
    const out = await prepare(RESULTS, 5, key);
    const r = new Receiver(5, key, () => undefined);
    expect(JSON.parse((await r.message(JSON.stringify({ t: 'hello', session: 6, sizes: [1, 1] })))!).t).toBe('error');
    expect(await r.message(JSON.stringify({ t: 'hello', session: 5, sizes: [out.readings.length, out.photos!.length] }))).toBeNull();
    const all = new Uint8Array([...out.readings, ...out.photos!]);
    let reply: string | null = null;
    for (let o = 0; o < all.length; o += 16384) reply = await r.message(all.slice(o, o + 16384).buffer);
    expect(reply && JSON.parse(reply).t).toBe('done');
    expect(r.received!.results.visits[1].photos![0].dataUrl).toBe(RESULTS.visits[1].photos![0].dataUrl);
  });

  it('a frame is told apart from the codes', () => {
    expect(readFrame(new Uint8Array([CODE.answer, 1]))).toBeNull();
  });
});
