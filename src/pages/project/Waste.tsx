// Waste acceptance: the project's soil and sediment samples against the criteria of a landfill class – the total
// concentrations screened, a TCLP result deciding where a total is over the screening value. The criteria are a
// guideline set of the team's own, pasted in or typed in the library; EnviroDB has none.

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Anchor, Badge, Button, Card, Group, Modal, SegmentedControl, Select, Stack, Switch, Table, Text, Textarea, TextInput, Tooltip } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconClipboardText, IconDownload } from '@tabler/icons-react';
import { downloadBlob, safeFileName } from '../../db/backup';
import { saveCriteria } from '../../db/waste';
import type { GuidelineSet } from '../../db/types';
import { useProject } from '../../hooks/useProjectData';
import { useViewState } from '../../hooks/useViewState';
import { EmptyState, MoreOptions } from '../../components/common';
import { formatDate } from '../../lib/dates';
import { byDepth, depthCell, depthText, hasDepths } from '../../lib/depth';
import { fmtNum } from '../../lib/values';
import { parseCriteria, TCLP_RATIO, verdictText, wasteCheck, wasteCriteria, wasteCsv, WASTE_DEFAULTS, type WasteCell, type WasteOptions, type WasteStatus, type WasteVerdict } from '../../lib/waste';

const VERDICT_COLOR: Record<WasteVerdict, string> = { meets: 'teal', over: 'red', test: 'orange', unclear: 'yellow', 'no-data': 'gray' };
// (tints that follow the light or dark scheme)
const CELL_BG: Partial<Record<WasteStatus, string>> = { fail: 'var(--mantine-color-red-light)', 'need-leach': 'var(--mantine-color-orange-light)', unclear: 'var(--mantine-color-yellow-light)' };
const num = (v: number) => fmtNum(Number(v.toPrecision(3)));
const shown = (x: { value: number; nd: boolean } | undefined) => (x ? `${x.nd ? '< ' : ''}${num(x.value)}` : '');

