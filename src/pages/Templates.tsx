import { useEffect, useMemo, useRef, useState } from 'react';
import { ActionIcon, Alert, Badge, Button, Card, ColorInput, FileButton, Grid, Group, Menu, NumberInput, Select, SimpleGrid, Stack, Switch, Text, TextInput, Title, Tooltip, Loader, Code, Image } from '@mantine/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate, useParams } from 'react-router-dom';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { IconCopy, IconDeviceFloppy, IconDots, IconPlus, IconTrash, IconPhoto, IconStar, IconTemplate, IconFileTypeDocx, IconFileTypePdf } from '@tabler/icons-react';
import { db, saveSettings } from '../db/db';
import type { ReportBlock, ReportTemplate } from '../db/types';
import { deleteTemplate, duplicateTemplate, saveTemplate } from '../db/repo';
import { MoreOptions, PageHeader, PeriodPicker, defaultPeriod, type PeriodValue } from '../components/common';
import { PLACEHOLDERS, type ReportDoc } from '../reports/model';
import { uid } from '../lib/ids';
import { ProjectDataProvider, useProject } from '../hooks/useProjectData';
import { useSettings } from '../hooks/useSettings';
import { buildReport, DEFAULT_LOGO_MM } from '../reports/build';
import { PdfPreview } from '../reports/PdfPreview';
import { SectionsEditor } from '../components/report/SectionsEditor';
import { readImageFile } from '../lib/image';
import { roundPeriods } from '../lib/latest';
import { JumpToPreview, usePreviewPane } from '../components/report/JumpToPreview';
import { hasMixedPages, samePages } from '../components/report/sections';
import { newBlock } from '../components/report/blocks';
import { cmToPx, renderChartPng } from '../charts/render';
import { exportReport, type ExportKind } from '../reports/export';

