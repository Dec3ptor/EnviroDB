import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { db, ensureBuiltIns } from '../src/db/db';
import { newProject, newSite, saveProject, saveSite } from '../src/db/repo';
import { readWorkbook } from '../src/importers/workbook';
import { detectExport, importContext, parseExport, siteFromClientRef } from '../src/importers/labExports';
import { pageLines, pdfReportGrid, pdfSampleInfo, readLabPdf, type PdfWord } from '../src/importers/pdfTables';
import { defaultPlans, readImportFiles } from '../src/importers/files';
import { parseWithPlan } from '../src/importers/detect';
import { analyteMapKey, type ParsedImport } from '../src/importers/model';
import { commitImport } from '../src/importers/commit';
import { buildParamIndex, matchParameter, matchSite } from '../src/lib/matching';
import { guessGroup } from '../src/data/parameters';

const file = (name: string) => {
  const b = readFileSync(`tests/fixtures/${name}`);
  return { name, data: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer };
};
const grid = async (name: string) => (await readWorkbook(file(name).data, name))[0];
const results = (p: ParsedImport | null) => Object.fromEntries((p?.samples ?? []).flatMap((s) => s.results.map((r) => [`${s.siteText}|${r.analyte}|${r.group ?? ''}`, r.parsed.text])));

// ------------------------------------------------------------ synthetic PDF pages, laid out like each lab's reports

const w = (str: string, x: number, y: number, width = str.length * 3.6, h = 7): PdfWord => ({ str, x, y, w: width, h });
/** Words of a phrase, one item per word as ALS's PDFs have them. */
const words = (text: string, x: number, y: number): PdfWord[] => {
  let at = x;
  return text.split(' ').map((s) => {
    const item = w(s, at, y);
    at += item.w + 2;
    return item;
  });
};

const ALS_PAGE: PdfWord[] = [
  ...words('Analytical Results', 34, 504),
  ...words('Sub-Matrix: WATER', 33, 493.5),
  ...words('2026000201 - Pond Outlet', 380, 488.4),
  ...words('2026000202 - Bore', 467, 492.5),
  ...words('2 (Deep)', 478, 484.4),
  ...words('Client Sample ID', 315, 484.4),
  w('----', 408, 480.4, 9.3),
  w('----', 495, 476.4, 9.3),
  ...words('Client Sampling', 318, 465.9),
  w('10-Feb-2026', 383, 461.9, 40.1),
  w('09:30', 425, 461.9, 17.5),
  w('10-Feb-2026', 470, 461.9, 40.1),
  w('11:05', 512, 461.9, 17.5),
  ...words('date / time', 334, 457.8),
  w('Compound', 32, 446.8, 34.2),
  w('CAS', 213, 446.8, 14.4),
  w('Number', 229.4, 446.8, 24.9),
  w('LOR', 277, 446.8, 14.4),
  w('Unit', 334.6, 446.8, 12.4),
  w('NH2600002-001', 387.1, 446.1, 51.4),
  w('NH2600002-002', 473.9, 446.1, 51.4),
  w('Result', 404, 430.9, 19.8),
  w('Result', 490.7, 430.9, 19.8),
  ...words('Ani_W: Anions by Ion Chromatography', 34, 415.9),
  w('Chloride', 41.2, 403, 26.1),
  w('16887-00-6', 218.8, 403.6, 35.8),
  w('0.5', 280, 403, 10),
  w('g/m3', 334, 403, 15.6),
  w('45.2', 405, 403, 15),
  w('<0.5', 492, 403, 15),
  ...words('HMSol_W: Elements in Water (Soluble)', 34, 390),
  w('Zinc', 41.2, 380, 15),
  w('7440-66-6', 218, 380, 32),
  w('0.001', 278, 380, 18),
  w('g/m3', 334, 380, 15.6),
  w('0.012', 404, 380, 18),
  w('----', 496, 380, 9.3),
  // a row made taller by two CAS numbers: its results sit beside the first, its name beside the second
  w('Benzo(b)&(j)fluoranthene', 41.2, 360, 78.2),
  w('205-99-2', 226.6, 368, 28),
  w('205-82-3', 226.6, 352, 28),
  w('0.0005', 272, 360, 25),
  w('g/m3', 334, 360, 15.6),
  w('<0.0005', 403, 367, 29.4),
  w('----', 496, 367, 9.3),
  ...words('SVOC_W: Semi-Volatile Organic Compounds (Surrogates)', 34, 345),
  w('Phenol-d5', 41.2, 335, 30),
  w('%', 336, 335, 5),
  w('45.1', 405, 335, 15),
  ...words('Cr6_W: Hexavalent Chromium (subcontracted)', 34, 328),
  // "ø": not accredited
  w('ø', 32.4, 320, 4.3),
  w('Chromium', 41.2, 320, 32.3),
  w('-', 75.5, 320, 2.3),
  w('Hexavalent', 79.7, 320, 35),
  w('g/m3', 334, 320, 15.6),
  w('----', 409, 320, 9.3),
  w('<0.010', 489, 320, 25),
  ...words('Page : 3 of 5', 33, 40),
];

