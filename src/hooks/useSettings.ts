import { useLiveQuery } from 'dexie-react-hooks';
import { db, DEFAULT_SETTINGS } from '../db/db';
import type { Settings } from '../db/types';
import { setDateFormat } from '../lib/dates';

export function useSettings(): Settings {
  const rec = useLiveQuery(() => db.meta.get('settings'), []);
  const s = { ...DEFAULT_SETTINGS, ...((rec?.value as Partial<Settings>) ?? {}) };
  setDateFormat(s.dateFormat);
  return s;
}
