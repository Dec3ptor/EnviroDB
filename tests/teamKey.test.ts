import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, ensureBuiltIns } from '../src/db/db';
import { createDemoProject } from '../src/db/demo';
import { makeCodes, makeSheet } from '../src/db/field';
import { BUILT_IN_TEMPLATES } from '../src/data/templates';
import type { ReportTemplate } from '../src/db/types';
import { fromBase45 } from '../src/field/link/codec';
import { isSetupText, lock, LockedError, mergeKeys, newTeamKey, parseKeys, readSetupText, setupText, showKeyId, unlock, type TeamKey } from '../src/field/lock';
import { checkResults, checkSheet, codeLink, decodeCode, fieldLinkPath, lockFile, sheetLink, unlockCode, unlockFile, unlockSheet, type FieldResults } from '../src/field/model';
import { addSheet, addTeamKeys, fieldDb, forgetTeamKeys, resultsOf, saveVisit, teamKeys } from '../src/field/db';
import { sniffLabFile } from '../src/importers/sniff';
import { qrMatrix } from '../src/reports/fieldCodes';
import { snapshotContent } from '../src/lib/issued';
import { lockKey } from '../src/components/TeamKey';
import { keepTeamKeys } from '../src/db/backup';
import type { ProjectBundle } from '../src/lib/analysis';
import { loadBundle } from './helpers';

const BASE = 'https://example.github.io/EnviroDB/';
let b: ProjectBundle;
let key: TeamKey;
let other: TeamKey;
beforeAll(async () => {
  await ensureBuiltIns();
  b = await loadBundle(await createDemoProject());
  key = await newTeamKey();
  other = await newTeamKey();
});

const sheetOf = () =>
  makeSheet(b, { round: 'October 2026 monitoring', date: '2026-10-21', siteIds: b.sites.map((s) => s.id), measureIds: ['ph-field', 'temp'], observe: { weather: true, flow: false, appearance: false, photos: false }, withLast: false });
const codesOf = () =>
  makeCodes(b, { siteIds: b.sites.map((s) => s.id), measureIds: ['ph-field', 'temp'], observe: { weather: true, flow: true, appearance: true, photos: true }, fill: { time: true, gps: true }, withLocation: true, withNotes: true });
const why = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e instanceof LockedError ? e.reason : (e as Error).message;
  }
  return 'opened';
};

