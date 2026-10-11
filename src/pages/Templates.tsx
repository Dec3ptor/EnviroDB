import { useEffect, useState } from 'react';
import {
  ActionIcon, Alert, Badge, Button, Card, Checkbox, ColorInput, FileButton, Grid, Group, Menu, NumberInput, ScrollArea, SegmentedControl, Select, SimpleGrid, Stack, Switch, Text, TextInput, Textarea, Title, Tooltip, Loader, Code, Image,
} from '@mantine/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate, useParams } from 'react-router-dom';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { IconArrowDown, IconArrowUp, IconCopy, IconDeviceFloppy, IconPlus, IconTrash, IconPhoto, IconStar, IconTemplate, IconFileTypeDocx, IconFileTypePdf } from '@tabler/icons-react';
import { db, saveSettings } from '../db/db';
import type { ReportBlock, ReportBlockType, ReportTemplate } from '../db/types';
import { deleteTemplate, duplicateTemplate, saveTemplate } from '../db/repo';
import { GuidelinePicker, PageHeader, ParamPicker, PeriodPicker, defaultPeriod, type PeriodValue } from '../components/common';
import { PLACEHOLDERS, type ReportDoc } from '../reports/model';
import { uid } from '../lib/ids';
import { ProjectDataProvider, useProject } from '../hooks/useProjectData';
import { useSettings } from '../hooks/useSettings';
import { buildReport } from '../reports/build';
import { ReportPreview } from '../reports/html';
import { cmToPx, renderChartPng } from '../charts/render';
import { exportReport, type ExportKind } from '../reports/export';

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
  pageBreak: { label: 'Page break', help: 'Start a new page' },
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
      return { id, type, title: 'Monitoring results', siteIds: [], parameterIds: [], layout: 'parametersAsRows', guidelineSetIds: null, highlight: true, splitBySite: true };
    case 'statsTable':
      return { id, type, title: 'Summary statistics', siteIds: [], parameterIds: [], stats: ['n', 'nd', 'min', 'median', 'max', 'exceed'] };
    case 'chart':
      return { id, type, parameterIds: [], siteIds: [], range: 'years', years: 3, showGuidelines: true, guidelineSetIds: null, showRules: true, logScale: false, widthCm: 16, heightCm: 8, caption: '' };
    default:
      return { id, type } as ReportBlock;
  }
}

function blockSummary(b: ReportBlock): string {
  switch (b.type) {
    case 'title':
      return b.title;
    case 'heading':
      return `H${b.level}: ${b.text}`;
    case 'text':
      return `${b.prompt ? '[filled in per report] ' : ''}${b.text.slice(0, 80)}`;
    case 'resultsTable':
      return `${b.title ?? ''} · ${b.layout === 'parametersAsRows' ? 'parameters down' : 'dates down'}${b.splitBySite ? ' · one table per site' : ''}`;
    case 'chart':
      return `${b.parameterIds.length ? `${b.parameterIds.length} parameters` : 'Key parameters (those with consent rules)'} · ${b.range === 'years' ? `last ${b.years} years` : b.range === 'all' ? 'all data' : 'report period'}`;
    default:
      return BLOCK_LABELS[b.type].help;
  }
}

