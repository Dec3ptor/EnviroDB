// A project's ecology surveys: what was found where – stream invertebrates, fish, birds, plants, eDNA – each with its
// taxa and how many, and what that works out to: how many taxa, how evenly spread, and for stream invertebrates the
// EPT taxa and the Macroinvertebrate Community Index, from the tolerance scores in the team's taxa list.

import { useMemo, useState } from 'react';
import { ActionIcon, Alert, Autocomplete, Badge, Button, Card, Checkbox, Chip, Group, Menu, Modal, NumberInput, SegmentedControl, Select, SimpleGrid, Stack, Switch, Table, Text, TextInput, Textarea, Tooltip } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconClipboardText, IconDownload, IconLeaf, IconListDetails, IconPlus, IconTable, IconTrash } from '@tabler/icons-react';
import { downloadBlob, safeFileName } from '../../db/backup';
import { deleteSurvey, likeTheLast, mergeTaxa, newSurvey, saveSurvey, saveSurveys, saveTaxon } from '../../db/ecology';
import { ECO_CODES, ECO_KINDS, type EcoCode, type EcoKind, type EcoRecord, type EcoSurvey, type Taxon } from '../../db/types';
import { useProject } from '../../hooks/useProjectData';
import { DateField, EmptyState } from '../../components/common';
import { formatDate, todayStr } from '../../lib/dates';
import { CODE_TEXT, countsOf, ecoIndices, indicesCsv, isEpt, mergedRecords, parseRecords, parseTable, parseTaxa, recordsCsv, taxonKey, type EcoIndices, type PastedTable, type TaxaList } from '../../lib/ecology';
import { same } from '../../sync/model';

const METHODS: Partial<Record<EcoKind, string[]>> = {
  'Stream invertebrates': ['Kick net (hard-bottomed, semi-quantitative)', 'Kick net (soft-bottomed, semi-quantitative)', 'Surber sampler (quantitative)', 'Sweep net'],
  Fish: ['Electric fishing', 'Fyke nets', 'Gee minnow traps', 'Spotlighting'],
  Birds: ['Five-minute bird count', 'Walk-through survey', 'Acoustic recorder'],
  Vegetation: ['Plot (recce)', 'Transect', 'Walk-through survey'],
  'Lizards and frogs': ['Artificial cover objects', 'Night spotlighting', 'Hand search', 'Pitfall traps'],
  eDNA: ['Filtered water sample, multi-species', 'Filtered water sample, targeted'],
};
const fmt = (v: number | null, dp: number) => (v === null ? '–' : v.toFixed(dp));
const pct = (v: number | null | undefined) => (v === null || v === undefined ? '–' : `${Math.round(v * 100)}%`);
const stream = (k: EcoKind) => k === 'Stream invertebrates';

