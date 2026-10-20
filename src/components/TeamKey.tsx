// The team key, on the computer: turning it on (off unless the team chooses it), setting up the team's phones with it,
// and making a new one (a lost phone, say). See field/lock.ts for what it locks and how.

import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Group, Modal, Stack, Switch, Text, Title } from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { IconDeviceMobile, IconKey, IconLock, IconRefresh } from '@tabler/icons-react';
import { saveSettings } from '../db/db';
import type { Settings } from '../db/types';
import { useSettings } from '../hooks/useSettings';
import { newTeamKey, setupText, showKeyId, type TeamKey } from '../field/lock';
import { formatDate } from '../lib/dates';
import { QrCode } from './QrCode';

/** The key new field sheets and codes are locked with: none unless the team turned the key on. */
export const lockKey = (s: Settings): TeamKey | null => (s.teamKey?.on ? s.teamKey.keys[0] ?? null : null);

/** All the team's keys, for opening what comes back (kept when the key is turned off). */
export const teamKeysOf = (s: Settings): TeamKey[] => s.teamKey?.keys ?? [];

/** A note in the field sheet and field codes windows: what's locked, and with which key. */
export function LockedBadge({ k }: { k: TeamKey | null }) {
  return k ? (
    <Badge variant="light" color="teal" leftSection={<IconLock size={12} />}>
      Locked with the team key {showKeyId(k.id)}
    </Badge>
  ) : null;
}

export function TeamKeyCard() {
  const settings = useSettings();
  const tk = settings.teamKey;
  const key = tk?.keys[0];
  const [busy, setBusy] = useState(false);
  const [setup, setSetup] = useState(false);
  const turn = async (on: boolean) => {
    setBusy(true);
    try {
      const keys = tk?.keys.length ? tk.keys : on ? [await newTeamKey()] : [];
      await saveSettings({ teamKey: { on, keys } });
      if (on && !tk?.keys.length) notifications.show({ color: 'teal', title: 'Team key made', message: 'Set up each phone with it (Set up a phone), then print the field codes again.' });
    } catch (e) {
      notifications.show({ color: 'red', message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const renew = () =>
    modals.openConfirmModal({
      title: 'Make a new team key?',
      children: (
        <Text size="sm">
          New field sheets and codes are locked with the new key: set each phone up again, and print the field codes again. Phones set up before can still open what was locked with the old key – so after a phone is lost, print every
          code again. Results locked with an old key still open here.
        </Text>
      ),
      labels: { confirm: 'Make a new key', cancel: 'Cancel' },
      onConfirm: async () => {
        try {
          const k = await newTeamKey();
          await saveSettings({ teamKey: { on: true, keys: [k, ...(tk?.keys ?? [])].slice(0, 6) } });
          notifications.show({ color: 'teal', message: `New team key ${showKeyId(k.id)}. Set up the phones again, and print the field codes again.` });
        } catch (e) {
          notifications.show({ color: 'red', message: (e as Error).message });
        }
      },
    });
  return (
    <Card>
      <Group gap="xs" mb={4}>
        <IconKey size={20} />
        <Title order={4}>Field codes: team key</Title>
      </Group>
      <Text size="xs" c="dimmed" mb="sm">
        For the team. A field sheet’s QR code or link, and a printed field code, carry the sites’ names and locations (and their notes, if chosen) – anyone who scans one can read it. With the team key, they’re locked: they open only on
        phones set up for the team, and the results those phones send back are locked too. The key is kept with the workspace.
      </Text>
      <Switch label="Lock field sheets and printed codes with the team key" checked={!!tk?.on} disabled={busy} onChange={(e) => void turn(e.currentTarget.checked)} />
      {key && (
        <Stack gap="xs" mt="sm">
          <Text size="sm">
            <IconLock size={14} style={{ verticalAlign: -2 }} /> Key <b>{showKeyId(key.id)}</b> · made {formatDate(key.made.slice(0, 10))}
            {tk!.keys.length > 1 ? ` · ${tk!.keys.length - 1} older kept, to open what was locked with them` : ''}
          </Text>
          {!tk?.on && (
            <Text size="xs" c="dimmed">
              Off: new sheets and codes aren’t locked. The key is kept, so locked results still open.
            </Text>
          )}
          <Group gap="xs">
            <Button size="xs" leftSection={<IconDeviceMobile size={14} />} onClick={() => setSetup(true)}>
              Set up a phone
            </Button>
            <Button size="xs" variant="default" leftSection={<IconRefresh size={14} />} onClick={renew}>
              Make a new key
            </Button>
          </Group>
          <Text size="xs" c="dimmed">
            Each phone is set up once. Print the field codes again after turning this on – codes printed before still open on any phone.
          </Text>
        </Stack>
      )}
      <TeamSetupModal opened={setup} keys={tk?.keys ?? []} onClose={() => setSetup(false)} />
    </Card>
  );
}

/** Setting up a phone: open its Team key page, then show it the key (only on screen, only when asked). */
function TeamSetupModal({ opened, keys, onClose }: { opened: boolean; keys: TeamKey[]; onClose: () => void }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (opened) setShow(false);
  }, [opened]);
  const page = `${location.origin}${location.pathname}#/field/team`;
  const key = keys[0];
  return (
    <Modal opened={opened} onClose={onClose} title="Set up a phone for the team" size="lg">
      {key && (
        <Stack gap="md">
          <Group align="flex-start" wrap="nowrap" gap="md">
            <QrCode text={page} size={180} label="QR code of the phone’s Team key page" />
            <div>
              <Text fw={600}>1. Open the Team key page on the phone</Text>
              <Text size="sm" c="dimmed">
                Scan this code with the phone’s camera. Or, in EnviroDB field on the phone, tap <b>Team key</b> at the bottom of the first page. Its camera starts.
              </Text>
            </div>
          </Group>
          <Group align="flex-start" wrap="nowrap" gap="md">
            {show ? (
              <QrCode text={setupText(keys)} size={180} label="The team key" />
            ) : (
              <Button w={180} style={{ flexShrink: 0 }} leftSection={<IconKey size={16} />} onClick={() => setShow(true)}>
                Show the team key
              </Button>
            )}
            <div>
              <Text fw={600}>2. Scan the team key with that page</Text>
              <Text size="sm" c="dimmed">
                The phone then says <b>Set up for the team</b> with the same key as here: <b style={{ whiteSpace: 'nowrap' }}>{showKeyId(key.id)}</b>.
              </Text>
            </div>
          </Group>
          <Alert color="orange" variant="light" p="xs">
            <Text size="xs">
              Only scan the team key with your team’s phones, in EnviroDB field. Don’t print, photograph or send it: anyone with it can open your locked field codes. It’s hidden again when this window closes.
            </Text>
          </Alert>
        </Stack>
      )}
    </Modal>
  );
}
