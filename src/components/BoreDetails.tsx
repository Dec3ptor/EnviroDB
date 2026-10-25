// A bore's particulars, for a groundwater site: the top-of-casing level, stick-up, depth, screen and diameter.
// Shown as a button in the site's row; the level turns a depth to water from the field into a groundwater level.

import { useState } from 'react';
import { ActionIcon, Button, Group, Modal, NumberInput, SimpleGrid, Stack, Text, Tooltip } from '@mantine/core';
import { IconDropletHalf2 } from '@tabler/icons-react';
import type { Site } from '../db/types';
import { boreSummary, hasBore, type BoreDetails } from '../lib/bore';

export function BoreButton({ site, onSave }: { site: Site; onSave: (bore: BoreDetails | undefined) => void }) {
  const [open, setOpen] = useState(false);
  const has = hasBore(site.bore);
  return (
    <>
      <Tooltip label={has ? `Bore: ${boreSummary(site.bore)}` : 'Bore details: top of casing, depth, screen'} withArrow multiline maw={320}>
        <ActionIcon size="sm" variant={has ? 'light' : 'subtle'} color={has ? undefined : 'gray'} aria-label={`Bore details for ${site.code}`} onClick={() => setOpen(true)}>
          <IconDropletHalf2 size={14} />
        </ActionIcon>
      </Tooltip>
      {open && <BoreModal site={site} onClose={() => setOpen(false)} onSave={onSave} />}
    </>
  );
}

function BoreModal({ site, onClose, onSave }: { site: Site; onClose: () => void; onSave: (bore: BoreDetails | undefined) => void }) {
  const [b, setB] = useState<BoreDetails>({ ...(site.bore ?? {}) });
  const num = (k: keyof BoreDetails, label: string, hint: string, dp = 2) => (
    <NumberInput label={label} description={hint} value={b[k] ?? ''} onChange={(v) => setB({ ...b, [k]: v === '' ? undefined : Number(v) })} decimalScale={dp} hideControls />
  );
  const save = () => {
    const clean = Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined && v !== null && !Number.isNaN(v))) as BoreDetails;
    onSave(Object.keys(clean).length ? clean : undefined);
    onClose();
  };
  return (
    <Modal opened onClose={onClose} title={`Bore ${site.code}${site.name ? ` – ${site.name}` : ''}`} size="md">
      <Stack gap="sm">
        <Text size="sm" c="dimmed">
          Depth to water is measured from the top of the casing. With the top of casing's level, EnviroDB works out the groundwater level (RL = TOC − depth) when field readings come in, and warns of a depth deeper than the well.
        </Text>
        <SimpleGrid cols={2} spacing="sm">
          {num('tocRl', 'Top of casing (m RL)', 'Surveyed level of the measuring point')}
          {num('stickUp', 'Stick-up (m)', 'Casing above the ground')}
          {num('depth', 'Well depth (m)', 'Below the top of casing')}
          {num('diameter', 'Diameter (mm)', 'Casing', 0)}
          {num('screenTop', 'Screen from (m)', 'Below the top of casing')}
          {num('screenBottom', 'Screen to (m)', '')}
        </SimpleGrid>
        {hasBore(b) && (
          <Text size="xs" c="dimmed">
            {boreSummary(b)}
          </Text>
        )}
        <Group justify="space-between" mt="xs">
          <Button variant="subtle" color="gray" onClick={() => setB({})}>
            Clear
          </Button>
          <Group gap="xs">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={save}>Save</Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}
