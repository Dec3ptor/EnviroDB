import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, ensureBuiltIns } from '../src/db/db';
import { createDemoProject } from '../src/db/demo';
import { BUILT_IN_TEMPLATES } from '../src/data/templates';
import type { ReportBlock, ReportTemplate, Result } from '../src/db/types';
import type { ProjectBundle } from '../src/lib/analysis';
import { buildReport } from '../src/reports/build';
import { calcHead, tableCalcValue } from '../src/reports/calc';
import type { DocNode, ReportDoc } from '../src/reports/model';
import { mean, percentile } from '../src/lib/stats';
import { loadBundle } from './helpers';

type Table = Extract<DocNode, { t: 'table' }>;
const annual = BUILT_IN_TEMPLATES.find((t) => t.id === 'tpl-annual')!;
const year = { start: '2025-07-01', end: '2026-06-30', label: '2025/26' };
let b: ProjectBundle;
beforeAll(async () => {
  await ensureBuiltIns();
  b = await loadBundle(await createDemoProject());
});
const report = (blocks: ReportBlock[], period = year): ReportDoc => buildReport({ bundle: b, template: { ...annual, blocks } as ReportTemplate, period, settings: DEFAULT_SETTINGS });
const tables = (d: ReportDoc) => d.nodes.filter((n): n is Table => n.t === 'table');
const site = (code: string) => b.sites.find((s) => s.code === code)!;
const r = (value: number, qualifier: '' | '<' = ''): Result => ({ id: `r${value}${qualifier}`, projectId: 'p', sampleId: 's', siteId: 'x', date: '2026-01-01', parameterId: 'tss', value, qualifier, unit: 'mg/L' }) as Result;

describe('calculation values', () => {
  it('works out means, totals, counts, percentiles and the highest, minding non-detects', () => {
    const p = b.paramMap.get('tss')!;
    const rs = [r(10), r(20), r(30), r(2, '<')];
    const nd = b.project.ndHandling === 'half' ? 1 : b.project.ndHandling === 'zero' ? 0 : 2;
    expect(tableCalcValue(b, p, rs, { id: 'a', stat: 'count' })).toBe('4');
    expect(tableCalcValue(b, p, rs, { id: 'a', stat: 'sum' })).toBe(String(60 + nd));
    expect(tableCalcValue(b, p, rs, { id: 'a', stat: 'mean' })).toBe(String((60 + nd) / 4));
    expect(tableCalcValue(b, p, rs, { id: 'a', stat: 'max' })).toBe('30');
    expect(tableCalcValue(b, p, rs, { id: 'a', stat: 'min' })).toBe('<2');
    expect(tableCalcValue(b, p, rs, { id: 'a', stat: 'percentile', percentile: 80 })).toBe(String(Number(percentile([10, 20, 30, nd], 80, b.project.percentileMethod)!.toPrecision(3))));
    expect(tableCalcValue(b, p, [r(2, '<'), r(5, '<')], { id: 'a', stat: 'max' })).toBe('<5');
    expect(tableCalcValue(b, p, [], { id: 'a', stat: 'mean' })).toBe('–');
    expect(calcHead({ id: 'a', stat: 'percentile', percentile: 80, over: 'years', years: 5 })).toBe('80th %ile (5 yr)');
    expect(calcHead({ id: 'a', stat: 'p95', label: '95%ile' })).toBe('95%ile');
  });
});

