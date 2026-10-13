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
  TableBorders,
  TableCell,
  TableLayoutType,
  TableRow,
  TabStopPosition,
  TabStopType,
  TextRun,
  WidthType,
  type ISectionOptions,
} from 'docx';
import type { LetterheadItem } from '../db/types';
import type { Cell, DocNode, ReportDoc, Run } from './model';
import { dataUrlToBytes } from '../charts/render';
import { CHART_GAP_MM, SIGN_GAP_MM, pageSizeMm, type Orientation } from './build';

const hex = (c?: string) => (c ? c.replace('#', '').toUpperCase() : undefined);
const TWIP_PER_MM = 56.6929;
const PX_PER_CM = 96 / 2.54;
const twips = (mm: number) => Math.round(mm * TWIP_PER_MM);
const px = (mm: number) => Math.round((mm / 25.4) * 96); // docx sizes images in pixels at 96 dpi
const imageType = (dataUrl: string) => (dataUrl.startsWith('data:image/jpeg') ? 'jpg' : 'png');

/** What every part of the document needs to know: the look, and the body text indent of a letterhead. */
interface Ctx {
  doc: ReportDoc;
  letter: boolean;
  /** Body indent from the left margin, in twips (a letterhead's Normal style). */
  indent: number;
  head: { fill: string; color: string };
  rule: string;
  text?: string;
}

function runs(rs: Run[], size: number, italics?: boolean): TextRun[] {
  return rs.map((r) => new TextRun({ text: r.text, bold: r.bold, italics: r.italic || italics, size }));
}

function headerLook(doc: ReportDoc): { fill: string; color: string } {
  switch (doc.look.tableHeader) {
    case 'grey':
      return { fill: 'EDEDED', color: '1F1F1F' };
    case 'dark':
      return { fill: '595959', color: 'FFFFFF' };
    default:
      return { fill: hex(doc.look.accent)!, color: 'FFFFFF' };
  }
}

function docCell(c: Cell, header: boolean, x: Ctx, size: number): TableCell {
  const thin = { style: BorderStyle.SINGLE, size: 2, color: x.rule };
  return new TableCell({
    columnSpan: c.colSpan,
    shading: header ? { type: ShadingType.CLEAR, color: 'auto', fill: x.head.fill } : c.fill ? { type: ShadingType.CLEAR, color: 'auto', fill: hex(c.fill) } : undefined,
    margins: { top: 20, bottom: 20, left: 60, right: 60 },
    borders: { top: thin, bottom: thin, left: thin, right: thin },
    children: [
      new Paragraph({
        alignment: c.align === 'right' ? AlignmentType.RIGHT : c.align === 'center' ? AlignmentType.CENTER : AlignmentType.LEFT,
        spacing: { before: 0, after: 0 },
        indent: { left: 0 },
        children: c.text.split('\n').map((text, i) => new TextRun({ text, break: i ? 1 : undefined, bold: header || c.bold, italics: c.italic, color: header ? x.head.color : hex(c.color), size })),
      }),
    ],
  });
}

function docRow(row: Cell[], header: boolean, x: Ctx, size: number): TableRow {
  const cells: TableCell[] = [];
  for (let i = 0; i < row.length; i++) {
    cells.push(docCell(row[i], header, x, size));
    i += (row[i].colSpan ?? 1) - 1;
  }
  return new TableRow({ children: cells, tableHeader: header, cantSplit: true });
}

const image = (dataUrl: string, widthMm: number, heightMm: number, border = false) =>
  new ImageRun({
    type: imageType(dataUrl),
    data: dataUrlToBytes(dataUrl),
    transformation: { width: px(widthMm), height: px(heightMm) },
    ...(border ? { outline: { type: 'solidFill' as const, solidFillType: 'rgb' as const, value: '8C8C8C', width: 6350 } } : {}),
  });

