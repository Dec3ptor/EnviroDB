import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  PageBreak,
  PageNumber,
  PageOrientation,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TabStopPosition,
  TabStopType,
  TextRun,
  WidthType,
  type ISectionOptions,
} from 'docx';
import type { Cell, DocNode, ReportDoc, Run } from './model';
import { dataUrlToBytes } from '../charts/render';

const hex = (c?: string) => (c ? c.replace('#', '').toUpperCase() : undefined);
const TWIP_PER_MM = 56.6929;
const PX_PER_CM = 96 / 2.54;

function runs(rs: Run[], size: number): TextRun[] {
  return rs.map((r) => new TextRun({ text: r.text, bold: r.bold, italics: r.italic, size }));
}

const thin = { style: BorderStyle.SINGLE, size: 2, color: 'B9B9B9' };

function docCell(c: Cell, header: boolean, accent: string, size: number): TableCell {
  return new TableCell({
    columnSpan: c.colSpan,
    shading: header ? { type: ShadingType.CLEAR, color: 'auto', fill: hex(accent) } : c.fill ? { type: ShadingType.CLEAR, color: 'auto', fill: hex(c.fill) } : undefined,
    margins: { top: 20, bottom: 20, left: 60, right: 60 },
    borders: { top: thin, bottom: thin, left: thin, right: thin },
    children: [
      new Paragraph({
        alignment: c.align === 'right' ? AlignmentType.RIGHT : c.align === 'center' ? AlignmentType.CENTER : AlignmentType.LEFT,
        spacing: { before: 0, after: 0 },
        children: [new TextRun({ text: c.text, bold: header || c.bold, italics: c.italic, color: header ? 'FFFFFF' : hex(c.color), size })],
      }),
    ],
  });
}

function docRow(row: Cell[], header: boolean, accent: string, size: number): TableRow {
  const cells: TableCell[] = [];
  for (let i = 0; i < row.length; i++) {
    cells.push(docCell(row[i], header, accent, size));
    i += (row[i].colSpan ?? 1) - 1;
  }
  return new TableRow({ children: cells, tableHeader: header, cantSplit: true });
}

function nodeToDocx(n: DocNode, doc: ReportDoc, contentWidthMm: number): Array<Paragraph | Table> {
  const t = doc.template;
  const base = t.fontSize * 2; // half-points
  switch (n.t) {
    case 'title': {
      const out: Array<Paragraph | Table> = [];
      if (n.logo) {
        const type = n.logo.startsWith('data:image/jpeg') ? 'jpg' : 'png';
        out.push(new Paragraph({ children: [new ImageRun({ type, data: dataUrlToBytes(n.logo), transformation: { width: 220, height: 70 } })], spacing: { after: 300 } }));
      }
      out.push(new Paragraph({ spacing: { before: 1200, after: 120 }, border: { left: { style: BorderStyle.SINGLE, size: 36, color: hex(t.accent)!, space: 12 } }, children: [new TextRun({ text: n.title, bold: true, size: base + 24, color: hex(t.accent) })] }));
      if (n.subtitle) out.push(new Paragraph({ spacing: { after: 600 }, border: { left: { style: BorderStyle.SINGLE, size: 36, color: hex(t.accent)!, space: 12 } }, children: [new TextRun({ text: n.subtitle, size: base + 8, color: '333333' })] }));
      for (const [k, v] of n.details) {
        out.push(new Paragraph({ tabStops: [{ type: TabStopType.LEFT, position: 2600 }], spacing: { after: 60 }, children: [new TextRun({ text: k, color: '555555', size: base }), new TextRun({ text: `\t${v}`, size: base })] }));
      }
      if (n.pageBreakAfter) out.push(new Paragraph({ children: [new PageBreak()] }));
      return out;
    }
    case 'h':
      return [
        new Paragraph({
          heading: n.level === 1 ? HeadingLevel.HEADING_1 : n.level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
          keepNext: true,
          children: [new TextRun({ text: `${n.number ? `${n.number}  ` : ''}${n.text}` })],
        }),
      ];
    case 'p':
      return [new Paragraph({ children: runs(n.runs, base), spacing: { after: 120 } })];
    case 'ul':
      return n.items.map((it) => new Paragraph({ bullet: { level: 0 }, children: runs(it, base), spacing: { after: 60 } }));
    case 'note':
      return [new Paragraph({ children: [new TextRun({ text: n.text, size: base - 4, color: '555555' })] })];
    case 'pagebreak':
      return [new Paragraph({ children: [new PageBreak()] })];
    case 'image': {
      const out: Array<Paragraph | Table> = [];
      const wCm = Math.min(n.widthCm, contentWidthMm / 10);
      const hCm = n.heightCm * (wCm / n.widthCm);
      if (n.dataUrl) out.push(new Paragraph({ keepNext: true, spacing: { before: 120, after: 40 }, children: [new ImageRun({ type: 'png', data: dataUrlToBytes(n.dataUrl), transformation: { width: Math.round(wCm * PX_PER_CM), height: Math.round(hCm * PX_PER_CM) } })] }));
      if (n.caption) out.push(new Paragraph({ style: 'Caption', children: [new TextRun({ text: n.caption })] }));
      return out;
    }
    case 'table': {
      const size = Math.round((n.fontSize ?? t.fontSize - 1) * 2);
      const out: Array<Paragraph | Table> = [];
      if (n.caption) out.push(new Paragraph({ style: 'Caption', keepNext: true, children: [new TextRun({ text: n.caption, bold: true })] }));
      const fixed = n.widths.reduce<number>((s, w) => s + (typeof w === 'number' ? w : 0), 0);
      const flexCount = n.widths.filter((w) => typeof w !== 'number').length;
      const flex = flexCount ? Math.max(8, (contentWidthMm - fixed) / flexCount) : 0;
      const colsMm = n.widths.map((w) => (typeof w === 'number' ? w : flex));
      const totalMm = colsMm.reduce((s, x) => s + x, 0);
      const scale = Math.min(1, contentWidthMm / totalMm);
      out.push(
        new Table({
          layout: TableLayoutType.FIXED,
          width: { size: Math.round(Math.min(contentWidthMm, totalMm) * TWIP_PER_MM), type: WidthType.DXA },
          columnWidths: colsMm.map((mm) => Math.round(mm * scale * TWIP_PER_MM)),
          rows: [...n.head.map((r) => docRow(r, true, t.accent, size)), ...n.body.map((r) => docRow(r, false, t.accent, size))],
        }),
      );
      for (const x of n.notes ?? []) out.push(new Paragraph({ spacing: { after: 0 }, children: [new TextRun({ text: x, size: size - 2, color: '555555' })] }));
      out.push(new Paragraph({ children: [], spacing: { after: 120 } }));
      return out;
    }
  }
}

