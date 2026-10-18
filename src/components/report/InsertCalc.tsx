import { useState } from 'react';
import { Button, Code, Group, Popover, Select, Stack, TagsInput, Text } from '@mantine/core';
import { IconCalculator } from '@tabler/icons-react';
import type { CalcStat, Parameter } from '../../db/types';
import { useCalcChoices } from './projectChoices';
import { CALC_STATS, calcToken } from '../../reports/calc';

/** Parameters to pick from: a project's by group (field, physical, chemistry …), or all by name. */
export function paramOptions(params: Parameter[], grouped: boolean) {
  if (!grouped) return params.map((x) => ({ value: x.id, label: x.name }));
  const groups = new Map<string, Array<{ value: string; label: string }>>();
  for (const p of params) groups.set(p.group, [...(groups.get(p.group) ?? []), { value: p.id, label: p.name }]);
  return [...groups].map(([group, items]) => ({ group, items }));
}

/**
 * "Insert a calculation": puts a value worked out from the results – {{calc:median:no3-n:DS1}} – where the caret is
 * in a text box (found by its id), to be filled in for each report's period.
 */
export function InsertCalc({ target, value, onChange }: { target: string; value: string; onChange: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [stat, setStat] = useState<CalcStat>('median');
  const [param, setParam] = useState<string | null>(null);
  const [sites, setSites] = useState<string[]>([]);
  // the project's own sites and parameters (all of them in the template library, with no project to go by)
  const { params, codes, project } = useCalcChoices();
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
            data={paramOptions(params, !!project)}
            value={param}
            onChange={setParam}
            searchable
            comboboxProps={{ withinPortal: false }}
          />
          <TagsInput size="xs" label="At sites (codes)" placeholder={sites.length ? '' : 'All sites'} data={codes} value={sites} onChange={setSites} comboboxProps={{ withinPortal: false }} />
          <Text size="xs" c="dimmed">
            {project ? `${project}’s parameters and sites.` : 'Every parameter and site – open a project’s Reports tab (or preview with a project) for just its own.'}
          </Text>
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
