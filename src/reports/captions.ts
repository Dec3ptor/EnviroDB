// What a table's or graph's caption says: your own wording with fill-ins – "[site code] – [site name], [date]" – or the
// usual wording. Shared by the report builder and the section forms (which show the usual wording to start from).

import type { ReportBlock } from '../db/types';

export interface FillIn {
  /** As written in a caption, between square brackets: [site name]. */
  name: string;
  /** What it gives, in the suggestions. */
  help: string;
  /** For the example under the box. */
  example: string;
}

const SITE: FillIn[] = [
  { name: 'site', help: "The site's code and name", example: 'DP1 – Sediment pond outlet' },
  { name: 'site code', help: "The site's code", example: 'DP1' },
  { name: 'site name', help: "The site's name", example: 'Sediment pond outlet' },
  { name: 'site type', help: 'Surface water, groundwater …', example: 'Discharge' },
];
const DATE: FillIn = { name: 'date', help: "The date of the site's sample", example: '3 Mar 2026' };
const SITES: FillIn = { name: 'sites', help: 'The sites in it', example: 'DP1, DS1 and US1' };
const COMMON: FillIn[] = [
  { name: 'period', help: "The report's dates", example: '1 Jul 2025 – 30 Jun 2026' },
  { name: 'period name', help: 'The period in words', example: 'July 2025 to June 2026' },
  { name: 'project', help: 'The project name', example: 'Kōwhai Quarry' },
  { name: 'project code', help: 'Project / job number', example: 'DEMO-001' },
  { name: 'consent', help: 'Consent number(s)', example: 'AUTH-123456' },
];
const CHART: FillIn[] = [
  { name: 'parameter', help: "The graph's parameter", example: 'Total Suspended Solids' },
  { name: 'unit', help: "The parameter's unit", example: 'mg/L' },
  { name: 'sites', help: 'The sites on the graph', example: 'DP1, DS1 and US1' },
  { name: 'dates', help: "The graph's dates", example: '1 Jul 2023 – 30 Jun 2026' },
];

/** The fill-ins a section's caption can use – the section's own first. */
export function captionFillIns(b: ReportBlock): FillIn[] {
  switch (b.type) {
    case 'roundTable':
    case 'roundReview':
      return [...SITE, DATE, ...COMMON];
    case 'resultsTable':
      return [...(b.splitBySite ? SITE : [SITES]), ...COMMON];
    case 'chart':
      return [...CHART, ...COMMON];
    default:
      return COMMON;
  }
}

/** Fill-ins for notes under a table: the ones every table has. */
export const NOTE_FILL_INS = COMMON;

/** Fill-ins for a page's header and footer. */
export const PAGE_FILL_INS: FillIn[] = [
  { name: 'page', help: 'The page number', example: '2' },
  { name: 'pages', help: 'How many pages', example: '14' },
  { name: 'report', help: "The template's name", example: 'Annual compliance monitoring report' },
  ...COMMON,
  { name: 'client', help: 'The client', example: 'Demo Aggregates Ltd' },
  { name: 'company', help: 'Your company (Settings)', example: 'Example Ltd' },
  { name: 'author', help: 'Your name (Settings)', example: 'Sam Smith' },
  { name: 'date', help: "Today's date", example: '18 Oct 2026' },
];

/** What the footer's right side says when it hasn't been changed: the page number, except on a letterhead (it has its own). */
export const usualFooterRight = (onLetterhead: boolean) => (onLetterhead ? '' : 'Page [page] of [pages]');

/** "Site name", "site.name" and "siteName" are all the same fill-in. */
export const fillKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const ALIASES: Record<string, string> = {
  periodlabel: 'periodname',
  projectname: 'project',
  projectconsents: 'consent',
  consents: 'consent',
  sampledate: 'date',
  param: 'parameter',
  parametername: 'parameter',
};

/**
 * "[site name]" (or "{{site.name}}") → "Sediment pond outlet". Anything else in brackets is left as written ("[mg/L]"),
 * and other {{…}} for the report's own placeholders.
 */
export function fillCaption(pattern: string, values: Record<string, string>): string {
  const get = (raw: string): string | undefined => {
    const k = fillKey(raw);
    return values[ALIASES[k] ?? k];
  };
  return pattern.replace(/\{\{\s*([\w. ]+?)\s*\}\}/g, (m, k: string) => get(k) ?? m).replace(/\[([^[\]\n]{1,40})\]/g, (m, k: string) => get(k) ?? m);
}

