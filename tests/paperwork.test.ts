import { describe, expect, it } from 'vitest';
import type { MonitoringSchedule } from '../src/db/types';
import { LABEL_SHEETS, bottleLabels, labelSheet, labelSheetsNeeded, planRound, schedulesDue, suiteLetter } from '../src/lib/paperwork';
import { formPageCount, labelsDefinition, paperworkDefinition, paperworkEmpty, sampleListText, type PaperworkInput } from '../src/reports/paperwork';

const sch = (x: Partial<MonitoringSchedule> & Pick<MonitoringSchedule, 'id'>): MonitoringSchedule => ({ projectId: 'p', name: x.id, siteIds: [], parameterIds: [], every: 1, unit: 'month', startDate: '2026-01-01', active: true, ...x });

const SITES = [
  { id: 's1', code: 'US1', name: 'Upstream', type: 'Surface water' as const },
  { id: 's2', code: 'DS1', name: 'Downstream', type: 'Surface water' as const },
  { id: 's3', code: 'GW1', name: 'Bore 1', type: 'Groundwater' as const },
  { id: 's4', code: 'GW2', name: '', type: 'Groundwater' as const },
];
const PARAMS = [
  { id: 'ph-field', group: 'Field' },
  { id: 'swl', group: 'Field' },
  { id: 'ph', group: 'Physical' },
  { id: 'tss', group: 'Physical' },
  { id: 'zn-d', group: 'Metals (dissolved)' },
  { id: 'load', group: 'Calculated', formula: '[TSS] * [Flow]' },
];

describe('the schedules with a round in a month', () => {
  const monthly = sch({ id: 'monthly' });
  const quarterly = sch({ id: 'quarterly', every: 3, startDate: '2026-01-01' });
  const windowed = sch({ id: 'windowed', every: 6, startDate: '2026-02-01', window: 3 });
  const weekly = sch({ id: 'weekly', every: 1, unit: 'week', startDate: '2020-01-06' });
  const all = [monthly, quarterly, windowed, weekly, sch({ id: 'off', active: false }), sch({ id: 'later', startDate: '2027-01-01' }), sch({ id: 'ended', endDate: '2026-03-31' })];
  const due = (months: string[]) => schedulesDue(all, months).map((s) => s.id);

  it('a round that starts in the month, or a sampling window that reaches into it', () => {
    expect(due(['2026-10'])).toEqual(['monthly', 'quarterly', 'windowed', 'weekly']); // windowed: Aug–Oct
    expect(due(['2026-11'])).toEqual(['monthly', 'weekly']);
    expect(due(['2026-02'])).toEqual(['monthly', 'windowed', 'weekly', 'ended']);
    expect(due(['2026-05', '2026-06', '2026-07'])).toEqual(['monthly', 'quarterly', 'weekly']);
  });

  it('only schedules that are running: active, started, not ended before', () => {
    expect(due(['2025-12'])).toEqual(['weekly']);
    expect(due(['2027-01'])).toEqual(['monthly', 'quarterly', 'weekly', 'later']);
    expect(due([])).toEqual([]);
  });
});

