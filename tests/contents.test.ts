import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { DEFAULT_SETTINGS, ensureBuiltIns } from '../src/db/db';
import { createDemoProject } from '../src/db/demo';
import { BUILT_IN_TEMPLATES } from '../src/data/templates';
import type { FigureImage, ReportBlock, ReportTemplate, TocBlock } from '../src/db/types';
import type { ProjectBundle } from '../src/lib/analysis';
import { buildReport } from '../src/reports/build';
import { docxBlob } from '../src/reports/docx';
import { pdfPageNumbers, toPdfDefinition } from '../src/reports/pdf';
import { planFromOutline, templateFromPlan } from '../src/reports/docTemplate';
import { newBlock } from '../src/components/report/blocks';
import type { DocNode, ReportDoc } from '../src/reports/model';
import { loadBundle, png } from './helpers';

const annual = BUILT_IN_TEMPLATES.find((t) => t.id === 'tpl-annual')!;
const year = { start: '2025-07-01', end: '2026-06-30', label: '2025/26' };
let b: ProjectBundle;
beforeAll(async () => {
  await ensureBuiltIns();
  b = await loadBundle(await createDemoProject());
});
const report = (t: ReportTemplate): ReportDoc => buildReport({ bundle: b, template: t, period: year, settings: DEFAULT_SETTINGS });
const toc = (patch: Partial<TocBlock> = {}): TocBlock => ({ id: 'toc', type: 'toc', title: 'Contents', levels: 2, tables: true, figures: true, pageBreakAfter: true, ...patch });
const pic = (id: string, caption: string): FigureImage => ({ id, src: png(400, 300), caption });
const blocks = (c: TocBlock): ReportBlock[] => [
  { id: 'title', type: 'title', title: 'Report', showDetails: false, pageBreakAfter: true },
  c,
  { id: 'h1', type: 'heading', text: 'Introduction', level: 1 },
  { id: 'h2', type: 'heading', text: 'Results', level: 1 },
  { id: 'h3', type: 'heading', text: 'Water quality', level: 2 },
  { id: 'h4', type: 'heading', text: 'Details', level: 3 },
  { id: 's', type: 'statsTable', title: 'Summary statistics', siteIds: [], parameterIds: [], stats: ['n', 'median'] },
  { id: 'f', type: 'figures', images: [pic('a', 'Upstream'), pic('b', 'Pond')], perRow: 2, heightMm: 0, numbering: 'each', label: 'Photo', caption: '' },
];
const contentsOf = (doc: ReportDoc) => doc.nodes.find((n): n is Extract<DocNode, { t: 'toc' }> => n.t === 'toc')!;
const word = async (doc: ReportDoc, pages?: Record<string, number>) => {
  const zip = await JSZip.loadAsync(await (await docxBlob(doc, { pages })).arrayBuffer());
  const file = async (name: string) => (await zip.file(name)?.async('string')) ?? '';
  return { xml: await file('word/document.xml'), styles: await file('word/styles.xml'), settings: await file('word/settings.xml') };
};

