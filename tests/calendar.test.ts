import { describe, expect, it } from 'vitest';
import {
  buildSheet, cellValue, monthText, planFromProject, plannedIn, reportsDueIn, resultsByMonth, rowMonths, scheduleSymbols, setWindow, statusFromFill, toggleSymbol, windowRange, windowsOf,
} from '../src/lib/calendar';
import { cellEdit, fromTsv, noteEdit, statusEdits, symbolEdits, toTsv, windowEdits } from '../src/lib/calendarEdits';
import { newCalendarRow, newObligation, newProject, newSchedule } from '../src/db/repo';
import type { CalendarMark, CalendarRow } from '../src/db/types';

const months = (...texts: string[]) => [...texts, ...Array(12 - texts.length).fill('')];
const row = (patch: Partial<CalendarRow> = {}) => newCalendarRow({ id: 'r1', ...patch });

describe('the monitoring calendar: sampling windows', () => {
  it('finds windows from "(" to ")", one over the new year too', () => {
    const w = windowsOf(months('(', '', ')', '●', '(●▲)'));
    expect(w.slice(0, 5).map((x) => [x.inWindow, x.start, x.end, x.span])).toEqual([
      [true, true, false, 3],
      [true, false, false, 0],
      [true, false, true, 0],
      [false, false, false, 0],
      [true, true, true, 1],
    ]);
    // December to February
    const wrap = windowsOf(['', ')', '', '', '', '', '', '', '', '', '', '(#']);
    expect(wrap.map((x) => x.inWindow)).toEqual([true, true, false, false, false, false, false, false, false, false, false, true]);
    expect([wrap[1].end, wrap[0].start, wrap[11].start, wrap[11].span]).toEqual([true, false, true, 1]);
    expect(windowRange(windowsOf(months('(', '', ')')), 1)).toEqual([0, 2]);
    expect(windowRange(windowsOf(months('●')), 0)).toEqual([0, 0]);
  });

  it('shows a month without the brackets and underscores, and knows what is planned', () => {
    expect(monthText('(GW1 to GW8 X')).toBe('GW1 to GW8 X');
    expect(monthText('(__#__')).toBe('#');
    expect(monthText(')')).toBe('');
    const r = row({ m01: '(', m03: ')', m05: '●' });
    expect([0, 1, 2, 3, 4].map((i) => plannedIn(r, i))).toEqual([true, true, true, false, true]);
  });

  it('adds and takes out marks, keeping the window brackets', () => {
    expect(toggleSymbol('●', '▲', true)).toBe('●▲');
    expect(toggleSymbol('●)', '#', true)).toBe('●#)');
    expect(toggleSymbol('(●', '#', true)).toBe('(●#');
    expect(toggleSymbol('●▲', '●', false)).toBe('▲');
    expect(toggleSymbol('(●', '●', false)).toBe('(');
  });

  it('makes months a window, and takes one away', () => {
    expect(setWindow(months('', '●', '', ''), 1, 3, true).slice(0, 4)).toEqual(['', '(●', '', ')']);
    expect(setWindow(months('', '(●', '', ')'), 2, 2, false).slice(0, 4)).toEqual(['', '●', '', '']);
    // a new window over part of an old one replaces it
    expect(setWindow(months('(', '', ')', ''), 1, 3, true).slice(0, 4)).toEqual(['', '(', '', ')']);
  });
});

