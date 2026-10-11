import { useMemo, useRef, useState } from 'react';
import { Accordion, Alert, Badge, Button, Card, Drawer, Group, Menu, SegmentedControl, Select, Stack, Table, Text, TextInput, ActionIcon, Textarea } from '@mantine/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Link } from 'react-router-dom';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { IconDownload, IconFileSpreadsheet, IconHistory, IconTrash, IconUpload, IconArrowBackUp, IconDeviceFloppy, IconFileTypeDocx, IconSparkles } from '@tabler/icons-react';
import { useProject } from '../../hooks/useProjectData';
import { EmptyState, GuidelinePicker, ParamPicker, PeriodPicker, SitePicker, defaultPeriod, type PeriodValue, DateField } from '../../components/common';
import { displayValue, evaluateAll, flagResults, pivot, type PivotRow } from '../../lib/analysis';
import { formatDate } from '../../lib/dates';
import { unitLabel } from '../../lib/units';
import { exportPivotCsv, exportPivotXlsx } from '../../reports/excel';
import { deleteImport, deleteSamples } from '../../db/repo';
import { db } from '../../db/db';
import type { ReportBlock, Result, Sample } from '../../db/types';
import { adhocTemplate, exportReport } from '../../reports/export';
import { useSettings } from '../../hooks/useSettings';
import { parseValue } from '../../lib/values';
import { AiInputModal } from '../../components/AiInputModal';

function Legend({ guidelineNames }: { guidelineNames: string[] }) {
  return (
    <Group gap="lg" wrap="wrap">
      <Text size="xs">
        <span className="hl-swatch" style={{ background: 'var(--edb-hl-limit)' }} />
        Consent limit exceeded
      </Text>
      <Text size="xs">
        <span className="hl-swatch" style={{ background: 'var(--edb-hl-guideline)' }} />
        Trigger / guideline exceeded{guidelineNames.length ? ` (${guidelineNames.join(', ')})` : ''}
      </Text>
      <Text size="xs">
        <span className="hl-swatch" style={{ background: 'var(--edb-hl-check)' }} />
        Detection limit above limit
      </Text>
      <Text size="xs" c="dimmed">
        &lt; = below detection limit · hover a cell for details · click a row to edit
      </Text>
    </Group>
  );
}

function cellClass(f?: { kind: string }) {
  return f ? (f.kind === 'limit' ? 'hl-limit' : f.kind === 'guideline' ? 'hl-guideline' : 'hl-check') : '';
}