describe('a round’s samples and what each is analysed for', () => {
  const surface = { id: 'a', siteIds: ['s1', 's2'], parameterIds: ['tss', 'ph', 'zn-d', 'load'] };
  const bores = { id: 'b', siteIds: ['s3', 's4'], parameterIds: ['swl', 'ph-field', 'zn-d'] };

  it('the lab’s analytes and the field readings apart, in the parameters’ order; a calculated one is neither', () => {
    const plan = planRound({ sites: SITES, schedules: [surface, bores], params: PARAMS });
    expect(plan.samples.map((s) => s.name)).toEqual(['US1', 'DS1', 'GW1', 'GW2']);
    expect(plan.samples[0]).toMatchObject({ analytes: ['ph', 'tss', 'zn-d'], field: [], from: 'schedule', suite: 'A', siteName: 'Upstream', type: 'Surface water' });
    expect(plan.samples[2]).toMatchObject({ analytes: ['zn-d'], field: ['ph-field', 'swl'], suite: 'B' });
    expect(plan.samples[3].siteName).toBeUndefined();
    expect(plan.suites).toEqual([
      { letter: 'A', analytes: ['ph', 'tss', 'zn-d'], samples: ['US1', 'DS1'] },
      { letter: 'B', analytes: ['zn-d'], samples: ['GW1', 'GW2'] },
    ]);
    expect(plan.field).toEqual(['ph-field', 'swl']);
  });

  it('a site in two schedules takes what both name', () => {
    const plan = planRound({ sites: SITES, schedules: [surface, { id: 'c', siteIds: ['s1'], parameterIds: ['ph-field'] }], params: PARAMS });
    expect(plan.samples[0]).toMatchObject({ analytes: ['ph', 'tss', 'zn-d'], field: ['ph-field'] });
    expect(plan.samples[1].field).toEqual([]);
  });

  it('a schedule that names nothing: what the lab reported for the site last time (never a field reading)', () => {
    const plan = planRound({ sites: SITES, schedules: [{ id: 'any', siteIds: ['s1', 's3'], parameterIds: [] }], params: PARAMS, lastAnalytes: (id) => (id === 's1' ? ['zn-d', 'ph-field', 'ph', 'gone'] : []) });
    expect(plan.samples[0]).toMatchObject({ name: 'US1', analytes: ['ph', 'zn-d'], from: 'last', suite: 'A' });
    expect(plan.samples[1]).toMatchObject({ name: 'GW1', analytes: [], from: 'none' });
    expect(plan.samples[1].suite).toBeUndefined();
  });

  it('a schedule that names only field readings asks the lab for nothing', () => {
    const plan = planRound({ sites: SITES, schedules: [{ id: 'f', siteIds: ['s3'], parameterIds: ['swl'] }], params: PARAMS, lastAnalytes: () => ['zn-d'] });
    expect(plan.samples[0]).toMatchObject({ analytes: [], field: ['swl'], from: 'none' });
    expect(plan.suites).toEqual([]);
  });

  it('the usual field readings where the schedules name none – a bore’s only at a bore', () => {
    const plan = planRound({ sites: SITES, schedules: [{ id: 'x', siteIds: ['s1', 's3'], parameterIds: ['tss'] }], params: PARAMS, usualField: ['ph-field', 'swl', 'tss'] });
    expect(plan.samples[0].field).toEqual(['ph-field']);
    expect(plan.samples[1].field).toEqual(['ph-field', 'swl']);
  });

  it('a site left out, and extra samples by name (not twice, not a site’s name)', () => {
    const plan = planRound({ sites: SITES, schedules: [surface], params: PARAMS, siteIds: ['s2'], extras: ['DUP1', ' dup1 ', '', 'Field blank', 'ds1'] });
    expect(plan.samples.map((s) => s.name)).toEqual(['DS1', 'DUP1', 'Field blank']);
    expect(plan.samples[1]).toMatchObject({ extra: true, analytes: [], from: 'none' });
    expect(plan.suites[0].samples).toEqual(['DS1']);
  });

  it('suite letters run on past Z', () => {
    expect([0, 1, 25, 26, 27, 52].map(suiteLetter)).toEqual(['A', 'B', 'Z', 'AA', 'AB', 'BA']);
  });
});

describe('bottle labels', () => {
  const plan = planRound({ sites: SITES, schedules: [{ id: 'a', siteIds: ['s1', 's2'], parameterIds: ['tss'] }], params: PARAMS });

  it('so many for each sample, numbered, after the labels already used', () => {
    const labels = bottleLabels(plan.samples, 2, 3);
    expect(labels.slice(0, 3)).toEqual([null, null, null]);
    expect(labels.slice(3).map((l) => `${l!.name} ${l!.count}`)).toEqual(['US1 1 of 2', 'US1 2 of 2', 'DS1 1 of 2', 'DS1 2 of 2']);
    expect(bottleLabels(plan.samples, 1)[0]).toMatchObject({ name: 'US1', siteName: 'Upstream', suite: 'A' });
    expect(bottleLabels(plan.samples, 1)[0]!.count).toBeUndefined();
    expect(bottleLabels(plan.samples, 0)).toEqual([]);
  });

  it('every sheet’s labels fit an A4 page, the same margin each side', () => {
    for (const s of LABEL_SHEETS) {
      const across = 2 * s.left + s.cols * s.width + (s.cols - 1) * s.gapX;
      const down = 2 * s.top + s.rows * s.height + (s.rows - 1) * s.gapY;
      expect(Math.abs(across - 210), `${s.id} across`).toBeLessThan(0.6);
      expect(Math.abs(down - 297), `${s.id} down`).toBeLessThan(0.6);
      expect(s.label.startsWith(`${s.cols * s.rows} a sheet`)).toBe(true);
    }
    expect(labelSheet('14').cols).toBe(2);
    expect(labelSheet('nope').id).toBe('21');
    expect(labelSheetsNeeded(21, labelSheet('21'))).toBe(1);
    expect(labelSheetsNeeded(22, labelSheet('21'))).toBe(2);
    expect(labelSheetsNeeded(0, labelSheet('21'))).toBe(0);
  });

  it('each label is put at its place on the sheet; a new sheet starts a new page', () => {
    const sheet = labelSheet('8');
    const dd = labelsDefinition({ project: { name: 'Kōwhai', code: 'K-1' }, plan, sheet, each: 5, date: '2026-11-12', sampler: 'Sam' });
    const content = dd.content as Array<{ absolutePosition?: { x: number; y: number }; pageBreak?: string }>;
    expect(content).toHaveLength(10);
    const MM = 2.834645669;
    expect(content[0].absolutePosition!.x).toBeGreaterThan(sheet.left * MM);
    expect(content[1].absolutePosition!.x).toBeGreaterThan((sheet.left + sheet.width) * MM);
    expect(content[2].absolutePosition!.y).toBeGreaterThan((sheet.top + sheet.height) * MM);
    // the ninth label is the first of the second sheet
    expect(content.map((c) => c.pageBreak ?? '')).toEqual(['', '', '', '', '', '', '', '', 'before', '']);
    expect(content[8].absolutePosition).toEqual(content[0].absolutePosition);
    expect(JSON.stringify(dd.content)).toContain('12 Nov 2026');
    expect(dd.pageMargins).toEqual([0, 0, 0, 0]);
  });
});

