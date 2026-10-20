import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import jsQR from 'jsqr';
import { ensureBuiltIns } from '../src/db/db';
import { createDemoProject } from '../src/db/demo';
import { makeCodes, makeSheet } from '../src/db/field';
import { checkCode, codeSheet, decodeCode, distanceM, encodeCode, fieldLinkPath, mergeSheets, type FieldCode, type FieldSheet } from '../src/field/model';
import { fieldCodesDefinition, fieldCodesPdfBytes, qrMatrix, type CodesPdfInput } from '../src/reports/fieldCodes';
import type { ProjectBundle } from '../src/lib/analysis';
import { addFromCode, addSheet, fieldDb, saveVisit } from '../src/field/db';
import { loadBundle } from './helpers';

let b: ProjectBundle;
beforeAll(async () => {
  await ensureBuiltIns();
  b = await loadBundle(await createDemoProject());
});

const choices = (patch: Partial<Parameters<typeof makeCodes>[1]> = {}) => ({
  siteIds: b.sites.map((s) => s.id),
  measureIds: ['ph-field', 'temp', 'ec-field', 'do'].filter((id) => b.paramMap.has(id)),
  observe: { weather: true, flow: true, appearance: true, photos: true },
  fill: { time: true, gps: true },
  withLocation: true,
  withNotes: false,
  ...patch,
});
const BASE = 'https://example.github.io/EnviroDB/';
const link = async (c: FieldCode) => `${BASE}#/field/code?k=${await encodeCode(c)}`;

