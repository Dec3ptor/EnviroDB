import type { ReportBlock, ReportKind, ReportTemplate } from '../db/types';

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
  headerText: '[project]',
  footerText: '[company] · [project code]',
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

// ---------------------------------------------------------------- letters on the letterhead (fixed ids: commentary is saved against them)

/** A letter's sign-off: a closing line and your signature from Settings. */
const letterSign = (key: string, closing: string): ReportBlock => ({ id: `${key}-sign`, type: 'signatures', closing, signatories: [{ id: `${key}-sign-1`, role: '', self: true, name: '', details: '' }] });

const letterAnnual: ReportBlock[] = [
  { id: 'la-letter', type: 'letter', date: '{{today}}', to: '{{project.recipient}}', subject: '{{project.name}} – Annual Monitoring Report – Consent {{project.consents}}', reference: 'Ref: {{project.code}}', salutation: '{{project.salutation}}' },
  {
    id: 'la-intro',
    type: 'text',
    text: 'This annual report of environmental monitoring at {{project.name}} covers the period {{period.start}} to {{period.end}}, as required by resource consent {{project.consents}} issued by {{project.regulator}}. The results are summarised below; the complete results and laboratory reports are attached.',
    prompt: true,
  },
  { id: 'la-h-consents', type: 'heading', text: 'Consents', level: 1 },
  {
    id: 'la-consents',
    type: 'text',
    text: '{{project.client}} holds resource consent {{project.consents}} for {{project.name}}. Describe each consent and the conditions that require this report here.\n\n> Quote the consent condition that requires this report here.',
    prompt: true,
  },
  { id: 'la-h-sites', type: 'heading', text: 'Monitoring locations', level: 1 },
  { id: 'la-sites', type: 'siteTable' },
  { id: 'la-h-sampling', type: 'heading', text: 'Monitoring undertaken', level: 1 },
  { id: 'la-summary', type: 'summary' },
  { id: 'la-sampling', type: 'samplingTable' },
  { id: 'la-h-triggers', type: 'heading', text: 'Trigger levels', level: 1 },
  { id: 'la-triggers-text', type: 'text', text: 'The consent limits and trigger levels the results are assessed against are given in {{table:triggers}}.', prompt: true },
  { id: 'la-triggers', type: 'triggerTable', title: '', siteIds: [], levels: 'all', ref: 'triggers' },
  { id: 'la-h-results', type: 'heading', text: 'Results and discussion', level: 1 },
  { id: 'la-compliance', type: 'complianceTable', ruleIds: [] },
  { id: 'la-exceedances', type: 'exceedances', ruleIds: [], includeGuidelines: false, includeNotes: true },
  { id: 'la-h-sitesresults', type: 'heading', text: 'Results by site', level: 2 },
  { id: 'la-rounds', type: 'roundTable', title: 'Results', siteIds: [], parameterIds: [], previous: 3, ruleColumns: 'all', comment: true, summaries: true, siteLabel: 'caption' },
  { id: 'la-h-trends', type: 'heading', text: 'Long-term trends', level: 2 },
  { id: 'la-trends', type: 'chart', parameterIds: [], siteIds: [], range: 'all', showGuidelines: false, guidelineSetIds: null, showRules: true, logScale: false, size: 'full', aspect: 0.45, widthCm: 16, heightCm: 7.2, caption: '', markPeriod: true },
  { id: 'la-figures', type: 'figures', images: [], perRow: 2, heightMm: 0, numbering: 'each', label: 'Figure', caption: '', border: false },
  { id: 'la-h-summary', type: 'heading', text: 'Summary', level: 1 },
  { id: 'la-summary-text', type: 'text', text: '- Monitoring was carried out as the consent requires.\n- Add the key findings for the year here.', prompt: true },
  letterSign('la', 'Kind regards,'),
  { id: 'la-attached', type: 'text', text: '**Attachments:**\n- Site plan\n- Laboratory results\n- Results spreadsheet', prompt: true },
  { id: 'la-h-appendix', type: 'heading', text: 'Appendix – Monitoring results', level: 1, pages: 'landscape' },
  { id: 'la-appendix', type: 'resultsTable', title: 'Monitoring results', siteIds: [], parameterIds: [], layout: 'parametersAsRows', guidelineSetIds: null, ruleColumns: 'all', highlight: true, splitBySite: true },
];

