import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, db, ensureBuiltIns, saveSettings } from '../src/db/db';
import { createDemoProject } from '../src/db/demo';
import { BUILT_IN_TEMPLATES } from '../src/data/templates';
import { buildReport } from '../src/reports/build';
import type { ArchivePart, ReportTemplate } from '../src/db/types';
import { dataKeys, diffSnapshots, fromBase64, gunzip, gzip, MissingParts, nextRevision, packSnapshot, sha256, sizeText, snapshotContent, toBase64, unpackSnapshot } from '../src/lib/issued';
import { deleteIssue, findIssuedFile, issueReport, issuedBuildOptions, loadIssued, startRevision } from '../src/db/issues';
import { acceptFinding, excludeResult } from '../src/db/qa';
import { runQa, qaInputFor } from '../src/lib/qa';
import { loadBundle, png } from './helpers';
import { exportProjectPackage } from '../src/db/backup';

const year = { start: '2025-07-01', end: '2026-06-30', label: 'July 2025 to June 2026' };
const annual = BUILT_IN_TEMPLATES.find((t) => t.id === 'tpl-annual')! as ReportTemplate;

/** An archive kept in memory. */
function memoryArchive() {
  const parts = new Map<string, ArchivePart>();
  return {
    parts,
    stored: async (keys: string[]) => new Map(keys.filter((k) => parts.has(k)).map((k) => [k, parts.get(k)!.z.length])),
    get: async (keys: string[]) => keys.map((k) => parts.get(k)),
    keep: (list: ArchivePart[]) => list.forEach((p) => parts.set(p.id, p)),
  };
}

