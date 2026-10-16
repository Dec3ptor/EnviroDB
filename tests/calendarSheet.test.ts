import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { db } from '../src/db/db';
import { newProject } from '../src/db/repo';
import { commitCalendarImport, readCalendarWorkbook, suggestProject } from '../src/importers/calendarSheet';
import { buildCalendarWorkbook } from '../src/reports/calendarExcel';
import { buildSheet } from '../src/lib/calendar';

// A made-up monitoring schedule spreadsheet laid out like a team's "Schedule All Monitoring" sheet.
const GREEN = 'FFE2F0D9';
const YELLOW = 'FFFFE699';
const PINK = 'FFFFD9D9';
const BRIGHT = 'FFFFFF00';

async function synthetic(): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Schedule All Monitoring');
  const fill = (addr: string, argb: string) => (ws.getCell(addr).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } });
  ws.getCell('B1').value = 'Job Code';
  ws.getCell('C1').value = 'Purchase Order No';
  ws.getCell('D1').value = 'Monitoring Schedule';
  ws.mergeCells('D1:O1');
  ws.mergeCells('A1:A3');
  ws.mergeCells('B1:B3');
  ws.mergeCells('C1:C3');
  const names = ['Jan', 'Feb', 'Mar', 'April', 'May', 'June', 'July', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  names.forEach((n, i) => {
    ws.getCell(2, 4 + i).value = i + 1;
    ws.getCell(3, 4 + i).value = n;
  });
  ['Monitoring Schedule Details', 'Monitoring Notes', 'Annual Report Due', 'Management Plan', 'NOTES', 'Consents', 'Folder link'].forEach((t, i) => (ws.getCell(1, 16 + i).value = t));
  // 4: monthly and quarterly marks, the first months done, March under way
  ws.getRow(4).values = ['Riverside Landfill', 'J-1001 / 01', 'PO-55', '●', '●', '●▲', '●', '●', '●▲', '●', '●', '●▲', '●', '●', '●▲', '● = GW1  ▲ = all bores', 'Results to the council\nwith the field sheets', 'October', '', '', 'RC 1234', 'G:\\Projects\\Riverside'];
  ['D4', 'E4'].forEach((a) => fill(a, GREEN));
  fill('F4', YELLOW);
  fill('R4', BRIGHT);
  // 5: sampling windows as merged cells, the first done
  ws.getCell('A5').value = 'Hilltop WWTP';
  ws.getCell('D5').value = '(_______________)';
  ws.mergeCells('D5:F5');
  ['D5', 'E5', 'F5'].forEach((a) => fill(a, GREEN));
  ws.getCell('J5').value = '(__GW1 to GW4_X_)';
  ws.mergeCells('J5:L5');
  ws.getCell('P5').value = 'Stormwater, 2 samples';
  // 6: on hold – the whole row pink
  ws.getRow(6).values = ['Hilltop WWTP', 'J-1002', '', '(____)'];
  ws.mergeCells('D6:E6');
  ['A6', 'B6', 'D6', 'E6', 'F6'].forEach((a) => fill(a, PINK));
  // 7 and 8: a window over the new year, and a note merged down over two rows
  ws.getRow(7).values = ['Lakeside Compost', '', '', '__________', '_________________)', '', '', '', '', '', '', '', '', '', '(_#__'];
  ws.getRow(8).values = ['Lakeside Compost', '', '', '', '', '', '', 'R'];
  ws.getCell('Q7').value = 'Check access with the farmer';
  ws.mergeCells('Q7:Q8');
  fill('K8', GREEN);
  // the legend
  ws.getCell('A10').value = 'DONT MARK GREEN UNTIL RESULTS SENT OR REPORTED';
  fill('A10', 'FFC5E0B4');
  ws.getCell('B10').value = 'DONE';
  ws.getCell('A11').value = '●';
  ws.getCell('B11').value = 'TO DO';
  ws.getCell('A12').value = 'More rows after the legend are not read';
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

describe('importing a monitoring schedule spreadsheet', () => {
  let data: Awaited<ReturnType<typeof readCalendarWorkbook>>;
  beforeAll(async () => {
    data = await readCalendarWorkbook(await synthetic());
  });

  it('finds the months, the columns and the rows down to the legend', () => {
    expect(data.sheet).toBe('Schedule All Monitoring');
    expect(data.found.sort()).toEqual(['consents', 'details', 'folder', 'job', 'jobCode', 'managementPlan', 'notes', 'other', 'purchaseOrder', 'reportDue']);
    expect(data.rows.map((r) => [r.line, r.row.job])).toEqual([
      [4, 'Riverside Landfill'],
      [5, 'Hilltop WWTP'],
      [6, 'Hilltop WWTP'],
      [7, 'Lakeside Compost'],
      [8, 'Lakeside Compost'],
    ]);
  });

  it('reads the marks, notes and colours', () => {
    const [river] = data.rows;
    expect(river.row).toMatchObject({ jobCode: 'J-1001 / 01', purchaseOrder: 'PO-55', m01: '●', m03: '●▲', details: '● = GW1  ▲ = all bores', notes: 'Results to the council\nwith the field sheets', reportDue: 'October', consents: 'RC 1234', folder: 'G:\\Projects\\Riverside' });
    expect(river.months.slice(0, 4)).toEqual(['done', 'done', 'doing', undefined]);
    expect(river.row.highlight).toEqual(['reportDue']);
  });

  it('turns cells merged over months into sampling windows', () => {
    const hill = data.rows[1];
    expect([hill.row.m01, hill.row.m02, hill.row.m03, hill.row.m07, hill.row.m09]).toEqual(['(', undefined, ')', '(GW1 to GW4 X', ')']);
    expect(hill.months.slice(0, 4)).toEqual(['done', 'done', 'done', undefined]);
  });

  it('puts a row shaded pink on hold', () => {
    const held = data.rows[2];
    expect(held.row.onHold).toBe(true);
    expect(held.months.every((m) => m === undefined)).toBe(true);
  });

  it('reads a window over the new year, and a note merged down over rows', () => {
    const [a, b] = data.rows.slice(3);
    expect([a.row.m01, a.row.m02, a.row.m12]).toEqual([undefined, ')', '(#']);
    expect([a.row.notes, b.row.notes]).toEqual(['Check access with the farmer', 'Check access with the farmer']);
    expect([b.row.m05, b.months[7]]).toEqual(['R', 'done']);
  });

  it('matches rows to projects by job code, then name', () => {
    const projects = [newProject({ id: 'a', name: 'Riverside', code: 'J-1001' }), newProject({ id: 'b', name: 'Lakeside compost' })];
    expect(data.rows.map((r) => suggestProject(r.row, projects)?.id ?? null)).toEqual(['a', null, null, 'b', 'b']);
  });
});

describe('the calendar onto a spreadsheet and back', () => {
  it('puts the rows on the calendar, linked to their projects, coloured for the year', async () => {
    const data = await readCalendarWorkbook(await synthetic());
    const riverside = newProject({ id: 'riv', name: 'Riverside Landfill' });
    await db.projects.put(riverside);
    const res = await commitCalendarImport(data.rows, ['riv', null, null, null, null], { year: 2026, replace: true, makeProjects: true });
    expect(res).toEqual({ rows: 5, projects: 2 });
    const rows = (await db.calendarRows.toArray()).sort((x, y) => x.order - y.order);
    expect(rows.map((r) => [r.job, !!r.projectId])).toEqual([
      ['', true], // shows the project's name
      ['', true],
      ['', true], // both Hilltop rows, one new project
      ['', true],
      ['', true],
    ]);
    expect(new Set(rows.slice(1, 3).map((r) => r.projectId)).size).toBe(1);
    // the project gets the row's job code, PO, consents and folder
    expect(await db.projects.get('riv')).toMatchObject({ code: 'J-1001 / 01', purchaseOrder: 'PO-55', consents: 'RC 1234', folder: 'G:\\Projects\\Riverside' });
    const marks = await db.calendarMarks.toArray();
    expect(marks.filter((m) => m.item === rows[0].id).map((m) => [m.month, m.status]).sort()).toEqual([
      ['2026-01', 'done'],
      ['2026-02', 'done'],
      ['2026-03', 'doing'],
    ]);

    // and out again, in the spreadsheet's layout: it reads back the same
    const sheet = buildSheet({ rows, marks, projects: await db.projects.toArray(), samples: [], obligations: [], sites: [] }, 2026);
    const back = await readCalendarWorkbook(await buildCalendarWorkbook(sheet, sheet.rows, 2026));
    expect(back.year).toBe(2026);
    expect(back.rows.map((r) => r.row.job)).toEqual(['Riverside Landfill', 'Hilltop WWTP', 'Hilltop WWTP', 'Lakeside Compost', 'Lakeside Compost']);
    const fields = ['m01', 'm02', 'm03', 'm07', 'm09', 'm12', 'details', 'notes', 'reportDue', 'onHold', 'highlight'] as const;
    const pick = (r: Record<string, unknown>) => Object.fromEntries(fields.map((f) => [f, r[f]]));
    expect(back.rows.map((r) => pick(r.row))).toEqual(data.rows.map((r) => pick(r.row)));
    expect(back.rows.map((r) => r.months)).toEqual(data.rows.map((r) => r.months));
  });
});
