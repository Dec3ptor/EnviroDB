import { useMemo } from 'react';
import qrcode from 'qrcode-generator';

/** A QR code, drawn as squares (no HTML from the library). */
export function QrCode({ text, size = 260, label = 'QR code of the field sheet' }: { text: string; size?: number; label?: string }) {
  const cells = useMemo(() => {
    const qr = qrcode(0, 'L');
    qr.addData(text, 'Byte');
    qr.make();
    const n = qr.getModuleCount();
    const dark: Array<[number, number]> = [];
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) dark.push([r, c]);
    return { n, dark };
  }, [text]);
  const q = 4; // the quiet margin
  return (
    <svg viewBox={`0 0 ${cells.n + 2 * q} ${cells.n + 2 * q}`} width={size} height={size} role="img" aria-label={label} shapeRendering="crispEdges" style={{ background: '#fff', borderRadius: 6, flexShrink: 0 }}>
      <path d={cells.dark.map(([r, c]) => `M${c + q} ${r + q}h1v1h-1z`).join('')} fill="#000" />
    </svg>
  );
}
