// The compliance register (on the Compliance tab): every condition of the consents, what EnviroDB found over the
// period, and the grade given with its reasoning – each grade's history kept.

import { useMemo, useState } from 'react';
import { Badge, Button, Card, Group, Menu, Modal, MultiSelect, Select, Stack, Table, Text, TextInput, Textarea, Timeline, Title, Tooltip } from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { IconClipboardText, IconDots, IconEdit, IconPlus, IconTrash, IconWand } from '@tabler/icons-react';
import { useProject } from '../../hooks/useProjectData';
import { EmptyState } from '../../components/common';
import { GRADE_COLOR, GRADE_ORDER, GRADE_TEXT, KIND_TEXT, overallGrade, registerRows, type RegisterRow } from '../../lib/register';
import { addFromText, clearGrade, deleteCondition, fillFromProject, gradeCondition, newCondition, saveCondition } from '../../db/register';
import { formatDate } from '../../lib/dates';
import type { ComplianceGrade, ConsentCondition } from '../../db/types';

const STATUS_TEXT: Record<RegisterRow['auto']['status'], { text: string; color: string }> = {
  complied: { text: 'Complied', color: 'teal' },
  'not-complied': { text: 'Not complied', color: 'red' },
  check: { text: 'To check', color: 'yellow' },
  'no-data': { text: 'No data', color: 'gray' },
  pending: { text: 'Not yet due', color: 'gray' },
  manual: { text: 'Assess yourself', color: 'blue' },
};

export function GradeBadge({ grade, auto }: { grade?: ComplianceGrade; auto?: boolean }) {
  if (!grade) return <Badge variant="outline" color="gray" style={{ textTransform: 'none' }}>To grade</Badge>;
  return (
    <Tooltip label={auto ? 'Worked out by EnviroDB – everything it checks complied. Grade it yourself to add your reasoning.' : GRADE_TEXT[grade]} disabled={!auto}>
      <Badge variant={auto ? 'light' : 'filled'} color={GRADE_COLOR[grade]} style={{ textTransform: 'none' }}>
        {GRADE_TEXT[grade]}
        {auto ? ' (auto)' : ''}
      </Badge>
    </Tooltip>
  );
}

