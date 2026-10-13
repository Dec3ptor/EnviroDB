import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Anchor, Badge, Button, Card, Grid, Group, Loader, Modal, Select, Stack, Tabs, Text, TextInput, Textarea, Title } from '@mantine/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useSearchParams } from 'react-router-dom';
import { notifications } from '@mantine/notifications';
import { IconCheck, IconDeviceFloppy, IconFileTypeDocx, IconFileTypePdf, IconLayoutList, IconSettings, IconTemplate } from '@tabler/icons-react';
import { db, saveReportWork } from '../../db/db';
import { useProject } from '../../hooks/useProjectData';
import { useSharedWork } from '../../hooks/useSharedWork';
import { same as sameValue } from '../../sync/model';
import { useSettings } from '../../hooks/useSettings';
import { MoreOptions, PeriodPicker, defaultPeriod, type PeriodValue } from '../../components/common';
import { nextDueReport, obligationPeriod, obligationPresets } from '../../lib/schedule';
import { roundPeriods } from '../../lib/latest';
import { formatDate, todayStr } from '../../lib/dates';
import { uid } from '../../lib/ids';
import { buildReport } from '../../reports/build';
import { PdfPreview } from '../../reports/PdfPreview';
import type { ReportDoc } from '../../reports/model';
import { cmToPx, renderChartPng } from '../../charts/render';
import { exportReport } from '../../reports/export';
import { saveTemplate, setSubmitted } from '../../db/repo';
import type { FigureImage, FiguresBlock, LetterBlock, Project, ReportTemplate, TextBlock } from '../../db/types';
import { FigureImages, FiguresLayout } from '../../components/report/Figures';
import { SectionsEditor } from '../../components/report/SectionsEditor';
import { PagesControl } from '../../components/report/PagesControl';
import { JumpToPreview, usePreviewPane } from '../../components/report/JumpToPreview';
import { ReportSites } from '../../components/report/ReportSites';

/** No images added yet (one object, so the preview isn't rebuilt for nothing). */
const NO_FIGURES: Record<string, FigureImage[]> = {};

const same = (a: ReportTemplate, b: ReportTemplate) => JSON.stringify({ ...a, updatedAt: '' }) === JSON.stringify({ ...b, updatedAt: '' });

