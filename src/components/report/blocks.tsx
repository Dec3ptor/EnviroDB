import { ActionIcon, Badge, Button, Checkbox, Group, NumberInput, SegmentedControl, Select, Slider, Stack, Switch, TagsInput, Text, TextInput, Textarea } from '@mantine/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import { db } from '../../db/db';
import type { CalcStat, Parameter, ReportBlock, ReportBlockType, Site } from '../../db/types';
import { CALC_STATS } from '../../reports/calc';
import { InsertCalc } from './InsertCalc';
import { GuidelinePicker, ParamPicker, SitePicker } from '../common';
import { createContext, useContext, useState } from 'react';
import { uid } from '../../lib/ids';
import { SignaturesForm } from './Signatures';
import { FigureImages, FiguresLayout, refName } from './Figures';

// Report template blocks ("sections"): labels, defaults, one-line summaries and settings forms.

export const BLOCK_LABELS: Record<ReportBlockType, { label: string; help: string }> = {
  title: { label: 'Title page', help: 'Report title, subtitle and project details' },
  letter: { label: 'Letter opening', help: 'Date, who the letter is to, subject, reference and greeting' },
  heading: { label: 'Heading', help: 'Section heading (numbered automatically)' },
  text: { label: 'Text', help: 'Your own text with {{placeholders}}; can be filled in per report' },
  summary: { label: 'Automatic summary', help: 'Sentences summarising sampling, compliance and guideline exceedances' },
  complianceTable: { label: 'Compliance table', help: 'Each consent rule with its outcome for the period' },
  triggerTable: { label: 'Trigger levels table', help: 'The consent limits and trigger levels: a parameter per row, a column per site' },
  exceedances: { label: 'Exceedance table', help: 'Every exceedance in the period, with your follow-up notes' },
  resultsTable: { label: 'Results table', help: 'Results with guideline values and highlighted exceedances' },
  roundTable: { label: 'Results vs previous rounds', help: "Each site's results this round beside its previous rounds and triggers, with a comment (Increase – Compliant …) and a summary you can edit" },
  roundReview: { label: 'Results vs earlier monitoring', help: "Each site's latest sample in the period beside its previous result, the change, the earlier median and usual range" },
  statsTable: { label: 'Statistics table', help: 'n, min, median, mean, 95th percentile, max per site' },
  chart: { label: 'Graphs', help: 'One graph per parameter with guideline / limit lines' },
  figures: { label: 'Figures', help: 'Your own images – photos, site plans, graphs – in a grid with captions and numbers' },
  siteTable: { label: 'Site table', help: 'Monitoring locations with coordinates' },
  samplingTable: { label: 'Sampling table', help: 'Samples collected per site vs the required programme' },
  signatures: { label: 'Signatures', help: 'Sign-off with names and signatures – paste a signature from an email or Word, or upload one' },
  pageBreak: { label: 'New page', help: 'Start a new page, and optionally switch to portrait or landscape from here' },
  spacer: { label: 'Space', help: 'Blank space between sections, as tall as you like' },
  calc: { label: 'Calculations', help: 'Values worked out from the results – the median nitrate-N downstream, the highest TSS, how many results were over a limit' },
  programmeTable: { label: 'Monitoring programme', help: 'Each sampling schedule: its sites, how often and what for' },
  tarpTable: { label: 'Trigger–action–response plan', help: 'Each consent limit and trigger level, when it is exceeded and the response required' },
  reportingTable: { label: 'Reporting requirements', help: 'Each report: how often, when it is next due and who it goes to' },
};

/** The sections offered to add, grouped as in the palette. */
export const BLOCK_GROUPS: Array<{ label: string; types: ReportBlockType[] }> = [
  { label: 'Text and layout', types: ['heading', 'text', 'spacer', 'pageBreak', 'title', 'letter', 'signatures'] },
  { label: 'From the results', types: ['summary', 'calc', 'resultsTable', 'roundTable', 'roundReview', 'statsTable', 'chart', 'figures'] },
  { label: 'Compliance', types: ['complianceTable', 'exceedances', 'triggerTable'] },
  { label: 'Programme and plans', types: ['programmeTable', 'tarpTable', 'reportingTable', 'siteTable', 'samplingTable'] },
];

/** Sections that make tables (refer to them with {{table:name}}) or figures ({{fig:name}}). */
const REF_KIND: Partial<Record<ReportBlockType, 'table' | 'fig'>> = {
  complianceTable: 'table',
  triggerTable: 'table',
  exceedances: 'table',
  resultsTable: 'table',
  roundTable: 'table',
  roundReview: 'table',
  statsTable: 'table',
  siteTable: 'table',
  samplingTable: 'table',
  calc: 'table',
  programmeTable: 'table',
  tarpTable: 'table',
  reportingTable: 'table',
  chart: 'fig',
  figures: 'fig',
};

