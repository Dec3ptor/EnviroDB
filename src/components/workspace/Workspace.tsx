import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, Anchor, Badge, Box, Button, Card, Center, Divider, Group, List, Loader, Modal, Popover, Stack, Text, TextInput, ThemeIcon, Title, UnstyledButton } from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import {
  IconAlertTriangle, IconBrandChrome, IconCloudCheck, IconCloudUpload, IconDatabaseExport, IconDroplet, IconFolderOpen, IconFolderPlus, IconPlugConnected, IconRefresh, IconUsers,
} from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import {
  chooseFolder, createWorkspace, getWorkspaceState, leaveWorkspace, onRemoteUpdate, reconnect, resolveChoice, retry, setMyName, syncNow, useAnotherFolder, useWorkspace, type WorkspaceState,
} from '../../sync/workspace';
import type { RemoteUpdate } from '../../sync/workspace';
import { downloadWorkspaceBackup } from '../../db/backup';
import { getSettings, saveSettings } from '../../db/db';
import type { Person } from '../../sync/engine';

/** Someone counts as connected when their EnviroDB has said so in the last few minutes. */
const ONLINE_MS = 12 * 60000;
export const isOnline = (p: Person, now = Date.now()) => now - new Date(p.lastSeen).getTime() < ONLINE_MS;