function SaveAsModal({ opened, onClose, initialName, onSave }: { opened: boolean; onClose: () => void; initialName: string; onSave: (name: string) => Promise<void> }) {
  const [name, setName] = useState(initialName);
  useEffect(() => setName(initialName), [initialName, opened]);
  return (
    <Modal opened={opened} onClose={onClose} title="Save as a new template">
      <Stack gap="sm">
        <TextInput label="Template name" value={name} onChange={(e) => setName(e.currentTarget.value)} data-autofocus onKeyDown={(e) => e.key === 'Enter' && name.trim() && void onSave(name.trim())} />
        <Text size="xs" c="dimmed">
          The new template appears in the template list for every project, and can be changed further on the Report templates page.
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button leftSection={<IconDeviceFloppy size={16} />} disabled={!name.trim()} onClick={() => void onSave(name.trim())}>
            Save template
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/** Who the project's letters go to and how they open – saved with the project – and this letter's subject. */
function LetterCard({ project, block, onBlock }: { project: Project; block: LetterBlock; onBlock: (b: LetterBlock) => void }) {
  const [to, setTo] = useState(project.recipient ?? '');
  const [hi, setHi] = useState(project.salutation ?? '');
  // each box takes the saved value when that value changes – saving one never clears what is being typed in the other
  useEffect(() => setTo(project.recipient ?? ''), [project.id, project.recipient]);
  useEffect(() => setHi(project.salutation ?? ''), [project.id, project.salutation]);
  const save = (patch: Partial<Project>) => void db.projects.update(project.id, { ...patch, updatedAt: new Date().toISOString() });
  return (
    <Card padding="md">
      <Title order={5} mb={4}>
        Letter
      </Title>
      <Text size="xs" c="dimmed" mb="sm">
        Who this project’s letters go to is saved with the project, for all its letters.
      </Text>
      <Stack gap="sm">
        <Textarea label="To" placeholder={'Name\nPosition\nOrganisation\nAddress'} autosize minRows={3} maxRows={7} value={to} onChange={(e) => setTo(e.currentTarget.value)} onBlur={() => to !== (project.recipient ?? '') && save({ recipient: to.trim() || undefined })} />
        <TextInput label="Greeting" placeholder="Dear Sir / Madam," value={hi} onChange={(e) => setHi(e.currentTarget.value)} onBlur={() => hi !== (project.salutation ?? '') && save({ salutation: hi.trim() || undefined })} />
        <TextInput label="Subject" description="For this template – {{period.month}} and the like are filled in" value={block.subject} onChange={(e) => onBlock({ ...block, subject: e.currentTarget.value })} />
      </Stack>
    </Card>
  );
}

export function ReportsTab() {
  const data = useProject();
  const { project, obligations } = data;
  const settings = useSettings();
  const templates = useLiveQuery(() => db.templates.toArray(), []);
  const [params] = useSearchParams();

  const oblPresets = useMemo(() => obligationPresets(obligations), [obligations]);
  const rounds = useMemo(() => roundPeriods(data, 12), [data]); // "Monitoring round – September 2026", newest first

  const [initial] = useState(() => {
    const oId = params.get('obligation');
    const idx = params.get('period');
    const ob = oId ? obligations.find((o) => o.id === oId) : undefined;
    if (ob && idx !== null) {
      const p = obligationPeriod(ob, Number(idx));
      return { period: { key: `obl:${ob.id}:${p.index}`, start: p.periodStart, end: p.periodEnd, label: `${ob.name}: ${formatDate(p.periodStart)} – ${formatDate(p.periodEnd)}` }, templateId: ob.templateId };
    }
    const s = params.get('start'), e = params.get('end');
    if (s && e) return { period: { key: 'custom', start: s, end: e, label: `${formatDate(s)} – ${formatDate(e)}` }, templateId: params.get('template') ?? undefined };
    // default: the report that is due next (unsubmitted and whose period has ended)
    const next = nextDueReport(obligations);
    if (next) {
      const { obligation: o, period: p } = next;
      return { period: { key: `obl:${o.id}:${p.index}`, start: p.periodStart, end: p.periodEnd, label: `${o.name}: ${formatDate(p.periodStart)} – ${formatDate(p.periodEnd)}` }, templateId: o.templateId ?? params.get('template') ?? undefined };
    }
    return { period: defaultPeriod(project.yearStartMonth, 'lastRy'), templateId: params.get('template') ?? undefined };
  });

  const [period, setPeriod] = useState<PeriodValue>(initial.period);
  const [templateId, setTemplateId] = useState<string | null>(initial.templateId ?? settings.defaultTemplateId ?? 'tpl-annual');
  const stored = templates?.find((t) => t.id === templateId) ?? templates?.find((t) => t.id === 'tpl-annual');

  // A template for one monitoring round starts on the latest round, unless the period is already a round or
  // belongs to a reporting obligation that uses this template.
  const seenTemplate = useRef<string | null>(null);
  useEffect(() => {
    if (!stored || seenTemplate.current === stored.id) return;
    seenTemplate.current = stored.id;
    if (stored.period !== 'latestRound' || !rounds.length || period.key.startsWith('round:')) return;
    const ob = period.key.startsWith('obl:') ? obligations.find((o) => o.id === period.key.split(':')[1]) : undefined;
    if (ob?.templateId === stored.id) return;
    setPeriod(rounds[0]);
  }, [stored, rounds, period.key, obligations]);

  // Layout changes made here are kept (per project and template) until saved as a template or discarded – setting
  // by setting, so two people adjusting the same report's layout keep each other's changes.
  const editKey = stored ? `layout:${project.id}:${stored.id}` : '';
  const layout = useSharedWork<unknown>(editKey);
  const working = useMemo(() => (stored && Object.keys(layout.value).length ? ({ ...stored, ...layout.value, id: stored.id } as ReportTemplate) : null), [stored, layout.value]);
  const template = working ?? stored;
  const edited = !!(working && stored && !same(working, stored));
  const changeTemplate = (t: ReportTemplate) => {
    if (!stored) return;
    const s = stored as unknown as Record<string, unknown>;
    // the settings that differ from the template (updatedAt aside)
    layout.setAll(Object.fromEntries(Object.entries(t).filter(([k, v]) => k !== 'id' && k !== 'updatedAt' && !sameValue(v, s[k]))));
  };
  const discard = () => layout.clear();
  const [saveAs, setSaveAs] = useState(false);
  const saveAsNew = async (name: string) => {
    if (!template) return;
    const copy: ReportTemplate = { ...structuredClone(template), id: uid('tpl'), name, builtIn: false, updatedAt: new Date().toISOString() };
    await saveTemplate(copy);
    discard();
    setTemplateId(copy.id);
    setSaveAs(false);
    notifications.show({ color: 'teal', title: 'Template saved', message: `“${name}” is now in your template list.` });
  };
  const saveOver = async () => {
    if (!working || !stored || stored.builtIn) return;
    await saveTemplate({ ...working, id: stored.id, builtIn: false }, stored);
    discard();
    notifications.show({ color: 'teal', message: `“${stored.name}” updated` });
  };

  // The sites the report covers (e.g. a groundwater report without the discharge): remembered for the reporting
  // obligation when the period is one of its periods, otherwise for the template.
  const oblId = period.key.startsWith('obl:') ? period.key.split(':')[1] : null;
  const sitesKey = stored ? `sites:${project.id}:${oblId ?? stored.id}` : '';
  const siteSel = useLiveQuery(async () => (sitesKey ? ((await db.meta.get(sitesKey))?.value as string[] | undefined) ?? null : null), [sitesKey]);
  const chosenSites = useMemo(() => {
    const ids = (siteSel ?? []).filter((id) => data.siteMap.has(id));
    return ids.length && ids.length < data.sites.length ? ids : null; // null = every site
  }, [siteSel, data.siteMap, data.sites.length]);
  const chooseSites = (ids: string[]) => {
    if (!sitesKey) return;
    const all = !ids.length || ids.length >= data.sites.length;
    void saveReportWork(sitesKey, all ? undefined : ids);
  };

  const [tab, setTab] = useState<string | null>('report');
  const settingsCard = useRef<HTMLDivElement>(null);
  const previewCard = useRef<HTMLDivElement>(null);
  const pane = usePreviewPane(previewCard, 'lg');
  const [open, setOpen] = useState<string | null>(null);

  const draftKey = template ? `draft:${project.id}:${template.id}:${period.start}:${period.end}` : '';
  // the commentary, section by section: colleagues' sections appear as they write them
  const drafts = useSharedWork<string>(draftKey);
  const prompts = drafts.value;
  const promptBlocks = (template?.blocks.filter((b) => b.type === 'text' && b.prompt) ?? []) as TextBlock[];

  // Images added to this report's Figures sections, saved with the project and period like the commentary
  const figKey = template ? `figs:${project.id}:${template.id}:${period.start}:${period.end}` : '';
  const figWork = useSharedWork<FigureImage[]>(figKey);
  const reportFigures = figWork.loading ? NO_FIGURES : figWork.value;
  const saveFigures = (blockId: string, images: FigureImage[]) => figWork.setPart(blockId, images.length ? images : undefined);

  // Build the report for the preview (debounced; graphs at a lower resolution than the export)
  const [doc, setDoc] = useState<ReportDoc | null>(null);
  const [building, setBuilding] = useState(false);
  useEffect(() => {
    if (!template) return;
    setBuilding(true);
    const h = setTimeout(() => {
      try {
        setDoc(buildReport({ bundle: data, template, period, settings, promptTexts: prompts, figures: reportFigures, preview: true, siteIds: chosenSites ?? undefined, renderChart: (opt, w, hh) => renderChartPng(opt, cmToPx(w), cmToPx(hh), 1.5) }));
      } finally {
        setBuilding(false);
      }
    }, 600);
    return () => clearTimeout(h);
  }, [data, template, period, settings, prompts, chosenSites, reportFigures]);

  const [busy, setBusy] = useState<'pdf' | 'docx' | null>(null);
  const exportDoc = async (kind: 'pdf' | 'docx') => {
    if (!template) return;
    setBusy(kind);
    try {
      await exportReport(kind, { bundle: data, template, period, settings, promptTexts: prompts, figures: reportFigures, siteIds: chosenSites ?? undefined });
    } catch (e) {
      notifications.show({ title: 'Export failed', message: (e as Error).message, color: 'red' });
    } finally {
      setBusy(null);
    }
  };

  const obl = period.key.startsWith('obl:') ? oblPresets.find((p) => p.key === period.key) : undefined;
  const obligation = obl ? obligations.find((o) => o.id === obl.obligationId) : undefined;
  const submitted = obligation?.submissions.find((s) => s.periodEnd === period.end);

  const savePrompt = (id: string, text: string | undefined) => drafts.setPart(id, text);

  if (!templates || !template || !stored)
    return (
      <Group justify="center" p="xl">
        <Loader />
      </Group>
    );

  const orientationControl = <PagesControl orientation={template.orientation} blocks={template.blocks} onChange={(orientation, blocks) => changeTemplate({ ...template, orientation, blocks })} />;

  // the heading a section comes under
  const headingOf = (id: string) => {
    const idx = template.blocks.findIndex((x) => x.id === id);
    return ([...template.blocks.slice(0, idx)].reverse().find((x) => x.type === 'heading') as { text: string } | undefined)?.text;
  };
  const letterBlock = template.blocks.find((b): b is LetterBlock => b.type === 'letter');
  const figureBlocks = template.blocks.filter((b): b is FiguresBlock => b.type === 'figures');
  // the text sections filled in per report, and the summaries drafted for each site, in the report's order
  const commentaryBoxes = template.blocks.flatMap((b): Array<{ key: string; label: string; group?: string; text: string; auto: boolean }> => {
    if (b.type === 'text' && b.prompt) {
      // named by its own bold label ("**Attachments:**"), else the heading it is under
      const own = b.text.match(/^\s*\*\*([^*]{2,40}?):?\*\*/)?.[1];
      return [{ key: b.id, label: own ?? headingOf(b.id) ?? (b === promptBlocks[0] ? 'Opening' : 'Text'), text: b.text, auto: false }];
    }
    if (b.type === 'roundTable' && b.summaries) return (doc?.commentary ?? []).filter((c) => c.key.startsWith(`${b.id}:`)).map((c) => ({ key: c.key, label: c.label, group: c.group, text: c.auto, auto: true }));
    return [];
  });

  const editedBanner = edited && (
    <Alert color="orange" variant="light" p="sm" title="Layout changed for this report">
      <Text size="xs" mb={8}>
        Your changes are kept for this project until you save or discard them. Save them as a template to reuse them.
      </Text>
      <Group gap={6}>
        <Button size="xs" leftSection={<IconDeviceFloppy size={14} />} onClick={() => setSaveAs(true)}>
          Save as new template
        </Button>
        {!stored.builtIn && (
          <Button size="xs" variant="default" onClick={() => void saveOver()}>
            Update “{stored.name}”
          </Button>
        )}
        <Button size="xs" variant="subtle" color="gray" onClick={discard}>
          Discard changes
        </Button>
      </Group>
    </Alert>
  );

  return (
    <Grid gutter="lg">
      <Grid.Col span={{ base: 12, lg: 4 }}>
        <Stack gap="md">
          <Card padding="md" ref={settingsCard} style={{ scrollMarginTop: 72 }}>
            <Tabs value={tab} onChange={setTab}>
              <Tabs.List grow mb="sm">
                <Tabs.Tab value="report" leftSection={<IconSettings size={15} />}>
                  Report
                </Tabs.Tab>
                <Tabs.Tab
                  value="layout"
                  leftSection={<IconLayoutList size={15} />}
                  rightSection={
                    edited ? (
                      <Badge size="xs" color="orange" variant="filled">
                        edited
                      </Badge>
                    ) : undefined
                  }
                >
                  Edit layout
                </Tabs.Tab>
              </Tabs.List>

              <Tabs.Panel value="report">
                <Stack gap="sm">
                  <Select
                    label="Template"
                    data={templates.map((t) => ({ value: t.id, label: t.builtIn ? t.name : `${t.name} (custom)` }))}
                    value={stored.id}
                    onChange={setTemplateId}
                    allowDeselect={false}
                    title={stored.description}
                    comboboxProps={{ width: 'max-content' }}
                    renderOption={({ option }) => (
                      <div style={{ maxWidth: 380 }}>
                        <Text size="sm">{option.label}</Text>
                        <Text size="xs" c="dimmed">
                          {templates.find((t) => t.id === option.value)?.description}
                        </Text>
                      </div>
                    )}
                  />
                  <PeriodPicker value={period} onChange={setPeriod} yearStartMonth={project.yearStartMonth} extra={[...oblPresets, ...rounds]} width="100%" />
                  <ReportSites sites={data.sites} chosen={chosenSites} onChange={chooseSites} rememberedFor={obligation ? `“${obligation.name}”` : 'this template'} />
                  {template.letterhead && !settings.letterhead && (
                    <Alert color="blue" variant="light" p="xs">
                      <Text size="xs">
                        This letter prints on your letterhead – add it in{' '}
                        <Anchor component={Link} to="/settings" size="xs">
                          Settings
                        </Anchor>{' '}
                        by uploading your company’s Word letter template.
                      </Text>
                    </Alert>
                  )}
                  {editedBanner}
                  <Stack gap={6}>
                    <Button fullWidth leftSection={<IconFileTypeDocx size={18} />} loading={busy === 'docx'} onClick={() => exportDoc('docx')}>
                      Download Word (.docx)
                    </Button>
                    <Button fullWidth variant="light" leftSection={<IconFileTypePdf size={18} />} loading={busy === 'pdf'} onClick={() => exportDoc('pdf')}>
                      Download PDF
                    </Button>
                  </Stack>
                  {obligation && (
                    <Group justify="space-between">
                      {submitted ? (
                        <Badge color="green" leftSection={<IconCheck size={12} />}>
                          Submitted {formatDate(submitted.submittedOn)}
                        </Badge>
                      ) : (
                        <Text size="xs" c="dimmed">
                          Due {formatDate(obligationPeriod(obligation, obl!.index).dueDate)}
                        </Text>
                      )}
                      {!submitted && (
                        <Button
                          size="compact-sm"
                          variant="subtle"
                          leftSection={<IconCheck size={14} />}
                          onClick={() => setSubmitted(obligation.id, { periodStart: period.start, periodEnd: period.end }, todayStr())}
                        >
                          Mark submitted
                        </Button>
                      )}
                    </Group>
                  )}
                </Stack>
              </Tabs.Panel>

              <Tabs.Panel value="layout">
                <Stack gap="sm">
                  {orientationControl}
                  {editedBanner}
                  <Text size="xs" c="dimmed">
                    Tap a section to change it. Drag ⋮⋮ to move it – a heading brings its content – or use the arrows; ⋯ has more.
                  </Text>
                  <SectionsEditor blocks={template.blocks} onChange={(blocks) => changeTemplate({ ...template, blocks })} orientation={template.orientation} open={open} onOpen={setOpen} />
                  <Anchor component={Link} to={`/templates/${stored.id}`} size="xs">
                    <Group gap={4}>
                      <IconTemplate size={13} />
                      Margins, fonts, colours and logo are on the Report templates page
                    </Group>
                  </Anchor>
                </Stack>
              </Tabs.Panel>
            </Tabs>
          </Card>
          {letterBlock && <LetterCard project={project} block={letterBlock} onBlock={(lb) => changeTemplate({ ...template, blocks: template.blocks.map((x) => (x.id === lb.id ? lb : x)) })} />}
          {commentaryBoxes.length > 0 && (
            <Card padding="md">
              <Title order={5} mb={4}>
                Commentary for this report
              </Title>
              <Text size="xs" c="dimmed" mb="sm">
                Saved automatically with this project and period. Use **bold**, *italic*, “- ” for bullets and “&gt; ” for a quotation.
              </Text>
              <Stack gap="sm">
                {commentaryBoxes.map((c) => (
                  <div key={c.key}>
                    <Textarea
                      label={c.label}
                      description={c.group}
                      autosize
                      minRows={c.auto ? 2 : 4}
                      maxRows={14}
                      value={prompts[c.key] ?? c.text}
                      onChange={(e) => savePrompt(c.key, e.currentTarget.value)}
                    />
                    {c.auto && prompts[c.key] !== undefined && prompts[c.key] !== c.text && (
                      <Anchor component="button" type="button" size="xs" onClick={() => savePrompt(c.key, undefined)}>
                        Back to the summary drafted from the results
                      </Anchor>
                    )}
                  </div>
                ))}
              </Stack>
            </Card>
          )}
          {figureBlocks.map((fb) => (
            <Card padding="md" key={fb.id}>
              <Title order={5} mb={4}>
                Figures for this report{figureBlocks.length > 1 ? ` – ${headingOf(fb.id) ?? 'Figures'}` : ''}
              </Title>
              <Text size="xs" c="dimmed" mb="sm">
                Photos, plans and graphs for this report – saved with this project and period.{fb.images.length ? ` ${fb.images.length} more from the template ${fb.images.length === 1 ? 'is' : 'are'} in every report.` : ''}
              </Text>
              <Stack gap="sm">
                <FigureImages images={reportFigures[fb.id] ?? []} numbering={fb.numbering} onChange={(images) => saveFigures(fb.id, images)} />
                <MoreOptions label="Layout" summary={`${fb.perRow} per row · ${fb.numbering === 'group' ? 'one number, (a) (b) …' : fb.numbering === 'each' ? `${fb.label || 'Figure'} numbers` : 'no numbers'}`} defaultOpen={(reportFigures[fb.id]?.length ?? 0) > 1}>
                  <FiguresLayout block={fb} onChange={(nb) => changeTemplate({ ...template, blocks: template.blocks.map((x) => (x.id === nb.id ? nb : x)) })} />
                  <Text size="xs" c="dimmed" mt={6}>
                    The layout is kept for this project and template, like other layout changes.
                  </Text>
                </MoreOptions>
              </Stack>
            </Card>
          ))}
          {!data.samples.length && (
            <Alert color="orange" variant="light">
              This project has no data yet – the report will be mostly empty.
            </Alert>
          )}
        </Stack>
      </Grid.Col>
      <Grid.Col span={{ base: 12, lg: 8 }}>
        <Card padding="sm" bg="var(--mantine-color-gray-1)" ref={previewCard} style={{ scrollMarginTop: 72, ...pane.style }}>
          <PdfPreview doc={doc} building={building} fill={pane.fill} />
        </Card>
      </Grid.Col>
      <JumpToPreview preview={previewCard} back={settingsCard} />
      <SaveAsModal opened={saveAs} onClose={() => setSaveAs(false)} initialName={`${stored.name} (edited)`} onSave={saveAsNew} />
    </Grid>
  );
}
