import { useMemo, useState } from 'react';
import { ActionIcon, Badge, Button, Card, Group, Menu, Modal, MultiSelect, NumberInput, Progress, Select, SimpleGrid, Stack, Switch, Table, Text, TextInput, Textarea, Title, Tooltip } from '@mantine/core';
import { modals } from '@mantine/modals';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { IconCalendarPlus, IconCheck, IconDots, IconEdit, IconFileReport, IconPlus, IconTrash, IconX } from '@tabler/icons-react';
import { useProject } from '../../hooks/useProjectData';
import { DateField, EmptyState, paramOptions } from '../../components/common';
import { addMonths, formatDate, relativeDays, todayStr } from '../../lib/dates';
import { buildIcs, frequencyLabel, nextObligation, OBLIGATION_STATUS, obligationPeriod, obligationPeriods, scheduleStatus } from '../../lib/schedule';
import { deleteObligation, deleteSchedule, newObligation, newSchedule, saveObligation, saveSchedule, setSubmitted } from '../../db/repo';
import type { MonitoringSchedule, ReportObligation } from '../../db/types';
import { db } from '../../db/db';
import { downloadBlob, safeFileName } from '../../db/backup';

function ScheduleModal({ value, onClose }: { value: MonitoringSchedule; onClose: () => void }) {
  const { sites, params } = useProject();
  const [s, setS] = useState(value);
  const set = <K extends keyof MonitoringSchedule>(k: K, v: MonitoringSchedule[K]) => setS({ ...s, [k]: v });
  return (
    <Modal opened onClose={onClose} title="Sampling schedule" size="lg">
      <Stack gap="sm">
        <TextInput label="Name" value={s.name} onChange={(e) => set('name', e.currentTarget.value)} data-autofocus />
        <MultiSelect label="Sites" required data={sites.map((x) => ({ value: x.id, label: x.name ? `${x.code} – ${x.name}` : x.code }))} value={s.siteIds} onChange={(v) => set('siteIds', v)} />
        <Group grow align="flex-end">
          <NumberInput label="Every" min={1} value={s.every} onChange={(v) => set('every', Number(v) || 1)} />
          <Select
            label="Unit"
            data={[
              { value: 'day', label: 'day(s)' },
              { value: 'week', label: 'week(s)' },
              { value: 'month', label: 'month(s)' },
              { value: 'year', label: 'year(s)' },
            ]}
            value={s.unit}
            onChange={(v) => v && set('unit', v as MonitoringSchedule['unit'])}
            allowDeselect={false}
          />
          <Text size="sm" c="dimmed" pb={8}>
            {frequencyLabel(s.every, s.unit)}
          </Text>
        </Group>
        <Group grow>
          <DateField label="Programme start" value={s.startDate} onChange={(v) => v && set('startDate', v)} description="Periods are counted from this date" />
          <DateField label="End (optional)" value={s.endDate} onChange={(v) => set('endDate', v)} clearable />
        </Group>
        <MultiSelect label="Required parameters (optional)" description="Only samples with at least one of these count. Leave empty to count any sample." data={paramOptions(params)} value={s.parameterIds} onChange={(v) => set('parameterIds', v)} searchable clearable />
        <Textarea label="Notes" autosize value={s.notes ?? ''} onChange={(e) => set('notes', e.currentTarget.value)} />
        <Switch label="Active" checked={s.active} onChange={(e) => set('active', e.currentTarget.checked)} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!s.siteIds.length || !s.name.trim()}
            onClick={async () => {
              await saveSchedule(s, value);
              onClose();
            }}
          >
            Save
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function ObligationModal({ value, onClose }: { value: ReportObligation; onClose: () => void }) {
  const templates = useLiveQuery(() => db.templates.toArray(), []);
  const [o, setO] = useState(value);
  const set = <K extends keyof ReportObligation>(k: K, v: ReportObligation[K]) => setO({ ...o, [k]: v });
  const p1 = obligationPeriod(o, 1);
  return (
    <Modal opened onClose={onClose} title="Reporting obligation" size="lg">
      <Stack gap="sm">
        <Group grow>
          <TextInput label="Report" value={o.name} onChange={(e) => set('name', e.currentTarget.value)} data-autofocus />
          <TextInput label="Submit to" value={o.recipient ?? ''} onChange={(e) => set('recipient', e.currentTarget.value)} placeholder="e.g. Regional Council" />
        </Group>
        <Group grow align="flex-end">
          <Select
            label="Frequency"
            data={[
              { value: '1-year', label: 'Annual' },
              { value: '6-month', label: 'Six-monthly' },
              { value: '3-month', label: 'Quarterly' },
              { value: '1-month', label: 'Monthly' },
              { value: '0-year', label: 'One-off' },
            ]}
            value={`${o.unit === 'year' ? o.every : o.every}-${o.unit}`}
            onChange={(v) => {
              if (!v) return;
              const [n, u] = v.split('-');
              setO({ ...o, every: Number(n), unit: u as 'month' | 'year' });
            }}
            allowDeselect={false}
          />
          <Select label="Report template" data={(templates ?? []).map((t) => ({ value: t.id, label: t.name }))} value={o.templateId ?? null} onChange={(v) => set('templateId', v ?? undefined)} clearable />
        </Group>
        <Text size="sm" fw={500}>
          First reporting period
        </Text>
        <SimpleGrid cols={3}>
          <DateField label="Period start" value={o.firstPeriodStart} onChange={(v) => v && set('firstPeriodStart', v)} />
          <DateField label="Period end" value={o.firstPeriodEnd} onChange={(v) => v && set('firstPeriodEnd', v)} />
          <DateField label="Report due" value={o.firstDueDate} onChange={(v) => v && set('firstDueDate', v)} />
        </SimpleGrid>
        {o.every > 0 && (
          <Text size="xs" c="dimmed">
            Next: {formatDate(p1.periodStart)} – {formatDate(p1.periodEnd)}, due {formatDate(p1.dueDate)}
          </Text>
        )}
        <Textarea label="Notes" autosize value={o.notes ?? ''} onChange={(e) => set('notes', e.currentTarget.value)} placeholder="e.g. include groundwater appendix; send to compliance officer" />
        <Switch label="Active" checked={o.active} onChange={(e) => set('active', e.currentTarget.checked)} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!o.name.trim()}
            onClick={async () => {
              await saveObligation(o, value);
              onClose();
            }}
          >
            Save
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

export function ScheduleTab() {
  const data = useProject();
  const { project, schedules, obligations, samples, siteMap, index } = data;
  const navigate = useNavigate();
  const [editS, setEditS] = useState<MonitoringSchedule | null>(null);
  const [editO, setEditO] = useState<ReportObligation | null>(null);
  const today = todayStr();
  const statuses = useMemo(() => schedules.map((s) => scheduleStatus(s, samples, index.bySample, today, 730)), [schedules, samples, index, today]);

  const exportIcs = () => {
    const events: Array<{ uid: string; date: string; title: string; description?: string }> = [];
    for (const o of obligations.filter((x) => x.active)) {
      const periods = obligationPeriods(o, addMonths(today, 24), 80).filter((p) => p.dueDate >= today && !p.submission);
      for (const p of periods.slice(0, 8)) events.push({ uid: `${o.id}-${p.index}`, date: p.dueDate, title: `${project.name}: ${o.name} due`, description: `Period ${formatDate(p.periodStart)} – ${formatDate(p.periodEnd)}${o.recipient ? `. Submit to ${o.recipient}` : ''}` });
    }
    for (const st of statuses) if (st.dueBy) events.push({ uid: `${st.schedule.id}-${st.dueBy}`, date: st.dueBy, title: `${project.name}: ${st.schedule.name} sampling due`, description: `Outstanding: ${st.outstanding.map((id) => siteMap.get(id)?.code).join(', ')}` });
    downloadBlob(new Blob([buildIcs(events)], { type: 'text/calendar' }), `${safeFileName(project.name)} deadlines.ics`);
  };

  return (
    <Stack gap="lg">
      <Group justify="flex-end">
        <Tooltip label="Download an .ics file of upcoming deadlines to add to Outlook (with 7-day reminders)">
          <Button variant="default" leftSection={<IconCalendarPlus size={16} />} onClick={exportIcs} disabled={!obligations.length && !schedules.length}>
            Add deadlines to calendar
          </Button>
        </Tooltip>
      </Group>
      <Card>
        <Group justify="space-between" mb="sm">
          <div>
            <Title order={4}>Reporting obligations</Title>
            <Text size="sm" c="dimmed">
              Reports required by the consent, with due dates and submission tracking
            </Text>
          </div>
          <Button leftSection={<IconPlus size={16} />} onClick={() => setEditO(newObligation(project.id, { recipient: project.regulator }))}>
            Add report
          </Button>
        </Group>
        {!obligations.length ? (
          <EmptyState title="No reporting obligations">e.g. “Annual monitoring report – period 1 July to 30 June, due 30 September each year”.</EmptyState>
        ) : (
          <Stack gap="md">
            {obligations.map((o) => {
              const periods = obligationPeriods(o, today).slice(-4);
              const next = nextObligation(o, today);
              if (next && !periods.some((p) => p.index === next.index)) periods.push(next);
              return (
                <Card key={o.id} padding="md" bg="var(--mantine-color-body)">
                  <Group justify="space-between" mb="xs" wrap="nowrap">
                    <div>
                      <Group gap="xs">
                        <Text fw={600}>{o.name}</Text>
                        <Badge variant="outline">{o.every ? frequencyLabel(o.every, o.unit) : 'One-off'}</Badge>
                        {!o.active && <Badge color="gray">Inactive</Badge>}
                      </Group>
                      {o.recipient && (
                        <Text size="xs" c="dimmed">
                          Submit to {o.recipient}
                        </Text>
                      )}
                    </div>
                    <Menu position="bottom-end">
                      <Menu.Target>
                        <ActionIcon variant="subtle" aria-label="Actions">
                          <IconDots size={16} />
                        </ActionIcon>
                      </Menu.Target>
                      <Menu.Dropdown>
                        <Menu.Item leftSection={<IconEdit size={14} />} onClick={() => setEditO(o)}>
                          Edit
                        </Menu.Item>
                        <Menu.Item
                          color="red"
                          leftSection={<IconTrash size={14} />}
                          onClick={() => modals.openConfirmModal({ title: 'Delete reporting obligation?', labels: { confirm: 'Delete', cancel: 'Cancel' }, confirmProps: { color: 'red' }, onConfirm: () => deleteObligation(o.id) })}
                        >
                          Delete
                        </Menu.Item>
                      </Menu.Dropdown>
                    </Menu>
                  </Group>
                  <Table.ScrollContainer minWidth={640}>
                    <Table>
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>Period</Table.Th>
                          <Table.Th>Due</Table.Th>
                          <Table.Th>Status</Table.Th>
                          <Table.Th />
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {periods.map((p) => {
                          const meta = OBLIGATION_STATUS[p.status];
                          return (
                            <Table.Tr key={p.index}>
                              <Table.Td className="tabular">
                                {formatDate(p.periodStart)} – {formatDate(p.periodEnd)}
                              </Table.Td>
                              <Table.Td className="tabular">
                                {formatDate(p.dueDate)}
                                {!p.submission && (
                                  <Text span size="xs" c={p.daysToDue < 0 ? 'red' : 'dimmed'} ml={6}>
                                    {relativeDays(p.daysToDue)}
                                  </Text>
                                )}
                              </Table.Td>
                              <Table.Td>
                                <Badge color={meta.color}>{p.submission ? `Submitted ${formatDate(p.submission.submittedOn)}` : meta.label}</Badge>
                              </Table.Td>
                              <Table.Td>
                                <Group gap={4} justify="flex-end" wrap="nowrap">
                                  <Button size="compact-xs" variant="light" leftSection={<IconFileReport size={14} />} onClick={() => navigate(`/projects/${project.id}/reports?obligation=${o.id}&period=${p.index}`)}>
                                    Generate
                                  </Button>
                                  {p.submission ? (
                                    <Button size="compact-xs" variant="subtle" color="gray" leftSection={<IconX size={14} />} onClick={() => setSubmitted(o.id, p, null)}>
                                      Undo
                                    </Button>
                                  ) : (
                                    <Button size="compact-xs" variant="subtle" leftSection={<IconCheck size={14} />} onClick={() => setSubmitted(o.id, p, today)}>
                                      Mark submitted
                                    </Button>
                                  )}
                                </Group>
                              </Table.Td>
                            </Table.Tr>
                          );
                        })}
                      </Table.Tbody>
                    </Table>
                  </Table.ScrollContainer>
                </Card>
              );
            })}
          </Stack>
        )}
      </Card>

      <Card>
        <Group justify="space-between" mb="sm">
          <div>
            <Title order={4}>Sampling schedules</Title>
            <Text size="sm" c="dimmed">
              Required sampling frequency – shows which sites are still to be sampled this period and any missed rounds
            </Text>
          </div>
          <Button leftSection={<IconPlus size={16} />} onClick={() => setEditS(newSchedule(project.id, { siteIds: data.sites.map((s) => s.id) }))} disabled={!data.sites.length}>
            Add schedule
          </Button>
        </Group>
        {!schedules.length ? (
          <EmptyState title="No sampling schedules">e.g. “Monthly at US1, DP1 and DS1”; “Quarterly groundwater at GW1–GW3”.</EmptyState>
        ) : (
          <SimpleGrid cols={{ base: 1, lg: 2 }}>
            {statuses.map((st) => {
              const pct = st.totalPeriods ? Math.round((st.completedPeriods / st.totalPeriods) * 100) : 100;
              return (
                <Card key={st.schedule.id} padding="md" bg="var(--mantine-color-body)">
                  <Group justify="space-between" wrap="nowrap" mb={6}>
                    <div>
                      <Group gap="xs">
                        <Text fw={600}>{st.schedule.name}</Text>
                        <Badge variant="outline">{frequencyLabel(st.schedule.every, st.schedule.unit)}</Badge>
                      </Group>
                      <Text size="xs" c="dimmed">
                        {st.schedule.siteIds.map((id) => siteMap.get(id)?.code).join(', ')}
                      </Text>
                    </div>
                    <Menu position="bottom-end">
                      <Menu.Target>
                        <ActionIcon variant="subtle" aria-label="Actions">
                          <IconDots size={16} />
                        </ActionIcon>
                      </Menu.Target>
                      <Menu.Dropdown>
                        <Menu.Item leftSection={<IconEdit size={14} />} onClick={() => setEditS(st.schedule)}>
                          Edit
                        </Menu.Item>
                        <Menu.Item color="red" leftSection={<IconTrash size={14} />} onClick={() => modals.openConfirmModal({ title: 'Delete schedule?', labels: { confirm: 'Delete', cancel: 'Cancel' }, confirmProps: { color: 'red' }, onConfirm: () => deleteSchedule(st.schedule.id) })}>
                          Delete
                        </Menu.Item>
                      </Menu.Dropdown>
                    </Menu>
                  </Group>
                  {st.current ? (
                    <Stack gap={6}>
                      <Text size="sm">
                        Current period: <b>{formatDate(st.current.start)} – {formatDate(st.current.end)}</b>
                      </Text>
                      <Group gap={6}>
                        {st.schedule.siteIds.map((id) => {
                          const done = st.current!.sampled[id];
                          return (
                            <Tooltip key={id} label={done ? `Sampled ${done.map((d) => formatDate(d)).join(', ')}` : `Not yet sampled – due by ${formatDate(st.current!.end)}`}>
                              <Badge color={done ? 'green' : 'orange'} variant={done ? 'light' : 'filled'} leftSection={done ? <IconCheck size={12} /> : undefined}>
                                {siteMap.get(id)?.code}
                              </Badge>
                            </Tooltip>
                          );
                        })}
                      </Group>
                    </Stack>
                  ) : (
                    <Text size="sm" c="dimmed">
                      Schedule not running today.
                    </Text>
                  )}
                  <Group gap="xs" mt="sm" align="center">
                    <Text size="xs" c="dimmed" w={170}>
                      Rounds completed (2 yrs): {st.completedPeriods}/{st.totalPeriods}
                    </Text>
                    <Progress value={pct} color={pct === 100 ? 'green' : pct >= 90 ? 'teal' : 'orange'} style={{ flex: 1 }} />
                  </Group>
                  {st.missed.length > 0 && (
                    <Text size="xs" c="orange.8" mt={4}>
                      Missed: {st.missed.slice(-6).map((m) => `${siteMap.get(m.siteId)?.code} (${formatDate(m.start)})`).join(', ')}
                      {st.missed.length > 6 ? ` and ${st.missed.length - 6} more` : ''}
                    </Text>
                  )}
                </Card>
              );
            })}
          </SimpleGrid>
        )}
      </Card>
      {editS && <ScheduleModal key={editS.id} value={editS} onClose={() => setEditS(null)} />}
      {editO && <ObligationModal key={editO.id} value={editO} onClose={() => setEditO(null)} />}
    </Stack>
  );
}
