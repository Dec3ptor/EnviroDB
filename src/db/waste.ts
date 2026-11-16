// Waste acceptance criteria kept as a guideline set of the team's own: each contaminant's total concentration is a
// value for its soil parameter, its leachate limit one for its TCLP parameter – added to the library where it hasn't
// them yet.

import { db } from './db';
import { createParameter, ensureTwin, saveGuidelineSet } from './repo';
import type { GuidelineSet, GuidelineValue, Parameter } from './types';
import { buildIndexes, matchAnalyte } from '../lib/matrix';
import { nowIso, uid } from '../lib/ids';
import type { CriteriaRow } from '../lib/waste';

/** The soil and TCLP parameters for a contaminant named in a table of criteria – its counterparts, or new ones under its name. */
async function parametersFor(name: string): Promise<{ soil: Parameter; tclp: Parameter }> {
  const all = await db.parameters.toArray();
  const ix = buildIndexes(all);
  const find = async (matrix: 'soil' | 'tclp', unit: string, of?: string): Promise<Parameter> => {
    // (matched as a file's analyte of that kind would be: by a parameter of the kind, else the water one's counterpart)
    const m = matchAnalyte(matrix === 'tclp' ? `TCLP ${name}` : name, undefined, unit, ix);
    const there = m.parameterId ? all.find((p) => p.id === m.parameterId) : undefined;
    if (there) return there;
    const twin = m.twin?.of ? await ensureTwin(m.twin.of, matrix) : null;
    if (twin) return twin;
    const made = await createParameter(`${name} (${matrix === 'soil' ? 'soil' : 'TCLP'})`, unit, matrix === 'soil' ? 'Soil' : 'Leach tests', { matrix, aliases: [name] });
    // a contaminant the library has never met: its TCLP parameter is the soil one's counterpart, so the two pair up
    if (of) {
      const linked = { ...made, of };
      await db.parameters.put(linked);
      return linked;
    }
    return made;
  };
  const soil = await find('soil', 'mg/kg');
  const tclp = await find('tclp', 'mg/L', soil.of ? undefined : soil.id);
  return { soil, tclp };
}

/**
 * Criteria saved as a guideline set – a new one, or `into` an existing one (its other values stay). Returns the set
 * and how many parameters were added to the library for it.
 */
export async function saveCriteria(name: string, source: string | undefined, rows: CriteriaRow[], into?: GuidelineSet): Promise<{ set: GuidelineSet; added: number }> {
  const before = await db.parameters.count();
  const values = new Map<string, GuidelineValue>((into?.values ?? []).map((v) => [v.parameterId, v]));
  for (const r of rows) {
    const { soil, tclp } = await parametersFor(r.name);
    if (r.total !== undefined) values.set(soil.id, { parameterId: soil.id, max: r.total, unit: 'mg/kg' });
    if (r.leach !== undefined) values.set(tclp.id, { parameterId: tclp.id, max: r.leach, unit: 'mg/L' });
  }
  const set: GuidelineSet = into
    ? { ...into, name: name.trim() || into.name, ...(source?.trim() ? { source: source.trim() } : {}), values: [...values.values()], updatedAt: nowIso() }
    : { id: uid('gl'), name: name.trim() || 'Waste acceptance criteria', shortName: (name.trim() || 'Waste criteria').slice(0, 24), family: 'Custom', matrix: 'Waste', builtIn: false, ...(source?.trim() ? { source: source.trim() } : {}), values: [...values.values()], updatedAt: nowIso() };
  await saveGuidelineSet(set, into);
  return { set, added: (await db.parameters.count()) - before };
}
