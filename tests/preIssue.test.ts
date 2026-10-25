import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, db, ensureBuiltIns } from '../src/db/db';
import { createDemoProject } from '../src/db/demo';
import { BUILT_IN_TEMPLATES } from '../src/data/templates';
import type { ReportTemplate } from '../src/db/types';
import { buildReport } from '../src/reports/build';
import { checksSummary, preIssueChecks } from '../src/reports/checks';
import type { ProjectBundle } from '../src/lib/analysis';
import { loadBundle } from './helpers';

let b: ProjectBundle;
let projectId: string;
const annual = BUILT_IN_TEMPLATES.find((t) => t.id === 'tpl-annual') as ReportTemplate;
beforeAll(async () => {
  await ensureBuiltIns();
  projectId = await createDemoProject();
  b = await loadBundle(projectId);
});
const period = { start: '2025-07-01', end: '2026-06-30', label: 'FY' };

describe('before a report is issued', () => {
  it('a complete report: only what’s worth noting', async () => {
    const doc = buildReport({ bundle: b, template: annual, period, settings: DEFAULT_SETTINGS, promptTexts: {}, figures: {}, preview: true });
    const imports = await db.imports.where('projectId').equals(projectId).toArray();
    const checks = preIssueChecks({ bundle: b, template: annual, period, doc, promptTexts: Object.fromEntries(doc.commentary.map((c) => [c.key, 'Written.'])), figures: {}, imports: imports.map((i) => ({ ...i, reviewed: { by: 'x', on: '2026-10-01' } })), today: '2026-10-25' });
    expect(checks.filter((c) => c.level === 'warn')).toEqual([]);
    expect(checksSummary([])).toBe('Ready to issue');
  });

  it('flags the period not over, silent sites, unreviewed imports, blank or drafted commentary, lost references', async () => {
    const doc = buildReport({ bundle: b, template: annual, period, settings: DEFAULT_SETTINGS, promptTexts: {}, figures: {}, preview: true });
    const imports = await db.imports.where('projectId').equals(projectId).toArray();
    // a site left silent: the first site's samples pushed out of the period
    const quiet = { ...b, samples: b.samples.filter((s) => s.siteId !== b.sites[0].id) };
    const texts: Record<string, string> = { [doc.commentary[0]?.key ?? 'x']: 'See {{table:nothing}} and Figure ? above.' };
    const docWithLost = { ...doc, nodes: [...doc.nodes, { t: 'p' as const, runs: [{ text: 'Compare with Table ? and Figure ?.' }] }, { t: 'note' as const, text: 'Raw {{fig:plan}} left' }] };
    const checks = preIssueChecks({ bundle: quiet, template: annual, period: { start: '2026-07-01', end: '2027-06-30' }, doc: docWithLost, promptTexts: texts, figures: {}, imports, today: '2026-10-25' });
    const text = checks.map((c) => `${c.level}:${c.text}`).join('\n');
    expect(text).toMatch(/warn:The period ends 30 Jun 2027/);
    expect(text).toMatch(new RegExp(`No results in the period at .*${b.sites[0].code}`));
    expect(text).toMatch(/warn:An import in the period isn’t reviewed/);
    expect(text).toMatch(/warn:2 references to a table or figure that isn’t in the report/);
    expect(text).toMatch(/warn:1 placeholder left as typed/);
    expect(checksSummary(checks)).toMatch(/\d to look at/);
    expect(checks.every((c) => !c.where || ['data', 'compliance', 'reports', 'setup', 'schedule'].includes(c.where))).toBe(true);
  });
});
