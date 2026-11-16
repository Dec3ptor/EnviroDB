import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { db, ensureBuiltIns } from '../src/db/db';
import { newProject, newSchedule, newSite, saveProject, saveSite } from '../src/db/repo';
import type { Parameter, Result, Sample } from '../src/db/types';
import { accountFor, accountText, leftSummary } from '../src/importers/account';
import { commitImport } from '../src/importers/commit';
import { parseWithPlan } from '../src/importers/detect';
import { defaultPlans } from '../src/importers/files';
import { importContext, parseExport } from '../src/importers/labExports';
import { parseLabSheet } from '../src/importers/lab';
import { detectWide, parseWide } from '../src/importers/wide';
import { parseDateAny } from '../src/lib/dates';
import { analyteMapKey, type ParsedImport, type RawSample } from '../src/importers/model';
import { pdfReportGrid, readLabPdf, type PdfWord } from '../src/importers/pdfTables';
import { readWorkbook } from '../src/importers/workbook';
import { buildParamIndex, matchParameter } from '../src/lib/matching';
import { measuredAs, roundGaps } from '../src/lib/schedule';
import { parseValue } from '../src/lib/values';

const csvGrid = async (text: string, name = 'file.csv') => (await readWorkbook(new TextEncoder().encode(text).buffer as ArrayBuffer, name))[0];
let params: Parameter[];
beforeAll(async () => {
  await ensureBuiltIns();
  params = await db.parameters.toArray();
});

// ------------------------------------------------------------ what a result cell says

describe('reading a result', () => {
  const v = (x: unknown) => {
    const p = parseValue(x);
    return p.missing ? (p.unread ? 'unread' : 'none') : `${p.qualifier}${p.value}${p.unit ? ` ${p.unit}` : ''}`;
  };

  it('a number with its unit written after it, or the temperature it was read at', () => {
    expect(v('7.4 pH Units')).toBe('7.4 pH');
    expect(v('412 µS/cm')).toBe('412 µS/cm');
    expect(v('12 g/m3')).toBe('12 g/m³');
    expect(v('0.5mg/L')).toBe('0.5 mg/L');
    expect(v('<0.5 mg/L')).toBe('<0.5 mg/L');
    expect(v('5 %')).toBe('5 %');
    expect(v('7.4 @ 21°C')).toBe('7.4');
    expect(v('7.4 at 21.5 °C')).toBe('7.4');
    expect(v('7.4 (at 20°C)')).toBe('7.4');
    // the units column of a report run into its first result
    expect(v('pH Units 7.4')).toBe('7.4 pH');
    expect(v('g/m³ as CaCO₃ < 1')).toBe('<1 g/m³');
    // as before
    expect(v('< 0.0010')).toBe('<0.001');
    expect(v('>2420')).toBe('>2420');
    expect(v('0.5*')).toBe('0.5');
    expect(v('12 #1')).toBe('12');
    expect(v('0.03 J')).toBe('0.03');
    expect(v('1,200')).toBe('1200');
    expect(v('2.4E+3')).toBe('2400');
    expect(v(7.4)).toBe('7.4');
    expect(v('ND')).toBe('<null');
    expect(v('Not detected')).toBe('<null');
    expect(v('Not Detected (see note 2)')).toBe('<null');
    expect(v('Non-detect')).toBe('<null');
  });

  it('a space is part of a number only between thousands', () => {
    expect(v('1 200')).toBe('1200');
    expect(v('12 345.6')).toBe('12345.6');
    expect(v('- 0.5')).toBe('-0.5');
    // two readings side by side are not one number
    expect(v('7.4 6.9')).toBe('unread');
    expect(v('7 4')).toBe('unread');
  });

  it('no result, said – or something there that isn’t read: told apart', () => {
    for (const x of ['', '-', 'NS', 'n/a', 'Dry', 'No Result', 'Not Required', 'not sampled', 'Insufficient sample', 'See comments', '----', '****', 'Completed', 'N/R', 'pending', null, undefined]) expect(v(x), String(x)).toBe('none');
    // a date in a results column isn't a result, nor something missed
    expect(v('10/02/2026')).toBe('none');
    for (const x of ['TNTC', 'Present', '~7.4', 'approx 7', '7.4 est', '7,4', '7.4 or so', 'high']) expect(v(x), x).toBe('unread');
  });
});

