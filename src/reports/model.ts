import type { ReportTemplate } from '../db/types';

export interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
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
  | { t: 'h'; level: 1 | 2 | 3; text: string; number?: string }
  | { t: 'p'; runs: Run[] }
  | { t: 'ul'; items: Run[][] }
  | { t: 'table'; caption?: string; head: Cell[][]; body: Cell[][]; widths: Array<number | '*' | 'auto'>; fontSize?: number; notes?: string[]; keepRows?: number }
  | { t: 'image'; dataUrl: string; widthCm: number; heightCm: number; caption?: string }
  /** Graphs side by side (two per row). */
  | { t: 'figures'; items: Array<{ dataUrl: string; widthCm: number; heightCm: number; caption?: string }> }
  | { t: 'note'; text: string }
  /** New page; `orientation` changes the orientation of the pages that follow. */
  | { t: 'pagebreak'; orientation?: 'portrait' | 'landscape' };

export interface ReportDoc {
  template: ReportTemplate;
  nodes: DocNode[];
  header: string;
  footer: string;
  title: string;
  author: string;
  fileName: string;
}

export const FILLS = {
  limit: '#F9D0D0',
  guideline: '#FDE7C2',
  check: '#E9E6F7',
  ok: '#DDF3DD',
  head: '#E6F2F0',
  guidelineRow: '#F3F3F1',
};

/** Parse simple markup: blank lines separate paragraphs, "- " lines are bullets, **bold**, *italic*. */
export function parseMarkup(text: string): DocNode[] {
  const out: DocNode[] = [];
  const blocks = text.replace(/\r/g, '').split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim() !== '');
    if (!lines.length) continue;
    let para: string[] = [];
    let bullets: Run[][] = [];
    const flushPara = () => {
      if (para.length) out.push({ t: 'p', runs: inline(para.join(' ')) });
      para = [];
    };
    const flushBullets = () => {
      if (bullets.length) out.push({ t: 'ul', items: bullets });
      bullets = [];
    };
    for (const line of lines) {
      const m = line.match(/^\s*(?:[-•*]|\d+[.)])\s+(.*)$/);
      if (m && !/^\s*\*\*/.test(line)) {
        flushPara();
        bullets.push(inline(m[1]));
      } else {
        flushBullets();
        para.push(line.trim());
      }
    }
    flushPara();
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
  ['period.start', 'Period start (long date)'],
  ['period.end', 'Period end (long date)'],
  ['period.label', 'Period label'],
  ['period.month', 'Month(s) of the period, e.g. September 2026'],
  ['today', "Today's date"],
  ['author', 'Your name (Settings)'],
  ['company', 'Company (Settings)'],
  ['count.samples', 'Number of samples in period'],
  ['count.sites', 'Number of sites sampled'],
  ['count.exceedances', 'Number of exceedances'],
  ['count.rules', 'Number of rules assessed'],
  ['count.rulesExceeded', 'Number of rules exceeded'],
];
