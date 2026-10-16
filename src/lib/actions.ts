// "Actions to take": what needs doing across the projects, most pressing first – reports overdue or due soon,
// results that are in but haven't been sent or reported, sampling rounds still to do, and exceedances nobody has
// followed up yet.

import type { ProjectBundle } from './analysis';
import { evaluateAll } from './analysis';
import type { ProjectCalendar } from './calendar';
import { addDays, daysBetween, formatDate, todayStr } from './dates';
import { nextObligation, scheduleStatus } from './schedule';

export interface Action {
  id: string;
  kind: 'report' | 'results' | 'sampling' | 'exceedance';
  /** 0 overdue or needing a response, 1 due soon, 2 to keep in mind. */
  urgency: 0 | 1 | 2;
  title: string;
  detail: string;
  projectId: string;
  projectName: string;
  link: string;
  /** When it's due (or happened). */
  date: string;
  /** Results in: the calendar month it can be marked done on. */
  calendar?: { projectId: string; item: string; month: string };
}

export function actionsToTake(bundles: ProjectBundle[], calendars: ProjectCalendar[] = [], today = todayStr()): Action[] {
  const out: Action[] = [];
  const thisMonth = today.slice(0, 7);
  for (const b of bundles) {
    const p = b.project;
    if (p.status !== 'active') continue;
    const base = { projectId: p.id, projectName: p.name };
    // reports
    for (const ob of b.obligations) {
      if (!ob.active) continue;
      const next = nextObligation(ob, today);
      if (!next || next.status === 'submitted') continue;
      const days = daysBetween(today, next.dueDate);
      if (days > 30) continue;
      out.push({
        ...base,
        id: `report:${ob.id}:${next.index}`,
        kind: 'report',
        urgency: days < 0 ? 0 : 1,
        title: days < 0 ? `${ob.name} is overdue` : `${ob.name} due ${formatDate(next.dueDate)}`,
        detail: `For ${formatDate(next.periodStart)} – ${formatDate(next.periodEnd)}${ob.recipient ? ` · to ${ob.recipient}` : ''}`,
        link: `/projects/${p.id}/reports?obligation=${ob.id}&period=${next.index}`,
        date: next.dueDate,
      });
    }
    // sampling still to do this round
    for (const sch of b.schedules) {
      if (!sch.active) continue;
      const st = scheduleStatus(sch, b.samples, b.index.bySample, today, 60);
      if (!st.outstanding.length || !st.dueBy || daysBetween(today, st.dueBy) > 21) continue;
      out.push({
        ...base,
        id: `sampling:${sch.id}:${st.dueBy}`,
        kind: 'sampling',
        urgency: daysBetween(today, st.dueBy) <= 7 ? 1 : 2,
        title: `Sample ${st.outstanding.map((id) => b.siteMap.get(id)?.code ?? '?').join(', ')}`,
        detail: `${sch.name} · by ${formatDate(st.dueBy)}`,
        link: `/projects/${p.id}/schedule`,
        date: st.dueBy,
      });
    }
    // exceedances in the last 90 days with no follow-up yet
    const notes = new Map(b.notes.map((n) => [n.id, n]));
    for (const ev of evaluateAll(b, addDays(today, -90), today)) {
      for (const ex of ev.exceedances) {
        const note = notes.get(`${ev.rule.id}|${ex.key}`);
        if (note && note.status !== 'open') continue;
        out.push({
          ...base,
          id: `exceedance:${ev.rule.id}:${ex.key}`,
          kind: 'exceedance',
          urgency: 0,
          title: `Follow up: ${ev.rule.name}`,
          detail: `${b.siteMap.get(ex.siteId)?.code ?? ''} ${formatDate(ex.date)} – ${ex.limitText}${note?.text ? ` · ${note.text}` : ''}`.trim(),
          link: `/projects/${p.id}/compliance`,
          date: ex.date.slice(0, 10),
        });
      }
    }
  }
  // results in that haven't been sent or reported (done is marked once they are)
  for (const c of calendars) {
    if (c.project.status !== 'active') continue;
    for (const e of c.entries) {
      if (e.window || e.item.kind !== 'sampling' || e.state !== 'doing' || e.mark?.status || e.month > thisMonth) continue;
      out.push({
        id: `results:${e.item.key}:${e.month}`,
        kind: 'results',
        urgency: e.month < thisMonth ? 0 : 1,
        title: `Send or report the results: ${e.item.label}`,
        detail: `${monthLabel(e.month)} round · results are in`,
        projectId: c.project.id,
        projectName: c.project.name,
        link: `/projects/${c.project.id}/data`,
        date: e.due,
        calendar: { projectId: c.project.id, item: e.item.key, month: e.month },
      });
    }
  }
  return out.sort((a, b) => a.urgency - b.urgency || a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
