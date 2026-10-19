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
  /** Who letter reports go to: name, position, organisation and address, a line each ({{project.recipient}}). */
  recipient?: string;
  /** The greeting in letters, e.g. "Dear David," ({{project.salutation}}). */
  salutation?: string;
  /** Purchase order number, for the monitoring calendar. */
  purchaseOrder?: string;
  /** The project's folder: a link or a path to copy (e.g. a SharePoint link or G:\\CLIENTS\\…). */
  folder?: string;
  /**
   * Where the project's lab results are saved, inside each person's projects folder ("Clients/Kōwhai/Lab results"):
   * EnviroDB looks there, subfolders and all, for lab files not yet imported.
   */
  labFolder?: string;
  /** Notes for the monitoring calendar (kept here by its first version; a calendar row made for the project starts with them). */
  calendarNotes?: string;
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
  /** Duplicates and blanks: not a monitoring location, its samples are kept out of the monitoring data. */
  'Quality control',
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
  /**
   * A QC sample, kept out of the monitoring data: a field duplicate (of `qcOf`) or a blank. Samples at a "Quality
   * control" site are QC samples too (duplicate or blank by their name).
   */
  qc?: 'duplicate' | 'blank';
  /** A duplicate's original sample. */
  qcOf?: ID;
  /** When the lab received it ('YYYY-MM-DD' or with a time), from the lab's file – for holding times. */
  receivedOn?: string;
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
  /**
   * Left out of the monitoring data after a QA/QC check – statistics, compliance, graphs and reports – and why. The
   * result is kept, and shown struck through in the sample's details.
   */
  excluded?: { reason: string; by?: string; at: string };
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
  /** Guideline rules: only these analytes from the set (none = every analyte in it). */
  parameterIds?: ID[];
  /**
   * Single-parameter rules (limit, statistic, consecutive): the limit is this guideline set's value for the parameter,
   * filled in from the set rather than typed (see withGuidelineLimit).
   */
  limitSetId?: ID;
  /** Guideline rules, and limits taken from a guideline: hardness-modify hardness-dependent metals for each sample. */
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
  /** Its mark on the monitoring calendar (●, ▲ …); by default one of CALENDAR_SYMBOLS in turn. */
  symbol?: string;
  /** Months the sampling can be done in, from the start of each round (default 1). */
  window?: number;
}

/** Where a job stands in a month of the monitoring calendar: done (results sent or reported), doing, cancelled. */
export type CalendarStatus = 'done' | 'doing' | 'cancelled';

/** A month of the calendar's rows: m01 (January) … m12 (December). */
export type MonthField = 'm01' | 'm02' | 'm03' | 'm04' | 'm05' | 'm06' | 'm07' | 'm08' | 'm09' | 'm10' | 'm11' | 'm12';

/** The other columns of a calendar row. */
export type CalendarTextField = 'job' | 'jobCode' | 'purchaseOrder' | 'details' | 'notes' | 'reportDue' | 'managementPlan' | 'other' | 'consents' | 'folder';

/**
 * A row of the monitoring calendar – a job, like a line of a team's monitoring-schedule spreadsheet: what's planned
 * each month (marks such as ●, ▲, R, #, or a sampling window "(" … ")"), the key to the marks and notes. The plan is
 * the same every year; how each month went is kept for each year (CalendarMark). A row for a project shows the
 * project's job number, purchase order, consents and folder (changing them changes the project's).
 */
export type CalendarRow = {
  id: ID;
  projectId?: ID;
  /** Results from these of the project's sites count for the row (all its sites when none). */
  siteIds?: ID[];
  order: number;
  /** The job, e.g. "Closed landfill – stormwater"; blank: the project's name. */
  job: string;
  /** For a row without a project. */
  jobCode?: string;
  purchaseOrder?: string;
  consents?: string;
  folder?: string;
  /** Monitoring schedule details: the key to the marks, e.g. "● = GW2  ▲ = all bores". */
  details?: string;
  notes?: string;
  reportDue?: string;
  managementPlan?: string;
  other?: string;
  /** Columns highlighted (yellow) to stand out, whatever the year. */
  highlight?: CalendarTextField[];
  /** The whole job is on hold or cancelled (the row is shaded pink). */
  onHold?: boolean;
  updatedAt: string;
} & Partial<Record<MonthField, string>>;

/**
 * How a month of a calendar row went in a year – done (green), doing (yellow) or cancelled / on hold (pink) – with a
 * note; or the colour of one of the row's other columns that year (e.g. the report due, green once it's sent).
 */
