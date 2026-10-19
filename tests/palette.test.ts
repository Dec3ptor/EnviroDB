import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { MantineTheme } from '@mantine/core';
import { appShades, DEFAULT_APP_COLOUR, inkFor, isLightColour, lightness, TEAL } from '../src/lib/palette';
import { makeTheme, themeVariables } from '../src/theme';
import { db, getSettings, MY_SETTINGS, saveSettings } from '../src/db/db';

describe('the app colour', () => {
  it('is the built-in teal until another is chosen', () => {
    expect(appShades()).toEqual([...TEAL]);
    expect(appShades('')).toEqual([...TEAL]);
    expect(appShades('not a colour')).toEqual([...TEAL]);
    expect(appShades(DEFAULT_APP_COLOUR.toUpperCase())).toEqual([...TEAL]);
    expect(makeTheme().colors?.brand?.[8]).toBe(DEFAULT_APP_COLOUR);
    expect(makeTheme().autoContrast).toBe(false);
  });

  it('gives ten shades of the chosen colour, lightest to darkest, with the colour itself for buttons', () => {
    for (const c of ['#1d4ed8', '#c2255c', '#2f3b52', '#e8590c', '#5f3dc4']) {
      const shades = appShades(c);
      expect(shades).toHaveLength(10);
      expect(shades.every((s) => /^#[0-9a-f]{6}$/.test(s))).toBe(true);
      expect(shades[8]).toBe(c);
      const ls = shades.map(lightness);
      for (let i = 1; i < 10; i++) expect(ls[i]).toBeLessThan(ls[i - 1]);
      expect(ls[0]).toBeGreaterThan(0.93);
      expect(makeTheme(c).primaryColor).toBe('brand');
      // teal stays for things done or saved
      expect(makeTheme(c).colors?.teal?.[8]).toBe(DEFAULT_APP_COLOUR);
    }
    // a grey stays grey
    const grey = appShades('#495057');
    for (const s of grey) {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
      expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(25);
    }
  });

  it('writes in black on a light colour', () => {
    expect(isLightColour('#ffd43b')).toBe(true);
    expect(makeTheme('#ffd43b').autoContrast).toBe(true);
    expect(isLightColour('#1d4ed8')).toBe(false);
    // and writes in a darker shade of it on white
    const ink = inkFor('#ffd43b')!;
    expect(lightness(ink)).toBeLessThan(0.5);
    expect(themeVariables('#ffd43b')({} as MantineTheme).light['--mantine-color-anchor']).toBe(ink);
    expect(inkFor('#1d4ed8')).toBeNull();
    expect(themeVariables()({} as MantineTheme).light).toEqual({});
  });

  it('is each person’s own', async () => {
    await saveSettings({ appColour: '#1d4ed8', company: 'Team Co' });
    expect((await getSettings()).appColour).toBe('#1d4ed8');
    expect((await db.meta.get(MY_SETTINGS))?.value).toMatchObject({ appColour: '#1d4ed8' });
    expect((await db.meta.get('settings'))?.value).not.toHaveProperty('appColour');
    await saveSettings({ appColour: undefined });
    expect((await getSettings()).appColour).toBeUndefined();
  });
});
