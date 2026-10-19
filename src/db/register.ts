// Saving the compliance register: conditions, their grades (each change kept in the grade's history), and making
// the register from what the project already has or from a consent's text.

import { db, getSettings } from './db';
import type { ComplianceGrade, ConditionAssessment, ConsentCondition } from './types';
import { uid } from '../lib/ids';
import type { ProjectBundle } from '../lib/analysis';
import { assessmentId, guessKind, parseConditions, refOf, rulesForRef } from '../lib/register';
import { saveEdited } from './repo';

const nowIso = () => new Date().toISOString();

export function newCondition(projectId: string, patch: Partial<ConsentCondition> = {}): ConsentCondition {
  return { id: uid('cond'), projectId, ref: '', title: '', kind: 'other', active: true, order: Date.now(), updatedAt: nowIso(), ...patch };
}

export async function saveCondition(c: ConsentCondition, before?: ConsentCondition): Promise<void> {
  await saveEdited(db.conditions, { ...c, updatedAt: nowIso() }, before);
}

export async function deleteCondition(id: string): Promise<void> {
  await db.transaction('rw', db.conditions, db.assessments, async () => {
    await db.assessments.where('conditionId').equals(id).delete();
    await db.conditions.delete(id);
  });
}

/** Grade a condition over a period, keeping the grade it replaces in the history. */
export async function gradeCondition(c: ConsentCondition, start: string, end: string, grade: ComplianceGrade, note: string, action: string): Promise<void> {
  const by = (await getSettings()).author || undefined;
  const id = assessmentId(c.id, start, end);
  await db.transaction('rw', db.assessments, async () => {
    const cur = await db.assessments.get(id);
    const history = cur ? [...(cur.history ?? []), { grade: cur.grade, note: cur.note, action: cur.action, by: cur.by, at: cur.at }] : undefined;
    const next: ConditionAssessment = { id, projectId: c.projectId, conditionId: c.id, start, end, grade, note: note.trim() || undefined, action: action.trim() || undefined, by, at: nowIso(), history };
    await db.assessments.put(next);
  });
}

/** Take a grade back (EnviroDB's own finding stands again); kept in the history of the next grade. */
export async function clearGrade(id: string): Promise<void> {
  await db.assessments.delete(id);
}

/**
 * Conditions for what the project already has, not yet in the register: its consent rules (grouped by condition
 * number), sampling schedules, reports, and the other consent requirements noted on the project.
 */
export async function fillFromProject(b: ProjectBundle, existing: ConsentCondition[]): Promise<number> {
  const linkedRules = new Set(existing.flatMap((c) => c.ruleIds ?? []));
  const linkedSch = new Set(existing.flatMap((c) => c.scheduleIds ?? []));
  const linkedObs = new Set(existing.flatMap((c) => c.obligationIds ?? []));
  const titles = new Set(existing.map((c) => c.title.trim().toLowerCase()));
  const made: ConsentCondition[] = [];
  let order = Date.now();
  // rules, by condition number
  const groups = new Map<string, typeof b.rules>();
  for (const r of b.rules) {
    if (linkedRules.has(r.id)) continue;
    const k = refOf(r.condition) || r.name;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  for (const [k, rules] of groups) {
    const same = existing.find((c) => c.ref && refOf(c.ref).toLowerCase() === refOf(rules[0].condition).toLowerCase());
    if (same) {
      await saveCondition({ ...same, ruleIds: [...(same.ruleIds ?? []), ...rules.map((r) => r.id)] }, same);
      continue;
    }
    made.push(newCondition(b.project.id, { ref: refOf(rules[0].condition), title: rules.map((r) => r.name).join('; ') || k, kind: 'limit', ruleIds: rules.map((r) => r.id), order: order++ }));
  }
  for (const s of b.schedules) if (!linkedSch.has(s.id)) made.push(newCondition(b.project.id, { title: s.name, kind: 'monitoring', scheduleIds: [s.id], order: order++ }));
  for (const o of b.obligations) if (!linkedObs.has(o.id)) made.push(newCondition(b.project.id, { title: o.name, kind: 'reporting', obligationIds: [o.id], order: order++ }));
  for (const line of (b.project.consentNotes ?? '').split('\n').map((l) => l.replace(/^[-•*]\s*/, '').trim()).filter(Boolean)) {
    if (titles.has(line.toLowerCase())) continue;
    made.push(newCondition(b.project.id, { title: line.length > 160 ? `${line.slice(0, 157)}…` : line, text: line.length > 160 ? line : undefined, kind: guessKind(line), order: order++ }));
  }
  if (made.length) await db.conditions.bulkPut(made);
  return made.length;
}

/** Conditions read from a consent's text, linked to the rules with the same condition numbers. */
export async function addFromText(b: ProjectBundle, text: string, consent?: string): Promise<number> {
  const parsed = parseConditions(text);
  let order = Date.now();
  const made = parsed.map((p) =>
    newCondition(b.project.id, {
      consent: consent?.trim() || undefined,
      ref: p.ref,
      title: p.title,
      text: p.text,
      kind: guessKind(p.text),
      ruleIds: rulesForRef(p.ref, b.rules),
      order: order++,
    }),
  );
  if (made.length) await db.conditions.bulkPut(made);
  return made.length;
}