export interface CalendarMark {
  /** `${row id}|${YYYY-MM}`, or `${row id}|${YYYY}|${field}` for another column. */
  id: string;
  /** The calendar row. */
  item: string;
  /** YYYY-MM, or YYYY for another column. */
  month: string;
  /** The column, when it isn't a month. */
  field?: CalendarTextField;
  status?: CalendarStatus;
  note?: string;
  /**
   * A month's sampling round, stage by stage (YYYY-MM-DD): sampled, sent to the lab (which lab, its job or chain of
   * custody number), results back, and the results sent on (to whom). Results back is also known from imports.
   */
  sampledOn?: string;
  labSentOn?: string;
  lab?: string;
  labRef?: string;
  resultsOn?: string;
  resultsSentOn?: string;
  sentTo?: string;
  /** Kept by the first version of the calendar. */
  projectId?: ID;
  updatedAt: string;
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

/**
 * A file from the inbox (the workspace's Inbox folder, or a project's lab folder) that has been dealt with: imported,
 * or set aside as not lab results. A file changed since (a lab's amended report) is new again.
 */
export interface InboxFile {
  /** Where and which version: `${where}|${path}|${size}|${modified}`. */
  id: ID;
  where: 'inbox' | 'project';
  /** Inside the workspace folder (where 'inbox'), or the projects folder (where 'project'). */
  path: string;
  name: string;
  size: number;
  modified: number;
  projectId?: ID;
  status: 'imported' | 'dismissed';
  importId?: ID;
  /** Who, and when. */
  by?: string;
  at: string;
}

/**
 * What was decided about a QA/QC finding (by its key): fine as it is, results left out, samples swapped between
 * sites, or queried with the lab – with who, when and why. The project's QA/QC log.
 */
export interface QaRecord {
  /** `${projectId}|${key}` */
  id: string;
  projectId: ID;
  key: string;
  kind: string;
  status: 'accepted' | 'excluded' | 'swapped' | 'queried';
  note?: string;
  /** The finding as it was when decided. */
  title: string;
  lines?: string[];
  date?: string;
  siteIds?: ID[];
  resultIds?: ID[];
  /** A swap made: the samples, and the analytes when not all. */
  swap?: { a: ID; b: ID; parameterIds?: ID[] };
  by?: string;
  at: string;
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
  | 'roundReview'
  | 'roundTable'
  | 'triggerTable'
  | 'letter'
  | 'figures'
  | 'signatures'
  | 'pageBreak'
  | 'spacer'
  | 'toc'
  | 'calc'
  | 'programmeTable'
  | 'tarpTable'
  | 'reportingTable'
  | 'qaSummary';

export interface ReportBlockBase {
  id: string;
  type: ReportBlockType;
  /** A name to refer to this section's first table or figure in text: {{table:name}} or {{fig:name}} gives "Table 2". */
  ref?: string;
  /**
   * Put this block – for a heading, its whole section – on pages of this orientation. The pages after it go back
   * to the orientation before it, so the setting moves with the section.
   */
  pages?: 'portrait' | 'landscape';
  /** Tables and graphs: under a numbered caption ("Table 3. …", the default) or a heading of their own (not numbered). */
  captionStyle?: 'caption' | 'heading';
  /** Tables and graphs: the caption's wording, with fill-ins such as [site name] and [date] (none = the usual wording). */
  captionText?: string;
  /** Tables: your own notes under the table, a line each ('' = none; none = the usual notes). */
  tableNotes?: string;
  /** Sections with parameters: leave these out (e.g. water levels, given a table of their own). */
  excludeParameterIds?: ID[];
  /** Sections with sites: leave these out. */
  excludeSiteIds?: ID[];
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
  /** Consent values to compare with, as columns beside the guideline columns: one per level (Limit, Trigger 1 …). */
  ruleColumns?: 'none' | 'limits' | 'all';
  /** Calculation columns after the results (rows at the foot, with samples down): the mean, 95th percentile … */
  calcColumns?: TableCalc[];
}

/** A statistic of each parameter's results, for a calculation column in a table. */
export type TableStat = 'mean' | 'median' | 'min' | 'max' | 'p95' | 'percentile' | 'sum' | 'count' | 'geomean';
export interface TableCalc {
  id: string;
  stat: TableStat;
  /** 'percentile': which one (e.g. 80). */
  percentile?: number;
  /** Worked out from the results in the table (unset), the report period's, the last `years` years', or all of them – at the table's sites. */
  over?: 'shown' | 'period' | 'years' | 'all';
  years?: number;
  /** Its heading (blank: "Mean", "95th %ile" …). */
  label?: string;
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
  /** 'full' = the page width (default), 'half' = two graphs side by side, 'custom' = widthCm × heightCm. */
  size?: 'full' | 'half' | 'custom';
  /** Height as a fraction of the width for 'full' and 'half' (default: heightCm ÷ widthCm). */
  aspect?: number;
  widthCm: number;
  heightCm: number;
  caption?: string;
  /** Shade the reporting period, e.g. this monitoring round against the earlier years. */
  markPeriod?: boolean;
}
export interface SiteTableBlock extends ReportBlockBase {
  type: 'siteTable';
}
/**
 * The QA/QC of the period's results: field duplicates (RPDs), blanks, the checks run, results left out and samples
 * swapped (with why), and how many checks are still to be looked at.
 */
export interface QaSummaryBlock extends ReportBlockBase {
  type: 'qaSummary';
  /** The duplicates' table: every analyte with an RPD, or only those outside the limits (default 'all'). */
  duplicates?: 'all' | 'outside' | 'none';
  /** The decisions' table (results left out, samples swapped, accepted findings …) – default shown. */
  decisions?: boolean;
}
/** What a monitoring round's results are compared with, besides limits and guidelines. */
export type RoundCompare = 'previous' | 'change' | 'median' | 'range' | 'note';
/** Each site's latest sample in the period, compared with the site's earlier results (one table per site). */
export interface RoundReviewBlock extends ReportBlockBase {
  type: 'roundReview';
  title?: string;
  siteIds: ID[]; // [] = all
  parameterIds: ID[]; // [] = all measured
  compare: RoundCompare[];
  /** Earlier results from this many years before the period (0 = all). */
  historyYears: number;
  guidelineSetIds: ID[] | null; // null = project default
  ruleColumns?: 'none' | 'limits' | 'all';
  highlight: boolean;
}
export interface SamplingTableBlock extends ReportBlockBase {
  type: 'samplingTable';
}
/**
 * A monitoring event, site by site: each site's latest results in the period beside its previous rounds and its
 * consent triggers, with a comment such as "Increase – Compliant" and a summary line under each table.
 */
export interface RoundTableBlock extends ReportBlockBase {
  type: 'roundTable';
  title?: string;
  siteIds: ID[]; // [] = all
  parameterIds: ID[]; // [] = all measured
  /** Earlier rounds beside this one: the last this many. */
  previous: number;
  /** …or these sampling rounds (dates, YYYY-MM-DD): each site's sample on the day, or the nearest within two weeks. */
  previousDates?: string[];
  /** Calculation columns after the rounds: the mean, 95th percentile … of each parameter's results. */
  calcColumns?: TableCalc[];
  /** Consent values to compare with: limits only, or limits and triggers. */
  ruleColumns: 'none' | 'limits' | 'all';
  /** A comment per result: the change since the previous round and whether it complies. */
  comment: boolean;
  /** A summary under each site's table – drafted from the results, and yours to edit with the report's commentary. */
  summaries: boolean;
  /** Name each site's table with a numbered caption (default) or a heading. */
  siteLabel?: 'caption' | 'heading';
}
/** Consent limits and trigger levels: a parameter per row and a column per site. */
export interface TriggerTableBlock extends ReportBlockBase {
  type: 'triggerTable';
  title?: string;
  siteIds: ID[]; // [] = all
  levels: 'limits' | 'triggers' | 'all';
}
/** The opening of a letter: date, who it is to, subject, reference and greeting. */
export interface LetterBlock extends ReportBlockBase {
  type: 'letter';
  date: string;
  /** A line each: name, position, organisation, address. */
  to: string;
  /** In bold. */
  subject: string;
  /** e.g. "Ref: {{project.code}}" – a line each. */
  reference?: string;
  salutation: string;
}
/** An image in a Figures section. */
export interface FigureImage {
  id: string;
  /** PNG or JPEG data URL, scaled down when added. */
  src: string;
  caption: string;
  /** A name to refer to it in text: {{fig:name}} gives "Figure 3" (or "Figure 3(b)" in a group). */
  ref?: string;
}
/** Images – site plans, photos, graphs from elsewhere – in a grid with captions and numbers. */
export interface FiguresBlock extends ReportBlockBase {
  type: 'figures';
  /** Images in every report from this template; the images for one report are added on the Reports tab. */
  images: FigureImage[];
  perRow: 1 | 2 | 3 | 4;
  /** Height of the images (mm); 0 = as wide as the column, keeping their shape. */
  heightMm: number;
  /** 'each' = Figure 1, Figure 2 …; 'group' = one number for them all, with (a), (b) … under the images; 'none' = captions only. */
  numbering: 'each' | 'group' | 'none';
  /** What they are called: Figure, Photo, Plate, Map … (each has its own numbers). */
  label: string;
  /** The caption for the group ('group' numbering). */
  caption?: string;
  /** A thin line around each image. */
  border?: boolean;
}
/** One person signing off a report. */
export interface Signatory {
  id: string;
  /** e.g. Prepared by, Reviewed by, Approved for release by. */
  role: string;
  /** The person preparing the report: name, details and signature come from Settings, so they are the same in every report. */
  self?: boolean;
  /** Name, details and signature of anyone else (not used for `self`). */
  name: string;
  /** Lines under the name – job title, qualifications, company. **bold**, *italic* and {{placeholders}} work. */
  details: string;
  /** Signature image (PNG or JPEG data URL); without one a line is left to sign by hand. */
  image?: string;
  /** e.g. {{today}}; blank = no date line. */
  date?: string;
}
export interface SignaturesBlock extends ReportBlockBase {
  type: 'signatures';
  /** e.g. "Kind regards," above the signatures of a letter. */
  closing?: string;
  signatories: Signatory[];
  /** Height of the signatures on the page (mm). */
  imageHeightMm?: number;
}
export interface PageBreakBlock extends ReportBlockBase {
  type: 'pageBreak';
  /** Orientation of the pages from here on (unset = keep the current orientation). */
  orientation?: 'portrait' | 'landscape';
}

/** Blank space between sections. */
export interface SpacerBlock extends ReportBlockBase {
  type: 'spacer';
  heightMm: number;
}

/**
 * Table of contents: the headings to `levels` with their page numbers, and lists of the numbered tables and figures.
 * In Word it is Word's own contents field, so it updates as the document is edited.
 */
export interface TocBlock extends ReportBlockBase {
  type: 'toc';
  /** e.g. "Contents"; blank = no title. */
  title: string;
  levels: 1 | 2 | 3;
  /** A list of the numbered tables after the contents. */
  tables: boolean;
  /** Lists of the numbered figures (graphs, photos …), a list for each label. */
  figures: boolean;
  /** Start a new page after it. */
  pageBreakAfter: boolean;
}

/** A statistic worked out from the results, e.g. the median nitrate-N at DS1 over the period. */
export type CalcStat = 'mean' | 'median' | 'min' | 'max' | 'p95' | 'count' | 'latest' | 'exceed';
export interface CalcRow {
  id: string;
  /** e.g. "Median nitrate-N downstream"; blank: made from the statistic, parameter and sites. */
  label?: string;
  stat: CalcStat;
  parameterId: ID;
  /** Site codes (a template is for any project with these sites); none: every site. */
  sites: string[];
}
/** Calculated values: a short table (or list) of statistics for the period. */
export interface CalcBlock extends ReportBlockBase {
  type: 'calc';
  title?: string;
  rows: CalcRow[];
  show: 'table' | 'list';
}

/** The monitoring programme: each sampling schedule's sites, frequency and parameters. */
export interface ProgrammeTableBlock extends ReportBlockBase {
  type: 'programmeTable';
  title?: string;
}
/** Trigger–action–response plan: each limit or trigger, the value, where it applies and the response required. */
export interface TarpTableBlock extends ReportBlockBase {
  type: 'tarpTable';
  title?: string;
  levels: 'limits' | 'triggers' | 'all';
}
/** Reporting requirements: each report, the period it covers, when it's due and who it goes to. */
export interface ReportingTableBlock extends ReportBlockBase {
  type: 'reportingTable';
  title?: string;
}

export type ReportBlock =
  | QaSummaryBlock
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
  | RoundReviewBlock
  | RoundTableBlock
  | TriggerTableBlock
  | LetterBlock
  | FiguresBlock
  | SignaturesBlock
  | PageBreakBlock
  | SpacerBlock
  | TocBlock
  | CalcBlock
  | ProgrammeTableBlock
  | TarpTableBlock
  | ReportingTableBlock;

/** What a template is for: groups the templates and the starters offered. */
export type ReportKind = 'monitoring' | 'letter' | 'management-plan' | 'investigation' | 'ecology' | 'other';

export interface ReportTemplate {
  id: ID;
  name: string;
  description?: string;
  /** What it's for (a monitoring report, a management plan …). */
  kind?: ReportKind;
  orientation: 'portrait' | 'landscape';
  pageSize: 'A4' | 'A3';
  marginMm: number;
  fontSize: number;
  accent: string;
  /** Header and footer text, with fill-ins such as [project] and [page] of [pages]: left (headerText, footerText), centre and right. */
  headerText?: string;
  footerText?: string;
  headerCenter?: string;
  headerRight?: string;
  footerCenter?: string;
  /** Unset: "Page [page] of [pages]" (none on a letterhead). */
  footerRight?: string;
  /** The header and footer on the first page too (unset: unless the title has a page of its own; never on a letterhead's first page). */
  pageTextFirst?: boolean;
  /** On a letterhead: this header and footer as well as the letterhead's own (unset: the letterhead's only). */
  pageTextWithLetterhead?: boolean;
  logo?: string; // data URL
  /** Height of the logo on the title page (mm); its width follows the image's proportions. */
  logoHeightMm?: number;
  /** Number captions (Table 1, Figure 1 …) – and headings (1, 1.1 …) unless `numberHeadings` says otherwise. */
  numbering?: boolean;
  /** Number headings (unset: as `numbering`). */
  numberHeadings?: boolean;
  /** 'letter': written as a letter – headings in regular weight, "Table 1." captions in italics, a letter opening rather than a title page. */
  style?: 'report' | 'letter';
  /** Use the letterhead in Settings: its logo, footers, margins and fonts (and for Word, the Word file it came from). */
  letterhead?: boolean;
  /** Table header rows: in the accent colour (default), light grey or dark grey. */
  tableHeader?: 'accent' | 'grey' | 'dark';
  /** How exceedances stand out in tables: shaded cells (default) or red text. */
  highlightStyle?: 'fill' | 'text';
  /** The period this template is usually for: 'latestRound' = the month of the latest monitoring round. */
  period?: 'latestRound';
  blocks: ReportBlock[];
  builtIn?: boolean;
  /** Added by EnviroDB for you to change (the Quick check's): not your own work – nor shared – until you save a change. */
  starter?: boolean;
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
  /** Your signature for report sign-offs (PNG or JPEG data URL). */
  signatureImage?: string;
  /** Lines under your name in sign-offs, e.g. job title and company (unset = the company). */
  signatureDetails?: string;
  /** Your company letterhead for letter reports. */
  letterhead?: Letterhead;
  /** Sampling rounds: results are due from the lab this many working days after sending (default 10). */
  labTurnaroundDays?: number;
  /** Sampling rounds: results are to be sent on this many working days after they're back (default 5). */
  sendResultsDays?: number;
  /** QA/QC: duplicate RPD limit (%) for results over 20× the detection limit (default 30). */
  qaRpdLimit?: number;
  /** QA/QC: duplicate RPD limit (%) for results 10–20× the detection limit (default 50). */
  qaRpdLimitNearDl?: number;
  /** QA/QC: how unusual a result is before it's flagged, in robust standard deviations (default 3.5). */
  qaOutlierZ?: number;
}

/** Something in a letterhead's header or footer: a line of text ({page} = page number) or a picture. */
export type LetterheadItem = (
  | { kind: 'text'; runs: Array<{ text: string; color?: string; sizePt?: number; bold?: boolean; italic?: boolean }> }
  | { kind: 'image'; dataUrl: string; widthMm: number; heightMm: number }
) & {
  align: 'left' | 'center' | 'right';
  /** Shift from the left margin (mm) of a left-aligned item, e.g. a logo that sits out in the margin. */
  dx?: number;
};

export interface LetterheadPage {
  header: LetterheadItem[];
  footer: LetterheadItem[];
}

/**
 * A company letterhead for letter reports – logo, footers, margins and fonts – read from a Word file or set up by
 * hand. Shared with the workspace (one letterhead for the team).
 */
export interface Letterhead {
  /** The Word file it was read from (blank when set up by hand). */
  fileName?: string;
  /** The letterhead part of the Word file (data URL, none of its text): Word downloads keep its header and footers exactly. */
  docx?: string;
  /** Word downloads use the Word file's own header and footers (default); off = drawn from the parts below, as in PDFs. */
  useWordFile?: boolean;
  marginsMm: { top: number; right: number; bottom: number; left: number; header: number; footer: number };
  /** How far body text is indented from the left margin (mm), as in the Word file's Normal style. */
  indentMm?: number;
  font?: string;
  headingFont?: string;
  fontSize?: number;
  textColor?: string;
  headingColor?: string;
  /** The first page – a letter's first page often has the address in its footer. */
  first: LetterheadPage;
  /** The pages after the first. */
  other: LetterheadPage;
}