describe('names that end with the temperature they’re reported at', () => {
  it('match the parameter', () => {
    const index = buildParamIndex(params);
    expect(matchParameter('pH at 25°C', index).parameterId).toBe('ph');
    expect(matchParameter('pH @ 25 °C', index).parameterId).toBe('ph');
    expect(matchParameter('Electrical Conductivity @ 25°C', index).parameterId).toBe('ec');
    expect(matchParameter('pH - Water', index).parameterId).toBe('ph');
    // and with what they were measured in
    expect(matchParameter('Conductivity (25°C) - Water', index).parameterId).toBe('ec');
    expect(matchParameter('Chloride in Water', index).parameterId).toBe('cl');
    expect(matchParameter('pH - Soil', index).parameterId).toBeNull();
  });
});

// ------------------------------------------------------------ PDF reports

const w = (str: string, x: number, y: number, width = str.length * 3.6, h = 7): PdfWord => ({ str, x, y, w: width, h });
const LINNAEUS_HEAD: PdfWord[] = [
  w('Analysis Report', 234, 723, 114, 15),
  w('Units', 191.3, 513, 22.6),
  w('2026000101', 244.6, 532.6, 55.4),
  w('Upstream Bridge', 241, 521.1, 63),
  w('2026000102', 325.1, 537.6, 55.4),
  w('Pond', 342, 526.1, 22),
  w('Outlet', 339, 514.6, 28),
  w('10/02/2026', 247.4, 504.2, 49.9),
  w('9:30', 262.6, 492.7, 19.3),
  w('10/02/2026', 327.9, 504.2, 49.9),
  w('10:15', 340.4, 492.7, 25),
  w('Test', 95.3, 476.4, 20.5),
];
const LINNAEUS_FOOT = w('Linnaeus, PO Box 1, Exampletown', 194, 72.5, 200);
const read = (...pages: PdfWord[][]) => {
  const rep = readLabPdf(pages)!;
  return { results: rep.results.map((r) => `${r.labNumber}|${r.analyte}|${r.unit ?? ''}|${r.value}`), left: rep.left };
};