function nodeToDocx(n: DocNode, x: Ctx, contentWidthMm: number): Array<Paragraph | Table> {
  const { doc, letter, indent } = x;
  const t = doc.template;
  const base = t.fontSize * 2; // half-points
  const after = letter ? 160 : 120; // space after a paragraph
  const ind = indent ? { left: indent } : undefined;
  const tableIndent = indent ? { size: indent, type: WidthType.DXA } : undefined;
  switch (n.t) {
    case 'title': {
      const out: Array<Paragraph | Table> = [];
      if (n.logo) out.push(new Paragraph({ children: [image(n.logo.dataUrl, n.logo.widthMm, n.logo.heightMm)], spacing: { after: 300 } }));
      out.push(new Paragraph({ spacing: { before: 1200, after: 120 }, border: { left: { style: BorderStyle.SINGLE, size: 36, color: hex(t.accent)!, space: 12 } }, children: [new TextRun({ text: n.title, bold: true, size: base + 24, color: hex(t.accent) })] }));
      if (n.subtitle) out.push(new Paragraph({ spacing: { after: 600 }, border: { left: { style: BorderStyle.SINGLE, size: 36, color: hex(t.accent)!, space: 12 } }, children: [new TextRun({ text: n.subtitle, size: base + 8, color: '333333' })] }));
      for (const [k, v] of n.details) {
        out.push(new Paragraph({ tabStops: [{ type: TabStopType.LEFT, position: 2600 }], spacing: { after: 60 }, children: [new TextRun({ text: k, color: '555555', size: base }), new TextRun({ text: `\t${v}`, size: base })] }));
      }
      if (n.pageBreakAfter) out.push(new Paragraph({ children: [new PageBreak()] }));
      else out.push(new Paragraph({ spacing: { after: 240 } })); // space before the text that follows on the same page
      return out;
    }
    case 'h':
      return [
        new Paragraph({
          heading: n.level === 1 ? HeadingLevel.HEADING_1 : n.level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
          keepNext: true,
          indent: ind,
          children: [new TextRun({ text: `${n.number ? `${n.number}  ` : ''}${n.text}` })],
        }),
      ];
    case 'p':
      return [new Paragraph({ children: runs(n.runs, base, n.quote), spacing: { after }, indent: n.quote ? { left: indent + twips(5) } : ind })];
    case 'lines':
      // an address: no space between the lines, kept together
      return n.lines.map((l, i) => new Paragraph({ children: runs(l, base), spacing: { after: i === n.lines.length - 1 ? after : 0 }, keepNext: i < n.lines.length - 1, keepLines: true, indent: ind }));
    case 'ul':
      return n.items.map((it) => new Paragraph({ bullet: { level: 0 }, children: runs(it, base), spacing: { after: 60 }, ...(indent ? { indent: { left: 720 + indent, hanging: 360 } } : {}) }));
    case 'note':
      return [new Paragraph({ children: [new TextRun({ text: n.text, size: base - 4, color: '555555' })], indent: ind })];
    case 'pagebreak':
      return [new Paragraph({ children: [new PageBreak()] })];
    case 'image': {
      const out: Array<Paragraph | Table> = [];
      const wCm = Math.min(n.widthCm, contentWidthMm / 10);
      const hCm = n.heightCm * (wCm / n.widthCm);
      if (n.dataUrl) out.push(new Paragraph({ keepNext: true, spacing: { before: 120, after: 40 }, indent: ind, children: [new ImageRun({ type: 'png', data: dataUrlToBytes(n.dataUrl), transformation: { width: Math.round(wCm * PX_PER_CM), height: Math.round(hCm * PX_PER_CM) } })] }));
      if (n.caption) out.push(new Paragraph({ style: 'Caption', indent: ind, children: [new TextRun({ text: n.caption })] }));
      return out;
    }
    case 'figures': {
      // graphs side by side: a borderless table, one cell per graph
      const cols = n.items.length;
      const colMm = Math.min(...n.items.map((it) => it.widthCm * 10), (contentWidthMm - CHART_GAP_MM * (cols - 1)) / cols);
      const cellMm = (i: number) => colMm + (i < cols - 1 ? CHART_GAP_MM : 0);
      const cells = n.items.map((it, i) => {
        const wCm = Math.min(it.widthCm, colMm / 10);
        const hCm = it.heightCm * (wCm / it.widthCm);
        const children: Paragraph[] = [];
        if (it.dataUrl) children.push(new Paragraph({ spacing: { before: 120, after: 40 }, indent: { left: 0 }, children: [new ImageRun({ type: 'png', data: dataUrlToBytes(it.dataUrl), transformation: { width: Math.round(wCm * PX_PER_CM), height: Math.round(hCm * PX_PER_CM) } })] }));
        if (it.caption) children.push(new Paragraph({ style: 'Caption', indent: { left: 0 }, children: [new TextRun({ text: it.caption })] }));
        return new TableCell({ width: { size: Math.round(cellMm(i) * TWIP_PER_MM), type: WidthType.DXA }, margins: { left: 0, right: i < cols - 1 ? Math.round(CHART_GAP_MM * TWIP_PER_MM) : 0 }, children: children.length ? children : [new Paragraph({})] });
      });
      return [
        new Table({
          layout: TableLayoutType.FIXED,
          borders: TableBorders.NONE,
          indent: tableIndent,
          width: { size: Math.round(n.items.reduce((s, _, i) => s + cellMm(i), 0) * TWIP_PER_MM), type: WidthType.DXA },
          columnWidths: n.items.map((_, i) => Math.round(cellMm(i) * TWIP_PER_MM)),
          rows: [new TableRow({ children: cells, cantSplit: true })],
        }),
        new Paragraph({ children: [], spacing: { after: 60 } }),
      ];
    }
    case 'gallery': {
      // images in a borderless table, `perRow` to a row; a row is never split over two pages
      const k = Math.min(1, (contentWidthMm - n.gapMm * (n.perRow - 1)) / n.perRow / n.colWidthMm);
      const colMm = n.colWidthMm * k;
      const cellMm = (i: number) => colMm + (i < n.perRow - 1 ? n.gapMm : 0);
      const rows: TableRow[] = [];
      for (let i = 0; i < n.items.length; i += n.perRow) {
        const row = n.items.slice(i, i + n.perRow);
        rows.push(
          new TableRow({
            cantSplit: true,
            children: Array.from({ length: n.perRow }, (_, c) => {
              const it = row[c];
              const children: Paragraph[] = [];
              if (it) {
                children.push(new Paragraph({ alignment: AlignmentType.CENTER, keepNext: true, spacing: { before: 80, after: 40 }, indent: { left: 0 }, children: [image(it.dataUrl, it.widthMm * k, it.heightMm * k, n.border)] }));
                if (it.caption) children.push(new Paragraph({ style: 'Caption', alignment: n.perRow > 1 ? AlignmentType.CENTER : AlignmentType.LEFT, indent: { left: 0 }, children: [new TextRun({ text: it.caption })] }));
              }
              return new TableCell({ width: { size: twips(cellMm(c)), type: WidthType.DXA }, margins: { left: 0, right: c < n.perRow - 1 ? twips(n.gapMm) : 0 }, children: children.length ? children : [new Paragraph({})] });
            }),
          }),
        );
      }
      const out: Array<Paragraph | Table> = [
        new Table({
          layout: TableLayoutType.FIXED,
          borders: TableBorders.NONE,
          indent: tableIndent,
          width: { size: twips(Array.from({ length: n.perRow }, (_, c) => cellMm(c)).reduce((s, v) => s + v, 0)), type: WidthType.DXA },
          columnWidths: Array.from({ length: n.perRow }, (_, c) => twips(cellMm(c))),
          rows,
        }),
      ];
      out.push(n.caption ? new Paragraph({ style: 'Caption', indent: ind, children: [new TextRun({ text: n.caption })] }) : new Paragraph({ children: [], spacing: { after: 60 } }));
      return out;
    }
    case 'signatures': {
      // a borderless table, one cell per signatory; the signatures sit on a common line so the names line up
      const small = base - 2;
      const gap = twips(SIGN_GAP_MM);
      const col = twips(n.colWidthMm);
      const lineHeight = Math.round(t.fontSize * 1.2 * 20); // an empty paragraph's height, in twips
      const person = (s: (typeof n.items)[number] | undefined, last: boolean) => {
        const children: Paragraph[] = [];
        if (s?.role) children.push(new Paragraph({ keepNext: true, spacing: { after: 0 }, indent: { left: 0 }, children: [new TextRun({ text: s.role, size: small, color: '555555' })] }));
        if (s?.image) children.push(new Paragraph({ keepNext: true, spacing: { before: twips(n.imageHeightMm - s.image.heightMm) + 40, after: 60 }, indent: { left: 0 }, children: [image(s.image.dataUrl, s.image.widthMm, s.image.heightMm)] }));
        else if (s)
          children.push(
            new Paragraph({
              keepNext: true,
              spacing: { before: Math.max(0, twips(n.imageHeightMm) + 40 - lineHeight), after: 60 },
              indent: { left: 0, right: Math.max(0, twips(n.colWidthMm - 60)) },
              border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: '777777', space: 1 } },
              children: [],
            }),
          );
        if (s?.name) children.push(new Paragraph({ keepNext: true, spacing: { after: 0 }, indent: { left: 0 }, children: [new TextRun({ text: s.name, bold: true, size: base })] }));
        for (const line of s?.lines ?? []) children.push(new Paragraph({ keepNext: true, spacing: { after: 0 }, indent: { left: 0 }, children: line.map((r) => new TextRun({ text: r.text, bold: r.bold, italics: r.italic, size: base, color: hex(x.text) ?? '333333' })) }));
        if (s?.date) children.push(new Paragraph({ spacing: { before: 40, after: 0 }, indent: { left: 0 }, children: [new TextRun({ text: `Date: ${s.date}`, size: small, color: '555555' })] }));
        return new TableCell({ width: { size: col + (last ? 0 : gap), type: WidthType.DXA }, margins: { left: 0, right: last ? 0 : gap, bottom: 200 }, children: children.length ? children : [new Paragraph({})] });
      };
      const rows: TableRow[] = [];
      for (let i = 0; i < n.items.length; i += n.cols) rows.push(new TableRow({ cantSplit: true, children: Array.from({ length: n.cols }, (_, k) => person(n.items[i + k], k === n.cols - 1)) }));
      return [
        n.closing ? new Paragraph({ keepNext: true, spacing: { before: 60, after: 0 }, indent: ind, children: runs(n.closing, base) }) : new Paragraph({ keepNext: true, spacing: { before: 120, after: 0 }, children: [] }),
        new Table({
          layout: TableLayoutType.FIXED,
          borders: TableBorders.NONE,
          indent: tableIndent,
          width: { size: n.cols * col + (n.cols - 1) * gap, type: WidthType.DXA },
          columnWidths: Array.from({ length: n.cols }, (_, k) => col + (k < n.cols - 1 ? gap : 0)),
          rows,
        }),
        new Paragraph({ children: [], spacing: { after: 60 } }),
      ];
    }
    case 'table': {
      const size = Math.round((n.fontSize ?? t.fontSize - 1) * 2);
      const out: Array<Paragraph | Table> = [];
      if (n.caption) out.push(new Paragraph({ style: 'Caption', keepNext: true, indent: ind, children: [new TextRun({ text: n.caption, bold: !letter })] }));
      // flexible columns (notes, comments) keep room for their text: the fixed ones give way if need be, as in the PDF
      const flexCount = n.widths.filter((w) => typeof w !== 'number').length;
      const FLEX_MIN = 20;
      const fixedRaw = n.widths.reduce<number>((s, w) => s + (typeof w === 'number' ? w : 0), 0);
      const roomForFixed = contentWidthMm - flexCount * FLEX_MIN;
      const k = flexCount && fixedRaw > roomForFixed ? Math.max(0.3, roomForFixed / fixedRaw) : 1;
      const fixed = fixedRaw * k;
      const flex = flexCount ? Math.max(FLEX_MIN, (contentWidthMm - fixed) / flexCount) : 0;
      const colsMm = n.widths.map((w) => (typeof w === 'number' ? w * k : flex));
      const totalMm = colsMm.reduce((s, v) => s + v, 0);
      const scale = Math.min(1, contentWidthMm / totalMm);
      out.push(
        new Table({
          layout: TableLayoutType.FIXED,
          indent: tableIndent,
          width: { size: Math.round(Math.min(contentWidthMm, totalMm) * TWIP_PER_MM), type: WidthType.DXA },
          columnWidths: colsMm.map((mm) => Math.round(mm * scale * TWIP_PER_MM)),
          rows: [...n.head.map((r) => docRow(r, true, x, size)), ...n.body.map((r) => docRow(r, false, x, size))],
        }),
      );
      for (const note of n.notes ?? []) out.push(new Paragraph({ spacing: { after: 0 }, indent: ind, children: [new TextRun({ text: note, size: size - 2, color: '555555' })] }));
      out.push(new Paragraph({ children: [], spacing: { after: 120 } }));
      return out;
    }
  }
}