describe('the monitoring calendar: filled in from a project', () => {
  const monthly = newSchedule('p1', { id: 'monthly', name: 'GW2', siteIds: ['gw2'], every: 1, unit: 'month', startDate: '2025-01-01' });
  const quarterly = newSchedule('p1', { id: 'quarterly', name: 'All bores', siteIds: ['gw1', 'gw2'], every: 3, unit: 'month', startDate: '2025-03-01' });
  const six = newSchedule('p1', { id: 'six', name: 'River', siteIds: ['us'], every: 6, unit: 'month', startDate: '2026-01-01', window: 3, symbol: '◆' });
  const weekly = newSchedule('p1', { id: 'weekly', name: 'Discharge', siteIds: ['dp'], every: 1, unit: 'week', startDate: '2026-01-05' });
  const annual = newObligation('p1', { id: 'annual', name: 'Annual report', every: 1, unit: 'year', firstPeriodStart: '2025-07-01', firstPeriodEnd: '2026-06-30', firstDueDate: '2026-09-30', submissions: [] });
  const codes = new Map([['gw1', 'GW1'], ['gw2', 'GW2'], ['us', 'US'], ['dp', 'DP']]);

  it('gives each schedule its own mark, keeping the ones chosen', () => {
    const s = scheduleSymbols([monthly, quarterly, six]);
    expect([s.get('monthly'), s.get('quarterly'), s.get('six')]).toEqual(['●', '▲', '◆']);
  });

  it('puts each schedule’s mark in the months its rounds start, windows over the months to sample in, R where reports are due', () => {
    const plan = planFromProject([monthly, quarterly, six, weekly], [annual], 2026, codes);
    expect(Object.values(plan.months)).toHaveLength(12);
    expect(plan.months).toMatchObject({ m01: '(●◆■', m02: '●■', m03: '●▲■)', m06: '●▲■', m07: '(●◆■', m09: '●▲■R)', m12: '●▲■' });
    expect(plan.details).toBe('● = GW2 (monthly: GW2); ▲ = All bores (quarterly: GW1, GW2); ◆ = River (six-monthly: US); ■ = Discharge (weekly: DP); R = report due');
    expect(plan.reportDue).toBe('Annual report – 30 September');
    // schedules that are off are left out
    expect(planFromProject([{ ...monthly, active: false }], [], 2026).months).toEqual({});
  });

  it('knows the months results came in at a row’s sites, and the reports due', () => {
    const samples = [
      { siteId: 'gw1', date: '2026-03-02T10:00' },
      { siteId: 'gw2', date: '2026-03-02' },
      { siteId: 'gw2', date: '2026-03-20' },
      { siteId: 'us', date: '2026-04-01' },
    ];
    const all = resultsByMonth(samples);
    expect(all.get('2026-03')).toEqual({ days: ['2026-03-02', '2026-03-20'], sites: ['gw1', 'gw2'] });
    expect(resultsByMonth(samples, ['us']).has('2026-03')).toBe(false);
    expect(reportsDueIn([annual], 2026)).toEqual([{ obligationId: 'annual', name: 'Annual report', index: 0, due: '2026-09-30', submitted: undefined }]);
    expect(reportsDueIn([annual], 2027).map((r) => r.due)).toEqual(['2027-09-30']);
  });
});