export function newBlock(type: ReportBlockType): ReportBlock {
  const id = uid('b');
  switch (type) {
    case 'title':
      return { id, type, title: '{{project.name}}', subtitle: 'Monitoring report – {{period.label}}', showDetails: true, preparedBy: '{{author}}', reviewedBy: '', pageBreakAfter: true };
    case 'heading':
      return { id, type, text: 'New section', level: 1 };
    case 'text':
      return { id, type, text: 'Type your text here. You can use placeholders such as {{project.name}}.', prompt: false };
    case 'summary':
      return { id, type };
    case 'complianceTable':
      return { id, type, ruleIds: [] };
    case 'exceedances':
      return { id, type, ruleIds: [], includeGuidelines: false, includeNotes: true };
    case 'resultsTable':
      return { id, type, title: 'Monitoring results', siteIds: [], parameterIds: [], layout: 'parametersAsRows', guidelineSetIds: null, ruleColumns: 'all', highlight: true, splitBySite: true };
    case 'statsTable':
      return { id, type, title: 'Summary statistics', siteIds: [], parameterIds: [], stats: ['n', 'nd', 'min', 'median', 'max', 'exceed'] };
    case 'chart':
      return { id, type, parameterIds: [], siteIds: [], range: 'years', years: 3, showGuidelines: true, guidelineSetIds: null, showRules: true, logScale: false, size: 'full', aspect: 0.5, widthCm: 16, heightCm: 8, caption: '' };
    case 'signatures':
      return { id, type, signatories: [{ id: uid('sg'), role: 'Prepared by', self: true, name: '', details: '' }, { id: uid('sg'), role: 'Reviewed by', name: '', details: '' }] };
    case 'roundReview':
      return { id, type, title: 'Results compared with earlier monitoring', siteIds: [], parameterIds: [], compare: ['previous', 'change', 'median', 'range', 'note'], historyYears: 0, guidelineSetIds: null, ruleColumns: 'all', highlight: true };
    case 'roundTable':
      return { id, type, title: '', siteIds: [], parameterIds: [], previous: 1, ruleColumns: 'all', comment: true, summaries: true, siteLabel: 'heading' };
    case 'triggerTable':
      return { id, type, title: '', siteIds: [], levels: 'all' };
    case 'letter':
      return { id, type, date: '{{today}}', to: '{{project.recipient}}', subject: '{{project.name}} – consent {{project.consents}}', reference: 'Ref: {{project.code}}', salutation: '{{project.salutation}}' };
    case 'figures':
      return { id, type, images: [], perRow: 2, heightMm: 0, numbering: 'each', label: 'Figure', caption: '', border: false };
    case 'spacer':
      return { id, type, heightMm: 10 };
    case 'calc':
      return { id, type, title: '', rows: [], show: 'table' };
    case 'tarpTable':
      return { id, type, title: '', levels: 'all' };
    case 'programmeTable':
    case 'reportingTable':
      return { id, type, title: '' };
    default:
      return { id, type } as ReportBlock;
  }
}

export function blockSummary(b: ReportBlock): string {
  switch (b.type) {
    case 'title':
      return b.title;
    case 'heading':
      return `H${b.level}: ${b.text}`;
    case 'text':
      return `${b.prompt ? '[filled in per report] ' : ''}${b.text.slice(0, 80)}`;
    case 'resultsTable':
      return `${b.title ?? ''} · ${b.layout === 'parametersAsRows' ? 'parameters down' : 'dates down'}${b.splitBySite ? ' · one table per site' : ''}${b.ruleColumns === 'all' ? ' · with consent limits & triggers' : b.ruleColumns === 'limits' ? ' · with consent limits' : ''}`;
    case 'chart':
      return `${b.parameterIds.length ? `${b.parameterIds.length} parameters` : 'Key parameters (those with consent rules)'} · ${b.range === 'years' ? `last ${b.years} years` : b.range === 'all' ? 'all data' : 'report period'} · ${(b.size ?? 'full') === 'full' ? 'full width' : b.size === 'half' ? 'two per row' : `${b.widthCm} × ${b.heightCm} cm`}`;
    case 'roundReview':
      return `${b.title ?? ''} · ${b.historyYears ? `last ${b.historyYears} years` : 'all earlier results'}`;
    case 'roundTable':
      return [b.previous ? `this round and ${b.previous} before` : 'this round', b.comment && 'comments', b.summaries && 'a summary per site'].filter(Boolean).join(' · ');
    case 'triggerTable':
      return b.levels === 'limits' ? 'Consent limits' : b.levels === 'triggers' ? 'Trigger levels' : 'Consent limits and trigger levels';
    case 'letter':
      return `${b.subject}`;
    case 'figures':
      return [`${b.perRow} per row`, b.numbering === 'group' ? `one ${b.label || 'figure'} number, (a) (b) …` : b.numbering === 'each' ? `${b.label || 'Figure'} numbers` : 'no numbers', b.images.length ? `${b.images.length} image${b.images.length === 1 ? '' : 's'} in every report` : 'images added per report'].join(' · ');
    case 'signatures':
      return b.signatories.map((s) => `${s.role || 'Signed'}: ${s.self ? 'you' : s.name || '(no name yet)'}`).join(' · ') || 'Nobody yet';
    case 'pageBreak':
      return b.orientation ? `New page – ${b.orientation} from here on` : 'New page';
    case 'spacer':
      return `${b.heightMm} mm`;
    case 'calc':
      return b.rows.length ? `${b.rows.length} value${b.rows.length === 1 ? '' : 's'}${b.show === 'list' ? ' as a list' : ' in a table'}` : 'No values chosen yet';
    case 'tarpTable':
      return b.levels === 'limits' ? 'Consent limits' : b.levels === 'triggers' ? 'Trigger levels' : 'Limits and trigger levels, with their responses';
    default:
      return BLOCK_LABELS[b.type].help;
  }
}

