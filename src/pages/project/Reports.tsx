import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Anchor, Badge, Button, Card, Grid, Group, Loader, Modal, Select, Stack, Tabs, Text, TextInput, Textarea, Title } from '@mantine/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useSearchParams } from 'react-router-dom';
import { notifications } from '@mantine/notifications';
import { IconCheck, IconDeviceFloppy, IconFileTypeDocx, IconFileTypePdf, IconLayoutList, IconSettings, IconTemplate } from '@tabler/icons-react';
import { db } from '../../db/db';
import { useProject } from '../../hooks/useProjectData';
import { useSettings } from '../../hooks/useSettings';
import { PeriodPicker, defaultPeriod, type PeriodValue } from '../../components/common';
import { nextDueReport, obligationPeriod, obligationPresets } from '../../lib/schedule';
import { roundPeriods } from '../../lib/latest';
import { formatDate, todayStr } from '../../lib/dates';
import { uid } from '../../lib/ids';
import { buildReport } from '../../reports/build';
import { PdfPreview } from '../../reports/PdfPreview';
import type { ReportDoc } from '../../reports/model';
import { cmToPx, renderChartPng } from '../../charts/render';
import { exportReport } from '../../reports/export';
import { saveObligation, saveTemplate } from '../../db/repo';
import type { ReportTemplate, TextBlock } from '../../db/types';
import { SectionsEditor } from '../../components/report/SectionsEditor';
import { PagesControl } from '../../components/report/PagesControl';
import { JumpToPreview } from '../../components/report/JumpToPreview';
import { ReportSites } from '../../components/report/ReportSites';

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

  // Layout changes made here are kept (per project and template) until saved as a template or discarded.
  const editKey = stored ? `layout:${project.id}:${stored.id}` : '';
  const [edits, setEdits] = useState<{ key: string; t: ReportTemplate } | null>(null);
  useEffect(() => {
    let alive = true;
    if (editKey) void db.meta.get(editKey).then((r) => alive && setEdits(r ? { key: editKey, t: r.value as ReportTemplate } : null));
    return () => {
      alive = false;
    };
  }, [editKey]);
  const working = edits && edits.key === editKey ? edits.t : null;
  const template = working ?? stored;
  const edited = !!(working && stored && !same(working, stored));
  const changeTemplate = (t: ReportTemplate) => {
    if (!editKey) return;
    if (stored && same(t, stored)) {
      setEdits(null);
      void db.meta.delete(editKey);
      return;
    }
    setEdits({ key: editKey, t });
    void db.meta.put({ key: editKey, value: t });
  };
  const discard = () => {
    setEdits(null);
    if (editKey) void db.meta.delete(editKey);
  };
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
    await saveTemplate({ ...working, id: stored.id, builtIn: false, updatedAt: new Date().toISOString() });
    discard();
    notifications.show({ color: 'teal', message: `“${stored.name}” updated` });
  };

  // The sites the report covers (e.g. a groundwater report without the discharge): remembered for the reporting
  // obligation when the period is one of its periods, otherwise for the template.
  const oblId = period.key.startsWith('obl:') ? period.key.split(':')[1] : null;
  const sitesKey = stored ? `sites:${project.id}:${oblId ?? stored.id}` : '';
  const [siteSel, setSiteSel] = useState<{ key: string; ids: string[] } | null>(null);
  useEffect(() => {
    let alive = true;
    if (sitesKey) void db.meta.get(sitesKey).then((r) => alive && setSiteSel(r ? { key: sitesKey, ids: r.value as string[] } : null));
    return () => {
      alive = false;
    };
  }, [sitesKey]);
  const chosenSites = useMemo(() => {
    const ids = siteSel && siteSel.key === sitesKey ? siteSel.ids.filter((id) => data.siteMap.has(id)) : [];
    return ids.length && ids.length < data.sites.length ? ids : null; // null = every site
  }, [siteSel, sitesKey, data.siteMap, data.sites.length]);
  const chooseSites = (ids: string[]) => {
    if (!sitesKey) return;
    const all = !ids.length || ids.length >= data.sites.length;
    setSiteSel(all ? null : { key: sitesKey, ids });
    void (all ? db.meta.delete(sitesKey) : db.meta.put({ key: sitesKey, value: ids }));
  };

  const [tab, setTab] = useState<string | null>('report');
  const settingsCard = useRef<HTMLDivElement>(null);
  const previewCard = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<string | null>(null);

  const draftKey = template ? `draft:${project.id}:${template.id}:${period.start}:${period.end}` : '';
  const [prompts, setPrompts] = useState<Record<string, string>>({});
  useEffect(() => {
    // load the saved commentary once per template/period (not live, so typing is never overwritten)
    let alive = true;
    if (draftKey) void db.meta.get(draftKey).then((r) => alive && setPrompts((r?.value as Record<string, string>) ?? {}));
    return () => {
      alive = false;
    };
  }, [draftKey]);
  const promptBlocks = (template?.blocks.filter((b) => b.type === 'text' && b.prompt) ?? []) as TextBlock[];

  // Build the report for the preview (debounced; graphs at a lower resolution than the export)
  const [doc, setDoc] = useState<ReportDoc | null>(null);
  const [building, setBuilding] = useState(false);
  useEffect(() => {
    if (!template) return;
    setBuilding(true);
    const h = setTimeout(() => {
      try {
        setDoc(buildReport({ bundle: data, template, period, settings, promptTexts: prompts, siteIds: chosenSites ?? undefined, renderChart: (opt, w, hh) => renderChartPng(opt, cmToPx(w), cmToPx(hh), 1.5) }));
      } finally {
        setBuilding(false);
      }
    }, 600);
    return () => clearTimeout(h);
  }, [data, template, period, settings, prompts, chosenSites]);

  const [busy, setBusy] = useState<'pdf' | 'docx' | null>(null);
  const exportDoc = async (kind: 'pdf' | 'docx') => {
    if (!template) return;
    setBusy(kind);
    try {
      await exportReport(kind, { bundle: data, template, period, settings, promptTexts: prompts, siteIds: chosenSites ?? undefined });
    } catch (e) {
      notifications.show({ title: 'Export failed', message: (e as Error).message, color: 'red' });
    } finally {
      setBusy(null);
    }
  };

  const obl = period.key.startsWith('obl:') ? oblPresets.find((p) => p.key === period.key) : undefined;
  const obligation = obl ? obligations.find((o) => o.id === obl.obligationId) : undefined;
  const submitted = obligation?.submissions.find((s) => s.periodEnd === period.end);

  const savePrompt = (id: string, text: string) => {
    const next = { ...prompts, [id]: text };
    setPrompts(next);
    if (draftKey) void db.meta.put({ key: draftKey, value: next });
  };

  if (!templates || !template || !stored)
    return (
      <Group justify="center" p="xl">
        <Loader />
      </Group>
    );

  const orientationControl = <PagesControl orientation={template.orientation} blocks={template.blocks} onChange={(orientation, blocks) => changeTemplate({ ...template, orientation, blocks })} />;

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
                          onClick={() => saveObligation({ ...obligation, submissions: [...obligation.submissions, { periodStart: period.start, periodEnd: period.end, submittedOn: todayStr() }] })}
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
          {promptBlocks.length > 0 && (
            <Card padding="md">
              <Title order={5} mb={4}>
                Commentary for this report
              </Title>
              <Text size="xs" c="dimmed" mb="sm">
                Saved automatically with this project and period. Use **bold**, *italic* and “- ” for bullets.
              </Text>
              <Stack gap="sm">
                {promptBlocks.map((b) => {
                  const idx = template.blocks.findIndex((x) => x.id === b.id);
                  const heading = [...template.blocks.slice(0, idx)].reverse().find((x) => x.type === 'heading') as { text: string } | undefined;
                  return <Textarea key={b.id} label={heading?.text ?? 'Text'} autosize minRows={4} maxRows={14} value={prompts[b.id] ?? b.text} onChange={(e) => savePrompt(b.id, e.currentTarget.value)} />;
                })}
              </Stack>
            </Card>
          )}
          {!data.samples.length && (
            <Alert color="orange" variant="light">
              This project has no data yet – the report will be mostly empty.
            </Alert>
          )}
        </Stack>
      </Grid.Col>
      <Grid.Col span={{ base: 12, lg: 8 }}>
        <Card padding="sm" bg="var(--mantine-color-gray-1)" ref={previewCard} style={{ scrollMarginTop: 72 }}>
          <PdfPreview doc={doc} building={building} />
        </Card>
      </Grid.Col>
      <JumpToPreview preview={previewCard} back={settingsCard} />
      <SaveAsModal opened={saveAs} onClose={() => setSaveAs(false)} initialName={`${stored.name} (edited)`} onSave={saveAsNew} />
    </Grid>
  );
}