function BlockForm({ block, onChange }: { block: ReportBlock; onChange: (b: ReportBlock) => void }) {
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
        <Group grow align="flex-end">
          <TextInput label="Heading text" value={block.text} onChange={(e) => set({ text: e.currentTarget.value })} />
          <SegmentedControl value={String(block.level)} onChange={(v) => set({ level: Number(v) as 1 | 2 | 3 })} data={[{ value: '1', label: 'Level 1' }, { value: '2', label: 'Level 2' }, { value: '3', label: 'Level 3' }]} />
        </Group>
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
          <Group>
            <SegmentedControl value={block.layout} onChange={(v) => set({ layout: v as typeof block.layout })} data={[{ value: 'parametersAsRows', label: 'Parameters down, samples across' }, { value: 'parametersAsColumns', label: 'Samples down, parameters across' }]} />
            <Switch label="One table per site" checked={block.splitBySite} onChange={(e) => set({ splitBySite: e.currentTarget.checked })} />
            <Switch label="Highlight exceedances" checked={block.highlight} onChange={(e) => set({ highlight: e.currentTarget.checked })} />
          </Group>
          <ParamPicker params={params} value={block.parameterIds} onChange={(v) => set({ parameterIds: v })} label="Parameters (empty = all with data)" />
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
            <NumberInput label="Width (cm)" min={6} max={40} value={block.widthCm} onChange={(v) => set({ widthCm: Number(v) || 16 })} w={100} />
            <NumberInput label="Height (cm)" min={4} max={30} value={block.heightCm} onChange={(v) => set({ heightCm: Number(v) || 8 })} w={100} />
          </Group>
          <Group>
            <Switch label="Guideline lines" checked={block.showGuidelines} onChange={(e) => set({ showGuidelines: e.currentTarget.checked })} />
            <Switch label="Consent limit / trigger lines" checked={block.showRules} onChange={(e) => set({ showRules: e.currentTarget.checked })} />
            <Switch label="Log scale" checked={block.logScale} onChange={(e) => set({ logScale: e.currentTarget.checked })} />
          </Group>
          <TextInput label="Extra caption text (optional)" value={block.caption ?? ''} onChange={(e) => set({ caption: e.currentTarget.value })} />
        </Stack>
      );
    default:
      return (
        <Text size="sm" c="dimmed">
          {BLOCK_LABELS[block.type].help}. No settings.
        </Text>
      );
  }
}

function Preview({ template }: { template: ReportTemplate }) {
  const data = useProject();
  const settings = useSettings();
  const [period, setPeriod] = useState<PeriodValue>(() => defaultPeriod(data.project.yearStartMonth, 'lastRy'));
  const [doc, setDoc] = useState<ReportDoc | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setBusy(true);
    const h = setTimeout(() => {
      try {
        setDoc(buildReport({ bundle: data, template, period, settings, renderChart: (o, w, hh) => renderChartPng(o, cmToPx(w), cmToPx(hh), 1.25) }));
      } finally {
        setBusy(false);
      }
    }, 450);
    return () => clearTimeout(h);
  }, [data, template, period, settings]);
  const [exporting, setExporting] = useState<ExportKind | null>(null);
  const run = async (kind: ExportKind) => {
    setExporting(kind);
    try {
      await exportReport(kind, { bundle: data, template, period, settings });
    } catch (e) {
      notifications.show({ title: 'Export failed', message: (e as Error).message, color: 'red' });
    } finally {
      setExporting(null);
    }
  };
  return (
    <Stack gap="xs">
      <Group align="flex-end" justify="space-between" wrap="wrap">
        <PeriodPicker value={period} onChange={setPeriod} yearStartMonth={data.project.yearStartMonth} />
        <Group gap="xs">
          <Button size="xs" leftSection={<IconFileTypeDocx size={16} />} loading={exporting === 'docx'} onClick={() => run('docx')}>
            Download Word
          </Button>
          <Button size="xs" variant="light" leftSection={<IconFileTypePdf size={16} />} loading={exporting === 'pdf'} onClick={() => run('pdf')}>
            Download PDF
          </Button>
        </Group>
      </Group>
      <div style={{ opacity: busy ? 0.6 : 1 }}>{doc ? <ReportPreview doc={doc} scale={0.75} /> : <Loader />}</div>
    </Stack>
  );
}