export function RegisterView({ start, end, label }: { start: string; end: string; label: string }) {
  const data = useProject();
  const { project, register } = data;
  const rows = useMemo(() => registerRows(register.conditions, register.assessments, data, start, end), [register, data, start, end]);
  const overall = overallGrade(rows);
  const [editing, setEditing] = useState<ConsentCondition | null>(null);
  const [grading, setGrading] = useState<RegisterRow | null>(null);
  const [pasting, setPasting] = useState(false);
  const consents = [...new Set(rows.map((r) => r.condition.consent).filter(Boolean))] as string[];

  const fill = async () => {
    const n = await fillFromProject(data, register.conditions);
    notifications.show({ message: n ? `${n} condition${n === 1 ? '' : 's'} added from the project’s rules, sampling, reports and notes.` : 'Everything the project has is in the register already.' });
  };

  return (
    <Stack gap="md">
      <Card padding="md">
        <Group justify="space-between" align="flex-start" wrap="wrap" gap="sm">
          <div>
            <Title order={4}>Compliance register – {label}</Title>
            <Text size="sm" c="dimmed">
              {rows.length
                ? `${rows.length} condition${rows.length === 1 ? '' : 's'} · ${overall.graded} graded${overall.toGrade ? ` · ${overall.toGrade} to grade` : ''}`
                : 'Every condition of the consent – limits, monitoring, reporting, notifications, management – graded for the period.'}
            </Text>
          </div>
          <Group gap="xs">
            {rows.length > 0 && (
              <Group gap={6}>
                <Text size="sm">Overall:</Text>
                <GradeBadge grade={overall.grade} />
                {overall.provisional && (
                  <Tooltip label="Not every condition is graded yet: conditions not complied with count at the grade EnviroDB suggests" multiline w={260}>
                    <Text size="xs" c="dimmed">
                      provisional
                    </Text>
                  </Tooltip>
                )}
              </Group>
            )}
            <Menu position="bottom-end" width={330}>
              <Menu.Target>
                <Button leftSection={<IconPlus size={16} />}>Add conditions</Button>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item leftSection={<IconWand size={16} />} onClick={() => void fill()}>
                  <Text size="sm" fw={500}>
                    From the project
                  </Text>
                  <Text size="xs" c="dimmed">
                    A condition for each condition number in the rules, each sampling schedule and report, and the other requirements noted in Setup
                  </Text>
                </Menu.Item>
                <Menu.Item leftSection={<IconClipboardText size={16} />} onClick={() => setPasting(true)}>
                  <Text size="sm" fw={500}>
                    Paste the consent’s conditions
                  </Text>
                  <Text size="xs" c="dimmed">
                    Copy them from the consent document – each numbered condition becomes one
                  </Text>
                </Menu.Item>
                <Menu.Item leftSection={<IconPlus size={16} />} onClick={() => setEditing(newCondition(project.id))}>
                  <Text size="sm" fw={500}>
                    One condition
                  </Text>
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Group>
      </Card>

      {!rows.length ? (
        <EmptyState title="No conditions in the register yet" action={<Button onClick={() => void fill()} leftSection={<IconWand size={16} />}>Make it from the project</Button>}>
          Add the consent’s conditions: from the project’s rules, sampling schedules and reports, or pasted from the consent. EnviroDB checks what it can for each over the period; you grade them, with your reasons.
        </EmptyState>
      ) : (
        <Card padding="md">
          <Table.ScrollContainer minWidth={860}>
            <Table verticalSpacing={8} fz="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={70}>No.</Table.Th>
                  <Table.Th>Condition</Table.Th>
                  <Table.Th>EnviroDB found</Table.Th>
                  <Table.Th w={210}>Grade</Table.Th>
                  <Table.Th w={36} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((r) => {
                  const c = r.condition;
                  const st = STATUS_TEXT[r.auto.status];
                  return (
                    <Table.Tr key={c.id} style={{ verticalAlign: 'top' }}>
                      <Table.Td fw={600}>
                        {c.ref || '–'}
                        {consents.length > 1 && c.consent && (
                          <Text size="xs" c="dimmed">
                            {c.consent}
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">{c.title || <i>No summary</i>}</Text>
                        <Group gap={4} mt={2}>
                          <Badge size="xs" variant="light" color="gray">
                            {KIND_TEXT[c.kind]}
                          </Badge>
                          {c.evidence && (
                            <Text size="xs" c="dimmed">
                              Shown by: {c.evidence}
                            </Text>
                          )}
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        <Badge size="sm" variant="light" color={st.color} style={{ textTransform: 'none' }}>
                          {st.text}
                        </Badge>
                        {r.auto.lines.length > 0 && (
                          <ul className="qa-lines">
                            {r.auto.lines.map((l, i) => (
                              <li key={i}>{l}</li>
                            ))}
                          </ul>
                        )}
                      </Table.Td>
                      <Table.Td>
                        <Stack gap={4}>
                          <div>
                            <GradeBadge grade={r.grade} auto={r.auto_} />
                          </div>
                          {r.assessment?.note && (
                            <Text size="xs" lineClamp={3} title={r.assessment.note}>
                              {r.assessment.note}
                            </Text>
                          )}
                          {r.assessment && (
                            <Text size="xs" c="dimmed">
                              {r.assessment.by ? `${r.assessment.by}, ` : ''}
                              {formatDate(r.assessment.at.slice(0, 10))}
                            </Text>
                          )}
                          <div>
                            <Button size="compact-xs" variant="light" onClick={() => setGrading(r)}>
                              {r.assessment ? 'Change grade' : 'Grade'}
                            </Button>
                          </div>
                        </Stack>
                      </Table.Td>
                      <Table.Td>
                        <Menu position="bottom-end">
                          <Menu.Target>
                            <Button size="compact-xs" variant="subtle" color="gray" aria-label={`Condition ${c.ref} actions`}>
                              <IconDots size={14} />
                            </Button>
                          </Menu.Target>
                          <Menu.Dropdown>
                            <Menu.Item leftSection={<IconEdit size={14} />} onClick={() => setEditing(c)}>
                              Edit
                            </Menu.Item>
                            <Menu.Item
                              color="red"
                              leftSection={<IconTrash size={14} />}
                              onClick={() =>
                                modals.openConfirmModal({
                                  title: 'Delete condition?',
                                  children: <Text size="sm">Condition {c.ref || c.title} and its grades for every period are deleted.</Text>,
                                  labels: { confirm: 'Delete', cancel: 'Cancel' },
                                  confirmProps: { color: 'red' },
                                  onConfirm: () => void deleteCondition(c.id),
                                })
                              }
                            >
                              Delete
                            </Menu.Item>
                          </Menu.Dropdown>
                        </Menu>
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
          <Text size="xs" c="dimmed" mt="xs">
            Grades as in council compliance monitoring: full compliance; low risk non-compliance (administrative, or no more than minor effects); moderate non-compliance (more than minor effects, or a risk of them); significant non-compliance (significant effects, or repeated). EnviroDB marks a condition fully compliant (auto) when everything it checks complied; anything else needs your grade and reasons. Each change of grade is kept.
          </Text>
        </Card>
      )}

      {editing && <ConditionEditor c={editing} onClose={() => setEditing(null)} />}
      {grading && <GradeModal row={grading} start={start} end={end} label={label} onClose={() => setGrading(null)} />}
      {pasting && <PasteModal onClose={() => setPasting(false)} />}
    </Stack>
  );
}

function ConditionEditor({ c, onClose }: { c: ConsentCondition; onClose: () => void }) {
  const { rules, schedules, obligations, register } = useProject();
  const [d, setD] = useState<ConsentCondition>(c);
  const isNew = !register.conditions.some((x) => x.id === c.id);
  const set = (patch: Partial<ConsentCondition>) => setD({ ...d, ...patch });
  return (
    <Modal opened onClose={onClose} title={<Text fw={600}>{isNew ? 'Add a condition' : `Condition ${c.ref}`}</Text>} size="lg">
      <Stack gap="sm">
        <Group grow align="flex-start">
          <TextInput label="Number" placeholder="7(b)" value={d.ref} onChange={(e) => set({ ref: e.currentTarget.value })} maw={140} />
          <TextInput label="Consent" placeholder="e.g. AUTH-123456" value={d.consent ?? ''} onChange={(e) => set({ consent: e.currentTarget.value || undefined })} />
          <Select label="Kind" value={d.kind} onChange={(v) => v && set({ kind: v as ConsentCondition['kind'] })} data={Object.entries(KIND_TEXT).map(([value, label]) => ({ value, label }))} allowDeselect={false} />
        </Group>
        <TextInput label="In short" placeholder="TSS in the discharge no more than 100 g/m³" value={d.title} onChange={(e) => set({ title: e.currentTarget.value })} data-autofocus />
        <Textarea label="The condition’s wording" autosize minRows={2} maxRows={8} value={d.text ?? ''} onChange={(e) => set({ text: e.currentTarget.value || undefined })} />
        <Text size="sm" fw={500}>
          What EnviroDB checks it by
        </Text>
        <MultiSelect label="Consent rules (limits, triggers)" data={rules.map((r) => ({ value: r.id, label: `${r.name}${r.condition ? ` – ${r.condition}` : ''}` }))} value={d.ruleIds ?? []} onChange={(v) => set({ ruleIds: v })} searchable clearable />
        <Group grow align="flex-start">
          <MultiSelect label="Sampling schedules" data={schedules.map((s) => ({ value: s.id, label: s.name }))} value={d.scheduleIds ?? []} onChange={(v) => set({ scheduleIds: v })} clearable />
          <MultiSelect label="Reports" data={obligations.map((o) => ({ value: o.id, label: o.name }))} value={d.obligationIds ?? []} onChange={(v) => set({ obligationIds: v })} clearable />
        </Group>
        <TextInput label="Otherwise shown by" placeholder="e.g. site inspection photos; the operator’s log book; management plan approved 3 May 2024" value={d.evidence ?? ''} onChange={(e) => set({ evidence: e.currentTarget.value || undefined })} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!d.title.trim() && !d.ref.trim()}
            onClick={async () => {
              await saveCondition(d, isNew ? undefined : c);
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

function GradeModal({ row, start, end, label, onClose }: { row: RegisterRow; start: string; end: string; label: string; onClose: () => void }) {
  const a = row.assessment;
  const [grade, setGrade] = useState<ComplianceGrade | null>(a?.grade ?? row.auto.suggested ?? null);
  const [note, setNote] = useState(a?.note ?? '');
  const [action, setAction] = useState(a?.action ?? '');
  const needsReason = grade && grade !== 'full' && grade !== 'na' && !note.trim();
  const history = [...(a?.history ?? [])].reverse();
  return (
    <Modal opened onClose={onClose} title={<Text fw={600}>Condition {row.condition.ref || row.condition.title} – {label}</Text>} size="lg">
      <Stack gap="sm">
        <Text size="sm">{row.condition.title}</Text>
        {row.auto.lines.length > 0 && (
          <Card withBorder p="xs">
            <Text size="xs" fw={600} mb={2}>
              EnviroDB found{row.auto.suggested ? ` – suggests ${GRADE_TEXT[row.auto.suggested].toLowerCase()}` : ''}
            </Text>
            <ul className="qa-lines">
              {row.auto.lines.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          </Card>
        )}
        <Select label="Grade" value={grade} onChange={(v) => setGrade(v as ComplianceGrade | null)} data={[...GRADE_ORDER].reverse().map((g) => ({ value: g, label: GRADE_TEXT[g] }))} allowDeselect={false} />
        <Textarea
          label="Why – the evidence and reasoning"
          description={grade && grade !== 'full' && grade !== 'na' ? 'Needed for a non-compliance' : undefined}
          placeholder={grade === 'full' ? 'e.g. all 12 samples within the limit; site inspection 3 March found no issues' : 'e.g. one TSS exceedance after 85 mm of rain; no visible effect downstream; council notified 4 March'}
          value={note}
          onChange={(e) => setNote(e.currentTarget.value)}
          autosize
          minRows={3}
          error={needsReason ? 'Say why' : undefined}
        />
        {grade && grade !== 'full' && grade !== 'na' && <Textarea label="What is being done about it" placeholder="e.g. pond desludged 20 March; re-sampled 27 March – complied" value={action} onChange={(e) => setAction(e.currentTarget.value)} autosize minRows={2} />}
        {history.length > 0 && (
          <div>
            <Text size="xs" fw={600} mb={4}>
              Earlier grades for this period
            </Text>
            <Timeline bulletSize={10} lineWidth={2}>
              {history.map((h, i) => (
                <Timeline.Item key={i} title={<Text size="xs">{GRADE_TEXT[h.grade]}</Text>}>
                  <Text size="xs" c="dimmed">
                    {h.by ? `${h.by}, ` : ''}
                    {formatDate(h.at.slice(0, 10))}
                    {h.note ? ` – ${h.note}` : ''}
                  </Text>
                </Timeline.Item>
              ))}
            </Timeline>
          </div>
        )}
        <Group justify="space-between">
          {a ? (
            <Button
              variant="subtle"
              color="gray"
              onClick={async () => {
                await clearGrade(a.id);
                onClose();
              }}
            >
              Take the grade back
            </Button>
          ) : (
            <span />
          )}
          <Group gap="xs">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button
              disabled={!grade || !!needsReason}
              onClick={async () => {
                await gradeCondition(row.condition, start, end, grade!, note, action);
                onClose();
              }}
            >
              Save the grade
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}

function PasteModal({ onClose }: { onClose: () => void }) {
  const data = useProject();
  const [text, setText] = useState('');
  const [consent, setConsent] = useState(data.project.consents ?? '');
  const add = async () => {
    const n = await addFromText(data, text, consent);
    notifications.show({ message: n ? `${n} condition${n === 1 ? '' : 's'} added – check their summaries and kinds.` : 'No numbered conditions found – each should start on a new line with its number, e.g. “7. The consent holder shall …”.', color: n ? 'teal' : 'orange' });
    if (n) onClose();
  };
  return (
    <Modal opened onClose={onClose} title={<Text fw={600}>Paste the consent’s conditions</Text>} size="xl">
      <Stack gap="sm">
        <Text size="sm" c="dimmed">
          Copy the conditions from the consent (Word or PDF) and paste them here. Each condition starting on a line with its number (“7.”, “7(b)”, “Condition 12”) becomes one; its sub-clauses stay with it. Conditions with the same numbers as the project’s rules are linked to them. Nothing
          is sent anywhere.
        </Text>
        <TextInput label="Consent number" value={consent} onChange={(e) => setConsent(e.currentTarget.value)} maw={300} />
        <Textarea value={text} onChange={(e) => setText(e.currentTarget.value)} autosize minRows={10} maxRows={22} placeholder={'1. The consent holder shall …\n2. The discharge shall not contain …\n   (a) …'} data-autofocus />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!text.trim()} onClick={() => void add()}>
            Add the conditions
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
