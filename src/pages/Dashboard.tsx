import { useEffect, useMemo, useState } from 'react';
import { ActionIcon, Alert, Button, Card, Group, Menu, SimpleGrid, Stack, Text, ThemeIcon, Title, Anchor, Loader, Center, Tooltip, Paper } from '@mantine/core';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import ReactGridLayout, { useContainerWidth } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { notifications } from '@mantine/notifications';
import { IconArrowDown, IconArrowUp, IconCheck, IconDatabaseImport, IconFlask, IconGripVertical, IconLayoutDashboard, IconPlus, IconRestore, IconSparkles, IconUpload, IconX } from '@tabler/icons-react';
import { useAllBundles } from '../hooks/useAllData';
import { evaluateAll, type ProjectBundle } from '../lib/analysis';
import { addDays, daysUntil, formatDate, reportingYear, todayStr } from '../lib/dates';
import { nextObligation, OBLIGATION_STATUS, scheduleStatus } from '../lib/schedule';
import { PageHeader } from '../components/common';
import { createDemoProject } from '../db/demo';
import { unitLabel } from '../lib/units';
import { fmtNum } from '../lib/values';
import { NewProjectButton } from './Projects';
import { db } from '../db/db';
import { useCalendarSheet } from '../hooks/useCalendarSheet';
import { actionsToTake } from '../lib/actions';
import { DEFAULT_DASHBOARD, WIDGET_MAP, WIDGETS, type DashboardData, type PlacedWidget, type WidgetCtx, type WidgetId } from './dashboard/widgets';
import type { Deadline } from './dashboard/widgets';
import type { RuleEvaluation } from '../lib/compliance';

function useDashboard(bundles: ProjectBundle[]): DashboardData {
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
        Everything is saved to your team’s workspace folder as you work, and colleagues’ changes appear here within seconds. <Anchor component={Link} to="/settings">Settings & backup</Anchor> shows who’s connected and has backups.
      </Text>
    </Stack>
  );
}

export function DashboardPage() {
  const { bundles, loading } = useAllBundles();
  const dash = useDashboard(bundles);
  const today = todayStr();
  const sheet = useCalendarSheet(Number(today.slice(0, 4)));
  const actions = useMemo(() => actionsToTake(bundles, sheet, today), [bundles, sheet, today]);
  const saved = useLiveQuery(() => db.meta.get(DASHBOARD_KEY), [], null);
  const [editing, setEditing] = useState(false);
  const [narrow, setNarrow] = useState(false);
  if (loading || saved === null)
    return (
      <Center h={300}>
        <Loader />
      </Center>
    );
  if (!bundles.length) return <Welcome />;
  const active = bundles.filter((b) => b.project.status === 'active');
  const placed = validLayout(saved?.value);
  const save = (items: PlacedWidget[]) => db.meta.put({ key: DASHBOARD_KEY, value: { version: 1, items } });
  const unused = WIDGETS.filter((w) => !placed.some((p) => p.i === w.id));
  const ctx: WidgetCtx = { bundles, dash, sheet, actions, today };
  const remove = (id: WidgetId) => save(placed.filter((p) => p.i !== id));
  const add = (id: WidgetId) => {
    const def = WIDGET_MAP.get(id)!;
    const y = placed.reduce((m, p) => Math.max(m, p.y + p.h), 0);
    save([...placed, { i: id, x: 0, y, w: def.size.w, h: def.size.h }]);
  };
  const move = (id: WidgetId, dir: -1 | 1) => {
    const order = [...placed].sort(byPosition);
    const i = order.findIndex((p) => p.i === id);
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    // swap places
    const a = order[i], b = order[j];
    save(placed.map((p) => (p.i === a.i ? { ...p, x: b.x, y: b.y } : p.i === b.i ? { ...p, x: a.x, y: a.y } : p)));
  };

  const card = (id: WidgetId, fill: boolean) => {
    const def = WIDGET_MAP.get(id)!;
    return (
      <Card className={`dash-widget${editing ? ' dash-editing' : ''}${fill ? ' dash-fill' : ''}`} padding="md">
        <Group justify="space-between" wrap="nowrap" className={`dash-head${editing && !narrow ? ' dash-drag' : ''}`} mb="sm">
          <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
            {editing && !narrow && <IconGripVertical size={16} color="var(--mantine-color-dimmed)" style={{ flexShrink: 0 }} />}
            <Title order={4} lineClamp={1}>
              {def.title}
            </Title>
            {def.extra?.(ctx)}
          </Group>
          {editing && (
            <Group gap={2} wrap="nowrap" className="dash-tools">
              {narrow && (
                <>
                  <ActionIcon variant="subtle" size="sm" onClick={() => move(id, -1)} aria-label={`Move ${def.title} up`}>
                    <IconArrowUp size={14} />
                  </ActionIcon>
                  <ActionIcon variant="subtle" size="sm" onClick={() => move(id, 1)} aria-label={`Move ${def.title} down`}>
                    <IconArrowDown size={14} />
                  </ActionIcon>
                </>
              )}
              <Tooltip label="Remove from the dashboard">
                <ActionIcon variant="subtle" color="red" size="sm" onClick={() => remove(id)} aria-label={`Remove ${def.title}`}>
                  <IconX size={14} />
                </ActionIcon>
              </Tooltip>
            </Group>
          )}
        </Group>
        <div className="dash-body">{def.render(ctx)}</div>
      </Card>
    );
  };

  return (
    <Stack gap="lg">
      <PageHeader
        title="Dashboard"
        description={`${formatDate(today)} · ${active.length} active project${active.length === 1 ? '' : 's'}`}
        actions={
          editing ? (
            <>
              <Menu position="bottom-end" width={320}>
                <Menu.Target>
                  <Button variant="default" leftSection={<IconPlus size={16} />} disabled={!unused.length}>
                    Add a widget
                  </Button>
                </Menu.Target>
                <Menu.Dropdown>
                  {unused.map((w) => (
                    <Menu.Item key={w.id} onClick={() => add(w.id)}>
                      <Text size="sm" fw={500}>
                        {w.title}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {w.description}
                      </Text>
                    </Menu.Item>
                  ))}
                </Menu.Dropdown>
              </Menu>
              <Button variant="default" leftSection={<IconRestore size={16} />} onClick={() => db.meta.delete(DASHBOARD_KEY)}>
                Reset
              </Button>
              <Button leftSection={<IconCheck size={16} />} onClick={() => setEditing(false)}>
                Done
              </Button>
            </>
          ) : (
            <>
              <Button variant="default" leftSection={<IconLayoutDashboard size={16} />} onClick={() => setEditing(true)}>
                Customise
              </Button>
              <NewProjectButton variant="default" />
              <Button component={Link} to="/import" leftSection={<IconUpload size={16} />}>
                Import results
              </Button>
            </>
          )
        }
      />
      {editing && (
        <Alert variant="light" color="teal" py={8}>
          {narrow
            ? 'Move widgets up or down, remove the ones you don’t need, or add others. Your dashboard is your own.'
            : 'Drag a widget by its title to move it, drag its bottom-right corner to resize it, remove the ones you don’t need, or add others. Your dashboard is your own.'}
        </Alert>
      )}
      <WidgetBoard placed={placed} editing={editing} card={card} onNarrow={setNarrow} onChange={(next) => void save(next)} />
    </Stack>
  );
}

