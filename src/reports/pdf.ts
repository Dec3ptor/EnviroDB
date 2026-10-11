import type { Content, TDocumentDefinitions, TableCell } from 'pdfmake/interfaces';
import type { Cell, DocNode, ReportDoc, Run } from './model';
import { downloadBlob } from '../db/backup';

const MM = 2.834645669; // points per mm

type PdfMake = {
  createPdf(dd: TDocumentDefinitions): { download(name?: string): void; getBlob(cb: (b: Blob) => void): void };
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

function nodeContent(n: DocNode, doc: ReportDoc, contentWidthPt: number): Content[] {
  const t = doc.template;
  switch (n.t) {
    case 'title': {
      const out: Content[] = [];
      if (n.logo) out.push({ image: n.logo, fit: [70 * MM, 22 * MM], margin: [0, 0, 0, 10 * MM] });
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
      if (n.pageBreakAfter) out.push({ text: '', pageBreak: 'after' });
      return out;
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
      return [{ text: '', pageBreak: 'after' }];
    case 'image': {
      const w = Math.min(n.widthCm * 10 * MM, contentWidthPt);
      const out: Content[] = [];
      if (n.dataUrl) out.push({ image: n.dataUrl, width: w, margin: [0, 4, 0, 2] });
      if (n.caption) out.push({ text: n.caption, style: 'caption' });
      return [{ stack: out, unbreakable: true } as Content];
    }
    case 'table': {
      const out: Content[] = [];
      if (n.caption) out.push({ text: n.caption, style: 'tableCaption', keepWithNext: true } as Content);
      out.push({
        table: {
          headerRows: n.head.length,
          keepWithHeaderRows: 1,
          dontBreakRows: true,
          widths: n.widths.map((w) => (typeof w === 'number' ? w * MM : w)),
          body: [...n.head.map((r) => rowCells(r, true, t.accent)), ...n.body.map((r) => rowCells(r, false, t.accent))],
        },
        fontSize: n.fontSize ?? t.fontSize - 1,
        layout: {
          hLineWidth: () => 0.4,
          vLineWidth: () => 0.4,
          hLineColor: () => '#b9b9b9',
          vLineColor: () => '#b9b9b9',
          paddingLeft: () => 3,
          paddingRight: () => 3,
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

export function toPdfDefinition(doc: ReportDoc): TDocumentDefinitions {
  const t = doc.template;
  const pageW = (t.pageSize === 'A3' ? (t.orientation === 'landscape' ? 420 : 297) : t.orientation === 'landscape' ? 297 : 210) * MM;
  const margin = t.marginMm * MM;
  const contentWidth = pageW - 2 * margin;
  const titleOnOwnPage = doc.nodes[0]?.t === 'title' && doc.nodes[0].pageBreakAfter;
  return {
    pageSize: t.pageSize,
    pageOrientation: t.orientation,
    pageMargins: [margin, margin + 6, margin, margin + 4],
    info: { title: doc.title, author: doc.author, creator: 'EnviroDB' },
    header: (page: number) =>
      page === 1 && titleOnOwnPage
        ? null
        : ({ columns: [{ text: doc.header, alignment: 'left' }, { text: '', alignment: 'right' }], margin: [margin, margin / 2, margin, 0], fontSize: t.fontSize - 2, color: '#777777' } as Content),
    footer: (page: number, pages: number) =>
      ({ columns: [{ text: doc.footer, alignment: 'left' }, { text: `Page ${page} of ${pages}`, alignment: 'right' }], margin: [margin, 6, margin, 0], fontSize: t.fontSize - 2, color: '#777777' }) as Content,
    content: doc.nodes.flatMap((n) => nodeContent(n, doc, contentWidth)),
    defaultStyle: { font: 'Roboto', fontSize: t.fontSize, lineHeight: 1.2 },
    styles: {
      h1: { fontSize: t.fontSize + 5, bold: true, color: t.accent, margin: [0, 12, 0, 6] },
      h2: { fontSize: t.fontSize + 2.5, bold: true, color: t.accent, margin: [0, 10, 0, 4] },
      h3: { fontSize: t.fontSize + 1, bold: true, color: '#333333', margin: [0, 8, 0, 3] },
      caption: { fontSize: t.fontSize - 1.5, color: '#444444', margin: [0, 2, 0, 10] },
      tableCaption: { fontSize: t.fontSize - 1, bold: true, color: '#222222', margin: [0, 4, 0, 3] },
      note: { fontSize: t.fontSize - 2.5, color: '#555555' },
    },
    pageBreakBefore: (current) => current.headlineLevel === 1 && current.startPosition.verticalRatio > 0.85,
  };
}

export async function downloadPdf(doc: ReportDoc): Promise<void> {
  downloadBlob(await pdfBlob(doc), `${doc.fileName}.pdf`);
}

export async function pdfBlob(doc: ReportDoc): Promise<Blob> {
  const pdfMake = await loadPdfMake();
  return new Promise((resolve) => pdfMake.createPdf(toPdfDefinition(doc)).getBlob(resolve));
}
