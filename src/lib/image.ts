/** Pixel size of a PNG or JPEG data URL, read from the file header (null when it can't be read). */
export function imageSize(dataUrl: string): { width: number; height: number } | null {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return null;
  let bin: string;
  try {
    bin = atob(dataUrl.slice(comma + 1, comma + 1 + 80000)); // the header is near the start
  } catch {
    return null;
  }
  const byte = (i: number) => bin.charCodeAt(i) & 0xff;
  const u16 = (i: number) => (byte(i) << 8) | byte(i + 1);
  const u32 = (i: number) => ((byte(i) << 24) | (byte(i + 1) << 16) | (byte(i + 2) << 8) | byte(i + 3)) >>> 0;
  // PNG: signature, then the IHDR chunk with width and height
  if (bin.startsWith('\x89PNG')) {
    const width = u32(16), height = u32(20);
    return width && height ? { width, height } : null;
  }
  // JPEG: walk the segments to the start-of-frame marker
  if (byte(0) === 0xff && byte(1) === 0xd8) {
    let i = 2;
    while (i + 9 < bin.length) {
      if (byte(i) !== 0xff) return null;
      const marker = byte(i + 1);
      const len = u16(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const height = u16(i + 5), width = u16(i + 7);
        return width && height ? { width, height } : null;
      }
      i += 2 + len;
    }
  }
  return null;
}

/** Logo size on the page: the chosen height, keeping its proportions, but never wider than `maxWidthMm`. */
export function logoSizeMm(dataUrl: string, heightMm: number, maxWidthMm: number): { widthMm: number; heightMm: number } {
  const px = imageSize(dataUrl);
  const aspect = px ? px.width / px.height : 3;
  const widthMm = Math.min(heightMm * aspect, maxWidthMm);
  return { widthMm, heightMm: widthMm / aspect };
}

/** Read an image file as a data URL, scaled down so its longer side is at most `maxPx` (keeps PNG transparency). */
export function readImageFile(file: File, maxPx = 1000): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const src = String(reader.result);
      const img = new Image();
      img.onerror = () => reject(new Error('The image could not be read'));
      img.onload = () => {
        const scale = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight));
        if (scale === 1) return resolve(src);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(file.type === 'image/jpeg' ? canvas.toDataURL('image/jpeg', 0.92) : canvas.toDataURL('image/png'));
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Redraw a signature image (a data:, blob: or object URL) trimmed of its blank margins, at most `maxPx` on its
 * longer side, as PNG (keeps transparency) – so signatures scanned or photographed with lots of paper around them
 * come out the same size as the rest. Null when the browser can't draw it, or it is a tiny spacer image.
 */
export async function trimmedImage(src: string, maxPx = 600): Promise<string | null> {
  const img = new Image();
  img.src = src;
  try {
    await img.decode();
  } catch {
    return null;
  }
  if (img.naturalWidth <= 4 || img.naturalHeight <= 4) return null;
  const k = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight)); // find the margins at up to 2000 px
  const w = Math.max(1, Math.round(img.naturalWidth * k));
  const h = Math.max(1, Math.round(img.naturalHeight * k));
  const work = document.createElement('canvas');
  work.width = w;
  work.height = h;
  const ctx = work.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  let [x0, y0, x1, y1] = [w, h, -1, -1];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (px[i + 3] > 24 && Math.min(px[i], px[i + 1], px[i + 2]) < 225) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  if (x1 < 0) [x0, y0, x1, y1] = [0, 0, w - 1, h - 1]; // nothing dark: keep it all
  const pad = Math.round(Math.max(x1 - x0, y1 - y0) * 0.03) + 1;
  [x0, y0, x1, y1] = [Math.max(0, x0 - pad), Math.max(0, y0 - pad), Math.min(w - 1, x1 + pad), Math.min(h - 1, y1 + pad)];
  const [cw, ch] = [x1 - x0 + 1, y1 - y0 + 1];
  const s = Math.min(1, maxPx / Math.max(cw, ch));
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(cw * s));
  out.height = Math.max(1, Math.round(ch * s));
  out.getContext('2d')!.drawImage(work, x0, y0, cw, ch, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}

/** An image file or blob as a trimmed signature (see `trimmedImage`). */
export async function trimmedImageFile(file: Blob): Promise<string | null> {
  const url = URL.createObjectURL(file);
  try {
    return await trimmedImage(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** An image on the web as a trimmed signature; null when the site doesn't allow it to be read (most don't). */
export async function fetchedImage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
    const blob = await res.blob();
    return res.ok && blob.type.startsWith('image/') ? await trimmedImageFile(blob) : null;
  } catch {
    return null;
  }
}
