import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { db, ensureBuiltIns } from '../src/db/db';
import { createDemoProject } from '../src/db/demo';
import { addAttachment, deleteImport, deleteRule, removeAttachment, saveRule, saveSite, setPeriodNote, setProjectStatus, setResultComment, setReviewed, setSubmitted, newRule, newSite } from '../src/db/repo';
import { reviewActions, actionsToTake } from '../src/lib/actions';
import { dueItemPath } from '../src/components/DueItem';
import { logAudit } from '../src/db/audit';
import { exportProjectPackage, importProjectPackage } from '../src/db/backup';
import { loadBundle } from './helpers';

let projectId: string;
beforeAll(async () => {
  await ensureBuiltIns();
  projectId = await createDemoProject();
});
const history = async () => (await db.audit.where('projectId').equals(projectId).sortBy('at')).map((e) => `${e.kind}: ${e.text}`);

describe('stage 1: workflow and safety nets', () => {
  it('a due item opens the obligation, not the Reports tab', async () => {
    const b = await loadBundle(projectId);
    const actions = actionsToTake([b], null, '2026-10-25');
    const report = actions.find((a) => a.kind === 'report');
    expect(report?.link).toMatch(new RegExp(`^/projects/${projectId}/schedule\\?obligation=.+&period=\\d+$`));
    expect(dueItemPath('p', 'o', 3)).toBe('/projects/p/schedule?obligation=o&period=3');
  });

  it('an obligation keeps files, links and notes for each period; submitting is in the history', async () => {
    const o = (await db.obligations.where('projectId').equals(projectId).first())!;
    await addAttachment(o.id, { periodEnd: '2026-06-30', name: 'Stormwater management plan v3', url: 'https://example.sharepoint.com/plan.docx' });
    await addAttachment(o.id, { periodEnd: '2025-06-30', name: 'Last year’s' });
    await setPeriodNote(o.id, '2026-06-30', 'Waiting on the ecologist’s section');
    let got = (await db.obligations.get(o.id))!;
    expect(got.attachments?.map((a) => [a.periodEnd, a.name, a.url])).toEqual([
      ['2026-06-30', 'Stormwater management plan v3', 'https://example.sharepoint.com/plan.docx'],
      ['2025-06-30', 'Last year’s', undefined],
    ]);
    expect(got.attachments?.[0].addedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(got.periodNotes).toEqual({ '2026-06-30': 'Waiting on the ecologist’s section' });
    await removeAttachment(o.id, '2025-06-30', 'Last year’s');
    await setPeriodNote(o.id, '2026-06-30', '  ');
    got = (await db.obligations.get(o.id))!;
    expect(got.attachments).toHaveLength(1);
    expect(got.periodNotes).toEqual({});
    await setSubmitted(o.id, { periodStart: '2025-07-01', periodEnd: '2026-06-30' }, '2026-09-20');
    expect((await history()).some((h) => h.startsWith('obligation:') && /marked submitted \(2026-09-20\)/.test(h))).toBe(true);
  });

  it('imports are reviewed and signed off; unreviewed ones are an action; undo is in the history', async () => {
    const imp = (await db.imports.where('projectId').equals(projectId).first())!;
    const projects = new Map([[projectId, (await db.projects.get(projectId))!]]);
    const before = reviewActions(await db.imports.toArray(), projects, '2026-10-25');
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({ kind: 'review', projectId, link: `/projects/${projectId}/data` });
    await setReviewed(imp.id, true);
    const after = (await db.imports.get(imp.id))!;
    expect(after.reviewed?.on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const all = await db.imports.toArray();
    expect(reviewActions(all, projects).find((a) => a.projectId === projectId)?.detail ?? '').not.toContain(imp.fileName);
    await setReviewed(imp.id, false);
    expect((await db.imports.get(imp.id))!.reviewed).toBeUndefined();
    // an archived project's imports aren't an action
    await setProjectStatus(projectId, 'archived');
    expect(reviewActions(all, new Map([[projectId, (await db.projects.get(projectId))!]]))).toEqual([]);
    await setProjectStatus(projectId, 'active');
    // undo
    const small = { ...imp, id: 'imp-test', fileName: 'test.xlsx', results: 0, samples: 0 };
    await db.imports.put(small);
    await deleteImport('imp-test');
    expect(await db.imports.get('imp-test')).toBeUndefined();
    const h = await history();
    expect(h).toContain(`review: Reviewed: ${imp.fileName} (${imp.results} results)`);
    expect(h).toContain('undo: Import undone: test.xlsx (0 results)');
    expect(h).toContain('project: Project archived');
  });

  it('a comment on a result', async () => {
    const r = (await db.results.where('projectId').equals(projectId).first())!;
    await setResultComment(r.id, '  lab re-ran this  ');
    expect((await db.results.get(r.id))!.comment).toBe('lab re-ran this');
    await setResultComment(r.id, '');
    expect((await db.results.get(r.id))!.comment).toBeUndefined();
  });

  it('sites and rules leave a trail', async () => {
    const s = newSite(projectId, { code: 'NEW1', order: 99 });
    await saveSite(s);
    await saveSite({ ...s, code: 'NEW2' }, s);
    await saveSite({ ...s, code: 'NEW2', aliases: ['x'] }, { ...s, code: 'NEW2' }); // an alias: not history
    const r = newRule(projectId, { name: 'Test limit' });
    await saveRule(r);
    await deleteRule(r.id);
    const h = await history();
    expect(h).toContain('site: Site NEW1 added');
    expect(h).toContain('site: Site NEW1 changed (now NEW2)');
    expect(h.filter((x) => x.startsWith('site: Site NEW')).length).toBe(2);
    expect(h).toContain('rule: Rule added: Test limit');
    expect(h).toContain('rule: Rule deleted: Test limit');
  });

  it('history never stops the work, and travels in a project package', async () => {
    await logAudit('no-such-project', 'setup', 'x'.repeat(1000));
    const e = await db.audit.where('projectId').equals('no-such-project').first();
    expect(e?.text.length).toBe(400);
    const pkg = await exportProjectPackage(projectId);
    expect((pkg.data.audit ?? []).length).toBeGreaterThan(3);
    const copyId = await importProjectPackage(pkg); // the project exists here: a copy
    expect(copyId).not.toBe(projectId);
    expect(await db.audit.where('projectId').equals(copyId).count()).toBe((pkg.data.audit ?? []).length);
  });
});
