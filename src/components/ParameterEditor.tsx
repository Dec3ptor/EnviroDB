// One parameter, to make or change – from the Data tab or the Library: its name, unit and group, the names labs use
// for it, and (optionally) a formula working it out from the sample's other values. The formula is checked as it's
// typed and its values shown before it's saved; an AI can write it (Ask an AI copies what it needs to know).

import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Autocomplete, Button, Card, Divider, Group, Modal, NumberInput, Select, Stack, Table, TagsInput, Text, Textarea, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useLiveQuery } from 'dexie-react-hooks';
import { IconCopy, IconMathFunction } from '@tabler/icons-react';
import { db } from '../db/db';
import type { Parameter } from '../db/types';
import { createParameter, saveParameter } from '../db/repo';
import { compareParams, PARAMETER_GROUPS } from '../data/parameters';
import { COMMON_UNITS, unitLabel } from '../lib/units';
import { calculatedResults, compileFormula } from '../lib/calculated';
import { FUNCTION_HELP } from '../lib/formula';
import { formulaPrompt } from '../lib/formulaPrompt';
import type { ProjectData } from '../hooks/useProjectData';
import { fmtNum } from '../lib/values';
import { formatDate } from '../lib/dates';
import { MoreOptions } from './common';

interface Draft {
  name: string;
  short: string;
  group: string;
  unit: string;
  decimals: number | '';
  aliases: string[];
  formula: string;
}

const draftOf = (p?: Parameter | null): Draft => ({ name: p?.name ?? '', short: p?.short ?? '', group: p?.group ?? 'Other', unit: p?.unit ?? 'mg/L', decimals: p?.decimals ?? '', aliases: p?.aliases ?? [], formula: p?.formula ?? '' });

/**
 * `paramId`: the parameter to change (none: a new one). `bundle`: the project it's opened from – its parameters are
 * offered first, and the formula's values in it shown.
 */
