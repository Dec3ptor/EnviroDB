// The QA/QC tab: what the checks found in the project's results – swapped bottles, unusual results, duplicates,
// blanks, ion balance … – and what was done about each (fine, left out, swapped back, queried with the lab), with
// the duplicates' RPDs, the QC samples and the project's QA/QC log.

import { useMemo, useState } from 'react';
import { Accordion, Alert, Anchor, Badge, Button, Card, Checkbox, Group, Modal, SegmentedControl, Select, Stack, Table, Text, Textarea, Title, Tooltip } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconArrowBackUp, IconArrowsExchange, IconCheck, IconCopy, IconEyeOff, IconMailQuestion } from '@tabler/icons-react';
import { useProject } from '../../hooks/useProjectData';
import { useProjectQa, type QaRange } from '../../hooks/useQa';
import { useViewState } from '../../hooks/useViewState';
import { QA_KIND_ORDER, QA_KINDS, QC_SITE_TYPE, looksLikeQc, qcKind, type QaFinding } from '../../lib/qa';
import { acceptFinding, excludeResults, labQueryText, queryFinding, setDuplicateOf, setSampleQc, swapFinding, undoRecord } from '../../db/qa';
import { saveSite } from '../../db/repo';
import { copyText } from '../../lib/clipboard';
import { addDays, dayOf, formatDate } from '../../lib/dates';
import { displayValue } from '../../lib/analysis';
import { unitLabel } from '../../lib/units';
import type { QaRecord, Result, Sample } from '../../db/types';

const STATUS: Record<QaRecord['status'], { label: string; color: string }> = {
  accepted: { label: 'Fine', color: 'teal' },
  excluded: { label: 'Left out', color: 'gray' },
  swapped: { label: 'Swapped', color: 'violet' },
  queried: { label: 'Queried with the lab', color: 'blue' },
};

type Action = { kind: 'accept' | 'exclude' | 'swap' | 'query'; f: QaFinding };