describe('table of contents', () => {
  it('lists the headings to its level, with numbers, and a list for each kind of numbered caption', () => {
    const doc = report({ ...annual, blocks: blocks(toc()) });
    const c = contentsOf(doc);
    expect(c.title).toBe('Contents');
    expect(c.entries.map((e) => [e.number, e.text, e.level])).toEqual([
      ['1', 'Introduction', 1],
      ['2', 'Results', 1],
      ['2.1', 'Water quality', 2],
    ]);
    // every heading has an anchor to link to
    expect(c.entries.every((e) => e.anchor && doc.nodes.some((n) => n.t === 'h' && n.anchor === e.anchor))).toBe(true);
    expect(c.lists.map((l) => [l.title, l.label, l.entries.map((e) => e.text)])).toEqual([
      ['Tables', 'Table', ['Table 1: Summary statistics']],
      ['Photos', 'Photo', ['Photo 1: Upstream', 'Photo 2: Pond']],
    ]);
    // a new page after it
    expect(doc.nodes[doc.nodes.indexOf(c) + 1]).toEqual({ t: 'pagebreak' });
  });

  it('leaves out deeper headings, and the lists it is not asked for', () => {
    const c = contentsOf(report({ ...annual, blocks: blocks(toc({ levels: 3, figures: false, pageBreakAfter: false })) }));
    expect(c.entries.map((e) => e.text)).toEqual(['Introduction', 'Results', 'Water quality', 'Details']);
    expect(c.lists.map((l) => l.title)).toEqual(['Tables']);
    expect(contentsOf(report({ ...annual, blocks: blocks(toc({ levels: 1, tables: false, figures: false })) })).entries.map((e) => e.text)).toEqual(['Introduction', 'Results']);
  });

  it('in the PDF: pdfmake’s contents, with the headings and captions marked for it', () => {
    const doc = report({ ...annual, blocks: blocks(toc()) });
    const flat = JSON.stringify(toPdfDefinition(doc).content);
    expect(flat).toContain('"toc":{"id":"contents0"');
    expect(flat).toContain('"toc":{"id":"contents0-Table"');
    expect(flat).toContain('"toc":{"id":"contents0-Photo"');
    expect(flat).toMatch(/"text":"2\.1 {2}Water quality"[^}]*"tocItem":\["contents0"\]/);
    expect(flat).toMatch(/"text":"Table 1: Summary statistics"[^}]*"tocItem":\["contents0-Table"\]/);
    expect(flat).toMatch(/"text":"Photo 2: Pond"[^}]*"tocItem":\["contents0-Photo"\]/);
    // a level 3 heading isn't in a contents to level 2
    expect(flat).not.toMatch(/"text":"Details"[^}]*"tocItem"/);
  });

  it('without a contents section, nothing is marked for one', () => {
    const doc = report({ ...annual, blocks: blocks(toc()).filter((x) => x.type !== 'toc') });
    expect(JSON.stringify(toPdfDefinition(doc).content)).not.toContain('tocItem');
  });

  it('in Word: Word’s own TOC fields, filled in, with its styles – and Word updates them on opening', async () => {
    const doc = report({ ...annual, blocks: blocks(toc()) });
    const c = contentsOf(doc);
    const pages = Object.fromEntries([...c.entries, ...c.lists.flatMap((l) => l.entries)].map((e, i) => [e.anchor, i + 3]));
    const { xml, styles, settings } = await word(doc, pages);
    expect(xml).toContain('<w:docPartGallery w:val="Table of Contents"/>');
    expect(xml).toContain('<w:pStyle w:val="TOCHeading"/>');
    expect(xml).toContain('TOC \\o &quot;1-2&quot; \\h \\z \\u');
    expect(xml).toContain('TOC \\h \\z \\c &quot;Table&quot;');
    expect(xml).toContain('TOC \\h \\z \\c &quot;Photo&quot;');
    // a line: a link to the heading's bookmark, its number, a tab, its text, then a PAGEREF with its page
    const first = c.entries[0];
    expect(xml).toMatch(new RegExp(`<w:pStyle w:val="TOC1"/>.*?<w:hyperlink w:anchor="_Ref_${first.anchor}" w:history="1"><w:r><w:t xml:space="preserve">1</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t xml:space="preserve">Introduction</w:t></w:r>`));
    expect(xml).toMatch(new RegExp(`PAGEREF _Ref_${first.anchor} \\\\h </w:instrText></w:r><w:r><w:rPr><w:webHidden/></w:rPr><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:rPr><w:webHidden/></w:rPr><w:t xml:space="preserve">3</w:t>`));
    expect(xml).toMatch(/<w:pStyle w:val="TOC2"\/>.*?Water quality/);
    // the headings and captions it links to are bookmarked
    for (const e of [...c.entries, ...c.lists.flatMap((l) => l.entries)]) expect(xml).toContain(`<w:bookmarkStart w:name="_Ref_${e.anchor}" w:id="`);
    // begin / separate / end balance: Word reads the fields
    const count = (type: string) => (xml.match(new RegExp(`w:fldCharType="${type}"`, 'g')) ?? []).length;
    expect(count('begin')).toBe(count('end'));
    expect(count('begin')).toBe(count('separate'));
    for (const id of ['TOC1', 'TOC2', 'TOC3', 'TableofFigures', 'TOCHeading']) expect(styles).toContain(`w:styleId="${id}"`);
    expect(styles).toContain('<w:name w:val="toc 1"/>');
    expect(styles).toContain('<w:name w:val="table of figures"/>');
    expect(styles).toMatch(/w:styleId="Heading2"[\s\S]*?<w:outlineLvl w:val="1"\/>/);
    expect(settings).toMatch(/<w:updateFields(?: w:val="true")?\/>/);
  });

  it('the PDF’s pages give each heading and caption its page number – also Word’s to start with', async () => {
    const doc = report({ ...annual, blocks: blocks(toc()) });
    const c = contentsOf(doc);
    const pages = await pdfPageNumbers(doc);
    const heads = c.entries.map((e) => pages[e.anchor]);
    // the title page, then the contents page, then the report
    expect(heads[0]).toBe(3);
    expect(heads.every((p, i) => p >= 3 && (i === 0 || p >= heads[i - 1]))).toBe(true);
    for (const e of c.lists.flatMap((l) => l.entries)) expect(pages[e.anchor]).toBeGreaterThanOrEqual(3);
    // the Word file works them out itself when not given
    const { xml } = await word(doc);
    expect(xml).toMatch(new RegExp(`PAGEREF _Ref_${c.entries[0].anchor} \\\\h </w:instrText>.*?<w:t xml:space="preserve">3</w:t>`));
  }, 60000);

  it('a Word file without contents isn’t asked to update its fields', async () => {
    const { settings } = await word(report({ ...annual, blocks: blocks(toc()).filter((x) => x.type !== 'toc') }));
    expect(settings).not.toContain('updateFields');
  });

  it('a template made from a document with a contents page has a contents section', () => {
    const plan = planFromOutline({
      title: 'Annual monitoring report',
      items: [
        { kind: 'heading', level: 1, text: 'Contents' },
        { kind: 'para', text: '1 Introduction ........ 3' },
        { kind: 'para', text: '2 Results ........ 5' },
        { kind: 'heading', level: 1, text: 'Introduction' },
        { kind: 'para', text: 'This report…' },
        { kind: 'heading', level: 1, text: 'Results' },
      ],
    });
    expect(plan.contents).toBe(true);
    expect(plan.sections.map((s) => s.heading)).toEqual(['Introduction', 'Results']);
    const t = templateFromPlan(plan, { name: 'From a document', fileName: 'report.docx', keepText: true, newBlock });
    expect(t.blocks.map((x) => x.type).slice(0, 3)).toEqual(['title', 'toc', 'heading']);
  });
});
