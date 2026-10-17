import { useMemo, useState } from 'react';
import { Alert, Badge, Button, Checkbox, Group, Modal, ScrollArea, Select, Stack, Table, Text } from '@mantine/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import type { CalendarRow, MonitoringSchedule, Project, ReportObligation, Site } from '../../db/types';
import { addCalendarRows, type CalendarEdit } from '../../db/repo';
import { MONTH_FIELDS, planFromProject, rowForProject, scheduleSymbols, type RowPlan } from '../../lib/calendar';
import { frequencyLabel } from '../../lib/schedule';
import { MONTH_SHORT } from '../../lib/dates';
import { SitePicker } from '../common';

// The monitoring calendar's dialogs: linking a row to a project (and the sites whose results count for it), filling
// a row in from the project's sampling schedules and reports, and adding rows for projects.

/** New rows for projects – each filled in from its sampling schedules and reports – after the project's other rows. */
export async function projectRows(projectIds: string[], year: number): Promise<CalendarRow[]> {
  const made: CalendarRow[] = [];
  for (const id of projectIds) {
    const [project, schedules, obligations, sites, existing] = await Promise.all([
      db.projects.get(id),
      db.schedules.where('projectId').equals(id).toArray(),
      db.obligations.where('projectId').equals(id).toArray(),
      db.sites.where('projectId').equals(id).toArray(),
      db.calendarRows.where('projectId').equals(id).toArray(),
    ]);
    if (!project) continue;
    const last = existing.sort((a, b) => b.order - a.order)[0];
    made.push(...(await addCalendarRows([rowForProject(project, schedules, obligations, year, new Map(sites.map((s) => [s.id, s.code])))], { after: last?.id })));
  }
  return made;
}

/** The edit that fills a row's months, details and report due in from a plan. */
function planEdit(row: CalendarRow, plan: RowPlan, parts: { months: boolean; details: boolean; reportDue: boolean }): CalendarEdit {
  const set: Partial<CalendarRow> = {};
  if (parts.months) for (const f of MONTH_FIELDS) set[f] = plan.months[f];
  if (parts.details) set.details = plan.details || undefined;
  if (parts.reportDue) set.reportDue = plan.reportDue || undefined;
  return { t: 'row', id: row.id, set };
}

function PlanPreview({ plan }: { plan: RowPlan }) {
  return (
    <ScrollArea type="auto">
      <Table withTableBorder withColumnBorders fz="xs" horizontalSpacing={4} verticalSpacing={4} className="cal-preview">
        <Table.Thead>
          <Table.Tr>
            {MONTH_SHORT.map((m) => (
              <Table.Th key={m} ta="center">
                {m}
              </Table.Th>
            ))}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          <Table.Tr>
            {MONTH_FIELDS.map((f) => (
              <Table.Td key={f} ta="center" style={{ whiteSpace: 'nowrap' }}>
                {plan.months[f] ?? ''}
              </Table.Td>
            ))}
          </Table.Tr>
        </Table.Tbody>
      </Table>
    </ScrollArea>
  );
}

function useProjectPlanData(projectId: string | null) {
  const schedules = useLiveQuery(() => (projectId ? db.schedules.where('projectId').equals(projectId).toArray() : Promise.resolve([] as MonitoringSchedule[])), [projectId]);
  const obligations = useLiveQuery(() => (projectId ? db.obligations.where('projectId').equals(projectId).toArray() : Promise.resolve([] as ReportObligation[])), [projectId]);
  const sites = useLiveQuery(() => (projectId ? db.sites.where('projectId').equals(projectId).sortBy('order') : Promise.resolve([] as Site[])), [projectId]);
  return { schedules: schedules ?? [], obligations: obligations ?? [], sites: sites ?? [], loaded: !!schedules && !!obligations && !!sites };
}

