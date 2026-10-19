import 'fake-indexeddb/auto';
import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { ensureBuiltIns } from '../src/db/db';
import { createDemoProject } from '../src/db/demo';
import { buildPackData, DEFAULT_SECTIONS, packParams, packPeriod, packSites } from '../src/pack/model';
import { PACK_SCRIPT, packHtml, scriptJson } from '../src/pack/html';
import viewerSource from '../src/pack/viewer.js?raw';
import { mapBox } from '../src/pack/aerial';
import { loadBundle } from './helpers';

const ctx = { version: 3, made: '2026-10-19', app: '1.8.0', company: 'Example Ltd' };

describe('the client data pack', () => {
  let projectId: string;
  beforeAll(async () => {
    await ensureBuiltIns();
    projectId = await createDemoProject();
  });

  it('holds the consent’s analytes at every site, with highlights, limits and compliance', async () => {
    const b = await loadBundle(projectId);
    const d = buildPackData(b, {}, ctx);
    expect(d.sites.map((s) => s.code)).toEqual(b.sites.map((s) => s.code));
    expect(d.sites.every((s) => s.lat !== undefined)).toBe(true);
    const consent = packParams(b, {});
    expect(d.params.map((p) => p.name)).toEqual(consent.map((p) => p.name));
    expect(consent.length).toBeLessThan(b.index.paramIdsWithData.length);
    // every result names a sample and an analyte in the pack
    expect(d.results.length).toBeGreaterThan(100);
    expect(d.results.every(([s, p]) => s < d.samples.length && p < d.params.length)).toBe(true);
    expect(d.samples.every(([site]) => site < d.sites.length)).toBe(true);
    // results above a consent limit are highlighted, with why
    const over = d.results.filter((r) => r[4] === 1);
    expect(over.length).toBeGreaterThan(0);
    expect(d.notes[over[0][5]!]).toMatch(/limit|>/i);
    expect(d.lines.some((l) => l.some((x) => x.kind === 'limit'))).toBe(true);
    expect(d.compliance.length).toBe(b.rules.filter((r) => r.active).length);
    expect(d.sections.map((s) => s.type)).toEqual(DEFAULT_SECTIONS.map((s) => s.type));
    expect(d.pack).toEqual(ctx);
    expect(d.look.title).toBe(b.project.name);
  });

  it('follows its settings: sites, analytes, dates, limits and sections', async () => {
    const b = await loadBundle(projectId);
    const two = b.sites.slice(0, 2).map((s) => s.id);
    const d = buildPackData(
      b,
      { siteIds: two, parameterIds: ['tss', 'ph'], period: 'years', years: 1, limits: false, sections: DEFAULT_SECTIONS.map((s) => ({ ...s, on: s.type !== 'compliance' })), title: 'Water quality', theme: 'dark' },
      ctx,
    );
    expect(d.sites.length).toBe(2);
    expect(d.params.map((p) => p.name).sort()).toEqual(['pH', 'Total Suspended Solids'].sort());
    const period = packPeriod(b, { period: 'years', years: 1 }, two);
    expect(d.period).toEqual(period);
    expect(d.samples.every(([, date]) => date.slice(0, 10) >= period.start && date.slice(0, 10) <= period.end)).toBe(true);
    expect(d.results.some((r) => r[4] === 1)).toBe(false);
    expect(d.lines.every((l) => l.every((x) => x.kind === 'guideline'))).toBe(true);
    expect(d.compliance).toEqual([]);
    expect(d.sections.some((s) => s.type === 'compliance')).toBe(false);
    expect(d.look).toMatchObject({ title: 'Water quality', theme: 'dark' });
    expect(packSites(b, { siteIds: ['nope'] }).length).toBe(b.sites.length);
  });

  it('is one HTML file that runs only its own script and connects to nothing', async () => {
    const b = await loadBundle(projectId);
    const d = buildPackData(b, { title: 'Evil </script><script>alert(1)</script> & co', intro: '<img src=x onerror=alert(1)>' }, ctx);
    const html = await packHtml(d);
    const hash = createHash('sha256').update(PACK_SCRIPT).digest('base64');
    expect(html).toContain(`script-src 'sha256-${hash}'`);
    expect(html).toMatch(/default-src 'none'/);
    expect(html).not.toMatch(/connect-src|https?:\/\/(?!www\.w3\.org)/);
    // the data can't end its script element, and the title is text
    const json = html.slice(html.indexOf('id="pack-data">') + 15, html.indexOf('</script>', html.indexOf('id="pack-data">')));
    expect(JSON.parse(json).look.title).toBe(d.look.title);
    expect(html).toContain('<title>Evil &lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt; &amp; co</title>');
    expect(html.match(/<script/g)!.length).toBe(2);
    expect(viewerSource).not.toMatch(/<\/script|innerHTML|insertAdjacentHTML|eval\(|new Function|fetch\(|XMLHttpRequest/);
    expect(scriptJson({ a: ' </script>' })).toBe('{"a":"\\u2028\\u003c/script\\u003e"}');
    expect(html.length).toBeLessThan(400_000);
  });

  it('frames the sites for the map', () => {
    const box = mapBox([
      { lat: -37.78, lng: 175.27 },
      { lat: -37.79, lng: 175.29 },
    ])!;
    expect((box[2] - box[0]) / (box[3] - box[1])).toBeCloseTo(1.6, 6);
    expect(mapBox([])).toBeNull();
    // one site: about 600 m across, and more
    const one = mapBox([{ lat: -37.78, lng: 175.27 }])!;
    expect((one[2] - one[0]) * 40075).toBeGreaterThan(0.6);
  });
});
