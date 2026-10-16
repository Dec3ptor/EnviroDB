import { useState } from 'react';
import { Button, Code, Group, Popover, Select, Stack, TagsInput, Text } from '@mantine/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { IconCalculator } from '@tabler/icons-react';
import { db } from '../../db/db';
import type { CalcStat } from '../../db/types';
import { CALC_STATS, calcToken } from '../../reports/calc';

/**
 * "Insert a calculation": puts a value worked out from the results – {{calc:median:no3-n:DS1}} – where the caret is
 * in a text box (found by its id), to be filled in for each report's period.
 */
export function InsertCalc({ target, value, onChange }: { target: string; value: string; onChange: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [stat, setStat] = useState<CalcStat>('median');
  const [param, setParam] = useState<string | null>(null);
  const [sites, setSites] = useState<string[]>([]);
  const params = useLiveQuery(() => db.parameters.toArray(), [], []);
  const codes = useLiveQuery(async () => [...new Set((await db.sites.toArray()).map((x) => x.code))].sort(), [], []);
  const p = params.find((x) => x.id === param);
  const token = param ? calcToken(stat, param, sites) : '';
  const insert = () => {
    if (!token) return;
    const el = document.getElementById(target) as HTMLTextAreaElement | null;
    if (el) {
      el.focus();
      const at = el.selectionStart ?? value.length;
      const to = el.selectionEnd ?? at;
      onChange(`${value.slice(0, at)}${token}${value.slice(to)}`);
      requestAnimationFrame(() => el.setSelectionRange(at + token.length, at + token.length));
    } else onChange(`${value}${value && !value.endsWith(' ') ? ' ' : ''}${token}`);
    setOpen(false);
  };
  return (
    <Popover opened={open} onChange={setOpen} width={330} position="bottom-start" withArrow shadow="md" trapFocus>
      <Popover.Target>
        <Button size="compact-xs" variant="subtle" leftSection={<IconCalculator size={14} />} onClick={() => setOpen((o) => !o)} style={{ alignSelf: 'flex-start' }}>
          Insert a calculation
        </Button>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="xs">
          <Text size="xs" c="dimmed">
            A value worked out from the results in each report’s period, written into the text.
          </Text>
          <Select size="xs" label="Value" data={Object.entries(CALC_STATS).map(([v, label]) => ({ value: v, label }))} value={stat} onChange={(v) => v && setStat(v as CalcStat)} allowDeselect={false} comboboxProps={{ withinPortal: false }} />
          <Select
            size="xs"
            label="Of"
            placeholder="Parameter"
            data={[...params].sort((a, b) => a.name.localeCompare(b.name)).map((x) => ({ value: x.id, label: x.name }))}
            value={param}
            onChange={setParam}
            searchable
            comboboxProps={{ withinPortal: false }}
          />
          <TagsInput size="xs" label="At sites (codes)" placeholder={sites.length ? '' : 'All sites'} data={codes} value={sites} onChange={setSites} comboboxProps={{ withinPortal: false }} />
          {token && (
            <Text size="xs">
              <Code>{token}</Code> – the {CALC_STATS[stat].toLowerCase()} {p ? (stat === 'count' || stat === 'exceed' ? `for ${p.name}` : p.name) : ''}
              {sites.length ? ` at ${sites.join(', ')}` : ' at all sites'}
              {p?.unit && stat !== 'count' && stat !== 'exceed' ? `, e.g. “0.82 ${p.unit}”` : ''}
            </Text>
          )}
          <Group justify="flex-end">
            <Button size="xs" onClick={insert} disabled={!token}>
              Insert
            </Button>
          </Group>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
