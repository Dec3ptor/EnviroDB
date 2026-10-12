import type { ReportBlock, ReportTemplate } from '../db/types';

const UPDATED = '2026-10-01';
let n = 0;
const id = (prefix: string) => `${prefix}-${++n}`;

/**
 * A sign-off at the end: you (name and signature from Settings) and a reviewer, who is left out until named.
 * Fixed ids, so adding it doesn't renumber the blocks that saved report commentary is kept against.
 */
const signOff = (key: string): ReportBlock => ({
  id: `${key}-sign`,
  type: 'signatures',
  signatories: [
    { id: `${key}-sign-1`, role: 'Prepared by', self: true, name: '', details: '' },
    { id: `${key}-sign-2`, role: 'Reviewed by', name: '', details: '' },
  ],
});

const base = {
  orientation: 'portrait' as const,
  pageSize: 'A4' as const,
  marginMm: 20,
  fontSize: 10,
  accent: '#0f766e',
  headerText: '{{project.name}}',
  footerText: '{{company}} · {{project.code}}',
  numbering: true,
  builtIn: true,
  updatedAt: UPDATED,
};

const annual: ReportBlock[] = [
  { id: id('a'), type: 'title', title: '{{project.name}}', subtitle: 'Annual Compliance Monitoring Report – {{period.label}}', showDetails: true, preparedBy: '{{author}}', reviewedBy: '', pageBreakAfter: true },
  { id: id('a'), type: 'heading', text: 'Introduction', level: 1 },
  {
    id: id('a'),
    type: 'text',
    text:
      'This report presents the results of environmental monitoring undertaken on behalf of {{project.client}} in accordance with resource consent(s) {{project.consents}} issued by {{project.regulator}}.\n\nIt covers the monitoring period {{period.start}} to {{period.end}}.',
    prompt: false,
  },
  { id: id('a'), type: 'heading', text: 'Summary', level: 1 },
  { id: id('a'), type: 'summary' },
  { id: id('a'), type: 'heading', text: 'Monitoring locations', level: 1 },
  { id: id('a'), type: 'siteTable' },
  { id: id('a'), type: 'heading', text: 'Sampling undertaken', level: 1 },
  { id: id('a'), type: 'samplingTable' },
  { id: id('a'), type: 'heading', text: 'Compliance assessment', level: 1 },
  { id: id('a'), type: 'complianceTable', ruleIds: [] },
  { id: id('a'), type: 'heading', text: 'Exceedances', level: 2 },
  { id: id('a'), type: 'exceedances', ruleIds: [], includeGuidelines: false, includeNotes: true },
  { id: id('a'), type: 'heading', text: 'Results', level: 1 },
  { id: id('a'), type: 'resultsTable', title: 'Monitoring results', siteIds: [], parameterIds: [], layout: 'parametersAsRows', guidelineSetIds: null, ruleColumns: 'all', highlight: true, splitBySite: true },
  { id: id('a'), type: 'heading', text: 'Summary statistics', level: 2 },
  { id: id('a'), type: 'statsTable', title: 'Summary statistics for the period', siteIds: [], parameterIds: [], stats: ['n', 'nd', 'min', 'median', 'mean', 'max', 'exceed'] },
  { id: id('a'), type: 'heading', text: 'Graphs', level: 1 },
  { id: id('a'), type: 'chart', parameterIds: [], siteIds: [], range: 'years', years: 3, showGuidelines: true, guidelineSetIds: null, showRules: true, logScale: false, widthCm: 16, heightCm: 8, caption: '' },
  { id: id('a'), type: 'heading', text: 'Discussion and conclusions', level: 1 },
  { id: id('a'), type: 'text', text: 'Add discussion of the results, any exceedances, the actions taken and recommendations here.', prompt: true },
  signOff('a'),
];

const quarterly: ReportBlock[] = [
  { id: id('q'), type: 'title', title: '{{project.name}}', subtitle: 'Monitoring Data Summary – {{period.start}} to {{period.end}}', showDetails: true, preparedBy: '{{author}}', reviewedBy: '', pageBreakAfter: false },
  { id: id('q'), type: 'summary' },
  { id: id('q'), type: 'heading', text: 'Compliance', level: 1 },
  { id: id('q'), type: 'complianceTable', ruleIds: [] },
  { id: id('q'), type: 'exceedances', ruleIds: [], includeGuidelines: true, includeNotes: true },
  { id: id('q'), type: 'heading', text: 'Results', level: 1, pages: 'landscape' },
  { id: id('q'), type: 'resultsTable', title: 'Results for the period', siteIds: [], parameterIds: [], layout: 'parametersAsColumns', guidelineSetIds: null, ruleColumns: 'all', highlight: true, splitBySite: false },
  { id: id('q'), type: 'heading', text: 'Graphs', level: 1 },
  { id: id('q'), type: 'chart', parameterIds: [], siteIds: [], range: 'years', years: 2, showGuidelines: true, guidelineSetIds: null, showRules: true, logScale: false, size: 'full', aspect: 0.5, widthCm: 16, heightCm: 8, caption: '' },
  { id: id('q'), type: 'heading', text: 'Comments', level: 1 },
  { id: id('q'), type: 'text', text: 'No issues were identified during the period.', prompt: true },
  signOff('q'),
];

