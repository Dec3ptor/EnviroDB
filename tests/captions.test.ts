import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, ensureBuiltIns } from '../src/db/db';
import { createDemoProject } from '../src/db/demo';
import { BUILT_IN_TEMPLATES } from '../src/data/templates';
import type { ReportBlock, ReportTemplate, Sample, Settings } from '../src/db/types';
import type { ProjectBundle } from '../src/lib/analysis';
import { buildIndex } from '../src/lib/dataIndex';
import { buildReport } from '../src/reports/build';
import { captionOf, defaultCaption, fillCaption, tidyCaption, withCaption } from '../src/reports/captions';
import type { DocNode, ReportDoc } from '../src/reports/model';
import { formatDate } from '../src/lib/dates';
import { loadBundle } from './helpers';

type Table = Extract<DocNode, { t: 'table' }>;
type Heading = Extract<DocNode, { t: 'h' }>;

const event = BUILT_IN_TEMPLATES.find((t) => t.id === 'tpl-letter-event')!;
const march = { start: '2026-03-01', end: '2026-03-31', label: 'March 2026' };
const me: Settings = { ...DEFAULT_SETTINGS, author: 'Test Author' };
let bundle: ProjectBundle;
beforeAll(async () => {
  await ensureBuiltIns();
  bundle = await loadBundle(await createDemoProject());
});
const report = (blocks: ReportBlock[], b: ProjectBundle = bundle, period = march): ReportDoc => buildReport({ bundle: b, template: { ...event, blocks } as ReportTemplate, period, settings: me });
const tables = (doc: ReportDoc) => doc.nodes.filter((n): n is Table => n.t === 'table');
const dp1 = () => bundle.sites.find((s) => s.code === 'DP1')!;
const rounds = (patch: Partial<Extract<ReportBlock, { type: 'roundTable' }>> = {}): ReportBlock => ({ id: 'r1', type: 'roundTable', title: '', siteIds: [dp1().id], parameterIds: [], previous: 1, ruleColumns: 'all', comment: true, summaries: false, siteLabel: 'caption', ...patch });
/** DP1's sample dates (with results) before March 2026, newest first. */
const earlierDays = () =>
  bundle.samples
    .filter((s) => s.siteId === dp1().id && s.date < '2026-03-01' && (bundle.index.bySample.get(s.id)?.length ?? 0) > 0)
    .map((s) => s.date.slice(0, 10))
    .sort()
    .reverse();
const marchSample = () => bundle.samples.find((s) => s.siteId === dp1().id && s.date.startsWith('2026-03'))!;

describe('caption fill-ins', () => {
  it('fills in [site name] and {{site.code}} alike, and leaves other brackets as written', () => {
    const v = { sitename: 'Pond outlet', sitecode: 'DP1', date: '3 Mar 2026' };
    expect(fillCaption('[site name] ([Site Code]), [date] in [mg/L]', v)).toBe('Pond outlet (DP1), 3 Mar 2026 in [mg/L]');
    expect(fillCaption('{{site.name}} – {{siteCode}}', v)).toBe('Pond outlet – DP1');
    expect(fillCaption('{{project.name}}', v)).toBe('{{project.name}}'); // the report's own placeholders are filled later
  });

  it('tidies what an empty fill-in leaves', () => {
    expect(tidyCaption('DP1 ()')).toBe('DP1');
    expect(tidyCaption('DP1 – , 3 Mar 2026')).toBe('DP1, 3 Mar 2026');
    expect(tidyCaption('Results – DP1, ')).toBe('Results – DP1');
    expect(tidyCaption('pH 6–9 – DP1')).toBe('pH 6–9 – DP1');
  });

  it('starts from the usual wording, and keeps an older template’s title as it was', () => {
    expect(captionOf(rounds())).toBe('[site], [date]');
    expect(captionOf(rounds({ title: 'Results' }))).toBe('Results – [site], [date]');
    const own = withCaption(rounds({ title: 'Results' }), '[site code] results');
    expect(own).toMatchObject({ captionText: '[site code] results', title: undefined });
    expect(defaultCaption({ id: 'x', type: 'statsTable', siteIds: [], parameterIds: [], stats: [] } as ReportBlock)).toBe('Summary statistics');
  });
});

