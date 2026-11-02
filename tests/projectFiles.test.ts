import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { memoryFolder } from '../src/sync/folder';

const folder = memoryFolder('Workspace');
vi.mock('../src/sync/workspace', async (orig) => ({ ...(await orig<typeof import('../src/sync/workspace')>()), currentWorkspaceFolder: () => folder }));

const { db, ensureBuiltIns } = await import('../src/db/db');
const { createDemoProject } = await import('../src/db/demo');
const { deleteImport, deleteProject } = await import('../src/db/repo');
const { exportProjectPackage, importProjectPackage } = await import('../src/db/backup');
const pf = await import('../src/lib/projectFiles');
const { guessKind, numbersIn, describeFile, projectJobs, suggestedJob, samplesByImport, linkedSampleIds, filesBySample, fileIsAbout, webAddress, linkTarget, tidyPath, nameOfTarget, insideProjectsFolder, sampleSummary } = pf;

const S = (id: string, labJob: string | undefined, date: string, siteId = 'a', extra: Record<string, unknown> = {}) => ({ id, projectId: 'p', siteId, date, labJob, labName: labJob ? 'Hill Labs' : undefined, ...extra });

describe('what a file is', () => {
  it('its kind: by its name, then its first page, a lab’s file being lab results', () => {
    expect(guessKind('Hill Labs Quote Q-2026-114.pdf')).toBe('quote');
    expect(guessKind('Quotation_annual_monitoring.docx')).toBe('quote');
    expect(guessKind('COC 12 Oct.pdf')).toBe('coc');
    expect(guessKind('Chain-of-Custody.xlsx')).toBe('coc');
    expect(guessKind('Field sheet - October round.pdf')).toBe('field');
    expect(guessKind('Resource consent AUTH-1234.pdf')).toBe('consent');
    expect(guessKind('Certificate of Analysis.pdf')).toBe('results');
    expect(guessKind('INV-0042 invoice.pdf')).toBe('invoice');
    expect(guessKind('RE Results query.msg')).toBe('correspondence');
    expect(guessKind('Annual report 2026.docx')).toBe('report');
    expect(guessKind('Scan_0001.pdf')).toBe('other');
    // a lab's report named only by its number: its first page says what it is
    expect(guessKind('3300139.pdf', 'R J Hill Laboratories … Certificate of Analysis … Lab No: 3300139')).toBe('results');
    expect(guessKind('Scan_0002.pdf', 'QUOTATION Quote No: Q12345')).toBe('quote');
    // a lab's "report" is its results
    expect(guessKind('3300139 Final report.pdf', '', true)).toBe('results');
  });

  it('the numbers in it – jobs, reports, samples – and the project’s lab job among them', () => {
    expect(numbersIn('3300139-SPv1 Final.pdf')).toEqual(['3300139']);
    expect(numbersIn('ALS EM2612345 and 23-14205; lab no 3300139.1, phone 07 858 2000')).toEqual(['EM2612345', '23-14205', '3300139']);
    const jobs = projectJobs([S('s1', '3300139', '2026-10-12T09:10'), S('s2', '3300139', '2026-10-12T09:45', 'b'), S('s3', '3300140', '2026-11-08T09:00')]);
    expect(jobs.map((j) => [j.job, j.sampleIds.length, j.dates, j.siteIds])).toEqual([
      ['3300140', 1, ['2026-11-08'], ['a']],
      ['3300139', 2, ['2026-10-12'], ['a', 'b']],
    ]);
    expect(describeFile('Report.pdf', 'R J Hill Laboratories Limited  Lab No: 3300139  Certificate of Analysis', jobs)).toEqual({ kind: 'results', lab: 'Hill Labs', ref: '3300139', numbers: ['3300139'] });
    expect(describeFile('Hill Labs quote 2026.pdf', '', jobs)).toMatchObject({ kind: 'quote', lab: 'Hill Labs', ref: undefined });
  });

  it('a file’s lab job is offered once it’s imported – before or after the file came', () => {
    const jobs = projectJobs([S('s1', '3300139', '2026-10-12')]);
    const f = { name: 'Results.pdf', numbers: ['0800444555', '3300139'] };
    expect(suggestedJob(f, jobs)?.job).toBe('3300139');
    expect(suggestedJob({ name: '3300139 report.pdf' }, jobs)?.job).toBe('3300139');
    expect(suggestedJob({ ...f, linked: { kind: 'job', job: '3300139' } }, jobs)).toBeUndefined();
    expect(suggestedJob({ name: 'Quote.pdf', numbers: ['12345'] }, jobs)).toBeUndefined();
  });
});

