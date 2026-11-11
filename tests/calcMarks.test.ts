import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { db, DEFAULT_SETTINGS, ensureBuiltIns } from '../src/db/db';
import { createDemoProject } from '../src/db/demo';
import { BUILT_IN_TEMPLATES } from '../src/data/templates';
import type { Parameter, ReportBlock, ReportTemplate, Result } from '../src/db/types';
import { buildReport } from '../src/reports/build';
import { calculatedIn, pivotCsv, provenanceNote } from '../src/reports/excel';
import { workbookSheets } from '../src/reports/workbook';
import type { DocNode } from '../src/reports/model';
import { pivot } from '../src/lib/analysis';
import { loadBundle } from './helpers';

type Table = Extract<DocNode, { t: 'table' }>;
let projectId = '';
let sampleId = '';
beforeAll(async () => {
  await ensureBuiltIns();
  projectId = await createDemoProject();
  // a made-up calculated parameter: twice the TSS – at the pond outlet's samples, which have TSS and none of it
  await db.parameters.put({ id: 'tss-x2', name: 'Twice TSS', group: 'Physical', unit: 'mg/L', aliases: [], formula: '[Total Suspended Solids] * 2' } as Parameter);
  const dp1 = (await db.sites.where('projectId').equals(projectId).toArray()).find((s) => s.code === 'DP1')!;
  sampleId = (await db.samples.where('projectId').equals(projectId).toArray()).filter((s) => s.siteId === dp1.id).sort((a, b) => (a.date < b.date ? 1 : -1))[0].id;
});

describe('calculated values, marked wherever the data goes', () => {
  it('says where a value came from: calculated (and what from), or changed by hand (and what it was)', () => {
    const p = { name: 'DO' };
    expect(provenanceNote({ calc: { formula: '[DO %] / 100 * DO_SAT([Temperature])', from: 'DO % 95 % sat, Temperature 14.2 °C' } }, p)).toBe('Calculated, not measured: DO = [DO %] / 100 * DO_SAT([Temperature])\nFrom DO % 95 % sat, Temperature 14.2 °C');
    expect(provenanceNote({ edited: { at: '2026-11-01T02:00:00Z', by: 'Sam', was: '7.1' } }, p)).toBe('Changed by hand by Sam on 1 Nov 2026 – was 7.1');
    expect(provenanceNote({ edited: { at: '2026-11-01T02:00:00Z', was: '' } }, p)).toBe('Changed by hand on 1 Nov 2026 (added by hand)');
    expect(provenanceNote({}, p)).toBe('');
  });

  it('the CSV names each row’s calculated values in a last column – only when there are any', async () => {
    const b = await loadBundle(projectId);
    const sample = b.samples.find((s) => s.id === sampleId)!;
    const grid = pivot(b, { siteIds: [sample.siteId], paramIds: ['tss', 'tss-x2'], start: sample.date.slice(0, 10), end: sample.date.slice(0, 10) });
    expect(calculatedIn(grid.columns, grid.rows).map((p) => p.id)).toEqual(['tss-x2']);
    const lines = pivotCsv(grid).split('\r\n');
    expect(lines[0].split(',').slice(-1)[0]).toBe('Calculated (not measured)');
    expect(lines[1].split(',').slice(-1)[0]).toBe('Twice TSS');
    // without the calculated column: the table as before
    const plain = pivot(b, { siteIds: [sample.siteId], paramIds: ['tss'], start: sample.date.slice(0, 10), end: sample.date.slice(0, 10) });
    expect(pivotCsv(plain).split('\r\n')[0]).toBe('Date,Site,Lab number,Total Suspended Solids (mg/L)');
    // the workbook's sheets carry the calculated results (written in italics, with a note)
    const cell = workbookSheets(b, [sample.siteId])[0].rows.find((r) => r.sample.id === sampleId)!.cells.get('tss-x2') as Result;
    expect(cell.calc?.formula).toBe('[Total Suspended Solids] * 2');
  });

  it('a report table shows them in italics, and says so underneath', async () => {
    const b = await loadBundle(projectId);
    const sample = b.samples.find((s) => s.id === sampleId)!;
    const day = sample.date.slice(0, 10);
    const block = (parameterIds: string[]): ReportBlock => ({ id: 'rt', type: 'resultsTable', siteIds: [sample.siteId], parameterIds, layout: 'parametersAsRows', guidelineSetIds: [], ruleColumns: 'none', highlight: false, splitBySite: true });
    const table = (parameterIds: string[]) =>
      buildReport({ bundle: b, template: { ...BUILT_IN_TEMPLATES.find((t) => t.id === 'tpl-annual')!, blocks: [block(parameterIds)] } as ReportTemplate, period: { start: day, end: day, label: day }, settings: DEFAULT_SETTINGS }).nodes.find((n): n is Table => n.t === 'table')!;
    const t = table(['tss', 'tss-x2']);
    const row = (name: string) => t.body.find((r) => r[0].text === name)!;
    expect(row('Twice TSS').some((c) => c.italic)).toBe(true);
    expect(row('Total Suspended Solids').some((c) => c.italic)).toBe(false);
    expect(t.notes).toContain('Values in italics are calculated from the sample’s other results (a formula), not measured.');
    expect(table(['tss']).notes?.join(' ')).not.toMatch(/italics/);
  });
});
