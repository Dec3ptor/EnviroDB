import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { DEFAULT_SETTINGS, db, ensureBuiltIns } from '../src/db/db';
import { createDemoProject } from '../src/db/demo';
import { BUILT_IN_TEMPLATES, QUICK_CHECK_TEMPLATE_ID } from '../src/data/templates';
import type { ReportTemplate, Settings } from '../src/db/types';
import type { ProjectBundle } from '../src/lib/analysis';
import { buildReport } from '../src/reports/build';
import { toPdfDefinition } from '../src/reports/pdf';
import { docxBlob } from '../src/reports/docx';
import { saveTemplate } from '../src/db/repo';
import { localData } from '../src/sync/engine';
import { loadBundle } from './helpers';

const annual = BUILT_IN_TEMPLATES.find((t) => t.id === 'tpl-annual')!;
const year = { start: '2025-07-01', end: '2026-06-30', label: '2025/26' };
const me: Settings = { ...DEFAULT_SETTINGS, author: 'Sam Smith', company: 'Example Ltd' };
let bundle: ProjectBundle;
beforeAll(async () => {
  await ensureBuiltIns();
  bundle = await loadBundle(await createDemoProject());
});
type PageFn = (page: number, pages: number) => { columns: Array<{ text: string }> } | null;
const texts = (c: ReturnType<PageFn>) => c?.columns.map((x) => x.text);

describe('headers and footers', () => {
  it('fills in left, centre and right, with the page numbers left for each page', () => {
    const t: ReportTemplate = { ...annual, headerText: '[project] – [report]', headerRight: '[period name]', footerText: '[company] · [author]', footerCenter: 'DRAFT', footerRight: undefined };
    const doc = buildReport({ bundle, template: t, period: year, settings: me });
    expect(doc.header).toEqual({ left: 'Demo – Kōwhai Quarry stormwater discharge – Annual compliance monitoring report', center: '', right: 'July 2025 to June 2026' });
    expect(doc.footer).toEqual({ left: 'Example Ltd · Sam Smith', center: 'DRAFT', right: 'Page {page} of {pages}' });
    // the title has a page of its own: not on it
    expect(doc.pageTextFirst).toBe(false);
    const def = toPdfDefinition(doc);
    expect((def.header as unknown as PageFn)(1, 9)).toBeNull();
    expect(texts((def.header as unknown as PageFn)(2, 9))).toEqual([doc.header.left, doc.header.right]);
    expect(texts((def.footer as unknown as PageFn)(2, 9))).toEqual(['Example Ltd · Sam Smith', 'DRAFT', 'Page 2 of 9']);
    // older templates' {{…}} still work, and an empty right side takes the page number off
    const old = buildReport({ bundle, template: { ...annual, footerRight: '' }, period: year, settings: me });
    expect(old.footer).toEqual({ left: `Example Ltd · ${bundle.project.code}`, center: '', right: '' });
  });

  it('can go on the first page too, and writes them in Word with page number fields', async () => {
    const doc = buildReport({ bundle, template: { ...annual, pageTextFirst: true, headerCenter: 'Confidential', footerRight: '[page] / [pages]' }, period: year, settings: me });
    expect((toPdfDefinition(doc).header as unknown as PageFn)(1, 9)).not.toBeNull();
    const zip = await JSZip.loadAsync(await (await docxBlob(doc)).arrayBuffer());
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/)![0]).not.toContain('<w:titlePg/>');
    const parts = await Promise.all(Object.keys(zip.files).filter((f) => /^word\/(header|footer)\d+\.xml$/.test(f)).map((f) => zip.file(f)!.async('string')));
    expect(parts.some((x) => x.includes('Confidential') && x.includes('w:val="center"'))).toBe(true);
    expect(parts.some((x) => /PAGE[\s\S]*NUMPAGES/.test(x))).toBe(true);
  });
});

describe('the Quick check template', () => {
  it('is there to change, and isn’t anyone’s own work until it is changed', async () => {
    const t = (await db.templates.get(QUICK_CHECK_TEMPLATE_ID))!;
    expect(t).toMatchObject({ name: 'Quick check', starter: true });
    expect(t.builtIn).toBeFalsy();
    const before = await localData(db);
    await saveTemplate({ ...t, headerText: 'Lab job [project code]' }, t);
    const saved = (await db.templates.get(QUICK_CHECK_TEMPLATE_ID))!;
    expect(saved.starter).toBeFalsy();
    expect(saved.headerText).toBe('Lab job [project code]');
    expect((await localData(db)).records).toBe(before.records + 1);
    // ensuring the built-ins again keeps your version
    await ensureBuiltIns();
    expect((await db.templates.get(QUICK_CHECK_TEMPLATE_ID))!.headerText).toBe('Lab job [project code]');
  });
});
