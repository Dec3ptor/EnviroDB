import type { Letterhead, ReportTemplate } from '../db/types';

export interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  /** A link to the table or figure with this anchor (a reference such as "Table 3"). */
  link?: string;
}

export interface Cell {
  text: string;
  bold?: boolean;
  italic?: boolean;
  fill?: string; // hex
  color?: string; // hex
  align?: 'left' | 'right' | 'center';
  colSpan?: number;
}

export type DocNode =
  | { t: 'title'; title: string; subtitle?: string; details: Array<[string, string]>; logo?: { dataUrl: string; widthMm: number; heightMm: number }; pageBreakAfter: boolean }
  | { t: 'h'; level: 1 | 2 | 3; text: string; number?: string; anchor?: string }
  /** A paragraph; `quote` = an indented quotation in italics, e.g. a consent condition. */
  | { t: 'p'; runs: Run[]; quote?: boolean }
  /** Lines kept together without space between them, e.g. an address. */
  | { t: 'lines'; lines: Run[][] }
  | { t: 'ul'; items: Run[][] }
  /** `anchor`: where links to this table (its caption) go. */
  | { t: 'table'; caption?: string; head: Cell[][]; body: Cell[][]; widths: Array<number | '*' | 'auto'>; fontSize?: number; notes?: string[]; keepRows?: number; anchor?: string }
  | { t: 'image'; dataUrl: string; widthCm: number; heightCm: number; caption?: string; anchor?: string }
  /** Graphs side by side (two per row). */
  | { t: 'figures'; items: Array<{ dataUrl: string; widthCm: number; heightCm: number; caption?: string; anchor?: string }> }
  /**
   * Images in rows of `perRow` columns, each fitted in its cell (sizes worked out by the builder), a caption under
   * each and optionally one for the group.
   */
  | { t: 'gallery'; perRow: number; colWidthMm: number; gapMm: number; border: boolean; items: Array<{ dataUrl: string; widthMm: number; heightMm: number; caption?: string; anchor?: string }>; caption?: string; anchor?: string }
  | { t: 'note'; text: string }
  /** Sign-off: signatories side by side, `cols` to a row; without an image a line is left to sign by hand. */
  | { t: 'signatures'; closing?: Run[]; cols: number; colWidthMm: number; imageHeightMm: number; items: Array<{ role: string; name: string; lines: Run[][]; date?: string; image?: { dataUrl: string; widthMm: number; heightMm: number } }> }
  /** New page; `orientation` changes the orientation of the pages that follow. */
  | { t: 'pagebreak'; orientation?: 'portrait' | 'landscape' }
  /** Blank space. */
  | { t: 'space'; mm: number };

/** Margins and the header / footer distances from the page edge, in mm. */
export interface PageGeometry {
  top: number;
  right: number;
  bottom: number;
  left: number;
  header: number;
  footer: number;
  /** Body text indent from the left margin (a letterhead's Normal style). */
  indent: number;
}

/** How the report looks, worked out from the template (and the letterhead it uses). */
export interface ReportLook {
  style: 'report' | 'letter';
  accent: string;
  /** Headings (the letterhead's heading colour, or the accent). */
  headingColor: string;
  textColor?: string;
  /** Fonts named in Word documents (PDFs use their own font). */
  font?: string;
  headingFont?: string;
  tableHeader: 'accent' | 'grey' | 'dark';
  highlight: 'fill' | 'text';
}

/** A commentary box the report asks for, beside the template's text sections – e.g. the summary under a site's table. */
export interface CommentaryField {
  key: string;
  label: string;
  /** The heading it comes under. */
  group: string;
  /** The text drafted from the results, used until it is edited. */
  auto: string;
}

export interface ReportDoc {
  template: ReportTemplate;
  nodes: DocNode[];
  header: string;
  footer: string;
  title: string;
  author: string;
  fileName: string;
  page: PageGeometry;
  look: ReportLook;
  /** The letterhead from Settings, for templates that use it. */
  letterhead?: Letterhead;
  commentary: CommentaryField[];
}