export function QaTab() {
  const data = useProject();
  const { project } = data;
  const [range, setRange] = useViewState<QaRange>(`${project.id}:qa.range`, '12m');
  const [show, setShow] = useViewState<'open' | 'all'>(`${project.id}:qa.show`, 'open');
  const qa = useProjectQa(range);
  const [action, setAction] = useState<Action | null>(null);

  const shown = show === 'open' ? qa.findings.filter((f) => !f.record) : qa.findings;
  const open = qa.findings.filter((f) => !f.record);
  const notes = open.filter((f) => f.severity === 'note').length;
  const dealt = qa.findings.length - open.length;
  const byKind = useMemo(() => QA_KIND_ORDER.map((k) => [k, shown.filter((f) => f.kind === k)] as const).filter(([, l]) => l.length), [shown]);
  // monitoring sites that look like QC sites (a "DUP1" site made before QC sites existed)
  const qcLike = data.sites.filter((s) => looksLikeQc(s.code) || looksLikeQc(s.name ?? ''));

  const copyQuery = async (list: QaFinding[]) => {
    const jobs = [...new Set(list.flatMap((f) => f.sampleIds.map((id) => data.index.sampleById.get(id)?.labJob).filter(Boolean) as string[]))];
    const ok = await copyText(labQueryText(list, { project: project.name, jobs }));
    notifications.show({ message: ok ? 'Copied – paste it into an email to the lab.' : 'Could not copy to the clipboard.', color: ok ? 'teal' : 'red' });
  };
  const toAsk = open.filter((f) => f.severity === 'check' && ['swap', 'outlier', 'duplicate', 'part-whole', 'ion-balance', 'ec-tds', 'impossible', 'blank'].includes(f.kind));

  return (
    <Stack gap="md">
      <Card padding="md">
        <Group justify="space-between" align="flex-end" wrap="wrap" gap="sm">
          <div>
            <Title order={4}>QA/QC checks</Title>
            <Text size="sm" c="dimmed">
              {qa.toCheck ? `${qa.toCheck} to look at` : 'Nothing to look at'}
              {notes ? ` · ${notes} note${notes === 1 ? '' : 's'}` : ''}
              {dealt ? ` · ${dealt} dealt with` : ''}
              {qa.start ? ` – samples from ${formatDate(qa.start)}` : ' – all samples'}
            </Text>
          </div>
          <Group gap="xs" wrap="wrap">
            <SegmentedControl
              size="xs"
              value={range}
              onChange={(v) => setRange(v as QaRange)}
              data={[
                { value: 'latest', label: 'Latest round' },
                { value: '12m', label: '12 months' },
                { value: 'all', label: 'All' },
              ]}
              aria-label="Samples checked"
            />
            <SegmentedControl
              size="xs"
              value={show}
              onChange={(v) => setShow(v as 'open' | 'all')}
              data={[
                { value: 'open', label: 'To look at' },
                { value: 'all', label: 'With dealt with' },
              ]}
              aria-label="Findings shown"
            />
            {toAsk.length > 0 && (
              <Tooltip label="An email to the lab listing these, to paste">
                <Button size="xs" variant="default" leftSection={<IconCopy size={14} />} onClick={() => void copyQuery(toAsk)}>
                  Copy a query for the lab
                </Button>
              </Tooltip>
            )}
          </Group>
        </Group>
        {qcLike.length > 0 && (
          <Alert color="yellow" variant="light" mt="sm" p="xs">
            <Group gap="xs" wrap="wrap">
              <Text size="sm">
                {qcLike.map((s) => s.code).join(', ')} look{qcLike.length === 1 ? 's' : ''} like {qcLike.length === 1 ? 'a quality control site' : 'quality control sites'} (duplicates or blanks). Make {qcLike.length === 1 ? 'it one' : 'them'} to keep {qcLike.length === 1 ? 'its' : 'their'} samples out of the monitoring data and check them as QC samples.
              </Text>
              <Button size="compact-xs" variant="light" onClick={() => void Promise.all(qcLike.map((s) => saveSite({ ...s, type: QC_SITE_TYPE }, s)))}>
                Make {qcLike.length === 1 ? 'it a QC site' : 'them QC sites'}
              </Button>
            </Group>
          </Alert>
        )}
      </Card>

      {!byKind.length && (
        <Card padding="lg">
          <Group gap="xs">
            <IconCheck size={18} color="var(--mantine-color-teal-6)" />
            <Text size="sm">{qa.findings.length ? 'Everything found has been dealt with.' : 'The checks found nothing unusual in these results.'}</Text>
          </Group>
          <Text size="xs" c="dimmed" mt={4}>
            Checked: {QA_KIND_ORDER.map((k) => QA_KINDS[k].title.toLowerCase()).join(', ')}.
          </Text>
        </Card>
      )}

      {byKind.map(([kind, list]) => (
        <Card key={kind} padding="md">
          <Group gap="xs" mb={2}>
            <Text fw={600}>{QA_KINDS[kind].title}</Text>
            <Badge variant="light" color="gray">
              {list.length}
            </Badge>
          </Group>
          <Text size="xs" c="dimmed" mb="sm">
            {QA_KINDS[kind].about}
          </Text>
          <Stack gap="xs">
            {list.map((f) => (
              <FindingRow key={f.key} f={f} onAction={(k) => setAction({ kind: k, f })} onQuery={() => void copyQuery([f])} />
            ))}
          </Stack>
        </Card>
      ))}

      <Accordion variant="separated" multiple>
        <DuplicatesPanel duplicates={qa.duplicates} />
        <QcSamplesPanel qcSamples={qa.qcSamples} />
        <LogPanel />
      </Accordion>

      {action && <ActionModal action={action} onClose={() => setAction(null)} />}
    </Stack>
  );
}