/** Choosing the schedules and reports a row is filled in from. */
function PlanPicker({
  schedules, obligations, chosen, onChange,
}: {
  schedules: MonitoringSchedule[];
  obligations: ReportObligation[];
  chosen: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const symbols = scheduleSymbols(schedules.filter((s) => s.active));
  const inOrder = schedules.filter((s) => s.active).sort((a, b) => a.startDate.localeCompare(b.startDate) || a.name.localeCompare(b.name));
  const toggle = (id: string, on: boolean) => {
    const next = new Set(chosen);
    if (on) next.add(id);
    else next.delete(id);
    onChange(next);
  };
  const active = [...schedules.filter((s) => s.active), ...obligations.filter((o) => o.active)];
  if (!active.length)
    return (
      <Text size="sm" c="dimmed">
        The project has no sampling schedules or reporting obligations yet – add them on its Schedule tab.
      </Text>
    );
  return (
    <Stack gap={4}>
      {inOrder.map((s) => (
          <Checkbox
            key={s.id}
            checked={chosen.has(s.id)}
            onChange={(e) => toggle(s.id, e.currentTarget.checked)}
            label={
              <>
                <b>{symbols.get(s.id)}</b> {s.name} <Text span size="xs" c="dimmed">({frequencyLabel(s.every, s.unit).toLowerCase()}{s.window && s.window > 1 ? `, a ${s.window}-month window` : ''})</Text>
              </>
            }
          />
        ))}
      {obligations
        .filter((o) => o.active)
        .map((o) => (
          <Checkbox
            key={o.id}
            checked={chosen.has(o.id)}
            onChange={(e) => toggle(o.id, e.currentTarget.checked)}
            label={
              <>
                <b>R</b> {o.name} <Text span size="xs" c="dimmed">(report)</Text>
              </>
            }
          />
        ))}
    </Stack>
  );
}

/** Which of a project's schedules a row is for: those at its sites, or all of them. */
function defaultChosen(row: CalendarRow, schedules: MonitoringSchedule[], obligations: ReportObligation[]): Set<string> {
  const sites = new Set(row.siteIds ?? []);
  const sch = schedules.filter((s) => s.active && (!sites.size || s.siteIds.some((id) => sites.has(id))));
  return new Set([...sch.map((s) => s.id), ...obligations.filter((o) => o.active).map((o) => o.id)]);
}

export function FillFromProjectModal({ row, year, onClose, run }: { row: CalendarRow; year: number; onClose: () => void; run: (e: CalendarEdit[]) => Promise<void> }) {
  const { schedules, obligations, sites, loaded } = useProjectPlanData(row.projectId ?? null);
  const [chosen, setChosen] = useState<Set<string> | null>(null);
  const pick = chosen ?? (loaded ? defaultChosen(row, schedules, obligations) : new Set<string>());
  const [parts, setParts] = useState({ months: true, details: true, reportDue: false });
  const plan = useMemo(
    () => planFromProject(schedules.filter((s) => pick.has(s.id)), obligations.filter((o) => pick.has(o.id)), year, new Map(sites.map((s) => [s.id, s.code]))),
    [schedules, obligations, sites, pick, year],
  );
  const hasMonths = MONTH_FIELDS.some((f) => row[f]);
  return (
    <Modal opened onClose={onClose} title="Fill in from the project’s schedules" size="lg">
      <Stack gap="sm">
        <Text size="sm" c="dimmed">
          Each sampling schedule’s mark goes in the months its rounds start (every month for weekly sampling), with a window over the months it can be sampled in; R goes in the month a report is due.
        </Text>
        {loaded && <PlanPicker schedules={schedules} obligations={obligations} chosen={pick} onChange={setChosen} />}
        <PlanPreview plan={plan} />
        {plan.details && (
          <Text size="sm">
            <Text span fw={600}>
              Details:{' '}
            </Text>
            {plan.details}
          </Text>
        )}
        <Group gap="md" align="flex-start">
          <Checkbox label="Months" checked={parts.months} onChange={(e) => setParts({ ...parts, months: e.currentTarget.checked })} />
          <Checkbox label="Schedule details" checked={parts.details} onChange={(e) => setParts({ ...parts, details: e.currentTarget.checked })} />
          <Checkbox label="Report due" description="The reports due show on the row anyway" checked={parts.reportDue} onChange={(e) => setParts({ ...parts, reportDue: e.currentTarget.checked })} />
        </Group>
        {hasMonths && parts.months && (
          <Alert color="orange" variant="light" p="xs">
            This replaces what’s in the row’s months now (Undo puts it back).
          </Alert>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!parts.months && !parts.details && !parts.reportDue}
            onClick={async () => {
              await run([planEdit(row, plan, parts)]);
              onClose();
            }}
          >
            Fill in
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

export function LinkRowModal({ row, year, onClose, run }: { row: CalendarRow; year: number; onClose: () => void; run: (e: CalendarEdit[]) => Promise<void> }) {
  const projects = useLiveQuery(() => db.projects.toArray(), []);
  const [projectId, setProjectId] = useState<string | null>(row.projectId ?? null);
  const [siteIds, setSiteIds] = useState<string[]>(row.siteIds ?? []);
  const { schedules, obligations, sites, loaded } = useProjectPlanData(projectId);
  const hasMonths = MONTH_FIELDS.some((f) => row[f]);
  const [fill, setFill] = useState(!hasMonths);
  const [copy, setCopy] = useState(true);
  const project = projects?.find((p) => p.id === projectId);
  const changed = projectId !== (row.projectId ?? null);
  // the row's own job code, PO, consents and folder, for the project where it has none
  const toProject: Partial<Project> = {};
  if (project && changed) {
    if (row.jobCode && !project.code) toProject.code = row.jobCode;
    if (row.purchaseOrder && !project.purchaseOrder) toProject.purchaseOrder = row.purchaseOrder;
    if (row.consents && !project.consents) toProject.consents = row.consents;
    if (row.folder && !project.folder) toProject.folder = row.folder;
  }
  const copyable = Object.keys(toProject).length > 0;
  const save = async () => {
    const edits: CalendarEdit[] = [];
    const old = projects?.find((p) => p.id === row.projectId);
    if (!projectId) {
      // the project's details stay on the row
      if (old) edits.push({ t: 'row', id: row.id, set: { projectId: undefined, siteIds: undefined, job: row.job || old.name, jobCode: old.code, purchaseOrder: old.purchaseOrder, consents: old.consents, folder: old.folder } });
    } else {
      const set: Partial<CalendarRow> = { projectId, siteIds: siteIds.length ? siteIds : undefined };
      if (project && row.job.trim().toLowerCase() === project.name.trim().toLowerCase()) set.job = '';
      edits.push({ t: 'row', id: row.id, set });
      if (copy && copyable) edits.push({ t: 'project', id: projectId, set: toProject });
      if (fill && loaded) {
        const linked = { ...row, siteIds: set.siteIds };
        const pick = defaultChosen(linked, schedules, obligations);
        const plan = planFromProject(schedules.filter((s) => pick.has(s.id)), obligations.filter((o) => pick.has(o.id)), year, new Map(sites.map((s) => [s.id, s.code])));
        edits.push(planEdit(row, plan, { months: true, details: true, reportDue: false }));
      }
    }
    await run(edits);
    onClose();
  };
  return (
    <Modal opened onClose={onClose} title="The row’s project" size="md">
      <Stack gap="sm">
        <Text size="sm" c="dimmed">
          A row for a project shows the project’s job code, purchase order, consents and folder (changing them on the calendar changes the project’s), when its results came in, and its reports due.
        </Text>
        <Select
          label="Project"
          placeholder="No project"
          data={[...(projects ?? [])].sort((a, b) => a.name.localeCompare(b.name)).map((p) => ({ value: p.id, label: p.code ? `${p.name} (${p.code})` : p.name }))}
          value={projectId}
          onChange={(v) => {
            setProjectId(v);
            setSiteIds([]);
          }}
          searchable
          clearable
        />
        {projectId && (
          <SitePicker
            label="Sites"
            description="Results from these sites count for this row – for a project with a row per kind of monitoring. None: all its sites."
            sites={sites ?? []}
            value={siteIds}
            onChange={setSiteIds}
          />
        )}
        {projectId && changed && (
          <Checkbox label="Fill in the months, details and report due from the project’s schedules" description={hasMonths ? 'Replaces what’s in the months now' : undefined} checked={fill} onChange={(e) => setFill(e.currentTarget.checked)} />
        )}
        {copyable && (
          <Checkbox
            label={`Give the project the row’s ${Object.keys(toProject).map((k) => ({ code: 'job code', purchaseOrder: 'purchase order', consents: 'consents', folder: 'folder' })[k]).join(', ')}`}
            description="The project has none yet"
            checked={copy}
            onChange={(e) => setCopy(e.currentTarget.checked)}
          />
        )}
        {!projectId && row.projectId && (
          <Text size="sm" c="dimmed">
            The row keeps the project’s name, job code, PO, consents and folder as its own.
          </Text>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!changed && same(siteIds, row.siteIds ?? [])}>
            Save
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

const same = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

export function AddProjectRowsModal({ year, onClose }: { year: number; onClose: () => void }) {
  const projects = useLiveQuery(() => db.projects.where('status').equals('active').toArray(), []);
  const rows = useLiveQuery(() => db.calendarRows.toArray(), []);
  const onCalendar = new Set((rows ?? []).map((r) => r.projectId).filter(Boolean));
  const list = [...(projects ?? [])].sort((a, b) => Number(onCalendar.has(a.id)) - Number(onCalendar.has(b.id)) || a.name.localeCompare(b.name));
  const [chosen, setChosen] = useState<Set<string> | null>(null);
  const pick = chosen ?? new Set(list.filter((p) => !onCalendar.has(p.id)).map((p) => p.id));
  const [busy, setBusy] = useState(false);
  return (
    <Modal opened onClose={onClose} title="Rows for projects" size="md">
      <Stack gap="sm">
        <Text size="sm" c="dimmed">
          A row for each project chosen, filled in from its sampling schedules and reports for {year} – change anything afterwards.
        </Text>
        {!list.length ? (
          <Text size="sm">No active projects.</Text>
        ) : (
          <ScrollArea.Autosize mah={360}>
            <Stack gap={6}>
              {list.map((p) => (
                <Checkbox
                  key={p.id}
                  checked={pick.has(p.id)}
                  onChange={(e) => {
                    const next = new Set(pick);
                    if (e.currentTarget.checked) next.add(p.id);
                    else next.delete(p.id);
                    setChosen(next);
                  }}
                  label={
                    <Group gap={6}>
                      <span>{p.name}</span>
                      {p.code && (
                        <Text span size="xs" c="dimmed">
                          {p.code}
                        </Text>
                      )}
                      {onCalendar.has(p.id) && (
                        <Badge size="xs" variant="light" color="gray">
                          On the calendar
                        </Badge>
                      )}
                    </Group>
                  }
                />
              ))}
            </Stack>
          </ScrollArea.Autosize>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={busy}
            disabled={!pick.size}
            onClick={async () => {
              setBusy(true);
              try {
                await projectRows(list.filter((p) => pick.has(p.id)).map((p) => p.id), year);
                onClose();
              } finally {
                setBusy(false);
              }
            }}
          >
            Add {pick.size} row{pick.size === 1 ? '' : 's'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