/** The project's sites, for choosing a section's sites on a project's Reports tab (none in the template library). */
export const ReportSitesContext = createContext<Site[] | null>(null);

/** Sections that can show some of the report's sites, and what to call the choice. */
const SITE_LABELS: Partial<Record<ReportBlockType, string>> = {
  resultsTable: 'Sites in this table',
  statsTable: 'Sites in this table',
  chart: 'Sites on these graphs',
  roundReview: 'Sites in this table',
  roundTable: 'Sites in this section',
  triggerTable: 'Sites in this table',
};

/** The sites a section is limited to, if it can be (and is). */
function sectionSiteIds(block: ReportBlock): string[] {
  return SITE_LABELS[block.type] && 'siteIds' in block ? block.siteIds : [];
}

/** Badges beside a section's name when it shows only some parameters or sites, or leaves some out. */
export function BlockSitesNote({ block }: { block: ReportBlock }) {
  return (
    <>
      <ParamsBadge block={block} />
      <SitesBadge block={block} />
    </>
  );
}

function ParamsBadge({ block }: { block: ReportBlock }) {
  const params = useLiveQuery(() => db.parameters.toArray(), []);
  const only = 'parameterIds' in block ? block.parameterIds : [];
  const out = block.excludeParameterIds ?? [];
  if (!params || (!only.length && !out.length)) return null;
  const name = (id: string) => {
    const p = params.find((x) => x.id === id);
    return p ? p.short || p.name : id;
  };
  const list = (ids: string[]) => (ids.length > 2 ? `${ids.length} parameters` : ids.map(name).join(', '));
  return (
    <Badge size="xs" variant="light" color={only.length ? 'blue' : 'gray'} style={{ flexShrink: 0, textTransform: 'none' }} title={(only.length ? only : out).map(name).join(', ')}>
      {only.length ? `only ${list(only)}` : `not ${list(out)}`}
    </Badge>
  );
}

/** "BH1, BH2" or "not DP1" (or a count) when a section shows only some sites, or leaves some out. */
function SitesBadge({ block }: { block: ReportBlock }) {
  const sites = useContext(ReportSitesContext);
  if (!sites || !SITE_LABELS[block.type]) return null;
  const ids = sectionSiteIds(block);
  const codes = sites.filter((s) => ids.includes(s.id)).map((s) => s.code);
  const out = sites.filter((s) => block.excludeSiteIds?.includes(s.id)).map((s) => s.code);
  if (codes.length)
    return (
      <Badge size="xs" variant="light" color="teal" style={{ flexShrink: 0, textTransform: 'none' }} title={`Only ${codes.join(', ')}`}>
        {codes.length > 3 ? `${codes.length} sites` : codes.join(', ')}
      </Badge>
    );
  if (out.length)
    return (
      <Badge size="xs" variant="light" color="gray" style={{ flexShrink: 0, textTransform: 'none' }} title={`All sites but ${out.join(', ')}`}>
        not {out.length > 3 ? `${out.length} sites` : out.join(', ')}
      </Badge>
    );
  return null;
}

type Choice = 'all' | 'only' | 'except';
const CHOICES = [
  { value: 'all', label: 'All' },
  { value: 'only', label: 'Only these' },
  { value: 'except', label: 'All except' },
];

/** A section's sites: all the report's, only some (e.g. the bores for a groundwater table), or all but some. */
function BlockSitesField({ block, onChange }: { block: ReportBlock; onChange: (b: ReportBlock) => void }) {
  const sites = useContext(ReportSitesContext);
  const label = SITE_LABELS[block.type];
  const has = !!label && 'siteIds' in block;
  const only = has ? (block as { siteIds: string[] }).siteIds.filter((id) => sites?.some((s) => s.id === id)) : [];
  const except = (block.excludeSiteIds ?? []).filter((id) => sites?.some((s) => s.id === id));
  const [mode, setMode] = useState<Choice>(only.length ? 'only' : except.length ? 'except' : 'all');
  if (!has) return null;
  if (!sites)
    return (
      <Text size="xs" c="dimmed">
        Shows all the report’s sites. To show only some in this section (e.g. just the bores), or leave some out, choose them on a project’s Reports tab under Edit layout.
      </Text>
    );
  const set = (patch: Partial<{ siteIds: string[]; excludeSiteIds?: string[] }>) => onChange({ ...block, ...patch } as ReportBlock);
  return (
    <Stack gap={6}>
      <Text size="sm" fw={500}>
        {label}
      </Text>
      <SegmentedControl
        size="xs"
        fullWidth
        value={mode}
        data={CHOICES}
        onChange={(v) => {
          setMode(v as Choice);
          if (v === 'all') set({ siteIds: [], excludeSiteIds: undefined });
          if (v === 'only') set({ excludeSiteIds: undefined });
          if (v === 'except') set({ siteIds: [] });
        }}
      />
      {mode === 'only' && (
        <SitePicker sites={sites} label="Only these sites" placeholder="Choose the sites" value={only} onChange={(v) => set({ siteIds: v.length >= sites.length ? [] : v })} />
      )}
      {mode === 'except' && (
        <SitePicker sites={sites} label="Leave out these sites" placeholder="Choose the sites to leave out" value={except} onChange={(v) => set({ excludeSiteIds: v.length ? v : undefined })} />
      )}
    </Stack>
  );
}