const LINNAEUS_PAGE: PdfWord[] = [
  w('Analysis Report', 234, 723, 114, 15),
  w('Units', 191.3, 513, 22.6),
  w('2026000101', 244.6, 532.6, 55.4),
  w('Upstream Bridge', 241, 521.1, 63),
  w('2026000102', 325.1, 537.6, 55.4), // a two-line name: the cell is centred, so its number sits higher
  w('Pond', 342, 526.1, 22),
  w('Outlet', 339, 514.6, 28),
  w('10/02/2026', 247.4, 504.2, 49.9),
  w('9:30', 262.6, 492.7, 19.3),
  w('10/02/2026', 327.9, 504.2, 49.9),
  w('10:15', 340.4, 492.7, 25),
  w('Test', 95.3, 476.4, 20.5),
  w('Analytica Laboratories Report', 39.7, 457.5, 131.5),
  w('NH2600001_0', 240.2, 457.5, 64.3),
  w('NH2600001_0', 320.7, 457.5, 64.3),
  w('Conductivity (25°C)', 39.7, 440.1, 86.1),
  w('μS/cm', 188.4, 440.1, 28.4),
  w('412', 344.7, 440.1, 16),
  w('pH - Water', 39.7, 422.6, 48.2),
  w('7.4', 265.4, 422.6, 13.8),
  w('6.9', 345.9, 422.6, 13.8),
  w('Report ID: 2026021000000001', 38, 90.7, 137),
  w('Linnaeus, PO Box 1, Exampletown', 194, 72.5, 200),
];

const HILL_PAGE: PdfWord[] = [
  w('Certificate of Analysis', 48.5, 730.8, 188, 18),
  w('Sample Name:', 147.6, 602.6, 62),
  w('NH2600001_003; 2026000103 Bore 2 (Deep)', 230.9, 603.8, 150),
  w('NH2600001_002', 445, 603.8, 50),
  w('10-Feb-2026 11:05 am', 260, 594, 90),
  w('10-Feb-2026 10:15 am', 425, 594, 90),
  w('Lab Number:', 154.6, 581.5, 55.5),
  w('4100000.1', 286.4, 582.2, 38),
  w('4100000.2', 451, 582.2, 38),
  w('Hexavalent Chromium', 46.3, 570.5, 90),
  w('g/m', 193.9, 570.5, 13),
  w('3', 206.9, 572.4, 2.9, 5.2),
  w('< 0.010', 290, 570.5, 30),
  w('0.021', 460, 570.5, 22),
  w("Analyst's Comments", 46, 540, 80),
];

let alsCsvGrid: Awaited<ReturnType<typeof grid>>;
beforeAll(async () => {
  await ensureBuiltIns();
  alsCsvGrid = await grid('als-csv-simple-synthetic.csv');
});

