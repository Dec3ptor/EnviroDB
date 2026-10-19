import { describe, expect, it } from 'vitest';
import type { CalendarMark, CalendarRow, Project, ReportObligation, Site } from '../src/db/types';
import { buildSheet, markId } from '../src/lib/calendar';
import { addWorkingDays, openRounds, roundEdits, roundOf, roundText, samplingPlanned, workingDaysBetween } from '../src/lib/rounds';
import { windowsOf, rowMonths } from '../src/lib/calendar';

const project = { id: 'p1', name: 'Quarry', status: 'active' } as Project;
const sites = [{ id: 's1', projectId: 'p1', code: 'DP1' }, { id: 's2', projectId: 'p1', code: 'DS1' }] as Site[];
const row = (over: Partial<CalendarRow> = {}): CalendarRow => ({ id: 'r1', projectId: 'p1', order: 1, job: '', updatedAt: '', m03: '●', m06: '● R', m09: '(', m10: ')', m12: 'R', ...over });
const sheetWith = (opts: { rows?: CalendarRow[]; marks?: CalendarMark[]; samples?: Array<{ siteId: string; date: string; importId?: string; labName?: string; labJob?: string }>; obligations?: ReportObligation[]; imported?: Map<string, string> } = {}) =>
  buildSheet(
    {
      rows: opts.rows ?? [row()],
      marks: opts.marks ?? [],
      projects: [project],
      samples: (opts.samples ?? []).map((s) => ({ projectId: 'p1', ...s })),
      obligations: opts.obligations ?? [],
      sites,
      imported: opts.imported,
    },
    2026,
  );
const opts = (today: string) => ({ today, labDays: 10, sendDays: 5 });

