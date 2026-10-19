// A report template from a document of yours – a Word report or plan, a PDF of one, or a text outline: its headings
// become the template's headings, the sections EnviroDB fills in from the data (results, compliance, the monitoring
// programme …) go under the headings that call for them, and the document's own text can be kept as the starting
// text for each report.

import type { PdfPage } from '../importers/pdfTables';
import type { ReportBlock, ReportBlockType, ReportKind, ReportTemplate } from '../db/types';
import { uid } from '../lib/ids';
import { parseXml, type El } from './wordLetterhead';

export type OutlineItem =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'para'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'table'; rows: string[][] };

export interface DocOutline {
  title?: string;
  subtitle?: string;
  items: OutlineItem[];
  /** It has a table of contents. */
  contents?: boolean;
}

// ---------------------------------------------------------------- reading Word documents

const kids = (el: El | undefined, name?: string): El[] => (el ? (el.kids.filter((k) => typeof k !== 'string' && (!name || k.name === name)) as El[]) : []);
const kid = (el: El | undefined, name: string) => kids(el, name)[0];
function findEl(el: El | undefined, name: string): El | undefined {
  for (const k of kids(el)) {
    if (k.name === name) return k;
    const f = findEl(k, name);
    if (f) return f;
  }
  return undefined;
}
const attr = (el: El | undefined, a = 'w:val') => el?.attrs[a];

interface StyleInfo {
  name: string;
  outline?: number;
}

/** Paragraph styles: their names and outline levels (through the styles they're based on). */
function readStyles(xml: string | undefined): Map<string, StyleInfo> {
  const out = new Map<string, StyleInfo>();
  if (!xml) return out;
  const raw = new Map<string, { name: string; outline?: number; basedOn?: string }>();
  for (const st of kids(findEl(parseXml(xml), 'w:styles'), 'w:style')) {
    const id = st.attrs['w:styleId'];
    if (!id) continue;
    const lvl = attr(kid(kid(st, 'w:pPr'), 'w:outlineLvl'));
    raw.set(id, { name: attr(kid(st, 'w:name')) ?? id, outline: lvl === undefined ? undefined : Number(lvl), basedOn: attr(kid(st, 'w:basedOn')) });
  }
  for (const [id, st] of raw) {
    let outline = st.outline;
    let cur = st;
    for (let i = 0; outline === undefined && cur.basedOn && i < 10; i++) {
      const next = raw.get(cur.basedOn);
      if (!next) break;
      outline = next.outline;
      cur = next;
    }
    out.set(id, { name: st.name, outline });
  }
  return out;
}

/** A paragraph's text: its runs, hyperlinks and insertions (not deletions or field codes). */
function paraText(p: El): string {
  let s = '';
  const walk = (el: El) => {
    for (const k of el.kids) {
      if (typeof k === 'string') continue;
      if (k.name === 'w:t') s += k.kids.filter((x): x is string => typeof x === 'string').join('');
      else if (k.name === 'w:tab' || k.name === 'w:ptab') s += ' ';
      else if (k.name === 'w:br' || k.name === 'w:cr') s += '\n';
      else if (k.name === 'w:del' || k.name === 'w:delText' || k.name === 'w:instrText' || k.name === 'w:pPr' || k.name === 'w:rPr') continue;
      else walk(k);
    }
  };
  walk(p);
  return s.replace(/[  ]+/g, ' ').replace(/ ?\n ?/g, '\n').trim();
}