function SampleDrawer({ sample, onClose }: { sample: Sample | null; onClose: () => void }) {
  const { sites, index, paramMap } = useProject();
  // remounted (via key) whenever a different sample is opened
  const [s, setDraft] = useState<Sample | null>(sample ? { ...sample } : null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  if (!s) return null;
  const results = (index.bySample.get(s.id) ?? []).slice().sort((a, b) => (paramMap.get(a.parameterId)?.order ?? 0) - (paramMap.get(b.parameterId)?.order ?? 0));
  const save = async () => {
    await db.transaction('rw', db.samples, db.results, async () => {
      await db.samples.put(s);
      for (const r of results) {
        const patch: Partial<Result> = { siteId: s.siteId, date: s.date };
        if (edits[r.id] !== undefined) {
          const pv = parseValue(edits[r.id]);
          Object.assign(patch, { value: pv.value, qualifier: pv.qualifier, text: pv.text, dl: pv.dl });
        }
        await db.results.update(r.id, patch);
      }
    });
    notifications.show({ message: 'Sample saved', color: 'teal' });
    onClose();
  };
  return (
    <Drawer opened={!!sample} onClose={onClose} position="right" size="lg" title={<Text fw={600}>Sample {s.sampleName ?? ''}</Text>}>
      <Stack gap="sm">
        <Group grow>
          <Select label="Site" data={sites.map((x) => ({ value: x.id, label: x.code }))} value={s.siteId} onChange={(v) => v && setDraft({ ...s, siteId: v })} allowDeselect={false} />
          <DateField label="Date" value={s.date.slice(0, 10)} onChange={(v) => v && setDraft({ ...s, date: v + s.date.slice(10) })} />
          <TextInput label="Time" value={s.date.slice(11, 16)} placeholder="hh:mm" onChange={(e) => {
            const t = e.currentTarget.value;
            setDraft({ ...s, date: /^\d{2}:\d{2}$/.test(t) ? `${s.date.slice(0, 10)}T${t}` : s.date.slice(0, 10) });
          }} />
        </Group>
        <Group grow>
          <TextInput label="Lab job" value={s.labJob ?? ''} onChange={(e) => setDraft({ ...s, labJob: e.currentTarget.value })} />
          <TextInput label="Lab number" value={s.labNumber ?? ''} onChange={(e) => setDraft({ ...s, labNumber: e.currentTarget.value })} />
        </Group>
        <Textarea label="Notes" autosize minRows={2} value={s.notes ?? ''} onChange={(e) => setDraft({ ...s, notes: e.currentTarget.value })} placeholder="e.g. sampled after heavy rain" />
        <Text fw={600} size="sm" mt="xs">
          Results ({results.length})
        </Text>
        <Table withTableBorder>
          <Table.Tbody>
            {results.map((r) => {
              const p = paramMap.get(r.parameterId);
              return (
                <Table.Tr key={r.id}>
                  <Table.Td>{p?.name ?? r.parameterId}</Table.Td>
                  <Table.Td w={140}>
                    <TextInput size="xs" value={edits[r.id] ?? (r.value === null ? r.text ?? '' : `${r.qualifier}${r.value}`)} onChange={(e) => setEdits({ ...edits, [r.id]: e.currentTarget.value })} />
                  </Table.Td>
                  <Table.Td w={90}>
                    <Text size="xs" c="dimmed">
                      {unitLabel(r.unit)}
                    </Text>
                  </Table.Td>
                  <Table.Td w={36}>
                    <ActionIcon variant="subtle" color="red" size="sm" aria-label="Delete result" onClick={async () => { await db.results.delete(r.id); }}>
                      <IconTrash size={14} />
                    </ActionIcon>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
        <Group justify="space-between" mt="sm">
          <Button
            color="red"
            variant="light"
            leftSection={<IconTrash size={16} />}
            onClick={() =>
              modals.openConfirmModal({
                title: 'Delete sample?',
                children: <Text size="sm">This deletes the sample and its {results.length} results.</Text>,
                labels: { confirm: 'Delete', cancel: 'Cancel' },
                confirmProps: { color: 'red' },
                onConfirm: async () => {
                  await deleteSamples([s.id]);
                  onClose();
                },
              })
            }
          >
            Delete sample
          </Button>
          <Button leftSection={<IconDeviceFloppy size={16} />} onClick={save}>
            Save changes
          </Button>
        </Group>
      </Stack>
    </Drawer>
  );
}

function SamplesAsRows({ rows, columns, flags, onRow }: { rows: PivotRow[]; columns: ReturnType<typeof pivot>['columns']; flags: Map<string, { kind: string; messages: string[] }>; onRow: (s: Sample) => void }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({ count: rows.length, getScrollElement: () => parentRef.current, estimateSize: () => 27, overscan: 12 });
  const items = v.getVirtualItems();
  const padTop = items.length ? items[0].start : 0;
  const padBottom = items.length ? v.getTotalSize() - items[items.length - 1].end : 0;
  return (
    <div ref={parentRef} style={{ maxHeight: 'calc(100vh - 330px)', minHeight: 300, overflow: 'auto', border: '1px solid var(--edb-grid)', borderRadius: 8 }}>
      <table className="edb-grid">
        <thead>
          <tr>
            <th className="sticky-col" style={{ minWidth: 110 }}>
              Date
            </th>
            <th className="sticky-col-2">Site</th>
            {columns.map((p) => (
              <th key={p.id} title={p.name} style={{ maxWidth: 140, whiteSpace: 'normal', minWidth: 80 }}>
                {p.short ?? p.name}
              </th>
            ))}
          </tr>
          <tr>
            <th className="sticky-col" />
            <th className="sticky-col-2" />
            {columns.map((p) => (
              <th key={p.id}>{unitLabel(p.unit)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {padTop > 0 && (
            <tr>
              <td style={{ height: padTop, padding: 0, border: 0 }} colSpan={columns.length + 2} />
            </tr>
          )}
          {items.map((it) => {
            const row = rows[it.index];
            return (
              <tr key={row.sample.id} className="clickable-row" onClick={() => onRow(row.sample)}>
                <td className="sticky-col tabular" title={row.sample.sampleName}>
                  {formatDate(row.sample.date, { time: true })}
                </td>
                <td className="sticky-col-2">{row.site.code}</td>
                {columns.map((p) => {
                  const r = row.cells.get(p.id);
                  if (!r) return <td key={p.id} />;
                  const f = flags.get(r.id);
                  return (
                    <td key={p.id} className={`num ${cellClass(f)} ${r.qualifier === '<' ? 'nd' : ''}`} title={[f?.messages.join('\n'), r.text && r.text !== String(r.value) ? `Reported: ${r.text} ${r.unit}` : ''].filter(Boolean).join('\n') || undefined}>
                      {displayValue(r, p).text}
                    </td>
                  );
                })}
              </tr>
            );
          })}
          {padBottom > 0 && (
            <tr>
              <td style={{ height: padBottom, padding: 0, border: 0 }} colSpan={columns.length + 2} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function ParamsAsRows({ rows, columns, flags, onRow }: { rows: PivotRow[]; columns: ReturnType<typeof pivot>['columns']; flags: Map<string, { kind: string; messages: string[] }>; onRow: (s: Sample) => void }) {
  const shown = rows.slice(-120);
  return (
    <Stack gap={4}>
      {rows.length > shown.length && (
        <Text size="xs" c="dimmed">
          Showing the most recent {shown.length} of {rows.length} samples – narrow the period or switch layout to see all.
        </Text>
      )}
      <div style={{ maxHeight: 'calc(100vh - 330px)', minHeight: 300, overflow: 'auto', border: '1px solid var(--edb-grid)', borderRadius: 8 }}>
        <table className="edb-grid" style={{ ['--edb-col1' as string]: '220px' }}>
          <thead>
            <tr>
              <th className="sticky-col" style={{ minWidth: 220 }}>
                Parameter
              </th>
              <th className="sticky-col-2">Unit</th>
              {shown.map((r) => (
                <th key={r.sample.id} className="clickable-row" onClick={() => onRow(r.sample)}>
                  {r.site.code}
                </th>
              ))}
            </tr>
            <tr>
              <th className="sticky-col" />
              <th className="sticky-col-2" />
              {shown.map((r) => (
                <th key={r.sample.id}>{formatDate(r.sample.date)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {columns.map((p) => (
              <tr key={p.id}>
                <td className="sticky-col">{p.name}</td>
                <td className="sticky-col-2">{unitLabel(p.unit)}</td>
                {shown.map((row) => {
                  const r = row.cells.get(p.id);
                  if (!r) return <td key={row.sample.id} />;
                  const f = flags.get(r.id);
                  return (
                    <td key={row.sample.id} className={`num ${cellClass(f)} ${r.qualifier === '<' ? 'nd' : ''}`} title={f?.messages.join('\n')}>
                      {displayValue(r, p).text}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Stack>
  );
}

function ImportHistory() {
  const { imports } = useProject();
  if (!imports.length) return null;
  return (
    <Accordion variant="contained">
      <Accordion.Item value="imports">
        <Accordion.Control icon={<IconHistory size={16} />}>Import history ({imports.length})</Accordion.Control>
        <Accordion.Panel>
          <Table.ScrollContainer minWidth={600}>
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Imported</Table.Th>
                  <Table.Th>File</Table.Th>
                  <Table.Th>Type</Table.Th>
                  <Table.Th ta="right">Samples</Table.Th>
                  <Table.Th ta="right">Results</Table.Th>
                  <Table.Th ta="right">Replaced / skipped</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {imports.map((im) => (
                  <Table.Tr key={im.id}>
                    <Table.Td>{new Date(im.importedAt).toLocaleString('en-NZ')}</Table.Td>
                    <Table.Td>{im.fileName}</Table.Td>
                    <Table.Td>
                      <Badge variant="light">{im.kind === 'lab' ? 'Lab results' : im.kind === 'wide' ? 'Spreadsheet' : 'Table'}</Badge>
                    </Table.Td>
                    <Table.Td ta="right">{im.samples}</Table.Td>
                    <Table.Td ta="right">{im.results}</Table.Td>
                    <Table.Td ta="right">
                      {im.replaced} / {im.skipped}
                    </Table.Td>
                    <Table.Td>
                      <Button
                        size="compact-xs"
                        variant="subtle"
                        color="red"
                        leftSection={<IconArrowBackUp size={14} />}
                        onClick={() =>
                          modals.openConfirmModal({
                            title: 'Undo this import?',
                            children: <Text size="sm">Removes the {im.results} results added by “{im.fileName}”. Results it replaced are not restored.</Text>,
                            labels: { confirm: 'Undo import', cancel: 'Cancel' },
                            confirmProps: { color: 'red' },
                            onConfirm: () => deleteImport(im.id),
                          })
                        }
                      >
                        Undo
                      </Button>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  );
}

export function DataTab() {
  const data = useProject();
  const { project, sites, params, guidelineSets, setMap, index } = data;
  const [period, setPeriod] = useState<PeriodValue>(() => defaultPeriod(project.yearStartMonth, 'all'));
  const [siteIds, setSiteIds] = useState<string[]>([]);
  const [paramIds, setParamIds] = useState<string[]>([]);
  const [setIds, setSetIds] = useState<string[]>(project.guidelineSetIds);
  const [layout, setLayout] = useState<'samplesAsRows' | 'parametersAsRows'>('samplesAsRows');
  const [selected, setSelected] = useState<Sample | null>(null);
  const withData = useMemo(() => new Set(index.paramIdsWithData), [index]);

  const { columns, rows } = useMemo(() => pivot(data, { siteIds, paramIds, start: period.start, end: period.end }), [data, siteIds, paramIds, period]);
  const flags = useMemo(() => flagResults(data, evaluateAll(data, period.start, period.end), setIds, period.start, period.end), [data, setIds, period]);
  const guidelineNames = setIds.map((id) => setMap.get(id)?.shortName ?? '').filter(Boolean);
  const settings = useSettings();
  const [wordBusy, setWordBusy] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const exportWord = async () => {
    setWordBusy(true);
    try {
      // "All data" → use the actual date range of the data
      const p = period.key === 'all' ? { ...period, start: index.dates.min?.slice(0, 10) ?? period.start, end: index.dates.max?.slice(0, 10) ?? period.end, label: 'all data' } : period;
      const blocks: ReportBlock[] = [
        { id: 'h', type: 'heading', text: `Monitoring results – ${p.label}`, level: 1 },
        {
          id: 'r',
          type: 'resultsTable',
          title: 'Monitoring results',
          siteIds,
          parameterIds: paramIds,
          layout: layout === 'samplesAsRows' ? 'parametersAsColumns' : 'parametersAsRows',
          guidelineSetIds: setIds,
          highlight: true,
          splitBySite: layout !== 'samplesAsRows',
        },
      ];
      await exportReport('docx', { bundle: data, template: adhocTemplate('Results table', blocks), period: p, settings });
    } catch (e) {
      notifications.show({ title: 'Export failed', message: (e as Error).message, color: 'red' });
    } finally {
      setWordBusy(false);
    }
  };

  if (!data.samples.length)
    return (
      <EmptyState
        title="No monitoring data yet"
        action={
          <Button component={Link} to={`/projects/${project.id}/import`} leftSection={<IconUpload size={16} />}>
            Import results
          </Button>
        }
      >
        Import Hill Labs Excel results, a master spreadsheet (dates per row, analytes per column) or a long table.
      </EmptyState>
    );

  const exportArgs = {
    title: `${project.name} – monitoring results (${period.label})`,
    columns,
    rows,
    flags,
    guidelineNames,
    layout,
    fileName: `${project.name} results ${period.start.startsWith('1900') ? 'all' : `${period.start} to ${period.end}`}`,
  };

  return (
    <Stack gap="md">
      <Card padding="md">
        <Group align="flex-end" gap="sm" wrap="wrap">
          <PeriodPicker value={period} onChange={setPeriod} yearStartMonth={project.yearStartMonth} />
          <SitePicker sites={sites} value={siteIds} onChange={setSiteIds} w={240} />
          <ParamPicker params={params} value={paramIds} onChange={setParamIds} onlyIds={withData} w={300} />
          <GuidelinePicker sets={guidelineSets} value={setIds} onChange={setSetIds} w={300} />
          <SegmentedControl
            value={layout}
            onChange={(v) => setLayout(v as typeof layout)}
            data={[
              { value: 'samplesAsRows', label: 'Dates down' },
              { value: 'parametersAsRows', label: 'Dates across' },
            ]}
          />
          <Menu>
            <Menu.Target>
              <Button variant="default" leftSection={<IconDownload size={16} />} loading={wordBusy}>
                Export
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item leftSection={<IconFileTypeDocx size={16} />} onClick={exportWord}>
                Word (formatted tables, landscape)
              </Menu.Item>
              <Menu.Item leftSection={<IconFileSpreadsheet size={16} />} onClick={() => exportPivotXlsx(exportArgs)}>
                Excel (with highlighting)
              </Menu.Item>
              <Menu.Item leftSection={<IconDownload size={16} />} onClick={() => exportPivotCsv(exportArgs)}>
                CSV
              </Menu.Item>
              <Menu.Divider />
              <Menu.Item leftSection={<IconSparkles size={16} />} onClick={() => setAiOpen(true)}>
                Copy for AI input (this period, sites and parameters)
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Card>
      <Group justify="space-between">
        <Legend guidelineNames={guidelineNames} />
        <Text size="sm" c="dimmed">
          {rows.length} samples · {columns.length} parameters
        </Text>
      </Group>
      {project.hardnessAdjust && setIds.some((id) => setMap.get(id)?.values.some((v) => v.hardness)) && (
        <Alert variant="light" color="blue" py={6}>
          <Text size="xs">Hardness-dependent metals are compared with hardness-modified values where hardness was measured in the same sample (ANZECC 2000). Change this in Setup.</Text>
        </Alert>
      )}
      {rows.length ? (
        layout === 'samplesAsRows' ? <SamplesAsRows rows={rows} columns={columns} flags={flags} onRow={setSelected} /> : <ParamsAsRows rows={rows} columns={columns} flags={flags} onRow={setSelected} />
      ) : (
        <EmptyState title="No results match the filters" />
      )}
      <ImportHistory />
      <SampleDrawer key={selected?.id ?? 'none'} sample={selected} onClose={() => setSelected(null)} />
      <AiInputModal opened={aiOpen} onClose={() => setAiOpen(false)} start={{ period, siteIds, paramIds }} />
    </Stack>
  );
}
