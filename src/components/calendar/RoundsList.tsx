// The sampling rounds under way or overdue across the calendar: what each needs next, most pressing first.

import { useMemo, useState } from 'react';
import { Anchor, Badge, Button, Card, Group, Stack, Text, Tooltip } from '@mantine/core';
import { IconAlertTriangle, IconProgressCheck } from '@tabler/icons-react';
import { Link } from 'react-router-dom';
import { applyCalendarEdits, type CalendarEdit } from '../../db/repo';
import { useCalendarSheet } from '../../hooks/useCalendarSheet';
import { useSettings } from '../../hooks/useSettings';
import { cellValue, monthName } from '../../lib/calendar';
import { addMonths, todayStr } from '../../lib/dates';
import { openRounds, roundOptions, roundText, STAGES, type Round } from '../../lib/rounds';
import { RoundModal } from './RoundModal';

const SHOWN = 8;

export function RoundsList({ projectId }: { projectId?: string }) {
  const today = todayStr();
  const year = Number(today.slice(0, 4));
  const sheet = useCalendarSheet(year, projectId);
  const settings = useSettings();
  const opts = useMemo(() => roundOptions(settings, today), [settings.labTurnaroundDays, settings.sendResultsDays, today]); // eslint-disable-line react-hooks/exhaustive-deps
  // the last six months (results are known from November of last year)
  const since = [addMonths(`${today.slice(0, 7)}-01`, -6).slice(0, 7), `${year - 1}-11`].sort()[1];
  const rounds = useMemo(() => (sheet ? openRounds(sheet, opts, since) : []), [sheet, opts, since]);
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<Round | null>(null);
  if (!sheet || !rounds.length) return null;
  const overdue = rounds.filter((r) => r.overdue).length;
  const shown = all ? rounds : rounds.slice(0, SHOWN);
  const run = async (edits: CalendarEdit[]) => {
    await applyCalendarEdits(edits);
  };
  return (
    <Card withBorder p="sm">
      <Group gap="xs" mb={6}>
        <IconProgressCheck size={18} />
        <Text fw={600} size="sm">
          Sampling rounds in progress
        </Text>
        <Badge variant="light" color="gray">
          {rounds.length}
        </Badge>
        {overdue > 0 && (
          <Badge variant="light" color="red" leftSection={<IconAlertTriangle size={12} />}>
            {overdue} overdue
          </Badge>
        )}
      </Group>
      <Stack gap={4}>
        {shown.map((r) => {
          const row = sheet.rows.find((x) => x.id === r.rowId)!;
          const project = row.projectId ? sheet.projects.get(row.projectId) : undefined;
          const job = cellValue(row, 'job', project) || 'Untitled job';
          const when = r.months.length > 1 ? `${monthName(r.months[0])} – ${monthName(r.months[r.months.length - 1])}` : `${monthName(r.month)} ${r.month.slice(0, 4)}`;
          const progress = roundText(r);
          return (
            <Group key={`${r.rowId}|${r.month}`} gap="sm" wrap="nowrap" className="round-row">
              <Tooltip label={STAGES.map((s) => `${r.stages[s.key].done ? '✓' : '–'} ${s.label}`).join('\n')} multiline style={{ whiteSpace: 'pre-line' }}>
                <span className="round-dots">
                  {STAGES.map((s) => (
                    <i key={s.key} className={r.stages[s.key].done ? 'on' : undefined} />
                  ))}
                </span>
              </Tooltip>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Text size="sm" lineClamp={1}>
                  {project ? (
                    <Anchor component={Link} to={`/projects/${project.id}/schedule`} inherit>
                      {job}
                    </Anchor>
                  ) : (
                    job
                  )}{' '}
                  <Text span c="dimmed" size="xs">
                    {when}
                  </Text>
                </Text>
                <Text size="xs" c={r.overdue ? 'red' : 'dimmed'} lineClamp={1}>
                  {r.overdue ? r.overdue.text : r.next?.text}
                  {progress ? ` · ${progress}` : ''}
                </Text>
              </div>
              <Button size="compact-xs" variant="light" onClick={() => setOpen(r)}>
                Update
              </Button>
            </Group>
          );
        })}
        {rounds.length > SHOWN && (
          <Button size="compact-xs" variant="subtle" onClick={() => setAll((a) => !a)} style={{ alignSelf: 'flex-start' }}>
            {all ? 'Show fewer' : `Show all ${rounds.length}`}
          </Button>
        )}
      </Stack>
      {open && <RoundModal sheet={sheet} row={sheet.rows.find((x) => x.id === open.rowId)!} month={open.month} opts={opts} run={run} onClose={() => setOpen(null)} />}
    </Card>
  );
}
