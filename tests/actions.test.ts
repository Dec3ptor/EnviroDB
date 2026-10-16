import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { db, ensureBuiltIns } from '../src/db/db';
import { newObligation, newProject, newRule, newSchedule, newSite, saveNote } from '../src/db/repo';
import { actionsToTake } from '../src/lib/actions';
import { calendarMonths, projectCalendar } from '../src/lib/calendar';
import { loadBundle } from './helpers';

const TODAY = '2026-10-16';
let projectId = '';

beforeAll(async () => {
  await ensureBuiltIns();
  const p = newProject({ name: 'Landfill' });
  projectId = p.id;
  await db.projects.put(p);
  const site = newSite(p.id, { id: 'gw1', code: 'GW1', order: 1 });
  const site2 = newSite(p.id, { id: 'gw2', code: 'GW2', order: 2 });
  await db.sites.bulkPut([site, site2]);
  // September's round is in (one site over its limit), October's still to do
  const sample = (id: string, siteId: string, date: string) => ({ id, projectId: p.id, siteId, date });
  await db.samples.bulkPut([sample('s1', 'gw1', '2026-09-10'), sample('s2', 'gw2', '2026-09-10')]);
  const r = (id: string, sampleId: string, siteId: string, value: number) => ({ id, projectId: p.id, sampleId, siteId, date: '2026-09-10', parameterId: 'nh4-n', value, qualifier: '' as const, unit: 'mg/L' });
  await db.results.bulkPut([r('r1', 's1', 'gw1', 5), r('r2', 's2', 'gw2', 0.2)]);
  await db.rules.put(newRule(p.id, { id: 'rule1', name: 'Ammonia limit', kind: 'threshold', parameterId: 'nh4-n', operator: '>', value: 1, unit: 'mg/L', siteIds: [] }));
  await db.schedules.put(newSchedule(p.id, { id: 'monthly', name: 'Monthly bores', siteIds: ['gw1', 'gw2'], every: 1, unit: 'month', startDate: '2026-01-01' }));
  // an annual report due in two weeks, and one that's overdue
  await db.obligations.bulkPut([
    newObligation(p.id, { id: 'annual', name: 'Annual report', firstPeriodStart: '2025-07-01', firstPeriodEnd: '2026-06-30', firstDueDate: '2026-10-30', every: 1, unit: 'year' }),
    newObligation(p.id, { id: 'gas', name: 'Gas survey report', firstPeriodStart: '2026-01-01', firstPeriodEnd: '2026-06-30', firstDueDate: '2026-09-30', every: 6, unit: 'month' }),
  ]);
});

describe('actions to take', () => {
  it('lists what needs doing, most pressing first', async () => {
    const b = await loadBundle(projectId);
    const cal = projectCalendar({ project: b.project, schedules: b.schedules, obligations: b.obligations, samples: b.samples, marks: [] }, calendarMonths(2026), TODAY);
    const actions = actionsToTake([b], [cal], TODAY);
    const brief = actions.map((a) => [a.kind, a.urgency, a.title]);
    expect(brief).toEqual([
      ['exceedance', 0, 'Follow up: Ammonia limit'],
      ['report', 0, 'Gas survey report is overdue'],
      ['results', 0, 'Send or report the results: Monthly bores'], // last month's, still not sent
      ['report', 1, 'Annual report due 30 Oct 2026'],
      ['sampling', 2, 'Sample GW1, GW2'],
    ]);
    // the September results can be marked done from the action
    expect(actions.find((a) => a.kind === 'results')?.calendar).toEqual({ projectId, item: 'monthly', month: '2026-09' });
  });

  it('drops an exceedance once it has a follow-up note', async () => {
    const b0 = await loadBundle(projectId);
    const ex = actionsToTake([b0], [], TODAY).find((a) => a.kind === 'exceedance')!;
    const key = ex.id.split(':').slice(2).join(':');
    await saveNote({ projectId, ruleId: 'rule1', key, status: 'notified', text: 'Council told 12 Sep', notifiedOn: '2026-09-12' });
    const b = await loadBundle(projectId);
    expect(actionsToTake([b], [], TODAY).some((a) => a.kind === 'exceedance')).toBe(false);
  });
});
