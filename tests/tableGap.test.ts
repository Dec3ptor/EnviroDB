import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { DEFAULT_SETTINGS, ensureBuiltIns } from '../src/db/db';
import { createDemoProject } from '../src/db/demo';
import { BUILT_IN_TEMPLATES } from '../src/data/templates';
import type { Settings } from '../src/db/types';
import { buildReport } from '../src/reports/build';
import { SUMMARY_GAP_PT, TABLE_GAP_PT, type DocNode } from '../src/reports/model';
import { toPdfDefinition } from '../src/reports/pdf';
import { docxBlob } from '../src/reports/docx';
import { loadBundle } from './helpers';

type Table = Extract<DocNode, { t: 'table' }>;
const annual = BUILT_IN_TEMPLATES.find((t) => t.id === 'tpl-letter-annual')!;
const year = { start: '2025-07-01', end: '2026-06-30', label: '2025/26' };
const me: Settings = { ...DEFAULT_SETTINGS, author: 'Sam Taylor', company: 'Example Ltd' };

let projectId = '';
beforeAll(async () => {
  await ensureBuiltIns();
  projectId = await createDemoProject();
});

const isSummary = (n: DocNode | undefined) => n?.t === 'p' && n.runs[0]?.text === 'Summary: ';

describe('the space between a table and what follows', () => {
  it('a table’s own summary sits close under it; other tables keep the usual space', async () => {
    const doc = buildReport({ bundle: await loadBundle(projectId), template: annual, period: year, settings: me });
    const tables = doc.nodes.map((n, i) => ({ n, next: doc.nodes[i + 1] })).filter((x): x is { n: Table; next: DocNode } => x.n.t === 'table');
    const withSummary = tables.filter((x) => isSummary(x.next));
    expect(withSummary.length).toBe(4); // one for each site's round table
    for (const x of withSummary) expect(x.n.gapAfter).toBe(SUMMARY_GAP_PT);
    for (const x of tables.filter((x) => !isSummary(x.next))) expect(x.n.gapAfter).toBeUndefined();
    expect(SUMMARY_GAP_PT).toBeLessThan(TABLE_GAP_PT);
  });

  it('the PDF and the Word file leave the same space', async () => {
    const doc = buildReport({ bundle: await loadBundle(projectId), template: annual, period: year, settings: me });
    // the PDF: the margin under the table (or under its notes)
    const flat = toPdfDefinition(doc).content as unknown as Array<Record<string, unknown>>;
    const pdfTables = flat.filter((c) => 'table' in c && Array.isArray((c.table as { body?: unknown }).body) && (c.table as { headerRows?: number }).headerRows);
    const margins = pdfTables.map((c) => (c.margin as number[])[3]);
    expect(margins.filter((m) => m === SUMMARY_GAP_PT).length).toBe(3); // the round tables without notes
    expect(margins).toContain(TABLE_GAP_PT);
    const notes = flat.filter((c) => c.style === 'note' && 'stack' in c).map((c) => (c.margin as number[])[3]);
    expect(notes).toContain(SUMMARY_GAP_PT); // the last round table's notes, then its summary

    // Word: after each table an empty paragraph exactly that high – not a normal line and 6 pt more
    const xml = await (await JSZip.loadAsync(await (await docxBlob(doc)).arrayBuffer())).file('word/document.xml')!.async('string');
    const firstSummary = xml.indexOf('Summary: ');
    const before = xml.slice(xml.lastIndexOf('</w:tbl>', firstSummary), firstSummary);
    expect(before).toContain(`w:line="${SUMMARY_GAP_PT * 20}" w:lineRule="exact"`);
    expect(before).not.toContain('w:after="120"');
    expect(xml).toContain(`w:line="${TABLE_GAP_PT * 20}" w:lineRule="exact"`);
    expect(xml.match(/<\/w:tbl><w:p><w:pPr><w:spacing w:after="120"\/><\/w:pPr><\/w:p>/g)).toBeNull();
  });
});
