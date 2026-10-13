import { useEffect, useMemo, useState } from 'react';
import { ActionIcon, Autocomplete, Button, Card, Group, NumberInput, Pagination, Select, Table, TagsInput, Text, TextInput } from '@mantine/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { IconDeviceFloppy, IconPlus, IconSearch } from '@tabler/icons-react';
import { db } from '../db/db';
import type { Parameter } from '../db/types';
import { createParameter, saveParameter } from '../db/repo';
import { PARAMETER_GROUPS, compareParams } from '../data/parameters';
import { COMMON_UNITS } from '../lib/units';
import { PageHeader } from '../components/common';
import { useEditable } from '../hooks/useEditable';

// The analyte dictionary: every parameter's name, group, unit and the other names it goes by in lab files.

function ParamRow({ p }: { p: Parameter }) {
  const [d, setD, { dirty, reset }] = useEditable(p);
  return (
    <Table.Tr>
      <Table.Td>
        <TextInput size="xs" value={d.name} onChange={(e) => setD({ ...d, name: e.currentTarget.value })} miw={200} />
      </Table.Td>
      <Table.Td>
        <TextInput size="xs" value={d.short ?? ''} onChange={(e) => setD({ ...d, short: e.currentTarget.value || undefined })} w={90} />
      </Table.Td>
      <Table.Td>
        <Select size="xs" data={PARAMETER_GROUPS} value={d.group} onChange={(v) => v && setD({ ...d, group: v })} w={150} allowDeselect={false} />
      </Table.Td>
      <Table.Td>
        <Autocomplete size="xs" data={COMMON_UNITS} value={d.unit} onChange={(v) => setD({ ...d, unit: v })} w={100} />
      </Table.Td>
      <Table.Td>
        <TagsInput size="xs" value={d.aliases} onChange={(v) => setD({ ...d, aliases: v })} maxTags={200} miw={260} />
      </Table.Td>
      <Table.Td>
        <NumberInput size="xs" value={d.decimals ?? ''} onChange={(v) => setD({ ...d, decimals: v === '' ? undefined : Number(v) })} w={60} min={0} max={6} hideControls placeholder="auto" />
      </Table.Td>
      <Table.Td>
        <ActionIcon disabled={!dirty} variant={dirty ? 'filled' : 'subtle'} onClick={() => saveParameter(d, p).then(reset)} aria-label="Save">
          <IconDeviceFloppy size={16} />
        </ActionIcon>
      </Table.Td>
    </Table.Tr>
  );
}

export function ParametersPage() {
  const params = useLiveQuery(() => db.parameters.toArray(), []);
  const [q, setQ] = useState('');
  const [group, setGroup] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const list = useMemo(
    () =>
      (params ?? [])
        .filter((p) => (!group || p.group === group) && (!q || [p.name, p.short, p.id, ...p.aliases].join(' ').toLowerCase().includes(q.toLowerCase())))
        .sort(compareParams),
    [params, q, group],
  );
  useEffect(() => setPage(1), [q, group]);
  const per = 25;
  const shown = list.slice((page - 1) * per, page * per);
  const add = async () => {
    const p = await createParameter('New parameter', 'mg/L', 'Other');
    setQ(p.name);
  };
  return (
    <>
      <PageHeader
        title="Parameters"
        description="The analyte dictionary shared by all projects. Aliases are the names used in lab files and spreadsheets; new ones you match during import are added automatically."
        actions={
          <Button leftSection={<IconPlus size={16} />} onClick={add}>
            Add parameter
          </Button>
        }
      />
      <Card>
      <Group mb="sm">
        <TextInput leftSection={<IconSearch size={14} />} placeholder="Search names and aliases" value={q} onChange={(e) => setQ(e.currentTarget.value)} w={280} />
        <Select data={PARAMETER_GROUPS} value={group} onChange={setGroup} placeholder="All groups" clearable w={200} />
        <Text size="sm" c="dimmed">
          {list.length} parameters
        </Text>
      </Group>
      <Table.ScrollContainer minWidth={1000}>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Name</Table.Th>
              <Table.Th>Short</Table.Th>
              <Table.Th>Group</Table.Th>
              <Table.Th>Unit</Table.Th>
              <Table.Th>Aliases</Table.Th>
              <Table.Th>Decimals</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {shown.map((p) => (
              <ParamRow key={`${p.id}-${p.aliases.length}-${p.unit}-${p.name}`} p={p} />
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {list.length > per && <Pagination mt="sm" total={Math.ceil(list.length / per)} value={page} onChange={setPage} size="sm" />}
      </Card>
    </>
  );
}
