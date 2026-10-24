import { useMemo, useState } from 'react';
import { ActionIcon, Alert, Badge, Button, Card, FileButton, Grid, Group, NavLink, NumberInput, ScrollArea, SegmentedControl, Select, Stack, Switch, Table, Text, TextInput, Textarea, Title, Autocomplete } from '@mantine/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate, useParams } from 'react-router-dom';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { IconCopy, IconDownload, IconFileImport, IconInfoCircle, IconPlus, IconSearch, IconTrash } from '@tabler/icons-react';
import { db } from '../db/db';
import type { GuidelineSet, GuidelineValue } from '../db/types';
import { deleteGuidelineSet, duplicateGuidelineSet, saveGuidelineSet } from '../db/repo';
import { PageHeader, paramOptions } from '../components/common';
import { COMMON_UNITS, unitLabel } from '../lib/units';
import { parseValue } from '../lib/values';
import { GUIDELINE_UNITS, guidelineInUnit, plainNumber } from '../lib/guidelines';
import { useSettings } from '../hooks/useSettings';
import { saveSettings } from '../db/db';
import { uid } from '../lib/ids';
import { downloadBlob, safeFileName } from '../db/backup';
import { readWorkbook, cellText, cellAt } from '../importers/workbook';
import { buildParamIndex, matchParameter } from '../lib/matching';
import { SaveButton } from '../components/Unsaved';
import { same } from '../sync/model';
import { LIBRARY, SectionNav } from '../components/Shell';

