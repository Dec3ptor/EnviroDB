import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { db, ensureBuiltIns } from '../src/db/db';
import { createDemoProject } from '../src/db/demo';
import { addParameterAlias } from '../src/db/repo';
import { buildParamIndex, matchParameter } from '../src/lib/matching';
import { commitImport, type ImportMapping } from '../src/importers/commit';
import { analyteMapKey, type ParsedImport } from '../src/importers/model';
import { parseValue } from '../src/lib/values';
import { BUILT_IN_PARAMETERS } from '../src/data/parameters';
import { stableId } from '../src/lib/ids';
import { loadBundle } from './helpers';

const index = () => db.parameters.toArray().then(buildParamIndex);

beforeAll(async () => {
  // a library from before: "acid soluble zinc" was a name for total zinc
  const old = BUILT_IN_PARAMETERS.find((p) => p.id === 'zn-t')!;
  await db.parameters.put({ ...old, aliases: [...old.aliases, 'acid soluble zinc', 'zinc (acid soluble)'] });
  await ensureBuiltIns();
});

describe('metal fractions', () => {
  it('dissolved (also called soluble or filtered), acid soluble and total recoverable are told apart', async () => {
    const ix = await index();
    const m = (name: string, group?: string) => matchParameter(name, ix, group).parameterId;
    expect(m('Soluble Zinc')).toBe('zn-d');
    expect(m('Zinc (Soluble)')).toBe('zn-d');
    expect(m('Zn - soluble')).toBe('zn-d');
    expect(m('Dissolved Zinc')).toBe('zn-d');
    expect(m('Acid Soluble Zinc')).toBe('zn-as');
    expect(m('Zinc - Acid Soluble')).toBe('zn-as');
    expect(m('Zn (acid sol)')).toBe('zn-as');
    expect(m('Acid-soluble copper')).toBe('cu-as');
    expect(m('Total Recoverable Zinc')).toBe('zn-t');
    // a lab section heading decides a bare "Zinc" – "acid soluble" before "soluble"
    expect(m('Zinc', 'Heavy metals, acid soluble, trace')).toBe('zn-as');
    expect(m('Zinc', 'Elements in Water (Soluble)')).toBe('zn-d');
    expect(m('Zinc', 'Heavy metals, totals, trace')).toBe('zn-t');
  });

  it('a library from before loses the old names from total zinc, and gains the acid-soluble metals', async () => {
    const zt = (await db.parameters.get('zn-t'))!;
    expect(zt.aliases).not.toContain('acid soluble zinc');
    expect(zt.aliases).not.toContain('zinc (acid soluble)');
    expect(zt.aliases).toContain('total recoverable zinc');
    const zas = (await db.parameters.get('zn-as'))!;
    expect(zas).toMatchObject({ name: 'Acid Soluble Zinc', short: 'Zn (AS)', group: 'Metals (acid soluble)', unit: 'mg/L', builtIn: true });
    expect((await db.parameters.get('zn-d'))!.aliases).toContain('soluble zinc');
  });

  it('a name matched to another parameter goes with it – and stays there when EnviroDB updates its own names', async () => {
    // someone's lab calls total zinc "Zn Sol." – matched first to dissolved by mistake, then corrected
    await addParameterAlias('zn-d', 'Zn Sol.');
    await addParameterAlias('zn-t', 'Zn Sol.');
    expect((await db.parameters.get('zn-d'))!.aliases).not.toContain('Zn Sol.');
    expect(matchParameter('Zn Sol.', await index()).parameterId).toBe('zn-t');
    // a built-in name moved: it isn't put back on its old parameter
    await addParameterAlias('zn-as', 'soluble zinc');
    await ensureBuiltIns();
    expect((await db.parameters.get('zn-d'))!.aliases).not.toContain('soluble zinc');
    expect((await db.parameters.get('zn-d'))!.removedAliases).toContain('soluble zinc');
    expect(matchParameter('Soluble Zinc', await index()).parameterId).toBe('zn-as');
    // and back again
    await addParameterAlias('zn-d', 'soluble zinc');
    await ensureBuiltIns();
    expect((await db.parameters.get('zn-d'))!.removedAliases).toBeUndefined();
    expect(matchParameter('Soluble Zinc', await index()).parameterId).toBe('zn-d');
  });
});

