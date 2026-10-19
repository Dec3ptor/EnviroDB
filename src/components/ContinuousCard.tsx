// Rainfall, flow and water level for a project: import a gauge's data file (a council's export, NIWA's CliFlo, a
// logger's CSV) as daily values, to show behind the graphs and with each sample.

import { useEffect, useMemo, useRef, useState } from 'react';
import { ActionIcon, Alert, Button, Card, FileButton, Group, Modal, SegmentedControl, Select, Stack, Table, Text, TextInput, Title, Tooltip } from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { useLocation } from 'react-router-dom';
import { IconCloudRain, IconPencil, IconPlus, IconTrash, IconUpload } from '@tabler/icons-react';
import type { ContinuousSeries, SeriesKind } from '../db/types';
import { readWorkbook, type SheetGrid } from '../importers/workbook';
import { dailyValues, findContinuous, KIND_TEXT, type FoundTable } from '../lib/continuous';
import { addSeriesDays, deleteSeries, saveSeries } from '../db/continuous';
import { formatDate } from '../lib/dates';
import { fmtNum } from '../lib/values';

const DEFAULT_UNIT: Record<SeriesKind, string> = { rainfall: 'mm', flow: 'm³/s', level: 'm', other: '' };
const KINDS = (['rainfall', 'flow', 'level', 'other'] as SeriesKind[]).map((k) => ({ value: k, label: KIND_TEXT[k] }));

