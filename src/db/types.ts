// Core data model for EnviroDB. Everything is stored locally in IndexedDB (see db.ts).
// Dates are stored as local "floating" ISO strings: 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:mm'
// (no timezone), so a sample taken at 10:30 am in NZ is always 10:30 am.

export type ID = string;

export type NdHandling = 'dl' | 'half' | 'zero';

export interface Project {
  id: ID;
  name: string;
  code?: string; // job / project number
  client?: string;
  consents?: string; // consent / permit numbers
  regulator?: string; // e.g. regional council
  location?: string;
  description?: string;
  status: 'active' | 'archived';
  /** Guideline sets used by default for highlighting in tables, charts and reports. */
  guidelineSetIds: ID[];
  /** Apply ANZECC hardness modification to hardness-dependent metals when hardness is measured. */
  hardnessAdjust: boolean;
  /** How non-detects are treated when calculating statistics. */
  ndHandling: NdHandling;
  /** First month (1-12) of the reporting year, e.g. 7 for July–June. */
  yearStartMonth: number;
  /** Percentile method for statistics: Excel PERCENTILE.INC or Hazen (NPS-FM). */
  percentileMethod: 'excel' | 'hazen';
  /** Consent requirements EnviroDB can't check automatically (narrative conditions, notification duties …). */
  consentNotes?: string;
  createdAt: string;
  updatedAt: string;
}

export const SITE_TYPES = [
  'Surface water',
  'Groundwater',
  'Discharge',
  'Stormwater',
  'Wastewater',
  'Leachate',
  'Marine',
  'Soil',
  'Sediment',
  'Air',
  'Other',
] as const;
export type SiteType = (typeof SITE_TYPES)[number];

export const SITE_ROLES = ['', 'Upstream / control', 'Downstream / impact', 'Discharge point', 'Background', 'Compliance point'] as const;
export type SiteRole = (typeof SITE_ROLES)[number];

export interface Site {
  id: ID;
  projectId: ID;
  code: string; // short code shown everywhere, e.g. "SW1"
  name?: string; // descriptive name, e.g. "Mangakino Stream upstream"
  type: SiteType;
  role: SiteRole;
  aliases: string[]; // other names used in lab files / spreadsheets
  easting?: number; // NZTM
  northing?: number;
  description?: string;
  active: boolean;
  order: number;
}

export interface Parameter {
  id: ID; // slug, e.g. "zn-d"
  name: string; // e.g. "Dissolved Zinc"
  short?: string; // e.g. "Zn (D)"
  group: string; // e.g. "Metals (dissolved)"
  unit: string; // canonical unit for display/comparison, e.g. "mg/L"
  aliases: string[];
  /** ANZECC (2000) hardness-modification exponent (HMTV = TV × (H/30)^a). */
  hardnessExponent?: number;
  decimals?: number;
  builtIn?: boolean;
  order?: number;
}

export interface Sample {
  id: ID;
  projectId: ID;
  siteId: ID;
  date: string; // 'YYYY-MM-DD' | 'YYYY-MM-DDTHH:mm'
  sampleName?: string; // as reported by the lab / spreadsheet
  labName?: string;
  labJob?: string;
  labNumber?: string;
  importId?: ID;
  notes?: string;
}

export type Qualifier = '' | '<' | '>';

export interface Result {
  id: ID;
  projectId: ID;
  sampleId: ID;
  siteId: ID;
  date: string; // denormalised from the sample for fast filtering
  parameterId: ID;
  /** Numeric value in `unit`. For non-detects this is the detection limit. Null if not numeric. */
  value: number | null;
  qualifier: Qualifier;
  unit: string; // unit as reported
  text?: string; // raw text as reported (e.g. "< 0.0010", "NS")
  dl?: number; // detection limit, if known
  importId?: ID;
}