describe('captions in reports', () => {
  it('writes a rounds table’s caption from its fill-ins, for each site', () => {
    const sample = marchSample();
    const doc = report([rounds({ captionText: 'Water quality at [site name] ([site code]) on [date], {{project.code}}' })]);
    expect(tables(doc)[0].caption).toBe(`Table 1. Water quality at ${dp1().name} (DP1) on ${formatDate(sample.date, { format: 'D MMM YYYY' })}, ${bundle.project.code}`);
    // the usual wording, and an older title before it
    expect(tables(report([rounds()]))[0].caption).toBe(`Table 1. DP1 – ${dp1().name}, ${formatDate(sample.date, { format: 'D MMM YYYY' })}`);
    expect(tables(report([rounds({ title: 'Results' })]))[0].caption).toMatch(/^Table 1\. Results – DP1 – /);
  });

  it('uses the wording as the heading when each site’s table is under a heading, which text can refer to', () => {
    const doc = report([{ id: 't', type: 'text', text: 'See {{table:pond}}.' }, rounds({ siteLabel: 'heading', captionText: '[site name] results', ref: 'pond' })]);
    const h = doc.nodes.find((n): n is Heading => n.t === 'h' && n.text === `${dp1().name} results`)!;
    expect(h.anchor).toBeTruthy();
    expect(tables(doc)[0].caption).toBeUndefined();
    const p = doc.nodes.find((n) => n.t === 'p') as Extract<DocNode, { t: 'p' }>;
    expect(p.runs.find((r) => r.link)).toMatchObject({ text: `${dp1().name} results`, link: h.anchor });
  });

  it('writes other tables’ and graphs’ captions too', () => {
    const doc = report([
      { id: 'a', type: 'resultsTable', siteIds: [], parameterIds: ['tss'], layout: 'parametersAsRows', guidelineSetIds: [], ruleColumns: 'none', highlight: false, splitBySite: true, captionText: 'TSS – [site code], [period name]' },
      { id: 'b', type: 'samplingTable', captionText: 'Samples, [period]' },
      { id: 'c', type: 'statsTable', siteIds: [], parameterIds: ['tss'], stats: ['n'], title: 'Old title' },
    ]);
    const caps = tables(doc).map((t) => t.caption);
    expect(caps).toContain('Table 1. TSS – US1, March 2026');
    expect(caps.some((c) => /^Table \d+\. Samples, 1 Mar 2026 – 31 Mar 2026$/.test(c ?? ''))).toBe(true);
    expect(caps.some((c) => /^Table \d+\. Old title$/.test(c ?? ''))).toBe(true);
    const chart = buildReport({
      bundle,
      template: { ...event, blocks: [{ id: 'g', type: 'chart', parameterIds: ['tss'], siteIds: [], range: 'period', showGuidelines: false, guidelineSetIds: null, showRules: false, logScale: false, size: 'full', aspect: 0.5, widthCm: 16, heightCm: 8, caption: '', captionText: '[parameter] ([unit]) at [sites]' }] } as ReportTemplate,
      period: march,
      settings: me,
    }).nodes.find((n): n is Extract<DocNode, { t: 'image' }> => n.t === 'image')!;
    expect(chart.caption).toMatch(/^Figure 1\. Total Suspended Solids \(mg\/L\) at .*DP1/);
  });
});

describe('notes under tables', () => {
  it('records the usual notes and uses your own in their place', () => {
    const usual = report([rounds()]);
    const auto = usual.autoNotes!.r1;
    expect(auto[0]).toMatch(/“<” indicates a result below/);
    expect(tables(usual)[0].notes).toEqual(auto);
    const own = report([rounds({ tableNotes: '"<" = below the detection limit.\n\nSampled by [project code] staff, [period name].' })]);
    expect(tables(own)[0].notes).toEqual(['"<" = below the detection limit.', `Sampled by ${bundle.project.code} staff, March 2026.`]);
    expect(own.autoNotes!.r1).toEqual(auto); // still the usual ones, to start from
    expect(tables(report([rounds({ tableNotes: '' })]))[0].notes).toBeUndefined();
  });

  it('puts notes under the last table of a section that had none', () => {
    const doc = report([{ id: 's', type: 'samplingTable', tableNotes: 'All samples were grab samples.' }]);
    expect(tables(doc).at(-1)!.notes).toEqual(['All samples were grab samples.']);
  });
});

describe('results vs previous rounds', () => {
  it('shows as many earlier rounds as asked', () => {
    const n = Math.min(8, earlierDays().length);
    const t = tables(report([rounds({ previous: n })]))[0];
    const roundHeads = t.head[0].slice(2, 2 + n + 1);
    expect(roundHeads).toHaveLength(n + 1);
    expect(new Set(roundHeads.map((c) => c.text)).size).toBe(n + 1);
    // the columns and the text shrink to fit the page
    const fixed = t.widths.reduce<number>((a, w) => a + (typeof w === 'number' ? w : 0), 0);
    expect(fixed).toBeLessThanOrEqual(170 - 30 + 0.01);
  });

  it('shows chosen rounds, taking a site’s sample within two weeks of the date', () => {
    const days = earlierDays();
    const pick = [days[2], days[5]];
    const shifted = new Date(Date.parse(pick[1]) + 5 * 86400000).toISOString().slice(0, 10); // a day the site wasn't sampled
    const t = tables(report([rounds({ previousDates: [pick[0], shifted, '2015-01-01'] })]))[0];
    const label = (d: string) => `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+d.slice(5, 7) - 1]}-${d.slice(2, 4)}`;
    expect(t.head[0].slice(2, 6).map((c) => c.text)).toEqual(['Mar-26', label(pick[0]), label(pick[1]), 'Jan-15']);
    // no sample near 2015: a column of dashes
    expect(t.body.every((row) => row[5].text === '–')).toBe(true);
  });

  it('still says whether a result complies when there is no earlier one, and the change since an older one', () => {
    const febIds = new Set(bundle.samples.filter((s) => s.siteId === dp1().id && s.date.startsWith('2026-02')).map((s) => s.id));
    const keep = (s: Sample) => !febIds.has(s.id);
    // DP1's February TSS result is gone; January's is still there
    const results = bundle.samples.flatMap((s) => bundle.index.bySample.get(s.id) ?? []).filter((r) => keep(bundle.samples.find((s) => s.id === r.sampleId)!) || r.parameterId !== 'tss');
    const b: ProjectBundle = { ...bundle, index: buildIndex(bundle.samples, results, bundle.sites, bundle.params) };
    const comment = (doc: ReportDoc, param: string) => {
      const t = tables(doc)[0];
      return t.body.find((row) => row[0].text === param)!.at(-1)!.text;
    };
    expect(comment(report([rounds({ previous: 1 })], b), 'Total Suspended Solids')).toMatch(/^No earlier result – (Compliant|Exceedance)$/);
    expect(comment(report([rounds({ previous: 2 })], b), 'Total Suspended Solids')).toMatch(/^(Increase|Decrease|Stable) since [A-Z][a-z]{2}-\d\d – (Compliant|Exceedance)$/);
    // with results in both rounds, as before
    expect(comment(report([rounds({ previous: 1 })]), 'pH')).toMatch(/^(Increase|Decrease|Stable) – Compliant$/);
  });
});