export function ParameterEditor({ opened, paramId, bundle, onClose, onSaved }: { opened: boolean; paramId?: string | null; bundle?: ProjectData; onClose: () => void; onSaved?: (p: Parameter) => void }) {
  // the library's own record (a project shows units its own way)
  const stored = useLiveQuery(async () => (paramId ? ((await db.parameters.get(paramId)) ?? null) : null), [paramId]);
  const library = useLiveQuery(() => db.parameters.toArray(), []);
  const [d, setD] = useState<Draft>(draftOf(null));
  const [helpOpen, setHelpOpen] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (opened && stored !== undefined) setD(draftOf(stored));
    if (!opened) setHelpOpen(false);
  }, [opened, stored?.id]);

  const targetId = stored?.id ?? '__new__';
  const params = useMemo(() => [...(bundle?.params ?? library ?? [])].sort(compareParams), [bundle, library]);
  const target: Parameter = { ...(stored ?? { id: targetId, aliases: [] }), id: targetId, name: d.name, group: d.group, unit: d.unit, aliases: d.aliases } as Parameter;
  const formula = d.formula.trim();
  const compiled = formula ? compileFormula(target, params, formula) : null;
  const ok = compiled && !('error' in compiled) ? compiled : null;
  // what it works out in this project (before it's saved)
  const preview = useMemo(() => {
    if (!bundle || !ok) return null;
    const others = bundle.results.filter((r) => !(r.calc && r.parameterId === targetId));
    const out = calculatedResults([...bundle.samples, ...bundle.qc.samples], others, params, bundle.project.ndHandling, [ok]);
    const measured = new Set(bundle.results.filter((r) => r.parameterId === targetId && !r.calc).map((r) => r.sampleId)).size;
    return { n: out.length, measured, examples: [...out].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 5) };
  }, [bundle, ok?.formula, targetId, params]);
  // the project's parameters with data (else the library's), to name in a formula or tell an AI about
  const offered = useMemo(() => {
    const withData = bundle ? new Set(bundle.index.paramIdsWithData) : null;
    return params.filter((p) => p.id !== targetId && (!withData || withData.has(p.id)));
  }, [params, bundle, targetId]);

  const insert = (name: string) => {
    const el = box.current;
    const at = el?.selectionStart ?? d.formula.length;
    const end = el?.selectionEnd ?? at;
    const next = `${d.formula.slice(0, at)}[${name}]${d.formula.slice(end)}`;
    setD({ ...d, formula: next });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + name.length + 2, at + name.length + 2);
    });
  };
  const askAi = async () => {
    try {
      await navigator.clipboard.writeText(formulaPrompt({ name: d.name, unit: d.unit }, offered));
      notifications.show({ color: 'teal', title: 'Copied for an AI', message: 'Paste it into an AI (Copilot, ChatGPT, Claude …), say what you want worked out, and paste the formula it gives back into Formula. Only parameter names and units are in it.', autoClose: 9000 });
    } catch {
      notifications.show({ color: 'red', message: 'It couldn’t be copied – the browser didn’t allow it.' });
    }
  };
  const save = async () => {
    const patch = { name: d.name.trim(), short: d.short.trim() || undefined, group: d.group, unit: d.unit.trim(), decimals: d.decimals === '' ? undefined : Number(d.decimals), formula: formula || undefined };
    let saved: Parameter;
    if (stored) {
      saved = { ...stored, ...patch, aliases: d.aliases };
      await saveParameter(saved, stored);
    } else {
      const made = await createParameter(patch.name, patch.unit, patch.group);
      saved = { ...made, ...patch, aliases: [...new Set([...made.aliases, ...d.aliases])] };
      await saveParameter(saved, made);
    }
    notifications.show({ color: 'teal', message: `${saved.name} saved${saved.formula ? ' – its values are worked out wherever a sample has what the formula needs' : ''}.` });
    onSaved?.(saved);
    onClose();
  };
  const unit = unitLabel(d.unit);
  return (
    <Modal opened={opened} onClose={onClose} title={stored ? `Parameter: ${stored.name}` : 'New parameter'} size="lg">
      <Stack gap="sm">
        <Group grow align="flex-start">
          <TextInput label="Name" required value={d.name} onChange={(e) => setD({ ...d, name: e.currentTarget.value })} data-autofocus placeholder="e.g. Dissolved Oxygen (calculated)" />
          <TextInput label="Short name" value={d.short} onChange={(e) => setD({ ...d, short: e.currentTarget.value })} placeholder="For table headings" maw={180} />
        </Group>
        <Group grow align="flex-start">
          <Select label="Group" data={PARAMETER_GROUPS} value={d.group} onChange={(v) => v && setD({ ...d, group: v })} allowDeselect={false} />
          <Autocomplete label="Unit" data={COMMON_UNITS} value={d.unit} onChange={(v) => setD({ ...d, unit: v })} />
          <NumberInput label="Decimals" value={d.decimals} onChange={(v) => setD({ ...d, decimals: v === '' ? '' : Number(v) })} min={0} max={6} placeholder="auto" hideControls maw={110} />
        </Group>
        <MoreOptions label="Other names" summary={d.aliases.length ? `${d.aliases.length} – as lab files call it` : 'As lab files call it'}>
          <TagsInput value={d.aliases} onChange={(v) => setD({ ...d, aliases: v })} maxTags={200} description="New ones are added as you match names during an import." />
        </MoreOptions>
        <Divider label="Calculated (optional)" labelPosition="left" />
        <Text size="sm" c="dimmed" mt={-6}>
          Worked out from the sample’s other values, wherever it has what the formula needs and no {d.name.trim() || 'value'} of its own.
        </Text>
        <Textarea
          ref={box}
          label="Formula"
          autosize
          minRows={2}
          value={d.formula}
          onChange={(e) => setD({ ...d, formula: e.currentTarget.value })}
          placeholder="e.g. [DO %] / 100 * DO_SAT([Temperature])"
          styles={{ input: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' } }}
          error={compiled && 'error' in compiled ? compiled.error : undefined}
        />
        <Group gap="xs" wrap="wrap" mt={-4}>
          <Select size="xs" placeholder="Insert a parameter…" data={offered.map((p) => ({ value: p.name, label: `${p.name}${unitLabel(p.unit) ? ` (${unitLabel(p.unit)})` : ''}` }))} value={null} onChange={(v) => v && insert(v)} searchable w={240} comboboxProps={{ withinPortal: true }} aria-label="Insert a parameter" />
          <Button size="xs" variant="light" leftSection={<IconCopy size={14} />} onClick={() => void askAi()}>
            Ask an AI…
          </Button>
          <Button size="xs" variant="subtle" leftSection={<IconMathFunction size={14} />} onClick={() => setHelpOpen(!helpOpen)}>
            {helpOpen ? 'Hide the functions' : 'Functions'}
          </Button>
        </Group>
        {helpOpen && (
          <Card withBorder padding="xs">
            <Text size="xs" mb={4}>
              Parameters in square brackets – <code>[Temperature]</code> – each the sample’s value in its own unit; numbers, <code>+ - * / ^</code> and brackets. The answer is in {unit || 'this parameter’s unit'}.
            </Text>
            {FUNCTION_HELP.map((h) => (
              <Text size="xs" c="dimmed" key={h}>
                {h}
              </Text>
            ))}
          </Card>
        )}
        {ok && (
          <Text size="xs" c="teal">
            Works it out from {[...new Set(ok.inputs.values())].map((id) => params.find((p) => p.id === id)?.name ?? id).join(', ')}.
          </Text>
        )}
        {preview && (
          <Card withBorder padding="sm">
            <Text size="sm" fw={600}>
              In this project: {preview.n ? `${preview.n} sample${preview.n === 1 ? ' gets' : 's get'} a value` : 'no sample has what it needs'}
              {preview.measured ? ` · ${preview.measured} ${preview.measured === 1 ? 'has' : 'have'} a measured one – kept` : ''}
            </Text>
            {preview.examples.length > 0 && (
              <Table fz="xs" mt={6} withRowBorders={false} verticalSpacing={2}>
                <Table.Tbody>
                  {preview.examples.map((r) => (
                    <Table.Tr key={r.id}>
                      <Table.Td style={{ whiteSpace: 'nowrap' }}>
                        {bundle?.siteMap.get(r.siteId)?.code} {formatDate(r.date.slice(0, 10))}
                      </Table.Td>
                      <Table.Td c="dimmed">{r.calc?.from}</Table.Td>
                      <Table.Td ta="right" fw={600} style={{ whiteSpace: 'nowrap' }}>
                        {fmtNum(r.value, d.decimals === '' ? undefined : Number(d.decimals))} {unit}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )}
          </Card>
        )}
        {formula && stored?.formula && formula !== stored.formula && (
          <Alert variant="light" color="blue" p="xs">
            <Text size="xs">The values worked out change with the formula. Nothing measured changes.</Text>
          </Alert>
        )}
        <Text size="xs" c="dimmed">
          Calculated values are worked out as the data is shown – never saved over your data. A measured value always wins, and clearing the formula takes them away. Parameters are shared by all projects.
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={!d.name.trim() || !!(compiled && 'error' in compiled)}>
            Save
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
