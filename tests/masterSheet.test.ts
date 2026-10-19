import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import * as XLSX from '@e965/xlsx';
import { db, ensureBuiltIns } from '../src/db/db';
import { readWorkbook } from '../src/importers/workbook';
import { planSheets, parseWithPlan } from '../src/importers/detect';
import { buildParamIndex, matchParameter, type ParamIndex } from '../src/lib/matching';
import { analyteMapKey, type ParsedImport } from '../src/importers/model';
import { createDemoProject } from '../src/db/demo';
import { commitImport } from '../src/importers/commit';
import { parseValue } from '../src/lib/values';
import { loadBundle } from './helpers';

let index: ParamIndex;
beforeAll(async () => {
  await ensureBuiltIns();
  index = buildParamIndex(await db.parameters.toArray());
});

const METALS = ['Arsenic', 'Cadmium', 'Chromium', 'Copper', 'Lead', 'Nickel', 'Zinc', 'Iron', 'Manganese', 'Aluminium'];
const GENERAL = ['pH', 'Temperature', 'Conductivity', 'Dissolved Oxygen', 'Turbidity', 'Total Suspended Solids', 'Total Hardness', 'Alkalinity', 'Chloride', 'Sulphate', 'Ammoniacal-N', 'Nitrate-N', 'Nitrite-N', 'Total Kjeldahl Nitrogen', 'Total Nitrogen', 'Dissolved Reactive Phosphorus', 'Total Phosphorus', 'E. coli', 'Faecal Coliforms', 'BOD5', 'COD'];
const LATER = ['Benzene', 'Toluene'];
const SITES = ['US1', 'DP1', 'DS1'];

/** A master sheet like a team's own: a title, a row of categories (merged over the metals), names, units, then years of rows. */
async function masterSheet(opts: { rows: number; categories?: boolean; siteOnce?: boolean; mergedNote?: boolean }) {
  const header = ['Site', 'Date', 'Time', ...GENERAL, ...METALS, ...METALS, ...LATER];
  const cats: unknown[] = header.map(() => '');
  cats[3] = 'General';
  cats[3 + GENERAL.length] = 'Dissolved Metals';
  cats[3 + GENERAL.length + METALS.length] = 'Total Metals';
  cats[3 + GENERAL.length + 2 * METALS.length] = 'Hydrocarbons';
  const units = ['', '', '', 'pH units', '°C', 'µS/cm', 'mg/L', 'NTU', ...GENERAL.slice(5).map(() => 'mg/L'), ...METALS.map(() => 'mg/L'), ...METALS.map(() => 'mg/L'), 'mg/L', 'mg/L'];
  units[3 + GENERAL.indexOf('E. coli')] = 'cfu/100mL';
  units[3 + GENERAL.indexOf('Faecal Coliforms')] = 'cfu/100mL';
  const aoa: unknown[][] = [['Kōwhai Quarry – monitoring master sheet'], opts.categories === false ? [] : cats, header, units];
  for (let i = 0; i < opts.rows; i++) {
    const site = SITES[Math.floor(i / 1) % 3];
    const row: unknown[] = [opts.siteOnce && i % 3 !== 0 ? '' : site, new Date(Date.UTC(2010, 0, 1) + Math.floor(i / 3) * 7 * 86400000), '09:30'];
    if (opts.siteOnce) row[0] = i % 3 === 0 ? `Block ${Math.floor(i / 3)}` : '';
    GENERAL.forEach((_, k) => row.push(k === 6 && i % 5 === 0 ? '<0.5' : Number((1 + ((i * 7 + k * 13) % 50) / 10).toFixed(2))));
    // dissolved below total, so the two can be told apart
    METALS.forEach((_, k) => row.push(i % 4 === 0 ? '<0.001' : Number((0.001 + ((i + k) % 30) / 1000).toFixed(4))));
    METALS.forEach((_, k) => row.push(Number((0.1 + ((i + k) % 30) / 100).toFixed(3))));
    LATER.forEach(() => row.push(i >= opts.rows - 300 ? 0.002 : ''));
    aoa.push(row);
  }
  if (opts.mergedNote) aoa.push(['US1', new Date(Date.UTC(2030, 0, 1)), '', 'No sample – site dry']);
  aoa.push([], ['ANZG 95%', '', '', 6.5, '', '', '', '', '', '', '', '', '', 0.9]);
  const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });
  const merges: XLSX.Range[] = [];
  if (opts.categories !== false)
    merges.push({ s: { r: 1, c: 3 + GENERAL.length }, e: { r: 1, c: 2 + GENERAL.length + METALS.length } }, { s: { r: 1, c: 3 + GENERAL.length + METALS.length }, e: { r: 1, c: 2 + GENERAL.length + 2 * METALS.length } });
  if (opts.mergedNote) merges.push({ s: { r: aoa.length - 3, c: 3 }, e: { r: aoa.length - 3, c: header.length - 1 } });
  ws['!merges'] = merges;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'All sites');
  const grids = await readWorkbook(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer, 'master.xlsx');
  return parseWithPlan(grids, planSheets(grids, index));
}

const analytes = (p: ParsedImport) => {
  const out = new Map<string, { count: number; analyte: string; group?: string }>();
  for (const s of p.samples)
    for (const r of s.results) {
      const k = analyteMapKey(r);
      const cur = out.get(k) ?? { count: 0, analyte: r.analyte, group: r.group };
      cur.count++;
      out.set(k, cur);
    }
  return out;
};
const match = (a: { analyte: string; group?: string }) => matchParameter(a.analyte, index, a.group).parameterId;

