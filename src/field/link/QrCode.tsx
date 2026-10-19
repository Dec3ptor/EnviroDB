// QR codes on screen: a still one (the computer's code, the phone's reply) and the phone's flickering stream.

import { useEffect, useMemo, useRef } from 'react';
import qrcode from 'qrcode-generator';
import { toBase45 } from './codec';

type Version = Parameters<typeof qrcode>[0];

/** The dark squares of a QR code holding these letters (alphanumeric) or text (bytes). */
export function qrCells(text: string, mode: 'Alphanumeric' | 'Byte', version = 0) {
  const qr = qrcode(version as Version, 'L');
  qr.addData(text, mode);
  qr.make();
  const n = qr.getModuleCount();
  return { n, isDark: (r: number, c: number) => qr.isDark(r, c) };
}

const QUIET = 4;

/** A still QR code, drawn as squares (no HTML from the library). Bytes go in as EnviroDB's letters. */
export function QrCode({ text, bytes, size = 260, label = 'QR code' }: { text?: string; bytes?: Uint8Array; size?: number | string; label?: string }) {
  const cells = useMemo(() => {
    const q = bytes ? qrCells(toBase45(bytes), 'Alphanumeric') : qrCells(text ?? '', 'Byte');
    const dark: Array<[number, number]> = [];
    for (let r = 0; r < q.n; r++) for (let c = 0; c < q.n; c++) if (q.isDark(r, c)) dark.push([r, c]);
    return { n: q.n, dark };
  }, [text, bytes]);
  return (
    <svg viewBox={`0 0 ${cells.n + 2 * QUIET} ${cells.n + 2 * QUIET}`} width={size} height={size} role="img" aria-label={label} shapeRendering="crispEdges" style={{ background: '#fff', borderRadius: 6, display: 'block' }}>
      <path d={cells.dark.map(([r, c]) => `M${c + QUIET} ${r + QUIET}h1v1h-1z`).join('')} fill="#000" />
    </svg>
  );
}

/** Draws a code's bytes on a canvas, as large as fits. */
export function drawCode(canvas: HTMLCanvasElement, bytes: Uint8Array, version: number) {
  const q = qrCells(toBase45(bytes), 'Alphanumeric', bytes[0] === 3 ? version : 0);
  const side = q.n + 2 * QUIET;
  const px = Math.max(1, Math.floor(Math.min(canvas.width, canvas.height) / side));
  const off = Math.floor((Math.min(canvas.width, canvas.height) - side * px) / 2);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  for (let r = 0; r < q.n; r++) for (let c = 0; c < q.n; c++) if (q.isDark(r, c)) ctx.fillRect(off + (c + QUIET) * px, off + (r + QUIET) * px, px, px);
}

/** A canvas that plays codes one after another, at so many a second, while running. */
export function CodeStream({ next, perSecond, version, running, label = 'Flashing code with the results' }: { next: () => Uint8Array; perSecond: number; version: number; running: boolean; label?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const nextRef = useRef(next);
  nextRef.current = next;
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !running) return;
    const fit = () => {
      const w = Math.floor(canvas.clientWidth * (window.devicePixelRatio || 1));
      if (w && canvas.width !== w) {
        canvas.width = w;
        canvas.height = w;
      }
    };
    fit();
    let timer = 0;
    const show = () => {
      fit();
      drawCode(canvas, nextRef.current(), version);
    };
    show();
    timer = window.setInterval(show, Math.round(1000 / perSecond));
    return () => window.clearInterval(timer);
  }, [perSecond, version, running]);
  return <canvas ref={ref} role="img" aria-label={label} style={{ width: '100%', aspectRatio: '1', display: 'block', background: '#fff', borderRadius: 6 }} />;
}
