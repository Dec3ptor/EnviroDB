import { useMemo, useState, type ReactNode } from 'react';
import { Accordion, Alert, Badge, Button, Card, Checkbox, FileButton, Group, List, Paper, Radio, ScrollArea, Select, Stack, Stepper, Table, Text, Textarea, Title } from '@mantine/core';
import { Link } from 'react-router-dom';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconArrowBackUp, IconCheck, IconCopy, IconDownload, IconFileUpload, IconSparkles } from '@tabler/icons-react';
import { useProject } from '../../hooks/useProjectData';
import { LevelBadge, PageHeader, paramOptions } from '../../components/common';
import { buildConsentPrompt, newParamId, parseConsentAnswer, planConsentImport, planParams, ruleBlockers, type ConsentPlan, type PlanRule } from '../../importers/consent';
import { commitConsentPlan, undoConsentImport, type ConsentImportResult } from '../../importers/consentCommit';
import { exceededWhen } from '../../lib/compliance';
import { frequencyLabel } from '../../lib/schedule';
import { formatDate } from '../../lib/dates';
import { copyText } from '../../lib/clipboard';
import { downloadBlob } from '../../db/backup';
import type { Parameter, Site } from '../../db/types';

interface Draft {
  consentText: string;
  notes: string;
  answer: string;
}

// The consent text, notes and pasted answer are kept in this browser until replaced, so nothing
// is lost while switching to the AI tool.
function loadDraft(key: string): Draft {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return { consentText: '', notes: '', answer: '', ...(JSON.parse(raw) as Partial<Draft>) };
  } catch {
    // storage unavailable
  }
  return { consentText: '', notes: '', answer: '' };
}
function saveDraft(key: string, d: Draft) {
  try {
    localStorage.setItem(key, JSON.stringify(d));
  } catch {
    // not kept – fine
  }
}

function Section({ title, count, children, description }: { title: string; count: number; children: ReactNode; description?: ReactNode }) {
  if (!count) return null;
  return (
    <Card>
      <Title order={4}>
        {title} <Text span c="dimmed" fw={400}>({count})</Text>
      </Title>
      {description && (
        <Text size="sm" c="dimmed" mb="xs">
          {description}
        </Text>
      )}
      <Stack gap="xs" mt="xs">
        {children}
      </Stack>
    </Card>
  );
}

function Notes({ warnings, quote, comment }: { warnings: string[]; quote?: string; comment?: string }) {
  return (
    <>
      {quote && (
        <Text size="xs" c="dimmed" fs="italic">
          “{quote}”
        </Text>
      )}
      {comment && (
        <Text size="xs" c="blue">
          AI note: {comment}
        </Text>
      )}
      {warnings.map((w) => (
        <Text key={w} size="xs" c="orange">
          ⚠ {w}
        </Text>
      ))}
    </>
  );
}

