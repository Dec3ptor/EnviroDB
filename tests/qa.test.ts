import { describe, expect, it } from 'vitest';
import { BUILT_IN_PARAMETERS } from '../src/data/parameters';
import type { Parameter, Result, Sample, Site } from '../src/db/types';
import { buildIndex } from '../src/lib/dataIndex';
import { guessPrimary, looksLikeQc, qcKind, runQa, withRecords, type QaInput } from '../src/lib/qa';

const P = new Map<string, Parameter>(BUILT_IN_PARAMETERS.map((p) => [p.id, p]));
const site = (id: string, type: Site['type'] = 'Surface water'): Site => ({ id, projectId: 'p', code: id, type, role: '', aliases: [], active: true, order: 0 });

let n = 0;
function sample(siteId: string, date: string, values: Record<string, number | string>, extra: Partial<Sample> = {}): { s: Sample; rs: Result[] } {
  const s: Sample = { id: `s${++n}`, projectId: 'p', siteId, date, ...extra };
  const rs = Object.entries(values).map(([pid, v]): Result => {
    const nd = typeof v === 'string' && v.startsWith('<');
    const value = typeof v === 'number' ? v : Number(v.replace('<', ''));
    return { id: `r${++n}`, projectId: 'p', sampleId: s.id, siteId, date, parameterId: pid, value, qualifier: nd ? '<' : '', unit: P.get(pid)?.unit ?? '' };
  });
  return { s, rs };
}

/** Two sites a year apart in chemistry: DP1 (a discharge) and DS1 (the stream). Monthly, with a little noise. */
function history(months = 10) {
  const out: Array<{ s: Sample; rs: Result[] }> = [];
  for (let m = 1; m <= months; m++) {
    const d = `2025-${String(m).padStart(2, '0')}-10`;
    const w = 1 + ((m % 3) - 1) * 0.06;
    out.push(sample('DP1', d, { ec: 420 * w, 'zn-d': 0.052 * w, 'zn-t': 0.07 * w, 'cu-d': 0.011 * w, 'cu-t': 0.016 * w, tss: 110 * w, 'nh4-n': 1.4 * w, ph: 7.4 }));
    out.push(sample('DS1', d, { ec: 150 * w, 'zn-d': 0.006 * w, 'zn-t': 0.009 * w, 'cu-d': 0.0021 * w, 'cu-t': 0.003 * w, tss: 9 * w, 'nh4-n': 0.05 * w, ph: 7.2 }));
  }
  return out;
}

function input(list: Array<{ s: Sample; rs: Result[] }>, extra: Partial<QaInput> = {}): QaInput {
  return { samples: list.map((x) => x.s), results: list.flatMap((x) => x.rs), sites: [site('DP1'), site('DS1'), site('QC', 'Quality control')], params: P, start: '2025-11-01', ...extra };
}

describe('QC samples', () => {
  it('reads QC sample names', () => {
    expect(['DUP1', 'Dup 2', 'QC1', 'Field Blank', 'Trip blank', 'FB-1', 'Duplicate'].every(looksLikeQc)).toBe(true);
    expect(['DP1', 'Upstream', 'Bore 2', 'Quarry pond'].some(looksLikeQc)).toBe(false);
    expect(qcKind({ sampleName: 'Field blank' })).toBe('blank');
    expect(qcKind({ sampleName: 'DUP1' })).toBe('duplicate');
    expect(qcKind({ sampleName: 'x', qc: 'blank' })).toBe('blank');
  });

  it('keeps QC samples and left-out results out of the monitoring data', () => {
    const a = sample('DP1', '2025-11-10', { ec: 400 });
    const dup = sample('QC', '2025-11-10', { ec: 410 }, { sampleName: 'DUP1' });
    a.rs[0].excluded = { reason: 'bottle broken', at: '' };
    const idx = buildIndex([a.s, dup.s], [...a.rs, ...dup.rs], [site('DP1'), site('QC', 'Quality control')], [...P.values()]);
    expect(idx.byParam.get('ec')).toBeUndefined();
    expect(idx.bySample.get(a.s.id)).toBeUndefined();
    expect(idx.withheld.get(a.s.id)?.length).toBe(1);
    expect(idx.allBySample.get(dup.s.id)?.length).toBe(1);
  });
});

