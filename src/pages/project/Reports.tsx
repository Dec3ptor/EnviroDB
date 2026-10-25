import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Anchor, Badge, Button, Card, Collapse, Grid, Group, Loader, Modal, Select, Stack, Tabs, Text, TextInput, Textarea, Title, Tooltip, UnstyledButton } from '@mantine/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useSearchParams } from 'react-router-dom';
import { notifications } from '@mantine/notifications';
import { IconCheck, IconChevronDown, IconChevronRight, IconDeviceFloppy, IconFileTypeDocx, IconFileTypePdf, IconLayoutList, IconLock, IconSettings, IconSparkles, IconTemplate, IconChecks } from '@tabler/icons-react';
import { db, saveReportWork } from '../../db/db';
import { hasViewState, revivePeriod, seedViewState, useViewState } from '../../hooks/useViewState';
import { useProject } from '../../hooks/useProjectData';
import { useSharedWork } from '../../hooks/useSharedWork';
import { same as sameValue } from '../../sync/model';
import { useSettings } from '../../hooks/useSettings';
import { defaultPeriod, EmptyState, MoreOptions, PeriodPicker, type PeriodValue } from '../../components/common';
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
import { InsertRef, ReportDocContext, ReportSamplesContext, ReportSitesContext } from '../../components/report/blocks';
import { InsertCalc } from '../../components/report/InsertCalc';
import { summaryText } from '../../reports/build';
import { PagesControl } from '../../components/report/PagesControl';
import { ReportProjectContext, projectParamIds } from '../../components/report/projectChoices';
import { PageTextEditor } from '../../components/report/PageText';
import { JumpToPreview, usePreviewPane } from '../../components/report/JumpToPreview';
import { ReportSites } from '../../components/report/ReportSites';
import { IssuedPanel, IssueModal, useIssuedContent, useLatestIssues, type ReportNow } from '../../components/report/Issued';
import { issuedBuildOptions } from '../../db/issues';
import type { IssuedReport } from '../../db/types';
import { preIssueChecks } from '../../reports/checks';
import { noteFirstReport } from '../../components/Onboarding';

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
  const [pageTextOpen, setPageTextOpen] = useState(false);
  const templates = useLiveQuery(() => db.templates.toArray(), []);
  const [params, setParams] = useSearchParams();

  const oblPresets = useMemo(() => obligationPresets(obligations), [obligations]);
  const rounds = useMemo(() => roundPeriods(data, 12), [data]); // "Monitoring round – September 2026", newest first

  // the report as left last time on this project – unless a link (e.g. from the Schedule tab) opens a particular one
  const k = (name: string) => `${project.id}:reports.${name}`;
  // a template kept from last time stays on its period (the latest-round jump below is for a template just chosen)
  const [keptTemplate] = useState(() => hasViewState(k('template')) && !params.toString());
  const [initial] = useState(() => {
    const opened = linkedReport();
    if (opened) {
      seedViewState(k('period'), opened.period);
      seedViewState(k('template'), opened.templateId ?? settings.defaultTemplateId ?? 'tpl-annual');
    }
    return opened ?? defaultReport();
  });
  function linkedReport(): { period: PeriodValue; templateId?: string } | null {
    const oId = params.get('obligation');
    const idx = params.get('period');
    const ob = oId ? obligations.find((o) => o.id === oId) : undefined;
    if (ob && idx !== null) {
      const p = obligationPeriod(ob, Number(idx));
      return { period: { key: `obl:${ob.id}:${p.index}`, start: p.periodStart, end: p.periodEnd, label: `${ob.name}: ${formatDate(p.periodStart)} – ${formatDate(p.periodEnd)}` }, templateId: ob.templateId };
    }
    const s = params.get('start'), e = params.get('end');
    if (s && e) return { period: { key: 'custom', start: s, end: e, label: `${formatDate(s)} – ${formatDate(e)}` }, templateId: params.get('template') ?? undefined };
    return params.get('template') ? { period: defaultReport().period, templateId: params.get('template')! } : null;
  }
  function defaultReport(): { period: PeriodValue; templateId?: string } {
    // the report that is due next (unsubmitted and whose period has ended)
    const next = nextDueReport(obligations);
    if (next) {
      const { obligation: o, period: p } = next;
      return { period: { key: `obl:${o.id}:${p.index}`, start: p.periodStart, end: p.periodEnd, label: `${o.name}: ${formatDate(p.periodStart)} – ${formatDate(p.periodEnd)}` }, templateId: o.templateId ?? params.get('template') ?? undefined };
    }
    return { period: defaultPeriod(project.yearStartMonth, 'lastRy') };
  }

  const [period, setPeriod] = useViewState<PeriodValue>(k('period'), initial.period, revivePeriod(project.yearStartMonth));
  const [templateId, setTemplateId] = useViewState<string | null>(k('template'), initial.templateId ?? settings.defaultTemplateId ?? 'tpl-annual');
  // the template chosen – or, when it has been deleted, the default, the annual report or the first there is
  const stored = templates?.find((t) => t.id === templateId) ?? templates?.find((t) => t.id === settings.defaultTemplateId) ?? templates?.find((t) => t.id === 'tpl-annual') ?? templates?.[0];

  // A template for one monitoring round starts on the latest round, unless the period is already a round or
  // belongs to a reporting obligation that uses this template.
  const seenTemplate = useRef<string | null>(keptTemplate ? templateId : null);
  // a link's report is opened once: coming back to the tab keeps what's been chosen since
  useEffect(() => {
    if (params.toString()) setParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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

  const [tab, setTab] = useViewState<string | null>(k('tab'), 'report');
  // imports with results in the report's period that nobody has signed off
  const unreviewed = useMemo(() => {
    const inPeriod = new Set(data.samples.filter((s) => s.date.slice(0, 10) >= period.start && s.date.slice(0, 10) <= period.end && s.importId).map((s) => s.importId!));
    return data.imports.filter((b) => !b.reviewed && inPeriod.has(b.id));
  }, [data.samples, data.imports, period.start, period.end]);
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

  // Issued: this report's revisions (the latest locks it, unless it is being revised) and the project's others
  const issues = useLiveQuery(() => db.issues.where('projectId').equals(project.id).toArray(), [project.id]);
  const allIssued = useLatestIssues(issues);
  const revisions = useMemo(
    () => (stored && issues ? issues.filter((i) => i.templateId === stored.id && i.period.start === period.start && i.period.end === period.end).sort((a, b) => (a.at < b.at ? -1 : 1)) : []),
    [issues, stored, period.start, period.end],
  );
  const latestIssue = revisions[revisions.length - 1];
  const locked = !!latestIssue && !latestIssue.revising;
  const issued = useIssuedContent(locked ? latestIssue : undefined);
  const [showCurrent, setShowCurrent] = useState(false);
  useEffect(() => setShowCurrent(false), [latestIssue?.id]);
  const asIssued = locked && !showCurrent;
  const [issuing, setIssuing] = useState(false);
  const reportNow = useMemo<ReportNow | null>(
    () => (template ? { bundle: data, template, period, settings, promptTexts: prompts, figures: reportFigures, siteIds: chosenSites ?? undefined } : null),
    [data, template, period, settings, prompts, reportFigures, chosenSites],
  );
  // open an issued report of the project: its template and period
  const openIssued = (i: IssuedReport) => {
    const preset = oblPresets.find((p) => p.start === i.period.start && p.end === i.period.end && (!i.obligationId || p.obligationId === i.obligationId));
    setTemplateId(i.templateId);
    seenTemplate.current = i.templateId;
    setPeriod(preset ?? { key: 'custom', start: i.period.start, end: i.period.end, label: i.period.label });
  };

  // Build the report for the preview (debounced; graphs at a lower resolution than the export)
  const [doc, setDoc] = useState<ReportDoc | null>(null);
  // the project's sites and parameters, for the calculation pickers
  const reportProject = useMemo(() => ({ name: project.name, sites: data.sites, paramIds: projectParamIds(data), series: data.continuous.series.map((x) => ({ id: x.id, name: x.name, kind: x.kind })) }), [project.name, data]);
  // the sampling rounds up to the report's end, to choose a rounds table's earlier rounds from
  const roundSamples = useMemo(() => data.samples.filter((x) => x.date.slice(0, 10) <= period.end), [data.samples, period.end]);
  const [building, setBuilding] = useState(false);
  useEffect(() => {
    if (!template) return;
    // an issued report shows as issued (once what it was built from is unpacked)
    if (asIssued && !issued.content && !issued.error) {
      setBuilding(true);
      return;
    }
    setBuilding(true);
    const h = setTimeout(() => {
      try {
        const renderChart = (opt: Parameters<typeof renderChartPng>[0], w: number, hh: number) => renderChartPng(opt, cmToPx(w), cmToPx(hh), 1.5);
        if (asIssued && issued.content) setDoc(buildReport({ ...issuedBuildOptions(issued.content, latestIssue!), preview: true, renderChart }));
        else setDoc(buildReport({ bundle: data, template, period, settings, promptTexts: prompts, figures: reportFigures, preview: true, siteIds: chosenSites ?? undefined, renderChart }));
      } finally {
        setBuilding(false);
      }
    }, 600);
    return () => clearTimeout(h);
  }, [data, template, period, settings, prompts, chosenSites, reportFigures, asIssued, issued.content, issued.error]);

  // what's missing before issuing (warnings, not stops)
  const checks = useMemo(() => (template && !asIssued ? preIssueChecks({ bundle: data, template, period, doc, promptTexts: prompts, figures: reportFigures, imports: data.imports, siteIds: chosenSites ?? undefined }) : []), [data, template, period, doc, prompts, reportFigures, chosenSites, asIssued]);

  const [busy, setBusy] = useState<'pdf' | 'docx' | null>(null);
  const exportDoc = async (kind: 'pdf' | 'docx') => {
    if (!template) return;
    setBusy(kind);
    try {
      await exportReport(kind, { bundle: data, template, period, settings, promptTexts: prompts, figures: reportFigures, siteIds: chosenSites ?? undefined });
      noteFirstReport();
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

  if (templates && !templates.length)
    return (
      <EmptyState
        title="No report templates"
        action={
          <Button component={Link} to="/templates">
            Report templates
          </Button>
        }
      >
        Every template has been deleted. Make one from a starter or a document of yours, or put the built-in ones back, on the Report templates page.
      </EmptyState>
    );
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
    <ReportProjectContext.Provider value={reportProject}>
    <Grid gutter="lg">
      <Grid.Col span={{ base: 12, lg: 4 }}>
        <Stack gap="md">
          <Card padding="md" ref={settingsCard} style={{ scrollMarginTop: 72, overflow: 'visible' }}>
            {unreviewed.length > 0 && (
              <Alert color="orange" variant="light" p="xs" mb="sm" icon={<IconChecks size={16} />} title={`${unreviewed.length === 1 ? 'An import in this period isn’t' : `${unreviewed.length} imports in this period aren’t`} reviewed yet`}>
                <Text size="xs">
                  {unreviewed
                    .slice(0, 3)
                    .map((b) => b.fileName)
                    .join(', ')}
                  {unreviewed.length > 3 ? ` and ${unreviewed.length - 3} more` : ''}. Check the results and mark them reviewed on the <Anchor component={Link} to={`/projects/${project.id}/data`} size="xs">Data tab</Anchor> (Import history) before issuing.
                </Text>
              </Alert>
            )}
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
                  <fieldset disabled={locked} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, opacity: locked ? 0.6 : 1 }} title={locked ? 'Locked as issued' : undefined}>
                    <ReportSites sites={data.sites} chosen={chosenSites} onChange={chooseSites} rememberedFor={obligation ? `“${obligation.name}”` : 'this template'} />
                  </fieldset>
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
                  {!locked && editedBanner}
                  {!locked && (
                    <Stack gap={6}>
                      <Button fullWidth leftSection={<IconFileTypeDocx size={18} />} loading={busy === 'docx'} onClick={() => exportDoc('docx')}>
                        Download Word (.docx)
                      </Button>
                      <Button fullWidth variant="light" leftSection={<IconFileTypePdf size={18} />} loading={busy === 'pdf'} onClick={() => exportDoc('pdf')}>
                        Download PDF
                      </Button>
                    </Stack>
                  )}
                  {reportNow && issues && (
                    <IssuedPanel revisions={revisions} all={allIssued} issued={issued} now={reportNow} showCurrent={showCurrent} onShowCurrent={setShowCurrent} onIssue={() => setIssuing(true)} onOpen={openIssued} checks={checks} />
                  )}
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
                {locked ? (
                  <Alert color="teal" variant="light" p="sm" icon={<IconLock size={16} />} title={`${latestIssue.revision} is issued`}>
                    <Text size="xs">Its layout is locked as issued. Revise it (on the Report tab) to change it – the change is then issued as a new revision.</Text>
                  </Alert>
                ) : (
                <Stack gap="sm">
                  {orientationControl}
                  {editedBanner}
                  <Text size="xs" c="dimmed">
                    Tap a section to change it. Drag ⋮⋮ to move it – a heading brings its content – or use the arrows; ⋯ has more.
                  </Text>
                  <ReportSitesContext.Provider value={chosenSites ? data.sites.filter((x) => chosenSites.includes(x.id)) : data.sites}>
                    <ReportSamplesContext.Provider value={roundSamples}>
                      <ReportDocContext.Provider value={doc}>
                        <SectionsEditor blocks={template.blocks} onChange={(blocks) => changeTemplate({ ...template, blocks })} orientation={template.orientation} open={open} onOpen={setOpen} paletteOpen={false} />
                      </ReportDocContext.Provider>
                    </ReportSamplesContext.Provider>
                  </ReportSitesContext.Provider>
                  <Card withBorder padding="xs">
                    <UnstyledButton onClick={() => setPageTextOpen((o) => !o)} w="100%">
                      <Group gap={6} wrap="nowrap">
                        {pageTextOpen ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                        <Text size="sm" fw={600}>
                          Header and footer
                        </Text>
                      </Group>
                    </UnstyledButton>
                    <Collapse in={pageTextOpen}>
                      <div style={{ marginTop: 8 }}>
                        <PageTextEditor template={template} onChange={(patch) => changeTemplate({ ...template, ...patch })} onLetterhead={!!(template.letterhead && settings.letterhead)} title={false} />
                      </div>
                    </Collapse>
                  </Card>
                  <Anchor component={Link} to={`/templates/${stored.id}`} size="xs">
                    <Group gap={4}>
                      <IconTemplate size={13} />
                      Margins, fonts, colours and logo are on the Report templates page
                    </Group>
                  </Anchor>
                </Stack>
                )}
              </Tabs.Panel>
            </Tabs>
          </Card>
          {letterBlock && !locked && <LetterCard project={project} block={letterBlock} onBlock={(lb) => changeTemplate({ ...template, blocks: template.blocks.map((x) => (x.id === lb.id ? lb : x)) })} />}
          {commentaryBoxes.length > 0 && (
            <Card padding="md">
              <Title order={5} mb={4}>
                Commentary for this report
              </Title>
              <Text size="xs" c="dimmed" mb="sm">
                {locked
                  ? `As it is now – ${latestIssue.revision} keeps the commentary as issued. Revise the report to change it.`
                  : 'Saved automatically with this project and period. Use **bold**, *italic*, “- ” for bullets and “> ” for a quotation.'}
              </Text>
              <Stack gap="sm">
                {commentaryBoxes.map((c) => (
                  <div key={c.key}>
                    <Textarea
                      id={`commentary-${c.key}`}
                      label={c.label}
                      description={c.group}
                      autosize
                      minRows={c.auto ? 2 : 4}
                      maxRows={14}
                      value={prompts[c.key] ?? c.text}
                      readOnly={locked}
                      onChange={(e) => savePrompt(c.key, e.currentTarget.value)}
                    />
                    {!c.auto && !locked && (
                      <Group gap={4}>
                        <Tooltip label="Sentences about the period from the results – samples, compliance, guideline exceedances and how it compares with the period before – to edit" multiline maw={300}>
                          <Button
                            size="compact-xs"
                            variant="subtle"
                            leftSection={<IconSparkles size={14} />}
                            onClick={() => {
                              const cur = prompts[c.key] ?? c.text;
                              const draft = summaryText(data, period.start, period.end, chosenSites ?? undefined);
                              // the template's starting text is replaced; your own is kept, with the draft after it
                              savePrompt(c.key, cur.trim() && cur !== c.text ? `${cur.trimEnd()}\n\n${draft}` : draft);
                            }}
                          >
                            Draft from the results
                          </Button>
                        </Tooltip>
                        <InsertCalc target={`commentary-${c.key}`} value={prompts[c.key] ?? c.text} onChange={(text) => savePrompt(c.key, text)} />
                        <InsertRef
                          blocks={template.blocks}
                          target={`commentary-${c.key}`}
                          value={prompts[c.key] ?? c.text}
                          onInsert={(text, named) => {
                            savePrompt(c.key, text);
                            if (named) changeTemplate({ ...template, blocks: template.blocks.map((x) => (x.id === named.id ? { ...x, ref: named.ref } : x)) });
                          }}
                        />
                      </Group>
                    )}
                    {c.auto && !locked && prompts[c.key] !== undefined && prompts[c.key] !== c.text && (
                      <Anchor component="button" type="button" size="xs" onClick={() => savePrompt(c.key, undefined)}>
                        Back to the summary drafted from the results
                      </Anchor>
                    )}
                  </div>
                ))}
              </Stack>
            </Card>
          )}
          {!locked && figureBlocks.map((fb) => (
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
      {reportNow && (
        <IssueModal opened={issuing} onClose={() => setIssuing(false)} now={reportNow} previous={latestIssue?.revising ? latestIssue : undefined} project={project} obligation={obligation} submitted={!!submitted} checks={checks} />
      )}
      <SaveAsModal opened={saveAs} onClose={() => setSaveAs(false)} initialName={`${stored.name} (edited)`} onSave={saveAsNew} />
    </Grid>
    </ReportProjectContext.Provider>
  );
}
