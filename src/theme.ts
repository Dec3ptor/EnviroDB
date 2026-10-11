import { createTheme, type MantineColorsTuple } from '@mantine/core';

// Deep teal primary – calm, "environmental", and distinct from the status colours.
const teal: MantineColorsTuple = ['#e6f7f5', '#cdeeea', '#9edcd4', '#6bc9bd', '#43b8aa', '#2aae9f', '#14a394', '#0f8c7f', '#0f766e', '#065f58'];

export const theme = createTheme({
  primaryColor: 'teal',
  primaryShade: { light: 8, dark: 6 },
  colors: { teal },
  fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  headings: { fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif', fontWeight: '650' },
  defaultRadius: 'md',
  cursorType: 'pointer',
  components: {
    Card: { defaultProps: { withBorder: true, radius: 'md', padding: 'lg' } },
    Paper: { defaultProps: { radius: 'md' } },
    Badge: { defaultProps: { radius: 'sm', variant: 'light' } },
    Button: { defaultProps: { radius: 'md' } },
    Table: { defaultProps: { verticalSpacing: 6, horizontalSpacing: 'sm' } },
    Tooltip: { defaultProps: { withArrow: true, openDelay: 300, multiline: true, maw: 320 } },
  },
});

// Chart palette (validated categorical order – see the dataviz reference palette).
export const SERIES_LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
export const SERIES_DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
export const STATUS = { good: '#0ca30c', warning: '#fab219', serious: '#ec835a', critical: '#d03b3b' };
export const INK = {
  light: { surface: '#ffffff', primary: '#0b0b0b', secondary: '#52514e', muted: '#898781', grid: '#e1e0d9', axis: '#c3c2b7' },
  dark: { surface: '#1a1a19', primary: '#f0efec', secondary: '#c3c2b7', muted: '#898781', grid: '#2c2c2a', axis: '#383835' },
};
