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
import { compileAll, compileFormula, explainFormula, likeParams, typicalGap, type FormulaReport, type InputUse } from '../lib/calculated';
import { FUNCTION_HELP, refText, renameRefs } from '../lib/formula';
import { FORMULA_PRESETS, fillPreset, presetGroups, presetNotes } from '../lib/formulaPresets';
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
  // a ready-made calculation just put in: what to know about it (units changed, inputs still to choose)
  const [preset, setPreset] = useState<{ title: string; about: string; notes: string[]; target?: Parameter } | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (opened && stored !== undefined) setD(draftOf(stored));
    if (!opened) setHelpOpen(false);
    setPreset(null);
  }, [opened, stored?.id]);

  const targetId = stored?.id ?? '__new__';
  const params = useMemo(() => [...(bundle?.params ?? library ?? [])].sort(compareParams), [bundle, library]);
  const target: Parameter = { ...(stored ?? { id: targetId, aliases: [] }), id: targetId, name: d.name, short: d.short.trim() || undefined, group: d.group, unit: d.unit, aliases: d.aliases } as Parameter;
  const formula = d.formula.trim();
  const compiled = formula ? compileFormula(target, params, formula) : null;
  const ok = compiled && !('error' in compiled) ? compiled : null;
  // worked out from itself through other calculated parameters (X from Y, Y from X): caught before it's saved
  const loop = useMemo(() => {
    if (!ok) return null;
    const trial = [...params.filter((p) => p.id !== targetId), { ...target, formula }];
    const why = compileAll(trial).problems.get(targetId);
    if (!why) return null;
    // the parameter it comes back through
    const seen = new Set<string>();
    const reaches = (id: string): boolean => {
      if (id === targetId) return true;
      if (seen.has(id)) return false;
      seen.add(id);
      const p = trial.find((x) => x.id === id);
      const c = p?.formula ? compileFormula(p, trial) : null;
      return !!c && !('error' in c) && [...c.inputs.values()].some(reaches);
    };
    const via = trial.find((p) => p.id !== targetId && [...ok.inputs.values()].includes(p.id) && reaches(p.id));
    return via ? `${via.name} is worked out from ${d.name.trim() || 'this one'} – they can’t each be worked out from the other` : why;
  }, [ok?.formula, params, targetId, d.name, d.short, d.aliases]);
  const problem = compiled && 'error' in compiled ? compiled.error : loop;
  // what it works out in this project (before it's saved) – and why not, when it doesn't
  const report = useMemo(() => {
    if (!bundle || !ok) return null;
    const others = bundle.results.filter((r) => !(r.calc && r.parameterId === targetId));
    return explainFormula([...bundle.samples, ...bundle.qc.samples], others, params, bundle.project.ndHandling, ok);
  }, [bundle, ok?.formula, ok?.param.unit, targetId, params]);
  // how many samples have each parameter here (to offer ones with values)
  const counts = useMemo(() => {
    const by = new Map<string, Set<string>>();
    for (const r of bundle?.results ?? []) {
      if (r.excluded || r.value === null || r.parameterId === targetId) continue;
      let set = by.get(r.parameterId);
      if (!set) by.set(r.parameterId, (set = new Set()));
      set.add(r.sampleId);
    }
    return new Map([...by].map(([id, set]) => [id, set.size]));
  }, [bundle, targetId]);
  // the project's parameters with data (else the library's), to name in a formula or tell an AI about
  const offered = useMemo(() => {
    const withData = bundle ? new Set(bundle.index.paramIdsWithData) : null;
    return params.filter((p) => p.id !== targetId && (!withData || withData.has(p.id)));
  }, [params, bundle, targetId]);
  const insert = (id: string) => {
    const p = params.find((x) => x.id === id);
    if (!p) return;
    const name = refText(p);
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
  /** A ready-made calculation: its formula with the library's parameters, and – for a new parameter – its name, unit and group. */
  const usePreset = (id: string) => {
    const pre = FORMULA_PRESETS.find((x) => x.id === id);
    if (!pre) return;
    const filled = fillPreset(pre, params, (pid) => counts.get(pid) ?? 0, stored?.id);
    const fresh = !stored && !d.name.trim();
    setD({
      ...d,
      formula: filled.formula,
      ...(fresh ? { name: pre.make.name, short: pre.make.short ?? '', unit: pre.make.unit, group: pre.make.group, decimals: pre.make.decimals ?? '' } : {}),
    });
    // the library's own parameter for it: the formula belongs there (it fills in where the lab gave no value)
    const own = !stored && pre.target ? params.find((x) => x.id === pre.target) : undefined;
    setPreset({ title: pre.title, about: pre.about, notes: presetNotes(filled), target: own });
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
    let kept: string[] = [];
    if (stored) {
      saved = { ...stored, ...patch, aliases: d.aliases };
      kept = await saveParameter(saved, stored);
    } else {
      const made = await createParameter(patch.name, patch.unit, patch.group);
      saved = { ...made, ...patch, aliases: [...new Set([...made.aliases, ...d.aliases])] };
      await saveParameter(saved, made);
    }
    const also = kept.length ? ` ${kept.join(', ')} – worked out from it – now name${kept.length === 1 ? 's' : ''} it as ${saved.name}.` : '';
    notifications.show({ color: 'teal', message: `${saved.name} saved${saved.formula ? ' – its values are worked out wherever a sample has what the formula needs' : ''}.${also}` });
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
          error={problem ?? undefined}
        />
        <Group gap="xs" wrap="wrap" mt={-4}>
          <Select size="xs" placeholder="Common calculations…" aria-label="Common calculations" data={presetGroups()} value={null} onChange={(v) => v && usePreset(v)} w={210} maxDropdownHeight={320} comboboxProps={{ withinPortal: true, width: 420, position: 'bottom-start' }} />
          <Select size="xs" placeholder="Insert a parameter…" data={offered.map((p) => ({ value: p.id, label: `${p.name}${unitLabel(p.unit) ? ` (${unitLabel(p.unit)})` : ''}` }))} value={null} onChange={(v) => v && insert(v)} searchable w={240} comboboxProps={{ withinPortal: true }} aria-label="Insert a parameter" />
          <Button size="xs" variant="light" leftSection={<IconCopy size={14} />} onClick={() => void askAi()}>
            Ask an AI…
          </Button>
          <Button size="xs" variant="subtle" leftSection={<IconMathFunction size={14} />} onClick={() => setHelpOpen(!helpOpen)}>
            {helpOpen ? 'Hide the functions' : 'Functions'}
          </Button>
        </Group>
        {preset && (
          <Alert color="blue" variant="light" p="xs" withCloseButton onClose={() => setPreset(null)} title={preset.title}>
            <Text size="xs">{preset.about}</Text>
            {preset.notes.map((n) => (
              <Text size="xs" key={n} mt={2}>
                {n}
              </Text>
            ))}
            {preset.target && (
              <Text size="xs" mt={2}>
                The library has {preset.target.name} already: to fill it in where the lab gave no value, put this formula on it instead (Library → Parameters → {preset.target.name}) – saved here, it becomes a second parameter, so name it apart (“
                {preset.target.name} (calculated)”).
              </Text>
            )}
          </Alert>
        )}
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
        {ok && !loop && ok.inputs.size > 0 && (
          <Stack gap={4}>
            <Text size="xs" fw={600}>
              Works it out from
            </Text>
            {(report?.inputs ?? inputsOf(ok.inputs, params)).map((u) => (
              <InputLine
                key={u.param.id}
                use={u}
                inProject={!!report}
                like={report && !u.samples ? likeParams(u.param, offered.filter((p) => ![...ok.inputs.values()].includes(p.id)), (id) => counts.get(id) ?? 0) : []}
                count={(id) => counts.get(id) ?? 0}
                onSwap={(q) => setD({ ...d, formula: renameRefs(d.formula, u.refs, refText(q)) })}
              />
            ))}
          </Stack>
        )}
        {report && !loop && <Preview report={report} name={d.name.trim() || 'value'} unit={unit} decimals={d.decimals === '' ? undefined : Number(d.decimals)} siteCode={(id) => bundle?.siteMap.get(id)?.code ?? ''} />}
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
          <Button onClick={() => void save()} disabled={!d.name.trim() || !!problem}>
            Save
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/** The parameters a formula uses, without a project to count them in. */
const inputsOf = (inputs: Map<string, string>, params: Parameter[]): InputUse[] => {
  const out: InputUse[] = [];
  for (const [ref, id] of inputs) {
    const there = out.find((u) => u.param.id === id);
    const param = params.find((p) => p.id === id);
    if (there) there.refs.push(ref);
    else if (param) out.push({ param, refs: [ref], samples: 0, otherUnit: 0, otherUnits: [] });
  }
  return out;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const list = (xs: string[], last: string) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} ${last} ${xs[xs.length - 1]}`);

/** One parameter the formula uses: its unit, how many samples here have it – and, when none do, ones that do. */
function InputLine({ use, inProject, like, count, onSwap }: { use: InputUse; inProject: boolean; like: Parameter[]; count: (id: string) => number; onSwap: (p: Parameter) => void }) {
  const unit = unitLabel(use.param.unit);
  const other = use.otherUnits.map((u) => unitLabel(u) || 'no unit').join(', ');
  const none = inProject && !use.samples;
  // written another way than its name: [DO %] = Dissolved Oxygen Saturation
  const alt = use.refs.filter((r) => r.toLowerCase() !== use.param.name.trim().toLowerCase());
  return (
    <div>
      <Text size="xs" c={none ? 'orange.8' : undefined}>
        {alt.length > 0 && <code>{alt.map((r) => `[${r}]`).join(', ')} = </code>}
        <b>{use.param.name}</b>
        {unit ? ` (${unit})` : ''}
        {inProject && (use.samples ? ` – in ${plural(use.samples, 'sample')}` : use.otherUnit ? '' : ' – no values in this project')}
        {inProject && use.otherUnit > 0 && (use.samples ? ` · ${use.otherUnit} more in ${other}, which can’t be changed to ${unit} – not used` : ` – its ${plural(use.otherUnit, 'value')} ${use.otherUnit === 1 ? 'is' : 'are'} in ${other}, which can’t be changed to ${unit}, so ${use.otherUnit === 1 ? 'it isn’t' : 'they aren’t'} used`)}
      </Text>
      {none && (
        <Group gap={4} mt={2} wrap="wrap">
          <Text size="xs" c="dimmed">
            {like.length ? 'Did you mean' : 'Pick the one your values are in from Insert a parameter…'}
          </Text>
          {like.map((q) => (
            <Button key={q.id} size="compact-xs" variant="light" onClick={() => onSwap(q)}>
              {q.name}
              {unitLabel(q.unit) ? ` (${unitLabel(q.unit)})` : ''} – {plural(count(q.id), 'sample')}
            </Button>
          ))}
        </Group>
      )}
    </div>
  );
}

/** What the formula does in this project: how many samples get a value (or why none do), and how close it comes where it's measured too. */
function Preview({ report, name, unit, decimals, siteCode }: { report: FormulaReport; name: string; unit: string; decimals?: number; siteCode: (siteId: string) => string }) {
  const n = report.results.length;
  const kept = report.measured ? `${report.measured} ${report.measured === 1 ? 'has' : 'have'} a measured ${name} – kept` : '';
  const missing = report.inputs.filter((u) => !u.samples);
  const why = missing.length
    ? `no sample has ${list(missing.map((u) => (u.otherUnit ? `${u.param.name} in ${unitLabel(u.param.unit)}` : u.param.name)), 'or')}`
    : report.noAnswer
      ? `it gives no number for the ${plural(report.noAnswer, 'sample')} with what it needs – dividing by 0, or the root or log of a negative?`
      : report.checks.length
        ? `every sample with what it needs has a measured ${name} – kept`
        : report.inputs.length > 1
          ? `no sample has ${list(report.inputs.map((u) => u.param.name), 'and')} together`
          : 'no sample has what it needs';
  const gap = typicalGap(report.checks);
  const far = gap?.share != null && gap.share > 0.15;
  const fmt = (v: number) => fmtNum(v, decimals);
  // its newest values – or, when it gives none, where it's measured too
  const rows = n
    ? [...report.results].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 5).map((r) => ({ key: r.id, siteId: r.siteId, date: r.date, from: r.calc?.from ?? '', value: r.value!, measured: undefined as number | undefined }))
    : [...report.checks].sort((a, b) => (a.sample.date < b.sample.date ? 1 : -1)).slice(0, 5).map((k) => ({ key: k.sample.id, siteId: k.sample.siteId, date: k.sample.date, from: k.from, value: k.worked, measured: k.measured }));
  return (
    <Card withBorder padding="sm">
      <Text size="sm" fw={600}>
        In this project: {n ? `${plural(n, 'sample')} ${n === 1 ? 'gets' : 'get'} a value` : `no sample gets a value – ${why}`}
        {kept && !(n === 0 && !missing.length && !report.noAnswer && report.checks.length) ? ` · ${kept}` : ''}
      </Text>
      {gap && (
        <Text size="xs" mt={4} c={far ? 'orange.8' : 'dimmed'}>
          {report.checks.length === 1
            ? `Where it’s measured too: works out ${fmt(report.checks[0].worked)} ${unit}, measured ${fmt(report.checks[0].measured)} ${unit}`
            : `Where it’s measured too (${report.checks.length} samples): typically within ${fmt(gap.diff)} ${unit}${gap.share != null ? ` (${Math.round(gap.share * 1000) / 10}%)` : ''} of the measured value`}
          {far ? ' – far apart: is the formula using the right parameters?' : ''}
        </Text>
      )}
      {rows.length > 0 && (
        <Table fz="xs" mt={6} withRowBorders={false} verticalSpacing={2}>
          <Table.Tbody>
            {rows.map((r) => (
              <Table.Tr key={r.key}>
                <Table.Td style={{ whiteSpace: 'nowrap' }}>
                  {siteCode(r.siteId)} {formatDate(r.date.slice(0, 10))}
                </Table.Td>
                <Table.Td c="dimmed">{r.from}</Table.Td>
                <Table.Td ta="right" fw={600} style={{ whiteSpace: 'nowrap' }}>
                  {fmt(r.value)} {unit}
                </Table.Td>
                {r.measured !== undefined && (
                  <Table.Td c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                    measured {fmt(r.measured)}
                  </Table.Td>
                )}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Card>
  );
}