describe('a lab’s PDF report: a row whose results aren’t on the line of its test', () => {
  it('a test with no unit – pH – is read when its results sit a little off its line', () => {
    // (a test with a unit was read before, by its unit on the results’ line; pH has none, and was dropped)
    const got = read([...LINNAEUS_HEAD, LINNAEUS_FOOT, w('Conductivity (25°C)', 39.7, 440.1, 86.1), w('μS/cm', 188.4, 437, 28.4), w('388', 264, 437, 16), w('412', 344.7, 437, 16), w('pH - Water', 39.7, 422.6, 48.2), w('7.4', 265.4, 419.5, 13.8), w('6.9', 345.9, 419.5, 13.8)]);
    expect(got.results).toEqual(['2026000101|Conductivity (25°C)|µS/cm|388', '2026000102|Conductivity (25°C)|µS/cm|412', '2026000101|pH - Water||7.4', '2026000102|pH - Water||6.9']);
    expect(got.left).toEqual([]);
  });

  it('a test’s name wrapped onto two lines, its results centred between them', () => {
    const got = read([
      ...LINNAEUS_HEAD,
      LINNAEUS_FOOT,
      w('Conductivity (25°C)', 39.7, 445.8, 86.1),
      w('- Water at site', 39.7, 434.3, 60),
      w('μS/cm', 188.4, 440.1, 28.4),
      w('388', 264, 440.1, 16),
      w('412', 344.7, 440.1, 16),
      w('pH - Water', 39.7, 418, 48.2),
      w('(on receipt)', 39.7, 406.5, 50),
      w('7.4', 265.4, 412.2, 13.8),
      w('6.9', 345.9, 412.2, 13.8),
    ]);
    expect(got.results).toEqual(['2026000101|Conductivity (25°C) - Water at site|µS/cm|388', '2026000102|Conductivity (25°C) - Water at site|µS/cm|412', '2026000101|pH - Water (on receipt)||7.4', '2026000102|pH - Water (on receipt)||6.9']);
  });

  it('results with no test anywhere near are said, not dropped; what’s under the samples below the table is no part of it', () => {
    const got = read([
      ...LINNAEUS_HEAD,
      LINNAEUS_FOOT,
      w('Conductivity (25°C)', 39.7, 440, 86.1),
      w('μS/cm', 188.4, 440, 28.4),
      w('388', 264, 440, 16),
      w('8.1', 265.4, 420, 13.8), // a result, and nothing to say what of
      w('pH - Water', 39.7, 400, 48.2),
      w('7.4', 265.4, 400, 13.8),
      w('6.9', 345.9, 400, 13.8),
      // under the table: a page number in the middle of the page, a footer with words across it
      w('2', 270, 200, 5),
      w('Tested at', 39.7, 180, 40),
      w('Exampletown', 250, 180, 50),
      w('Page 1 of 2', 340, 180, 45),
    ]);
    expect(got.results).toEqual(['2026000101|Conductivity (25°C)|µS/cm|388', '2026000101|pH - Water||7.4', '2026000102|pH - Water||6.9']);
    expect(got.left).toEqual([{ sample: '2026000101', text: '8.1', why: 'no-test' }]);
  });

  it('a result in words inside the table is passed on, to be shown as not read', () => {
    const rep = readLabPdf([[...LINNAEUS_HEAD, LINNAEUS_FOOT, w('Appearance', 39.7, 440, 48), w('Clear', 262, 440, 20), w('Turbid', 342, 440, 24), w('pH - Water', 39.7, 420, 48.2), w('7.4', 265.4, 420, 13.8)]])!;
    expect(rep.results.map((r) => `${r.analyte}=${r.value}`)).toEqual(['Appearance=Clear', 'Appearance=Turbid', 'pH - Water=7.4']);
    const p = parseExport(pdfReportGrid(rep, 'l.pdf'))!;
    expect(p.samples.flatMap((s) => s.results.map((r) => r.analyte))).toEqual(['pH - Water']);
    expect(p.left!.map((x) => [x.sample, x.analyte, x.text, x.why])).toEqual([['Upstream Bridge', 'Appearance', 'Clear', 'unreadable'], ['Pond Outlet', 'Appearance', 'Turbid', 'unreadable']]);
  });

  it('two numbers under one sample are said – never run together into one', () => {
    const got = read([...LINNAEUS_HEAD, LINNAEUS_FOOT, w('Conductivity (25°C)', 39.7, 440, 86.1), w('μS/cm', 188.4, 440, 28.4), w('388', 250, 440, 16), w('412', 280, 440, 16), w('520', 344.7, 440, 16)]);
    expect(got.results).toEqual(['2026000102|Conductivity (25°C)|µS/cm|520']);
    expect(got.left).toEqual([{ sample: '2026000101', analyte: 'Conductivity (25°C)', text: '388 412', why: 'two-values' }]);
    // and the sheet made of the report carries it, with the sample's name
    const rep = readLabPdf([[...LINNAEUS_HEAD, LINNAEUS_FOOT, w('Conductivity (25°C)', 39.7, 440, 86.1), w('388', 250, 440, 16), w('412', 280, 440, 16)]])!;
    expect(pdfReportGrid(rep, 'l.pdf').left).toEqual([{ sample: 'Upstream Bridge', analyte: 'Conductivity (25°C)', text: '388 412', why: 'two-values' }]);
  });

  it('a page the results run on to is read though it doesn’t name the lab again', () => {
    const second = [...LINNAEUS_HEAD.map((x) => (x.str === '2026000101' ? { ...x, str: '2026000103' } : x.str === '2026000102' ? { ...x, str: '2026000104' } : x)), w('pH - Water', 39.7, 440, 48.2), w('7.0', 265.4, 440, 13.8), w('7.2', 345.9, 440, 13.8)];
    const got = read([...LINNAEUS_HEAD, LINNAEUS_FOOT, w('pH - Water', 39.7, 440, 48.2), w('7.4', 265.4, 440, 13.8), w('6.9', 345.9, 440, 13.8)], second);
    expect(got.results).toEqual(['2026000101|pH - Water||7.4', '2026000102|pH - Water||6.9', '2026000103|pH - Water||7.0', '2026000104|pH - Water||7.2']);
    // on its own, a page that never names a lab isn't a report this knows
    expect(readLabPdf([second])).toBeNull();
  });

  it('a wide unit running on under the first sample stays the unit, on a certificate with few samples', () => {
    const hill = (cols: number[]): PdfWord[] => [w('Certificate of Analysis', 48.5, 730.8, 188, 18), w('Sample Name:', 147.6, 602.6, 62), ...cols.flatMap((x, i) => [w(`DS${i + 1} 10-Feb-2026 9:${10 + i} am`, x - 40, 603.8, 80), w(`4100000.${i + 1}`, x - 19, 582.2, 38)]), w('Lab Number:', 154.6, 581.5, 55.5)];
    const row = (name: string, unit: string, y: number, cols: number[], vals: string[], unitW: number): PdfWord[] => [w(name, 46.3, y, name.length * 4.2), w(unit, 193.9, y, unitW), ...cols.flatMap((x, i) => [w(vals[i], x - vals[i].length * 2.2, y, vals[i].length * 4.4)])];
    // one sample: its column takes in the end of the units column
    const one = read([...hill([263]), ...row('pH', 'pH Units', 570, [263], ['7.1'], 34), ...row('Total Alkalinity', 'g/m³ as CaCO₃', 558, [263], ['71'], 44), w("Analyst's Comments", 46, 500, 80)]);
    expect(one.results).toEqual(['4100000.1|pH|pH Units|7.1', '4100000.1|Total Alkalinity|g/m³ as CaCO₃|71']);
    // even where the unit reaches under the sample's number, the result is read with it
    const over = read([...hill([263]), ...row('Total Alkalinity', 'g/m³ as CaCO₃', 558, [263], ['71'], 62), w("Analyst's Comments", 46, 500, 80)]);
    expect(over.results).toEqual(['4100000.1|Total Alkalinity||g/m³ as CaCO₃ 71']);
    expect(parseValue('g/m³ as CaCO₃ 71').value).toBe(71);
  });
});