/** The headings, paragraphs, lists and tables of a Word document (.docx). */
export async function readWordOutline(data: ArrayBuffer | Uint8Array): Promise<DocOutline> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(data);
  const docXml = await zip.file('word/document.xml')?.async('string');
  if (!docXml) throw new Error('This doesn’t look like a Word document (.docx).');
  const styles = readStyles(await zip.file('word/styles.xml')?.async('string'));
  const out: DocOutline = { items: [] };
  const push = (item: OutlineItem) => out.items.push(item);
  const para = (p: El) => {
    const pPr = kid(p, 'w:pPr');
    const styleId = attr(kid(pPr, 'w:pStyle'));
    const st = styleId ? styles.get(styleId) : undefined;
    const name = (st?.name ?? styleId ?? '').toLowerCase();
    if (/^toc\b|toc heading|table of contents|table of figures/.test(name)) {
      out.contents = true;
      return;
    }
    if (/^caption$|^header$|^footer$/.test(name)) return;
    const text = paraText(p);
    if (!text) return;
    if (/^title$/.test(name)) {
      if (!out.title) out.title = text;
      return;
    }
    if (/^subtitle$/.test(name)) {
      if (!out.subtitle) out.subtitle = text;
      return;
    }
    const lvlOwn = attr(kid(pPr, 'w:outlineLvl'));
    const outline = lvlOwn !== undefined ? Number(lvlOwn) : st?.outline;
    const hm = name.match(/heading\s*(\d)/);
    const level = hm ? Number(hm[1]) : outline !== undefined && outline < 9 ? outline + 1 : 0;
    if (level) {
      push({ kind: 'heading', level: Math.min(3, Math.max(1, level)) as 1 | 2 | 3, text: text.replace(/\s+/g, ' ') });
      return;
    }
    if (kid(pPr, 'w:numPr') || /list|bullet/.test(name)) {
      const last = out.items[out.items.length - 1];
      if (last?.kind === 'list') last.items.push(text);
      else push({ kind: 'list', items: [text] });
      return;
    }
    push({ kind: 'para', text });
  };
  const table = (t: El) => {
    const rows = kids(t, 'w:tr').map((tr) => kids(tr, 'w:tc').map((tc) => kids(tc, 'w:p').map(paraText).filter(Boolean).join(' ')));
    if (rows.length) push({ kind: 'table', rows });
  };
  const walk = (el: El | undefined) => {
    for (const k of kids(el)) {
      if (k.name === 'w:p') para(k);
      else if (k.name === 'w:tbl') table(k);
      else if (k.name === 'w:sdt') walk(kid(k, 'w:sdtContent'));
      else if (k.name === 'w:customXml' || k.name === 'w:smartTag' || k.name === 'w:ins') walk(k);
    }
  };
  walk(findEl(parseXml(docXml), 'w:body'));
  return out;
}

// ---------------------------------------------------------------- reading PDFs and text

const NUMBERED = /^(\d{1,2}(?:\.\d{1,2}){0,3})\.?\s+(\S.*)$/;

/** Headings and paragraphs of a PDF, from where its words sit and how big they are. */
export function pdfOutline(pages: PdfPage[]): DocOutline {
  interface PLine {
    page: number;
    y: number;
    size: number;
    text: string;
  }
  const lines: PLine[] = [];
  pages.forEach((words, page) => {
    const sorted = words.filter((w) => w.str.trim()).sort((a, b) => b.y - a.y || a.x - b.x);
    let cur: { y: number; size: number; parts: Array<{ x: number; x1: number; s: string }> } | null = null;
    const flush = () => {
      if (!cur) return;
      const parts = cur.parts.sort((a, b) => a.x - b.x);
      let text = '';
      let x1 = -Infinity;
      for (const p of parts) {
        text += text && p.x - x1 > 0.8 ? ` ${p.s}` : p.s;
        x1 = p.x1;
      }
      lines.push({ page, y: cur.y, size: cur.size, text: text.replace(/\s+/g, ' ').trim() });
      cur = null;
    };
    for (const w of sorted) {
      if (cur && Math.abs(cur.y - w.y) <= 2.5) {
        cur.parts.push({ x: w.x, x1: w.x + w.w, s: w.str.trim() });
        cur.size = Math.max(cur.size, w.h);
      } else {
        flush();
        cur = { y: w.y, size: w.h, parts: [{ x: w.x, x1: w.x + w.w, s: w.str.trim() }] };
      }
    }
    flush();
  });
  // page headers and footers: the same line on most pages, or a page number
  const counts = new Map<string, number>();
  for (const l of lines) counts.set(l.text, (counts.get(l.text) ?? 0) + 1);
  const repeated = (t: string) => pages.length > 2 && (counts.get(t) ?? 0) >= Math.max(3, pages.length * 0.5);
  const body = lines.filter((l) => l.text && !repeated(l.text) && !/^(page\s*)?\d+(\s*(of|\/)\s*\d+)?$/i.test(l.text));
  // the size most of the text is in
  const bySize = new Map<number, number>();
  for (const l of body) bySize.set(Math.round(l.size), (bySize.get(Math.round(l.size)) ?? 0) + l.text.length);
  const bodySize = [...bySize].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 10;
  const headingSizes = [...new Set(body.filter((l) => l.size >= bodySize * 1.15).map((l) => Math.round(l.size)))].sort((a, b) => b - a);
  const out: DocOutline = { items: [] };
  let para: PLine | null = null;
  let paraText = '';
  const endPara = () => {
    if (para && paraText) out.items.push({ kind: 'para', text: paraText });
    para = null;
    paraText = '';
  };
  const isBullet = (t: string) => /^[•▪◦●–-]\s+/.test(t);
  for (const l of body) {
    const big = l.size >= bodySize * 1.15;
    const num = l.text.match(NUMBERED);
    const short = l.text.length <= 90 && !/[.,;:]$/.test(l.text);
    if (!out.title && !out.items.length && big && l.page === 0 && headingSizes[0] === Math.round(l.size)) {
      out.title = l.text;
      continue;
    }
    if ((big && short) || (num && short && l.text.split(' ').length <= 12 && /^[A-Z]/.test(num[2]))) {
      endPara();
      const level = num ? Math.min(3, num[1].split('.').length) : Math.min(3, Math.max(1, headingSizes.indexOf(Math.round(l.size)) + 1));
      out.items.push({ kind: 'heading', level: level as 1 | 2 | 3, text: num ? num[2] : l.text });
      continue;
    }
    if (isBullet(l.text)) {
      endPara();
      const t = l.text.replace(/^[•▪◦●–-]\s+/, '');
      const last = out.items[out.items.length - 1];
      if (last?.kind === 'list') last.items.push(t);
      else out.items.push({ kind: 'list', items: [t] });
      continue;
    }
    // a paragraph goes on while its lines follow closely
    const p: PLine | null = para;
    if (p && p.page === l.page && p.y - l.y <= l.size * 1.9) {
      paraText = paraText.endsWith('-') ? paraText.slice(0, -1) + l.text : `${paraText} ${l.text}`;
      para = l;
      continue;
    }
    const last = out.items[out.items.length - 1];
    // a wrapped bullet line
    if (!p && last?.kind === 'list' && !big) {
      last.items[last.items.length - 1] += ` ${l.text}`;
      continue;
    }
    endPara();
    para = l;
    paraText = l.text;
  }
  endPara();
  return out;
}