function styles(doc: ReportDoc) {
  const base = doc.template.fontSize * 2;
  const look = doc.look;
  if (look.style === 'letter') {
    // a letter: headings in regular weight in the heading colour, captions in italics
    const font = look.font ?? 'Calibri';
    const headingFont = look.headingFont ?? font;
    const text = hex(look.textColor);
    const head = hex(look.headingColor);
    return {
      default: { document: { run: { font, size: base, color: text } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: headingFont, size: base + 4, color: head }, paragraph: { spacing: { before: 240, after: 80 } } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: headingFont, size: base + 1, italics: true, color: head }, paragraph: { spacing: { before: 200, after: 60 } } },
        { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: headingFont, size: base, bold: true, color: text }, paragraph: { spacing: { before: 160, after: 60 } } },
        { id: 'Caption', name: 'Caption', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: base - 1, italics: true, color: text }, paragraph: { spacing: { before: 60, after: 120 } } },
      ],
    };
  }
  const accent = look.headingColor;
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

/** Split the report into Word sections wherever the page orientation changes. */
function splitSections(doc: ReportDoc): Array<{ orientation: Orientation; nodes: DocNode[] }> {
  const out: Array<{ orientation: Orientation; nodes: DocNode[] }> = [{ orientation: doc.template.orientation, nodes: [] }];
  for (const n of doc.nodes) {
    const cur = out[out.length - 1];
    if (n.t === 'pagebreak' && n.orientation && n.orientation !== cur.orientation) {
      out.push({ orientation: n.orientation, nodes: [] });
      continue;
    }
    // a page break at the start of a section, after another page break or after a title page would leave a blank page
    const prev = cur.nodes[cur.nodes.length - 1];
    if (n.t === 'pagebreak' && (!prev || prev.t === 'pagebreak' || (prev.t === 'title' && prev.pageBreakAfter))) continue;
    cur.nodes.push(n);
  }
  // a section break already starts a new page
  out.forEach((s, i) => {
    if (i === out.length - 1) return;
    while (s.nodes[s.nodes.length - 1]?.t === 'pagebreak') s.nodes.pop();
    const last = s.nodes[s.nodes.length - 1];
    if (last?.t === 'title' && last.pageBreakAfter) s.nodes[s.nodes.length - 1] = { ...last, pageBreakAfter: false };
  });
  const kept = out.filter((s) => s.nodes.length);
  return kept.length ? kept : [out[0]];
}

