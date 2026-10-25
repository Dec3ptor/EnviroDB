import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Accordion, Badge, Button, Card, Drawer, Group, Menu, NumberInput, Pill, Popover, SegmentedControl, Select, Stack, Table, Text, TextInput, ActionIcon, Textarea, UnstyledButton, CloseButton, Tooltip } from '@mantine/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Link } from 'react-router-dom';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { IconDownload, IconFileSpreadsheet, IconHistory, IconTrash, IconUpload, IconArrowBackUp, IconFileTypeDocx, IconSparkles, IconArrowUp, IconArrowDown, IconChevronDown, IconFilter, IconSearch, IconSortAscending, IconSortDescending, IconEyeOff, IconCloudRain, IconChecks, IconMessage } from '@tabler/icons-react';
import { excludeResult, restoreResults } from '../../db/qa';
import { useProject } from '../../hooks/useProjectData';
import { ConsentViewControl, EmptyState, GuidelinePicker, ParamPicker, PeriodPicker, SitePicker, consentPresets, defaultPeriod, type PeriodValue, DateField } from '../../components/common';
import { consentParameterIds, countWithData, displayValue, evaluateAll, flagResults, pivot, type ConsentView, type PivotRow, type CellFlag } from '../../lib/analysis';
import { formatDate } from '../../lib/dates';
import { unitLabel } from '../../lib/units';
import { exportPivotCsv, exportPivotXlsx } from '../../reports/excel';
import { deleteImport, deleteSamples, saveEdited, setResultComment, setReviewed } from '../../db/repo';
import { db } from '../../db/db';
import { compareParams } from '../../data/parameters';

/** A parameter id no result has, so the table shows nothing rather than everything when a view has no parameters. */
const NO_PARAMETERS = '\u0000none';
import type { ReportBlock, Result, Sample } from '../../db/types';
import { adhocTemplate, exportReport } from '../../reports/export';
import { useSettings } from '../../hooks/useSettings';
import { fmtNum, parseValue } from '../../lib/values';
import { rainAround, rainSeries } from '../../lib/continuous';
import { cellClass, SET_COLOURS, setColourIndex } from '../../lib/highlight';
import { AiInputModal } from '../../components/AiInputModal';
import { reviveIds, revivePeriod, useViewState } from '../../hooks/useViewState';
import { applyView, DEFAULT_SORT, describeFilter, FILTER_OPS, SHOW_ROWS, sortLabel, type FilterOp, type ShowRows, type SortKey, type SortState, type ValueFilter } from '../../lib/tableView';
import type { Parameter } from '../../db/types';
import { SaveButton } from '../../components/Unsaved';
import { same } from '../../sync/model';
import { useFeature } from '../../hooks/useFeatures';

function Legend({ guidelineNames, hardness }: { guidelineNames: string[]; hardness?: boolean }) {
  return (
    <Group gap="lg" wrap="wrap">
      <Text size="xs">
        <span className="hl-swatch" style={{ background: 'var(--edb-hl-limit)' }} />
        Consent limit exceeded
      </Text>
      <Text size="xs">
        <span className="hl-swatch" style={{ background: 'var(--edb-hl-guideline)' }} />
        Trigger{guidelineNames.length ? ` or ${guidelineNames[0]}` : ''} exceeded
      </Text>
      {guidelineNames.slice(1).map((name, i) => (
        <Text size="xs" key={name}>
          <span className="hl-swatch" style={{ background: SET_COLOURS[setColourIndex(i + 1)].fill }} />
          {name} exceeded
        </Text>
      ))}
      <Text size="xs">
        <span className="hl-swatch" style={{ background: 'var(--edb-hl-check)' }} />
        Detection limit above limit
      </Text>
      <Text size="xs" c="dimmed">
        &lt; = below detection limit · hover a cell for details · click a row to edit
        {hardness && (
          <Tooltip multiline w={300} label="Hardness-dependent metals are compared with hardness-modified guideline values where hardness was measured in the same sample (ANZECC 2000). Change this in Setup.">
            <span style={{ textDecoration: 'underline dotted', cursor: 'help' }}> · metals hardness-modified</span>
          </Tooltip>
        )}
      </Text>
    </Group>
  );
}


