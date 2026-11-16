import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { db, ensureBuiltIns } from '../src/db/db';
import { addParameterAlias, createParameter, ensureTwin, newProject, newSite, saveProject, saveSite } from '../src/db/repo';
import type { Parameter } from '../src/db/types';
import { accountFor } from '../src/importers/account';
import { commitImport } from '../src/importers/commit';
import { parseLabSheet } from '../src/importers/lab';
import { analyteMapKey, type ParsedImport } from '../src/importers/model';
import { readWorkbook } from '../src/importers/workbook';
import { depthText } from '../src/lib/depth';
import { matchSite } from '../src/lib/matching';
import { bareAnalyte, buildIndexes, matchAnalyte, matrixOf, twinOf } from '../src/lib/matrix';

const csvGrid = async (text: string, name = 'soil.csv') => (await readWorkbook(new TextEncoder().encode(text).buffer as ArrayBuffer, name))[0];
const all = () => db.parameters.toArray();
const byId = async (id: string) => (await db.parameters.get(id)) as Parameter;

beforeAll(async () => {
  await ensureBuiltIns();
});

describe('what a result was measured in', () => {
  it('per kilogram: a soil; a TCLP or SPLP test: its extract; else water', () => {
    expect(matrixOf('Arsenic', undefined, 'mg/kg dry wt')).toBe('soil');
    expect(matrixOf('Total Recoverable Lead', 'Heavy metals, screen level', 'mg/kg')).toBe('soil');
    expect(matrixOf('Benzo[a]pyrene', undefined, 'µg/kg')).toBe('soil');
    expect(matrixOf('TCLP Arsenic', undefined, 'g/m3')).toBe('tclp');
    expect(matrixOf('Arsenic', 'TCLP Extraction, Toxicity Characteristic Leaching Procedure', 'mg/L')).toBe('tclp');
    expect(matrixOf('Lead (SPLP)', undefined, 'mg/L')).toBe('splp');
    expect(matrixOf('Arsenic', 'Heavy metals, dissolved', 'g/m3')).toBeNull();
    expect(matrixOf('pH', undefined, 'pH Units')).toBeNull();
  });

  it('a name without the words that only say that', () => {
    expect(bareAnalyte('TCLP Arsenic')).toBe('Arsenic');
    expect(bareAnalyte('Arsenic (TCLP)')).toBe('Arsenic');
    expect(bareAnalyte('TCLP extractable Lead')).toBe('Lead');
    expect(bareAnalyte('Lead - TCLP')).toBe('Lead');
    expect(bareAnalyte('Total Recoverable Arsenic')).toBe('Total Recoverable Arsenic');
    expect(bareAnalyte('Lead in soil')).toBe('Lead');
    expect(bareAnalyte('Dry Matter')).toBe('Dry Matter');
  });

  it('the counterpart of a water parameter, as it’s added', async () => {
    const soil = twinOf(await byId('as-t'), 'soil');
    expect(soil).toMatchObject({ id: 'as-t-soil', name: 'Arsenic (soil)', short: 'As (soil)', group: 'Soil', unit: 'mg/kg', aliases: [], matrix: 'soil', of: 'as-t' });
    expect(twinOf(await byId('as-t'), 'tclp')).toMatchObject({ id: 'as-t-tclp', name: 'Arsenic (TCLP)', group: 'Leach tests', unit: 'mg/L', matrix: 'tclp', of: 'as-t' });
    expect(twinOf(await byId('bap'), 'soil')).toMatchObject({ id: 'bap-soil', name: 'Benzo[a]pyrene (soil)', short: 'BaP (soil)' });
  });
});

