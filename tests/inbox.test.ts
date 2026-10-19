import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import type { InboxFile, Project } from '../src/db/types';
import { sniffLabFile } from '../src/importers/sniff';
import { memoryFolder } from '../src/sync/folder';
import { findLabFiles, inboxKey, projectFolderPath } from '../src/sync/inbox';
import { segmentOf } from '../src/sync/model';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const file = (name: string, body: BlobPart, lastModified = Date.now()) => new File([body], name, { lastModified });

async function workbook(creator: string, heading: string): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = creator;
  const ws = wb.addWorksheet('Results');
  ws.addRow([heading, '9100001']);
  ws.addRow(['Sample', 'pH', 'EC']);
  ws.addRow(['SW1', 7.2, 410]);
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

const project = (p: Partial<Project> & { id: string }): Project => ({ name: p.id, status: 'active', ...p }) as Project;

describe('telling lab files from the rest', () => {
  it('knows the labs’ CSV files', async () => {
    expect(await sniffLabFile(file('9100001.csv', fixture('hill-ssfc-synthetic.csv')))).toMatchObject({ lab: true, labName: 'Hill Labs' });
    expect(await sniffLabFile(file('export.csv', fixture('als-esdat-synthetic.csv')))).toMatchObject({ lab: true, labName: 'ALS' });
    expect(await sniffLabFile(file('report.csv', fixture('linnaeus-report-synthetic.csv')))).toMatchObject({ lab: true, labName: 'Linnaeus' });
    expect((await sniffLabFile(file('download.csv', fixture('monitoring-export-synthetic.csv')))).lab).toBe(true);
  });

  it('leaves out photos, temporary files, plain notes and EnviroDB’s own spreadsheets', async () => {
    expect((await sniffLabFile(file('IMG_0042.jpg', 'x'))).lab).toBe(false);
    expect((await sniffLabFile(file('~$results.xlsx', 'x'))).lab).toBe(false);
    expect((await sniffLabFile(file('README.txt', 'Save lab result files here.'))).lab).toBe(false);
    const ours = await workbook('EnviroDB 1.2.0', 'Laboratory Job Number');
    expect(await sniffLabFile(file('Results 2026.xlsx', ours))).toMatchObject({ lab: false, why: 'made by EnviroDB' });
  });

  it('reads a lab’s spreadsheet headings', async () => {
    const lab = await workbook('Lab system', 'Laboratory Job Number');
    expect((await sniffLabFile(file('Job.xlsx', lab))).lab).toBe(true);
    const plain = await workbook('Someone', 'Budget');
    expect((await sniffLabFile(file('Budget.xlsx', plain))).lab).toBe(false);
  });

  it('takes PDFs by their name, and zips by what’s in them', async () => {
    expect((await sniffLabFile(file('COA 9100001.pdf', '%PDF'))).lab).toBe(true);
    expect((await sniffLabFile(file('Site photos.pdf', '%PDF'), 'Lab/Site photos.pdf')).lab).toBe(false);
    const zip = new JSZip();
    zip.file('9100001.csv', 'x');
    zip.file('COA 9100001.pdf', 'x');
    expect(await sniffLabFile(file('attachments.zip', await zip.generateAsync({ type: 'arraybuffer' })))).toMatchObject({ lab: true, why: 'a zip of lab files' });
  });
});

describe('where a project’s lab files are', () => {
  it('uses the lab folder chosen', () => {
    expect(projectFolderPath({ labFolder: '/Clients/Kōwhai/Lab results/', folder: 'G:\\Projects\\Other' }, 'Projects')).toBe('Clients/Kōwhai/Lab results');
  });
  it('or the project’s folder when it runs through the projects folder', () => {
    expect(projectFolderPath({ folder: 'G:\\Projects\\Clients\\Kōwhai' }, 'projects')).toBe('Clients/Kōwhai');
    expect(projectFolderPath({ folder: 'G:\\Work\\Kōwhai' }, 'Projects')).toBeUndefined();
    expect(projectFolderPath({ folder: 'https://example.sharepoint.com/sites/x' }, 'Projects')).toBeUndefined();
    expect(projectFolderPath({ folder: 'G:\\Projects' }, 'Projects')).toBeUndefined();
    expect(projectFolderPath({ folder: 'G:\\Projects\\Kōwhai' })).toBeUndefined();
  });
  it('keeps what’s been done with a file with the project, or the inbox', () => {
    expect(segmentOf('inbox', { projectId: 'p1' })).toBe('project.p1');
    expect(segmentOf('inbox', {})).toBe('inbox');
  });
});

