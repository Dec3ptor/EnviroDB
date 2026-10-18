import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import * as d from 'docx';
import { DEFAULT_SETTINGS, db, ensureBuiltIns } from '../src/db/db';
import { createDemoProject } from '../src/db/demo';
import { BUILT_IN_TEMPLATES } from '../src/data/templates';
import type { FigureImage, Letterhead, Parameter, ReportBlock, ReportTemplate, Result, Settings, Site } from '../src/db/types';
import { buildReport, letterheadFor, siteSummary, trendOf } from '../src/reports/build';
import { TEXT_FLAGS, parseMarkup, type DocNode, type ReportDoc } from '../src/reports/model';
import { toPdfDefinition } from '../src/reports/pdf';
import { docxBlob } from '../src/reports/docx';
import { bytesOfDataUrl, readLetterhead } from '../src/reports/wordLetterhead';
import { captionFromFileName } from '../src/lib/image';
import { loadBundle, png } from './helpers';
import { newRule } from '../src/db/repo';

type Table = Extract<DocNode, { t: 'table' }>;
type Gallery = Extract<DocNode, { t: 'gallery' }>;

let projectId = '';
let sites: Record<string, Site> = {};
beforeAll(async () => {
  await ensureBuiltIns();
  projectId = await createDemoProject();
  sites = Object.fromEntries((await db.sites.where('projectId').equals(projectId).toArray()).map((s) => [s.code, s]));
});

const event = BUILT_IN_TEMPLATES.find((t) => t.id === 'tpl-letter-event')!;
const annual = BUILT_IN_TEMPLATES.find((t) => t.id === 'tpl-letter-annual')!;
const march = { start: '2026-03-01', end: '2026-03-31', label: 'March 2026' };
const year = { start: '2025-07-01', end: '2026-06-30', label: '2025/26' };
const me: Settings = { ...DEFAULT_SETTINGS, author: 'Ben Foote', company: 'Example Ltd', signatureDetails: 'Environmental Scientist' };
const texts = (n: DocNode) => (n.t === 'p' ? n.runs.map((r) => r.text).join('') : n.t === 'lines' ? n.lines.map((l) => l.map((r) => r.text).join('')).join('\n') : n.t === 'h' ? n.text : '');
const allText = (doc: ReportDoc) => doc.nodes.map(texts).join('\n');

/** A company letter template made in Word: a logo in the header, the address in page 1's footer, page numbers after. */
async function wordLetterhead(): Promise<Uint8Array> {
  const logo = Buffer.from(png(220, 105).split(',')[1], 'base64');
  const picture = () => new d.Paragraph({ children: [new d.ImageRun({ type: 'png', data: logo, transformation: { width: 83, height: 40 } })] });
  const word = new d.Document({
    styles: {
      paragraphStyles: [
        { id: 'Normal', name: 'Normal', run: { font: 'Lato Light', size: 20, color: '1F2933' }, paragraph: { indent: { left: 284 } } },
        { id: 'Heading1', name: 'heading 1', basedOn: 'Normal', run: { font: 'Lato', size: 36, color: 'B03A2E' } },
        { id: 'LetterAddress', name: 'Letter address', basedOn: 'Normal', run: { size: 14, color: 'B03A2E' } },
      ],
    },
    sections: [
      {
        properties: { titlePage: true, page: { margin: { top: 1701, right: 1134, bottom: 1418, left: 1418, header: 709, footer: 567 } } },
        headers: { first: new d.Header({ children: [picture()] }), default: new d.Header({ children: [picture()] }) },
        footers: {
          first: new d.Footer({ children: ['Example Ltd', 'Level 1, 1 Main Street', 'Town 1234'].map((t) => new d.Paragraph({ style: 'LetterAddress', children: [new d.TextRun(t)] })) }),
          default: new d.Footer({
            children: [
              new d.Paragraph({ children: [new d.TextRun({ text: 'example.com', color: 'B03A2E', size: 14 })] }),
              new d.Paragraph({ alignment: d.AlignmentType.RIGHT, children: [new d.TextRun({ children: [d.PageNumber.CURRENT], size: 12 })] }),
            ],
          }),
        },
        children: [new d.Paragraph('Confidential client text that must not be kept')],
      },
    ],
  });
  return new Uint8Array(await d.Packer.toBuffer(word));
}

