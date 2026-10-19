// Keeping continuous data: a gauge's daily values, added to (new days replace old), renamed or removed.

import { db } from './db';
import type { ContinuousSeries, SeriesKind } from './types';
import { uid } from '../lib/ids';
import { seriesRange, toYears, type DayValue } from '../lib/continuous';
import { saveEdited } from './repo';

const nowIso = () => new Date().toISOString();

/** Add a file's daily values: to a series already kept (`into`), or as a new one. */
export async function addSeriesDays(projectId: string, days: Map<string, DayValue>, meta: { name: string; kind: SeriesKind; unit: string; source?: string }, into?: ContinuousSeries): Promise<ContinuousSeries> {
  const id = into?.id ?? uid('ser');
  return db.transaction('rw', [db.series, db.seriesDays], async () => {
    const existing = into ? await db.seriesDays.where('seriesId').equals(id).toArray() : [];
    const years = toYears(projectId, id, days, existing);
    const range = seriesRange(years);
    const series: ContinuousSeries = {
      ...(into ?? {}),
      id,
      projectId,
      name: meta.name.trim() || into?.name || 'Rainfall',
      kind: meta.kind,
      unit: meta.unit.trim(),
      source: [into?.source, meta.source].filter(Boolean).join('; ') || undefined,
      first: range.first,
      last: range.last,
      updatedAt: nowIso(),
    };
    // only the years with new days are written again
    const touched = new Set([...days.keys()].map((d) => d.slice(0, 4)));
    await db.seriesDays.bulkPut(years.filter((y) => touched.has(y.year)));
    await db.series.put(series);
    return series;
  });
}

export async function saveSeries(s: ContinuousSeries, before?: ContinuousSeries): Promise<void> {
  await saveEdited(db.series, { ...s, updatedAt: nowIso() }, before);
}

export async function deleteSeries(id: string): Promise<void> {
  await db.transaction('rw', [db.series, db.seriesDays], async () => {
    await db.seriesDays.where('seriesId').equals(id).delete();
    await db.series.delete(id);
  });
}
