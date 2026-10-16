import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import * as d from 'docx';
import { DEFAULT_SETTINGS, db, ensureBuiltIns, getSettings, saveSettings } from '../src/db/db';
import { createDemoProject } from '../src/db/demo';
import { deleteTemplate, restoreBuiltInTemplates, templateFrom } from '../src/db/repo';
import { BUILT_IN_TEMPLATES, STARTER_TEMPLATES } from '../src/data/templates';
import type { ReportBlock, ReportTemplate } from '../src/db/types';
import { buildReport, previousPeriod, summaryText } from '../src/reports/build';
import { calcLabel, calcToken, calcValue, fillCalcs } from '../src/reports/calc';
import { kindOfDocument, pdfOutline, planFromOutline, readWordOutline, templateFromPlan, textOutline } from '../src/reports/docTemplate';
import { newBlock } from '../src/components/report/blocks';
import type { DocNode } from '../src/reports/model';
import { convert } from '../src/lib/units';
import { loadBundle } from './helpers';

let projectId = '';
beforeAll(async () => {
  await ensureBuiltIns();
  projectId = await createDemoProject();
});

const year = { start: '2025-07-01', end: '2026-06-30', label: '2025/26' };
const settings = { ...DEFAULT_SETTINGS, company: 'Example Ltd' };
const text = (n: DocNode) => (n.t === 'p' ? n.runs.map((r) => r.text).join('') : n.t === 'h' ? n.text : '');

describe('calculations in reports', () => {
  it('works out a statistic of the results in the period, at the sites named by code', async () => {
    const b = await loadBundle(projectId);
    // a parameter in mg/L with results at a site in the year
    const inYear = b.samples.filter((s) => s.date.slice(0, 10) >= year.start && s.date.slice(0, 10) <= year.end);
    const r0 = inYear.flatMap((s) => b.index.bySample.get(s.id) ?? []).find((r) => b.paramMap.get(r.parameterId)?.unit === 'mg/L')!;
    const site = b.siteMap.get(r0.siteId)!;
    const pid = r0.parameterId;
    const p = b.paramMap.get(pid)!;
    const values = b.samples
      .filter((s) => s.siteId === site.id && s.date.slice(0, 10) >= year.start && s.date.slice(0, 10) <= year.end)
      .flatMap((s) => (b.index.bySample.get(s.id) ?? []).filter((r) => r.parameterId === pid))
      .map((r) => convert(r.value, r.unit, p.unit))
      .filter((v): v is number => v !== null);
    const count = calcValue(b, { stat: 'count', parameterId: pid, sites: [site.code] }, year.start, year.end);
    expect(count.value).toBe(values.length);
    const max = calcValue(b, { stat: 'max', parameterId: pid, sites: [site.code.toLowerCase()] }, year.start, year.end);
    expect(max.value).toBe(Math.max(...values));
    expect(max.text).toMatch(/mg\/L$/);
    expect(calcLabel(b, { stat: 'median', parameterId: pid, sites: [site.code] })).toBe(`Median ${p.name} at ${site.code}`);
    // a site the project doesn't have, a parameter it doesn't measure
    expect(calcValue(b, { stat: 'max', parameterId: pid, sites: ['NOPE'] }, year.start, year.end).text).toBe('–');
    // in text: {{calc:STAT:PARAMETER:SITES}}
    const token = calcToken('count', pid, [site.code]);
    expect(token).toBe(`{{calc:count:${pid}:${site.code}}}`);
    expect(fillCalcs(`There were ${token} results.`, b, year.start, year.end)).toBe(`There were ${values.length} results.`);
    expect(fillCalcs('{{calc:max:no-such-thing}} {{calc:nonsense:tss}}', b, year.start, year.end)).toBe('– {{calc:nonsense:tss}}');
  });
});

