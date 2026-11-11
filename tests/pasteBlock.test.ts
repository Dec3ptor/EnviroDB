import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { db, ensureBuiltIns } from '../src/db/db';
import { addSample, setCellValues } from '../src/db/edits';
import { newProject, newSite, saveProject, saveSite } from '../src/db/repo';
import { isBlock, parseBlock, pasteSummary, planPaste, type PasteTarget } from '../src/lib/pasteBlock';

describe('cells copied from a spreadsheet', () => {
  it('rows of tab-separated cells; the empty line at the end is dropped', () => {
    expect(parseBlock('1\t2\t3\r\n4\t5\t6\r\n')).toEqual([['1', '2', '3'], ['4', '5', '6']]);
    expect(parseBlock('12.5\n')).toEqual([['12.5']]);
    expect(parseBlock('  7.1 \t <0.005\n\n8\t\n')).toEqual([['7.1', '<0.005'], [''], ['8', '']]);
    expect(parseBlock('')).toEqual([]);
    expect(parseBlock('\n\n')).toEqual([]);
    // a cell left empty keeps its place
    expect(parseBlock('1\t\t3')).toEqual([['1', '', '3']]);
  });

  it('a quoted cell may hold tabs, line breaks and quotes', () => {
    expect(parseBlock('"a\tb"\t2\n"line 1\nline 2"\t"say ""hi"""\n')).toEqual([['a\tb', '2'], ['line 1\nline 2', 'say "hi"']]);
    // a quote that isn't a cell's wrapping is kept as it is
    expect(parseBlock('5" pipe\t2')).toEqual([['5" pipe', '2']]);
    expect(parseBlock('"open\t2')).toEqual([['"open', '2']]);
  });

  it('one cell is typed in; more than one is a block', () => {
    expect(isBlock([['1']])).toBe(false);
    expect(isBlock([])).toBe(false);
    expect(isBlock([['1', '2']])).toBe(true);
    expect(isBlock([['1'], ['2']])).toBe(true);
  });
});

describe('what a paste does, before it does it', () => {
  // a table of 3 rows × 3 columns: some cells with values, one that can't be typed into
  const now: Record<string, string | undefined> = { '0:0': '7.1', '0:1': '<0.005', '1:0': '12', '2:2': '3' };
  const target = (r: number, c: number): PasteTarget<string> | null => (r > 2 || c > 2 ? null : { cell: `${r}:${c}`, current: now[`${r}:${c}`], blocked: r === 2 && c === 0, label: `R${r} C${c}` });

  it('adds where there’s nothing, changes where there’s something else; the same value is left', () => {
    const plan = planPaste([['7.10', '<0.005'], ['13', '0.4']], { row: 0, col: 0 }, target);
    expect(plan.adds).toEqual([{ cell: '1:1', label: 'R1 C1', text: '0.4' }]);
    expect(plan.changes).toEqual([{ cell: '1:0', label: 'R1 C0', text: '13', before: '12' }]);
    expect(plan.same).toBe(2);
    expect([plan.rows, plan.cols]).toEqual([2, 2]);
    expect(pasteSummary(plan)).toBe('1 value to add, 1 value to change – 2 cells already have their value');
  });

  it('below detection isn’t the same as the number; an empty cell leaves its value alone', () => {
    const plan = planPaste([['<7.1', ''], ['', '']], { row: 0, col: 0 }, target);
    expect(plan.changes).toEqual([{ cell: '0:0', label: 'R0 C0', text: '<7.1', before: '7.1' }]);
    expect(plan.adds).toEqual([]);
    expect(plan.same).toBe(0);
  });

  it('cells that aren’t values, fall off the table, or can’t be typed into are counted, not pasted', () => {
    const plan = planPaste([['n/a', 'abc', '1', '2'], ['5', '6', '7', '8']], { row: 1, col: 1 }, target);
    // (row 1: n/a → C1, abc → C2, the rest beyond the edge; row 2: 5 → C1, 6 → C2 (its own value 3), the rest beyond)
    expect(plan.invalid).toEqual(['n/a', 'abc']);
    expect(plan.outside).toBe(4);
    expect(plan.adds.map((a) => a.cell)).toEqual(['2:1']);
    expect(plan.changes.map((a) => [a.cell, a.before, a.text])).toEqual([['2:2', '3', '6']]);
    const blocked = planPaste([['9']], { row: 2, col: 0 }, target);
    expect(blocked).toMatchObject({ adds: [], changes: [], blocked: 1 });
    expect(pasteSummary(blocked)).toBe('Nothing to paste – 1 cell left out after a QA/QC check');
    expect(pasteSummary(plan)).toBe('1 value to add, 1 value to change – 2 cells aren’t values (n/a, abc); 4 cells beyond the table’s edge');
  });
});

