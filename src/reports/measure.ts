// Approximate text widths for the report font (Roboto), used to size table columns so they fit the page.
// Widths are in em (fraction of the font size).

const NARROW = new Set(['.', ',', ':', ';', '|', "'", '!', 'i', 'l', 'j', 'I', '(', ')', '[', ']']);
const SPACE = 0.25;

function charEm(ch: string): number {
  if (ch === ' ') return SPACE;
  if (NARROW.has(ch)) return 0.26;
  if (/[0-9]/.test(ch)) return 0.562;
  if (ch === '/' || ch === '-' || ch === 'r' || ch === 't' || ch === 'f') return 0.37;
  if (ch === '<' || ch === '>' || ch === '=' || ch === '+') return 0.51;
  if (ch === '–' || ch === '—' || ch === 'm' || ch === 'w' || ch === 'M' || ch === 'W' || ch === '%') return 0.82;
  if (/[A-Z]/.test(ch)) return 0.65;
  if (ch === 'µ' || /[a-z]/.test(ch)) return 0.53;
  return 0.56;
}

const PT_TO_MM = 0.3528;

/** Width of a single line of text in millimetres. */
export function textWidthMm(text: string, pt: number, bold = false): number {
  let em = 0;
  for (const ch of text) em += charEm(ch);
  return em * pt * PT_TO_MM * (bold ? 1.06 : 1) * 1.04; // small headroom for rounding / font hinting
}

/** Width of the longest word – the narrowest a column can be before a word has to break. */
export function longestWordMm(text: string, pt: number, bold = false): number {
  return Math.max(0, ...text.split(/\s+/).map((w) => textWidthMm(w, pt, bold)));
}

/**
 * How much wider than Roboto a font named in Word documents sets text, so columns sized for the PDF don't wrap in
 * Word (Montserrat, for one, is much wider).
 */
export function fontWidthFactor(font?: string): number {
  if (!font) return 1;
  if (/montserrat|verdana|tahoma/i.test(font)) return 1.2;
  if (/arial|helvetica|segoe|open sans|lato|source sans/i.test(font)) return 1.06;
  if (/calibri|carlito|aptos|roboto/i.test(font)) return 1;
  return 1.1;
}

/** Cell padding + borders used by the PDF and Word renderers (mm). */
export const CELL_PAD_MM = 2.4;
