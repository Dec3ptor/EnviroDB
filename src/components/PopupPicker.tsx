// Choosing several things from a long list (parameters, sites, guideline sets): a one-line field that opens a
// popup with everything laid out at once – grouped, searchable, a tick box for each group, and quick picks.

import { Fragment, type ReactNode, useMemo, useRef, useState } from 'react';
import { Badge, Box, Button, Checkbox, CloseButton, Group, Input, InputBase, Modal, SimpleGrid, Stack, Text, TextInput, type StyleProp } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconSearch, IconSelector } from '@tabler/icons-react';

/** An option; `short` names it in the field's summary (a site's code), `hint` is shown after it (a unit). */
export interface PickerOption {
  value: string;
  label: string;
  short?: string;
  hint?: string;
}
export type PickerData = Array<{ group: string; items: PickerOption[] }>;
/** A ready-made choice, e.g. "In the consent". */
export interface PickerPreset {
  label: string;
  ids: string[];
  description?: string;
}

export interface PopupPickerProps {
  label: string;
  data: PickerData;
  value: string[];
  onChange: (v: string[]) => void;
  /** What nothing chosen means, e.g. "All parameters". */
  placeholder: string;
  /** Plural, e.g. "parameters". */
  noun: string;
  /** The popup's title (default "Choose " + noun). */
  title?: string;
  presets?: PickerPreset[];
  description?: ReactNode;
  w?: StyleProp<React.CSSProperties['width']>;
  disabled?: boolean;
  required?: boolean;
  error?: ReactNode;
  size?: 'xs' | 'sm' | 'md';
}

/** "US1, DP1" or "5 parameters"; empty when nothing is chosen. */
export function pickerSummary(data: PickerData, value: string[], noun: string): string {
  const by = new Map(data.flatMap((g) => g.items).map((o) => [o.value, o]));
  const chosen = value.map((v) => by.get(v)).filter((o): o is PickerOption => !!o);
  if (!chosen.length) return '';
  return chosen.length <= 3 ? chosen.map((o) => o.short ?? o.label).join(', ') : `${chosen.length} ${noun}`;
}

