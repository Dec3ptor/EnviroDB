import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { combineSettings, db, MY_SETTINGS } from '../db/db';
import type { Settings } from '../db/types';
import { setDateFormat } from '../lib/dates';

/** The app settings. The same object is returned until they change, so it can be used as an effect dependency. */
export function useSettings(): Settings {
  const recs = useLiveQuery(() => Promise.all([db.meta.get('settings'), db.meta.get(MY_SETTINGS)]), []);
  return useMemo(() => {
    const s = combineSettings(recs?.[0]?.value, recs?.[1]?.value);
    setDateFormat(s.dateFormat);
    return s;
  }, [recs]);
}
