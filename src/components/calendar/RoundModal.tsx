// A sampling round on the monitoring calendar, stage by stage: sampled, sent to the lab (which lab, its job or chain
// of custody number), results back, results sent (to whom) – with what EnviroDB already knows filled in.

import { useEffect, useMemo, useState } from 'react';
import { Alert, Autocomplete, Button, Checkbox, Group, Modal, Stack, Switch, Text, TextInput, Textarea } from '@mantine/core';
import { IconAlertTriangle, IconClockHour4 } from '@tabler/icons-react';
import type { CalendarMark, CalendarRow } from '../../db/types';
import type { CalendarEdit } from '../../db/repo';
import { DateField } from '../common';
import { cellValue, markId, monthName, type CalendarSheet } from '../../lib/calendar';
import { formatDate, todayStr } from '../../lib/dates';
import { roundEdits, roundOf, type RoundOptions, type StageKey } from '../../lib/rounds';

const LABS = ['Hill Labs', 'ALS', 'Linnaeus', 'Analytica', 'Eurofins', 'Watercare Laboratory Services', 'NIWA'];

interface StageState {
  on: boolean;
  date?: string;
}

export function RoundModal({ sheet, row, month, opts, onClose, run }: { sheet: CalendarSheet; row: CalendarRow; month: string; opts: RoundOptions; onClose: () => void; run: (e: CalendarEdit[]) => Promise<void> }) {
  const round = useMemo(() => roundOf(sheet, row, month, opts), [sheet, row, month, opts]);
  const first = round?.month ?? month;
  const mark: Partial<CalendarMark> = sheet.marks.get(markId(row.id, first)) ?? {};
  const project = row.projectId ? sheet.projects.get(row.projectId) : undefined;
  const job = cellValue(row, 'job', project) || 'Untitled job';
  const months = round?.months ?? [month];
  const when = months.length > 1 ? `${monthName(months[0])} – ${monthName(months[months.length - 1])} ${months[0].slice(0, 4)}` : `${monthName(month, true)} ${month.slice(0, 4)}`;

  const manual: Record<StageKey, string | undefined> = { sampled: mark.sampledOn, lab: mark.labSentOn, results: mark.resultsOn, sent: mark.resultsSentOn };
  const auto = (k: StageKey) => !!round?.stages[k].done && !manual[k];
  const init = (k: StageKey): StageState => ({ on: !!manual[k] || auto(k), date: manual[k] });
  const [stages, setStages] = useState<Record<StageKey, StageState>>(() => ({ sampled: init('sampled'), lab: init('lab'), results: init('results'), sent: init('sent') }));
  const [lab, setLab] = useState(mark.lab ?? '');
  const [labRef, setLabRef] = useState(mark.labRef ?? '');
  const [sentTo, setSentTo] = useState(mark.sentTo ?? '');
  const [note, setNote] = useState(mark.note ?? '');
  const [cancelled, setCancelled] = useState(mark.status === 'cancelled');
  useEffect(() => setCancelled(mark.status === 'cancelled'), [mark.status]);

  const labsUsed = useMemo(() => [...new Set([...LABS, ...[...sheet.marks.values()].map((m) => m.lab).filter(Boolean)] as string[])].sort(), [sheet.marks]);
  const recipients = useMemo(() => [...new Set([project?.client, project?.regulator, 'The client', 'The council', ...[...sheet.marks.values()].map((m) => m.sentTo)].filter(Boolean) as string[])], [project, sheet.marks]);

  const set = (k: StageKey, patch: Partial<StageState>) =>
    setStages((s) => {
      const next = { ...s[k], ...patch };
      // ticked: today, unless a date is given (or EnviroDB knows it)
      if (patch.on && !next.date && !auto(k)) next.date = todayStr();
      if (patch.on === false) next.date = undefined;
      return { ...s, [k]: next };
    });

  const save = async () => {
    const dateOf = (k: StageKey) => (stages[k].on ? stages[k].date : undefined);
    const edits = roundEdits(
      row,
      first,
      {
        sampledOn: dateOf('sampled'),
        labSentOn: dateOf('lab'),
        resultsOn: dateOf('results'),
        resultsSentOn: dateOf('sent'),
        notSent: !stages.sent.on,
        lab: lab.trim() || undefined,
        labRef: labRef.trim() || undefined,
        sentTo: sentTo.trim() || undefined,
        note: note.trim() || undefined,
        cancelled,
      },
      sheet.marks,
    );
    await run(edits);
    onClose();
  };

  const from = (k: StageKey) => (round?.stages[k].from && !stages[k].date ? round.stages[k].from : undefined);
  const stageRow = (k: StageKey, label: string, extra?: React.ReactNode) => (
    <Stack gap={4}>
      <Group gap="sm" wrap="nowrap" align="flex-end">
        <Checkbox
          label={label}
          checked={stages[k].on}
          disabled={cancelled || (auto(k) && k !== 'sent' && !!round?.stages[k].from && round.stages[k].from !== 'marked done')}
          onChange={(e) => set(k, { on: e.currentTarget.checked })}
          w={150}
          mb={8}
        />
        <DateField size="xs" w={140} aria-label={`${label}: date`} placeholder={round?.stages[k].date ? formatDate(round.stages[k].date) : 'Date'} value={stages[k].date} onChange={(v) => set(k, { date: v, on: true })} disabled={cancelled} />
      </Group>
      {from(k) && (
        <Text size="xs" c="dimmed" pl={30}>
          {from(k)!.charAt(0).toUpperCase() + from(k)!.slice(1)}
        </Text>
      )}
      {extra}
    </Stack>
  );

  const res = months.map((m) => sheet.facts.get(row.id)?.results.get(m)).filter(Boolean);
  const sitesIn = [...new Set(res.flatMap((r) => r!.sites))].map((id) => sheet.sites.get(id)?.code ?? '?');

  return (
    <Modal opened onClose={onClose} title={<Text fw={700}>Sampling round – {job}, {when}</Text>} size="lg">
      <Stack gap="sm">
        {round?.overdue && !cancelled ? (
          <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />} p="xs">
            {round.overdue.text}
          </Alert>
        ) : round?.next && !cancelled ? (
          <Alert color="blue" variant="light" icon={<IconClockHour4 size={16} />} p="xs">
            {round.next.text}
          </Alert>
        ) : null}
        {!round?.planned && (
          <Text size="xs" c="dimmed">
            Nothing is planned this month on the calendar – record a round here if there was one (e.g. a resample).
          </Text>
        )}
        {stageRow('sampled', 'Sampled')}
        {stageRow(
          'lab',
          'Sent to the lab',
          <Group gap="xs" pl={30} grow>
            <Autocomplete size="xs" label="Lab" placeholder="e.g. Hill Labs" data={labsUsed} value={lab} onChange={setLab} disabled={cancelled} />
            <TextInput size="xs" label="Job / chain of custody no." placeholder={round?.labRef ?? 'e.g. 3456789'} value={labRef} onChange={(e) => setLabRef(e.currentTarget.value)} disabled={cancelled} />
          </Group>,
        )}
        {stageRow(
          'results',
          'Results back',
          sitesIn.length ? (
            <Text size="xs" c="dimmed" pl={30}>
              In EnviroDB for {sitesIn.join(', ')}
              {round?.lab && !mark.lab ? ` · ${round.lab}` : ''}
              {round?.labRef && !mark.labRef ? ` job ${round.labRef}` : ''}
            </Text>
          ) : null,
        )}
        {stageRow(
          'sent',
          'Results sent',
          <Group gap="xs" pl={30} grow>
            <Autocomplete size="xs" label="Sent to" placeholder="e.g. the client, the council" data={recipients} value={sentTo} onChange={setSentTo} disabled={cancelled} />
          </Group>,
        )}
        <Textarea size="xs" label="Note" placeholder="e.g. GW2 dry – not sampled; results to the client by the 20th" autosize minRows={2} value={note} onChange={(e) => setNote(e.currentTarget.value)} />
        <Switch size="sm" label="Cancelled or on hold this round" checked={cancelled} onChange={(e) => setCancelled(e.currentTarget.checked)} />
        <Text size="xs" c="dimmed">
          The month’s colour follows: under way once anything is ticked, done (green) once the results are sent. Results back is ticked by itself when the lab’s results are imported.
        </Text>
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()}>Save</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
