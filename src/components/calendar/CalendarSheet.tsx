import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { ActionIcon, Anchor, Button, Checkbox, Divider, Group, Menu, Popover, Stack, Text, Textarea, TextInput, Tooltip, UnstyledButton } from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { Link, useNavigate } from 'react-router-dom';
import {
  IconArrowBackUp, IconArrowDown, IconArrowForwardUp, IconArrowUp, IconBracketsContain, IconChevronLeft, IconChevronRight, IconColumns3, IconCopy, IconDots, IconDownload,
  IconEraser, IconExternalLink, IconFolder, IconHighlight, IconLink, IconMessagePlus, IconPlayerPause, IconPlayerPlay, IconPlus, IconRowInsertBottom, IconRowInsertTop, IconSearch,
  IconTableImport, IconTrash, IconWand, IconProgressCheck,
} from '@tabler/icons-react';
import type { CalendarRow, CalendarStatus, CalendarTextField, MonthField, Project } from '../../db/types';
import { addCalendarRows, applyCalendarEdits, deleteCalendarRows, swapCalendarRows, type CalendarEdit } from '../../db/repo';
import { useCalendarSheet, type CalendarSheet as SheetData } from '../../hooks/useCalendarSheet';
import {
  CALENDAR_COLUMNS, CALENDAR_SYMBOLS, cellValue, markId, monthKey, monthText, OTHER_SYMBOLS, reportsToShow, rowMonths, STATUS_INFO, STATUSES, windowRange, windowsOf, type MonthWindow,
} from '../../lib/calendar';
import { cellEdit, fromTsv, noteEdit, sheetColumns, statusEdits, symbolEdits, toTsv, windowEdits, type SheetColumn } from '../../lib/calendarEdits';
import { formatDate, MONTH_SHORT, todayStr } from '../../lib/dates';
import { AddProjectRowsModal, FillFromProjectModal, LinkRowModal, projectRows } from './CalendarDialogs';
import { ImportCalendarModal } from './ImportCalendarModal';
import { RoundModal } from './RoundModal';
import { roundOf, roundOptions, roundText, STAGES, type Round, type RoundOptions } from '../../lib/rounds';
import { useSettings } from '../../hooks/useSettings';

// The monitoring calendar as a spreadsheet, laid out like the team's "Schedule All Monitoring" sheet: a row per job,
// the months with what's planned and coloured by how it went this year, the key and notes beside them. Click or drag
// to select cells, type to change them, colour them from the toolbar; rows for projects show what EnviroDB knows.

const PREFS_KEY = 'envirodb.calendar.sheet';
const HANDLE_W = 30;
const SYMBOLS = [...CALENDAR_SYMBOLS.slice(0, 5), ...OTHER_SYMBOLS];
const STATUS_KEYS: Array<CalendarStatus | undefined> = [undefined, 'done', 'doing', 'cancelled'];
const SHORT: Record<CalendarStatus, string> = { done: 'Done', doing: 'Doing', cancelled: 'Cancelled' };

function loadPrefs(): { hidden?: string[] } {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as { hidden?: string[] };
  } catch {
    return {};
  }
}
function savePrefs(p: { hidden?: string[] }) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...loadPrefs(), ...p }));
  } catch {
    /* a convenience only */
  }
}

type Pos = { r: number; c: number };
/** How editing a cell ends: the keys that move on, or leaving it for elsewhere on the page. */
type EditEnd = 'down' | 'right' | 'left' | 'stay' | 'cancel' | 'blur';
interface Sel {
  /** Where the selection started, and the cell it ends on (the one typed into). */
  a: Pos;
  f: Pos;
}
const rectOf = (s: Sel) => ({ r0: Math.min(s.a.r, s.f.r), r1: Math.max(s.a.r, s.f.r), c0: Math.min(s.a.c, s.f.c), c1: Math.max(s.a.c, s.f.c) });

const projectOf = (sheet: SheetData, row: CalendarRow) => (row.projectId ? sheet.projects.get(row.projectId) : undefined);

function rowSearchText(row: CalendarRow, project?: Project) {
  return [row.job, project?.name, project?.client, project?.code, row.jobCode, row.details, row.notes, row.other, row.consents, project?.consents].join(' ').toLowerCase();
}

function siteList(sheet: SheetData, ids: string[]) {
  return ids.map((id) => sheet.sites.get(id)?.code ?? '?').join(', ');
}

function resultsText(sheet: SheetData, row: CalendarRow, month: string): string | null {
  const r = sheet.facts.get(row.id)?.results.get(month);
  if (!r) return null;
  return `Results in EnviroDB: ${r.days.map((d) => formatDate(d)).join(', ')} (${siteList(sheet, r.sites)})`;
}

export interface CalendarSheetProps {
  /** Only this project's rows (its Schedule tab). */
  projectId?: string;
  /** For the dashboard: colouring months only, and the job, the months and the `columns` chosen. */
  compact?: boolean;
  /** The dashboard's choice of columns besides the job and months. */
  columns?: string[];
  /** Lets the dashboard's columns be chosen (the Columns button). */
  onColumnsChange?: (fields: string[]) => void;
}

