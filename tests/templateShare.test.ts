import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, db, ensureBuiltIns } from '../src/db/db';
import { createDemoProject } from '../src/db/demo';
import { BUILT_IN_TEMPLATES } from '../src/data/templates';
import type { GuidelineSet, Parameter, ReportTemplate } from '../src/db/types';
import type { ProjectBundle } from '../src/lib/analysis';
import { buildReport } from '../src/reports/build';
import { readTemplateFile, templateFile, templateFileName, type ReadContext } from '../src/lib/templateShare';
import { loadBundle, png } from './helpers';

let b: ProjectBundle;
let params: Parameter[];
let sets: GuidelineSet[];
const year = { start: '2025-07-01', end: '2026-06-30', label: '2025/26' };
beforeAll(async () => {
  await ensureBuiltIns();
  b = await loadBundle(await createDemoProject());
  params = await db.parameters.toArray();
  sets = await db.guidelineSets.toArray();
});

const mine = (): ReportTemplate => {
  const site = b.sites[0];
  return {
    id: 'tpl-mine',
    name: 'Our quarterly report',
    description: 'Quarterly letter to the council',
    kind: 'letter',
    orientation: 'portrait',
    pageSize: 'A4',
    marginMm: 22,
    fontSize: 10,
    accent: '#1d4ed8',
    footerCenter: '[project] – [page] of [pages]',
    logo: png(60, 20),
    letterhead: true,
    style: 'letter',
    updatedAt: '2026-10-01T00:00:00Z',
    blocks: [
      { id: 'h', type: 'heading', text: 'Results', level: 1 },
      { id: 'r', type: 'resultsTable', title: 'Results', siteIds: [site.id], parameterIds: ['ph-field', 'tss'], excludeParameterIds: ['ecoli'], layout: 'parametersAsRows', guidelineSetIds: [sets[0].id], ruleColumns: 'all', highlight: true, splitBySite: true, captionText: 'Results at [site name]' },
      { id: 'c', type: 'calc', title: 'Key values', rows: [{ id: 'r1', stat: 'median', parameterId: 'tss', sites: ['DS1'] }], show: 'table' },
      { id: 'e', type: 'exceedances', ruleIds: ['some-rule'], includeGuidelines: false, includeNotes: true },
      { id: 'f', type: 'figures', images: [{ id: 'i', src: png(40, 30), caption: 'Site plan' }], perRow: 2, heightMm: 0, numbering: 'each', label: 'Figure', caption: '', border: false },
      { id: 's', type: 'signatures', signatories: [{ id: 'a', role: 'Prepared by', self: true, name: '', details: '' }, { id: 'b', role: 'Reviewed by', name: 'Jane Reviewer', details: 'Principal', image: png(80, 20) }] },
    ],
  };
};
const here = (extra: Partial<ReadContext> = {}): ReadContext => ({ params, sets, names: [], siteIds: new Set(b.sites.map((s) => s.id)), hasLetterhead: true, ...extra });
const viaFile = (t: ReportTemplate[], opts?: { signatures?: boolean }) => JSON.parse(JSON.stringify(templateFile(t, { params, sets }, { by: 'R. Tester', ...opts })));