/** Headings ("# …", or numbered "2.1 Results"), bullets ("- …") and paragraphs of plain text or Markdown. */
export function textOutline(text: string): DocOutline {
  const out: DocOutline = { items: [] };
  for (const block of text.replace(/\r\n?/g, '\n').split(/\n\s*\n/)) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    let para: string[] = [];
    const endPara = () => {
      if (para.length) out.items.push({ kind: 'para', text: para.join(' ') });
      para = [];
    };
    for (const l of lines) {
      const md = l.match(/^(#{1,6})\s+(.*)$/);
      const num = l.match(NUMBERED);
      if (md || (num && l.length <= 80 && !/[.,;:]$/.test(l) && /^[A-Z]/.test(num[2]))) {
        endPara();
        const level = md ? md[1].length : num![1].split('.').length;
        const t = (md ? md[2] : num![2]).trim();
        if (md && level === 1 && !out.title && !out.items.length) out.title = t;
        else out.items.push({ kind: 'heading', level: Math.min(3, md ? Math.max(1, level - (out.title ? 1 : 0)) : level) as 1 | 2 | 3, text: t });
      } else if (/^[-*•]\s+/.test(l)) {
        endPara();
        const t = l.replace(/^[-*•]\s+/, '');
        const last = out.items[out.items.length - 1];
        if (last?.kind === 'list') last.items.push(t);
        else out.items.push({ kind: 'list', items: [t] });
      } else para.push(l);
    }
    endPara();
  }
  return out;
}

export async function readDocOutline(file: File): Promise<DocOutline> {
  const name = file.name.toLowerCase();
  if (/\.(docx|dotx|docm|dotm)$/.test(name)) return readWordOutline(await file.arrayBuffer());
  if (name.endsWith('.pdf')) {
    const { readPdfWords } = await import('../importers/pdfTables');
    return pdfOutline(await readPdfWords(await file.arrayBuffer()));
  }
  if (/\.(md|txt|markdown)$/.test(name)) return textOutline(await file.text());
  if (name.endsWith('.doc')) throw new Error('Old Word documents (.doc) can’t be read – save it as .docx in Word first.');
  throw new Error('Please choose a Word document (.docx), a PDF or a text file.');
}

// ---------------------------------------------------------------- the template it makes

/** The sections EnviroDB fills in from the data, and the headings that call for them (in order: first match wins). */
const SECTION_RULES: Array<{ re: RegExp; type: ReportBlockType }> = [
  { re: /executive summary|^summary\b|summary of (the )?(results|monitoring|findings)|key findings/, type: 'summary' },
  { re: /non-?compliance|exceedances?|incidents?|breach/, type: 'exceedances' },
  { re: /compliance/, type: 'complianceTable' },
  { re: /trigger|tarp|response (plan|actions?)|contingency|action levels?/, type: 'tarpTable' },
  { re: /(monitoring|sampling) (programme|program|plan|schedule|requirements|regime|frequency)|frequency of (monitoring|sampling)/, type: 'programmeTable' },
  { re: /^reporting\b|reporting (requirements|obligations)/, type: 'reportingTable' },
  { re: /(sampling|monitoring) (locations?|sites?|points?)|site locations?|^(sites?|locations?)$/, type: 'siteTable' },
  { re: /samples? (collected|taken)|sampling (undertaken|completed|events?|rounds?)|monitoring undertaken|field ?work/, type: 'samplingTable' },
  { re: /statistic/, type: 'statsTable' },
  { re: /graphs?\b|trends?\b|time ?series|charts?\b/, type: 'chart' },
  { re: /photo|figures?\b|site plans?\b|maps?\b/, type: 'figures' },
  { re: /results|analytical|laborator(y|ies)|water quality|monitoring data|^data$/, type: 'resultsTable' },
  { re: /sign[- ]?off|signatures?|approval|prepared by|authoris/, type: 'signatures' },
];

/** The sections a heading can have under it, for choosing. */
export const DOC_SECTION_TYPES: ReportBlockType[] = ['summary', 'complianceTable', 'exceedances', 'triggerTable', 'tarpTable', 'resultsTable', 'roundTable', 'statsTable', 'calc', 'chart', 'figures', 'siteTable', 'samplingTable', 'programmeTable', 'reportingTable', 'signatures'];

export interface DocSection {
  heading: string;
  level: 1 | 2 | 3;
  /** Its text, as the template's text markup (paragraphs, "- " bullets). */
  text: string;
  /** Tables in the document under it (EnviroDB makes its tables from the data). */
  tables: number;
  /** The section from the data to go under it. */
  section: ReportBlockType | null;
}

export interface DocPlan {
  title?: string;
  subtitle?: string;
  /** Text before the first heading. */
  intro: string;
  sections: DocSection[];
  /** A letter: it greets someone ("Dear …"). */
  letter: boolean;
  /** The greeting and the closing, kept out of the text. */
  closing?: string;
  kind: ReportKind;
  tables: number;
  /** It has a table of contents. */
  contents?: boolean;
}

const markup = (items: OutlineItem[]) =>
  items
    .flatMap((i) => (i.kind === 'para' ? [i.text] : i.kind === 'list' ? [i.items.map((x) => `- ${x}`).join('\n')] : []))
    .join('\n\n');

export function kindOfDocument(text: string, letter: boolean): ReportKind {
  const t = text.toLowerCase();
  if (/management plan|monitoring plan|\b(e|es|cm|ss|wm)mp\b/.test(t)) return 'management-plan';
  if (/site investigation|contaminat|remediation|\b(d|p)si\b|soil validation|waste acceptance|hail\b/.test(t)) return 'investigation';
  if (/ecolog|habitat|vegetation|invertebrate|\bfish\b|edna|\bbird|lizard|wetland|riparian|macrophyte/.test(t)) return 'ecology';
  if (letter) return 'letter';
  return 'monitoring';
}

/** What a document's outline makes: its headings, their text and the data section each calls for. */
export function planFromOutline(outline: DocOutline): DocPlan {
  const items = [...outline.items];
  let letter = false;
  let closing: string | undefined;
  // a letter: the greeting and what's above it (the address) and the closing are the letter's own parts
  const greet = items.findIndex((i, k) => k < 15 && i.kind === 'para' && /^dear\b/i.test(i.text));
  if (greet >= 0 && !items.slice(0, greet).some((i) => i.kind === 'heading')) {
    letter = true;
    items.splice(0, greet + 1);
  }
  const closeAt = items.findIndex((i) => i.kind === 'para' && /^(yours (sincerely|faithfully)|kind regards|regards|ng[aā] mihi|nā m[aā]tou)/i.test(i.text));
  if (letter && closeAt >= 0) {
    closing = (items[closeAt] as { text: string }).text.split('\n')[0];
    items.splice(closeAt); // the signature block and what follows it
  }
  // a table of contents: its title, and the lines under it ("2.1 Results ....... 7") – the template makes its own
  let contents = !!outline.contents;
  const tocAt = items.findIndex((i) => (i.kind === 'heading' || i.kind === 'para') && /^(table of )?contents$/i.test(i.text.trim()));
  if (tocAt >= 0) {
    contents = true;
    let end = tocAt + 1;
    const tocLine = (i: OutlineItem) => (i.kind === 'heading' || i.kind === 'para') && i.text.length < 160 && /(\.{3,}|…)\s*\d+$|\s\d{1,3}$/.test(i.text.trim());
    while (end < items.length && tocLine(items[end])) end++;
    items.splice(tocAt, end - tocAt);
  }
  const firstHeading = items.findIndex((i) => i.kind === 'heading');
  const introItems = firstHeading < 0 ? items : items.slice(0, firstHeading);
  const sections: DocSection[] = [];
  const used = new Set<ReportBlockType>();
  let tables = 0;
  for (let k = firstHeading < 0 ? items.length : firstHeading; k < items.length; k++) {
    const h = items[k];
    if (h.kind !== 'heading') continue;
    const body: OutlineItem[] = [];
    let j = k + 1;
    for (; j < items.length && items[j].kind !== 'heading'; j++) body.push(items[j]);
    const t = h.text.toLowerCase().replace(/^\d+(\.\d+)*\.?\s*/, '');
    const rule = SECTION_RULES.find((r) => r.re.test(t) && !used.has(r.type));
    if (rule) used.add(rule.type);
    const n = body.filter((b) => b.kind === 'table').length;
    tables += n;
    sections.push({ heading: h.text.replace(/^\d+(\.\d+)*\.?\s+/, ''), level: h.level, text: markup(body), tables: n, section: rule?.type ?? null });
  }
  tables += introItems.filter((i) => i.kind === 'table').length;
  const all = [outline.title, outline.subtitle, ...sections.map((s) => s.heading)].join(' ');
  return { title: outline.title, subtitle: outline.subtitle, intro: markup(introItems), sections, letter, closing, kind: kindOfDocument(all, letter), tables, contents: contents && !letter };
}

/** A data section as the template's starting block (built like the editor's new sections). */
type NewBlock = (type: ReportBlockType) => ReportBlock;

/**
 * The template: a title page (or a letter opening), then each heading with its text (kept as the starting text,
 * filled in for each report) and the section from the data chosen for it, and a sign-off.
 */
export function templateFromPlan(plan: DocPlan, opts: { name: string; fileName: string; keepText: boolean; newBlock: NewBlock }): ReportTemplate {
  const { newBlock } = opts;
  const blocks: ReportBlock[] = [];
  const text = (t: string): ReportBlock => ({ id: uid('b'), type: 'text', text: t, prompt: true });
  if (plan.letter) {
    blocks.push(newBlock('letter'));
  } else {
    const title = newBlock('title') as Extract<ReportBlock, { type: 'title' }>;
    blocks.push({ ...title, subtitle: plan.subtitle || plan.title || title.subtitle });
    if (plan.contents) blocks.push(newBlock('toc'));
  }
  if (opts.keepText && plan.intro) blocks.push(text(plan.intro));
  let signed = false;
  plan.sections.forEach((s, i) => {
    blocks.push({ id: uid('b'), type: 'heading', text: s.heading, level: s.level });
    // a heading over sub-headings needs nothing of its own
    const parent = (plan.sections[i + 1]?.level ?? 0) > s.level;
    if (opts.keepText && s.text) blocks.push(text(s.text));
    else if (!opts.keepText && !s.section && !parent) blocks.push(text(`Write about ${s.heading.toLowerCase()} here.`));
    if (s.section) {
      blocks.push(newBlock(s.section));
      if (s.section === 'signatures') signed = true;
    }
  });
  if (!signed) {
    const sign = newBlock('signatures') as Extract<ReportBlock, { type: 'signatures' }>;
    blocks.push(plan.letter ? { ...sign, closing: plan.closing ?? 'Kind regards,', signatories: sign.signatories.slice(0, 1).map((x) => ({ ...x, role: '' })) } : sign);
  }
  return {
    id: uid('tpl'),
    name: opts.name,
    description: `Made from ${opts.fileName}`,
    kind: plan.kind,
    orientation: 'portrait',
    pageSize: 'A4',
    marginMm: 20,
    fontSize: 10,
    accent: '#0f766e',
    headerText: plan.letter ? '' : '[project]',
    footerText: plan.letter ? '[company]' : '[company] · [project code]',
    numbering: true,
    ...(plan.letter ? { style: 'letter' as const, letterhead: true, tableHeader: 'grey' as const, highlightStyle: 'text' as const, numberHeadings: false } : {}),
    blocks,
    updatedAt: new Date().toISOString(),
  };
}