export function TemplateEditorPage() {
  const { templateId } = useParams();
  const navigate = useNavigate();
  const stored = useLiveQuery(() => (templateId ? db.templates.get(templateId) : undefined), [templateId]);
  const projects = useLiveQuery(() => db.projects.toArray(), []);
  const [t, setT] = useState<ReportTemplate | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [previewProject, setPreviewProject] = useState<string | null>(null);
  if (stored && (!t || t.id !== stored.id)) setT(structuredClone(stored)); // load once per template
  useEffect(() => {
    if (!previewProject && projects?.length) setPreviewProject([...projects].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0].id);
  }, [projects, previewProject]);
  if (!t) return <Loader />;
  const readOnly = !!t.builtIn;
  const dirty = !!stored && JSON.stringify({ ...stored, updatedAt: '' }) !== JSON.stringify({ ...t, updatedAt: '' });
  const setBlocks = (blocks: ReportBlock[]) => setT({ ...t, blocks });
  const move = (i: number, d: -1 | 1) => {
    const list = [...t.blocks];
    [list[i], list[i + d]] = [list[i + d], list[i]];
    setBlocks(list);
  };

  return (
    <Stack>
      <PageHeader
        title={t.name}
        description={readOnly ? 'Built-in template – duplicate it to make your own version.' : 'Custom template'}
        badge={readOnly ? <Badge variant="outline">Built-in</Badge> : dirty ? <Badge color="orange">Unsaved changes</Badge> : undefined}
        actions={
          readOnly ? (
            <Button
              leftSection={<IconCopy size={16} />}
              onClick={async () => {
                const c = await duplicateTemplate(t);
                navigate(`/templates/${c.id}`);
              }}
            >
              Duplicate to customise
            </Button>
          ) : (
            <Button leftSection={<IconDeviceFloppy size={16} />} disabled={!dirty} onClick={async () => { await saveTemplate(t); notifications.show({ message: 'Template saved', color: 'teal' }); }}>
              Save template
            </Button>
          )
        }
      />
      <Grid gutter="lg">
        <Grid.Col span={{ base: 12, xl: 5 }}>
          <Stack gap="md">
            <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0 }}>
              <Card padding="md">
                <Title order={5} mb="xs">
                  Page &amp; style
                </Title>
                <Stack gap="xs">
                  <TextInput label="Template name" value={t.name} onChange={(e) => setT({ ...t, name: e.currentTarget.value })} />
                  <TextInput label="Description" value={t.description ?? ''} onChange={(e) => setT({ ...t, description: e.currentTarget.value })} />
                  <SimpleGrid cols={{ base: 2, sm: 4 }}>
                    <Select label="Page" data={['A4', 'A3']} value={t.pageSize} onChange={(v) => v && setT({ ...t, pageSize: v as 'A4' | 'A3' })} allowDeselect={false} />
                    <Select label="Orientation" data={[{ value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }]} value={t.orientation} onChange={(v) => v && setT({ ...t, orientation: v as 'portrait' | 'landscape' })} allowDeselect={false} />
                    <NumberInput label="Margins (mm)" min={8} max={40} value={t.marginMm} onChange={(v) => setT({ ...t, marginMm: Number(v) || 20 })} />
                    <NumberInput label="Font size (pt)" min={7} max={14} step={0.5} value={t.fontSize} onChange={(v) => setT({ ...t, fontSize: Number(v) || 10 })} />
                  </SimpleGrid>
                  <SimpleGrid cols={{ base: 1, sm: 2 }}>
                    <TextInput label="Header text" value={t.headerText ?? ''} onChange={(e) => setT({ ...t, headerText: e.currentTarget.value })} />
                    <TextInput label="Footer text" value={t.footerText ?? ''} onChange={(e) => setT({ ...t, footerText: e.currentTarget.value })} description="Page numbers are added automatically" />
                  </SimpleGrid>
                  <Group align="flex-end">
                    <ColorInput label="Accent colour" value={t.accent} onChange={(v) => setT({ ...t, accent: v })} w={160} swatches={['#0f766e', '#1d4ed8', '#b91c1c', '#7c3aed', '#334155', '#047857', '#c2410c']} />
                    <Switch label="Number headings, tables and figures" checked={t.numbering !== false} onChange={(e) => setT({ ...t, numbering: e.currentTarget.checked })} mb={8} />
                  </Group>
                  <Group align="center">
                    {t.logo && <Image src={t.logo} h={36} w="auto" fit="contain" alt="Logo" />}
                    <FileButton
                      accept="image/png,image/jpeg"
                      onChange={(f) => {
                        if (!f) return;
                        if (f.size > 1.5 * 1024 * 1024) {
                          notifications.show({ message: 'Please use an image under 1.5 MB', color: 'orange' });
                          return;
                        }
                        const r = new FileReader();
                        r.onload = () => setT({ ...t, logo: String(r.result) });
                        r.readAsDataURL(f);
                      }}
                    >
                      {(p) => (
                        <Button variant="default" size="xs" leftSection={<IconPhoto size={14} />} {...p} disabled={readOnly}>
                          {t.logo ? 'Change logo' : 'Add logo (PNG/JPG)'}
                        </Button>
                      )}
                    </FileButton>
                    {t.logo && (
                      <Button variant="subtle" size="xs" color="red" onClick={() => setT({ ...t, logo: undefined })} disabled={readOnly}>
                        Remove logo
                      </Button>
                    )}
                  </Group>
                </Stack>
              </Card>
            </fieldset>

            <Card padding="md">
              <Group justify="space-between" mb="xs">
                <Title order={5}>Content</Title>
                {!readOnly && (
                  <Menu position="bottom-end" width={320}>
                    <Menu.Target>
                      <Button size="xs" leftSection={<IconPlus size={14} />}>
                        Add block
                      </Button>
                    </Menu.Target>
                    <Menu.Dropdown>
                      {(Object.keys(BLOCK_LABELS) as ReportBlockType[]).map((k) => (
                        <Menu.Item
                          key={k}
                          onClick={() => {
                            const b = newBlock(k);
                            const idx = open ? t.blocks.findIndex((x) => x.id === open) : -1;
                            const list = [...t.blocks];
                            list.splice(idx >= 0 ? idx + 1 : list.length, 0, b);
                            setBlocks(list);
                            setOpen(b.id);
                          }}
                        >
                          <Text size="sm" fw={500}>
                            {BLOCK_LABELS[k].label}
                          </Text>
                          <Text size="xs" c="dimmed">
                            {BLOCK_LABELS[k].help}
                          </Text>
                        </Menu.Item>
                      ))}
                    </Menu.Dropdown>
                  </Menu>
                )}
              </Group>
              <Stack gap={6}>
                {t.blocks.map((b, i) => (
                  <Card key={b.id} padding="xs" withBorder style={{ borderColor: open === b.id ? 'var(--mantine-color-teal-5)' : undefined }}>
                    <Group justify="space-between" wrap="nowrap" gap="xs">
                      <div style={{ minWidth: 0, flex: 1, cursor: 'pointer' }} onClick={() => setOpen(open === b.id ? null : b.id)}>
                        <Text size="sm" fw={600}>
                          {BLOCK_LABELS[b.type].label}
                        </Text>
                        <Text size="xs" c="dimmed" truncate>
                          {blockSummary(b)}
                        </Text>
                      </div>
                      {!readOnly && (
                        <Group gap={2} wrap="nowrap">
                          <ActionIcon size="sm" variant="subtle" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                            <IconArrowUp size={14} />
                          </ActionIcon>
                          <ActionIcon size="sm" variant="subtle" disabled={i === t.blocks.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
                            <IconArrowDown size={14} />
                          </ActionIcon>
                          <ActionIcon size="sm" variant="subtle" color="red" onClick={() => setBlocks(t.blocks.filter((x) => x.id !== b.id))} aria-label="Remove block">
                            <IconTrash size={14} />
                          </ActionIcon>
                        </Group>
                      )}
                    </Group>
                    {open === b.id && (
                      <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: '8px 0 0' }}>
                        <BlockForm block={b} onChange={(nb) => setBlocks(t.blocks.map((x) => (x.id === b.id ? nb : x)))} />
                      </fieldset>
                    )}
                  </Card>
                ))}
              </Stack>
            </Card>
            <Card padding="md">
              <Title order={6} mb={4}>
                Placeholders
              </Title>
              <Text size="xs" c="dimmed" mb={6}>
                Use these in titles, headings, text, header and footer.
              </Text>
              <SimpleGrid cols={2} spacing={4}>
                {PLACEHOLDERS.map(([k, d]) => (
                  <Tooltip key={k} label={`${d} – click to copy`}>
                    <Code style={{ cursor: 'pointer' }} onClick={() => navigator.clipboard?.writeText(`{{${k}}}`)}>
                      {`{{${k}}}`}
                    </Code>
                  </Tooltip>
                ))}
              </SimpleGrid>
            </Card>
          </Stack>
        </Grid.Col>
        <Grid.Col span={{ base: 12, xl: 7 }}>
          <Card padding="md" bg="var(--mantine-color-gray-1)">
            <Group justify="space-between" mb="xs" wrap="wrap">
              <Text fw={600}>Live preview</Text>
              <Select size="xs" data={(projects ?? []).map((p) => ({ value: p.id, label: p.name }))} value={previewProject} onChange={setPreviewProject} placeholder="Preview with project…" w={300} />
            </Group>
            {previewProject ? (
              <ScrollArea h="calc(100vh - 240px)" type="auto">
                <ProjectDataProvider key={previewProject} projectId={previewProject}>
                  <Preview template={t} />
                </ProjectDataProvider>
              </ScrollArea>
            ) : (
              <Alert>Create a project (or load the demo) to preview templates with real data.</Alert>
            )}
          </Card>
        </Grid.Col>
      </Grid>
    </Stack>
  );
}