describe('bytes', () => {
  it('compresses, encodes and fingerprints', async () => {
    const text = 'nitrate '.repeat(500);
    const z = await gzip(text);
    expect(z.length).toBeLessThan(100);
    expect(await gunzip(fromBase64(toBase64(z)))).toBe(text);
    // the SHA-256 everyone gets for "abc"
    expect(await sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(await sha256(new Blob(['abc']))).toBe(await sha256('abc'));
  });
  it('names revisions and sizes', () => {
    expect(nextRevision([])).toBe('Rev 0');
    expect(nextRevision(['Rev 0'])).toBe('Rev 1');
    expect(nextRevision(['Rev 0', 'Rev 9'])).toBe('Rev 10');
    expect(nextRevision(['Draft A'])).toBe('Draft B');
    expect(nextRevision(['Final'])).toBe('Final (2)');
    expect(sizeText(512)).toBe('512 bytes');
    expect(sizeText(84_000)).toBe('82 KB');
    expect(sizeText(3_500_000)).toBe('3.3 MB');
  });
});

describe('what an issued report keeps', () => {
  let projectId: string;
  beforeAll(async () => {
    await ensureBuiltIns();
    await saveSettings({ author: 'R. Tester', company: 'Example Ltd' });
    projectId = await createDemoProject();
  });
  const input = async (extra: Partial<Parameters<typeof snapshotContent>[0]> = {}) => ({
    bundle: await loadBundle(projectId),
    template: annual,
    period: year,
    settings: { ...DEFAULT_SETTINGS, author: 'R. Tester', company: 'Example Ltd' },
    promptTexts: { intro: 'Commentary as issued.' },
    figures: {},
    issuedOn: '2026-07-20',
    ...extra,
  });

  it('packs small and unpacks to the same', async () => {
    const content = snapshotContent(await input());
    expect(content.data.length).toBeGreaterThan(3);
    const mem = memoryArchive();
    const { ref, parts } = await packSnapshot(content, mem.stored);
    mem.keep(parts);
    const asJson = JSON.stringify(content).length;
    // the project's data as the database holds it, for comparison
    const raw = JSON.stringify([await db.samples.where('projectId').equals(projectId).toArray(), await db.results.where('projectId').equals(projectId).toArray()]).length;
    expect(ref.bytes).toBeLessThan(raw / 12);
    expect(ref.bytes).toBeLessThan(asJson / 2.5);
    expect(ref.added).toBe(ref.bytes);
    expect(await unpackSnapshot(ref, mem.get)).toEqual(JSON.parse(JSON.stringify(content)));
  });

  it('keeps each part once: a revision adds only what changed', async () => {
    const mem = memoryArchive();
    const first = await packSnapshot(snapshotContent(await input()), mem.stored);
    mem.keep(first.parts);
    // a lab re-issues one result
    const b = await loadBundle(projectId);
    const r = b.index.bySample.get(b.samples.filter((s) => s.date <= year.end).pop()!.id)!.find((x) => x.value !== null)!;
    await db.results.update(r.id, { value: r.value! * 2 });
    const second = await packSnapshot(snapshotContent(await input({ promptTexts: { intro: 'Revised.' } })), mem.stored);
    // the head (commentary) and the one site's year
    expect(second.parts.map((p) => p.kind).sort()).toEqual(['data', 'head']);
    expect(second.ref.added).toBeLessThan(first.ref.bytes / 3);
    await db.results.update(r.id, { value: r.value });
  });

  it('keeps images once, apart from the rest', async () => {
    const mem = memoryArchive();
    const img = png(400, 300);
    const content = snapshotContent(await input({ figures: { figs: [{ id: 'f1', src: img, caption: 'Site plan' }, { id: 'f2', src: img, caption: 'Again' }] } }));
    const { ref, parts } = await packSnapshot(content, mem.stored);
    mem.keep(parts);
    expect(ref.images.length).toBe(1);
    expect(parts.filter((p) => p.kind === 'image').length).toBe(1);
    expect((await unpackSnapshot(ref, mem.get)).figures.figs[1].src).toBe(img);
    // a part not here yet
    mem.parts.delete(ref.images[0]);
    await expect(unpackSnapshot(ref, mem.get)).rejects.toBeInstanceOf(MissingParts);
  });

  it('rebuilds the report exactly as it was', async () => {
    // a QA/QC decision naming results, as the report's QA/QC section shows it
    let b = await loadBundle(projectId);
    const qa = runQa(qaInputFor(b, { start: '1900-01-01', end: '2199-12-31' }, DEFAULT_SETTINGS));
    const f = qa.findings.find((x) => x.resultIds.length);
    if (f) await acceptFinding(projectId, f, 'Checked with the lab');
    b = await loadBundle(projectId);
    const blocks = [...annual.blocks, { id: 'qa', type: 'qaSummary' } as ReportTemplate['blocks'][number]];
    const template = { ...annual, blocks };
    const opts = { bundle: b, template, period: year, settings: { ...DEFAULT_SETTINGS, author: 'R. Tester', company: 'Example Ltd' }, promptTexts: {}, figures: {}, today: '2026-07-20', issue: { revision: 'Rev 0' } };
    const live = buildReport(opts);
    const mem = memoryArchive();
    const { ref, parts } = await packSnapshot(snapshotContent({ ...opts, issuedOn: '2026-07-20' }), mem.stored);
    mem.keep(parts);
    const again = buildReport(issuedBuildOptions(await unpackSnapshot(ref, mem.get), { revision: 'Rev 0' }));
    expect(JSON.stringify(again.nodes)).toBe(JSON.stringify(live.nodes));
    expect(again.fileName).toBe(live.fileName);
    expect(again.fileName).toMatch(/ - Rev 0$/);
  });

  it('says what has changed since', async () => {
    const before = snapshotContent(await input());
    expect(diffSnapshots(before, before).summary).toBe('Nothing has changed since.');
    const b = await loadBundle(projectId);
    const inPeriod = b.samples.filter((s) => s.date >= year.start && s.date <= year.end);
    const s = inPeriod[inPeriod.length - 1];
    const [r1, r2] = b.index.bySample.get(s.id)!.filter((x) => x.value !== null);
    await db.results.update(r1.id, { value: r1.value! + 1 });
    await excludeResult(r2, 'Bottle broken in transit', 'by hand');
    const after = snapshotContent(await input({ promptTexts: { intro: 'Changed.' }, template: { ...annual, blocks: annual.blocks.slice(1) } }));
    const d = diffSnapshots(before, after);
    expect(d.results.changed).toBe(2);
    expect(d.results.inPeriod).toBe(2);
    expect(d.dataInPeriod).toBe(true);
    const lines = d.changes.filter((c) => c.area === 'results').map((c) => c.text);
    expect(lines.some((l) => l.includes('→'))).toBe(true);
    expect(lines.some((l) => l.endsWith('left out (Bottle broken in transit)'))).toBe(true);
    expect(d.changes.some((c) => c.area === 'layout' && c.text === '1 section removed')).toBe(true);
    expect(d.changes.some((c) => c.area === 'commentary')).toBe(true);
    expect(d.summary).toBe('2 results changed in the period, the layout changed and the commentary edited.');
    // the quick check: the fingerprints of the data parts differ only for that site's year
    const k1 = await dataKeys(before), k2 = await dataKeys(after);
    expect(k1.filter((k, i) => k.key !== k2[i].key).map((k) => `${k.site}|${k.year}`)).toEqual([`${s.siteId}|${s.date.slice(0, 4)}`]);
  });

  it('is kept, locked and found again by a file’s fingerprint', async () => {
    const content = snapshotContent(await input());
    const file = new Blob(['%PDF-1.7 the issued report']);
    const hash = await sha256(file);
    const one = await issueReport({ content, templateId: annual.id, report: annual.name, revision: 'Rev 0', to: 'The council', files: [{ name: 'r.pdf', kind: 'pdf', sha256: hash, bytes: file.size }] });
    const kept = await db.archive.where('projectId').equals(projectId).count();
    expect(kept).toBe(1 + content.data.length);
    expect(one.by).toBe('R. Tester');
    expect((await findIssuedFile(hash))?.issue.id).toBe(one.id);
    expect(await findIssuedFile(await sha256('%PDF-1.7 changed afterwards'))).toBeNull();
    await startRevision(one, 'Lab corrected a result');
    const prev = (await db.issues.get(one.id))!;
    expect(prev.revising?.reason).toBe('Lab corrected a result');
    // the revision: nothing changed, so nothing new is kept but its own head
    const two = await issueReport({ content: { ...content, promptTexts: { intro: 'Rev 1 text' } }, templateId: annual.id, report: annual.name, revision: nextRevision([one.revision]), files: [], previous: prev });
    expect(two.revision).toBe('Rev 1');
    expect(two.reason).toBe('Lab corrected a result');
    expect(two.snapshot.added).toBeLessThan(one.snapshot.added / 4);
    expect(await db.archive.where('projectId').equals(projectId).count()).toBe(kept + 1);
    expect((await db.issues.get(one.id))!.revising).toBeUndefined();
    expect((await loadIssued(two)).promptTexts.intro).toBe('Rev 1 text');
    await deleteIssue(two);
    expect(await db.issues.where('projectId').equals(projectId).count()).toBe(1);
    // in the project's backup, with what it was built from
    const pkg = await exportProjectPackage(projectId);
    expect(pkg.data.issues?.length).toBe(1);
    expect(pkg.data.archive?.length).toBe(kept + 1);
  });
});