describe('sampling rounds', () => {
  it('counts working days, Monday to Friday', () => {
    expect(workingDaysBetween('2026-10-02', '2026-10-09')).toBe(5); // Fri → next Fri
    expect(addWorkingDays('2026-10-02', 10)).toBe('2026-10-16');
    expect(addWorkingDays('2026-10-09', 1)).toBe('2026-10-12'); // Friday → Monday
  });

  it('knows which months plan sampling: a mark other than R, or a window', () => {
    const r = row();
    const w = windowsOf(rowMonths(r));
    expect([2, 5, 8, 9, 11, 0].map((i) => samplingPlanned(r, i, w))).toEqual([true, true, true, true, false, false]);
  });

  it('a planned month with nothing done, once past, is overdue; before then, it says when by', () => {
    const s = sheetWith();
    expect(roundOf(s, row(), '2026-03', opts('2026-04-10'))!.overdue).toMatchObject({ kind: 'sample', text: 'Planned for Mar 2026, not sampled' });
    expect(roundOf(s, row(), '2026-03', opts('2026-03-10'))!.next).toMatchObject({ text: 'Sample by 31 Mar 2026' });
    expect(roundOf(s, row(), '2026-12', opts('2027-01-10'))).toBeNull(); // a report month only
  });

  it('results imported tick off sampled, sent to the lab and results back – with the lab and its job number', () => {
    const s = sheetWith({ samples: [{ siteId: 's1', date: '2026-03-04', importId: 'i1', labName: 'Hill Labs', labJob: '3456789' }, { siteId: 's2', date: '2026-03-05', importId: 'i1', labName: 'Hill Labs', labJob: '3456789' }], imported: new Map([['i1', '2026-03-16']]) });
    const r = roundOf(s, row(), '2026-03', opts('2026-03-20'))!;
    expect(r.stages.sampled).toMatchObject({ done: true, date: '2026-03-04' });
    expect(r.stages.lab.done).toBe(true);
    expect(r.stages.results).toMatchObject({ done: true, date: '2026-03-16', from: 'imported 16 Mar 2026' });
    expect(r.stages.sent.done).toBe(false);
    expect([r.lab, r.labRef]).toEqual(['Hill Labs', '3456789']);
    expect(r.next).toMatchObject({ text: 'Send the results by 23 Mar 2026' });
    // a week later and still not sent
    expect(roundOf(s, row(), '2026-03', opts('2026-03-24'))!.overdue).toMatchObject({ kind: 'send', text: 'Results not sent – due 23 Mar 2026' });
  });

  it('sent to the lab and nothing back after the turnaround: overdue from that lab', () => {
    const marks: CalendarMark[] = [{ id: markId('r1', '2026-06'), item: 'r1', month: '2026-06', labSentOn: '2026-06-02', lab: 'ALS', labRef: 'COC 123', status: 'doing', updatedAt: '' }];
    const s = sheetWith({ marks });
    expect(roundOf(s, row(), '2026-06', opts('2026-06-10'))!.next).toMatchObject({ text: 'Results due from ALS by 16 Jun 2026' });
    const late = roundOf(s, row(), '2026-06', opts('2026-06-17'))!;
    expect(late.overdue).toMatchObject({ kind: 'lab', text: 'Results from ALS overdue – due 16 Jun 2026' });
    expect(roundText(late)).toBe('Sampled · sent to ALS 2 Jun 2026 (COC 123)');
  });

  it('a sampling window is one round, kept on its first month', () => {
    const marks: CalendarMark[] = [{ id: markId('r1', '2026-09'), item: 'r1', month: '2026-09', sampledOn: '2026-10-07', updatedAt: '' }];
    const s = sheetWith({ marks });
    const a = roundOf(s, row(), '2026-09', opts('2026-10-08'))!;
    const b = roundOf(s, row(), '2026-10', opts('2026-10-08'))!;
    expect(a.months).toEqual(['2026-09', '2026-10']);
    expect(b.month).toBe('2026-09');
    expect(b.stages.sampled).toMatchObject({ done: true, date: '2026-10-07' });
    expect(b.next).toMatchObject({ text: 'Send the samples to the lab' });
  });

  it('a report sent covering the month counts as the results sent', () => {
    const ob = { id: 'o1', projectId: 'p1', name: 'Annual report', every: 1, unit: 'year', firstPeriodStart: '2026-01-01', firstPeriodEnd: '2026-12-31', firstDueDate: '2027-02-28', active: true, submissions: [{ periodStart: '2026-01-01', periodEnd: '2026-12-31', submittedOn: '2027-02-20' }] } as ReportObligation;
    const s = sheetWith({ samples: [{ siteId: 's1', date: '2026-03-04' }], obligations: [ob] });
    const r = roundOf(s, row(), '2026-03', opts('2027-03-01'))!;
    expect(r.done).toBe(true);
    expect(r.stages.sent).toMatchObject({ done: true, date: '2027-02-20', from: 'in the Annual report sent 20 Feb 2027' });
  });

  it('recording stages colours the months: under way, then done; cancelled stays cancelled', () => {
    const r = row();
    const none = new Map<string, CalendarMark>();
    const [e1] = roundEdits(r, '2026-03', { labSentOn: '2026-03-05', lab: 'Hill Labs' }, none);
    expect(e1).toMatchObject({ t: 'mark', id: 'r1|2026-03', mark: { labSentOn: '2026-03-05', lab: 'Hill Labs', status: 'doing' } });
    const marks = new Map([['r1|2026-03', (e1 as { mark: CalendarMark }).mark]]);
    const [e2] = roundEdits(r, '2026-03', { resultsSentOn: '2026-03-20', sentTo: 'the council' }, marks);
    expect((e2 as { mark: CalendarMark }).mark).toMatchObject({ status: 'done', resultsSentOn: '2026-03-20', sentTo: 'the council', labSentOn: '2026-03-05' });
    // unticking: back to under way
    const done = new Map([['r1|2026-03', (e2 as { mark: CalendarMark }).mark]]);
    expect((roundEdits(r, '2026-03', { resultsSentOn: undefined, notSent: true }, done)[0] as { mark: CalendarMark }).mark.status).toBe('doing');
    // a window: both months take the colour
    const w = roundEdits(r, '2026-10', { sampledOn: '2026-09-20' }, none);
    expect(w.map((e) => [e.id, (e as { mark: CalendarMark }).mark?.status])).toEqual([['r1|2026-09', 'doing'], ['r1|2026-10', 'doing']]);
    expect((w[0] as { mark: CalendarMark }).mark.sampledOn).toBe('2026-09-20');
    expect((w[1] as { mark: CalendarMark }).mark.sampledOn).toBeUndefined();
    const cancelled = new Map([['r1|2026-03', { id: 'r1|2026-03', item: 'r1', month: '2026-03', status: 'cancelled', updatedAt: '' } as CalendarMark]]);
    expect((roundEdits(r, '2026-03', { sampledOn: '2026-03-02' }, cancelled)[0] as { mark: CalendarMark }).mark.status).toBe('cancelled');
  });

  it('lists the rounds under way or overdue, most pressing first', () => {
    const marks: CalendarMark[] = [{ id: markId('r1', '2026-06'), item: 'r1', month: '2026-06', labSentOn: '2026-06-02', lab: 'ALS', updatedAt: '' }];
    const s = sheetWith({ marks, samples: [{ siteId: 's1', date: '2026-03-04' }] });
    const list = openRounds(s, opts('2026-06-20'), '2026-01');
    expect(list.map((r) => [r.month, r.overdue?.kind])).toEqual([
      ['2026-03', 'send'],
      ['2026-06', 'lab'],
    ]);
  });
});

describe('old results imported later', () => {
  it('an import long after the sampling isn’t when the results came back, and a report sent after the sampling covers them', () => {
    const ob = { id: 'o1', projectId: 'p1', name: 'Quarterly summary', every: 3, unit: 'month', firstPeriodStart: '2026-01-01', firstPeriodEnd: '2026-03-31', firstDueDate: '2026-04-30', active: true, submissions: [{ periodStart: '2026-01-01', periodEnd: '2026-03-31', submittedOn: '2026-04-20' }] } as ReportObligation;
    const s = sheetWith({ samples: [{ siteId: 's1', date: '2026-03-04', importId: 'old' }], imported: new Map([['old', '2026-10-19']]), obligations: [ob] });
    const r = roundOf(s, row(), '2026-03', opts('2026-10-20'))!;
    expect(r.stages.results).toMatchObject({ done: true, date: '2026-03-04', from: 'in EnviroDB' });
    expect(r.stages.sent).toMatchObject({ done: true, date: '2026-04-20' });
    // without the report: overdue long ago, not "due next week"
    const bare = sheetWith({ samples: [{ siteId: 's1', date: '2026-03-04', importId: 'old' }], imported: new Map([['old', '2026-10-19']]) });
    expect(roundOf(bare, row(), '2026-03', opts('2026-10-20'))!.overdue).toMatchObject({ kind: 'send', due: '2026-03-11' });
  });
});