describe('the monitoring calendar: cells', () => {
  const project = newProject({ id: 'p1', name: 'Closed landfill', code: 'J-100', consents: 'RC 1' });

  it('shows a project’s details on its rows, and changes the project’s when they change', () => {
    const r = row({ projectId: 'p1', jobCode: 'old code' });
    expect(cellValue(r, 'job', project)).toBe('Closed landfill');
    expect(cellValue(r, 'jobCode', project)).toBe('J-100');
    expect(cellValue(r, 'jobCode')).toBe('old code');
    expect(cellEdit(r, 'jobCode', ' J-101 ', project)).toEqual({ t: 'project', id: 'p1', set: { code: 'J-101' } });
    expect(cellEdit(r, 'job', 'Closed landfill', project)).toEqual({ t: 'row', id: 'r1', set: { job: '' } });
    expect(cellEdit(r, 'job', 'Closed landfill – gas', project)).toEqual({ t: 'row', id: 'r1', set: { job: 'Closed landfill – gas' } });
    expect(cellEdit(r, 'm03', '  ')).toEqual({ t: 'row', id: 'r1', set: { m03: undefined } });
    expect(cellEdit(r, 'notes', 'Line one\r\nline two')).toEqual({ t: 'row', id: 'r1', set: { notes: 'Line one\nline two' } });
  });

  it('colours cells for the year – a window all together – and clears them when they have the colour already', () => {
    const r = row({ m01: '(', m03: ')', m05: '●' });
    const marks = new Map<string, CalendarMark>();
    const edits = statusEdits([{ row: r, key: 'm02' }, { row: r, key: 'reportDue' }], 'done', 2026, marks);
    expect(edits.map((e) => e.id)).toEqual(['r1|2026-01', 'r1|2026-02', 'r1|2026-03', 'r1|2026|reportDue']);
    expect(edits[3]).toMatchObject({ t: 'mark', mark: { item: 'r1', month: '2026', field: 'reportDue', status: 'done' } });
    for (const e of edits) if (e.t === 'mark' && e.mark) marks.set(e.id, e.mark);
    // again: off (a month with a note keeps it)
    marks.set('r1|2026-01', { ...marks.get('r1|2026-01')!, note: 'Sent 3 Feb' });
    const off = statusEdits([{ row: r, key: 'm01' }], 'done', 2026, marks);
    expect(off.map((e) => (e.t === 'mark' ? e.mark && { status: e.mark.status, note: e.mark.note } : null))).toEqual([{ status: undefined, note: 'Sent 3 Feb' }, null, null]);
    // a different colour replaces it
    expect(statusEdits([{ row: r, key: 'm05' }], 'doing', 2026, marks).map((e) => e.t === 'mark' && e.mark?.status)).toEqual(['doing']);
    expect(noteEdit(r, '2026-05', '', marks)).toEqual({ t: 'mark', id: 'r1|2026-05', mark: null });
  });

  it('adds a mark to the months selected, or takes it out of all of them', () => {
    const r = row({ m01: '●', m02: '' });
    expect(symbolEdits([{ row: r, key: 'm01' }, { row: r, key: 'm02' }], '●')).toEqual([
      { t: 'row', id: 'r1', set: { m01: '●' } },
      { t: 'row', id: 'r1', set: { m02: '●' } },
    ]);
    const both = row({ m01: '●', m02: '●▲' });
    expect(symbolEdits([{ row: both, key: 'm01' }, { row: both, key: 'm02' }], '●').map((e) => e.t === 'row' && e.set)).toEqual([{ m01: undefined }, { m02: '▲' }]);
  });

  it('makes a window over the months selected, and undoes it', () => {
    const r = row({ m02: '●' });
    const [on] = windowEdits([r], 1, 3);
    expect(on).toEqual({ t: 'row', id: 'r1', set: { m02: '(●', m04: ')' } });
    const [off] = windowEdits([{ ...r, m02: '(●', m04: ')' }], 1, 3);
    expect(off).toEqual({ t: 'row', id: 'r1', set: { m02: '●', m04: undefined } });
  });

  it('copies and pastes cells as Excel does', () => {
    const grid = [['●', 'Two\nlines'], ['say "hi"', '']];
    expect(fromTsv(toTsv(grid))).toEqual(grid);
    expect(fromTsv('a\tb\r\nc\td\r\n')).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('builds the sheet with what EnviroDB knows about each row’s project', () => {
    const rows = [row({ id: 'b', order: 2, projectId: 'p1', siteIds: ['gw1'] }), row({ id: 'a', order: 1, job: 'Another job' })];
    const sheet = buildSheet(
      {
        rows,
        marks: [{ id: 'b|2026-03', item: 'b', month: '2026-03', status: 'done', updatedAt: '' }],
        projects: [project],
        samples: [
          { projectId: 'p1', siteId: 'gw1', date: '2026-03-02' },
          { projectId: 'p1', siteId: 'gw2', date: '2026-04-02' },
        ],
        obligations: [],
        sites: [],
      },
      2026,
    );
    expect(sheet.rows.map((r) => r.id)).toEqual(['a', 'b']);
    expect([...sheet.facts.get('b')!.results.keys()]).toEqual(['2026-03']);
    expect(sheet.facts.has('a')).toBe(false);
    expect(sheet.marks.get('b|2026-03')?.status).toBe('done');
    expect(rowMonths(rows[0])).toHaveLength(12);
  });
});

describe('spreadsheet colours', () => {
  it('reads green as done, yellow or orange as doing, pink or red as cancelled, bright yellow as a highlight', () => {
    expect(['E2F0D9', 'C6EFCE', 'FFC5E0B4', 'FFE699', 'FFEB9C', 'FFC000', 'FFD9D9', 'FFC7CE', 'FF0000', 'FFFF00', 'FFFFFF', 'D9D9D9', '4472C4', undefined].map(statusFromFill)).toEqual([
      'done', 'done', 'done', 'doing', 'doing', 'doing', 'cancelled', 'cancelled', 'cancelled', 'highlight', null, null, null, null,
    ]);
  });
});