describe('QA/QC checks', () => {
  it('finds nothing to look at in ordinary results', () => {
    const list = [...history(), ...history(11).slice(-2)];
    expect(runQa(input(list)).findings).toEqual([]);
  });

  it('spots two samples swapped between sites', () => {
    const list = history();
    // the November bottles labelled the wrong way round
    list.push(sample('DP1', '2025-11-10', { ec: 152, 'zn-d': 0.0061, 'zn-t': 0.0088, 'cu-d': 0.002, 'cu-t': 0.0031, tss: 9.5, 'nh4-n': 0.048, ph: 7.2 }));
    list.push(sample('DS1', '2025-11-10', { ec: 415, 'zn-d': 0.05, 'zn-t': 0.072, 'cu-d': 0.0105, 'cu-t': 0.017, tss: 105, 'nh4-n': 1.38, ph: 7.4 }));
    const f = runQa(input(list)).findings;
    const swap = f.find((x) => x.kind === 'swap');
    expect(swap?.title).toBe('Possible bottle swap: DP1 ↔ DS1');
    expect(swap?.swap?.parameterIds).toBeUndefined();
    // a swap, not two lots of outliers on their own
    expect(f.filter((x) => x.kind === 'swap')).toHaveLength(1);
    expect(f.filter((x) => x.kind === 'outlier')).toEqual([]);
    expect(swap?.lines[0]).toMatch(/^EC \(µS\/cm\): DP1 152 \(usually 420\), DS1 415 \(usually 150\)$/);
  });

  it('spots one set of bottles swapped by the lab (the metals)', () => {
    const list = history();
    list.push(sample('DP1', '2025-11-10', { ec: 425, 'zn-d': 0.0059, 'zn-t': 0.0091, tss: 108, 'nh4-n': 1.45, ph: 7.4, 'cu-d': 0.0022, 'cu-t': 0.0029 }));
    list.push(sample('DS1', '2025-11-10', { ec: 148, 'zn-d': 0.053, 'zn-t': 0.069, tss: 8.5, 'nh4-n': 0.052, ph: 7.2, 'cu-d': 0.0108, 'cu-t': 0.0155 }));
    const swaps = runQa(input(list)).findings.filter((x) => x.kind === 'swap');
    expect(swaps.map((x) => x.title)).toEqual(['Possible swap of the metals (dissolved) and metals (total) bottles: DP1 ↔ DS1']);
    expect(swaps[0].swap?.parameterIds?.sort()).toEqual(['cu-d', 'cu-t', 'zn-d', 'zn-t']);
  });

  it('flags a result unlike the site’s others, and a likely unit mix-up', () => {
    const list = history();
    list.push(sample('DP1', '2025-11-10', { ec: 410, 'zn-d': 52, 'zn-t': 70, tss: 105, 'nh4-n': 1.4, ph: 7.4 }));
    const f = runQa(input(list)).findings.find((x) => x.kind === 'outlier');
    expect(f?.title).toBe('2 results unlike DP1’s others');
    expect(f?.lines[0]).toMatch(/^Zn \(D\) 52 mg\/L \(usually 0\.052.*about 1000× usual/);
    // dissolved isn't higher than total, so no part-whole finding
    expect(runQa(input(list)).findings.some((x) => x.kind === 'part-whole')).toBe(false);
  });

  it('checks parts against wholes, with room for the detection limit', () => {
    const list = history(2);
    list.push(sample('DP1', '2025-11-10', { 'zn-d': 0.09, 'zn-t': 0.06, 'nh4-n': 3, tkn: 2, drp: 0.011, tp: 0.01, ecoli: 120, fc: 100 }));
    const titles = runQa(input(list)).findings.filter((x) => x.kind === 'part-whole').map((x) => x.title);
    expect(titles).toContain('Dissolved Zinc higher than Total Zinc at DP1');
    expect(titles).toContain('Total Ammoniacal-N higher than Total Kjeldahl Nitrogen at DP1');
    expect(titles).toContain('E. coli higher than Faecal Coliforms at DP1');
    expect(titles.some((t) => t.startsWith('Dissolved Reactive'))).toBe(false); // within 10%
  });

  it('works out the ion balance', () => {
    const good = sample('DP1', '2025-11-10', { 'ca-d': 40, 'mg-d': 12, 'na-d': 46, 'k-d': 4, cl: 71, so4: 48, alkalinity: 100 });
    const bad = sample('DS1', '2025-11-10', { 'ca-d': 40, 'mg-d': 12, 'na-d': 46, 'k-d': 4, cl: 20, so4: 48, alkalinity: 100 });
    const f = runQa(input([good, bad])).findings.filter((x) => x.kind === 'ion-balance');
    expect(f.map((x) => x.siteIds[0])).toEqual(['DS1']);
    expect(f[0].title).toMatch(/^Ion balance \+\d+\.\d% at DS1$/);
  });

  it('compares duplicates, using the original set or the likeliest', () => {
    const list = history(3);
    const a = sample('DP1', '2025-11-10', { ec: 420, 'zn-d': 0.05, tss: 110, 'nh4-n': '<0.01', 'cu-d': 0.0011 });
    const b = sample('DS1', '2025-11-10', { ec: 150, 'zn-d': 0.006, tss: 9, 'nh4-n': 0.05, 'cu-d': 0.001 });
    a.rs.forEach((r) => r.parameterId === 'cu-d' && (r.dl = 0.0005));
    const dup = sample('QC', '2025-11-10', { ec: 430, 'zn-d': 0.09, tss: 104, 'nh4-n': '<0.01', 'cu-d': 0.002 }, { sampleName: 'DUP1' });
    const r = runQa(input([...list, a, b, dup]));
    // not set: the likeliest original is suggested
    const link = r.findings.find((x) => x.kind === 'duplicate-link');
    expect(link?.primary).toBe(a.s.id);
    const rows = new Map(r.duplicates.map((d) => [d.parameterId, d]));
    expect(rows.get('ec')?.pass).toBe(true);
    expect(rows.get('zn-d')).toMatchObject({ pass: false, limit: 30 });
    expect(Math.round(rows.get('zn-d')!.rpd!)).toBe(57);
    expect(rows.get('nh4-n')?.rpd).toBeNull(); // both below detection
    expect(rows.get('cu-d')?.limit).toBeNull(); // near the detection limit: no limit
    expect(r.findings.find((x) => x.kind === 'duplicate')?.title).toBe('Duplicate of DP1 differs for 1 analyte');
    // set: no suggestion needed
    dup.s.qcOf = a.s.id;
    expect(runQa(input([...list, a, b, dup])).findings.some((x) => x.kind === 'duplicate-link')).toBe(false);
  });

  it('suggests no original when two are just as alike', () => {
    const a = sample('DP1', '2025-11-10', { ec: 420, 'zn-d': 0.05, tss: 110 });
    const b = sample('DS1', '2025-11-10', { ec: 420, 'zn-d': 0.05, tss: 110 });
    const dup = sample('QC', '2025-11-10', { ec: 415, 'zn-d': 0.051, tss: 108 });
    const all = [a, b, dup];
    const vals = (id: string) => new Map(all.find((x) => x.s.id === id)!.rs.map((r) => [r.parameterId, { r, v: r.value!, nd: false }]));
    expect(guessPrimary(dup.s, [a.s, b.s], vals)).toBeUndefined();
  });

  it('reports what’s found in a blank', () => {
    const blank = sample('QC', '2025-11-10', { 'zn-d': 0.004, 'cu-d': '<0.0005', ph: 5.8, ec: 2 }, { sampleName: 'Field blank' });
    const a = sample('DP1', '2025-11-10', { 'zn-d': 0.05 });
    const f = runQa(input([a, blank])).findings.find((x) => x.kind === 'blank');
    expect(f?.lines).toEqual(['Zn (D): 0.004 mg/L (samples that day: 0.05–0.05)']);
  });

  it('checks holding times, the lab’s comments, impossible values and detection limits', () => {
    const list = history(4);
    const late = sample('DP1', '2025-11-10T09:00', { ecoli: 30, tss: 100, 'zn-d': '<0.05', 'cu-d': '<0.001', ph: 15 }, { receivedOn: '2025-11-11T14:00', notes: 'Lab comment #1 (E. coli): the sample was > 10 °C on receipt at the lab.' });
    const limits = new Map([['cu-d', [{ value: 0.0014, label: 'ANZG 95%' }]], ['zn-d', [{ value: 0.008, label: 'consent limit' }]]]);
    const f = runQa(input([...list, late], { limits })).findings;
    const by = (k: string) => f.filter((x) => x.kind === k);
    expect(by('holding')[0]).toMatchObject({ title: 'Received 29 hours after sampling at DP1', lines: ['E. coli: usual holding time 24 h'] });
    expect(by('lab-comment')[0]).toMatchObject({ severity: 'check', lines: ['#1 (E. coli): the sample was > 10 °C on receipt at the lab.'] });
    expect(by('impossible')[0].title).toBe('pH 15.0 at DP1');
    expect(by('dl-limit').map((x) => x.title)).toEqual(['Zn (D): detection limit above the consent limit']);
  });

  it('notes raised detection limits', () => {
    const list = [1, 2, 3, 4].map((m) => sample('DP1', `2025-0${m}-10`, { 'cu-d': '<0.0005' }));
    list.push(sample('DP1', '2025-11-10', { 'cu-d': '<0.005' }));
    const f = runQa(input(list)).findings.find((x) => x.kind === 'dl-raised');
    expect(f).toMatchObject({ severity: 'note', lines: ['Cu (D) <0.005 mg/L (usually <0.0005)'] });
  });

  it('flags field and lab EC far apart', () => {
    const f = runQa(input([sample('DP1', '2025-11-10', { ec: 420, 'ec-field': 160 })])).findings;
    expect(f.map((x) => x.title)).toEqual(['Field and lab EC differ at DP1']);
  });

  it('keeps decisions by finding, except a swap found again', () => {
    const list = history();
    list.push(sample('DP1', '2025-11-10', { ec: 410, 'zn-d': 52, 'zn-t': 70, tss: 105, 'nh4-n': 1.4, ph: 7.4 }));
    const [f] = runQa(input(list)).findings;
    const rec = { id: `p|${f.key}`, projectId: 'p', key: f.key, kind: f.kind, status: 'accepted' as const, title: f.title, at: '2025-11-20' };
    expect(withRecords([f], [rec])[0].record?.status).toBe('accepted');
    expect(withRecords([{ ...f, kind: 'swap' }], [{ ...rec, status: 'swapped' }])[0].record).toBeUndefined();
  });
});
