import { Checkbox, Group, NumberInput, SegmentedControl, Select, Stack, Switch, Text, TextInput, Textarea } from '@mantine/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import type { ReportBlock, ReportBlockType } from '../../db/types';
import { GuidelinePicker, ParamPicker } from '../common';
import { uid } from '../../lib/ids';

// Report template blocks ("sections"): labels, defaults, one-line summaries and settings forms.

export const BLOCK_LABELS: Record<ReportBlockType, { label: string; help: string }> = {
  title: { label: 'Title page', help: 'Report title, subtitle and project details' },
  heading: { label: 'Heading', help: 'Section heading (numbered automatically)' },
  text: { label: 'Text', help: 'Your own text with {{placeholders}}; can be filled in per report' },
  summary: { label: 'Automatic summary', help: 'Sentences summarising sampling, compliance and guideline exceedances' },
  complianceTable: { label: 'Compliance table', help: 'Each consent rule with its outcome for the period' },
  exceedances: { label: 'Exceedance table', help: 'Every exceedance in the period, with your follow-up notes' },
  resultsTable: { label: 'Results table', help: 'Results with guideline values and highlighted exceedances' },
  statsTable: { label: 'Statistics table', help: 'n, min, median, mean, 95th percentile, max per site' },
  chart: { label: 'Graphs', help: 'One graph per parameter with guideline / limit lines' },
  siteTable: { label: 'Site table', help: 'Monitoring locations with coordinates' },
  samplingTable: { label: 'Sampling table', help: 'Samples collected per site vs the required programme' },
  roundReview: { label: 'Results vs earlier monitoring', help: "Each site's latest sample in the period beside its previous result, the change, the earlier median and usual range" },
  pageBreak: { label: 'New page', help: 'Start a new page, and optionally switch to portrait or landscape from here' },
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
    case 'roundReview':
      return { id, type, title: 'Results compared with earlier monitoring', siteIds: [], parameterIds: [], compare: ['previous', 'change', 'median', 'range', 'note'], historyYears: 0, guidelineSetIds: null, ruleColumns: 'all', highlight: true };
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
    case 'pageBreak':
      return b.orientation ? `New page – ${b.orientation} from here on` : 'New page';
    default:
      return BLOCK_LABELS[b.type].help;
  }
}

export function BlockForm({ block, onChange }: { block: ReportBlock; onChange: (b: ReportBlock) => void }) {
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
          <Textarea label="Text" autosize minRows={3} maxRows={14} value={block.text} onChange={(e) => set({ text: e.currentTarget.value })} description="Blank line = new paragraph · “- ” = bullet · **bold** · *italic* · {{placeholders}}" />
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
          <ParamPicker params={params} value={block.parameterIds} onChange={(v) => set({ parameterIds: v })} label="Parameters (empty = all with data)" />
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
          <ParamPicker params={params} value={block.parameterIds} onChange={(v) => set({ parameterIds: v })} label="Parameters (empty = all with data)" />
        </Stack>
      );
    case 'chart':
      return (
        <Stack gap="xs">
          <ParamPicker params={params} value={block.parameterIds} onChange={(v) => set({ parameterIds: v })} label="Parameters (empty = parameters with consent rules)" />
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
          <ParamPicker params={params} value={block.parameterIds} onChange={(v) => set({ parameterIds: v })} label="Parameters (empty = all measured)" />
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
