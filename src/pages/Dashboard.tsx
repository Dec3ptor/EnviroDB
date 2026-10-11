import { useMemo, useState } from 'react';
import { Badge, Button, Card, Grid, Group, SimpleGrid, Stack, Table, Text, ThemeIcon, Title, Anchor, Loader, Center, Tooltip, List, Paper } from '@mantine/core';
import { Link, useNavigate } from 'react-router-dom';
import { notifications } from '@mantine/notifications';
import {
  IconAlertTriangle,
  IconCalendarDue,
  IconFlask,
  IconFolders,
  IconPlus,
  IconUpload,
  IconSparkles,
  IconDatabaseImport,
  IconCircleCheck,
  IconCircleX,
  IconFileReport,
} from '@tabler/icons-react';
import { useAllBundles } from '../hooks/useAllData';
import { evaluateAll, type ProjectBundle } from '../lib/analysis';
import { addDays, daysUntil, formatDate, relativeDays, reportingYear, todayStr } from '../lib/dates';
import { nextObligation, OBLIGATION_STATUS, scheduleStatus } from '../lib/schedule';
import { EmptyState, LevelBadge, PageHeader, StatTile } from '../components/common';
import { createDemoProject } from '../db/demo';
import { unitLabel } from '../lib/units';
import { fmtNum } from '../lib/values';
import { NewProjectButton } from './Projects';
import type { RuleEvaluation } from '../lib/compliance';

interface Deadline {
  date: string;
  kind: 'report' | 'sampling';
  title: string;
  project: ProjectBundle;
  status: string;
  color: string;
  link: string;
}

function useDashboard(bundles: ProjectBundle[]) {
  return useMemo(() => {
    const today = todayStr();
    const deadlines: Deadline[] = [];
    const exceedances: Array<{ b: ProjectBundle; ev: RuleEvaluation; date: string; site: string; param: string; value: string; limit: string }> = [];
    const projectStats = new Map<string, { evals: RuleEvaluation[]; exceeded: number; lastSample?: string; samples30: number }>();
    let samples30 = 0;
    for (const b of bundles) {
      if (b.project.status !== 'active') continue;
      const ry = reportingYear(today, b.project.yearStartMonth || 7);
      const evals = evaluateAll(b, ry.start, today);
      const recent = evaluateAll(b, addDays(today, -90), today);
      for (const ev of recent) {
        for (const ex of ev.exceedances) {
          exceedances.push({
            b,
            ev,
            date: ex.date,
            site: b.siteMap.get(ex.siteId)?.code ?? '',
            param: b.paramMap.get(ex.parameterId)?.name ?? ex.parameterId,
            value: ex.value === null ? '' : `${ex.qualifier}${fmtNum(ex.value)} ${ex.unit === '%' ? '%' : unitLabel(ex.unit)}`,
            limit: ex.limitText,
          });
        }
      }
      const s30 = b.samples.filter((s) => s.date.slice(0, 10) >= addDays(today, -30)).length;
      samples30 += s30;
      projectStats.set(b.project.id, { evals, exceeded: evals.filter((e) => e.status === 'exceeded').length, lastSample: b.samples[b.samples.length - 1]?.date, samples30: s30 });

      for (const ob of b.obligations) {
        if (!ob.active) continue;
        const next = nextObligation(ob, today);
        if (!next) continue;
        const meta = OBLIGATION_STATUS[next.status];
        deadlines.push({
          date: next.dueDate,
          kind: 'report',
          title: `${ob.name} (${formatDate(next.periodStart)} – ${formatDate(next.periodEnd)})`,
          project: b,
          status: meta.label,
          color: meta.color,
          link: `/projects/${b.project.id}/reports?obligation=${ob.id}&period=${next.index}`,
        });
      }
      const bySample = b.index.bySample;
      for (const sch of b.schedules) {
        if (!sch.active) continue;
        const st = scheduleStatus(sch, b.samples, bySample, today, 120);
        if (st.outstanding.length && st.dueBy) {
          const d = daysUntil(st.dueBy, today);
          deadlines.push({
            date: st.dueBy,
            kind: 'sampling',
            title: `${sch.name}: ${st.outstanding.map((id) => b.siteMap.get(id)?.code).join(', ')} not yet sampled`,
            project: b,
            status: d <= 7 ? 'Due soon' : 'Sampling due',
            color: d <= 7 ? 'orange' : 'blue',
            link: `/projects/${b.project.id}/schedule`,
          });
        }
      }
    }
    deadlines.sort((a, c) => (a.date < c.date ? -1 : 1));
    exceedances.sort((a, c) => (a.date < c.date ? 1 : -1));
    return { deadlines, exceedances, projectStats, samples30 };
  }, [bundles]);
}