/** The widgets in a grid that can be rearranged (a column of them on a phone). */
function WidgetBoard({ placed, editing, card, onNarrow, onChange }: { placed: PlacedWidget[]; editing: boolean; card: (id: WidgetId, fill: boolean) => JSX.Element; onNarrow: (narrow: boolean) => void; onChange: (items: PlacedWidget[]) => void }) {
  const { width, containerRef, mounted } = useContainerWidth({ measureBeforeMount: true, debounceTimeout: 100 });
  const narrow = mounted && width < 760;
  useEffect(() => onNarrow(narrow), [narrow, onNarrow]);
  return (
    // min-width 0: in the page's column the grid mustn't widen its own container
    <div ref={containerRef as React.RefObject<HTMLDivElement>} style={{ minWidth: 0, width: '100%' }}>
      {!mounted ? null : narrow ? (
        <Stack gap="lg">
          {[...placed].sort(byPosition).map((p) => (
            <div key={p.i}>{card(p.i, false)}</div>
          ))}
        </Stack>
      ) : (
        <ReactGridLayout
          layout={placed.map((p) => ({ ...p, minW: WIDGET_MAP.get(p.i)!.size.minW, minH: WIDGET_MAP.get(p.i)!.size.minH }))}
          width={width}
          gridConfig={{ cols: 12, rowHeight: 40, margin: [16, 16], containerPadding: [0, 0] }}
          dragConfig={{ enabled: editing, handle: '.dash-drag', cancel: '.dash-tools' }}
          resizeConfig={{ enabled: editing, handles: ['se'] }}
          onLayoutChange={(layout) => {
            if (!editing) return;
            const next = layout.map((l) => ({ i: l.i as WidgetId, x: l.x, y: l.y, w: l.w, h: l.h }));
            if (!sameLayout(next, placed)) onChange(next);
          }}
        >
          {placed.map((p) => (
            <div key={p.i}>{card(p.i, true)}</div>
          ))}
        </ReactGridLayout>
      )}
    </div>
  );
}

const DASHBOARD_KEY = 'dashboard';

const byPosition = (a: PlacedWidget, b: PlacedWidget) => a.y - b.y || a.x - b.x;

function sameLayout(a: PlacedWidget[], b: PlacedWidget[]): boolean {
  if (a.length !== b.length) return false;
  const m = new Map(b.map((x) => [x.i, x]));
  return a.every((x) => {
    const y = m.get(x.i);
    return !!y && y.x === x.x && y.y === x.y && y.w === x.w && y.h === x.h;
  });
}

/** The saved dashboard, or the default; widgets this version doesn't have are left out. */
function validLayout(value: unknown): PlacedWidget[] {
  const items = (value as { items?: unknown } | undefined)?.items;
  if (!Array.isArray(items)) return DEFAULT_DASHBOARD;
  const ok = items.filter(
    (x): x is PlacedWidget => !!x && typeof x === 'object' && WIDGET_MAP.has((x as PlacedWidget).i) && ['x', 'y', 'w', 'h'].every((k) => Number.isFinite((x as unknown as Record<string, number>)[k])),
  );
  return ok.filter((x, i) => ok.findIndex((y) => y.i === x.i) === i);
}
