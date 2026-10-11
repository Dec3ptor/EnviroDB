import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { db, ensureBuiltIns } from '../src/db/db';
import { newProject, newSite, saveProject } from '../src/db/repo';
import type { Project, Site } from '../src/db/types';
import { buildConsentPrompt, newParamId, parseConsentAnswer, planConsentImport, ruleBlockers, type ConsentAnswer, type ConsentContext } from '../src/importers/consent';
import { commitConsentPlan, undoConsentImport } from '../src/importers/consentCommit';

const TODAY = '2026-10-11';

// What an AI tool might send back: prose around a fenced block, a trailing comma, loose wording.
const ANSWER = `Here is the extracted set-up data for consent AUTH-555:

\`\`\`json
{
  "format": "envirodb-consent-setup",
  "version": 1,
  "project": { "consents": "AUTH-555", "regulator": "Example Regional Council", "description": "Quarry stormwater discharge.", "yearStartMonth": 7 },
  "sites": [
    { "code": "US1", "name": "Stream upstream", "type": "Surface water", "role": "Upstream / control" },
    { "code": "DP1", "name": "Pond outlet", "type": "outfall", "role": "discharge" },
    { "code": "DS1", "name": "Stream 100 m downstream", "type": "stream", "role": "downstream" }
  ],
  "rules": [
    { "name": "Discharge TSS", "condition": "Condition 8(a)", "level": "Limit", "kind": "threshold", "parameter": "Total Suspended Solids", "sites": ["DP1"], "operator": ">", "value": 100, "unit": "g/m3", "action": "Notify Example Regional Council within 24 hours.", "quote": "shall not exceed 100 g/m³" },
    { "name": "Discharge pH", "condition": "Condition 8(b)", "kind": "threshold", "parameter": "pH", "sites": ["DP1"], "operator": "outside", "min": 6.5, "max": 8.5, "unit": "pH units" },
    { "name": "Zinc", "condition": "Condition 8(c)", "kind": "threshold", "parameter": "Zinc", "sites": ["DP1"], "operator": ">", "value": "0.2", "unit": "g/m3", "comment": "Fraction not stated" },
    { "name": "Turbidity change", "condition": "Condition 10", "kind": "change", "parameter": "Turbidity", "sites": ["DS1"], "referenceSite": "US1", "changeType": "percent", "operator": ">", "value": 20, "unit": "%" },
    { "name": "Nitrate 95th percentile", "level": "trigger level 2", "kind": "statistic", "parameter": "Nitrate-N", "sites": ["DS1"], "statistic": "95th percentile", "window": "annual", "operator": ">", "value": 3.5, "unit": "mg/L" },
    { "name": "Metals vs ANZG", "kind": "guideline", "guidelineSet": "anzg-fw-95", "hardnessAdjust": true, "sites": ["DS1"] },
    { "name": "Glyphosate", "kind": "threshold", "parameter": "Glyphosate", "sites": ["DS1"], "operator": ">", "value": 0.37, "unit": "mg/L" },
    { "name": "Bore ammonia", "kind": "threshold", "parameter": "Ammoniacal nitrogen", "sites": ["BH9"], "operator": ">", "value": 1, "unit": "mg/L" },
  ],
  "schedules": [
    { "name": "Stream sampling", "sites": ["US1", "DP1", "DS1"], "parameters": ["Total Suspended Solids", "pH", "Unobtainium"], "frequency": "quarterly", "startDate": "1 July 2026" }
  ],
  "reporting": [
    { "name": "Annual report", "recipient": "Example Regional Council", "every": 1, "unit": "year", "firstPeriodStart": "2025-07-01", "firstPeriodEnd": "2026-06-30", "firstDueDate": "2026-09-30" },
    { "name": "Quarterly summary", "every": 3, "unit": "month", "firstPeriodStart": "2026-04-01" }
  ],
  "notes": ["Condition 9: no conspicuous change in colour or clarity.", "Condition 12: sample within 24 h after > 25 mm rain."]
}
\`\`\`
Let me know if you need anything else.`;

let project: Project;
let ctx: ConsentContext;
let existingUs1: Site;

beforeAll(async () => {
  await ensureBuiltIns();
  project = newProject({ name: 'Consent test', regulator: 'Old Council' });
  await saveProject(project);
  existingUs1 = newSite(project.id, { code: 'US1', name: 'Upstream', order: 1 });
  await db.sites.put(existingUs1);
  ctx = { project, sites: [existingUs1], params: await db.parameters.toArray(), guidelineSets: await db.guidelineSets.toArray() };
});