/** A section's parameters: all of them, only some (e.g. just water levels), or all but some (e.g. all but water levels). */
function BlockParamsField({ block, params, onChange, all }: { block: ReportBlock & { parameterIds: string[] }; params: Parameter[]; onChange: (b: ReportBlock) => void; all: string }) {
  const [mode, setMode] = useState<Choice>(block.parameterIds.length ? 'only' : block.excludeParameterIds?.length ? 'except' : 'all');
  const set = (patch: Partial<{ parameterIds: string[]; excludeParameterIds?: string[] }>) => onChange({ ...block, ...patch } as ReportBlock);
  return (
    <Stack gap={6}>
      <Text size="sm" fw={500}>
        Parameters
      </Text>
      <SegmentedControl
        size="xs"
        fullWidth
        value={mode}
        data={CHOICES}
        onChange={(v) => {
          setMode(v as Choice);
          if (v === 'all') set({ parameterIds: [], excludeParameterIds: undefined });
          if (v === 'only') set({ excludeParameterIds: undefined });
          if (v === 'except') set({ parameterIds: [] });
        }}
      />
      {mode === 'all' && (
        <Text size="xs" c="dimmed">
          {all}
        </Text>
      )}
      {mode === 'only' && <ParamPicker params={params} label="Only these parameters" placeholder="Choose the parameters" value={block.parameterIds} onChange={(v) => set({ parameterIds: v })} />}
      {mode === 'except' && (
        <ParamPicker
          params={params}
          label="Leave out these parameters"
          description={`${all}, less these – e.g. water levels, given a table of their own`}
          placeholder="Choose the parameters to leave out"
          value={block.excludeParameterIds ?? []}
          onChange={(v) => set({ excludeParameterIds: v.length ? v : undefined })}
        />
      )}
    </Stack>
  );
}

/** A section's settings, and the name to refer to its table or figure in text. */
export function BlockForm({ block, onChange }: { block: ReportBlock; onChange: (b: ReportBlock) => void }) {
  const kind = REF_KIND[block.type];
  return (
    <Stack gap="xs">
      <BlockSitesField block={block} onChange={onChange} />
      <BlockSettings block={block} onChange={onChange} />
      {kind && (
        <TextInput
          size="xs"
          label="Name to refer to it in text (optional)"
          placeholder={kind === 'fig' ? 'e.g. site-plan' : 'e.g. triggers'}
          description={block.ref ? `Write {{${kind}:${block.ref}}} in text for its number, e.g. “see ${kind === 'fig' ? 'Figure' : 'Table'} 2”.` : `Then {{${kind}:name}} in text gives its number, and stays right when sections move.`}
          value={block.ref ?? ''}
          onChange={(e) => onChange({ ...block, ref: refName(e.currentTarget.value) || undefined })}
          maw={360}
        />
      )}
    </Stack>
  );
}