describe('a file’s analytes matched: soil never to water', () => {
  it('arsenic per kilogram has no parameter until its soil one is added – and the water one keeps its results and its names', async () => {
    let ix = buildIndexes(await all());
    // in water, as ever
    expect(matchAnalyte('Total Recoverable Arsenic', undefined, 'g/m3', ix).parameterId).toBe('as-t');
    expect(matchAnalyte('Dissolved Arsenic', undefined, 'g/m3', ix).parameterId).toBe('as-d');
    // in a soil: the one to add
    expect(matchAnalyte('Total Recoverable Arsenic', undefined, 'mg/kg dry wt', ix)).toMatchObject({ parameterId: null, twin: { matrix: 'soil', of: 'as-t' } });
    // a metal named without its fraction is the total, in a soil
    expect(matchAnalyte('Arsenic', undefined, 'mg/kg', ix)).toMatchObject({ parameterId: null, twin: { matrix: 'soil', of: 'as-t' } });
    expect(matchAnalyte('TCLP Lead', undefined, 'mg/L', ix)).toMatchObject({ parameterId: null, twin: { matrix: 'tclp', of: 'pb-t' } });
    // one nobody has heard of: a soil parameter under its own name
    expect(matchAnalyte('Dry Matter', undefined, 'g/100g', ix)).toMatchObject({ parameterId: null, twin: { matrix: 'soil' } });
    expect(matchAnalyte('Dry Matter', undefined, 'g/100g', ix).twin!.of).toBeUndefined();

    // added: found by both names from then on
    expect((await ensureTwin('as-t', 'soil'))!.id).toBe('as-t-soil');
    expect((await ensureTwin('as-t', 'soil'))!.id).toBe('as-t-soil'); // once
    expect((await all()).filter((p) => p.of === 'as-t' && p.matrix === 'soil')).toHaveLength(1);
    const dm = await createParameter('Dry Matter (soil)', 'g/100g', 'Soil', { matrix: 'soil', aliases: ['Dry Matter'] });
    ix = buildIndexes(await all());
    expect(matchAnalyte('Total Recoverable Arsenic', undefined, 'mg/kg dry wt', ix).parameterId).toBe('as-t-soil');
    expect(matchAnalyte('Arsenic', undefined, 'mg/kg', ix).parameterId).toBe('as-t-soil');
    expect(matchAnalyte('Dry Matter', undefined, 'g/100g', ix).parameterId).toBe(dm.id);
    // and water is untouched: the soil parameters aren't among the names a water file is matched to
    expect(matchAnalyte('Total Recoverable Arsenic', undefined, 'g/m3', ix).parameterId).toBe('as-t');
    expect(matchAnalyte('Arsenic (soil)', undefined, 'g/m3', ix).parameterId).not.toBe('as-t-soil');
    expect(matchAnalyte('Dry Matter', undefined, 'g/m3', ix).parameterId).toBeNull();
  });

  it('a name remembered for a soil parameter stays the water parameter’s too', async () => {
    const before = (await byId('as-t')).aliases;
    expect(before.map((a) => a.toLowerCase())).toContain('total recoverable arsenic');
    await addParameterAlias('as-t-soil', 'Total Recoverable Arsenic');
    expect((await byId('as-t-soil')).aliases).toContain('Total Recoverable Arsenic');
    expect((await byId('as-t')).aliases).toEqual(before);
    expect((await byId('as-t')).removedAliases ?? []).toEqual([]);
  });
});

