import { Fragment, useEffect, useMemo, useState } from 'react';
import { ActionIcon, Anchor, Badge, Button, Group, Popover, ScrollArea, SegmentedControl, Select, Stack, Text, TextInput, Textarea, Tooltip, UnstyledButton } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { Link } from 'react-router-dom';
import { IconChevronLeft, IconChevronRight, IconDownload, IconExternalLink, IconFolder, IconPlus, IconTrash } from '@tabler/icons-react';
import type { CalendarStatus, Project } from '../../db/types';
import { addCalendarExtra, deleteCalendarMark, saveCalendarMark, saveProject, setSubmitted } from '../../db/repo';
import { useCalendar } from '../../hooks/useCalendarData';
import {
  calendarMonths, cellState, cellText, EXTRA_SYMBOLS, legend, monthName, monthOf, STATE_INFO, type CalendarEntry, type CalendarItem, type CellState, type ProjectCalendar,
} from '../../lib/calendar';
import { formatDate, todayStr } from '../../lib/dates';

// The monitoring calendar: a row per project (or per schedule and report), a column per month, marks for what's due
// and colours for where it stands. Click a month to mark it done, add a note or an extra job.

type Rows = 'projects' | 'items';
interface Prefs {
  startMonth: number;
  rows: Rows;
}
const PREFS_KEY = 'envirodb.calendar';

function loadPrefs(): Partial<Prefs> {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>;
  } catch {
    return {};
  }
}
function savePrefs(p: Partial<Prefs>) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...loadPrefs(), ...p }));
  } catch {
    /* a convenience only */
  }
}

const STATE_CLASS: Record<CellState, string> = { done: 'cal-done', doing: 'cal-doing', cancelled: 'cal-cancelled', todo: 'cal-todo', overdue: 'cal-overdue' };

/** The year that holds today, for a year starting in `startMonth`. */
function currentYear(startMonth: number): number {
  const t = todayStr();
  const y = Number(t.slice(0, 4));
  return Number(t.slice(5, 7)) >= startMonth ? y : y - 1;
}

function entryInfo(e: CalendarEntry): string {
  const parts: string[] = [];
  if (e.item.kind === 'report') {
    parts.push(`Due ${formatDate(e.due)} · for ${formatDate(e.start)} – ${formatDate(e.end)}`);
    if (e.auto === 'submitted') parts.push('submitted');
  } else if (e.item.kind === 'sampling') {
    parts.push(e.count && e.count > 1 ? `${e.count} rounds this month` : `Round ${formatDate(e.start)} – ${formatDate(e.end)}`);
    if (e.window) parts.push(`sampling window, until ${formatDate(e.due)}`);
    if (e.auto === 'reported') parts.push(`reported in the ${e.reportedIn}`);
    else if (e.auto === 'sampled') parts.push('results in for every site');
    else if (e.auto === 'partly') parts.push('results in for some sites');
  }
  return parts.join(' · ');
}

function EntryEditor({ e }: { e: CalendarEntry }) {
  // a sampling window's later months share the round's mark
  const month = e.window ? monthOf(e.start) : e.month;
  const [note, setNote] = useState(e.mark?.note ?? '');
  useEffect(() => setNote(e.mark?.note ?? ''), [e.mark?.note]);
  const value = e.mark?.status ?? (e.auto === 'submitted' || e.auto === 'reported' ? 'done' : 'todo');
  const save = async (status: CalendarStatus | undefined, n = note) => {
    if (e.item.kind === 'report') {
      // a report marked done is submitted (today); one marked otherwise isn't
      await setSubmitted(e.item.key, { periodStart: e.start, periodEnd: e.end }, status === 'done' ? todayStr() : null);
      await saveCalendarMark({ projectId: e.item.projectId, item: e.item.key, month, status: status === 'done' ? undefined : status, note: n });
      return;
    }
    await saveCalendarMark({ projectId: e.item.projectId, item: e.item.key, month, status, note: n, symbol: e.mark?.symbol, label: e.mark?.label });
  };
  return (
    <Stack gap={4} className="cal-entry">
      <Group gap="xs" wrap="nowrap" align="flex-start" justify="space-between">
        <Group gap={8} wrap="nowrap" align="flex-start">
          <Text fw={700} w={22} ta="center" className="cal-symbol">
            {e.item.symbol}
          </Text>
          <div>
            <Text size="sm" fw={500}>
              {e.item.label}
            </Text>
            <Text size="xs" c="dimmed">
              {entryInfo(e)}
            </Text>
          </div>
        </Group>
        {e.item.kind === 'extra' && e.mark && (
          <Tooltip label="Remove this job">
            <ActionIcon size="sm" variant="subtle" color="red" onClick={() => deleteCalendarMark(e.mark!.id)} aria-label="Remove this job">
              <IconTrash size={14} />
            </ActionIcon>
          </Tooltip>
        )}
      </Group>
      <SegmentedControl
        size="xs"
        fullWidth
        value={value}
        onChange={(v) => void save(v === 'todo' ? undefined : (v as CalendarStatus))}
        data={[
          { value: 'todo', label: 'To do' },
          { value: 'doing', label: 'Doing' },
          { value: 'done', label: 'Done' },
          { value: 'cancelled', label: 'Cancelled' },
        ]}
        className={`cal-seg cal-seg-${value}`}
      />
      {e.auto === 'sampled' && !e.mark?.status && (
        <Text size="xs" c="dimmed">
          The results are in – mark it done once they've been sent or reported.
        </Text>
      )}
      <TextInput size="xs" placeholder="Note (e.g. results to the client by the 20th)" value={note} onChange={(ev) => setNote(ev.currentTarget.value)} onBlur={() => note !== (e.mark?.note ?? '') && void save(e.mark?.status, note)} />
    </Stack>
  );
}

