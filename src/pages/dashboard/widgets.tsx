import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActionIcon, Anchor, Badge, Button, Group, List, Paper, SegmentedControl, SimpleGrid, Stack, Table, Text, Textarea, ThemeIcon, Tooltip, UnstyledButton } from '@mantine/core';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  IconAlertTriangle, IconBook2, IconCalendarDue, IconCalendarMonth, IconCheck, IconCircleCheck, IconCircleX, IconFileReport, IconFlask, IconFolders, IconListCheck, IconSettings, IconUpload,
} from '@tabler/icons-react';
import { db } from '../../db/db';
import type { ProjectBundle } from '../../lib/analysis';
import type { RuleEvaluation } from '../../lib/compliance';
import type { Action } from '../../lib/actions';
import { cellValue, markId, MONTH_FIELDS, monthName, monthText, plannedIn, rowMonths, STATUS_INFO, STATUSES, windowRange, windowsOf, type CalendarSheet as SheetData } from '../../lib/calendar';
import { addMonths, daysUntil, formatDate, MONTH_SHORT, relativeDays } from '../../lib/dates';
import { nextObligation, obligationPeriods } from '../../lib/schedule';
import { setCalendarStatus } from '../../db/repo';
import { LevelBadge, StatTile } from '../../components/common';
import { CalendarSheet } from '../../components/calendar/CalendarSheet';
import { NewProjectButton } from '../Projects';

// The dashboard's widgets: each is a card that can be placed, moved and resized on the dashboard.

export interface Deadline {
  date: string;
  kind: 'report' | 'sampling';
  title: string;
  project: ProjectBundle;
  status: string;
  color: string;
  link: string;
}

export interface DashboardData {
  deadlines: Deadline[];
  exceedances: Array<{ b: ProjectBundle; ev: RuleEvaluation; date: string; site: string; param: string; value: string; limit: string }>;
  projectStats: Map<string, { evals: RuleEvaluation[]; exceeded: number; lastSample?: string; samples30: number }>;
  samples30: number;
}

export interface WidgetCtx {
  bundles: ProjectBundle[];
  dash: DashboardData;
  /** The monitoring calendar this year. */
  sheet: SheetData | null;
  actions: Action[];
  today: string;
}

export type WidgetId = 'stats' | 'actions' | 'thisMonth' | 'calendar' | 'deadlines' | 'reports' | 'exceedances' | 'projects' | 'imports' | 'notes' | 'links';

export interface WidgetDef {
  id: WidgetId;
  title: string;
  description: string;
  /** Size in grid units (24 columns; rows of 12 px). */
  size: { w: number; h: number; minW: number; minH: number };
  /** The space (px, inside the card's padding) its contents need at full size; `h` only for contents that can't scroll. */
  fit: { w: number; h?: number };
  render: (ctx: WidgetCtx) => ReactNode;
  /** Shown beside the title. */
  extra?: (ctx: WidgetCtx) => ReactNode;
}

// ------------------------------------------------------------ widgets

function KeyFigures({ bundles, dash, today }: WidgetCtx) {
  const navigate = useNavigate();
  const active = bundles.filter((b) => b.project.status === 'active');
  const overdue = dash.deadlines.filter((d) => d.kind === 'report' && d.date < today).length;
  const reportsSoon = dash.deadlines.filter((d) => d.kind === 'report' && d.date >= today && daysUntil(d.date) <= 30).length;
  const exceeded = Array.from(dash.projectStats.values()).reduce((s, p) => s + p.exceeded, 0);
  return (
    <SimpleGrid cols={{ base: 1, xs: 2, lg: 4 }}>
      <StatTile label="Active projects" value={active.length} sub={`${bundles.length - active.length} archived`} icon={<IconFolders size={22} color="var(--mantine-color-dimmed)" />} onClick={() => navigate('/projects')} />
      <StatTile label="Samples in the last 30 days" value={dash.samples30} icon={<IconFlask size={22} color="var(--mantine-color-dimmed)" />} />
      <StatTile
        label="Rules exceeded"
        value={exceeded}
        color={exceeded ? 'red' : undefined}
        sub={`This reporting year · ${dash.exceedances.length} exceedance${dash.exceedances.length === 1 ? '' : 's'} in the last 90 days`}
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
  );
}

