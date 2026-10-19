import type { Content, TDocumentDefinitions, TableCell } from 'pdfmake/interfaces';
import type { LetterheadItem } from '../db/types';
import type { Cell, DocNode, PageLine, ReportDoc, Run } from './model';
import { CHART_GAP_MM, SIGN_GAP_MM, pageSizeMm, type Orientation } from './build';
import { downloadBlob } from '../db/backup';
import { fitCellSize } from './measure';

const MM = 2.834645669; // points per mm

type PdfMake = {
  createPdf(dd: TDocumentDefinitions): { download(name?: string): void; getBlob(cb: (b: Blob) => void): void; getBuffer(cb: (b: Uint8Array) => void): void };
  vfs?: Record<string, string>;
  addVirtualFileSystem?: (vfs: Record<string, string>) => void;
};

let pdfMakePromise: Promise<PdfMake> | null = null;
async function loadPdfMake(): Promise<PdfMake> {
  if (!pdfMakePromise) {
    pdfMakePromise = (async () => {
      const mod = (await import('pdfmake/build/pdfmake')) as unknown as { default?: PdfMake } & PdfMake;
      const fonts = (await import('pdfmake/build/vfs_fonts')) as unknown as { default?: Record<string, string> } & Record<string, unknown>;
      const pdfMake = mod.default ?? mod;
      const vfs = (fonts.default ?? (fonts as unknown as { pdfMake?: { vfs: Record<string, string> } }).pdfMake?.vfs ?? fonts) as Record<string, string>;
      if (pdfMake.addVirtualFileSystem) pdfMake.addVirtualFileSystem(vfs);
      else pdfMake.vfs = vfs;
      return pdfMake;
    })();
  }
  return pdfMakePromise;
}

/** Text runs; a reference ("Table 3") links to its table or figure. */
const runs = (rs: Run[]) => rs.map((r) => ({ text: r.text, bold: r.bold, italics: r.italic, ...(r.link ? { linkToDestination: r.link } : {}) }));
/** Where links to a caption or heading go. */
const dest = (anchor?: string) => (anchor ? { id: anchor } : {});
/** A link target at the top of a picture (its caption is under it, and a link shows the page from where it lands). */
const spot = (anchor?: string): Content[] => (anchor ? [{ text: ' ', id: anchor, fontSize: 1, lineHeight: 1 } as Content] : []);

/** A table of contents' pdfmake id: its headings, or one of its lists (Tables, Figures …). */
const tocId = (k: number, label?: string) => `contents${k}${label ? `-${label.replace(/\W+/g, '_')}` : ''}`;
type Listed = { ids: string[]; level: 1 | 2 | 3 };
const listedCache = new WeakMap<ReportDoc, Map<string, Listed>>();
/** The headings and captions in the report's tables of contents, by anchor: which ones each goes in, and its level. */
function listedIn(doc: ReportDoc): Map<string, Listed> {
  let m = listedCache.get(doc);
  if (!m) {
    const out = new Map<string, Listed>();
    const add = (anchor: string, id: string, level: 1 | 2 | 3) => {
      const e = out.get(anchor) ?? { ids: [], level };
      e.ids.push(id);
      out.set(anchor, e);
    };
    doc.nodes.filter((n) => n.t === 'toc').forEach((n, k) => {
      n.entries.forEach((e) => add(e.anchor, tocId(k), e.level));
      n.lists.forEach((l) => l.entries.forEach((e) => add(e.anchor, tocId(k, l.label), 1)));
    });
    listedCache.set(doc, (m = out));
  }
  return m;
}
/** A heading or caption in a table of contents: pdfmake lists it there, with its page number. */
function listed(doc: ReportDoc, anchor: string | undefined, heading = false): object {
  const e = anchor ? listedIn(doc).get(anchor) : undefined;
  if (!e) return {};
  // rows as close together as Word's (pdfmake adds 2pt above and below each)
  const top = heading && e.level === 1 ? 3 : 0;
  return { tocItem: e.ids, tocMargin: [heading ? (e.level - 1) * 12 : 0, top, 0, 0], tocStyle: { bold: heading && e.level === 1 && doc.look.style !== 'letter' } };
}