function ImportModal({ projectId, series, into, onClose }: { projectId: string; series: ContinuousSeries[]; into: ContinuousSeries | null | undefined; onClose: () => void }) {
  const opened = into !== undefined;
  const [file, setFile] = useState<{ name: string; grids: SheetGrid[]; table: FoundTable } | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const [col, setCol] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<SeriesKind>('rainfall');
  const [unit, setUnit] = useState('mm');
  const [target, setTarget] = useState<string>('new');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!opened) return;
    setFile(null);
    setError('');
    setTarget(into ? into.id : 'new');
  }, [opened, into]);

  const read = async (f: File | null) => {
    if (!f) return;
    setReading(true);
    setError('');
    try {
      const grids = await readWorkbook(await f.arrayBuffer(), f.name);
      const table = findContinuous(grids);
      if (!table || !table.columns.length) throw new Error('No dates with readings beside them were found in this file.');
      setFile({ name: f.name, grids, table });
      const first = table.columns.find((c) => into && c.kind === into.kind) ?? table.columns.find((c) => c.kind !== 'other') ?? table.columns[0];
      setCol(String(first.col));
      const k = into?.kind ?? first.kind;
      setKind(k === 'other' && first.unit === 'mm' ? 'rainfall' : k);
      setUnit(into?.unit ?? (first.unit || DEFAULT_UNIT[k]));
      setName(into?.name ?? f.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim());
    } catch (e) {
      setFile(null);
      setError((e as Error).message);
    } finally {
      setReading(false);
    }
  };

  const days = useMemo(() => (file && col !== null ? dailyValues(file.grids[file.table.sheet], file.table, Number(col), kind) : null), [file, col, kind]);
  const stats = useMemo(() => {
    if (!days?.size) return null;
    const list = [...days];
    const top = list.reduce((a, b) => (b[1].v > a[1].v ? b : a));
    const total = list.reduce((n, [, d]) => n + d.v, 0);
    return { n: list.length, first: list[0][0], last: list[list.length - 1][0], top, total };
  }, [days]);
  const into2 = target === 'new' ? undefined : series.find((s) => s.id === target);

  const add = async () => {
    if (!days?.size || !file) return;
    setBusy(true);
    try {
      const s = await addSeriesDays(projectId, days, { name, kind, unit, source: file.name }, into2);
      notifications.show({ color: 'teal', title: `${s.name}: ${days.size} days added`, message: `Records from ${formatDate(s.first)} to ${formatDate(s.last)}. Choose it on the Graphs tab to show it behind the graphs.` });
      onClose();
    } catch (e) {
      notifications.show({ color: 'red', title: 'Not added', message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title={into ? `Add records to ${into.name}` : 'Add rainfall, flow or level'} size="lg">
      <Stack gap="sm">
        <Text size="sm">
          A gauge’s data file – the council’s export, NIWA’s CliFlo, a logger’s CSV or a spreadsheet: a column of dates (and times), and the readings beside them. It’s kept as daily values: rainfall the day’s total, flow
          and level the day’s mean and highest.
        </Text>
        <Group gap="xs">
          <FileButton accept=".csv,.txt,.xlsx,.xls,.xlsm,.ods,text/csv" onChange={(f) => void read(f)}>
            {(props) => (
              <Button {...props} leftSection={<IconUpload size={16} />} variant={file ? 'default' : 'filled'} loading={reading}>
                {file ? 'Another file' : 'Choose the file'}
              </Button>
            )}
          </FileButton>
          {file && (
            <Text size="sm" c="dimmed">
              {file.name}: {file.table.rows.toLocaleString('en-NZ')} readings{file.table.subDaily ? ' (several a day)' : ''}, {formatDate(file.table.first.slice(0, 10))} to {formatDate(file.table.last.slice(0, 10))}
            </Text>
          )}
        </Group>
        {error && (
          <Alert color="orange" variant="light" p="xs">
            <Text size="sm">{error}</Text>
          </Alert>
        )}
        {file && (
          <>
            {file.table.columns.length > 1 && (
              <Select
                label="The readings"
                data={file.table.columns.map((c) => ({ value: String(c.col), label: `${c.name}${c.unit ? ` (${c.unit})` : ''} – ${c.count.toLocaleString('en-NZ')} readings` }))}
                value={col}
                onChange={(v) => {
                  setCol(v);
                  const c = file.table.columns.find((x) => String(x.col) === v);
                  if (c && !into) {
                    setKind(c.kind);
                    setUnit(c.unit || DEFAULT_UNIT[c.kind]);
                  }
                }}
                allowDeselect={false}
              />
            )}
            <Select
              label="Add to"
              data={[{ value: 'new', label: 'A new series' }, ...series.map((s) => ({ value: s.id, label: `${s.name} (${KIND_TEXT[s.kind].toLowerCase()})` }))]}
              value={target}
              onChange={(v) => {
                setTarget(v ?? 'new');
                const s = series.find((x) => x.id === v);
                if (s) {
                  setName(s.name);
                  setKind(s.kind);
                  setUnit(s.unit);
                }
              }}
              allowDeselect={false}
              description={target !== 'new' ? 'Days already kept are replaced by this file’s.' : undefined}
            />
            <TextInput label="Name" placeholder="e.g. Kōwhai at Quarry Rd rain gauge" value={name} onChange={(e) => setName(e.currentTarget.value)} disabled={target !== 'new'} />
            <Group grow align="flex-end">
              <div>
                <Text size="sm" fw={500} mb={4}>
                  What it is
                </Text>
                <SegmentedControl
                  fullWidth
                  size="xs"
                  data={KINDS}
                  value={kind}
                  disabled={target !== 'new'}
                  onChange={(v) => {
                    setKind(v as SeriesKind);
                    if (!unit || Object.values(DEFAULT_UNIT).includes(unit)) setUnit(DEFAULT_UNIT[v as SeriesKind]);
                  }}
                />
              </div>
              <TextInput label="Unit" value={unit} onChange={(e) => setUnit(e.currentTarget.value)} disabled={target !== 'new'} maw={140} />
            </Group>
            {stats && (
              <Text size="sm">
                {stats.n.toLocaleString('en-NZ')} days, {formatDate(stats.first)} to {formatDate(stats.last)}.{' '}
                {kind === 'rainfall'
                  ? `${fmtNum(stats.total)} ${unit} in all; the wettest day ${fmtNum(stats.top[1].v)} ${unit} on ${formatDate(stats.top[0])}.`
                  : `Highest daily mean ${fmtNum(stats.top[1].v)} ${unit} on ${formatDate(stats.top[0])}.`}
              </Text>
            )}
          </>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button leftSection={<IconPlus size={16} />} disabled={!stats || !name.trim()} loading={busy} onClick={() => void add()}>
            Add {stats ? `${stats.n.toLocaleString('en-NZ')} days` : ''}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function EditModal({ series, onClose }: { series: ContinuousSeries | null; onClose: () => void }) {
  const [draft, setDraft] = useState<ContinuousSeries | null>(series);
  useEffect(() => setDraft(series), [series]);
  return (
    <Modal opened={!!series} onClose={onClose} title="Rainfall, flow or level">
      {draft && series && (
        <Stack gap="sm">
          <TextInput label="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.currentTarget.value })} data-autofocus />
          <SegmentedControl fullWidth size="xs" data={KINDS} value={draft.kind} onChange={(v) => setDraft({ ...draft, kind: v as SeriesKind })} />
          <TextInput label="Unit" value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.currentTarget.value })} />
          <TextInput label="Where the records came from" value={draft.source ?? ''} onChange={(e) => setDraft({ ...draft, source: e.currentTarget.value || undefined })} />
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button
              disabled={!draft.name.trim()}
              onClick={() => {
                void saveSeries({ ...draft, name: draft.name.trim() }, series);
                onClose();
              }}
            >
              Save
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}

export function ContinuousCard({ projectId, series, dayCounts }: { projectId: string; series: ContinuousSeries[]; dayCounts: Map<string, number> }) {
  const [importing, setImporting] = useState<ContinuousSeries | null | undefined>(undefined);
  const [editing, setEditing] = useState<ContinuousSeries | null>(null);
  const loc = useLocation();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (loc.hash === '#continuous') ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [loc.hash]);
  return (
    <Card ref={ref} style={{ scrollMarginTop: 72 }}>
      <Group justify="space-between" mb="sm" align="flex-start">
        <div style={{ flex: '1 1 300px' }}>
          <Title order={4}>Rainfall and flow</Title>
          <Text size="sm" c="dimmed">
            A rain gauge’s or flow recorder’s records, from its data file, to show behind the graphs (and in reports) and with each sample: how wet it was when it was taken.
          </Text>
        </div>
        <Button leftSection={<IconCloudRain size={16} />} onClick={() => setImporting(null)}>
          Add from a file
        </Button>
      </Group>
      {series.length ? (
        <Table.ScrollContainer minWidth={640}>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Name</Table.Th>
                <Table.Th>What</Table.Th>
                <Table.Th>Records</Table.Th>
                <Table.Th>From</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {series.map((s) => (
                <Table.Tr key={s.id}>
                  <Table.Td>{s.name}</Table.Td>
                  <Table.Td>
                    {KIND_TEXT[s.kind]}
                    {s.unit ? ` (${s.unit})` : ''}
                  </Table.Td>
                  <Table.Td>
                    {s.first ? `${formatDate(s.first)} – ${formatDate(s.last)}` : '–'}
                    <Text size="xs" c="dimmed">
                      {(dayCounts.get(s.id) ?? 0).toLocaleString('en-NZ')} days
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed" lineClamp={2} maw={240}>
                      {s.source}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Group gap={4} justify="flex-end" wrap="nowrap">
                      <Tooltip label="Add records from another file">
                        <ActionIcon variant="subtle" onClick={() => setImporting(s)} aria-label="Add records">
                          <IconUpload size={16} />
                        </ActionIcon>
                      </Tooltip>
                      <ActionIcon variant="subtle" onClick={() => setEditing(s)} aria-label="Edit">
                        <IconPencil size={16} />
                      </ActionIcon>
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        aria-label="Delete"
                        onClick={() =>
                          modals.openConfirmModal({
                            title: `Delete ${s.name}?`,
                            children: <Text size="sm">Its records are deleted from the project; graphs and reports that show it no longer do.</Text>,
                            labels: { confirm: 'Delete', cancel: 'Cancel' },
                            confirmProps: { color: 'red' },
                            onConfirm: () => void deleteSeries(s.id),
                          })
                        }
                      >
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      ) : (
        <Text size="sm" c="dimmed">
          None yet. Councils publish their rain gauges’ and flow sites’ records (Environment Data portals, Hilltop), and NIWA’s CliFlo has rainfall for climate stations – download a CSV and add it here.
        </Text>
      )}
      <ImportModal projectId={projectId} series={series} into={importing} onClose={() => setImporting(undefined)} />
      <EditModal series={editing} onClose={() => setEditing(null)} />
    </Card>
  );
}
