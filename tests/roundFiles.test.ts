import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { memoryFolder } from '../src/sync/folder';

const folder = memoryFolder('Workspace');
vi.mock('../src/sync/workspace', async (orig) => ({ ...(await orig<typeof import('../src/sync/workspace')>()), currentWorkspaceFolder: () => folder }));

const { db, DEFAULT_SETTINGS, ensureBuiltIns } = await import('../src/db/db');
const { createDemoProject } = await import('../src/db/demo');
const { exportProjectPackage, importProjectPackage } = await import('../src/db/backup');
const { addProjectFiles, linkedSampleIds, filesBySample, fileIsAbout, roundSpan, roundName, roundFiles, roundForms, linkProjectFile, samplesByImport } = await import('../src/lib/projectFiles');
const { periodFiles, loadAttachments, attachedTitle, attachedRefs, printable, sameRefs } = await import('../src/lib/attachments');
const { buildReport } = await import('../src/reports/build');
const { preIssueChecks } = await import('../src/reports/checks');
const { snapshotContent, diffSnapshots } = await import('../src/lib/issued');
const { loadBundle } = await import('./helpers');
import type { CalendarRow, ProjectFile, ReportTemplate } from '../src/db/types';
import type { DocNode } from '../src/reports/model';
import type { AttachedDoc } from '../src/lib/attachments';

const row = (x: Partial<CalendarRow> & { id: string }): CalendarRow => ({ order: 0, job: '', updatedAt: '', ...x }) as CalendarRow;
const S = (id: string, date: string, siteId = 'a', extra: Record<string, unknown> = {}) => ({ id, projectId: 'p', siteId, date, labJob: undefined as string | undefined, ...extra });
const none = new Map<string, Set<string>>();

describe('a file linked to a sampling round', () => {
  // a row sampled each month, and one with a window over October–December, for bores b and c only
  const monthly = row({ id: 'r1', m10: '●', m11: '●' });
  const windowed = row({ id: 'r2', job: 'Groundwater', siteIds: ['b', 'c'], m10: '(▲', m11: '', m12: ')' });
  const rows = new Map([monthly, windowed].map((r) => [r.id, r]));
  const samples = [S('s1', '2026-10-09T09:00', 'a'), S('s2', '2026-10-09T10:00', 'b'), S('s3', '2026-11-20', 'b'), S('s4', '2026-12-02', 'c'), S('s5', '2026-11-21', 'a'), S('q1', '2026-12-02', 'qc', { qc: 'duplicate' }), S('s6', '2027-01-05', 'b')];

  it('is about the month’s samples – a calendar row’s whole window, at the row’s sites', () => {
    expect(roundSpan({ month: '2026-10' })).toEqual({ months: ['2026-10'] });
    expect(roundSpan({ month: '2026-10', row: 'r1' }, rows)).toEqual({ months: ['2026-10'], siteIds: undefined });
    expect(roundSpan({ month: '2026-10', row: 'r2' }, rows)).toEqual({ months: ['2026-10', '2026-11', '2026-12'], siteIds: ['b', 'c'] });
    // the row has gone: the month, every site
    expect(roundSpan({ month: '2026-10', row: 'gone' }, rows)).toEqual({ months: ['2026-10'] });
    const ids = (linked: ProjectFile['linked']) => linkedSampleIds({ linked }, samples, none, rows);
    expect(ids({ kind: 'round', month: '2026-10' })).toEqual(['s1', 's2']);
    expect(ids({ kind: 'round', month: '2026-10', row: 'r1' })).toEqual(['s1', 's2']);
    // the window's bores – and the duplicate taken with them, whatever site it's kept under
    expect(ids({ kind: 'round', month: '2026-10', row: 'r2' })).toEqual(['s2', 's3', 's4', 'q1']);
    expect(ids({ kind: 'round', month: '2026-09' })).toEqual([]);
  });

  it('shows with each of those samples', () => {
    const f = { id: 'f1', linked: { kind: 'round', month: '2026-10', row: 'r2' } } as ProjectFile;
    expect([...filesBySample([f], samples, none, rows).keys()]).toEqual(['s2', 's3', 's4', 'q1']);
    expect(fileIsAbout(f, { ...samples[1], importId: undefined }, [], rows)).toBe(true);
    expect(fileIsAbout(f, { ...samples[0], importId: undefined }, [], rows)).toBe(false);
    // without the calendar's rows it's the month alone
    expect(fileIsAbout(f, { ...samples[2], importId: undefined }, [])).toBe(false);
  });

  it('in words, and in its round’s dialog', () => {
    expect(roundName({ month: '2026-10' })).toBe('October 2026');
    expect(roundName({ month: '2026-10', row: 'r2' }, rows)).toBe('October – December 2026');
    expect(roundName({ month: '2026-10', row: 'r2' }, rows, true)).toBe('October – December 2026 (Groundwater)');
    expect(roundName({ month: '2026-11', row: 'r1' }, rows, true)).toBe('November 2026');
    const files = [
      { id: 'a', linked: { kind: 'round', month: '2026-10', row: 'r2' } },
      { id: 'b', linked: { kind: 'round', month: '2026-10' } },
      { id: 'c', linked: { kind: 'round', month: '2026-10', row: 'r1' } },
      { id: 'd', linked: { kind: 'round', month: '2027-01', row: 'r2' } },
      { id: 'e', linked: { kind: 'job', job: '1' } },
      { id: 'f', eachRound: true, path: 'Project files/P/form.pdf' },
      { id: 'g', eachRound: true, href: 'https://x.test/form.pdf' },
    ] as ProjectFile[];
    // the row's own, and those linked to the month alone
    expect(roundFiles(files, { row: 'r2', months: ['2026-10', '2026-11', '2026-12'] }).map((f) => f.id)).toEqual(['a', 'b']);
    expect(roundFiles(files, { row: 'r1', months: ['2026-10'] }).map((f) => f.id)).toEqual(['b', 'c']);
    expect(roundForms(files).map((f) => f.id)).toEqual(['f']);
  });
});