describe('letter text', () => {
  it('reads "> " lines as a quotation, e.g. a consent condition', () => {
    expect(parseMarkup('Condition 14.1 requires:\n\n> The permit holder shall *supply* a report\n> annually in January.\n\nAs follows.')).toEqual([
      { t: 'p', runs: [{ text: 'Condition 14.1 requires:' }] },
      { t: 'p', runs: [{ text: 'The permit holder shall ' }, { text: 'supply', italic: true }, { text: ' a report annually in January.' }], quote: true },
      { t: 'p', runs: [{ text: 'As follows.' }] },
    ]);
  });

  it('opens with the date, who it is to, the subject in bold, the reference and the greeting', async () => {
    await db.projects.update(projectId, { recipient: 'Jane Smith\nCompliance Officer\nExample Regional Council', salutation: 'Dear Jane,' });
    const doc = buildReport({ bundle: await loadBundle(projectId), template: event, period: march, settings: me });
    expect(doc.look).toMatchObject({ style: 'letter', tableHeader: 'grey', highlight: 'text' });
    const [date, to, , ref] = doc.nodes.filter((n) => n.t === 'lines' || n.t === 'p').slice(0, 5);
    expect(texts(date)).toMatch(/^\d{1,2} \w+ \d{4}$/);
    expect(texts(to)).toBe('Jane Smith\nCompliance Officer\nExample Regional Council');
    const subject = doc.nodes.find((n): n is Extract<DocNode, { t: 'p' }> => n.t === 'p' && /Compliance Monitoring/.test(texts(n)))!;
    expect(subject.runs.every((r) => r.bold)).toBe(true);
    expect(texts(subject)).toContain('– March 2026');
    expect(texts(ref)).toBe('Project ref: DEMO-001');
    expect(allText(doc)).toContain('Dear Jane,');
    // no one named yet: a polite greeting, and the preview asks who it is to
    await db.projects.update(projectId, { recipient: undefined, salutation: undefined });
    const blank = buildReport({ bundle: await loadBundle(projectId), template: event, period: march, settings: me, preview: true });
    expect(allText(blank)).toContain('Dear Sir / Madam,');
    expect(blank.nodes.some((n) => n.t === 'note' && /Who is this letter to/.test(n.text))).toBe(true);
    expect(buildReport({ bundle: await loadBundle(projectId), template: event, period: march, settings: me }).nodes.some((n) => n.t === 'note')).toBe(false); // not in the real thing
  });

  it('signs off with the closing line above your signature', async () => {
    const doc = buildReport({ bundle: await loadBundle(projectId), template: event, period: march, settings: me });
    const sign = doc.nodes.find((n): n is Extract<DocNode, { t: 'signatures' }> => n.t === 'signatures')!;
    expect(sign.closing).toEqual([{ text: 'Kind regards,' }]);
    expect(sign.items).toMatchObject([{ role: '', name: 'Ben Foote', lines: [[{ text: 'Environmental Scientist' }]] }]);
  });
});