const letterEvent: ReportBlock[] = [
  { id: 'le-letter', type: 'letter', date: '{{today}}', to: '{{project.recipient}}', subject: '{{project.name}}: consent {{project.consents}}: Compliance Monitoring – {{period.month}}', reference: 'Project ref: {{project.code}}', salutation: '{{project.salutation}}' },
  {
    id: 'le-intro',
    type: 'text',
    text: 'The routine monitoring round for {{project.name}} was carried out in {{period.month}} as required by consent {{project.consents}}. Each site’s results are compared below with the previous round and the consent trigger levels.',
    prompt: true,
  },
  { id: 'le-rounds', type: 'roundTable', title: '', siteIds: [], parameterIds: [], previous: 1, ruleColumns: 'all', comment: true, summaries: true, siteLabel: 'heading' },
  { id: 'le-figures', type: 'figures', images: [], perRow: 2, heightMm: 0, numbering: 'each', label: 'Figure', caption: '', border: false },
  { id: 'le-h-summary', type: 'heading', text: 'Summary', level: 1 },
  { id: 'le-summary-text', type: 'text', text: 'Add an overall summary of the round here – which sites remain compliant, any exceedances and their follow-up. The next monitoring round is scheduled for …', prompt: true },
  letterSign('le', 'Kind regards,'),
  { id: 'le-attached', type: 'text', text: '**Attachments:**\n- Laboratory results\n- Results spreadsheet\n\n**CC:** {{project.regulator}}', prompt: true },
];

/** Letters print on the letterhead in Settings: headings in its colour, grey table headers, exceedances in red. */
const letter = { ...base, style: 'letter' as const, letterhead: true, tableHeader: 'grey' as const, highlightStyle: 'text' as const, numbering: true, numberHeadings: false, headerText: '', footerText: '[company]' };

const appendix: ReportBlock[] = [
  { id: id('d'), type: 'heading', text: 'Appendix – Monitoring data', level: 1 },
  { id: id('d'), type: 'resultsTable', title: 'All results', siteIds: [], parameterIds: [], layout: 'parametersAsRows', guidelineSetIds: null, ruleColumns: 'all', highlight: true, splitBySite: true },
  { id: id('d'), type: 'statsTable', title: 'Summary statistics', siteIds: [], parameterIds: [], stats: ['n', 'nd', 'min', 'median', 'p95', 'max', 'exceed'] },
];

export const BUILT_IN_TEMPLATES: ReportTemplate[] = [
  { ...base, kind: 'monitoring', id: 'tpl-annual', name: 'Annual compliance monitoring report', description: 'Full annual report: introduction, summary, sites, sampling, compliance, exceedances, results, statistics, graphs and conclusions.', blocks: annual },
  { ...base, kind: 'monitoring', id: 'tpl-quarterly', name: 'Quarterly / interim data summary', description: 'Short summary of compliance and results for a quarter or other interim period. The results table is on landscape pages.', blocks: quarterly },
  {
    ...base,
    kind: 'monitoring',
    id: 'tpl-round',
    name: 'Monitoring round summary',
    description: "One monitoring round, titled by its month, with each result compared with limits, guidelines and the site's earlier results.",
    blocks: round,
    period: 'latestRound',
  },
  {
    ...letter,
    kind: 'letter',
    id: 'tpl-letter-annual',
    name: 'Annual report (letter)',
    description: 'An annual report as a letter on your letterhead: consents, monitoring locations and programme, trigger levels, results by site with comments, long-term graphs, figures, summary and sign-off.',
    blocks: letterAnnual,
  },
  {
    ...letter,
    kind: 'letter',
    id: 'tpl-letter-event',
    name: 'Monitoring event report (letter)',
    description: "One monitoring round as a letter on your letterhead, titled by its month: each site's results beside the previous round and its triggers, with a comment and a summary per site, figures and sign-off.",
    blocks: letterEvent,
    period: 'latestRound',
  },
  { ...base, kind: 'letter', id: 'tpl-notification', name: 'Exceedance notification', description: 'Brief notification to the regulator listing exceedances and actions taken.', blocks: notification },
  { ...base, kind: 'monitoring', id: 'tpl-appendix', name: 'Data appendix', description: 'Full results tables and statistics for appending to a report.', blocks: appendix, orientation: 'landscape' },
];