function ago(iso: string | number | undefined): string {
  if (!iso) return 'never';
  const ms = Date.now() - (typeof iso === 'number' ? iso : new Date(iso).getTime());
  if (ms < 60000) return 'just now';
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

// ------------------------------------------------------------ the lock screen

function Screen({ children }: { children: ReactNode }) {
  return (
    <Center mih="100vh" p="md" bg="light-dark(var(--mantine-color-gray-0), var(--mantine-color-dark-8))">
      <Card w="100%" maw={600} padding="xl" withBorder shadow="sm">
        <Group gap={8} mb="lg">
          <Box style={{ background: 'var(--mantine-primary-color-8)', borderRadius: 8, width: 30, height: 30, display: 'grid', placeItems: 'center' }}>
            <IconDroplet size={18} color="var(--mantine-primary-color-contrast)" />
          </Box>
          <Text fw={700} size="lg">
            EnviroDB
          </Text>
        </Group>
        {children}
      </Card>
    </Center>
  );
}

function ErrorNote({ error }: { error?: string }) {
  return error ? (
    <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
      {error}
    </Alert>
  ) : null;
}

function NameInput({ s, onValid }: { s: WorkspaceState; onValid?: (ok: boolean) => void }) {
  const [name, setName] = useState(s.myName);
  useEffect(() => {
    if (s.myName) return;
    // people already using EnviroDB have their name in their settings
    void getSettings().then((x) => x.author && setName((n) => n || x.author));
  }, [s.myName]);
  useEffect(() => onValid?.(!!name.trim()), [name, onValid]);
  return (
    <TextInput
      label="Your name"
      description="Shown to colleagues next to your changes"
      value={name}
      onChange={(e) => setName(e.currentTarget.value)}
      onBlur={() => name.trim() && name.trim() !== s.myName && void setMyName(name)}
      required
      data-autofocus
    />
  );
}

async function nameFirst(): Promise<boolean> {
  const input = document.querySelector<HTMLInputElement>('input[data-autofocus]');
  const name = input?.value.trim() ?? getWorkspaceState().myName;
  if (!name) return false;
  if (name !== getWorkspaceState().myName) await setMyName(name);
  const settings = await getSettings();
  if (!settings.author) await saveSettings({ author: name });
  return true;
}

function SetupScreen({ s }: { s: WorkspaceState }) {
  const [ok, setOk] = useState(!!s.myName);
  return (
    <Screen>
      <Stack>
        <Title order={3}>Connect to your team’s workspace</Title>
        <Text size="sm">
          EnviroDB keeps everything – projects, results, rules and reports – in a <b>workspace folder</b> that everyone on the team can reach: a SharePoint or OneDrive folder synced to your computer, or a
          shared network drive. Your changes are saved there as you work, and colleagues’ changes show up for you within seconds.
        </Text>
        <NameInput s={s} onValid={setOk} />
        <Button size="md" leftSection={<IconFolderOpen size={18} />} disabled={!ok} onClick={async () => (await nameFirst()) && chooseFolder()}>
          Choose the workspace folder…
        </Button>
        <ErrorNote error={s.error} />
        <List size="sm" spacing={4} c="dimmed">
          <List.Item>Joining colleagues? Choose the folder they set up.</List.Item>
          <List.Item>Starting fresh? Make a new empty folder (e.g. “EnviroDB workspace” in your team’s SharePoint) and choose it.</List.Item>
          <List.Item>In OneDrive, right-click the folder → “Always keep on this device”, so the latest files are always on your computer.</List.Item>
        </List>
      </Stack>
    </Screen>
  );
}

function ReconnectScreen({ s }: { s: WorkspaceState }) {
  return (
    <Stack>
      <Title order={3}>Reconnect to {s.workspace?.name ? `“${s.workspace.name}”` : 'your workspace'}</Title>
      <Text size="sm">
        The browser asks before EnviroDB can use the folder <b>{s.folderName}</b> again. If it offers “Allow on every visit”, choose it to skip this step next time.
      </Text>
      <ErrorNote error={s.error} />
      <Group>
        <Button size="md" leftSection={<IconPlugConnected size={18} />} onClick={() => reconnect()}>
          Reconnect
        </Button>
        <Button variant="subtle" onClick={() => useAnotherFolder()}>
          Choose a different folder
        </Button>
      </Group>
    </Stack>
  );
}

function ConnectingScreen({ s }: { s: WorkspaceState }) {
  return (
    <Stack align="center" py="lg">
      <Loader />
      <Text fw={600}>Connecting to {s.workspace?.name ? `“${s.workspace.name}”` : `“${s.folderName ?? 'the folder'}”`}…</Text>
      {s.detail && (
        <Text size="sm" c="dimmed">
          {s.detail}
        </Text>
      )}
    </Stack>
  );
}

function CreateScreen({ s }: { s: WorkspaceState }) {
  const [name, setName] = useState(s.folderName ?? '');
  return (
    <Screen>
      <Stack>
        <Title order={3}>“{s.folderName}” isn’t a workspace yet</Title>
        <Text size="sm">
          {s.emptyFolder
            ? 'Start a new workspace in this empty folder? Then share the folder with your colleagues and have them choose it in EnviroDB.'
            : 'The folder already has other things in it. You can still start a workspace here – EnviroDB only adds its own files and folders – but a folder of its own keeps things tidy.'}
        </Text>
        <TextInput label="Workspace name" description="Shown to everyone who connects" value={name} onChange={(e) => setName(e.currentTarget.value)} />
        <ErrorNote error={s.error} />
        <Group>
          <Button size="md" leftSection={<IconFolderPlus size={18} />} onClick={() => createWorkspace(name)}>
            Start the workspace here
          </Button>
          <Button variant="subtle" onClick={() => useAnotherFolder()}>
            Choose another folder
          </Button>
        </Group>
      </Stack>
    </Screen>
  );
}

function ChooseScreen({ s }: { s: WorkspaceState }) {
  const c = s.choice!;
  const to = s.workspace?.name ?? s.folderName;
  const projects = `${c.projects} project${c.projects === 1 ? '' : 's'}`;
  const confirmRemove = () =>
    modals.openConfirmModal({
      title: 'Remove it from this browser?',
      children: <Text size="sm">{c.projects ? `The ${projects}` : 'Your work'} in this browser will be deleted from it. Download a backup first if you might need it.</Text>,
      labels: { confirm: 'Remove them', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: () => resolveChoice('remove'),
    });
  return (
    <Screen>
      {c.kind === 'adopt' ? (
        <Stack>
          <Title order={3}>
            {c.projects ? `This browser has ${projects} that ${c.projects === 1 ? 'isn’t' : 'aren’t'} in “${to}”` : `This browser has work of yours that isn’t in “${to}”`}
          </Title>
          <Text size="sm">
            {c.projects ? `Add ${c.projects === 1 ? 'it' : 'them'} to the workspace so the team can see and work on ${c.projects === 1 ? 'it' : 'them'} – with your report templates, guideline sets and other work – or remove ${c.projects === 1 ? 'it' : 'them'} from this browser.` : 'Your own report templates, guideline sets or other work. Add it to the workspace so the team can use it, or remove it from this browser.'}
          </Text>
          <Group>
            <Button size="md" leftSection={<IconCloudUpload size={18} />} onClick={() => resolveChoice('add')}>
              Add {c.projects === 1 || !c.projects ? 'it' : 'them'} to the workspace
            </Button>
            <Button variant="default" leftSection={<IconDatabaseExport size={16} />} onClick={() => downloadWorkspaceBackup()}>
              Download a backup
            </Button>
          </Group>
          <Group>
            <Button variant="subtle" color="red" onClick={confirmRemove}>
              Remove from this browser
            </Button>
            <Button variant="subtle" onClick={() => resolveChoice('cancel')}>
              Cancel
            </Button>
          </Group>
        </Stack>
      ) : (
        <Stack>
          <Title order={3}>Switch to “{to}”?</Title>
          <Text size="sm">
            This browser holds the workspace “{c.from?.name}”. Switching replaces this browser’s copy with “{to}”. “{c.from?.name}” stays as it is in its own folder – choose that folder again to go back to it.
          </Text>
          {c.unsaved > 0 && (
            <Alert color="orange" variant="light" icon={<IconAlertTriangle size={16} />}>
              Some changes made here never reached “{c.from?.name}” (its folder couldn’t be reached). Download a backup first, or go back and reconnect to “{c.from?.name}” so they are saved.
            </Alert>
          )}
          <Group>
            <Button size="md" onClick={() => resolveChoice('remove')}>
              Switch to “{to}”
            </Button>
            <Button variant="default" leftSection={<IconDatabaseExport size={16} />} onClick={() => downloadWorkspaceBackup()}>
              Download a backup
            </Button>
            <Button variant="subtle" onClick={() => resolveChoice('cancel')}>
              Cancel
            </Button>
          </Group>
        </Stack>
      )}
    </Screen>
  );
}

function OfflineScreen({ s }: { s: WorkspaceState }) {
  return (
    <Stack>
      <Group gap="xs">
        <ThemeIcon color="orange" variant="light">
          <IconAlertTriangle size={18} />
        </ThemeIcon>
        <Title order={4}>Can’t reach the workspace folder</Title>
      </Group>
      <Text size="sm">{s.error}</Text>
      <Text size="sm" c="dimmed">
        Changes you have made are kept in this browser and saved to the folder as soon as it is back. EnviroDB keeps trying every few seconds.
      </Text>
      <Group>
        <Button leftSection={<IconRefresh size={16} />} onClick={() => retry()}>
          Try again
        </Button>
        <Button variant="subtle" onClick={() => useAnotherFolder()}>
          Choose the folder again
        </Button>
      </Group>
    </Stack>
  );
}

function UnsupportedScreen() {
  return (
    <Screen>
      <Stack>
        <Group gap="xs">
          <IconBrandChrome size={26} />
          <Title order={3}>Open EnviroDB in Microsoft Edge or Google Chrome</Title>
        </Group>
        <Text size="sm">
          Your team’s data lives in a shared workspace folder, and only Edge and Chrome on a computer (Windows or Mac) can work with folders from a web page. Phones, tablets, Firefox and Safari can’t.
        </Text>
      </Stack>
    </Screen>
  );
}

/**
 * Nothing works until this browser is connected to the workspace folder. Once it has been, losing the folder (or
 * needing permission again) puts a notice over the app rather than closing it, so nothing on screen is lost.
 */
export function WorkspaceGate({ children }: { children: ReactNode }) {
  const s = useWorkspace();
  const wasReady = useRef(false);
  if (s.phase === 'ready') wasReady.current = true;
  if (['setup', 'create', 'choose', 'unsupported', 'starting'].includes(s.phase)) wasReady.current = false;

  const overlay = s.phase === 'offline' ? <OfflineScreen s={s} /> : s.phase === 'reconnect' ? <ReconnectScreen s={s} /> : s.phase === 'connecting' ? <ConnectingScreen s={s} /> : null;
  if (s.phase === 'ready' || (wasReady.current && overlay)) {
    return (
      <>
        {children}
        <Modal opened={!!overlay} onClose={() => undefined} withCloseButton={false} closeOnClickOutside={false} closeOnEscape={false} centered size="lg" zIndex={400}>
          {overlay}
        </Modal>
        <RemoteNotices />
        {s.newerApp && (
          <Alert color="blue" variant="filled" style={{ position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 300 }} icon={<IconRefresh size={16} />}>
            <Group gap="sm">
              <Text size="sm">A colleague is using a newer EnviroDB.</Text>
              <Button size="compact-sm" variant="white" onClick={() => location.reload()}>
                Reload to update
              </Button>
            </Group>
          </Alert>
        )}
      </>
    );
  }
  switch (s.phase) {
    case 'unsupported':
      return <UnsupportedScreen />;
    case 'setup':
      return <SetupScreen s={s} />;
    case 'create':
      return <CreateScreen s={s} />;
    case 'choose':
      return <ChooseScreen s={s} />;
    case 'starting':
      return (
        <Center h="100vh">
          <Loader />
        </Center>
      );
    default:
      return <Screen>{overlay}</Screen>;
  }
}

// ------------------------------------------------------------ in the header

function PeopleList({ people }: { people: Person[] }) {
  return (
    <Stack gap={6}>
      {people.map((p) => (
        <Group key={p.id} gap="xs" justify="space-between" wrap="nowrap">
          <Group gap={6} wrap="nowrap">
            <Box w={8} h={8} style={{ borderRadius: 8, background: isOnline(p) ? 'var(--mantine-color-teal-6)' : 'var(--mantine-color-gray-4)' }} />
            <Text size="sm">
              {p.name}
              {p.me ? ' (you)' : ''}
            </Text>
          </Group>
          <Text size="xs" c="dimmed">
            {p.me || isOnline(p) ? 'connected' : `last seen ${ago(p.lastSeen)}`}
            {p.appVersion ? ` · ${p.appVersion}` : ''}
          </Text>
        </Group>
      ))}
    </Stack>
  );
}

/** Saved / saving, and who else is connected – in the header. */
export function WorkspaceBadge() {
  const s = useWorkspace();
  const navigate = useNavigate();
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);
  const others = s.people.filter((p) => !p.me && isOnline(p)).length;
  const saving = s.pending > 0;
  return (
    <Popover width={300} position="bottom-end" shadow="md" withArrow>
      <Popover.Target>
        <UnstyledButton aria-label="Workspace">
          <Badge color={saving ? 'blue' : 'teal'} variant="light" leftSection={saving ? <IconCloudUpload size={14} /> : <IconCloudCheck size={14} />} rightSection={others ? <Group gap={2} wrap="nowrap"><IconUsers size={12} />{others}</Group> : undefined} style={{ cursor: 'pointer' }}>
            {saving ? 'Saving…' : 'Saved'}
          </Badge>
        </UnstyledButton>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="xs">
          <div>
            <Text fw={600}>{s.workspace?.name}</Text>
            <Text size="xs" c="dimmed">
              Folder “{s.folderName}” · {s.follower ? 'kept in step by another EnviroDB tab' : `checked ${ago(s.lastSync)}`}
            </Text>
          </div>
          <Divider />
          <PeopleList people={s.people} />
          <Divider />
          <Group justify="space-between">
            <Button size="compact-sm" variant="subtle" leftSection={<IconRefresh size={14} />} onClick={() => syncNow()} disabled={s.follower}>
              Check now
            </Button>
            <Anchor size="sm" onClick={() => navigate('/settings')}>
              Workspace settings
            </Anchor>
          </Group>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}

// ------------------------------------------------------------ in Settings

export function WorkspaceCard() {
  const s = useWorkspace();
  const leave = () =>
    modals.openConfirmModal({
      title: 'Leave the workspace?',
      children: (
        <Text size="sm">
          This browser’s copy is removed and EnviroDB will ask for a workspace folder again. Nothing changes in the folder – the workspace and everyone else’s work stay as they are.
        </Text>
      ),
      labels: { confirm: 'Leave and clear this browser', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: () => leaveWorkspace(),
    });
  return (
    <Card>
      <Group gap="xs" mb={4} justify="space-between">
        <Group gap="xs">
          <IconUsers size={20} />
          <Title order={4}>Shared workspace</Title>
        </Group>
        <Badge color={s.pending ? 'blue' : 'teal'} variant="light">
          {s.pending ? 'Saving…' : 'Everything saved'}
        </Badge>
      </Group>
      <Text size="sm" mb="sm">
        Connected to <b>{s.workspace?.name}</b> in the folder <b>{s.folderName}</b>. Every change is saved to the folder as you work and colleagues’ changes appear within a few seconds. A copy of everything is also kept
        in the folder’s <i>backups</i> folder each day (the last ten days).
      </Text>
      <Group align="flex-start" gap="xl" wrap="wrap">
        <Stack gap="xs" w={280}>
          <Text size="sm">
            Colleagues see you as <b>{s.myName || 'Someone'}</b> (your name, above).
          </Text>
          <Group gap="xs">
            <Button size="xs" variant="default" leftSection={<IconFolderOpen size={14} />} onClick={() => useAnotherFolder()}>
              Use a different folder
            </Button>
            <Button size="xs" variant="subtle" color="red" onClick={leave}>
              Leave…
            </Button>
          </Group>
        </Stack>
        <Box miw={240} style={{ flex: 1 }}>
          <Text size="sm" fw={500} mb={6}>
            People
          </Text>
          <PeopleList people={s.people} />
        </Box>
      </Group>
    </Card>
  );
}

// ------------------------------------------------------------ colleagues' changes

const TABLE_NAMES: Record<string, [string, string]> = {
  projects: ['project', 'projects'],
  sites: ['site', 'sites'],
  parameters: ['parameter', 'parameters'],
  samples: ['sample', 'samples'],
  results: ['result', 'results'],
  guidelineSets: ['guideline set', 'guideline sets'],
  rules: ['consent rule', 'consent rules'],
  notes: ['exceedance note', 'exceedance notes'],
  schedules: ['monitoring schedule', 'monitoring schedules'],
  obligations: ['reporting requirement', 'reporting requirements'],
  imports: ['import', 'imports'],
  templates: ['report template', 'report templates'],
  meta: ['piece of report work', 'pieces of report work'],
};

/** A short description of a record for notices: “project “Kōwhai Quarry””, “site DP1”, “report commentary” … */
export function describeRecord(t: string, k: string, rec: Record<string, unknown> | null): string {
  const named = (kind: string, field = 'name') => (rec?.[field] ? `${kind} “${String(rec[field])}”` : `a ${kind}`);
  switch (t) {
    case 'projects':
      return named('project');
    case 'sites':
      return rec?.code ? `site ${String(rec.code)}` : 'a site';
    case 'rules':
      return named('consent rule');
    case 'templates':
      return named('report template');
    case 'guidelineSets':
      return named('guideline set');
    case 'parameters':
      return named('parameter');
    case 'samples':
      return rec?.date ? `a sample from ${String(rec.date).slice(0, 10)}` : 'a sample';
    case 'meta':
      if (k === 'settings') return 'the team settings';
      if (k.startsWith('draft:')) return 'report commentary';
      if (k.startsWith('figs:')) return 'report figures';
      if (k.startsWith('layout:')) return 'a report layout';
      return 'a report’s sites';
    default:
      return `a ${TABLE_NAMES[t]?.[0] ?? 'record'}`;
  }
}

function summary(u: RemoteUpdate): Array<{ by: string; text: string }> {
  const byPerson = new Map<string, Map<string, number>>();
  for (const c of u.changes) {
    const m = byPerson.get(c.by) ?? new Map<string, number>();
    m.set(c.t, (m.get(c.t) ?? 0) + 1);
    byPerson.set(c.by, m);
  }
  return [...byPerson].map(([by, m]) => ({
    by,
    text: [...m]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([t, n]) => `${n} ${TABLE_NAMES[t]?.[n === 1 ? 0 : 1] ?? 'records'}`)
      .join(', '),
  }));
}

/** Notices about colleagues' changes as they arrive, and about changes to the same thing at the same time. */
export function RemoteNotices() {
  useEffect(
    () =>
      onRemoteUpdate((u) => {
        const joined = new Set(u.joined.map((p) => p.id));
        for (const p of u.joined) {
          const added = u.changes.filter((c) => c.by === p.id && c.t === 'projects' && c.action === 'added').map((c) => String(c.rec?.name ?? 'a project'));
          notifications.show({
            id: `joined-${p.id}`,
            title: `${p.name} joined the workspace`,
            message: added.length ? `and added ${added.length === 1 ? `the project “${added[0]}”` : `${added.length} projects`} from their browser` : 'They can now see and work on everything here.',
            color: 'blue',
            autoClose: 7000,
            icon: <IconUsers size={16} />,
          });
        }
        for (const { by, text } of summary({ ...u, changes: u.changes.filter((c) => !joined.has(c.by)) })) {
          notifications.show({ id: `remote-${by}`, title: `${u.names.get(by) ?? 'A colleague'} made changes`, message: `Updated here: ${text}`, color: 'teal', autoClose: 5000, icon: <IconCloudCheck size={16} /> });
        }
        const shown = u.conflicts.slice(0, 3);
        for (const c of shown) {
          const who = u.names.get(c.by) ?? 'A colleague';
          notifications.show({
            title: 'Changed by two people at once',
            message: c.deleted
              ? `${who} deleted ${describeRecord(c.t, c.k, c.rec)} that you had just changed.`
              : `${who} also changed ${describeRecord(c.t, c.k, c.rec)}${c.t === 'meta' ? '' : ` (${c.fields.map((f) => f.replace(/^\./, '')).join(', ')})`} – their later change is the one kept.`,
            color: 'yellow',
            autoClose: false,
            icon: <IconAlertTriangle size={16} />,
          });
        }
        if (u.conflicts.length > shown.length) notifications.show({ message: `…and ${u.conflicts.length - shown.length} more things changed by two people at once.`, color: 'yellow', autoClose: 10000 });
      }),
    [],
  );
  return null;
}
