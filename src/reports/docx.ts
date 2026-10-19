import {
  AlignmentType,
  Bookmark,
  BookmarkEnd,
  BookmarkStart,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  InternalHyperlink,
  LevelFormat,
  SimpleField,
  type IRunOptions,
  PageBreak,
  PageNumber,
  PageOrientation,
  Packer,
  type ParagraphChild,
  Paragraph,
  ShadingType,
  Table,
  TableBorders,
  TableCell,
  TableLayoutType,
  TableRow,
  TabStopType,
  TextRun,
  WidthType,
  type ISectionOptions,
} from 'docx';
import type { LetterheadItem } from '../db/types';
import type { Cell, DocNode, PageLine, RefTarget, ReportDoc, Run } from './model';
import { dataUrlToBytes } from '../charts/render';
import { CHART_GAP_MM, SIGN_GAP_MM, pageSizeMm, type Orientation } from './build';
import { fitCellSize, fontWidthFactor } from './measure';

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

/** A Word bookmark name for an anchor (hidden from Word's bookmark list, like its own cross-reference bookmarks). */
const bookmark = (anchor: string) => `_Ref_${anchor}`;

/** Word's own heading numbering: 1, 1.1, 1.1.1 – the number, then a tab to the heading's text. */
const HEADING_NUMBERS = 'heading-numbers';
function headingNumbering(indent: number) {
  const hang = twips(10);
  return {
    config: [
      {
        reference: HEADING_NUMBERS,
        levels: ['%1', '%1.%2', '%1.%2.%3'].map((text, level) => ({ level, format: LevelFormat.DECIMAL, text, alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: indent + hang, hanging: hang } } } })),
      },
    ],
  };
}

/** The document being written: what each reference shows, and each numbered caption's label and number. */
let TARGETS: Record<string, RefTarget> = {};

/** A Word field – {SEQ Table}, {REF _Ref_ref3 \h} – with its result as Word would show it, so nothing needs updating on opening. */
function field(instr: string, result: string, style: IRunOptions): SimpleField {
  const f = new SimpleField(` ${instr} `);
  (f as unknown as { root: unknown[] }).root.push(new TextRun({ ...style, text: result }));
  return f;
}

/** A caption label as a SEQ field's name: "Table", "Figure", "Site_photo". */
const seqName = (label: string) => label.trim().replace(/\s+/g, '_').replace(/[^\w]/g, '') || 'Figure';

/**
 * Text runs; a reference ("Table 3") is Word's own cross-reference – a REF field to the caption's bookmark, a link
 * (Ctrl+click) that updates with the numbering – and anything after the number ("(b)") follows as text.
 */
function runs(rs: Run[], size: number, italics?: boolean): ParagraphChild[] {
  return rs.flatMap((r): ParagraphChild[] => {
    const style: IRunOptions = { bold: r.bold, italics: r.italic || italics, size };
    if (!r.link) return [new TextRun({ ...style, text: r.text })];
    const t = TARGETS[r.link];
    if (t && r.text.startsWith(t.text)) {
      const rest = r.text.slice(t.text.length);
      return [field(`REF ${bookmark(r.link)} \\h`, t.text, style), ...(rest ? [new TextRun({ ...style, text: rest })] : [])];
    }
    return [new InternalHyperlink({ anchor: bookmark(r.link), children: [new TextRun({ ...style, text: r.text })] })];
  });
}

let bookmarkNo = 0;
function bookmarked(anchor: string, children: ParagraphChild[]): ParagraphChild {
  // the library numbers every bookmark 1, and Word matches a bookmark's start and end by number: each gets its own
  const n = ++bookmarkNo;
  return Object.assign(new Bookmark({ id: bookmark(anchor), children }), { start: new BookmarkStart(bookmark(anchor), n), end: new BookmarkEnd(n) });
}

/**
 * A caption's or heading's text, with a bookmark for references to it. A numbered caption is Word's own: "Table "
 * and a SEQ field for the number, bookmarked as Word's cross-references are (the label and number), then its text.
 */