// ------------------------------------------------------------ lab files

describe('lab files: what isn’t a result is kept to be shown', () => {
  it('an ALS file: a count too high to number is listed with its sample and test', async () => {
    const g = await csvGrid(
      'LabSampleReference,ClientSampleReference,SampleDate,AnalyteReference,AnalyteDescription,NumericResult,TextResult,Unit\n' +
        'NH2600005001,2026000501 - Pond Outlet,2026-03-10 09:30,MICRO_EC,Escherichia coli,,TNTC,cfu/100mL\n' +
        'NH2600005001,2026000501 - Pond Outlet,2026-03-10 09:30,INORG_PH,pH,7.6,7.6 pH Units,\n' +
        'NH2600005001,2026000501 - Pond Outlet,2026-03-10 09:30,INORG_TSS,Total Suspended Solids,,----,g/m3\n',
    );
    const p = parseExport(g)!;
    expect(p.samples[0].results.map((r) => [r.analyte, r.parsed.value, r.unit])).toEqual([['pH', 7.6, 'pH']]);
    expect(p.left).toEqual([{ sheet: g.name, sample: '2026000501 - Pond Outlet', analyte: 'Escherichia coli', text: 'TNTC', why: 'unreadable' }]);
  });

  it('an ESdat file: a result in % is a result unless it’s a surrogate’s recovery', async () => {
    const g = await csvGrid(
      'SampleCode,ChemCode,OriginalChemName,Prefix,Result,Result_Unit,Total_or_Filtered,Result_Type\n' +
        'NH2600006001,MOIST,Moisture Content,,12.5,%,T,REG\n' +
        'NH2600006001,2037-26-5,Toluene-D8,,98,%,T,REG\n' +
        'NH2600006001,460-00-4,4-Bromofluorobenzene,,101,%,T,SUR\n' +
        'NH2600006001,16887-00-6,Chloride,,45.2,g/m3,F,REG\n',
    );
    const p = parseExport(g)!;
    expect(p.samples[0].results.map((r) => r.analyte)).toEqual(['Moisture Content', 'Chloride']);
    expect(p.warnings.join(' ')).toMatch(/Left out 2 surrogate recoveries/);
  });

  it('a Hill results sheet: a cell that says something else is listed', async () => {
    const g = await csvGrid(',"Sample Name:","DP1 28-Sept-2026 9:40 am","DS1 28-Sept-2026 10:18 am"\n,"Lab Number:","9100001.1","9100001.2"\n"pH","pH Units","7.1","7.3 approx"\n"Escherichia coli","MPN / 100mL","> 2,420","-"\n');
    const p = parseLabSheet(g)!;
    expect(p.samples.map((s) => s.results.map((r) => `${r.analyte}=${r.parsed.qualifier}${r.parsed.value}`))).toEqual([['pH=7.1', 'Escherichia coli=>2420'], []].filter((x) => x.length));
    expect(p.left).toEqual([{ sheet: g.name, sample: 'DS1 28-Sept-2026 10:18 am', analyte: 'pH', text: '7.3 approx', why: 'unreadable' }]);
  });
});