describe('results vs previous rounds', () => {
  const p = { id: 'x', name: 'X', group: 'Other', unit: 'mg/L', aliases: [] } as Parameter;
  const r = (value: number, qualifier: '' | '<' = '') => ({ value, qualifier, unit: 'mg/L' }) as Result;

  it('says how each result changed since the previous round', () => {
    expect(trendOf(r(2.6), r(2.5), p)).toBe('Increase');
    expect(trendOf(r(1.92), r(2.1), p)).toBe('Decrease');
    expect(trendOf(r(5.5), r(5.5), p)).toBe('Stable');
    expect(trendOf(r(0.01, '<'), r(0.005, '<'), p)).toBe('Stable'); // both below detection
    expect(trendOf(r(0.02), r(0.01, '<'), p)).toBe('Increase');
    expect(trendOf(r(1), undefined, p)).toBe(''); // no previous round: the comment just says whether it complies
  });

  it('drafts a summary for each site from its results', () => {
    const fact = (name: string, patch: object) => ({ p: { ...p, name }, trend: 'Stable', status: 'ok' as const, value: '1 g/m³', broken: [], again: false, record: false, ...patch });
    expect(siteSummary([fact('Nitrate-N', { status: 'exceed', trend: 'Decrease', value: '1.92 g/m³', broken: [{ level: 'Trigger', limit: '> 1.51 g/m³' }], again: true }), fact('pH', {})])).toBe(
      'Nitrate-N (1.92 g/m³) continues to exceed the trigger (> 1.51 g/m³). All other parameters remain compliant.',
    );
    expect(siteSummary([fact('pH', {}), fact('Potassium', { trend: 'Increase', change: 40 }), fact('Chloride', { record: true })])).toBe(
      'All parameters remain compliant. Potassium increased since the previous round, but remain below their trigger levels. Chloride was the highest result on record at this site.',
    );
    expect(siteSummary([fact('pH', { status: 'none' })])).toBe('');
  });

  it("puts each site's results beside the previous round and its consent values, with a comment and red exceedances", async () => {
    const doc = buildReport({ bundle: await loadBundle(projectId), template: event, period: march, settings: me });
    const at = doc.nodes.findIndex((n) => n.t === 'h' && n.text === 'DP1 – Sediment pond outlet');
    expect(at).toBeGreaterThan(0);
    expect(doc.nodes[at]).toMatchObject({ t: 'h', level: 3 });
    expect((doc.nodes[at] as Extract<DocNode, { t: 'h' }>).number).toBeUndefined();
    const table = doc.nodes[at + 1] as Table;
    expect(table.caption).toBeUndefined(); // under a heading, as in a letter
    expect(table.head[0].map((c) => c.text)).toEqual(['Parameter', 'Unit', 'Mar-26', 'Feb-26', 'Limit', 'Trigger 1', 'Comment']);
    const row = (name: string) => table.body.find((x) => x[0].text === name)!;
    const tss = row('Total Suspended Solids');
    expect(tss.slice(2, 5).map((c) => c.text)).toEqual(['141', '16', '100']);
    expect(tss[2]).toMatchObject({ color: TEXT_FLAGS.exceed, bold: true }); // a limit: red and bold
    expect(tss[2].fill).toBeUndefined();
    expect(tss[6]).toMatchObject({ text: 'Increase – Exceedance', color: TEXT_FLAGS.exceed });
    expect(row('pH')[6].text).toBe('Stable – Compliant');
    expect(row('Total Hardness')[6].text).toBe('Increase'); // no consent value: just the change
    // a summary under the table, drafted from the results – and the user's own words once written
    const key = `le-rounds:${sites.DP1.id}`;
    const field = doc.commentary.find((c) => c.key === key)!;
    expect(field).toMatchObject({ label: 'DP1 – summary' });
    expect(field.auto).toMatch(/^Total Suspended Solids \(141 mg\/L\) exceeded the limit \(> 100 mg\/L\)\. All other parameters remain compliant\./);
    expect(doc.nodes[at + 2]).toMatchObject({ t: 'p', runs: [{ text: 'Summary: ', bold: true }, { text: field.auto }] });
    const mine = buildReport({ bundle: await loadBundle(projectId), template: event, period: march, settings: me, promptTexts: { [key]: 'TSS exceeded the limit after heavy rain; the Council was notified.' } });
    const i2 = mine.nodes.findIndex((n) => n.t === 'h' && n.text === 'DP1 – Sediment pond outlet');
    expect(texts(mine.nodes[i2 + 2])).toBe('Summary: TSS exceeded the limit after heavy rain; the Council was notified.');
    // a change limit says what it is relative to; a site not sampled says so
    expect(doc.commentary.find((c) => c.key === `le-rounds:${sites.DS1.id}`)!.auto).toContain('the limit (> 50% above US1)');
    const gw = doc.nodes.findIndex((n) => n.t === 'h' && n.text.startsWith('GW1'));
    expect(texts(doc.nodes[gw + 1])).toBe('Not sampled in this round.');
  });

  it('shows earlier rounds side by side in an annual letter, with numbered captions', async () => {
    const doc = buildReport({ bundle: await loadBundle(projectId), template: annual, period: year, settings: me });
    const dp1 = doc.nodes.find((n): n is Table => n.t === 'table' && /^Table \d+\. Results – DP1/.test(n.caption ?? ''))!;
    expect(dp1.head[0].map((c) => c.text).slice(0, 6)).toEqual(['Parameter', 'Unit', 'Jun-26', 'May-26', 'Apr-26', 'Mar-26']);
  });
});

