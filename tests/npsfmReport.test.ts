import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, ensureBuiltIns } from '../src/db/db';
import { createDemoProject } from '../src/db/demo';
import { BUILT_IN_TEMPLATES } from '../src/data/templates';
import type { ProjectBundle } from '../src/lib/analysis';
import { buildReport } from '../src/reports/build';
import type { DocNode } from '../src/reports/model';
import { projectNpsfm } from '../src/lib/npsfm';
import { loadBundle } from './helpers';

const annual = BUILT_IN_TEMPLATES.find((t) => t.id === 'tpl-annual')!;
let b: ProjectBundle;
beforeAll(async () => {
  await ensureBuiltIns();
  b = await loadBundle(await createDemoProject());
});

describe('NPS-FM for the demo project', () => {
  it('grades the surface water sites as rivers, not the discharge or the bore', () => {
    const g = projectNpsfm(b, '2021-07-01', '2026-06-30');
    const graded = g.filter((s) => s.grades.length).map((s) => s.site.code);
    expect(graded).toEqual(['US1', 'DS1']);
    const ds1 = g.find((s) => s.site.code === 'DS1')!;
    const byId = new Map(ds1.grades.map((x) => [x.attribute.id, x]));
    expect(byId.get('ecoli')?.band).toMatch(/^[A-E]$/);
    expect(byId.get('nitrate')?.band).toMatch(/^[A-D]$/);
    expect(byId.get('ammonia')?.adjusted).toBe(byId.get('ammonia')?.n); // each sample's own pH
    expect(byId.get('sediment')?.reason).toBe('No results.');
  });

  it('a report table of bands, with the bottom lines', () => {
    const doc = buildReport({ bundle: b, template: { ...annual, blocks: [{ id: 'n', type: 'npsfmTable', siteIds: [], years: 5, detail: true }] }, period: { start: '2025-07-01', end: '2026-06-30', label: '2025/26' }, settings: DEFAULT_SETTINGS });
    const tables = doc.nodes.filter((n): n is Extract<DocNode, { t: 'table' }> => n.t === 'table');
    expect(tables).toHaveLength(2);
    const [bands, stats] = tables;
    expect(bands.caption).toMatch(/^Table 1: NPS-FM attribute bands/);
    expect(bands.head[0].map((c) => c.text)).toEqual(['Attribute', 'US1', 'DS1']);
    expect(bands.body.map((r) => r[0].text)).toEqual(expect.arrayContaining(['E. coli †', 'Nitrate (toxicity)', 'Ammonia (toxicity)', 'Dissolved reactive phosphorus †']));
    expect(bands.notes?.[1]).toMatch(/^National bottom lines: Nitrate \(toxicity\) 2\.4 median, 3\.5 95th percentile; Ammonia/);
    expect(stats.head[0].map((c) => c.text)).toEqual(['Site', 'Attribute', 'Statistic', 'Value', 'Band', 'Results']);
    expect(stats.body.some((r) => r[2].text === '% over 540 /100 mL')).toBe(true);
  });
});