function Welcome() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  return (
    <Stack gap="lg">
      <Paper withBorder p="xl" radius="lg">
        <Stack gap="md">
          <Group gap="sm">
            <ThemeIcon size={44} radius="md" variant="light">
              <IconSparkles size={26} />
            </ThemeIcon>
            <div>
              <Title order={3}>Welcome to EnviroDB</Title>
              <Text c="dimmed">Monitoring data, consent compliance and reporting – in one place, in your browser.</Text>
            </div>
          </Group>
          <SimpleGrid cols={{ base: 1, md: 3 }} spacing="md">
            {[
              ['1. Set up a project', 'Add the monitoring sites, consent limits / trigger levels, sampling frequency and reporting dates.'],
              ['2. Import results', 'Drop in Hill Labs Excel results or your existing master spreadsheets. Sites and analytes are matched automatically.'],
              ['3. Report', 'See exceedances instantly, make graphs, and export PDF or Word reports from your own templates.'],
            ].map(([t, d]) => (
              <Card key={t} padding="md">
                <Text fw={600}>{t}</Text>
                <Text size="sm" c="dimmed">
                  {d}
                </Text>
              </Card>
            ))}
          </SimpleGrid>
          <Group>
            <NewProjectButton />
            <Button
              variant="light"
              leftSection={<IconFlask size={16} />}
              loading={loading}
              onClick={async () => {
                setLoading(true);
                const id = await createDemoProject();
                notifications.show({ title: 'Demo project created', message: 'Explore it, then delete it from the project Setup tab when you are done.', color: 'teal' });
                navigate(`/projects/${id}`);
              }}
            >
              Load demo project
            </Button>
            <Button variant="default" leftSection={<IconDatabaseImport size={16} />} component={Link} to="/settings">
              Restore a backup
            </Button>
          </Group>
        </Stack>
      </Paper>
      <Text size="sm" c="dimmed">
        Your data is stored privately in this browser's database (IndexedDB) – nothing is uploaded. Use <Anchor component={Link} to="/settings">Settings & backup</Anchor> to autosave to a file in OneDrive/SharePoint or download backups.
      </Text>
    </Stack>
  );
}

