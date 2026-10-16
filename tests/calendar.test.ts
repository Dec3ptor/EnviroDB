import { describe, expect, it } from 'vitest';
import { calendarMonths, cellState, cellText, legend, projectCalendar, scheduleSymbols } from '../src/lib/calendar';
import { newObligation, newProject, newSchedule } from '../src/db/repo';
import type { CalendarMark } from '../src/db/types';

const project = newProject({ id: 'p1', name: 'Closed landfill' });
const monthly = newSchedule('p1', { id: 'monthly', name: 'GW2', siteIds: ['gw2'], every: 1, unit: 'month', startDate: '2025-01-01' });
const quarterly = newSchedule('p1', { id: 'quarterly', name: 'All bores', siteIds: ['gw1', 'gw2'], every: 3, unit: 'month', startDate: '2025-03-01' });
const sixMonthly = newSchedule('p1', { id: 'six', name: 'River', siteIds: ['us'], every: 6, unit: 'month', startDate: '2026-01-01', window: 3, symbol: '◆' });
const weekly = newSchedule('p1', { id: 'weekly', name: 'Discharge', siteIds: ['dp'], every: 1, unit: 'week', startDate: '2026-01-05' });
const report = newObligation('p1', { id: 'annual', name: 'Annual report', every: 1, unit: 'year', firstPeriodStart: '2025-07-01', firstPeriodEnd: '2026-06-30', firstDueDate: '2026-09-30', submissions: [] });
const mark = (item: string, month: string, patch: Partial<CalendarMark> = {}): CalendarMark => ({ id: `${item}|${month}`, projectId: 'p1', item, month, updatedAt: '', ...patch });

const months = calendarMonths(2026);
const at = (entries: ReturnType<typeof projectCalendar>['entries'], item: string, month: string) => entries.filter((e) => e.item.key === item && e.month === month);

describe('the monitoring calendar', () => {
  it('shows a calendar year, or a reporting year', () => {
    expect(months).toEqual(['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12']);
    expect(calendarMonths(2026, 7)).toEqual(['2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03', '2027-04', '2027-05', '2027-06']);
  });

  it('gives each schedule its own mark, keeping the ones chosen', () => {
    const s = scheduleSymbols([monthly, quarterly, sixMonthly]);
    expect([s.get('monthly'), s.get('quarterly'), s.get('six')]).toEqual(['●', '▲', '◆']);
  });

  it('puts every round and report in its month, with where it stands', () => {
    const samples = [
      { siteId: 'gw2', date: '2026-01-14T10:00' },
      { siteId: 'gw2', date: '2026-02-11' },
      { siteId: 'gw1', date: '2026-03-20' }, // one of the two bores so far
      { siteId: 'dp', date: '2026-01-06' },
      { siteId: 'dp', date: '2026-01-13' },
    ];
    const marks = [mark('monthly', '2026-01', { status: 'done' }), mark('x-1', '2026-08', { symbol: '#', label: 'Metals suite' }), mark('annual', '2026-09', { status: 'doing', note: 'Draft with Sam' })];
    const cal = projectCalendar({ project, schedules: [monthly, quarterly, sixMonthly, weekly], obligations: [report], samples, marks }, months, '2026-04-15');
    const e = cal.entries;

    // monthly: marked done; results in (still to send); nothing in for a month that's over; to come
    expect(at(e, 'monthly', '2026-01')[0].state).toBe('done');
    expect(at(e, 'monthly', '2026-02')[0]).toMatchObject({ state: 'doing', auto: 'sampled' });
    expect(at(e, 'monthly', '2026-03')[0].state).toBe('overdue');
    expect(at(e, 'monthly', '2026-04')[0].state).toBe('todo');
    // quarterly from March: one bore of two so far
    expect(e.filter((x) => x.item.key === 'quarterly').map((x) => x.month)).toEqual(['2026-03', '2026-06', '2026-09', '2026-12']);
    expect(at(e, 'quarterly', '2026-03')[0]).toMatchObject({ auto: 'partly', state: 'todo' });
    // six-monthly with a three-month window: the mark in the first month, a band over the other two
    expect(e.filter((x) => x.item.key === 'six').map((x) => `${x.month}${x.window ? ' band' : ''}`)).toEqual(['2026-01', '2026-02 band', '2026-03 band', '2026-07', '2026-08 band', '2026-09 band']);
    expect(at(e, 'six', '2026-01')[0]).toMatchObject({ state: 'overdue', due: '2026-03-31' });
    // weekly: one entry a month, with its rounds counted
    expect(at(e, 'weekly', '2026-01')[0]).toMatchObject({ count: 4, auto: 'partly' });
    // the report in the month it's due, as marked; the extra job
    expect(at(e, 'annual', '2026-09')[0]).toMatchObject({ state: 'doing', due: '2026-09-30' });
    expect(at(e, 'x-1', '2026-08')[0].item).toMatchObject({ kind: 'extra', symbol: '#', label: 'Metals suite' });
    expect(cal.reportsDue).toEqual([{ label: 'Annual report', due: '2026-09-30', state: 'doing' }]);

    // a project's months: the marks together, coloured by the item needing most attention
    const month = (m: string) => e.filter((x) => x.month === m);
    expect(at(e, 'weekly', '2026-01')[0].item.symbol).toBe('■');
    expect(cellText(month('2026-09'))).toBe('●▲■×4R'); // the river window's band has no mark
    expect(cellText(month('2026-01'))).toBe('●■×4◆');
    expect(cellState(month('2026-02'))).toBe('overdue'); // the weekly rounds in February have nothing in
    expect(cellState(at(e, 'monthly', '2026-01'))).toBe('done');
    expect(legend(cal.items)).toContain('● = GW2 (Monthly)');
    expect(legend(cal.items)).toContain('R = Annual report');
  });

  it("counts a round as done once the report its results went into is submitted", () => {
    const submitted = { ...report, submissions: [{ periodStart: '2025-07-01', periodEnd: '2026-06-30', submittedOn: '2026-09-20' }] };
    const cal = projectCalendar({ project, schedules: [monthly], obligations: [submitted], samples: [{ siteId: 'gw2', date: '2026-02-11' }, { siteId: 'gw2', date: '2026-08-03' }], marks: [] }, months, '2026-10-01');
    expect(at(cal.entries, 'monthly', '2026-02')[0]).toMatchObject({ state: 'done', auto: 'reported', reportedIn: 'Annual report' });
    // after the reporting period: results in, not reported yet
    expect(at(cal.entries, 'monthly', '2026-08')[0]).toMatchObject({ state: 'doing', auto: 'sampled' });
  });

  it('counts a submitted report as done, and leaves out schedules that are off', () => {
    const submitted = { ...report, submissions: [{ periodStart: '2025-07-01', periodEnd: '2026-06-30', submittedOn: '2026-09-20' }] };
    const cal = projectCalendar({ project, schedules: [{ ...monthly, active: false }], obligations: [submitted], samples: [], marks: [] }, months, '2026-10-01');
    expect(cal.entries.map((x) => [x.item.key, x.month, x.state, x.auto])).toEqual([['annual', '2026-09', 'done', 'submitted']]);
  });
});
