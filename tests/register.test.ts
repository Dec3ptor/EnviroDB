import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, db, ensureBuiltIns, saveSettings } from '../src/db/db';
import { createDemoProject } from '../src/db/demo';
import { BUILT_IN_TEMPLATES } from '../src/data/templates';
import { addFromText, clearGrade, fillFromProject, gradeCondition } from '../src/db/register';
import { autoStatus, compareRefs, guessKind, overallGrade, parseConditions, refOf, registerRows } from '../src/lib/register';
import { buildReport } from '../src/reports/build';
import type { DocNode } from '../src/reports/model';
import { loadBundle } from './helpers';

const CONSENT = `CONDITIONS
1. The consent holder shall operate the sediment pond in accordance with the approved Erosion and Sediment Control Plan.
2. The discharge shall not contain total suspended solids exceeding 100 g/m³ at any time.
   (a) Samples shall be taken monthly at the pond outlet.
3. The consent holder shall forward an annual monitoring report to the Council by 31 July each year.
8(a) The pH of the discharge shall be between 6.0 and 9.0.
Condition 12 – This consent shall lapse five years after the date of commencement.`;

describe('reading a consent’s conditions', () => {
  it('splits numbered conditions, keeping sub-clauses with them', () => {
    const c = parseConditions(CONSENT);
    expect(c.map((x) => x.ref)).toEqual(['1', '2', '3', '8(a)', '12']);
    expect(c[1].text).toContain('(a) Samples shall be taken monthly');
    expect(c[1].title).toBe('The discharge shall not contain total suspended solids exceeding 100 g/m³ at any time.');
    expect(c[4].title).toBe('This consent shall lapse five years after the date of commencement.');
  });
  it('guesses the kind, reads condition numbers and orders them', () => {
    expect(parseConditions(CONSENT).map((x) => guessKind(x.text))).toEqual(['management', 'limit', 'reporting', 'other', 'administrative']);
    expect(refOf('Condition 8(a)')).toBe('8(a)');
    expect(['10', '2', '8(b)', '8(a)'].sort(compareRefs)).toEqual(['2', '8(a)', '8(b)', '10']);
  });
});

describe('the register for the demo project', () => {
  let projectId: string;
  beforeAll(async () => {
    await ensureBuiltIns();
    await saveSettings({ author: 'R. Tester' });
    projectId = await createDemoProject();
  });
  const year = { start: '2025-07-01', end: '2026-06-30' };

  it('is made from the project’s rules, sampling and reports', async () => {
    const b = await loadBundle(projectId);
    const n = await fillFromProject(b, []);
    expect(n).toBeGreaterThan(3);
    const conds = await db.conditions.where('projectId').equals(projectId).toArray();
    expect(conds.find((c) => c.ref === '8(a)')?.kind).toBe('limit');
    expect(conds.some((c) => c.kind === 'monitoring' && c.scheduleIds?.length)).toBe(true);
    expect(conds.some((c) => c.kind === 'reporting' && c.obligationIds?.length)).toBe(true);
    // again: nothing new
    expect(await fillFromProject(await loadBundle(projectId), conds)).toBe(0);
  });

  it('says what it found for each condition', async () => {
    const b = await loadBundle(projectId);
    const tss = b.register!.conditions.find((c) => c.ref === '8(a)')!;
    const s = autoStatus(tss, b, year.start, year.end);
    expect(['complied', 'not-complied', 'check']).toContain(s.status);
    expect(s.lines[0]).toMatch(/^Discharge TSS limit: /);
    const sampling = b.register!.conditions.find((c) => c.kind === 'monitoring')!;
    expect(autoStatus(sampling, b, year.start, year.end).lines[0]).toMatch(/samples (taken|not taken)/);
    const rows = registerRows(b.register!.conditions, b.register!.assessments, b, year.start, year.end);
    expect(rows.every((r) => r.grade === undefined || r.auto_)).toBe(true);
    // not complied but not yet graded: counted at the suggested grade, and the overall grade is provisional
    const o = overallGrade(rows);
    expect(o.provisional).toBe(o.toGrade > 0);
    if (rows.some((r) => !r.grade && r.auto.status === 'not-complied')) expect(o.grade).not.toBe('full');
  });

  it('keeps every grade given, and takes one back', async () => {
    let b = await loadBundle(projectId);
    const c = b.register!.conditions.find((x) => x.ref === '8(a)')!;
    await gradeCondition(c, year.start, year.end, 'full', 'All results within the limit', '');
    await gradeCondition(c, year.start, year.end, 'moderate', 'One exceedance after heavy rain; sediment reached the stream', 'Pond desludged; re-sampled – complied');
    const a = (await db.assessments.where('conditionId').equals(c.id).toArray())[0];
    expect(a.grade).toBe('moderate');
    expect(a.by).toBe('R. Tester');
    expect(a.history?.map((h) => h.grade)).toEqual(['full']);
    b = await loadBundle(projectId);
    const rows = registerRows(b.register!.conditions, b.register!.assessments, b, year.start, year.end);
    expect(overallGrade(rows).grade).toBe('moderate');
    // the report section
    const annual = BUILT_IN_TEMPLATES.find((t) => t.id === 'tpl-annual')!;
    const doc = buildReport({ bundle: b, template: { ...annual, blocks: [{ id: 'r', type: 'complianceRegister' }] }, period: { ...year, label: '2025/26' }, settings: DEFAULT_SETTINGS });
    const p = doc.nodes.find((n): n is Extract<DocNode, { t: 'p' }> => n.t === 'p')!;
    expect(p.runs.map((r) => r.text).join('')).toMatch(/^Overall: moderate non-compliance (\(provisional\) )?– 1 condition moderate non-compliance/);
    const t = doc.nodes.find((n): n is Extract<DocNode, { t: 'table' }> => n.t === 'table')!;
    expect(t.caption).toMatch(/^Table 1: Compliance with consent conditions/);
    const row = t.body.find((r) => r[0].text === '8(a)')!;
    expect(row[3].text).toBe('Moderate non-compliance');
    expect(row[4].text).toBe('One exceedance after heavy rain; sediment reached the stream Action: Pond desludged; re-sampled – complied');
    await clearGrade(a.id);
    expect(await db.assessments.get(a.id)).toBeUndefined();
  });

  it('adds pasted conditions, linked to the rules with the same numbers', async () => {
    const b = await loadBundle(projectId);
    const n = await addFromText(b, CONSENT, 'AUTH-123456');
    expect(n).toBe(5);
    const pasted = (await db.conditions.where('projectId').equals(projectId).toArray()).filter((c) => c.consent === 'AUTH-123456');
    const ph = pasted.find((c) => c.ref === '8(a)')!;
    expect(ph.ruleIds?.length).toBeGreaterThan(0);
  });
});