/** A letterhead's header or footer: its items stacked, with left, centre and right side by side in a borderless table. */
function letterheadPart(items: LetterheadItem[], widthMm: number): Array<Paragraph | Table> {
  const para = (it: LetterheadItem, align: 'left' | 'center' | 'right') =>
    new Paragraph({
      alignment: align === 'right' ? AlignmentType.RIGHT : align === 'center' ? AlignmentType.CENTER : AlignmentType.LEFT,
      spacing: { before: 0, after: 0 },
      indent: { left: align === 'left' && it.dx ? twips(it.dx) : 0 },
      children:
        it.kind === 'image'
          ? [image(it.dataUrl, it.widthMm, it.heightMm)]
          : it.runs.flatMap((r) => {
              const style = { size: Math.round((r.sizePt ?? 8) * 2), color: hex(r.color), bold: r.bold, italics: r.italic };
              // {page} and {pages} become page number fields
              return r.text
                .split(/(\{pages?\})/)
                .filter(Boolean)
                .map((bit) => new TextRun({ ...style, ...(bit === '{page}' ? { children: [PageNumber.CURRENT] } : bit === '{pages}' ? { children: [PageNumber.TOTAL_PAGES] } : { text: bit }) }));
            }),
    });
  const groups = (['left', 'center', 'right'] as const).map((a) => ({ a, items: items.filter((it) => it.align === a) })).filter((g) => g.items.length);
  if (!groups.length) return [new Paragraph({ children: [] })];
  if (groups.length === 1) return groups[0].items.map((it) => para(it, groups[0].a));
  const colMm = widthMm / groups.length;
  return [
    new Table({
      layout: TableLayoutType.FIXED,
      borders: TableBorders.NONE,
      width: { size: twips(widthMm), type: WidthType.DXA },
      columnWidths: groups.map(() => twips(colMm)),
      rows: [new TableRow({ children: groups.map((g) => new TableCell({ width: { size: twips(colMm), type: WidthType.DXA }, margins: { left: 0, right: 0 }, children: g.items.map((it) => para(it, g.a)) })) })],
    }),
    new Paragraph({ spacing: { before: 0, after: 0 }, children: [] }),
  ];
}

