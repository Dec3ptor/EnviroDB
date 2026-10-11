import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, DEFAULT_SETTINGS } from '../db/db';
import type { Settings } from '../db/types';
import { setDateFormat } from '../lib/dates';

/** The app settings. The same object is returned until they change, so it can be used as an effect dependency. */
export function useSettings(): Settings {
  const rec = useLiveQuery(() => db.meta.get('settings'), []);
  return useMemo(() => {
    const s = { ...DEFAULT_SETTINGS, ...((rec?.value as Partial<Settings>) ?? {}) };
    setDateFormat(s.dateFormat);
    return s;
  }, [rec]);
}
