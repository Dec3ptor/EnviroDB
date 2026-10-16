import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { projectCalendar, type ProjectCalendar } from '../lib/calendar';
import { todayStr } from '../lib/dates';

/** The monitoring calendar for the months given: every project's (or one project's) rounds, reports and extra jobs. */
export function useCalendar(months: string[], projectId?: string): ProjectCalendar[] | null {
  const scope = <T,>(all: () => Promise<T[]>, one: (id: string) => Promise<T[]>) => (projectId ? one(projectId) : all());
  const projects = useLiveQuery(() => scope(() => db.projects.toArray(), (id) => db.projects.where('id').equals(id).toArray()), [projectId]);
  const schedules = useLiveQuery(() => scope(() => db.schedules.toArray(), (id) => db.schedules.where('projectId').equals(id).toArray()), [projectId]);
  const obligations = useLiveQuery(() => scope(() => db.obligations.toArray(), (id) => db.obligations.where('projectId').equals(id).toArray()), [projectId]);
  const samples = useLiveQuery(() => scope(() => db.samples.toArray(), (id) => db.samples.where('projectId').equals(id).toArray()), [projectId]);
  const sites = useLiveQuery(() => scope(() => db.sites.toArray(), (id) => db.sites.where('projectId').equals(id).toArray()), [projectId]);
  const marks = useLiveQuery(() => scope(() => db.calendarMarks.toArray(), (id) => db.calendarMarks.where('projectId').equals(id).toArray()), [projectId]);
  const key = months.join(',');
  return useMemo(() => {
    if (!projects || !schedules || !obligations || !samples || !sites || !marks) return null;
    const by = <T extends { projectId: string }>(list: T[]) => {
      const m = new Map<string, T[]>();
      for (const x of list) m.set(x.projectId, [...(m.get(x.projectId) ?? []), x]);
      return m;
    };
    const sch = by(schedules), obl = by(obligations), smp = by(samples), mk = by(marks);
    const siteCodes = new Map(sites.map((s) => [s.id, s.code]));
    const today = todayStr();
    return [...projects]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((project) =>
        projectCalendar(
          { project, schedules: sch.get(project.id) ?? [], obligations: obl.get(project.id) ?? [], samples: smp.get(project.id) ?? [], marks: mk.get(project.id) ?? [], siteCodes },
          months,
          today,
        ),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, schedules, obligations, samples, sites, marks, key]);
}
