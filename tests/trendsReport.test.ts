import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, ensureBuiltIns } from '../src/db/db';
import { createDemoProject } from '../src/db/demo';
import { BUILT_IN_TEMPLATES } from '../src/data/templates';
import type { ReportBlock } from '../src/db/types';
import type { ProjectBundle } from '../src/lib/analysis';
import { buildReport } from '../src/reports/build';
import type { DocNode } from '../src/reports/model';
import { defaultPairs, projectTrends, trendRange } from '../src/lib/projectTrends';
import { newBlock } from '../src/components/report/blocks';
import { loadBundle } from './helpers';

const annual = BUILT_IN_TEMPLATES.find((t) => t.id === 'tpl-annual')!;
const year = { start: '2025-07-01', end: '2026-06-30', label: '2025/26' };
let b: ProjectBundle;
beforeAll(async () => {
  await ensureBuiltIns();
  b = await loadBundle(await createDemoProject());
});
const build = (blocks: ReportBlock[], renderChart?: (o: unknown) => string) =>
  buildReport({ bundle: b, template: { ...annual, blocks }, period: year, settings: DEFAULT_SETTINGS, renderChart: renderChart as never });
const tables = (nodes: DocNode[]) => nodes.filter((n): n is Extract<DocNode, { t: 'table' }> => n.t === 'table');

describe('trends in a project', () => {
  it('pairs the upstream and downstream sites by their roles', () => {
    expect(defaultPairs(b).map((p) => `${b.siteMap.get(p.upId)?.code}→${b.siteMap.get(p.downId)?.code}`)).toContain('US1→DS1');
  });
  it('finds the demo’s rising downstream nitrate', () => {
    const ds1 = b.sites.find((s) => s.code === 'DS1')!;
    const [row] = projectTrends(b, { siteIds: [ds1.id], parameterIds: ['no3-n'], ...trendRange('all', '2026-10-01') });
    expect(row.result.ok).toBe(true);
    expect(row.result.slope!).toBeGreaterThan(0);
    expect(['likely-degrading', 'very-likely-degrading']).toContain(row.result.category);
  });
});

describe('trend report sections', () => {
  it('a trends table up to the report’s end', () => {
    const doc = build([{ ...(newBlock('trendTable') as Extract<ReportBlock, { type: 'trendTable' }>), parameterIds: ['tss', 'no3-n'], years: 0 }]);
    const [t] = tables(doc.nodes);
    expect(t.caption).toMatch(/^Table 1: Trends in water quality/);
    expect(t.head[0].map((c) => c.text)).toEqual(['Site', 'Analyte', 'Trend', 'Change a year', 'Likelihood', 'Results']);
    expect(t.body.map((r) => `${r[0].text} ${r[1].text}`)).toEqual(expect.arrayContaining(['DP1 Total Suspended Solids', 'DS1 Nitrate-N']));
    expect(t.notes?.[0]).toMatch(/^Trends to 30 Jun 2026: the Mann-Kendall test/);
  });
  it('downstream against upstream, over the report’s period', () => {
    const doc = build([{ ...(newBlock('upDownTable') as Extract<ReportBlock, { type: 'upDownTable' }>), parameterIds: ['tss', 'ec', 'no3-n'] }]);
    const [t] = tables(doc.nodes);
    expect(t.caption).toMatch(/Downstream compared with upstream, .* – DS1 against US1$/);
    expect(t.head[0].map((c) => c.text)).toEqual(['Analyte', 'Pairs', 'US1 median', 'DS1 median', 'Median difference', 'Higher at DS1', 'Difference']);
    expect(t.body).toHaveLength(3);
    expect(t.body.every((r) => Number(r[1].text) >= 10)).toBe(true); // monthly, a year
    expect(t.notes?.[0]).toMatch(/Wilcoxon signed-rank/);
  });
  it('graphs with trend lines', () => {
    const options: Array<{ series: Array<{ name: string; lineStyle?: { type?: unknown } }> }> = [];
    build([{ ...(newBlock('chart') as Extract<ReportBlock, { type: 'chart' }>), parameterIds: ['no3-n'], range: 'all', trendLines: true }], (o) => (options.push(o as never), 'data:image/png;base64,'));
    const dashed = options[0].series.filter((s) => Array.isArray(s.lineStyle?.type));
    expect(dashed.map((s) => s.name)).toEqual(expect.arrayContaining(['DS1']));
  });
});