describe('a section for some sites only', () => {
  it('shows only the sites chosen for a results table, and all of them when the choice is from elsewhere', async () => {
    const b = await loadBundle(projectId);
    const gw1 = b.sites.find((s) => s.code === 'GW1')!.id;
    const only = (ids: string[]): ReportTemplate => ({ ...annual, blocks: annual.blocks.map((x) => (x.type === 'resultsTable' || x.type === 'roundTable' ? { ...x, siteIds: ids } : x)) as ReportBlock[] });
    const captions = (t: ReportTemplate) =>
      buildReport({ bundle: b, template: t, period: year, settings: me })
        .nodes.filter((n): n is Table => n.t === 'table' && /Results – /.test(n.caption ?? ''))
        .map((n) => n.caption!.replace(/^Table \d+\. /, ''));
    expect(captions(only([gw1])).every((c) => c.includes('GW1'))).toBe(true);
    expect(captions(only([gw1])).length).toBeGreaterThan(0);
    const everySite = captions(only(['site-from-another-project']));
    expect(everySite.some((c) => c.includes('DP1')) && everySite.some((c) => c.includes('GW1'))).toBe(true);
  });
});

describe('a section leaving some out', () => {
  it('leaves out the parameters and sites chosen – e.g. water levels in a table of their own', async () => {
    const b = await loadBundle(projectId);
    const dp1 = b.sites.find((s) => s.code === 'DP1')!.id;
    const t: ReportTemplate = {
      ...annual,
      blocks: annual.blocks.map((x) => (x.type === 'resultsTable' || x.type === 'roundTable' ? { ...x, excludeParameterIds: ['ph'], excludeSiteIds: [dp1] } : x)) as ReportBlock[],
    };
    const tables = buildReport({ bundle: b, template: t, period: year, settings: me }).nodes.filter((n): n is Table => n.t === 'table' && /Results – /.test(n.caption ?? ''));
    expect(tables.length).toBeGreaterThan(0);
    expect(tables.some((n) => n.caption!.includes('DP1'))).toBe(false);
    expect(tables.some((n) => n.caption!.includes('DS1'))).toBe(true);
    expect(tables.flatMap((n) => n.body.map((r) => r[0].text)).includes('pH')).toBe(false);
    // and a table of just one parameter
    const only: ReportTemplate = { ...annual, blocks: annual.blocks.map((x) => (x.type === 'roundTable' ? { ...x, parameterIds: ['tss'] } : x)) as ReportBlock[] };
    const rows = buildReport({ bundle: b, template: only, period: year, settings: me })
      .nodes.filter((n): n is Table => n.t === 'table' && /Results – /.test(n.caption ?? ''))
      .flatMap((n) => n.body.map((r) => r[0].text));
    expect(new Set(rows)).toEqual(new Set(['Total Suspended Solids']));
  });
});