/** Table header rows: the accent colour with white text, light grey, or dark grey with white text. */
function headerLook(doc: ReportDoc): { fill: string; color: string } {
  switch (doc.look.tableHeader) {
    case 'grey':
      return { fill: '#EDEDED', color: '#1F1F1F' };
    case 'dark':
      return { fill: '#595959', color: '#FFFFFF' };
    default:
      return { fill: doc.look.accent, color: '#FFFFFF' };
  }
}

function cell(c: Cell, header: boolean, look: { fill: string; color: string }, fit?: { pt: number; widthPt: number }): TableCell {
  // a number (or word) wider than its column gets smaller, rather than breaking or spilling over
  const size = fit ? fitCellSize(c.text, fit.pt, fit.widthPt / MM, header || c.bold) : undefined;
  return {
    text: c.text,
    bold: header || c.bold,
    italics: c.italic,
    fillColor: header ? look.fill : c.fill,
    color: header ? look.color : c.color,
    alignment: c.align,
    colSpan: c.colSpan,
    ...(fit && size !== undefined && size < fit.pt ? { fontSize: size } : {}),
  } as TableCell;
}

/** A row's cells; with the columns' text widths (pt), each cell's text fits its column. */
function rowCells(row: Cell[], header: boolean, look: { fill: string; color: string }, fit?: { pt: number; widths: Array<number | '*' | 'auto'> }): TableCell[] {
  const out: TableCell[] = [];
  let col = 0;
  for (let i = 0; i < row.length; i++) {
    const span = Math.max(1, row[i].colSpan ?? 1);
    const ws = fit?.widths.slice(col, col + span) ?? [];
    const widthPt = ws.length === span && ws.every((w) => typeof w === 'number') ? (ws as number[]).reduce((a, w) => a + w, 0) + (span - 1) * (2 * CELL_PAD_PT + RULE_PT) : undefined;
    col += span;
    out.push(cell(row[i], header, look, fit && widthPt ? { pt: fit.pt, widthPt } : undefined));
    for (let k = 1; k < span; k++) out.push({} as TableCell);
    i += span - 1;
  }
  return out;
}

const CELL_PAD_PT = 3; // left and right cell padding (see table layout below)
const RULE_PT = 0.4;

/**
 * Column widths in points. The builder gives full column widths (mm, including padding); pdfmake wants the
 * content width only and adds padding + rules itself, so subtract them – otherwise the table runs off the page.
 */
function fitWidths(widths: Array<number | '*' | 'auto'>, contentWidthPt: number): Array<number | '*' | 'auto'> {
  const fixed = widths.reduce<number>((s, w) => s + (typeof w === 'number' ? w * MM : 0), 0);
  const flex = widths.filter((w) => typeof w !== 'number').length;
  const avail = contentWidthPt - RULE_PT - flex * (40 + 2 * CELL_PAD_PT + RULE_PT); // flexible columns keep 40pt of text
  const k = fixed > avail ? avail / fixed : 1;
  return widths.map((w) => (typeof w === 'number' ? Math.max(6, w * MM * k - 2 * CELL_PAD_PT - RULE_PT) : w));
}

