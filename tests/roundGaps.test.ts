import { describe, expect, it } from 'vitest';
import type { MonitoringSchedule, Result, Sample } from '../src/db/types';
import { fromLab, gapLines, hasGaps, recentGaps, roundGaps, roundOf } from '../src/lib/schedule';
import { gapActions } from '../src/lib/actions';
import { jobsWithoutSheet, projectJobs, samplesByImport } from '../src/lib/projectFiles';
import type { ProjectBundle } from '../src/lib/analysis';

// A made-up monthly round at three sites: TSS, dissolved zinc and field pH.
const sch = (patch: Partial<MonitoringSchedule> = {}): MonitoringSchedule => ({ id: 'm', projectId: 'p', name: 'Monthly stormwater', siteIds: ['us1', 'ds1', 'gw1'], parameterIds: ['tss', 'zn-d', 'ph-field'], every: 1, unit: 'month', startDate: '2026-01-01', active: true, ...patch });
const S = (id: string, siteId: string, date: string, extra: Partial<Sample> = {}): Sample => ({ id, projectId: 'p', siteId, date, ...extra });
const R = (sampleId: string, parameterId: string, importId?: string, extra: Partial<Result> = {}): Result => ({ id: `${sampleId}-${parameterId}`, projectId: 'p', sampleId, siteId: '', date: '', parameterId, value: 1, qualifier: '', unit: '', importId, ...extra });
const samples = [S('a', 'us1', '2026-10-09T09:10', { labJob: '3300139' }), S('b', 'ds1', '2026-10-09T10:20', { labJob: '3300139' }), S('old', 'gw1', '2026-09-08', { labJob: '3300138' })];
const results = [
  R('a', 'tss', 'lab1'), R('a', 'zn-d', 'lab1'), R('a', 'ph-field', 'field1'),
  // DS1: the lab left zinc off; its pH was typed in
  R('b', 'tss', 'lab1'), R('b', 'ph-field'),
  R('old', 'tss', 'lab0'), R('old', 'zn-d', 'lab0'), R('old', 'ph-field', 'lab0'),
];
const imports = [{ id: 'lab1', kind: 'lab' as const }, { id: 'lab0', kind: 'lab' as const }, { id: 'field1', kind: 'field' as const }];
const resultsOf = (id: string) => results.filter((r) => r.sampleId === id);
const code = (id: string) => id.toUpperCase();
const name = (id: string) => ({ tss: 'TSS', 'zn-d': 'Dissolved Zinc', 'ph-field': 'pH (field)' })[id] ?? id;

