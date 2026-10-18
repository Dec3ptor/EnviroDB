import { describe, expect, it } from 'vitest';
import { revivePeriod, reviveIds } from '../src/hooks/useViewState';
import { sectionSites } from '../src/reports/build';
import { periodPresets, todayStr } from '../src/lib/dates';
import type { Site } from '../src/db/types';

describe('kept page settings', () => {
  it('moves the usual periods on with the date, and keeps fixed ones', () => {
    const revive = revivePeriod(7);
    const last12 = periodPresets(todayStr(), 7).find((p) => p.key === 'last12')!;
    expect(revive({ key: 'last12', start: '2001-01-01', end: '2001-12-31', label: 'Last 12 months' })).toMatchObject({ start: last12.start, end: last12.end });
    const obl = { key: 'obl:o1:3', start: '2025-07-01', end: '2026-06-30', label: 'Annual report: …' };
    expect(revive(obl)).toEqual(obl);
    expect(revive({ key: 'custom', start: '2024-01-01', end: '2024-03-31', label: 'x' })).toMatchObject({ start: '2024-01-01' });
    expect(revive(null as never)).toBeUndefined();
  });

  it('keeps only ids that are still there', () => {
    expect(reviveIds((id) => id !== 'gone')(['a', 'gone', 'b'])).toEqual(['a', 'b']);
    expect(reviveIds(() => true)('nope' as never)).toBeUndefined();
  });
});

describe('a report section’s sites', () => {
  const site = (id: string, active = true): Site => ({ id, projectId: 'p', code: id.toUpperCase(), type: 'Groundwater', role: '', aliases: [], active, order: 1 });
  const all = [site('bh1'), site('bh2'), site('sw1'), site('old', false)];
  it('shows the ones chosen, or all when none are (or none of them are in this report)', () => {
    expect(sectionSites({ siteIds: ['bh2', 'bh1'] }, all).map((s) => s.id)).toEqual(['bh1', 'bh2']);
    expect(sectionSites({ siteIds: [] }, all)).toBe(all);
    expect(sectionSites({ siteIds: ['from-another-project'] }, all)).toBe(all);
    const active = all.filter((s) => s.active);
    expect(sectionSites({ siteIds: ['old'] }, active, all).map((s) => s.id)).toEqual(['old']); // chosen even though inactive
  });
  it('leaves out the sites it is told to', () => {
    expect(sectionSites({ siteIds: [], excludeSiteIds: ['sw1'] }, all).map((s) => s.id)).toEqual(['bh1', 'bh2', 'old']);
    expect(sectionSites({ siteIds: ['bh1', 'bh2'], excludeSiteIds: ['bh2'] }, all).map((s) => s.id)).toEqual(['bh1']);
    expect(sectionSites({ siteIds: [], excludeSiteIds: ['elsewhere'] }, all)).toBe(all);
  });
});
