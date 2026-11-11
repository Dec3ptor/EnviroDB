// Ecology surveys and the team's taxa list, saved: a survey with what was found in it; a taxon with its group and
// tolerance scores. Changes to surveys go in the project's history.

import { db } from './db';
import { logAudit } from './audit';
import { saveEdited, touchProject } from './repo';
import type { EcoSurvey, Taxon } from './types';
import { nowIso, uid } from '../lib/ids';
import { formatDate } from '../lib/dates';
import { mergedRecords, taxonKey } from '../lib/ecology';

export function newSurvey(projectId: string, patch: Partial<EcoSurvey> = {}): EcoSurvey {
  return { id: uid('eco'), projectId, date: nowIso().slice(0, 10), kind: 'Stream invertebrates', records: [], updatedAt: nowIso(), ...patch };
}

const tidy = (s: EcoSurvey): EcoSurvey => {
  const out: EcoSurvey = { ...s, records: mergedRecords(s.records).map((r) => ({ taxon: r.taxon.trim(), ...(typeof r.n === 'number' ? { n: r.n } : {}), ...(r.code && typeof r.n !== 'number' ? { code: r.code } : {}), ...(r.note?.trim() ? { note: r.note.trim() } : {}) })), updatedAt: nowIso() };
  for (const k of ['siteId', 'place', 'method', 'effort', 'by', 'notes', 'bed', 'scores'] as const) if (!out[k] || (typeof out[k] === 'string' && !(out[k] as string).trim())) delete out[k];
  if (out.siteId) delete out.place;
  if (out.kind !== 'Stream invertebrates') {
    delete out.bed;
    delete out.scores;
  }
  for (const k of ['place', 'method', 'effort', 'by', 'notes', 'scores'] as const) if (typeof out[k] === 'string') out[k] = out[k]!.trim();
  return out;
};

/** A survey saved (a taxon entered twice becomes one line); new taxa join the team's list, to be given groups and scores. */
export async function saveSurvey(s: EcoSurvey, before?: EcoSurvey): Promise<EcoSurvey> {
  const next = tidy(s);
  await saveEdited(db.surveys, next, before);
  const have = new Set((await db.taxa.toArray()).map((t) => t.id));
  const fresh = next.records.map((r) => r.taxon).filter((name) => !have.has(taxonKey(name)));
  if (fresh.length) await db.taxa.bulkPut([...new Map(fresh.map((name) => [taxonKey(name), { id: taxonKey(name), name, updatedAt: nowIso() } as Taxon])).values()]);
  await touchProject(next.projectId);
  await logAudit(next.projectId, 'survey', `${before ? 'Survey changed' : 'Survey added'}: ${next.kind.toLowerCase()}, ${formatDate(next.date)} (${next.records.length} taxa)`);
  return next;
}

/** A survey deleted – returns how to put it back. */
export async function deleteSurvey(s: EcoSurvey): Promise<() => Promise<void>> {
  await db.surveys.delete(s.id);
  await logAudit(s.projectId, 'survey', `Survey deleted: ${s.kind.toLowerCase()}, ${formatDate(s.date)}`);
  return async () => {
    await db.surveys.put(s);
    await logAudit(s.projectId, 'survey', `Survey put back: ${s.kind.toLowerCase()}, ${formatDate(s.date)}`);
  };
}

/** A taxon's entry in the team's list, saved (only what was changed here). */
export async function saveTaxon(t: Taxon, before?: Taxon): Promise<void> {
  const next: Taxon = { ...t, id: taxonKey(t.name), name: t.name.trim(), updatedAt: nowIso() };
  for (const k of ['group', 'common', 'status'] as const) {
    if (next[k]?.trim()) next[k] = next[k]!.trim();
    else delete next[k];
  }
  for (const k of ['mci', 'mciSb'] as const) if (typeof next[k] !== 'number' || !Number.isFinite(next[k])) delete next[k];
  if (next.ept === undefined) delete next.ept;
  if (before && before.id !== next.id) await db.taxa.delete(before.id);
  await saveEdited(db.taxa, next, before && before.id === next.id ? before : undefined);
}

/**
 * A pasted taxa list taken into the team's: each taxon's group, scores, common name and status as the list gives them
 * (what the list leaves blank stays as it was). `fill`: only what a taxon doesn't have yet – a results table's groups
 * never change the team's own. Returns how many were added and how many changed.
 */
export async function mergeTaxa(list: Taxon[], fill = false): Promise<{ added: number; changed: number }> {
  let added = 0;
  let changed = 0;
  await db.transaction('rw', db.taxa, async () => {
    for (const t of list) {
      const cur = await db.taxa.get(t.id);
      if (!cur) {
        await db.taxa.put({ ...t, updatedAt: nowIso() });
        added++;
        continue;
      }
      const has = (k: string) => (cur as unknown as Record<string, unknown>)[k] !== undefined && (cur as unknown as Record<string, unknown>)[k] !== '';
      const next = { ...cur, ...Object.fromEntries(Object.entries(t).filter(([k, v]) => k !== 'id' && k !== 'name' && v !== undefined && v !== '' && !(fill && has(k)))) } as Taxon;
      if (JSON.stringify({ ...next, updatedAt: '' }) !== JSON.stringify({ ...cur, updatedAt: '' })) {
        await db.taxa.put({ ...next, updatedAt: nowIso() });
        changed++;
      }
    }
  });
  return { added, changed };
}

/**
 * The surveys made from a pasted results table, saved together – each as its own survey. The groups and common names
 * the table gives go into the team's taxa list where a taxon has none (they never change the team's own).
 */
export async function saveSurveys(list: EcoSurvey[], taxa: Taxon[] = []): Promise<{ surveys: number; taxaAdded: number }> {
  const before = await db.taxa.count();
  for (const s of list) await saveSurvey(s);
  if (taxa.length) await mergeTaxa(taxa, true);
  return { surveys: list.length, taxaAdded: (await db.taxa.count()) - before };
}

/** What a new survey of a kind starts with: how the last one of that kind in the project was done. */
export function likeTheLast(surveys: EcoSurvey[], kind: EcoSurvey['kind']): Partial<EcoSurvey> {
  const last = surveys.filter((s) => s.kind === kind).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.updatedAt < b.updatedAt ? 1 : -1))[0];
  if (!last) return {};
  return { ...(last.method ? { method: last.method } : {}), ...(last.effort ? { effort: last.effort } : {}), ...(last.bed ? { bed: last.bed } : {}), ...(last.scores ? { scores: last.scores } : {}) };
}
