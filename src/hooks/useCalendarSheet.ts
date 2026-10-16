import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { ReportObligation, Site } from '../db/types';
import { buildSheet, type CalendarSheet } from '../lib/calendar';

export type { CalendarSheet };

/**
 * The monitoring calendar with what EnviroDB knows about each row's project in a year (results from November of the
 * year before, so the start of a year can look back).
 */
export function useCalendarSheet(year: number, projectId?: string): CalendarSheet | null {
  const rows = useLiveQuery(() => (projectId ? db.calendarRows.where('projectId').equals(projectId).toArray() : db.calendarRows.toArray()), [projectId]);
  const marks = useLiveQuery(() => db.calendarMarks.toArray(), []);
  const projects = useLiveQuery(() => db.projects.toArray(), []);
  const linked = useMemo(() => [...new Set((rows ?? []).map((r) => r.projectId).filter(Boolean) as string[])].sort(), [rows]);
  const key = linked.join(',');
  const samples = useLiveQuery(
    () =>
      Promise.all(
        linked.map((id) =>
          db.samples
            .where('[projectId+date]')
            .between([id, `${year - 1}-11-01`], [id, `${year + 1}-01-01`], true, false)
            .toArray()
            .then((list) => list.map((s) => ({ projectId: s.projectId, siteId: s.siteId, date: s.date }))),
        ),
      ).then((l) => l.flat()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, year],
  );
  const obligations = useLiveQuery(() => (linked.length ? db.obligations.where('projectId').anyOf(linked).toArray() : Promise.resolve([] as ReportObligation[])), [key]);
  const sites = useLiveQuery(() => (linked.length ? db.sites.where('projectId').anyOf(linked).toArray() : Promise.resolve([] as Site[])), [key]);
  return useMemo(() => {
    if (!rows || !marks || !projects || !samples || !obligations || !sites) return null;
    return buildSheet({ rows, marks, projects, samples, obligations, sites }, year);
  }, [rows, marks, projects, samples, obligations, sites, year]);
}