export function CalendarSheet({ projectId, compact = false, columns, onColumnsChange }: CalendarSheetProps) {
  const today = todayStr();
  const thisYear = Number(today.slice(0, 4));
  const nowMonth = today.slice(0, 7);
  const navigate = useNavigate();
  const [year, setYear] = useState(thisYear);
  const sheet = useCalendarSheet(year, projectId);
  const [search, setSearch] = useState('');
  const [hidden, setHidden] = useState(() => new Set(loadPrefs().hidden ?? []));
  // on the dashboard, the columns it chose; otherwise all but those hidden here
  const shownCompact = useMemo(() => new Set(columns ?? []), [columns]);
  const hiddenNow = useMemo(() => (compact ? new Set(CALENDAR_COLUMNS.filter((c) => !shownCompact.has(c.field)).map((c) => c.field)) : hidden), [compact, shownCompact, hidden]);
  const cols = useMemo(() => sheetColumns(hiddenNow), [hiddenNow]);
  const columnShown = (field: string) => !hiddenNow.has(field);
  const showColumn = (field: string, on: boolean) => {
    setSel(null);
    if (compact) {
      const next = new Set(shownCompact);
      if (on) next.add(field);
      else next.delete(field);
      onColumnsChange?.(CALENDAR_COLUMNS.filter((c) => next.has(c.field)).map((c) => c.field));
      return;
    }
    const next = new Set(hidden);
    if (on) next.delete(field);
    else next.add(field);
    setHidden(next);
    savePrefs({ hidden: [...next] });
  };
  const q = search.trim().toLowerCase();
  const rows = useMemo(() => (sheet ? sheet.rows.filter((r) => !q || rowSearchText(r, projectOf(sheet, r)).includes(q)) : []), [sheet, q]);
  const [sel, setSel] = useState<Sel | null>(null);
  const [editing, setEditing] = useState<{ r: number; c: number; value: string } | null>(null);
  const [dialog, setDialog] = useState<null | { kind: 'link' | 'fill'; row: CalendarRow } | { kind: 'projects' | 'import' } | { kind: 'round'; row: CalendarRow; month: string }>(null);
  const settings = useSettings();
  const roundOpts = useMemo(() => roundOptions(settings, today), [settings.labTurnaroundDays, settings.sendResultsDays, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const undoStack = useRef<CalendarEdit[][]>([]);
  const redoStack = useRef<CalendarEdit[][]>([]);
  const [, setStacks] = useState(0);
  const firstMonth = cols.findIndex((c) => c.kind === 'month');

  // keep the selection on the sheet as rows come and go
  useEffect(() => {
    if (!sel) return;
    const max = rows.length - 1;
    if (max < 0) setSel(null);
    else if (sel.a.r > max || sel.f.r > max) setSel({ a: { r: Math.min(sel.a.r, max), c: sel.a.c }, f: { r: Math.min(sel.f.r, max), c: sel.f.c } });
  }, [rows.length, sel]);
  useEffect(() => {
    const up = () => (dragging.current = false);
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);

  const refocus = () => wrapRef.current?.focus({ preventScroll: true });

  const run = useCallback(async (edits: CalendarEdit[]) => {
    if (!edits.length) return;
    const undo = await applyCalendarEdits(edits);
    if (!undo.length) return;
    undoStack.current.push(undo);
    if (undoStack.current.length > 100) undoStack.current.shift();
    redoStack.current = [];
    setStacks((n) => n + 1);
  }, []);
  const undo = async () => {
    const e = undoStack.current.pop();
    if (!e) return;
    redoStack.current.push(await applyCalendarEdits(e));
    setStacks((n) => n + 1);
  };
  const redo = async () => {
    const e = redoStack.current.pop();
    if (!e) return;
    undoStack.current.push(await applyCalendarEdits(e));
    setStacks((n) => n + 1);
  };

  const cells = (s: Sel | null = sel) => {
    if (!s) return [];
    const { r0, r1, c0, c1 } = rectOf(s);
    const out: Array<{ row: CalendarRow; col: SheetColumn; r: number; c: number }> = [];
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (rows[r] && cols[c]) out.push({ row: rows[r], col: cols[c], r, c });
    return out;
  };
  const selMonths = cells().filter((x) => x.col.kind === 'month');
  const selText = cells().filter((x) => x.col.kind === 'text');
  const rect = sel ? rectOf(sel) : null;
  const monthSpan = rect ? [Math.max(rect.c0, firstMonth), Math.min(rect.c1, firstMonth + 11)] : null;
  const canWindow = !!monthSpan && monthSpan[1] > monthSpan[0];

  const commit = async (r: number, c: number, typed: string) => {
    const row = rows[r];
    const col = cols[c];
    if (!row || !col || !sheet) return;
    const project = projectOf(sheet, row);
    let value = typed;
    if (col.kind === 'month') {
      // a sampling window stays one: its brackets go back on what's typed in its first and last months
      const w = windowsOf(rowMonths(row))[col.month];
      const t = value.trim();
      if (w.start && !t.startsWith('(')) value = `(${t}`;
      if (w.end && !value.trim().endsWith(')')) value = `${value.trim()})`;
    }
    if (value === cellValue(row, col.key, project)) return;
    await run([cellEdit(row, col.key, value, project)]);
  };
  const startEdit = (initial?: string, at?: Pos) => {
    const p = at ?? sel?.f;
    if (!p || !sheet || compact) return;
    const row = rows[p.r];
    const col = cols[p.c];
    if (!row || !col) return;
    let value = initial ?? cellValue(row, col.key, projectOf(sheet, row));
    if (initial === undefined && col.kind === 'month') {
      const w = windowsOf(rowMonths(row))[col.month];
      if (w.start) value = value.replace(/^\s*\(/, '');
      if (w.end) value = value.replace(/\)\s*$/, '');
    }
    setEditing({ r: p.r, c: p.c, value });
  };
  const finishEdit = (how: EditEnd, next?: Pos) => {
    const e = editing;
    if (!e) return;
    setEditing(null);
    // on to the next cell straight away – what's typed next goes there – while the change is saved
    const d = how === 'down' ? [1, 0] : how === 'right' ? [0, 1] : how === 'left' ? [0, -1] : [0, 0];
    const p = next ?? { r: Math.min(rows.length - 1, Math.max(0, e.r + d[0])), c: Math.min(cols.length - 1, Math.max(0, e.c + d[1])) };
    if (!next) setSel({ a: p, f: p });
    if (how !== 'blur') refocus();
    if (how !== 'cancel') void commit(e.r, e.c, e.value);
  };

  // the sampling round of the month selected
  const openRound = () => {
    const p = sel?.f;
    const row = p ? rows[p.r] : undefined;
    const col = p ? cols[p.c] : undefined;
    if (row && col?.kind === 'month') setDialog({ kind: 'round', row, month: monthKey(year, col.key) });
  };

  const colour = (status: CalendarStatus | undefined) => {
    if (!sheet || !sel) return;
    void run(statusEdits(cells().map(({ row, col }) => ({ row, key: col.key })), status, year, sheet.marks));
    refocus();
  };
  const symbol = (sym: string) => {
    const el = document.querySelector<HTMLTextAreaElement>('.cal-editor');
    if (editing && el && cols[editing.c]?.kind === 'month') {
      el.setRangeText(sym, el.selectionStart, el.selectionEnd, 'end');
      setEditing({ ...editing, value: el.value });
      return;
    }
    void run(symbolEdits(selMonths.map(({ row, col }) => ({ row, key: col.key as MonthField })), sym));
    refocus();
  };
  const toggleWindow = () => {
    if (!rect || !canWindow || !monthSpan) return;
    void run(windowEdits(rows.slice(rect.r0, rect.r1 + 1), monthSpan[0] - firstMonth, monthSpan[1] - firstMonth));
    refocus();
  };
  const toggleHighlight = () => {
    const on = !selText.every(({ row, col }) => row.highlight?.includes(col.key as CalendarTextField));
    const byRow = new Map<CalendarRow, Set<CalendarTextField>>();
    for (const { row, col } of selText) byRow.set(row, (byRow.get(row) ?? new Set()).add(col.key as CalendarTextField));
    void run(
      [...byRow].map(([row, fields]) => {
        const next = new Set(row.highlight ?? []);
        fields.forEach((f) => (on ? next.add(f) : next.delete(f)));
        return { t: 'row', id: row.id, set: { highlight: next.size ? CALENDAR_COLUMNS.map((c) => c.field).filter((f) => next.has(f)) : undefined } };
      }),
    );
    refocus();
  };
  const clearCells = () => {
    if (!sheet) return;
    void run(cells().map(({ row, col }) => cellEdit(row, col.key, '', projectOf(sheet, row))));
  };

  const move = (dr: number, dc: number, extend: boolean) => {
    if (!sel) return;
    const f = { r: Math.min(rows.length - 1, Math.max(0, sel.f.r + dr)), c: Math.min(cols.length - 1, Math.max(0, sel.f.c + dc)) };
    setSel(extend ? { a: sel.a, f } : { a: f, f });
    requestAnimationFrame(() => wrapRef.current?.querySelector(`[data-cell="${f.r}:${f.c}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (editing || !sel || (e.target as HTMLElement) !== wrapRef.current) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && key === 'z') {
      e.preventDefault();
      void (e.shiftKey ? redo() : undo());
      return;
    }
    if (mod && key === 'y') {
      e.preventDefault();
      void redo();
      return;
    }
    if (e.altKey && /^Digit[0-3]$/.test(e.code)) {
      e.preventDefault();
      colour(STATUS_KEYS[Number(e.code.slice(5))]);
      return;
    }
    if (e.altKey && e.code === 'KeyR') {
      e.preventDefault();
      openRound();
      return;
    }
    switch (e.key) {
      case 'ArrowUp':
      case 'ArrowDown':
      case 'ArrowLeft':
      case 'ArrowRight': {
        e.preventDefault();
        const [dr, dc] = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
        move(dr, dc, e.shiftKey);
        return;
      }
      case 'Tab':
        e.preventDefault();
        move(0, e.shiftKey ? -1 : 1, false);
        return;
      case 'Enter':
      case 'F2':
        e.preventDefault();
        startEdit();
        return;
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        if (!compact) clearCells();
        return;
      case 'Escape':
        setSel(null);
        return;
    }
    if (e.key.length === 1 && !mod && !e.altKey) {
      e.preventDefault();
      startEdit(e.key);
    }
  };

  const onCopy = (e: ClipboardEvent<HTMLDivElement>) => {
    if (editing || !sel || !sheet) return;
    const { r0, r1, c0, c1 } = rectOf(sel);
    const grid: string[][] = [];
    for (let r = r0; r <= r1; r++) {
      const row = rows[r];
      grid.push(cols.slice(c0, c1 + 1).map((col) => cellValue(row, col.key, projectOf(sheet, row))));
    }
    e.clipboardData.setData('text/plain', toTsv(grid));
    e.preventDefault();
  };
  const onCut = (e: ClipboardEvent<HTMLDivElement>) => {
    if (editing || !sel || compact) return;
    onCopy(e);
    clearCells();
  };
  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    if (editing || !sel || !sheet || compact) return;
    const grid = fromTsv(e.clipboardData.getData('text/plain'));
    e.preventDefault();
    const { r0, r1, c0, c1 } = rectOf(sel);
    const one = grid.length === 1 && grid[0].length === 1;
    const edits: CalendarEdit[] = [];
    const rN = one ? r1 - r0 + 1 : grid.length;
    const cN = one ? c1 - c0 + 1 : Math.max(...grid.map((g) => g.length));
    for (let i = 0; i < rN; i++) {
      for (let j = 0; j < cN; j++) {
        const row = rows[r0 + i];
        const col = cols[c0 + j];
        const v = one ? grid[0][0] : grid[i]?.[j];
        if (!row || !col || v === undefined) continue;
        edits.push(cellEdit(row, col.key, v, projectOf(sheet, row)));
      }
    }
    void run(edits);
    setSel({ a: { r: r0, c: c0 }, f: { r: Math.min(rows.length - 1, r0 + rN - 1), c: Math.min(cols.length - 1, c0 + cN - 1) } });
  };

  const onCellDown = (e: MouseEvent, r: number, c: number) => {
    if (e.button !== 0) return;
    e.preventDefault();
    if (editing) finishEdit('stay', { r, c });
    refocus();
    if (e.shiftKey && sel) {
      setSel({ a: sel.a, f: { r, c } });
      return;
    }
    dragging.current = true;
    const col = cols[c];
    if (col.kind === 'month') {
      // a sampling window is picked as one, like the merged cells it is in the spreadsheet
      const [a, b] = windowRange(windowsOf(rowMonths(rows[r])), col.month);
      if (b > a) {
        setSel({ a: { r, c: c - col.month + b }, f: { r, c: c - col.month + a } });
        return;
      }
    }
    setSel({ a: { r, c }, f: { r, c } });
  };
  const onCellEnter = (r: number, c: number) => {
    if (dragging.current && sel) setSel({ a: sel.a, f: { r, c } });
  };

  // a new row: selected, with its job being typed in
  const [pending, setPending] = useState<string | null>(null);
  const addRow = async (at: { after?: string; before?: string }, patch: Partial<CalendarRow> = {}, edit = true) => {
    const [made] = await addCalendarRows([{ projectId, ...patch }], at);
    if (edit) setPending(made.id);
    return made;
  };
  useEffect(() => {
    if (!pending) return;
    const r = rows.findIndex((x) => x.id === pending);
    if (r < 0) return;
    setPending(null);
    setSel({ a: { r, c: 0 }, f: { r, c: 0 } });
    if (!rows[r].job && !rows[r].projectId) setEditing({ r, c: 0, value: '' });
    requestAnimationFrame(() => wrapRef.current?.querySelector(`[data-cell="${r}:0"]`)?.scrollIntoView({ block: 'nearest' }));
  }, [pending, rows]);
  const rowActions = (row: CalendarRow, r: number) => {
    const project = sheet ? projectOf(sheet, row) : undefined;
    return (
      <Menu.Dropdown>
        {project && (
          <Menu.Item leftSection={<IconExternalLink size={14} />} onClick={() => navigate(`/projects/${project.id}/schedule`)}>
            Open {project.name}
          </Menu.Item>
        )}
        <Menu.Item leftSection={<IconLink size={14} />} onClick={() => setDialog({ kind: 'link', row })}>
          {project ? 'Project and sites…' : 'Link to a project…'}
        </Menu.Item>
        {project && (
          <Menu.Item leftSection={<IconWand size={14} />} onClick={() => setDialog({ kind: 'fill', row })}>
            Fill in from the project’s schedules…
          </Menu.Item>
        )}
        <Menu.Divider />
        <Menu.Item leftSection={<IconRowInsertTop size={14} />} onClick={() => void addRow({ before: row.id })}>
          Insert a row above
        </Menu.Item>
        <Menu.Item leftSection={<IconRowInsertBottom size={14} />} onClick={() => void addRow({ after: row.id })}>
          Insert a row below
        </Menu.Item>
        <Menu.Item
          leftSection={<IconCopy size={14} />}
          onClick={() => {
            const { id: _id, order: _o, updatedAt: _u, ...copy } = row;
            void addRow({ after: row.id }, copy);
          }}
        >
          Duplicate
        </Menu.Item>
        <Menu.Item leftSection={<IconArrowUp size={14} />} disabled={r === 0} onClick={() => void swapCalendarRows(row.id, rows[r - 1].id)}>
          Move up
        </Menu.Item>
        <Menu.Item leftSection={<IconArrowDown size={14} />} disabled={r === rows.length - 1} onClick={() => void swapCalendarRows(row.id, rows[r + 1].id)}>
          Move down
        </Menu.Item>
        <Menu.Item leftSection={row.onHold ? <IconPlayerPlay size={14} /> : <IconPlayerPause size={14} />} onClick={() => void run([{ t: 'row', id: row.id, set: { onHold: row.onHold ? undefined : true } }])}>
          {row.onHold ? 'Take off hold' : 'Put on hold (shade the row pink)'}
        </Menu.Item>
        <Menu.Divider />
        <Menu.Item
          color="red"
          leftSection={<IconTrash size={14} />}
          onClick={() =>
            modals.openConfirmModal({
              title: 'Delete this row?',
              children: <Text size="sm">“{cellValue(row, 'job', project) || 'This row'}” and its colours and notes for every year come off the calendar. {project ? 'The project itself stays.' : ''}</Text>,
              labels: { confirm: 'Delete', cancel: 'Cancel' },
              confirmProps: { color: 'red' },
              onConfirm: () => void deleteCalendarRows([row.id]),
            })
          }
        >
          Delete row
        </Menu.Item>
      </Menu.Dropdown>
    );
  };
  if (!sheet)
    return (
      <Text size="sm" c="dimmed">
        Loading…
      </Text>
    );

  const focus = sel?.f;
  const focusRow = focus ? rows[focus.r] : undefined;
  const focusCol = focus ? cols[focus.c] : undefined;
  const totalWidth = (compact ? 0 : HANDLE_W) + cols.reduce((s, c) => s + c.width, 0);
  const leadCols = cols.slice(0, firstMonth);
  const tailCols = cols.slice(firstMonth + 12);

  return (
    <Stack gap={6} className={`cal-sheet-box${compact ? ' cal-compact' : ''}`}>
      <Group gap={6} wrap="wrap" className="cal-toolbar">
        <Group gap={2} wrap="nowrap">
          <ActionIcon variant="default" size="md" onClick={() => setYear((y) => y - 1)} aria-label="Previous year">
            <IconChevronLeft size={16} />
          </ActionIcon>
          <Text fw={700} w={52} ta="center">
            {year}
          </Text>
          <ActionIcon variant="default" size="md" onClick={() => setYear((y) => y + 1)} aria-label="Next year">
            <IconChevronRight size={16} />
          </ActionIcon>
          {year !== thisYear && (
            <Button size="compact-sm" variant="subtle" onClick={() => setYear(thisYear)}>
              This year
            </Button>
          )}
        </Group>
        <Divider orientation="vertical" />
        {STATUSES.map((s, i) => (
          <Tooltip key={s} label={`${STATUS_INFO[s].label}: ${STATUS_INFO[s].hint.charAt(0).toLowerCase()}${STATUS_INFO[s].hint.slice(1)} (Alt+${i + 1}). Again to clear.`} multiline maw={300}>
            <Button size="compact-sm" variant="default" leftSection={<span className={`cal-swatch st-${s}`} />} onMouseDown={(e) => e.preventDefault()} onClick={() => colour(s)} disabled={!sel}>
              {SHORT[s]}
            </Button>
          </Tooltip>
        ))}
        <Tooltip label="Clear the colour (Alt+0)">
          <ActionIcon variant="default" size="md" onMouseDown={(e) => e.preventDefault()} onClick={() => colour(undefined)} disabled={!sel} aria-label="Clear the colour">
            <IconEraser size={16} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label="The sampling round of the month selected: sampled, sent to the lab, results back, results sent (Alt+R)" multiline maw={280}>
          <Button size="compact-sm" variant="default" leftSection={<IconProgressCheck size={14} />} onMouseDown={(e) => e.preventDefault()} onClick={openRound} disabled={focusCol?.kind !== 'month'}>
            Round
          </Button>
        </Tooltip>
        {!compact && (
          <>
            <Divider orientation="vertical" />
            <Group gap={1} wrap="nowrap" className="cal-symbols">
              {SYMBOLS.map((s) => (
                <Tooltip key={s} label={`${s} – add to (or take out of) the months selected`} openDelay={500}>
                  <UnstyledButton className="cal-sym" onMouseDown={(e) => e.preventDefault()} onClick={() => symbol(s)} disabled={!selMonths.length && !editing} aria-label={`Mark ${s}`}>
                    {s}
                  </UnstyledButton>
                </Tooltip>
              ))}
            </Group>
            <Tooltip label="Make the months selected a sampling window – the round can be done any time in them (again to undo)" multiline maw={280}>
              <Button size="compact-sm" variant="default" leftSection={<IconBracketsContain size={14} />} onMouseDown={(e) => e.preventDefault()} onClick={toggleWindow} disabled={!canWindow}>
                Window
              </Button>
            </Tooltip>
            <Tooltip label="Highlight (yellow) – for something to stand out, every year">
              <ActionIcon variant="default" size="md" onMouseDown={(e) => e.preventDefault()} onClick={toggleHighlight} disabled={!selText.length} aria-label="Highlight">
                <IconHighlight size={16} />
              </ActionIcon>
            </Tooltip>
            <NoteButton sheet={sheet} row={focusRow} col={focusCol} year={year} run={run} onDone={refocus} />
            <Divider orientation="vertical" />
            <Tooltip label="Undo (Ctrl+Z)">
              <ActionIcon variant="default" size="md" onClick={() => void undo()} disabled={!undoStack.current.length} aria-label="Undo">
                <IconArrowBackUp size={16} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Redo (Ctrl+Y)">
              <ActionIcon variant="default" size="md" onClick={() => void redo()} disabled={!redoStack.current.length} aria-label="Redo">
                <IconArrowForwardUp size={16} />
              </ActionIcon>
            </Tooltip>
          </>
        )}
        <div style={{ flex: 1 }} />
        {!compact && !projectId && (
          <TextInput size="xs" leftSection={<IconSearch size={14} />} placeholder="Find a job" value={search} onChange={(e) => setSearch(e.currentTarget.value)} w={170} />
        )}
        {(!compact || onColumnsChange) && (
          <Menu position="bottom-end" closeOnItemClick={false}>
            <Menu.Target>
              <Tooltip label={compact ? 'Columns to show here, besides the job and months' : 'Columns to show'}>
                {compact ? (
                  <Button size="compact-sm" variant="default" leftSection={<IconColumns3 size={14} />} aria-label="Columns to show">
                    Columns{shownCompact.size ? ` (${shownCompact.size})` : ''}
                  </Button>
                ) : (
                  <ActionIcon variant="default" size="md" aria-label="Columns to show">
                    <IconColumns3 size={16} />
                  </ActionIcon>
                )}
              </Tooltip>
            </Menu.Target>
            <Menu.Dropdown>
              {compact && <Menu.Label>Besides the job and months</Menu.Label>}
              {CALENDAR_COLUMNS.filter((c) => c.field !== 'job').map((c) => (
                <Menu.Item key={c.field}>
                  <Checkbox size="xs" label={c.label} checked={columnShown(c.field)} onChange={(e) => showColumn(c.field, e.currentTarget.checked)} />
                </Menu.Item>
              ))}
            </Menu.Dropdown>
          </Menu>
        )}
        {!compact && !projectId && (
          <>
            <Button size="compact-sm" variant="default" leftSection={<IconPlus size={14} />} onClick={() => setDialog({ kind: 'projects' })}>
              Rows for projects
            </Button>
            <Button size="compact-sm" variant="default" leftSection={<IconTableImport size={14} />} onClick={() => setDialog({ kind: 'import' })}>
              Import
            </Button>
          </>
        )}
        {!compact && (
          <Button
            size="compact-sm"
            variant="default"
            leftSection={<IconDownload size={14} />}
            disabled={!rows.length}
            onClick={async () => {
              const { downloadCalendarXlsx } = await import('../../reports/calendarExcel');
              await downloadCalendarXlsx(sheet, rows, year);
            }}
          >
            Excel
          </Button>
        )}
      </Group>

      <div
        ref={wrapRef}
        className="cal-scroll"
        tabIndex={0}
        onKeyDown={onKeyDown}
        onCopy={onCopy}
        onCut={onCut}
        onPaste={onPaste}
        style={{ scrollPaddingLeft: (compact ? 0 : HANDLE_W) + (cols[0]?.width ?? 0) }}
        aria-label={`Monitoring calendar ${year}`}
      >
        <table className="cal-sheet" style={{ width: totalWidth }}>
          <colgroup>
            {!compact && <col style={{ width: HANDLE_W }} />}
            {cols.map((c) => (
              <col key={c.key} style={{ width: c.width }} />
            ))}
          </colgroup>
          <thead>
            <tr className="cal-h1">
              {!compact && <th rowSpan={2} className="cal-handle-h" />}
              {leadCols.map((c) => (
                <th key={c.key} rowSpan={2} className={c.key === 'job' ? 'cal-job-h' : undefined}>
                  {c.label}
                </th>
              ))}
              <th colSpan={12} className="cal-months-h">
                Monitoring schedule {year}
              </th>
              {tailCols.map((c) => (
                <th key={c.key} rowSpan={2}>
                  {c.label}
                </th>
              ))}
            </tr>
            <tr className="cal-h2">
              {MONTH_SHORT.map((m, i) => (
                <th key={m} className={`${year}-${String(i + 1).padStart(2, '0')}` === nowMonth ? 'cal-now' : undefined}>
                  {m}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <SheetRow
                key={row.id}
                row={row}
                r={r}
                sheet={sheet}
                cols={cols}
                year={year}
                compact={compact}
                rect={rect && r >= rect.r0 && r <= rect.r1 ? rect : null}
                focusC={focus?.r === r ? focus.c : -1}
                editing={editing?.r === r ? editing : null}
                onEditChange={(value) => setEditing((e) => (e ? { ...e, value } : e))}
                onEditDone={(how) => finishEdit(how)}
                onCellDown={onCellDown}
                onCellEnter={onCellEnter}
                onCellDouble={(c) => startEdit(undefined, rect && r >= rect.r0 && r <= rect.r1 && c >= rect.c0 && c <= rect.c1 ? sel!.f : { r, c })}
                menu={compact ? null : rowActions(row, r)}
                roundOpts={roundOpts}
              />
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={cols.length + (compact ? 0 : 1)} className="cal-empty">
                  {q ? 'No jobs match.' : projectId ? 'This project isn’t on the monitoring calendar yet.' : 'Nothing on the calendar yet – import your monitoring spreadsheet, add rows for your projects, or add a job.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {!compact && (
        <Group gap="xs">
          <Button
            size="compact-sm"
            variant="subtle"
            leftSection={<IconPlus size={14} />}
            onClick={async () => {
              if (projectId) {
                const [made] = await projectRows([projectId], year);
                if (made) setPending(made.id);
                return;
              }
              setSearch('');
              await addRow({});
            }}
          >
            {projectId ? 'Add a row for this project (filled in from its schedules)' : 'Add a job'}
          </Button>
        </Group>
      )}

      <InfoBar sheet={sheet} row={focusRow} col={focusCol} year={year} compact={compact} roundOpts={roundOpts} />
      {!compact && <CalendarLegend />}

      {dialog?.kind === 'link' && <LinkRowModal row={dialog.row} year={year} onClose={() => setDialog(null)} run={run} />}
      {dialog?.kind === 'fill' && <FillFromProjectModal row={dialog.row} year={year} onClose={() => setDialog(null)} run={run} />}
      {dialog?.kind === 'projects' && <AddProjectRowsModal year={year} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'import' && <ImportCalendarModal onClose={() => setDialog(null)} />}
      {dialog?.kind === 'round' && (
        <RoundModal
          sheet={sheet}
          row={rows.find((r) => r.id === dialog.row.id) ?? dialog.row}
          month={dialog.month}
          opts={roundOpts}
          run={run}
          onClose={() => {
            setDialog(null);
            refocus();
          }}
        />
      )}
    </Stack>
  );
}

// ------------------------------------------------------------ a row

interface SheetRowProps {
  row: CalendarRow;
  r: number;
  sheet: SheetData;
  cols: SheetColumn[];
  year: number;
  compact: boolean;
  rect: { r0: number; r1: number; c0: number; c1: number } | null;
  focusC: number;
  editing: { c: number; value: string } | null;
  onEditChange: (value: string) => void;
  onEditDone: (how: EditEnd) => void;
  onCellDown: (e: MouseEvent, r: number, c: number) => void;
  onCellEnter: (r: number, c: number) => void;
  onCellDouble: (c: number) => void;
  menu: ReactNode;
  roundOpts: RoundOptions;
}

function SheetRow({ row, r, sheet, cols, year, compact, rect, focusC, editing, onEditChange, onEditDone, onCellDown, onCellEnter, onCellDouble, menu, roundOpts }: SheetRowProps) {
  const project = projectOf(sheet, row);
  const texts = rowMonths(row);
  const windows = windowsOf(texts);
  const facts = sheet.facts.get(row.id);
  return (
    <tr className={row.onHold ? 'cal-hold' : undefined}>
      {!compact && (
        <td className="cal-handle">
          <Menu position="bottom-start" withinPortal>
            <Menu.Target>
              <UnstyledButton className="cal-handle-btn" aria-label={`Row ${r + 1} actions`} title="Row actions">
                <span>{r + 1}</span>
                <IconDots size={12} />
              </UnstyledButton>
            </Menu.Target>
            {menu}
          </Menu>
        </td>
      )}
      {cols.map((col, c) => {
        const selected = !!rect && c >= rect.c0 && c <= rect.c1;
        const cls: string[] = [];
        if (selected) cls.push('sel');
        if (focusC === c) cls.push('focus');
        const props = {
          'data-cell': `${r}:${c}`,
          onMouseDown: (e: MouseEvent) => onCellDown(e, r, c),
          onMouseEnter: () => onCellEnter(r, c),
          onDoubleClick: () => onCellDouble(c),
        };
        const editor = editing?.c === c ? <CellEditor value={editing.value} month={col.kind === 'month'} onChange={onEditChange} onDone={onEditDone} /> : null;
        if (col.kind === 'month') {
          const month = monthKey(year, col.key);
          const mark = sheet.marks.get(markId(row.id, month));
          const w = windows[col.month];
          const round = roundOf(sheet, row, month, roundOpts);
          return (
            <MonthCell
              key={col.key}
              cls={cls}
              text={row[col.key] ?? ''}
              window={w}
              windows={windows}
              texts={texts}
              index={col.month}
              status={mark?.status}
              note={mark?.note}
              results={facts ? resultsText(sheet, row, month) : null}
              round={round && (round.started || round.overdue) ? round : null}
              first={round?.month === month}
              props={props}
              editor={editor}
            />
          );
        }
        const field = col.key;
        const status = sheet.marks.get(markId(row.id, String(year), field))?.status;
        if (status) cls.push(`st-${status}`);
        else if (row.highlight?.includes(field)) cls.push('hl');
        cls.push(`cal-t-${field}`);
        if (field === 'job') cls.push('cal-job');
        if (project && (col.col.project || field === 'job')) cls.push('cal-linked');
        const value = cellValue(row, field, project);
        return (
          <td key={col.key} className={cls.join(' ')} {...props} title={project && col.col.project ? `From the project ${project.name} – changing it here changes the project’s` : value.length > 90 ? value : undefined}>
            <div className="cal-text">{field === 'folder' ? <FolderValue value={value} /> : value}</div>
            {field === 'job' && project && (
              <Anchor component={Link} to={`/projects/${project.id}/schedule`} className="cal-open" onMouseDown={(e) => e.stopPropagation()} aria-label={`Open ${project.name}`} title={`Open ${project.name}`}>
                <IconExternalLink size={12} />
              </Anchor>
            )}
            {field === 'reportDue' && facts?.reports.length ? <ReportFacts reports={facts.reports} project={project!} /> : null}
            {editor}
          </td>
        );
      })}
    </tr>
  );
}

function MonthCell({
  cls, text, window: w, windows, texts, index, status, note, results, round, first, props, editor,
}: {
  cls: string[];
  text: string;
  window: MonthWindow;
  windows: MonthWindow[];
  texts: string[];
  index: number;
  status?: CalendarStatus;
  note?: string;
  results: string | null;
  /** The month's sampling round, when something's recorded or overdue; `first`: the month it's kept on. */
  round: Round | null;
  first: boolean;
  props: Record<string, unknown>;
  editor: ReactNode;
}) {
  const shown = monthText(text);
  const c = ['cal-m', ...cls];
  if (status) c.push(`st-${status}`);
  if (w.inWindow) c.push('cal-in-win');
  if (w.inWindow && !w.end && index < 11 && windows[index + 1].inWindow && !windows[index + 1].start) c.push('cal-win-joined');
  // the label of a window spans it, unless its other months have marks of their own
  const span = w.start && w.span > 1 && texts.slice(index + 1, index + w.span).every((t) => !monthText(t)) ? w.span : 1;
  const progress = round && first ? roundText(round) : '';
  const title = [STATUS_INFO[status!]?.label, progress, round?.overdue?.text ?? (round && first ? round.next?.text : undefined), note, results].filter(Boolean).join('\n');
  if (round?.overdue && !round.cancelled) c.push('cal-od');
  return (
    <td className={c.join(' ')} {...props} title={title || undefined}>
      {w.inWindow && <span className={`cal-win${w.start ? ' s' : ''}${w.end ? ' e' : ''}`} />}
      {shown && (
        <span className={`cal-mt${span > 1 ? ' cal-mt-span' : ''}${/[a-z]{2}/i.test(shown) ? ' cal-mt-words' : ''}`} style={span > 1 ? { width: `calc(${span * 100}% + ${span - 1}px)` } : undefined}>
          {shown}
        </span>
      )}
      {round && first && round.tracked && !round.cancelled ? (
        <span className="cal-stages" aria-hidden>
          {STAGES.map((s) => (
            <i key={s.key} className={round.stages[s.key].done ? 'on' : undefined} />
          ))}
        </span>
      ) : (
        results && <span className="cal-dot" />
      )}
      {note && <span className="cal-flag" />}
      {editor}
    </td>
  );
}

function CellEditor({ value, month, onChange, onDone }: { value: string; month: boolean; onChange: (v: string) => void; onDone: (how: EditEnd) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const finished = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(el.scrollHeight, el.parentElement?.clientHeight ?? 0)}px`;
  }, [value]);
  const done = (how: EditEnd) => {
    if (finished.current) return;
    finished.current = true;
    onDone(how);
  };
  return (
    <textarea
      ref={ref}
      className={`cal-editor${month ? ' cal-editor-month' : ''}`}
      value={value}
      rows={1}
      onChange={(e) => onChange(e.currentTarget.value)}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={() => done('blur')}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && e.altKey) {
          // a new line where the caret is, as in Excel
          e.preventDefault();
          const el = e.currentTarget;
          el.setRangeText('\n', el.selectionStart, el.selectionEnd, 'end');
          onChange(el.value);
        } else if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          done('down');
        } else if (e.key === 'Tab') {
          e.preventDefault();
          done(e.shiftKey ? 'left' : 'right');
        } else if (e.key === 'Escape') {
          e.preventDefault();
          done('cancel');
        }
      }}
    />
  );
}