describe('a lab’s soil results imported', () => {
  const FILE =
    ',"Sample Name:","TP1 0.1m 12-Mar-2026","TP1 0.5m 12-Mar-2026","TP1 1.0-1.2 m 12-Mar-2026","SS2 12-Mar-2026"\n' +
    ',"Lab Number:","9200001.1","9200001.2","9200001.3","9200001.4"\n' +
    '"Dry Matter","g/100g as rcvd","82","79","75","88"\n' +
    '"Heavy metals, screen level"\n' +
    '"Total Recoverable Arsenic","mg/kg dry wt","12","45","< 2","8"\n' +
    '"Total Recoverable Lead","mg/kg dry wt","230","1,100","18","35"\n' +
    '"TCLP Extraction"\n' +
    '"TCLP Lead","g/m3","-","2.4","-","-"\n';

  it('each depth is its own sample; the results go to soil and leach-test parameters', async () => {
    const project = newProject({ name: 'Old depot', code: 'CL-1' });
    await saveProject(project);
    const tp1 = newSite(project.id, { code: 'TP1', type: 'Soil' });
    const ss2 = newSite(project.id, { code: 'SS2', type: 'Soil', order: 1 });
    await saveSite(tp1);
    await saveSite(ss2);
    const parsed = parseLabSheet(await csvGrid(FILE)) as ParsedImport;
    expect(parsed.samples.map((s) => [s.siteText, s.date])).toEqual([['TP1 0.1m', '2026-03-12'], ['TP1 0.5m', '2026-03-12'], ['TP1 1.0-1.2 m', '2026-03-12'], ['SS2', '2026-03-12']]);
    const sites = [tp1, ss2];
    // the site is found whatever the depth after it
    const siteOf = Object.fromEntries(parsed.samples.map((s) => [s.key, matchSite(s.siteText, sites).siteId]));
    expect(Object.values(siteOf)).toEqual([tp1.id, tp1.id, tp1.id, ss2.id]);

    // the analytes: what's there, and what's to add
    let ix = buildIndexes(await all());
    const rows = new Map(parsed.samples.flatMap((s) => s.results.map((r) => [analyteMapKey(r), r] as const)));
    const mapping: Record<string, string | null> = {};
    for (const [key, r] of rows) {
      const m = matchAnalyte(r.analyte, r.group, r.unit, ix);
      mapping[key] = m.parameterId ?? (m.twin?.of ? (await ensureTwin(m.twin.of, m.twin.matrix))!.id : null);
    }
    ix = buildIndexes(await all());
    expect(Object.fromEntries([...rows].map(([key, r]) => [r.analyte, mapping[key]]))).toEqual({
      'Dry Matter': (await all()).find((p) => p.name === 'Dry Matter (soil)')!.id,
      'Total Recoverable Arsenic': 'as-t-soil',
      'Total Recoverable Lead': 'pb-t-soil',
      'TCLP Lead': 'pb-t-tclp',
    });

    const input = { sites: siteOf, dates: {}, include: {}, params: mapping, units: {} };
    // accounted for: three depths at TP1 are three samples, nothing twice
    const account = accountFor(parsed, input, { sites, params: new Map((await all()).map((p) => [p.id, p])), qcSites: new Set() });
    expect(account.read).toBe(13);
    expect(account.going).toBe(13);
    expect(account.lines).toEqual([]);

    const batch = await commitImport(project.id, parsed, input, { duplicates: 'replace', rememberAliases: true, fileName: 'soil.csv' });
    expect(batch.results).toBe(13);
    const samples = (await db.samples.where('projectId').equals(project.id).toArray()).sort((a, b) => (a.siteId === b.siteId ? (a.depth?.top ?? -1) - (b.depth?.top ?? -1) : a.siteId === tp1.id ? -1 : 1));
    expect(samples.map((s) => [s.siteId === tp1.id ? 'TP1' : 'SS2', depthText(s.depth)])).toEqual([['TP1', '0.1 m'], ['TP1', '0.5 m'], ['TP1', '1.0–1.2 m'], ['SS2', '']]);
    const res = await db.results.where('projectId').equals(project.id).toArray();
    const at = (i: number) => Object.fromEntries(res.filter((r) => r.sampleId === samples[i].id).map((r) => [r.parameterId, `${r.qualifier}${r.value} ${r.unit}`]));
    expect(at(1)).toMatchObject({ 'as-t-soil': '45 mg/kg dry wt', 'pb-t-soil': '1100 mg/kg dry wt', 'pb-t-tclp': '2.4 g/m3' });
    expect(at(2)).toMatchObject({ 'as-t-soil': '<2 mg/kg dry wt', 'pb-t-soil': '18 mg/kg dry wt' });
    expect(Object.keys(at(0))).not.toContain('pb-t-tclp');
    // nothing went to a water parameter; the site remembers no name with a depth in it
    expect(res.some((r) => ['as-t', 'pb-t', 'as-d', 'pb-d'].includes(r.parameterId))).toBe(false);
    expect((await db.sites.get(tp1.id))!.aliases).toEqual([]);
    expect((await byId('pb-t')).aliases.map((a) => a.toLowerCase())).toContain('total recoverable lead');

    // the same file again: the same samples, their results replaced – not a second set
    const again = await commitImport(project.id, parsed, input, { duplicates: 'replace', rememberAliases: true, fileName: 'soil.csv' });
    expect(again.newSamples).toBe(0);
    expect(again.replaced).toBe(13);
    expect(await db.samples.where('projectId').equals(project.id).count()).toBe(4);
    expect(await db.results.where('projectId').equals(project.id).count()).toBe(13);
  });

  it('at a water site a depth in the name is no part of the sample: one a day, as before', async () => {
    const project = newProject({ name: 'A bore', code: 'GW-9' });
    await saveProject(project);
    const bh = newSite(project.id, { code: 'BH1', type: 'Groundwater' });
    await saveSite(bh);
    const parsed = parseLabSheet(await csvGrid(',"Sample Name:","BH1 12.5m 12-Mar-2026","BH1 20.0m 12-Mar-2026"\n,"Lab Number:","9300001.1","9300001.2"\n"pH","pH Units","7.1","7.3"\n'))!;
    const account = accountFor(parsed, { sites: Object.fromEntries(parsed.samples.map((s) => [s.key, bh.id])), dates: {}, include: {}, params: { [analyteMapKey(parsed.samples[0].results[0])]: 'ph' } }, { sites: [bh], params: new Map((await all()).map((p) => [p.id, p])), qcSites: new Set() });
    // two samples of one bore on one day: said, as it is for any water site
    expect(account.going).toBe(1);
    expect(account.clashes).toHaveLength(1);
  });
});
