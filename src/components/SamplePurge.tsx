// A bore's purge, in its sample's details: what was taken out before it was sampled, and the readings as it settled –
// as the phone recorded them at the bore.

import { Badge, Group, Stack, Table, Text } from '@mantine/core';
import type { Parameter, Sample } from '../db/types';
import { STABLE_RULES, purgeProgress, purgeSummary, ruleText, stability } from '../lib/purge';

const n1 = (v: number) => (Math.round(v * 10) / 10).toString();

export function SamplePurge({ sample, paramMap }: { sample: Pick<Sample, 'purge'>; paramMap: Map<string, Pick<Parameter, 'name' | 'short' | 'unit'>> }) {
  const log = sample.purge;
  if (!log) return null;
  const rules = log.rules ?? STABLE_RULES;
  const p = purgeProgress(log);
  const s = stability(log.readings, rules);
  // the readings' columns: every parameter any reading has, in the criteria's order, then the rest
  const ids = [...new Set(log.readings.flatMap((r) => Object.keys(r.values)))];
  const order = (id: string) => (rules.findIndex((r) => r.id === id) + 1 || 99);
  ids.sort((a, b) => order(a) - order(b));
  const head = (id: string) => rules.find((r) => r.id === id)?.label ?? paramMap.get(id)?.short ?? paramMap.get(id)?.name ?? id;
  const anyLevel = log.readings.some((r) => r.level !== undefined);
  return (
    <Stack gap={4}>
      <Group gap="xs">
        <Text fw={600} size="sm">
          Purge
        </Text>
        {s.enough && (
          <Badge size="xs" variant="light" color={s.stable ? 'teal' : 'orange'}>
            {s.stable ? 'Readings settled' : 'Not settled when sampled'}
          </Badge>
        )}
      </Group>
      <Text size="sm">{purgeSummary(log) || 'Recorded at the bore.'}</Text>
      {(log.depth !== undefined || log.swl !== undefined || log.diameter !== undefined) && (
        <Text size="xs" c="dimmed">
          {[log.depth !== undefined ? `bore ${log.depth} m deep` : '', log.swl !== undefined ? `water at ${log.swl} m` : '', log.diameter !== undefined ? `${log.diameter} mm casing` : '', p.casing !== null ? `${n1(p.casing)} L in the casing` : '']
            .filter(Boolean)
            .join(' · ')
            .replace(/^./, (c) => c.toUpperCase())}
        </Text>
      )}
      {log.readings.length > 0 && (
        <Table.ScrollContainer minWidth={300}>
          <Table verticalSpacing={3} horizontalSpacing={6} fz="xs" withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Time</Table.Th>
                <Table.Th ta="right">Litres out</Table.Th>
                {anyLevel && <Table.Th ta="right">Water at (m)</Table.Th>}
                {ids.map((id) => (
                  <Table.Th key={id} ta="right">
                    {head(id)}
                  </Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {log.readings.map((r, i) => (
                <Table.Tr key={i}>
                  <Table.Td>{r.time}</Table.Td>
                  <Table.Td ta="right">{r.litres ?? ''}</Table.Td>
                  {anyLevel && <Table.Td ta="right">{r.level ?? ''}</Table.Td>}
                  {ids.map((id) => (
                    <Table.Td key={id} ta="right">
                      {r.values[id] ?? ''}
                    </Table.Td>
                  ))}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
      {s.enough && (
        <Text size="xs" c="dimmed">
          The last three readings: {s.checks.map((c) => `${c.label} ${c.ok ? '✓' : '✗'} (${ruleText(rules.find((r) => r.id === c.id)!)})`).join(', ')}
          {log.rules ? ' – by the criteria set on the phone' : ''}.
        </Text>
      )}
    </Stack>
  );
}