function nodeContent(n: DocNode, doc: ReportDoc, contentWidthPt: number): Content[] {
  const t = doc.template;
  const letter = doc.look.style === 'letter';
  const gap = letter ? 8 : 6; // space after a paragraph
  switch (n.t) {
    case 'title': {
      const out: Content[] = [];
      if (n.logo) out.push({ image: n.logo.dataUrl, width: n.logo.widthMm * MM, height: n.logo.heightMm * MM, margin: [0, 0, 0, 10 * MM] });
      out.push({
        table: { widths: [4, '*'], body: [[{ text: '', fillColor: t.accent }, { stack: [{ text: n.title, fontSize: t.fontSize + 12, bold: true, color: t.accent }, ...(n.subtitle ? [{ text: n.subtitle, fontSize: t.fontSize + 4, color: '#333333', margin: [0, 4, 0, 0] }] : [])], margin: [10, 4, 0, 4] }]] },
        layout: 'noBorders',
        margin: [0, 18 * MM, 0, 12 * MM],
      } as Content);
      if (n.details.length)
        out.push({
          table: { widths: [45 * MM, '*'], body: n.details.map(([k, v]) => [{ text: k, color: '#555555' }, { text: v }]) },
          layout: { hLineWidth: () => 0, vLineWidth: () => 0, paddingTop: () => 3, paddingBottom: () => 3, paddingLeft: () => 0 },
          margin: [0, 0, 0, n.pageBreakAfter ? 0 : 10 * MM], // space before the text that follows on the same page
        } as Content);
      return out; // a title page's page break is applied to the content that follows (see toPdfDefinition)
    }
    case 'h':
      return [{ text: `${n.number ? `${n.number}  ` : ''}${n.text}`, style: `h${n.level}`, headlineLevel: n.level, ...dest(n.anchor), ...listed(doc, n.anchor, true) } as Content];
    case 'toc': {
      // pdfmake fills in the page numbers once the pages are laid out
      const k = doc.nodes.filter((x) => x.t === 'toc').indexOf(n);
      const look = { textStyle: { fontSize: t.fontSize }, numberStyle: { fontSize: t.fontSize } };
      const out: Content[] = [];
      if (n.title) out.push({ text: n.title, style: 'h1' });
      if (n.entries.length) out.push({ toc: { id: tocId(k), ...look }, margin: [0, 0, 0, 6] } as Content);
      for (const l of n.lists) {
        if (!l.entries.length) continue;
        // as Word's "TOC List Heading": bold, in the heading colour
        out.push({ text: l.title, bold: true, color: doc.look.headingColor, fontSize: t.fontSize + (letter ? 0 : 1), margin: [0, 12, 0, 3] });
        out.push({ toc: { id: tocId(k, l.label), ...look }, margin: [0, 0, 0, 6] } as Content);
      }
      return out;
    }
    case 'p':
      return n.quote ? [{ text: runs(n.runs), italics: true, margin: [5 * MM, 0, 0, gap] }] : [{ text: runs(n.runs), margin: [0, 0, 0, gap] }];
    case 'lines':
      return [{ stack: n.lines.map((l) => ({ text: runs(l) })), margin: [0, 0, 0, gap], unbreakable: true } as Content];
    case 'ul':
      return [{ ul: n.items.map((it) => ({ text: runs(it) })), margin: [0, 0, 0, gap] }];
    case 'note':
      return [{ text: n.text, style: 'note', margin: [0, 0, 0, 6] }];
    case 'pagebreak':
      return []; // applied to the content that follows (see toPdfDefinition)
    case 'space':
      return [{ text: '', margin: [0, 0, 0, n.mm * MM] } as Content];
    case 'image': {
      const w = Math.min(n.widthCm * 10 * MM, contentWidthPt);
      const out: Content[] = [...spot(n.anchor)];
      if (n.dataUrl) out.push({ image: n.dataUrl, width: w, margin: [0, 4, 0, 2] });
      if (n.caption) out.push({ text: n.caption, style: 'caption', ...listed(doc, n.anchor) } as Content);
      return [{ stack: out, unbreakable: true } as Content];
    }
    case 'figures': {
      const gapPt = CHART_GAP_MM * MM;
      const max = (contentWidthPt - gapPt * (n.items.length - 1)) / Math.max(1, n.items.length);
      return [
        {
          stack: [
            {
              columns: n.items.map((it) => {
                const w = Math.min(it.widthCm * 10 * MM, max);
                const stack: Content[] = [...spot(it.anchor)];
                if (it.dataUrl) stack.push({ image: it.dataUrl, width: w, margin: [0, 4, 0, 2] });
                if (it.caption) stack.push({ text: it.caption, style: 'caption', ...listed(doc, it.anchor) } as Content);
                return { width: w, stack };
              }),
              columnGap: gapPt,
            },
          ],
          unbreakable: true,
        } as Content,
      ];
    }
    case 'gallery': {
      // a row of images stays on one page; the group caption goes with the last row
      const colW = Math.min(n.colWidthMm * MM, (contentWidthPt - n.gapMm * MM * (n.perRow - 1)) / n.perRow);
      const k = colW / (n.colWidthMm * MM);
      const rows: Array<typeof n.items> = [];
      for (let i = 0; i < n.items.length; i += n.perRow) rows.push(n.items.slice(i, i + n.perRow));
      const picture = (it: (typeof n.items)[number]): Content => {
        const [w, h] = [it.widthMm * MM * k, it.heightMm * MM * k];
        const image = { image: it.dataUrl, width: w, height: h };
        const framed = n.border ? { table: { widths: [w], body: [[{ ...image, margin: [0, 0, 0, 0] }]] }, layout: { hLineWidth: () => 0.5, vLineWidth: () => 0.5, hLineColor: () => '#8c8c8c', vLineColor: () => '#8c8c8c', paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0 } } : image;
        return { columns: [{ width: '*', text: '' }, { width: 'auto', stack: [framed] }, { width: '*', text: '' }], columnGap: 0 } as Content;
      };
      return [
        {
          stack: rows.map((row, i) => {
            const last = i === rows.length - 1;
            return {
              stack: [
                ...(i === 0 ? spot(n.anchor) : []),
                {
                  columns: row.map((it) => ({ width: colW, stack: [...spot(it.anchor), picture(it), ...(it.caption ? [{ text: it.caption, style: 'caption', alignment: n.perRow > 1 ? 'center' : 'left', margin: [0, 3, 0, 0], ...listed(doc, it.anchor) }] : [])] })),
                  columnGap: n.gapMm * MM,
                },
                ...(last && n.caption ? [{ text: n.caption, style: 'caption', margin: [0, 4, 0, 0], ...listed(doc, n.anchor) }] : []),
              ],
              unbreakable: true,
              margin: [0, i ? 8 : 4, 0, last ? 10 : 0],
            };
          }),
        } as Content,
      ];
    }
    case 'signatures': {
      // the signatures sit on a common line, so the names line up whether or not there is a signature image
      const box = n.imageHeightMm * MM;
      const colW = n.colWidthMm * MM;
      const person = (s: (typeof n.items)[number]): Content => {
        const stack: Content[] = [];
        if (s.role) stack.push({ text: s.role, fontSize: t.fontSize - 1, color: '#555555' });
        if (s.image) stack.push({ image: s.image.dataUrl, width: s.image.widthMm * MM, height: s.image.heightMm * MM, margin: [0, box - s.image.heightMm * MM + 2, 0, 3] });
        else stack.push({ canvas: [{ type: 'line', x1: 0, y1: box + 2, x2: Math.min(colW, 60 * MM), y2: box + 2, lineWidth: 0.5, lineColor: '#777777' }], margin: [0, 0, 0, 3] });
        if (s.name) stack.push({ text: s.name, bold: true });
        for (const line of s.lines) stack.push({ text: runs(line), color: doc.look.textColor ?? '#333333' });
        if (s.date) stack.push({ text: `Date: ${s.date}`, fontSize: t.fontSize - 1, color: '#555555', margin: [0, 2, 0, 0] });
        return { width: colW, stack } as Content;
      };
      const rows = Array.from({ length: Math.ceil(n.items.length / n.cols) }, (_, i) => n.items.slice(i * n.cols, (i + 1) * n.cols));
      return [
        {
          stack: [...(n.closing ? [{ text: runs(n.closing), margin: [0, 0, 0, 2] }] : []), ...rows.map((row, i) => ({ columns: row.map(person), columnGap: SIGN_GAP_MM * MM, margin: [0, i ? 12 : 0, 0, 0] }))],
          unbreakable: true,
          margin: [0, n.closing ? 4 : 12, 0, 10],
        } as Content,
      ];
    }
    case 'table': {
      const out: Content[] = [];
      const head = headerLook(doc);
      const rule = letter ? '#404040' : '#b9b9b9';
      if (n.caption) out.push({ text: n.caption, style: 'tableCaption', headlineLevel: 9, ...dest(n.anchor), ...listed(doc, n.anchor) } as Content); // 9 = table caption (kept with its table)
      const colWidths = fitWidths(n.widths, contentWidthPt);
      const pt = n.fontSize ?? t.fontSize - 1;
      const fit = { pt, widths: colWidths };
      out.push({
        table: {
          headerRows: n.head.length,
          keepWithHeaderRows: n.keepRows ?? 1,
          dontBreakRows: true,
          widths: colWidths,
          body: [...n.head.map((r) => rowCells(r, true, head, fit)), ...n.body.map((r) => rowCells(r, false, head, fit))],
        },
        fontSize: pt,
        layout: {
          hLineWidth: () => RULE_PT,
          vLineWidth: () => RULE_PT,
          hLineColor: () => rule,
          vLineColor: () => rule,
          paddingLeft: () => CELL_PAD_PT,
          paddingRight: () => CELL_PAD_PT,
          paddingTop: () => 1.5,
          paddingBottom: () => 1.5,
        },
        margin: [0, 0, 0, n.notes?.length ? 2 : 8],
      } as Content);
      if (n.notes?.length) out.push({ stack: n.notes.map((x) => ({ text: x })), style: 'note', margin: [0, 0, 0, 8] });
      return out;
    }
  }
}