describe('rows that used to go without a word', () => {
  it('a Hill results sheet: a test whose name starts like a sample detail is a test; results with no test beside them are said', async () => {
    const g = await csvGrid(
      ',"Sample Name:","GW1 01-Oct-2026 11:45 am","GW2 01-Oct-2026 12:30 pm"\n,"Lab Number:","9100001.1","9100001.2"\n' +
        '"Depth to Water","m","2.31","4.02"\n"Depth","m","6","6"\n"pH","pH Units","6.4","6.6"\n,"g/m3","0.5","0.7"\n',
    );
    const p = parseLabSheet(g)!;
    // "Depth" alone is the sample's depth (a detail); "Depth to Water" is a result
    expect(p.samples[0].results.map((r) => `${r.analyte}=${r.parsed.value}`)).toEqual(['Depth to Water=2.31', 'pH=6.4']);
    expect(p.left).toEqual([
      { sheet: g.name, sample: 'GW1 01-Oct-2026 11:45 am', text: '0.5', why: 'no-test' },
      { sheet: g.name, sample: 'GW2 01-Oct-2026 12:30 pm', text: '0.7', why: 'no-test' },
    ]);
  });

  it('a date with the time written 0930 is a date', () => {
    expect(parseDateAny('10/02/2026 0930')).toBe('2026-02-10T09:30');
    expect(parseDateAny('10 Feb 2026 1415 hrs')).toBe('2026-02-10T14:15');
    expect(parseDateAny('10/02/2026 9:30')).toBe('2026-02-10T09:30');
    // not a time: a year, or a number that isn't on the clock
    expect(parseDateAny('10/02/2026 2575')).toBeNull();
  });

  it('a master sheet: a row of results whose date can’t be read is said, with what the date cell has', async () => {
    // (statistics rows under the data – "Median", "95th percentile" – are left out as before, without a word)
    const g = await csvGrid('Date,Site,pH,Zinc - Total (g/m3),Chloride (g/m3)\n10/02/2026,DS1,7.4,0.012,12\nearly March 2026,DS1,7.2,0.010,11\n10/04/2026,DS1,7.3,0.011,13\nMedian,,7.3,0.011,12\n95th percentile,,7.4,0.012,13\n');
    const { config } = detectWide(g, buildParamIndex(params));
    const p = parseWide(g, config);
    expect(p.samples.map((s) => s.date)).toEqual(['2026-02-10', '2026-04-10']);
    expect(p.warnings).toEqual(['1 row has results and a date that couldn’t be read (“early March 2026”) – it was left out. Put the date right in the file, or type the results into the Data tab.']);
  });
});

