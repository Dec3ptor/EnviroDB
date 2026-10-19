// The direct Wi-Fi link (WebRTC) between the phone and the computer. No servers at all – no STUN or TURN – so the two
// can only reach each other on the same local network, and nothing passes through anyone else. The link is encrypted
// by the browsers; the codes it was set up with were passed by camera, so no one else can join it.

import { fromSdp, toSdp, type LinkCode } from './signal';

/** No outside servers: a direct link on the local network or none. */
const NO_SERVERS: RTCConfiguration = { iceServers: [] };

/** When the browser has found its addresses (or after a few seconds). */
function gathered(pc: RTCPeerConnection, ms = 3000): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', check);
      resolve();
    };
    const check = () => pc.iceGatheringState === 'complete' && done();
    const timer = setTimeout(done, ms);
    pc.addEventListener('icegatheringstatechange', check);
  });
}

/** The computer's end: a link waiting for the phone, and the code to show it. */
export async function offerLink(session: number, key: Uint8Array): Promise<{ pc: RTCPeerConnection; channel: RTCDataChannel; code: LinkCode }> {
  const pc = new RTCPeerConnection(NO_SERVERS);
  const channel = pc.createDataChannel('envirodb-field', { ordered: true });
  channel.binaryType = 'arraybuffer';
  await pc.setLocalDescription(await pc.createOffer());
  await gathered(pc);
  return { pc, channel, code: { kind: 'offer', session, key, ...fromSdp(pc.localDescription!.sdp) } };
}

/** The computer, once it has read the phone's reply. */
export async function completeLink(pc: RTCPeerConnection, answer: LinkCode): Promise<void> {
  await pc.setRemoteDescription({ type: 'answer', sdp: toSdp(answer) });
}

/** The phone's end: joins the computer's link, and the reply code to show the computer. */
export async function answerLink(offer: LinkCode): Promise<{ pc: RTCPeerConnection; channel: Promise<RTCDataChannel>; code: LinkCode }> {
  const pc = new RTCPeerConnection(NO_SERVERS);
  const channel = new Promise<RTCDataChannel>((resolve) => {
    pc.addEventListener('datachannel', (e) => {
      e.channel.binaryType = 'arraybuffer';
      resolve(e.channel);
    });
  });
  await pc.setRemoteDescription({ type: 'offer', sdp: toSdp(offer) });
  await pc.setLocalDescription(await pc.createAnswer());
  await gathered(pc);
  return { pc, channel, code: { kind: 'answer', session: offer.session, ...fromSdp(pc.localDescription!.sdp) } };
}

/** Once the channel is open. */
export function opened(channel: RTCDataChannel): Promise<void> {
  if (channel.readyState === 'open') return Promise.resolve();
  return new Promise((resolve, reject) => {
    channel.addEventListener('open', () => resolve(), { once: true });
    channel.addEventListener('close', () => reject(new Error('The link closed.')), { once: true });
  });
}

/** Sends bytes in pieces, waiting when the browser's queue is full. */
export async function sendBytes(channel: RTCDataChannel, bytes: Uint8Array, onProgress?: (sent: number) => void): Promise<void> {
  const PIECE = 16 * 1024;
  channel.bufferedAmountLowThreshold = 256 * 1024;
  for (let o = 0; o < bytes.length; o += PIECE) {
    if (channel.bufferedAmount > 1024 * 1024) await new Promise<void>((r) => channel.addEventListener('bufferedamountlow', () => r(), { once: true }));
    if (channel.readyState !== 'open') throw new Error('The link closed.');
    channel.send(bytes.slice(o, o + PIECE));
    onProgress?.(Math.min(bytes.length, o + PIECE));
  }
}
