// NZTM2000 (New Zealand Transverse Mercator) ⇄ latitude/longitude on NZGD2000, which is within a metre of WGS84 –
// what web maps and GPS use. The series are LINZ's (from their published NZTM conversion code).

const A = 6378137;
const RF = 298.257222101;
const CM = (173 * Math.PI) / 180;
const SF = 0.9996;
const FE = 1600000;
const FN = 10000000;

const F = 1 / RF;
const E2 = 2 * F - F * F;
const E4 = E2 * E2;
const E6 = E4 * E2;
const A0 = 1 - E2 / 4 - (3 * E4) / 64 - (5 * E6) / 256;
const A2 = (3 / 8) * (E2 + E4 / 4 + (15 * E6) / 128);
const A4 = (15 / 256) * (E4 + (3 * E6) / 4);
const A6 = (35 * E6) / 3072;

function meridianArc(lt: number): number {
  return A * (A0 * lt - A2 * Math.sin(2 * lt) + A4 * Math.sin(4 * lt) - A6 * Math.sin(6 * lt));
}

function footPointLat(m: number): number {
  const b = A * (1 - F);
  const n = (A - b) / (A + b);
  const n2 = n * n, n3 = n2 * n, n4 = n2 * n2;
  const g = A * (1 - n) * (1 - n2) * (1 + (9 * n2) / 4 + (225 * n4) / 64);
  const s = m / g;
  return s + ((3 * n) / 2 - (27 * n3) / 32) * Math.sin(2 * s) + ((21 * n2) / 16 - (55 * n4) / 32) * Math.sin(4 * s) + ((151 * n3) / 96) * Math.sin(6 * s) + ((1097 * n4) / 512) * Math.sin(8 * s);
}

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Nztm {
  easting: number;
  northing: number;
}

/** Latitude/longitude (degrees) → NZTM2000 easting/northing (metres). */
export function toNztm(lat: number, lng: number): Nztm {
  const lt = (lat * Math.PI) / 180;
  let dlon = (lng * Math.PI) / 180 - CM;
  while (dlon > Math.PI) dlon -= 2 * Math.PI;
  while (dlon < -Math.PI) dlon += 2 * Math.PI;
  const m = meridianArc(lt);
  const slt = Math.sin(lt), clt = Math.cos(lt);
  const eslt = 1 - E2 * slt * slt;
  const eta = A / Math.sqrt(eslt);
  const rho = (eta * (1 - E2)) / eslt;
  const psi = eta / rho;
  const w = dlon;
  const wc = clt * w, wc2 = wc * wc;
  const t = slt / clt, t2 = t * t, t4 = t2 * t2, t6 = t2 * t4;

  let trm1 = (psi - t2) / 6;
  let trm2 = (((4 * (1 - 6 * t2) * psi + (1 + 8 * t2)) * psi - 2 * t2) * psi + t4) / 120;
  let trm3 = (61 - 479 * t2 + 179 * t4 - t6) / 5040;
  const gce = SF * eta * dlon * clt * (((trm3 * wc2 + trm2) * wc2 + trm1) * wc2 + 1);
  const easting = gce + FE;

  trm1 = 1 / 2;
  trm2 = ((4 * psi + 1) * psi - t2) / 24;
  trm3 = ((((8 * (11 - 24 * t2) * psi - 28 * (1 - 6 * t2)) * psi + (1 - 32 * t2)) * psi - 2 * t2) * psi + t4) / 720;
  const trm4 = (1385 - 3111 * t2 + 543 * t4 - t6) / 40320;
  const gcn = eta * t * ((((trm4 * wc2 + trm3) * wc2 + trm2) * wc2 + trm1) * wc2);
  const northing = (gcn + m) * SF + FN;
  return { easting, northing };
}

