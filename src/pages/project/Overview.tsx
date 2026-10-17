import { useMemo, useState } from 'react';
import { Anchor, Badge, Button, Card, Checkbox, Grid, Group, Select, SimpleGrid, Stack, Switch, Table, Text, Title, Tooltip, useComputedColorScheme } from '@mantine/core';
import { Link, useNavigate } from 'react-router-dom';
import { IconArrowRight, IconCalendarDue, IconFlask, IconShieldCheck } from '@tabler/icons-react';
import { useProject } from '../../hooks/useProjectData';
import { ConsentViewControl, defaultPeriod, LevelBadge, PeriodPicker, RuleStatusBadge, StatTile, type PeriodValue } from '../../components/common';
import { cellClass } from '../../lib/highlight';
import { consentParameterIds, countWithData, displayValue, evaluateAll, flagResults, keyParameters, type CellFlag, type ConsentView } from '../../lib/analysis';
import { reviewCell, reviewLines, samplingRounds, type ReviewCell } from '../../lib/latest';
import { addMonths, daysUntil, formatDate, formatMonthYear, MONTH_SHORT, relativeDays, todayStr } from '../../lib/dates';
import { byDueDate, nextObligation, OBLIGATION_STATUS } from '../../lib/schedule';
import { buildChartSpec, chartOption } from '../../charts/timeSeries';
import { EChart } from '../../charts/EChart';
import { unitLabel } from '../../lib/units';
import { expandRules } from '../../lib/compliance';

function GettingStarted() {
  const { project, sites, samples, rules, obligations, schedules } = useProject();
  const base = `/projects/${project.id}`;
  const steps = [
    { done: sites.length > 0, label: 'Add monitoring sites', to: `${base}/setup` },
    { done: samples.length > 0, label: 'Import lab results or a master spreadsheet', to: `${base}/import` },
    { done: rules.length > 0, label: 'Add consent limits / trigger levels', to: `${base}/compliance` },
    { done: schedules.length > 0 || obligations.length > 0, label: 'Add sampling frequency and reporting dates', to: `${base}/schedule` },
  ];
  if (steps.every((s) => s.done)) return null;
  const needsRules = !rules.length || (!schedules.length && !obligations.length);
  return (
    <Card>
      <Title order={4} mb="xs">
        Finish setting up this project
      </Title>
      <Stack gap={6}>
        {steps.map((s) => (
          <Group key={s.label} gap="sm">
            <Checkbox checked={s.done} readOnly />
            <Anchor component={Link} to={s.to} c={s.done ? 'dimmed' : undefined} td={s.done ? 'line-through' : undefined}>
              {s.label}
            </Anchor>
          </Group>
        ))}
      </Stack>
      {needsRules && (
        <Text size="sm" mt="sm">
          Tip:{' '}
          <Anchor component={Link} to={`${base}/consent-setup`}>
            set up the limits, triggers, sampling and reporting dates from your consent with an AI tool
          </Anchor>
          .
        </Text>
      )}
    </Card>
  );
}