describe('a block pasted into the Data tab', () => {
  let projectId = '';
  let siteId = '';
  beforeAll(async () => {
    await ensureBuiltIns();
    const p = newProject({ name: 'Paste', code: 'PA-1' });
    await saveProject(p);
    projectId = p.id;
    const s = newSite(projectId, { code: 'SW1' });
    await saveSite(s);
    siteId = s.id;
  });

  it('each cell as if typed – with one entry in the history and one Undo for them all', async () => {
    const a = (await addSample(projectId, siteId, '2026-10-02', 'SW1')).sample;
    const b = (await addSample(projectId, siteId, '2026-10-09', 'SW1')).sample;
    const turb = (await db.parameters.get('turbidity'))!;
    const tss = (await db.parameters.get('tss'))!;
    await db.results.put({ id: 'lab-9', projectId, sampleId: a.id, siteId, date: a.date, parameterId: 'tss', value: 8, qualifier: '', unit: tss.unit, importId: 'imp-x' });
    const before = (await db.audit.where('projectId').equals(projectId).toArray()).length;
    const change = await setCellValues(projectId, [
      { sample: a, param: turb, text: '12', siteCode: 'SW1' },
      { sample: a, param: tss, text: '9', siteCode: 'SW1' },
      { sample: b, param: turb, text: '<0.5', siteCode: 'SW1' },
      { sample: b, param: tss, text: '', siteCode: 'SW1' }, // empty: left alone
      { sample: b, param: tss, text: 'cloudy', siteCode: 'SW1' },
    ]);
    expect(change).toMatchObject({ added: 2, changed: 1, said: '3 values pasted: 2 added, 1 changed' });
    expect(change!.errors).toHaveLength(1);
    expect(change!.errors[0]).toMatch(/“cloudy” isn’t a value/);
    const results = await db.results.where('projectId').equals(projectId).toArray();
    expect(results.map((r) => [r.parameterId, r.qualifier, r.value]).sort()).toEqual([['tss', '', 9], ['turbidity', '', 12], ['turbidity', '<', 0.5]]);
    // the lab's value is kept on the result, as when it's typed over
    expect(await db.results.get('lab-9')).toMatchObject({ value: 9, importId: 'imp-x', edited: { was: '8' } });
    const history = (await db.audit.where('projectId').equals(projectId).toArray()).map((x) => x.text);
    expect(history.length).toBe(before + 1);
    expect(history.filter((t) => /^3 values pasted: 2 added, 1 changed – SW1 2 Oct 2026 Turbidity: 12 NTU added; /.test(t))).toHaveLength(1);

    await change!.undo();
    const back = await db.results.where('projectId').equals(projectId).toArray();
    expect(back.map((r) => [r.id, r.value])).toEqual([['lab-9', 8]]);
    expect((await db.results.get('lab-9'))!.edited).toBeUndefined();
    expect((await db.audit.where('projectId').equals(projectId).toArray()).map((x) => x.text)).toContain('Paste undone (3 values)');
  });

  it('nothing to change is nothing done; only mistakes says so', async () => {
    const a = (await db.samples.where('projectId').equals(projectId).toArray()).find((x) => x.date === '2026-10-02')!;
    const tss = (await db.parameters.get('tss'))!;
    expect(await setCellValues(projectId, [{ sample: a, param: tss, text: '8', siteCode: 'SW1' }])).toBeNull();
    expect(await setCellValues(projectId, [])).toBeNull();
    const bad = await setCellValues(projectId, [{ sample: a, param: tss, text: 'x', siteCode: 'SW1' }]);
    expect(bad).toMatchObject({ added: 0, changed: 0, said: 'Nothing pasted' });
    expect(bad!.errors).toHaveLength(1);
  });
});