function FolderValue({ value }: { value: string }) {
  if (!value) return null;
  const link = /^https?:\/\//i.test(value);
  return (
    <Group gap={4} wrap="nowrap" className="cal-folder">
      {link ? (
        <ActionIcon component="a" href={value} target="_blank" rel="noreferrer" variant="subtle" size="sm" aria-label="Open the folder" onMouseDown={(e) => e.stopPropagation()}>
          <IconExternalLink size={14} />
        </ActionIcon>
      ) : (
        <ActionIcon
          variant="subtle"
          size="sm"
          aria-label="Copy the folder path"
          title="Copy the path, then paste it into File Explorer"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={async (e) => {
            e.stopPropagation();
            await navigator.clipboard.writeText(value);
            notifications.show({ message: 'Folder path copied – paste it into File Explorer' });
          }}
        >
          <IconFolder size={14} />
        </ActionIcon>
      )}
      <span className="cal-folder-path">{value}</span>
    </Group>
  );
}

function ReportFacts({ reports, project }: { reports: NonNullable<ReturnType<SheetData['facts']['get']>>['reports']; project: Project }) {
  const today = todayStr();
  const shown = reportsToShow(reports);
  return (
    <div className="cal-facts" onMouseDown={(e) => e.stopPropagation()}>
      {shown.map((x) => (
        <Anchor key={`${x.obligationId}|${x.index}`} component={Link} to={`/projects/${project.id}/reports?obligation=${x.obligationId}&period=${x.index}`} size="xs" c={x.submitted ? 'teal' : x.due < today ? 'red' : 'dimmed'} display="block">
          {x.name}: {formatDate(x.due)}
          {x.submitted ? ` · sent ${formatDate(x.submitted)}` : x.due < today ? ' · overdue' : ''}
        </Anchor>
      ))}
    </div>
  );
}