describe('printed field codes', () => {
  it('a code for the project and one for each site – no day, no results, no notes unless asked', async () => {
    const { project, sites } = makeCodes(b, choices());
    expect(project.sites.map((s) => s.code)).toEqual(b.sites.map((s) => s.code));
    expect(sites).toHaveLength(b.sites.length);
    expect(sites.every((c) => c.site === c.sites[0].id && c.sites.length === 1)).toBe(true);
    const json = JSON.stringify(project);
    expect(json).not.toMatch(/"date"|"round"|"last"|"note"/);
    expect(makeCodes(b, choices({ withNotes: true })).project.sites.some((s) => s.note)).toBe(b.sites.some((s) => s.description));
    expect(makeCodes(b, choices({ withLocation: false })).project.sites.every((s) => s.lat === undefined)).toBe(true);
    // a site's code asks only for that site's readings (a bore isn't asked for flow readings and so on)
    const sheet = makeSheet(b, { round: '', date: '', siteIds: choices().siteIds, measureIds: choices().measureIds, observe: choices().observe, withLast: false });
    for (const c of sites) {
      const own = sheet.sites.find((s) => s.id === c.site)!.measures;
      expect(c.measures.map((m) => m.id)).toEqual(own ?? sheet.measures.map((m) => m.id));
    }
  });

  it('read back from the link as it was; anything else is turned away', async () => {
    const { sites } = makeCodes(b, choices());
    const l = await link(sites[0]);
    expect(fieldLinkPath(l)).toMatch(/^\/field\/code\?k=[A-Z2-7]+$/);
    expect(fieldLinkPath('https://example.com/?q=1')).toBeNull();
    const back = await decodeCode(fieldLinkPath(l)!.split('k=')[1]);
    expect(back).toMatchObject({ kind: 'field-code', site: sites[0].site, project: sites[0].project, fill: { time: true, gps: true } });
    expect(back.sites[0]).toMatchObject({ id: sites[0].sites[0].id, code: sites[0].sites[0].code });
    expect(() => checkCode({ app: 'EnviroDB', kind: 'field-sheet' })).toThrow(/isn’t an EnviroDB field code/);
    expect(() => checkCode({ app: 'EnviroDB', kind: 'field-code', project: { name: 'x' }, sites: [{ id: 'a', code: 'A' }] })).toThrow(/which project/);
    // a site that isn't among the code's sites isn't opened
    expect(checkCode({ ...sites[0], site: 'somewhere-else' }).site).toBeUndefined();
  });

  it('small enough for a printed QR code that reads – and it reads back', async () => {
    const { project, sites } = makeCodes(b, choices({ withNotes: true }));
    for (const c of sites) {
      const l = await link(c);
      const m = qrMatrix(l)!;
      expect(m.level).toBe('M');
      expect(m.n).toBeLessThanOrEqual(81); // version 16 or below: big squares on a card
    }
    // the drawn code reads back as the link (a picture of its squares, as the phone's camera sees it)
    const l = await link(sites[1]);
    const m = qrMatrix(l)!;
    const px = 4, side = (m.n + 8) * px;
    const img = new Uint8ClampedArray(side * side * 4).fill(255);
    for (const [r, c] of m.dark) for (let y = 0; y < px; y++) for (let x = 0; x < px; x++) {
      const i = (((r + 4) * px + y) * side + (c + 4) * px + x) * 4;
      img[i] = img[i + 1] = img[i + 2] = 0;
    }
    expect(jsQR(img, side, side)?.data).toBe(l);
    expect(qrMatrix(await link(project))).not.toBeNull();
  });

  it('scanned, a code starts the day’s sheet – named as the computer names it, so the two become one', () => {
    const { project, sites } = makeCodes(b, choices());
    const day = codeSheet(sites[0], '2026-10-20');
    const computer = makeSheet(b, { round: 'October 2026 monitoring', date: '2026-10-20', siteIds: [b.sites[0].id, b.sites[1].id], measureIds: choices().measureIds, observe: { weather: true, flow: false, appearance: false, photos: false }, withLast: true });
    expect(day.id).toBe(computer.id);
    expect(day.round).toBe('October 2026 monitoring');
    expect(project.sites).toHaveLength(b.sites.length);
  });

  it('a site scanned joins the day’s sheet; the computer’s sheet opened again keeps it', () => {
    const { sites } = makeCodes(b, choices());
    const measureIds = choices().measureIds;
    const computer = makeSheet(b, { round: 'October 2026 monitoring', date: '2026-10-20', siteIds: [b.sites[0].id], measureIds: measureIds.slice(0, 2), observe: { weather: true, flow: false, appearance: false, photos: false }, withLast: true });
    const last = b.sites.find((s) => s.code === 'GW1')!;
    const scanned = codeSheet(sites.find((c) => c.site === last.id)!, '2026-10-20');
    const merged = mergeSheets(computer, scanned, 'old');
    expect(merged.sites.map((s) => s.id)).toEqual([b.sites[0].id, last.id]);
    expect(merged.round).toBe(computer.round);
    // every reading either asks for; each site still only its own
    expect(merged.measures.map((m) => m.id)).toEqual([...new Set([...measureIds.slice(0, 2), ...scanned.measures.map((m) => m.id)])]);
    const ownOf = (sh: FieldSheet, id: string) => sh.sites.find((s) => s.id === id)!.measures ?? sh.measures.map((m) => m.id);
    expect(ownOf(merged, b.sites[0].id)).toEqual(ownOf(computer, b.sites[0].id));
    expect(ownOf(merged, last.id)).toEqual(ownOf(scanned, last.id));
    expect(merged.observe).toEqual({ weather: true, flow: true, appearance: true, photos: true });
    // a code can't rename what's there already
    const renamed = codeSheet({ ...sites[0], project: { ...sites[0].project, name: 'Something else' }, sites: [{ ...sites[0].sites[0], name: 'Renamed' }] }, '2026-10-20');
    const kept = mergeSheets(computer, renamed, 'old');
    expect(kept.project.name).toBe(computer.project.name);
    expect(kept.sites[0].name).toBe(computer.sites[0].name);
    // last time's readings from the computer's sheet stay
    expect(kept.sites[0].last).toEqual(computer.sites[0].last);
  });

  it('says how far the phone is from the site', () => {
    expect(distanceM({ lat: -36.85, lng: 174.76 }, { lat: -36.85, lng: 174.76 })).toBe(0);
    const d = distanceM({ lat: -36.85, lng: 174.76 }, { lat: -36.86, lng: 174.76 });
    expect(d).toBeGreaterThan(1100);
    expect(d).toBeLessThan(1120);
  });

  it('the PDF: a cover with the project’s code and the sites, then the sites’ codes in each layout', async () => {
    const { project, sites } = makeCodes(b, choices({ withNotes: true }));
    const input = async (layout: CodesPdfInput['layout'], withProject = true): Promise<CodesPdfInput> => ({
      project: { name: b.project.name, code: b.project.code },
      projectCode: withProject ? { code: project, link: await link(project) } : undefined,
      siteCodes: await Promise.all(sites.map(async (c) => ({ code: c, link: await link(c) }))),
      layout,
      show: { name: true, project: true, location: true, notes: true, readings: true },
      fill: { time: true, gps: true },
      printed: '2026-10-20',
    });
    const text = (x: unknown): string => JSON.stringify(x);
    const cards = fieldCodesDefinition(await input('cards'));
    expect(text(cards.content)).toContain('The project’s code');
    for (const s of b.sites) expect(text(cards.content)).toContain(`"text":"${s.code}"`);
    expect(text(cards.content)).toContain('fills in the time and records the phone’s location');
    // the number of pages of site codes: 4 a page, 8 a page, one each
    const pagesOf = (dd: ReturnType<typeof fieldCodesDefinition>) => (dd.content as Array<{ table?: unknown }>).filter((c) => c.table && (c as { layout?: unknown }).layout !== 'lightHorizontalLines').length;
    expect(pagesOf(cards)).toBe(Math.ceil(b.sites.length / 4));
    expect(pagesOf(fieldCodesDefinition(await input('labels')))).toBe(Math.ceil(b.sites.length / 8));
    expect(pagesOf(fieldCodesDefinition(await input('page', false)))).toBe(b.sites.length);
    const bytes = await fieldCodesPdfBytes(await input('cards'));
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
  }, 60_000);

  it('on the phone: sites scanned one after another make one sheet for the day, with last time from the phone', async () => {
    const { sites } = makeCodes(b, choices());
    const [a, c] = [sites[0], sites[2]];
    // a visit recorded at the first site last month, on this phone
    await saveVisit(`${b.project.id}:2026-09-15`, { siteId: a.site!, time: '2026-09-15T10:05', values: { 'ph-field': 7.2, temp: 14.1 } });
    const one = await addFromCode(a, '2026-10-20');
    const two = await addFromCode(c, '2026-10-20');
    expect(two.id).toBe(one.id);
    expect(two.sites.map((s) => s.id)).toEqual([a.site, c.site]);
    expect(two.sites[0].last).toEqual({ date: '2026-09-15', values: { 'ph-field': 7.2, temp: 14.1 } });
    expect(await fieldDb.sheets.count()).toBe(1);
    // the same code again: nothing doubled
    expect((await addFromCode(c, '2026-10-20')).sites).toHaveLength(2);
    // the computer's sheet for the day opened after: its sites, and the scanned one recorded here stays
    await saveVisit(two.id, { siteId: c.site!, time: '2026-10-20T11:00', values: { temp: 15 } });
    const computer = makeSheet(b, { round: 'October 2026 monitoring', date: '2026-10-20', siteIds: [b.sites[0].id, b.sites[1].id], measureIds: choices().measureIds, observe: choices().observe, withLast: true });
    await addSheet(computer);
    const kept = (await fieldDb.sheets.get(two.id))!.sheet;
    expect(kept.sites.map((s) => s.id)).toEqual([b.sites[0].id, b.sites[1].id, c.site]);
    // a site from a code with nothing recorded, not on the computer's sheet, goes (the computer's sheet decides)
    const lone = sites[3];
    await addFromCode(lone, '2026-10-20');
    await addSheet(computer);
    expect((await fieldDb.sheets.get(two.id))!.sheet.sites.map((s) => s.id)).not.toContain(lone.site);
    // made again on the computer with fewer readings: the phone asks for those at the computer's sites
    await addSheet({ ...computer, measures: computer.measures.slice(0, 1), sites: computer.sites.map((s) => ({ ...s, measures: undefined })) });
    const again = (await fieldDb.sheets.get(two.id))!.sheet;
    const ownOf = (id: string) => again.sites.find((s) => s.id === id)!.measures ?? again.measures.map((m) => m.id);
    expect(ownOf(b.sites[0].id)).toEqual([computer.measures[0].id]);
    expect(ownOf(c.site!)).toEqual(c.measures.map((m) => m.id));
  });
});