export interface GuidelineValue {
  parameterId: ID;
  max?: number; // upper limit
  min?: number; // lower limit (pH, DO …)
  unit: string;
  /** Hardness-dependent value (reported at 30 mg/L CaCO3); adjusted using the parameter's exponent. */
  hardness?: boolean;
  /** Exceedance test for the upper limit: '>' (default) or '>=' (e.g. E. coli "less than 1"). */
  op?: '>' | '>=';
  note?: string;
}

export interface GuidelineSet {
  id: ID;
  name: string; // full name
  shortName: string; // used in table headers / chart labels
  family?: string; // grouping in pickers
  source?: string; // citation
  matrix?: string;
  notes?: string;
  builtIn: boolean;
  values: GuidelineValue[];
  updatedAt: string;
}

export type RuleKind = 'threshold' | 'statistic' | 'change' | 'consecutive' | 'guideline';
export type Operator = '>' | '>=' | '<' | '<=' | 'outside';
export type StatName = 'mean' | 'median' | 'percentile' | 'max' | 'min' | 'geomean';
export type WindowKind = 'period' | 'rolling-days' | 'rolling-samples' | 'year';
export type ChangeType = 'absolute' | 'percent' | 'abs-diff';

/** A consent limit / trigger level / compliance condition. */
export interface Rule {
  id: ID;
  projectId: ID;
  name: string;
  condition?: string; // consent condition reference, e.g. "Condition 7(b)"
  level: string; // "Limit", "Trigger", "Alert" … (see RULE_LEVELS)
  kind: RuleKind;
  parameterId?: ID; // single-parameter rules
  siteIds: ID[]; // [] = all sites
  operator: Operator;
  value?: number; // threshold (or percentage for % change)
  min?: number; // for 'outside'
  max?: number;
  unit?: string;
  // statistic rules
  statistic?: StatName;
  percentile?: number;
  window?: WindowKind;
  windowSize?: number;
  minSamples?: number;
  // change-from-reference rules
  referenceSiteId?: ID;
  changeType?: ChangeType;
  pairingDays?: number;
  // consecutive rules
  consecutive?: number;
  // guideline rules
  guidelineSetId?: ID;
  hardnessAdjust?: boolean;
  action?: string; // required response if triggered
  active: boolean;
  effectiveFrom?: string;
  effectiveTo?: string;
  order: number;
}

export const RULE_LEVELS = ['Limit', 'Trigger 2', 'Trigger 1', 'Trigger', 'Alert', 'Target', 'Info'] as const;

export interface ExceedanceNote {
  id: string; // `${ruleId}|${key}` where key identifies the exceedance
  projectId: ID;
  ruleId: ID;
  key: string;
  status: 'open' | 'notified' | 'closed';
  notifiedOn?: string;
  text: string;
  updatedAt: string;
}

export type FrequencyUnit = 'day' | 'week' | 'month' | 'year';

export interface MonitoringSchedule {
  id: ID;
  projectId: ID;
  name: string;
  siteIds: ID[];
  parameterIds: ID[]; // [] = any sample counts
  every: number;
  unit: FrequencyUnit;
  startDate: string;
  endDate?: string;
  notes?: string;
  active: boolean;
}

export interface ReportSubmission {
  periodStart: string;
  periodEnd: string;
  submittedOn: string;
  notes?: string;
}

export interface ReportObligation {
  id: ID;
  projectId: ID;
  name: string;
  recipient?: string;
  every: number; // 0 = one-off
  unit: 'month' | 'year';
  firstPeriodStart: string;
  firstPeriodEnd: string;
  firstDueDate: string;
  templateId?: ID;
  notes?: string;
  active: boolean;
  submissions: ReportSubmission[];
}

export interface ImportBatch {
  id: ID;
  projectId: ID;
  fileName: string;
  kind: 'lab' | 'wide' | 'long';
  importedAt: string;
  samples: number;
  results: number;
  skipped: number;
  replaced: number;
  notes?: string;
}

// ---------------------------------------------------------------- reports

export type ReportBlockType =
  | 'title'
  | 'heading'
  | 'text'
  | 'summary'
  | 'complianceTable'
  | 'exceedances'
  | 'resultsTable'
  | 'statsTable'
  | 'chart'
  | 'siteTable'
  | 'samplingTable'
  | 'pageBreak';

