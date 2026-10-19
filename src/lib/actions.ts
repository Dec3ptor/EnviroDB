// "Actions to take": what needs doing across the projects, most pressing first – reports overdue or due soon,
// sampling rounds on the monitoring calendar that need something (results overdue from the lab, results back but not
// sent on, planned but not sampled), sampling still to do, and exceedances nobody has followed up yet.

import type { ProjectBundle } from './analysis';
import { evaluateAll } from './analysis';
import { cellValue, type CalendarSheet } from './calendar';
import { openRounds, roundText, type RoundOptions } from './rounds';
import { addDays, addMonths, daysBetween, formatDate, todayStr } from './dates';
import { nextObligation, scheduleStatus } from './schedule';

export interface Action {
  id: string;
  kind: 'report' | 'results' | 'lab' | 'inbox' | 'qa' | 'sampling' | 'exceedance';
  /** 0 overdue or needing a response, 1 due soon, 2 to keep in mind. */
  urgency: 0 | 1 | 2;
  title: string;
  detail: string;
  projectId: string;
  projectName: string;
  link: string;
  /** When it's due (or happened). */
  date: string;
  /** A round's results to send: the calendar row and month (YYYY-MM) of the round, to record them sent. */
  calendar?: { item: string; month: string };
}

export function actionsToTake(bundles: ProjectBundle[], sheet: CalendarSheet | null = null, today = todayStr(), rounds: Omit<RoundOptions, 'today'> = {}): Action[] {
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
  // sampling rounds on the calendar: results overdue from the lab, results back but not sent on, planned but not sampled
  if (sheet) {
    const since = addMonths(`${thisMonth}-01`, -2).slice(0, 7);
    for (const r of openRounds(sheet, { ...rounds, today }, since)) {
      const row = sheet.rows.find((x) => x.id === r.rowId)!;
      const project = row.projectId ? sheet.projects.get(row.projectId) : undefined;
      if (!project) continue;
      const job = cellValue(row, 'job', project);
      const when = r.months.length > 1 ? `${monthLabel(r.months[0])} – ${monthLabel(r.months[r.months.length - 1])}` : monthLabel(r.month);
      const base = { projectId: project.id, projectName: project.name, date: r.overdue?.due ?? r.next?.due ?? `${r.month}-01` };
      const progress = roundText(r);
      if (r.overdue?.kind === 'lab')
        out.push({ ...base, id: `lab:${r.rowId}:${r.month}`, kind: 'lab', urgency: 0, title: `Results overdue from ${r.lab ?? 'the lab'}: ${job}`, detail: `${when} · ${progress}`, link: '/calendar' });
      else if (r.stages.results.done)
        out.push({
          ...base,
          id: `results:${r.rowId}:${r.month}`,
          kind: 'results',
          urgency: r.overdue ? 0 : 1,
          title: `Send the results: ${job}`,
          detail: `${when} · ${progress}${r.overdue ? '' : r.next ? ` · ${r.next.text.charAt(0).toLowerCase()}${r.next.text.slice(1)}` : ''}`,
          link: `/projects/${project.id}/data`,
          calendar: { item: r.rowId, month: r.month },
        });
      else if (r.overdue?.kind === 'sample') out.push({ ...base, id: `notsampled:${r.rowId}:${r.month}`, kind: 'sampling', urgency: 0, title: `Not sampled: ${job}`, detail: r.overdue.text, link: '/calendar' });
    }
  }
  return out.sort((a, b) => a.urgency - b.urgency || a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

/** New lab files in the inbox, by project: one action each, to import them. */
export function inboxActions(files: Array<{ projectId?: string; name: string; modified: number }>, projects: Map<string, { name: string }>): Action[] {
  const by = new Map<string, typeof files>();
  for (const f of files) by.set(f.projectId ?? '', [...(by.get(f.projectId ?? '') ?? []), f]);
  return [...by].map(([pid, list]) => {
    const p = pid ? projects.get(pid) : undefined;
    const n = list.length;
    return {
      id: `inbox:${pid}`,
      kind: 'inbox' as const,
      urgency: 1 as const,
      title: `${n} new lab file${n === 1 ? '' : 's'} to import${p ? `: ${p.name}` : ''}`,
      detail: list.slice(0, 3).map((f) => f.name).join(', ') + (n > 3 ? ` and ${n - 3} more` : ''),
      projectId: pid,
      projectName: p?.name ?? 'Lab inbox',
      link: pid ? `/projects/${pid}/import` : '/import',
      date: new Date(Math.max(...list.map((f) => f.modified))).toISOString().slice(0, 10),
    };
  });
}

/** Projects whose recent results have QA/QC findings nobody has looked at. */
export function qaActions(list: Array<{ project: { id: string; name: string; status: string }; findings: Array<{ title: string; date: string; severity: string; record?: unknown }> }>): Action[] {
  const out: Action[] = [];
  for (const { project, findings } of list) {
    if (project.status !== 'active') continue;
    const open = findings.filter((f) => f.severity === 'check' && !f.record);
    if (!open.length) continue;
    out.push({
      id: `qa:${project.id}`,
      kind: 'qa',
      urgency: 1,
      title: `QA/QC: ${open.length} thing${open.length === 1 ? '' : 's'} to look at`,
      detail: open.slice(0, 2).map((f) => f.title).join(' · ') + (open.length > 2 ? ` and ${open.length - 2} more` : ''),
      projectId: project.id,
      projectName: project.name,
      link: `/projects/${project.id}/qa`,
      date: open.reduce((m, f) => (f.date > m ? f.date : m), ''),
    });
  }
  return out;
}
