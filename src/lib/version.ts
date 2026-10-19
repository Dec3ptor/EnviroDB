// The app's version and build, how versions compare, and whether a newer one has been published.

import { APP_VERSION, RELEASES } from '../data/releases';

export { APP_VERSION, RELEASES };

/** The build: its commit and date (set by the build; "dev" when running from source). */
export const APP_BUILD: { commit: string; date: string } = typeof __APP_BUILD__ !== 'undefined' ? __APP_BUILD__ : { commit: 'dev', date: '' };

/** "EnviroDB 1.2.0" – what files record as their maker. */
export const MADE_BY = `EnviroDB ${APP_VERSION}`;

/** -1, 0 or 1: how version a compares with b ("1.10.0" is after "1.9.2"). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0);
  const pb = b.split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** The releases after a version (newest first) – what's new since then. */
export const releasesSince = (version: string | null) => RELEASES.filter((r) => !version || compareVersions(r.version, version) > 0);

/** What the published app says its version is (version.json, written by the build next to the app). */
export async function publishedVersion(): Promise<{ version: string; commit: string } | null> {
  try {
    const res = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const v = (await res.json()) as { version?: unknown; commit?: unknown };
    return typeof v.version === 'string' ? { version: v.version, commit: String(v.commit ?? '') } : null;
  } catch {
    return null;
  }
}