describe('consent set-up with an AI tool', () => {
  it('writes instructions with the format, known parameters, sites and guideline sets', () => {
    const t = buildConsentPrompt(ctx, { consentText: 'Condition 8: the discharge shall not exceed 100 g/m3 TSS.', notes: 'Use DP1 for the pond outlet.', today: TODAY });
    expect(t).toContain('# Task: turn resource consent conditions into EnviroDB set-up data');
    expect(t).toContain("Today's date is 11 Oct 2026.");
    expect(t).toContain('"format": "envirodb-consent-setup"');
    expect(t).toMatch(/Physical & field: .*Turbidity/);
    expect(t).toContain('Dissolved Zinc');
    expect(t).toContain('- US1 – Upstream (Surface water)');
    expect(t).toContain('- anzg-fw-95: ANZG (2018) Freshwater – 95% species protection');
    expect(t).toContain('## Consent text\nCondition 8: the discharge shall not exceed 100 g/m3 TSS.');
    expect(t).toContain('## Notes from the user\nUse DP1 for the pond outlet.');
    expect(t).not.toContain('## Consent documents');
    // the example in the instructions must itself be valid, readable set-up data
    const exStart = t.indexOf('```json', t.indexOf('## Example')) + 7;
    const example = t.slice(exStart, t.indexOf('```', exStart));
    const parsed = parseConsentAnswer(example);
    expect('data' in parsed && planConsentImport(parsed.data, ctx, TODAY).rules.length).toBe(4);
  });

  it('reads answers with prose, code fences and trailing commas, and explains failures', () => {
    const ok = parseConsentAnswer(ANSWER);
    expect('data' in ok).toBe(true);
    const arr = parseConsentAnswer('[{"name": "x", "parameter": "pH"}]');
    expect('data' in arr && Array.isArray(arr.data.rules)).toBe(true);
    const cut = parseConsentAnswer(ANSWER.slice(0, 900));
    expect('error' in cut && cut.error).toMatch(/isn't complete, valid JSON/);
    expect('error' in parseConsentAnswer('Sorry, I can’t open the PDF.') && true).toBe(true);
    expect('error' in parseConsentAnswer('{"hello": 1}') && true).toBe(true);
  });

  it('maps the answer to sites, rules, schedules and reporting dates with warnings', () => {
    const { data } = parseConsentAnswer(ANSWER) as { data: ConsentAnswer };
    const plan = planConsentImport(data, ctx, TODAY);
    const byName = (n: string) => plan.rules.find((r) => r.rule.name === n)!;

    // sites: US1 is already in the project; BH9 only appears in a rule
    expect(plan.sites.map((s) => [s.site.code, s.existing ? 'existing' : 'new', s.site.type, s.site.role])).toEqual([
      ['US1', 'existing', 'Surface water', 'Upstream / control'],
      ['DP1', 'new', 'Discharge', 'Discharge point'],
      ['DS1', 'new', 'Surface water', 'Downstream / impact'],
      ['BH9', 'new', 'Other', ''],
    ]);
    expect(plan.sites[0].site.id).toBe(existingUs1.id);
    expect(plan.sites[3].warnings[0]).toMatch(/used by rule "Bore ammonia"/);

    const tss = byName('Discharge TSS').rule;
    expect([tss.kind, tss.parameterId, tss.operator, tss.value, tss.unit, tss.level, tss.condition]).toEqual(['threshold', 'tss', '>', 100, 'g/m³', 'Limit', 'Condition 8(a)']);
    expect(tss.siteIds).toEqual([plan.sites[1].site.id]);
    expect(byName('Discharge TSS').quote).toBe('shall not exceed 100 g/m³');
    const ph = byName('Discharge pH').rule;
    expect([ph.operator, ph.min, ph.max, ph.parameterId]).toEqual(['outside', 6.5, 8.5, 'ph']);
    const zn = byName('Zinc');
    expect(zn.rule.value).toBe(0.2);
    expect(['zn-t', 'zn-d']).toContain(zn.rule.parameterId);
    expect(zn.warnings[0]).toMatch(/Check the parameter/);
    expect(zn.comment).toBe('Fraction not stated');
    const turb = byName('Turbidity change').rule;
    expect([turb.kind, turb.changeType, turb.referenceSiteId, turb.pairingDays]).toEqual(['change', 'percent', existingUs1.id, 0]);
    const no3 = byName('Nitrate 95th percentile').rule;
    expect([no3.statistic, no3.percentile, no3.window, no3.level]).toEqual(['percentile', 95, 'year', 'Trigger 2']);
    const metals = byName('Metals vs ANZG').rule;
    expect([metals.kind, metals.guidelineSetId, metals.hardnessAdjust]).toEqual(['guideline', 'anzg-fw-95', true]);
    const gly = byName('Glyphosate');
    expect(gly.rule.parameterId).toBeUndefined();
    expect(gly.warnings[0]).toMatch(/doesn't know "Glyphosate"/);
    expect(ruleBlockers(gly.rule)).toEqual(['choose a parameter']);
    expect(byName('Bore ammonia').rule.parameterId).toBe('nh4-n');

    const sch = plan.schedules[0];
    expect([sch.schedule.every, sch.schedule.unit, sch.schedule.startDate, sch.schedule.parameterIds]).toEqual([3, 'month', '2026-07-01', ['tss', 'ph']]);
    expect(sch.warnings[0]).toMatch(/"Unobtainium" not recognised/);
    const [annual, quarterly] = plan.obligations;
    expect([annual.obligation.every, annual.obligation.unit, annual.obligation.firstDueDate, annual.obligation.templateId, annual.warnings.length]).toEqual([1, 'year', '2026-09-30', 'tpl-annual', 0]);
    expect([quarterly.obligation.firstPeriodEnd, quarterly.obligation.firstDueDate, quarterly.obligation.templateId]).toEqual(['2026-06-30', '2026-07-30', 'tpl-quarterly']);
    expect(quarterly.warnings[0]).toMatch(/Due date not given/);

    // project details: empty fields are filled in by default; changed values need a tick
    const f = Object.fromEntries(plan.project.map((x) => [x.field, x]));
    expect(f.consents.include).toBe(true);
    expect([f.regulator.current, f.regulator.proposed, f.regulator.include]).toEqual(['Old Council', 'Example Regional Council', false]);
    expect(plan.notes).toHaveLength(2);
  });

  it('imports the selection, pauses unfinished rules, and undoes cleanly', async () => {
    const { data } = parseConsentAnswer(ANSWER) as { data: ConsentAnswer };
    const plan = planConsentImport(data, ctx, TODAY);
    // the user adds the unknown parameter as a new one and leaves out the bore
    plan.rules.find((r) => r.rule.name === 'Glyphosate')!.rule.parameterId = newParamId('Glyphosate');
    plan.sites.find((s) => s.site.code === 'BH9')!.include = false;
    plan.rules.find((r) => r.rule.name === 'Metals vs ANZG')!.rule.guidelineSetId = undefined; // still needs a set

    const res = await commitConsentPlan(project.id, plan, { replace: false });
    expect([res.sites, res.rules, res.schedules, res.obligations, res.params]).toEqual([2, 7, 1, 2, 1]);
    expect(res.skipped).toEqual(['Rule "Bore ammonia": none of its sites were imported']);
    expect(res.paused).toEqual(['Metals vs ANZG (choose a guideline set)']);
    const rules = await db.rules.where('projectId').equals(project.id).toArray();
    expect(rules.find((r) => r.name === 'Metals vs ANZG')!.active).toBe(false);
    const glyParam = await db.parameters.get(rules.find((r) => r.name === 'Glyphosate')!.parameterId!);
    expect([glyParam?.name, glyParam?.unit]).toEqual(['Glyphosate', 'mg/L']);
    const p = (await db.projects.get(project.id))!;
    expect([p.consents, p.regulator, p.yearStartMonth]).toEqual(['AUTH-555', 'Old Council', 7]);
    expect(p.consentNotes).toBe('- Condition 9: no conspicuous change in colour or clarity.\n- Condition 12: sample within 24 h after > 25 mm rain.');
    expect((await db.sites.where('projectId').equals(project.id).toArray()).map((s) => s.code).sort()).toEqual(['DP1', 'DS1', 'US1']);

    // a second run replacing everything, then undo puts the first import back
    const plan2 = planConsentImport(data, { ...ctx, sites: await db.sites.where('projectId').equals(project.id).toArray() }, TODAY);
    expect(plan2.sites.filter((s) => !s.existing).map((s) => s.site.code)).toEqual(['BH9']);
    const res2 = await commitConsentPlan(project.id, plan2, { replace: true });
    expect(res2.undo.replaced.rules).toHaveLength(7);
    expect(await db.rules.where('projectId').equals(project.id).count()).toBe(8);
    await undoConsentImport(res2.undo);
    expect(await db.rules.where('projectId').equals(project.id).count()).toBe(7);
    expect(await db.sites.where('projectId').equals(project.id).count()).toBe(3);
    expect((await db.projects.get(project.id))!.consentNotes).toBe(p.consentNotes);
  });
});
