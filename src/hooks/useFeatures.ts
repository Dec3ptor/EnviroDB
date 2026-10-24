import { useMemo } from 'react';
import { featureOn, type Feature } from '../lib/features';
import { useSettings } from './useSettings';

/** Whether the team has a feature on (Settings → Team → Features). */
export function useFeature(f: Feature): boolean {
  return featureOn(useSettings(), f);
}

/** Whether the team has each feature on. */
export function useFeatures(): (f: Feature) => boolean {
  const s = useSettings();
  return useMemo(() => (f: Feature) => featureOn(s, f), [s]);
}
