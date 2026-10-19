// The phone's own store for field mode: the field sheets opened on it and what's been recorded at each site. Kept
// apart from the team's data – the phone isn't connected to the shared folder – until the results are sent.

import Dexie, { type Table } from 'dexie';
import { FIELD_APP, type FieldResults, type FieldSheet, type FieldVisit } from './model';

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

export async function addSheet(sheet: FieldSheet): Promise<void> {
  const cur = await fieldDb.sheets.get(sheet.id);
  await fieldDb.sheets.put({ id: sheet.id, sheet, addedAt: cur?.addedAt ?? new Date().toISOString(), sentAt: cur?.sentAt });
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
