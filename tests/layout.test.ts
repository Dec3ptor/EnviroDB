import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import pdfMake from 'pdfmake/build/pdfmake';
import vfs from 'pdfmake/build/vfs_fonts';
import JSZip from 'jszip';
import { DEFAULT_SETTINGS, ensureBuiltIns } from '../src/db/db';
import { createDemoProject } from '../src/db/demo';
import type { ChartBlock, ReportBlock, ReportTemplate } from '../src/db/types';
import { BUILT_IN_TEMPLATES } from '../src/data/templates';
import { buildReport, chartSizeCm, pageOrientations, usableWidthMm } from '../src/reports/build';
import { toPdfDefinition } from '../src/reports/pdf';
import { docxBlob } from '../src/reports/docx';
import type { ReportDoc } from '../src/reports/model';
import { loadBundle } from './helpers';
import { hasMixedPages, moveSection, samePages, setPages, stepSection } from '../src/components/report/sections';

const pm = pdfMake as unknown as { vfs: Record<string, string>; createPdf: (dd: unknown) => { getBuffer: (cb: (b: Uint8Array) => void) => void } };
pm.vfs = vfs as unknown as Record<string, string>;

/** Page sizes of a generated PDF, e.g. ['P', 'L', 'L', 'P']. */
async function pdfPages(doc: ReportDoc): Promise<string[]> {
  const buf = await new Promise<Uint8Array>((res) => pm.createPdf(toPdfDefinition(doc)).getBuffer(res));
  const text = Buffer.from(buf).toString('latin1');
  return Array.from(text.matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)).map((m) => (+m[1] > +m[2] ? 'L' : 'P'));
}

let projectId = '';
beforeAll(async () => {
  await ensureBuiltIns();
  projectId = await createDemoProject();
});

const annual = BUILT_IN_TEMPLATES.find((t) => t.id === 'tpl-annual')!;
const period = { start: '2025-07-01', end: '2026-06-30', label: '2025/26' };

/** The annual template with the Results section (results + statistics) on landscape pages. */
function withLandscapeResults(): ReportTemplate {
  const blocks: ReportBlock[] = [];
  for (const b of annual.blocks) {
    if (b.type === 'heading' && b.text === 'Results') blocks.push({ id: 'pb1', type: 'pageBreak', orientation: 'landscape' });
    if (b.type === 'heading' && b.text === 'Graphs') blocks.push({ id: 'pb2', type: 'pageBreak', orientation: 'portrait' });
    blocks.push(b);
  }
  return { ...annual, id: 'test', blocks };
}