describe('with a project: added to a round, put in a report', () => {
  let projectId = '';
  let oct: { id: string; date: string; labJob?: string; siteId: string }[] = [];
  const pdf = (name: string, text = 'x') => new File([`%PDF-1.4 ${text}`], name, { type: 'application/pdf' });
  beforeAll(async () => {
    await ensureBuiltIns();
    projectId = await createDemoProject();
    const samples = await db.samples.where('projectId').equals(projectId).toArray();
    oct = samples.filter((s) => s.date.startsWith('2026-10'));
  });

  it('files added to a round are linked to it as they’re added; one there already is linked, not copied', async () => {
    const project = (await db.projects.get(projectId))!;
    const link = { kind: 'round', month: '2026-10' } as const;
    const loose = (await addProjectFiles(project, [pdf('Scan_0007.pdf')], { readText: async () => '' })).added[0];
    expect(loose.linked).toBeUndefined();
    const r = await addProjectFiles(project, [pdf('Scan_0007.pdf'), pdf('Signed form.pdf')], { linked: link, kind: 'coc', readText: async () => '' });
    // (nothing said what it was: it's taken to be the round's chain of custody, as a new file is)
    expect(r.relinked.map((f) => [f.name, f.kind, f.linked])).toEqual([['Scan_0007.pdf', 'coc', link]]);
    expect(r.added.map((f) => [f.name, f.kind, f.linked])).toEqual([['Signed form.pdf', 'coc', link]]);
    // added again: both are there and linked, so nothing happens
    const again = await addProjectFiles(project, [pdf('Scan_0007.pdf')], { linked: link, readText: async () => '' });
    expect(again).toMatchObject({ added: [], relinked: [], skipped: ['Scan_0007.pdf'] });
    // a name that says what it is keeps that kind
    const named = await addProjectFiles(project, [pdf('Field sheet 9 Oct.pdf')], { linked: link, kind: 'coc', readText: async () => '' });
    expect(named.added[0].kind).toBe('field');
    expect(oct.length).toBeGreaterThan(0);
    const all = await db.files.where('projectId').equals(projectId).toArray();
    const samples = await db.samples.where('projectId').equals(projectId).toArray();
    expect(linkedSampleIds(all.find((f) => f.name === 'Signed form.pdf')!, samples, none).sort()).toEqual(oct.map((s) => s.id).sort());
  });

  it('a project file carries a round’s link to the copy’s own calendar row', async () => {
    const calRow = row({ id: 'row-x', projectId, m10: '●' });
    await db.calendarRows.put(calRow);
    const f = (await db.files.where('projectId').equals(projectId).toArray()).find((x) => x.name === 'Signed form.pdf')!;
    await linkProjectFile(f, { kind: 'round', month: '2026-10', row: 'row-x' });
    const copyId = await importProjectPackage(JSON.parse(JSON.stringify(await exportProjectPackage(projectId))));
    const copyRows = await db.calendarRows.where('projectId').equals(copyId).toArray();
    const copied = (await db.files.where('projectId').equals(copyId).toArray()).find((x) => x.name === 'Signed form.pdf')!;
    expect(copyRows).toHaveLength(1);
    expect(copyRows[0].id).not.toBe('row-x');
    expect(copied.linked).toEqual({ kind: 'round', month: '2026-10', row: copyRows[0].id });
    await linkProjectFile(f, { kind: 'round', month: '2026-10' });
  });

  it('a report’s period takes the files about its samples: by kind, in the order sampled', async () => {
    const project = (await db.projects.get(projectId))!;
    const samples = await db.samples.where('projectId').equals(projectId).toArray();
    const results = await db.results.where('projectId').equals(projectId).toArray();
    const job = oct.find((s) => s.labJob)!.labJob!;
    const cert = (await addProjectFiles(project, [pdf(`Hill ${job} certificate.pdf`)], { readText: async () => '' })).added[0];
    await linkProjectFile(cert, { kind: 'job', job });
    await db.files.put({ id: 'f-link', projectId, name: 'Linked report', kind: 'results', href: 'https://x.test/r.pdf', linked: { kind: 'job', job }, addedAt: '2026-11-01T00:00:00Z' });
    await db.files.put({ id: 'f-nov', projectId, name: 'CoC next round.pdf', kind: 'coc', path: 'Project files/DEMO-001/CoC next round.pdf', size: 9, linked: { kind: 'round', month: '2026-12' }, addedAt: '2026-11-01T00:00:00Z' });
    const files = await db.files.where('projectId').equals(projectId).toArray();
    const byImport = samplesByImport(samples, results);
    const pick = (kinds: Array<'results' | 'coc' | 'field'>, start: string, end: string, siteIds?: string[]) => periodFiles({ files, kinds, period: { start, end }, samples, byImport, siteIds }).map((r) => r.name);
    expect(pick(['results'], '2026-10-01', '2026-10-31')).toEqual([`Hill ${job} certificate.pdf`, 'Linked report']);
    expect(pick(['results'], '2026-11-01', '2026-11-30')).toEqual([]);
    // the round's lab results, then its chain of custody and field sheets; a round with no samples yet still counts
    expect(pick(['results', 'coc', 'field'], '2026-10-01', '2026-12-31')).toEqual([`Hill ${job} certificate.pdf`, 'Linked report', 'Scan_0007.pdf', 'Signed form.pdf', 'Field sheet 9 Oct.pdf', 'CoC next round.pdf']);
    expect(pick(['coc'], '2026-12-01', '2026-12-31')).toEqual(['CoC next round.pdf']);
    // only sites that aren't in the lab job: nothing of it
    const other = (await db.sites.where('projectId').equals(projectId).toArray()).filter((s) => !oct.some((x) => x.siteId === s.id)).map((s) => s.id);
    if (other.length) expect(pick(['results'], '2026-10-01', '2026-10-31', other)).toEqual([]);
    const ref = periodFiles({ files, kinds: ['results'], period: { start: '2026-10-01', end: '2026-10-31' }, samples, byImport })[0];
    expect(ref.jobs).toEqual([job]);
    expect(ref.about).toMatch(new RegExp(`^Demo Lab job ${job} – \\d+ samples?, 9 Oct 2026$`));
    expect(attachedTitle(ref)).toBe(`Lab results: Hill ${job} certificate.pdf – ${ref.about}`);
    expect(printable({ b: periodFiles({ files, kinds: ['results'], period: { start: '2026-10-01', end: '2026-10-31' }, samples, byImport }) }).b.map((r) => r.name)).toEqual([`Hill ${job} certificate.pdf`]);
    expect(sameRefs([ref], [{ ...ref }])).toBe(true);
    expect(sameRefs([ref], [{ ...ref, size: 1 }])).toBe(false);
  });

  it('what can’t be put in says why; the rest come with their pages', async () => {
    const page = { dataUrl: 'data:image/jpeg;base64,AAAA', width: 595, height: 842 };
    const docs = await loadAttachments(
      [
        { fileId: 'a', name: 'Link', kind: 'results' },
        { fileId: 'b', name: 'Sheet.xlsx', kind: 'results', path: 'Project files/P/Sheet.xlsx' },
        { fileId: 'c', name: 'Gone.pdf', kind: 'results', path: 'Project files/P/Gone.pdf' },
      ],
      async () => null,
    );
    expect(docs.map((d) => [d.name, d.pages.length, d.missing, !!d.unprintable])).toEqual([
      ['Link', 0, 'a link – only a file kept with the project can be put in', true],
      ['Sheet.xlsx', 0, 'not a PDF or a picture', true],
      ['Gone.pdf', 0, 'not in the shared folder', false],
    ]);
    const kept: Record<string, AttachedDoc[]> = { blk: [{ fileId: 'd', name: 'Report.pdf', kind: 'results', path: 'x', pages: [page], more: 2 }, { ...docs[2] }] };
    expect(attachedRefs(kept)).toEqual({ blk: [{ fileId: 'd', name: 'Report.pdf', kind: 'results', path: 'x' }] });
  });

  it('the report: each page a page to itself, turned to suit; a line over each document', async () => {
    const b = await loadBundle(projectId);
    const template: ReportTemplate = { id: 't', name: 'T', orientation: 'portrait', pageSize: 'A4', marginMm: 20, fontSize: 10, accent: '#0f766e', headerText: '', footerText: '', numbering: true, updatedAt: '', blocks: [{ id: 'h', type: 'heading', text: 'Appendix A', level: 1 }, { id: 'lab', type: 'labReports', kinds: ['results'] }, { id: 'after', type: 'text', text: 'After.', prompt: false }] };
    const period = { start: '2026-10-01', end: '2026-10-31', label: 'October 2026' };
    const page = (w: number, h: number) => ({ dataUrl: 'data:image/jpeg;base64,AAAA', width: w, height: h });
    const docs: AttachedDoc[] = [
      { fileId: 'd1', name: 'Report.pdf', kind: 'results', about: 'Hill Labs job 1 – 3 samples, 9 Oct 2026', pages: [page(595, 842), page(842, 595)], more: 3 },
      { fileId: 'd2', name: 'Sheet.xlsx', kind: 'results', pages: [], missing: 'not a PDF or a picture', unprintable: true },
      { fileId: 'd3', name: 'Gone.pdf', kind: 'results', pages: [], missing: 'not in the shared folder' },
    ];
    const build = (attachments: Record<string, AttachedDoc[]> | undefined, preview = false, blocks = template.blocks) => buildReport({ bundle: b, template: { ...template, blocks }, period, settings: { ...DEFAULT_SETTINGS }, attachments, preview }).nodes;
    const nodes = build({ lab: docs });
    const kinds = nodes.map((n) => n.t);
    expect(kinds).toEqual(['h', 'pagebreak', 'p', 'image', 'pagebreak', 'image', 'pagebreak', 'p']);
    const breaks = nodes.filter((n): n is Extract<DocNode, { t: 'pagebreak' }> => n.t === 'pagebreak');
    // the page after the appendix goes back to the report's own way up
    expect(breaks.map((x) => x.orientation)).toEqual(['portrait', 'landscape', 'portrait']);
    const title = nodes[2] as Extract<DocNode, { t: 'p' }>;
    expect(title.runs.map((r) => r.text).join('')).toBe('Lab results: Report.pdf – Hill Labs job 1 – 3 samples, 9 Oct 2026 (its first 2 pages of 5)');
    const images = nodes.filter((n): n is Extract<DocNode, { t: 'image' }> => n.t === 'image');
    // inside the margins: 170 × 257 mm upright (less the title's room), 257 × 170 mm on its side
    expect(images[0].widthCm).toBeLessThanOrEqual(17);
    expect(images[0].heightCm).toBeLessThan(24.5);
    expect(images[0].heightCm).toBeGreaterThan(22);
    expect(images[1].widthCm).toBeGreaterThan(22);
    expect(images[1].heightCm).toBeLessThanOrEqual(17);
    // no title line
    expect(build({ lab: docs }, false, [{ id: 'lab', type: 'labReports', kinds: ['results'], titles: false }]).map((n) => n.t)).toEqual(['pagebreak', 'image', 'pagebreak', 'image']);
    // while it's worked on: what's still being read, what isn't there, what couldn't go in – none of it in the report itself
    const note = (ns: DocNode[]) => ns.filter((n): n is Extract<DocNode, { t: 'note' }> => n.t === 'note').map((n) => n.text);
    expect(note(build(undefined, true))[0]).toContain('being read');
    expect(note(build({ lab: [] }, true))[0]).toContain('no PDF or picture in the project’s files is about this period’s samples');
    // a spreadsheet never could go in (the Reports tab lists it): only what should have and couldn't be read is said here
    expect(note(build({ lab: docs }, true))[0]).toBe('Laboratory reports: not put in – Gone.pdf (not in the shared folder).');
    expect(note(build({ lab: [docs[1]] }, true))[0]).toContain('no PDF or picture in the project’s files is about this period’s samples');
    expect(build(undefined).map((n) => n.t)).toEqual(['h', 'p']);
    expect(build({ lab: [] }).map((n) => n.t)).toEqual(['h', 'p']);
  });

  it('before issuing: a lab job in the period with no lab report on file is said', async () => {
    const b = await loadBundle(projectId);
    const template = { id: 't', name: 'T', orientation: 'portrait', pageSize: 'A4', marginMm: 20, fontSize: 10, accent: '#0f766e', headerText: '', footerText: '', numbering: true, updatedAt: '', blocks: [{ id: 'lab', type: 'labReports', kinds: ['results'] }] } as ReportTemplate;
    const job = oct.find((s) => s.labJob)!.labJob!;
    const base = { bundle: b, template, period: { start: '2026-10-01', end: '2026-10-31' }, doc: null, promptTexts: {}, figures: {}, imports: [], today: '2026-11-11' };
    const about = (attached: Record<string, Array<{ kind: string; name: string; jobs?: string[] }>> | undefined) => preIssueChecks({ ...base, attached }).filter((c) => c.where === 'files').map((c) => c.text);
    expect(about({ lab: [] })[0]).toContain(`No lab report on file for lab job ${job}`);
    expect(about({ lab: [{ kind: 'results', name: 'r.pdf', jobs: [job] }] })).toEqual([]);
    // a chain of custody isn't the lab's report
    expect(about({ lab: [{ kind: 'coc', name: 'c.pdf', jobs: [job] }] })).toHaveLength(1);
    // not asked about until the report's documents are known
    expect(about(undefined)).toEqual([]);
  });

  it('an issue keeps which documents went in, and says when they’ve changed since', async () => {
    const b = await loadBundle(projectId);
    const template = { id: 't', name: 'T', orientation: 'portrait', pageSize: 'A4', marginMm: 20, fontSize: 10, accent: '#0f766e', headerText: '', footerText: '', numbering: true, updatedAt: '', blocks: [{ id: 'lab', type: 'labReports', kinds: ['results'] }] } as ReportTemplate;
    const input = { bundle: b, template, period: { start: '2026-10-01', end: '2026-10-31', label: 'October 2026' }, settings: { ...DEFAULT_SETTINGS }, issuedOn: '2026-11-11' };
    const ref = { fileId: 'd1', name: 'Report.pdf', kind: 'results' as const, path: 'Project files/P/Report.pdf', size: 10 };
    const issued = snapshotContent({ ...input, attached: { lab: [ref] } });
    expect(issued.attached).toEqual({ lab: [ref] });
    expect(snapshotContent(input).attached).toBeUndefined();
    expect(snapshotContent({ ...input, attached: { lab: [] } }).attached).toBeUndefined();
    expect(diffSnapshots(issued, snapshotContent({ ...input, attached: { lab: [ref] } })).changes).toEqual([]);
    const more = diffSnapshots(issued, snapshotContent({ ...input, attached: { lab: [ref, { ...ref, fileId: 'd2', name: 'Second.pdf' }] } }));
    expect(more.changes).toEqual([{ area: 'attached', text: '1 document more' }]);
    const swapped = diffSnapshots(issued, snapshotContent({ ...input, attached: { lab: [{ ...ref, size: 99 }] } }));
    expect(swapped.changes[0]).toMatchObject({ area: 'attached', text: '1 document more, 1 document fewer' });
  });
});
