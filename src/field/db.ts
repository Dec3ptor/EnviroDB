// The phone's own store for field mode: the field sheets opened on it and what's been recorded at each site. Kept
// apart from the team's data – the phone isn't connected to the shared folder – until the results are sent.

import Dexie, { type Table } from 'dexie';
import { codeSheet, FIELD_APP, mergeSheets, type FieldCode, type FieldResults, type FieldSheet, type FieldSite, type FieldVisit } from './model';
import { mergeKeys, parseKeys, type TeamKey } from './lock';

export interface StoredSheet {
  id: string;
  sheet: FieldSheet;
  addedAt: string;
  /** When the results were last sent. */
  sentAt?: string;
  /** The team key it came locked with (its fingerprint): the results file is locked with it too. */
  lockedWith?: string;
}

export interface StoredVisit {
  /** `${sheetId}|${siteId}` */
  id: string;
  sheetId: string;
  visit: FieldVisit;
  updatedAt: string;
}

class FieldDatabase extends Dexie {
  sheets!: Table<StoredSheet, string>;
  visits!: Table<StoredVisit, string>;
  prefs!: Table<{ key: string; value: string }, string>;
  constructor() {
    super('EnviroDB-field');
    this.version(1).stores({ sheets: 'id, addedAt', visits: 'id, sheetId', prefs: 'key' });
  }
}

export const fieldDb = new FieldDatabase();

/**
 * A sheet from the computer, kept on the phone. Opened again for the same day (made again on the computer), it takes
 * the new sheet's sites and readings – keeping any site recorded here that the new one leaves out (one scanned from
 * its printed code, say).
 */
export async function addSheet(sheet: FieldSheet, lockedWith?: string): Promise<void> {
  const cur = await fieldDb.sheets.get(sheet.id);
  let next = sheet;
  if (cur) {
    const recorded = new Set((await fieldDb.visits.where('sheetId').equals(sheet.id).toArray()).map((v) => v.visit.siteId));
    // sites recorded here, added here or placed here stay; others the computer's sheet leaves out go
    const kept = { ...cur.sheet, sites: cur.sheet.sites.filter((s) => recorded.has(s.id) || s.added || s.located || sheet.sites.some((x) => x.id === s.id)) };
    next = mergeSheets(kept, sheet, 'add');
  }
  await fieldDb.sheets.put({ id: sheet.id, sheet: next, addedAt: cur?.addedAt ?? new Date().toISOString(), sentAt: cur?.sentAt, lockedWith: lockedWith ?? cur?.lockedWith });
}

/**
 * A printed code scanned on `date`: its sites join that day's sheet for the project (started if there's none yet),
 * with last time's readings at each from what this phone recorded there before.
 */
export async function addFromCode(code: FieldCode, date: string, lockedWith?: string): Promise<FieldSheet> {
  const fresh = codeSheet(code, date);
  const before = (await fieldDb.visits.toArray()).filter((v) => v.sheetId.startsWith(`${code.project.id}:`) && v.sheetId.slice(code.project.id.length + 1) < date && Object.keys(v.visit.values).length);
  fresh.sites = fresh.sites.map((site) => {
    const mine = before.filter((v) => v.visit.siteId === site.id);
    const latest = mine.sort((a, b) => ((a.visit.time ?? a.sheetId) < (b.visit.time ?? b.sheetId) ? 1 : -1))[0];
    if (!latest) return site;
    const values = Object.fromEntries(fresh.measures.filter((m) => latest.visit.values[m.id] !== undefined).map((m) => [m.id, latest.visit.values[m.id]]));
    const day = (latest.visit.time ?? latest.sheetId.slice(code.project.id.length + 1)).slice(0, 10);
    return Object.keys(values).length ? { ...site, last: { date: day, values } } : site;
  });
  const cur = await fieldDb.sheets.get(fresh.id);
  const sheet = cur ? mergeSheets(cur.sheet, fresh, 'old') : fresh;
  await fieldDb.sheets.put({ id: sheet.id, sheet, addedAt: cur?.addedAt ?? new Date().toISOString(), sentAt: cur?.sentAt, lockedWith: lockedWith ?? cur?.lockedWith });
  return sheet;
}

