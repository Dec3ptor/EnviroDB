import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { DEFAULT_SETTINGS, ensureBuiltIns } from '../src/db/db';
import { createDemoProject } from '../src/db/demo';
import { BUILT_IN_TEMPLATES } from '../src/data/templates';
import type { FigureImage, ReportBlock, ReportTemplate } from '../src/db/types';
import type { ProjectBundle } from '../src/lib/analysis';
import { buildReport } from '../src/reports/build';
import { docxBlob } from '../src/reports/docx';
import type { ReportDoc } from '../src/reports/model';
import { loadBundle, png } from './helpers';

const annual = BUILT_IN_TEMPLATES.find((t) => t.id === 'tpl-annual')!;
const year = { start: '2025-07-01', end: '2026-06-30', label: '2025/26' };
let b: ProjectBundle;
beforeAll(async () => {
  await ensureBuiltIns();
  b = await loadBundle(await createDemoProject());
});
const report = (t: ReportTemplate): ReportDoc => buildReport({ bundle: b, template: t, period: year, settings: DEFAULT_SETTINGS });
const word = async (doc: ReportDoc) => {
  const zip = await JSZip.loadAsync(await (await docxBlob(doc)).arrayBuffer());
  return { xml: await zip.file('word/document.xml')!.async('string'), numbering: (await zip.file('word/numbering.xml')?.async('string')) ?? '' };
};
const paragraphs = (xml: string) => xml.match(/<w:p>[\s\S]*?<\/w:p>|<w:p [\s\S]*?<\/w:p>/g) ?? [];
const textOf = (p: string) => Array.from(p.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)).map((m) => m[1]).join('');

describe('a Word file as if made in Word', () => {
  it('numbers headings with Word’s own numbering, not typed-in numbers', async () => {
    const doc = report(annual);
    expect(doc.nodes.some((n) => n.t === 'h' && n.number === '1')).toBe(true);
    const { xml, numbering } = await word(doc);
    const intro = paragraphs(xml).find((p) => /Heading1/.test(p) && textOf(p) === 'Introduction')!;
    expect(intro).toBeTruthy();
    expect(intro).toMatch(/<w:numPr><w:ilvl w:val="0"\/><w:numId w:val="\d+"\/><\/w:numPr>/);
    const sub = paragraphs(xml).find((p) => /Heading2/.test(p) && textOf(p) === 'Exceedances')!;
    expect(sub).toMatch(/<w:ilvl w:val="1"\/>/);
    expect(numbering).toContain('w:val="%1.%2"');
    // nothing typed in front of a heading
    expect(paragraphs(xml).some((p) => /Heading[12]/.test(p) && /^\d+(\.\d+)?\s/.test(textOf(p)))).toBe(false);
  });

  it('refers to a figure in a numbered group – "Figure 1(b)" – as Word does: a REF to the figure, then "(b)"', async () => {
    const pic = (id: string, caption: string, ref?: string): FigureImage => ({ id, src: png(400, 300), caption, ref });
    const blocks: ReportBlock[] = [
      { id: 't', type: 'text', text: 'The pond was dry ({{fig:pond}}).' },
      { id: 'f', type: 'figures', images: [pic('a', 'Upstream'), pic('b', 'Pond', 'pond')], perRow: 2, heightMm: 0, numbering: 'group', label: 'Figure', caption: 'Site photos' },
    ];
    const doc = report({ ...annual, blocks });
    const { xml } = await word(doc);
    const p = paragraphs(xml).find((x) => textOf(x).startsWith('The pond was dry'))!;
    expect(p).toMatch(/<w:fldSimple w:instr=" REF _Ref_ref\d+ \\h "><w:r>(?:(?!<\/w:r>).)*<w:t xml:space="preserve">Figure 1<\/w:t><\/w:r><\/w:fldSimple><w:r>(?:(?!<\/w:r>).)*<w:t xml:space="preserve">\(b\)<\/w:t>/);
    expect(textOf(p)).toBe('The pond was dry (Figure 1(b)).');
    expect(xml).toMatch(/<w:fldSimple w:instr=" SEQ Figure \\\* ARABIC "><w:r>(?:(?!<\/w:r>).)*<w:t xml:space="preserve">1<\/w:t>/);
  });

  it('refers to a table under a heading with the heading’s text, and numbers other labels with their own SEQ', async () => {
    const pic = (id: string, caption: string): FigureImage => ({ id, src: png(400, 300), caption });
    const blocks: ReportBlock[] = [
      { id: 't', type: 'text', text: 'See {{table:stats}} and {{fig:photos}}.' },
      { id: 's', type: 'statsTable', title: 'Summary statistics', siteIds: [], parameterIds: [], stats: ['n'], ref: 'stats', captionStyle: 'heading' },
      { id: 'f', type: 'figures', images: [pic('a', 'Upstream')], perRow: 1, heightMm: 0, numbering: 'each', label: 'Site photo', caption: '', ref: 'photos' },
    ];
    const { xml } = await word(report({ ...annual, blocks }));
    const p = paragraphs(xml).find((x) => textOf(x).startsWith('See '))!;
    expect(textOf(p)).toBe('See Summary statistics and Site photo 1.');
    expect(p).toMatch(/REF _Ref_ref\d+ \\h "><w:r>(?:(?!<\/w:r>).)*>Summary statistics<\/w:t>/);
    expect(xml).toContain('SEQ Site_photo \\* ARABIC');
  });
});
