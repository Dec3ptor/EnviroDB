import { type ReactNode, useMemo, useState } from 'react';
import { Badge, Box, Collapse, Group, Input, SegmentedControl, Stack, Text, Title, Tooltip, Paper, Select, ThemeIcon, UnstyledButton, type StyleProp } from '@mantine/core';
import { DatePickerInput, type DatePickerInputProps } from '@mantine/dates';
import { IconAlertTriangle, IconChevronRight, IconCircleCheck, IconCircleX, IconHelpCircle, IconMinus } from '@tabler/icons-react';
import type { GuidelineSet, Parameter, Site } from '../db/types';
import { STATUS_META, LEVEL_COLORS, type RuleStatus } from '../lib/compliance';
import { formatDate, makeDate, periodPresets, todayStr, type Period } from '../lib/dates';
import { PARAMETER_GROUPS } from '../data/parameters';
import { consentParameterIds, type ConsentView, type ProjectBundle } from '../lib/analysis';
import { PopupPicker, type PickerData, type PickerOption, type PickerPreset, type PopupPickerProps } from './PopupPicker';

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

/** Settings most people leave alone: closed by default, with a one-line summary of the current choices. */
export function MoreOptions({ label, summary, children, defaultOpen = false }: { label: string; summary?: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <UnstyledButton onClick={() => setOpen(!open)} aria-expanded={open} style={{ display: 'flex', alignItems: 'center', gap: 6, maxWidth: '100%' }}>
        <IconChevronRight size={15} style={{ flexShrink: 0, transform: open ? 'rotate(90deg)' : undefined, transition: 'transform 150ms' }} />
        <Text size="sm" fw={600} style={{ flexShrink: 0 }}>
          {label}
        </Text>
        {!open && summary && (
          <Text size="xs" c="dimmed" truncate>
            {summary}
          </Text>
        )}
      </UnstyledButton>
      <Collapse in={open}>
        <Box pt="sm">{children}</Box>
      </Collapse>
    </div>
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

export function PeriodPicker({ value, onChange, yearStartMonth, extra = [], width = 300 }: { value: PeriodValue; onChange: (v: PeriodValue) => void; yearStartMonth: number; extra?: Array<Period & { key: string }>; width?: StyleProp<React.CSSProperties['width']> }) {
  const presets = usePeriodPresets(yearStartMonth, extra);
  const data = [...presets.map((p) => ({ value: p.key, label: p.label })), { value: 'custom', label: 'Custom range…' }];
  return (
    <Group gap="xs" wrap="wrap" w={{ base: '100%', xs: 'auto' }}>
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

export type { PickerData, PickerOption, PickerPreset } from './PopupPicker';
/** The pickers open a popup with every option laid out (see PopupPicker); `compact` is kept for the filter bars' callers. */
type PickerProps = Omit<PopupPickerProps, 'data' | 'noun' | 'label' | 'placeholder'> & { label?: string; placeholder?: string; compact?: boolean };

/** Sites, grouped by type when there are several types. */
export function SitePicker({ sites, label = 'Sites', placeholder = 'All sites', compact: _compact, ...rest }: { sites: Site[] } & PickerProps) {
  const data = useMemo<PickerData>(() => {
    const item = (s: Site): PickerOption => ({ value: s.id, label: s.name ? `${s.code} – ${s.name}` : s.code, short: s.code });
    const types = [...new Set(sites.map((s) => s.type))];
    if (types.length < 2) return [{ group: '', items: sites.map(item) }];
    return types.map((t) => ({ group: t, items: sites.filter((s) => s.type === t).map(item) }));
  }, [sites]);
  return <PopupPicker label={label} data={data} placeholder={placeholder} noun="sites" {...rest} />;
}

export function paramOptions(params: Parameter[], onlyIds?: Set<string>): PickerData {
  const groups = new Map<string, PickerOption[]>();
  for (const p of params) {
    if (onlyIds && !onlyIds.has(p.id)) continue;
    const g = PARAMETER_GROUPS.includes(p.group) ? p.group : 'Other';
    const list = groups.get(g) ?? [];
    list.push({ value: p.id, label: p.name, short: p.short || p.name });
    groups.set(g, list);
  }
  return PARAMETER_GROUPS.filter((g) => groups.has(g)).map((g) => ({ group: g, items: groups.get(g)! }));
}

export function ParamPicker({ params, onlyIds, label = 'Parameters', placeholder = 'All parameters', compact: _compact, ...rest }: { params: Parameter[]; onlyIds?: Set<string> } & PickerProps) {
  const data = useMemo(() => paramOptions(params, onlyIds), [params, onlyIds]);
  return <PopupPicker label={label} data={data} placeholder={placeholder} noun="parameters" {...rest} />;
}

export function guidelineOptions(sets: GuidelineSet[]): PickerData {
  const fam = new Map<string, PickerOption[]>();
  for (const s of sets) {
    const f = s.builtIn ? s.family ?? 'Other' : 'Custom';
    const list = fam.get(f) ?? [];
    list.push({ value: s.id, label: s.name, short: s.shortName || s.name });
    fam.set(f, list);
  }
  const order = ['Custom', 'ANZG (2018) default guideline values', 'ANZECC (2000) trigger values', 'ANZECC (2000) physical & chemical stressors', 'Drinking water'];
  return Array.from(fam.entries())
    .sort((a, b) => (order.indexOf(a[0]) + 100) % 100 - ((order.indexOf(b[0]) + 100) % 100))
    .map(([group, items]) => ({ group, items }));
}

export function GuidelinePicker({ sets, label = 'Compare with guidelines', placeholder = 'None', compact: _compact, ...rest }: { sets: GuidelineSet[] } & PickerProps) {
  const data = useMemo(() => guidelineOptions(sets), [sets]);
  return <PopupPicker label={label} data={data} placeholder={placeholder} noun="guideline sets" title="Choose guideline sets" {...rest} />;
}

/** Quick picks for a parameter picker: those in the consent, with a limit, with a trigger – among `withData`. */
export function consentPresets(b: Pick<ProjectBundle, 'rules' | 'schedules' | 'setMap'>, withData?: Set<string>): PickerPreset[] {
  return CONSENT_VIEWS.map(([view, label, description]) => ({ label: label === 'In consent' ? 'In the consent' : label, description, ids: [...consentParameterIds(b, view)].filter((id) => !withData || withData.has(id)) }));
}

const CONSENT_VIEWS: Array<[ConsentView, string, string]> = [
  ['consent', 'In consent', 'In the consent: parameters with limits, triggers or other conditions, and those the sampling schedules require'],
  ['limits', 'Limits', 'Parameters with a consent limit'],
  ['triggers', 'Triggers', 'Parameters with a consent trigger or alert level'],
];

/** Show all parameters, or only those in the consent, with a limit, or with a trigger; `counts` are of those with results. */
export function ConsentViewControl({ value, onChange, counts, label }: { value: 'all' | ConsentView; onChange: (v: 'all' | ConsentView) => void; counts: Record<ConsentView, number>; label?: string }) {
  const control = (
    <SegmentedControl
      fullWidth
      value={value}
      onChange={(v) => onChange(v as 'all' | ConsentView)}
      data={[
        { value: 'all', label: 'All' },
        ...CONSENT_VIEWS.map(([v, text, help]) => ({
          value: v,
          label: (
            <Tooltip label={`${help} – ${counts[v]} with results`} multiline w={260} openDelay={300}>
              <span>{text}</span>
            </Tooltip>
          ),
        })),
      ]}
    />
  );
  return label ? (
    <Input.Wrapper label={label} w={{ base: '100%', xs: 'auto' }}>
      {control}
    </Input.Wrapper>
  ) : (
    control
  );
}