describe('sharing report templates', () => {
  it('saves templates with the names of what they refer to – and other people’s signatures only if asked', () => {
    const file = viaFile([mine()]);
    expect(file).toMatchObject({ app: 'EnviroDB', kind: 'report-templates', v: 1, by: 'R. Tester' });
    expect(file.names.parameters.tss.name).toBe(params.find((p) => p.id === 'tss')!.name);
    expect(Object.keys(file.names.parameters).sort()).toEqual(['ecoli', 'ph-field', 'tss']);
    expect(file.names.guidelineSets[sets[0].id]).toBe(sets[0].name);
    const sig = file.templates[0].blocks.find((x: { type: string }) => x.type === 'signatures');
    expect(sig.signatories[1].image).toBeUndefined();
    expect(sig.signatories[1].name).toBe('Jane Reviewer');
    expect(viaFile([mine()], { signatures: true }).templates[0].blocks.find((x: { type: string }) => x.type === 'signatures').signatories[1].image).toMatch(/^data:image\/png/);
    expect(file.templates[0].builtIn).toBeUndefined();
    expect(templateFileName([mine()])).toBe('Our quarterly report.envirodb-template.json');
    expect(templateFileName([mine(), mine()])).toBe('2 report templates.envirodb-template.json');
  });

  it('come back the same in the same workspace – as new templates beside the old', () => {
    const [got] = readTemplateFile(viaFile([mine()], { signatures: true }), here({ names: ['Our quarterly report'] }));
    const t = got.template;
    expect(t.id).not.toBe('tpl-mine');
    expect(t.name).toBe('Our quarterly report (imported)');
    const strip = (x: ReportTemplate) => JSON.parse(JSON.stringify({ ...x, id: '', name: '', updatedAt: '', blocks: x.blocks.map((bl) => ({ ...bl, id: '' })) }), (k, v) => (['id'].includes(k) ? '' : v));
    // the same, but for the consent rules (the sender's projects' own)
    const expected = strip(mine());
    expected.blocks = expected.blocks.map((bl: { type: string }) => (bl.type === 'exceedances' ? { ...bl, ruleIds: [] } : bl));
    expect(strip(t)).toEqual(expected);
    expect(got.notes.join(' ')).toMatch(/consent rules/);
  });

  it('fit another workspace: analytes and guideline sets matched by name, the rest left out and said so', () => {
    // another workspace: the same analytes under other ids, one missing, and other sites
    const theirs = params.filter((p) => p.id !== 'ecoli').map((p) => ({ ...p, id: `x-${p.id}` }));
    const theirSets = sets.map((s) => ({ ...s, id: `x-${s.id}` }));
    const [got] = readTemplateFile(viaFile([mine()]), { params: theirs, sets: theirSets, names: [], siteIds: new Set(['elsewhere']), hasLetterhead: false });
    const r = got.template.blocks.find((x) => x.type === 'resultsTable')!;
    expect(r).toMatchObject({ parameterIds: ['x-ph-field', 'x-tss'], excludeParameterIds: [], guidelineSetIds: [`x-${sets[0].id}`], siteIds: [] });
    const c = got.template.blocks.find((x) => x.type === 'calc')!;
    expect(c).toMatchObject({ rows: [{ stat: 'median', parameterId: 'x-tss', sites: ['DS1'] }] });
    const notes = got.notes.join(' | ');
    expect(notes).toMatch(/An analyte this workspace doesn’t have was left out: E\. coli|left out: .*coli/i);
    expect(notes).toMatch(/Sites and consent rules picked for the sender’s projects were cleared/);
    expect(notes).toMatch(/letterhead – add yours in Settings/);
    expect(notes).toMatch(/Signatures of named people weren’t in the file/);
  });

  it('make reports like any other template', () => {
    for (const t of [mine(), ...BUILT_IN_TEMPLATES]) {
      const [got] = readTemplateFile(viaFile([t]), here());
      const doc = buildReport({ bundle: b, template: got.template, period: year, settings: DEFAULT_SETTINGS });
      expect(doc.nodes.length, t.name).toBeGreaterThan(0);
    }
  });

  it('a file from outside is checked: only what a template has, of the right kinds, and pictures only as PNG or JPEG', () => {
    const evil = {
      app: 'EnviroDB',
      kind: 'report-templates',
      templates: [
        {
          name: 42,
          orientation: 'sideways',
          marginMm: 9999,
          fontSize: 'big',
          accent: 'red; background:url(x)',
          logo: 'data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+',
          __proto__: { polluted: true },
          blocks: [
            { type: 'script', code: 'alert(1)' },
            { type: 'heading', text: '<img src=x onerror=alert(1)>', level: 'one' },
            { type: 'figures', images: [{ src: 'data:text/html;base64,PHNjcmlwdD4=', caption: 'x' }, { src: png(10, 10), caption: 'ok' }, 'nope'] },
            { type: 'chart', overlay: 'series:theirs', parameterIds: 'all', guidelineSetIds: null },
            'not a block',
          ],
        },
      ],
    };
    const [got] = readTemplateFile(JSON.parse(JSON.stringify(evil)), here());
    const t = got.template;
    expect(t.name).toBe('Imported template');
    expect(t.orientation).toBe('portrait');
    expect(t.marginMm).toBe(60);
    expect(t.fontSize).toBe(10);
    expect(t.accent).toBe('#0f766e');
    expect(t.logo).toBeUndefined();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(t.blocks.map((x) => x.type)).toEqual(['heading', 'figures', 'chart']);
    expect(t.blocks[0]).toMatchObject({ text: '<img src=x onerror=alert(1)>', level: 1 }); // just text; the level a number
    expect(t.blocks[1]).toMatchObject({ images: [{ caption: 'ok' }] });
    expect(t.blocks[2]).toMatchObject({ parameterIds: [], guidelineSetIds: null });
    expect('overlay' in t.blocks[2]).toBe(false);
    // a single template on its own is fine too; anything else isn't
    expect(readTemplateFile(JSON.parse(JSON.stringify(mine())), here())[0].template.name).toBe('Our quarterly report');
    expect(() => readTemplateFile({ app: 'Other', kind: 'report-templates', templates: [] }, here())).toThrow(/isn’t an EnviroDB report template file/);
    expect(() => readTemplateFile({ app: 'EnviroDB', kind: 'report-templates', templates: ['x'] }, here())).toThrow(/no templates/);
  });
});
