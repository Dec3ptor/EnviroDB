import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { ensureBuiltIns } from '../src/db/db';
import { createDemoProject } from '../src/db/demo';
import type { ProjectBundle } from '../src/lib/analysis';
import { limitsTable, ruleValueText } from '../src/lib/limitsTable';
import { newRule } from '../src/db/repo';
import { loadBundle } from './helpers';

let b: ProjectBundle;
beforeAll(async () => {
  await ensureBuiltIns();
  b = await loadBundle(await createDemoProject());
});
const active = () => b.sites.filter((s) => s.active);
const cellAt = (t: ReturnType<typeof limitsTable>, param: string, level: string, site: string) => {
  const row = t.rows.find((r) => r.param.name === param && r.level === level);
  return row?.cells[t.sites.findIndex((s) => s.code === site)]?.text;
};

describe('limits and triggers table', () => {
  it('has a row per parameter and level and a column per site, as in the report', () => {
    const t = limitsTable(b, active());
    expect(t.sites.map((s) => s.code)).toEqual(['DP1', 'DS1', 'GW1'].filter((c) => t.sites.some((s) => s.code === c)));
    expect(cellAt(t, 'pH', 'Limit', 'DP1')).toBe('6–9');
    expect(cellAt(t, 'Total Suspended Solids', 'Limit', 'DP1')).toBe('100');
    expect(cellAt(t, 'Total Suspended Solids', 'Trigger 1', 'DP1')).toBe('50\n(2 in a row)');
    expect(cellAt(t, 'Nitrate-N', 'Trigger', 'DS1')).toBe('2.4\n(median)');
    expect(cellAt(t, 'pH', 'Limit', 'DS1')).toBeUndefined();
    // each cell knows its rules, to open them
    const row = t.rows.find((r) => r.param.name === 'pH' && r.level === 'Limit')!;
    expect(row.cells[t.sites.findIndex((s) => s.code === 'DP1')]!.rules[0].kind).toBe('threshold');
  });

  it('shows only limits or only triggers', () => {
    expect(new Set(limitsTable(b, active(), 'limits').rows.map((r) => r.level))).toEqual(new Set(['Limit']));
    expect(limitsTable(b, active(), 'triggers').rows.every((r) => r.level !== 'Limit')).toBe(true);
  });

  it('lists rules without a value per parameter on their own, and gives a guideline rule’s analytes their values', () => {
    const extra = [
      newRule(b.project.id, { id: 'chg', name: 'Turbidity increase', kind: 'change', parameterId: 'turbidity', changeType: 'percent', operator: '>', value: 20, level: 'Limit' }),
      newRule(b.project.id, { id: 'gl', name: 'Zinc vs ANZG', kind: 'guideline', guidelineSetId: 'anzg-fw-95', parameterIds: ['zn-d'], level: 'Trigger 2', siteIds: [] }),
    ];
    const t = limitsTable({ ...b, rules: [...b.rules, ...extra] }, active());
    expect(t.other.map((r) => r.id)).toContain('chg');
    const zinc = t.rows.find((r) => r.param.id === 'zn-d' && r.level === 'Trigger 2')!;
    expect(zinc.cells.every((c) => c && /^(0\.008|8)$/.test(c.text))).toBe(true);
    expect(zinc.cells[0]!.rules[0].id).toBe('gl|zn-d');
  });

  it('writes a minimum as "≥" and converts to the parameter’s unit', () => {
    const p = b.paramMap.get('zn-d')!;
    const r = newRule(b.project.id, { kind: 'threshold', parameterId: 'zn-d', operator: '>', value: 8, unit: p.unit === 'mg/L' ? 'µg/L' : 'mg/L' });
    expect(ruleValueText(r, p)).toBe(p.unit === 'mg/L' ? '0.008' : '8000');
    expect(ruleValueText({ ...r, operator: '<', value: 6, unit: p.unit }, p)).toBe('≥6');
  });
});
