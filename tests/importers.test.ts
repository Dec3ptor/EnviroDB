import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readWorkbook } from '../src/importers/workbook';
import { parseLabSheet } from '../src/importers/lab';
import { detectWide, parseWide } from '../src/importers/wide';
import { detectLong, parseLong } from '../src/importers/long';
import { planSheets } from '../src/importers/detect';
import { BUILT_IN_PARAMETERS } from '../src/data/parameters';
import { buildParamIndex, matchParameter } from '../src/lib/matching';

const load = (name: string) => {
  const buf = readFileSync(new URL(`../public/samples/${name}`, import.meta.url));
  return readWorkbook(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), name);
};
const labGrids = await load('example-lab-results-hill-layout.xlsx');
const masterGrids = await load('example-master-sheet.xlsx');
const longGrids = await load('example-long-format.csv');
const index = buildParamIndex(BUILT_IN_PARAMETERS);

describe('lab certificate (Hill layout)', () => {
  const grids = labGrids;
  it('detects the layout', () => {
    expect(planSheets(grids, index)[0].mode).toBe('lab');
  });
  const parsed = parseLabSheet(grids[0])!;
  it('reads samples, lab numbers and dates from sample names', () => {
    expect(parsed.labName).toBe('Hill Laboratories');
    expect(parsed.samples.map((s) => s.sampleName)).toEqual(['US1 12-Mar-2026 9:10 am', 'DP1 12-Mar-2026 9:45 am', 'DS1 12-Mar-2026 10:20 am']);
    expect(parsed.samples.map((s) => s.labNumber)).toEqual(['3512345.1', '3512345.2', '3512345.3']);
    expect(parsed.samples.map((s) => s.date)).toEqual(['2026-03-12T09:10', '2026-03-12T09:45', '2026-03-12T10:20']);
    expect(parsed.samples.map((s) => s.siteText)).toEqual(['US1', 'DP1', 'DS1']);
  });
  it('reads results, units, non-detects and section groups', () => {
    const us = parsed.samples[0];
    const tss = us.results.find((r) => r.analyte === 'Total Suspended Solids')!;
    expect(tss.unit).toBe('g/m³');
    expect(tss.parsed).toMatchObject({ value: 3, qualifier: '<' });
    const zn = us.results.find((r) => r.analyte === 'Dissolved Zinc')!;
    expect(zn.group).toMatch(/Heavy metals, dissolved/);
    expect(zn.parsed.value).toBe(0.0019);
    // DP1 has no DRP / E. coli (blank cells) and nothing from the methods table
    const dp = parsed.samples[1];
    expect(dp.results.find((r) => r.analyte === 'Escherichia coli')).toBeUndefined();
    expect(dp.results.some((r) => r.analyte === 'Test' || r.analyte === 'pH meter. APHA 4500-H+ B')).toBe(false);
    expect(us.results.length).toBe(13);
  });
  it('maps every analyte to a parameter', () => {
    const unmatched = parsed.samples[0].results.filter((r) => !matchParameter(r.analyte, index, r.group).parameterId).map((r) => r.analyte);
    expect(unmatched).toEqual([]);
  });
});

describe('master sheet (dates per row, one sheet per site)', () => {
  const grids = masterGrids;
  it('plans sheets', () => {
    const plans = planSheets(grids, index);
    expect(plans.map((p) => p.mode)).toEqual(['wide', 'wide', 'wide', 'skip']);
  });
  const { config } = detectWide(grids[0], index);
  it('detects header, units row, date and time columns', () => {
    expect(config.orientation).toBe('rows');
    expect(config.headerRow).toBe(2);
    expect(config.unitRow).toBe(3);
    expect(config.dateCol).toBe(0);
    expect(config.timeCol).toBe(1);
    expect(config.siteMode).toBe('sheet');
    expect(config.firstDataRow).toBe(5);
  });
  it('parses rows, skipping the guideline row and NS values', () => {
    const p = parseWide(grids[0], config);
    expect(p.samples.length).toBe(24);
    expect(p.samples[0].siteText).toBe('US1');
    expect(p.samples[0].date).toMatch(/^2022-07-\d\dT\d\d:\d\d$/);
    const s5 = p.samples[5];
    expect(s5.results.find((r) => r.analyte === 'Dissolved Zn')).toBeUndefined();
    const comments = p.samples.flatMap((s) => s.results).filter((r) => r.analyte === 'Comments');
    expect(comments.length).toBe(0);
    const ec = p.samples[0].results.find((r) => r.analyte === 'EC')!;
    expect(ec.unit).toBe('uS/cm');
  });
});

describe('long format CSV', () => {
  const grids = longGrids;
  it('detects and parses', () => {
    const { config, score } = detectLong(grids[0]);
    expect(score).toBeGreaterThan(20);
    const p = parseLong(grids[0], config);
    expect(p.samples.length).toBe(6);
    expect(p.samples[0].date).toBe('2026-04-14');
    expect(p.samples[0].results.length).toBe(3);
    const tss = p.samples[0].results.find((r) => r.analyte === 'Total Suspended Solids')!;
    expect(tss.parsed).toMatchObject({ value: 3, qualifier: '<' });
  });

  it('knows a long table without a detection limit column', async () => {
    const sites = ['DP1', 'DS1', 'US1', 'DUP1', 'Field blank'];
    const params = ['pH', 'Total Suspended Solids', 'Turbidity', 'Electrical Conductivity (EC)', 'Dissolved Zinc', 'Nitrate-N'];
    const csv = ['Site,Date,Parameter,Result,Units', ...sites.flatMap((s) => params.map((p, i) => `${s},2026-10-14,${p},${i + 1.5},g/m3`))].join('\n');
    const grids = await readWorkbook(new TextEncoder().encode(csv).buffer, 'round.csv');
    expect(planSheets(grids, index)[0].mode).toBe('long');
  });
});