describe('the paperwork PDF', () => {
  const plan = planRound({ sites: SITES, schedules: [{ id: 'a', siteIds: ['s1', 's3'], parameterIds: ['tss', 'zn-d', 'swl'] }], params: PARAMS, extras: ['DUP1'] });
  const base: PaperworkInput = {
    project: { name: 'Kōwhai Quarry', code: 'K-1', client: 'Demo Ltd' },
    round: 'November 2026',
    plan,
    paramName: (id) => ({ tss: 'Total Suspended Solids', 'zn-d': 'Dissolved Zinc', swl: 'Static water level' })[id] ?? id,
    list: true,
    custody: true,
    fieldSheet: true,
    forms: [],
    printed: '2026-11-11',
  };
  const text = (x: unknown) => JSON.stringify(x);

  it('the sample list names each sample and its suite; with sign-off boxes it’s a chain of custody', () => {
    const dd = paperworkDefinition(base);
    const t = text(dd.content);
    expect(t).toContain('Chain of custody and analysis request');
    for (const w of ['US1', 'GW1', 'DUP1', 'Total Suspended Solids, Dissolved Zinc', 'Relinquished by', 'Received by the laboratory', 'Write in what DUP1 is analysed for.', 'Field record', 'Static water level']) expect(t).toContain(w);
    expect(dd.pageOrientation).toBe('portrait');
    const plain = text(paperworkDefinition({ ...base, custody: false, fieldSheet: false }).content);
    expect(plain).toContain('Sample list and analysis request');
    expect(plain).not.toContain('Relinquished by');
    expect(plain).not.toContain('Field record');
  });

  it('the lab’s forms come last, a page each, turned to suit – and get no footer', () => {
    const page = (w: number, h: number) => ({ dataUrl: 'data:image/jpeg;base64,AAAA', width: w, height: h });
    const input = { ...base, forms: [{ name: 'CoC.pdf', pages: [page(842, 595), page(595, 842)] }] };
    expect(formPageCount(input)).toBe(2);
    const dd = paperworkDefinition(input);
    const content = dd.content as Array<{ image?: string; pageOrientation?: string; pageBreak?: string; width?: number; height?: number }>;
    const forms = content.filter((c) => c.image);
    expect(forms.map((f) => [f.pageOrientation, f.pageBreak])).toEqual([['landscape', 'before'], ['portrait', 'before']]);
    expect(Math.round(forms[0].width!)).toBe(842);
    expect(Math.round(forms[1].height!)).toBe(842);
    const footer = dd.footer as (page: number, pages: number) => { text?: string; columns?: Array<{ text: string }> };
    expect(footer(1, 4).columns![1].text).toBe('Page 1 of 2');
    expect(footer(3, 4)).toEqual({ text: '' });
    expect(footer(4, 4)).toEqual({ text: '' });
  });

  it('only a form: the first page is the form’s way up; nothing at all says so', () => {
    const only = { ...base, list: false, fieldSheet: false, forms: [{ name: 'CoC.pdf', pages: [{ dataUrl: 'data:image/jpeg;base64,AAAA', width: 842, height: 595 }] }] };
    expect(paperworkDefinition(only).pageOrientation).toBe('landscape');
    expect(paperworkEmpty(only)).toBe(false);
    expect(paperworkDefinition({ ...base, list: false }).pageOrientation).toBe('landscape'); // the field record first
    const none = { ...base, list: false, fieldSheet: false };
    expect(paperworkEmpty(none)).toBe(true);
    expect(text(paperworkDefinition(none).content)).toContain('Nothing to print');
    expect(paperworkEmpty({ ...base, plan: planRound({ sites: SITES, schedules: [], params: PARAMS }) })).toBe(true);
  });

  it('the sample list as text, for an email to the lab', () => {
    expect(sampleListText({ ...base, date: '2026-11-12', lab: 'Hill Labs', quote: 'Q1' }).split('\n')).toEqual([
      'K-1 – Kōwhai Quarry – November 2026',
      'Sampling 12 Nov 2026',
      'Hill Labs, quote Q1',
      '',
      '3 samples:',
      '- US1 (Upstream), surface water – analysis A',
      '- GW1 (Bore 1), groundwater – analysis A',
      '- DUP1',
      '',
      'Analysis:',
      'A (2 samples): Total Suspended Solids, Dissolved Zinc',
    ]);
  });
});