/** Red for exceedances shown as text, and purple for a detection limit above the limit. */
export const TEXT_FLAGS = { exceed: '#E00000', check: '#7A3DB8' };

export const FILLS = {
  limit: '#F9D0D0',
  guideline: '#FDE7C2',
  check: '#E9E6F7',
  ok: '#DDF3DD',
  head: '#E6F2F0',
  guidelineRow: '#F3F3F1',
};

/** Parse simple markup: blank lines separate paragraphs, "- " lines are bullets, "> " lines a quotation, **bold**, *italic*. */
export function parseMarkup(text: string): DocNode[] {
  const out: DocNode[] = [];
  const blocks = text.replace(/\r/g, '').split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim() !== '');
    if (!lines.length) continue;
    let para: string[] = [];
    let quote: string[] = [];
    let bullets: Run[][] = [];
    const flushPara = () => {
      if (para.length) out.push({ t: 'p', runs: inline(para.join(' ')) });
      para = [];
    };
    const flushQuote = () => {
      if (quote.length) out.push({ t: 'p', runs: inline(quote.join(' ')), quote: true });
      quote = [];
    };
    const flushBullets = () => {
      if (bullets.length) out.push({ t: 'ul', items: bullets });
      bullets = [];
    };
    for (const line of lines) {
      const m = line.match(/^\s*(?:[-•*]|\d+[.)])\s+(.*)$/);
      const q = line.match(/^\s*>\s?(.*)$/);
      if (q) {
        flushPara();
        flushBullets();
        quote.push(q[1].trim());
      } else if (m && !/^\s*\*\*/.test(line)) {
        flushPara();
        flushQuote();
        bullets.push(inline(m[1]));
      } else {
        flushBullets();
        flushQuote();
        para.push(line.trim());
      }
    }
    flushPara();
    flushQuote();
    flushBullets();
  }
  return out;
}

export function inline(text: string): Run[] {
  const runs: Run[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) runs.push({ text: text.slice(last, m.index) });
    const tok = m[0];
    if (tok.startsWith('**')) runs.push({ text: tok.slice(2, -2), bold: true });
    else runs.push({ text: tok.slice(1, -1), italic: true });
    last = m.index + tok.length;
  }
  if (last < text.length) runs.push({ text: text.slice(last) });
  return runs.length ? runs : [{ text: '' }];
}

export function fillPlaceholders(text: string, ctx: Record<string, string>): string {
  // {{fig:name}} and {{table:name}} are left for the report builder, which knows the numbers once it is done
  const filled = text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k: string) => ctx[k] ?? '');
  // tidy separators left dangling by empty placeholders, e.g. " · DEMO-001" or "Client –  · x"
  return filled
    .split('\n')
    .map((line) =>
      line
        .replace(/(\s[·|]\s*)+(?=\s[·|]\s)/g, '')
        .replace(/^\s*[·|]\s*/, '')
        .replace(/\s*[·|]\s*$/, ''),
    )
    .join('\n');
}

export const PLACEHOLDERS: Array<[string, string]> = [
  ['project.name', 'Project name'],
  ['project.code', 'Project / job number'],
  ['project.client', 'Client'],
  ['project.consents', 'Consent number(s)'],
  ['project.regulator', 'Regulator'],
  ['project.location', 'Location'],
  ['project.recipient', 'Who letters go to (name, position, address)'],
  ['project.salutation', 'Letter greeting, e.g. Dear David,'],
  ['period.start', 'Period start (long date)'],
  ['period.end', 'Period end (long date)'],
  ['period.label', 'The period, e.g. July 2025 to June 2026'],
  ['period.month', 'Month(s) of the period, e.g. September 2026'],
  ['today', "Today's date"],
  ['author', 'Your name (Settings)'],
  ['company', 'Company (Settings)'],
  ['count.samples', 'Number of samples in period'],
  ['count.sites', 'Number of sites sampled'],
  ['count.exceedances', 'Number of exceedances'],
  ['count.rules', 'Number of rules assessed'],
  ['count.rulesExceeded', 'Number of rules exceeded'],
  ['fig:name', 'Figure number of an image or graph named “name”'],
  ['table:name', 'Table number of a table section named “name”'],
];
