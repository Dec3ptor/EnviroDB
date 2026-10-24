// The features the team uses: switched on or off for everyone, starting from the essentials. Switching one off hides
// it – menus, tabs, cards – and keeps its data; switching it back on shows it all again.

import { Button, Card, Group, SegmentedControl, Stack, Switch, Text, Title } from '@mantine/core';
import { IconAdjustmentsHorizontal } from '@tabler/icons-react';
import { saveSettings } from '../db/db';
import { useSettings } from '../hooks/useSettings';
import { FEATURES, featureOn, featurePreset, presetOf, type Feature } from '../lib/features';

export function FeaturesCard() {
  const settings = useSettings();
  const preset = presetOf(settings);
  const set = (k: Feature, on: boolean) => void saveSettings({ features: { ...featurePreset(false), ...Object.fromEntries(FEATURES.map((f) => [f.key, featureOn(settings, f.key)])), [k]: on } });
  return (
    <Card id="features">
      <Group gap="xs" mb={4}>
        <IconAdjustmentsHorizontal size={20} />
        <Title order={4}>Features</Title>
      </Group>
      <Text size="sm" c="dimmed" mb="sm">
        For the whole team. EnviroDB starts with the essentials – projects, importing, data, graphs, maps, compliance and reports. Switch on more as the team needs them; switching one off hides it and keeps its data. QA/QC checks are chosen for each
        project, in its Setup tab.
      </Text>
      <SegmentedControl
        mb="md"
        value={preset}
        onChange={(v) => v !== 'custom' && void saveSettings({ features: featurePreset(v === 'everything') })}
        data={[
          { value: 'essentials', label: 'Essentials' },
          { value: 'everything', label: 'Everything' },
          { value: 'custom', label: 'Chosen', disabled: preset !== 'custom' },
        ]}
      />
      <Stack gap="sm">
        {FEATURES.map((f) => (
          <Switch key={f.key} label={f.label} description={f.description} checked={featureOn(settings, f.key)} onChange={(e) => set(f.key, e.currentTarget.checked)} />
        ))}
      </Stack>
    </Card>
  );
}

/** A note on the dashboard until the team chooses its features: where the rest went. */
export function EssentialsNote({ onDismiss }: { onDismiss: () => void }) {
  return (
    <Card withBorder padding="sm" style={{ borderColor: 'var(--mantine-primary-color-3)' }}>
      <Group justify="space-between" wrap="wrap" gap="sm">
        <Text size="sm" style={{ flex: '1 1 320px' }}>
          <b>EnviroDB now starts with the essentials.</b> Field mode, NPS-FM bands, client data packs, rainfall data and the AI helpers are switched off until your team wants them – in Settings → Team → Features. QA/QC checks are switched on for each
          project in its Setup tab.
        </Text>
        <Group gap="xs">
          <Button size="xs" variant="default" component="a" href="#/settings?tab=team">
            Choose features
          </Button>
          <Button size="xs" variant="subtle" onClick={onDismiss}>
            Got it
          </Button>
        </Group>
      </Group>
    </Card>
  );
}