function BlockSettings({ block, onChange }: { block: ReportBlock; onChange: (b: ReportBlock) => void }) {
  const params = useLiveQuery(() => db.parameters.toArray(), []) ?? [];
  const sets = useLiveQuery(() => db.guidelineSets.toArray(), []) ?? [];
  const set = (patch: Partial<ReportBlock>) => onChange({ ...block, ...patch } as ReportBlock);
  switch (block.type) {
    case 'title':
      return (
        <Stack gap="xs">
          <TextInput label="Title" value={block.title} onChange={(e) => set({ title: e.currentTarget.value })} />
          <TextInput label="Subtitle" value={block.subtitle ?? ''} onChange={(e) => set({ subtitle: e.currentTarget.value })} />
          <Group grow>
            <TextInput label="Prepared by" value={block.preparedBy ?? ''} onChange={(e) => set({ preparedBy: e.currentTarget.value })} />
            <TextInput label="Reviewed by" value={block.reviewedBy ?? ''} onChange={(e) => set({ reviewedBy: e.currentTarget.value })} />
          </Group>
          <Group>
            <Switch label="Show project details" checked={block.showDetails} onChange={(e) => set({ showDetails: e.currentTarget.checked })} />
            <Switch label="Title on its own page" checked={block.pageBreakAfter} onChange={(e) => set({ pageBreakAfter: e.currentTarget.checked })} />
          </Group>
        </Stack>
      );
    case 'heading':
      return (
        <Stack gap="xs">
          <TextInput label="Heading text" value={block.text} onChange={(e) => set({ text: e.currentTarget.value })} />
          <SegmentedControl fullWidth value={String(block.level)} onChange={(v) => set({ level: Number(v) as 1 | 2 | 3 })} data={[{ value: '1', label: 'Level 1' }, { value: '2', label: 'Level 2' }, { value: '3', label: 'Level 3' }]} />
          <div>
            <Text size="sm" fw={500}>
              Pages for this section
            </Text>
            <Text size="xs" c="dimmed" mb={4}>
              The section starts on a new page of this orientation; the pages after it turn back.
            </Text>
            <SegmentedControl
              size="xs"
              value={block.pages ?? ''}
              onChange={(v) => set({ pages: (v || undefined) as ReportBlock['pages'] })}
              data={[
                { value: '', label: 'No change' },
                { value: 'portrait', label: 'Portrait' },
                { value: 'landscape', label: 'Landscape' },
              ]}
            />
          </div>
        </Stack>
      );
    case 'text':
      return (
        <Stack gap="xs">
          <Textarea id={`text-${block.id}`} label="Text" autosize minRows={3} maxRows={14} value={block.text} onChange={(e) => set({ text: e.currentTarget.value })} description="Blank line = new paragraph · “- ” = bullet · **bold** · *italic* · {{placeholders}}" />
          <InsertCalc target={`text-${block.id}`} value={block.text} onChange={(text) => set({ text })} />
          <Switch label="Fill in each time a report is generated (this text is the starting point)" checked={!!block.prompt} onChange={(e) => set({ prompt: e.currentTarget.checked })} />
        </Stack>
      );
    case 'exceedances':
      return (
        <Group>
          <Switch label="Include guideline exceedances (not just consent rules)" checked={block.includeGuidelines} onChange={(e) => set({ includeGuidelines: e.currentTarget.checked })} />
          <Switch label="Include follow-up notes" checked={block.includeNotes} onChange={(e) => set({ includeNotes: e.currentTarget.checked })} />
        </Group>
      );
    case 'resultsTable':
      return (
        <Stack gap="xs">
          <TextInput label="Table title" value={block.title ?? ''} onChange={(e) => set({ title: e.currentTarget.value })} />
          <SegmentedControl fullWidth value={block.layout} onChange={(v) => set({ layout: v as typeof block.layout })} data={[{ value: 'parametersAsRows', label: 'Parameters down' }, { value: 'parametersAsColumns', label: 'Samples down' }]} />
          <Group>
            <Switch label="One table per site" checked={block.splitBySite} onChange={(e) => set({ splitBySite: e.currentTarget.checked })} />
            <Switch label="Highlight exceedances" checked={block.highlight} onChange={(e) => set({ highlight: e.currentTarget.checked })} />
          </Group>
          <BlockParamsField block={block} params={params} onChange={onChange} all="All with data" />
          <div>
            <Text size="sm" fw={500}>
              Consent values to compare with
            </Text>
            <Text size="xs" c="dimmed" mb={4}>
              A column for each level in the project's consent rules (e.g. Limit, Trigger 1), beside the guideline columns.
            </Text>
            <SegmentedControl
              size="xs"
              value={block.ruleColumns ?? 'none'}
              onChange={(v) => set({ ruleColumns: v as NonNullable<typeof block.ruleColumns> })}
              data={[
                { value: 'none', label: 'None' },
                { value: 'limits', label: 'Limits' },
                { value: 'all', label: 'Limits & triggers' },
              ]}
            />
          </div>
          <Switch label="Use the project's default guideline sets" checked={block.guidelineSetIds === null} onChange={(e) => set({ guidelineSetIds: e.currentTarget.checked ? null : [] })} />
          {block.guidelineSetIds !== null && <GuidelinePicker sets={sets} value={block.guidelineSetIds} onChange={(v) => set({ guidelineSetIds: v })} label="Guideline columns" />}
        </Stack>
      );
    case 'statsTable':
      return (
        <Stack gap="xs">
          <TextInput label="Table title" value={block.title ?? ''} onChange={(e) => set({ title: e.currentTarget.value })} />
          <Checkbox.Group label="Statistics" value={block.stats} onChange={(v) => set({ stats: v as typeof block.stats })}>
            <Group mt={4}>
              {(['n', 'nd', 'min', 'median', 'mean', 'p95', 'max', 'exceed'] as const).map((s) => (
                <Checkbox key={s} value={s} label={{ n: 'n', nd: 'n < DL', min: 'Min', median: 'Median', mean: 'Mean', p95: '95th %ile', max: 'Max', exceed: 'Exceedances' }[s]} />
              ))}
            </Group>
          </Checkbox.Group>
          <BlockParamsField block={block} params={params} onChange={onChange} all="All with data" />
        </Stack>
      );
    case 'chart':
      return (
        <Stack gap="xs">
          <BlockParamsField block={block} params={params} onChange={onChange} all="The parameters with consent rules" />
          <Group align="flex-end">
            <Select label="Time range" data={[{ value: 'period', label: 'Report period' }, { value: 'years', label: 'Years up to period end' }, { value: 'all', label: 'All data' }]} value={block.range} onChange={(v) => v && set({ range: v as typeof block.range })} w={200} allowDeselect={false} />
            {block.range === 'years' && <NumberInput label="Years" min={1} max={30} value={block.years ?? 3} onChange={(v) => set({ years: Number(v) || 3 })} w={90} />}
          </Group>
          <Group align="flex-end">
            <div>
              <Text size="sm" fw={500} mb={4}>
                Size
              </Text>
              <SegmentedControl
                value={block.size ?? 'full'}
                onChange={(v) => set({ size: v as typeof block.size })}
                data={[
                  { value: 'full', label: 'Full width' },
                  { value: 'half', label: 'Two per row' },
                  { value: 'custom', label: 'Custom' },
                ]}
              />
            </div>
            {(block.size ?? 'full') !== 'custom' ? (
              <Select
                label="Shape"
                w={190}
                allowDeselect={false}
                value={String(block.aspect ?? (block.widthCm ? Math.round((block.heightCm / block.widthCm) * 100) / 100 : 0.5))}
                onChange={(v) => v && set({ aspect: Number(v) })}
                data={[
                  { value: '0.4', label: 'Wide (2.5 : 1)' },
                  { value: '0.5', label: 'Standard (2 : 1)' },
                  { value: '0.67', label: 'Tall (3 : 2)' },
                  ...(block.aspect !== undefined && ![0.4, 0.5, 0.67].includes(block.aspect) ? [{ value: String(block.aspect), label: `Custom (${block.aspect})` }] : []),
                  ...(block.aspect === undefined && block.widthCm && ![0.4, 0.5, 0.67].includes(Math.round((block.heightCm / block.widthCm) * 100) / 100) ? [{ value: String(Math.round((block.heightCm / block.widthCm) * 100) / 100), label: `As set (${block.widthCm} × ${block.heightCm})` }] : []),
                ]}
              />
            ) : (
              <>
                <NumberInput label="Width (cm)" min={6} max={40} value={block.widthCm} onChange={(v) => set({ widthCm: Number(v) || 16 })} w={100} />
                <NumberInput label="Height (cm)" min={4} max={30} value={block.heightCm} onChange={(v) => set({ heightCm: Number(v) || 8 })} w={100} />
              </>
            )}
          </Group>
          <Text size="xs" c="dimmed">
            Full width and two per row fit the page, so graphs grow on landscape pages.
          </Text>
          <Group>
            <Switch label="Guideline lines" checked={block.showGuidelines} onChange={(e) => set({ showGuidelines: e.currentTarget.checked })} />
            <Switch label="Consent limit / trigger lines" checked={block.showRules} onChange={(e) => set({ showRules: e.currentTarget.checked })} />
            <Switch label="Log scale" checked={block.logScale} onChange={(e) => set({ logScale: e.currentTarget.checked })} />
            {block.range !== 'period' && <Switch label="Shade the report period" checked={!!block.markPeriod} onChange={(e) => set({ markPeriod: e.currentTarget.checked })} />}
          </Group>
          <TextInput label="Extra caption text (optional)" value={block.caption ?? ''} onChange={(e) => set({ caption: e.currentTarget.value })} />
        </Stack>
      );
    case 'roundReview':
      return (
        <Stack gap="xs">
          <TextInput label="Table title" value={block.title ?? ''} onChange={(e) => set({ title: e.currentTarget.value })} description="One table per site, for its latest sample in the report period" />
          <Checkbox.Group label="Compare each result with" value={block.compare} onChange={(v) => set({ compare: v as typeof block.compare })}>
            <Group gap="sm" mt={4}>
              <Checkbox value="previous" label="Previous result" />
              <Checkbox value="change" label="Change" />
              <Checkbox value="median" label="Earlier median" />
              <Checkbox value="range" label="Usual range" />
              <Checkbox value="note" label="Unusual / record notes" />
            </Group>
          </Checkbox.Group>
          <div>
            <Text size="sm" fw={500} mb={4}>
              Earlier results to compare with
            </Text>
            <SegmentedControl
              fullWidth
              size="xs"
              value={String(block.historyYears)}
              onChange={(v) => set({ historyYears: Number(v) })}
              data={[
                { value: '0', label: 'All' },
                { value: '5', label: '5 years' },
                { value: '3', label: '3 years' },
                { value: '1', label: '1 year' },
              ]}
            />
          </div>
          <BlockParamsField block={block} params={params} onChange={onChange} all="All measured" />
          <div>
            <Text size="sm" fw={500} mb={4}>
              Consent values to compare with
            </Text>
            <SegmentedControl
              size="xs"
              value={block.ruleColumns ?? 'none'}
              onChange={(v) => set({ ruleColumns: v as NonNullable<typeof block.ruleColumns> })}
              data={[
                { value: 'none', label: 'None' },
                { value: 'limits', label: 'Limits' },
                { value: 'all', label: 'Limits & triggers' },
              ]}
            />
          </div>
          <Switch label="Use the project's default guideline sets" checked={block.guidelineSetIds === null} onChange={(e) => set({ guidelineSetIds: e.currentTarget.checked ? null : [] })} />
          {block.guidelineSetIds !== null && <GuidelinePicker sets={sets} value={block.guidelineSetIds} onChange={(v) => set({ guidelineSetIds: v })} label="Guideline columns" />}
          <Switch label="Highlight exceedances" checked={block.highlight} onChange={(e) => set({ highlight: e.currentTarget.checked })} />
        </Stack>
      );
    case 'roundTable':
      return (
        <Stack gap="xs">
          <TextInput label="Table title (optional)" value={block.title ?? ''} onChange={(e) => set({ title: e.currentTarget.value })} description="One table per site, for its latest sample in the report period" />
          <Group align="flex-end" gap="md">
            <div>
              <Text size="sm" fw={500} mb={4}>
                Earlier rounds beside it
              </Text>
              <SegmentedControl size="xs" value={String(block.previous)} onChange={(v) => set({ previous: Number(v) })} data={['0', '1', '2', '3']} />
            </div>
            <div>
              <Text size="sm" fw={500} mb={4}>
                Each site's table under
              </Text>
              <SegmentedControl
                size="xs"
                value={block.siteLabel ?? 'caption'}
                onChange={(v) => set({ siteLabel: v as 'caption' | 'heading' })}
                data={[
                  { value: 'heading', label: 'A heading' },
                  { value: 'caption', label: 'A numbered caption' },
                ]}
              />
            </div>
          </Group>
          <div>
            <Text size="sm" fw={500} mb={4}>
              Consent values to compare with
            </Text>
            <SegmentedControl
              size="xs"
              value={block.ruleColumns}
              onChange={(v) => set({ ruleColumns: v as typeof block.ruleColumns })}
              data={[
                { value: 'none', label: 'None' },
                { value: 'limits', label: 'Limits' },
                { value: 'all', label: 'Limits & triggers' },
              ]}
            />
          </div>
          <Switch label="A comment on each result: the change since last round and whether it complies (e.g. “Increase – Compliant”)" checked={block.comment} onChange={(e) => set({ comment: e.currentTarget.checked })} />
          <Switch label="A summary under each site's table – drafted from the results, yours to edit in the report's commentary" checked={block.summaries} onChange={(e) => set({ summaries: e.currentTarget.checked })} />
          <BlockParamsField block={block} params={params} onChange={onChange} all="All measured" />
        </Stack>
      );
    case 'triggerTable':
      return (
        <Stack gap="xs">
          <TextInput label="Table title (optional)" value={block.title ?? ''} onChange={(e) => set({ title: e.currentTarget.value })} placeholder="Consent limits and trigger levels" />
          <div>
            <Text size="sm" fw={500} mb={4}>
              Show
            </Text>
            <SegmentedControl
              size="xs"
              value={block.levels}
              onChange={(v) => set({ levels: v as typeof block.levels })}
              data={[
                { value: 'all', label: 'Limits & triggers' },
                { value: 'limits', label: 'Limits' },
                { value: 'triggers', label: 'Triggers' },
              ]}
            />
          </div>
          <Text size="xs" c="dimmed">
            From the project's consent rules (Setup). A rule for some sites only fills in those sites' columns.
          </Text>
        </Stack>
      );
    case 'letter':
      return (
        <Stack gap="xs">
          <TextInput label="Date" value={block.date} onChange={(e) => set({ date: e.currentTarget.value })} description="{{today}} = the day it is made" />
          <Textarea label="To" autosize minRows={2} maxRows={6} value={block.to} onChange={(e) => set({ to: e.currentTarget.value })} description="{{project.recipient}} = who this project's letters go to – set it on the Reports tab, under “Letter”" />
          <TextInput label="Subject (in bold)" value={block.subject} onChange={(e) => set({ subject: e.currentTarget.value })} />
          <Textarea label="Reference" autosize minRows={1} maxRows={3} value={block.reference ?? ''} onChange={(e) => set({ reference: e.currentTarget.value })} />
          <TextInput label="Greeting" value={block.salutation} onChange={(e) => set({ salutation: e.currentTarget.value })} description="{{project.salutation}} = the project's greeting, e.g. Dear David, (Dear Sir / Madam, until set)" />
        </Stack>
      );
    case 'figures':
      return (
        <Stack gap="xs">
          <FiguresLayout block={block} onChange={(b) => onChange(b)} />
          <div>
            <Text size="sm" fw={500}>
              Images in every report
            </Text>
            <Text size="xs" c="dimmed" mb={4}>
              e.g. a site plan. Photos for one report are added on the Reports tab, under “Figures for this report”.
            </Text>
            <FigureImages images={block.images} numbering={block.numbering} onChange={(images) => set({ images })} />
          </div>
        </Stack>
      );
    case 'signatures':
      return <SignaturesForm block={block} onChange={onChange} />;
    case 'spacer':
      return (
        <Stack gap={4}>
          <Text size="sm" fw={500}>
            Height: {block.heightMm} mm
          </Text>
          <Slider min={2} max={120} step={1} value={block.heightMm} onChange={(v) => set({ heightMm: v })} marks={[{ value: 10, label: '1 cm' }, { value: 50, label: '5 cm' }, { value: 100, label: '10 cm' }]} mb="md" />
        </Stack>
      );
    case 'calc':
      return <CalcForm block={block} onChange={(b) => onChange(b)} />;
    case 'programmeTable':
    case 'reportingTable':
      return (
        <Stack gap="xs">
          <TextInput label="Table title (optional)" value={block.title ?? ''} onChange={(e) => set({ title: e.currentTarget.value })} placeholder={block.type === 'programmeTable' ? 'Monitoring programme' : 'Reporting requirements'} />
          <Text size="xs" c="dimmed">
            {block.type === 'programmeTable' ? 'From the project’s sampling schedules (Schedule tab): sites, frequency, parameters and notes.' : 'From the project’s reporting obligations (Schedule tab): frequency, when the next one is due and who it goes to.'}
          </Text>
        </Stack>
      );
    case 'tarpTable':
      return (
        <Stack gap="xs">
          <TextInput label="Table title (optional)" value={block.title ?? ''} onChange={(e) => set({ title: e.currentTarget.value })} placeholder="Trigger levels, limits and responses" />
          <div>
            <Text size="sm" fw={500} mb={4}>
              Show
            </Text>
            <SegmentedControl
              size="xs"
              value={block.levels}
              onChange={(v) => set({ levels: v as typeof block.levels })}
              data={[
                { value: 'all', label: 'Limits & triggers' },
                { value: 'limits', label: 'Limits' },
                { value: 'triggers', label: 'Triggers' },
              ]}
            />
          </div>
          <Text size="xs" c="dimmed">
            From the project’s consent rules (Setup): the response is each rule’s “action if exceeded”.
          </Text>
        </Stack>
      );
    case 'pageBreak':
      return (
        <div>
          <Text size="sm" fw={500} mb={4}>
            Pages from here on
          </Text>
          <SegmentedControl
            value={block.orientation ?? 'same'}
            onChange={(v) => set({ orientation: v === 'same' ? undefined : (v as 'portrait' | 'landscape') })}
            data={[
              { value: 'same', label: 'Keep orientation' },
              { value: 'portrait', label: 'Portrait' },
              { value: 'landscape', label: 'Landscape' },
            ]}
          />
        </div>
      );
    default:
      return (
        <Text size="sm" c="dimmed">
          {BLOCK_LABELS[block.type].help}. No settings.
        </Text>
      );
  }
}