const ACTION_ICON: Record<Action['kind'], typeof IconFlask> = { report: IconFileReport, results: IconListCheck, sampling: IconFlask, exceedance: IconAlertTriangle };
const URGENCY_COLOR = ['red', 'orange', 'gray'] as const;

function ActionsToTake({ actions }: WidgetCtx) {
  const navigate = useNavigate();
  if (!actions.length)
    return (
      <Group gap="xs">
        <IconCircleCheck size={18} color="var(--mantine-color-green-6)" />
        <Text size="sm" c="dimmed">
          Nothing needs doing right now: no reports due in the next month, results waiting or exceedances to follow up.
        </Text>
      </Group>
    );
  return (
    <Stack gap={6}>
      {actions.slice(0, 40).map((a) => {
        const Icon = ACTION_ICON[a.kind];
        return (
          <Paper key={a.id} withBorder p={8} radius="md" className="clickable-row" onClick={() => navigate(a.link)}>
            <Group gap="sm" wrap="nowrap" align="flex-start">
              <ThemeIcon size="md" variant="light" color={URGENCY_COLOR[a.urgency]}>
                <Icon size={16} />
              </ThemeIcon>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Text size="sm" fw={500} lineClamp={2}>
                  {a.title}
                </Text>
                <Text size="xs" c="dimmed" lineClamp={2}>
                  {a.projectName} · {a.detail}
                </Text>
              </div>
              {a.calendar && (
                <Tooltip label="Mark done – the results have been sent or reported">
                  <ActionIcon
                    variant="light"
                    color="teal"
                    aria-label="Mark done"
                    onClick={(e) => {
                      e.stopPropagation();
                      void setCalendarStatus(a.calendar!.item, a.calendar!.month, 'done');
                    }}
                  >
                    <IconCheck size={16} />
                  </ActionIcon>
                </Tooltip>
              )}
            </Group>
          </Paper>
        );
      })}
    </Stack>
  );
}