function pageWidthPt(doc: ReportDoc, o: Orientation): number {
  const [w, h] = pageSizeMm(doc.template);
  return (o === 'landscape' ? h : w) * MM;
}

/**
 * The document content. Page breaks (including a title page's) are put on the content that follows them, so
 * that several breaks in a row never leave a blank page and a change of orientation starts the new page.
 */
function pdfContent(doc: ReportDoc, sidesPt: number): { content: Content[]; firstOrientation: Orientation } {
  const t = doc.template;
  const out: Content[] = [];
  let orientation: Orientation = t.orientation;
  let firstOrientation: Orientation = t.orientation;
  let pending = null as { orientation?: Orientation } | null;
  for (const n of doc.nodes) {
    if (n.t === 'pagebreak') {
      pending = { orientation: n.orientation ?? pending?.orientation };
      continue;
    }
    const o = pending?.orientation ?? orientation;
    const items = nodeContent(n, doc, pageWidthPt(doc, o) - sidesPt);
    if (pending && items.length) {
      // a break before any content just sets the orientation of the first page
      if (out.length) items[0] = { ...(items[0] as object), pageBreak: 'before', pageOrientation: o } as Content;
      else firstOrientation = o;
      orientation = o;
      pending = null;
    }
    out.push(...items);
    if (n.t === 'title' && n.pageBreakAfter) pending = {};
  }
  return { content: out, firstOrientation };
}

