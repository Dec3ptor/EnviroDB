// The camera: reading QR codes from it (the computer's webcam reading the phone, or the phone reading the computer's
// screen). Only EnviroDB's own codes count – letters that decode to bytes – and a code shown for several camera
// frames is passed on once.

import { fromBase45 } from './codec';

type JsQr = typeof import('jsqr').default;
let jsQr: JsQr | null = null;
const loadReader = async () => (jsQr ??= (await import('jsqr')).default);

/** The camera: the one facing the user (a laptop's webcam) or the one on the back (a phone's). */
export async function openCamera(facing: 'user' | 'environment'): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser can’t use a camera here.');
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } } });
  } catch (e) {
    const name = (e as Error).name;
    throw new Error(name === 'NotAllowedError' ? 'The camera wasn’t allowed – allow it for EnviroDB in the browser (the camera icon by the address) and try again.' : name === 'NotFoundError' ? 'No camera was found.' : `The camera couldn’t start (${(e as Error).message}).`);
  }
}

export const stopCamera = (s: MediaStream | null | undefined) => s?.getTracks().forEach((t) => t.stop());

/**
 * Reads codes from the video as fast as it can, until stopped. Once a code is found, only the area around it is read
 * (quicker, and at full sharpness for dense codes); if it's lost for a moment, the whole view again. Codes that
 * aren't EnviroDB's letters go to `onText` when it's given (a printed field code holds a link).
 */
export function scanVideo(video: HTMLVideoElement, onCode: (bytes: Uint8Array) => void | Promise<void>, onRate?: (codesPerSecond: number) => void, onText?: (text: string) => void): () => void {
  let stopped = false;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  let region: { x: number; y: number; w: number; h: number } | null = null;
  let misses = 0;
  let last = '';
  let reads = 0;
  let since = performance.now();
  const v = video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
  const next = () => {
    if (stopped) return;
    if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(() => void tick());
    else requestAnimationFrame(() => void tick());
  };
  const tick = async () => {
    if (stopped) return;
    try {
      const read = await loadReader();
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (vw && vh) {
        const { x: sx, y: sy, w: sw, h: sh } = region ?? { x: 0, y: 0, w: vw, h: vh };
        const scale = Math.min(1, (region ? 1000 : 1280) / Math.max(sw, sh));
        const cw = Math.max(1, Math.round(sw * scale));
        const ch = Math.max(1, Math.round(sh * scale));
        if (canvas.width !== cw || canvas.height !== ch) {
          canvas.width = cw;
          canvas.height = ch;
        }
        ctx.drawImage(video, sx, sy, sw, sh, 0, 0, cw, ch);
        const found = read(ctx.getImageData(0, 0, cw, ch).data, cw, ch, { inversionAttempts: 'dontInvert' });
        if (found?.data) {
          misses = 0;
          const pts = [found.location.topLeftCorner, found.location.topRightCorner, found.location.bottomLeftCorner, found.location.bottomRightCorner].map((p) => ({ x: sx + p.x / scale, y: sy + p.y / scale }));
          const minX = Math.min(...pts.map((p) => p.x));
          const maxX = Math.max(...pts.map((p) => p.x));
          const minY = Math.min(...pts.map((p) => p.y));
          const maxY = Math.max(...pts.map((p) => p.y));
          const pad = Math.max(maxX - minX, maxY - minY) * 0.35;
          const x = Math.max(0, Math.floor(minX - pad));
          const y = Math.max(0, Math.floor(minY - pad));
          region = { x, y, w: Math.min(vw - x, Math.ceil(maxX - minX + 2 * pad)), h: Math.min(vh - y, Math.ceil(maxY - minY + 2 * pad)) };
          if (found.data !== last) {
            last = found.data;
            let bytes: Uint8Array | null = null;
            try {
              bytes = fromBase45(found.data);
            } catch {
              /* someone else's code */
            }
            if (bytes) {
              reads++;
              await onCode(bytes);
            } else onText?.(found.data);
          }
        } else if (region && ++misses > 6) {
          region = null;
          misses = 0;
        }
      }
      const now = performance.now();
      if (now - since >= 1000) {
        onRate?.(Math.round((reads * 1000) / (now - since)));
        reads = 0;
        since = now;
      }
    } catch {
      /* a frame that couldn't be read: carry on */
    }
    next();
  };
  next();
  return () => {
    stopped = true;
  };
}