describe('lab exports', () => {
  it('names a site from the reference the samples were sent under, whatever the lab numbers', () => {
    expect(siteFromClientRef('2026000101 - Upstream')).toBe('Upstream');
    expect(siteFromClientRef('2026000104 - Weir (Site 4)')).toBe('Weir (Site 4)');
    expect(siteFromClientRef('NH2600001_002; 2026000102 Pond Outlet')).toBe('Pond Outlet');
    expect(siteFromClientRef('Upstream')).toBe('Upstream');
    expect(siteFromClientRef('MW1')).toBe('MW1');
  });

  it("reads Linnaeus reports saved as CSV: a sample per site, the ALS reference rows and empty results left out", async () => {
    const g = await grid('linnaeus-report-synthetic.csv');
    expect(detectExport(g)?.format).toBe('linnaeus');
    const p = parseExport(g)!;
    expect(p.labName).toBe('Linnaeus');
    expect(p.samples.map((s) => [s.siteText, s.date, s.labNumber])).toEqual([
      ['Upstream Bridge', '2026-02-10T09:30', '2026000101'],
      ['Pond Outlet', '2026-02-10T10:15', '2026000102'],
      ['Bore 2 (Deep)', '2026-02-10T11:05', '2026000103'],
    ]);
    expect(results(p)).toEqual({ 'Upstream Bridge|pH - Water|': '7.4', 'Pond Outlet|Conductivity (25°C)|': '412', 'Pond Outlet|pH - Water|': '6.9', 'Bore 2 (Deep)|pH - Water|': '7.1' });
  });

  it('reads ALS CSV files: dissolved and total metals told apart, surrogate recoveries left out', async () => {
    expect(detectExport(alsCsvGrid)?.format).toBe('als');
    const p = parseExport(alsCsvGrid)!;
    expect(p.samples.map((s) => [s.siteText, s.date, s.labJob])).toEqual([
      ['Upstream Bridge', '2026-02-10T09:30', 'NH2600001'],
      ['Pond Outlet', '2026-02-10T10:15', 'NH2600001'],
      ['Bore 2 (Deep)', '2026-02-10T11:05', 'NH2600001'],
    ]);
    const r = results(p);
    expect(r['Upstream Bridge|Zinc|Dissolved']).toBe('0.004');
    expect(r['Upstream Bridge|Zinc|Total']).toBe('0.009');
    expect(r['Upstream Bridge|Ammoniacal Nitrogen as N|']).toBe('<0.010');
    expect(Object.keys(r).some((k) => /Phenol-d5|Fluorobiphenyl/.test(k))).toBe(false);
    expect(p.warnings.join(' ')).toMatch(/2 surrogate recoveries/);
    // and the lab's names match the parameter library
    const index = buildParamIndex(await db.parameters.toArray());
    const zincs = p.samples[0].results.filter((x) => x.analyte === 'Zinc').map((x) => matchParameter(x.analyte, index, x.group).parameterId);
    expect(zincs).toEqual(['zn-d', 'zn-t']);
  });

  it('reads ALS ESdat files, naming their samples from the PDF report and leaving out the lab QC', async () => {
    const g = await grid('als-esdat-synthetic.csv');
    expect(detectExport(g)?.format).toBe('esdat');
    // on its own: lab numbers only, and a warning saying what to add
    const alone = parseExport(g)!;
    expect(alone.samples.map((s) => [s.siteText, s.date])).toEqual([
      ['NH2600002001', undefined],
      ['NH2600002002', undefined],
    ]);
    expect(alone.warnings.join(' ')).toMatch(/PDF report for NH2600002/);
    expect(alone.warnings.join(' ')).toMatch(/Left out 3 laboratory QC results/);
    // with the PDF: site names and dates
    const rep = readLabPdf([ALS_PAGE])!;
    const p = parseExport(g, importContext([g], pdfSampleInfo(rep)))!;
    expect(p.samples.map((s) => [s.siteText, s.date])).toEqual([
      ['Pond Outlet', '2026-02-10T09:30'],
      ['Bore 2 (Deep)', '2026-02-10T11:05'],
    ]);
    expect(results(p)).toEqual({
      'Pond Outlet|Chloride|Dissolved': '45.2',
      'Pond Outlet|Total Kjeldahl Nitrogen as N|Total': '1.2',
      'Bore 2 (Deep)|Chloride|Dissolved': '<0.5',
      'Bore 2 (Deep)|Nitrate as N|Dissolved': '<0.020',
    });
  });
});

