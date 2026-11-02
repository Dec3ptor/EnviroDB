// The project's files: lab quotes and result sheets, chains of custody, the consent … Dropped or uploaded here, a copy
// is kept in the shared folder; a link points to one kept elsewhere. Each can be linked to the data it's about – a
// lab job, an import, or samples – and then shows in those samples' details.

import { useMemo, useState } from 'react';
import { ActionIcon, Anchor, Autocomplete, Badge, Button, Card, Chip, FileButton, Group, Menu, Modal, MultiSelect, SegmentedControl, Select, Stack, Table, Text, TextInput, Textarea, ThemeIcon, Tooltip } from '@mantine/core';
import { Dropzone } from '@mantine/dropzone';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { useNavigate } from 'react-router-dom';
import {
  IconCopy, IconDots, IconDownload, IconExternalLink, IconEye, IconLink, IconPencil, IconSearch, IconTrash, IconUnlink, IconUpload,
} from '@tabler/icons-react';
import type { FileKind, FileLink, ImportBatch, ProjectFile, Sample } from '../../db/types';
import { useProject } from '../../hooks/useProjectData';
import { useProjectFiles } from '../../hooks/useProjectFiles';
import { useViewState, seedViewState } from '../../hooks/useViewState';
import { useWorkspace, currentWorkspaceFolder } from '../../sync/workspace';
import { downloadBlob } from '../../db/backup';
import { same } from '../../sync/model';
import { copyText } from '../../lib/clipboard';
import { formatDate } from '../../lib/dates';
import {
  addProjectFiles, addProjectLink, FILE_KINDS, fileSize, kindLabel, linkedSampleIds, linkProjectFile, linkTarget, nameOfTarget, projectFilesDir, projectJobs, removeProjectFile, sampleSummary, saveProjectFile, samplesByImport, sharedCopy, suggestedJob, webAddress, type LabJob,
} from '../../lib/projectFiles';
import { FileIcon, FileViewer } from '../../components/FileViewer';
import { DateField, defaultPeriod } from '../../components/common';
import { SaveButton } from '../../components/Unsaved';

const KIND_COLOR: Record<FileKind, string> = { results: 'teal', quote: 'blue', coc: 'grape', field: 'lime', consent: 'orange', report: 'indigo', correspondence: 'gray', invoice: 'yellow', other: 'gray' };

/** The labs a project's files and samples name, and the usual ones – offered for a file's lab. */
const LABS = ['Hill Labs', 'Eurofins', 'ALS', 'Analytica', 'Watercare', 'Linnaeus'];

/** The data a link names, in words: "Lab job 3300139", "Import of Hill.csv", "Samples". */
function linkLabel(l: FileLink, imports: ImportBatch[]): string {
  if (l.kind === 'job') return `Lab job ${l.job}`;
  if (l.kind === 'import') return `Import of ${imports.find((b) => b.id === l.importId)?.fileName ?? 'a file'}`;
  return 'Chosen samples';
}