describe('the data a file is linked to', () => {
  const samples = [S('s1', '3300139', '2026-10-12', 'a', { importId: 'imp1' }), S('s2', '3300139', '2026-10-12', 'b'), S('s3', undefined, '2026-11-01', 'a')];
  const results = [
    { sampleId: 's2', importId: 'imp1' },
    { sampleId: 's3', importId: 'imp2' },
  ];
  const byImport = samplesByImport(samples, results);

  it('a lab job’s samples, an import’s, or samples chosen', () => {
    expect(linkedSampleIds({ linked: { kind: 'job', job: '3300139' } }, samples, byImport)).toEqual(['s1', 's2']);
    expect(linkedSampleIds({ linked: { kind: 'import', importId: 'imp1' } }, samples, byImport).sort()).toEqual(['s1', 's2']);
    expect(linkedSampleIds({ linked: { kind: 'samples', sampleIds: ['s3', 'gone'] } }, samples, byImport)).toEqual(['s3']);
    expect(linkedSampleIds({}, samples, byImport)).toEqual([]);
    const files = [
      { id: 'f1', name: 'job.pdf', linked: { kind: 'job' as const, job: '3300139' } },
      { id: 'f2', name: 'coc.pdf', linked: { kind: 'samples' as const, sampleIds: ['s2'] } },
    ] as never[];
    const by = filesBySample(files, samples, byImport);
    expect([...by].map(([id, list]) => [id, (list as Array<{ id: string }>).map((f) => f.id)])).toEqual([
      ['s1', ['f1']],
      ['s2', ['f1', 'f2']],
    ]);
    expect(fileIsAbout({ linked: { kind: 'import', importId: 'imp2' } }, samples[2], [{ importId: 'imp2' }])).toBe(true);
    expect(fileIsAbout({ linked: { kind: 'job', job: '3300139' } }, samples[2], [])).toBe(false);
    expect(sampleSummary(['s1', 's2'], (id) => samples.find((s) => s.id === id), (id) => id.toUpperCase())).toBe('2 samples, 12 Oct 2026 – A, B');
  });
});

describe('links to files kept elsewhere', () => {
  it('web addresses (only http and https), and paths as File Explorer gives them', () => {
    expect(webAddress('https://example.sharepoint.com/:b:/r/sites/Env/Quote.pdf?web=1')).toBe('https://example.sharepoint.com/:b:/r/sites/Env/Quote.pdf?web=1');
    expect(webAddress('javascript:alert(1)')).toBeNull();
    expect(linkTarget('javascript:alert(1)')).toBeNull();
    expect(linkTarget(' JavaScript:alert(1)')).toBeNull();
    expect(linkTarget('data:text/html,<b>x</b>')).toBeNull();
    expect(linkTarget('"G:\\Projects\\Clients\\Kōwhai\\Quote 2026.pdf"')).toBe('G:\\Projects\\Clients\\Kōwhai\\Quote 2026.pdf');
    expect(linkTarget('\\\\server\\share\\Lab\\3300139.pdf')).toBe('\\\\server\\share\\Lab\\3300139.pdf');
    expect(tidyPath('file:///G:/Projects/Quote%202026.pdf')).toBe('G:\\Projects\\Quote 2026.pdf');
    expect(nameOfTarget('https://x.sharepoint.com/sites/Env/Shared%20Documents/Hill%20quote.pdf?csf=1')).toBe('Hill quote.pdf');
    expect(nameOfTarget('G:\\Projects\\Clients\\Quote.pdf')).toBe('Quote.pdf');
    expect(insideProjectsFolder('G:\\Projects\\Clients\\Kōwhai\\Quote.pdf', 'Projects')).toBe('Clients/Kōwhai/Quote.pdf');
    expect(insideProjectsFolder('G:\\Other\\Quote.pdf', 'Projects')).toBeUndefined();
  });
});