describe('new sections', () => {
  it('puts space, calculations, the monitoring programme, the trigger–action–response plan and the reporting requirements in a report', async () => {
    const b = await loadBundle(projectId);
    const pid = b.rules.find((r) => r.parameterId)!.parameterId!;
    const blocks: ReportBlock[] = [
      { ...newBlock('spacer'), heightMm: 25 } as ReportBlock,
      { ...newBlock('calc'), rows: [{ id: 'c1', stat: 'median', parameterId: pid, sites: [] }, { id: 'c2', stat: 'count', parameterId: pid, sites: [], label: 'Results' }] } as ReportBlock,
      newBlock('programmeTable'),
      newBlock('tarpTable'),
      newBlock('reportingTable'),
    ];
    const template: ReportTemplate = { ...BUILT_IN_TEMPLATES[0], id: 't-new', builtIn: false, blocks };
    const doc = buildReport({ bundle: b, template, period: year, settings });
    expect(doc.nodes.find((n) => n.t === 'space')).toEqual({ t: 'space', mm: 25 });
    const tables = doc.nodes.filter((n): n is Extract<DocNode, { t: 'table' }> => n.t === 'table');
    const captions = tables.map((t) => t.caption ?? '');
    expect(captions[0]).toMatch(/^Table 1: Calculated values, 1 Jul 2025 – 30 Jun 2026/);
    expect(captions.slice(1).map((c) => c.replace(/^Table \d+: /, ''))).toEqual(['Monitoring programme', 'Trigger levels, limits and responses', 'Reporting requirements']);
    expect(tables[0].body.map((r) => r[0].text)).toEqual([`Median ${b.paramMap.get(pid)!.name}`, 'Results']);
    expect(tables[1].body.length).toBe(b.schedules.filter((s) => s.active).length);
    expect(tables[2].body.length).toBe(b.rules.filter((r) => r.active).length);
    expect(tables[3].body.map((r) => r[0].text)).toEqual(b.obligations.filter((o) => o.active).map((o) => o.name));
  });
});

