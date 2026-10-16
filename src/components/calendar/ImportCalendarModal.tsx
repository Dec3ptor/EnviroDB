import { useMemo, useState } from 'react';
import { Alert, Anchor, Badge, Button, Checkbox, Group, Modal, NumberInput, ScrollArea, Select, Stack, Table, Text } from '@mantine/core';
import { Dropzone } from '@mantine/dropzone';
import { notifications } from '@mantine/notifications';
import { useLiveQuery } from 'dexie-react-hooks';
import { IconFileSpreadsheet } from '@tabler/icons-react';
import { db } from '../../db/db';
import { commitCalendarImport, jobKey, readCalendarWorkbook, suggestProject, type ImportedCalendar } from '../../importers/calendarSheet';
import { MONTH_FIELDS, monthText, STATUS_INFO } from '../../lib/calendar';
import { MONTH_SHORT, todayStr } from '../../lib/dates';

// Bringing a team's monitoring-schedule spreadsheet onto the calendar: its rows, sampling windows and colours, with
// each row linked to the project it's for (matched by job code or name – change any).

const ACCEPT = {
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx', '.xlsm'],
  'application/vnd.ms-excel': ['.xls'],
  'application/vnd.ms-excel.sheet.macroEnabled.12': ['.xlsm'],
};