describe('lab PDF reports', () => {
  it('reads words into lines and phrases (superscripts on their line, close words together)', () => {
    const lines = pageLines(HILL_PAGE);
    expect(lines.map((l) => l.phrases.map((p) => p.text).join(' | '))).toContain('Hexavalent Chromium | g/m3 | < 0.010 | 0.021');
  });

  it("reads ALS certificates: samples from the column headings, sections, a tall row, footnote marks; surrogates left out", () => {
    const rep = readLabPdf([ALS_PAGE])!;
    expect(rep.lab).toBe('ALS');
    expect(rep.samples).toEqual([
      { labNumber: 'NH2600002-001', clientRef: '2026000201 - Pond Outlet', date: '2026-02-10T09:30' },
      { labNumber: 'NH2600002-002', clientRef: '2026000202 - Bore 2 (Deep)', date: '2026-02-10T11:05' },
    ]);
    expect(rep.results.map((r) => [r.labNumber, r.analyte, r.group, r.unit, r.value])).toEqual([
      ['NH2600002-001', 'Chloride', 'Anions by Ion Chromatography', 'g/m3', '45.2'],
      ['NH2600002-002', 'Chloride', 'Anions by Ion Chromatography', 'g/m3', '<0.5'],
      ['NH2600002-001', 'Zinc', 'Elements in Water (Soluble)', 'g/m3', '0.012'],
      ['NH2600002-001', 'Benzo(b)&(j)fluoranthene', 'Elements in Water (Soluble)', 'g/m3', '<0.0005'],
      ['NH2600002-002', 'Chromium - Hexavalent', 'Hexavalent Chromium (subcontracted)', 'g/m3', '<0.010'],
    ]);
  });

  it('reads Linnaeus reports: sample details under the numbers, units, the ALS reference row left out', () => {
    const rep = readLabPdf([LINNAEUS_PAGE])!;
    expect(rep.lab).toBe('Linnaeus');
    expect(rep.samples).toEqual([
      { labNumber: '2026000101', clientRef: 'Upstream Bridge', date: '2026-02-10T09:30' },
      { labNumber: '2026000102', clientRef: 'Pond Outlet', date: '2026-02-10T10:15' },
    ]);
    expect(rep.results.map((r) => [r.labNumber, r.analyte, r.unit, r.value])).toEqual([
      ['2026000102', 'Conductivity (25°C)', 'µS/cm', '412'],
      ['2026000101', 'pH - Water', undefined, '7.4'],
      ['2026000102', 'pH - Water', undefined, '6.9'],
    ]);
  });

  it("reads Hill certificates – a sample named only by ALS's number is named from ALS's files", () => {
    const rep = readLabPdf([HILL_PAGE])!;
    expect(rep.lab).toBe('Hill Laboratories');
    expect(rep.results.map((r) => [r.labNumber, r.analyte, r.unit, r.value])).toEqual([
      ['4100000.1', 'Hexavalent Chromium', 'g/m3', '< 0.010'],
      ['4100000.2', 'Hexavalent Chromium', 'g/m3', '0.021'],
    ]);
    const g = pdfReportGrid(rep, 'hill.pdf');
    const p = parseExport(g, importContext([alsCsvGrid, g]))!;
    expect(p.samples.map((s) => [s.siteText, s.date, s.labName])).toEqual([
      ['Bore 2 (Deep)', '2026-02-10T11:05', 'Hill Laboratories'],
      ['Pond Outlet', '2026-02-10T10:15', 'Hill Laboratories'],
    ]);
  });
});