export function ConsentSetupPage() {
  const data = useProject();
  const { project, sites, params, guidelineSets, setMap, rules, schedules, obligations } = data;
  const base = `/projects/${project.id}`;
  const draftKey = `edb.consentSetup.${project.id}`;
  const [draft, setDraftState] = useState<Draft>(() => loadDraft(draftKey));
  const setDraft = (patch: Partial<Draft>) => {
    const d = { ...draft, ...patch };
    setDraftState(d);
    saveDraft(draftKey, d);
  };
  const [step, setStep] = useState(draft.answer.trim() ? 1 : 0);
  const [plan, setPlan] = useState<ConsentPlan | null>(null);
  const [error, setError] = useState('');
  const [replace, setReplace] = useState('add');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ConsentImportResult | null>(null);
  const [copied, setCopied] = useState(false);

  const ctx = { project, sites, params, guidelineSets };
  const prompt = useMemo(() => buildConsentPrompt({ project, sites, params, guidelineSets }, { consentText: draft.consentText, notes: draft.notes }), [project, sites, params, guidelineSets, draft.consentText, draft.notes]);
  const hasSetup = rules.length + schedules.length + obligations.length > 0;

  const copyPrompt = async () => {
    if (await copyText(prompt)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
      notifications.show({ color: 'teal', title: 'Instructions copied', message: 'Paste them into your AI tool and attach the consent documents.' });
    } else notifications.show({ color: 'red', title: "Couldn't copy", message: 'Use Download .txt instead.' });
  };
  const check = () => {
    const r = parseConsentAnswer(draft.answer);
    if ('error' in r) {
      setError(r.error);
      return;
    }
    setError('');
    setResult(null);
    setPlan(planConsentImport(r.data, ctx));
    setStep(2);
  };
  const doImport = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      const res = await commitConsentPlan(project.id, plan, { replace: replace === 'replace' });
      setResult(res);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      notifications.show({ color: 'red', title: 'Import failed', message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const undo = async () => {
    if (!result) return;
    await undoConsentImport(result.undo);
    setResult(null);
    notifications.show({ color: 'teal', message: 'Import undone – the project is back as it was.' });
  };

  return (
    <Stack gap="md">
      <PageHeader
        title="Set up from consent documents"
        description="Use an AI tool to read your consent and turn its conditions into EnviroDB rules, sampling schedules and reporting dates. You check everything before it's imported."
      />
      {result && (
        <Alert color="teal" icon={<IconCheck size={18} />} title="Imported">
          <Stack gap={6}>
            <Text size="sm">
              {[
                result.sites && plural(result.sites, 'site'),
                result.rules && plural(result.rules, 'rule'),
                result.schedules && plural(result.schedules, 'sampling schedule'),
                result.obligations && plural(result.obligations, 'report'),
                result.params && plural(result.params, 'new parameter'),
              ]
                .filter(Boolean)
                .join(', ') || 'Nothing new'}{' '}
              {result.undo.replaced.rules.length || result.undo.replaced.schedules.length || result.undo.replaced.obligations.length ? '(replacing the previous set-up).' : 'added to the project.'}
            </Text>
            {result.paused.length > 0 && (
              <Text size="sm">
                <b>Paused until finished</b> (edit them on the Compliance tab): {result.paused.join('; ')}.
              </Text>
            )}
            {result.skipped.length > 0 && <Text size="sm">Not imported: {result.skipped.join('; ')}.</Text>}
            <Group gap="xs" mt={4}>
              <Button component={Link} to={`${base}/compliance`} size="xs">
                Go to Compliance
              </Button>
              <Button component={Link} to={`${base}/schedule`} size="xs" variant="default">
                Go to Schedule
              </Button>
              <Button size="xs" variant="subtle" color="red" leftSection={<IconArrowBackUp size={14} />} onClick={undo}>
                Undo import
              </Button>
            </Group>
          </Stack>
        </Alert>
      )}
      <Stepper active={step} onStepClick={setStep} allowNextStepsSelect={false} size="sm">
        <Stepper.Step label="Instructions" description="Copy into your AI tool">
          <Card>
            <Stack gap="md">
              <List type="ordered" spacing={4} size="sm">
                <List.Item>Copy the instructions below.</List.Item>
                <List.Item>Open your AI tool (Claude, ChatGPT, Copilot…), paste the instructions and attach the consent and any monitoring plan (PDF or Word).</List.Item>
                <List.Item>Copy the AI's whole answer, then come back here and paste it in the next step.</List.Item>
              </List>
              <Textarea
                label="Consent text (optional)"
                description="Paste the conditions here if you can't attach files in your AI tool. They're added to the instructions."
                autosize
                minRows={3}
                maxRows={12}
                value={draft.consentText}
                onChange={(e) => setDraft({ consentText: e.currentTarget.value })}
              />
              <Textarea
                label="Anything else the AI should know (optional)"
                description="For example the site codes you use, which conditions to leave out, or that metal limits are for total recoverable metals."
                autosize
                minRows={2}
                maxRows={6}
                value={draft.notes}
                onChange={(e) => setDraft({ notes: e.currentTarget.value })}
              />
              <Group gap="xs">
                <Button color={copied ? 'teal' : undefined} leftSection={copied ? <IconCheck size={16} /> : <IconCopy size={16} />} onClick={copyPrompt}>
                  {copied ? 'Copied' : 'Copy instructions'}
                </Button>
                <Button variant="default" leftSection={<IconDownload size={16} />} onClick={() => downloadBlob(new Blob([prompt], { type: 'text/plain;charset=utf-8' }), `${project.name} - consent set-up instructions.txt`)}>
                  Download .txt
                </Button>
              </Group>
              <Accordion variant="contained" chevronPosition="left">
                <Accordion.Item value="p">
                  <Accordion.Control>Preview the instructions</Accordion.Control>
                  <Accordion.Panel>
                    <ScrollArea.Autosize mah={360} type="auto">
                      <pre className="ai-preview">{prompt}</pre>
                    </ScrollArea.Autosize>
                  </Accordion.Panel>
                </Accordion.Item>
              </Accordion>
              <Text size="xs" c="dimmed">
                EnviroDB doesn't send anything to an AI tool itself. Only use AI tools your organisation has approved for client documents.
              </Text>
              <Group justify="flex-end">
                <Button variant="light" onClick={() => setStep(1)}>
                  Next: paste the answer
                </Button>
              </Group>
            </Stack>
          </Card>
        </Stepper.Step>

        <Stepper.Step label="AI answer" description="Paste it back here">
          <Card>
            <Stack gap="sm">
              <Textarea
                label="The AI tool's answer"
                description="Paste the whole answer. The part from the first { to the last } is used."
                autosize
                minRows={10}
                maxRows={24}
                value={draft.answer}
                onChange={(e) => setDraft({ answer: e.currentTarget.value })}
                styles={{ input: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 12 } }}
                placeholder={'{\n  "format": "envirodb-consent-setup",\n  …\n}'}
              />
              {error && (
                <Alert color="red" icon={<IconAlertTriangle size={18} />}>
                  {error}
                </Alert>
              )}
              <Group justify="space-between">
                <Group gap="xs">
                  <Button variant="default" onClick={() => setStep(0)}>
                    Back
                  </Button>
                  <FileButton accept=".json,.txt,.md,application/json,text/plain" onChange={async (f) => f && setDraft({ answer: await f.text() })}>
                    {(props) => (
                      <Button variant="default" leftSection={<IconFileUpload size={16} />} {...props}>
                        Open a saved answer
                      </Button>
                    )}
                  </FileButton>
                  {draft.answer && (
                    <Button variant="subtle" color="gray" onClick={() => setDraft({ answer: '' })}>
                      Clear
                    </Button>
                  )}
                </Group>
                <Button disabled={!draft.answer.trim()} onClick={check}>
                  Check the answer
                </Button>
              </Group>
            </Stack>
          </Card>
        </Stepper.Step>

        <Stepper.Step label="Review and import" description="Check before importing">
          {plan && <Review plan={plan} setPlan={setPlan} sites={sites} params={params} setMap={setMap} />}
          {plan && !result && (
            <Card mt="md">
              <Stack gap="sm">
                {hasSetup && (
                  <Radio.Group label="This project already has rules, schedules or reporting dates" value={replace} onChange={setReplace}>
                    <Stack gap={6} mt={6}>
                      <Radio value="add" label="Add these to what's already set up" />
                      <Radio value="replace" label="Replace the project's rules, sampling schedules and reporting dates (sites and data are kept)" />
                    </Stack>
                  </Radio.Group>
                )}
                <Group justify="space-between">
                  <Button variant="default" onClick={() => setStep(1)}>
                    Back
                  </Button>
                  <Button leftSection={<IconSparkles size={16} />} loading={busy} onClick={doImport} disabled={!countSelected(plan)}>
                    Import {countSelected(plan)} selected item{countSelected(plan) === 1 ? '' : 's'}
                  </Button>
                </Group>
              </Stack>
            </Card>
          )}
        </Stepper.Step>
      </Stepper>

    </Stack>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function countSelected(plan: ConsentPlan): number {
  return (
    plan.project.filter((x) => x.include).length +
    plan.sites.filter((x) => x.include && !x.existing).length +
    plan.rules.filter((x) => x.include).length +
    plan.schedules.filter((x) => x.include).length +
    plan.obligations.filter((x) => x.include).length +
    (plan.includeNotes ? plan.notes.length : 0)
  );
}

function Review({ plan, setPlan, sites, params, setMap }: { plan: ConsentPlan; setPlan: (p: ConsentPlan) => void; sites: Site[]; params: Parameter[]; setMap: Map<string, import('../../db/types').GuidelineSet> }) {
  const allSites = useMemo(() => [...sites, ...plan.sites.filter((s) => !s.existing).map((s) => s.site)], [sites, plan.sites]);
  const paramMap = useMemo(() => planParams(plan, params), [plan, params]);
  const baseOptions = useMemo(() => paramOptions(params), [params]);
  const siteCodes = (ids: string[]) => (ids.length ? ids.map((id) => allSites.find((s) => s.id === id)?.code ?? '?').join(', ') : 'all sites');
  const patchRule = (key: string, patch: Partial<PlanRule>) => setPlan({ ...plan, rules: plan.rules.map((r) => (r.key === key ? { ...r, ...patch } : r)) });
  const newSites = plan.sites.filter((s) => !s.existing).length;
  const ruleText = (pr: PlanRule) => {
    const r = pr.rule;
    if (r.kind === 'guideline' || r.parameterId) return exceededWhen(r, paramMap, allSites, setMap);
    const fake: Parameter = { id: '__unmatched', name: `“${pr.paramText || 'no parameter'}”`, group: 'Other', unit: r.unit ?? '', aliases: [] };
    return exceededWhen({ ...r, parameterId: fake.id }, new Map([...paramMap, [fake.id, fake]]), allSites, setMap);
  };

  return (
    <Stack gap="md">
      <Group gap="xs">
        {[
          plan.project.length && plural(plan.project.length, 'project detail'),
          plan.sites.length && `${plural(plan.sites.length, 'site')} (${newSites} new)`,
          plan.rules.length && plural(plan.rules.length, 'rule'),
          plan.schedules.length && plural(plan.schedules.length, 'sampling schedule'),
          plan.obligations.length && plural(plan.obligations.length, 'report'),
          plan.notes.length && plural(plan.notes.length, 'other requirement'),
        ]
          .filter(Boolean)
          .map((t) => (
            <Badge key={String(t)} variant="light" size="lg">
              {t}
            </Badge>
          ))}
      </Group>
      <Text size="sm" c="dimmed">
        Untick anything you don't want. Check the parameters marked ⚠ – the AI tool may have guessed. Everything can be edited after importing.
      </Text>

      <Section title="Project details" count={plan.project.length} description="Empty fields are filled in. Tick a changed value to replace what's there.">
        <Table.ScrollContainer minWidth={560}>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={40} />
                <Table.Th>Field</Table.Th>
                <Table.Th>Now</Table.Th>
                <Table.Th>From the consent</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {plan.project.map((f, i) => (
                <Table.Tr key={f.field}>
                  <Table.Td>
                    <Checkbox aria-label={`Use ${f.label}`} checked={f.include} onChange={(e) => setPlan({ ...plan, project: plan.project.map((x, j) => (j === i ? { ...x, include: e.currentTarget.checked } : x)) })} />
                  </Table.Td>
                  <Table.Td>{f.label}</Table.Td>
                  <Table.Td c="dimmed">{f.current || '—'}</Table.Td>
                  <Table.Td>{f.proposed}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Section>

      <Section title="Monitoring sites" count={plan.sites.length}>
        <Table.ScrollContainer minWidth={640}>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={40} />
                <Table.Th>Code</Table.Th>
                <Table.Th>Name</Table.Th>
                <Table.Th>Type</Table.Th>
                <Table.Th>Role</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {plan.sites.map((s, i) => (
                <Table.Tr key={s.key} style={{ opacity: s.include || s.existing ? 1 : 0.55 }}>
                  <Table.Td>
                    {!s.existing && <Checkbox aria-label={`Import site ${s.site.code}`} checked={s.include} onChange={(e) => setPlan({ ...plan, sites: plan.sites.map((x, j) => (j === i ? { ...x, include: e.currentTarget.checked } : x)) })} />}
                  </Table.Td>
                  <Table.Td fw={600}>{s.site.code}</Table.Td>
                  <Table.Td>
                    {s.site.name ?? ''}
                    <Notes warnings={s.warnings} comment={s.comment} />
                  </Table.Td>
                  <Table.Td>{s.site.type}</Table.Td>
                  <Table.Td>{s.site.role || '—'}</Table.Td>
                  <Table.Td>{s.existing ? <Badge variant="outline" color="gray">Already in project{s.existing.code !== s.site.code ? ` as ${s.existing.code}` : ''}</Badge> : <Badge variant="light">New</Badge>}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Section>

      <Section title="Consent limits and triggers" count={plan.rules.length}>
        {plan.rules.map((pr) => {
          const r = pr.rule;
          const needs = ruleBlockers(r);
          const options = pr.paramText && !params.some((p) => p.name.toLowerCase() === pr.paramText.toLowerCase()) ? [...baseOptions, { group: 'New', items: [{ value: newParamId(pr.paramText), label: `Add “${pr.paramText}” as a new parameter` }] }] : baseOptions;
          const uncertain = pr.warnings.some((w) => /parameter/i.test(w));
          return (
            <Paper key={pr.key} withBorder p="sm" radius="md" style={{ opacity: pr.include ? 1 : 0.55 }}>
              <Group justify="space-between" align="flex-start" gap="xs">
                <Checkbox
                  checked={pr.include}
                  onChange={(e) => patchRule(pr.key, { include: e.currentTarget.checked })}
                  label={
                    <Text fw={600} size="sm">
                      {r.name}
                    </Text>
                  }
                />
                <Group gap={6} pl={{ base: 30, sm: 0 }}>
                  {r.condition && (
                    <Badge variant="outline" color="gray" style={{ textTransform: 'none' }}>
                      {r.condition}
                    </Badge>
                  )}
                  <LevelBadge level={r.level} />
                </Group>
              </Group>
              <Stack gap={4} mt={6} pl={30}>
                <Text size="sm">
                  <Text span c="dimmed">
                    Exceeded when:{' '}
                  </Text>
                  {ruleText(pr)}
                </Text>
                {r.kind !== 'guideline' && (
                  <Select
                    size="xs"
                    w={{ base: '100%', sm: 360 }}
                    aria-label={`Parameter for ${r.name}`}
                    placeholder="Choose a parameter"
                    data={options}
                    searchable
                    value={r.parameterId ?? null}
                    onChange={(v) => patchRule(pr.key, { rule: { ...r, parameterId: v ?? undefined, unit: r.unit || (v ? params.find((p) => p.id === v)?.unit : undefined) }, warnings: uncertain && v ? pr.warnings.filter((w) => !/parameter/i.test(w)) : pr.warnings })}
                    error={!r.parameterId}
                    styles={uncertain && r.parameterId ? { input: { borderColor: 'var(--mantine-color-orange-5)' } } : undefined}
                  />
                )}
                {r.action && (
                  <Text size="xs">
                    <Text span c="dimmed">
                      Response:{' '}
                    </Text>
                    {r.action}
                  </Text>
                )}
                <Notes warnings={pr.warnings} quote={pr.quote} comment={pr.comment} />
                {pr.include && needs.length > 0 && (
                  <Text size="xs" c="red">
                    Imported paused until you {needs.join(' and ')} on the Compliance tab.
                  </Text>
                )}
              </Stack>
            </Paper>
          );
        })}
      </Section>

      <Section title="Sampling schedules" count={plan.schedules.length}>
        <Table.ScrollContainer minWidth={700}>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={40} />
                <Table.Th>Schedule</Table.Th>
                <Table.Th>How often</Table.Th>
                <Table.Th>Sites</Table.Th>
                <Table.Th>Parameters</Table.Th>
                <Table.Th>From</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {plan.schedules.map((ps, i) => (
                <Table.Tr key={ps.key} style={{ opacity: ps.include ? 1 : 0.55 }}>
                  <Table.Td>
                    <Checkbox aria-label={`Import ${ps.schedule.name}`} checked={ps.include} onChange={(e) => setPlan({ ...plan, schedules: plan.schedules.map((x, j) => (j === i ? { ...x, include: e.currentTarget.checked } : x)) })} />
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" fw={500}>
                      {ps.schedule.name}
                    </Text>
                    {ps.schedule.notes && (
                      <Text size="xs" c="dimmed">
                        {ps.schedule.notes}
                      </Text>
                    )}
                    <Notes warnings={ps.warnings} quote={ps.quote} comment={ps.comment} />
                  </Table.Td>
                  <Table.Td>{frequencyLabel(ps.schedule.every, ps.schedule.unit)}</Table.Td>
                  <Table.Td>{siteCodes(ps.schedule.siteIds)}</Table.Td>
                  <Table.Td>{ps.schedule.parameterIds.length ? ps.schedule.parameterIds.map((id) => paramMap.get(id)?.name ?? id).join(', ') : 'Any'}</Table.Td>
                  <Table.Td className="tabular">{formatDate(ps.schedule.startDate)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Section>

      <Section title="Reporting" count={plan.obligations.length}>
        <Table.ScrollContainer minWidth={700}>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={40} />
                <Table.Th>Report</Table.Th>
                <Table.Th>How often</Table.Th>
                <Table.Th>First period</Table.Th>
                <Table.Th>Due</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {plan.obligations.map((po, i) => {
                const o = po.obligation;
                return (
                  <Table.Tr key={po.key} style={{ opacity: po.include ? 1 : 0.55 }}>
                    <Table.Td>
                      <Checkbox aria-label={`Import ${o.name}`} checked={po.include} onChange={(e) => setPlan({ ...plan, obligations: plan.obligations.map((x, j) => (j === i ? { ...x, include: e.currentTarget.checked } : x)) })} />
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" fw={500}>
                        {o.name}
                      </Text>
                      {o.recipient && (
                        <Text size="xs" c="dimmed">
                          To {o.recipient}
                        </Text>
                      )}
                      <Notes warnings={po.warnings} quote={po.quote} comment={po.comment} />
                    </Table.Td>
                    <Table.Td>{o.every ? frequencyLabel(o.every, o.unit) : 'One-off'}</Table.Td>
                    <Table.Td className="tabular">
                      {formatDate(o.firstPeriodStart)} – {formatDate(o.firstPeriodEnd)}
                    </Table.Td>
                    <Table.Td className="tabular">{formatDate(o.firstDueDate)}</Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Section>

      <Section title="Other consent requirements" count={plan.notes.length} description="EnviroDB can't check these automatically. They can be saved with the project, where they're shown on the Setup tab and included in Copy for AI input.">
        <List size="sm" spacing={4}>
          {plan.notes.map((n) => (
            <List.Item key={n}>{n}</List.Item>
          ))}
        </List>
        <Checkbox label="Save these with the project" checked={plan.includeNotes} onChange={(e) => setPlan({ ...plan, includeNotes: e.currentTarget.checked })} />
      </Section>
    </Stack>
  );
}
