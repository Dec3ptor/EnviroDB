import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { RELEASES, APP_VERSION } from '../src/data/releases';
import { MADE_BY, compareVersions, releasesSince } from '../src/lib/version';
import { DEFAULT_SETTINGS, ensureBuiltIns } from '../src/db/db';
import { createDemoProject } from '../src/db/demo';
import { exportWorkspace } from '../src/db/backup';
import { BUILT_IN_TEMPLATES } from '../src/data/templates';
import { buildReport } from '../src/reports/build';
import { toPdfDefinition } from '../src/reports/pdf';
import { docxBlob } from '../src/reports/docx';
import { loadBundle } from './helpers';

describe('version', () => {
  it('is the newest release’s, and package.json agrees', () => {
    expect(JSON.parse(readFileSync('package.json', 'utf8')).version).toBe(APP_VERSION);
    expect(APP_VERSION).toBe(RELEASES[0].version);
    for (const r of RELEASES) {
      expect(r.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.items.length).toBeGreaterThan(0);
    }
    // newest first, each a later version than the one after it
    for (let i = 1; i < RELEASES.length; i++) expect(compareVersions(RELEASES[i - 1].version, RELEASES[i].version)).toBe(1);
  });

  it('compares versions number by number', () => {
    expect(compareVersions('1.10.0', '1.9.2')).toBe(1);
    expect(compareVersions('1.2.0', '1.2')).toBe(0);
    expect(compareVersions('0.9.9', '1.0.0')).toBe(-1);
    expect(releasesSince(null)).toEqual(RELEASES);
    expect(releasesSince(APP_VERSION)).toEqual([]);
    expect(releasesSince('0.0.1').map((r) => r.version)).toContain(APP_VERSION);
  });

  describe('stamped on what it makes', () => {
    let projectId: string;
    beforeAll(async () => {
      await ensureBuiltIns();
      projectId = await createDemoProject();
    });
    it('PDF, Word and backups record the version', async () => {
      const doc = buildReport({ bundle: await loadBundle(projectId), template: BUILT_IN_TEMPLATES.find((t) => t.id === 'tpl-quarterly')!, period: { start: '2026-01-01', end: '2026-03-31', label: 'Q1' }, settings: DEFAULT_SETTINGS });
      expect(toPdfDefinition(doc).info).toMatchObject({ creator: MADE_BY, producer: MADE_BY });
      const zip = await JSZip.loadAsync(await (await docxBlob(doc)).arrayBuffer());
      expect(await zip.file('docProps/core.xml')!.async('string')).toContain(`<dc:creator>${MADE_BY}</dc:creator>`);
      expect((await exportWorkspace()).appVersion).toBe(APP_VERSION);
    });
  });
});