function exportCsv(set: GuidelineSet, names: Map<string, string>, unit: string) {
  const rows = [['Parameter', 'Minimum', 'Maximum', 'Unit', 'Hardness-dependent', 'Note']];
  for (const v of set.values) {
    const d = guidelineInUnit(v, unit);
    rows.push([names.get(v.parameterId) ?? v.parameterId, plainNumber(d.min), plainNumber(d.max), unitLabel(d.unit), v.hardness ? 'yes' : '', v.note ?? '']);
  }
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  downloadBlob(new Blob([rows.map((r) => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv' }), `${safeFileName(set.name)}.csv`);
}

export function GuidelinesPage() {
  const { setId } = useParams();
  const navigate = useNavigate();
  const sets = useLiveQuery(() => db.guidelineSets.toArray(), []);
  const params = useLiveQuery(() => db.parameters.toArray(), []);
  const [q, setQ] = useState('');
  const settings = useSettings();
  const showUnit = settings.guidelineUnit ?? 'published';
  const names = useMemo(() => new Map((params ?? []).map((p) => [p.id, p.name])), [params]);
  const selected = sets?.find((s) => s.id === setId) ?? sets?.find((s) => s.id === 'anzg-fw-95');
  const [draft, setDraft] = useState<GuidelineSet | null>(null);
  // the set as it was when editing started: saving changes only what was changed here
  const [draftBase, setDraftBase] = useState<GuidelineSet | undefined>();
  const editing = draft && selected && draft.id === selected.id ? draft : null;
  const current = editing ?? selected;

  const groups = useMemo(() => {
    const g = new Map<string, GuidelineSet[]>();
    for (const s of sets ?? []) {
      if (q && !`${s.name} ${s.shortName}`.toLowerCase().includes(q.toLowerCase())) continue;
      const f = s.builtIn ? s.family ?? 'Other' : 'Custom';
      g.set(f, [...(g.get(f) ?? []), s]);
    }
    return Array.from(g.entries()).sort((a, b) => (a[0] === 'Custom' ? -1 : b[0] === 'Custom' ? 1 : a[0].localeCompare(b[0])));
  }, [sets, q]);

  const importFile = async (file: File | null) => {
    if (!file || !params) return;
    try {
      const grids = await readWorkbook(await file.arrayBuffer(), file.name);
      const g = grids[0];
      let header = 0;
      for (let r = 0; r < Math.min(g.nRows, 15); r++) if ((g.rows[r] ?? []).some((c) => /parameter|analyte|determinand/i.test(cellText(c)))) { header = r; break; }
      const hdr = (g.rows[header] ?? []).map((c) => cellText(c).toLowerCase());
      const col = (re: RegExp) => hdr.findIndex((h) => re.test(h));
      const cP = Math.max(0, col(/parameter|analyte|determinand/)), cMin = col(/^min/), cMax = col(/^max|value|limit|guideline/), cU = col(/unit/), cN = col(/note|comment/), cH = col(/hardness/);
      const index = buildParamIndex(params);
      const values: GuidelineValue[] = [];
      const unmatched: string[] = [];
      for (let r = header + 1; r < g.nRows; r++) {
        const name = cellText(cellAt(g, r, cP));
        if (!name) continue;
        const m = matchParameter(name, index);
        if (!m.parameterId) {
          unmatched.push(name);
          continue;
        }
        const max = cMax >= 0 ? parseValue(cellAt(g, r, cMax).v).value ?? undefined : undefined;
        const min = cMin >= 0 ? parseValue(cellAt(g, r, cMin).v).value ?? undefined : undefined;
        if (max === undefined && min === undefined) continue;
        values.push({ parameterId: m.parameterId, max, min, unit: (cU >= 0 && cellText(cellAt(g, r, cU))) || 'mg/L', note: cN >= 0 ? cellText(cellAt(g, r, cN)) || undefined : undefined, hardness: cH >= 0 ? /^(y|yes|true|1)$/i.test(cellText(cellAt(g, r, cH))) || undefined : undefined });
      }
      const set: GuidelineSet = { id: uid('gl'), name: file.name.replace(/\.[^.]+$/, ''), shortName: file.name.replace(/\.[^.]+$/, '').slice(0, 24), family: 'Custom', builtIn: false, values, updatedAt: new Date().toISOString(), source: `Imported from ${file.name}` };
      await saveGuidelineSet(set);
      navigate(`/guidelines/${set.id}`);
      notifications.show({ title: `Imported ${values.length} values`, message: unmatched.length ? `Not matched: ${unmatched.slice(0, 8).join(', ')}${unmatched.length > 8 ? '…' : ''}` : 'All parameters matched', color: unmatched.length ? 'orange' : 'teal' });
    } catch (e) {
      notifications.show({ title: 'Import failed', message: (e as Error).message, color: 'red' });
    }
  };

  if (!sets || !params) return null;
  const setVal = (i: number, patch: Partial<GuidelineValue>) => editing && setDraft({ ...editing, values: editing.values.map((v, j) => (j === i ? { ...v, ...patch } : v)) });

  return (
    <Stack>
      <SectionNav items={LIBRARY} />
      <PageHeader
        title="Guideline values"
        description="Guideline sets are compared with results in tables, graphs and reports. Create custom sets for site-specific trigger values or other guidelines."
        actions={
          <>
            <FileButton onChange={importFile} accept=".csv,.xlsx,.xls">
              {(p) => (
                <Button variant="default" leftSection={<IconFileImport size={16} />} {...p}>
                  Import CSV / Excel
                </Button>
              )}
            </FileButton>
            <Button
              leftSection={<IconPlus size={16} />}
              onClick={async () => {
                const s: GuidelineSet = { id: uid('gl'), name: 'Site-specific trigger values', shortName: 'SSTV', family: 'Custom', builtIn: false, values: [], updatedAt: new Date().toISOString() };
                await saveGuidelineSet(s);
                setDraftBase(s);
                setDraft(s);
                navigate(`/guidelines/${s.id}`);
              }}
            >
              New set
            </Button>
          </>
        }
      />
      <Grid gutter="lg">
        <Grid.Col span={{ base: 12, md: 4 }}>
          <Card padding="xs">
            <TextInput leftSection={<IconSearch size={14} />} placeholder="Search" value={q} onChange={(e) => setQ(e.currentTarget.value)} mb="xs" />
            <ScrollArea.Autosize mah="calc(100vh - 260px)">
              {groups.map(([fam, list]) => (
                <div key={fam}>
                  <Text size="xs" fw={600} c="dimmed" px="sm" pt="xs" tt="uppercase">
                    {fam}
                  </Text>
                  {list.map((s) => (
                    <NavLink key={s.id} label={s.name} description={`${s.values.length} values`} active={current?.id === s.id} onClick={() => { setDraft(null); navigate(`/guidelines/${s.id}`); }} style={{ borderRadius: 6 }} />
                  ))}
                </div>
              ))}
            </ScrollArea.Autosize>
          </Card>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 8 }}>
          {current && (
            <Card>
              <Group justify="space-between" align="flex-start" mb="sm" wrap="wrap">
                <div style={{ flex: 1, minWidth: 260 }}>
                  {editing ? (
                    <Stack gap="xs">
                      <TextInput label="Name" value={editing.name} onChange={(e) => setDraft({ ...editing, name: e.currentTarget.value })} />
                      <TextInput label="Short name (table headers, graph labels)" value={editing.shortName} onChange={(e) => setDraft({ ...editing, shortName: e.currentTarget.value })} />
                      <TextInput label="Source / citation" value={editing.source ?? ''} onChange={(e) => setDraft({ ...editing, source: e.currentTarget.value })} />
                      <Textarea label="Notes" autosize value={editing.notes ?? ''} onChange={(e) => setDraft({ ...editing, notes: e.currentTarget.value })} />
                    </Stack>
                  ) : (
                    <>
                      <Group gap="xs">
                        <Title order={4}>{current.name}</Title>
                        {current.builtIn ? <Badge variant="outline">Built-in</Badge> : <Badge>Custom</Badge>}
                      </Group>
                      <Text size="sm" c="dimmed">
                        {current.source}
                      </Text>
                    </>
                  )}
                </div>
                <Group gap="xs">
                  {editing ? (
                    <>
                      <Button variant="default" onClick={() => setDraft(null)}>
                        Cancel
                      </Button>
                      <SaveButton dirty={!same(editing, draftBase?.id === editing.id ? draftBase : current)} onClick={async () => { await saveGuidelineSet(editing, draftBase?.id === editing.id ? draftBase : undefined); setDraft(null); notifications.show({ message: 'Guideline set saved', color: 'teal' }); }} />
                    </>
                  ) : (
                    <>
                      <Button variant="default" leftSection={<IconDownload size={16} />} onClick={() => exportCsv(current, names, showUnit)}>
                        CSV
                      </Button>
                      <Button
                        variant="default"
                        leftSection={<IconCopy size={16} />}
                        onClick={async () => {
                          const c = await duplicateGuidelineSet(current);
                          setDraftBase(c);
                          setDraft(c);
                          navigate(`/guidelines/${c.id}`);
                        }}
                      >
                        Duplicate{current.builtIn ? ' to edit' : ''}
                      </Button>
                      {!current.builtIn && (
                        <>
                          <Button onClick={() => { setDraftBase(current); setDraft(structuredClone(current)); }}>Edit</Button>
                          <ActionIcon
                            variant="subtle"
                            color="red"
                            size="lg"
                            aria-label="Delete set"
                            onClick={() => modals.openConfirmModal({ title: `Delete “${current.name}”?`, labels: { confirm: 'Delete', cancel: 'Cancel' }, confirmProps: { color: 'red' }, onConfirm: async () => { await deleteGuidelineSet(current.id); navigate('/guidelines'); } })}
                          >
                            <IconTrash size={18} />
                          </ActionIcon>
                        </>
                      )}
                    </>
                  )}
                </Group>
              </Group>
              {current.notes && !editing && (
                <Alert variant="light" color="blue" icon={<IconInfoCircle size={16} />} mb="sm">
                  <Text size="sm">{current.notes}</Text>
                </Alert>
              )}
              {!editing && (
                <Group justify="space-between" align="center" mb="xs" wrap="wrap" gap="xs">
                  <Text size="sm" c="dimmed">
                    {current.values.length} value{current.values.length === 1 ? '' : 's'}
                  </Text>
                  <Group gap="xs" wrap="wrap">
                    <Text size="sm">Show concentrations in</Text>
                    <SegmentedControl size="xs" data={GUIDELINE_UNITS} value={showUnit} onChange={(v) => saveSettings({ guidelineUnit: v })} aria-label="Show concentrations in" />
                  </Group>
                </Group>
              )}
              <Table.ScrollContainer minWidth={640}>
                <Table striped>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Parameter</Table.Th>
                      <Table.Th ta="right">Minimum</Table.Th>
                      <Table.Th ta="right">Maximum</Table.Th>
                      <Table.Th>Unit</Table.Th>
                      <Table.Th>Hardness</Table.Th>
                      <Table.Th>Note</Table.Th>
                      {editing && <Table.Th />}
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {(editing ?? current).values.map((v, i) =>
                      editing ? (
                        <Table.Tr key={i}>
                          <Table.Td>
                            <Select size="xs" data={paramOptions(params)} value={v.parameterId} onChange={(x) => x && setVal(i, { parameterId: x })} searchable w={220} allowDeselect={false} />
                          </Table.Td>
                          <Table.Td>
                            <NumberInput size="xs" value={v.min ?? ''} onChange={(x) => setVal(i, { min: x === '' ? undefined : Number(x) })} w={100} decimalScale={8} hideControls />
                          </Table.Td>
                          <Table.Td>
                            <NumberInput size="xs" value={v.max ?? ''} onChange={(x) => setVal(i, { max: x === '' ? undefined : Number(x) })} w={100} decimalScale={8} hideControls />
                          </Table.Td>
                          <Table.Td>
                            <Autocomplete size="xs" data={COMMON_UNITS} value={v.unit} onChange={(x) => setVal(i, { unit: x })} w={110} />
                          </Table.Td>
                          <Table.Td>
                            <Switch size="xs" checked={!!v.hardness} onChange={(e) => setVal(i, { hardness: e.currentTarget.checked || undefined })} />
                          </Table.Td>
                          <Table.Td>
                            <TextInput size="xs" value={v.note ?? ''} onChange={(e) => setVal(i, { note: e.currentTarget.value || undefined })} />
                          </Table.Td>
                          <Table.Td>
                            <ActionIcon size="sm" variant="subtle" color="red" onClick={() => setDraft({ ...editing, values: editing.values.filter((_, j) => j !== i) })} aria-label="Remove">
                              <IconTrash size={14} />
                            </ActionIcon>
                          </Table.Td>
                        </Table.Tr>
                      ) : (
                        <Table.Tr key={i}>
                          <Table.Td>{names.get(v.parameterId) ?? v.parameterId}</Table.Td>
                          <Table.Td ta="right" className="tabular">
                            {plainNumber(guidelineInUnit(v, showUnit).min)}
                          </Table.Td>
                          <Table.Td ta="right" className="tabular">
                            {v.op === '>=' ? '< ' : ''}
                            {plainNumber(guidelineInUnit(v, showUnit).max)}
                          </Table.Td>
                          <Table.Td>{unitLabel(guidelineInUnit(v, showUnit).unit)}</Table.Td>
                          <Table.Td>{v.hardness ? <Badge size="xs">H</Badge> : ''}</Table.Td>
                          <Table.Td>
                            <Text size="xs" c="dimmed">
                              {v.note}
                            </Text>
                          </Table.Td>
                        </Table.Tr>
                      ),
                    )}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
              {editing && (
                <Button mt="sm" variant="light" leftSection={<IconPlus size={16} />} onClick={() => setDraft({ ...editing, values: [...editing.values, { parameterId: 'zn-d', max: undefined, unit: showUnit === 'published' ? 'µg/L' : showUnit }] })}>
                  Add value
                </Button>
              )}
              {!editing && showUnit !== 'published' && (
                <Text size="xs" c="dimmed" mt="sm">
                  Concentrations are converted from the published units for display. Results are always compared in matching units, whatever is shown here.
                </Text>
              )}
              {!editing && current.builtIn && (
                <Text size="xs" c="dimmed" mt="sm">
                  Built-in values are provided for convenience – always confirm them against the current published guideline before relying on them. Duplicate the set to change values.
                </Text>
              )}
            </Card>
          )}
        </Grid.Col>
      </Grid>
    </Stack>
  );
}