export interface ReportBlockBase {
  id: string;
  type: ReportBlockType;
}

export interface TitleBlock extends ReportBlockBase {
  type: 'title';
  title: string;
  subtitle?: string;
  showDetails: boolean;
  preparedBy?: string;
  reviewedBy?: string;
  pageBreakAfter: boolean;
}
export interface HeadingBlock extends ReportBlockBase {
  type: 'heading';
  text: string;
  level: 1 | 2 | 3;
}
export interface TextBlock extends ReportBlockBase {
  type: 'text';
  text: string; // supports **bold**, *italic*, "- " bullet lines and {{placeholders}}
  /** Ask for this text each time the report is generated (pre-filled with `text`). */
  prompt?: boolean;
}
export interface SummaryBlock extends ReportBlockBase {
  type: 'summary'; // auto-generated narrative paragraph(s)
}
export interface ComplianceTableBlock extends ReportBlockBase {
  type: 'complianceTable';
  ruleIds: ID[]; // [] = all active rules
}
export interface ExceedancesBlock extends ReportBlockBase {
  type: 'exceedances';
  ruleIds: ID[];
  includeGuidelines: boolean;
  includeNotes: boolean;
}
export interface ResultsTableBlock extends ReportBlockBase {
  type: 'resultsTable';
  title?: string;
  siteIds: ID[]; // [] = all
  parameterIds: ID[]; // [] = all with data
  layout: 'parametersAsRows' | 'parametersAsColumns';
  guidelineSetIds: ID[] | null; // null = project default
  highlight: boolean;
  splitBySite: boolean;
  /** Only these samples (quick exports of a filtered table). */
  sampleIds?: string[];
}
export interface StatsTableBlock extends ReportBlockBase {
  type: 'statsTable';
  title?: string;
  siteIds: ID[];
  parameterIds: ID[];
  stats: Array<'n' | 'nd' | 'min' | 'max' | 'mean' | 'median' | 'p95' | 'exceed'>;
}
export interface ChartBlock extends ReportBlockBase {
  type: 'chart';
  parameterIds: ID[];
  siteIds: ID[];
  range: 'period' | 'all' | 'years';
  years?: number;
  showGuidelines: boolean;
  guidelineSetIds: ID[] | null;
  showRules: boolean;
  logScale: boolean;
  widthCm: number;
  heightCm: number;
  caption?: string;
}
export interface SiteTableBlock extends ReportBlockBase {
  type: 'siteTable';
}
export interface SamplingTableBlock extends ReportBlockBase {
  type: 'samplingTable';
}
export interface PageBreakBlock extends ReportBlockBase {
  type: 'pageBreak';
}

export type ReportBlock =
  | TitleBlock
  | HeadingBlock
  | TextBlock
  | SummaryBlock
  | ComplianceTableBlock
  | ExceedancesBlock
  | ResultsTableBlock
  | StatsTableBlock
  | ChartBlock
  | SiteTableBlock
  | SamplingTableBlock
  | PageBreakBlock;

export interface ReportTemplate {
  id: ID;
  name: string;
  description?: string;
  orientation: 'portrait' | 'landscape';
  pageSize: 'A4' | 'A3';
  marginMm: number;
  fontSize: number;
  accent: string;
  headerText?: string;
  footerText?: string;
  logo?: string; // data URL
  /** Number headings (1, 1.1 …) and captions (Table 1, Figure 1 …). */
  numbering?: boolean;
  blocks: ReportBlock[];
  builtIn?: boolean;
  updatedAt: string;
}

export interface MetaRecord {
  key: string;
  value: unknown;
}

export interface Settings {
  author: string;
  company: string;
  defaultTemplateId?: ID;
  dateFormat: 'D MMM YYYY' | 'DD/MM/YYYY' | 'YYYY-MM-DD';
  lastBackupAt?: string;
  /** Unit for showing guideline concentrations on the Guidelines page ('published' = as stored). */
  guidelineUnit?: string;
}