describe('trigger levels table', () => {
  it('lists each parameter and level with a column per site, and text can refer to it by name', async () => {
    const doc = buildReport({ bundle: await loadBundle(projectId), template: annual, period: year, settings: me });
    const t = doc.nodes.find((n): n is Table => n.t === 'table' && /Consent limits and trigger levels/.test(n.caption ?? ''))!;
    const no = t.caption!.match(/^Table (\d+)\./)![1];
    expect(allText(doc)).toContain(`The consent limits and trigger levels the results are assessed against are given in Table ${no}.`);
    expect(t.head[0].map((c) => c.text)).toEqual(['Parameter', 'Unit', 'Level', 'DP1', 'DS1', 'GW1']);
    const rows = t.body.map((r) => r.map((c) => c.text));
    expect(rows).toContainEqual(['pH', 'pH units', 'Limit', '6–9', '–', '–']);
    expect(rows).toContainEqual(['Total Suspended Solids', 'mg/L', 'Limit', '100', '–', '–']);
    expect(rows).toContainEqual(['Total Suspended Solids', 'mg/L', 'Trigger 1', '50\n(2 in a row)', '–', '–']);
    expect(rows).toContainEqual(['Nitrate-N', 'mg/L', 'Trigger', '–', '2.4\n(median)', '–']);
    // limits only: no level column
    const limits: ReportTemplate = { ...annual, blocks: annual.blocks.map((b) => (b.type === 'triggerTable' ? { ...b, levels: 'limits' } : b)) as ReportBlock[] };
    const lt = buildReport({ bundle: await loadBundle(projectId), template: limits, period: year, settings: me }).nodes.find((n): n is Table => n.t === 'table' && /^Table \d+\. Consent limits$/.test(n.caption ?? ''))!;
    expect(lt.head[0].map((c) => c.text)).toEqual(['Parameter', 'Unit', 'DP1']);
    // a name no section has
    const lost: ReportTemplate = { ...annual, blocks: annual.blocks.map((b) => (b.type === 'triggerTable' ? { ...b, ref: undefined } : b)) as ReportBlock[] };
    expect(allText(buildReport({ bundle: await loadBundle(projectId), template: lost, period: year, settings: me }))).toContain('are given in Table ?.');
  });

  it('gives the guideline values of rules that compare chosen analytes with a guideline set', async () => {
    const b = await loadBundle(projectId);
    const ds1 = b.sites.find((s) => s.code === 'DS1')!.id;
    const extra = [
      newRule(projectId, { id: 'g1', name: 'Zinc vs ANZG 95%', level: 'Trigger', kind: 'guideline', guidelineSetId: 'anzg-fw-95', parameterIds: ['zn-d'], hardnessAdjust: true, siteIds: [ds1] }),
      newRule(projectId, { id: 'g2', name: 'Copper at the ANZG 90% value', level: 'Limit', kind: 'threshold', parameterId: 'cu-d', limitSetId: 'anzg-fw-90', siteIds: [ds1] }),
    ];
    const doc = buildReport({ bundle: { ...b, rules: [...b.rules, ...extra] }, template: annual, period: year, settings: me });
    const t = doc.nodes.find((n): n is Table => n.t === 'table' && /Consent limits and trigger levels/.test(n.caption ?? ''))!;
    const rows = t.body.map((r) => r.map((c) => c.text));
    const zinc = rows.find((r) => r[0] === 'Dissolved Zinc')!;
    const copper = rows.find((r) => r[0] === 'Dissolved Copper')!;
    const at = t.head[0].findIndex((c) => c.text === 'DS1');
    expect([zinc[2], zinc[at]]).toEqual(['Trigger', zinc[1] === 'µg/L' ? '8\n(HMTV)' : '0.008\n(HMTV)']);
    expect([copper[2], copper[at]]).toEqual(['Limit', copper[1] === 'µg/L' ? '1.8' : '0.0018']);
    expect(t.notes?.join(' ')).toMatch(/HMTV: hardness-modified for each sample/);
    // the rule over the whole set (in the demo) adds no rows of its own
    expect(rows.some((r) => r[0] === 'Dissolved Cadmium')).toBe(false);
  });
});

