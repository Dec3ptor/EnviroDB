import { useMemo, useState } from 'react';
import { Alert, Button, Group, Modal, MultiSelect, NumberInput, Paper, Select, SimpleGrid, Stack, Switch, Text, TextInput, Textarea, Autocomplete } from '@mantine/core';
import type { ChangeType, Operator, Rule, RuleKind, StatName, WindowKind } from '../../db/types';
import { RULE_LEVELS } from '../../db/types';
import { useProject } from '../../hooks/useProjectData';
import { paramOptions, guidelineOptions, RuleStatusBadge, DateField } from '../../components/common';
import { describeRule, evaluateRule } from '../../lib/compliance';
import { evalContext } from '../../lib/analysis';
import { COMMON_UNITS } from '../../lib/units';
import { saveRule } from '../../db/repo';

export const KIND_LABELS: Record<RuleKind, string> = {
  threshold: 'Limit on each result',
  statistic: 'Statistical limit (median, percentile, mean…)',
  change: 'Change relative to an upstream / background site',
  consecutive: 'Consecutive results exceeding a level',
  guideline: 'Compare results with a guideline set',
};

const OPS: Array<{ value: Operator; label: string }> = [
  { value: '>', label: 'is greater than (>)' },
  { value: '>=', label: 'is at least (≥)' },
  { value: '<', label: 'is less than (<)' },
  { value: '<=', label: 'is at most (≤)' },
  { value: 'outside', label: 'is outside the range' },
];

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
  const siteData = sites.map((s) => ({ value: s.id, label: s.name ? `${s.code} – ${s.name}` : s.code }));
  const needsParam = r.kind !== 'guideline';
  const valid = !!r.name.trim() && (r.kind === 'guideline' ? !!r.guidelineSetId : !!r.parameterId && (r.operator === 'outside' ? r.min !== undefined || r.max !== undefined : r.value !== undefined)) && (r.kind !== 'change' || !!r.referenceSiteId);

  return (
    <Modal opened onClose={onClose} title={rule && data.rules.some((x) => x.id === rule.id) ? 'Edit rule' : 'New consent rule / trigger'} size="xl">
      <Stack gap="sm">
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <TextInput label="Name" required value={r.name} onChange={(e) => set('name', e.currentTarget.value)} placeholder="e.g. Discharge TSS limit" data-autofocus />
          <TextInput label="Consent condition" value={r.condition ?? ''} onChange={(e) => set('condition', e.currentTarget.value)} placeholder="e.g. Condition 8(a)" />
          <Autocomplete label="Level" data={[...RULE_LEVELS]} value={r.level} onChange={(v) => set('level', v)} description="“Limit” levels show red; others amber" />
        </SimpleGrid>
        <Select label="Type of rule" data={Object.entries(KIND_LABELS).map(([value, label]) => ({ value, label }))} value={r.kind} onChange={(v) => v && set('kind', v as RuleKind)} allowDeselect={false} />

        {needsParam && (
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <Select label="Parameter" required searchable data={paramOptions(params)} value={r.parameterId ?? null} onChange={(v) => setR({ ...r, parameterId: v ?? undefined, unit: v ? data.paramMap.get(v)?.unit : r.unit })} />
            <MultiSelect label={r.kind === 'change' ? 'Sites to test (e.g. downstream)' : 'Applies to sites'} data={siteData} value={r.siteIds} onChange={(v) => set('siteIds', v)} placeholder={r.siteIds.length ? undefined : 'All sites'} clearable />
          </SimpleGrid>
        )}
        {r.kind === 'guideline' && (
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <Select label="Guideline set" required searchable data={guidelineOptions(guidelineSets)} value={r.guidelineSetId ?? null} onChange={(v) => set('guidelineSetId', v ?? undefined)} />
            <MultiSelect label="Applies to sites" data={siteData} value={r.siteIds} onChange={(v) => set('siteIds', v)} placeholder={r.siteIds.length ? undefined : 'All sites'} clearable />
            <Switch label="Hardness-modify hardness-dependent metals (ANZECC 2000)" checked={!!r.hardnessAdjust} onChange={(e) => set('hardnessAdjust', e.currentTarget.checked)} />
          </SimpleGrid>
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
            <Text size="sm" fw={500} mb={6}>
              Exceeded when the {r.kind === 'change' ? 'change' : r.kind === 'statistic' ? 'statistic' : 'result'}…
            </Text>
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
              <Text size="sm">Tests: {describeRule(r, data.paramMap, sites, data.setMap)}</Text>
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
              await saveRule(r, rule ?? undefined);
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