// ------------------------------------------------------------ kept in the shared folder

describe('a project’s files, kept in the shared folder', () => {
  let projectId = '';
  let code = '';
  let job = '';
  beforeAll(async () => {
    await ensureBuiltIns();
    projectId = await createDemoProject();
    code = (await db.projects.get(projectId))!.code!;
    job = (await db.samples.where('projectId').equals(projectId).first())!.labJob!;
  });
  const file = (name: string, text = 'x') => new File([text], name, { type: name.endsWith('.pdf') ? 'application/pdf' : 'text/plain' });

  it('uploaded: a copy as it is, what it seems to be, the lab job it’s about offered – nothing linked till chosen', async () => {
    const project = (await db.projects.get(projectId))!;
    const jobs = projectJobs(await db.samples.where('projectId').equals(projectId).toArray());
    const r = await pf.addProjectFiles(project, [file(`${job} Final report.pdf`, 'lab report bytes'), file('Hill Labs quote 2026.pdf')], { jobs, readText: async () => '' });
    expect(r.errors).toEqual([]);
    expect(r.added.map((f) => [f.name, f.kind, f.path, f.ref, f.linked])).toEqual([
      [`${job} Final report.pdf`, 'results', `Project files/${code}/${job} Final report.pdf`, job, undefined],
      ['Hill Labs quote 2026.pdf', 'quote', `Project files/${code}/Hill Labs quote 2026.pdf`, undefined, undefined],
    ]);
    expect(await (await folder.file(`Project files/${code}/${job} Final report.pdf`))!.text()).toBe('lab report bytes');
    expect(suggestedJob(r.added[0], jobs)?.job).toBe(job);
    // the same file again: left; another with the same name: beside it
    const again = await pf.addProjectFiles(project, [file(`${job} Final report.pdf`, 'lab report bytes'), file('Hill Labs quote 2026.pdf', 'a newer quote')], { readText: async () => '' });
    expect(again.skipped).toEqual([`${job} Final report.pdf`]);
    expect(again.added[0].path).toBe(`Project files/${code}/Hill Labs quote 2026 (2).pdf`);
    expect((await db.audit.where('projectId').equals(projectId).toArray()).some((a) => a.kind === 'file' && a.text.startsWith('2 files added'))).toBe(true);
  });

  it('linked to its lab job: shows with those samples; taken off and put back', async () => {
    const f = (await db.files.where('projectId').equals(projectId).toArray()).find((x) => x.kind === 'results')!;
    await pf.linkProjectFile(f, { kind: 'job', job }, `lab job ${job}`);
    const samples = await db.samples.where('projectId').equals(projectId).toArray();
    const linked = (await db.files.get(f.id))!;
    expect(linkedSampleIds(linked, samples, new Map()).length).toBe(samples.filter((s) => s.labJob === job).length);
    const undo = await pf.removeProjectFile(linked);
    expect(await db.files.get(f.id)).toBeUndefined();
    expect(await folder.file(f.path!)).toBeNull();
    await undo();
    expect((await db.files.get(f.id))!.linked).toEqual({ kind: 'job', job });
    expect(await (await folder.file(f.path!))!.text()).toBe('lab report bytes');
  });

  it('only its own copies are opened or deleted – whatever a record names', async () => {
    expect(pf.isKeptPath(`Project files/${code}/Quote.pdf`)).toBe(true);
    expect(pf.isKeptPath('EnviroDB.workspace')).toBe(false);
    expect(pf.isKeptPath('Project files/../clients/x.json')).toBe(false);
    folder.files.set('clients/someone/data.json', { text: '{}', lastModified: 1 });
    const odd = { id: 'f-odd', projectId, name: 'odd', kind: 'other' as const, path: 'clients/someone/data.json', addedAt: '' };
    await db.files.put(odd);
    expect(await pf.sharedCopy(odd)).toBeNull();
    await pf.removeProjectFile(odd);
    expect(folder.files.has('clients/someone/data.json')).toBe(true);
    expect(await db.files.get('f-odd')).toBeUndefined();
  });

  it('a link: a web address or a path – never anything a browser would run', async () => {
    const l = await pf.addProjectLink(projectId, 'https://example.sharepoint.com/sites/Env/Consent%20AUTH-1234.pdf');
    expect(l).toMatchObject({ name: 'Consent AUTH-1234.pdf', kind: 'consent', href: 'https://example.sharepoint.com/sites/Env/Consent%20AUTH-1234.pdf' });
    expect(l.path).toBeUndefined();
    await expect(pf.addProjectLink(projectId, 'javascript:alert(document.cookie)')).rejects.toThrow(/web link/);
    await expect(pf.saveProjectFile({ ...l, href: 'javascript:alert(1)' }, l)).rejects.toThrow(/web link/);
    await pf.saveProjectFile({ ...l, name: 'The consent', notes: 'Expires 2041' }, l);
    expect(await db.files.get(l.id)).toMatchObject({ name: 'The consent', notes: 'Expires 2041', href: l.href });
  });

  it('an import’s files kept, linked to its results – imported again, linked again, not copied again; undone, unlinked', async () => {
    const project = (await db.projects.get(projectId))!;
    // an import of its own (undoing the demo's would take its samples)
    const batch = { id: 'imp-kept', projectId, fileName: 'Hill 3300199.csv', kind: 'lab' as const, importedAt: new Date().toISOString(), samples: 0, results: 0, skipped: 0, replaced: 0 };
    await db.imports.put(batch);
    const csv = { name: 'Hill 3300199.csv', data: new TextEncoder().encode('Lab No,Zinc\n1,0.01').buffer as ArrayBuffer };
    expect(await pf.keepImportFiles(project, [csv], batch, { lab: 'Hill Labs', job: '3300199' })).toBe(1);
    const kept = (await db.files.where('projectId').equals(projectId).toArray()).find((f) => f.name === 'Hill 3300199.csv')!;
    expect(kept).toMatchObject({ kind: 'results', lab: 'Hill Labs', ref: '3300199', linked: { kind: 'import', importId: batch.id }, fromImport: batch.id, path: `Project files/${code}/Hill 3300199.csv` });
    const files = (await db.files.where('projectId').equals(projectId).count());
    expect(await pf.keepImportFiles(project, [csv], { id: 'imp-again' })).toBe(1);
    expect(await db.files.where('projectId').equals(projectId).count()).toBe(files);
    expect((await db.files.get(kept.id))!.linked).toEqual({ kind: 'import', importId: 'imp-again' });
    // the import undone: the file stays, no longer linked
    await pf.keepImportFiles(project, [csv], batch);
    await deleteImport(batch.id);
    expect((await db.files.get(kept.id))!.linked).toBeUndefined();
  });

  it('go with the project in a project file, linked to the copy’s data; deleted with it', async () => {
    const pkg = JSON.parse(JSON.stringify(await exportProjectPackage(projectId)));
    const ours = await db.files.where('projectId').equals(projectId).toArray();
    expect(pkg.data.files.length).toBe(ours.length);
    const sample = (await db.samples.where('projectId').equals(projectId).first())!;
    const coc = { ...ours[0], id: 'f-coc', linked: { kind: 'samples', sampleIds: [sample.id] } };
    pkg.data.files.push(coc);
    const copyId = await importProjectPackage(pkg);
    expect(copyId).not.toBe(projectId);
    const copied = await db.files.where('projectId').equals(copyId).toArray();
    expect(copied.length).toBe(ours.length + 1);
    const c = copied.find((f) => f.name === coc.name && f.linked?.kind === 'samples')!;
    const copySamples = await db.samples.where('projectId').equals(copyId).toArray();
    expect(c.linked!.kind === 'samples' && copySamples.some((s) => s.id === (c.linked as { sampleIds: string[] }).sampleIds[0])).toBe(true);
    await deleteProject(copyId);
    expect(await db.files.where('projectId').equals(copyId).count()).toBe(0);
  });
});