/** NZTM2000 easting/northing (metres) → latitude/longitude (degrees). */
export function fromNztm(easting: number, northing: number): LatLng {
  const cn1 = (northing - FN) / SF;
  const fphi = footPointLat(cn1);
  const slt = Math.sin(fphi), clt = Math.cos(fphi);
  const eslt = 1 - E2 * slt * slt;
  const eta = A / Math.sqrt(eslt);
  const rho = (eta * (1 - E2)) / eslt;
  const psi = eta / rho;
  const e = easting - FE;
  const x = e / (eta * SF), x2 = x * x;
  const t = slt / clt, t2 = t * t, t4 = t2 * t2;

  let trm1 = 1 / 2;
  let trm2 = ((-4 * psi + 9 * (1 - t2)) * psi + 12 * t2) / 24;
  let trm3 = ((((8 * (11 - 24 * t2) * psi - 12 * (21 - 71 * t2)) * psi + 15 * ((15 * t2 - 98) * t2 + 15)) * psi + 180 * ((-3 * t2 + 5) * t2)) * psi + 360 * t4) / 720;
  let trm4 = (((1575 * t2 + 4095) * t2 + 3633) * t2 + 1385) / 40320;
  const lat = fphi + ((t * x * e) / (SF * rho)) * (((trm4 * x2 - trm3) * x2 + trm2) * x2 - trm1);

  trm1 = 1;
  trm2 = (psi + 2 * t2) / 6;
  trm3 = (((-4 * (1 - 6 * t2) * psi + (9 - 68 * t2)) * psi + 72 * t2) * psi + 24 * t4) / 120;
  trm4 = (((720 * t2 + 1320) * t2 + 662) * t2 + 61) / 5040;
  const lng = CM - (x / clt) * (((trm4 * x2 - trm3) * x2 + trm2) * x2 - trm1);
  return { lat: (lat * 180) / Math.PI, lng: (lng * 180) / Math.PI };
}

/** Where NZTM coordinates can fall (New Zealand, its offshore islands and the coast around them). */
export function isNztm(easting: number, northing: number): boolean {
  return easting >= 900000 && easting <= 2300000 && northing >= 4700000 && northing <= 6300000;
}

/** A site's position on the map, if it has NZTM coordinates. */
export function siteLatLng(s: { easting?: number; northing?: number }): LatLng | null {
  if (s.easting === undefined || s.northing === undefined || !Number.isFinite(s.easting) || !Number.isFinite(s.northing) || !isNztm(s.easting, s.northing)) return null;
  return fromNztm(s.easting, s.northing);
}

/** NZTM to the metre, as stored for a site. */
export function roundedNztm(lat: number, lng: number): Nztm {
  const p = toNztm(lat, lng);
  return { easting: Math.round(p.easting), northing: Math.round(p.northing) };
}

/**
 * Coordinates typed or pasted in any common form: "-37.78, 175.28" or "175.28 -37.78" (degrees, either order),
 * "37°46'48\"S 175°16'48\"E", or NZTM "1812345 5823456" (either order, "E"/"N" letters allowed).
 */
export function parseCoordinates(text: string): (Nztm & LatLng) | null {
  const t = text.trim();
  if (!t) return null;
  // degrees, minutes, seconds with hemisphere letters
  const dms = [...t.matchAll(/(\d+(?:\.\d+)?)\s*[°º\s]\s*(?:(\d+(?:\.\d+)?)\s*['′\s]\s*)?(?:(\d+(?:\.\d+)?)\s*["″]?\s*)?([NSEW])/gi)];
  if (dms.length === 2) {
    let lat: number | undefined, lng: number | undefined;
    for (const m of dms) {
      const v = Number(m[1]) + Number(m[2] ?? 0) / 60 + Number(m[3] ?? 0) / 3600;
      const h = m[4].toUpperCase();
      if (h === 'N' || h === 'S') lat = h === 'S' ? -v : v;
      else lng = h === 'W' ? -v : v;
    }
    if (lat !== undefined && lng !== undefined) return withNztm(lat, lng);
  }
  const nums = (t.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  if (nums.length !== 2) return null;
  const [a, b] = nums;
  if (Math.abs(a) > 1000 && Math.abs(b) > 1000) {
    const [e, n] = a > b ? [b, a] : [a, b]; // northings are the bigger number in New Zealand
    if (!isNztm(e, n)) return null;
    return { easting: Math.round(e), northing: Math.round(n), ...fromNztm(e, n) };
  }
  // degrees: latitude is the one between -90 and 90 that isn't New Zealand's longitude
  let lat = a, lng = b;
  if (Math.abs(a) > 90 || (a > 160 && Math.abs(b) <= 90)) [lat, lng] = [b, a];
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (lat > 0 && lng > 160) lat = -lat; // "37.78, 175.28" in New Zealand means 37.78° south
  return withNztm(lat, lng);
}

function withNztm(lat: number, lng: number): (Nztm & LatLng) | null {
  const p = roundedNztm(lat, lng);
  return isNztm(p.easting, p.northing) ? { ...p, lat, lng } : null;
}

/** "-37.78012, 175.27943" */
export function formatLatLng(p: LatLng): string {
  return `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;
}