const round: ReportBlock[] = [
  { id: id('r'), type: 'title', title: '{{project.name}}', subtitle: 'Monitoring results – {{period.month}}', showDetails: true, preparedBy: '{{author}}', reviewedBy: '', pageBreakAfter: false },
  {
    id: id('r'),
    type: 'text',
    text: 'This report presents the results of monitoring undertaken in {{period.month}} on behalf of {{project.client}} under resource consent(s) {{project.consents}}. Each result is compared with the consent limits and triggers, guideline values and the earlier results at the same site.',
    prompt: false,
  },
  { id: id('r'), type: 'summary' },
  { id: id('r'), type: 'heading', text: 'Compliance', level: 1 },
  { id: id('r'), type: 'complianceTable', ruleIds: [] },
  { id: id('r'), type: 'exceedances', ruleIds: [], includeGuidelines: true, includeNotes: true },
  { id: id('r'), type: 'heading', text: 'Results compared with earlier monitoring', level: 1, pages: 'landscape' },
  { id: id('r'), type: 'roundReview', title: 'Results compared with earlier monitoring', siteIds: [], parameterIds: [], compare: ['previous', 'change', 'median', 'range', 'note'], historyYears: 0, guidelineSetIds: null, ruleColumns: 'all', highlight: true },
  { id: id('r'), type: 'heading', text: 'Graphs', level: 1 },
  { id: id('r'), type: 'chart', parameterIds: [], siteIds: [], range: 'years', years: 3, showGuidelines: true, guidelineSetIds: null, showRules: true, logScale: false, size: 'full', aspect: 0.45, widthCm: 16, heightCm: 8, caption: '', markPeriod: true },
  { id: id('r'), type: 'heading', text: 'Comments', level: 1 },
  { id: id('r'), type: 'text', text: 'Add comments on this round’s results here, e.g. anything unusual and the follow-up.', prompt: true },
  signOff('r'),
];

const notification: ReportBlock[] = [
  { id: id('n'), type: 'title', title: 'Notification of monitoring exceedance', subtitle: '{{project.name}} – consent {{project.consents}}', showDetails: true, preparedBy: '{{author}}', reviewedBy: '', pageBreakAfter: false },
  {
    id: id('n'),
    type: 'text',
    text:
      'To: {{project.regulator}}\n\nIn accordance with the conditions of consent {{project.consents}}, {{project.client}} advises that monitoring undertaken between {{period.start}} and {{period.end}} recorded the exceedance(s) summarised below.',
    prompt: false,
  },
  { id: id('n'), type: 'exceedances', ruleIds: [], includeGuidelines: false, includeNotes: true },
  { id: id('n'), type: 'heading', text: 'Actions taken', level: 2 },
  { id: id('n'), type: 'text', text: '- Investigation of the cause is under way.\n- Re-sampling has been scheduled.', prompt: true },
  { id: id('n'), type: 'chart', parameterIds: [], siteIds: [], range: 'years', years: 1, showGuidelines: false, guidelineSetIds: null, showRules: true, logScale: false, widthCm: 16, heightCm: 7, caption: '' },
  signOff('n'),
];

const appendix: ReportBlock[] = [
  { id: id('d'), type: 'heading', text: 'Appendix – Monitoring data', level: 1 },
  { id: id('d'), type: 'resultsTable', title: 'All results', siteIds: [], parameterIds: [], layout: 'parametersAsRows', guidelineSetIds: null, ruleColumns: 'all', highlight: true, splitBySite: true },
  { id: id('d'), type: 'statsTable', title: 'Summary statistics', siteIds: [], parameterIds: [], stats: ['n', 'nd', 'min', 'median', 'p95', 'max', 'exceed'] },
];

export const BUILT_IN_TEMPLATES: ReportTemplate[] = [
  { ...base, id: 'tpl-annual', name: 'Annual compliance monitoring report', description: 'Full annual report: introduction, summary, sites, sampling, compliance, exceedances, results, statistics, graphs and conclusions.', blocks: annual },
  { ...base, id: 'tpl-quarterly', name: 'Quarterly / interim data summary', description: 'Short summary of compliance and results for a quarter or other interim period. The results table is on landscape pages.', blocks: quarterly },
  {
    ...base,
    id: 'tpl-round',
    name: 'Monitoring round summary',
    description: "One monitoring round, titled by its month, with each result compared with limits, guidelines and the site's earlier results.",
    blocks: round,
    period: 'latestRound',
  },
  { ...base, id: 'tpl-notification', name: 'Exceedance notification', description: 'Brief notification to the regulator listing exceedances and actions taken.', blocks: notification },
  { ...base, id: 'tpl-appendix', name: 'Data appendix', description: 'Full results tables and statistics for appending to a report.', blocks: appendix, orientation: 'landscape' },
];
