import { useMemo, useState } from 'react';
import { RegisterView } from './Register';
import { Accordion, ActionIcon, Badge, Button, Card, Group, Menu, SegmentedControl, Select, Stack, Table, Text, Textarea, Popover } from '@mantine/core';
import { modals } from '@mantine/modals';
import { Link } from 'react-router-dom';
import { IconAlertTriangle, IconCopy, IconDots, IconEdit, IconPlus, IconTrash, IconNotes, IconPlayerPause, IconPlayerPlay, IconFileTypeDocx, IconSparkles, IconListDetails, IconTable, IconChecklist } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { adhocTemplate, exportReport } from '../../reports/export';
import { useSettings } from '../../hooks/useSettings';
import { revivePeriod, useViewState } from '../../hooks/useViewState';
import { useProject } from '../../hooks/useProjectData';
import { DateField, EmptyState, LevelBadge, PeriodPicker, RuleStatusBadge, defaultPeriod, type PeriodValue } from '../../components/common';
import { evaluateAll, isLimitLevel } from '../../lib/analysis';
import { formatDate } from '../../lib/dates';
import { unitLabel } from '../../lib/units';
import { fmtNum } from '../../lib/values';
import { deleteRule, newRule, saveNote, saveRule } from '../../db/repo';
import { db } from '../../db/db';
import type { ExceedanceNote, ReportBlock, Rule } from '../../db/types';
import type { Exceedance, RuleEvaluation } from '../../lib/compliance';
import { RuleEditor } from './RuleEditor';
import { LimitsView } from './LimitsView';
import { uid } from '../../lib/ids';
import { useFeature } from '../../hooks/useFeatures';

type Preset = { label: string; description: string; make: (projectId: string) => Rule[] };

const PRESETS: Preset[] = [
  { label: 'Maximum limit', description: 'e.g. TSS must not exceed 100 g/m³', make: (pid) => [newRule(pid, { name: 'Maximum limit', kind: 'threshold', operator: '>' })] },
  { label: 'Minimum limit', description: 'e.g. dissolved oxygen at least 6 mg/L', make: (pid) => [newRule(pid, { name: 'Minimum limit', kind: 'threshold', operator: '<', parameterId: 'do', unit: 'mg/L', value: 6 })] },
  { label: 'Range', description: 'e.g. pH between 6.5 and 8.5', make: (pid) => [newRule(pid, { name: 'pH range', kind: 'threshold', operator: 'outside', parameterId: 'ph', unit: 'pH', min: 6.5, max: 8.5 })] },
  { label: 'Change from upstream', description: 'e.g. turbidity increase no more than 20%', make: (pid) => [newRule(pid, { name: 'Turbidity increase', kind: 'change', parameterId: 'turbidity', changeType: 'percent', operator: '>', value: 20, pairingDays: 0 })] },
  { label: 'pH change from upstream', description: 'e.g. pH change no more than 0.5 units', make: (pid) => [newRule(pid, { name: 'pH change', kind: 'change', parameterId: 'ph', changeType: 'abs-diff', operator: '>', value: 0.5, unit: 'pH', pairingDays: 0 })] },
  { label: 'Statistical limit', description: 'e.g. annual median, 95th percentile', make: (pid) => [newRule(pid, { name: 'Annual median', kind: 'statistic', statistic: 'median', window: 'year', operator: '>', minSamples: 4 })] },
  { label: 'Consecutive exceedances', description: 'e.g. 2 results in a row above a trigger', make: (pid) => [newRule(pid, { name: 'Consecutive trigger', kind: 'consecutive', consecutive: 2, operator: '>', level: 'Trigger' })] },
  { label: 'Guideline comparison', description: 'e.g. all results vs ANZG 95% (hardness-modified)', make: (pid) => [newRule(pid, { name: 'Dissolved metals vs ANZG 95%', kind: 'guideline', guidelineSetId: 'anzg-fw-95', hardnessAdjust: true, level: 'Trigger' })] },
  {
    label: 'Chosen analytes vs a guideline',
    description: 'e.g. dissolved copper and zinc vs ANZG 95%',
    make: (pid) => [newRule(pid, { name: 'Dissolved copper and zinc vs ANZG 95%', kind: 'guideline', guidelineSetId: 'anzg-fw-95', parameterIds: ['cu-d', 'zn-d'], hardnessAdjust: true, level: 'Trigger' })],
  },
  {
    label: 'Limit at a guideline value',
    description: 'e.g. annual median zinc above its ANZG 95% value',
    make: (pid) => [newRule(pid, { name: 'Dissolved zinc – annual median vs ANZG 95%', kind: 'statistic', statistic: 'median', window: 'year', minSamples: 4, parameterId: 'zn-d', limitSetId: 'anzg-fw-95', level: 'Trigger' })],
  },
  {
    label: 'NPS-FM nitrate toxicity bottom line',
    description: 'Annual median ≤ 2.4 and 95th percentile ≤ 3.5 mg/L NO3-N',
    make: (pid) => [
      newRule(pid, { name: 'Nitrate toxicity – median (NPS-FM bottom line)', condition: 'NPS-FM 2020 Table 6', level: 'Trigger', kind: 'statistic', parameterId: 'no3-n', statistic: 'median', window: 'year', operator: '>', value: 2.4, unit: 'mg/L', minSamples: 4 }),
      newRule(pid, { name: 'Nitrate toxicity – 95th percentile (NPS-FM bottom line)', condition: 'NPS-FM 2020 Table 6', level: 'Trigger', kind: 'statistic', parameterId: 'no3-n', statistic: 'percentile', percentile: 95, window: 'year', operator: '>', value: 3.5, unit: 'mg/L', minSamples: 4 }),
    ],
  },
  {
    label: 'NPS-FM ammonia toxicity bottom line',
    description: 'Annual median ≤ 0.24 and maximum ≤ 0.40 mg/L NH4-N (pH 8)',
    make: (pid) => [
      newRule(pid, { name: 'Ammonia toxicity – median (NPS-FM bottom line)', condition: 'NPS-FM 2020 Table 5 (pH 8, 20°C)', level: 'Trigger', kind: 'statistic', parameterId: 'nh4-n', statistic: 'median', window: 'year', operator: '>', value: 0.24, unit: 'mg/L', minSamples: 4 }),
      newRule(pid, { name: 'Ammonia toxicity – maximum (NPS-FM bottom line)', condition: 'NPS-FM 2020 Table 5 (pH 8, 20°C)', level: 'Trigger', kind: 'statistic', parameterId: 'nh4-n', statistic: 'max', window: 'year', operator: '>', value: 0.4, unit: 'mg/L', minSamples: 1 }),
    ],
  },
];