/**
 * The Quick check page's Word and PDF downloads – yours to change (it isn't a built-in): the file's name is the
 * project's ({{project.name}}), its lab job the project number; tables with no guideline sets of their own use the sets
 * chosen on the page.
 */
export const QUICK_CHECK_TEMPLATE_ID = 'tpl-quick-check';
export const QUICK_CHECK_TEMPLATE: ReportTemplate = {
  id: QUICK_CHECK_TEMPLATE_ID,
  name: 'Quick check',
  kind: 'other',
  description: 'The Word and PDF downloads on the Quick check page – change it to suit. Tables without guideline sets of their own compare with the sets chosen there.',
  orientation: 'landscape',
  pageSize: 'A4',
  marginMm: 15,
  fontSize: 9.5,
  accent: '#0f766e',
  headerText: '[project]',
  footerText: '[company]',
  numbering: true,
  starter: true,
  blocks: [
    { id: 'qc-title', type: 'title', title: 'Quick check', subtitle: '{{project.name}}', showDetails: false, pageBreakAfter: false },
    { id: 'qc-summary', type: 'summary' },
    { id: 'qc-results', type: 'resultsTable', title: 'Results compared with guideline values', siteIds: [], parameterIds: [], layout: 'parametersAsRows', guidelineSetIds: null, ruleColumns: 'none', highlight: true, splitBySite: false },
  ],
  updatedAt: UPDATED,
};

/** What templates are for, in the order they're listed. */
export const REPORT_KINDS: Array<{ kind: ReportKind; label: string }> = [
  { kind: 'monitoring', label: 'Monitoring reports' },
  { kind: 'letter', label: 'Letters' },
  { kind: 'management-plan', label: 'Management plans' },
  { kind: 'investigation', label: 'Site investigations' },
  { kind: 'ecology', label: 'Ecology' },
  { kind: 'other', label: 'Other' },
];
export const KIND_LABEL = Object.fromEntries(REPORT_KINDS.map((k) => [k.kind, k.label])) as Record<ReportKind, string>;

// ---------------------------------------------------------------- starters: new templates to make your own

const text = (t: string, prompt = true): ReportBlock => ({ id: id('s'), type: 'text', text: t, prompt });
const h = (t: string, level: 1 | 2 | 3 = 1): ReportBlock => ({ id: id('s'), type: 'heading', text: t, level });
const titleBlock = (subtitle: string, pageBreakAfter = true): ReportBlock => ({ id: id('s'), type: 'title', title: '{{project.name}}', subtitle, showDetails: true, preparedBy: '{{author}}', reviewedBy: '', pageBreakAfter });
const results = (title = 'Results'): ReportBlock => ({ id: id('s'), type: 'resultsTable', title, siteIds: [], parameterIds: [], layout: 'parametersAsRows', guidelineSetIds: null, ruleColumns: 'all', highlight: true, splitBySite: true });
const signs = (): ReportBlock => ({ id: id('s'), type: 'signatures', signatories: [{ id: id('sg'), role: 'Prepared by', self: true, name: '', details: '' }, { id: id('sg'), role: 'Reviewed by', name: '', details: '' }] });

const managementPlan: ReportBlock[] = [
  titleBlock('Environmental Monitoring and Management Plan'),
  h('Introduction'),
  text('This plan sets out how the environmental effects of {{project.name}} are monitored and managed, as required by resource consent(s) {{project.consents}} issued by {{project.regulator}}.'),
  h('Purpose and objectives'),
  text('The purpose of this plan is to …\n\nIts objectives are to:\n- monitor …\n- identify and respond to …\n- report …'),
  h('Site description'),
  text('Describe the site, the activity and the receiving environment.'),
  { id: id('s'), type: 'siteTable' },
  h('Consent requirements'),
  text('The conditions of consent {{project.consents}} this plan responds to:\n\n> Quote the conditions here.'),
  h('Monitoring programme'),
  text('Monitoring is carried out as set out in {{table:programme}}. Samples are collected by suitably trained staff and analysed by an IANZ-accredited laboratory.'),
  { id: id('s'), type: 'programmeTable', title: '', ref: 'programme' },
  h('Trigger levels and response actions'),
  text('Where a result exceeds a trigger level or consent limit, the response in {{table:tarp}} is followed.'),
  { id: id('s'), type: 'tarpTable', title: '', levels: 'all', ref: 'tarp' },
  h('Reporting'),
  { id: id('s'), type: 'reportingTable', title: '' },
  h('Roles and responsibilities'),
  text('- **Consent holder:** …\n- **Environmental consultant:** monitoring, analysis and reporting\n- **Site manager:** …'),
  h('Review of this plan'),
  text('This plan is reviewed every … years, and whenever the consent conditions, the activity or the monitoring results show it needs to be.'),
  signs(),
];