/** A result left out after a QA/QC check: struck through, with why. */
function Withheld({ r, p }: { r?: Result; p: Parameter }) {
  if (!r?.excluded) return <td />;
  return (
    <td className="num result-excluded" title={`Left out (QA/QC): ${r.excluded.reason}`}>
      {displayValue(r, p).text}
    </td>
  );
}

/** A comment on one result ("lab re-ran this"): a speech bubble, filled when there is one. */
function ResultComment({ r }: { r: Result }) {
  const [opened, setOpened] = useState(false);
  const [text, setText] = useState(r.comment ?? '');
  return (
    <Popover opened={opened} onChange={setOpened} width={300} position="left" withArrow shadow="md">
      <Popover.Target>
        <Tooltip label={r.comment ? `Comment: ${r.comment}` : 'Add a comment'} multiline w={260}>
          <ActionIcon
            variant={r.comment ? 'light' : 'subtle'}
            color={r.comment ? 'blue' : 'gray'}
            size="sm"
            aria-label={r.comment ? 'Edit the comment' : 'Add a comment'}
            onClick={() => {
              setText(r.comment ?? '');
              setOpened(!opened);
            }}
          >
            <IconMessage size={14} />
          </ActionIcon>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="xs">
          <Textarea size="xs" label="Comment on this result" autosize minRows={2} value={text} onChange={(e) => setText(e.currentTarget.value)} placeholder="e.g. lab re-ran this; sampled after heavy rain" data-autofocus />
          <Group justify="flex-end" gap="xs">
            {r.comment && (
              <Button size="xs" variant="subtle" color="red" onClick={() => void setResultComment(r.id, '').then(() => setOpened(false))}>
                Remove
              </Button>
            )}
            <Button size="xs" onClick={() => void setResultComment(r.id, text).then(() => setOpened(false))}>
              Save
            </Button>
          </Group>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}

function SampleDrawer({ sample, onClose }: { sample: Sample | null; onClose: () => void }) {
  const { sites: monitoring, qc, index, paramMap, continuous } = useProject();
  const sites = [...monitoring, ...qc.sites];
  const [leaving, setLeaving] = useState<Result | null>(null);
  const [why, setWhy] = useState('');
  // remounted (via key) whenever a different sample is opened
  const [s, setDraft] = useState<Sample | null>(sample ? { ...sample } : null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  if (!s) return null;
  // every result, left-out ones too (struck through)
  const results = (index.allBySample.get(s.id) ?? []).slice().sort((a, b) => {
    const [pa, pb] = [paramMap.get(a.parameterId), paramMap.get(b.parameterId)];
    return pa && pb ? compareParams(pa, pb) : Number(!pa) - Number(!pb);
  });
  const save = async () => {
    await db.transaction('rw', db.samples, db.results, async () => {
      await saveEdited(db.samples, s, sample ?? undefined); // only what was changed here
      for (const r of results) {
        const patch: Partial<Result> = s.siteId !== sample?.siteId || s.date !== sample?.date ? { siteId: s.siteId, date: s.date } : {};
        if (edits[r.id] !== undefined) {
          const pv = parseValue(edits[r.id]);
          Object.assign(patch, { value: pv.value, qualifier: pv.qualifier, text: pv.text, dl: pv.dl });
        }
        if (Object.keys(patch).length) await db.results.update(r.id, patch);
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
        {rainSeries(continuous).map(({ series, years }) => {
          const rain = rainAround(years, s.date);
          if (rain.day === null && rain.before === null) return null;
          return (
            <Text size="sm" key={series.id}>
              <IconCloudRain size={14} style={{ verticalAlign: -2, marginRight: 4 }} />
              {series.name}: {rain.day === null ? 'no record on the day' : `${fmtNum(rain.day)} ${series.unit} on the day`}
              {rain.before !== null ? `, ${fmtNum(rain.before)} ${series.unit} in the 3 days before` : ''}
              {!rain.complete && rain.before !== null ? ' (some days missing)' : ''}.
            </Text>
          );
        })}
        <Text fw={600} size="sm" mt="xs">
          Results ({results.length})
        </Text>
        <Table withTableBorder>
          <Table.Tbody>
            {results.map((r) => {
              const p = paramMap.get(r.parameterId);
              return (
                <Table.Tr key={r.id}>
                  <Table.Td>
                    {r.excluded ? (
                      <Tooltip label={`Left out${r.excluded.by ? ` by ${r.excluded.by}` : ''} on ${formatDate(r.excluded.at.slice(0, 10))}: ${r.excluded.reason}`} multiline w={280}>
                        <span className="result-excluded">{p?.name ?? r.parameterId}</span>
                      </Tooltip>
                    ) : (
                      p?.name ?? r.parameterId
                    )}
                  </Table.Td>
                  <Table.Td w={140}>
                    <TextInput size="xs" className={r.excluded ? 'result-excluded' : undefined} value={edits[r.id] ?? (r.value === null ? r.text ?? '' : `${r.qualifier}${r.value}`)} onChange={(e) => setEdits({ ...edits, [r.id]: e.currentTarget.value })} />
                  </Table.Td>
                  <Table.Td w={90}>
                    <Text size="xs" c="dimmed">
                      {unitLabel(r.unit)}
                    </Text>
                  </Table.Td>
                  <Table.Td w={92}>
                    <Group gap={2} wrap="nowrap">
                      <ResultComment r={r} />
                      {r.excluded ? (
                        <Tooltip label="Put back into the data">
                          <ActionIcon variant="subtle" size="sm" aria-label="Put the result back" onClick={() => void restoreResults([r.id])}>
                            <IconArrowBackUp size={14} />
                          </ActionIcon>
                        </Tooltip>
                      ) : (
                        <Tooltip label="Leave out of the data (kept, with the reason)">
                          <ActionIcon variant="subtle" color="gray" size="sm" aria-label="Leave the result out" onClick={() => setLeaving(r)}>
                            <IconEyeOff size={14} />
                          </ActionIcon>
                        </Tooltip>
                      )}
                      <ActionIcon variant="subtle" color="red" size="sm" aria-label="Delete result" onClick={async () => { await db.results.delete(r.id); }}>
                        <IconTrash size={14} />
                      </ActionIcon>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
        {leaving && (
          <Card withBorder p="sm">
            <Stack gap={6}>
              <Text size="sm" fw={500}>
                Leave out {paramMap.get(leaving.parameterId)?.name ?? leaving.parameterId}?
              </Text>
              <Text size="xs" c="dimmed">
                It stays here, struck through, but isn’t used in statistics, compliance, graphs or reports. It’s recorded in the QA/QC log.
              </Text>
              <TextInput size="xs" label="Why" placeholder="e.g. bottle contaminated – lab confirmed" value={why} onChange={(e) => setWhy(e.currentTarget.value)} data-autofocus />
              <Group justify="flex-end" gap="xs">
                <Button size="xs" variant="default" onClick={() => setLeaving(null)}>
                  Cancel
                </Button>
                <Button
                  size="xs"
                  color="gray"
                  onClick={async () => {
                    const p = paramMap.get(leaving.parameterId);
                    await excludeResult(leaving, why, `${sites.find((x) => x.id === leaving.siteId)?.code ?? ''} ${p?.name ?? leaving.parameterId} ${displayValue(leaving, p).text}`.trim());
                    setLeaving(null);
                    setWhy('');
                  }}
                >
                  Leave out
                </Button>
              </Group>
            </Stack>
          </Card>
        )}
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
          <SaveButton dirty={!same(s, sample) || Object.keys(edits).length > 0} onClick={save}>
            Save changes
          </SaveButton>
        </Group>
      </Stack>
    </Drawer>
  );
}

function SortHead({ label, title, sortKey, sort, onSort, onSortDir, onFilter }: { label: string; title?: string; sortKey: SortKey; sort: SortState; onSort: (k: SortKey) => void; onSortDir?: (k: SortKey, dir: SortState['dir']) => void; onFilter?: (k: string) => void }) {
  const active = sort.key === sortKey;
  return (
    <Group gap={2} wrap="nowrap" align="flex-end">
      <UnstyledButton className="th-sort" title={title ? `${title} – click to sort` : 'Click to sort'} onClick={() => onSort(sortKey)} aria-label={`Sort by ${title ?? label}`}>
        {label}
        {active && (sort.dir === 'asc' ? <IconArrowUp size={12} style={{ marginLeft: 2, verticalAlign: -1 }} /> : <IconArrowDown size={12} style={{ marginLeft: 2, verticalAlign: -1 }} />)}
      </UnstyledButton>
      {onSortDir && onFilter && (
        <Menu position="bottom-end" withinPortal>
          <Menu.Target>
            <ActionIcon size={16} variant="subtle" color="gray" aria-label={`Sort or filter ${title ?? label}`}>
              <IconChevronDown size={12} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item leftSection={<IconSortDescending size={14} />} onClick={() => onSortDir(sortKey, 'desc')}>
              Sort largest to smallest
            </Menu.Item>
            <Menu.Item leftSection={<IconSortAscending size={14} />} onClick={() => onSortDir(sortKey, 'asc')}>
              Sort smallest to largest
            </Menu.Item>
            <Menu.Item leftSection={<IconFilter size={14} />} onClick={() => onFilter(sortKey)}>
              Filter by value…
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      )}
    </Group>
  );
}

interface HeadProps {
  sort: SortState;
  onSort: (k: SortKey) => void;
  onSortDir: (k: SortKey, dir: SortState['dir']) => void;
  onFilter: (k: string) => void;
}

/** Keeps the second header row (units, dates) right under the first however tall its names wrap, so neither is covered. */
function useHeaderRows() {
  const ref = useRef<HTMLTableSectionElement>(null);
  useLayoutEffect(() => {
    const head = ref.current;
    const first = head?.rows[0];
    if (!head || !first) return;
    const fit = () => head.closest('table')?.style.setProperty('--edb-head1', `${first.getBoundingClientRect().height}px`);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(first);
    return () => ro.disconnect();
  }, []);
  return ref;
}

function SamplesAsRows({ rows, columns, flags, onRow, head }: { rows: PivotRow[]; columns: ReturnType<typeof pivot>['columns']; flags: Map<string, CellFlag>; onRow: (s: Sample) => void; head: HeadProps }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({ count: rows.length, getScrollElement: () => parentRef.current, estimateSize: () => 27, overscan: 12 });
  const items = v.getVirtualItems();
  const padTop = items.length ? items[0].start : 0;
  const padBottom = items.length ? v.getTotalSize() - items[items.length - 1].end : 0;
  const headRef = useHeaderRows();
  return (
    <div ref={parentRef} style={{ maxHeight: 'calc(100vh - 330px)', minHeight: 300, overflow: 'auto', border: '1px solid var(--edb-grid)', borderRadius: 8 }}>
      <table className="edb-grid">
        <thead ref={headRef}>
          <tr>
            <th className="sticky-col" style={{ minWidth: 110 }}>
              <SortHead label="Date" sortKey="date" sort={head.sort} onSort={head.onSort} />
            </th>
            <th className="sticky-col-2">
              <SortHead label="Site" sortKey="site" sort={head.sort} onSort={head.onSort} />
            </th>
            {columns.map((p) => (
              <th key={p.id} style={{ maxWidth: 150, whiteSpace: 'normal', minWidth: 84 }}>
                <SortHead label={p.short ?? p.name} title={p.name} sortKey={p.id} sort={head.sort} onSort={head.onSort} onSortDir={head.onSortDir} onFilter={head.onFilter} />
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
                  if (!r) return <Withheld key={p.id} r={row.withheld?.get(p.id)} p={p} />;
                  const f = flags.get(r.id);
                  return (
                    <td key={p.id} className={`num ${cellClass(f)} ${r.qualifier === '<' ? 'nd' : ''} ${r.comment ? 'commented' : ''}`} title={[f?.messages.join('\n'), r.text && r.text !== String(r.value) ? `Reported: ${r.text} ${r.unit}` : '', r.comment ? `Comment: ${r.comment}` : ''].filter(Boolean).join('\n') || undefined}>
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

function ParamsAsRows({ rows, columns, flags, onRow }: { rows: PivotRow[]; columns: ReturnType<typeof pivot>['columns']; flags: Map<string, CellFlag>; onRow: (s: Sample) => void }) {
  const shown = rows.slice(-120);
  const headRef = useHeaderRows();
  return (
    <Stack gap={4}>
      {rows.length > shown.length && (
        <Text size="xs" c="dimmed">
          Showing the most recent {shown.length} of {rows.length} samples – narrow the period or switch layout to see all.
        </Text>
      )}
      <div style={{ maxHeight: 'calc(100vh - 330px)', minHeight: 300, overflow: 'auto', border: '1px solid var(--edb-grid)', borderRadius: 8 }}>
        <table className="edb-grid" style={{ ['--edb-col1' as string]: '220px' }}>
          <thead ref={headRef}>
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
                  if (!r) return <Withheld key={row.sample.id} r={row.withheld?.get(p.id)} p={p} />;
                  const f = flags.get(r.id);
                  return (
                    <td key={row.sample.id} className={`num ${cellClass(f)} ${r.qualifier === '<' ? 'nd' : ''} ${r.comment ? 'commented' : ''}`} title={[f?.messages.join('\n'), r.comment ? `Comment: ${r.comment}` : ''].filter(Boolean).join('\n') || undefined}>
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

function FilterEditor({ draft, columns, onChange, onApply }: { draft: ValueFilter; columns: Parameter[]; onChange: (f: ValueFilter) => void; onApply: (f: ValueFilter) => void }) {
  const op = FILTER_OPS.find((o) => o.value === draft.op);
  const p = columns.find((c) => c.id === draft.paramId);
  const ready = !!draft.paramId && (!op?.needsValue || draft.value !== undefined);
  return (
    <Stack gap="xs" w={290}>
      <Select label="Parameter" data={columns.map((c) => ({ value: c.id, label: c.name }))} value={draft.paramId || null} onChange={(v) => v && onChange({ ...draft, paramId: v })} searchable comboboxProps={{ withinPortal: false }} allowDeselect={false} />
      <Select label="Show samples where it" data={FILTER_OPS.map((o) => ({ value: o.value, label: o.label }))} value={draft.op} onChange={(v) => v && onChange({ ...draft, op: v as FilterOp })} comboboxProps={{ withinPortal: false }} allowDeselect={false} />
      {op?.needsValue && (
        <NumberInput
          label={`Value${p ? ` (${unitLabel(p.unit)})` : ''}`}
          value={draft.value ?? ''}
          onChange={(v) => onChange({ ...draft, value: v === '' ? undefined : Number(v) })}
          decimalScale={8}
          onKeyDown={(e) => e.key === 'Enter' && ready && onApply(draft)}
          data-autofocus
        />
      )}
      {op?.needsValue && (
        <Text size="xs" c="dimmed">
          Non-detects only count when the whole range fits, e.g. “&lt;0.5” passes “below 1” but not “above 0.1”.
        </Text>
      )}
      <Button size="xs" disabled={!ready} onClick={() => onApply(draft)}>
        Apply filter
      </Button>
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
                  <Table.Th>Reviewed</Table.Th>
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
                      {im.reviewed ? (
                        <Group gap={4} wrap="nowrap">
                          <Badge color="teal" variant="light" title={`Reviewed by ${im.reviewed.by || 'someone'} on ${formatDate(im.reviewed.on)}`}>
                            {im.reviewed.by || 'Reviewed'} · {formatDate(im.reviewed.on)}
                          </Badge>
                          <Button size="compact-xs" variant="subtle" color="gray" onClick={() => void setReviewed(im.id, false)}>
                            Undo
                          </Button>
                        </Group>
                      ) : (
                        <Button size="compact-xs" variant="light" leftSection={<IconChecks size={14} />} onClick={() => void setReviewed(im.id, true)}>
                          Mark reviewed
                        </Button>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Badge variant="light">{im.kind === 'lab' ? 'Lab results' : im.kind === 'wide' ? 'Spreadsheet' : im.kind === 'field' ? 'Field' : 'Table'}</Badge>
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
  // the table as set up last time on this project (kept when going to another tab, and for next time)
  const k = (name: string) => `${project.id}:data.${name}`;
  const [period, setPeriod] = useViewState<PeriodValue>(k('period'), () => defaultPeriod(project.yearStartMonth, 'all'), revivePeriod(project.yearStartMonth));
  const [siteIds, setSiteIds] = useViewState<string[]>(k('sites'), [], reviveIds((id) => data.siteMap.has(id)));
  const [paramIds, setParamIds] = useViewState<string[]>(k('params'), [], reviveIds((id) => data.paramMap.has(id)));
  const [setIds, setSetIds] = useViewState<string[]>(k('sets'), project.guidelineSetIds, reviveIds((id) => data.setMap.has(id)));
  const [layout, setLayout] = useViewState<'samplesAsRows' | 'parametersAsRows'>(k('layout'), 'samplesAsRows');
  const [selected, setSelected] = useState<Sample | null>(null);
  const withData = useMemo(() => new Set(index.paramIdsWithData), [index]);
  const paramPresets = useMemo(() => consentPresets(data, withData), [data, withData]);
  const [sort, setSort] = useViewState<SortState>(k('sort'), DEFAULT_SORT);
  const [filters, setFilters] = useViewState<ValueFilter[]>(k('filters'), [], (v) => (Array.isArray(v) ? v.filter((f) => data.paramMap.has(f.paramId)) : undefined));
  const [show, setShow] = useViewState<ShowRows>(k('show'), 'all');
  const [search, setSearch] = useViewState(k('search'), '');
  const [draft, setDraft] = useState<ValueFilter | null>(null);
  const [consentView, setConsentView] = useViewState<'all' | ConsentView>(k('consent'), 'all');
  const consent = useMemo(() => ({ consent: consentParameterIds(data, 'consent'), limits: consentParameterIds(data, 'limits'), triggers: consentParameterIds(data, 'triggers') }), [data]);
  // the parameters shown: those picked (or all with data), narrowed to the consent view, in the logical order
  const shownIds = useMemo(() => {
    if (consentView === 'all' && !paramIds.length) return [];
    const picked = paramIds.length ? paramIds : [...withData];
    const ids = consentView === 'all' ? picked : picked.filter((id) => consent[consentView].has(id));
    const ordered = ids
      .map((id) => data.paramMap.get(id))
      .filter((p): p is NonNullable<typeof p> => !!p)
      .sort(compareParams)
      .map((p) => p.id);
    if (consentView === 'all') return ordered;
    return ordered.length ? ordered : [NO_PARAMETERS];
  }, [consentView, paramIds, withData, consent, data.paramMap]);
  const noneInView = shownIds[0] === NO_PARAMETERS;
  const consentCounts = useMemo(() => countWithData(consent, withData), [consent, withData]);
  const exportIds = noneInView ? [] : shownIds;

  const { columns, rows } = useMemo(() => pivot(data, { siteIds, paramIds: shownIds, start: period.start, end: period.end, withheld: true }), [data, siteIds, shownIds, period]);
  const flags = useMemo(() => flagResults(data, evaluateAll(data, period.start, period.end), setIds, period.start, period.end), [data, setIds, period]);
  const guidelineNames = setIds.map((id) => setMap.get(id)?.shortName ?? '').filter(Boolean);
  const siteOrder = useMemo(() => new Map(sites.map((s, i) => [s.id, i])), [sites]);
  const view = useMemo(() => applyView(rows, data.paramMap, flags, { sort, filters, show, search }, siteOrder), [rows, data.paramMap, flags, sort, filters, show, search, siteOrder]);
  const narrowed = view.length !== rows.length;
  const sorted = sort.key !== DEFAULT_SORT.key || sort.dir !== DEFAULT_SORT.dir;
  const clearView = () => {
    setFilters([]);
    setShow('all');
    setSearch('');
    setSort(DEFAULT_SORT);
  };
  const head: HeadProps = {
    sort,
    onSort: (key) =>
      setSort((s) => {
        if (key === 'date') return { key, dir: s.key === 'date' && s.dir === 'asc' ? 'desc' : 'asc' };
        const first = key === 'site' ? 'asc' : 'desc';
        if (s.key !== key) return { key, dir: first };
        if (s.dir === first) return { key, dir: first === 'asc' ? 'desc' : 'asc' };
        return DEFAULT_SORT;
      }),
    onSortDir: (key, dir) => setSort({ key, dir }),
    onFilter: (paramId) => setDraft({ paramId, op: '>' }),
  };
  const settings = useSettings();
  const [wordBusy, setWordBusy] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const ai = useFeature('ai');
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
          parameterIds: exportIds,
          layout: layout === 'samplesAsRows' ? 'parametersAsColumns' : 'parametersAsRows',
          guidelineSetIds: setIds,
          highlight: true,
          splitBySite: layout !== 'samplesAsRows',
          sampleIds: narrowed ? view.map((r) => r.sample.id) : undefined,
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
    rows: view,
    flags,
    guidelineNames,
    layout,
    fileName: `${project.name} results ${period.start.startsWith('1900') ? 'all' : `${period.start} to ${period.end}`}`,
  };

  return (
    <Stack gap="md">
      <Card padding="md">
        <Group align="flex-end" gap="sm" wrap="wrap">
          <PeriodPicker value={period} onChange={setPeriod} yearStartMonth={project.yearStartMonth} width={{ base: '100%', xs: 220 }} />
          <SitePicker compact sites={sites} value={siteIds} onChange={setSiteIds} w={{ base: '100%', xs: 160 }} />
          <ParamPicker compact params={params} value={paramIds} onChange={setParamIds} onlyIds={withData} presets={paramPresets} w={{ base: '100%', xs: 190 }} />
          <ConsentViewControl label="Show" value={consentView} onChange={setConsentView} counts={consentCounts} />
          <GuidelinePicker compact sets={guidelineSets} value={setIds} onChange={setSetIds} w={{ base: '100%', xs: 190 }} label="Compare with" placeholder="No guidelines" />
        </Group>
        <Group align="center" gap="sm" wrap="wrap" mt="sm">
          <TextInput
            leftSection={<IconSearch size={16} />}
            placeholder="Search sample names, lab jobs, notes…"
            aria-label="Search samples"
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            rightSection={search ? <CloseButton size="sm" aria-label="Clear search" onClick={() => setSearch('')} /> : null}
            w={{ base: '100%', sm: 300 }}
          />
          <Select aria-label="Show" data={SHOW_ROWS} value={show} onChange={(v) => v && setShow(v as ShowRows)} allowDeselect={false} w={{ base: '100%', sm: 300 }} comboboxProps={{ width: 'max-content' }} />
          <Popover opened={!!draft} onChange={(o) => !o && setDraft(null)} position="bottom-start" withArrow shadow="md" trapFocus>
            <Popover.Target>
              <Button variant="subtle" leftSection={<IconFilter size={16} />} onClick={() => setDraft(draft ? null : { paramId: columns[0]?.id ?? '', op: '>' })} disabled={!columns.length}>
                Filter by value
              </Button>
            </Popover.Target>
            <Popover.Dropdown>
              {draft && (
                <FilterEditor
                  draft={draft}
                  columns={columns}
                  onChange={setDraft}
                  onApply={(f) => {
                    setFilters([...filters.filter((x) => !(x.paramId === f.paramId && x.op === f.op)), f]);
                    setDraft(null);
                  }}
                />
              )}
            </Popover.Dropdown>
          </Popover>
          <Group gap="sm" ml="auto" wrap="nowrap">
            <SegmentedControl
              value={layout}
              onChange={(v) => setLayout(v as typeof layout)}
              data={[
                { value: 'samplesAsRows', label: 'Dates down' },
                { value: 'parametersAsRows', label: 'Dates across' },
              ]}
            />
            <Menu position="bottom-end">
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
                {ai && (
                  <>
                    <Menu.Divider />
                    <Menu.Item leftSection={<IconSparkles size={16} />} onClick={() => setAiOpen(true)}>
                      Copy for AI input (this period, sites and parameters)
                    </Menu.Item>
                  </>
                )}
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Group>
        {(filters.length > 0 || sorted || show !== 'all' || search) && (
          <Group gap={6} mt="sm" wrap="wrap">
            {sorted && (
              <Pill withRemoveButton onRemove={() => setSort(DEFAULT_SORT)} removeButtonProps={{ 'aria-label': 'Clear sort' }}>
                Sorted by {sortLabel(sort, data.paramMap)}
              </Pill>
            )}
            {show !== 'all' && (
              <Pill withRemoveButton onRemove={() => setShow('all')}>
                {SHOW_ROWS.find((s) => s.value === show)?.label}
              </Pill>
            )}
            {search && (
              <Pill withRemoveButton onRemove={() => setSearch('')}>
                Matching “{search}”
              </Pill>
            )}
            {filters.map((f, i) => (
              <Pill key={`${f.paramId}${f.op}`} withRemoveButton onRemove={() => setFilters(filters.filter((_, j) => j !== i))}>
                {describeFilter(f, data.paramMap.get(f.paramId), unitLabel(data.paramMap.get(f.paramId)?.unit))}
              </Pill>
            ))}
            <Button size="compact-xs" variant="subtle" onClick={clearView}>
              Clear all
            </Button>
          </Group>
        )}
      </Card>
      <Group justify="space-between" gap="xs">
        <Legend guidelineNames={guidelineNames} hardness={project.hardnessAdjust && setIds.some((id) => setMap.get(id)?.values.some((v) => v.hardness))} />
        <Text size="sm" c={narrowed ? undefined : 'dimmed'} fw={narrowed ? 600 : undefined}>
          {narrowed ? `Showing ${view.length} of ${rows.length} samples` : `${rows.length} samples`} · {columns.length} parameters
        </Text>
      </Group>
      {noneInView ? (
        <EmptyState
          title={`No ${consentView === 'limits' ? 'parameters with consent limits' : consentView === 'triggers' ? 'parameters with consent triggers' : 'consent parameters'} have results${paramIds.length ? ' among those chosen' : ''}`}
          action={
            <Button variant="light" onClick={() => setConsentView('all')}>
              Show all parameters
            </Button>
          }
        >
          {consent[consentView === 'all' ? 'consent' : consentView].size ? 'Try another period or sites.' : 'Add the consent conditions on the Compliance tab, and the parameters each sampling schedule requires under Overview → Sampling & reporting.'}
        </EmptyState>
      ) : view.length ? (
        layout === 'samplesAsRows' ? <SamplesAsRows rows={view} columns={columns} flags={flags} onRow={setSelected} head={head} /> : <ParamsAsRows rows={view} columns={columns} flags={flags} onRow={setSelected} />
      ) : (
        <EmptyState
          title={rows.length ? 'No samples match the filters' : 'No results match the filters'}
          action={
            narrowed ? (
              <Button variant="light" onClick={clearView}>
                Clear filters
              </Button>
            ) : undefined
          }
        />
      )}
      <ImportHistory />
      <SampleDrawer key={selected?.id ?? 'none'} sample={selected} onClose={() => setSelected(null)} />
      <AiInputModal opened={aiOpen} onClose={() => setAiOpen(false)} start={{ period, siteIds, paramIds: exportIds }} />
    </Stack>
  );
}