function Preview({ template, fill }: { template: ReportTemplate; fill?: boolean }) {
  const data = useProject();
  const settings = useSettings();
  const rounds = useMemo(() => roundPeriods(data, 12), [data]);
  const [period, setPeriod] = useState<PeriodValue>(() => (template.period === 'latestRound' && rounds[0]) || defaultPeriod(data.project.yearStartMonth, 'lastRy'));
  const [doc, setDoc] = useState<ReportDoc | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setBusy(true);
    const h = setTimeout(() => {
      try {
        setDoc(buildReport({ bundle: data, template, period, settings, renderChart: (o, w, hh) => renderChartPng(o, cmToPx(w), cmToPx(hh), 1.5) }));
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
    <Stack gap="xs" style={fill ? { flex: 1, minHeight: 0 } : undefined}>
      <Group align="flex-end" justify="space-between" wrap="wrap">
        <PeriodPicker value={period} onChange={setPeriod} yearStartMonth={data.project.yearStartMonth} extra={rounds} />
        <Group gap="xs">
          <Button size="xs" leftSection={<IconFileTypeDocx size={16} />} loading={exporting === 'docx'} onClick={() => run('docx')}>
            Download Word
          </Button>
          <Button size="xs" variant="light" leftSection={<IconFileTypePdf size={16} />} loading={exporting === 'pdf'} onClick={() => run('pdf')}>
            Download PDF
          </Button>
        </Group>
      </Group>
      <PdfPreview doc={doc} building={busy} fill={fill} />
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
  const settingsCol = useRef<HTMLDivElement>(null);
  const previewCard = useRef<HTMLDivElement>(null);
  const pane = usePreviewPane(previewCard, 'xl');
  if (stored && (!t || t.id !== stored.id)) setT(structuredClone(stored)); // load once per template
  useEffect(() => {
    if (!previewProject && projects?.length) setPreviewProject([...projects].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0].id);
  }, [projects, previewProject]);
  if (!t) return <Loader />;
  const readOnly = !!t.builtIn;
  const dirty = !!stored && JSON.stringify({ ...stored, updatedAt: '' }) !== JSON.stringify({ ...t, updatedAt: '' });
  const setBlocks = (blocks: ReportBlock[]) => setT({ ...t, blocks });
  const mixed = hasMixedPages(t.blocks, t.orientation);

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
          <Stack gap="md" ref={settingsCol} style={{ scrollMarginTop: 72 }}>
            <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
              <Card padding="md">
                <Title order={5} mb="xs">
                  Page &amp; style
                </Title>
                <Stack gap="xs">
                  <TextInput label="Template name" value={t.name} onChange={(e) => setT({ ...t, name: e.currentTarget.value })} />
                  <TextInput label="Description" value={t.description ?? ''} onChange={(e) => setT({ ...t, description: e.currentTarget.value })} />
                  <SimpleGrid cols={{ base: 2, sm: 4 }}>
                    <Select label="Page" data={['A4', 'A3']} value={t.pageSize} onChange={(v) => v && setT({ ...t, pageSize: v as 'A4' | 'A3' })} allowDeselect={false} />
                    <Select
                      label="Orientation"
                      data={[{ value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }, ...(mixed ? [{ value: 'mixed', label: 'Mixed', disabled: true }] : [])]}
                      value={mixed ? 'mixed' : t.orientation}
                      onChange={(v) => v && v !== 'mixed' && setT({ ...t, orientation: v as 'portrait' | 'landscape', blocks: samePages(t.blocks) })}
                      allowDeselect={false}
                    />
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
                        if (f.size > 10 * 1024 * 1024) {
                          notifications.show({ message: 'Please use an image under 10 MB', color: 'orange' });
                          return;
                        }
                        // large images are scaled down so reports stay small; the size on the page is set below
                        readImageFile(f)
                          .then((logo) => setT({ ...t, logo }))
                          .catch((e: Error) => notifications.show({ message: e.message, color: 'red' }));
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
                    {t.logo && (
                      <NumberInput
                        label="Logo height (mm)"
                        description="Width follows the logo's shape"
                        min={6}
                        max={40}
                        step={1}
                        value={t.logoHeightMm ?? DEFAULT_LOGO_MM}
                        onChange={(v) => setT({ ...t, logoHeightMm: Number(v) || DEFAULT_LOGO_MM })}
                        w={150}
                      />
                    )}
                  </Group>
                </Stack>
              </Card>
            </fieldset>

            <Card padding="md">
              <Title order={5} mb={4}>
                Content
              </Title>
              <Text size="xs" c="dimmed" mb="xs">
                Tap a section to edit it. Drag ⋮⋮ to move it – a heading brings its content – or use the arrows; ⋯ has more.
              </Text>
              <SectionsEditor blocks={t.blocks} onChange={setBlocks} orientation={t.orientation} open={open} onOpen={setOpen} readOnly={readOnly} />
            </Card>
            <Card padding="md">
              <MoreOptions label="Placeholders" summary="{{project.name}}, {{period.label}} … for titles, text, header and footer">
                <Text size="xs" c="dimmed" mb={6}>
                  Use these in titles, headings, text, header and footer. Click one to copy it.
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
              </MoreOptions>
            </Card>
          </Stack>
        </Grid.Col>
        <Grid.Col span={{ base: 12, xl: 7 }}>
          <Card padding="md" bg="var(--mantine-color-gray-1)" ref={previewCard} style={{ scrollMarginTop: 72, ...pane.style }}>
            <Group justify="space-between" mb="xs" wrap="wrap">
              <Text fw={600}>Live preview</Text>
              <Select size="xs" data={(projects ?? []).map((p) => ({ value: p.id, label: p.name }))} value={previewProject} onChange={setPreviewProject} placeholder="Preview with project…" w={300} />
            </Group>
            {previewProject ? (
              <ProjectDataProvider key={previewProject} projectId={previewProject}>
                <Preview template={t} fill={pane.fill} />
              </ProjectDataProvider>
            ) : (
              <Alert>Create a project (or load the demo) to preview templates with real data.</Alert>
            )}
          </Card>
        </Grid.Col>
      </Grid>
      <JumpToPreview preview={previewCard} back={settingsCol} backLabel="Back to the template" from="xl" />
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
                  <Group gap="xs" wrap="nowrap" align="flex-start">
                    <IconTemplate size={18} style={{ flexShrink: 0, marginTop: 3 }} />
                    <Text fw={600}>{t.name}</Text>
                  </Group>
                  <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
                    {settings.defaultTemplateId === t.id && (
                      <Badge color="yellow" leftSection={<IconStar size={10} />}>
                        Default
                      </Badge>
                    )}
                    {t.builtIn ? <Badge variant="outline">Built-in</Badge> : <Badge>Custom</Badge>}
                  </Group>
                </Group>
                <Text size="sm" c="dimmed" style={{ flex: 1 }}>
                  {t.description || `${t.blocks.length} sections`}
                </Text>
                <Text size="xs" c="dimmed">
                  {t.pageSize} {t.orientation} · {t.blocks.length} sections
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
                  <Menu position="bottom-end">
                    <Menu.Target>
                      <ActionIcon variant="subtle" size={30} aria-label={`More actions for ${t.name}`}>
                        <IconDots size={16} />
                      </ActionIcon>
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