export function FilesTab() {
  const data = useProject();
  const { project, imports, siteMap } = data;
  const navigate = useNavigate();
  const ws = useWorkspace();
  const files = useProjectFiles(project.id);
  const allSamples = useMemo(() => [...data.samples, ...data.qc.samples], [data.samples, data.qc.samples]);
  const sampleById = useMemo(() => new Map(allSamples.map((s) => [s.id, s])), [allSamples]);
  const jobs = useMemo(() => projectJobs(allSamples), [allSamples]);
  const byImport = useMemo(() => samplesByImport(allSamples, data.results), [allSamples, data.results]);
  const [kind, setKind] = useViewState<'all' | FileKind>(`${project.id}:files.kind`, 'all');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<ProjectFile | null>(null);
  const [editing, setEditing] = useState<ProjectFile | null>(null);
  const [linking, setLinking] = useState<ProjectFile | null>(null);
  const [adding, setAdding] = useState(false);
  const canKeep = ws.phase === 'ready' && !!currentWorkspaceFolder()?.writeBlob;
  const dir = projectFilesDir(project);
  const siteCode = (id: string) => siteMap.get(id)?.code;
  const labs = useMemo(() => [...new Set([...files.map((f) => f.lab ?? ''), ...allSamples.map((s) => s.labName ?? ''), ...LABS].filter(Boolean))], [files, allSamples]);

  // each file: the samples it's linked to (or the lab job it seems to be about), and when it's from
  const rows = useMemo(() => {
    return files
      .map((f) => {
        const ids = linkedSampleIds(f, allSamples, byImport);
        const days = ids.map((id) => sampleById.get(id)?.date.slice(0, 10) ?? '').filter(Boolean).sort();
        return { f, ids, suggestion: suggestedJob(f, jobs), when: f.date ?? days[days.length - 1] ?? f.addedAt.slice(0, 10) };
      })
      .sort((a, b) => (a.when < b.when ? 1 : a.when > b.when ? -1 : a.f.name.localeCompare(b.f.name)));
  }, [files, allSamples, byImport, jobs, sampleById]);
  const counts = useMemo(() => {
    const m = new Map<FileKind, number>();
    for (const { f } of rows) m.set(f.kind, (m.get(f.kind) ?? 0) + 1);
    return m;
  }, [rows]);
  // a kind remembered that has no files now: all of them
  const showing = kind !== 'all' && counts.get(kind) ? kind : 'all';
  const q = search.trim().toLowerCase();
  const shown = rows.filter(({ f }) => (showing === 'all' || f.kind === showing) && (!q || [f.name, f.lab, f.ref, f.notes, kindLabel(f.kind), f.linked?.kind === 'job' ? f.linked.job : ''].filter(Boolean).join(' ').toLowerCase().includes(q)));

  const upload = async (list: File[]) => {
    if (!list.length) return;
    setBusy(true);
    try {
      const r = await addProjectFiles(project, list, { jobs });
      const offered = r.added.filter((f) => suggestedJob(f, jobs)).length;
      if (r.added.length)
        notifications.show({
          color: 'teal',
          title: `${r.added.length} file${r.added.length === 1 ? '' : 's'} added`,
          message: `Kept in the shared folder, in ${dir}.${offered ? ` ${offered === 1 ? (r.added.length === 1 ? 'It’s' : 'One is') : `${offered} are`} from ${offered === 1 ? 'one of this project’s lab jobs' : 'this project’s lab jobs'} – Link to lab job, beside ${offered === 1 ? 'it' : 'each'}, links ${offered === 1 ? 'it' : 'them'} to the samples.` : ''}`,
          autoClose: 9000,
        });
      if (r.skipped.length) notifications.show({ color: 'blue', message: `Already here: ${r.skipped.join(', ')}.` });
      for (const e of r.errors) notifications.show({ color: 'red', title: 'Not added', message: e, autoClose: 12000 });
    } finally {
      setBusy(false);
    }
  };
  const quickLink = async (f: ProjectFile, job: LabJob) => {
    await linkProjectFile(f, { kind: 'job', job: job.job }, `lab job ${job.job}`);
    notifications.show({
      color: 'teal',
      message: (
        <Group gap="xs" wrap="nowrap" justify="space-between">
          <Text size="sm">
            {f.name} linked to lab job {job.job} – it shows in its {job.sampleIds.length} sample{job.sampleIds.length === 1 ? '’s' : 's’'} details.
          </Text>
          <Button size="compact-xs" variant="light" style={{ flexShrink: 0 }} onClick={() => void linkProjectFile({ ...f, linked: { kind: 'job', job: job.job } }, undefined)}>
            Undo
          </Button>
        </Group>
      ),
    });
  };
  const remove = (f: ProjectFile) =>
    modals.openConfirmModal({
      title: `Remove ${f.name}?`,
      children: <Text size="sm">{f.path ? `It comes off the project, and its copy in the shared folder (${f.path}) is deleted.` : 'The link comes off the project – the file it points to stays where it is.'}</Text>,
      labels: { confirm: 'Remove', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: async () => {
        const undo = await removeProjectFile(f);
        notifications.show({
          message: (
            <Group gap="xs" wrap="nowrap" justify="space-between">
              <Text size="sm">{f.name} removed.</Text>
              <Button size="compact-xs" variant="light" style={{ flexShrink: 0 }} onClick={() => void undo()}>
                Undo
              </Button>
            </Group>
          ),
          autoClose: 10000,
        });
      },
    });
  const download = async (f: ProjectFile) => {
    const file = await sharedCopy(f);
    if (file) downloadBlob(file, f.name);
    else notifications.show({ color: 'orange', message: `${f.name} isn’t in the shared folder (${f.path}).` });
  };
  const copyPath = async (f: ProjectFile) => notifications.show({ color: (await copyText(f.href ?? '')) ? 'teal' : 'red', message: `Path copied – paste it into File Explorer’s address bar: ${f.href}` });

  return (
    <Stack gap="md">
      <Dropzone.FullScreen active={canKeep} onDrop={(list) => void upload(list)} multiple maxSize={1024 * 1024 * 1024}>
        <Stack align="center" gap="xs" style={{ pointerEvents: 'none' }} mih={220} justify="center">
          <IconUpload size={48} stroke={1.5} />
          <Text size="xl" fw={600}>
            Drop to add to {project.code || project.name}
          </Text>
          <Text size="sm" c="dimmed">
            Kept in the shared folder, in {dir}
          </Text>
        </Stack>
      </Dropzone.FullScreen>
      <Card withBorder padding="md">
        <Group justify="space-between" wrap="wrap" gap="sm">
          <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
            <ThemeIcon variant="light" size="lg" radius="md">
              <IconUpload size={20} />
            </ThemeIcon>
            <div style={{ minWidth: 0 }}>
              <Text fw={500}>Drop files anywhere on this page – or upload them</Text>
              <Text size="xs" c="dimmed">
                Lab quotes, result sheets, chains of custody, the consent … {canKeep ? `Kept in the shared folder, in ${dir}.` : 'The shared folder isn’t connected, so only links can be added for now.'}
              </Text>
            </div>
          </Group>
          <Group gap="xs">
            <FileButton onChange={(list) => void upload(list)} multiple disabled={!canKeep}>
              {(props) => (
                <Button {...props} leftSection={<IconUpload size={16} />} loading={busy}>
                  Upload files
                </Button>
              )}
            </FileButton>
            <Button variant="default" leftSection={<IconLink size={16} />} onClick={() => setAdding(true)}>
              Add a link
            </Button>
          </Group>
        </Group>
      </Card>

      {rows.length > 0 && (
        <Group justify="space-between" wrap="wrap" gap="xs">
          <Chip.Group value={showing} onChange={(v) => setKind(v as 'all' | FileKind)}>
            <Group gap={6}>
              <Chip value="all" size="xs" variant="light">
                All {rows.length}
              </Chip>
              {FILE_KINDS.filter((k) => counts.get(k.value)).map((k) => (
                <Chip key={k.value} value={k.value} size="xs" variant="light">
                  {k.label} {counts.get(k.value)}
                </Chip>
              ))}
            </Group>
          </Chip.Group>
          <TextInput size="xs" placeholder="Search files…" leftSection={<IconSearch size={14} />} value={search} onChange={(e) => setSearch(e.currentTarget.value)} w={220} aria-label="Search files" />
        </Group>
      )}

      {rows.length === 0 ? (
        <Text size="sm" c="dimmed" ta="center" py="lg">
          No files yet. A lab’s result sheet linked to its samples shows in their details on the Data tab; a file kept by an import is linked to its results already.
        </Text>
      ) : shown.length === 0 ? (
        <Text size="sm" c="dimmed" ta="center" py="md">
          None match.
        </Text>
      ) : (
        <Table.ScrollContainer minWidth={760}>
          <Table verticalSpacing="xs" highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>File</Table.Th>
                <Table.Th style={{ minWidth: 150 }}>Kind</Table.Th>
                <Table.Th style={{ minWidth: 120 }}>Lab · number</Table.Th>
                <Table.Th>Linked to</Table.Th>
                <Table.Th w={70} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {shown.map(({ f, ids, suggestion }) => {
                const web = f.href ? webAddress(f.href) : null;
                const open = () => setViewing(f);
                return (
                  <Table.Tr key={f.id}>
                    <Table.Td>
                      <Group gap="xs" wrap="nowrap" align="flex-start">
                        <div style={{ paddingTop: 2 }}>
                          <FileIcon f={f} />
                        </div>
                        <div style={{ minWidth: 0 }}>
                          {web ? (
                            <Anchor href={web} target="_blank" rel="noopener noreferrer" size="sm" fw={500}>
                              {f.name} <IconExternalLink size={12} style={{ verticalAlign: -1 }} />
                            </Anchor>
                          ) : (
                            <Anchor component="button" type="button" size="sm" fw={500} ta="left" onClick={open}>
                              {f.name}
                            </Anchor>
                          )}
                          <Text size="xs" c="dimmed">
                            {[f.date ? formatDate(f.date) : '', f.path ? fileSize(f.size) : web ? 'a link' : 'on the network drive', `added ${formatDate(f.addedAt.slice(0, 10))}${f.addedBy ? ` by ${f.addedBy}` : ''}`].filter(Boolean).join(' · ')}
                          </Text>
                          {f.notes && (
                            <Text size="xs" lineClamp={2}>
                              {f.notes}
                            </Text>
                          )}
                        </div>
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <Badge variant="light" color={KIND_COLOR[f.kind]} style={{ whiteSpace: 'nowrap' }}>
                        {kindLabel(f.kind)}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{[f.lab, f.ref].filter(Boolean).join(' · ') || '–'}</Text>
                    </Table.Td>
                    <Table.Td>
                      {f.linked ? (
                        <Stack gap={0}>
                          <Anchor component="button" type="button" size="sm" ta="left" onClick={() => setLinking(f)}>
                            <IconLink size={12} style={{ verticalAlign: -1, marginRight: 4 }} />
                            {linkLabel(f.linked, imports)}
                          </Anchor>
                          <Text size="xs" c={ids.length ? 'dimmed' : 'orange.8'}>
                            {ids.length ? sampleSummary(ids, (id) => sampleById.get(id), siteCode) : f.linked.kind === 'job' ? 'no samples with that lab job yet' : 'its samples have gone'}
                          </Text>
                        </Stack>
                      ) : suggestion ? (
                        <Stack gap={2} align="flex-start">
                          <Button size="compact-xs" variant="light" leftSection={<IconLink size={12} />} onClick={() => void quickLink(f, suggestion)}>
                            Link to lab job {suggestion.job}
                          </Button>
                          <Text size="xs" c="dimmed">
                            {sampleSummary(suggestion.sampleIds, (id) => sampleById.get(id), siteCode)}
                          </Text>
                        </Stack>
                      ) : (
                        <Button size="compact-xs" variant="subtle" color="gray" onClick={() => setLinking(f)}>
                          Link to data…
                        </Button>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Group gap={2} wrap="nowrap" justify="flex-end">
                        {web ? (
                          <Tooltip label="Open the link">
                            <ActionIcon component="a" href={web} target="_blank" rel="noopener noreferrer" variant="subtle" aria-label={`Open ${f.name}`}>
                              <IconExternalLink size={16} />
                            </ActionIcon>
                          </Tooltip>
                        ) : (
                          <Tooltip label="Open">
                            <ActionIcon variant="subtle" onClick={open} aria-label={`Open ${f.name}`}>
                              <IconEye size={16} />
                            </ActionIcon>
                          </Tooltip>
                        )}
                        <Menu position="bottom-end" withinPortal>
                          <Menu.Target>
                            <ActionIcon variant="subtle" color="gray" aria-label={`More for ${f.name}`}>
                              <IconDots size={16} />
                            </ActionIcon>
                          </Menu.Target>
                          <Menu.Dropdown>
                            {f.path && (
                              <Menu.Item leftSection={<IconDownload size={14} />} onClick={() => void download(f)}>
                                Download
                              </Menu.Item>
                            )}
                            {f.href && !web && (
                              <Menu.Item leftSection={<IconCopy size={14} />} onClick={() => void copyPath(f)}>
                                Copy the path
                              </Menu.Item>
                            )}
                            <Menu.Item leftSection={<IconPencil size={14} />} onClick={() => setEditing(f)}>
                              Details…
                            </Menu.Item>
                            <Menu.Item leftSection={<IconLink size={14} />} onClick={() => setLinking(f)}>
                              Link to data…
                            </Menu.Item>
                            {f.linked && (
                              <Menu.Item leftSection={<IconUnlink size={14} />} onClick={() => void linkProjectFile(f, undefined)}>
                                Unlink from its data
                              </Menu.Item>
                            )}
                            <Menu.Divider />
                            <Menu.Item color="red" leftSection={<IconTrash size={14} />} onClick={() => remove(f)}>
                              Remove…
                            </Menu.Item>
                          </Menu.Dropdown>
                        </Menu>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}

      {viewing && <FileViewer file={viewing} onClose={() => setViewing(null)} />}
      {editing && <FileDetails key={editing.id} file={editing} labs={labs} onClose={() => setEditing(null)} />}
      {linking && (
        <LinkModal
          key={linking.id}
          file={linking}
          jobs={jobs}
          imports={imports}
          samples={allSamples}
          byImport={byImport}
          siteCode={siteCode}
          onClose={() => setLinking(null)}
          onShow={(search) => {
            seedViewState(`${project.id}:data.search`, search);
            seedViewState(`${project.id}:data.period`, defaultPeriod(project.yearStartMonth, 'all'));
            navigate(`/projects/${project.id}/data`);
          }}
        />
      )}
      <AddLinkModal opened={adding} projectId={project.id} labs={labs} jobs={jobs} onClose={() => setAdding(false)} />
    </Stack>
  );
}

/** A file's details: its name, kind, lab, number, date and notes – and a link's address. */
function FileDetails({ file, labs, onClose }: { file: ProjectFile; labs: string[]; onClose: () => void }) {
  const [d, setD] = useState<ProjectFile>(file);
  const [error, setError] = useState('');
  const save = async () => {
    try {
      await saveProjectFile(d, file);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Modal opened onClose={onClose} title="File details" size="lg">
      <Stack gap="sm">
        <TextInput label="Name" value={d.name} onChange={(e) => setD({ ...d, name: e.currentTarget.value })} data-autofocus />
        <Group grow align="flex-start">
          <Select label="Kind" data={FILE_KINDS} value={d.kind} onChange={(v) => v && setD({ ...d, kind: v as FileKind })} allowDeselect={false} />
          <Autocomplete label="Lab or company" data={labs} value={d.lab ?? ''} onChange={(v) => setD({ ...d, lab: v || undefined })} />
        </Group>
        <Group grow align="flex-start">
          <TextInput label="Number" description="The lab’s job or report number, or a quote number" value={d.ref ?? ''} onChange={(e) => setD({ ...d, ref: e.currentTarget.value || undefined })} />
          <DateField label="Date" description="Of the quote, report …" value={d.date} onChange={(v) => setD({ ...d, date: v })} clearable />
        </Group>
        {file.href !== undefined && <TextInput label="Link or path" value={d.href ?? ''} onChange={(e) => setD({ ...d, href: e.currentTarget.value })} error={error || undefined} />}
        <Textarea label="Notes" autosize minRows={2} value={d.notes ?? ''} onChange={(e) => setD({ ...d, notes: e.currentTarget.value || undefined })} placeholder="e.g. quote valid to 30 June; covers quarterly rounds" />
        {file.path && (
          <Text size="xs" c="dimmed">
            Kept in the shared folder: {file.path}
          </Text>
        )}
        {error && !file.href && (
          <Text size="sm" c="red">
            {error}
          </Text>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <SaveButton dirty={!same(d, file)} onClick={() => void save()} disabled={!d.name.trim()}>
            Save
          </SaveButton>
        </Group>
      </Stack>
    </Modal>
  );
}

/** What a file is linked to: a lab job (its samples – those imported later too), an import's samples, or samples chosen. */
function LinkModal({ file, jobs, imports, samples, byImport, siteCode, onClose, onShow }: {
  file: ProjectFile;
  jobs: LabJob[];
  imports: ImportBatch[];
  samples: Sample[];
  byImport: Map<string, Set<string>>;
  siteCode: (siteId: string) => string | undefined;
  onClose: () => void;
  onShow: (search: string) => void;
}) {
  const suggestion = suggestedJob(file, jobs);
  const l = file.linked;
  const [how, setHow] = useState<'job' | 'import' | 'samples' | 'none'>(l?.kind ?? (suggestion || jobs.length ? 'job' : file.fromImport ? 'import' : 'samples'));
  const [job, setJob] = useState<string | null>(l?.kind === 'job' ? l.job : (suggestion?.job ?? null));
  const [importId, setImportId] = useState<string | null>(l?.kind === 'import' ? l.importId : (file.fromImport ?? null));
  const [ids, setIds] = useState<string[]>(l ? linkedSampleIds(file, samples, byImport) : []);
  const next: FileLink | undefined = how === 'job' && job ? { kind: 'job', job } : how === 'import' && importId ? { kind: 'import', importId } : how === 'samples' && ids.length ? { kind: 'samples', sampleIds: ids } : undefined;
  const linkedIds = next ? linkedSampleIds({ linked: next }, samples, byImport) : [];
  const sampleById = useMemo(() => new Map(samples.map((s) => [s.id, s])), [samples]);
  // the samples to choose from, a group for each month, the latest first
  const sampleOptions = useMemo(() => {
    const groups = new Map<string, Array<{ value: string; label: string }>>();
    for (const s of [...samples].sort((a, b) => (a.date < b.date ? 1 : -1))) {
      const month = formatDate(`${s.date.slice(0, 7)}-01`).replace(/^\d+ /, '');
      const list = groups.get(month) ?? [];
      list.push({ value: s.id, label: `${formatDate(s.date.slice(0, 10))} · ${siteCode(s.siteId) ?? ''}${s.sampleName ? ` · ${s.sampleName}` : ''}` });
      groups.set(month, list);
    }
    return [...groups].map(([group, items]) => ({ group, items }));
  }, [samples]);
  const save = async () => {
    await linkProjectFile(file, next, next?.kind === 'job' ? `lab job ${next.job}` : next?.kind === 'import' ? `the import of ${imports.find((b) => b.id === next.importId)?.fileName ?? 'a file'}` : `${linkedIds.length} samples`);
    onClose();
  };
  // to see them in the Data tab: their lab job, or their day
  const days = [...new Set(linkedIds.map((id) => sampleById.get(id)?.date.slice(0, 10)))];
  const jobsOf = [...new Set(linkedIds.map((id) => sampleById.get(id)?.labJob))];
  const showBy = next?.kind === 'job' ? next.job : jobsOf.length === 1 && jobsOf[0] ? jobsOf[0] : days.length === 1 && days[0] ? days[0] : null;
  return (
    <Modal opened onClose={onClose} title={`Link ${file.name} to data`} size="lg">
      <Stack gap="sm">
        <SegmentedControl
          value={how}
          onChange={(v) => setHow(v as typeof how)}
          data={[
            { value: 'job', label: 'A lab job' },
            { value: 'import', label: 'An import' },
            { value: 'samples', label: 'Samples' },
            { value: 'none', label: 'Nothing' },
          ]}
        />
        {how === 'job' &&
          (jobs.length ? (
            <Select
              label="Lab job"
              description="Its samples – and any with the same job number imported later"
              searchable
              data={jobs.map((j) => ({ value: j.job, label: `${j.job}${j.lab ? ` (${j.lab})` : ''} – ${sampleSummary(j.sampleIds, (id) => sampleById.get(id), siteCode)}` }))}
              value={job}
              onChange={setJob}
              comboboxProps={{ withinPortal: true }}
            />
          ) : (
            <Text size="sm" c="dimmed">
              The project’s samples have no lab job numbers yet – they come with a lab’s file when it’s imported.
            </Text>
          ))}
        {how === 'import' &&
          (imports.length ? (
            <Select
              label="Import"
              description="The samples its results went into"
              searchable
              data={imports.map((b) => ({ value: b.id, label: `${b.fileName} – imported ${formatDate(b.importedAt.slice(0, 10))} (${b.samples} sample${b.samples === 1 ? '' : 's'})` }))}
              value={importId}
              onChange={setImportId}
              comboboxProps={{ withinPortal: true }}
            />
          ) : (
            <Text size="sm" c="dimmed">
              Nothing’s been imported into this project yet.
            </Text>
          ))}
        {how === 'samples' && <MultiSelect label="Samples" placeholder="Search by date or site…" searchable clearable data={sampleOptions} value={ids} onChange={setIds} maxDropdownHeight={280} comboboxProps={{ withinPortal: true }} />}
        <Text size="sm">{how === 'none' ? 'It won’t be linked to any data.' : next ? (linkedIds.length ? `Linked to ${sampleSummary(linkedIds, (id) => sampleById.get(id), siteCode)}.` : 'No samples with it yet – they’ll show it when they’re imported.') : 'Choose what it’s about.'}</Text>
        <Text size="xs" c="dimmed">
          A file linked to samples shows in their details on the Data tab, and the samples are marked with a paperclip there.
        </Text>
        <Group justify="space-between">
          <div>
            {l && showBy && (
              <Button variant="subtle" size="xs" onClick={() => onShow(showBy)}>
                Show them in the Data tab
              </Button>
            )}
          </div>
          <Group gap="xs">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={how !== 'none' && !next}>
              {how === 'none' ? 'Unlink' : 'Link'}
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}

/** A link to a file kept elsewhere: a SharePoint or web address, or a path on the network drive. */
function AddLinkModal({ opened, projectId, labs, jobs, onClose }: { opened: boolean; projectId: string; labs: string[]; jobs: LabJob[]; onClose: () => void }) {
  const [target, setTarget] = useState('');
  const [name, setName] = useState('');
  const [named, setNamed] = useState(false);
  const [kind, setKind] = useState<FileKind | null>(null);
  const [lab, setLab] = useState('');
  const href = target.trim() ? linkTarget(target) : null;
  const reset = () => {
    setTarget('');
    setName('');
    setNamed(false);
    setKind(null);
    setLab('');
  };
  const add = async () => {
    try {
      const f = await addProjectLink(projectId, target, { name, kind: kind ?? undefined, lab: lab || undefined }, jobs);
      notifications.show({ color: 'teal', message: `${f.name} added.` });
      reset();
      onClose();
    } catch (e) {
      notifications.show({ color: 'red', message: (e as Error).message });
    }
  };
  return (
    <Modal
      opened={opened}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Add a link to a file"
      size="lg"
    >
      <Stack gap="sm">
        <TextInput
          label="Link or path"
          placeholder="https://…sharepoint.com/…  or  G:\Clients\…\Quote.pdf"
          value={target}
          onChange={(e) => {
            const v = e.currentTarget.value;
            setTarget(v);
            if (!named) setName(v.trim() && linkTarget(v) ? nameOfTarget(linkTarget(v)!) : '');
          }}
          error={target.trim() && !href ? 'Paste a web link (https://…) or a path (G:\\… or \\\\server\\…)' : undefined}
          data-autofocus
        />
        <TextInput
          label="Name"
          value={name}
          onChange={(e) => {
            setName(e.currentTarget.value);
            setNamed(true);
          }}
          placeholder="What it is, e.g. Hill Labs quote 2026"
        />
        <Group grow align="flex-start">
          <Select label="Kind" placeholder="Worked out from its name" data={FILE_KINDS} value={kind} onChange={(v) => setKind(v as FileKind | null)} clearable />
          <Autocomplete label="Lab or company" data={labs} value={lab} onChange={setLab} />
        </Group>
        <Text size="xs" c="dimmed">
          A web link (SharePoint, OneDrive …) opens in a new tab. A path (G:\…) is copied for File Explorer – or opened here, when it’s in your projects folder.
        </Text>
        <Group justify="flex-end">
          <Button
            variant="default"
            onClick={() => {
              reset();
              onClose();
            }}
          >
            Cancel
          </Button>
          <Button onClick={() => void add()} disabled={!href || !(name.trim() || nameOfTarget(href))}>
            Add the link
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
