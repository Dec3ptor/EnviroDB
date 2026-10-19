// The handshake for a direct Wi-Fi link between the phone and the computer, carried by two QR codes instead of a
// server: the computer's code ("offer") and the phone's reply ("answer"). Each holds what the browsers need to find and
// trust each other – the link's username and password, the fingerprint of its encryption certificate and the
// device's addresses on the local network – packed small. The computer's code also holds a fresh key the phone seals
// the results with.

import { CODE } from './codec';

export interface Candidate {
  /** An IPv4 or IPv6 address, or a .local name. */
  addr: string;
  port: number;
}

export interface LinkCode {
  kind: 'offer' | 'answer';
  /** Which receiving this belongs to (the computer picks it). */
  session: number;
  /** The key the results are sealed with (the computer's code only). */
  key?: Uint8Array;
  ufrag: string;
  pwd: string;
  /** SHA-256 fingerprint of the link's certificate. */
  fingerprint: Uint8Array;
  setup: 'actpass' | 'active' | 'passive';
  mid: string;
  candidates: Candidate[];
}

const SETUPS = ['actpass', 'active', 'passive'] as const;

/** What a browser's session description says about its end of the link (the parts the other end needs). */
export function fromSdp(sdp: string): Pick<LinkCode, 'ufrag' | 'pwd' | 'fingerprint' | 'setup' | 'mid' | 'candidates'> {
  const one = (re: RegExp) => re.exec(sdp)?.[1]?.trim();
  const ufrag = one(/^a=ice-ufrag:(.+)$/m);
  const pwd = one(/^a=ice-pwd:(.+)$/m);
  const fp = one(/^a=fingerprint:sha-256 ([0-9A-Fa-f:]+)$/m);
  const setup = one(/^a=setup:(\w+)$/m) as LinkCode['setup'] | undefined;
  const mid = one(/^a=mid:(.+)$/m) ?? '0';
  if (!ufrag || !pwd || !fp || !setup || !SETUPS.includes(setup)) throw new Error('The link couldn’t be set up in this browser.');
  const candidates: Candidate[] = [];
  for (const m of sdp.matchAll(/^a=candidate:\S+ 1 udp \d+ (\S+) (\d+) typ host/gim)) {
    const c = { addr: m[1], port: Number(m[2]) };
    if (!candidates.some((x) => x.addr === c.addr && x.port === c.port)) candidates.push(c);
  }
  // IPv4 first (most networks), at most 8
  candidates.sort((a, b) => Number(!isIpv4(a.addr)) - Number(!isIpv4(b.addr)));
  return { ufrag, pwd, fingerprint: new Uint8Array(fp.split(':').map((h) => parseInt(h, 16))), setup, mid, candidates: candidates.slice(0, 8) };
}

const isIpv4 = (s: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(s);
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).toUpperCase().padStart(2, '0')).join(':');

/** A session description the browser accepts as the other end's. */
export function toSdp(c: LinkCode): string {
  const lines = [
    'v=0',
    `o=- ${c.session} 2 IN IP4 127.0.0.1`,
    's=-',
    't=0 0',
    `a=group:BUNDLE ${c.mid}`,
    'a=msid-semantic: WMS',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 0.0.0.0',
    ...c.candidates.map((x, i) => `a=candidate:${i + 1} 1 udp ${2122260223 - i} ${x.addr} ${x.port} typ host generation 0`),
    'a=end-of-candidates',
    `a=ice-ufrag:${c.ufrag}`,
    `a=ice-pwd:${c.pwd}`,
    `a=fingerprint:sha-256 ${hex(c.fingerprint)}`,
    `a=setup:${c.setup}`,
    `a=mid:${c.mid}`,
    'a=sctp-port:5000',
    'a=max-message-size:262144',
  ];
  return `${lines.join('\r\n')}\r\n`;
}

// ------------------------------------------------------------ packed for a QR code

const enc = new TextEncoder();
const dec = new TextDecoder();

/**
 * [kind][session ×4] ([key ×32] in the computer's code) [setup][fingerprint ×32] [ufrag][pwd][mid] (each
 * [length][text]) [count] then each address: [4][IPv4 ×4] or [0][length][name], and [port ×2].
 */
export function packCode(c: LinkCode): Uint8Array {
  const out: number[] = [c.kind === 'offer' ? CODE.offer : CODE.answer];
  const u32 = (n: number) => out.push((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
  const str = (s: string) => {
    const b = enc.encode(s);
    if (b.length > 255) throw new Error('Too long for the code.');
    out.push(b.length, ...b);
  };
  u32(c.session);
  if (c.kind === 'offer') {
    if (c.key?.length !== 32) throw new Error('The computer’s code needs its key.');
    out.push(...c.key);
  }
  out.push(SETUPS.indexOf(c.setup));
  if (c.fingerprint.length !== 32) throw new Error('Unexpected certificate fingerprint.');
  out.push(...c.fingerprint);
  str(c.ufrag);
  str(c.pwd);
  str(c.mid);
  out.push(c.candidates.length);
  for (const x of c.candidates) {
    if (isIpv4(x.addr)) out.push(4, ...x.addr.split('.').map(Number));
    else {
      out.push(0);
      str(x.addr);
    }
    out.push((x.port >>> 8) & 255, x.port & 255);
  }
  return new Uint8Array(out);
}

export function unpackCode(b: Uint8Array): LinkCode {
  let o = 0;
  const need = (n: number) => {
    if (o + n > b.length) throw new Error('Not a code from EnviroDB.');
  };
  const byte = () => (need(1), b[o++]);
  const bytes = (n: number) => (need(n), b.slice(o, (o += n)));
  const u32 = () => (need(4), ((b[o++] << 24) | (b[o++] << 16) | (b[o++] << 8) | b[o++]) >>> 0);
  const str = () => dec.decode(bytes(byte()));
  const t = byte();
  if (t !== CODE.offer && t !== CODE.answer) throw new Error('Not a code from EnviroDB.');
  const kind = t === CODE.offer ? 'offer' : 'answer';
  const session = u32();
  const key = kind === 'offer' ? bytes(32) : undefined;
  const setup = SETUPS[byte()];
  if (!setup) throw new Error('Not a code from EnviroDB.');
  const fingerprint = bytes(32);
  const ufrag = str();
  const pwd = str();
  const mid = str();
  const n = byte();
  const candidates: Candidate[] = [];
  for (let i = 0; i < n; i++) {
    const k = byte();
    const addr = k === 4 ? [...bytes(4)].join('.') : str();
    const port = (byte() << 8) | byte();
    // only plain addresses and names – nothing that could become something else in the description
    if (/^[0-9A-Za-z.:-]{1,80}$/.test(addr) && port > 0) candidates.push({ addr, port });
  }
  for (const s of [ufrag, pwd, mid]) if (!/^[A-Za-z0-9+/=_-]{1,256}$/.test(s)) throw new Error('Not a code from EnviroDB.');
  return { kind, session, key, ufrag, pwd, fingerprint, setup, mid, candidates };
}