// ------------------------------------------------------------ letterhead (logo, address and page numbers)

const itemHeightPt = (it: LetterheadItem) => (it.kind === 'image' ? it.heightMm * MM : Math.max(6, ...it.runs.map((r) => r.sizePt ?? 8)) * 1.2);

/** Height of a header or footer: its tallest column. */
const partHeightPt = (items: LetterheadItem[]) => Math.max(0, ...(['left', 'center', 'right'] as const).map((a) => items.filter((it) => it.align === a).reduce((s, it) => s + itemHeightPt(it), 0)));

function letterheadPart(items: LetterheadItem[], page: number, pages: number): Content {
  const show = (it: LetterheadItem): Content => {
    const dx = it.align === 'left' && it.dx ? it.dx * MM : 0;
    return it.kind === 'image'
      ? { image: it.dataUrl, width: it.widthMm * MM, height: it.heightMm * MM, margin: [dx, 0, 0, 0] }
      : { text: it.runs.map((r) => ({ text: r.text.replace(/\{page\}/g, String(page)).replace(/\{pages\}/g, String(pages)), color: r.color, fontSize: r.sizePt ?? 8, bold: r.bold, italics: r.italic })), lineHeight: 1, margin: [dx, 0, 0, 0] };
  };
  const col = (align: 'left' | 'center' | 'right') => items.filter((it) => it.align === align).map(show);
  const center = col('center');
  return {
    columns: [
      { width: '*', stack: col('left') },
      ...(center.length ? [{ width: '*', stack: center, alignment: 'center' }] : []),
      { width: '*', stack: col('right'), alignment: 'right' },
    ],
  } as Content;
}