export function ImportCalendarModal({ onClose }: { onClose: () => void }) {
  const projects = useLiveQuery(() => db.projects.toArray(), []);
  const existing = useLiveQuery(() => db.calendarRows.count(), []);
  const thisYear = Number(todayStr().slice(0, 4));
  const [file, setFile] = useState('');
  const [data, setData] = useState<ImportedCalendar | null>(null);
  const [links, setLinks] = useState<Array<string | null>>([]);
  const [year, setYear] = useState(thisYear);
  const [replace, setReplace] = useState(false);
  const [makeProjects, setMakeProjects] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const options = useMemo(() => [...(projects ?? [])].sort((a, b) => a.name.localeCompare(b.name)).map((p) => ({ value: p.id, label: p.code ? `${p.name} (${p.code})` : p.name })), [projects]);

  const load = async (f: File) => {
    setError('');
    setBusy(true);
    try {
      const d = await readCalendarWorkbook(await f.arrayBuffer());
      if (!d.rows.length) throw new Error(`The months are on “${d.sheet}”, but no rows under them have anything in.`);
      setData(d);
      setFile(f.name);
      setYear(d.year ?? thisYear);
      setLinks(d.rows.map((r) => suggestProject(r.row, projects ?? [])?.id ?? null));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  // a project chosen for a row goes for the job's other rows too
  const link = (i: number, id: string | null) => {
    if (!data) return;
    const key = (k: number) => jobKey(data.rows[k].row);
    setLinks(links.map((cur, k) => (k === i || (key(k) === key(i) && cur === links[i]) ? id : cur)));
  };
  const linked = links.filter(Boolean).length;
  const coloured = data?.rows.reduce((n, r) => n + r.months.filter(Boolean).length, 0) ?? 0;

  return (
    <Modal opened onClose={onClose} title="Import a monitoring schedule spreadsheet" size={data ? 'calc(100vw - 64px)' : 'lg'}>
      <Stack gap="sm">
        {!data ? (
          <>
            <Text size="sm" c="dimmed">
              The spreadsheet your team keeps the monitoring schedule in: a row per job, the months (Jan … Dec) across the top, sampling windows as cells merged over months, green for done, yellow for doing and pink for cancelled or on hold. The rows come onto the calendar with their marks, notes and colours.
            </Text>
            <Dropzone onDrop={(files) => files[0] && void load(files[0])} accept={ACCEPT} loading={busy} multiple={false} maxSize={30 * 1024 * 1024}>
              <Group justify="center" gap="md" mih={110} style={{ pointerEvents: 'none' }}>
                <IconFileSpreadsheet size={40} stroke={1.4} color="var(--mantine-color-teal-6)" />
                <div>
                  <Text fw={600}>Drop the spreadsheet here</Text>
                  <Text size="sm" c="dimmed">
                    or click to choose it (.xlsx)
                  </Text>
                </div>
              </Group>
            </Dropzone>
            {error && (
              <Alert color="red" variant="light">
                {error}
              </Alert>
            )}
          </>
        ) : (
          <>
            <Text size="sm">
              <b>{data.rows.length}</b> rows from “{data.sheet}” in {file} – {coloured} months coloured, {linked} row{linked === 1 ? '' : 's'} matched to a project.{' '}
              <Anchor component="button" size="sm" onClick={() => setData(null)}>
                Choose another file
              </Anchor>
            </Text>
            <Group gap="lg" align="flex-end" wrap="wrap">
              <NumberInput label="The colours are for" description="Months are coloured for one year" value={year} onChange={(v) => setYear(Number(v) || thisYear)} min={2000} max={2100} w={170} />
              <Checkbox label="Make a project for each job that has none" checked={makeProjects} onChange={(e) => setMakeProjects(e.currentTarget.checked)} />
              {!!existing && <Checkbox label={`Replace the ${existing} row${existing === 1 ? '' : 's'} on the calendar now`} checked={replace} onChange={(e) => setReplace(e.currentTarget.checked)} color="red" />}
            </Group>
            <ScrollArea.Autosize mah="52vh" type="auto">
              <Table stickyHeader withTableBorder fz="xs" className="cal-import-table">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Row</Table.Th>
                    <Table.Th miw={180}>Job</Table.Th>
                    <Table.Th>Job code</Table.Th>
                    {MONTH_SHORT.map((m) => (
                      <Table.Th key={m} ta="center">
                        {m}
                      </Table.Th>
                    ))}
                    <Table.Th miw={240}>Project</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {data.rows.map((r, i) => (
                    <Table.Tr key={r.line} className={r.row.onHold ? 'cal-hold' : undefined}>
                      <Table.Td c="dimmed">{r.line}</Table.Td>
                      <Table.Td>
                        {r.row.job || <Text span c="dimmed" size="xs">(no job)</Text>}
                        {r.row.onHold && (
                          <Badge size="xs" color="pink" variant="light" ml={6}>
                            on hold
                          </Badge>
                        )}
                      </Table.Td>
                      <Table.Td style={{ whiteSpace: 'nowrap' }}>{r.row.jobCode}</Table.Td>
                      {MONTH_FIELDS.map((f, m) => (
                        <Table.Td key={f} ta="center" className={r.months[m] ? `st-${r.months[m]}` : undefined} title={r.months[m] ? STATUS_INFO[r.months[m]!].label : undefined} style={{ whiteSpace: 'nowrap' }}>
                          {(r.row[f] ?? '').includes('(') ? '(' : ''}
                          {monthText(r.row[f] ?? '')}
                          {(r.row[f] ?? '').includes(')') ? ')' : ''}
                        </Table.Td>
                      ))}
                      <Table.Td>
                        <Select size="xs" placeholder={makeProjects && r.row.job ? 'A new project' : 'No project'} data={options} value={links[i]} onChange={(v) => link(i, v)} searchable clearable comboboxProps={{ withinPortal: true }} />
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea.Autosize>
            <Group justify="flex-end">
              <Button variant="default" onClick={onClose}>
                Cancel
              </Button>
              <Button
                loading={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const res = await commitCalendarImport(data.rows, links, { year, replace, makeProjects });
                    notifications.show({ color: 'teal', message: `${res.rows} rows on the calendar${res.projects ? `, ${res.projects} new project${res.projects === 1 ? '' : 's'}` : ''}` });
                    onClose();
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Import {data.rows.length} rows
              </Button>
            </Group>
            {error && (
              <Alert color="red" variant="light">
                {error}
              </Alert>
            )}
          </>
        )}
      </Stack>
    </Modal>
  );
}
