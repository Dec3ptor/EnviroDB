// The phone's own store for field mode: the field sheets opened on it and what's been recorded at each site. Kept
// apart from the team's data – the phone isn't connected to the shared folder – until the results are sent.

import Dexie, { type Table } from 'dexie';
import { codeSheet, FIELD_APP, mergeSheets, type FieldCode, type FieldResults, type FieldSheet, type FieldVisit } from './model';

export interface StoredSheet {
  id: string;
  sheet: FieldSheet;
  addedAt: string;
  /** When the results were last sent. */
  sentAt?: string;
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
export async function addSheet(sheet: FieldSheet): Promise<void> {
  const cur = await fieldDb.sheets.get(sheet.id);
  let next = sheet;
  if (cur) {
    const recorded = new Set((await fieldDb.visits.where('sheetId').equals(sheet.id).toArray()).map((v) => v.visit.siteId));
    const kept = { ...cur.sheet, sites: cur.sheet.sites.filter((s) => recorded.has(s.id) || sheet.sites.some((x) => x.id === s.id)) };
    next = mergeSheets(kept, sheet, 'add');
  }
  await fieldDb.sheets.put({ id: sheet.id, sheet: next, addedAt: cur?.addedAt ?? new Date().toISOString(), sentAt: cur?.sentAt });
}

/**
 * A printed code scanned on `date`: its sites join that day's sheet for the project (started if there's none yet),
 * with last time's readings at each from what this phone recorded there before.
 */
export async function addFromCode(code: FieldCode, date: string): Promise<FieldSheet> {
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
  await fieldDb.sheets.put({ id: sheet.id, sheet, addedAt: cur?.addedAt ?? new Date().toISOString(), sentAt: cur?.sentAt });
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

/** What was recorded on a sheet, as the file to send back. */
export function resultsOf(sheet: FieldSheet, visits: FieldVisit[], by: string): FieldResults {
  const order = new Map(sheet.sites.map((s, i) => [s.id, i]));
  return {
    app: FIELD_APP,
    kind: 'field-results',
    v: 1,
    sheet: { id: sheet.id, project: sheet.project, round: sheet.round, date: sheet.date },
    by: by.trim() || undefined,
    sent: new Date().toISOString(),
    visits: visits.filter((v) => order.has(v.siteId) && (v.done || v.notSampled || Object.keys(v.values).length || v.notes)).sort((a, b) => order.get(a.siteId)! - order.get(b.siteId)!),
  };
}

export const resultsFileName = (sheet: FieldSheet) =>
  `Field results - ${sheet.project.code || sheet.project.name} - ${sheet.date}.envirodb-field.json`
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‒-―]/g, '-')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/[\\/:*?"<>|]+/g, '-');