function styles(accent: string, fontSize: number) {
  const base = fontSize * 2;
  return {
    default: { document: { run: { font: 'Calibri', size: base } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: base + 10, bold: true, color: hex(accent) }, paragraph: { spacing: { before: 360, after: 120 } } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: base + 5, bold: true, color: hex(accent) }, paragraph: { spacing: { before: 240, after: 80 } } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: base + 2, bold: true, color: '333333' }, paragraph: { spacing: { before: 200, after: 60 } } },
      { id: 'Caption', name: 'Caption', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: base - 2, color: '333333' }, paragraph: { spacing: { before: 60, after: 120 } } },
    ],
  };
}

function section(doc: ReportDoc, children: Array<Paragraph | Table>): ISectionOptions {
  const t = doc.template;
  const [w, h] = t.pageSize === 'A3' ? [297, 420] : [210, 297];
  const small = (t.fontSize - 2) * 2;
  return {
    properties: {
      page: {
        size: { width: Math.round(w * TWIP_PER_MM), height: Math.round(h * TWIP_PER_MM), orientation: t.orientation === 'landscape' ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT },
        margin: { top: Math.round(t.marginMm * TWIP_PER_MM), bottom: Math.round(t.marginMm * TWIP_PER_MM), left: Math.round(t.marginMm * TWIP_PER_MM), right: Math.round(t.marginMm * TWIP_PER_MM) },
      },
      titlePage: doc.nodes[0]?.t === 'title' && doc.nodes[0].pageBreakAfter,
    },
    headers: { default: new Header({ children: [new Paragraph({ children: [new TextRun({ text: doc.header, size: small, color: '777777' })] })] }), first: new Header({ children: [new Paragraph({ children: [] })] }) },
    footers: {
      default: new Footer({
        children: [
          new Paragraph({
            tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
            children: [new TextRun({ text: doc.footer, size: small, color: '777777' }), new TextRun({ children: ['\tPage ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], size: small, color: '777777' })],
          }),
        ],
      }),
      first: new Footer({ children: [new Paragraph({ children: [] })] }),
    },
    children,
  };
}

export async function docxBlob(doc: ReportDoc): Promise<Blob> {
  const t = doc.template;
  const [w, h] = t.pageSize === 'A3' ? [297, 420] : [210, 297];
  const contentWidthMm = (t.orientation === 'landscape' ? h : w) - 2 * t.marginMm;
  const children = doc.nodes.flatMap((n) => nodeToDocx(n, doc, contentWidthMm));
  const d = new Document({ creator: 'EnviroDB', title: doc.title, description: doc.title, styles: styles(t.accent, t.fontSize), sections: [section(doc, children)] });
  return Packer.toBlob(d);
}

/** Quick Word document containing a list of graphs (from the graph builder). */
export async function chartsToDocx(title: string, subtitle: string, images: Array<{ title: string; dataUrl: string; widthCm: number; heightCm: number }>): Promise<Blob> {
  const children: Paragraph[] = [
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: title })] }),
    new Paragraph({ children: [new TextRun({ text: subtitle, color: '555555' })], spacing: { after: 240 } }),
  ];
  images.forEach((img, i) => {
    children.push(new Paragraph({ keepNext: true, children: [new ImageRun({ type: 'png', data: dataUrlToBytes(img.dataUrl), transformation: { width: Math.round(img.widthCm * PX_PER_CM), height: Math.round(img.heightCm * PX_PER_CM) } })] }));
    children.push(new Paragraph({ style: 'Caption', children: [new TextRun({ text: `Figure ${i + 1}: ${img.title}` })] }));
  });
  const d = new Document({ creator: 'EnviroDB', styles: styles('#0f766e', 10), sections: [{ children }] });
  return Packer.toBlob(d);
}
