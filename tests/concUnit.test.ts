import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { db, ensureBuiltIns } from '../src/db/db';
import { createDemoProject } from '../src/db/demo';
import { importUnit, projectUnit, withProjectUnits } from '../src/lib/units';
import { displayUnit, displayValue } from '../src/lib/analysis';
import { loadBundle } from './helpers';

let projectId: string;
beforeAll(async () => {
  await ensureBuiltIns();
  projectId = await createDemoProject();
});

describe('a project’s concentration unit', () => {
  it('mg/L and g/m³ are the same thing, written the project’s way', () => {
    expect(projectUnit('mg/L', 'g/m³')).toBe('g/m³');
    expect(projectUnit('µg/L', 'g/m³')).toBe('mg/m³');
    expect(projectUnit('g/m³', 'mg/L')).toBe('mg/L');
    expect(projectUnit('mg/m³', 'mg/L')).toBe('µg/L');
    expect(projectUnit('mg/L', undefined)).toBe('mg/L');
    expect(projectUnit('NTU', 'g/m³')).toBe('NTU');
    expect(projectUnit('mg/kg', 'g/m³')).toBe('mg/kg');
    expect(projectUnit('µS/cm', 'mg/L')).toBe('µS/cm');
  });

  it('a parameter from a file: the file’s unit the project’s way, or the project’s unit when the file has none', () => {
    expect(importUnit(undefined, undefined)).toBe('mg/L');
    expect(importUnit(undefined, 'g/m³')).toBe('g/m³');
    expect(importUnit('g/m3', undefined)).toBe('mg/L');
    expect(importUnit('g/m3', 'g/m³')).toBe('g/m³');
    expect(importUnit('mg/L', 'g/m³')).toBe('g/m³');
    expect(importUnit('ug/L', 'g/m³')).toBe('mg/m³');
    expect(importUnit('NTU', 'g/m³')).toBe('NTU');
  });

  it('the project’s parameters carry its unit; the library’s stay; the numbers don’t change', async () => {
    const before = await loadBundle(projectId);
    const nh4 = before.paramMap.get('nh4-n')!;
    expect(nh4.unit).toBe('mg/L');
    await db.projects.update(projectId, { concUnit: 'g/m³' });
    const b = await loadBundle(projectId);
    const p = b.paramMap.get('nh4-n')!;
    expect(displayUnit(p)).toBe('g/m³');
    expect(b.paramMap.get('turbidity')!.unit).toBe('NTU');
    const r = b.index.byParam.get('nh4-n')!.values().next().value![0];
    expect(displayValue(r, p).value).toBe(displayValue(r, nh4).value);
    // the library itself is untouched
    expect((await db.parameters.get('nh4-n'))!.unit).toBe('mg/L');
    // copies, not the library's objects
    expect(withProjectUnits([nh4], 'g/m³')[0]).not.toBe(nh4);
    expect(withProjectUnits([nh4], undefined)[0]).toBe(nh4);
    await db.projects.update(projectId, { concUnit: undefined });
  });
});
