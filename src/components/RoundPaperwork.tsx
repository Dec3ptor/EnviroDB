// A sampling round's paperwork, made here: the sample list with what the lab analyses each sample for (a chain of
// custody, with its sign-off boxes), a sheet for the field readings, the lab's own forms kept with the project printed
// after them, and the bottle labels on their sheets. Opened from a round on the monitoring calendar, or from a
// sampling schedule.

import { useEffect, useMemo, useRef, useState } from 'react';
import { ActionIcon, Alert, Autocomplete, Badge, Button, Checkbox, Chip, FileButton, Grid, Group, Modal, NumberInput, SegmentedControl, Select, Stack, Switch, TagsInput, Text, TextInput, Textarea, Tooltip } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { useLiveQuery } from 'dexie-react-hooks';
import { IconCopy, IconDownload, IconEye, IconFolderPlus, IconPaperclip } from '@tabler/icons-react';
import { db } from '../db/db';
import { saveEdited, saveProject } from '../db/repo';
import { downloadBlob, safeFileName } from '../db/backup';
import type { FileLink, ProjectFile, Sample } from '../db/types';
import { compareParams } from '../data/parameters';
import { useProjectFiles } from '../hooks/useProjectFiles';
import { useSettings } from '../hooks/useSettings';
import { useViewState } from '../hooks/useViewState';
import { copyText } from '../lib/clipboard';
import { todayStr } from '../lib/dates';
import { LABEL_SHEETS, bottleLabels, labelSheet, labelSheetsNeeded, planRound, schedulesDue } from '../lib/paperwork';
import { hasPages, pagesOf, type PageImage } from '../lib/pdfPages';
import { addProjectFiles, removeProjectFile, sharedCopy } from '../lib/projectFiles';
import { frequencyLabel } from '../lib/schedule';
import { unitLabel, withProjectUnits } from '../lib/units';
import { isQcSite } from '../lib/qc';
import { labelsPdfBytes, paperworkEmpty, paperworkPdfBytes, sampleListText, type LabelsInput, type PaperworkInput } from '../reports/paperwork';
import { PdfPreview } from '../reports/PdfPreview';
import { currentWorkspaceFolder, useWorkspace } from '../sync/workspace';
import { DateField, MoreOptions } from './common';
import { FileIcon, FileViewer } from './FileViewer';

const LABS = ['Hill Labs', 'Eurofins', 'ALS', 'Analytica', 'Watercare Laboratory Services', 'Linnaeus'];
/** A form's pages are drawn for print; more than this many and the rest are left off. */
const FORM_PAGES = 12;

export interface PaperworkRound {
  /** The round's months ('YYYY-MM'), the first first. */
  months: string[];
  /** In words: "October 2026". */
  label: string;
  /** The monitoring calendar row it's on, and the sites that row is for (all the project's when none). */
  rowId?: string;
  siteIds?: string[];
}

interface Setup {
  sheet: string;
  each: number;
  list: boolean;
  custody: boolean;
  fieldSheet: boolean;
}
const SETUP: Setup = { sheet: '21', each: 1, list: true, custody: true, fieldSheet: true };

