import { describe, expect, it } from 'vitest';
import { BUILT_IN_PARAMETERS } from '../src/data/parameters';
import type { Parameter, Result, Sample, Site } from '../src/db/types';
import { _historyStats, runQa } from '../src/lib/qa';

const P = new Map<string, Parameter>(BUILT_IN_PARAMETERS.map((p) => [p.id, p]));

// a small random generator, so the test is the same each run
function rng(seed: number) {
  return () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
}

describe('QA/QC: a site’s usual results', () => {
  it('worked out once per series – the same as the plain sums, for every day left out', () => {
    const r = rng(7);
    for (let trial = 0; trial < 60; trial++) {
      const n = 2 + Math.floor(r() * 40);
      const days = Array.from({ length: Math.max(1, Math.floor(n * (0.4 + r() * 0.6))) }, (_, i) => `2020-01-${String(i + 1).padStart(2, '0')}`);
      const pid = trial % 2 ? 'ph' : 'zn-d';
      const pts = Array.from({ length: n }, (_, i) => {
        const raw = trial % 3 === 0 ? Math.round(r() * 5) / 2 : r() * 10; // ties as well
        return { sampleId: `s${i}`, day: days[Math.floor(r() * days.length)], x: pid === 'ph' ? raw : Math.log10(Math.max(raw, 1e-9)), raw, nd: r() < 0.25 };
      });
      for (const day of [...days, 'another day']) {
        const plain = _historyStats.statsOf(pid, pts.filter((p) => p.day !== day));
        const quick = _historyStats.statsWithout(pid, pts, day);
        if (!plain) {
          expect(quick).toBeNull();
          continue;
        }
        expect(quick).not.toBeNull();
        for (const k of Object.keys(plain) as Array<keyof typeof plain>) {
          if (plain[k] === undefined) expect(quick![k], `${trial} ${day} ${k}`).toBeUndefined();
          else expect(quick![k], `${trial} ${day} ${k}`).toBeCloseTo(plain[k] as number, 9);
        }
      }
    }
  });

  it('years of weekly results at three sites, 44 analytes, all checked: seconds, not minutes', () => {
    const pids = [...P.keys()].filter((id) => P.get(id)!.unit === 'mg/L').slice(0, 44);
    const sites: Site[] = ['US1', 'DP1', 'DS1'].map((id) => ({ id, projectId: 'p', code: id, type: 'Surface water', role: '', aliases: [], active: true, order: 0 }));
    const samples: Sample[] = [];
    const results: Result[] = [];
    const r = rng(3);
    for (let i = 0; i < 2000; i++) {
      const s: Sample = { id: `s${i}`, projectId: 'p', siteId: sites[i % 3].id, date: new Date(Date.UTC(2005, 0, 1) + Math.floor(i / 3) * 7 * 86400000).toISOString().slice(0, 10) };
      samples.push(s);
      pids.forEach((pid, k) => results.push({ id: `r${i}-${k}`, projectId: 'p', sampleId: s.id, siteId: s.siteId, date: s.date, parameterId: pid, value: 0.01 + r(), qualifier: r() < 0.1 ? '<' : '', unit: 'mg/L' }));
    }
    const t = performance.now();
    const out = runQa({ samples, results, sites, params: P });
    expect(out.findings.length).toBeGreaterThan(0);
    expect(performance.now() - t).toBeLessThan(15_000);
  }, 60_000);
});
