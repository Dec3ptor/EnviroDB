// The Compliance tab's limits and triggers at a glance: a row per parameter and level, a column per site, each value
// coloured by how the site did in the period. Hover a value for its rule; click it to change the rule.

import { useMemo } from 'react';
import { Badge, Group, Paper, SegmentedControl, Stack, Table, Text, Tooltip, UnstyledButton } from '@mantine/core';
import type { Parameter, Rule, Site } from '../../db/types';
import type { ProjectBundle } from '../../lib/analysis';
import { describeRule, type Exceedance, type RuleEvaluation } from '../../lib/compliance';
import { formatDate } from '../../lib/dates';
import { limitsTable, type LevelChoice, type LimitCell } from '../../lib/limitsTable';
import { unitLabel } from '../../lib/units';
import { fmtNum } from '../../lib/values';
import { useViewState } from '../../hooks/useViewState';
import { LevelBadge, RuleStatusBadge } from '../../components/common';

type CellStatus = 'exceeded' | 'inconclusive' | 'compliant' | 'no-data';

const STATUS_TEXT: Record<CellStatus, string> = {
  exceeded: 'Exceeded in this period',
  inconclusive: 'Check: detection limit above the value',
  compliant: 'Complied in this period',
  'no-data': 'No results in this period',
};