export function TemplatesPage() {
  const templates = useLiveQuery(() => db.templates.toArray(), []);
  const settings = useSettings();
  const navigate = useNavigate();
  return (
    <Stack>
      <PageHeader
        title="Report templates"
        description="Templates define the content and layout of your reports. Built-in templates can be duplicated and customised."
        actions={
          <Button
            leftSection={<IconPlus size={16} />}
            onClick={async () => {
              const t: ReportTemplate = {
                id: uid('tpl'),
                name: 'New template',
                orientation: 'portrait',
                pageSize: 'A4',
                marginMm: 20,
                fontSize: 10,
                accent: '#0f766e',
                headerText: '{{project.name}}',
                footerText: '{{company}}',
                numbering: true,
                blocks: [newBlock('title'), newBlock('summary')],
                updatedAt: new Date().toISOString(),
              };
              await saveTemplate(t);
              navigate(`/templates/${t.id}`);
            }}
          >
            New template
          </Button>
        }
      />
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
        {(templates ?? [])
          .sort((a, b) => Number(!!a.builtIn) - Number(!!b.builtIn) || a.name.localeCompare(b.name))
          .map((t) => (
            <Card key={t.id}>
              <Stack gap={6} h="100%">
                <Group justify="space-between" wrap="nowrap" align="flex-start">
                  <Group gap="xs" wrap="nowrap">
                    <IconTemplate size={18} />
                    <Text fw={600}>{t.name}</Text>
                  </Group>
                  <Group gap={4}>
                    {settings.defaultTemplateId === t.id && (
                      <Badge color="yellow" leftSection={<IconStar size={10} />}>
                        Default
                      </Badge>
                    )}
                    {t.builtIn ? <Badge variant="outline">Built-in</Badge> : <Badge>Custom</Badge>}
                  </Group>
                </Group>
                <Text size="sm" c="dimmed" style={{ flex: 1 }}>
                  {t.description || `${t.blocks.length} blocks`}
                </Text>
                <Text size="xs" c="dimmed">
                  {t.pageSize} {t.orientation} · {t.blocks.length} blocks
                </Text>
                <Group gap="xs" mt="xs">
                  <Button size="xs" onClick={() => navigate(`/templates/${t.id}`)}>
                    {t.builtIn ? 'View' : 'Edit'}
                  </Button>
                  <Button
                    size="xs"
                    variant="default"
                    leftSection={<IconCopy size={14} />}
                    onClick={async () => {
                      const c = await duplicateTemplate(t);
                      navigate(`/templates/${c.id}`);
                    }}
                  >
                    Duplicate
                  </Button>
                  <Menu>
                    <Menu.Target>
                      <Button size="xs" variant="subtle">
                        More
                      </Button>
                    </Menu.Target>
                    <Menu.Dropdown>
                      <Menu.Item leftSection={<IconStar size={14} />} onClick={() => saveSettings({ defaultTemplateId: t.id })}>
                        Make default
                      </Menu.Item>
                      {!t.builtIn && (
                        <Menu.Item color="red" leftSection={<IconTrash size={14} />} onClick={() => modals.openConfirmModal({ title: `Delete “${t.name}”?`, labels: { confirm: 'Delete', cancel: 'Cancel' }, confirmProps: { color: 'red' }, onConfirm: () => deleteTemplate(t.id) })}>
                          Delete
                        </Menu.Item>
                      )}
                    </Menu.Dropdown>
                  </Menu>
                </Group>
              </Stack>
            </Card>
          ))}
      </SimpleGrid>
    </Stack>
  );
}