export async function deleteSheet(id: string): Promise<void> {
  await fieldDb.transaction('rw', fieldDb.sheets, fieldDb.visits, async () => {
    await fieldDb.visits.where('sheetId').equals(id).delete();
    await fieldDb.sheets.delete(id);
  });
}

export async function saveVisit(sheetId: string, visit: FieldVisit): Promise<void> {
  await fieldDb.visits.put({ id: `${sheetId}|${visit.siteId}`, sheetId, visit, updatedAt: new Date().toISOString() });
}

export async function getPref(key: string): Promise<string> {
  return (await fieldDb.prefs.get(key))?.value ?? '';
}
export async function setPref(key: string, value: string): Promise<void> {
  await fieldDb.prefs.put({ key, value });
}

/** The team's keys this phone was set up with, newest first (none unless it was set up). */
export async function teamKeys(): Promise<TeamKey[]> {
  return parseKeys(await getPref('teamKeys'));
}
/** Setting the phone up for the team: the keys join any it has (newest first). */
export async function addTeamKeys(keys: TeamKey[]): Promise<TeamKey[]> {
  const next = mergeKeys(keys, await teamKeys());
  await setPref('teamKeys', JSON.stringify(next));
  return next;
}
export async function forgetTeamKeys(): Promise<void> {
  await fieldDb.prefs.delete('teamKeys');
}

/** What was recorded on a sheet, as the file to send back: the visits, sites added here, locations set here. */
export function resultsOf(sheet: FieldSheet, visits: FieldVisit[], by: string): FieldResults {
  const order = new Map(sheet.sites.map((s, i) => [s.id, i]));
  const added = sheet.sites.filter((s) => s.added);
  const located = sheet.sites.filter((s) => s.located && !s.added && s.lat !== undefined && s.lng !== undefined);
  return {
    app: FIELD_APP,
    kind: 'field-results',
    v: 1,
    sheet: { id: sheet.id, project: sheet.project, round: sheet.round, date: sheet.date },
    by: by.trim() || undefined,
    sent: new Date().toISOString(),
    visits: visits.filter((v) => order.has(v.siteId) && (v.done || v.notSampled || Object.keys(v.values).length || v.notes)).sort((a, b) => order.get(a.siteId)! - order.get(b.siteId)!),
    ...(added.length ? { newSites: added.map((s) => ({ id: s.id, code: s.code, name: s.name, type: s.type, lat: s.lat, lng: s.lng, acc: s.located?.acc, how: s.located?.how, note: s.note })) } : {}),
    ...(located.length ? { located: located.map((s) => ({ siteId: s.id, lat: s.lat!, lng: s.lng!, acc: s.located!.acc, how: s.located!.how, at: s.located!.at })) } : {}),
  };
}

/** Changes a site on a sheet kept on the phone (its location, say). */
export async function updateSite(sheetId: string, siteId: string, patch: Partial<FieldSite>): Promise<void> {
  await fieldDb.transaction('rw', fieldDb.sheets, async () => {
    const cur = await fieldDb.sheets.get(sheetId);
    if (!cur) return;
    await fieldDb.sheets.put({ ...cur, sheet: { ...cur.sheet, sites: cur.sheet.sites.map((s) => (s.id === siteId ? { ...s, ...patch } : s)) } });
  });
}

/** A new monitoring point, added to the sheet (at the end). */
export async function addSite(sheetId: string, site: FieldSite): Promise<void> {
  await fieldDb.transaction('rw', fieldDb.sheets, async () => {
    const cur = await fieldDb.sheets.get(sheetId);
    if (!cur) return;
    await fieldDb.sheets.put({ ...cur, sheet: { ...cur.sheet, sites: [...cur.sheet.sites.filter((s) => s.id !== site.id), site] } });
  });
}

export const resultsFileName = (sheet: FieldSheet) =>
  `Field results - ${sheet.project.code || sheet.project.name} - ${sheet.date}.envirodb-field.json`
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‒-―]/g, '-')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/[\\/:*?"<>|]+/g, '-');
