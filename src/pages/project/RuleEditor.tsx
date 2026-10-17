import { useMemo, useState } from 'react';
import { Alert, Button, Group, Modal, NumberInput, Paper, SegmentedControl, Select, SimpleGrid, Stack, Switch, Text, TextInput, Textarea, Autocomplete } from '@mantine/core';
import type { ChangeType, GuidelineSet, Operator, Rule, RuleKind, StatName, WindowKind } from '../../db/types';
import { RULE_LEVELS } from '../../db/types';
import { useProject } from '../../hooks/useProjectData';
import { paramOptions, guidelineOptions, ParamPicker, SitePicker, RuleStatusBadge, DateField } from '../../components/common';
import { describeRule, evaluateRule, GUIDELINE_LIMIT_KINDS, guidelineLimitValue, thresholdText, withGuidelineLimit } from '../../lib/compliance';
import { describeLimit, guidelineFor } from '../../lib/guidelines';
import { evalContext } from '../../lib/analysis';
import { COMMON_UNITS, convert, unitLabel } from '../../lib/units';
import { fmtNum } from '../../lib/values';
import { saveRule } from '../../db/repo';

export const KIND_LABELS: Record<RuleKind, string> = {
  threshold: 'Limit on each result',
  statistic: 'Statistical limit (median, percentile, mean…)',
  change: 'Change relative to an upstream / background site',
  consecutive: 'Consecutive results exceeding a level',
  guideline: 'Compare results with a guideline set (every analyte or those you choose)',
};

const OPS: Array<{ value: Operator; label: string }> = [
  { value: '>', label: 'is greater than (>)' },
  { value: '>=', label: 'is at least (≥)' },
  { value: '<', label: 'is less than (<)' },
  { value: '<=', label: 'is at most (≤)' },
  { value: 'outside', label: 'is outside the range' },
];

/** A set's value for a parameter, e.g. "8 µg/L", "6.5–8.5", "≥ 6 mg/L" (in `unit` where it converts). */
function setValueText(set: GuidelineSet, parameterId: string, unit: string): string {
  const gv = set.values.find((v) => v.parameterId === parameterId);
  if (!gv) return '';
  const lim = guidelineFor(set, parameterId, unit) ?? guidelineFor(set, parameterId, gv.unit);
  const u = guidelineFor(set, parameterId, unit) ? unit : gv.unit;
  return lim ? `${describeLimit(lim, u)}${gv.hardness ? ' at 30 mg/L hardness' : ''}`.trim() : '';
}

/** Sets that have a value for the parameter, grouped like the guideline picker, and each one's value. */
function setsWithValue(sets: GuidelineSet[], parameterId: string | undefined, unit: string) {
  const having = parameterId ? sets.filter((s) => s.values.some((v) => v.parameterId === parameterId && (v.min !== undefined || v.max !== undefined))) : [];
  const values = new Map(having.map((s) => [s.id, setValueText(s, parameterId!, unit)]));
  return { data: guidelineOptions(having).map((g) => ({ group: g.group, items: g.items.map((o) => ({ value: o.value, label: o.label })) })), values };
}