function Coverage() {
  const { sites, samples } = useProject();
  const months = useMemo(() => {
    const out: string[] = [];
    let m = addMonths(`${todayStr().slice(0, 7)}-01`, -23);
    for (let i = 0; i < 24; i++) {
      out.push(m.slice(0, 7));
      m = addMonths(m, 1);
    }
    return out;
  }, []);
  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const s of samples) {
      const k = `${s.siteId}|${s.date.slice(0, 7)}`;
      c.set(k, (c.get(k) ?? 0) + 1);
    }
    return c;
  }, [samples]);
  if (!sites.length) return null;
  return (
    <Card>
      <Group justify="space-between" mb="xs">
        <Title order={4}>Sampling coverage</Title>
        <Text size="xs" c="dimmed">
          Samples per month, last 24 months
        </Text>
      </Group>
      <Table.ScrollContainer minWidth={560}>
        <table style={{ borderCollapse: 'separate', borderSpacing: 3 }}>
          <thead>
            <tr>
              <th />
              {months.map((m) => (
                <th key={m} style={{ fontSize: 10, fontWeight: 400, color: 'var(--mantine-color-dimmed)', width: 20 }}>
                  {m.endsWith('-01') ? m.slice(2, 4) : MONTH_SHORT[+m.slice(5, 7) - 1][0]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sites.map((s) => (
              <tr key={s.id}>
                <td style={{ fontSize: 12, paddingRight: 8, whiteSpace: 'nowrap' }}>{s.code}</td>
                {months.map((m) => {
                  const n = counts.get(`${s.id}|${m}`) ?? 0;
                  return (
                    <td key={m}>
                      <Tooltip label={`${s.code} · ${formatMonthYear(`${m}-01`)}: ${n} sample${n === 1 ? '' : 's'}`}>
                        <span className="coverage-cell" style={{ background: n === 0 ? 'var(--mantine-color-gray-2)' : n === 1 ? 'var(--mantine-color-teal-5)' : 'var(--mantine-color-teal-8)' }} />
                      </Tooltip>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Table.ScrollContainer>
    </Card>
  );
}

function LatestResultsReview() {
  const data = useProject();
  const { sites, project, siteMap } = data;
  const rounds = useMemo(() => samplingRounds(data), [data]);
  const [roundKey, setRoundKey] = useState('latest');
  const [scope, setScope] = useState<'all' | ConsentView>('all');
  const [issuesOnly, setIssuesOnly] = useState(false);
  const round = rounds.find((r) => r.key === roundKey) ?? rounds[0];
  const flags = useMemo(() => {
    if (!round) return new Map<string, CellFlag>();
    const dates = round.samples.map((s) => s.date.slice(0, 10)).sort();
    const [start, end] = [dates[0], dates[dates.length - 1]];
    return flagResults(data, evaluateAll(data, start, end), project.guidelineSetIds, start, end);
  }, [data, round, project.guidelineSetIds]);
  const consent = useMemo(() => ({ consent: consentParameterIds(data, 'consent'), limits: consentParameterIds(data, 'limits'), triggers: consentParameterIds(data, 'triggers') }), [data]);
  const counts = useMemo(() => countWithData(consent, new Set(data.index.paramIdsWithData)), [consent, data.index]);
  const table = useMemo(() => {
    if (!round) return [];
    const measured = new Set(round.samples.flatMap((s) => (data.index.bySample.get(s.id) ?? []).map((r) => r.parameterId)));
    return data.params
      .filter((p) => measured.has(p.id) && (scope === 'all' || consent[scope].has(p.id)))
      .map((p) => {
        const cells = round.samples.map((s) => reviewCell(data, s, p));
        const issue = cells.some((c) => c && (flags.has(c.result.id) || c.unusual));
        return { p, cells, issue };
      });
  }, [data, round, scope, consent, flags]);
  if (!round) return null;
  const all = table.flatMap((t) => t.cells).filter((c): c is ReviewCell => !!c);
  const exceed = all.filter((c) => ['limit', 'guideline'].includes(flags.get(c.result.id)?.kind ?? '')).length;
  const check = all.filter((c) => flags.get(c.result.id)?.kind === 'check').length;
  const unusual = all.filter((c) => c.unusual).length;
  const rows = issuesOnly ? table.filter((t) => t.issue) : table;
  return (
    <Card>
      <Group justify="space-between" align="flex-end" mb="sm" wrap="wrap" gap="sm">
        <div>
          <Title order={4}>Latest results</Title>
          <Group gap={6} mt={4}>
            <Badge color={exceed ? 'red' : 'green'} variant="light">
              {exceed ? `${exceed} exceedance${exceed === 1 ? '' : 's'}` : 'No exceedances'}
            </Badge>
            {check > 0 && (
              <Badge color="grape" variant="light">
                {check} detection limit issue{check === 1 ? '' : 's'}
              </Badge>
            )}
            <Badge color={unusual ? 'orange' : 'gray'} variant="light">
              {unusual ? `${unusual} unusual for the site` : 'Nothing unusual'}
            </Badge>
          </Group>
        </div>
        <Group gap="sm" align="flex-end" wrap="wrap">
          <Select aria-label="Sampling round" data={rounds.map((r) => ({ value: r.key, label: r.label }))} value={round.key} onChange={(v) => v && setRoundKey(v)} allowDeselect={false} w={260} comboboxProps={{ width: 'max-content' }} />
          {counts.consent > 0 && <ConsentViewControl value={scope} onChange={setScope} counts={counts} />}
          <Switch label="Only show issues" checked={issuesOnly} onChange={(e) => setIssuesOnly(e.currentTarget.checked)} />
        </Group>
      </Group>
      {rows.length ? (
        <div style={{ maxHeight: 560, overflow: 'auto', border: '1px solid var(--edb-grid)', borderRadius: 8 }}>
          <table className="edb-grid">
            <thead>
              <tr>
                <th className="sticky-col" style={{ minWidth: 150 }}>
                  Parameter
                </th>
                {round.samples.map((s) => (
                  <th key={s.id} style={{ minWidth: 84 }}>
                    {siteMap.get(s.siteId)?.code}
                    <div style={{ fontWeight: 400, fontSize: 11, color: 'var(--edb-muted)' }}>{formatDate(s.date)}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ p, cells }) => {
                const unit = unitLabel(p.unit);
                return (
                  <tr key={p.id}>
                    <td className="sticky-col" style={{ whiteSpace: 'normal', maxWidth: 260 }}>
                      {p.name} <span style={{ color: 'var(--edb-muted)', fontSize: 11, whiteSpace: 'nowrap' }}>{unit}</span>
                    </td>
                    {cells.map((c, i) => {
                      const sample = round.samples[i];
                      if (!c) return <td key={sample.id} />;
                      const f = flags.get(c.result.id);
                      const cls = cellClass(f);
                      const lines = [...(f?.messages ?? []), ...reviewLines(c, p, siteMap.get(sample.siteId)?.code ?? '', unit)];
                      return (
                        <td key={sample.id} className={`num ${cls} ${c.result.qualifier === '<' ? 'nd' : ''}`}>
                          <Tooltip label={lines.join('\n')} multiline w={300} style={{ whiteSpace: 'pre-line' }} openDelay={150}>
                            <span>
                              {displayValue(c.result, p).text}
                              {c.unusual && (
                                <span className={`lr-mark lr-${c.unusual}`} aria-label={`unusually ${c.unusual}`}>
                                  {c.unusual === 'high' ? '▲' : '▼'}
                                </span>
                              )}
                            </span>
                          </Tooltip>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <Text size="sm" c="dimmed">
          {issuesOnly ? 'No issues in this round.' : 'No results in this round.'}
        </Text>
      )}
      <Group justify="space-between" mt="xs" wrap="wrap" gap="xs">
        <Text size="xs" c="dimmed">
          Red: consent limit exceeded · Amber: trigger or guideline exceeded · Purple: detection limit above the limit · ▲▼ unusually high or low for the site (outside 90% of its earlier results). Hover a value for the previous result.
        </Text>
        <Anchor component={Link} to={`/projects/${project.id}/data`} size="sm">
          All data
        </Anchor>
      </Group>
      {sites.length > round.samples.length && roundKey === 'latest' && (
        <Text size="xs" c="dimmed" mt={4}>
          No results yet for {sites.filter((s) => !round.samples.some((x) => x.siteId === s.id)).map((s) => s.code).join(', ')}.
        </Text>
      )}
    </Card>
  );
}

function Trends() {
  const data = useProject();
  const scheme = useComputedColorScheme('light');
  const keys = useMemo(() => keyParameters(data, 6), [data]);
  const start = addMonths(todayStr(), -36);
  const sets = data.project.guidelineSetIds.map((id) => data.setMap.get(id)).filter((s): s is NonNullable<typeof s> => !!s);
  if (!keys.length) return null;
  return (
    <Card>
      <Group justify="space-between" mb="xs">
        <Title order={4}>Key parameter trends (3 years)</Title>
        <Anchor component={Link} to={`/projects/${data.project.id}/charts`} size="sm">
          Graph builder
        </Anchor>
      </Group>
      <SimpleGrid cols={{ base: 1, md: 2 }}>
        {keys.map((pid) => {
          const p = data.paramMap.get(pid)!;
          const spec = buildChartSpec({ index: data.index, param: p, sites: data.sites, siteIds: [], start, end: todayStr(), guidelineSets: sets, rules: expandRules(data.rules, data.setMap), setMap: data.setMap, showRules: true });
          return <EChart key={pid} option={(width, hidden) => chartOption(spec, { dark: scheme === 'dark', fontScale: 0.9, width, hidden })} height={240} />;
        })}
      </SimpleGrid>
    </Card>
  );
}

export function OverviewTab() {
  const data = useProject();
  const { project, samples, obligations, rules } = data;
  const navigate = useNavigate();
  const [period, setPeriod] = useState<PeriodValue>(() => defaultPeriod(project.yearStartMonth, 'thisRy'));
  const evals = useMemo(() => evaluateAll(data, period.start, period.end), [data, period]);
  const inPeriod = samples.filter((s) => s.date.slice(0, 10) >= period.start && s.date.slice(0, 10) <= period.end);
  const last = samples[samples.length - 1];
  const exceeded = evals.filter((e) => e.status === 'exceeded');
  const next = obligations
    .filter((o) => o.active)
    .map((o) => ({ o, n: nextObligation(o) }))
    .filter((x) => x.n)
    .sort((a, b) => byDueDate(a.n!, b.n!) || a.o.name.localeCompare(b.o.name))[0];

  return (
    <Stack gap="lg">
      <GettingStarted />
      <Group justify="space-between" align="flex-end">
        <PeriodPicker value={period} onChange={setPeriod} yearStartMonth={project.yearStartMonth} />
      </Group>
      <SimpleGrid cols={{ base: 1, xs: 2, lg: 4 }}>
        <StatTile label="Samples in period" value={inPeriod.length} sub={period.label} icon={<IconFlask size={22} color="var(--mantine-color-dimmed)" />} />
        <StatTile label="Last sampled" value={last ? formatDate(last.date) : '—'} sub={last ? relativeDays(daysUntil(last.date.slice(0, 10))) : 'No data yet'} />
        <StatTile
          label="Consent rules"
          value={rules.length ? `${evals.length - exceeded.length}/${evals.length}` : '—'}
          sub={rules.length ? (exceeded.length ? `${exceeded.length} exceeded in period` : 'All complied in period') : 'No rules defined'}
          color={exceeded.length ? 'red' : rules.length ? 'green' : undefined}
          icon={<IconShieldCheck size={22} color="var(--mantine-color-dimmed)" />}
          onClick={() => navigate(`/projects/${project.id}/compliance`)}
        />
        <StatTile
          label="Next report due"
          value={next ? formatDate(next.n!.dueDate) : '—'}
          sub={next ? `${next.o.name} · ${OBLIGATION_STATUS[next.n!.status].label} (${relativeDays(next.n!.daysToDue)})` : 'No reporting obligations'}
          color={next?.n?.status === 'overdue' ? 'red' : undefined}
          icon={<IconCalendarDue size={22} color="var(--mantine-color-dimmed)" />}
          onClick={() => navigate(`/projects/${project.id}/schedule`)}
        />
      </SimpleGrid>
      <LatestResultsReview />
      <Grid gutter="lg">
        <Grid.Col span={{ base: 12, lg: 6 }}>
          <Card h="100%">
            <Group justify="space-between" mb="xs">
              <Title order={4}>Compliance – {period.label}</Title>
              <Button variant="subtle" size="compact-sm" rightSection={<IconArrowRight size={14} />} component={Link} to={`/projects/${project.id}/compliance`}>
                Details
              </Button>
            </Group>
            {evals.length ? (
              <Stack gap={8}>
                {evals.map((ev) => (
                  <Group key={ev.rule.id} justify="space-between" wrap="nowrap" align="flex-start">
                    <div style={{ minWidth: 0 }}>
                      <Group gap={6} wrap="nowrap">
                        <LevelBadge level={ev.rule.level} />
                        <Text size="sm" fw={500} truncate>
                          {ev.rule.name}
                        </Text>
                      </Group>
                      <Text size="xs" c="dimmed">
                        {ev.summary}
                      </Text>
                    </div>
                    <RuleStatusBadge status={ev.status} size="sm" />
                  </Group>
                ))}
              </Stack>
            ) : (
              <Text size="sm" c="dimmed">
                No consent limits or triggers yet.{' '}
                <Anchor component={Link} to={`/projects/${project.id}/compliance`}>
                  Add rules
                </Anchor>
              </Text>
            )}
          </Card>
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 6 }}>
          <Coverage />
        </Grid.Col>
      </Grid>
      <Trends />
      {project.description && (
        <Card>
          <Title order={5} mb={4}>
            About this project
          </Title>
          <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
            {project.description}
          </Text>
          {project.location && (
            <Badge mt="xs" variant="light">
              {project.location}
            </Badge>
          )}
        </Card>
      )}
    </Stack>
  );
}