const pageNo = (s: string, page: number, pages: number) => s.replace(/\{page\}/g, String(page)).replace(/\{pages\}/g, String(pages));
const hasText = (l: PageLine) => !!(l.left || l.center || l.right);

/** A header or footer line: left, centre and right (the centre one only when there is one, so the left has room). */
function pageLine(l: PageLine, page: number, pages: number): Content {
  return {
    columns: [
      { width: '*', text: pageNo(l.left, page, pages), alignment: 'left' },
      ...(l.center ? [{ width: '*', text: pageNo(l.center, page, pages), alignment: 'center' }] : []),
      { width: l.center ? '*' : 'auto', text: pageNo(l.right, page, pages), alignment: 'right' },
    ],
    columnGap: 8,
  } as Content;
}

export function toPdfDefinition(doc: ReportDoc): TDocumentDefinitions {
  const t = doc.template;
  const letter = doc.look.style === 'letter';
  const lh = doc.letterhead;
  const geo = doc.page;
  const heading = doc.look.headingColor;
  const text = doc.look.textColor;
  // Page margins. pdfmake has one set for every page, so a letterhead's tallest header and footer (often page 1's
  // address) decide them; the Word document keeps the letterhead's own margins.
  let margins: [number, number, number, number];
  let header: TDocumentDefinitions['header'];
  let footer: TDocumentDefinitions['footer'];
  const small = t.fontSize - 2;
  // the template's own header and footer lines – on a letterhead, under its header and above its footer, if wanted
  const shown = (page: number) => page > 1 || doc.pageTextFirst;
  if (lh) {
    const extra = doc.pageTextWithLetterhead;
    const lineH = small * 1.25 + 3;
    const addHead = extra && hasText(doc.header) ? lineH : 0;
    const addFoot = extra && hasText(doc.footer) ? lineH : 0;
    const heads = [lh.first.header, lh.other.header].map(partHeightPt);
    const feet = [lh.first.footer, lh.other.footer].map(partHeightPt);
    const top = Math.max(geo.top * MM, geo.header * MM + Math.max(...heads) + addHead + 4 * MM);
    const bottom = Math.max(geo.bottom * MM, geo.footer * MM + Math.max(...feet) + addFoot + 4 * MM);
    margins = [(geo.left + geo.indent) * MM, top, geo.right * MM, bottom];
    const own = (l: PageLine, page: number, pages: number, gap: [number, number]) => ({ ...(pageLine(l, page, pages) as object), fontSize: small, color: '#777777', margin: [0, gap[0], 0, gap[1]] }) as Content;
    header = (page: number, pages: number) => {
      const part = letterheadPart(page === 1 ? lh.first.header : lh.other.header, page, pages);
      const stack = addHead && shown(page) ? [part, own(doc.header, page, pages, [3, 0])] : [part];
      return { stack, margin: [geo.left * MM, geo.header * MM, geo.right * MM, 0] } as Content;
    };
    footer = (page: number, pages: number) => {
      const items = page === 1 ? lh.first.footer : lh.other.footer;
      const withLine = addFoot && shown(page);
      const h = partHeightPt(items) + (withLine ? lineH : 0);
      const stack = withLine ? [own(doc.footer, page, pages, [0, 3]), letterheadPart(items, page, pages)] : [letterheadPart(items, page, pages)];
      return { stack, margin: [geo.left * MM, Math.max(0, bottom - geo.footer * MM - h), geo.right * MM, 0] } as Content;
    };
  } else {
    const margin = t.marginMm * MM;
    margins = [margin, margin + 6, margin, margin + 4];
    header = (page: number, pages: number) => (shown(page) && hasText(doc.header) ? ({ ...(pageLine(doc.header, page, pages) as object), margin: [margin, margin / 2, margin, 0], fontSize: small, color: '#777777' } as Content) : null);
    footer = (page: number, pages: number) => (shown(page) && hasText(doc.footer) ? ({ ...(pageLine(doc.footer, page, pages) as object), margin: [margin, 6, margin, 0], fontSize: small, color: '#777777' } as Content) : null);
  }
  const { content, firstOrientation } = pdfContent(doc, margins[0] + margins[2]);
  return {
    pageSize: t.pageSize,
    pageOrientation: firstOrientation,
    pageMargins: margins,
    info: { title: doc.title, author: doc.author, creator: 'EnviroDB' },
    header,
    footer,
    content,
    defaultStyle: { font: 'Roboto', fontSize: t.fontSize, lineHeight: 1.2, color: text },
    styles: letter
      ? {
          // a letter: headings in regular weight, captions in italics
          h1: { fontSize: t.fontSize + 2, color: heading, margin: [0, 12, 0, 4] },
          h2: { fontSize: t.fontSize + 0.5, italics: true, color: heading, margin: [0, 10, 0, 3] },
          h3: { fontSize: t.fontSize, bold: true, color: text ?? '#222222', margin: [0, 8, 0, 3] },
          caption: { fontSize: t.fontSize - 0.5, italics: true, color: text ?? '#333333', margin: [0, 2, 0, 10] },
          tableCaption: { fontSize: t.fontSize - 0.5, italics: true, color: text ?? '#222222', margin: [0, 6, 0, 4] },
          note: { fontSize: t.fontSize - 2.5, color: '#555555' },
        }
      : {
          h1: { fontSize: t.fontSize + 5, bold: true, color: heading, margin: [0, 12, 0, 6] },
          h2: { fontSize: t.fontSize + 2.5, bold: true, color: heading, margin: [0, 10, 0, 4] },
          h3: { fontSize: t.fontSize + 1, bold: true, color: '#333333', margin: [0, 8, 0, 3] },
          caption: { fontSize: t.fontSize - 1.5, color: '#444444', margin: [0, 2, 0, 10] },
          tableCaption: { fontSize: t.fontSize - 1, bold: true, color: '#222222', margin: [0, 4, 0, 3] },
          note: { fontSize: t.fontSize - 2.5, color: '#555555' },
        },
    // Never leave a heading or table title alone at the bottom of a page: break before it when nothing but
    // other headings/titles (or a table that has moved to the next page) follows it on the same page.
    pageBreakBefore: (current, following) => {
      if (!current.headlineLevel) return false;
      const rest = following.filter((n) => !n.table && !n.headlineLevel && !n.stack);
      return rest.length === 0 || current.startPosition.verticalRatio > 0.92;
    },
  };
}

