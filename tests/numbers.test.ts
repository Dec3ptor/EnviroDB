import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { DEFAULT_SETTINGS, ensureBuiltIns } from '../src/db/db';
import { createDemoProject } from '../src/db/demo';
import { BUILT_IN_TEMPLATES } from '../src/data/templates';
import type { ReportTemplate } from '../src/db/types';
import { fmtNum, fmtResult } from '../src/lib/values';
import { buildReport } from '../src/reports/build';
import { fitCellSize, textWidthMm } from '../src/reports/measure';
import { toPdfDefinition } from '../src/reports/pdf';
import { docxBlob } from '../src/reports/docx';
import type { DocNode, ReportDoc } from '../src/reports/model';
import { loadBundle } from './helpers';

describe('numbers in full', () => {
  it('never writes a small result as 5e-5', () => {
    expect(fmtNum(0.00005)).toBe('0.00005');
    expect(fmtNum(0.0000523)).toBe('0.0000523');
    expect(fmtNum(0.000000512)).toBe('0.000000512');
    expect(fmtNum(-0.0000000456)).toBe('-0.0000000456');
    expect(fmtNum(0.0029)).toBe('0.0029');
    expect(fmtResult(0.00005, '<')).toBe('< 0.00005');
    expect(fmtNum(123456)).toBe('123,456');
  });
});

describe('cells that fit', () => {
  it('makes a number smaller when it is wider than its column, and leaves the rest', () => {
    const narrow = textWidthMm('<0.0000005', 7) * 0.7;
    const size = fitCellSize('<0.0000005', 7, narrow);
    expect(size).toBeLessThan(7);
    expect(textWidthMm('<0.0000005', size)).toBeLessThanOrEqual(narrow + 0.01);
    expect(fitCellSize('0.5', 7, 20)).toBe(7);
    // words wrap: only the longest word has to fit
    expect(fitCellSize('Dissolved reactive phosphorus', 7, textWidthMm('phosphorus', 7) + 0.1)).toBe(7);
    // "< 0.00005" (a space after the sign) stays on one line too
    expect(fitCellSize('< 0.00005', 7, textWidthMm('0.00005', 7))).toBeLessThan(7);
    expect(fitCellSize('<0.0000005', 7, 1)).toBe(4.5);
  });

  it('shrinks such a cell in the PDF and Word files', async () => {
    await ensureBuiltIns();
    const bundle = await loadBundle(await createDemoProject());
    const annual = BUILT_IN_TEMPLATES.find((t) => t.id === 'tpl-letter-annual')!;
    const doc: ReportDoc = buildReport({ bundle, template: { ...annual, blocks: [{ id: 's', type: 'siteTable' }] } as ReportTemplate, period: { start: '2025-07-01', end: '2026-06-30', label: 'y' }, settings: DEFAULT_SETTINGS });
    const table = doc.nodes.find((n): n is Extract<DocNode, { t: 'table' }> => n.t === 'table')!;
    // a tiny result in a narrow column
    table.body[0][0] = { text: '<0.000000005' };
    table.widths = [12, ...table.widths.slice(1)];
    const pdf = JSON.stringify(toPdfDefinition(doc).content);
    const m = pdf.match(/"text":"<0\.000000005"[^}]*"fontSize":([\d.]+)/);
    expect(m).toBeTruthy();
    expect(Number(m![1])).toBeLessThan(table.fontSize ?? doc.template.fontSize - 1);
    const xml = await (await JSZip.loadAsync(await (await docxBlob(doc)).arrayBuffer())).file('word/document.xml')!.async('string');
    const run = xml.match(/<w:sz w:val="(\d+)"\/>(?:(?!<w:sz ).)*?<w:t[^>]*>&lt;0\.000000005<\/w:t>/);
    expect(run).toBeTruthy();
    expect(Number(run![1])).toBeLessThan(Math.round((table.fontSize ?? doc.template.fontSize - 1) * 2));
  });
});