describe('a PDF report beside the lab’s spreadsheet', () => {
  const header = 'LabSampleReference,ClientSampleReference,SampleDate,AnalyteReference,AnalyteDescription,NumericResult,TextResult,Unit\n';
  const pdfGrid = () => {
    const rep = {
      lab: 'ALS',
      samples: [{ labNumber: 'NH2600007-001', clientRef: '2026000701 - Pond Outlet', date: '2026-03-10T09:30' }],
      results: [
        { labNumber: 'NH2600007-001', analyte: 'Chloride', group: 'Anions by Ion Chromatography', unit: 'g/m3', value: '45.2' },
        { labNumber: 'NH2600007-001', analyte: 'pH', group: 'pH by PC Titrator', unit: 'pH Unit', value: '7.6' },
        { labNumber: 'NH2600007-001', analyte: 'Zinc', group: 'Elements in Water (Soluble)', unit: 'g/m3', value: '0.012' },
        { labNumber: 'NH2600007-001', analyte: 'Zinc', group: 'Elements in Water (Total)', unit: 'g/m3', value: '0.020' },
      ],
      left: [],
    };
    return { ...pdfReportGrid(rep, 'als.pdf'), file: 'als.pdf' };
  };

  it('with every result of the PDF: the PDF is left out, as before', async () => {
    const sheet = { ...(await csvGrid(`${header}NH2600007001,2026000701 - Pond Outlet,2026-03-10 09:30,ANIONS_WS_CL,Chloride,45.2,45.2,g/m3\nNH2600007001,2026000701 - Pond Outlet,2026-03-10 09:30,INORG_PH,pH,7.6,7.6,pH Unit\nNH2600007001,2026000701 - Pond Outlet,2026-03-10 09:30,ICPM_WS_ZN,Zinc,0.012,0.012,g/m3\nNH2600007001,2026000701 - Pond Outlet,2026-03-10 09:30,ICPM_WT_ZN,Zinc,0.020,0.020,g/m3\n`, 'als.csv')), file: 'als.csv' };
    const grids = [sheet, pdfGrid()];
    const { plans, notes } = defaultPlans(grids, importContext(grids), buildParamIndex(params));
    expect(plans.map((p) => p.mode)).toEqual(['export', 'skip']);
    expect(notes[0]).toMatch(/als\.pdf: the same results are in als\.csv/);
  });

  it('without some: those are read from the PDF, the rest from the spreadsheet', async () => {
    // the spreadsheet has the sample, and not its pH or its total zinc
    const sheet = { ...(await csvGrid(`${header}NH2600007001,2026000701 - Pond Outlet,2026-03-10 09:30,ANIONS_WS_CL,Chloride,45.2,45.2,g/m3\nNH2600007001,2026000701 - Pond Outlet,2026-03-10 09:30,ICPM_WS_ZN,Zinc,0.012,0.012,g/m3\n`, 'als.csv')), name: 'als.csv', file: 'als.csv' };
    const grids = [sheet, pdfGrid()];
    const ctx = importContext(grids);
    const { plans, notes } = defaultPlans(grids, ctx, buildParamIndex(params));
    expect(plans.map((p) => p.mode)).toEqual(['export', 'export']);
    expect(notes[0]).toBe('als.pdf: 2 results aren’t in als.csv – pH, Zinc – so they’re read from the PDF; the rest are taken from als.csv.');
    const parsed = parseWithPlan(grids, plans, ctx);
    const all = parsed.samples.flatMap((s) => s.results.map((r) => `${s.sheet}|${r.analyte}|${r.group ?? ''}|${r.parsed.value}`));
    expect(all).toEqual(['als.csv|Chloride|Dissolved|45.2', 'als.csv|Zinc|Dissolved|0.012', 'als.pdf|pH|pH by PC Titrator|7.6', 'als.pdf|Zinc|Elements in Water (Total)|0.02']);
  });
});

// ------------------------------------------------------------ every result accounted for

