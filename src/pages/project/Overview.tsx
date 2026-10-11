import { useMemo, useState } from 'react';
import { Anchor, Badge, Button, Card, Checkbox, Grid, Group, SimpleGrid, Stack, Table, Text, Title, Tooltip, useComputedColorScheme } from '@mantine/core';
import { Link, useNavigate } from 'react-router-dom';
import { IconArrowRight, IconCalendarDue, IconFlask, IconShieldCheck } from '@tabler/icons-react';
import { useProject } from '../../hooks/useProjectData';
import { defaultPeriod, LevelBadge, PeriodPicker, RuleStatusBadge, StatTile, type PeriodValue } from '../../components/common';
import { displayValue, evaluateAll, flagResults, keyParameters } from '../../lib/analysis';
import { addMonths, daysUntil, formatDate, formatMonthYear, MONTH_SHORT, relativeDays, todayStr } from '../../lib/dates';
import { nextObligation, OBLIGATION_STATUS } from '../../lib/schedule';
import { buildChartSpec, chartOption } from '../../charts/timeSeries';
import { EChart } from '../../charts/EChart';
import { unitLabel } from '../../lib/units';

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

function LatestResults() {
  const data = useProject();
  const { sites, index, paramMap, project } = data;
  const latest = useMemo(() => {
    return sites
      .map((site) => {
        const ss = data.samples.filter((s) => s.siteId === site.id);
        return { site, sample: ss[ss.length - 1] };
      })
      .filter((x) => x.sample);
  }, [sites, data.samples]);
  const keys = useMemo(() => keyParameters(data, 10), [data]);
  const flags = useMemo(() => {
    if (!latest.length) return new Map();
    const start = latest.reduce((m, x) => (x.sample.date < m ? x.sample.date : m), latest[0].sample.date).slice(0, 10);
    const evals = evaluateAll(data, start, todayStr());
    return flagResults(data, evals, project.guidelineSetIds, start, todayStr());
  }, [data, latest, project.guidelineSetIds]);
  if (!latest.length) return null;
  return (
    <Card>
      <Group justify="space-between" mb="xs">
        <Title order={4}>Latest results</Title>
        <Anchor component={Link} to={`/projects/${project.id}/data`} size="sm">
          All data
        </Anchor>
      </Group>
      <Table.ScrollContainer minWidth={400}>
        <table className="edb-grid">
          <thead>
            <tr>
              <th className="sticky-col">Parameter</th>
              {latest.map((l) => (
                <th key={l.site.id}>
                  {l.site.code}
                  <div style={{ fontWeight: 400, fontSize: 11, color: 'var(--edb-muted)' }}>{formatDate(l.sample.date)}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {keys.map((pid) => {
              const p = paramMap.get(pid);
              if (!p) return null;
              return (
                <tr key={pid}>
                  <td className="sticky-col">
                    {p.name} <span style={{ color: 'var(--edb-muted)', fontSize: 11 }}>{unitLabel(p.unit)}</span>
                  </td>
                  {latest.map((l) => {
                    const r = (index.bySample.get(l.sample.id) ?? []).find((x) => x.parameterId === pid);
                    if (!r) return <td key={l.site.id} />;
                    const f = flags.get(r.id);
                    const cls = f ? (f.kind === 'limit' ? 'hl-limit' : f.kind === 'guideline' ? 'hl-guideline' : 'hl-check') : '';
                    const cell = (
                      <td key={l.site.id} className={`num ${cls} ${r.qualifier === '<' ? 'nd' : ''}`}>
                        {displayValue(r, p).text}
                      </td>
                    );
                    return f ? (
                      <Tooltip key={l.site.id} label={f.messages.join('\n')}>
                        {cell}
                      </Tooltip>
                    ) : (
                      cell
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </Table.ScrollContainer>
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
          const spec = buildChartSpec({ index: data.index, param: p, sites: data.sites, siteIds: [], start, end: todayStr(), guidelineSets: sets, rules: data.rules, showRules: true });
          return <EChart key={pid} option={chartOption(spec, { dark: scheme === 'dark', fontScale: 0.9 })} height={240} />;
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
    .sort((a, b) => (a.n!.dueDate < b.n!.dueDate ? -1 : 1))[0];

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
          <LatestResults />
        </Grid.Col>
      </Grid>
      <Coverage />
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
