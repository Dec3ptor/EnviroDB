import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { db, ensureBuiltIns, getSettings, saveReportWork, saveSettings } from '../src/db/db';
import { createDemoProject } from '../src/db/demo';
import { exportProjectPackage, exportWorkspace, restoreWorkspace } from '../src/db/backup';
import { png } from './helpers';

let projectId = '';
beforeAll(async () => {
  await ensureBuiltIns();
  projectId = await createDemoProject();
});

describe('backups', () => {
  it('keep report commentary, figures, layout changes and your settings – and put them back', async () => {
    const draft = `draft:${projectId}:tpl-letter-event:2026-09-01:2026-09-30`;
    const figs = `figs:${projectId}:tpl-letter-event:2026-09-01:2026-09-30`;
    await saveReportWork(draft, { 'le-intro': 'The September round went well.' });
    await saveReportWork(figs, { 'le-figures': [{ id: 'f1', src: png(40, 30), caption: 'Upstream' }] });
    await saveSettings({ author: 'Ben Foote', signatureImage: png(60, 20) });
    await db.meta.put({ key: 'autosaveLast', value: '2026-10-01T00:00:00Z' }); // the autosave's own bookkeeping

    const backup = JSON.parse(JSON.stringify(await exportWorkspace()));
    expect(backup.meta.map((r: { key: string }) => r.key).sort()).toEqual([draft, figs, 'settings'].sort());

    // replace: everything as it was in the backup
    await saveReportWork(draft, { 'le-intro': 'Changed since the backup' });
    await saveReportWork(`layout:${projectId}:tpl-annual`, { name: 'not in the backup' });
    await saveSettings({ author: 'Someone else' });
    await restoreWorkspace(backup, 'replace');
    expect((await db.meta.get(draft))?.value).toEqual({ 'le-intro': 'The September round went well.' });
    expect((await db.meta.get(figs))?.value).toMatchObject({ 'le-figures': [{ caption: 'Upstream' }] });
    expect(await db.meta.get(`layout:${projectId}:tpl-annual`)).toBeUndefined();
    expect((await getSettings()).author).toBe('Ben Foote');

    // merge: your own settings stay, blanks are filled in
    await saveSettings({ author: 'Jane Doe', signatureImage: undefined });
    await restoreWorkspace(backup, 'merge');
    const s = await getSettings();
    expect(s.author).toBe('Jane Doe');
    expect(s.signatureImage).toBe(backup.meta.find((r: { key: string }) => r.key === 'settings').value.signatureImage);
  });

  it('leave report work and settings out of project files shared with others', async () => {
    const pkg = await exportProjectPackage(projectId);
    expect(pkg.meta).toBeUndefined();
  });

  it('still restore backups made before they had report work', async () => {
    const backup = JSON.parse(JSON.stringify(await exportWorkspace()));
    delete backup.meta;
    await expect(restoreWorkspace(backup, 'merge')).resolves.toBeUndefined();
  });
});