function NoteButton({ sheet, row, col, year, run, onDone }: { sheet: SheetData; row?: CalendarRow; col?: SheetColumn; year: number; run: (e: CalendarEdit[]) => Promise<void>; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const month = row && col?.kind === 'month' ? monthKey(year, col.key) : null;
  const current = row && month ? sheet.marks.get(markId(row.id, month))?.note ?? '' : '';
  return (
    <Popover
      opened={open}
      onChange={setOpen}
      width={300}
      position="bottom"
      withArrow
      shadow="md"
      trapFocus
      onOpen={() => setText(current)}
    >
      <Popover.Target>
        <Tooltip label={month ? `A note for ${MONTH_SHORT[Number(month.slice(5, 7)) - 1]} ${year}` : 'A note for a month – select one first'}>
          <ActionIcon variant="default" size="md" onClick={() => setOpen((o) => !o)} disabled={!month} aria-label="Note for the month">
            <IconMessagePlus size={16} />
          </ActionIcon>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="xs">
          <Textarea
            label={month ? `${cellValue(row!, 'job', projectOf(sheet, row!))} – ${MONTH_SHORT[Number(month.slice(5, 7)) - 1]} ${year}` : ''}
            placeholder="e.g. results to the client by the 20th"
            autosize
            minRows={2}
            value={text}
            onChange={(e) => setText(e.currentTarget.value)}
            data-autofocus
          />
          <Group justify="flex-end" gap="xs">
            {current && (
              <Button
                size="xs"
                variant="subtle"
                color="red"
                onClick={async () => {
                  await run([noteEdit(row!, month!, '', sheet.marks)]);
                  setOpen(false);
                  onDone();
                }}
              >
                Remove
              </Button>
            )}
            <Button
              size="xs"
              onClick={async () => {
                await run([noteEdit(row!, month!, text, sheet.marks)]);
                setOpen(false);
                onDone();
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

function InfoBar({ sheet, row, col, year, compact, roundOpts }: { sheet: SheetData; row?: CalendarRow; col?: SheetColumn; year: number; compact: boolean; roundOpts: RoundOptions }) {
  if (!row || !col)
    return compact ? null : (
      <Text size="xs" c="dimmed">
        Click a cell to select it (drag or Shift-click for more), type to change it, Enter to edit what’s there – Alt+Enter for a new line. Colour months from the toolbar once they’re done.
      </Text>
    );
  const project = projectOf(sheet, row);
  const parts: string[] = [cellValue(row, 'job', project) || 'Untitled job'];
  if (col.kind === 'month') {
    const month = monthKey(year, col.key);
    const mark = sheet.marks.get(markId(row.id, month));
    parts.push(`${MONTH_SHORT[col.month]} ${year}${row[col.key] ? `: ${row[col.key]}` : ''}`);
    if (mark?.status) parts.push(STATUS_INFO[mark.status].label);
    const round = roundOf(sheet, row, month, roundOpts);
    if (round) {
      const progress = roundText(round);
      if (progress) parts.push(progress);
      if (round.overdue && !round.cancelled) parts.push(`⚠ ${round.overdue.text}`);
      else if (round.next && !round.cancelled) parts.push(round.next.text);
    }
    if (mark?.note) parts.push(`Note: ${mark.note}`);
    const res = resultsText(sheet, row, month);
    if (res) parts.push(res);
    else if (project) parts.push('No results in EnviroDB this month');
    if (!compact) parts.push('Alt+R or Round: record the round');
  } else {
    const value = cellValue(row, col.key, project);
    parts.push(value ? `${col.label}: ${value.replace(/\s*\n\s*/g, ' / ')}` : col.label);
    if (project && (col.col.project || col.key === 'job')) parts.push(`from the project ${project.name}`);
  }
  return (
    <Text size="xs" c="dimmed" className="cal-info" lineClamp={2}>
      {parts.join(' · ')}
    </Text>
  );
}

export function CalendarLegend() {
  return (
    <Group gap="md" className="cal-legend" wrap="wrap">
      {STATUSES.map((s) => (
        <Group key={s} gap={6} wrap="nowrap">
          <span className={`cal-swatch st-${s}`} />
          <Text size="xs">
            <b>{STATUS_INFO[s].label}</b> – {STATUS_INFO[s].hint.charAt(0).toLowerCase()}
            {STATUS_INFO[s].hint.slice(1)}
          </Text>
        </Group>
      ))}
      <Group gap={6} wrap="nowrap">
        <span className="cal-swatch" />
        <Text size="xs">
          <b>To do</b>
        </Text>
      </Group>
      <Text size="xs" c="dimmed">
        <span className="cal-dot cal-dot-inline" /> results in EnviroDB that month · <span className="cal-stages-key"><i /><i /><i /><i /></span> round: sampled, lab, results back, sent · <span className="cal-od-key" /> overdue · <span className="cal-win-key" /> sampling window · <span className="cal-flag-key" /> note
      </Text>
    </Group>
  );
}

