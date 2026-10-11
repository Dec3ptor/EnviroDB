import { Anchor, Chip, Group, Text } from '@mantine/core';
import type { Site } from '../../db/types';

/**
 * The monitoring sites a report covers, e.g. a groundwater report without the discharge. `chosen` is null for
 * every site; choosing every site again goes back to null.
 */
export function ReportSites({ sites, chosen, onChange, rememberedFor }: { sites: Site[]; chosen: string[] | null; onChange: (ids: string[]) => void; rememberedFor: string }) {
  if (sites.length < 2) return null;
  const value = chosen ?? sites.map((s) => s.id);
  const types = [...new Set(sites.map((s) => s.type))];
  return (
    <div>
      <Group justify="space-between" gap="xs" mb={4} wrap="nowrap">
        <Text size="sm" fw={500}>
          Sites
        </Text>
        <Text size="xs" c="dimmed" ta="right">
          {chosen ? `${chosen.length} of ${sites.length} · remembered for ${rememberedFor}` : 'All sites'}
        </Text>
      </Group>
      <Chip.Group multiple value={value} onChange={(ids) => ids.length && onChange(ids)}>
        <Group gap={6}>
          {sites.map((s) => (
            <Chip key={s.id} value={s.id} size="xs" title={[s.name, s.type].filter(Boolean).join(' · ')}>
              {s.code}
            </Chip>
          ))}
        </Group>
      </Chip.Group>
      {(types.length > 1 || chosen) && (
        <Group gap={12} mt={6}>
          {types.length > 1 &&
            types.map((type) => (
              <Anchor key={type} component="button" type="button" size="xs" onClick={() => onChange(sites.filter((s) => s.type === type).map((s) => s.id))}>
                {type} only
              </Anchor>
            ))}
          {chosen && (
            <Anchor component="button" type="button" size="xs" onClick={() => onChange([])}>
              All sites
            </Anchor>
          )}
        </Group>
      )}
    </div>
  );
}
