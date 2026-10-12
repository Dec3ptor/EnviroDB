import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import pdfMake from 'pdfmake/build/pdfmake';
import vfs from 'pdfmake/build/vfs_fonts';
import JSZip from 'jszip';
import zlib from 'node:zlib';
import { imageSize } from '../src/lib/image';
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

  it('drops a block exactly where it is released; a heading brings its section', () => {
    const r = at('Results');
    // Graphs (heading + chart) dropped on the results table: straight above the table
    expect(names(moveSection(annual.blocks, at('Graphs'), r + 1)).slice(r, r + 4)).toEqual(['Results', 'Graphs', 'chart', 'resultsTable']);
    // a sub-section dragged up onto the results table
    expect(names(moveSection(annual.blocks, at('Summary statistics'), r + 1)).slice(r, r + 4)).toEqual(['Results', 'Summary statistics', 'statsTable', 'resultsTable']);
    // moving down: below the row it was dropped on
    expect(names(moveSection(annual.blocks, at('Introduction'), at('Summary'))).slice(0, 5)).toEqual(['title', 'Summary', 'Introduction', 'text', 'summary']);
    // a heading on its own can go straight above a table
    const lone: ReportBlock[] = [...annual.blocks, { id: 'new', type: 'heading', text: 'DP1 results', level: 2 }];
    expect(names(moveSection(lone, lone.length - 1, r + 1)).slice(r, r + 3)).toEqual(['Results', 'DP1 results', 'resultsTable']);
    // dropped on its own content: no change; never above the title page
    expect(moveSection(annual.blocks, r, r + 2)).toBe(annual.blocks);
    expect(names(moveSection(annual.blocks, at('Summary'), 0)).slice(0, 3)).toEqual(['title', 'Summary', 'summary']);
    // anything else moves on its own
    const chart = annual.blocks.findIndex((b) => b.type === 'chart');
    expect(names(moveSection(annual.blocks, chart, r + 1))[r + 1]).toBe('chart');
  });

  it('the arrows move a section past the next section, and anything else one row', () => {
    const down = names(stepSection(annual.blocks, at('Results'), 1)!);
    expect(down.slice(at('Results'))).toEqual(['Graphs', 'chart', 'Results', 'resultsTable', 'Summary statistics', 'statsTable', 'Discussion and conclusions', 'text']);
    expect(stepSection(annual.blocks, at('Introduction'), -1)).toBeNull(); // never above the title page
    expect(stepSection(annual.blocks, at('Discussion and conclusions'), 1)).toBeNull();
    // a paragraph moves one row
    expect(names(stepSection(annual.blocks, 2, 1)!).slice(0, 5)).toEqual(['title', 'Introduction', 'Summary', 'text', 'summary']);
    expect(stepSection(annual.blocks, 1, -1)).toBeNull();
    // so does a heading with nothing under it: up one row puts it straight above the results table
    const s = at('Summary statistics');
    const lone: ReportBlock[] = [...annual.blocks.slice(0, s), { id: 'new', type: 'heading', text: 'DP1 results', level: 2 }, ...annual.blocks.slice(s)];
    expect(names(stepSection(lone, s, -1)!).slice(at('Results'), at('Results') + 3)).toEqual(['Results', 'DP1 results', 'resultsTable']);
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

/** A real PNG of the given size (white). */
function png(width: number, height: number): string {
  const crc = (buf: Buffer) => zlib.crc32(buf);
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td) >>> 0);
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const rows = Buffer.alloc((width * 3 + 1) * height, 0xff);
  for (let y = 0; y < height; y++) rows[y * (width * 3 + 1)] = 0; // filter byte
  const file = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
  return `data:image/png;base64,${file.toString('base64')}`;
}

describe('title page logo', () => {
  it('reads PNG and JPEG sizes', () => {
    expect(imageSize(png(300, 100))).toEqual({ width: 300, height: 100 });
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x64, 0x01, 0x2c, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(imageSize(`data:image/jpeg;base64,${jpeg.toString('base64')}`)).toEqual({ width: 300, height: 100 });
  });

  it('keeps the logo in proportion at the chosen height in PDF and Word, and caps very wide logos', async () => {
    const b = await loadBundle(projectId);
    const build = (logo: string, logoHeightMm?: number) => buildReport({ bundle: b, template: { ...annual, id: 'x', logo, logoHeightMm }, period, settings: DEFAULT_SETTINGS });
    const title = (doc: ReportDoc) => doc.nodes.find((n) => n.t === 'title') as Extract<ReportDoc['nodes'][number], { t: 'title' }>;
    const doc = build(png(300, 100));
    expect(title(doc).logo).toMatchObject({ widthMm: 36, heightMm: 12 }); // default height 12 mm, 3:1 logo
    expect(title(build(png(300, 100), 20)).logo).toMatchObject({ widthMm: 60, heightMm: 20 });
    const wide = title(build(png(1000, 100), 20)).logo!;
    expect(wide.widthMm).toBe(80); // capped
    expect(wide.heightMm).toBeCloseTo(8, 6);
    // PDF: drawn at exactly that size
    const img = JSON.stringify(toPdfDefinition(doc).content).match(/"image":"data:image\/png[^"]*","width":([\d.]+),"height":([\d.]+)/);
    expect(+img![1] / +img![2]).toBeCloseTo(3, 6);
    expect(+img![2]).toBeCloseTo(12 * 2.834645669, 3);
    // Word: same proportions (no longer stretched to 220 × 70 px)
    const zip = await JSZip.loadAsync(await (await docxBlob(doc)).arrayBuffer());
    const xml = await zip.file('word/document.xml')!.async('string');
    const ext = xml.match(/<wp:extent cx="(\d+)" cy="(\d+)"\/>/)!;
    expect(+ext[1] / +ext[2]).toBeCloseTo(3, 1);
    expect(+ext[2] / 360000).toBeCloseTo(1.2, 1); // EMU → cm
  });
});