/** A month's jobs on the monitoring calendar – this month or next – to colour as they're done. */
function MonthList({ sheet, today }: WidgetCtx) {
  const [which, setWhich] = useState<'this' | 'next'>('this');
  const thisMonth = today.slice(0, 7);
  const nextMonth = addMonths(`${thisMonth}-01`, 1).slice(0, 7);
  const month = which === 'this' ? thisMonth : nextMonth;
  const i = Number(month.slice(5, 7)) - 1;
  const rows = useMemo(
    () =>
      (sheet?.rows ?? []).filter((r) => {
        const p = r.projectId ? sheet!.projects.get(r.projectId) : undefined;
        return !r.onHold && (!p || p.status === 'active') && plannedIn(r, i);
      }),
    [sheet, i],
  );
  return (
    <Stack gap="xs">
      <SegmentedControl
        size="xs"
        value={which}
        onChange={(v) => setWhich(v as 'this' | 'next')}
        data={[
          { value: 'this', label: monthName(thisMonth, true) },
          { value: 'next', label: monthName(nextMonth, true) },
        ]}
        w="fit-content"
      />
      {!sheet ? null : !rows.length ? (
        <Text size="sm" c="dimmed">
          Nothing on the{' '}
          <Anchor component={Link} to="/calendar" size="sm">
            monitoring calendar
          </Anchor>{' '}
          for {monthName(month, true)}.
        </Text>
      ) : (
        rows.map((row) => {
          const project = row.projectId ? sheet.projects.get(row.projectId) : undefined;
          const status = sheet.marks.get(markId(row.id, month))?.status;
          const res = sheet.facts.get(row.id)?.results.get(month);
          const windows = windowsOf(rowMonths(row));
          const own = monthText(row[MONTH_FIELDS[i]] ?? '');
          const [a, b] = windowRange(windows, i);
          const marks = own || monthText(row[MONTH_FIELDS[a]] ?? '');
          const window = b > a ? `${MONTH_SHORT[a]}–${MONTH_SHORT[b]}` : '';
          return (
            <Group key={row.id} gap="xs" wrap="nowrap" justify="space-between" className={`dash-month${status ? ` st-${status}` : ''}`}>
              <div style={{ minWidth: 0 }}>
                <Group gap={8} wrap="nowrap">
                  {marks && (
                    <Text fw={700} size="sm" style={{ flexShrink: 0 }}>
                      {marks}
                    </Text>
                  )}
                  {project ? (
                    <Anchor component={Link} to={`/projects/${project.id}/schedule`} size="sm" fw={500} c="inherit" truncate>
                      {cellValue(row, 'job', project)}
                    </Anchor>
                  ) : (
                    <Text size="sm" fw={500} truncate>
                      {row.job || 'Untitled job'}
                    </Text>
                  )}
                </Group>
                <Text size="xs" c="dimmed" truncate>
                  {[window && `window ${window}`, res ? `results in ${res.days.map((d) => formatDate(d)).join(', ')}` : project ? 'no results in yet' : '', status ? STATUS_INFO[status].label.toLowerCase() : '']
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </div>
              <Group gap={4} wrap="nowrap">
                {STATUSES.map((s) => (
                  <Tooltip key={s} label={status === s ? `${STATUS_INFO[s].label} – click to clear` : STATUS_INFO[s].label}>
                    <UnstyledButton
                      className={`dash-st${status === s ? ' on' : ''}`}
                      onClick={() => void setCalendarStatus(row.id, month, status === s ? undefined : s)}
                      aria-label={`Mark ${STATUS_INFO[s].label.toLowerCase()}`}
                      aria-pressed={status === s}
                    >
                      <span className={`cal-swatch st-${s}`} />
                    </UnstyledButton>
                  </Tooltip>
                ))}
              </Group>
            </Group>
          );
        })
      )}
    </Stack>
  );
}

function Deadlines({ dash, today }: WidgetCtx) {
  const navigate = useNavigate();
  if (!dash.deadlines.length)
    return (
      <Text c="dimmed" size="sm">
        Nothing due. Add reporting obligations and sampling schedules on each project's Schedule tab.
      </Text>
    );
  return (
    <Table highlightOnHover>
      <Table.Tbody>
        {dash.deadlines.slice(0, 20).map((d, i) => (
          <Table.Tr key={i} className="clickable-row" onClick={() => navigate(d.link)}>
            <Table.Td style={{ whiteSpace: 'nowrap' }} w={110}>
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
            <Table.Td w={120}>
              <Badge color={d.color} style={{ overflow: 'visible' }} styles={{ label: { overflow: 'visible' } }}>
                {d.status}
              </Badge>
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

function ReportsDue({ bundles, today }: WidgetCtx) {
  const end = `${today.slice(0, 4)}-12-31`;
  const list = bundles
    .filter((b) => b.project.status === 'active')
    .flatMap((b) =>
      b.obligations
        .filter((o) => o.active)
        .flatMap((o) => {
          const periods = obligationPeriods(o, today).filter((p) => !p.submission);
          const next = nextObligation(o, today);
          if (next && !next.submission && !periods.some((p) => p.index === next.index)) periods.push(next);
          return periods.filter((p) => p.dueDate <= end).map((p) => ({ b, o, p }));
        }),
    )
    .sort((a, b) => a.p.dueDate.localeCompare(b.p.dueDate))
    .slice(0, 12);
  if (!list.length)
    return (
      <Text size="sm" c="dimmed">
        No reports outstanding this year.
      </Text>
    );
  return (
    <Stack gap={6}>
      {list.map(({ b, o, p }) => (
        <Group key={`${o.id}|${p.index}`} gap="sm" wrap="nowrap" justify="space-between">
          <div style={{ minWidth: 0 }}>
            <Anchor component={Link} to={`/projects/${b.project.id}/reports?obligation=${o.id}&period=${p.index}`} size="sm" fw={500} c="inherit" lineClamp={1}>
              {o.name}
            </Anchor>
            <Text size="xs" c="dimmed" lineClamp={1}>
              {b.project.name}
            </Text>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <Text size="sm" className="tabular">
              {formatDate(p.dueDate)}
            </Text>
            <Text size="xs" c={p.dueDate < today ? 'red' : 'dimmed'}>
              {relativeDays(daysUntil(p.dueDate))}
            </Text>
          </div>
        </Group>
      ))}
    </Stack>
  );
}

function Exceedances({ dash }: WidgetCtx) {
  const navigate = useNavigate();
  if (!dash.exceedances.length)
    return (
      <Group gap="xs">
        <IconCircleCheck size={18} color="var(--mantine-color-green-6)" />
        <Text size="sm" c="dimmed">
          No consent limit or trigger exceedances in the last 90 days.
        </Text>
      </Group>
    );
  return (
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
        {dash.exceedances.slice(0, 20).map((e, i) => (
          <Table.Tr key={i} className="clickable-row" onClick={() => navigate(`/projects/${e.b.project.id}/compliance`)}>
            <Table.Td className="tabular" style={{ whiteSpace: 'nowrap' }}>
              {formatDate(e.date)}
            </Table.Td>
            <Table.Td>
              <Text size="sm">{e.b.project.name}</Text>
              <Text size="xs" c="dimmed">
                {e.site}
              </Text>
            </Table.Td>
            <Table.Td>{e.param}</Table.Td>
            <Table.Td ta="right" className="tabular" fw={600} style={{ whiteSpace: 'nowrap' }}>
              {e.value}
            </Table.Td>
            <Table.Td>
              <Group gap={6} wrap="nowrap" align="flex-start">
                <div style={{ flexShrink: 0 }}>
                  <LevelBadge level={e.ev.rule.level} />
                </div>
                <Tooltip label={e.ev.description}>
                  <Text size="sm" lineClamp={2}>
                    {e.ev.rule.name}
                  </Text>
                </Tooltip>
              </Group>
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

function Projects({ bundles, dash }: WidgetCtx) {
  const navigate = useNavigate();
  const active = bundles.filter((b) => b.project.status === 'active').sort((a, c) => (a.project.updatedAt < c.project.updatedAt ? 1 : -1));
  return (
    <Stack gap="sm">
      {!active.length && (
        <Text size="sm" c="dimmed">
          No active projects.
        </Text>
      )}
      {active.map((b) => {
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
    </Stack>
  );
}

function RecentImports({ bundles }: WidgetCtx) {
  const imports = useLiveQuery(() => db.imports.orderBy('importedAt').reverse().limit(12).toArray(), []);
  const names = new Map(bundles.map((b) => [b.project.id, b.project.name]));
  if (!imports) return null;
  if (!imports.length)
    return (
      <Text size="sm" c="dimmed">
        Nothing imported yet.
      </Text>
    );
  return (
    <Stack gap={6}>
      {imports.map((i) => (
        <Group key={i.id} gap="sm" wrap="nowrap" justify="space-between">
          <div style={{ minWidth: 0 }}>
            <Anchor component={Link} to={`/projects/${i.projectId}/data`} size="sm" fw={500} c="inherit" lineClamp={1}>
              {i.fileName}
            </Anchor>
            <Text size="xs" c="dimmed" lineClamp={1}>
              {names.get(i.projectId) ?? 'Deleted project'} · {i.results} results from {i.samples} samples
            </Text>
          </div>
          <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
            {formatDate(i.importedAt)}
          </Text>
        </Group>
      ))}
    </Stack>
  );
}

const NOTES_KEY = 'dashboardNotes';

function MyNotes() {
  const saved = useLiveQuery(() => db.meta.get(NOTES_KEY), []);
  const [text, setText] = useState<string | null>(null);
  const timer = useRef<number>();
  useEffect(() => {
    if (saved !== undefined && text === null) setText((saved?.value as string | undefined) ?? '');
  }, [saved, text]);
  return (
    <Textarea
      placeholder="Your own notes – only you see them"
      autosize
      minRows={3}
      value={text ?? ''}
      onChange={(e) => {
        const v = e.currentTarget.value;
        setText(v);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => void db.meta.put({ key: NOTES_KEY, value: v }), 500);
      }}
      styles={{ input: { border: 0, padding: 0, background: 'transparent' } }}
    />
  );
}

function QuickLinks() {
  const links: Array<[string, string, typeof IconUpload]> = [
    ['/import', 'Import results', IconUpload],
    ['/calendar', 'Monitoring calendar', IconCalendarMonth],
    ['/guidelines', 'Guidelines', IconBook2],
    ['/settings', 'Settings & backup', IconSettings],
  ];
  return (
    <Group gap="xs">
      <NewProjectButton variant="light" size="xs" />
      {links.map(([to, label, Icon]) => (
        <Button key={to} component={Link} to={to} variant="default" size="xs" leftSection={<Icon size={14} />}>
          {label}
        </Button>
      ))}
    </Group>
  );
}

const CALENDAR_WIDGET_KEY = 'dashboard.calendar';

/** The calendar on the dashboard, with the columns chosen for it (kept with the dashboard, so they're each person's own). */
function CalendarWidget() {
  const saved = useLiveQuery(() => db.meta.get(CALENDAR_WIDGET_KEY), [], null);
  if (saved === null) return null;
  const columns = Array.isArray((saved?.value as { columns?: unknown } | undefined)?.columns) ? ((saved!.value as { columns: string[] }).columns) : [];
  return <CalendarSheet compact columns={columns} onColumnsChange={(fields) => void db.meta.put({ key: CALENDAR_WIDGET_KEY, value: { columns: fields } })} />;
}

export const WIDGETS: WidgetDef[] = [
  { id: 'stats', title: 'Key figures', description: 'Projects, samples, rules exceeded and reports due', size: { w: 24, h: 8, minW: 4, minH: 3 }, fit: { w: 720, h: 170 }, render: (c) => <KeyFigures {...c} /> },
  {
    id: 'actions',
    title: 'Actions to take',
    description: 'Reports due, results to send or report, sampling still to do, exceedances to follow up',
    size: { w: 14, h: 16, minW: 4, minH: 4 }, fit: { w: 430 },
    render: (c) => <ActionsToTake {...c} />,
    extra: (c) => (c.actions.length ? <Badge variant="light" color={c.actions.some((a) => a.urgency === 0) ? 'red' : 'orange'}>{c.actions.length}</Badge> : null),
  },
  { id: 'thisMonth', title: 'This month’s monitoring', description: 'The jobs on the monitoring calendar this month and next, to colour as they’re done', size: { w: 10, h: 16, minW: 4, minH: 4 }, fit: { w: 330 }, render: (c) => <MonthList {...c} /> },
  {
    id: 'calendar',
    title: 'Monitoring calendar',
    description: 'The team’s monitoring schedule for the year, as in the spreadsheet',
    size: { w: 24, h: 16, minW: 4, minH: 4 }, fit: { w: 620 },
    render: () => <CalendarWidget />,
    extra: () => (
      <Anchor component={Link} to="/calendar" size="xs">
        Open
      </Anchor>
    ),
  },
  { id: 'deadlines', title: 'Upcoming deadlines', description: 'Reports and sampling rounds, soonest first', size: { w: 14, h: 16, minW: 4, minH: 4 }, fit: { w: 430 }, render: (c) => <Deadlines {...c} /> },
  { id: 'reports', title: 'Reports due', description: 'Reports due by the end of the year, not yet submitted', size: { w: 10, h: 12, minW: 4, minH: 4 }, fit: { w: 320 }, render: (c) => <ReportsDue {...c} /> },
  { id: 'exceedances', title: 'Recent exceedances', description: 'Consent limits and triggers exceeded in the last 90 days', size: { w: 24, h: 14, minW: 4, minH: 4 }, fit: { w: 600 }, render: (c) => <Exceedances {...c} /> },
  { id: 'projects', title: 'Projects', description: 'Your active projects and whether they comply', size: { w: 10, h: 16, minW: 4, minH: 4 }, fit: { w: 320 }, render: (c) => <Projects {...c} /> },
  { id: 'imports', title: 'Recent imports', description: 'The latest lab files imported, by anyone', size: { w: 10, h: 10, minW: 4, minH: 4 }, fit: { w: 330 }, render: (c) => <RecentImports {...c} /> },
  { id: 'notes', title: 'My notes', description: 'A notepad only you see', size: { w: 8, h: 10, minW: 3, minH: 4 }, fit: { w: 240 }, render: () => <MyNotes /> },
  { id: 'links', title: 'Quick links', description: 'New project, import, calendar, guidelines, settings', size: { w: 10, h: 6, minW: 4, minH: 3 }, fit: { w: 360, h: 115 }, render: () => <QuickLinks /> },
];

export const WIDGET_MAP = new Map(WIDGETS.map((w) => [w.id, w]));

export interface PlacedWidget {
  i: WidgetId;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Text size chosen for the widget (1 = normal); none: it fits the widget's size by itself. */
  scale?: number;
}

/** The dashboard grid: 24 columns and 12 px rows (with 16 px gaps, two of these make one of the first version's). */
export const GRID = { cols: 24, rowHeight: 12, margin: 16, version: 2 };

/** A widget's own size for its contents: smaller than this, everything in it is shown smaller to fit (no smaller than `MIN_SCALE`). */
export const MIN_SCALE = 0.55;
export function autoScale(fit: WidgetDef['fit'], width: number, height: number): number {
  if (!width) return 1;
  const s = Math.min(width / fit.w, fit.h && height ? height / fit.h : 1, 1);
  return Math.max(MIN_SCALE, Math.round(s * 100) / 100);
}

/** The dashboard to start from: what most people want to see first. */
export const DEFAULT_DASHBOARD: PlacedWidget[] = [
  { i: 'stats', x: 0, y: 0, w: 24, h: 8 },
  { i: 'actions', x: 0, y: 8, w: 14, h: 18 },
  { i: 'thisMonth', x: 14, y: 8, w: 10, h: 18 },
  { i: 'calendar', x: 0, y: 26, w: 24, h: 16 },
  { i: 'deadlines', x: 0, y: 42, w: 14, h: 16 },
  { i: 'projects', x: 14, y: 42, w: 10, h: 16 },
  { i: 'exceedances', x: 0, y: 58, w: 24, h: 14 },
];


/** The saved dashboard, or the default; widgets this version doesn't have are left out. A first-version layout (12 columns,
 * 40 px rows) is doubled to fit the finer grid. */
export function readLayout(value: unknown): PlacedWidget[] {
  const v = value as { items?: unknown; version?: number } | undefined;
  const items = v?.items;
  if (!Array.isArray(items)) return DEFAULT_DASHBOARD;
  const k = (v?.version ?? 1) < 2 ? 2 : 1;
  const ok = items
    .filter((x): x is PlacedWidget => !!x && typeof x === 'object' && WIDGET_MAP.has((x as PlacedWidget).i) && ['x', 'y', 'w', 'h'].every((key) => Number.isFinite((x as unknown as Record<string, number>)[key])))
    .map((x) => ({ i: x.i, x: x.x * k, y: x.y * k, w: x.w * k, h: x.h * k, scale: typeof x.scale === 'number' && x.scale >= 0.4 && x.scale <= 2 ? x.scale : undefined }));
  return ok.filter((x, i) => ok.findIndex((y) => y.i === x.i) === i);
}