describe('master spreadsheets with many analytes', () => {
  it('keeps every analyte column – dissolved and total of the same metal apart, by the categories over them', async () => {
    const t0 = performance.now();
    const p = await masterSheet({ rows: 1500 });
    const ms = performance.now() - t0;
    const a = analytes(p);
    expect(p.samples).toHaveLength(1500);
    expect(a.size).toBe(GENERAL.length + 2 * METALS.length + LATER.length);
    const zinc = [...a.values()].filter((x) => x.analyte === 'Zinc');
    expect(zinc.map((x) => [x.group, match(x)])).toEqual([
      ['Dissolved Metals', 'zn-d'],
      ['Total Metals', 'zn-t'],
    ]);
    expect([...a.values()].filter((x) => x.analyte === 'Arsenic').map(match)).toEqual(['as-d', 'as-t']);
    // every metal column's values, none lost under the other
    for (const x of a.values()) if (METALS.includes(x.analyte)) expect(x.count, `${x.analyte} ${x.group}`).toBe(1500);
    // an analyte started late in the sheet (its results only in the last 300 rows) is still found
    expect([...a.values()].find((x) => x.analyte === 'Benzene')?.count).toBe(300);
    expect(ms).toBeLessThan(20_000);
  }, 60_000);

  it('the same name twice with nothing over it: both kept, told apart by their column', async () => {
    const p = await masterSheet({ rows: 60, categories: false });
    const zinc = [...analytes(p).values()].filter((x) => x.analyte === 'Zinc');
    expect(zinc.map((x) => x.group)).toEqual(['column AE', 'column AO']);
    expect(zinc.every((x) => x.count === 60)).toBe(true);
  }, 60_000);

  it('a site written once over its rows applies to the rows under it (and says so)', async () => {
    const p = await masterSheet({ rows: 30, siteOnce: true });
    expect(p.samples).toHaveLength(30);
    expect(p.samples.slice(0, 3).map((s) => s.siteText)).toEqual(['Block 0', 'Block 0', 'Block 0']);
    expect(p.warnings.join(' ')).toMatch(/20 rows with no site of their own were given the site above/);
  }, 60_000);

  it('a note merged across a row of results isn’t copied into every column', async () => {
    const p = await masterSheet({ rows: 9, mergedNote: true });
    const last = p.samples.find((s) => s.date?.startsWith('2030'));
    expect(last?.results.length ?? 0).toBeLessThanOrEqual(1);
  }, 60_000);

  it('a plain “Arsenic” isn’t taken for acid-soluble arsenic', () => {
    const m = matchParameter('Arsenic', index);
    expect(m.parameterId).toBeNull();
    expect(m.candidates.sort()).toEqual(['as-d', 'as-t']);
    expect(matchParameter('As (acid sol)', index).parameterId).toBe('as-as');
    expect(matchParameter('Acid Soluble Arsenic', index).parameterId).toBe('as-as');
  });

  it('saved whole, with progress shown – and names remembered once, but not a bare “Zinc” a category decided', async () => {
    const projectId = await createDemoProject();
    const b = await loadBundle(projectId);
    const p = await masterSheet({ rows: 45 });
    const ix = buildParamIndex(await db.parameters.toArray());
    const params: Record<string, string | null> = {};
    for (const s of p.samples) for (const r of s.results) params[analyteMapKey(r)] ??= matchParameter(r.analyte, ix, r.group).parameterId;
    // one picked by hand: a name only this sheet uses
    p.samples.forEach((s) => s.results.push({ analyte: 'Fluor. (IC)', unit: 'mg/L', raw: 0.01, parsed: parseValue(0.01) }));
    params[analyteMapKey({ analyte: 'Fluor. (IC)', unit: 'mg/L' })] = 'f';
    // the site names, each on fifteen rows, given a new name for the site
    p.samples.forEach((s) => (s.siteText = `${s.siteText} (master)`));
    const site = (t: string) => b.sites.find((x) => t.startsWith(x.code))!.id;
    const progress: number[] = [];
    const total = p.samples.reduce((t, s) => t + s.results.filter((r) => params[analyteMapKey(r)]).length, 0);
    const res = await commitImport(projectId, p, { sites: Object.fromEntries(p.samples.map((s) => [s.key, site(s.siteText!)])), dates: {}, include: {}, params, units: {} }, { duplicates: 'replace', rememberAliases: true, fileName: 'master.xlsx', onProgress: (n) => progress.push(n) });
    expect(res.results).toBe(total);
    expect(progress.at(-1)).toBe(total);
    expect((await db.results.where('importId').equals(res.id).count())).toBe(total);
    // remembered: the hand-picked name, and each site's name once
    expect((await db.parameters.get('f'))!.aliases).toContain('Fluor. (IC)');
    for (const code of SITES) expect((await db.sites.get(site(code)))!.aliases.filter((a) => a === `${code} (master)`)).toHaveLength(1);
    // not remembered: "Zinc" – its category chose dissolved or total, and would be overruled by a remembered name next time
    expect((await db.parameters.get('zn-d'))!.aliases.map((a) => a.toLowerCase())).not.toContain('zinc');
    expect((await db.parameters.get('zn-t'))!.aliases.map((a) => a.toLowerCase())).not.toContain('zinc');
    const again = buildParamIndex(await db.parameters.toArray());
    expect(matchParameter('Zinc', again, 'Dissolved Metals').parameterId).toBe('zn-d');
    expect(matchParameter('Zinc', again, 'Total Metals').parameterId).toBe('zn-t');
  }, 120_000);
});