describe('consent values in results tables', () => {
  type Table = Extract<ReportDoc['nodes'][number], { t: 'table' }>;
  const tables = (doc: ReportDoc) => doc.nodes.filter((n): n is Table => n.t === 'table' && /results/i.test(n.caption ?? ''));
  const withRules = (mode: 'none' | 'limits' | 'all', layout?: 'parametersAsColumns'): ReportTemplate => ({
    ...annual,
    id: 'x',
    blocks: annual.blocks.map((x) => (x.type === 'resultsTable' ? { ...x, ruleColumns: mode, ...(layout ? { layout, splitBySite: false } : {}) } : x)),
  });
  const row = (t: Table, name: string) => t.body.find((r) => r[0].text === name)!.map((c) => c.text);

  it('adds a column per consent level, for the sites each rule applies to', async () => {
    const b = await loadBundle(projectId);
    const doc = buildReport({ bundle: b, template: withRules('all'), period, settings: DEFAULT_SETTINGS });
    const site = (code: string) => tables(doc).find((t) => t.caption!.includes(` – ${code}`))!;
    const dp1 = site('DP1');
    expect(dp1.head[0].slice(0, 5).map((c) => c.text)).toEqual(['Parameter', 'Unit', 'Limit', 'Trigger 1', 'ANZG FW 95%']);
    expect(row(dp1, 'Total Suspended Solids').slice(2, 4)).toEqual(['100', '50\n(2 in a row)']);
    expect(row(dp1, 'pH').slice(2, 4)).toEqual(['6–9', '']);
    expect(site('DS1').head[0].slice(2, 4).map((c) => c.text)).toEqual(['Trigger', 'ANZG FW 95%']);
    expect(row(site('DS1'), 'Nitrate-N')[2]).toBe('2.4\n(median)');
    expect(site('US1').head[0][2].text).toBe('ANZG FW 95%'); // no consent rules at the upstream site
    expect(tables(doc).filter((t) => t.caption!.includes(' – DP1')).at(-1)!.notes!.join(' ')).toMatch(/brackets/); // notes go under the last part
    // Word puts the bracket on its own line too
    const xml = await (await JSZip.loadAsync(await (await docxBlob(doc)).arrayBuffer())).file('word/document.xml')!.async('string');
    expect(xml).toMatch(/<w:t xml:space="preserve">50<\/w:t><\/w:r><w:r>(?:<w:rPr>.*?<\/w:rPr>)?<w:br\/><w:t xml:space="preserve">\(2 in a row\)<\/w:t>/);
    // limits only, or none
    const limits = buildReport({ bundle: b, template: withRules('limits'), period, settings: DEFAULT_SETTINGS });
    expect(tables(limits).find((t) => t.caption!.includes(' – DP1'))!.head[0].slice(2, 4).map((c) => c.text)).toEqual(['Limit', 'ANZG FW 95%']);
    const none = buildReport({ bundle: b, template: withRules('none'), period, settings: DEFAULT_SETTINGS });
    expect(tables(none).find((t) => t.caption!.includes(' – DP1'))!.head[0][2].text).toBe('ANZG FW 95%');
  });

  it('adds consent rows, naming the site, when samples run down the table', async () => {
    const b = await loadBundle(projectId);
    const doc = buildReport({ bundle: b, template: withRules('all', 'parametersAsColumns'), period, settings: DEFAULT_SETTINGS });
    const first = tables(doc)[0];
    const tssCol = first.head[0].findIndex((c) => c.text === 'TSS' || c.text === 'Total Suspended Solids');
    expect(tssCol).toBeGreaterThan(1);
    const limitRow = first.body.find((r) => r[0].text === 'Limit')!;
    expect(limitRow[tssCol].text).toBe('100\n(DP1)');
  });
});