describe('finding new lab files', () => {
  const t = Date.UTC(2026, 9, 1);
  const hill = fixture('hill-ssfc-synthetic.csv');

  function folders() {
    const ws = memoryFolder('Workspace');
    ws.files.set('changes/a.json', { text: '{}', lastModified: t });
    ws.files.set('Inbox/README.txt', { text: 'Save lab result files here.', lastModified: t });
    ws.files.set('Inbox/DEMO-001 9100001.csv', { text: hill, lastModified: t + 1000 });
    ws.files.set('Inbox/Other job.csv', { text: hill, lastModified: t + 2000 });
    const root = memoryFolder('Projects');
    root.files.set('Clients/Kowhai/Lab/2026-09/9100002.csv', { text: hill, lastModified: t + 3000 });
    root.files.set('Clients/Kowhai/Lab/2026-09/photo.jpg', { text: 'x', lastModified: t + 3000 });
    root.files.set('Clients/Kowhai/Lab/old/9000000.csv', { text: hill, lastModified: t });
    root.files.set('Clients/Kowhai/Lab/2019/9000001.csv', { text: hill, lastModified: Date.UTC(2019, 0, 1) });
    root.files.set('Clients/Kowhai/Report.pdf', { text: '%PDF', lastModified: t });
    return { ws, root };
  }
  const projects = [
    project({ id: 'demo', code: 'DEMO-001' }),
    project({ id: 'kowhai', code: 'KOW', folder: 'G:\\Projects\\Clients\\Kowhai' }),
    project({ id: 'gone', labFolder: 'Clients/Gone' }),
  ];

  it('lists the inbox’s and the projects’ lab files, newest first', async () => {
    const { ws, root } = folders();
    const r = await findLabFiles({ workspace: ws, root: { name: root.name, folder: root }, projects, done: [], now: t });
    expect(r.hasInbox).toBe(true);
    expect(r.files.map((f) => [f.where, f.path, f.projectId ?? null, f.projectKnown])).toEqual([
      ['project', 'Clients/Kowhai/Lab/2026-09/9100002.csv', 'kowhai', true],
      ['inbox', 'Inbox/Other job.csv', null, false],
      ['inbox', 'Inbox/DEMO-001 9100001.csv', 'demo', false],
    ]);
    expect(r.files[0].labName).toBe('Hill Labs');
    expect(r.others).toBe(2); // the README and the report (the photo isn't opened; old folders and old files aren't looked at)
    expect(r.missing).toEqual([{ projectId: 'gone', path: 'Clients/Gone' }]);
  });

  it('leaves out files imported or set aside, until they change', async () => {
    const { ws, root } = folders();
    const size = new TextEncoder().encode(hill).length;
    const done: InboxFile[] = [
      { id: inboxKey('inbox', 'Inbox/Other job.csv', size, t + 2000), where: 'inbox', path: 'Inbox/Other job.csv', name: 'Other job.csv', size, modified: t + 2000, status: 'dismissed', at: '' },
      { id: inboxKey('project', 'Clients/Kowhai/Lab/2026-09/9100002.csv', size, t), where: 'project', path: 'Clients/Kowhai/Lab/2026-09/9100002.csv', name: '9100002.csv', size, modified: t, status: 'imported', at: '' },
    ];
    const r = await findLabFiles({ workspace: ws, root: { name: root.name, folder: root }, projects, done, now: t });
    expect(r.files.map((f) => [f.path, f.amended])).toEqual([
      ['Clients/Kowhai/Lab/2026-09/9100002.csv', true],
      ['Inbox/DEMO-001 9100001.csv', false],
    ]);
  });

  it('works without an inbox or a projects folder', async () => {
    const ws = memoryFolder('Workspace');
    ws.files.set('changes/a.json', { text: '{}', lastModified: t });
    expect(await findLabFiles({ workspace: ws, root: null, projects, done: [], now: t })).toEqual({ files: [], others: 0, missing: [], hasInbox: false });
    expect(await findLabFiles({ workspace: null, root: null, projects, done: [], now: t })).toEqual({ files: [], others: 0, missing: [], hasInbox: false });
  });
});
