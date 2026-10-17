import { describe, expect, it } from 'vitest';
import { autoScale, DEFAULT_DASHBOARD, MIN_SCALE, readLayout, WIDGET_MAP } from '../src/pages/dashboard/widgets';

describe('dashboard layout', () => {
  it('doubles a first-version layout onto the finer grid, keeping text sizes', () => {
    const v1 = { version: 1, items: [{ i: 'stats', x: 0, y: 0, w: 12, h: 4 }, { i: 'notes', x: 7, y: 4, w: 5, h: 6, scale: 0.8 }, { i: 'gone', x: 0, y: 0, w: 1, h: 1 }] };
    expect(readLayout(v1)).toEqual([
      { i: 'stats', x: 0, y: 0, w: 24, h: 8, scale: undefined },
      { i: 'notes', x: 14, y: 8, w: 10, h: 12, scale: 0.8 },
    ]);
    expect(readLayout({ version: 2, items: [{ i: 'stats', x: 3, y: 1, w: 7, h: 5 }] })).toEqual([{ i: 'stats', x: 3, y: 1, w: 7, h: 5, scale: undefined }]);
    expect(readLayout(undefined)).toBe(DEFAULT_DASHBOARD);
  });

  it('shows a widget smaller when it is smaller than its contents need', () => {
    const fit = WIDGET_MAP.get('projects')!.fit;
    expect(autoScale(fit, fit.w * 2, 500)).toBe(1);
    expect(autoScale(fit, fit.w * 0.8, 500)).toBe(0.8);
    expect(autoScale(fit, 10, 500)).toBe(MIN_SCALE);
    // contents that can't scroll fit the height too
    const stats = WIDGET_MAP.get('stats')!.fit;
    expect(autoScale(stats, stats.w, stats.h! * 0.7)).toBe(0.7);
    expect(autoScale(fit, 0, 0)).toBe(1); // not measured yet
  });
});
