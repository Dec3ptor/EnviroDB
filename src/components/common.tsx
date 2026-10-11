import { type ReactNode, useMemo } from 'react';
import { Badge, Group, Stack, Text, Title, Paper, Select, MultiSelect, ThemeIcon, type MultiSelectProps } from '@mantine/core';
import { DatePickerInput, type DatePickerInputProps } from '@mantine/dates';
import { IconAlertTriangle, IconCircleCheck, IconCircleX, IconHelpCircle, IconMinus } from '@tabler/icons-react';
import type { GuidelineSet, Parameter, Site } from '../db/types';
import { STATUS_META, LEVEL_COLORS, type RuleStatus } from '../lib/compliance';
import { formatDate, makeDate, periodPresets, todayStr, type Period } from '../lib/dates';
import { PARAMETER_GROUPS } from '../data/parameters';

export function PageHeader({ title, description, actions, badge }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; badge?: ReactNode }) {
  return (
    <Group justify="space-between" align="flex-start" mb="md" wrap="wrap" gap="sm">
      <Stack gap={2} style={{ minWidth: 0, flex: '1 1 260px' }}>
        <Group gap="xs" wrap="nowrap">
          <Title order={2} fz={{ base: 20, sm: 24 }} style={{ overflowWrap: 'anywhere' }}>
            {title}
          </Title>
          {badge}
        </Group>
        {description && (
          <Text c="dimmed" size="sm">
            {description}
          </Text>
        )}
      </Stack>
      {actions && <Group gap="xs">{actions}</Group>}
    </Group>
  );
}

export function StatTile({ label, value, sub, color, icon, onClick }: { label: string; value: ReactNode; sub?: ReactNode; color?: string; icon?: ReactNode; onClick?: () => void }) {
  return (
    <Paper withBorder p="md" radius="md" onClick={onClick} style={onClick ? { cursor: 'pointer' } : undefined}>
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Stack gap={4}>
          <Text size="sm" c="dimmed">
            {label}
          </Text>
          <Text fw={650} fz={28} lh={1.1} c={color}>
            {value}
          </Text>
          {sub && (
            <Text size="xs" c="dimmed">
              {sub}
            </Text>
          )}
        </Stack>
        {icon}
      </Group>
    </Paper>
  );
}

const STATUS_ICON: Record<RuleStatus, typeof IconCircleCheck> = {
  compliant: IconCircleCheck,
  exceeded: IconCircleX,
  inconclusive: IconAlertTriangle,
  'no-data': IconMinus,
};

export function RuleStatusBadge({ status, size = 'md' }: { status: RuleStatus; size?: 'sm' | 'md' | 'lg' }) {
  const meta = STATUS_META[status];
  const Icon = STATUS_ICON[status];
  return (
    <Badge color={meta.color} variant={status === 'exceeded' ? 'filled' : 'light'} size={size} leftSection={<Icon size={13} />}>
      {meta.label}
    </Badge>
  );
}

export function LevelBadge({ level }: { level: string }) {
  return (
    <Badge color={LEVEL_COLORS[level] ?? 'gray'} variant="outline" size="sm">
      {level}
    </Badge>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <Paper withBorder p="xl" radius="md">
      <Stack align="center" gap="xs" py="md">
        {icon ?? (
          <ThemeIcon variant="light" size={48} radius="xl">
            <IconHelpCircle size={26} />
          </ThemeIcon>
        )}
        <Text fw={600}>{title}</Text>
        {children && (
          <Text c="dimmed" size="sm" ta="center" maw={520}>
            {children}
          </Text>
        )}
        {action}
      </Stack>
    </Paper>
  );
}

// ------------------------------------------------------------ dates