export function WasteTab() {
  const data = useProject();
  const { project, paramMap, siteMap } = data;
  const [setId, setSetId] = useViewState<string | null>(`${project.id}:waste.set`, null);
  const [opts, setOpts] = useViewState<WasteOptions>(`${project.id}:waste.opts`, WASTE_DEFAULTS);
  const [pasting, setPasting] = useState(false);
  // the sets with something for a soil or a TCLP extract in them: criteria for this
  const sets = useMemo(() => data.guidelineSets.filter((g) => g.values.some((v) => paramMap.get(v.parameterId)?.matrix)), [data.guidelineSets, paramMap]);
  const set = sets.find((g) => g.id === setId) ?? (sets.length === 1 ? sets[0] : undefined);
  const samples = useMemo(() => data.samples.filter((s) => hasDepths(siteMap.get(s.siteId))).sort((a, b) => (siteMap.get(a.siteId)!.code.localeCompare(siteMap.get(b.siteId)!.code, undefined, { numeric: true }) || byDepth(a, b))), [data.samples, siteMap]);
  const criteria = useMemo(() => (set ? wasteCriteria(set, paramMap, opts) : []), [set, paramMap, opts]);
  const rows = useMemo(() => wasteCheck(samples, (id) => data.index.bySample.get(id) ?? [], (id) => siteMap.get(id), criteria, opts), [samples, data.index, siteMap, criteria, opts]);
  const counts = useMemo(() => {
    const c: Record<WasteVerdict, number> = { meets: 0, over: 0, test: 0, unclear: 0, 'no-data': 0 };
    for (const r of rows) c[r.verdict]++;
    return c;
  }, [rows]);
  // only the contaminants some sample has a result for (the rest are named under the table)
  const cols = criteria.map((c, i) => ({ c, i })).filter(({ i }) => rows.some((r) => r.cells[i].status !== 'none'));
  const untested = criteria.filter((_, i) => !rows.some((r) => r.cells[i].status !== 'none')).map((c) => c.name);

  if (!samples.length)
    return (
      <EmptyState title="No soil or sediment samples yet">
        Import the lab’s results for the project’s soil or sediment sites: results per kilogram go to soil parameters, TCLP results to their own, and each depth is its own sample. Then choose the criteria to compare them with here.
      </EmptyState>
    );
  return (
    <Stack gap="md">
      <Card padding="md">
        <Group justify="space-between" align="flex-start" wrap="wrap" gap="sm">
          <div style={{ flex: 1, minWidth: 260 }}>
            <Text fw={600}>Waste acceptance</Text>
            <Text size="sm" c="dimmed">
              Each soil or sediment sample against a landfill class’s criteria, in two steps: a total within the screening value passes; over it, the TCLP result decides. EnviroDB has no criteria of its own – paste the ones you work to, from the guideline or the landfill’s
              consent.
            </Text>
          </div>
          <Group gap="xs" align="flex-end">
            <Select
              label="Criteria"
              placeholder={sets.length ? 'Choose' : 'None yet'}
              data={sets.map((g) => ({ value: g.id, label: g.name }))}
              value={set?.id ?? null}
              onChange={setSetId}
              w={280}
              disabled={!sets.length}
              comboboxProps={{ withinPortal: true }}
            />
            <Button variant="default" leftSection={<IconClipboardText size={16} />} onClick={() => setPasting(true)}>
              Paste criteria…
            </Button>
            <Button variant="default" leftSection={<IconDownload size={16} />} disabled={!set} onClick={() => downloadBlob(new Blob([`﻿${wasteCsv(rows, criteria, (s) => String(depthCell(s.depth)))}`], { type: 'text/csv' }), `${safeFileName(`${project.code || project.name} waste acceptance`)}.csv`)}>
              CSV
            </Button>
          </Group>
        </Group>
        {set && (
          <Stack gap={6} mt="sm">
            <Text size="xs" c="dimmed">
              {set.source ? `${set.source}. ` : ''}
              {criteria.length} contaminant{criteria.length === 1 ? '' : 's'} with a criterion. <Anchor component={Link} to={`/guidelines/${set.id}`} size="xs">Change the values in the library</Anchor>
            </Text>
            <MoreOptions label="How it’s worked out" summary={`${opts.screen20 ? `A leachate limit with no total: screened at ${TCLP_RATIO} × the limit` : 'A leachate limit with no total needs a TCLP result'} · a total beside a leachate limit is ${opts.totalIs === 'screen' ? 'a screening value' : 'a limit of its own'}`}>
              <Stack gap="xs">
                <Switch
                  label={`Where the criteria give a leachate limit and no total, screen the total at ${TCLP_RATIO} × the limit`}
                  description={`A TCLP test extracts with ${TCLP_RATIO} times the sample’s weight of fluid: if every bit of the contaminant leached, the extract would hold the total ÷ ${TCLP_RATIO}. A total at or under ${TCLP_RATIO} × the limit can’t fail the test.`}
                  checked={opts.screen20}
                  onChange={(e) => setOpts({ ...opts, screen20: e.currentTarget.checked })}
                />
                <div>
                  <Text size="sm" fw={500} mb={4}>
                    A total given beside a leachate limit is
                  </Text>
                  <SegmentedControl
                    size="xs"
                    value={opts.totalIs}
                    onChange={(v) => setOpts({ ...opts, totalIs: v as WasteOptions['totalIs'] })}
                    data={[
                      { value: 'screen', label: 'A screening value: over it, a TCLP result within its limit passes' },
                      { value: 'limit', label: 'A limit of its own, to be met as well' },
                    ]}
                  />
                </div>
              </Stack>
            </MoreOptions>
          </Stack>
        )}
      </Card>
      {!set ? (
        <EmptyState title={sets.length ? 'Choose the criteria to compare with' : 'No criteria yet'} action={<Button leftSection={<IconClipboardText size={16} />} onClick={() => setPasting(true)}>Paste criteria…</Button>}>
          {samples.length} soil or sediment sample{samples.length === 1 ? '' : 's'} to check. Paste a landfill class’s criteria – a contaminant a line, its total (mg/kg) and its leachate limit (mg/L) – and they’re kept as a guideline set for every project.
        </EmptyState>
      ) : (
        <>
          <Group gap="xs">
            {(['meets', 'test', 'over', 'unclear', 'no-data'] as const)
              .filter((v) => counts[v])
              .map((v) => (
                <Badge key={v} color={VERDICT_COLOR[v]} variant="light" size="lg">
                  {counts[v]} {verdictText(v).toLowerCase()}
                </Badge>
              ))}
          </Group>
          <Card padding={0}>
            <Table.ScrollContainer minWidth={Math.max(640, 330 + cols.length * 96)}>
              <Table verticalSpacing={4} horizontalSpacing={8} fz="sm" withColumnBorders>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Site</Table.Th>
                    <Table.Th>Depth</Table.Th>
                    <Table.Th>Date</Table.Th>
                    <Table.Th>Outcome</Table.Th>
                    {cols.map(({ c }) => (
                      <Table.Th key={c.key} ta="right" style={{ whiteSpace: 'nowrap' }}>
                        {c.name}
                        <Text size="xs" c="dimmed" fw={400}>
                          {c.screen !== undefined ? `${num(c.screen)} mg/kg${c.screenFrom === 'leach' ? ' *' : ''}` : '–'}
                        </Text>
                        <Text size="xs" c="dimmed" fw={400}>
                          {c.leach !== undefined ? `TCLP ${num(c.leach)} mg/L` : ' '}
                        </Text>
                      </Table.Th>
                    ))}
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {rows.map((r) => (
                    <Table.Tr key={r.sample.id}>
                      <Table.Td fw={600}>{r.site.code}</Table.Td>
                      <Table.Td style={{ whiteSpace: 'nowrap' }}>{depthText(r.sample.depth) || '–'}</Table.Td>
                      <Table.Td style={{ whiteSpace: 'nowrap' }}>{formatDate(r.sample.date)}</Table.Td>
                      <Table.Td>
                        <Tooltip label={r.summary} multiline maw={420} disabled={r.verdict === 'meets' && !r.untested.length}>
                          <Badge color={VERDICT_COLOR[r.verdict]} variant={r.verdict === 'over' ? 'filled' : 'light'}>
                            {verdictText(r.verdict)}
                          </Badge>
                        </Tooltip>
                      </Table.Td>
                      {cols.map(({ c, i }) => (
                        <ValueCell key={c.key} cell={r.cells[i]} />
                      ))}
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Card>
          <Text size="xs" c="dimmed">
            Under each contaminant: the total it’s screened at (mg/kg) and its leachate limit (TCLP, mg/L). In a cell: the sample’s total, and its TCLP result beneath where it has one.
            {criteria.some((c) => c.screenFrom === 'leach') ? ` * ${TCLP_RATIO} × the leachate limit – the criteria give no total.` : ''} Orange: over the screening value with no TCLP result yet. Red: over the criteria. Yellow: a detection limit above the value it’s
            compared with.{untested.length ? ` No sample has a result for: ${untested.join(', ')}.` : ''}
          </Text>
        </>
      )}
      {pasting && <CriteriaModal sets={sets} current={set} onClose={() => setPasting(false)} onSaved={(id) => setSetId(id)} />}
    </Stack>
  );
}

function ValueCell({ cell }: { cell: WasteCell }) {
  if (cell.status === 'none')
    return (
      <Table.Td ta="right" c="dimmed">
        –
      </Table.Td>
    );
  return (
    <Tooltip label={cell.why} multiline maw={360}>
      <Table.Td ta="right" style={{ background: CELL_BG[cell.status], whiteSpace: 'nowrap' }} className="tabular">
        {shown(cell.total) || '–'}
        {cell.leach && (
          <Text size="xs" c={cell.status === 'fail' ? 'red.8' : 'dimmed'}>
            TCLP {shown(cell.leach)}
          </Text>
        )}
      </Table.Td>
    </Tooltip>
  );
}

/** Criteria pasted in: a contaminant a line with its total and its leachate limit – kept as a guideline set. */
function CriteriaModal({ sets, current, onClose, onSaved }: { sets: GuidelineSet[]; current?: GuidelineSet; onClose: () => void; onSaved: (id: string) => void }) {
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  const [source, setSource] = useState('');
  const [into, setInto] = useState<string>('new');
  const [busy, setBusy] = useState(false);
  const parsed = useMemo(() => parseCriteria(text), [text]);
  const target = sets.find((g) => g.id === into);
  const save = async () => {
    setBusy(true);
    try {
      const r = await saveCriteria(target ? target.name : name, source, parsed.rows, target);
      notifications.show({ color: 'teal', message: `${parsed.rows.length} contaminant${parsed.rows.length === 1 ? '' : 's'} saved in “${r.set.name}”${r.added ? ` – ${r.added} soil or TCLP parameter${r.added === 1 ? '' : 's'} added to the library` : ''}.` });
      onSaved(r.set.id);
      onClose();
    } catch (e) {
      notifications.show({ color: 'red', message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal opened onClose={onClose} title="Paste waste acceptance criteria" size="lg">
      <Stack gap="sm">
        <Text size="sm" c="dimmed">
          From the guideline’s table or the landfill’s consent: a contaminant a line, then its total concentration (mg/kg), then its leachate limit (TCLP, mg/L). Either may be blank. With a heading row, the columns are found by their headings. Check each value against
          your source once it’s in – they’re yours, kept as a guideline set for every project.
        </Text>
        <Textarea
          autosize
          minRows={7}
          maxRows={16}
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
          placeholder={'Contaminant\tTotal (mg/kg)\tTCLP (mg/L)\nArsenic\t…\t…\nLead\t…\t…'}
          data-autofocus
          aria-label="The criteria"
          styles={{ input: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 13 } }}
        />
        {parsed.rows.length > 0 && (
          <Table.ScrollContainer minWidth={420} mah={220} style={{ overflowY: 'auto' }}>
            <Table verticalSpacing={2} fz="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Contaminant</Table.Th>
                  <Table.Th ta="right">Total (mg/kg)</Table.Th>
                  <Table.Th ta="right">Leachate limit (mg/L)</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {parsed.rows.map((r, i) => (
                  <Table.Tr key={i}>
                    <Table.Td>{r.name}</Table.Td>
                    <Table.Td ta="right">{r.total ?? '–'}</Table.Td>
                    <Table.Td ta="right">{r.leach ?? '–'}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
        {parsed.skipped.length > 0 && (
          <Alert color="orange" variant="light" p="xs">
            <Text size="sm">
              Left out – no number beside {parsed.skipped.length === 1 ? 'it' : 'them'}: {parsed.skipped.slice(0, 8).join(', ')}
              {parsed.skipped.length > 8 ? ` and ${parsed.skipped.length - 8} more` : ''}.
            </Text>
          </Alert>
        )}
        <Group grow align="flex-start">
          <Select label="Keep them as" data={[{ value: 'new', label: 'A new set of criteria' }, ...sets.map((g) => ({ value: g.id, label: `Added to “${g.name}”` }))]} value={into} onChange={(v) => setInto(v ?? 'new')} allowDeselect={false} comboboxProps={{ withinPortal: true }} />
          {into === 'new' && <TextInput label="Name" required value={name} onChange={(e) => setName(e.currentTarget.value)} placeholder="e.g. Class 2 landfill" />}
        </Group>
        <TextInput label="Where they’re from" value={source} onChange={(e) => setSource(e.currentTarget.value)} placeholder="The guideline and its table, or the landfill’s consent – for the record" />
        <Group justify="space-between">
          <div>{current && into === current.id && <Text size="xs" c="dimmed">A contaminant already in the set takes the pasted value.</Text>}</div>
          <Group gap="xs">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => void save()} loading={busy} disabled={!parsed.rows.length || (into === 'new' && !name.trim())}>
              Save {parsed.rows.length || ''} {parsed.rows.length === 1 ? 'contaminant' : 'contaminants'}
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}