describe('figures', () => {
  const pic = (id: string, caption: string, ref?: string, w = 400, h = 300): FigureImage => ({ id, src: png(w, h), caption, ref });
  const template = (fig: Partial<Extract<ReportBlock, { type: 'figures' }>>, style: ReportTemplate['style'] = 'letter'): ReportTemplate => ({
    ...event,
    style,
    blocks: [
      { id: 't1', type: 'text', text: 'The pond was dry ({{fig:pond}}); see also {{fig:photos}}.' },
      { id: 'f1', type: 'figures', images: [pic('a', 'Upstream')], perRow: 2, heightMm: 0, numbering: 'each', label: 'Photo', caption: '', ...fig },
    ],
  });
  const build = (t: ReportTemplate, figures?: Record<string, FigureImage[]>, preview = false) => buildReport({ bundle: { ...emptyBundle() }, template: t, period: march, settings: me, figures, preview });
  let emptyBundle: () => Parameters<typeof buildReport>[0]['bundle'];
  beforeAll(async () => {
    const b = await loadBundle(projectId);
    emptyBundle = () => b;
  });

  it('lays out the template’s images and this report’s in rows, numbered, and resolves references written before them', () => {
    const doc = build(template({ ref: 'photos' }), { f1: [pic('b', 'The dry pond', 'pond', 300, 400)] });
    const g = doc.nodes.find((n): n is Gallery => n.t === 'gallery')!;
    expect(g.perRow).toBe(2);
    expect(g.colWidthMm).toBeCloseTo((210 - 20 - 20 - 5) / 2, 5); // A4 less the margins, then the gap
    expect(g.items.map((i) => i.caption)).toEqual(['Photo 1. Upstream', 'Photo 2. The dry pond']);
    expect(g.items[0].heightMm).toBeCloseTo(g.items[0].widthMm * 0.75, 5); // keeps its shape
    expect(g.items[1].heightMm).toBeLessThanOrEqual(g.colWidthMm * (400 / 300) + 0.001);
    expect(allText(doc)).toContain('The pond was dry (Photo 2); see also Photo 1.');
    // a report-style template: "Photo 1: …"
    expect(build(template({}, 'report')).nodes.find((n): n is Gallery => n.t === 'gallery')!.items[0].caption).toBe('Photo 1: Upstream');
  });

  it('can number a group once, with (a), (b) … under the images', () => {
    const doc = build(template({ numbering: 'group', label: 'Figure', caption: 'Site photos', ref: 'photos' }), { f1: [pic('b', 'Pond', 'pond')] });
    const g = doc.nodes.find((n): n is Gallery => n.t === 'gallery')!;
    expect(g.items.map((i) => i.caption)).toEqual(['(a) Upstream', '(b) Pond']);
    expect(g.caption).toBe('Figure 1. Site photos');
    expect(allText(doc)).toContain('The pond was dry (Figure 1(b)); see also Figure 1.');
  });

  it('fits images to a set height, and leaves the section out when there are none', () => {
    const g = build(template({ heightMm: 45 })).nodes.find((n): n is Gallery => n.t === 'gallery')!;
    expect(g.items[0]).toMatchObject({ heightMm: 45, widthMm: 60 });
    const none = template({ images: [] });
    expect(build(none).nodes.some((n) => n.t === 'gallery' || n.t === 'note')).toBe(false);
    expect(build(none, undefined, true).nodes.some((n) => n.t === 'note' && /no images yet/.test(n.text))).toBe(true);
  });

  it('draws them in PDF and Word at the sizes worked out', async () => {
    const doc = build(template({ border: true }), { f1: [pic('b', 'Pond')] });
    const g = doc.nodes.find((n): n is Gallery => n.t === 'gallery')!;
    const pdf = JSON.stringify(toPdfDefinition(doc).content);
    expect(pdf.match(/"image":"data:image\/png/g)).toHaveLength(2);
    expect(pdf).toContain('"text":"Photo 1. Upstream"');
    const xml = await (await JSZip.loadAsync(await (await docxBlob(doc)).arrayBuffer())).file('word/document.xml')!.async('string');
    const ext = Array.from(xml.matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"\/>/g)).map((m) => Math.round(+m[1] / 36000));
    expect(ext).toEqual([Math.round(g.items[0].widthMm), Math.round(g.items[1].widthMm)]);
    expect(xml).toContain('<a:ln w="6350">'); // the border
  });

  it('names images from their file names, but not cameras’ numbers', () => {
    expect(captionFromFileName('site_plan.png')).toBe('Site plan');
    expect(captionFromFileName('stormwater-pond-dry.jpeg')).toBe('Stormwater pond dry');
    expect(captionFromFileName('IMG_2041.JPG')).toBe('');
    expect(captionFromFileName('Screenshot 2026-10-01 at 10.00.00.png')).toBe('');
  });
});

describe('letterhead from a Word file', () => {
  let lh: Letterhead;
  beforeAll(async () => {
    lh = await readLetterhead(await wordLetterhead(), 'Company letter.docx');
  });

  it('reads the margins, fonts, colours, logo, address and page numbers', () => {
    expect(lh.marginsMm).toEqual({ top: 30, right: 20, bottom: 25, left: 25, header: 12.5, footer: 10 });
    expect(lh).toMatchObject({ fileName: 'Company letter.docx', indentMm: 5, font: 'Lato Light', headingFont: 'Lato', fontSize: 10, textColor: '#1F2933', headingColor: '#B03A2E' });
    expect(lh.first.header).toHaveLength(1);
    expect(lh.first.header[0]).toMatchObject({ kind: 'image', align: 'left', dx: 5 });
    expect((lh.first.header[0] as { widthMm: number }).widthMm).toBeCloseTo(21.96, 1);
    expect(lh.first.footer.map((it) => it.kind === 'text' && it.runs)).toEqual(['Example Ltd', 'Level 1, 1 Main Street', 'Town 1234'].map((text) => [{ text, color: '#B03A2E', sizePt: 7 }]));
    expect(lh.other.footer).toMatchObject([
      { kind: 'text', align: 'left', runs: [{ text: 'example.com', color: '#B03A2E', sizePt: 7 }] },
      { kind: 'text', align: 'right', runs: [{ text: '{page}', sizePt: 6 }] },
    ]);
  });

  it('keeps only the letterhead of the file, none of its text', async () => {
    const zip = await JSZip.loadAsync(bytesOfDataUrl(lh.docx!));
    const body = await zip.file('word/document.xml')!.async('string');
    expect(body).not.toContain('Confidential');
    expect(body).toMatch(/<w:body><w:p\/><w:sectPr>/);
    const footers = await Promise.all(Object.keys(zip.files).filter((f) => /^word\/footer\d+\.xml$/.test(f)).map((f) => zip.file(f)!.async('string')));
    expect(footers.join('')).toContain('Level 1, 1 Main Street');
    expect(Object.keys(zip.files).some((f) => /^word\/media\/.+\.png$/.test(f))).toBe(true);
  });

  it('prints PDFs on it: the logo and address on page 1, page numbers after', async () => {
    const doc = buildReport({ bundle: await loadBundle(projectId), template: event, period: march, settings: { ...me, letterhead: lh } });
    expect(doc.page).toEqual({ top: 30, right: 20, bottom: 25, left: 25, header: 12.5, footer: 10, indent: 5 });
    expect(doc.look.headingColor).toBe('#B03A2E');
    const def = toPdfDefinition(doc);
    const MM = 2.834645669;
    const [left, , , bottom] = def.pageMargins as number[];
    expect(left / MM).toBeCloseTo(30, 5); // the margin and the text indent
    expect(bottom / MM).toBeGreaterThan(10 + 3 * 7 * 1.2 * 0.3528); // room for the three address lines
    const header = def.header as (p: number, n: number) => unknown;
    const footer = def.footer as (p: number, n: number) => unknown;
    expect(JSON.stringify(header(1, 3))).toContain('data:image/png');
    expect(JSON.stringify(footer(1, 3))).toContain('Level 1, 1 Main Street');
    expect(JSON.stringify(footer(2, 3))).toContain('"text":"2"');
    expect(JSON.stringify(footer(2, 3))).toContain('example.com');
  });

  it('builds Word documents on the file’s own header and footers, with nothing left dangling', async () => {
    const doc = buildReport({ bundle: await loadBundle(projectId), template: annual, period: year, settings: { ...me, letterhead: lh } }); // has a landscape appendix: two sections
    const zip = await JSZip.loadAsync(await (await docxBlob(doc)).arrayBuffer());
    const xml = await zip.file('word/document.xml')!.async('string');
    const sects = xml.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/g)!;
    expect(sects.length).toBe(2);
    for (const s of sects) {
      expect(s).toMatch(/<w:headerReference w:type="default" r:id="rIdLetterhead\d+"\/>/);
      expect(s).toMatch(/<w:footerReference w:type="first" r:id="rIdLetterhead\d+"\/>/);
      expect(s).toContain('<w:pgMar w:top="1701" w:right="1134" w:bottom="1418" w:left="1418" w:header="709" w:footer="567"');
    }
    expect(sects.map((s) => s.includes('<w:titlePg/>'))).toEqual([true, false]); // the address on the letter's first page only
    expect(sects[1]).toContain('w:orient="landscape"');
    // every link in the package goes somewhere, and every part has a type
    const files = new Set(Object.keys(zip.files));
    for (const name of [...files].filter((f) => f.endsWith('.rels'))) {
      const folder = name.replace(/(^|\/)_rels\/[^/]*\.rels$/, '$1');
      for (const m of (await zip.file(name)!.async('string')).matchAll(/<Relationship [^>]*Target="([^"]+)"([^>]*)\/>/g)) {
        if (/TargetMode="External"/.test(m[0])) continue;
        const target = m[1].startsWith('/') ? m[1].slice(1) : `${folder}${m[1]}`.replace(/[^/]+\/\.\.\//g, '');
        expect(files.has(target), `${name} → ${m[1]}`).toBe(true);
      }
    }
    const types = await zip.file('[Content_Types].xml')!.async('string');
    for (const m of types.matchAll(/PartName="\/([^"]+)"/g)) expect(files.has(m[1]), m[1]).toBe(true);
    // the letterhead's parts, pictures and styles came across; nothing of EnviroDB's own header is left
    const parts = [...files].filter((f) => /^word\/letterhead-(header|footer)\d+\.xml$/.test(f));
    expect(parts.length).toBe(4);
    expect([...files].filter((f) => /^word\/(header|footer)\d+\.xml$/.test(f))).toEqual([]);
    const footerXml = (await Promise.all(parts.map((f) => zip.file(f)!.async('string')))).join('');
    expect(footerXml).toContain('Level 1, 1 Main Street');
    expect(footerXml).toContain('<w:pStyle w:val="LhLetterAddress"/>');
    const styles = await zip.file('word/styles.xml')!.async('string');
    expect(styles).toContain('w:styleId="LhNormal"');
    expect(styles).toMatch(/w:styleId="LhLetterAddress"[\s\S]*?<w:basedOn w:val="LhNormal"\/>/);
    expect(styles.match(/w:styleId="Normal"/g) ?? []).toHaveLength(0); // the report keeps its own default style
    // the report's own look: the letterhead's fonts and heading colour
    expect(styles).toMatch(/w:styleId="Heading1"[\s\S]*?w:ascii="Lato"[\s\S]*?<w:color w:val="B03A2E"\/>/);
    // and without the Word file, the parts are drawn from what was read
    const plain = buildReport({ bundle: await loadBundle(projectId), template: event, period: march, settings: { ...me, letterhead: { ...lh, useWordFile: false } } });
    const drawn = await JSZip.loadAsync(await (await docxBlob(plain)).arrayBuffer());
    expect([...Object.keys(drawn.files)].some((f) => /letterhead-/.test(f))).toBe(false);
    const drawnFooters = await Promise.all(Object.keys(drawn.files).filter((f) => /^word\/footer\d+\.xml$/.test(f)).map((f) => drawn.file(f)!.async('string')));
    expect(drawnFooters.join('')).toContain('Level 1, 1 Main Street');
  });

  it('gives a letter without a letterhead its template’s logo and footer', () => {
    const logo = png(300, 100);
    const lhOf = letterheadFor({ ...event, logo, footerText: '{{company}}' }, {});
    expect(lhOf!.first.header).toMatchObject([{ kind: 'image', dataUrl: logo, heightMm: 12 }]);
    expect(lhOf!.other.footer).toMatchObject([{ align: 'left', runs: [{ text: '{{company}}' }] }, { align: 'right', runs: [{ text: '{page}' }] }]);
    expect(letterheadFor(BUILT_IN_TEMPLATES.find((t) => t.id === 'tpl-annual')!, {})).toBeUndefined(); // a report keeps its classic header and footer
  });

  it('fills in placeholders in the letterhead’s lines', async () => {
    const doc = buildReport({ bundle: await loadBundle(projectId), template: { ...event, footerText: '{{company}} · {{project.code}}' }, period: march, settings: me });
    expect(doc.letterhead!.other.footer[0]).toMatchObject({ runs: [{ text: 'Example Ltd · DEMO-001' }] });
    const footer = toPdfDefinition(doc).footer as (p: number, n: number) => unknown;
    expect(JSON.stringify(footer(2, 3))).toContain('Example Ltd · DEMO-001');
    expect(JSON.stringify(footer(2, 3))).not.toContain('{{');
  });

  it('turns away files that are not Word documents', async () => {
    await expect(readLetterhead(new TextEncoder().encode('not a zip'), 'x.docx')).rejects.toThrow(/not a Word document/);
  });
});

describe('the letter templates', () => {
  it('build both letters, in PDF and Word', async () => {
    const b = await loadBundle(projectId);
    for (const [t, period] of [
      [event, march],
      [annual, year],
    ] as const) {
      const doc = buildReport({ bundle: b, template: t, period, settings: me });
      expect(doc.nodes.length).toBeGreaterThan(10);
      expect(doc.nodes.some((n) => n.t === 'h' && n.number)).toBe(false); // letters' headings aren't numbered
      expect(doc.nodes.filter((n): n is Table => n.t === 'table').every((x) => !x.caption || /^Table \d+\. /.test(x.caption))).toBe(true);
      expect(toPdfDefinition(doc).content).toBeTruthy();
      expect((await docxBlob(doc)).size).toBeGreaterThan(5000);
    }
    expect(buildReport({ bundle: b, template: event, period: march, settings: me }).fileName).toMatch(/March 2026$/);
  });
});