describe('calculation columns in tables', () => {
  const results = (patch: Partial<Extract<ReportBlock, { type: 'resultsTable' }>>): ReportBlock => ({
    id: 'rt',
    type: 'resultsTable',
    siteIds: [site('DP1').id],
    parameterIds: ['tss', 'ph'],
    layout: 'parametersAsRows',
    guidelineSetIds: [],
    ruleColumns: 'none',
    highlight: false,
    splitBySite: true,
    calcColumns: [
      { id: 'm', stat: 'mean' },
      { id: 'p', stat: 'p95' },
    ],
    ...patch,
  });

  it('adds them after the results, worked out from the results in the table, with a note', () => {
    const doc = report([results({})]);
    const t = tables(doc).at(-1)!;
    const head = t.head[0].map((c) => c.text);
    expect(head.slice(-2)).toEqual(['Mean', '95th %ile']);
    expect(t.widths).toHaveLength(head.length);
    const tss = t.body.find((row) => row[0].text === 'Total Suspended Solids')!;
    const shown = tables(doc).flatMap((x) => x.body.find((row) => row[0].text === 'Total Suspended Solids')!.slice(2, -2).map((c) => Number(c.text.replace('<', ''))));
    expect(Number(tss.at(-2)!.text)).toBeCloseTo(Number(mean(shown)!.toPrecision(3)), 6);
    expect(t.notes?.join(' ')).toMatch(/Mean, 95th %ile: worked out from the results in the table/);
  });

  it('puts them as rows at the foot of a table with samples down', () => {
    const t = tables(report([results({ layout: 'parametersAsColumns' })])).at(-1)!;
    const foot = t.body.slice(-2);
    expect(foot.map((row) => row[0].text)).toEqual(['Mean', '95th %ile']);
    expect(foot[0][0].colSpan).toBe(2);
    expect(foot[0].length).toBe(t.head[0].length);
  });

  it('works out a column over the last few years, at the table’s sites', () => {
    const t = tables(report([results({ calcColumns: [{ id: 'y', stat: 'count', over: 'years', years: 2 }] })])).at(-1)!;
    expect(t.head[0].at(-1)!.text).toBe('No. (2 yr)');
    const n = b.index.byParam.get('tss')!.get(site('DP1').id)!.filter((x) => x.date.slice(0, 10) >= '2024-07-01' && x.date.slice(0, 10) <= '2026-06-30').length;
    expect(t.body.find((row) => row[0].text === 'Total Suspended Solids')!.at(-1)!.text).toBe(String(n));
  });

  it('adds them to a rounds table after the rounds, before the consent values', () => {
    const doc = report(
      [{ id: 'r1', type: 'roundTable', title: '', siteIds: [site('DP1').id], parameterIds: ['tss'], previous: 2, ruleColumns: 'all', comment: true, summaries: false, siteLabel: 'caption', calcColumns: [{ id: 'm', stat: 'mean' }, { id: 'x', stat: 'max', over: 'all' }] }],
      { start: '2026-03-01', end: '2026-03-31', label: 'March 2026' },
    );
    const t = tables(doc)[0];
    const head = t.head[0].map((c) => c.text);
    expect(head.slice(5, 7)).toEqual(['Mean', 'Max (all)']);
    expect(head.slice(7)).toEqual(['Limit', 'Trigger 1', 'Comment']);
    const row = t.body[0];
    const rounds = row.slice(2, 5).map((c) => Number(c.text.replace('<', '')));
    expect(Number(row[5].text)).toBeCloseTo(Number(mean(rounds)!.toPrecision(3)), 6);
    const all = b.index.byParam.get('tss')!.get(site('DP1').id)!.filter((x) => x.date.slice(0, 10) <= '2026-03-31').map((x) => x.value ?? 0);
    expect(Number(row[6].text)).toBe(Math.max(...all));
    expect(t.notes?.join(' ')).toMatch(/Mean: worked out from the site's rounds shown; Max \(all\): worked out from all the results to 31 Mar 2026/);
  });
});

describe('the project’s choices for calculations', () => {
  it('offers the parameters with results – or, before any, those the consent rules name', async () => {
    const { projectParamIds } = await import('../src/components/report/projectChoices');
    expect(projectParamIds(b)).toEqual(b.index.paramIdsWithData);
    const { buildIndex } = await import('../src/lib/dataIndex');
    const empty = { ...b, index: buildIndex([], [], b.sites, b.params) };
    const fromRules = projectParamIds(empty);
    expect(fromRules.length).toBeGreaterThan(0);
    expect(fromRules).toContain('tss');
    expect(fromRules.length).toBeLessThan(b.params.length);
  });
});