export function RuleEditor({ rule, onClose, period }: { rule: Rule | null; onClose: () => void; period: { start: string; end: string } }) {
  const data = useProject();
  const { sites, params, guidelineSets } = data;
  const [r, setR] = useState<Rule | null>(rule);
  const set = <K extends keyof Rule>(k: K, v: Rule[K]) => setR((cur) => (cur ? { ...cur, [k]: v } : cur));
  const preview = useMemo(() => {
    if (!r) return null;
    try {
      return evaluateRule({ ...r, active: true }, evalContext(data, period.start, period.end));
    } catch {
      return null;
    }
  }, [r, data, period]);
  if (!r) return null;
  const p = r.parameterId ? data.paramMap.get(r.parameterId) : undefined;
  // the rule as it will be saved: a limit taken from a guideline set filled in
  const eff = withGuidelineLimit(r, data.setMap);
  const limitSets = setsWithValue(guidelineSets, r.parameterId, eff.unit || p?.unit || '');
  const canUseSet = GUIDELINE_LIMIT_KINDS.has(r.kind);
  const fromSet = canUseSet && r.limitSetId !== undefined;
  const limitGv = fromSet ? guidelineLimitValue(r, data.setMap) : undefined;
  const ruleSet = r.kind === 'guideline' && r.guidelineSetId ? data.setMap.get(r.guidelineSetId) : undefined;
  const setParamIds = new Set(ruleSet?.values.map((v) => v.parameterId) ?? []);
  /** Changing the type keeps a guideline choice: one analyte from a set ⇄ a limit at that set's value. */
  const changeKind = (kind: RuleKind) => {
    const next: Rule = { ...r, kind };
    if (kind === 'guideline' && !r.guidelineSetId && r.limitSetId) Object.assign(next, { guidelineSetId: r.limitSetId, parameterIds: r.parameterId ? [r.parameterId] : undefined });
    if (GUIDELINE_LIMIT_KINDS.has(kind) && r.kind === 'guideline' && r.guidelineSetId && r.parameterIds?.length === 1 && !r.parameterId)
      Object.assign(next, { parameterId: r.parameterIds[0], limitSetId: r.guidelineSetId, unit: data.paramMap.get(r.parameterIds[0])?.unit });
    setR(next);
  };
  /** Take the limit from a guideline set: the project's sets first, then any set with a value for the parameter. */
  const takeLimitFromSet = (on: boolean) => {
    if (!on) return setR({ ...eff, limitSetId: undefined, hardnessAdjust: undefined });
    const having = (id: string) => !!r.parameterId && !!data.setMap.get(id)?.values.some((v) => v.parameterId === r.parameterId);
    const first = data.project.guidelineSetIds.find(having) ?? guidelineSets.find((s) => having(s.id))?.id ?? '';
    setR({ ...r, limitSetId: first });
  };
  const siteData = sites.map((s) => ({ value: s.id, label: s.name ? `${s.code} – ${s.name}` : s.code }));
  const needsParam = r.kind !== 'guideline';
  const valid =
    !!r.name.trim() &&
    (r.kind === 'guideline'
      ? !!r.guidelineSetId
      : !!r.parameterId && (fromSet ? !!limitGv : eff.operator === 'outside' ? eff.min !== undefined || eff.max !== undefined : eff.value !== undefined)) &&
    (r.kind !== 'change' || !!r.referenceSiteId);

  return (
    <Modal opened onClose={onClose} title={rule && data.rules.some((x) => x.id === rule.id) ? 'Edit rule' : 'New consent rule / trigger'} size="xl">
      <Stack gap="sm">
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <TextInput label="Name" required value={r.name} onChange={(e) => set('name', e.currentTarget.value)} placeholder="e.g. Discharge TSS limit" data-autofocus />
          <TextInput label="Consent condition" value={r.condition ?? ''} onChange={(e) => set('condition', e.currentTarget.value)} placeholder="e.g. Condition 8(a)" />
          <Autocomplete label="Level" data={[...RULE_LEVELS]} value={r.level} onChange={(v) => set('level', v)} description="“Limit” levels show red; others amber" />
        </SimpleGrid>
        <Select label="Type of rule" data={Object.entries(KIND_LABELS).map(([value, label]) => ({ value, label }))} value={r.kind} onChange={(v) => v && changeKind(v as RuleKind)} allowDeselect={false} />

        {needsParam && (
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <Select label="Parameter" required searchable data={paramOptions(params)} value={r.parameterId ?? null} onChange={(v) => setR({ ...r, parameterId: v ?? undefined, unit: v ? data.paramMap.get(v)?.unit : r.unit })} />
            <SitePicker label={r.kind === 'change' ? 'Sites to test (e.g. downstream)' : 'Applies to sites'} sites={sites} value={r.siteIds} onChange={(v) => set('siteIds', v)} />
          </SimpleGrid>
        )}
        {r.kind === 'guideline' && (
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <Select
              label="Guideline set"
              required
              searchable
              data={guidelineOptions(guidelineSets)}
              value={r.guidelineSetId ?? null}
              onChange={(v) => {
                const values = new Set(v ? data.setMap.get(v)?.values.map((x) => x.parameterId) : []);
                setR({ ...r, guidelineSetId: v ?? undefined, parameterIds: r.parameterIds?.filter((id) => values.has(id)) });
              }}
            />
            <SitePicker label="Applies to sites" sites={sites} value={r.siteIds} onChange={(v) => set('siteIds', v)} />
            <ParamPicker
              label="Analytes to compare"
              params={params}
              onlyIds={setParamIds}
              value={r.parameterIds ?? []}
              onChange={(v) => set('parameterIds', v.length ? v : undefined)}
              placeholder={ruleSet ? `Every analyte in the set (${setParamIds.size})` : 'Choose a guideline set first'}
              disabled={!ruleSet}
              description="Only these analytes are compared with the set"
            />
            <Switch mt={{ sm: 30 }} label="Hardness-modify hardness-dependent metals (ANZECC 2000)" checked={!!r.hardnessAdjust} onChange={(e) => set('hardnessAdjust', e.currentTarget.checked)} />
          </SimpleGrid>
        )}
        {ruleSet && !!r.parameterIds?.length && (
          <Text size="xs" c="dimmed">
            {ruleSet.shortName} values:{' '}
            {r.parameterIds
              .map((id) => {
                const pp = data.paramMap.get(id);
                return pp ? `${pp.name} ${setValueText(ruleSet, id, pp.unit)}` : '';
              })
              .filter(Boolean)
              .join('; ')}
          </Text>
        )}

        {r.kind === 'change' && (
          <SimpleGrid cols={{ base: 1, sm: 3 }}>
            <Select label="Reference site (upstream / background)" required data={siteData} value={r.referenceSiteId ?? null} onChange={(v) => set('referenceSiteId', v ?? undefined)} />
            <Select
              label="Measure"
              data={[
                { value: 'percent', label: 'Percentage increase (%)' },
                { value: 'absolute', label: 'Increase (site − reference)' },
                { value: 'abs-diff', label: 'Change either way |site − reference|' },
              ]}
              value={r.changeType ?? 'percent'}
              onChange={(v) => set('changeType', (v ?? 'percent') as ChangeType)}
              allowDeselect={false}
            />
            <NumberInput label="Pair samples taken within (days)" min={0} max={30} value={r.pairingDays ?? 0} onChange={(v) => set('pairingDays', Number(v) || 0)} description="0 = same day" />
          </SimpleGrid>
        )}

        {r.kind === 'statistic' && (
          <SimpleGrid cols={{ base: 1, sm: 4 }}>
            <Select
              label="Statistic"
              data={[
                { value: 'median', label: 'Median' },
                { value: 'percentile', label: 'Percentile' },
                { value: 'mean', label: 'Mean' },
                { value: 'geomean', label: 'Geometric mean' },
                { value: 'max', label: 'Maximum' },
                { value: 'min', label: 'Minimum' },
              ]}
              value={r.statistic ?? 'median'}
              onChange={(v) => set('statistic', (v ?? 'median') as StatName)}
              allowDeselect={false}
            />
            {r.statistic === 'percentile' && <NumberInput label="Percentile" min={1} max={99} value={r.percentile ?? 95} onChange={(v) => set('percentile', Number(v) || 95)} />}
            <Select
              label="Over"
              data={[
                { value: 'period', label: 'The reporting period' },
                { value: 'year', label: 'Each reporting year' },
                { value: 'rolling-days', label: 'Rolling number of days' },
                { value: 'rolling-samples', label: 'Rolling number of samples' },
              ]}
              value={r.window ?? 'period'}
              onChange={(v) => set('window', (v ?? 'period') as WindowKind)}
              allowDeselect={false}
            />
            {(r.window === 'rolling-days' || r.window === 'rolling-samples') && (
              <NumberInput label={r.window === 'rolling-days' ? 'Days' : 'Samples'} min={2} value={r.windowSize ?? (r.window === 'rolling-days' ? 365 : 12)} onChange={(v) => set('windowSize', Number(v) || undefined)} />
            )}
            <NumberInput label="Minimum samples" min={1} value={r.minSamples ?? 1} onChange={(v) => set('minSamples', Number(v) || 1)} />
          </SimpleGrid>
        )}

        {r.kind === 'consecutive' && <NumberInput label="Number of consecutive results" min={2} max={12} value={r.consecutive ?? 2} onChange={(v) => set('consecutive', Number(v) || 2)} w={260} />}

        {r.kind !== 'guideline' && (
          <Paper withBorder p="sm" radius="md">
            <Group justify="space-between" gap="xs" mb={8}>
              <Text size="sm" fw={500}>
                {fromSet ? 'The limit' : `Exceeded when the ${r.kind === 'change' ? 'change' : r.kind === 'statistic' ? 'statistic' : 'result'}…`}
              </Text>
              {canUseSet && (
                <SegmentedControl
                  size="xs"
                  data={[
                    { value: 'typed', label: 'A value you enter' },
                    { value: 'set', label: 'A guideline value' },
                  ]}
                  value={fromSet ? 'set' : 'typed'}
                  onChange={(v) => takeLimitFromSet(v === 'set')}
                />
              )}
            </Group>
            {fromSet ? (
              <Stack gap="xs">
                <Group align="flex-end" gap="sm" wrap="wrap">
                  <Select
                    label="Guideline value from"
                    searchable
                    w={{ base: '100%', sm: 420 }}
                    data={limitSets.data}
                    renderOption={({ option }) => (
                      <div>
                        <Text size="sm">{option.label}</Text>
                        <Text size="xs" c="dimmed">
                          {limitSets.values.get(option.value)}
                        </Text>
                      </div>
                    )}
                    maxDropdownHeight={360}
                    value={r.limitSetId || null}
                    onChange={(v) => setR({ ...r, limitSetId: v ?? '' })}
                    placeholder={r.parameterId ? 'Choose a guideline set' : 'Choose the parameter first'}
                    nothingFoundMessage="No guideline set has a value for this parameter"
                    disabled={!r.parameterId}
                  />
                  <Autocomplete label="Unit" data={COMMON_UNITS} value={eff.unit ?? p?.unit ?? ''} onChange={(v) => set('unit', v)} w={150} />
                </Group>
                {limitGv ? (
                  <Text size="sm">
                    Exceeded when the {r.kind === 'statistic' ? 'statistic' : 'result'} is <b>{thresholdText(eff, eff.unit ?? '')}</b>
                    {limitGv.hardness && r.kind !== 'statistic' && eff.hardnessAdjust ? ', modified for each sample’s hardness' : ''}.
                  </Text>
                ) : (
                  <Text size="sm" c="red">
                    {r.parameterId ? (r.limitSetId ? 'That guideline set has no value for this parameter – choose another.' : 'Choose a guideline set.') : 'Choose the parameter first.'}
                  </Text>
                )}
                {limitGv?.hardness && r.kind !== 'statistic' && (
                  <Switch
                    label="Hardness-modify for each sample (ANZECC 2000)"
                    description={`Off: the value at 30 mg/L hardness, ${fmtNum(limitGv.max !== undefined ? convert(limitGv.max, limitGv.unit, eff.unit ?? limitGv.unit) ?? limitGv.max : undefined)} ${unitLabel(eff.unit ?? limitGv.unit)}, for every sample`}
                    checked={!!r.hardnessAdjust}
                    onChange={(e) => set('hardnessAdjust', e.currentTarget.checked)}
                  />
                )}
              </Stack>
            ) : (
            <Group align="flex-end" gap="sm" wrap="wrap">
              <Select data={OPS.filter((o) => r.kind !== 'change' || o.value !== 'outside')} value={r.operator} onChange={(v) => v && set('operator', v as Operator)} w={230} allowDeselect={false} />
              {r.operator === 'outside' ? (
                <>
                  <NumberInput label="Minimum" value={r.min ?? ''} onChange={(v) => set('min', v === '' ? undefined : Number(v))} w={130} decimalScale={6} />
                  <NumberInput label="Maximum" value={r.max ?? ''} onChange={(v) => set('max', v === '' ? undefined : Number(v))} w={130} decimalScale={6} />
                </>
              ) : (
                <NumberInput label={r.changeType === 'percent' && r.kind === 'change' ? 'Percent' : 'Value'} value={r.value ?? ''} onChange={(v) => set('value', v === '' ? undefined : Number(v))} w={150} decimalScale={6} />
              )}
              {!(r.kind === 'change' && r.changeType === 'percent') && (
                <Autocomplete label="Unit" data={COMMON_UNITS} value={r.unit ?? p?.unit ?? ''} onChange={(v) => set('unit', v)} w={150} description={p && r.unit && r.unit !== p.unit ? `Results converted from ${p.unit}` : undefined} />
              )}
            </Group>
            )}
          </Paper>
        )}

        <Textarea label="Required action if triggered" autosize minRows={2} value={r.action ?? ''} onChange={(e) => set('action', e.currentTarget.value)} placeholder="e.g. Notify the Council within 24 hours and re-sample within 7 days" />
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <DateField label="Effective from" value={r.effectiveFrom} onChange={(v) => set('effectiveFrom', v)} clearable placeholder="Always" />
          <DateField label="Effective to" value={r.effectiveTo} onChange={(v) => set('effectiveTo', v)} clearable placeholder="Ongoing" />
          <Switch mt={28} label="Active" checked={r.active} onChange={(e) => set('active', e.currentTarget.checked)} />
        </SimpleGrid>

        {valid && preview && (
          <Alert variant="light" color={preview.status === 'exceeded' ? 'red' : preview.status === 'compliant' ? 'green' : 'gray'} title="Preview for the selected period">
            <Stack gap={4}>
              <Text size="sm">Tests: {describeRule(eff, data.paramMap, sites, data.setMap)}</Text>
              <Group gap="xs">
                <RuleStatusBadge status={preview.status} size="sm" />
                <Text size="sm">{preview.summary}</Text>
              </Group>
            </Stack>
          </Alert>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!valid}
            onClick={async () => {
              await saveRule(eff, rule ?? undefined);
              onClose();
            }}
          >
            Save rule
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