/** Tidy what an empty fill-in leaves: "DP1 ()" → "DP1", "DP1 – , 3 Mar" → "DP1, 3 Mar", " · DEMO-001" → "DEMO-001". */
export function tidyCaption(s: string): string {
  return s
    .replace(/(\s[·|]\s*)+(?=\s[·|]\s)/g, '')
    .replace(/^\s*[·|]\s*/, '')
    .replace(/\s*[·|]\s*$/, '')
    .replace(/\s*\(\s*\)/g, '')
    .replace(/\s+[–-]\s*(?=[,.;:)]|$)/g, '')
    .replace(/,\s*(?=[,.;]|$)/g, '')
    .replace(/^\s*[–,;:.-]\s*/, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

const headed = (b: ReportBlock) => b.captionStyle === 'heading' || (b.type === 'roundTable' && b.siteLabel === 'heading');

/** The usual caption, written with fill-ins. */
export function defaultCaption(b: ReportBlock): string {
  switch (b.type) {
    case 'resultsTable':
      return b.splitBySite ? 'Monitoring results – [site code] ([site name])' : 'Monitoring results';
    case 'roundReview':
      return 'Results compared with earlier monitoring – [site code] ([site name]), [date]';
    case 'roundTable':
      return headed(b) ? '[site]' : '[site], [date]';
    case 'statsTable':
      return 'Summary statistics';
    case 'complianceTable':
      return 'Compliance with consent conditions, [period]';
    case 'exceedances':
      return 'Exceedances recorded, [period]';
    case 'siteTable':
      return 'Monitoring sites';
    case 'qaSummary':
      return 'Field duplicate results, [period]';
    case 'trendTable':
      return 'Trends in water quality';
    case 'upDownTable':
      return 'Downstream compared with upstream, [period]';
    case 'samplingTable':
      return 'Samples collected, [period]';
    case 'calc':
      return 'Calculated values, [period]';
    case 'programmeTable':
      return 'Monitoring programme';
    case 'reportingTable':
      return 'Reporting requirements';
    case 'tarpTable':
      return b.levels === 'limits' ? 'Consent limits and responses' : b.levels === 'triggers' ? 'Trigger levels and responses' : 'Trigger levels, limits and responses';
    case 'triggerTable':
      return b.levels === 'limits' ? 'Consent limits' : b.levels === 'triggers' ? 'Trigger levels' : 'Consent limits and trigger levels';
    case 'chart': {
      const band = b.markPeriod && b.range !== 'period';
      return `[parameter] at [sites]${b.range === 'period' ? '' : ', [dates]'}${band ? '. The shaded band is the reporting period' : ''}`;
    }
    default:
      return '';
  }
}

/** A template from before captions could be written: its title (or a graph's extra text) as the wording it gave. */
export function earlierCaption(b: ReportBlock): string | undefined {
  const title = 'title' in b && typeof b.title === 'string' ? b.title.trim() : '';
  switch (b.type) {
    case 'resultsTable':
      return title ? (b.splitBySite ? `${title} – [site code] ([site name])` : title) : undefined;
    case 'roundReview':
      return title ? `${title} – [site code] ([site name]), [date]` : undefined;
    case 'roundTable':
      return title && !headed(b) ? `${title} – [site], [date]` : undefined;
    case 'chart':
      return b.caption?.trim() ? `${defaultCaption(b)}. ${b.caption.trim()}` : undefined;
    case 'statsTable':
    case 'calc':
    case 'programmeTable':
    case 'reportingTable':
    case 'tarpTable':
    case 'triggerTable':
      return title || undefined;
    default:
      return undefined;
  }
}

/** The wording a section's captions use, with fill-ins. */
export function captionOf(b: ReportBlock): string {
  return b.captionText?.trim() || earlierCaption(b) || defaultCaption(b);
}

/** Changing a section's caption wording: the old title (or a graph's extra text) goes – the wording has it now. */
export function withCaption(b: ReportBlock, text: string | undefined): ReportBlock {
  const out = { ...b, captionText: text?.trim() ? text : undefined } as ReportBlock;
  if (b.type === 'chart') (out as typeof b).caption = '';
  else if ('title' in out && b.type !== 'title') (out as { title?: string }).title = undefined;
  return out;
}