/** A Calculations section: each value's statistic, parameter and sites. */
function CalcForm({ block, onChange }: { block: Extract<ReportBlock, { type: 'calc' }>; onChange: (b: ReportBlock) => void }) {
  const params = useLiveQuery(() => db.parameters.toArray(), []) ?? [];
  const codes = useLiveQuery(async () => [...new Set((await db.sites.toArray()).map((x) => x.code))].sort(), []) ?? [];
  const paramData = [...params].sort((a, b) => a.name.localeCompare(b.name)).map((p) => ({ value: p.id, label: p.name }));
  const rows = block.rows;
  const setRow = (i: number, patch: Partial<(typeof rows)[number]>) => onChange({ ...block, rows: rows.map((r, k) => (k === i ? { ...r, ...patch } : r)) });
  return (
    <Stack gap="xs">
      <TextInput label="Title (optional)" value={block.title ?? ''} onChange={(e) => onChange({ ...block, title: e.currentTarget.value })} placeholder="Calculated values, {{period.label}}" />
      {rows.map((r, i) => (
        <Group key={r.id} gap={6} align="flex-end" wrap="wrap">
          <Select size="xs" label={i === 0 ? 'Value' : undefined} w={170} data={Object.entries(CALC_STATS).map(([value, label]) => ({ value, label }))} value={r.stat} onChange={(v) => v && setRow(i, { stat: v as CalcStat })} allowDeselect={false} />
          <Select size="xs" label={i === 0 ? 'Of' : undefined} w={190} data={paramData} value={r.parameterId || null} onChange={(v) => v && setRow(i, { parameterId: v })} searchable placeholder="Parameter" />
          <TagsInput size="xs" label={i === 0 ? 'At sites (codes)' : undefined} w={170} data={codes} value={r.sites} onChange={(v) => setRow(i, { sites: v })} placeholder={r.sites.length ? '' : 'All sites'} />
          <TextInput size="xs" label={i === 0 ? 'Label (optional)' : undefined} style={{ flex: 1, minWidth: 140 }} value={r.label ?? ''} onChange={(e) => setRow(i, { label: e.currentTarget.value || undefined })} placeholder="Made from the value, parameter and sites" />
          <ActionIcon variant="subtle" color="red" mb={2} onClick={() => onChange({ ...block, rows: rows.filter((_, k) => k !== i) })} aria-label="Remove this value">
            <IconTrash size={14} />
          </ActionIcon>
        </Group>
      ))}
      <Group gap="sm">
        <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={() => onChange({ ...block, rows: [...rows, { id: uid('c'), stat: 'median', parameterId: '', sites: [] }] })}>
          Add a value
        </Button>
        <SegmentedControl
          size="xs"
          value={block.show}
          onChange={(v) => onChange({ ...block, show: v as 'table' | 'list' })}
          data={[
            { value: 'table', label: 'As a table' },
            { value: 'list', label: 'As a list' },
          ]}
        />
      </Group>
      <Text size="xs" c="dimmed">
        Worked out from each report’s period. To put a value in a sentence instead, use “Insert a calculation” in a Text section.
      </Text>
    </Stack>
  );
}