describe('what a sampling round is missing', () => {
  it('a day’s round: the schedule’s period it falls in', () => {
    expect(roundOf(sch(), '2026-10-09T09:10')).toEqual({ start: '2026-10-01', end: '2026-10-31' });
    expect(roundOf(sch({ every: 3 }), '2026-05-20')).toEqual({ start: '2026-04-01', end: '2026-06-30' });
    expect(roundOf(sch(), '2025-12-31')).toBeNull();
    expect(roundOf(sch({ endDate: '2026-06-30' }), '2026-07-01')).toBeNull();
  });

  it('sites not sampled, and at the sites sampled what the schedule names with no result', () => {
    const g = roundGaps(sch(), { start: '2026-10-01', end: '2026-10-31' }, samples, resultsOf, fromLab(imports));
    expect(g).toMatchObject({ notSampled: ['gw1'], complete: ['us1'], accepted: false });
    expect(g.incomplete).toEqual([{ siteId: 'ds1', dates: ['2026-10-09'], missing: ['zn-d'], labIn: true }]);
    expect(gapLines(g, code, name)).toEqual(['Not sampled: GW1', 'DS1 (9 Oct 2026): no result for Dissolved Zinc']);
    expect(hasGaps(g)).toBe(true);
    // September: everything in
    const sep = roundGaps(sch({ siteIds: ['gw1'] }), { start: '2026-09-01', end: '2026-09-30' }, samples, resultsOf, fromLab(imports));
    expect(hasGaps(sep)).toBe(false);
    // a schedule that names no analytes: any sample counts
    expect(roundGaps(sch({ parameterIds: [] }), { start: '2026-10-01', end: '2026-10-31' }, samples, resultsOf, fromLab(imports)).incomplete).toEqual([]);
  });

  it('readings from the phone, with the lab still to report: said, and not chased', () => {
    const fieldOnly = [R('b', 'ph-field', 'field1')];
    const g = roundGaps(sch({ siteIds: ['ds1'] }), { start: '2026-10-01', end: '2026-10-31' }, samples, (id) => fieldOnly.filter((r) => r.sampleId === id), fromLab(imports));
    expect(g.incomplete[0]).toMatchObject({ missing: ['tss', 'zn-d'], labIn: false });
    expect(gapLines(g, code, name)).toEqual(['DS1 (9 Oct 2026): no result for TSS, Dissolved Zinc – nothing from the lab yet']);
  });

  it('the rounds to look at: the current one and the one before, once sampling has begun; accepted ones are marked', () => {
    const got = recentGaps([sch()], samples, resultsOf, fromLab(imports), '2026-10-20');
    expect(got.map((g) => [g.start, g.notSampled, g.incomplete.map((s) => s.siteId)])).toEqual([
      ['2026-10-01', ['gw1'], ['ds1']],
      ['2026-09-01', ['us1', 'ds1'], []],
    ]);
    // November: nobody has sampled yet – nothing to say about it; October is the one before
    expect(recentGaps([sch()], samples, resultsOf, fromLab(imports), '2026-11-03').map((g) => g.start)).toEqual(['2026-10-01']);
    expect(recentGaps([sch({ accepted: ['2026-10-01'] })], samples, resultsOf, fromLab(imports), '2026-10-20')[0].accepted).toBe(true);
    expect(recentGaps([sch({ active: false })], samples, resultsOf, fromLab(imports), '2026-10-20')).toEqual([]);
  });

  it('on the dashboard: results missing from the lab – not sites still to sample, nor rounds accepted', () => {
    const bundle = (s: MonitoringSchedule) =>
      ({
        project: { id: 'p', name: 'Quarry', status: 'active' },
        schedules: [s],
        samples,
        siteMap: new Map(['us1', 'ds1', 'gw1'].map((id) => [id, { code: code(id) }])),
        paramMap: new Map(['tss', 'zn-d', 'ph-field'].map((id) => [id, { name: name(id), short: id === 'zn-d' ? 'Zn (D)' : undefined }])),
        index: { allBySample: new Map(samples.map((x) => [x.id, resultsOf(x.id)])) },
      }) as unknown as ProjectBundle;
    const actions = gapActions([bundle(sch())], imports, '2026-10-20');
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ kind: 'gaps', title: '1 result missing from the lab: Monthly stormwater', detail: 'DS1 (9 Oct 2026): no result for Zn (D)', link: '/projects/p/schedule', date: '2026-10-09' });
    expect(gapActions([bundle(sch({ accepted: ['2026-10-01'] }))], imports, '2026-10-20')).toEqual([]);
  });
});

describe('lab jobs with no result sheet on file', () => {
  it('a job is covered by a results file linked to it, to its import, or to one of its samples', () => {
    const jobs = projectJobs(samples);
    const byImport = samplesByImport(samples.map((s) => ({ id: s.id, importId: undefined })), results);
    const file = (patch: object) => ({ id: 'f', projectId: 'p', name: 'x.pdf', kind: 'results', addedAt: '', ...patch }) as never;
    expect(jobsWithoutSheet(jobs, [], samples, byImport).map((j) => j.job)).toEqual(['3300139', '3300138']);
    expect(jobsWithoutSheet(jobs, [file({ linked: { kind: 'job', job: '3300139' } })], samples, byImport).map((j) => j.job)).toEqual(['3300138']);
    expect(jobsWithoutSheet(jobs, [file({ linked: { kind: 'import', importId: 'lab0' } })], samples, byImport).map((j) => j.job)).toEqual(['3300139']);
    // a chain of custody isn't a result sheet; an older job is left alone
    expect(jobsWithoutSheet(jobs, [file({ kind: 'coc', linked: { kind: 'job', job: '3300139' } })], samples, byImport, '2026-10-01').map((j) => j.job)).toEqual(['3300139']);
  });
});
