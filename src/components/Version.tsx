// The app's version at the foot of the menu, what's new in each release, and the notices that a new version is out
// (published, or already used by someone in the workspace).

import { useEffect, useRef, useState } from 'react';
import { Badge, Button, Group, List, Modal, Stack, Text, Title, UnstyledButton } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { APP_BUILD, APP_VERSION, RELEASES, compareVersions, publishedVersion, releasesSince } from '../lib/version';
import { formatDateLong } from '../lib/dates';
import { useWorkspace } from '../sync/workspace';

const SEEN_KEY = 'envirodb.seenVersion';
const CHECK_EVERY_MS = 30 * 60 * 1000;
const RECENT_MS = 24 * 60 * 60 * 1000;

const readSeen = () => {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
};
const writeSeen = (v: string) => {
  try {
    localStorage.setItem(SEEN_KEY, v);
  } catch {
    /* a convenience only */
  }
};

export function WhatsNew({ opened, onClose, since }: { opened: boolean; onClose: () => void; since?: string | null }) {
  const shown = since ? releasesSince(since) : RELEASES;
  return (
    <Modal opened={opened} onClose={onClose} title={<Text fw={700}>What’s new in EnviroDB</Text>} size="lg">
      <Stack gap="md">
        <Text size="xs" c="dimmed">
          You have version {APP_VERSION}
          {APP_BUILD.commit !== 'dev' ? ` (build ${APP_BUILD.commit}${APP_BUILD.date ? `, ${formatDateLong(APP_BUILD.date)}` : ''})` : ''}.
        </Text>
        {(shown.length ? shown : RELEASES.slice(0, 1)).map((r) => (
          <div key={r.version}>
            <Group gap="xs" mb={4}>
              <Badge variant="light" color="teal">
                {r.version}
              </Badge>
              <Title order={5}>{r.title}</Title>
              <Text size="xs" c="dimmed">
                {formatDateLong(r.date)}
              </Text>
            </Group>
            <List size="sm" spacing={4}>
              {r.items.map((it, i) => (
                <List.Item key={i}>{it}</List.Item>
              ))}
            </List>
          </div>
        ))}
      </Stack>
    </Modal>
  );
}

const reload = () => window.location.reload();
const reloadButton = (
  <Button size="compact-xs" mt={6} onClick={reload}>
    Reload now
  </Button>
);

/**
 * The version at the foot of the menu (click: what's new). Also: after an update, a note of what's new; when a newer
 * version is published, or someone in the workspace is already using one, an offer to reload.
 */
export function VersionFooter() {
  const [open, setOpen] = useState(false);
  const [since, setSince] = useState<string | null>(null);
  const ws = useWorkspace();
  const told = useRef(new Set<string>());

  // just updated: say so once
  useEffect(() => {
    const seen = readSeen();
    writeSeen(APP_VERSION);
    if (seen && compareVersions(APP_VERSION, seen) > 0) {
      notifications.show({
        id: 'app-updated',
        color: 'teal',
        autoClose: 15000,
        title: `EnviroDB is now version ${APP_VERSION}`,
        message: (
          <Button
            size="compact-xs"
            variant="light"
            mt={4}
            onClick={() => {
              setSince(seen);
              setOpen(true);
              notifications.hide('app-updated');
            }}
          >
            See what’s new
          </Button>
        ),
      });
    }
  }, []);

  // a newer version published: offer to reload (checked now and then, and on coming back to the tab)
  useEffect(() => {
    let last = 0;
    const check = async () => {
      if (Date.now() - last < 5 * 60 * 1000) return;
      last = Date.now();
      const pub = await publishedVersion();
      if (!pub) return;
      const newer = compareVersions(pub.version, APP_VERSION) > 0 || (compareVersions(pub.version, APP_VERSION) === 0 && APP_BUILD.commit !== 'dev' && !!pub.commit && pub.commit !== APP_BUILD.commit);
      if (!newer || told.current.has(`pub:${pub.version}:${pub.commit}`)) return;
      told.current.add(`pub:${pub.version}:${pub.commit}`);
      notifications.show({
        id: 'app-update',
        color: 'blue',
        autoClose: false,
        title: pub.version === APP_VERSION ? 'An update to EnviroDB is ready' : `EnviroDB ${pub.version} is ready`,
        message: (
          <>
            <Text size="sm">Reload to use it. Your work is kept.</Text>
            {reloadButton}
          </>
        ),
      });
    };
    const first = setTimeout(check, 10000);
    const every = setInterval(check, CHECK_EVERY_MS);
    const onVisible = () => document.visibilityState === 'visible' && void check();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(first);
      clearInterval(every);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // someone in the workspace is on a newer version
  useEffect(() => {
    const ahead = ws.people.filter((p) => !p.me && p.appVersion && compareVersions(p.appVersion, APP_VERSION) > 0 && Date.now() - new Date(p.lastSeen).getTime() < RECENT_MS);
    const newest = ahead.sort((a, b) => compareVersions(b.appVersion!, a.appVersion!))[0];
    if (!newest || told.current.has(`team:${newest.appVersion}`)) return;
    told.current.add(`team:${newest.appVersion}`);
    notifications.show({
      id: 'app-team-ahead',
      color: 'blue',
      autoClose: false,
      title: `${newest.name} is using EnviroDB ${newest.appVersion}`,
      message: (
        <>
          <Text size="sm">You have {APP_VERSION}. Reload to update, so you both work with the same version.</Text>
          {reloadButton}
        </>
      ),
    });
  }, [ws.people]);

  return (
    <>
      <UnstyledButton
        onClick={() => {
          setSince(null);
          setOpen(true);
        }}
        px="sm"
        pb={4}
        aria-label={`EnviroDB version ${APP_VERSION} – what’s new`}
      >
        <Text size="xs" c="dimmed">
          EnviroDB {APP_VERSION} · what’s new
        </Text>
      </UnstyledButton>
      <WhatsNew opened={open} onClose={() => setOpen(false)} since={since} />
    </>
  );
}