function NoteEditor({ ruleId, ex, note }: { ruleId: string; ex: Exceedance; note?: ExceedanceNote }) {
  const { project } = useProject();
  const [opened, setOpened] = useState(false);
  // the note as it was when opened: saving changes only what was changed here
  const [base, setBase] = useState(note);
  const [status, setStatus] = useState<ExceedanceNote['status']>(note?.status ?? 'open');
  const [text, setText] = useState(note?.text ?? '');
  const [notifiedOn, setNotifiedOn] = useState<string | undefined>(note?.notifiedOn);
  const open = () => {
    setBase(note);
    setStatus(note?.status ?? 'open');
    setText(note?.text ?? '');
    setNotifiedOn(note?.notifiedOn);
    setOpened(true);
  };
  const color = note ? (note.status === 'closed' ? 'green' : note.status === 'notified' ? 'blue' : 'orange') : 'gray';
  return (
    <Popover opened={opened} onChange={setOpened} width={340} position="left" withArrow shadow="md">
      <Popover.Target>
        <Badge color={color} variant={note ? 'light' : 'outline'} style={{ cursor: 'pointer' }} leftSection={<IconNotes size={12} />} onClick={() => (opened ? setOpened(false) : open())}>
          {note ? note.status : 'Add note'}
        </Badge>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="xs">
          <Select
            label="Status"
            data={[
              { value: 'open', label: 'Open – investigating' },
              { value: 'notified', label: 'Regulator notified' },
              { value: 'closed', label: 'Closed – resolved' },
            ]}
            value={status}
            onChange={(v) => v && setStatus(v as ExceedanceNote['status'])}
            allowDeselect={false}
            comboboxProps={{ withinPortal: false }}
          />
          <DateField label="Regulator notified on" value={notifiedOn} onChange={setNotifiedOn} clearable popoverProps={{ withinPortal: false }} />
          <Textarea label="Notes / actions taken" autosize minRows={3} value={text} onChange={(e) => setText(e.currentTarget.value)} placeholder="Cause, response, follow-up sampling…" />
          <Group justify="flex-end">
            <Button
              size="xs"
              onClick={async () => {
                await saveNote({ projectId: project.id, ruleId, key: ex.key, status, text, notifiedOn }, base);
                setOpened(false);
              }}
            >
              Save
            </Button>
          </Group>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}

function ExceedanceTable({ ev }: { ev: RuleEvaluation }) {
  const { siteMap, paramMap, notes } = useProject();
  const noteMap = new Map(notes.filter((n) => n.ruleId === ev.rule.id).map((n) => [n.key, n]));
  const rows = [...ev.exceedances, ...ev.inconclusive];
  if (!rows.length) return <Text size="sm" c="dimmed">{ev.summary}</Text>;
  return (
    <Table.ScrollContainer minWidth={700}>
      <Table striped>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Date</Table.Th>
            <Table.Th>Site</Table.Th>
            <Table.Th>Parameter</Table.Th>
            <Table.Th ta="right">Value</Table.Th>
            <Table.Th>Limit</Table.Th>
            <Table.Th>Detail</Table.Th>
            <Table.Th>Follow-up</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((ex) => (
            <Table.Tr key={ex.key}>
              <Table.Td className="tabular">{formatDate(ex.date, { time: true })}</Table.Td>
              <Table.Td>{siteMap.get(ex.siteId)?.code}</Table.Td>
              <Table.Td>{paramMap.get(ex.parameterId)?.name ?? ex.parameterId}</Table.Td>
              <Table.Td ta="right" fw={600} className="tabular">
                {ex.value === null ? '' : `${ex.qualifier}${fmtNum(ex.value)}`} {ex.unit === '%' ? '%' : unitLabel(ex.unit)}
              </Table.Td>
              <Table.Td>{ex.limitText}</Table.Td>
              <Table.Td>
                {ex.inconclusive ? (
                  <Badge color="yellow" variant="light">
                    DL above limit
                  </Badge>
                ) : (
                  <Text size="xs">{ex.detail}</Text>
                )}
              </Table.Td>
              <Table.Td>
                <NoteEditor key={ex.key} ruleId={ev.rule.id} ex={ex} note={noteMap.get(ex.key)} />
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}

/** Every exceedance in the period, across the rules, with where its follow-up is up to: the list to work through. */
function FollowUpView({ evals }: { evals: RuleEvaluation[] }) {
  const { siteMap, paramMap, notes } = useProject();
  const [show, setShow] = useState<'open' | 'all'>('open');
  const noteMap = new Map(notes.map((n) => [n.id, n]));
  const rows = evals
    .flatMap((ev) => ev.exceedances.map((ex) => ({ ev, ex, note: noteMap.get(`${ev.rule.id}|${ex.key}`) })))
    .filter((r) => show === 'all' || !r.note || r.note.status === 'open')
    .sort((a, b) => b.ex.date.localeCompare(a.ex.date));
  const counts = { open: 0, notified: 0, closed: 0 };
  for (const ev of evals) for (const ex of ev.exceedances) counts[noteMap.get(`${ev.rule.id}|${ex.key}`)?.status ?? 'open']++;
  return (
    <Stack gap="sm">
      <Group justify="space-between" wrap="wrap" gap="sm">
        <Group gap="xs">
          <Badge color="orange" variant="light">
            {counts.open} open
          </Badge>
          <Badge color="blue" variant="light">
            {counts.notified} notified
          </Badge>
          <Badge color="green" variant="light">
            {counts.closed} closed
          </Badge>
        </Group>
        <SegmentedControl size="xs" value={show} onChange={(v) => setShow(v as 'open' | 'all')} data={[{ value: 'open', label: 'Still open' }, { value: 'all', label: 'All in the period' }]} />
      </Group>
      {!rows.length ? (
        <EmptyState title={show === 'open' ? 'Nothing open' : 'No exceedances in the period'}>
          {show === 'open' ? 'Every exceedance in the period has been notified or closed.' : 'Limits, triggers and guideline rules were all met.'}
        </EmptyState>
      ) : (
        <Table.ScrollContainer minWidth={760}>
          <Table striped>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Date</Table.Th>
                <Table.Th>Site</Table.Th>
                <Table.Th>Rule</Table.Th>
                <Table.Th ta="right">Value</Table.Th>
                <Table.Th>Limit</Table.Th>
                <Table.Th>Notified</Table.Th>
                <Table.Th>Follow-up</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map(({ ev, ex, note }) => (
                <Table.Tr key={`${ev.rule.id}|${ex.key}`}>
                  <Table.Td className="tabular">{formatDate(ex.date)}</Table.Td>
                  <Table.Td>{siteMap.get(ex.siteId)?.code}</Table.Td>
                  <Table.Td>
                    <Text size="sm">{ev.rule.name}</Text>
                    <Text size="xs" c="dimmed">
                      {paramMap.get(ex.parameterId)?.name ?? ex.parameterId}
                    </Text>
                  </Table.Td>
                  <Table.Td ta="right" fw={600} className="tabular">
                    {ex.value === null ? '' : `${ex.qualifier}${fmtNum(ex.value)}`} {ex.unit === '%' ? '%' : unitLabel(ex.unit)}
                  </Table.Td>
                  <Table.Td>{ex.limitText}</Table.Td>
                  <Table.Td className="tabular">{note?.notifiedOn ? formatDate(note.notifiedOn) : ''}</Table.Td>
                  <Table.Td>
                    <Group gap="xs" wrap="nowrap">
                      <NoteEditor key={ex.key} ruleId={ev.rule.id} ex={ex} note={note} />
                      {note?.text && (
                        <Text size="xs" c="dimmed" lineClamp={1} style={{ maxWidth: 240 }}>
                          {note.text}
                        </Text>
                      )}
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
      <Text size="xs" c="dimmed">
        Open exceedances from the last 90 days also show under Actions to take on the dashboard. Each rule’s own list is under Rules.
      </Text>
    </Stack>
  );
}

export function ComplianceTab() {
  const data = useProject();
  const { project, rules } = data;
  const ai = useFeature('ai');
  const [period, setPeriod] = useViewState<PeriodValue>(`${project.id}:compliance.period`, () => defaultPeriod(project.yearStartMonth, 'thisRy'), revivePeriod(project.yearStartMonth));
  const [editing, setEditing] = useState<Rule | null>(null);
  // the rules one by one, or the limits and triggers as a table
  const [view, setView] = useViewState<'rules' | 'table' | 'register' | 'followup'>(`${project.id}:compliance.view`, 'rules', (v) => (v === 'rules' || v === 'table' || v === 'register' || v === 'followup' ? v : undefined));
  const evals = useMemo(() => evaluateAll(data, period.start, period.end, rules.filter((r) => r.active)), [data, period, rules]);
  const openCount = useMemo(() => evals.reduce((n, ev) => n + ev.exceedances.filter((ex) => (data.notes.find((x) => x.id === `${ev.rule.id}|${ex.key}`)?.status ?? 'open') === 'open').length, 0), [evals, data.notes]);
  const evalMap = new Map(evals.map((e) => [e.rule.id, e]));
  // most important first: limits exceeded, then triggers, results to check, compliant, no data, paused
  const rank = (r: Rule) => {
    const ev = evalMap.get(r.id);
    if (!r.active) return 9;
    if (!ev) return 8;
    return ev.status === 'exceeded' ? (isLimitLevel(r.level) ? 0 : 1) : ev.status === 'inconclusive' ? 2 : ev.status === 'compliant' ? 4 : 5;
  };
  const ordered = [...rules].sort((a, b) => rank(a) - rank(b) || (evalMap.get(b.id)?.exceedances.length ?? 0) - (evalMap.get(a.id)?.exceedances.length ?? 0));
  const exceeded = evals.filter((e) => e.status === 'exceeded').length;
  const withData = evals.filter((e) => e.status !== 'no-data').length;
  const checkDl = evals.filter((e) => e.status === 'inconclusive').length;

  const settings = useSettings();
  const [wordBusy, setWordBusy] = useState(false);
  const exportWord = async () => {
    setWordBusy(true);
    try {
      const blocks: ReportBlock[] = [
        { id: 'h1', type: 'heading', text: `Compliance summary – ${period.label}`, level: 1 },
        ...(data.register.conditions.length ? [{ id: 'reg', type: 'complianceRegister' } as ReportBlock, { id: 'h4', type: 'heading', text: 'Consent limits and triggers', level: 2 } as ReportBlock] : []),
        { id: 'c', type: 'complianceTable', ruleIds: [] },
        { id: 'h3', type: 'heading', text: 'Consent limits and trigger levels', level: 2 },
        { id: 't', type: 'triggerTable', title: '', siteIds: [], levels: 'all' },
        { id: 'h2', type: 'heading', text: 'Exceedances and follow-up', level: 2 },
        { id: 'e', type: 'exceedances', ruleIds: [], includeGuidelines: false, includeNotes: true },
      ];
      await exportReport('docx', { bundle: data, template: adhocTemplate('Compliance summary', blocks, 'portrait'), period, settings });
    } catch (e) {
      notifications.show({ title: 'Export failed', message: (e as Error).message, color: 'red' });
    } finally {
      setWordBusy(false);
    }
  };

  const addPreset = async (p: Preset) => {
    const made = p.make(project.id);
    if (made.length === 1) setEditing(made[0]);
    else {
      for (const [i, r] of made.entries()) await saveRule({ ...r, order: Date.now() + i });
    }
  };

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end" wrap="wrap">
        <Group gap="sm" align="flex-end" wrap="wrap">
          <PeriodPicker value={period} onChange={setPeriod} yearStartMonth={project.yearStartMonth} />
          {(rules.length > 0 || view === 'register') && (
            <SegmentedControl
              value={view}
              onChange={(v) => setView(v as 'rules' | 'table' | 'register' | 'followup')}
              data={[
                {
                  value: 'rules',
                  label: (
                    <Group gap={6} wrap="nowrap">
                      <IconListDetails size={16} />
                      <span>Rules</span>
                    </Group>
                  ),
                },
                {
                  value: 'table',
                  label: (
                    <Group gap={6} wrap="nowrap">
                      <IconTable size={16} />
                      <span>Limits &amp; triggers</span>
                    </Group>
                  ),
                },
                {
                  value: 'followup',
                  label: (
                    <Group gap={6} wrap="nowrap">
                      <IconAlertTriangle size={16} />
                      <span>Follow-up{openCount ? ` (${openCount})` : ''}</span>
                    </Group>
                  ),
                },
                {
                  value: 'register',
                  label: (
                    <Group gap={6} wrap="nowrap">
                      <IconChecklist size={16} />
                      <span>Register</span>
                    </Group>
                  ),
                },
              ]}
            />
          )}
        </Group>
        <Group gap="xs">
          {rules.length > 0 && (
            <Badge size="lg" color={exceeded ? 'red' : checkDl ? 'yellow' : withData ? 'green' : 'gray'} variant="light">
              {exceeded
                ? `${exceeded} of ${withData} rules with data exceeded`
                : checkDl
                  ? `${checkDl} rule${checkDl === 1 ? '' : 's'} to check (detection limit)`
                  : withData
                    ? `All ${withData} rules with data complied`
                    : 'No data in this period'}
            </Badge>
          )}
          {(rules.length > 0 || data.register.conditions.length > 0) && (
            <Button variant="default" leftSection={<IconFileTypeDocx size={16} />} loading={wordBusy} onClick={exportWord}>
              Word
            </Button>
          )}
          <Menu position="bottom-end" width={360}>
            <Menu.Target>
              <Button leftSection={<IconPlus size={16} />}>Add rule</Button>
            </Menu.Target>
            <Menu.Dropdown mah="min(70vh, 640px)" style={{ overflowY: 'auto' }}>
              {ai && (
                <>
                  <Menu.Item leftSection={<IconSparkles size={16} />} component={Link} to={`/projects/${project.id}/consent-setup`}>
                    <Text size="sm" fw={500}>
                      From consent documents (with AI)
                    </Text>
                    <Text size="xs" c="dimmed">
                      Have an AI tool read the consent and set up all the rules
                    </Text>
                  </Menu.Item>
                  <Menu.Divider />
                </>
              )}
              {PRESETS.map((p) => (
                <Menu.Item key={p.label} onClick={() => addPreset(p)}>
                  <Text size="sm" fw={500}>
                    {p.label}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {p.description}
                  </Text>
                </Menu.Item>
              ))}
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Group>

      {view === 'register' ? (
        <RegisterView start={period.start} end={period.end} label={period.label} />
      ) : !rules.length ? (
        <EmptyState
          title="No consent rules yet"
          action={
            <Group gap="xs">
              <Button onClick={() => setEditing(newRule(project.id, { name: '' }))}>Add your first rule</Button>
              <Button variant="default" onClick={() => setView('register')}>
                Compliance register
              </Button>
            </Group>
          }
        >
          Add each consent limit, trigger level or guideline comparison. Rules are checked automatically every time data is imported, and feed the compliance tables in your reports. The compliance register covers every condition of the consent.
        </EmptyState>
      ) : view === 'table' ? (
        <LimitsView data={data} evals={evals} period={period} onEdit={setEditing} />
      ) : view === 'followup' ? (
        <FollowUpView evals={evals} />
      ) : (
        <Accordion multiple variant="separated" defaultValue={evals.filter((e) => e.status === 'exceeded').map((e) => e.rule.id)}>
          {ordered.map((rule) => {
            const ev = evalMap.get(rule.id);
            return (
              <Accordion.Item key={rule.id} value={rule.id}>
                <Group wrap="nowrap" gap={0} pr="xs">
                  <Accordion.Control>
                    <Group justify="space-between" wrap="nowrap" gap="sm">
                      <div style={{ minWidth: 0 }}>
                        <Group gap={6} wrap="wrap" style={{ rowGap: 0 }}>
                          <LevelBadge level={rule.level} />
                          <Text fw={600} size="sm" lh={1.35}>
                            {rule.name}
                          </Text>
                          {rule.condition && (
                            <Text size="xs" c="dimmed">
                              {rule.condition}
                            </Text>
                          )}
                        </Group>
                        <Text size="xs" c="dimmed" lineClamp={2}>
                          {ev ? `${ev.description} — ${ev.summary}` : 'Inactive'}
                        </Text>
                      </div>
                      <div style={{ flexShrink: 0 }}>{ev ? <RuleStatusBadge status={ev.status} /> : <Badge color="gray">Inactive</Badge>}</div>
                    </Group>
                  </Accordion.Control>
                  <Menu position="bottom-end">
                    <Menu.Target>
                      <ActionIcon variant="subtle" aria-label="Rule actions">
                        <IconDots size={16} />
                      </ActionIcon>
                    </Menu.Target>
                    <Menu.Dropdown>
                      <Menu.Item leftSection={<IconEdit size={14} />} onClick={() => setEditing(rule)}>
                        Edit
                      </Menu.Item>
                      <Menu.Item leftSection={<IconCopy size={14} />} onClick={() => setEditing({ ...rule, id: uid('rule'), name: `${rule.name} (copy)`, order: Date.now() })}>
                        Duplicate
                      </Menu.Item>
                      <Menu.Item leftSection={rule.active ? <IconPlayerPause size={14} /> : <IconPlayerPlay size={14} />} onClick={() => db.rules.update(rule.id, { active: !rule.active })}>
                        {rule.active ? 'Deactivate' : 'Activate'}
                      </Menu.Item>
                      <Menu.Item
                        color="red"
                        leftSection={<IconTrash size={14} />}
                        onClick={() =>
                          modals.openConfirmModal({
                            title: 'Delete rule?',
                            children: <Text size="sm">“{rule.name}” and its exceedance notes will be deleted.</Text>,
                            labels: { confirm: 'Delete', cancel: 'Cancel' },
                            confirmProps: { color: 'red' },
                            onConfirm: () => deleteRule(rule.id),
                          })
                        }
                      >
                        Delete
                      </Menu.Item>
                    </Menu.Dropdown>
                  </Menu>
                </Group>
                <Accordion.Panel>
                  <Stack gap="xs">
                    {rule.action && (
                      <Text size="sm">
                        <b>Required action:</b> {rule.action}
                      </Text>
                    )}
                    {ev && <ExceedanceTable ev={ev} />}
                  </Stack>
                </Accordion.Panel>
              </Accordion.Item>
            );
          })}
        </Accordion>
      )}
      <Card padding="sm" withBorder={false} bg="transparent">
        <Text size="xs" c="dimmed">
          Non-detects are assessed conservatively: a “&lt;DL” result only complies when the detection limit is at or below the limit; otherwise it is flagged “Check DL”. Statistics treat non-detects as {project.ndHandling === 'half' ? 'half the detection limit' : project.ndHandling === 'zero' ? 'zero' : 'the detection limit'} and use {project.percentileMethod === 'hazen' ? 'Hazen' : 'Excel PERCENTILE.INC'} percentiles (change in Setup).
        </Text>
      </Card>
      {editing && <RuleEditor key={editing.id} rule={editing} onClose={() => setEditing(null)} period={period} />}
    </Stack>
  );
}