export function LimitsView({ data, evals, period, onEdit }: { data: ProjectBundle; evals: RuleEvaluation[]; period: { start: string; end: string; label: string }; onEdit: (r: Rule) => void }) {
  const [levels, setLevels] = useViewState<LevelChoice>(`${data.project.id}:compliance.levels`, 'all', (v) => (['all', 'limits', 'triggers'].includes(v) ? v : undefined));
  const sites = useMemo(() => data.sites.filter((s) => s.active), [data.sites]);
  const lt = useMemo(() => limitsTable({ rules: data.rules, params: data.params, setMap: data.setMap }, sites, levels), [data.rules, data.params, data.setMap, sites, levels]);
  const evalMap = useMemo(() => new Map(evals.map((e) => [e.rule.id, e])), [evals]);
  const ruleById = useMemo(() => new Map(data.rules.map((r) => [r.id, r])), [data.rules]);
  // a guideline rule's analytes are "rule|parameter"
  const origin = (r: Rule) => ruleById.get(r.id.split('|')[0]) ?? r;

  const inPeriod = (d: string) => d.slice(0, 10) >= period.start && d.slice(0, 10) <= period.end;
  const hasData = (pid: string, site?: Site) => {
    const m = data.index.byParam.get(pid);
    if (!m) return false;
    return (site ? [m.get(site.id) ?? []] : [...m.values()]).some((list) => list.some((r) => inPeriod(r.date)));
  };
  const statusOf = (cell: LimitCell, p: Parameter, site?: Site): { status: CellStatus; found: Exceedance[] } => {
    const found: Exceedance[] = [];
    let check = false;
    let assessed = false;
    for (const r of cell.rules) {
      const ev = evalMap.get(origin(r).id);
      if (!ev) continue;
      assessed = true;
      const here = (x: Exceedance) => x.parameterId === p.id && (!site || x.siteId === site.id);
      found.push(...ev.exceedances.filter(here));
      if (ev.inconclusive.some(here)) check = true;
    }
    return { status: found.length ? 'exceeded' : check ? 'inconclusive' : assessed && hasData(p.id, site) ? 'compliant' : 'no-data', found };
  };

  const tip = (cell: LimitCell, p: Parameter, site: Site | undefined, st: { status: CellStatus; found: Exceedance[] }) => {
    const rules = [...new Map(cell.rules.map((r) => [origin(r).id, origin(r)])).values()];
    const latest = [...st.found].sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    return (
      <Stack gap={4} maw={340}>
        {rules.map((r) => (
          <div key={r.id}>
            <Text size="xs" fw={600}>
              {r.name}
              {r.condition ? ` – ${r.condition}` : ''}
            </Text>
            <Text size="xs">{describeRule(r, data.paramMap, data.sites, data.setMap)}</Text>
            {r.action && <Text size="xs">Action: {r.action}</Text>}
          </div>
        ))}
        <Text size="xs" fw={600}>
          {site ? `${site.code}: ` : ''}
          {STATUS_TEXT[st.status]}
          {st.found.length ? ` – ${st.found.length} time${st.found.length === 1 ? '' : 's'}` : ''}
        </Text>
        {latest && (
          <Text size="xs">
            Latest: {formatDate(latest.date)}
            {/* a statistic's detail says more than its value ("median 2.6 mg/L of 12 results") */}
            {latest.detail ? `, ${latest.detail}` : latest.value !== null ? `, ${latest.qualifier === '<' ? '<' : ''}${fmtNum(latest.value)} ${unitLabel(latest.unit || p.unit)}` : ''}
          </Text>
        )}
        <Text size="xs" c="dimmed">
          Click to change the rule
        </Text>
      </Stack>
    );
  };

  const cellView = (cell: LimitCell | null, p: Parameter, site?: Site) => {
    if (!cell)
      return (
        <Text size="sm" c="dimmed" ta="center">
          –
        </Text>
      );
    const st = statusOf(cell, p, site);
    const [value, ...rest] = cell.text.split('\n');
    return (
      <Tooltip label={tip(cell, p, site, st)} multiline withArrow openDelay={200} events={{ hover: true, focus: true, touch: true }}>
        <UnstyledButton className={`edb-limit edb-limit-${st.status}`} onClick={() => onEdit(origin(cell.rules[0]))} aria-label={`${p.name}${site ? ` at ${site.code}` : ''}: ${cell.text.replace(/\n/g, ' ')} – ${STATUS_TEXT[st.status]}`}>
          <span className="v">{value}</span>
          {rest.map((line, i) => (
            <span key={i} className="q">
              {line}
            </span>
          ))}
          {st.found.length > 0 && <span className="n">×{st.found.length}</span>}
        </UnstyledButton>
      </Tooltip>
    );
  };

  // a parameter's levels share its name and unit
  const spans = new Map<number, number>();
  lt.rows.forEach((row, i) => {
    if (i && lt.rows[i - 1].param === row.param) return;
    let n = 1;
    while (lt.rows[i + n]?.param === row.param) n++;
    spans.set(i, n);
  });
  const perSite = lt.sites.length > 0;
  const exceededCells = lt.rows.reduce((a, row) => a + row.cells.filter((c, k) => c && statusOf(c, row.param, perSite ? lt.sites[k] : undefined).status === 'exceeded').length, 0);

  return (
    <Stack gap="sm">
      <Group justify="space-between" wrap="wrap" gap="xs">
        <SegmentedControl
          size="xs"
          value={levels}
          onChange={(v) => setLevels(v as LevelChoice)}
          data={[
            { value: 'all', label: 'Limits & triggers' },
            { value: 'limits', label: 'Limits' },
            { value: 'triggers', label: 'Triggers' },
          ]}
        />
        <Group gap={10} wrap="wrap">
          {(['exceeded', 'inconclusive', 'compliant', 'no-data'] as const).map((s) => (
            <Group key={s} gap={4} wrap="nowrap">
              <span className={`edb-limit-key edb-limit-${s}`} />
              <Text size="xs" c="dimmed">
                {s === 'exceeded' ? 'Exceeded' : s === 'inconclusive' ? 'Check DL' : s === 'compliant' ? 'Complied' : 'No results'}
              </Text>
            </Group>
          ))}
          <Text size="xs" c="dimmed">
            · {period.label}
          </Text>
        </Group>
      </Group>
      {!lt.rows.length ? (
        <Paper withBorder p="md">
          <Text size="sm" c="dimmed">
            No {levels === 'limits' ? 'consent limits' : levels === 'triggers' ? 'trigger levels' : 'consent limits or trigger levels'} with a value per parameter yet. Add one with <b>Add rule</b>, or switch to the rules list.
          </Text>
        </Paper>
      ) : (
        <Table.ScrollContainer minWidth={perSite ? 250 + lt.sites.length * 88 : 380} type="native">
          <Table withTableBorder withColumnBorders verticalSpacing={6} horizontalSpacing="sm" className="edb-limits" stickyHeader>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Parameter</Table.Th>
                <Table.Th w={104}>Level</Table.Th>
                {perSite ? (
                  lt.sites.map((s) => (
                    <Table.Th key={s.id} ta="center">
                      <Tooltip label={s.name || s.code} disabled={!s.name} withArrow>
                        <span>{s.code}</span>
                      </Tooltip>
                    </Table.Th>
                  ))
                ) : (
                  <Table.Th ta="center">All sites</Table.Th>
                )}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {lt.rows.map((row, i) => (
                <Table.Tr key={`${row.param.id}|${row.level}`} className={spans.has(i) && i ? 'first' : undefined}>
                  {spans.has(i) && (
                    <Table.Td rowSpan={spans.get(i)} style={{ verticalAlign: 'top' }}>
                      <Text size="sm" fw={500} lh={1.3}>
                        {row.param.name}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {unitLabel(row.param.unit)}
                      </Text>
                    </Table.Td>
                  )}
                  <Table.Td style={{ whiteSpace: 'nowrap' }}>
                    <LevelBadge level={row.level} />
                  </Table.Td>
                  {row.cells.map((c, k) => (
                    <Table.Td key={k} ta="center">
                      {cellView(c, row.param, perSite ? lt.sites[k] : undefined)}
                    </Table.Td>
                  ))}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
      {lt.rows.length > 0 && (
        <Text size="xs" c="dimmed">
          {period.label}: {exceededCells ? `${exceededCells} value${exceededCells === 1 ? '' : 's'} exceeded. ` : 'nothing exceeded. '}
          Values are in each parameter’s unit; brackets say how it is assessed (a statistic, results in a row) – HMTV: hardness-modified for each sample. Hover a value for its rule, click to change it.
        </Text>
      )}
      {lt.other.length > 0 && (
        <Paper withBorder p="sm">
          <Text size="sm" fw={600} mb={6}>
            Also checked
          </Text>
          <Stack gap={6}>
            {lt.other.map((r) => {
              const ev = evalMap.get(r.id);
              return (
                <UnstyledButton key={r.id} onClick={() => onEdit(r)} className="edb-site-row" p={4}>
                  <Group justify="space-between" wrap="nowrap" gap="sm">
                    <div style={{ minWidth: 0 }}>
                      <Group gap={6} wrap="wrap">
                        <LevelBadge level={r.level} />
                        <Text size="sm" fw={500}>
                          {r.name}
                        </Text>
                      </Group>
                      <Text size="xs" c="dimmed">
                        {describeRule(r, data.paramMap, data.sites, data.setMap)}
                      </Text>
                    </div>
                    {ev ? <RuleStatusBadge status={ev.status} size="sm" /> : <Badge color="gray">Inactive</Badge>}
                  </Group>
                </UnstyledButton>
              );
            })}
          </Stack>
        </Paper>
      )}
    </Stack>
  );
}