export async function downloadPdf(doc: ReportDoc): Promise<void> {
  downloadBlob(await pdfBlob(doc), `${doc.fileName}.pdf`);
}

export async function pdfBlob(doc: ReportDoc): Promise<Blob> {
  const pdfMake = await loadPdfMake();
  return new Promise((resolve) => pdfMake.createPdf(toPdfDefinition(doc)).getBlob(resolve));
}

/**
 * The page each heading and caption falls on in the PDF, by anchor. Word's contents start with these page numbers
 * (Word works out its own when it updates the fields on opening).
 */
export async function pdfPageNumbers(doc: ReportDoc): Promise<Record<string, number>> {
  const pdfMake = await loadPdfMake();
  const dd = toPdfDefinition(doc);
  await new Promise<void>((resolve) => pdfMake.createPdf(dd).getBuffer(() => resolve()));
  // pdfmake lays out the content in place: each node has its positions on the pages
  const out: Record<string, number> = {};
  const seen = new Set<object>();
  const walk = (v: unknown) => {
    if (!v || typeof v !== 'object' || seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) return v.forEach(walk);
    const o = v as Record<string, unknown>;
    const at = (o.positions as Array<{ pageNumber: number }> | undefined)?.[0];
    if (typeof o.id === 'string' && at && !(o.id in out)) out[o.id] = at.pageNumber;
    for (const [k, x] of Object.entries(o)) if (x && typeof x === 'object' && k !== 'positions' && !k.startsWith('_') && k !== 'image') walk(x);
  };
  walk(dd.content);
  return out;
}

/** The PDF file's bytes (used for the on-screen preview). */
export async function pdfBytes(doc: ReportDoc): Promise<Uint8Array> {
  const pdfMake = await loadPdfMake();
  return new Promise((resolve) => pdfMake.createPdf(toPdfDefinition(doc)).getBuffer(resolve));
}