describe('a file’s results accounted for before the import', () => {
  const result = (analyte: string, value: number | string, unit = 'g/m3') => ({ analyte, unit, raw: value, parsed: parseValue(value) });
  const sample = (key: string, name: string, date: string | undefined, results: ReturnType<typeof result>[]): RawSample => ({ key, sampleName: name, siteText: name, date, dateSource: date ? 'cell' : 'none', sheet: 'f', results });
  const site = (id: string, code: string, type = 'Surface water') => ({ id, projectId: 'p', code, type, role: '', aliases: [], active: true, order: 0 }) as never;
  const paramMap = () => new Map(params.map((p) => [p.id, p]));
  const map = (...pairs: Array<[string, string, string | null]>) => Object.fromEntries(pairs.map(([analyte, unit, pid]) => [analyteMapKey({ analyte, unit }), pid]));

  it('what goes in, and for each that doesn’t, why', () => {
    const parsed: ParsedImport = {
      kind: 'lab',
      warnings: [],
      samples: [
        sample('a', 'DS1', '2026-03-10', [result('pH', 7.4, 'pH'), result('Zinc', 0.012), result('Mystery', 3)]),
        sample('b', 'Elsewhere', '2026-03-10', [result('pH', 7.1, 'pH'), result('Zinc', 0.02)]),
        sample('c', 'US1', undefined, [result('pH', 7.0, 'pH')]),
        sample('d', 'US1 old', '2026-03-10', [result('pH', 6.8, 'pH')]),
      ],
      left: [{ sheet: 'f', sample: 'DS1', analyte: 'E. coli', text: 'TNTC', why: 'unreadable' }, { sheet: 'f', sample: 'US1', analyte: 'E. coli', text: 'tntc', why: 'unreadable' }],
    };
    const a = accountFor(parsed, { sites: { a: 's1', b: null, c: 's2', d: 's2' }, dates: {}, include: { d: false }, params: map(['pH', 'pH', 'ph'], ['Zinc', 'g/m3', 'zn-d'], ['Mystery', 'g/m3', null]) }, { sites: [site('s1', 'DS1'), site('s2', 'US1')], params: paramMap(), qcSites: new Set() });
    expect(a.read).toBe(7);
    expect(a.going).toBe(2);
    expect(a.lines.map((l) => [l.why, l.n, l.items])).toEqual([
      ['no-parameter', 1, ['Mystery']],
      ['no-site', 2, ['Elsewhere']],
      ['no-date', 1, ['US1']],
      ['unticked', 1, ['US1 old']],
    ]);
    expect(a.lines.map(accountText)).toEqual([
      '1 result for an analyte not matched to a parameter: Mystery',
      '2 results of a sample with no site chosen: Elsewhere',
      '1 result of a sample with no date: US1',
      '1 result of a sample you left out: US1 old',
    ]);
    // read = going in + every line: nothing unaccounted for
    expect(a.going + a.lines.reduce((n, l) => n + l.n, 0)).toBe(a.read);
    expect(leftSummary(a.left)).toEqual([{ text: 'TNTC', n: 2, why: 'unreadable', where: ['DS1 – E. coli', 'US1 – E. coli'] }]);
  });

  it('one sample and parameter in the file twice: the later is kept, and it’s said – which, where the values differ', () => {
    const parsed: ParsedImport = {
      kind: 'lab',
      warnings: [],
      samples: [
        // two labs' pH for one sample; two analytes matched to one parameter; and a result that's simply there twice
        sample('a', 'DS1 (Linnaeus)', '2026-03-10T09:30', [result('pH - Water', 7.4, 'pH'), result('Zinc', 0.012), result('Chloride', 12)]),
        sample('b', 'DS1 (ALS)', '2026-03-10T09:35', [result('pH', 7.6, 'pH'), result('Zinc Soluble', 12, 'µg/L'), result('Chloride', 12)]),
      ],
    };
    const mapping = { sites: { a: 's1', b: 's1' }, dates: {}, include: {}, params: map(['pH - Water', 'pH', 'ph'], ['pH', 'pH', 'ph'], ['Zinc', 'g/m3', 'zn-d'], ['Zinc Soluble', 'µg/L', 'zn-d'], ['Chloride', 'g/m3', 'cl']) };
    const ctx = { sites: [site('s1', 'DS1')], params: paramMap(), qcSites: new Set<string>() };
    const a = accountFor(parsed, mapping, ctx);
    expect(a.read).toBe(6);
    expect(a.going).toBe(3);
    // zinc 0.012 g/m³ and 12 µg/L are the same result; so are the two chlorides
    expect(a.repeats).toBe(2);
    expect(a.clashes).toEqual([{ site: 'DS1', day: '2026-03-10', parameter: 'pH', kept: '7.6', dropped: '7.4', from: ['DS1 (ALS) – pH', 'DS1 (Linnaeus) – pH - Water'] }]);
    expect(a.merged).toEqual([{ site: 'DS1', day: '2026-03-10', names: ['DS1 (Linnaeus)', 'DS1 (ALS)'] }]);
    expect(accountText(a.lines[0])).toBe('3 results in the file twice for one sample and parameter – the later is kept: DS1 10 Mar 2026: pH');
    expect(a.going + a.lines.reduce((n, l) => n + l.n, 0)).toBe(a.read);
    // kept beside each other when that's asked for: nothing replaces anything
    expect(accountFor(parsed, mapping, { ...ctx, keepBoth: true }).going).toBe(6);
    // at a quality control site each sample is its own
    const qc = accountFor(parsed, mapping, { sites: [site('s1', 'DUP', 'Quality control')], params: paramMap(), qcSites: new Set(['s1']) });
    expect(qc.going).toBe(6);
    expect(qc.clashes).toEqual([]);
  });

  it('the import keeps what the file had that didn’t go in, for its history', async () => {
    const project = newProject({ name: 'Accounted' });
    await saveProject(project);
    const s = newSite(project.id, { code: 'DS1' });
    await saveSite(s);
    const parsed: ParsedImport = { kind: 'lab', warnings: [], samples: [sample('a', 'DS1', '2026-03-10', [result('pH', 7.4, 'pH')])] };
    const batch = await commitImport(project.id, parsed, { sites: { a: s.id }, dates: {}, include: {}, params: map(['pH', 'pH', 'ph']), units: {} }, { duplicates: 'replace', rememberAliases: false, fileName: 'x.csv', leftOut: ['1 result for an analyte not matched to a parameter: Mystery'] });
    expect(batch.results).toBe(1);
    expect((await db.imports.get(batch.id))!.notes).toBe('Not imported from the file – 1 result for an analyte not matched to a parameter: Mystery.');
  });
});