const investigation: ReportBlock[] = [
  titleBlock('Detailed Site Investigation'),
  h('Introduction'),
  text('{{company}} was engaged by {{project.client}} to carry out a site investigation at {{project.location}}. This report presents the investigation and its findings.'),
  h('Scope of work'),
  text('The scope of work was to:\n- review the site history\n- collect soil and/or water samples for laboratory analysis\n- compare the results with the assessment criteria\n- report the findings'),
  h('Site description and history'),
  text('Describe the site, its surroundings and its history of use, including any activities on the HAIL.'),
  { id: id('s'), type: 'siteTable' },
  h('Sampling and analysis'),
  text('Describe how and where samples were collected and the analyses carried out.'),
  { id: id('s'), type: 'samplingTable' },
  h('Assessment criteria'),
  text('The results are compared with the guideline values shown in {{table:results}}. Describe why these criteria were chosen for the site’s current and proposed use.'),
  h('Results'),
  { ...results('Laboratory results'), ref: 'results' } as ReportBlock,
  { id: id('s'), type: 'exceedances', ruleIds: [], includeGuidelines: true, includeNotes: true },
  { id: id('s'), type: 'statsTable', title: 'Summary statistics', siteIds: [], parameterIds: [], stats: ['n', 'nd', 'min', 'median', 'p95', 'max', 'exceed'] },
  h('Discussion'),
  text('Discuss the results, what they mean for the site’s use and any data gaps.'),
  h('Conclusions and recommendations'),
  text('- …'),
  h('Limitations'),
  text('This report has been prepared for {{project.client}} for the purpose described. Its findings are based on the samples collected and the information available at the time.'),
  signs(),
];

const ecology: ReportBlock[] = [
  titleBlock('Ecological Survey Report'),
  h('Introduction'),
  text('This report presents the results of the ecological survey of {{project.name}} for {{period.label}}.'),
  h('Methods'),
  text('Describe the survey methods – e.g. habitat assessment, macroinvertebrate sampling, fish survey, vegetation plots or eDNA – and where they were used.'),
  { id: id('s'), type: 'siteTable' },
  { id: id('s'), type: 'samplingTable' },
  h('Results'),
  { id: id('s'), type: 'summary' },
  results('Survey results'),
  { id: id('s'), type: 'chart', parameterIds: [], siteIds: [], range: 'all', showGuidelines: true, guidelineSetIds: null, showRules: true, logScale: false, size: 'half', aspect: 0.67, widthCm: 8, heightCm: 6, caption: '' },
  { id: id('s'), type: 'figures', images: [], perRow: 2, heightMm: 0, numbering: 'each', label: 'Figure', caption: '', border: false },
  h('Discussion'),
  text('Discuss the results – the condition of the habitats and communities surveyed, changes since earlier surveys and any effects of the activity.'),
  h('Conclusions and recommendations'),
  text('- …'),
  signs(),
];

const blank: ReportBlock[] = [titleBlock('{{period.label}}', false), h('Introduction'), text('Type your text here.', false)];

/** Starting points for new templates; each one made from them is your own to change. */
export const STARTER_TEMPLATES: ReportTemplate[] = [
  { ...base, builtIn: false, kind: 'other', id: 'start-blank', name: 'Blank template', description: 'A title, a heading and some text – add the sections you need.', blocks: blank },
  { ...base, builtIn: false, kind: 'management-plan', id: 'start-plan', name: 'Management plan', description: 'Purpose, site, consent requirements, the monitoring programme, trigger levels and responses, reporting, roles and review – the tables come from the project.', blocks: managementPlan },
  { ...base, builtIn: false, kind: 'investigation', id: 'start-investigation', name: 'Site investigation report', description: 'Contaminated land: scope, site history, sampling, assessment criteria, results against the criteria, discussion, conclusions and limitations.', blocks: investigation },
  { ...base, builtIn: false, kind: 'ecology', id: 'start-ecology', name: 'Ecology survey report', description: 'Methods, sites, survey results with graphs and photos, discussion and conclusions.', blocks: ecology },
];
