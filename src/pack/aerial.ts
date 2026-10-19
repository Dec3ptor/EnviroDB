// An aerial photo of the sites' area for the data pack's map: LINZ imagery tiles drawn onto one picture when the
// pack is made, so the pack itself never needs the internet.

import { linzAerialTile } from '../components/map/linz';

export const AERIAL_ATTRIBUTION = 'Aerial imagery: LINZ (CC BY 4.0).';

const merc = (lat: number, lng: number): [number, number] => {
  const s = Math.sin((lat * Math.PI) / 180);
  return [(lng + 180) / 360, 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)];
};

/** The area to show (Web Mercator, 0–1): the sites with room around them, 16:10 – as the pack's map frames them. */
export function mapBox(points: Array<{ lat: number; lng: number }>): [number, number, number, number] | null {
  if (!points.length) return null;
  const m = points.map((p) => merc(p.lat, p.lng));
  const xs = m.map((p) => p[0]), ys = m.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const minSpan = 0.6 / 40075;
  let w = Math.max(x1 - x0, minSpan), h = Math.max(y1 - y0, minSpan);
  if (w / h < 1.6) w = h * 1.6;
  else h = w / 1.6;
  w *= 1.35;
  h *= 1.35;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2];
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${src.split('?')[0]}`));
    img.src = src;
  });
}

/** The aerial photo (JPEG data URL) of the area, about `width` pixels across – or null when it can't be had. */
export async function aerialSnapshot(box: [number, number, number, number], width = 1400): Promise<string | null> {
  const span = box[2] - box[0];
  let z = Math.floor(Math.log2(width / (256 * span)));
  z = Math.max(3, Math.min(19, z));
  const scale = 256 * 2 ** z;
  const px0 = box[0] * scale, py0 = box[1] * scale, px1 = box[2] * scale, py1 = box[3] * scale;
  const tx0 = Math.floor(px0 / 256), tx1 = Math.floor(px1 / 256), ty0 = Math.floor(py0 / 256), ty1 = Math.floor(py1 / 256);
  if ((tx1 - tx0 + 1) * (ty1 - ty0 + 1) > 80) return null;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(px1 - px0);
  canvas.height = Math.round(py1 - py0);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const tiles: Array<Promise<void>> = [];
  for (let tx = tx0; tx <= tx1; tx++)
    for (let ty = ty0; ty <= ty1; ty++)
      tiles.push(loadImage(linzAerialTile(z, tx, ty)).then((img) => ctx.drawImage(img, Math.round(tx * 256 - px0), Math.round(ty * 256 - py0), 256, 256)));
  try {
    await Promise.all(tiles);
    return canvas.toDataURL('image/jpeg', 0.82);
  } catch {
    // a tile that wouldn't load, or imagery the browser won't let be copied: the plain map instead
    return null;
  }
}