describe('importing a lab round', () => {
  it('reads a zip of the lab files, takes results from the spreadsheets over the PDFs, and files them by site and day', async () => {
    const zip = new JSZip();
    for (const f of ['linnaeus-report-synthetic.csv', 'als-csv-simple-synthetic.csv']) zip.file(`Lab reports/${f}`, file(f).data);
    zip.file('__MACOSX/._als-csv-simple-synthetic.csv', 'x');
    const read = await readImportFiles([{ name: 'Lab reports.zip', data: await zip.generateAsync({ type: 'arraybuffer' }) }]);
    expect(read.names).toEqual(['linnaeus-report-synthetic.csv', 'als-csv-simple-synthetic.csv']);
    // the Linnaeus PDF of the same samples, as if it was in the zip too
    const pdf = { ...pdfReportGrid(readLabPdf([LINNAEUS_PAGE])!, 'linnaeus.pdf'), file: 'linnaeus.pdf' };
    const grids = [...read.grids, pdf];
    const ctx = importContext(grids);
    const params = await db.parameters.toArray();
    const { plans, notes } = defaultPlans(grids, ctx, buildParamIndex(params));
    expect(plans.map((p) => p.mode)).toEqual(['export', 'export', 'skip']);
    expect(notes[0]).toMatch(/linnaeus\.pdf: the same results are in linnaeus-report-synthetic\.csv/);

    const parsed = parseWithPlan(grids, plans, ctx);
    const project = newProject({ name: 'Lab round' });
    await saveProject(project);
    const sites = ['Upstream Bridge', 'Pond Outlet', 'Bore 2 (Deep)'].map((name, i) => newSite(project.id, { code: `S${i + 1}`, name, order: i + 1 }));
    for (const s of sites) await saveSite(s);
    const index = buildParamIndex(params);
    const mapping = {
      sites: Object.fromEntries(parsed.samples.map((s) => [s.key, matchSite(s.siteText, sites).siteId])),
      dates: {},
      include: {},
      params: Object.fromEntries(parsed.samples.flatMap((s) => s.results.map((r) => [analyteMapKey(r), matchParameter(r.analyte, index, r.group).parameterId]))),
      units: {},
    };
    expect(Object.values(mapping.sites).every(Boolean)).toBe(true);
    await commitImport(project.id, parsed, mapping, { duplicates: 'replace', rememberAliases: false, fileName: 'Lab reports.zip' });

    // one sample per site and day, with Linnaeus's pH beside ALS's chemistry
    const samples = await db.samples.where('projectId').equals(project.id).toArray();
    expect(samples).toHaveLength(3);
    const res = await db.results.where('projectId').equals(project.id).toArray();
    const at = (site: number) => Object.fromEntries(res.filter((r) => r.siteId === sites[site].id).map((r) => [r.parameterId, `${r.qualifier}${r.value}`]));
    expect(at(0)).toEqual({ ph: '7.4', cl: '12.3', 'nh4-n': '<0.01', 'zn-d': '0.004', 'zn-t': '0.009' });
    expect(at(1)).toEqual({ ph: '6.9', ec: '412', 'no3-n': '1.25', tn: '2.1' });
    expect(at(2)).toEqual({ ph: '7.1', naphthalene: '<0.0005' });
    expect(samples.find((s) => s.siteId === sites[0].id)?.labName).toBe('Linnaeus');
  });

  it('reads the same lab file sent twice (CSV and Excel) once, and drops footnote marks from test names', async () => {
    const a = file('als-csv-simple-synthetic.csv');
    const read = await readImportFiles([a, { ...a, name: 'copy of the same.csv' }]);
    const { plans, notes } = defaultPlans(read.grids, read.context, buildParamIndex(await db.parameters.toArray()));
    expect(plans.map((p) => p.mode)).toEqual(['export', 'skip']);
    expect(notes).toEqual(['copy of the same.csv: the same results as als-csv-simple-synthetic.csv, so they’re read once.'.replace('’', "'")]);
    const rep = readLabPdf([LINNAEUS_PAGE.map((x) => (x.str === 'pH - Water' ? { ...x, str: 'pH - Water*' } : x))])!;
    expect(new Set(rep.results.map((r) => r.analyte))).toEqual(new Set(['Conductivity (25°C)', 'pH - Water']));
  });

  it('puts parameters added from lab files in a sensible group', () => {
    expect(guessGroup('4,4-DDT')).toBe('Pesticides');
    expect(guessGroup('gamma-BHC (Lindane)')).toBe('Pesticides');
    expect(guessGroup('Benzo(g,h,i)perylene')).toBe('Hydrocarbons');
    expect(guessGroup('Benzo(a)pyrene TEQ (LOR)')).toBe('Hydrocarbons');
    expect(guessGroup('Bis(2-ethylhexyl)phthalate')).toBe('Other organics');
    expect(guessGroup('2,4-Dichlorophenol')).toBe('Other organics');
    expect(guessGroup('Isophorone', 'Semi-Volatile Organic Compounds - Water by GCMS')).toBe('Other organics');
    expect(guessGroup('PFHxA')).toBe('PFAS');
    expect(guessGroup('Lithium')).toBe('Other');
  });
});