export function PopupPicker({ label, data, value, onChange, placeholder, noun, title, presets, description, w, disabled, required, error, size = 'sm' }: PopupPickerProps) {
  const [open, setOpen] = useState(false);
  const summary = pickerSummary(data, value, noun);
  const names = useMemo(() => new Map(data.flatMap((g) => g.items).map((o) => [o.value, o.label])), [data]);
  return (
    <>
      <InputBase
        component="button"
        type="button"
        pointer
        label={label}
        description={description}
        required={required}
        error={error}
        disabled={disabled}
        size={size}
        w={w}
        title={value.map((v) => names.get(v)).filter(Boolean).join('\n') || undefined}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        rightSection={value.length && !disabled ? <CloseButton size="sm" aria-label={`Clear ${label.toLowerCase()}`} onClick={() => onChange([])} /> : <IconSelector size={16} style={{ opacity: 0.6 }} />}
        rightSectionPointerEvents={value.length && !disabled ? 'all' : 'none'}
      >
        {summary ? (
          <Text span size={size} truncate display="block">
            {summary}
          </Text>
        ) : (
          <Input.Placeholder>{placeholder}</Input.Placeholder>
        )}
      </InputBase>
      {open && (
        <PickerDialog
          title={title ?? `Choose ${noun}`}
          data={data}
          value={value}
          noun={noun}
          placeholder={placeholder}
          presets={presets}
          onClose={() => setOpen(false)}
          onDone={(v) => {
            onChange(v);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

function PickerDialog({ title, data, value, noun, placeholder, presets, onClose, onDone }: { title: string; data: PickerData; value: string[]; noun: string; placeholder: string; presets?: PickerPreset[]; onClose: () => void; onDone: (v: string[]) => void }) {
  const [draft, setDraft] = useState<string[]>(value);
  const [q, setQ] = useState('');
  const phone = useMediaQuery('(max-width: 36em)');
  const search = useRef<HTMLInputElement>(null);
  const order = useMemo(() => new Map(data.flatMap((g) => g.items).map((o, i) => [o.value, i])), [data]);
  const total = order.size;
  const chosen = new Set(draft);
  const query = q.trim().toLowerCase();
  // every word typed, in any order, in the option's name or its group's ("dissolved metals", "zinc dissolved")
  const words = query.replace(/[()]/g, ' ').split(/\s+/).filter(Boolean);
  const matches = (o: PickerOption, group: string) => {
    const hay = `${group} ${o.label} ${o.short ?? ''}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  };
  const groups = data.map((g) => ({ ...g, items: words.length ? g.items.filter((o) => matches(o, g.group)) : g.items })).filter((g) => g.items.length);
  const shown = groups.flatMap((g) => g.items.map((o) => o.value));
  const setMany = (ids: string[], on: boolean) => setDraft((d) => (on ? [...d, ...ids.filter((id) => !d.includes(id))] : d.filter((id) => !ids.includes(id))));
  const toggle = (id: string) => setMany([id], !chosen.has(id));
  // the list's own order (e.g. the usual analyte order), whatever order they were ticked in
  const done = () => onDone([...draft].sort((a, b) => (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity)));
  const allShown = shown.length > 0 && shown.every((id) => chosen.has(id));

  return (
    <Modal opened onClose={onClose} title={<Text fw={600}>{title}</Text>} size={total > 24 ? 'xl' : 'lg'} fullScreen={!!phone} padding="md" styles={{ body: { paddingBottom: 0 } }}>
      <Stack gap="sm">
        <TextInput
          ref={search}
          data-autofocus
          placeholder={`Search ${noun}`}
          leftSection={<IconSearch size={16} />}
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
          rightSection={q ? <CloseButton size="sm" aria-label="Clear the search" onClick={() => setQ('')} /> : undefined}
          onKeyDown={(e) => {
            // Enter ticks (or unticks) the first match, ready for the next search
            if (e.key === 'Enter' && shown.length) {
              e.preventDefault();
              toggle(shown[0]);
              search.current?.select();
            }
          }}
        />
        {presets && presets.some((p) => p.ids.length) && (
          <Group gap={6}>
            <Text size="xs" c="dimmed">
              Quick pick:
            </Text>
            {presets
              .filter((p) => p.ids.length)
              .map((p) => {
                const ids = p.ids.filter((id) => order.has(id));
                const exact = ids.length === draft.length && ids.every((id) => chosen.has(id));
                return (
                  <Button key={p.label} size="compact-xs" variant={exact ? 'filled' : 'light'} title={p.description} onClick={() => setDraft(ids)}>
                    {p.label} ({ids.length})
                  </Button>
                );
              })}
          </Group>
        )}

        {groups.map((g) => {
          const ids = g.items.map((o) => o.value);
          const n = ids.filter((id) => chosen.has(id)).length;
          return (
            <Fragment key={g.group || '_'}>
              {g.group && (
                <Group gap="xs" mt={4} wrap="nowrap" style={{ borderBottom: '1px solid var(--mantine-color-default-border)', paddingBottom: 4 }}>
                  <Checkbox
                    size="xs"
                    checked={n === ids.length}
                    indeterminate={n > 0 && n < ids.length}
                    onChange={() => setMany(ids, n < ids.length)}
                    aria-label={`All ${g.group}`}
                    label={
                      <Text size="sm" fw={600}>
                        {g.group}
                      </Text>
                    }
                  />
                  {n > 0 && (
                    <Badge size="xs" variant="light">
                      {n} of {ids.length}
                    </Badge>
                  )}
                </Group>
              )}
              <SimpleGrid cols={{ base: 1, xs: 2, md: total > 24 ? 3 : 2 }} spacing="xs" verticalSpacing={6}>
                {g.items.map((o) => (
                  <Checkbox
                    key={o.value}
                    size="sm"
                    checked={chosen.has(o.value)}
                    onChange={() => toggle(o.value)}
                    label={
                      <>
                        {o.label}
                        {o.hint && (
                          <Text span size="xs" c="dimmed">
                            {' '}
                            {o.hint}
                          </Text>
                        )}
                      </>
                    }
                  />
                ))}
              </SimpleGrid>
            </Fragment>
          );
        })}
        {!groups.length && (
          <Text size="sm" c="dimmed" ta="center" py="lg">
            Nothing matches “{q}”.
          </Text>
        )}

        <Box pos="sticky" bottom={0} py="sm" mt="xs" style={{ background: 'var(--mantine-color-body)', borderTop: '1px solid var(--mantine-color-default-border)', zIndex: 2 }}>
          <Group justify="space-between" gap="xs">
            <Text size="sm" c={draft.length ? undefined : 'dimmed'}>
              {draft.length ? `${draft.length} of ${total} chosen` : `None chosen: ${placeholder.toLowerCase()}`}
            </Text>
            <Group gap="xs">
              {shown.length > 0 && (
                <Button size="xs" variant="subtle" onClick={() => setMany(shown, !allShown)}>
                  {allShown ? (query ? 'Untick these' : 'Untick all') : query ? 'Tick these' : 'Tick all'}
                </Button>
              )}
              {draft.length > 0 && (
                <Button size="xs" variant="subtle" color="gray" onClick={() => setDraft([])}>
                  Clear
                </Button>
              )}
              <Button size="xs" variant="default" onClick={onClose}>
                Cancel
              </Button>
              <Button size="xs" onClick={done}>
                Done
              </Button>
            </Group>
          </Group>
        </Box>
      </Stack>
    </Modal>
  );
}
