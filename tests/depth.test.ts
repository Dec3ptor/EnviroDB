import { describe, expect, it } from 'vitest';
import { byDepth, depthKey, depthText, hasDepths, parseDepth, readDepth } from '../src/lib/depth';

describe('a soil sample’s depth, from its name', () => {
  const d = (name: string) => {
    const p = parseDepth(name);
    return p ? `${depthText(p.depth)} at ${p.rest}` : null;
  };
  it('one depth, with its unit or as a decimal at the end', () => {
    expect(d('TP1 0.5m')).toBe('0.5 m at TP1');
    expect(d('TP1 0.5 m')).toBe('0.5 m at TP1');
    expect(d('TP1-0.5')).toBe('0.5 m at TP1');
    expect(d('HA2_0.3')).toBe('0.3 m at HA2');
    expect(d('TP1 @ 0.5')).toBe('0.5 m at TP1');
    expect(d('TP1 (0.5 m)')).toBe('0.5 m at TP1');
    expect(d('BH3 1.2 m bgl')).toBe('1.2 m at BH3');
    expect(d('HA2 500 mm')).toBe('0.5 m at HA2');
    expect(d('SS4 30cm')).toBe('0.3 m at SS4');
    expect(d('TP1 0.5m (dup)')).toBe('0.5 m at TP1 (dup)');
  });
  it('an interval', () => {
    expect(d('BH2 1.0-1.2 m')).toBe('1.0–1.2 m at BH2');
    expect(d('TP1 0.1-0.3')).toBe('0.1–0.3 m at TP1');
    expect(d('HA2_0.0-0.1')).toBe('0.0–0.1 m at HA2');
    expect(d('HA5 100 – 200 mm')).toBe('0.1–0.2 m at HA5');
    expect(d('TP7 0.5 to 1.0 m')).toBe('0.5–1.0 m at TP7');
    expect(d('TP1 @ 0.1-0.3')).toBe('0.1–0.3 m at TP1');
  });
  it('not a depth: a site’s number, a whole number, a bore’s name', () => {
    expect(d('TP1')).toBeNull();
    expect(d('TP1 2')).toBeNull();
    expect(d('BH2m')).toBeNull();
    expect(d('Site 12')).toBeNull();
    expect(d('DS1 downstream')).toBeNull();
    expect(d('TP1 1.2-0.5 m')).toBe('0.5 m at TP1 1.2'); // an interval that runs upward isn't one; the last figure is a depth
  });
  it('written, typed and keyed', () => {
    expect(depthText({ top: 0.5 })).toBe('0.5 m');
    expect(depthText({ top: 1, bottom: 1.25 })).toBe('1.0–1.25 m');
    expect(depthText(undefined)).toBe('');
    expect(depthKey({ top: 0.1, bottom: 0.3 })).toBe('0.1-0.3');
    expect(depthKey(undefined)).toBe('');
    expect(readDepth('0.5')).toEqual({ top: 0.5 });
    expect(readDepth('0.1-0.3 m')).toEqual({ top: 0.1, bottom: 0.3 });
    expect(readDepth('100 mm')).toEqual({ top: 0.1 });
    expect(readDepth('')).toBeUndefined();
    expect(readDepth('deep')).toBeNull();
    expect(readDepth('0.5-0.2')).toBeNull();
    expect(hasDepths({ type: 'Soil' })).toBe(true);
    expect(hasDepths({ type: 'Sediment' })).toBe(true);
    expect(hasDepths({ type: 'Groundwater' })).toBe(false);
    expect([{ date: '2026-03-02', depth: { top: 0.5 } }, { date: '2026-03-01', depth: { top: 1 } }, { date: '2026-03-02', depth: { top: 0.1 } }, { date: '2026-03-02' }].sort(byDepth).map((x) => `${x.date.slice(8)}:${x.depth?.top ?? '-'}`)).toEqual(['01:1', '02:-', '02:0.1', '02:0.5']);
  });
});