function FindingRow({ f, onAction, onQuery }: { f: QaFinding; onAction: (k: Action['kind']) => void; onQuery: () => void }) {
  const { siteMap, index, project } = useProject();
  const rec = f.record;
  const where = f.siteIds.map((id) => siteMap.get(id)?.code).filter(Boolean).join(', ');
  const colour = rec ? STATUS[rec.status].color : f.severity === 'check' ? 'orange' : 'blue';
  const samples = f.sampleIds.map((id) => index.sampleById.get(id)).filter((s): s is Sample => !!s);
  return (
    <div className="qa-row" style={{ borderLeftColor: `var(--mantine-color-${colour}-5)` }}>
      <Group justify="space-between" align="flex-start" wrap="wrap" gap="xs">
        <div style={{ flex: '1 1 320px', minWidth: 0 }}>
          <Group gap={6} wrap="wrap">
            <Text size="sm" fw={600}>
              {f.title}
            </Text>
            {f.severity === 'note' && !rec && (
              <Badge size="xs" variant="light" color="blue">
                note
              </Badge>
            )}
            {rec && (
              <Badge size="xs" variant="light" color={STATUS[rec.status].color}>
                {STATUS[rec.status].label}
              </Badge>
            )}
          </Group>
          <Text size="xs" c="dimmed">
            {formatDate(f.date)}
            {where ? ` · ${where}` : ''}
            {samples.some((s) => s.labJob) ? ` · job ${[...new Set(samples.map((s) => s.labJob).filter(Boolean))].join(', ')}` : ''}
          </Text>
          <ul className="qa-lines">
            {f.lines.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
          {rec && (
            <Text size="xs" c="dimmed">
              {STATUS[rec.status].label}
              {rec.by ? ` by ${rec.by}` : ''} on {formatDate(rec.at.slice(0, 10))}
              {rec.note ? ` – ${rec.note}` : ''}
            </Text>
          )}
        </div>
        <Group gap={4} wrap="wrap">
          {rec ? (
            <Button size="compact-xs" variant="subtle" color="gray" leftSection={<IconArrowBackUp size={13} />} onClick={() => void undoRecord(rec)}>
              Undo
            </Button>
          ) : f.kind === 'duplicate-link' ? (
            <LinkDuplicate f={f} />
          ) : (
            <>
              {f.swap && (
                <Button size="compact-xs" variant="light" color="violet" leftSection={<IconArrowsExchange size={13} />} onClick={() => onAction('swap')}>
                  Swap back
                </Button>
              )}
              {f.resultIds.length > 0 && (
                <Button size="compact-xs" variant="light" color="gray" leftSection={<IconEyeOff size={13} />} onClick={() => onAction('exclude')}>
                  Leave out…
                </Button>
              )}
              <Button size="compact-xs" variant="light" color="teal" leftSection={<IconCheck size={13} />} onClick={() => onAction('accept')}>
                Fine
              </Button>
              <Tooltip label="Copy an email to the lab about this, and mark it queried">
                <Button
                  size="compact-xs"
                  variant="subtle"
                  leftSection={<IconMailQuestion size={13} />}
                  onClick={() => {
                    onQuery();
                    void queryFinding(project.id, f);
                  }}
                >
                  Query
                </Button>
              </Tooltip>
            </>
          )}
        </Group>
      </Group>
    </div>
  );
}

/** Choose a duplicate's original sample (the suggestion first). */
function LinkDuplicate({ f }: { f: QaFinding }) {
  const { samples, siteMap, index } = useProject();
  const dup = index.sampleById.get(f.sampleIds[0]);
  const [pick, setPick] = useState<string | null>(f.primary ?? null);
  if (!dup) return null;
  const day = dayOf(dup.date);
  const near = samples.filter((s) => dayOf(s.date) >= addDays(day, -3) && dayOf(s.date) <= addDays(day, 3));
  return (
    <Group gap={4} wrap="nowrap">
      <Select
        size="xs"
        w={190}
        placeholder="Duplicate of…"
        data={near.map((s) => ({ value: s.id, label: `${siteMap.get(s.siteId)?.code ?? '?'} ${formatDate(s.date)}${s.id === f.primary ? ' (likely)' : ''}` }))}
        value={pick}
        onChange={setPick}
        aria-label="Duplicate of"
        comboboxProps={{ withinPortal: true }}
      />
      <Button size="compact-sm" disabled={!pick} onClick={() => void setDuplicateOf(dup.id, pick!)}>
        Set
      </Button>
      <Tooltip label="It’s a blank, not a duplicate">
        <Button size="compact-sm" variant="subtle" color="gray" onClick={() => void setSampleQc(dup.id, 'blank')}>
          Blank
        </Button>
      </Tooltip>
    </Group>
  );
}

function ActionModal({ action, onClose }: { action: Action; onClose: () => void }) {
  const { project, index, paramMap, siteMap } = useProject();
  const { f } = action;
  const [note, setNote] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set(f.resultIds));
  const [busy, setBusy] = useState(false);
  const results = f.resultIds.map((id) => [...index.allBySample.values()].flat().find((r) => r.id === id)).filter((r): r is Result => !!r);
  const run = async () => {
    setBusy(true);
    try {
      if (action.kind === 'accept') await acceptFinding(project.id, f, note);
      if (action.kind === 'exclude') await excludeResults(project.id, f, [...picked], note);
      if (action.kind === 'swap') await swapFinding(project.id, f, note);
      onClose();
    } catch (e) {
      notifications.show({ color: 'red', message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const swapA = f.swap ? index.sampleById.get(f.swap.a) : undefined;
  const swapB = f.swap ? index.sampleById.get(f.swap.b) : undefined;
  const title = { accept: 'Fine as it is', exclude: 'Leave results out', swap: 'Swap back', query: 'Query the lab' }[action.kind];
  return (
    <Modal opened onClose={onClose} title={<Text fw={600}>{title}</Text>} size="lg">
      <Stack gap="sm">
        <Text size="sm" fw={500}>
          {f.title} – {formatDate(f.date)}
        </Text>
        {action.kind === 'exclude' && (
          <>
            <Text size="sm" c="dimmed">
              Left-out results stay in EnviroDB (struck through in the sample’s details) but aren’t used in statistics, compliance, graphs or reports. Undo puts them back.
            </Text>
            <Stack gap={4}>
              {results.map((r) => {
                const p = paramMap.get(r.parameterId);
                return (
                  <Checkbox
                    key={r.id}
                    checked={picked.has(r.id)}
                    onChange={(e) => {
                      const on = e.currentTarget.checked;
                      setPicked((s) => {
                        const n = new Set(s);
                        if (on) n.add(r.id);
                        else n.delete(r.id);
                        return n;
                      });
                    }}
                    label={`${siteMap.get(r.siteId)?.code ?? ''} ${p?.name ?? r.parameterId}: ${displayValue(r, p).text} ${unitLabel(p?.unit ?? r.unit)}`}
                  />
                );
              })}
            </Stack>
          </>
        )}
        {action.kind === 'swap' && swapA && swapB && (
          <Text size="sm">
            {f.swap?.parameterIds
              ? `The ${f.swap.parameterIds.length} analytes’ results change places between ${siteMap.get(swapA.siteId)?.code} and ${siteMap.get(swapB.siteId)?.code} (${formatDate(swapA.date)}).`
              : `The sample labelled ${siteMap.get(swapA.siteId)?.code} moves to ${siteMap.get(swapB.siteId)?.code}, and the one labelled ${siteMap.get(swapB.siteId)?.code} to ${siteMap.get(swapA.siteId)?.code}, results and all.`}{' '}
            A note is added to both samples. Undo swaps them back. Importing the lab’s file again puts them back as labelled – ask the lab for an amended report if you can.
          </Text>
        )}
        <Textarea
          label={action.kind === 'accept' ? 'Why it’s fine' : action.kind === 'exclude' ? 'Why they’re left out' : 'Why (for the record)'}
          placeholder={action.kind === 'accept' ? 'e.g. storm event – heavy rain the day before' : action.kind === 'exclude' ? 'e.g. lab confirmed contamination of the bottle' : 'e.g. sampler confirmed the labels were swapped'}
          value={note}
          onChange={(e) => setNote(e.currentTarget.value)}
          autosize
          minRows={2}
          data-autofocus
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void run()} loading={busy} disabled={action.kind === 'exclude' && !picked.size} color={action.kind === 'swap' ? 'violet' : action.kind === 'exclude' ? 'gray' : 'teal'}>
            {action.kind === 'exclude' ? `Leave out ${picked.size}` : action.kind === 'swap' ? 'Swap' : 'Save'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function DuplicatesPanel({ duplicates }: { duplicates: ReturnType<typeof useProjectQa>['duplicates'] }) {
  const { siteMap, paramMap } = useProject();
  const rows = duplicates.filter((d) => d.rpd !== null);
  const checked = rows.filter((d) => d.pass !== null);
  const passed = checked.filter((d) => d.pass).length;
  const pairs = new Set(duplicates.map((d) => d.dup.id)).size;
  return (
    <Accordion.Item value="dups">
      <Accordion.Control>
        <Text size="sm" fw={600}>
          Field duplicates{' '}
          <Text span size="sm" c="dimmed" fw={400}>
            {pairs ? `${pairs} duplicate${pairs === 1 ? '' : 's'} · ${checked.length ? `${passed} of ${checked.length} within limits (${Math.round((passed / checked.length) * 100)}%)` : 'none near enough above detection to check'}` : 'none'}
          </Text>
        </Text>
      </Accordion.Control>
      <Accordion.Panel>
        {rows.length ? (
          <Table.ScrollContainer minWidth={640}>
            <Table striped fz="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Date</Table.Th>
                  <Table.Th>Site</Table.Th>
                  <Table.Th>Duplicate</Table.Th>
                  <Table.Th>Analyte</Table.Th>
                  <Table.Th ta="right">Sample</Table.Th>
                  <Table.Th ta="right">Duplicate</Table.Th>
                  <Table.Th ta="right">RPD</Table.Th>
                  <Table.Th ta="right">Limit</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((d) => {
                  const p = paramMap.get(d.parameterId);
                  return (
                    <Table.Tr key={`${d.dup.id}|${d.parameterId}`} style={d.pass === false ? { color: 'var(--mantine-color-red-7)' } : undefined}>
                      <Table.Td>{formatDate(d.dup.date)}</Table.Td>
                      <Table.Td>
                        {siteMap.get(d.primary!.siteId)?.code}
                        {d.guessed ? ' (likely)' : ''}
                      </Table.Td>
                      <Table.Td>{d.dup.sampleName || siteMap.get(d.dup.siteId)?.code}</Table.Td>
                      <Table.Td>{p?.short ?? p?.name ?? d.parameterId}</Table.Td>
                      <Table.Td ta="right">{d.a ? displayValue(d.a, p).text : ''}</Table.Td>
                      <Table.Td ta="right">{d.b ? displayValue(d.b, p).text : ''}</Table.Td>
                      <Table.Td ta="right">{d.rpd === null ? '' : `${Math.round(d.rpd)}%`}</Table.Td>
                      <Table.Td ta="right">{d.limit === null ? '–' : `${d.limit}%`}</Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        ) : (
          <Text size="sm" c="dimmed">
            No duplicates in these samples. Import them to a quality control site (e.g. “DUP1”) and set the sample each is a duplicate of.
          </Text>
        )}
      </Accordion.Panel>
    </Accordion.Item>
  );
}

function QcSamplesPanel({ qcSamples }: { qcSamples: Sample[] }) {
  const { siteMap, samples, index } = useProject();
  return (
    <Accordion.Item value="qc">
      <Accordion.Control>
        <Text size="sm" fw={600}>
          QC samples{' '}
          <Text span size="sm" c="dimmed" fw={400}>
            {qcSamples.length || 'none'}
          </Text>
        </Text>
      </Accordion.Control>
      <Accordion.Panel>
        <Text size="xs" c="dimmed" mb="xs">
          Duplicates and blanks: samples at a quality control site (site type “{QC_SITE_TYPE}”), kept out of the monitoring data. A QC site is made when importing a sample named like “DUP1” or “Field blank”.
        </Text>
        {qcSamples.length > 0 && (
          <Table.ScrollContainer minWidth={560}>
            <Table fz="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Date</Table.Th>
                  <Table.Th>Sample</Table.Th>
                  <Table.Th>Kind</Table.Th>
                  <Table.Th>Duplicate of</Table.Th>
                  <Table.Th ta="right">Results</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {qcSamples.map((s) => {
                  const kind = qcKind(s, siteMap.get(s.siteId));
                  const day = dayOf(s.date);
                  const near = samples.filter((x) => dayOf(x.date) >= addDays(day, -3) && dayOf(x.date) <= addDays(day, 3));
                  return (
                    <Table.Tr key={s.id}>
                      <Table.Td>{formatDate(s.date)}</Table.Td>
                      <Table.Td>{s.sampleName || siteMap.get(s.siteId)?.code}</Table.Td>
                      <Table.Td>
                        <Select size="xs" w={120} data={[{ value: 'duplicate', label: 'Duplicate' }, { value: 'blank', label: 'Blank' }]} value={kind} onChange={(v) => v && void setSampleQc(s.id, v as Sample['qc'])} allowDeselect={false} aria-label="Kind of QC sample" />
                      </Table.Td>
                      <Table.Td>
                        {kind === 'duplicate' && (
                          <Select
                            size="xs"
                            w={200}
                            placeholder="Choose…"
                            data={near.map((x) => ({ value: x.id, label: `${siteMap.get(x.siteId)?.code ?? '?'} ${formatDate(x.date)}` }))}
                            value={s.qcOf ?? null}
                            onChange={(v) => void setDuplicateOf(s.id, v ?? undefined)}
                            clearable
                            aria-label="Duplicate of"
                          />
                        )}
                      </Table.Td>
                      <Table.Td ta="right">{index.allBySample.get(s.id)?.length ?? 0}</Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Accordion.Panel>
    </Accordion.Item>
  );
}

function LogPanel() {
  const { qc, siteMap } = useProject();
  const log = [...qc.records].sort((a, b) => (a.at < b.at ? 1 : -1));
  return (
    <Accordion.Item value="log">
      <Accordion.Control>
        <Text size="sm" fw={600}>
          QA/QC log{' '}
          <Text span size="sm" c="dimmed" fw={400}>
            {log.length ? `${log.length} decision${log.length === 1 ? '' : 's'}` : 'nothing decided yet'}
          </Text>
        </Text>
      </Accordion.Control>
      <Accordion.Panel>
        <Text size="xs" c="dimmed" mb="xs">
          Every decision on a check – who, when and why – for the whole team. Reports can include it (the QA/QC section).
        </Text>
        {log.length > 0 && (
          <Table.ScrollContainer minWidth={640}>
            <Table fz="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Sampled</Table.Th>
                  <Table.Th>Finding</Table.Th>
                  <Table.Th>Decision</Table.Th>
                  <Table.Th>Why</Table.Th>
                  <Table.Th>By</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {log.map((r) => (
                  <Table.Tr key={r.id}>
                    <Table.Td>{r.date ? formatDate(r.date) : ''}</Table.Td>
                    <Table.Td>
                      {r.title}
                      {r.siteIds?.length ? <Text span c="dimmed" size="xs">{` · ${r.siteIds.map((id) => siteMap.get(id)?.code).filter(Boolean).join(', ')}`}</Text> : null}
                    </Table.Td>
                    <Table.Td>
                      <Badge size="xs" variant="light" color={STATUS[r.status].color}>
                        {STATUS[r.status].label}
                      </Badge>
                    </Table.Td>
                    <Table.Td>{r.note}</Table.Td>
                    <Table.Td>
                      {r.by}
                      <Text size="xs" c="dimmed">
                        {formatDate(r.at.slice(0, 10))}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Anchor component="button" size="xs" onClick={() => void undoRecord(r)}>
                        Undo
                      </Anchor>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Accordion.Panel>
    </Accordion.Item>
  );
}