function marked(anchor: string | undefined, text: string, style: IRunOptions = {}): ParagraphChild[] {
  if (!anchor) return [new TextRun({ ...style, text })];
  const t = TARGETS[anchor];
  if (t?.label && t.num && text.startsWith(t.text) && t.text === `${t.label} ${t.num}`) {
    const rest = text.slice(t.text.length);
    return [bookmarked(anchor, [new TextRun({ ...style, text: `${t.label} ` }), field(`SEQ ${seqName(t.label)} \\* ARABIC`, String(t.num), style)]), ...(rest ? [new TextRun({ ...style, text: rest })] : [])];
  }
  return [bookmarked(anchor, [new TextRun({ ...style, text })])];
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

/**
 * A row; with the columns' widths (mm), a number (or word) wider than its column gets smaller rather than breaking.
 * Cell margins are 60 twips a side; a wider body font (a letterhead's) needs more room.
 */
function docRow(row: Cell[], header: boolean, x: Ctx, size: number, colsMm?: number[]): TableRow {
  const cells: TableCell[] = [];
  const wide = fontWidthFactor(x.doc.look.font ?? 'Calibri');
  let col = 0;
  for (let i = 0; i < row.length; i++) {
    const span = Math.max(1, row[i].colSpan ?? 1);
    const widthMm = colsMm ? colsMm.slice(col, col + span).reduce((a, w) => a + w, 0) - (120 / TWIP_PER_MM + 0.3) : 0;
    col += span;
    const fitted = colsMm ? Math.round(fitCellSize(row[i].text, size / 2, widthMm / wide, header || row[i].bold) * 2) : size;
    cells.push(docCell(row[i], header, x, Math.min(size, fitted)));
    i += span - 1;
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
          // a numbered heading is numbered by Word (1, 1.1 …), so headings added in Word follow on; its indent is the numbering's
          ...(n.number ? { numbering: { reference: HEADING_NUMBERS, level: n.level - 1 } } : { indent: ind }),
          children: marked(n.anchor, n.text),
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
    case 'space':
      return [new Paragraph({ children: [], spacing: { before: 0, after: 0, line: Math.max(20, Math.round(n.mm * 56.6929)), lineRule: 'exact' } })];
    case 'image': {
      const out: Array<Paragraph | Table> = [];
      const wCm = Math.min(n.widthCm, contentWidthMm / 10);
      const hCm = n.heightCm * (wCm / n.widthCm);
      if (n.dataUrl) out.push(new Paragraph({ keepNext: true, spacing: { before: 120, after: 40 }, indent: ind, children: [new ImageRun({ type: 'png', data: dataUrlToBytes(n.dataUrl), transformation: { width: Math.round(wCm * PX_PER_CM), height: Math.round(hCm * PX_PER_CM) } })] }));
      if (n.caption) out.push(new Paragraph({ style: 'Caption', indent: ind, children: marked(n.anchor, n.caption) }));
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
        if (it.caption) children.push(new Paragraph({ style: 'Caption', indent: { left: 0 }, children: marked(it.anchor, it.caption) }));
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
                if (it.caption) children.push(new Paragraph({ style: 'Caption', alignment: n.perRow > 1 ? AlignmentType.CENTER : AlignmentType.LEFT, indent: { left: 0 }, children: marked(it.anchor, it.caption) }));
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
      out.push(n.caption ? new Paragraph({ style: 'Caption', indent: ind, children: marked(n.anchor, n.caption) }) : new Paragraph({ children: [], spacing: { after: 60 } }));
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
      if (n.caption) out.push(new Paragraph({ style: 'Caption', keepNext: true, indent: ind, children: marked(n.anchor, n.caption, { bold: !letter }) }));
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
      const scaled = colsMm.map((mm) => mm * scale);
      out.push(
        new Table({
          layout: TableLayoutType.FIXED,
          indent: tableIndent,
          width: { size: Math.round(Math.min(contentWidthMm, totalMm) * TWIP_PER_MM), type: WidthType.DXA },
          columnWidths: colsMm.map((mm) => Math.round(mm * scale * TWIP_PER_MM)),
          rows: [...n.head.map((r) => docRow(r, true, x, size, scaled)), ...n.body.map((r) => docRow(r, false, x, size, scaled))],
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

/** Text with {page} and {pages} as Word's page number fields. */
function pageRuns(text: string, size: number, color = '777777'): TextRun[] {
  return text
    .split(/(\{pages?\})/)
    .filter(Boolean)
    .map((bit) => new TextRun({ size, color, ...(bit === '{page}' ? { children: [PageNumber.CURRENT] } : bit === '{pages}' ? { children: [PageNumber.TOTAL_PAGES] } : { text: bit }) }));
}

/** A header or footer line: left, then centre and right at tab stops across the page. */
function pageLinePara(l: PageLine, widthMm: number, size: number): Paragraph {
  const tab = () => new TextRun({ text: '\t', size });
  return new Paragraph({
    tabStops: [
      { type: TabStopType.CENTER, position: twips(widthMm / 2) },
      { type: TabStopType.RIGHT, position: twips(widthMm) },
    ],
    spacing: { before: 0, after: 0 },
    indent: { left: 0 },
    children: [...pageRuns(l.left, size), ...(l.center || l.right ? [tab(), ...pageRuns(l.center, size)] : []), ...(l.right ? [tab(), ...pageRuns(l.right, size)] : [])],
  });
}

const pageLineEmpty = (l: PageLine) => !(l.left || l.center || l.right);

function section(doc: ReportDoc, children: Array<Paragraph | Table>, orientation: Orientation, first: boolean): ISectionOptions {
  const t = doc.template;
  const [w, h] = pageSizeMm(t);
  const size = { width: twips(w), height: twips(h), orientation: orientation === 'landscape' ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT };
  // the letterhead's Word file replaces the header and footers afterwards, so none are drawn here
  const fromWord = !!doc.letterhead?.docx && doc.letterhead.useWordFile !== false;
  const lh = doc.letterhead && fromWord ? { ...doc.letterhead, first: { header: [], footer: [] }, other: { header: [], footer: [] } } : doc.letterhead;
  const small = (t.fontSize - 2) * 2;
  if (lh) {
    const g = doc.page;
    const widthMm = (orientation === 'landscape' ? h : w) - g.left - g.right;
    // the template's own lines as well, under the letterhead's header and above its footer
    const extra = doc.pageTextWithLetterhead;
    const head = (items: LetterheadItem[], own: boolean) => [...letterheadPart(items, widthMm), ...(extra && own && !pageLineEmpty(doc.header) ? [pageLinePara(doc.header, widthMm, small)] : [])];
    const foot = (items: LetterheadItem[], own: boolean) => [...(extra && own && !pageLineEmpty(doc.footer) ? [pageLinePara(doc.footer, widthMm, small)] : []), ...letterheadPart(items, widthMm)];
    return {
      properties: { page: { size, margin: { top: twips(g.top), right: twips(g.right), bottom: twips(g.bottom), left: twips(g.left), header: twips(g.header), footer: twips(g.footer) } }, titlePage: first },
      // later sections carry on with the same header and footer
      ...(first
        ? {
            headers: { default: new Header({ children: head(lh.other.header, true) }), first: new Header({ children: head(lh.first.header, doc.pageTextFirst) }) },
            footers: { default: new Footer({ children: foot(lh.other.footer, true) }), first: new Footer({ children: foot(lh.first.footer, doc.pageTextFirst) }) },
          }
        : {}),
      children,
    };
  }
  const widthMm = (orientation === 'landscape' ? h : w) - 2 * t.marginMm;
  const line = (l: PageLine) => (pageLineEmpty(l) ? [new Paragraph({ children: [] })] : [pageLinePara(l, widthMm, small)]);
  return {
    properties: {
      page: { size, margin: { top: twips(t.marginMm), bottom: twips(t.marginMm), left: twips(t.marginMm), right: twips(t.marginMm) } },
      // the first page has its own (empty) header and footer unless they go on it too
      titlePage: first && !doc.pageTextFirst,
    },
    headers: { default: new Header({ children: line(doc.header) }), first: new Header({ children: [new Paragraph({ children: [] })] }) },
    footers: { default: new Footer({ children: line(doc.footer) }), first: new Footer({ children: [new Paragraph({ children: [] })] }) },
    children,
  };
}

export async function docxBlob(doc: ReportDoc): Promise<Blob> {
  const t = doc.template;
  const [w, h] = pageSizeMm(t);
  TARGETS = doc.refTargets ?? {};
  const x: Ctx = { doc, letter: doc.look.style === 'letter', indent: twips(doc.page.indent), head: headerLook(doc), rule: doc.look.style === 'letter' ? '404040' : 'B9B9B9', text: doc.look.textColor };
  const sides = doc.letterhead ? doc.page.left + doc.page.right + doc.page.indent : 2 * t.marginMm;
  const sections = splitSections(doc).map((s, i) => {
    const contentWidthMm = (s.orientation === 'landscape' ? h : w) - sides;
    return section(doc, s.nodes.flatMap((n) => nodeToDocx(n, x, contentWidthMm)), s.orientation, i === 0);
  });
  const d = new Document({ creator: 'EnviroDB', title: doc.title, description: doc.title, styles: styles(doc), numbering: headingNumbering(twips(doc.page.indent)), sections });
  const blob = await Packer.toBlob(d);
  if (!doc.letterhead?.docx || doc.letterhead.useWordFile === false) return blob;
  // on the company's own letterhead: its header and footers from the Word file, exactly as they are – with the
  // template's own lines added, if wanted
  const { applyWordLetterhead, pageLineXml } = await import('./wordLetterhead');
  const g = doc.page;
  const widthMm = (doc.template.orientation === 'landscape' ? h : w) - g.left - g.right;
  const small = (t.fontSize - 2) * 2;
  const extra = doc.pageTextWithLetterhead
    ? { header: pageLineEmpty(doc.header) ? undefined : pageLineXml(doc.header, twips(widthMm), small), footer: pageLineEmpty(doc.footer) ? undefined : pageLineXml(doc.footer, twips(widthMm), small), first: doc.pageTextFirst }
    : undefined;
  return applyWordLetterhead(blob, doc.letterhead.docx, extra);
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