// ------------------------------------------------------------ what a round is missing

describe('a round isn’t missing a measurement it has the other way', () => {
  it('pH scheduled from the lab is there when the meter read it on site – and the other way round', () => {
    expect(measuredAs('ph')).toEqual(['ph', 'ph-field']);
    expect(measuredAs('ec-field')).toEqual(['ec-field', 'ec']);
    const sch = newSchedule('p', { name: 'Monthly', siteIds: ['s1', 's2'], parameterIds: ['ph', 'ec-field', 'zn-d'], every: 1, unit: 'month', startDate: '2026-01-01' });
    const samples = [{ id: 'a', projectId: 'p', siteId: 's1', date: '2026-03-10' }, { id: 'b', projectId: 'p', siteId: 's2', date: '2026-03-10' }] as Sample[];
    const res = (sampleId: string, parameterId: string) => ({ id: `${sampleId}${parameterId}`, sampleId, parameterId, value: 1, qualifier: '' }) as unknown as Result;
    const results: Record<string, Result[]> = { a: [res('a', 'ph-field'), res('a', 'ec'), res('a', 'zn-d')], b: [res('b', 'ph'), res('b', 'zn-d')] };
    const g = roundGaps(sch, { start: '2026-03-01', end: '2026-03-31' }, samples, (id) => results[id] ?? [], () => true);
    // s1 has field pH for the lab pH asked for, and lab EC for the field EC: nothing missing. s2 has no EC of either kind
    expect(g.complete).toEqual(['s1']);
    expect(g.incomplete.map((x) => [x.siteId, x.missing])).toEqual([['s2', ['ec-field']]]);
  });
});