export function RoundPaperworkModal({ projectId, round, scheduleIds, lab: roundLab, cocNumber: roundCoc, onClose }: {
  projectId: string;
  round: PaperworkRound;
  /** The schedules ticked to start with (else those with a round in the months). */
  scheduleIds?: string[];
  /** The round's lab and chain of custody number, where they're recorded. */
  lab?: string;
  cocNumber?: string;
  onClose: () => void;
}) {
  const settings = useSettings();
  const ws = useWorkspace();
  const project = useLiveQuery(() => db.projects.get(projectId), [projectId]);
  const allSites = useLiveQuery(() => db.sites.where('projectId').equals(projectId).toArray(), [projectId]);
  const allSchedules = useLiveQuery(() => db.schedules.where('projectId').equals(projectId).toArray(), [projectId]);
  const allParams = useLiveQuery(() => db.parameters.toArray(), []);
  const files = useProjectFiles(projectId);
  // what the lab reported for each site lately – for a schedule that names no analytes
  const lately = useLiveQuery(async () => {
    const samples = await db.samples.where('projectId').equals(projectId).toArray();
    const bySite = new Map<string, Sample[]>();
    for (const s of samples) if (!s.qc) bySite.set(s.siteId, [...(bySite.get(s.siteId) ?? []), s]);
    const recent = [...bySite.values()].flatMap((list) => list.sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 4));
    const results = recent.length ? await db.results.where('sampleId').anyOf(recent.map((s) => s.id)).toArray() : [];
    const bySample = new Map<string, string[]>();
    for (const r of results) bySample.set(r.sampleId, [...(bySample.get(r.sampleId) ?? []), r.parameterId]);
    return { bySite, bySample };
  }, [projectId]);

  const sites = useMemo(() => [...(allSites ?? [])].filter((s) => s.active !== false && !isQcSite(s) && (!round.siteIds?.length || round.siteIds.includes(s.id))).sort((a, b) => a.order - b.order || a.code.localeCompare(b.code)), [allSites, round.siteIds]);
  const params = useMemo(() => withProjectUnits([...(allParams ?? [])].sort(compareParams), project?.concUnit), [allParams, project?.concUnit]);
  const paramMap = useMemo(() => new Map(params.map((p) => [p.id, p])), [params]);
  const schedules = useMemo(() => [...(allSchedules ?? [])].filter((s) => s.active).sort((a, b) => a.name.localeCompare(b.name)), [allSchedules]);

  const [setup, setSetup] = useViewState<Setup>(`${projectId}:paperwork.setup`, SETUP, (v) => ({ ...SETUP, ...v }));
  const [date, setDate] = useState<string | undefined>(undefined);
  const [picked, setPicked] = useState<string[] | null>(scheduleIds ?? null);
  const [off, setOff] = useState<string[]>([]);
  const [extras, setExtras] = useState<string[]>([]);
  const [lab, setLab] = useState<string | null>(null);
  const [quote, setQuote] = useState<string | null>(null);
  const [coc, setCoc] = useState(roundCoc ?? '');
  const [sampler, setSampler] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [formIds, setFormIds] = useState<string[] | null>(null);
  const [startAt, setStartAt] = useState(1);
  const [outlines, setOutlines] = useState(false);
  const [view, setView] = useState<'paperwork' | 'labels'>('paperwork');
  const [viewing, setViewing] = useState<ProjectFile | null>(null);
  const [busy, setBusy] = useState('');

  // the schedules with a round in the months – every running one when none has
  const due = useMemo(() => schedulesDue(schedules, round.months).map((s) => s.id), [schedules, round.months]);
  const chosen = useMemo(() => (picked ?? (due.length ? due : schedules.map((s) => s.id))).filter((id) => schedules.some((s) => s.id === id)), [picked, due, schedules]);
  const chosenSchedules = useMemo(() => schedules.filter((s) => chosen.includes(s.id)), [schedules, chosen]);
  // with no schedule at all, every site – analysed as it was last time
  const noSchedules = !schedules.length;
  const planSchedules = useMemo(() => (noSchedules ? [{ id: 'all', siteIds: sites.map((s) => s.id), parameterIds: [] as string[] }] : chosenSchedules), [noSchedules, sites, chosenSchedules]);
  const candidates = useMemo(() => sites.filter((s) => planSchedules.some((x) => x.siteIds.includes(s.id))), [sites, planSchedules]);
  const usualField = useMemo(() => {
    const seen = new Set([...(lately?.bySample.values() ?? [])].flat());
    const field = params.filter((p) => p.group === 'Field' && seen.has(p.id)).map((p) => p.id);
    return field.length ? field : ['ph-field', 'temp', 'ec-field', 'do'].filter((id) => paramMap.has(id));
  }, [lately, params, paramMap]);
  const plan = useMemo(
    () =>
      planRound({
        sites,
        schedules: planSchedules,
        params,
        siteIds: candidates.filter((s) => !off.includes(s.id)).map((s) => s.id),
        extras,
        usualField,
        lastAnalytes: (siteId) => {
          for (const s of [...(lately?.bySite.get(siteId) ?? [])].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 4)) {
            const ids = (lately?.bySample.get(s.id) ?? []).filter((id) => paramMap.get(id)?.group !== 'Field');
            if (ids.length) return ids;
          }
          return [];
        },
      }),
    [sites, planSchedules, params, candidates, off, extras, usualField, lately, paramMap],
  );

  // the lab's own forms: PDFs and pictures kept with the project – those marked for every round are ticked
  const forms = useMemo(() => files.filter((f) => !!f.path && hasPages(f) && (f.eachRound || f.kind === 'coc')).sort((a, b) => Number(!!b.eachRound) - Number(!!a.eachRound) || a.name.localeCompare(b.name)), [files]);
  const ticked = useMemo(() => (formIds ?? forms.filter((f) => f.eachRound).map((f) => f.id)).filter((id) => forms.some((f) => f.id === id)), [formIds, forms]);
  const cache = useRef(new Map<string, PageImage[]>());
  const [pages, setPages] = useState<Record<string, PageImage[] | string>>({});
  useEffect(() => {
    let live = true;
    for (const id of ticked) {
      const f = forms.find((x) => x.id === id);
      const key = `${id}|${f?.size ?? ''}`;
      if (!f || pages[key] !== undefined) continue;
      const kept = cache.current.get(key);
      if (kept) {
        setPages((p) => ({ ...p, [key]: kept }));
        continue;
      }
      void (async () => {
        try {
          const file = await sharedCopy(f);
          if (!file) throw new Error('It isn’t in the shared folder.');
          const drawn = await pagesOf(file, { dpi: 200, maxPages: FORM_PAGES });
          cache.current.set(key, drawn.pages);
          if (live) setPages((p) => ({ ...p, [key]: drawn.pages }));
        } catch (e) {
          if (live) setPages((p) => ({ ...p, [key]: (e as Error).message || 'It couldn’t be read.' }));
        }
      })();
    }
    return () => {
      live = false;
    };
  }, [ticked, forms]); // eslint-disable-line react-hooks/exhaustive-deps
  const formPages = ticked
    .map((id) => {
      const f = forms.find((x) => x.id === id)!;
      const got = pages[`${id}|${f.size ?? ''}`];
      return { f, got };
    })
    .filter((x) => x.f);
  const drawing = formPages.some((x) => x.got === undefined);

  const labValue = lab ?? roundLab ?? project?.lab ?? '';
  const quoteValue = quote ?? project?.labQuote ?? '';
  const samplerValue = sampler ?? settings.author ?? '';
  const input: PaperworkInput | null = useMemo(() => {
    if (!project) return null;
    return {
      project: { name: project.name, code: project.code, client: project.client, consents: project.consents, purchaseOrder: project.purchaseOrder },
      round: round.label,
      date,
      plan,
      paramName: (id: string) => paramMap.get(id)?.name ?? id,
      paramUnit: (id: string) => unitLabel(paramMap.get(id)?.unit ?? ''),
      sampler: samplerValue.trim() || undefined,
      company: settings.company || undefined,
      lab: labValue.trim() || undefined,
      quote: quoteValue.trim() || undefined,
      cocNumber: coc.trim() || undefined,
      notes,
      list: setup.list,
      custody: setup.custody,
      fieldSheet: setup.fieldSheet && plan.field.length > 0,
      forms: formPages.filter((x) => Array.isArray(x.got)).map((x) => ({ name: x.f.name, pages: x.got as PageImage[] })),
      printed: todayStr(),
      dateFormat: settings.dateFormat,
    };
  }, [project, round.label, date, plan, paramMap, samplerValue, settings.company, settings.dateFormat, labValue, quoteValue, coc, notes, setup.list, setup.custody, setup.fieldSheet, pages, ticked]); // eslint-disable-line react-hooks/exhaustive-deps
  const sheet = labelSheet(setup.sheet);
  const labelsInput: LabelsInput | null = useMemo(
    () => (project ? { project: { name: project.name, code: project.code }, plan, sheet, each: setup.each, skip: Math.max(0, startAt - 1), date, sampler: samplerValue.trim() || undefined, paramName: (id: string) => paramMap.get(id)?.short ?? paramMap.get(id)?.name ?? id, outlines, dateFormat: settings.dateFormat } : null),
    [project, plan, sheet, setup.each, startAt, date, samplerValue, paramMap, outlines, settings.dateFormat],
  );
  const [shownInput] = useDebouncedValue(input, 350);
  const [shownLabels] = useDebouncedValue(labelsInput, 350);
  const load = useMemo(() => (view === 'paperwork' ? (shownInput ? () => paperworkPdfBytes(shownInput) : null) : shownLabels ? () => labelsPdfBytes(shownLabels) : null), [view, shownInput, shownLabels]);

  if (!project || !allSites || !allSchedules || !allParams) return null;
  const nothing = !input || paperworkEmpty(input);
  const labelCount = bottleLabels(plan.samples, setup.each).length;
  const stem = `${project.code || project.name} - ${round.months[0]}`;
  const canKeep = ws.phase === 'ready' && !!currentWorkspaceFolder()?.writeBlob;
  const link: FileLink = { kind: 'round', month: round.months[0], ...(round.rowId ? { row: round.rowId } : {}) };

  /** The lab and its quote, kept with the project for the next round. */
  const remember = async () => {
    const next = { ...project, lab: labValue.trim() || undefined, labQuote: quoteValue.trim() || undefined };
    if (next.lab !== project.lab || next.labQuote !== project.labQuote) await saveProject(next, project);
  };
  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(what);
    try {
      await fn();
    } catch (e) {
      notifications.show({ color: 'red', message: (e as Error).message });
    } finally {
      setBusy('');
    }
  };
  const downloadPaperwork = () =>
    run('paperwork', async () => {
      if (!input) return;
      downloadBlob(new Blob([(await paperworkPdfBytes(input)) as BlobPart], { type: 'application/pdf' }), `${safeFileName(`Sampling paperwork - ${stem}`)}.pdf`);
      await remember();
    });
  const downloadLabels = () =>
    run('labels', async () => {
      if (!labelsInput) return;
      downloadBlob(new Blob([(await labelsPdfBytes(labelsInput)) as BlobPart], { type: 'application/pdf' }), `${safeFileName(`Bottle labels - ${stem}`)}.pdf`);
    });
  const keep = () =>
    run('keep', async () => {
      if (!input) return;
      const name = `${safeFileName(`Sampling paperwork - ${stem}`)}.pdf`;
      // made again for the same round: the copy kept before is replaced
      for (const old of files.filter((f) => f.name === name && f.linked?.kind === 'round' && f.linked.month === link.month && (f.linked.row ?? '') === (round.rowId ?? ''))) await removeProjectFile(old);
      const r = await addProjectFiles(project, [new File([(await paperworkPdfBytes(input)) as BlobPart], name, { type: 'application/pdf' })], { linked: link, kind: 'coc', readText: async () => 'chain of custody' });
      await remember();
      if (r.errors.length) throw new Error(r.errors[0]);
      notifications.show({ color: 'teal', message: `Kept with the project’s files, linked to the ${round.label} round – it shows with the round, and with its samples once they’re in.` });
    });
  const addForm = (list: File[]) =>
    run('form', async () => {
      if (!list.length) return;
      const r = await addProjectFiles(project, list, { kind: 'coc' });
      const got = [...r.added, ...files.filter((f) => list.some((x) => x.name === f.name && x.size === f.size))];
      for (const f of got) if (!f.eachRound) await saveEdited(db.files, { ...f, eachRound: true }, f);
      setFormIds([...new Set([...ticked, ...got.map((f) => f.id)])]);
      for (const e of r.errors) notifications.show({ color: 'red', message: e });
      const unprintable = got.filter((f) => !hasPages(f));
      if (unprintable.length) notifications.show({ color: 'orange', message: `${unprintable.map((f) => f.name).join(', ')}: only a PDF or a picture can be printed with the paperwork – it’s kept with the project’s files.` });
    });
  const copyList = async () => {
    if (!input) return;
    const ok = await copyText(sampleListText(input));
    notifications.show({ color: ok ? 'teal' : 'red', message: ok ? 'Sample list copied – paste it into an email to the lab, or a bottle order.' : 'It couldn’t be copied.' });
  };

  const fromLast = plan.samples.filter((s) => s.from === 'last').length;
  const unnamed = plan.samples.filter((s) => !s.extra && s.from === 'none').map((s) => s.name);
  return (
    <Modal opened onClose={onClose} closeOnEscape={!viewing} title={<Text fw={700}>Paperwork for the {round.label} round – {project.code || project.name}</Text>} size="min(1280px, 96vw)">
      <Grid gutter="lg">
        <Grid.Col span={{ base: 12, md: 5 }}>
          <Stack gap="sm">
            <Text size="sm" c="dimmed">
              What goes out with the round: the samples and what the lab analyses each for, a sheet for the field readings, your lab’s chain of custody form, and the bottle labels.
            </Text>
            {noSchedules ? (
              <Alert color="blue" variant="light" p="xs">
                <Text size="xs">The project has no sampling schedules, so every site is listed with what the lab reported for it last time. A schedule (Schedule tab) names the sites and analytes of each round.</Text>
              </Alert>
            ) : (
              <div>
                <Text size="sm" fw={500} mb={4}>
                  Sampling schedules
                </Text>
                <Stack gap={4}>
                  {schedules.map((s) => (
                    <Checkbox
                      key={s.id}
                      size="xs"
                      checked={chosen.includes(s.id)}
                      onChange={(e) => setPicked(e.currentTarget.checked ? [...chosen, s.id] : chosen.filter((x) => x !== s.id))}
                      label={
                        <>
                          {s.name}{' '}
                          <Text span c="dimmed" size="xs">
                            {frequencyLabel(s.every, s.unit).toLowerCase()} · {s.siteIds.length} site{s.siteIds.length === 1 ? '' : 's'}
                            {s.parameterIds.length ? ` · ${s.parameterIds.length} analytes` : ''}
                            {due.includes(s.id) ? ' · due this round' : ''}
                          </Text>
                        </>
                      }
                    />
                  ))}
                </Stack>
              </div>
            )}
            {candidates.length > 0 && (
              <div>
                <Group justify="space-between" mb={4}>
                  <Text size="sm" fw={500}>
                    Sites
                  </Text>
                  <Text size="xs" c="dimmed">
                    {plan.samples.filter((s) => !s.extra).length} of {candidates.length} – untick one that isn’t sampled this time
                  </Text>
                </Group>
                <Chip.Group multiple value={candidates.filter((s) => !off.includes(s.id)).map((s) => s.id)} onChange={(on) => setOff(candidates.filter((s) => !on.includes(s.id)).map((s) => s.id))}>
                  <Group gap={6}>
                    {candidates.map((s) => (
                      <Chip key={s.id} value={s.id} size="xs" variant="light">
                        {s.code}
                      </Chip>
                    ))}
                  </Group>
                </Chip.Group>
              </div>
            )}
            <TagsInput size="xs" label="Extra samples" description="Duplicates and blanks, by the names on their bottles – type one and press Enter" placeholder="e.g. DUP1, Field blank" value={extras} onChange={setExtras} splitChars={[',', ';']} clearable />
            {(fromLast > 0 || unnamed.length > 0) && (
              <Text size="xs" c="dimmed">
                {fromLast > 0 ? `${fromLast} site${fromLast === 1 ? '’s' : 's’'} analysis is what the lab reported last time (the schedule names no analytes). ` : ''}
                {unnamed.length > 0 ? `No analysis is known for ${unnamed.join(', ')} – it’s left to write in.` : ''}
              </Text>
            )}
            <Group grow align="flex-start">
              <DateField size="xs" label="Sampling day" description="Printed on the list and labels – or leave it to write in" placeholder="Written in by hand" value={date} onChange={setDate} clearable />
              <TextInput size="xs" label="Sampled by" description="On the list and the labels" value={samplerValue} onChange={(e) => setSampler(e.currentTarget.value)} />
            </Group>
            <Group grow align="flex-start">
              <Autocomplete size="xs" label="Laboratory" data={[...new Set([labValue, ...LABS].filter(Boolean))]} value={labValue} onChange={setLab} />
              <TextInput size="xs" label="Lab quote no." value={quoteValue} onChange={(e) => setQuote(e.currentTarget.value)} />
              <TextInput size="xs" label="Lab job / CoC no." placeholder="If it’s known" value={coc} onChange={(e) => setCoc(e.currentTarget.value)} />
            </Group>
            <div>
              <Text size="sm" fw={500} mb={4}>
                What to print
              </Text>
              <Stack gap={4}>
                <Checkbox size="xs" label="The sample list and analysis request" checked={setup.list} onChange={(e) => setSetup({ ...setup, list: e.currentTarget.checked })} />
                <Checkbox size="xs" ml={26} label="with sign-off boxes – relinquished by, received by (a chain of custody)" checked={setup.custody} disabled={!setup.list} onChange={(e) => setSetup({ ...setup, custody: e.currentTarget.checked })} />
                <Checkbox
                  size="xs"
                  label={`A field record sheet, to write the readings on${plan.field.length ? ` (${plan.field.length} reading${plan.field.length === 1 ? '' : 's'})` : ''}`}
                  checked={setup.fieldSheet && plan.field.length > 0}
                  disabled={!plan.field.length}
                  onChange={(e) => setSetup({ ...setup, fieldSheet: e.currentTarget.checked })}
                />
              </Stack>
            </div>
            <div>
              <Group justify="space-between" mb={4}>
                <Text size="sm" fw={500}>
                  Your lab’s own forms
                </Text>
                {canKeep && (
                  <FileButton onChange={(list) => void addForm(list)} multiple accept="application/pdf,image/png,image/jpeg">
                    {(props) => (
                      <Button {...props} size="compact-xs" variant="subtle" leftSection={<IconPaperclip size={14} />} loading={busy === 'form'}>
                        Add a form
                      </Button>
                    )}
                  </FileButton>
                )}
              </Group>
              {forms.length ? (
                <Stack gap={4}>
                  {forms.map((f) => {
                    const got = pages[`${f.id}|${f.size ?? ''}`];
                    const on = ticked.includes(f.id);
                    return (
                      <Group key={f.id} gap={6} wrap="nowrap">
                        <Checkbox size="xs" checked={on} onChange={(e) => setFormIds(e.currentTarget.checked ? [...ticked, f.id] : ticked.filter((x) => x !== f.id))} aria-label={`Print ${f.name}`} />
                        <FileIcon f={f} size={15} />
                        <Text size="xs" style={{ flex: 1, minWidth: 0 }} truncate>
                          {f.name}
                        </Text>
                        {f.eachRound && (
                          <Badge size="xs" variant="light" color="gray" style={{ flexShrink: 0 }}>
                            every round
                          </Badge>
                        )}
                        {on && typeof got === 'string' && (
                          <Text size="xs" c="red" style={{ flexShrink: 0 }}>
                            {got}
                          </Text>
                        )}
                        {on && Array.isArray(got) && (
                          <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
                            {got.length} page{got.length === 1 ? '' : 's'}
                          </Text>
                        )}
                        <Tooltip label="Open">
                          <ActionIcon size="sm" variant="subtle" onClick={() => setViewing(f)} aria-label={`Open ${f.name}`}>
                            <IconEye size={14} />
                          </ActionIcon>
                        </Tooltip>
                      </Group>
                    );
                  })}
                  <Text size="xs" c="dimmed">
                    Printed after the sample list, as they are. One marked “every round” (in the Files tab, under its details) is ticked each time.
                  </Text>
                </Stack>
              ) : (
                <Text size="xs" c="dimmed">
                  {canKeep
                    ? 'None yet. Add your lab’s chain of custody form – filled in for this project, as a PDF – and it’s printed with every round’s paperwork.'
                    : 'Connect the shared folder to keep your lab’s chain of custody form with the project: it’s then printed with every round’s paperwork.'}
                </Text>
              )}
            </div>
            <div>
              <Text size="sm" fw={500} mb={4}>
                Bottle labels
              </Text>
              <Group grow align="flex-start">
                <Select size="xs" label="Label sheet" data={LABEL_SHEETS.map((s) => ({ value: s.id, label: s.label }))} value={sheet.id} onChange={(v) => v && setSetup({ ...setup, sheet: v })} allowDeselect={false} comboboxProps={{ withinPortal: true }} />
                <NumberInput size="xs" label="Labels for each sample" description="One a bottle" min={0} max={24} value={setup.each} onChange={(v) => setSetup({ ...setup, each: Math.max(0, Math.min(24, Number(v) || 0)) })} />
                <NumberInput size="xs" label="Start at label" description="On a part-used sheet" min={1} max={sheet.cols * sheet.rows} value={startAt} onChange={(v) => setStartAt(Math.max(1, Math.min(sheet.cols * sheet.rows, Number(v) || 1)))} />
              </Group>
              <Group justify="space-between" mt={6}>
                <Text size="xs" c="dimmed">
                  {labelCount ? `${labelCount} label${labelCount === 1 ? '' : 's'} on ${labelSheetsNeeded(labelCount + startAt - 1, sheet)} sheet${labelSheetsNeeded(labelCount + startAt - 1, sheet) === 1 ? '' : 's'}. Print at actual size (100%), not “fit to page”.` : 'No labels.'}
                </Text>
                <Switch size="xs" label="Outlines, to test on plain paper" checked={outlines} onChange={(e) => setOutlines(e.currentTarget.checked)} />
              </Group>
            </div>
            <MoreOptions label="A note on the sample list" summary={notes.trim() || 'None'}>
              <Textarea size="xs" autosize minRows={2} placeholder="e.g. Low-level metals; results to the client and the council; GW2 dry in March" value={notes} onChange={(e) => setNotes(e.currentTarget.value)} />
            </MoreOptions>
          </Stack>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 7 }}>
          <Stack gap="xs" style={{ height: 'min(78vh, 900px)' }}>
            <Group justify="space-between" wrap="wrap" gap="xs">
              <SegmentedControl
                size="xs"
                value={view}
                onChange={(v) => setView(v as typeof view)}
                data={[
                  { value: 'paperwork', label: 'Paperwork' },
                  { value: 'labels', label: `Labels${labelCount ? ` (${labelCount})` : ''}` },
                ]}
              />
              <Group gap="xs">
                <Tooltip label="The samples and their analysis as text – for an email to the lab, or a bottle order">
                  <Button size="xs" variant="default" leftSection={<IconCopy size={14} />} onClick={() => void copyList()} disabled={!plan.samples.length}>
                    Copy the sample list
                  </Button>
                </Tooltip>
                {canKeep && (
                  <Tooltip label="A copy in the project’s files, linked to this round" multiline maw={260}>
                    <Button size="xs" variant="default" leftSection={<IconFolderPlus size={14} />} onClick={() => void keep()} loading={busy === 'keep'} disabled={nothing || drawing}>
                      Keep with the round
                    </Button>
                  </Tooltip>
                )}
                {view === 'paperwork' ? (
                  <Button size="xs" leftSection={<IconDownload size={14} />} onClick={() => void downloadPaperwork()} loading={busy === 'paperwork'} disabled={nothing || drawing}>
                    Download the paperwork
                  </Button>
                ) : (
                  <Button size="xs" leftSection={<IconDownload size={14} />} onClick={() => void downloadLabels()} loading={busy === 'labels'} disabled={!labelCount}>
                    Download the labels
                  </Button>
                )}
              </Group>
            </Group>
            {view === 'paperwork' && nothing && !drawing ? (
              <Text c="dimmed" size="sm" ta="center" py="xl">
                Nothing to print yet: tick a schedule with sites, or one of your lab’s forms.
              </Text>
            ) : view === 'labels' && !labelCount ? (
              <Text c="dimmed" size="sm" ta="center" py="xl">
                No labels: set how many each sample needs.
              </Text>
            ) : (
              <PdfPreview load={load} building={drawing && view === 'paperwork'} fill />
            )}
          </Stack>
        </Grid.Col>
      </Grid>
      {viewing && <FileViewer file={viewing} onClose={() => setViewing(null)} />}
    </Modal>
  );
}