export function EcologyTab() {
  const data = useProject();
  const { project, siteMap } = data;
  const sites = useMemo(() => [...data.sites], [data.sites]);
  const { surveys, taxa: taxaAll } = data.ecology;
  const taxa: TaxaList = useMemo(() => new Map(taxaAll.map((t) => [t.id, t])), [taxaAll]);
  const [kind, setKind] = useState<'all' | EcoKind>('all');
  const [editing, setEditing] = useState<EcoSurvey | null>(null);
  const [taxaOpen, setTaxaOpen] = useState(false);
  const [tableOpen, setTableOpen] = useState(false);
  const siteCode = (id: string | undefined) => (id ? (siteMap.get(id)?.code ?? '') : '');
  const sorted = useMemo(() => [...surveys].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : siteCode(a.siteId).localeCompare(siteCode(b.siteId)))), [surveys, siteMap]); // eslint-disable-line react-hooks/exhaustive-deps
  const kinds = useMemo(() => ECO_KINDS.filter((k) => sorted.some((s) => s.kind === k)), [sorted]);
  const shown = sorted.filter((s) => kind === 'all' || s.kind === kind);
  const rows = useMemo(() => shown.map((s) => ({ s, x: ecoIndices(s, taxa) })), [shown, taxa]);
  const anyStream = shown.some((s) => stream(s.kind));
  const unscored = useMemo(() => [...new Set(rows.filter((r) => stream(r.s.kind)).flatMap((r) => r.x.unscored))], [rows]);

  const usedIds = new Set(sorted.flatMap((s) => s.records.map((r) => taxonKey(r.taxon))));
  const stem = safeFileName(`${project.code || project.name} ecology`);
  return (
    <Stack gap="md">
      <Card padding="md">
        <Group justify="space-between" wrap="wrap" gap="sm">
          <div style={{ minWidth: 0 }}>
            <Text fw={600}>Ecology surveys</Text>
            <Text size="sm" c="dimmed">
              What was found where: stream invertebrates, fish, birds, plants, eDNA. Each survey works out how many taxa there were and how evenly they’re spread – and, for stream invertebrates, EPT and the MCI.
            </Text>
          </div>
          <Group gap="xs">
            <Button variant="default" leftSection={<IconListDetails size={16} />} onClick={() => setTaxaOpen(true)}>
              Taxa and scores…
            </Button>
            <Button variant="default" leftSection={<IconTable size={16} />} onClick={() => setTableOpen(true)}>
              Paste a results table…
            </Button>
            <Menu position="bottom-end">
              <Menu.Target>
                <Button variant="default" leftSection={<IconDownload size={16} />} disabled={!sorted.length}>
                  Export
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item onClick={() => downloadBlob(new Blob([`﻿${indicesCsv(shown, siteCode, taxa)}`], { type: 'text/csv' }), `${stem} - surveys.csv`)}>The surveys and their indices (CSV)</Menu.Item>
                <Menu.Item onClick={() => downloadBlob(new Blob([`﻿${recordsCsv(shown, siteCode, taxa)}`], { type: 'text/csv' }), `${stem} - records.csv`)}>Every record, a line each (CSV)</Menu.Item>
              </Menu.Dropdown>
            </Menu>
            <Button
              leftSection={<IconPlus size={16} />}
              onClick={() => {
                const k = kind === 'all' ? (sorted[0]?.kind ?? 'Stream invertebrates') : kind;
                setEditing(newSurvey(project.id, { siteId: sites[0]?.id, kind: k, ...likeTheLast(sorted, k) }));
              }}
            >
              Add a survey
            </Button>
          </Group>
        </Group>
      </Card>
      {kinds.length > 1 && (
        <Chip.Group value={kind} onChange={(v) => setKind(v as 'all' | EcoKind)}>
          <Group gap={6}>
            <Chip value="all" size="xs" variant="light">
              All {sorted.length}
            </Chip>
            {kinds.map((k) => (
              <Chip key={k} value={k} size="xs" variant="light">
                {k} {sorted.filter((s) => s.kind === k).length}
              </Chip>
            ))}
          </Group>
        </Chip.Group>
      )}
      {!sorted.length ? (
        <EmptyState icon={<IconLeaf size={32} />} title="No surveys yet">
          Add a survey for a site and a day, then type or paste what was found – a taxon a line, with how many (a number, or R, C, A, VA, VVA). Or paste a whole results table – the taxa down the side, a column for each site or sample – as a taxonomist’s or an eDNA
          lab’s spreadsheet has it. The taxa join the team’s list, where each can be given its group and its MCI tolerance score.
        </EmptyState>
      ) : (
        <Card padding={0}>
          <Table.ScrollContainer minWidth={760}>
            <Table verticalSpacing="xs" highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Date</Table.Th>
                  <Table.Th>Site</Table.Th>
                  <Table.Th>Survey</Table.Th>
                  <Table.Th ta="right">Taxa</Table.Th>
                  <Table.Th ta="right">Individuals</Table.Th>
                  <Table.Th ta="right">
                    <Tooltip label="Shannon’s diversity: higher with more taxa, more evenly spread">
                      <span>H′</span>
                    </Tooltip>
                  </Table.Th>
                  {anyStream && (
                    <>
                      <Table.Th ta="right">EPT taxa</Table.Th>
                      <Table.Th ta="right">MCI</Table.Th>
                      <Table.Th ta="right">QMCI</Table.Th>
                    </>
                  )}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map(({ s, x }) => (
                  <Table.Tr key={s.id} style={{ cursor: 'pointer' }} onClick={() => setEditing(s)}>
                    <Table.Td style={{ whiteSpace: 'nowrap' }}>{formatDate(s.date)}</Table.Td>
                    <Table.Td>{siteCode(s.siteId) || s.place || '–'}</Table.Td>
                    <Table.Td>
                      <Text size="sm">{s.kind}</Text>
                      {s.method && (
                        <Text size="xs" c="dimmed" lineClamp={1}>
                          {s.method}
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td ta="right">{x.richness}</Table.Td>
                    <Table.Td ta="right">{x.total === null ? '–' : x.total.toLocaleString()}</Table.Td>
                    <Table.Td ta="right">{fmt(x.shannon, 2)}</Table.Td>
                    {anyStream && (
                      <>
                        <Table.Td ta="right">{stream(s.kind) && x.ept ? `${x.ept.taxa} (${pct(x.ept.taxaShare)})` : '–'}</Table.Td>
                        <Table.Td ta="right">{stream(s.kind) ? fmt(x.mci, 0) : '–'}</Table.Td>
                        <Table.Td ta="right">
                          {stream(s.kind) ? fmt(x.qmci, 2) : '–'}
                          {stream(s.kind) && x.unscored.length > 0 && x.scored > 0 && (
                            <Tooltip label={`${x.unscored.length} of its taxa have no score: ${x.unscored.slice(0, 6).join(', ')}${x.unscored.length > 6 ? ' …' : ''}`} multiline maw={300}>
                              <Text span c="orange.7" ml={4}>
                                *
                              </Text>
                            </Tooltip>
                          )}
                        </Table.Td>
                      </>
                    )}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Card>
      )}
      {anyStream && unscored.length > 0 && (
        <Alert color="orange" variant="light" p="xs">
          <Text size="sm">
            {unscored.length} stream invertebrate {unscored.length === 1 ? 'taxon has' : 'taxa have'} no tolerance score, so {unscored.length === 1 ? 'it’s' : 'they’re'} left out of the MCI and QMCI: {unscored.slice(0, 8).join(', ')}
            {unscored.length > 8 ? ` and ${unscored.length - 8} more` : ''}. EnviroDB has no scores of its own – give them in <b>Taxa and scores…</b>, from the published list you work to.
          </Text>
        </Alert>
      )}
      {sorted.length > 0 && (
        <Text size="xs" c="dimmed">
          H′ is Shannon’s diversity (natural log). EPT taxa are the mayflies, stoneflies and caddisflies, by each taxon’s group in the taxa list. MCI is 20 × the mean tolerance score of the taxa found; QMCI weights the scores by how many of each (SQMCI, from coded
          abundances: R 1, C 5, A 20, VA 100, VVA 500).
        </Text>
      )}
      {editing && <SurveyModal key={editing.id} survey={editing} isNew={!sorted.some((s) => s.id === editing.id)} sites={sites} taxa={taxa} onClose={() => setEditing(null)} />}
      {taxaOpen && <TaxaModal taxa={taxaAll} used={usedIds} onClose={() => setTaxaOpen(false)} />}
      {tableOpen && <TableModal projectId={project.id} sites={sites} surveys={sorted} startKind={kind === 'all' ? (sorted[0]?.kind ?? 'Stream invertebrates') : kind} onClose={() => setTableOpen(false)} />}
    </Stack>
  );
}

/** A survey's numbers, as they're worked out while it's typed. */
function IndicesPanel({ x, kind }: { x: EcoIndices; kind: EcoKind }) {
  const cell = (label: string, value: string, hint?: string) => (
    <div>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text fw={600}>{value}</Text>
      {hint && (
        <Text size="xs" c="dimmed">
          {hint}
        </Text>
      )}
    </div>
  );
  return (
    <Card withBorder padding="sm">
      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
        {cell('Taxa', String(x.richness))}
        {cell('Individuals', x.total === null ? '–' : x.total.toLocaleString(), x.approximate ? 'from coded abundances' : undefined)}
        {cell('Shannon H′', fmt(x.shannon, 2), x.evenness !== null ? `evenness ${x.evenness.toFixed(2)}` : undefined)}
        {cell('Commonest', x.dominant ? `${Math.round(x.dominant.share * 100)}%` : '–', x.dominant?.taxon)}
        {stream(kind) && cell('EPT taxa', x.ept ? `${x.ept.taxa} (${pct(x.ept.taxaShare)})` : '–', x.ept ? (x.ept.share !== null ? `${pct(x.ept.share)} of individuals` : undefined) : 'needs the taxa’s groups')}
        {stream(kind) && cell('MCI', fmt(x.mci, 0), x.scored ? `${x.scored} of ${x.richness} taxa scored` : 'needs tolerance scores')}
        {stream(kind) && cell(x.qmciKind ?? 'QMCI', fmt(x.qmci, 2))}
        {cell('Simpson 1 − D', fmt(x.simpson, 2))}
      </SimpleGrid>
    </Card>
  );
}

function SurveyModal({ survey, isNew, sites, taxa, onClose }: { survey: EcoSurvey; isNew: boolean; sites: Array<{ id: string; code: string; name?: string }>; taxa: TaxaList; onClose: () => void }) {
  const [s, setS] = useState<EcoSurvey>(survey);
  const [where, setWhere] = useState<'site' | 'place'>(survey.siteId || !survey.place ? 'site' : 'place');
  const [pasting, setPasting] = useState(false);
  const [busy, setBusy] = useState(false);
  const x = useMemo(() => ecoIndices(s, taxa), [s, taxa]);
  const names = useMemo(() => [...taxa.values()].map((t) => t.name).sort((a, b) => a.localeCompare(b)), [taxa]);
  const setRecord = (i: number, patch: Partial<EcoRecord>) => setS({ ...s, records: s.records.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const how = countsOf(s.records);
  const save = async () => {
    setBusy(true);
    try {
      await saveSurvey({ ...s, records: s.records.filter((r) => r.taxon.trim()), ...(where === 'site' ? { place: undefined } : { siteId: undefined }) }, isNew ? undefined : survey);
      onClose();
    } catch (e) {
      notifications.show({ color: 'red', message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    const undo = await deleteSurvey(survey);
    onClose();
    notifications.show({
      autoClose: 10000,
      message: (
        <Group gap="xs" wrap="nowrap" justify="space-between">
          <Text size="sm">Survey deleted.</Text>
          <Button size="compact-xs" variant="light" onClick={() => void undo()}>
            Undo
          </Button>
        </Group>
      ),
    });
  };
  return (
    <Modal opened onClose={onClose} title={isNew ? 'A survey' : `${s.kind} – ${formatDate(s.date)}`} size="min(960px, 96vw)">
      <Stack gap="sm">
        <Group grow align="flex-start">
          <DateField label="Date" value={s.date} onChange={(v) => v && setS({ ...s, date: v })} />
          <Select label="Survey of" data={[...ECO_KINDS]} value={s.kind} onChange={(v) => v && setS({ ...s, kind: v as EcoKind })} allowDeselect={false} comboboxProps={{ withinPortal: true }} />
          {where === 'site' ? (
            <Select
              label="Site"
              data={[...sites.map((x) => ({ value: x.id, label: `${x.code}${x.name ? ` – ${x.name}` : ''}` })), { value: '__place', label: 'Somewhere else…' }]}
              value={s.siteId ?? null}
              onChange={(v) => (v === '__place' ? setWhere('place') : setS({ ...s, siteId: v ?? undefined }))}
              searchable
              comboboxProps={{ withinPortal: true }}
            />
          ) : (
            <TextInput label="Place" description={<Text span size="xs" c="blue" style={{ cursor: 'pointer' }} onClick={() => setWhere('site')}>One of the project’s sites instead</Text>} value={s.place ?? ''} onChange={(e) => setS({ ...s, place: e.currentTarget.value })} placeholder="e.g. Wetland margin, north" />
          )}
        </Group>
        <Group grow align="flex-start">
          <Autocomplete label="Method" data={METHODS[s.kind] ?? []} value={s.method ?? ''} onChange={(v) => setS({ ...s, method: v })} placeholder="How it was done" comboboxProps={{ withinPortal: true }} />
          <TextInput label="Effort" value={s.effort ?? ''} onChange={(e) => setS({ ...s, effort: e.currentTarget.value })} placeholder="e.g. 0.6 m², 50 m reach, 5 minutes" />
          <TextInput label="By" value={s.by ?? ''} onChange={(e) => setS({ ...s, by: e.currentTarget.value })} placeholder="Who surveyed, who identified" />
        </Group>
        {stream(s.kind) && (
          <Group gap="sm" align="center">
            <Text size="sm" fw={500}>
              Stream bed
            </Text>
            <SegmentedControl size="xs" value={s.bed ?? 'hard'} onChange={(v) => setS({ ...s, bed: v as 'hard' | 'soft' })} data={[{ value: 'hard', label: 'Hard-bottomed' }, { value: 'soft', label: 'Soft-bottomed' }]} />
            <Text size="xs" c="dimmed">
              Which of each taxon’s tolerance scores counts.
            </Text>
            <TextInput size="xs" aria-label="Tolerance scores from" value={s.scores ?? ''} onChange={(e) => setS({ ...s, scores: e.currentTarget.value })} placeholder="Scores from – e.g. Stark & Maxted 2007" w={300} ml="auto" />
          </Group>
        )}
        <IndicesPanel x={x} kind={s.kind} />
        <Group justify="space-between" align="flex-end">
          <Text size="sm" fw={500}>
            What was found {s.records.length ? `(${s.records.length})` : ''}
          </Text>
          <Group gap="xs">
            <Button size="compact-sm" variant="default" leftSection={<IconClipboardText size={14} />} onClick={() => setPasting(true)}>
              Paste a list…
            </Button>
            <Button size="compact-sm" variant="light" leftSection={<IconPlus size={14} />} onClick={() => setS({ ...s, records: [...s.records, { taxon: '' }] })}>
              Add a taxon
            </Button>
          </Group>
        </Group>
        {s.records.length > 0 ? (
          <Table.ScrollContainer minWidth={560} mah={360} style={{ overflowY: 'auto' }}>
            <Table verticalSpacing={4} horizontalSpacing={6}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Taxon</Table.Th>
                  <Table.Th w={110}>Count</Table.Th>
                  <Table.Th w={120}>or coded</Table.Th>
                  <Table.Th>Note</Table.Th>
                  <Table.Th w={32} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {s.records.map((r, i) => {
                  const t = taxa.get(taxonKey(r.taxon));
                  return (
                    <Table.Tr key={i}>
                      <Table.Td>
                        <Autocomplete
                          size="xs"
                          aria-label={`Taxon ${i + 1}`}
                          data={names}
                          limit={12}
                          value={r.taxon}
                          onChange={(v) => setRecord(i, { taxon: v })}
                          placeholder="Name"
                          comboboxProps={{ withinPortal: true }}
                          rightSectionWidth={stream(s.kind) && t ? 66 : undefined}
                          rightSection={
                            stream(s.kind) && t && (t.group || t.mci !== undefined) ? (
                              <Text size="xs" c="dimmed" pr={6} style={{ whiteSpace: 'nowrap' }}>
                                {isEpt(t) ? 'EPT' : ''} {(s.bed === 'soft' ? (t.mciSb ?? t.mci) : t.mci) ?? ''}
                              </Text>
                            ) : undefined
                          }
                        />
                      </Table.Td>
                      <Table.Td>
                        <NumberInput size="xs" aria-label={`Count of taxon ${i + 1}`} value={r.n ?? ''} min={0} hideControls onChange={(v) => setRecord(i, { n: v === '' ? undefined : Number(v), ...(v !== '' ? { code: undefined } : {}) })} />
                      </Table.Td>
                      <Table.Td>
                        <Select
                          size="xs"
                          aria-label={`Coded abundance of taxon ${i + 1}`}
                          data={ECO_CODES.map((c) => ({ value: c, label: c }))}
                          renderOption={({ option }) => <Text size="sm">{CODE_TEXT[option.value as EcoCode]}</Text>}
                          value={r.code ?? null}
                          onChange={(v) => setRecord(i, { code: (v as EcoCode | null) ?? undefined, ...(v ? { n: undefined } : {}) })}
                          clearable
                          placeholder="–"
                          comboboxProps={{ withinPortal: true, width: 220 }}
                        />
                      </Table.Td>
                      <Table.Td>
                        <TextInput size="xs" aria-label={`Note on taxon ${i + 1}`} value={r.note ?? ''} onChange={(e) => setRecord(i, { note: e.currentTarget.value || undefined })} />
                      </Table.Td>
                      <Table.Td>
                        <ActionIcon size="sm" variant="subtle" color="gray" aria-label={`Take off taxon ${i + 1}`} onClick={() => setS({ ...s, records: s.records.filter((_, j) => j !== i) })}>
                          <IconTrash size={14} />
                        </ActionIcon>
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        ) : (
          <Text size="sm" c="dimmed">
            Nothing yet – add a taxon, or paste a list from a spreadsheet (a taxon a line, with how many).
          </Text>
        )}
        {how === 'mixed' && (
          <Text size="xs" c="orange.8">
            Some taxa have a number and some a coded abundance: the codes count as the numbers they stand for, so the totals are approximate.
          </Text>
        )}
        {stream(s.kind) && x.unscored.length > 0 && (
          <Text size="xs" c="orange.8">
            No tolerance score for {x.unscored.slice(0, 6).join(', ')}
            {x.unscored.length > 6 ? ` and ${x.unscored.length - 6} more` : ''} – left out of the MCI and QMCI until the taxa list has one (Taxa and scores…).
          </Text>
        )}
        <Textarea label="Notes" autosize minRows={2} value={s.notes ?? ''} onChange={(e) => setS({ ...s, notes: e.currentTarget.value })} placeholder="Conditions, habitat, anything unusual" />
        <Group justify="space-between">
          <div>
            {!isNew && (
              <Button variant="subtle" color="red" leftSection={<IconTrash size={16} />} onClick={() => void remove()}>
                Delete
              </Button>
            )}
          </div>
          <Group gap="xs">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => void save()} loading={busy} disabled={!s.date || (where === 'place' && !s.place?.trim() && !s.siteId) || same(s, survey)}>
              Save
            </Button>
          </Group>
        </Group>
      </Stack>
      {pasting && (
        <PasteModal
          title="Paste what was found"
          hint="A taxon a line, then how many – a number, or a coded abundance (R, C, A, VA, VVA), or nothing for “present” – then a note. Copied from a spreadsheet, or typed."
          placeholder={'Deleatidium\t42\nAoteapsyche\tVA\nPotamopyrgus'}
          onClose={() => setPasting(false)}
          onTake={(text) => {
            const got = parseRecords(text);
            setS({ ...s, records: [...s.records.filter((r) => r.taxon.trim()), ...got.records] });
            setPasting(false);
            notifications.show({ color: got.records.length ? 'teal' : 'orange', message: `${got.records.length} taxa added${got.skipped.length ? ` – ${got.skipped.length} line${got.skipped.length === 1 ? '' : 's'} left out (${got.skipped.slice(0, 3).join(', ')})` : ''}.` });
          }}
        />
      )}
    </Modal>
  );
}

function PasteModal({ title, hint, placeholder, onClose, onTake }: { title: string; hint: string; placeholder: string; onClose: () => void; onTake: (text: string) => void }) {
  const [text, setText] = useState('');
  return (
    <Modal opened onClose={onClose} title={title} size="lg">
      <Stack gap="sm">
        <Text size="sm" c="dimmed">
          {hint}
        </Text>
        <Textarea autosize minRows={8} maxRows={18} value={text} onChange={(e) => setText(e.currentTarget.value)} placeholder={placeholder} data-autofocus styles={{ input: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 13 } }} aria-label={title} />
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onTake(text)} disabled={!text.trim()}>
            Add them
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/** The team's taxa: each one's group, its tolerance scores, whether it counts for EPT – typed in, or pasted from the list the team works to. */
function TaxaModal({ taxa, used, onClose }: { taxa: Taxon[]; used: Set<string>; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [drafts, setDrafts] = useState<Record<string, Taxon>>({});
  const [pasting, setPasting] = useState(false);
  const [onlyUsed, setOnlyUsed] = useState(used.size > 0);
  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    return [...taxa]
      .filter((t) => (!onlyUsed || used.has(t.id)) && (!n || [t.name, t.group, t.common].filter(Boolean).join(' ').toLowerCase().includes(n)))
      .sort((a, b) => (a.group ?? '￿').localeCompare(b.group ?? '￿') || a.name.localeCompare(b.name));
  }, [taxa, q, onlyUsed, used]);
  const row = (t: Taxon) => drafts[t.id] ?? t;
  const set = (t: Taxon, patch: Partial<Taxon>) => setDrafts({ ...drafts, [t.id]: { ...row(t), ...patch } });
  const changed = Object.entries(drafts).filter(([id, d]) => {
    const cur = taxa.find((t) => t.id === id);
    return cur && !same({ ...d, updatedAt: '' }, { ...cur, updatedAt: '' });
  });
  const save = async () => {
    for (const [id, d] of changed) await saveTaxon(d, taxa.find((t) => t.id === id));
    setDrafts({});
    notifications.show({ color: 'teal', message: `${changed.length} ${changed.length === 1 ? 'taxon' : 'taxa'} saved – for every project.` });
  };
  const scored = taxa.filter((t) => t.mci !== undefined).length;
  return (
    <Modal opened onClose={onClose} title="Taxa and scores" size="min(1040px, 96vw)">
      <Stack gap="sm">
        <Text size="sm" c="dimmed">
          The team’s taxa, for every project: each one’s group (its order, say – Ephemeroptera, Plecoptera and Trichoptera count for EPT) and, for stream invertebrates, its MCI tolerance score. EnviroDB has no scores of its own: type them in, or paste the published list you
          work to. {taxa.length ? `${scored} of ${taxa.length} taxa have a score.` : ''} Many reports leave the caddisflies Oxyethira and Paroxyethira (Hydroptilidae) out of EPT – set EPT to No for those if yours does.
        </Text>
        <Group gap="xs" justify="space-between">
          <Group gap="xs">
            <TextInput size="xs" placeholder="Search taxa…" value={q} onChange={(e) => setQ(e.currentTarget.value)} w={220} aria-label="Search taxa" />
            {used.size > 0 && (
              <Chip size="xs" variant="light" checked={onlyUsed} onChange={setOnlyUsed}>
                In this project’s surveys
              </Chip>
            )}
          </Group>
          <Button size="xs" variant="default" leftSection={<IconClipboardText size={14} />} onClick={() => setPasting(true)}>
            Paste a list…
          </Button>
        </Group>
        {list.length ? (
          <Table.ScrollContainer minWidth={760} mah="52vh" style={{ overflowY: 'auto' }}>
            <Table verticalSpacing={3} horizontalSpacing={6} stickyHeader>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Taxon</Table.Th>
                  <Table.Th>Group</Table.Th>
                  <Table.Th w={90}>MCI score</Table.Th>
                  <Table.Th w={110}>Soft-bottomed</Table.Th>
                  <Table.Th w={120}>EPT</Table.Th>
                  <Table.Th>Common name</Table.Th>
                  <Table.Th>Status</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {list.slice(0, 400).map((t) => {
                  const d = row(t);
                  return (
                    <Table.Tr key={t.id} className={drafts[t.id] && !same({ ...d, updatedAt: '' }, { ...t, updatedAt: '' }) ? 'edb-unsaved-row' : undefined}>
                      <Table.Td>
                        <Text size="sm">{t.name}</Text>
                      </Table.Td>
                      <Table.Td>
                        <TextInput size="xs" aria-label={`Group of ${t.name}`} value={d.group ?? ''} onChange={(e) => set(t, { group: e.currentTarget.value || undefined })} />
                      </Table.Td>
                      <Table.Td>
                        <NumberInput size="xs" aria-label={`MCI score of ${t.name}`} value={d.mci ?? ''} min={0} max={10} hideControls onChange={(v) => set(t, { mci: v === '' ? undefined : Number(v) })} />
                      </Table.Td>
                      <Table.Td>
                        <NumberInput size="xs" aria-label={`Soft-bottomed score of ${t.name}`} value={d.mciSb ?? ''} min={0} max={10} hideControls onChange={(v) => set(t, { mciSb: v === '' ? undefined : Number(v) })} />
                      </Table.Td>
                      <Table.Td>
                        <Select
                          size="xs"
                          aria-label={`Whether ${t.name} counts for EPT`}
                          data={[
                            { value: 'group', label: `By its group (${isEpt({ group: d.group }) ? 'yes' : 'no'})` },
                            { value: 'yes', label: 'Yes' },
                            { value: 'no', label: 'No' },
                          ]}
                          value={d.ept === undefined ? 'group' : d.ept ? 'yes' : 'no'}
                          onChange={(v) => set(t, { ept: v === 'yes' ? true : v === 'no' ? false : undefined })}
                          allowDeselect={false}
                          comboboxProps={{ withinPortal: true }}
                        />
                      </Table.Td>
                      <Table.Td>
                        <TextInput size="xs" aria-label={`Common name of ${t.name}`} value={d.common ?? ''} onChange={(e) => set(t, { common: e.currentTarget.value || undefined })} />
                      </Table.Td>
                      <Table.Td>
                        <TextInput size="xs" aria-label={`Status of ${t.name}`} value={d.status ?? ''} onChange={(e) => set(t, { status: e.currentTarget.value || undefined })} placeholder="e.g. native, At Risk – Declining" />
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        ) : (
          <Text size="sm" c="dimmed" py="md" ta="center">
            {taxa.length ? 'None match.' : 'No taxa yet – they’re added as surveys are, or paste a list.'}
          </Text>
        )}
        {list.length > 400 && (
          <Text size="xs" c="dimmed">
            Showing the first 400 – search to find the rest.
          </Text>
        )}
        <Group justify="space-between">
          <Badge variant="light" color={changed.length ? 'yellow' : 'gray'}>
            {changed.length ? `${changed.length} changed` : 'No changes'}
          </Badge>
          <Group gap="xs">
            <Button variant="default" onClick={onClose}>
              Close
            </Button>
            <Button onClick={() => void save()} disabled={!changed.length}>
              Save
            </Button>
          </Group>
        </Group>
      </Stack>
      {pasting && (
        <PasteModal
          title="Paste a taxa list"
          hint="From a spreadsheet, with a heading row: Taxon, and any of Group (or Order), MCI, MCI-sb, Common name, Status – in any order. Without headings: the taxon, its hard-bottom score, its soft-bottom score. What the list leaves blank stays as it is."
          placeholder={'Taxon\tOrder\tMCI\tMCI-sb\nDeleatidium\tEphemeroptera\t…\t…'}
          onClose={() => setPasting(false)}
          onTake={(text) => {
            const got = parseTaxa(text);
            void mergeTaxa(got.taxa).then((r) => {
              setPasting(false);
              notifications.show({ color: r.added + r.changed ? 'teal' : 'orange', message: `${r.added} added, ${r.changed} changed${got.skipped.length ? `; ${got.skipped.length} line${got.skipped.length === 1 ? '' : 's'} left out` : ''}.` });
            });
          }}
        />
      )}
    </Modal>
  );
}

const plain = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * A whole results table pasted in – the taxa down the side, a column of counts for each site or sample – made into a
 * survey a column: each column given its site and its day here.
 */
function TableModal({ projectId, sites, surveys, startKind, onClose }: { projectId: string; sites: Array<{ id: string; code: string; name?: string }>; surveys: EcoSurvey[]; startKind: EcoKind; onClose: () => void }) {
  const [text, setText] = useState('');
  const [table, setTable] = useState<PastedTable | null>(null);
  const [unread, setUnread] = useState(false);
  const [kind, setKind] = useState<EcoKind>(startKind);
  const [like, setLike] = useState<Partial<EcoSurvey>>(() => likeTheLast(surveys, startKind));
  const [cols, setCols] = useState<Array<{ on: boolean; siteId: string | null; date: string }>>([]);
  const [pool, setPool] = useState(false);
  const [busy, setBusy] = useState(false);
  const read = (from: string) => {
    const got = parseTable(from);
    setUnread(!got?.columns.length);
    if (!got?.columns.length) return;
    setTable(got);
    // a column headed with a site's code (or its name) is that site's
    setCols(got.columns.map((c) => ({ on: true, siteId: sites.find((x) => plain(x.code) === plain(c.header) || (!!x.name && plain(x.name) === plain(c.header)))?.id ?? null, date: todayStr() })));
  };
  const setCol = (i: number, patch: Partial<(typeof cols)[number]>) => setCols(cols.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const chosen = table ? table.columns.map((c, i) => ({ c, at: cols[i] })).filter((x) => x.at?.on) : [];
  const keyOf = (x: (typeof chosen)[number]) => `${x.at.siteId ?? `place:${x.c.header}`}|${x.at.date}`;
  const places = new Set(chosen.map(keyOf)).size;
  const count = pool ? places : chosen.length;
  /** The surveys the chosen columns make – columns for the same place and day added up into one when asked. */
  const build = (): EcoSurvey[] => {
    const out: Array<{ survey: EcoSurvey; headers: string[] }> = [];
    const byKey = new Map<string, (typeof out)[number]>();
    for (const x of chosen) {
      const { c, at } = x;
      const site = sites.find((y) => y.id === at.siteId);
      // the column's heading is kept in the survey's notes where it says more than the site does (a sample number)
      const said = site && plain(site.code) !== plain(c.header) ? c.header : '';
      const cur = pool ? byKey.get(keyOf(x)) : undefined;
      if (cur) {
        cur.survey.records = mergedRecords([...cur.survey.records, ...c.records]);
        if (said) cur.headers.push(said);
        continue;
      }
      const entry = { survey: newSurvey(projectId, { kind, date: at.date, ...(site ? { siteId: site.id } : { place: c.header }), ...like, records: c.records }), headers: said ? [said] : [] };
      byKey.set(keyOf(x), entry);
      out.push(entry);
    }
    return out.map(({ survey, headers }) => (headers.length ? { ...survey, notes: `From the results table pasted in: ${headers.length === 1 ? 'column' : 'columns'} ${headers.map((h) => `“${h}”`).join(', ')}.` } : survey));
  };
  const save = async () => {
    if (!table) return;
    setBusy(true);
    try {
      const r = await saveSurveys(build(), table.taxa);
      notifications.show({ color: 'teal', message: `${r.surveys} ${r.surveys === 1 ? 'survey' : 'surveys'} added${r.taxaAdded ? ` – ${r.taxaAdded} new ${r.taxaAdded === 1 ? 'taxon joins' : 'taxa join'} the team’s list` : ''}.` });
      onClose();
    } catch (e) {
      notifications.show({ color: 'red', message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal opened onClose={onClose} title="Paste a results table" size="min(900px, 96vw)">
      {!table ? (
        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            Copy the table in the spreadsheet – the taxa down the side, a column of counts for each site or sample, headings included – and paste it here. A taxonomist’s results and an eDNA lab’s (a row a sequence, a column a sample) both read; totals and indices at
            the foot are left out.
          </Text>
          <Textarea
            autosize
            minRows={8}
            maxRows={16}
            value={text}
            onChange={(e) => {
              setText(e.currentTarget.value);
              setUnread(false);
            }}
            placeholder={'Taxon\tUS1\tDS1\nDeleatidium\t42\t3\nPotamopyrgus\t\t260'}
            data-autofocus
            aria-label="The results table"
            styles={{ input: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 13, whiteSpace: 'pre', overflowX: 'auto' } }}
          />
          {unread && (
            <Text size="sm" c="red.7">
              That doesn’t read as a results table: it needs a heading row, the taxa down the side and at least one column of counts.
            </Text>
          )}
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => read(text)} disabled={!text.trim()}>
              Read it
            </Button>
          </Group>
        </Stack>
      ) : (
        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            {table.columns.length} {table.columns.length === 1 ? 'column' : 'columns'} of counts{table.skipped ? ` (${table.skipped} ${table.skipped === 1 ? 'line' : 'lines'} left out – no taxon, or a total)` : ''}. Each becomes a survey: say where it was and the day – the date here sets every column’s.
          </Text>
          <Group grow align="flex-start">
            <Select
              label="Surveys of"
              data={[...ECO_KINDS]}
              value={kind}
              onChange={(v) => {
                if (!v) return;
                setKind(v as EcoKind);
                setLike(likeTheLast(surveys, v as EcoKind));
              }}
              allowDeselect={false}
              comboboxProps={{ withinPortal: true }}
            />
            <Autocomplete label="Method" data={METHODS[kind] ?? []} value={like.method ?? ''} onChange={(v) => setLike({ ...like, method: v })} placeholder="How it was done" comboboxProps={{ withinPortal: true }} />
            <DateField label="Date" value={cols.every((c) => c.date === cols[0]?.date) ? cols[0]?.date : undefined} placeholder="Several" onChange={(v) => v && setCols(cols.map((c) => ({ ...c, date: v })))} />
          </Group>
          {stream(kind) && (
            <Group gap="sm" align="center">
              <Text size="sm" fw={500}>
                Stream bed
              </Text>
              <SegmentedControl size="xs" value={like.bed ?? 'hard'} onChange={(v) => setLike({ ...like, bed: v as 'hard' | 'soft' })} data={[{ value: 'hard', label: 'Hard-bottomed' }, { value: 'soft', label: 'Soft-bottomed' }]} />
              <TextInput size="xs" aria-label="Tolerance scores from" value={like.scores ?? ''} onChange={(e) => setLike({ ...like, scores: e.currentTarget.value })} placeholder="Scores from – e.g. Stark & Maxted 2007" w={300} ml="auto" />
            </Group>
          )}
          <Table.ScrollContainer minWidth={620} mah="44vh" style={{ overflowY: 'auto' }}>
            <Table verticalSpacing={4} horizontalSpacing={6}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={32} />
                  <Table.Th>Column</Table.Th>
                  <Table.Th ta="right">Taxa</Table.Th>
                  <Table.Th ta="right">Individuals</Table.Th>
                  <Table.Th>Where</Table.Th>
                  <Table.Th w={150}>Date</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {table.columns.map((c, i) => {
                  const at = cols[i];
                  const total = c.records.every((r) => typeof r.n === 'number') ? c.records.reduce((n, r) => n + (r.n ?? 0), 0) : null;
                  return (
                    <Table.Tr key={i} style={at.on ? undefined : { opacity: 0.5 }}>
                      <Table.Td>
                        <Checkbox size="xs" aria-label={`Bring in ${c.header}`} checked={at.on} onChange={(e) => setCol(i, { on: e.currentTarget.checked })} />
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm" fw={500}>
                          {c.header}
                        </Text>
                      </Table.Td>
                      <Table.Td ta="right">{c.records.length}</Table.Td>
                      <Table.Td ta="right">{total === null ? '–' : total.toLocaleString()}</Table.Td>
                      <Table.Td>
                        <Select
                          size="xs"
                          aria-label={`Where ${c.header} was`}
                          data={[{ value: '__place', label: `Somewhere else: “${c.header}”` }, ...sites.map((x) => ({ value: x.id, label: `${x.code}${x.name ? ` – ${x.name}` : ''}` }))]}
                          value={at.siteId ?? '__place'}
                          onChange={(v) => setCol(i, { siteId: !v || v === '__place' ? null : v })}
                          allowDeselect={false}
                          searchable
                          disabled={!at.on}
                          comboboxProps={{ withinPortal: true }}
                        />
                      </Table.Td>
                      <Table.Td>
                        <DateField size="xs" aria-label={`The day ${c.header} was taken`} value={at.date} onChange={(v) => v && setCol(i, { date: v })} disabled={!at.on} />
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
          {(places < chosen.length || pool) && <Switch label="Add up the columns for the same place and day into one survey (replicates)" checked={pool} onChange={(e) => setPool(e.currentTarget.checked)} />}
          {table.taxa.length > 0 && (
            <Text size="xs" c="dimmed">
              The table’s groups and common names go into the team’s taxa list where a taxon has none – they never change the team’s own.
            </Text>
          )}
          <Group justify="space-between">
            <Button variant="subtle" onClick={() => setTable(null)}>
              Paste again
            </Button>
            <Group gap="xs">
              <Button variant="default" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={() => void save()} loading={busy} disabled={!count}>
                Add {count} {count === 1 ? 'survey' : 'surveys'}
              </Button>
            </Group>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}