describe('page orientation and graph sizes', () => {
  it('sizes graphs to the page: full width, two per row or a custom size', () => {
    const blk = annual.blocks.find((b) => b.type === 'chart') as ChartBlock;
    expect(chartSizeCm(blk, annual, 'portrait')).toEqual({ widthCm: 17, heightCm: 8.5 });
    const land = chartSizeCm(blk, annual, 'landscape');
    expect(land.widthCm).toBeCloseTo(25.7, 6);
    expect(land.heightCm).toBeLessThan(11); // capped so a heading and caption still fit on the page
    expect(chartSizeCm({ ...blk, size: 'half', aspect: 0.5 }, annual, 'landscape')).toEqual({ widthCm: 12.55, heightCm: 6.275 });
    expect(chartSizeCm({ ...blk, size: 'custom', widthCm: 12, heightCm: 6 }, annual, 'portrait')).toEqual({ widthCm: 12, heightCm: 6 });
  });

  it('lays out a landscape section with landscape widths, and returns to portrait', async () => {
    const b = await loadBundle(projectId);
    const doc = buildReport({ bundle: b, template: withLandscapeResults(), period, settings: DEFAULT_SETTINGS });
    const i1 = doc.nodes.findIndex((n) => n.t === 'pagebreak' && n.orientation === 'landscape');
    const i2 = doc.nodes.findIndex((n) => n.t === 'pagebreak' && n.orientation === 'portrait');
    expect(i1).toBeGreaterThan(0);
    expect(i2).toBeGreaterThan(i1);
    const fixed = (n: (typeof doc.nodes)[number]) => (n.t === 'table' ? n.widths.reduce<number>((s, w) => s + (typeof w === 'number' ? w : 0), 0) : 0);
    const landscapeTables = doc.nodes.slice(i1, i2).filter((n) => n.t === 'table');
    expect(landscapeTables.length).toBeGreaterThan(2);
    expect(Math.max(...landscapeTables.map(fixed))).toBeGreaterThan(usableWidthMm(annual, 'portrait')); // uses the extra width
    expect(landscapeTables.every((n) => fixed(n) <= usableWidthMm(annual, 'landscape') + 0.5)).toBe(true);
    const charts = doc.nodes.slice(i2).filter((n) => n.t === 'image');
    expect(charts.length).toBeGreaterThan(0);
    expect(charts.every((n) => n.t === 'image' && n.widthCm === 17)).toBe(true); // full portrait width

    // the real PDF: portrait title page and front matter, landscape results, portrait graphs – no blank pages
    const pages = await pdfPages(doc);
    const s = pages.join('');
    expect(s).toMatch(/^P+L+P+$/);
    const plain = await pdfPages(buildReport({ bundle: b, template: annual, period, settings: DEFAULT_SETTINGS }));
    expect(plain.every((p) => p === 'P')).toBe(true);
  });

  it('never leaves a blank page for page breaks in a row', async () => {
    const b = await loadBundle(projectId);
    const blocks: ReportBlock[] = [
      { id: 't', type: 'title', title: 'T', showDetails: false, pageBreakAfter: true },
      { id: 'p1', type: 'pageBreak', orientation: 'landscape' },
      { id: 'p2', type: 'pageBreak' },
      { id: 'h', type: 'heading', text: 'Landscape', level: 1 },
      { id: 'p3', type: 'pageBreak', orientation: 'portrait' },
      { id: 'h2', type: 'heading', text: 'Portrait', level: 1 },
    ];
    const doc = buildReport({ bundle: b, template: { ...annual, id: 'x', blocks }, period, settings: DEFAULT_SETTINGS });
    expect(await pdfPages(doc)).toEqual(['P', 'L', 'P']);
    const zip = await JSZip.loadAsync(await (await docxBlob(doc)).arrayBuffer());
    const xml = await zip.file('word/document.xml')!.async('string');
    const sections = Array.from(xml.matchAll(/<w:pgSz [^>]*>/g)).map((m) => (/w:orient="landscape"/.test(m[0]) ? 'L' : 'P'));
    expect(sections).toEqual(['P', 'L', 'P']);
    expect((xml.match(/w:type="page"/g) ?? []).length).toBe(0); // no extra page breaks: the section breaks start the pages
  });

  it('puts two graphs side by side in PDF and Word', async () => {
    const b = await loadBundle(projectId);
    const quarterly = BUILT_IN_TEMPLATES.find((t) => t.id === 'tpl-quarterly')!;
    const twoPerRow = { ...quarterly, blocks: quarterly.blocks.map((x) => (x.type === 'chart' ? { ...x, size: 'half' as const } : x)) };
    const doc = buildReport({ bundle: b, template: twoPerRow, period, settings: DEFAULT_SETTINGS, renderChart: () => 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=' });
    const rows = doc.nodes.filter((n) => n.t === 'figures');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((n) => n.t === 'figures' && n.items.length <= 2)).toBe(true);
    const def = JSON.stringify(toPdfDefinition(doc).content);
    expect(def).toContain('"columns"');
    const zip = await JSZip.loadAsync(await (await docxBlob(doc)).arrayBuffer());
    const xml = await zip.file('word/document.xml')!.async('string');
    expect((xml.match(/<pic:pic /g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

describe('editing the layout', () => {
  const names = (bs: ReportBlock[]) => bs.map((b) => (b.type === 'heading' ? b.text : b.type));
  const at = (text: string) => annual.blocks.findIndex((b) => b.type === 'heading' && b.text === text);

  it('drags a heading with its section, and drops it between sections', () => {
    // Introduction dropped on the Summary heading goes after the whole Summary section
    expect(names(moveSection(annual.blocks, at('Introduction'), at('Summary'))).slice(0, 6)).toEqual(['title', 'Summary', 'summary', 'Introduction', 'text', 'Monitoring locations']);
    // Graphs dropped on the results table goes before the Results section, not into it
    const r = at('Results');
    expect(names(moveSection(annual.blocks, at('Graphs'), r + 1)).slice(r, r + 3)).toEqual(['Graphs', 'chart', 'Results']);
    // dropped on its own content: no change
    expect(moveSection(annual.blocks, r, r + 2)).toBe(annual.blocks);
    // anything else moves on its own
    const chart = annual.blocks.findIndex((b) => b.type === 'chart');
    expect(names(moveSection(annual.blocks, chart, r + 1))[r + 1]).toBe('chart');
  });

  it('steps a section past the next one, taking its sub-sections with it', () => {
    const down = names(stepSection(annual.blocks, at('Results'), 1)!);
    expect(down.slice(at('Results'))).toEqual(['Graphs', 'chart', 'Results', 'resultsTable', 'Summary statistics', 'statsTable', 'Discussion and conclusions', 'text']);
    expect(stepSection(annual.blocks, at('Introduction'), -1)).toBeNull(); // never above the title page
    expect(stepSection(annual.blocks, at('Discussion and conclusions'), 1)).toBeNull();
    expect(stepSection(annual.blocks, 2, 1)).toBeNull(); // only headings move as sections
  });

  it('puts a section on landscape pages, keeps it there when the section moves, then turns back', async () => {
    const blocks = setPages(annual.blocks, at('Results'), 'landscape');
    const orient = (bs: ReportBlock[]) => {
      const o = pageOrientations(bs, 'portrait');
      return (text: string) => o[bs.findIndex((b) => b.type === 'heading' && b.text === text)];
    };
    let o = orient(blocks);
    expect([o('Exceedances'), o('Results'), o('Summary statistics'), o('Graphs')]).toEqual(['portrait', 'landscape', 'landscape', 'portrait']);
    // moved above Monitoring locations: still landscape, and the sections after it are portrait again
    const moved = moveSection(blocks, at('Results'), at('Monitoring locations'));
    o = orient(moved);
    expect([o('Summary'), o('Results'), o('Summary statistics'), o('Monitoring locations'), o('Graphs')]).toEqual(['portrait', 'landscape', 'landscape', 'portrait', 'portrait']);
    // a single table on its own landscape pages
    const table = annual.blocks.findIndex((b) => b.type === 'complianceTable');
    const one = pageOrientations(setPages(annual.blocks, table, 'landscape'), 'portrait');
    expect([one[table - 1], one[table], one[table + 1]]).toEqual(['portrait', 'landscape', 'portrait']);
    // the PDF and Word files follow
    const b = await loadBundle(projectId);
    const doc = buildReport({ bundle: b, template: { ...annual, id: 'x', blocks: moved }, period, settings: DEFAULT_SETTINGS });
    expect((await pdfPages(doc)).join('').replace(/(.)\1+/g, '$1')).toBe('PLP');
    const zip = await JSZip.loadAsync(await (await docxBlob(doc)).arrayBuffer());
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(Array.from(xml.matchAll(/<w:pgSz [^>]*>/g)).map((m) => (/w:orient="landscape"/.test(m[0]) ? 'L' : 'P')).join('')).toBe('PLP');
    // one orientation for the whole report clears it
    expect(hasMixedPages(blocks, 'portrait')).toBe(true);
    expect(hasMixedPages(samePages(blocks), 'landscape')).toBe(false);
    expect(samePages(blocks).filter((x) => x.pages).length).toBe(0);
  });
});
