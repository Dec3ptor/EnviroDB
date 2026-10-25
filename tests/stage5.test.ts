import { describe, expect, it } from 'vitest';
import { GO_KEYS, PAGES, searchAll, SHORTCUTS, type SearchSource } from '../src/lib/search';
import { newRule, newSite } from '../src/db/repo';

const src: SearchSource = {
  projects: [
    { id: 'p1', name: 'Kōwhai Quarry stormwater discharge', code: 'DEMO-001', client: 'Demo Aggregates Ltd', status: 'active', createdAt: '', updatedAt: '', yearStartMonth: 7 } as never,
    { id: 'p2', name: 'Old landfill groundwater', code: 'LF-9', status: 'archived', createdAt: '', updatedAt: '', yearStartMonth: 7 } as never,
  ],
  sites: [
    { ...newSite('p1', { code: 'US1', name: 'Kōwhai Stream – upstream', aliases: ['Upstream', 'U/S'] }), projectName: 'Kōwhai Quarry' },
    { ...newSite('p1', { code: 'GW1', name: 'Monitoring bore BH1', type: 'Groundwater', aliases: ['BH1'] }), projectName: 'Kōwhai Quarry' },
  ],
  params: [{ id: 'nh4-n', name: 'Total Ammoniacal-N', short: 'NH4-N', group: 'Nutrients', unit: 'mg/L', aliases: ['ammonia', 'ammoniacal nitrogen'] }],
  rules: [{ ...newRule('p1', { name: 'Turbidity increase downstream', condition: 'Condition 12', level: 'Limit' }), projectName: 'Kōwhai Quarry' }],
  obligations: [{ id: 'o1', projectId: 'p1', name: 'Annual monitoring report', kind: 'report', recipient: 'Waikato Regional Council', every: 1, unit: 'year', projectName: 'Kōwhai Quarry' } as never],
  templates: [{ id: 't1', name: 'Annual compliance monitoring report', description: 'Full report' }],
  guidelineSets: [{ id: 'g1', name: 'ANZG (2018) freshwater 95% protection', shortName: 'ANZG FW 95%' }],
};

describe('stage 5: search everything', () => {
  it('a site code, a project, an alias, a parameter', () => {
    expect(searchAll('us1', src)[0]).toMatchObject({ kind: 'site', title: 'US1', to: '/projects/p1/setup' });
    expect(searchAll('bh1', src)[0]).toMatchObject({ kind: 'site', title: 'GW1' });
    expect(searchAll('kowhai', src)[0]).toMatchObject({ kind: 'project', to: '/projects/p1' });
    expect(searchAll('ammonia', src)[0]).toMatchObject({ kind: 'parameter', title: 'Total Ammoniacal-N' });
    expect(searchAll('demo aggregates', src)[0].kind).toBe('project');
  });
  it('pages, limits, reports due, templates and guideline sets', () => {
    expect(searchAll('calendar', src)[0]).toMatchObject({ kind: 'page', to: '/calendar' });
    expect(searchAll('features', src)[0]).toMatchObject({ kind: 'page', to: '/settings?tab=team' });
    expect(searchAll('condition 12', src)[0]).toMatchObject({ kind: 'rule', to: '/projects/p1/compliance' });
    expect(searchAll('council', src)[0]).toMatchObject({ kind: 'obligation', to: '/projects/p1/schedule' });
    expect(searchAll('anzg', src)[0]).toMatchObject({ kind: 'guideline', to: '/guidelines/g1' });
    const annual = searchAll('annual', src);
    expect(annual.map((h) => h.kind)).toEqual(['obligation', 'template']);
  });
  it('every word has to match; the start of a name beats the middle; archived projects say so', () => {
    expect(searchAll('kowhai nothing-like-it', src)).toEqual([]);
    const hits = searchAll('stream', src);
    expect(hits[0].title).toBe('US1');
    expect(searchAll('landfill', src)[0].detail).toContain('archived');
    expect(searchAll('', src)).toEqual([]);
    expect(searchAll('   ', src)).toEqual([]);
  });
  it('the shortcuts and pages are consistent', () => {
    for (const to of Object.values(GO_KEYS)) expect(PAGES.some((p) => p.to === to)).toBe(true);
    expect(SHORTCUTS.some((s) => s.keys === 'Ctrl K')).toBe(true);
  });
});