export function DashboardPage() {
  const { bundles, loading } = useAllBundles();
  const dash = useDashboard(bundles);
  const navigate = useNavigate();
  if (loading)
    return (
      <Center h={300}>
        <Loader />
      </Center>
    );
  const active = bundles.filter((b) => b.project.status === 'active');
  if (!bundles.length) return <Welcome />;
  const today = todayStr();
  const overdue = dash.deadlines.filter((d) => d.kind === 'report' && d.date < today).length;
  const reportsSoon = dash.deadlines.filter((d) => d.kind === 'report' && d.date >= today && daysUntil(d.date) <= 30).length;
  const exceeded = Array.from(dash.projectStats.values()).reduce((s, p) => s + p.exceeded, 0);

  return (
    <Stack gap="lg">
      <PageHeader
        title="Dashboard"
        description={`${formatDate(today)} · ${active.length} active project${active.length === 1 ? '' : 's'}`}
        actions={
          <>
            <NewProjectButton variant="default" />
            <Button component={Link} to="/import" leftSection={<IconUpload size={16} />}>
              Import results
            </Button>
          </>
        }
      />
      <SimpleGrid cols={{ base: 1, xs: 2, lg: 4 }}>
        <StatTile label="Active projects" value={active.length} sub={`${bundles.length - active.length} archived`} icon={<IconFolders size={22} color="var(--mantine-color-dimmed)" />} onClick={() => navigate('/projects')} />
        <StatTile label="Samples in the last 30 days" value={dash.samples30} icon={<IconFlask size={22} color="var(--mantine-color-dimmed)" />} />
        <StatTile
          label="Rules exceeded this reporting year"
          value={exceeded}
          color={exceeded ? 'red' : undefined}
          sub={`${dash.exceedances.length} exceedance${dash.exceedances.length === 1 ? '' : 's'} in the last 90 days`}
          icon={exceeded ? <IconCircleX size={22} color="var(--mantine-color-red-6)" /> : <IconCircleCheck size={22} color="var(--mantine-color-green-6)" />}
        />
        <StatTile
          label="Reports due in 30 days"
          value={reportsSoon}
          color={overdue ? 'red' : undefined}
          sub={overdue ? `${overdue} overdue` : 'None overdue'}
          icon={<IconCalendarDue size={22} color={overdue ? 'var(--mantine-color-red-6)' : 'var(--mantine-color-dimmed)'} />}
        />
      </SimpleGrid>

      <Grid gutter="lg">
        <Grid.Col span={{ base: 12, lg: 7 }}>
          <Stack gap="lg">
            <Card>
              <Group justify="space-between" mb="sm">
                <Title order={4}>Upcoming deadlines</Title>
                <Text size="sm" c="dimmed">
                  Reports and sampling rounds
                </Text>
              </Group>
              {dash.deadlines.length ? (
                <Table.ScrollContainer minWidth={460}>
                  <Table highlightOnHover>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th w={110}>Due</Table.Th>
                        <Table.Th>What</Table.Th>
                        <Table.Th w={130}>Status</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {dash.deadlines.slice(0, 12).map((d, i) => (
                        <Table.Tr key={i} className="clickable-row" onClick={() => navigate(d.link)}>
                          <Table.Td style={{ whiteSpace: 'nowrap' }}>
                            <Text size="sm" fw={500} className="tabular">
                              {formatDate(d.date)}
                            </Text>
                            <Text size="xs" c={d.date < today ? 'red' : 'dimmed'}>
                              {relativeDays(daysUntil(d.date))}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            <Group gap={8} wrap="nowrap" align="flex-start">
                              {d.kind === 'report' ? <IconFileReport size={16} style={{ flexShrink: 0, marginTop: 2 }} /> : <IconFlask size={16} style={{ flexShrink: 0, marginTop: 2 }} />}
                              <div>
                                <Text size="sm">{d.title}</Text>
                                <Text size="xs" c="dimmed">
                                  {d.project.project.name}
                                </Text>
                              </div>
                            </Group>
                          </Table.Td>
                          <Table.Td>
                            <Badge color={d.color} style={{ overflow: 'visible' }} styles={{ label: { overflow: 'visible' } }}>
                              {d.status}
                            </Badge>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
              ) : (
                <Text c="dimmed" size="sm">
                  Nothing due. Add reporting obligations and sampling schedules on each project's Schedule tab.
                </Text>
              )}
            </Card>

            <Card>
              <Group justify="space-between" mb="sm">
                <Title order={4}>Recent exceedances</Title>
                <Text size="sm" c="dimmed">
                  Last 90 days
                </Text>
              </Group>
              {dash.exceedances.length ? (
                <Table.ScrollContainer minWidth={560}>
                  <Table highlightOnHover>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Date</Table.Th>
                        <Table.Th>Project / site</Table.Th>
                        <Table.Th>Parameter</Table.Th>
                        <Table.Th ta="right">Value</Table.Th>
                        <Table.Th>Rule</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {dash.exceedances.slice(0, 10).map((e, i) => (
                        <Table.Tr key={i} className="clickable-row" onClick={() => navigate(`/projects/${e.b.project.id}/compliance`)}>
                          <Table.Td className="tabular">{formatDate(e.date)}</Table.Td>
                          <Table.Td>
                            <Text size="sm">{e.b.project.name}</Text>
                            <Text size="xs" c="dimmed">
                              {e.site}
                            </Text>
                          </Table.Td>
                          <Table.Td>{e.param}</Table.Td>
                          <Table.Td ta="right" className="tabular" fw={600}>
                            {e.value}
                          </Table.Td>
                          <Table.Td>
                            <Group gap={6} wrap="nowrap">
                              <LevelBadge level={e.ev.rule.level} />
                              <Tooltip label={e.ev.description}>
                                <Text size="sm" lineClamp={1}>
                                  {e.ev.rule.name}
                                </Text>
                              </Tooltip>
                            </Group>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
              ) : (
                <Group gap="xs">
                  <IconCircleCheck size={18} color="var(--mantine-color-green-6)" />
                  <Text size="sm" c="dimmed">
                    No consent limit or trigger exceedances in the last 90 days.
                  </Text>
                </Group>
              )}
            </Card>
          </Stack>
        </Grid.Col>

        <Grid.Col span={{ base: 12, lg: 5 }}>
          <Card>
            <Title order={4} mb="sm">
              Projects
            </Title>
            <Stack gap="sm">
              {active.length === 0 && <EmptyState title="No active projects" />}
              {active
                .sort((a, c) => (a.project.updatedAt < c.project.updatedAt ? 1 : -1))
                .map((b) => {
                  const st = dash.projectStats.get(b.project.id);
                  const exceededRules = st?.evals.filter((e) => e.status === 'exceeded') ?? [];
                  return (
                    <Paper key={b.project.id} withBorder p="sm" radius="md" className="clickable-row" onClick={() => navigate(`/projects/${b.project.id}`)}>
                      <Group justify="space-between" wrap="nowrap" align="flex-start">
                        <div style={{ minWidth: 0 }}>
                          <Text fw={600} truncate>
                            {b.project.name}
                          </Text>
                          <Text size="xs" c="dimmed" truncate>
                            {[b.project.code, b.project.client, `${b.sites.length} sites`].filter(Boolean).join(' · ')}
                          </Text>
                          <Text size="xs" c="dimmed">
                            Last sampled {st?.lastSample ? `${formatDate(st.lastSample)} (${relativeDays(daysUntil(st.lastSample.slice(0, 10)))})` : '—'}
                          </Text>
                        </div>
                        {b.rules.length ? (
                          exceededRules.length ? (
                            <Tooltip label={<List size="xs">{exceededRules.map((e) => <List.Item key={e.rule.id}>{e.rule.name}</List.Item>)}</List>}>
                              <Badge color="red" variant="filled" leftSection={<IconAlertTriangle size={12} />} style={{ flexShrink: 0 }}>
                                {exceededRules.length} exceeded
                              </Badge>
                            </Tooltip>
                          ) : (
                            <Badge color="green" leftSection={<IconCircleCheck size={12} />} style={{ flexShrink: 0 }}>
                              Complying
                            </Badge>
                          )
                        ) : (
                          <Badge color="gray" style={{ flexShrink: 0 }}>
                            No rules
                          </Badge>
                        )}
                      </Group>
                    </Paper>
                  );
                })}
              <Button variant="subtle" component={Link} to="/projects" leftSection={<IconPlus size={14} />}>
                All projects
              </Button>
            </Stack>
          </Card>
        </Grid.Col>
      </Grid>
    </Stack>
  );
}