function section(doc: ReportDoc, children: Array<Paragraph | Table>, orientation: Orientation, first: boolean): ISectionOptions {
  const t = doc.template;
  const [w, h] = pageSizeMm(t);
  const size = { width: twips(w), height: twips(h), orientation: orientation === 'landscape' ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT };
  // the letterhead's Word file replaces the header and footers afterwards, so none are drawn here
  const fromWord = !!doc.letterhead?.docx && doc.letterhead.useWordFile !== false;
  const lh = doc.letterhead && fromWord ? { ...doc.letterhead, first: { header: [], footer: [] }, other: { header: [], footer: [] } } : doc.letterhead;
  if (lh) {
    const g = doc.page;
    const widthMm = (orientation === 'landscape' ? h : w) - g.left - g.right;
    return {
      properties: { page: { size, margin: { top: twips(g.top), right: twips(g.right), bottom: twips(g.bottom), left: twips(g.left), header: twips(g.header), footer: twips(g.footer) } }, titlePage: first },
      // later sections carry on with the same header and footer
      ...(first
        ? {
            headers: { default: new Header({ children: letterheadPart(lh.other.header, widthMm) }), first: new Header({ children: letterheadPart(lh.first.header, widthMm) }) },
            footers: { default: new Footer({ children: letterheadPart(lh.other.footer, widthMm) }), first: new Footer({ children: letterheadPart(lh.first.footer, widthMm) }) },
          }
        : {}),
      children,
    };
  }
  const small = (t.fontSize - 2) * 2;
  return {
    properties: {
      page: { size, margin: { top: twips(t.marginMm), bottom: twips(t.marginMm), left: twips(t.marginMm), right: twips(t.marginMm) } },
      titlePage: first && doc.nodes[0]?.t === 'title' && doc.nodes[0].pageBreakAfter,
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
  const [w, h] = pageSizeMm(t);
  const x: Ctx = { doc, letter: doc.look.style === 'letter', indent: twips(doc.page.indent), head: headerLook(doc), rule: doc.look.style === 'letter' ? '404040' : 'B9B9B9', text: doc.look.textColor };
  const sides = doc.letterhead ? doc.page.left + doc.page.right + doc.page.indent : 2 * t.marginMm;
  const sections = splitSections(doc).map((s, i) => {
    const contentWidthMm = (s.orientation === 'landscape' ? h : w) - sides;
    return section(doc, s.nodes.flatMap((n) => nodeToDocx(n, x, contentWidthMm)), s.orientation, i === 0);
  });
  const d = new Document({ creator: 'EnviroDB', title: doc.title, description: doc.title, styles: styles(doc), sections });
  const blob = await Packer.toBlob(d);
  if (!doc.letterhead?.docx || doc.letterhead.useWordFile === false) return blob;
  // on the company's own letterhead: its header and footers from the Word file, exactly as they are
  const { applyWordLetterhead } = await import('./wordLetterhead');
  return applyWordLetterhead(blob, doc.letterhead.docx);
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
  const plain = { style: 'report' as const, accent: '#0f766e', headingColor: '#0f766e', tableHeader: 'accent' as const, highlight: 'fill' as const };
  const d = new Document({ creator: 'EnviroDB', styles: styles({ template: { fontSize: 10 }, look: plain } as ReportDoc), sections: [{ children }] });
  return Packer.toBlob(d);
}