describe('the team key', () => {
  it('is off unless the team turns it on', () => {
    expect(DEFAULT_SETTINGS.teamKey).toBeUndefined();
    expect(lockKey(DEFAULT_SETTINGS)).toBeNull();
    expect(lockKey({ ...DEFAULT_SETTINGS, teamKey: { on: false, keys: [key] } })).toBeNull();
    expect(lockKey({ ...DEFAULT_SETTINGS, teamKey: { on: true, keys: [key, other] } })).toBe(key);
  });

  it('locks so that only the key opens it, and nothing changed passes', async () => {
    expect(key.id).toMatch(/^[A-Z2-7]{8}$/);
    expect(showKeyId(key.id)).toMatch(/^[A-Z2-7]{4}-[A-Z2-7]{4}$/);
    expect(key.id).not.toBe(other.id);
    const msg = new TextEncoder().encode('US1 behind the woolshed, gate code 1234');
    const locked = await lock(msg, key, 'sheet');
    expect(new TextDecoder().decode(locked)).not.toMatch(/woolshed|1234/);
    expect(new TextDecoder().decode(await unlock(locked, [other, key], 'sheet'))).toBe('US1 behind the woolshed, gate code 1234');
    // a different key, a changed byte, or a sheet passed off as a code: turned away
    expect(await why(unlock(locked, [other], 'sheet'))).toBe('no-key');
    expect(await why(unlock(locked, [], 'sheet'))).toBe('no-key');
    const changed = locked.slice();
    changed[changed.length - 3] ^= 1;
    expect(await why(unlock(changed, [key], 'sheet'))).toBe('damaged');
    expect(await why(unlock(locked, [key], 'code'))).toBe('damaged');
    // the same thing locked twice looks different (a fresh start each time)
    expect(Buffer.from(await lock(msg, key, 'sheet')).equals(Buffer.from(locked))).toBe(false);
  });

  it('field sheet links: locked with the key when on, as before when off', async () => {
    const sheet = sheetOf();
    const plain = await sheetLink(BASE, sheet, null);
    expect(plain).toMatch(/#\/field\/open\?s=/);
    const locked = await sheetLink(BASE, sheet, key);
    expect(locked).toMatch(/#\/field\/open\?e=[A-Za-z0-9_-]+$/);
    const path = fieldLinkPath(locked)!;
    expect(path).toMatch(/^\/field\/open\?e=/);
    const e = path.split('e=')[1];
    // nothing of the sheet shows
    const site = b.sites[0];
    expect(Buffer.from(e, 'base64url').toString('latin1')).not.toContain(site.code);
    const opened = await unlockSheet(e, [key]);
    expect(opened.keyId).toBe(key.id);
    expect(opened.sheet).toEqual(checkSheet(JSON.parse(JSON.stringify(sheet))));
    expect(await why(unlockSheet(e, [other]))).toBe('no-key');
  });

  it('printed codes: locked codes still fit a QR code’s letters, and open only with the key', async () => {
    const { project, sites } = codesOf();
    const plain = await codeLink(BASE, sites[0], null);
    const locked = await codeLink(BASE, sites[0], key);
    expect(locked).toMatch(/#\/field\/code\?x=[A-Z2-7]+$/);
    // the lock adds a few dozen letters, no more
    expect(locked.length - plain.length).toBeLessThan(60);
    const qr = qrMatrix(locked)!;
    expect(qr.level).toBe('M');
    expect(qrMatrix(await codeLink(BASE, project, key))).not.toBeNull();
    const x = fieldLinkPath(locked)!.split('x=')[1];
    const { code, keyId } = await unlockCode(x, [other, key]);
    expect(keyId).toBe(key.id);
    expect(code).toEqual(await decodeCode(fieldLinkPath(plain)!.split('k=')[1]));
    expect(await why(unlockCode(x, [other]))).toBe('no-key');
    // a locked code isn't a plain one
    expect(await why(decodeCode(x))).toMatch(/isn’t an EnviroDB field code/);
  });

  it('files: a locked results file shows only what it is and its project, and the inbox still knows it', async () => {
    const sheet = sheetOf();
    await addSheet(sheet, key.id);
    await saveVisit(sheet.id, { siteId: sheet.sites[0].id, time: '2026-10-21T09:10', values: { 'ph-field': 7.3 }, notes: 'Gate code 1234', done: true });
    const visits = (await fieldDb.visits.where('sheetId').equals(sheet.id).toArray()).map((v) => v.visit);
    const results = resultsOf((await fieldDb.sheets.get(sheet.id))!.sheet, visits, 'R. Tester');
    const file = await lockFile(results, key);
    const text = JSON.stringify(file);
    expect(text).not.toMatch(/Gate code|R\. Tester|7\.3|October/);
    expect(text).not.toContain(sheet.sites[0].code);
    const sniff = await sniffLabFile(new File([text], 'Field results - DEMO - 2026-10-21.envirodb-field.json'));
    expect(sniff).toMatchObject({ lab: true, labName: 'Field results', field: { projectId: sheet.project.id } });
    const { content, keyId } = await unlockFile(JSON.parse(text), [key]);
    expect(keyId).toBe(key.id);
    expect(checkResults(content)).toEqual(checkResults(JSON.parse(JSON.stringify(results))) as FieldResults);
    expect(await why(unlockFile(JSON.parse(text), [other]))).toBe('no-key');
    // a sheet file too; anything not locked comes through as it was
    const sheetFile = await lockFile(sheet, key);
    expect(sheetFile).toMatchObject({ app: 'EnviroDB', kind: 'field-sheet' });
    expect(checkSheet((await unlockFile(sheetFile, [key])).content).id).toBe(sheet.id);
    expect((await unlockFile(results, [])).content).toBe(results);
    // a results file can't be passed off as a sheet
    expect(await why(unlockFile({ ...file, kind: 'field-sheet' }, [key]))).toBe('damaged');
  });

  it('setting up a phone: the keys from the computer’s code, kept on the phone; a sheet that came locked is remembered', async () => {
    const text = setupText([other, key]);
    expect(isSetupText(text)).toBe(true);
    // never taken for one of the phone link's codes, or a field link
    expect(() => fromBase45(text)).toThrow();
    expect(fieldLinkPath(text)).toBeNull();
    const got = await readSetupText(text);
    expect(got.map((k) => [k.id, k.key])).toEqual([
      [other.id, other.key],
      [key.id, key.key],
    ]);
    await expect(readSetupText('EnviroDB-team-key-1/AAAA')).rejects.toThrow(/damaged/);
    await expect(readSetupText('https://example.com')).rejects.toThrow(/isn’t an EnviroDB team key/);

    expect(await teamKeys()).toEqual([]);
    await addTeamKeys([key]);
    await addTeamKeys(got);
    expect((await teamKeys()).map((k) => k.id)).toEqual([other.id, key.id]);
    expect(mergeKeys([key], [key, other]).map((k) => k.id)).toEqual([key.id, other.id]);
    expect(parseKeys('{"not":"keys"}')).toEqual([]);
    expect(parseKeys(JSON.stringify([{ id: 'x', key: 'y' }, key]))).toEqual([key]);

    // the computer's sheet opened again unlocked: the phone still sends the results back locked
    const sheet = sheetOf();
    await addSheet(sheet, key.id);
    await addSheet(sheet);
    expect((await fieldDb.sheets.get(sheet.id))?.lockedWith).toBe(key.id);
    await forgetTeamKeys();
    expect(await teamKeys()).toEqual([]);
  });

  it('an older backup restored never loses a key', () => {
    // the backup had none: the key stays, off (as the backup was)
    expect(keepTeamKeys({ on: true, keys: [key] }, undefined)).toEqual({ on: false, keys: [key] });
    // the backup had an older key on: on, with both
    expect(keepTeamKeys({ on: true, keys: [key] }, { on: true, keys: [other] })).toEqual({ on: true, keys: [other, key] });
    expect(keepTeamKeys(undefined, undefined)).toBeUndefined();
  });

  it('never goes into an issued report’s record', async () => {
    const annual = BUILT_IN_TEMPLATES.find((t) => t.id === 'tpl-annual') as ReportTemplate | undefined;
    if (!annual) return;
    const content = snapshotContent({
      bundle: b,
      template: annual,
      period: { start: '2025-07-01', end: '2026-06-30', label: 'July 2025 to June 2026' },
      settings: { ...DEFAULT_SETTINGS, company: 'Example Ltd', teamKey: { on: true, keys: [key] } },
      issuedOn: '2026-07-20',
    });
    expect(JSON.stringify(content)).not.toContain(key.key);
    expect(content.settings.company).toBe('Example Ltd');
  });
});