function AddExtra({ projectId, month }: { projectId: string; month: string }) {
  const [symbol, setSymbol] = useState(EXTRA_SYMBOLS[0]);
  const [label, setLabel] = useState('');
  return (
    <Group gap={6} wrap="nowrap" align="flex-end">
      <Select size="xs" w={64} data={EXTRA_SYMBOLS} value={symbol} onChange={(v) => v && setSymbol(v)} allowDeselect={false} aria-label="Mark" comboboxProps={{ withinPortal: false }} />
      <TextInput size="xs" style={{ flex: 1 }} placeholder="Extra job this month, e.g. metals suite" value={label} onChange={(e) => setLabel(e.currentTarget.value)} />
      <Button
        size="xs"
        variant="light"
        leftSection={<IconPlus size={14} />}
        disabled={!label.trim()}
        onClick={async () => {
          await addCalendarExtra(projectId, month, symbol, label.trim());
          setLabel('');
        }}
      >
        Add
      </Button>
    </Group>
  );
}

function Cell({ entries, month, project, current, editable }: { entries: CalendarEntry[]; month: string; project: Project; current: boolean; editable: boolean }) {
  const [open, setOpen] = useState(false);
  const state = cellState(entries);
  const text = cellText(entries);
  const band = entries.length > 0 && entries.every((e) => e.window);
  const cls = ['cal-cell', state ? STATE_CLASS[state] : '', band ? 'cal-band' : '', current ? (entries.length ? 'cal-now' : 'cal-now-empty') : ''].join(' ');
  const label = `${monthName(month, true)} ${month.slice(0, 4)}${entries.length ? `: ${entries.filter((e) => !e.window).map((e) => `${e.item.label} – ${STATE_INFO[e.state].label}`).join(', ')}` : ''}`;
  const button = (
    <UnstyledButton className={cls} onClick={() => editable && setOpen((o) => !o)} aria-label={label} title={entries.length ? label : undefined}>
      {text}
    </UnstyledButton>
  );
  if (!editable || !open) return button;
  return (
    <Popover opened onChange={setOpen} width={360} position="bottom" withArrow shadow="md" trapFocus>
      <Popover.Target>{button}</Popover.Target>
      <Popover.Dropdown>
        <Stack gap="sm">
          <div>
            <Text fw={600}>
              {monthName(month, true)} {month.slice(0, 4)}
            </Text>
            <Text size="xs" c="dimmed">
              {project.name}
            </Text>
          </div>
          {entries.length ? entries.map((e) => <EntryEditor key={`${e.item.key}|${e.start}`} e={e} />) : <Text size="sm" c="dimmed">Nothing due this month.</Text>}
          {entries.length > 1 && (
            <Button
              size="xs"
              variant="default"
              onClick={async () => {
                for (const e of entries) {
                  const m = e.window ? monthOf(e.start) : e.month;
                  if (e.item.kind === 'report') await setSubmitted(e.item.key, { periodStart: e.start, periodEnd: e.end }, todayStr());
                  else await saveCalendarMark({ projectId: e.item.projectId, item: e.item.key, month: m, status: 'done', note: e.mark?.note, symbol: e.mark?.symbol, label: e.mark?.label });
                }
              }}
            >
              Mark all done
            </Button>
          )}
          <AddExtra projectId={project.id} month={month} />
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}

function NotesCell({ project, editable }: { project: Project; editable: boolean }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(project.calendarNotes ?? '');
  useEffect(() => setText(project.calendarNotes ?? ''), [project.calendarNotes]);
  const view = (
    <UnstyledButton className="cal-notes" onClick={() => editable && setOpen((o) => !o)} title={editable ? 'Click to edit' : undefined}>
      {project.calendarNotes ? <Text size="xs" lineClamp={3}>{project.calendarNotes}</Text> : editable ? <Text size="xs" c="dimmed">Add notes…</Text> : null}
    </UnstyledButton>
  );
  if (!open) return view;
  return (
    <Popover opened onChange={setOpen} width={320} withArrow shadow="md" trapFocus>
      <Popover.Target>{view}</Popover.Target>
      <Popover.Dropdown>
        <Stack gap="xs">
          <Textarea label="Monitoring notes" description="e.g. who the results go to, access, gear" autosize minRows={3} value={text} onChange={(e) => setText(e.currentTarget.value)} data-autofocus />
          <Group justify="flex-end">
            <Button
              size="xs"
              onClick={async () => {
                await saveProject({ ...project, calendarNotes: text.trim() || undefined }, project);
                setOpen(false);
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

function FolderCell({ folder }: { folder?: string }) {
  if (!folder) return null;
  const link = /^https?:\/\//i.test(folder);
  return (
    <Tooltip label={link ? `Open ${folder}` : `${folder} – click to copy, then paste into File Explorer`} multiline maw={360}>
      {link ? (
        <ActionIcon component="a" href={folder} target="_blank" rel="noreferrer" variant="subtle" size="sm" aria-label="Open the project folder">
          <IconExternalLink size={15} />
        </ActionIcon>
      ) : (
        <ActionIcon
          variant="subtle"
          size="sm"
          aria-label="Copy the folder path"
          onClick={async () => {
            await navigator.clipboard.writeText(folder);
            notifications.show({ message: 'Folder path copied – paste it into File Explorer' });
          }}
        >
          <IconFolder size={15} />
        </ActionIcon>
      )}
    </Tooltip>
  );
}

const STATE_DOT: Record<CellState, string> = { done: 'teal', doing: 'yellow', cancelled: 'pink', todo: 'gray', overdue: 'red' };

export function CalendarLegend() {
  return (
    <Group gap="md" className="cal-legend" wrap="wrap">
      {(['done', 'doing', 'cancelled', 'overdue'] as CellState[]).map((s) => (
        <Group key={s} gap={6} wrap="nowrap">
          <span className={`cal-swatch ${STATE_CLASS[s]}`} />
          <Text size="xs">
            <b>{STATE_INFO[s].label}</b> – {STATE_INFO[s].hint.toLowerCase()}
          </Text>
        </Group>
      ))}
      <Text size="xs" c="dimmed">
        ● ▲ ■ … sampling (each project's key under Details) · R report due · # % @ extra jobs · <span className="cal-swatch cal-band" /> sampling window
      </Text>
    </Group>
  );
}

export interface MonitoringCalendarProps {
  /** One project's calendar (a row per schedule and report); otherwise every project's. */
  projectId?: string;
  /** Show archived projects too. */
  archived?: boolean;
  /** Only projects whose name, client or job number has this in it. */
  search?: string;
  /** Fewer columns: for the dashboard and a project's Schedule tab. */
  compact?: boolean;
  editable?: boolean;
}

export function MonitoringCalendar({ projectId, archived = false, search = '', compact = false, editable = true }: MonitoringCalendarProps) {
  const saved = loadPrefs();
  const [startMonth, setStartMonth] = useState<number>(saved.startMonth === 7 ? 7 : 1);
  const [rows, setRows] = useState<Rows>(projectId ? 'items' : saved.rows === 'items' ? 'items' : 'projects');
  const [year, setYear] = useState(() => currentYear(saved.startMonth === 7 ? 7 : 1));
  const months = useMemo(() => calendarMonths(year, startMonth), [year, startMonth]);
  const calendars = useCalendar(months, projectId);
  const nowMonth = todayStr().slice(0, 7);
  const q = search.trim().toLowerCase();
  const shown = (calendars ?? []).filter(
    (c) => (archived || c.project.status === 'active' || !!projectId) && (!q || [c.project.name, c.project.client, c.project.code].join(' ').toLowerCase().includes(q)),
  );
  // projects with something on the calendar first
  const ordered = [...shown].sort((a, b) => Number(!a.items.length) - Number(!b.items.length));
  const yearLabel = startMonth === 1 ? String(year) : `${year}–${String(year + 1).slice(2)}`;

  const monthCells = (entriesFor: (m: string) => CalendarEntry[], project: Project) =>
    months.map((m) => (
      <td key={m} className="cal-td">
        <Cell entries={entriesFor(m)} month={m} project={project} current={m === nowMonth} editable={editable} />
      </td>
    ));

  return (
    <Stack gap="sm">
      <Group justify="space-between" wrap="wrap" gap="sm">
        <Group gap={4} wrap="nowrap">
          <ActionIcon variant="default" onClick={() => setYear((y) => y - 1)} aria-label="Previous year">
            <IconChevronLeft size={16} />
          </ActionIcon>
          <Text fw={650} w={84} ta="center">
            {yearLabel}
          </Text>
          <ActionIcon variant="default" onClick={() => setYear((y) => y + 1)} aria-label="Next year">
            <IconChevronRight size={16} />
          </ActionIcon>
          {year !== currentYear(startMonth) && (
            <Button size="compact-sm" variant="subtle" onClick={() => setYear(currentYear(startMonth))}>
              This year
            </Button>
          )}
        </Group>
        <Group gap="xs" wrap="wrap">
          <SegmentedControl
            size="xs"
            value={String(startMonth)}
            onChange={(v) => {
              const s = Number(v);
              setStartMonth(s);
              setYear(currentYear(s));
              savePrefs({ startMonth: s });
            }}
            data={[
              { value: '1', label: 'Jan–Dec' },
              { value: '7', label: 'Jul–Jun' },
            ]}
            aria-label="Year"
          />
          {!projectId && (
            <SegmentedControl
              size="xs"
              value={rows}
              onChange={(v) => {
                setRows(v as Rows);
                savePrefs({ rows: v as Rows });
              }}
              data={[
                { value: 'projects', label: 'A row per project' },
                { value: 'items', label: 'A row per schedule' },
              ]}
              aria-label="Rows"
            />
          )}
          {!compact && (
            <Button
              size="xs"
              variant="default"
              leftSection={<IconDownload size={14} />}
              disabled={!calendars}
              onClick={async () => {
                const { exportCalendarXlsx } = await import('../../reports/calendarExcel');
                await exportCalendarXlsx(ordered, months, rows, yearLabel);
              }}
            >
              Excel
            </Button>
          )}
        </Group>
      </Group>

      {!calendars ? (
        <Text size="sm" c="dimmed">
          Loading…
        </Text>
      ) : !ordered.length ? (
        <Text size="sm" c="dimmed">
          No projects{q ? ' match' : ''}.
        </Text>
      ) : (
        <ScrollArea type="auto" offsetScrollbars>
          <table className={`edb-cal${compact ? ' edb-cal-compact' : ''}`}>
            <thead>
              <tr>
                <th className="cal-name">{projectId ? 'Schedule / report' : rows === 'projects' ? 'Project' : 'Project / schedule'}</th>
                {months.map((m) => (
                  <th key={m} className={m === nowMonth ? 'cal-now-head' : undefined}>
                    {monthName(m)}
                    {m.endsWith('-01') && startMonth !== 1 ? <div className="cal-year">{m.slice(0, 4)}</div> : null}
                  </th>
                ))}
                {!compact && <th className="cal-text">{rows === 'projects' ? 'Key' : 'Details'}</th>}
                {!compact && !projectId && <th className="cal-text">Notes</th>}
                {!compact && !projectId && <th className="cal-text">Reports due</th>}
                {!compact && !projectId && <th className="cal-text">Consents</th>}
                {!compact && !projectId && <th className="cal-small">Job / PO</th>}
                {!compact && !projectId && <th className="cal-small" aria-label="Folder" />}
              </tr>
            </thead>
            <tbody>
              {ordered.map((c) => (
                <Fragment key={c.project.id}>
                  {rows === 'projects' && !projectId ? (
                    <ProjectRow c={c} compact={compact} monthCells={monthCells} editable={editable} />
                  ) : (
                    <ItemRows c={c} compact={compact} showProject={!projectId} monthCells={monthCells} />
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </ScrollArea>
      )}
      <CalendarLegend />
    </Stack>
  );
}

type MonthCells = (entriesFor: (m: string) => CalendarEntry[], project: Project) => JSX.Element[];

function ProjectName({ project, to }: { project: Project; to: string }) {
  return (
    <div>
      <Anchor component={Link} to={to} size="sm" fw={600} c="inherit" className="cal-project">
        {project.name}
      </Anchor>
      {(project.client || project.status !== 'active') && (
        <Text size="xs" c="dimmed" lineClamp={1}>
          {[project.client, project.status !== 'active' ? 'archived' : ''].filter(Boolean).join(' · ')}
        </Text>
      )}
    </div>
  );
}

function ProjectRow({ c, compact, monthCells, editable }: { c: ProjectCalendar; compact: boolean; monthCells: MonthCells; editable: boolean }) {
  const p = c.project;
  const byMonth = new Map<string, CalendarEntry[]>();
  for (const e of c.entries) byMonth.set(e.month, [...(byMonth.get(e.month) ?? []), e]);
  return (
    <tr className={c.items.length ? undefined : 'cal-empty'}>
      <td className="cal-name">
        <ProjectName project={p} to={`/projects/${p.id}/schedule`} />
        {!c.items.length && (
          <Text size="xs" c="dimmed">
            No sampling schedules or reports yet
          </Text>
        )}
      </td>
      {monthCells((m) => byMonth.get(m) ?? [], p)}
      {!compact && (
        <td className="cal-text">
          <Text size="xs">{legend(c.items)}</Text>
        </td>
      )}
      {!compact && (
        <>
          <td className="cal-text">
            <NotesCell project={p} editable={editable} />
          </td>
          <td className="cal-text">
            {c.reportsDue.map((r) => (
              <Group key={`${r.label}${r.due}`} gap={4} wrap="nowrap">
                <Badge size="xs" circle color={STATE_DOT[r.state]} variant="filled" />
                <Text size="xs">
                  {r.label} – {formatDate(r.due)}
                </Text>
              </Group>
            ))}
          </td>
          <td className="cal-text">
            <Text size="xs">{p.consents}</Text>
          </td>
          <td className="cal-small">
            <Text size="xs">{p.code}</Text>
            {p.purchaseOrder && (
              <Text size="xs" c="dimmed">
                PO {p.purchaseOrder}
              </Text>
            )}
          </td>
          <td className="cal-small">
            <FolderCell folder={p.folder} />
          </td>
        </>
      )}
    </tr>
  );
}

function ItemRows({ c, compact, showProject, monthCells }: { c: ProjectCalendar; compact: boolean; showProject: boolean; monthCells: MonthCells }) {
  const p = c.project;
  // extra jobs share one row
  const items: Array<CalendarItem | 'extras'> = [...c.items.filter((i) => i.kind !== 'extra'), ...(c.items.some((i) => i.kind === 'extra') ? (['extras'] as const) : [])];
  const span = 13 + (compact ? 0 : showProject ? 6 : 1);
  return (
    <>
      {showProject && (
        <tr className="cal-group">
          <td colSpan={span}>
            <Group gap="xs">
              <ProjectName project={p} to={`/projects/${p.id}/schedule`} />
              {!compact && p.consents && (
                <Text size="xs" c="dimmed">
                  {p.consents}
                </Text>
              )}
              {!compact && <FolderCell folder={p.folder} />}
            </Group>
          </td>
        </tr>
      )}
      {!items.length && (
        <tr className="cal-empty">
          <td className="cal-name">
            <Text size="xs" c="dimmed">
              No sampling schedules or reports yet –{' '}
              <Anchor component={Link} to={`/projects/${p.id}/schedule`} size="xs">
                add them
              </Anchor>
            </Text>
          </td>
          {monthCells(() => [], p)}
        </tr>
      )}
      {items.map((it) => {
        const isExtra = it === 'extras';
        const entries = c.entries.filter((e) => (isExtra ? e.item.kind === 'extra' : e.item.key === it.key));
        const byMonth = new Map<string, CalendarEntry[]>();
        for (const e of entries) byMonth.set(e.month, [...(byMonth.get(e.month) ?? []), e]);
        return (
          <tr key={isExtra ? 'extras' : it.key}>
            <td className="cal-name cal-item">
              <Group gap={6} wrap="nowrap">
                <Text fw={700} w={18} ta="center" className="cal-symbol">
                  {isExtra ? '#' : it.symbol}
                </Text>
                <div>
                  <Text size="sm">{isExtra ? 'Extra jobs' : it.label}</Text>
                  {!isExtra && it.detail && (
                    <Text size="xs" c="dimmed" lineClamp={1}>
                      {it.detail}
                    </Text>
                  )}
                </div>
              </Group>
            </td>
            {monthCells((m) => byMonth.get(m) ?? [], p)}
            {!compact && (
              <td className="cal-text" colSpan={showProject ? 6 : 1}>
                <Text size="xs" c="dimmed">
                  {isExtra ? 'Jobs added to a month' : it.kind === 'report' ? it.detail ?? 'Report due' : it.detail}
                </Text>
              </td>
            )}
          </tr>
        );
      })}
    </>
  );
}

