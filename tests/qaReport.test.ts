import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, db, ensureBuiltIns } from '../src/db/db';
import { createDemoProject } from '../src/db/demo';
import { BUILT_IN_TEMPLATES } from '../src/data/templates';
import type { QaRecord, Result, Sample, Site } from '../src/db/types';
import { buildReport } from '../src/reports/build';
import type { DocNode } from '../src/reports/model';
import { excludeResults, swapSamples, undoRecord } from '../src/db/qa';
import { runQa, qaInputFor } from '../src/lib/qa';
import { loadBundle } from './helpers';

const annual = BUILT_IN_TEMPLATES.find((t) => t.id === 'tpl-annual')!;
let projectId: string;
let dp1: Site;
let primary: Sample;

beforeAll(async () => {
  await ensureBuiltIns();
  projectId = await createDemoProject();
  const sites = await db.sites.where('projectId').equals(projectId).toArray();
  dp1 = sites.find((s) => s.code === 'DP1')!;
  // the latest DP1 sample, and a duplicate of it at a quality control site
  const samples = (await db.samples.where('siteId').equals(dp1.id).toArray()).sort((a, b) => (a.date < b.date ? 1 : -1));
  primary = samples[0];
  const qcSite: Site = { id: 'site-qc', projectId, code: 'DUP1', type: 'Quality control', role: '', aliases: [], active: true, order: 9 };
  await db.sites.put(qcSite);
  const dup: Sample = { id: 'dup1', projectId, siteId: qcSite.id, date: primary.date, sampleName: 'DUP1', qcOf: primary.id };
  await db.samples.put(dup);
  const rs = await db.results.where('sampleId').equals(primary.id).toArray();
  // the duplicate agrees except for one analyte, way off
  const odd = rs.find((r) => r.parameterId === 'ec' && r.qualifier === '')!;
  await db.results.bulkPut(rs.map((r): Result => ({ ...r, id: `d-${r.id}`, sampleId: dup.id, siteId: qcSite.id, value: r.id === odd.id ? r.value! * 3 : r.value })));
});

const period = () => ({ start: primary.date.slice(0, 10), end: primary.date.slice(0, 10), label: 'the round' });
const qaSection = async (patch = {}) => {
  const b = await loadBundle(projectId);
  const doc = buildReport({ bundle: b, template: { ...annual, blocks: [{ id: 'q', type: 'qaSummary', duplicates: 'all', decisions: true, ...patch }] }, period: period(), settings: DEFAULT_SETTINGS });
  return doc.nodes.filter((n) => n.t === 'p' || n.t === 'table') as Array<Extract<DocNode, { t: 'p' } | { t: 'table' }>>;
};
const paras = (nodes: Awaited<ReturnType<typeof qaSection>>) => nodes.filter((n): n is Extract<DocNode, { t: 'p' }> => n.t === 'p').map((n) => n.runs.map((r) => r.text).join(''));
const tables = (nodes: Awaited<ReturnType<typeof qaSection>>) => nodes.filter((n): n is Extract<DocNode, { t: 'table' }> => n.t === 'table');

describe('the QA/QC report section', () => {
  it('keeps the duplicate out of the monitoring data', async () => {
    const b = await loadBundle(projectId);
    expect(b.sites.map((s) => s.code)).not.toContain('DUP1');
    expect(b.samples.some((s) => s.id === 'dup1')).toBe(false);
    expect([...b.index.byParam.values()].some((m) => m.has('site-qc'))).toBe(false);
    expect(b.qc?.samples.map((s) => s.id)).toEqual(['dup1']);
  });

  it('sums up the duplicates and the checks, with the RPD table', async () => {
    const nodes = await qaSection();
    const text = paras(nodes);
    expect(text[0]).toMatch(/^1 field duplicate was taken\. \d+ of \d+ analyte pairs \(\d+%\) were within the relative percent difference \(RPD\) limits of 30%/);
    expect(text.some((t) => t.startsWith('The results were checked for ion balance'))).toBe(true);
    const [dups] = tables(nodes);
    expect(dups.caption).toMatch(/^Table 1: Field duplicate results/);
    expect(dups.body.some((row) => row[6].text === '100%')).toBe(true); // three times as much: RPD 100%
    expect(dups.body.every((row) => row[1].text === 'DP1' && row[2].text === 'DUP1')).toBe(true);
  });

  it('lists the decisions, and only the duplicates outside the limits when asked', async () => {
    const b = await loadBundle(projectId);
    const all = runQa(qaInputFor(b, period()));
    const f = all.findings.find((x) => x.kind === 'duplicate')!;
    expect(f).toBeTruthy();
    await excludeResults(projectId, f, f.resultIds, 'lab confirmed a transcription error');
    const nodes = await qaSection({ duplicates: 'outside' });
    expect(paras(nodes).some((t) => t.startsWith('After review, 1 result was left out of the data, as listed below.'))).toBe(true);
    const [dups, decisions] = tables(nodes);
    expect(dups.body).toHaveLength(1);
    expect(decisions.caption).toMatch(/QA\/QC decisions/);
    expect(decisions.body[0].map((c) => c.text)).toEqual([expect.any(String), 'DP1', f.title, 'Left out of the data (1)', 'lab confirmed a transcription error']);
    // and undone
    const rec = (await db.qa.toArray())[0] as QaRecord;
    await undoRecord(rec);
    expect((await db.results.get(f.resultIds[0]))?.excluded).toBeUndefined();
    expect(await db.qa.count()).toBe(0);
  });

  it('swaps two samples’ sites, and back', async () => {
    const ds1 = (await db.sites.where('projectId').equals(projectId).toArray()).find((s) => s.code === 'DS1')!;
    const other = (await db.samples.where('siteId').equals(ds1.id).toArray()).find((s) => s.date.slice(0, 10) === primary.date.slice(0, 10))!;
    await swapSamples(primary.id, other.id);
    expect((await db.samples.get(primary.id))?.siteId).toBe(ds1.id);
    expect((await db.results.where('sampleId').equals(primary.id).toArray()).every((r) => r.siteId === ds1.id)).toBe(true);
    expect((await db.samples.get(primary.id))?.notes).toMatch(/QA\/QC .*: moved from DP1 to DS1 – bottles swapped\./);
    await swapSamples(primary.id, other.id);
    expect((await db.samples.get(primary.id))?.siteId).toBe(dp1.id);
  });
});