describe('the automatic summary', () => {
  it('finds the period before', () => {
    expect(previousPeriod('2025-07-01', '2026-06-30')).toEqual({ start: '2024-07-01', end: '2025-06-30' });
    expect(previousPeriod('2026-03-01', '2026-03-31')).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    expect(previousPeriod('2026-03-05', '2026-03-11')).toEqual({ start: '2026-02-26', end: '2026-03-04' });
  });

  it('compares the period with the one before, and can be drafted as text to edit', async () => {
    const b = await loadBundle(projectId);
    const template: ReportTemplate = { ...BUILT_IN_TEMPLATES[0], id: 't-sum', builtIn: false, blocks: [newBlock('summary')] };
    const doc = buildReport({ bundle: b, template, period: year, settings });
    const said = doc.nodes.map(text).join('\n');
    expect(said).toMatch(/In the previous period \(1 Jul 2024 – 30 Jun 2025\), \d+ samples were collected/);
    expect(said).toMatch(/Compared with then, the median .+ (higher|lower|similar) \(/);
    const draft = summaryText(b, year.start, year.end);
    expect(draft.startsWith('During the period 1 July 2025 to 30 June 2026')).toBe(true);
    expect(draft).toContain('\n\n');
    expect(draft).toContain('In the previous period');
  });
});

describe('templates', () => {
  it('lets a built-in template be deleted – it stays deleted – and put back', async () => {
    await saveSettings({ defaultTemplateId: 'tpl-quarterly' });
    await deleteTemplate('tpl-quarterly');
    expect((await getSettings()).defaultTemplateId).toBeUndefined();
    await ensureBuiltIns(); // the next time the app starts
    expect(await db.templates.get('tpl-quarterly')).toBeUndefined();
    expect(await restoreBuiltInTemplates()).toBe(1);
    await ensureBuiltIns();
    expect((await db.templates.get('tpl-quarterly'))?.name).toBe('Quarterly / interim data summary');
  });

  it('makes your own template from a starter', async () => {
    const plan = STARTER_TEMPLATES.find((t) => t.kind === 'management-plan')!;
    const t = await templateFrom(plan);
    expect(t).toMatchObject({ name: 'Management plan', kind: 'management-plan', builtIn: false });
    expect(t.id).not.toBe(plan.id);
    expect(t.blocks.map((b) => b.type)).toContain('tarpTable');
    expect(new Set(t.blocks.map((b) => b.id)).size).toBe(t.blocks.length);
    expect(t.blocks.every((b, i) => b.id !== plan.blocks[i].id)).toBe(true);
    // and every starter builds on a project
    const b = await loadBundle(projectId);
    for (const st of STARTER_TEMPLATES) expect(buildReport({ bundle: b, template: st, period: year, settings }).nodes.length).toBeGreaterThanOrEqual(st.blocks.length - 2);
  });
});

describe('a template from a document', () => {
  async function wordReport(): Promise<Uint8Array> {
    const P = (t: string) => new d.Paragraph({ children: [new d.TextRun(t)] });
    const H = (t: string, heading: (typeof d.HeadingLevel)[keyof typeof d.HeadingLevel]) => new d.Paragraph({ heading, children: [new d.TextRun(t)] });
    const cell = (t: string) => new d.TableCell({ children: [P(t)] });
    const doc = new d.Document({
      numbering: { config: [{ reference: 'dots', levels: [{ level: 0, format: d.LevelFormat.BULLET, text: '•', alignment: d.AlignmentType.LEFT }] }] },
      sections: [
        {
          children: [
            H('Annual Groundwater Monitoring Report', d.HeadingLevel.TITLE),
            H('1 Introduction', d.HeadingLevel.HEADING_1),
            P('This report presents the monitoring of the closed landfill.'),
            P('It covers the year to June.'),
            H('Monitoring programme', d.HeadingLevel.HEADING_1),
            P('Samples are collected quarterly.'),
            H('Results', d.HeadingLevel.HEADING_1),
            new d.Table({ rows: [new d.TableRow({ children: [cell('Site'), cell('pH')] }), new d.TableRow({ children: [cell('GW1'), cell('7.1')] })] }),
            P('The results are summarised below.'),
            H('Groundwater results', d.HeadingLevel.HEADING_2),
            H('Compliance with consent conditions', d.HeadingLevel.HEADING_1),
            H('Trigger levels and response actions', d.HeadingLevel.HEADING_1),
            H('Conclusions', d.HeadingLevel.HEADING_1),
            new d.Paragraph({ numbering: { reference: 'dots', level: 0 }, children: [new d.TextRun('All bores complied.')] }),
            new d.Paragraph({ numbering: { reference: 'dots', level: 0 }, children: [new d.TextRun('Monitoring continues.')] }),
          ],
        },
      ],
    });
    return new Uint8Array(await (await d.Packer.toBlob(doc)).arrayBuffer());
  }

  it('reads a Word document’s headings, text, lists and tables', async () => {
    const outline = await readWordOutline(await wordReport());
    expect(outline.title).toBe('Annual Groundwater Monitoring Report');
    expect(outline.items.map((i) => (i.kind === 'heading' ? `${'#'.repeat(i.level)} ${i.text}` : i.kind === 'list' ? `list ${i.items.length}` : i.kind))).toEqual([
      '# 1 Introduction',
      'para',
      'para',
      '# Monitoring programme',
      'para',
      '# Results',
      'table',
      'para',
      '## Groundwater results',
      '# Compliance with consent conditions',
      '# Trigger levels and response actions',
      '# Conclusions',
      'list 2',
    ]);
  });

  it('puts the sections from the data under the headings that call for them, keeping the text to start from', async () => {
    const plan = planFromOutline(await readWordOutline(await wordReport()));
    expect(plan.kind).toBe('monitoring');
    expect(plan.tables).toBe(1);
    expect(plan.sections.map((s) => [s.heading, s.section])).toEqual([
      ['Introduction', null],
      ['Monitoring programme', 'programmeTable'],
      ['Results', 'resultsTable'],
      ['Groundwater results', null], // one results table is enough
      ['Compliance with consent conditions', 'complianceTable'],
      ['Trigger levels and response actions', 'tarpTable'],
      ['Conclusions', null],
    ]);
    expect(plan.sections[0].text).toBe('This report presents the monitoring of the closed landfill.\n\nIt covers the year to June.');
    expect(plan.sections[6].text).toBe('- All bores complied.\n- Monitoring continues.');
    const t = templateFromPlan(plan, { name: 'From Word', fileName: 'report.docx', keepText: true, newBlock });
    expect(t.blocks.map((b) => (b.type === 'heading' ? `h:${b.text}` : b.type))).toEqual([
      'title', 'h:Introduction', 'text', 'h:Monitoring programme', 'text', 'programmeTable', 'h:Results', 'text', 'resultsTable', 'h:Groundwater results',
      'h:Compliance with consent conditions', 'complianceTable', 'h:Trigger levels and response actions', 'tarpTable', 'h:Conclusions', 'text', 'signatures',
    ]);
    expect(t.blocks[0]).toMatchObject({ type: 'title', subtitle: 'Annual Groundwater Monitoring Report' });
    expect(t.blocks[2]).toMatchObject({ type: 'text', prompt: true });
    // without the document's text: a line to write over where there's nothing from the data
    const bare = templateFromPlan(plan, { name: 'Bare', fileName: 'report.docx', keepText: false, newBlock });
    expect(bare.blocks.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text)).toEqual(['Write about introduction here.', 'Write about groundwater results here.', 'Write about conclusions here.']);
  });

  it('makes a letter from a letter', () => {
    const plan = planFromOutline({
      items: [
        { kind: 'para', text: 'The Monitoring Manager\nRegional Council' },
        { kind: 'para', text: 'Dear Sam,' },
        { kind: 'para', text: 'Please find the results of this round below.' },
        { kind: 'heading', level: 1, text: 'Results' },
        { kind: 'para', text: 'All results complied.' },
        { kind: 'para', text: 'Kind regards,' },
        { kind: 'para', text: 'Jo Bloggs' },
      ],
    });
    expect(plan).toMatchObject({ letter: true, closing: 'Kind regards,', kind: 'letter', intro: 'Please find the results of this round below.' });
    const t = templateFromPlan(plan, { name: 'Letter', fileName: 'letter.docx', keepText: true, newBlock });
    expect(t.style).toBe('letter');
    expect(t.blocks.map((b) => b.type)).toEqual(['letter', 'text', 'heading', 'text', 'resultsTable', 'signatures']);
    expect(t.blocks[5]).toMatchObject({ closing: 'Kind regards,' });
  });

  it('reads headings and bullets from text, and headings from a PDF by their size', () => {
    const md = textOutline('# Environmental Management Plan\n\n## Purpose\n\nWhy we monitor.\n\n2.1 Sampling locations\n\n- GW1\n- GW2\n\nMore text\nover two lines.');
    expect(md.title).toBe('Environmental Management Plan');
    expect(md.items).toEqual([
      { kind: 'heading', level: 1, text: 'Purpose' },
      { kind: 'para', text: 'Why we monitor.' },
      { kind: 'heading', level: 2, text: 'Sampling locations' },
      { kind: 'list', items: ['GW1', 'GW2'] },
      { kind: 'para', text: 'More text over two lines.' },
    ]);
    expect(kindOfDocument('Environmental Management Plan', false)).toBe('management-plan');
    expect(kindOfDocument('Detailed Site Investigation', false)).toBe('investigation');
    expect(kindOfDocument('Freshwater fish survey', false)).toBe('ecology');

    // three pages: a running header and page numbers on each, a title, numbered headings, body text and bullets
    const w = (str: string, x: number, y: number, h = 10) => ({ str, x, y, w: str.length * h * 0.5, h });
    const page = (n: number, words: ReturnType<typeof w>[]) => [w('Example Ltd – Monitoring Report', 72, 800, 8), ...words, w(String(n), 300, 30, 8)];
    const pdf = pdfOutline([
      page(1, [w('Annual Monitoring Report', 72, 700, 20), w('1 Introduction', 72, 640, 14), w('This report covers the year to June and', 72, 620), w('the results of every round.', 72, 607)]),
      page(2, [w('2 Results', 72, 700, 14), w('2.1 Groundwater', 72, 670, 12), w('• GW1 complied', 72, 650), w('• GW2 complied', 72, 637)]),
      page(3, [w('3 Conclusions', 72, 700, 14), w('Monitoring continues.', 72, 680)]),
    ]);
    expect(pdf.title).toBe('Annual Monitoring Report');
    expect(pdf.items).toEqual([
      { kind: 'heading', level: 1, text: 'Introduction' },
      { kind: 'para', text: 'This report covers the year to June and the results of every round.' },
      { kind: 'heading', level: 1, text: 'Results' },
      { kind: 'heading', level: 2, text: 'Groundwater' },
      { kind: 'list', items: ['GW1 complied', 'GW2 complied'] },
      { kind: 'heading', level: 1, text: 'Conclusions' },
      { kind: 'para', text: 'Monitoring continues.' },
    ]);
  });
});