describe('importing again over a file that went wrong', () => {
  it('clears out what earlier files put on those samples – field readings and results typed in stay', async () => {
    const projectId = await createDemoProject();
    const b = await loadBundle(projectId);
    const [s1, s2] = b.sites;
    const file = (analyte: string, values: number[]): ParsedImport => ({
      kind: 'lab',
      warnings: [],
      samples: [s1, s2].map((s, i) => ({ key: s.code, sampleName: s.code, siteText: s.code, date: '2026-09-01', sheet: 'x', results: [{ analyte, unit: 'mg/L', raw: values[i], parsed: parseValue(values[i]) }, { analyte: 'pH', unit: 'pH', raw: 7, parsed: parseValue(7) }] })),
    });
    const mapping = (parsed: ParsedImport, zinc: string): ImportMapping => ({
      sites: { [s1.code]: s1.id, [s2.code]: s2.id },
      dates: {},
      include: {},
      params: Object.fromEntries(parsed.samples.flatMap((x) => x.results.map((r) => [analyteMapKey(r), r.analyte === 'pH' ? 'ph' : zinc]))),
      units: {},
    });
    // the first file: "Soluble Zinc" matched to total zinc by mistake
    const first = file('Soluble Zinc', [0.05, 0.08]);
    await commitImport(projectId, first, mapping(first, 'zn-t'), { duplicates: 'replace', rememberAliases: false, fileName: 'first.csv' });
    const sample1 = stableId('s', projectId, s1.id, '2026-09-01');
    // a field reading and a result typed in on the same sample
    await db.results.bulkPut([
      { id: 'field-r', projectId, sampleId: sample1, siteId: s1.id, date: '2026-09-01', parameterId: 'temp', value: 14, qualifier: '', unit: '°C', importId: 'fieldbatch' },
      { id: 'typed-r', projectId, sampleId: sample1, siteId: s1.id, date: '2026-09-01', parameterId: 'do', value: 9, qualifier: '', unit: 'mg/L' },
    ]);
    await db.imports.put({ id: 'fieldbatch', projectId, fileName: 'phone', kind: 'field', importedAt: '2026-09-01T10:00:00Z', samples: 1, results: 1, skipped: 0, replaced: 0 });
    const pids = async (sampleId: string) => (await db.results.where('sampleId').equals(sampleId).toArray()).map((r) => r.parameterId).sort();
    expect(await pids(sample1)).toEqual(['do', 'ph', 'temp', 'zn-t']);

    const others = () => db.results.where('projectId').equals(projectId).filter((r) => ![sample1, stableId('s', projectId, s2.id, '2026-09-01')].includes(r.sampleId)).count();
    const othersBefore = await others();
    // imported again, matched right – without clearing, the wrong total zinc would stay beside it
    const again = file('Soluble Zinc', [0.05, 0.08]);
    const done = await commitImport(projectId, again, mapping(again, 'zn-d'), { duplicates: 'replace', clearEarlier: true, rememberAliases: false, fileName: 'again.csv' });
    expect(await pids(sample1)).toEqual(['do', 'ph', 'temp', 'zn-d']);
    expect(await pids(stableId('s', projectId, s2.id, '2026-09-01'))).toEqual(['ph', 'zn-d']);
    expect(done.cleared).toBe(2);
    expect(done.replaced).toBe(2); // pH, put again
    expect(done.notes).toMatch(/Cleared 2 earlier results on these samples first/);
    // other samples aren't touched
    expect(await others()).toBe(othersBefore);
    expect(othersBefore).toBeGreaterThan(100);
  });
});
