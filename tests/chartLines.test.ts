import { describe, expect, it } from 'vitest';
import { BUILT_IN_PARAMETERS } from '../src/data/parameters';
import type { Result, Rule, Sample, Site } from '../src/db/types';
import { buildIndex } from '../src/lib/dataIndex';
import { buildChartSpec, LINE_COLORS, thresholdStyles } from '../src/charts/timeSeries';

// Made-up monitoring: zinc and copper at an upstream and a downstream site.
const sites: Site[] = [
  { id: 'us1', projectId: 'p', code: 'US1', type: 'Surface water', role: '', aliases: [], active: true, order: 1 },
  { id: 'ds1', projectId: 'p', code: 'DS1', type: 'Surface water', role: '', aliases: [], active: true, order: 2 },
];
const samples: Sample[] = sites.map((s, i) => ({ id: `s${i}`, projectId: 'p', siteId: s.id, date: '2026-03-01' }));
const results: Result[] = samples.flatMap((s) => ['zn-d', 'cu-d'].map((pid) => ({ id: `${s.id}${pid}`, projectId: 'p', sampleId: s.id, siteId: s.siteId, date: s.date, parameterId: pid, value: 0.01, qualifier: '', unit: 'mg/L' })));
const index = buildIndex(samples, results, sites, BUILT_IN_PARAMETERS);
const param = (id: string) => BUILT_IN_PARAMETERS.find((p) => p.id === id)!;
let n = 0;
const rule = (patch: Partial<Rule>): Rule => ({ id: `r${++n}`, projectId: 'p', name: 'Rule', level: 'Trigger', kind: 'threshold', parameterId: 'zn-d', siteIds: [], operator: '>', value: 0.05, unit: 'mg/L', active: true, order: n, ...patch });
const styles = (rules: Rule[], pid = 'zn-d', dark = false) =>
  thresholdStyles(buildChartSpec({ index, param: param(pid), sites, siteIds: [], guidelineSets: [], rules, showRules: true }).lines, dark).map((s) => ({ name: s.text.match(/^(Trigger [12](?= \d)|\S+)/)![1], color: s.color, dash: s.dash }));
const { light, dark } = LINE_COLORS;

describe('limit, trigger and guideline lines on the graphs', () => {
  it('two triggers on a graph have colours of their own – the main one amber, as in the tables', () => {
    const rules = [rule({ level: 'Trigger 2', value: 0.08 }), rule({ level: 'Trigger 1', value: 0.05 })];
    const s = styles(rules);
    expect(s.map((x) => x.name)).toEqual(['Trigger 1', 'Trigger 2']); // the key in order
    expect(s.map((x) => x.color)).toEqual([light.trigger[0], light.trigger[1]]);
    expect(s[0].dash).not.toEqual(s[1].dash);
    expect(styles(rules, 'zn-d', true).map((x) => x.color)).toEqual([dark.trigger[0], dark.trigger[1]]);
  });

  it('a graph’s only trigger is amber, whatever other graphs have', () => {
    const rules = [rule({ level: 'Trigger 1' }), rule({ level: 'Trigger 2', value: 0.08 }), rule({ level: 'Trigger 2', parameterId: 'cu-d', value: 0.004 }), rule({ level: 'Trigger', parameterId: 'cu-d', siteIds: ['us1'], kind: 'statistic', statistic: 'median', value: 0.003 })];
    const copper = styles(rules.slice(0, 3), 'cu-d');
    expect(copper.map((x) => x.color)).toEqual([light.trigger[0]]);
    // and two on one graph: the main level first
    expect(styles(rules, 'cu-d').map((x) => [x.name, x.color])).toEqual([
      ['Trigger', light.trigger[0]],
      ['Trigger 2', light.trigger[1]],
    ]);
  });

  it('the same trigger set for different sites: a colour for each', () => {
    const s = styles([rule({ siteIds: ['us1'], value: 0.02 }), rule({ siteIds: ['ds1'], value: 0.06 })]);
    expect(s).toHaveLength(2);
    expect(s[0].color).not.toBe(s[1].color);
  });

  it('four triggers on a graph: four colours; a fifth takes a colour again, with other dashes', () => {
    const levels = ['Trigger', 'Trigger 1', 'Trigger 2', 'Alert', 'Target'];
    const s = styles(levels.map((level, i) => rule({ level, value: 0.01 * (i + 1) })));
    expect(s.map((x) => x.name)).toEqual(levels);
    expect(s.slice(0, 4).map((x) => x.color)).toEqual(light.trigger);
    expect(s[4].color).toBe(light.trigger[0]);
    expect(s[4].dash).not.toEqual(s[0].dash);
  });

  it('limits are all red, told apart by their dashes', () => {
    const s = styles([rule({ level: 'Limit', value: 0.1 }), rule({ level: 'Limit', kind: 'statistic', statistic: 'percentile', percentile: 95, value: 0.07 })]);
    expect(s.map((x) => x.color)).toEqual([light.limit[0], light.limit[0]]);
    expect(s[0].dash).not.toEqual(s[1].dash);
  });

  it('every colour differs from every other of its kind, light and dark', () => {
    for (const mode of [light, dark]) for (const list of Object.values(mode)) expect(new Set(list).size).toBe(list.length);
    expect(light.trigger).toHaveLength(dark.trigger.length);
    expect(light.guideline).toHaveLength(dark.guideline.length);
  });
});
