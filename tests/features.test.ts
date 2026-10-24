import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/db/db';
import { FEATURES, featureOn, featurePreset, presetOf, PROJECT_TABS, tabOf, trendsReady, viewOff, visibleViews, type ProjectFacts } from '../src/lib/features';

const facts = (patch: Partial<ProjectFacts> = {}): ProjectFacts => ({ project: {}, sites: [{ type: 'Groundwater' }], sampleDates: ['2026-03-01'], ...patch });
const monthly = (from: string, n: number) => Array.from({ length: n }, (_, i) => new Date(Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1 + i, 15)).toISOString().slice(0, 10));

describe('features', () => {
  it('a team that hasn’t chosen has the essentials: the calendar, nothing else extra', () => {
    expect(DEFAULT_SETTINGS.features).toBeUndefined();
    expect(FEATURES.filter((f) => featureOn(DEFAULT_SETTINGS, f.key)).map((f) => f.key)).toEqual(['calendar']);
    expect(presetOf(DEFAULT_SETTINGS)).toBe('essentials');
    const all = { features: featurePreset(true) };
    expect(FEATURES.every((f) => featureOn(all, f.key))).toBe(true);
    expect(presetOf(all)).toBe('everything');
    expect(presetOf({ features: { field: true } })).toBe('custom');
    expect(featureOn({ features: { calendar: false } }, 'calendar')).toBe(false);
  });

  it('QA/QC is off for every project until turned on for it', () => {
    expect(viewOff('qa', facts(), DEFAULT_SETTINGS)).toMatch(/off for this project/);
    expect(viewOff('qa', facts({ project: { qa: false } }), DEFAULT_SETTINGS)).not.toBeNull();
    expect(viewOff('qa', facts({ project: { qa: true } }), DEFAULT_SETTINGS)).toBeNull();
    expect(visibleViews('data', facts(), DEFAULT_SETTINGS).map((v) => v.value)).toEqual(['data']);
    expect(visibleViews('data', facts({ project: { qa: true } }), DEFAULT_SETTINGS).map((v) => v.value)).toEqual(['data', 'qa']);
  });

  it('NPS-FM: on for the team, and only for a project with freshwater sites', () => {
    const on = { features: { npsfm: true } };
    expect(viewOff('npsfm', facts({ sites: [{ type: 'Surface water' }] }), DEFAULT_SETTINGS)).toMatch(/switched off for the team/);
    expect(viewOff('npsfm', facts(), on)).toMatch(/no surface water sites/);
    expect(viewOff('npsfm', facts({ sites: [{ type: 'Surface water' }] }), on)).toBeNull();
  });

  it('trends: after two years and eight sampling days', () => {
    expect(trendsReady(monthly('2025-01', 12)).ready).toBe(false); // a year
    expect(trendsReady(['2023-01-01', '2025-06-01']).ready).toBe(false); // two days
    expect(trendsReady([...monthly('2023-01', 30), ...monthly('2023-01', 30)])).toMatchObject({ ready: true, days: 30 });
    expect(viewOff('trends', facts(), DEFAULT_SETTINGS)).toMatch(/so far 1 day\)/);
    expect(visibleViews('charts', facts({ sampleDates: monthly('2023-01', 30) }), DEFAULT_SETTINGS).map((v) => v.value)).toEqual(['charts', 'trends']);
  });

  it('a new project shows seven tabs, each with only its own view', () => {
    expect(PROJECT_TABS.map((t) => t.label)).toEqual(['Overview', 'Data', 'Graphs', 'Map', 'Compliance', 'Reports', 'Setup']);
    const shown = PROJECT_TABS.map((t) => [t.value, visibleViews(t.value, facts(), DEFAULT_SETTINGS).map((v) => v.value)]);
    expect(shown).toEqual([
      ['overview', ['overview', 'schedule']],
      ['data', ['data']],
      ['charts', ['charts']],
      ['map', ['map']],
      ['compliance', ['compliance']],
      ['reports', ['reports']],
      ['setup', ['setup']],
    ]);
    // every view has one tab, and links to the old tabs still land in the right one
    const all = PROJECT_TABS.flatMap((t) => t.views.map((v) => v.value));
    expect(new Set(all).size).toBe(all.length);
    expect(['qa', 'trends', 'npsfm', 'schedule', 'pack'].map(tabOf)).toEqual(['data', 'charts', 'compliance', 'overview', 'reports']);
    expect(tabOf('import')).toBe('overview');
  });
});
