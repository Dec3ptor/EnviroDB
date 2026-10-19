// The app's colour: ten shades, lightest to darkest, from the one colour chosen in Settings – spread the way the
// built-in teal's are, so buttons, highlights and tinted backgrounds keep the same feel in any colour.

/** The built-in teal (the app's colour until another is chosen). */
export const TEAL = ['#e6f7f5', '#cdeeea', '#9edcd4', '#6bc9bd', '#43b8aa', '#2aae9f', '#14a394', '#0f8c7f', '#0f766e', '#065f58'] as const;
export const DEFAULT_APP_COLOUR = TEAL[8];

/** Colours offered with the picker. */
export const APP_COLOURS = ['#0f766e', '#2b8a3e', '#1c7ed6', '#1d4ed8', '#2f3b52', '#5f3dc4', '#c2255c', '#c2410c'];

// Each shade measured from the teal (the chosen colour is shade 8, buttons in light mode): how much further from
// white it is, and how colourful, compared with the chosen colour.
const FROM_WHITE = [0.076, 0.155, 0.306, 0.461, 0.586, 0.656, 0.728, 0.867, 1, 1.15];
const CHROMA = [0.21, 0.405, 0.743, 1.065, 1.23, 1.292, 1.294, 1.159, 1, 0.872];

export const isHexColour = (s: unknown): s is string => typeof s === 'string' && /^#[0-9a-f]{6}$/i.test(s.trim());

// ------------------------------------------------------------ OKLCH (lightness as the eye sees it)

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function toOklch(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map((i) => toLinear(parseInt(hex.slice(i, i + 2), 16) / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), Math.atan2(B, A)];
}

/** Linear sRGB of an OKLCH colour (may be outside 0–1 when the colour can't be shown). */
function linearRgb(L: number, C: number, h: number): [number, number, number] {
  const A = C * Math.cos(h);
  const B = C * Math.sin(h);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}

const shown = (rgb: number[]) => rgb.every((c) => c >= -1e-4 && c <= 1 + 1e-4);

/** The colour as hex – as colourful as a screen can show at that lightness and hue. */
function fromOklch(L: number, C: number, h: number): string {
  L = Math.min(1, Math.max(0, L));
  let rgb = linearRgb(L, C, h);
  if (!shown(rgb)) {
    let [lo, hi] = [0, C];
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (shown(linearRgb(L, mid, h))) lo = mid;
      else hi = mid;
    }
    rgb = linearRgb(L, lo, h);
  }
  return `#${rgb.map((c) => Math.round(Math.min(1, Math.max(0, toGamma(Math.min(1, Math.max(0, c))))) * 255).toString(16).padStart(2, '0')).join('')}`;
}

// ------------------------------------------------------------ the shades

/** How light a colour looks, 0 (black) to 1 (white). */
export function lightness(hex: string): number {
  return isHexColour(hex) ? toOklch(hex.trim().toLowerCase())[0] : 0;
}

/** Too light for white writing on it (the app then writes in black on its buttons). */
export const isLightColour = (hex: string) => lightness(hex) > 0.68;

/** The ten shades for the app's colour (the teal when none is chosen). */
export function appShades(colour?: string): string[] {
  const hex = colour?.trim().toLowerCase();
  if (!isHexColour(hex) || hex === DEFAULT_APP_COLOUR) return [...TEAL];
  const [L, C, h] = toOklch(hex);
  return FROM_WHITE.map((f, i) => (i === 8 ? hex : fromOklch(1 - (1 - L) * f, C * CHROMA[i], h)));
}

/** For a light colour, a darker one of the same hue for writing in it on white (links, the chosen tab); else null. */
export function inkFor(colour?: string): string | null {
  const hex = colour?.trim().toLowerCase();
  if (!isHexColour(hex) || !isLightColour(hex)) return null;
  const [, C, h] = toOklch(hex);
  return fromOklch(0.47, C, h);
}
