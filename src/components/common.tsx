import { Fragment, type ReactNode, useMemo, useState } from 'react';
import { Anchor, Badge, Box, Checkbox, CloseButton, Collapse, Combobox, Group, Input, InputBase, ScrollArea, Stack, Text, Title, Paper, Select, MultiSelect, ThemeIcon, UnstyledButton, useCombobox, type MultiSelectProps, type StyleProp } from '@mantine/core';
import { DatePickerInput, type DatePickerInputProps } from '@mantine/dates';
import { IconAlertTriangle, IconChevronRight, IconCircleCheck, IconCircleX, IconHelpCircle, IconMinus } from '@tabler/icons-react';
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

/** An option in a picker; `short` is how it is named in a compact summary (a site's code, a guideline's short name). */
export interface PickerOption {
  value: string;
  label: string;
  short?: string;
}
export type PickerData = Array<{ group: string; items: PickerOption[] }>;

/**
 * A multi-select that stays one line high – "US1, DP1" or "5 parameters" – and opens to a checklist, so filter bars
 * line up however much is chosen. Nothing chosen shows the placeholder (e.g. "All sites").
 */
export function CompactMultiSelect({ label, data, value, onChange, placeholder, noun, w, description }: { label: string; data: PickerData; value: string[]; onChange: (v: string[]) => void; placeholder: string; noun: string; w?: StyleProp<React.CSSProperties['width']>; description?: ReactNode }) {
  const [search, setSearch] = useState('');
  const combobox = useCombobox({
    onDropdownClose: () => {
      combobox.resetSelectedOption();
      setSearch('');
    },
    onDropdownOpen: () => combobox.focusSearchInput(),
  });
  const byValue = useMemo(() => new Map(data.flatMap((g) => g.items).map((o) => [o.value, o])), [data]);
  const chosen = value.map((v) => byValue.get(v)).filter((o): o is PickerOption => !!o);
  const summary = chosen.length === 0 ? '' : chosen.length <= 3 ? chosen.map((o) => o.short ?? o.label).join(', ') : `${chosen.length} ${noun}`;
  const q = search.trim().toLowerCase();
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  const groups = data
    .map((g) => ({ ...g, items: g.items.filter((o) => !q || o.label.toLowerCase().includes(q) || o.short?.toLowerCase().includes(q)) }))
    .filter((g) => g.items.length);
  const options = groups.map((g) => {
    const opts = g.items.map((o) => (
      <Combobox.Option value={o.value} key={o.value} active={value.includes(o.value)}>
        <Group gap="xs" wrap="nowrap">
          <Checkbox size="xs" radius={3} checked={value.includes(o.value)} readOnly tabIndex={-1} aria-hidden style={{ pointerEvents: 'none' }} />
          <span>{o.label}</span>
        </Group>
      </Combobox.Option>
    ));
    return g.group ? (
      <Combobox.Group key={g.group} label={g.group}>
        {opts}
      </Combobox.Group>
    ) : (
      <Fragment key="_">{opts}</Fragment>
    );
  });
  return (
    <Combobox store={combobox} onOptionSubmit={toggle} width="max-content" position="bottom-start" withinPortal>
      <Combobox.Target>
        <InputBase
          component="button"
          type="button"
          pointer
          label={label}
          description={description}
          w={w}
          title={chosen.map((o) => o.label).join('\n') || undefined}
          onClick={() => combobox.toggleDropdown()}
          rightSection={value.length ? <CloseButton size="sm" aria-label={`Clear ${label.toLowerCase()}`} onMouseDown={(e) => e.preventDefault()} onClick={() => onChange([])} /> : <Combobox.Chevron />}
          rightSectionPointerEvents={value.length ? 'all' : 'none'}
        >
          {summary ? (
            <Text span size="sm" truncate display="block">
              {summary}
            </Text>
          ) : (
            <Input.Placeholder>{placeholder}</Input.Placeholder>
          )}
        </InputBase>
      </Combobox.Target>
      <Combobox.Dropdown miw={260} maw="min(92vw, 420px)">
        <Combobox.Search value={search} onChange={(e) => setSearch(e.currentTarget.value)} placeholder={`Search ${noun}`} />
        <Combobox.Options>
          <ScrollArea.Autosize mah={340} type="scroll">
            {options.length ? options : <Combobox.Empty>Nothing found</Combobox.Empty>}
          </ScrollArea.Autosize>
        </Combobox.Options>
        {value.length > 0 && (
          <Combobox.Footer>
            <Anchor component="button" type="button" size="xs" onClick={() => onChange([])}>
              Clear – {placeholder.toLowerCase()}
            </Anchor>
          </Combobox.Footer>
        )}
      </Combobox.Dropdown>
    </Combobox>
  );
}

type PickerProps = { value: string[]; onChange: (v: string[]) => void; label?: string; compact?: boolean; placeholder?: string } & Partial<Omit<MultiSelectProps, 'value' | 'onChange' | 'data' | 'label' | 'placeholder'>>;

/** Sites: a one-line picker in filter bars (`compact`), chips in forms. */
export function SitePicker({ sites, value, onChange, label = 'Sites', compact, placeholder = 'All sites', ...rest }: { sites: Site[] } & PickerProps) {
  const data = useMemo<PickerData>(() => [{ group: '', items: sites.map((s) => ({ value: s.id, label: s.name ? `${s.code} – ${s.name}` : s.code, short: s.code })) }], [sites]);
  if (compact) return <CompactMultiSelect label={label} data={data} value={value} onChange={onChange} placeholder={placeholder} noun="sites" w={rest.w} />;
  return <MultiSelect label={label} data={data[0].items} value={value} onChange={onChange} placeholder={value.length ? undefined : placeholder} searchable clearable maxDropdownHeight={300} {...rest} />;
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

export function ParamPicker({ params, value, onChange, onlyIds, label = 'Parameters', compact, placeholder = 'All parameters', ...rest }: { params: Parameter[]; onlyIds?: Set<string> } & PickerProps) {
  const data = useMemo(() => paramOptions(params, onlyIds), [params, onlyIds]);
  if (compact) return <CompactMultiSelect label={label} data={data} value={value} onChange={onChange} placeholder={placeholder} noun="parameters" w={rest.w} />;
  return <MultiSelect label={label} data={data} value={value} onChange={onChange} searchable clearable placeholder={value.length ? undefined : placeholder} maxDropdownHeight={340} {...rest} />;
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

export function GuidelinePicker({ sets, value, onChange, label = 'Compare with guidelines', compact, placeholder = 'None', ...rest }: { sets: GuidelineSet[] } & PickerProps) {
  const data = useMemo(() => guidelineOptions(sets), [sets]);
  if (compact) return <CompactMultiSelect label={label} data={data} value={value} onChange={onChange} placeholder={placeholder} noun="guideline sets" w={rest.w} />;
  return <MultiSelect label={label} data={data} value={value} onChange={onChange} searchable clearable placeholder={value.length ? undefined : placeholder} maxDropdownHeight={360} {...rest} />;
}