export function strToDate(s?: string | null): Date | null {
  if (!s) return null;
  return new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
}
export function dateToStr(d: Date | null): string | undefined {
  if (!d) return undefined;
  return makeDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

export function DateField(props: Omit<DatePickerInputProps<'default'>, 'value' | 'onChange' | 'type'> & { value?: string; onChange: (v: string | undefined) => void }) {
  const { value, onChange, ...rest } = props;
  return <DatePickerInput valueFormat="D MMM YYYY" clearable={false} {...rest} value={strToDate(value)} onChange={(d) => onChange(dateToStr(d))} />;
}

export interface PeriodValue {
  key: string;
  start: string;
  end: string;
  label: string;
}

export function usePeriodPresets(yearStartMonth: number, extra: Array<Period & { key: string }> = []) {
  return useMemo(() => [...extra, ...periodPresets(todayStr(), yearStartMonth)], [yearStartMonth, extra]);
}

export function PeriodPicker({ value, onChange, yearStartMonth, extra = [], width = 300 }: { value: PeriodValue; onChange: (v: PeriodValue) => void; yearStartMonth: number; extra?: Array<Period & { key: string }>; width?: number | string }) {
  const presets = usePeriodPresets(yearStartMonth, extra);
  const data = [...presets.map((p) => ({ value: p.key, label: p.label })), { value: 'custom', label: 'Custom range…' }];
  return (
    <Group gap="xs" wrap="wrap">
      <Select
        label="Period"
        data={data}
        value={value.key}
        allowDeselect={false}
        w={width}
        comboboxProps={{ width: 'max-content' }}
        onChange={(k) => {
          if (!k) return;
          if (k === 'custom') onChange({ ...value, key: 'custom', label: `${formatDate(value.start)} – ${formatDate(value.end)}` });
          else {
            const p = presets.find((x) => x.key === k)!;
            onChange({ key: p.key, start: p.start, end: p.end, label: p.label });
          }
        }}
      />
      {value.key === 'custom' && (
        <>
          <DateField label="From" value={value.start} onChange={(v) => v && onChange({ ...value, start: v, label: `${formatDate(v)} – ${formatDate(value.end)}` })} w={150} />
          <DateField label="To" value={value.end} onChange={(v) => v && onChange({ ...value, end: v, label: `${formatDate(value.start)} – ${formatDate(v)}` })} w={150} />
        </>
      )}
    </Group>
  );
}

export function defaultPeriod(yearStartMonth: number, key = 'last12'): PeriodValue {
  const p = periodPresets(todayStr(), yearStartMonth).find((x) => x.key === key)!;
  return { key: p.key, start: p.start, end: p.end, label: p.label };
}

// ------------------------------------------------------------ pickers

export function SitePicker({ sites, value, onChange, label = 'Sites', ...rest }: { sites: Site[]; value: string[]; onChange: (v: string[]) => void; label?: string } & Partial<MultiSelectProps>) {
  return (
    <MultiSelect
      label={label}
      data={sites.map((s) => ({ value: s.id, label: s.name ? `${s.code} – ${s.name}` : s.code }))}
      value={value}
      onChange={onChange}
      placeholder={value.length ? undefined : 'All sites'}
      searchable
      clearable
      maxDropdownHeight={300}
      {...rest}
    />
  );
}

export function paramOptions(params: Parameter[], onlyIds?: Set<string>) {
  const groups = new Map<string, Array<{ value: string; label: string }>>();
  for (const p of params) {
    if (onlyIds && !onlyIds.has(p.id)) continue;
    const g = PARAMETER_GROUPS.includes(p.group) ? p.group : 'Other';
    const list = groups.get(g) ?? [];
    list.push({ value: p.id, label: p.name });
    groups.set(g, list);
  }
  return PARAMETER_GROUPS.filter((g) => groups.has(g)).map((g) => ({ group: g, items: groups.get(g)! }));
}

export function ParamPicker({ params, value, onChange, onlyIds, label = 'Parameters', ...rest }: { params: Parameter[]; value: string[]; onChange: (v: string[]) => void; onlyIds?: Set<string>; label?: string } & Partial<MultiSelectProps>) {
  const data = useMemo(() => paramOptions(params, onlyIds), [params, onlyIds]);
  return <MultiSelect label={label} data={data} value={value} onChange={onChange} searchable clearable placeholder={value.length ? undefined : 'All parameters'} maxDropdownHeight={340} {...rest} />;
}

export function guidelineOptions(sets: GuidelineSet[]) {
  const fam = new Map<string, Array<{ value: string; label: string }>>();
  for (const s of sets) {
    const f = s.builtIn ? s.family ?? 'Other' : 'Custom';
    const list = fam.get(f) ?? [];
    list.push({ value: s.id, label: s.name });
    fam.set(f, list);
  }
  const order = ['Custom', 'ANZG (2018) default guideline values', 'ANZECC (2000) trigger values', 'ANZECC (2000) physical & chemical stressors', 'Drinking water'];
  return Array.from(fam.entries())
    .sort((a, b) => (order.indexOf(a[0]) + 100) % 100 - ((order.indexOf(b[0]) + 100) % 100))
    .map(([group, items]) => ({ group, items }));
}

export function GuidelinePicker({ sets, value, onChange, label = 'Compare with guidelines', ...rest }: { sets: GuidelineSet[]; value: string[]; onChange: (v: string[]) => void; label?: string } & Partial<MultiSelectProps>) {
  const data = useMemo(() => guidelineOptions(sets), [sets]);
  return <MultiSelect label={label} data={data} value={value} onChange={onChange} searchable clearable placeholder={value.length ? undefined : 'None'} maxDropdownHeight={360} {...rest} />;
}
