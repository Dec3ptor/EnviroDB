import type { Content, TDocumentDefinitions, TableCell } from 'pdfmake/interfaces';
import type { Cell, DocNode, ReportDoc, Run } from './model';
import { CHART_GAP_MM, type Orientation } from './build';
import { downloadBlob } from '../db/backup';

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

const runs = (rs: Run[]) => rs.map((r) => ({ text: r.text, bold: r.bold, italics: r.italic }));

function cell(c: Cell, header: boolean, accent: string): TableCell {
  return {
    text: c.text,
    bold: header || c.bold,
    italics: c.italic,
    fillColor: header ? accent : c.fill,
    color: header ? '#ffffff' : c.color,
    alignment: c.align,
    colSpan: c.colSpan,
  } as TableCell;
}

function rowCells(row: Cell[], header: boolean, accent: string): TableCell[] {
  const out: TableCell[] = [];
  for (let i = 0; i < row.length; i++) {
    out.push(cell(row[i], header, accent));
    const span = row[i].colSpan ?? 1;
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
        } as Content);
      return out; // a title page's page break is applied to the content that follows (see toPdfDefinition)
    }
    case 'h':
      return [{ text: `${n.number ? `${n.number}  ` : ''}${n.text}`, style: `h${n.level}`, headlineLevel: n.level } as Content];
    case 'p':
      return [{ text: runs(n.runs), margin: [0, 0, 0, 6] }];
    case 'ul':
      return [{ ul: n.items.map((it) => ({ text: runs(it) })), margin: [0, 0, 0, 6] }];
    case 'note':
      return [{ text: n.text, style: 'note' }];
    case 'pagebreak':
      return []; // applied to the content that follows (see toPdfDefinition)
    case 'image': {
      const w = Math.min(n.widthCm * 10 * MM, contentWidthPt);
      const out: Content[] = [];
      if (n.dataUrl) out.push({ image: n.dataUrl, width: w, margin: [0, 4, 0, 2] });
      if (n.caption) out.push({ text: n.caption, style: 'caption' });
      return [{ stack: out, unbreakable: true } as Content];
    }
    case 'figures': {
      const gap = CHART_GAP_MM * MM;
      const max = (contentWidthPt - gap * (n.items.length - 1)) / Math.max(1, n.items.length);
      return [
        {
          stack: [
            {
              columns: n.items.map((it) => {
                const w = Math.min(it.widthCm * 10 * MM, max);
                const stack: Content[] = [];
                if (it.dataUrl) stack.push({ image: it.dataUrl, width: w, margin: [0, 4, 0, 2] });
                if (it.caption) stack.push({ text: it.caption, style: 'caption' });
                return { width: w, stack };
              }),
              columnGap: gap,
            },
          ],
          unbreakable: true,
        } as Content,
      ];
    }
    case 'table': {
      const out: Content[] = [];
      if (n.caption) out.push({ text: n.caption, style: 'tableCaption', headlineLevel: 9 } as Content); // 9 = table caption (kept with its table)
      out.push({
        table: {
          headerRows: n.head.length,
          keepWithHeaderRows: n.keepRows ?? 1,
          dontBreakRows: true,
          widths: fitWidths(n.widths, contentWidthPt),
          body: [...n.head.map((r) => rowCells(r, true, t.accent)), ...n.body.map((r) => rowCells(r, false, t.accent))],
        },
        fontSize: n.fontSize ?? t.fontSize - 1,
        layout: {
          hLineWidth: () => RULE_PT,
          vLineWidth: () => RULE_PT,
          hLineColor: () => '#b9b9b9',
          vLineColor: () => '#b9b9b9',
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
  const t = doc.template;
  const [w, h] = t.pageSize === 'A3' ? [297, 420] : [210, 297];
  return (o === 'landscape' ? h : w) * MM;
}

/**
 * The document content. Page breaks (including a title page's) are put on the content that follows them, so
 * that several breaks in a row never leave a blank page and a change of orientation starts the new page.
 */
function pdfContent(doc: ReportDoc): { content: Content[]; firstOrientation: Orientation } {
  const t = doc.template;
  const margin = t.marginMm * MM;
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
    const items = nodeContent(n, doc, pageWidthPt(doc, o) - 2 * margin);
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

export function toPdfDefinition(doc: ReportDoc): TDocumentDefinitions {
  const t = doc.template;
  const margin = t.marginMm * MM;
  const titleOnOwnPage = doc.nodes[0]?.t === 'title' && doc.nodes[0].pageBreakAfter;
  const { content, firstOrientation } = pdfContent(doc);
  return {
    pageSize: t.pageSize,
    pageOrientation: firstOrientation,
    pageMargins: [margin, margin + 6, margin, margin + 4],
    info: { title: doc.title, author: doc.author, creator: 'EnviroDB' },
    header: (page: number) =>
      page === 1 && titleOnOwnPage
        ? null
        : ({ columns: [{ text: doc.header, alignment: 'left' }, { text: '', alignment: 'right' }], margin: [margin, margin / 2, margin, 0], fontSize: t.fontSize - 2, color: '#777777' } as Content),
    footer: (page: number, pages: number) =>
      ({ columns: [{ text: doc.footer, alignment: 'left' }, { text: `Page ${page} of ${pages}`, alignment: 'right' }], margin: [margin, 6, margin, 0], fontSize: t.fontSize - 2, color: '#777777' }) as Content,
    content,
    defaultStyle: { font: 'Roboto', fontSize: t.fontSize, lineHeight: 1.2 },
    styles: {
      h1: { fontSize: t.fontSize + 5, bold: true, color: t.accent, margin: [0, 12, 0, 6] },
      h2: { fontSize: t.fontSize + 2.5, bold: true, color: t.accent, margin: [0, 10, 0, 4] },
      h3: { fontSize: t.fontSize + 1, bold: true, color: '#333333', margin: [0, 8, 0, 3] },
      caption: { fontSize: t.fontSize - 1.5, color: '#444444', margin: [0, 2, 0, 10] },
      tableCaption: { fontSize: t.fontSize - 1, bold: true, color: '#222222', margin: [0, 4, 0, 3] },
      note: { fontSize: t.fontSize - 2.5, color: '#555555' },
    },
    // Never leave a heading or table title alone at the bottom of a page: break before it when nothing but
    // other headings/titles (or a table that has moved to the next page) follows it on the same page.
    pageBreakBefore: (current, following) => {
      if (!current.headlineLevel) return false;
      const content = following.filter((n) => !n.table && !n.headlineLevel && !n.stack);
      return content.length === 0 || current.startPosition.verticalRatio > 0.92;
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

/** The PDF file's bytes (used for the on-screen preview). */
export async function pdfBytes(doc: ReportDoc): Promise<Uint8Array> {
  const pdfMake = await loadPdfMake();
  return new Promise((resolve) => pdfMake.createPdf(toPdfDefinition(doc)).getBuffer(resolve));
}
