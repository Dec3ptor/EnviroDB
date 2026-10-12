import { useEffect, useState } from 'react';
import { AppShell, Burger, Group, NavLink, Text, Button, ActionIcon, Tooltip, useMantineColorScheme, Divider, ScrollArea, Badge, Box } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  IconLayoutDashboard,
  IconFolders,
  IconUpload,
  IconBook2,
  IconTemplate,
  IconSettings,
  IconMoon,
  IconSun,
  IconCloudCheck,
  IconCloudOff,
  IconAlertTriangle,
  IconDroplet,
  IconFlask,
} from '@tabler/icons-react';
import { db } from '../db/db';
import { getAutosaveState, onAutosaveChange, regrantAutosave, type AutosaveState } from '../db/backup';
import { useSettings } from '../hooks/useSettings';

function AutosaveIndicator() {
  const [s, setS] = useState<AutosaveState>(getAutosaveState());
  const settings = useSettings();
  const navigate = useNavigate();
  useEffect(() => {
    const off = onAutosaveChange(setS);
    return () => {
      off();
    };
  }, []);
  if (s.status === 'on')
    return (
      <Tooltip label={`Autosaving to ${s.fileName}${s.lastSaved ? ` – last saved ${new Date(s.lastSaved).toLocaleTimeString()}` : ''}`}>
        <Badge color="teal" variant="light" leftSection={<IconCloudCheck size={14} />} style={{ cursor: 'pointer' }} onClick={() => navigate('/settings')}>
          Autosave on
        </Badge>
      </Tooltip>
    );
  if (s.status === 'needs-permission')
    return (
      <Button size="compact-sm" color="orange" variant="light" leftSection={<IconAlertTriangle size={14} />} onClick={() => regrantAutosave()}>
        Resume autosave to {s.fileName}
      </Button>
    );
  if (s.status === 'error')
    return (
      <Tooltip label={s.error}>
        <Badge color="red" leftSection={<IconAlertTriangle size={14} />}>
          Autosave failed
        </Badge>
      </Tooltip>
    );
  const days = settings.lastBackupAt ? Math.floor((Date.now() - new Date(settings.lastBackupAt).getTime()) / 86400000) : null;
  return (
    <Tooltip label="Your data is stored in this browser. Link an autosave file (e.g. in OneDrive) or download a backup regularly.">
      <Badge color={days === null || days > 7 ? 'orange' : 'gray'} variant="light" leftSection={<IconCloudOff size={14} />} style={{ cursor: 'pointer' }} onClick={() => navigate('/settings')}>
        {days === null ? 'Not backed up' : `Backup ${days}d ago`}
      </Badge>
    </Tooltip>
  );
}

export function Shell() {
  const [opened, { toggle, close }] = useDisclosure();
  const location = useLocation();
  const { colorScheme, toggleColorScheme } = useMantineColorScheme();
  const projects = useLiveQuery(() => db.projects.where('status').equals('active').toArray(), []);
  useEffect(() => close(), [location.pathname, close]);

  const path = location.pathname;
  const nav = [
    { to: '/', label: 'Dashboard', icon: IconLayoutDashboard, active: path === '/' },
    { to: '/projects', label: 'Projects', icon: IconFolders, active: path === '/projects' },
    { to: '/import', label: 'Import data', icon: IconUpload, active: path.startsWith('/import') },
  ];
  // reference data shared by every project
  const library = [
    { to: '/guidelines', label: 'Guidelines', icon: IconBook2, active: path.startsWith('/guidelines') },
    { to: '/templates', label: 'Report templates', icon: IconTemplate, active: path.startsWith('/templates') },
    { to: '/parameters', label: 'Parameters', icon: IconFlask, active: path.startsWith('/parameters') },
  ];
  const recent = [...(projects ?? [])].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).slice(0, 8);

  return (
    <AppShell header={{ height: 56 }} navbar={{ width: 250, breakpoint: 'sm', collapsed: { mobile: !opened } }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="xs" wrap="nowrap">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            <Link to="/" style={{ textDecoration: 'none', color: 'inherit', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Box style={{ background: 'var(--mantine-color-teal-8)', borderRadius: 8, width: 30, height: 30, display: 'grid', placeItems: 'center' }}>
                <IconDroplet size={18} color="white" />
              </Box>
              <Text fw={700} size="lg">
                EnviroDB
              </Text>
            </Link>
            <Text c="dimmed" size="sm" visibleFrom="md">
              Monitoring · compliance · reporting
            </Text>
          </Group>
          <Group gap="xs" wrap="nowrap">
            <AutosaveIndicator />
            <ActionIcon variant="default" size="lg" onClick={() => toggleColorScheme()} aria-label="Toggle colour scheme">
              {colorScheme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
            </ActionIcon>
          </Group>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="xs">
        <AppShell.Section>
          {nav.map((n) => (
            <NavLink key={n.to} component={Link} to={n.to} label={n.label} leftSection={<n.icon size={18} stroke={1.6} />} active={n.active} variant="light" style={{ borderRadius: 8 }} />
          ))}
          <Divider my={6} label="Library" labelPosition="left" />
          {library.map((n) => (
            <NavLink key={n.to} component={Link} to={n.to} label={n.label} leftSection={<n.icon size={18} stroke={1.6} />} active={n.active} variant="light" style={{ borderRadius: 8 }} />
          ))}
        </AppShell.Section>
        <Divider my={6} label="Recent projects" labelPosition="left" />
        <AppShell.Section grow component={ScrollArea}>
          {recent.map((p) => (
            <NavLink
              key={p.id}
              component={Link}
              to={`/projects/${p.id}`}
              label={p.name}
              description={p.code}
              active={path.startsWith(`/projects/${p.id}`)}
              variant="light"
              style={{ borderRadius: 8 }}
            />
          ))}
          {!recent.length && (
            <Text size="sm" c="dimmed" px="sm">
              No projects yet
            </Text>
          )}
        </AppShell.Section>
        <AppShell.Section>
          <NavLink component={Link} to="/settings" label="Settings & backup" leftSection={<IconSettings size={18} stroke={1.6} />} active={path.startsWith('/settings')} variant="light" style={{ borderRadius: 8 }} />
          <Text size="xs" c="dimmed" px="sm" py={4}>
            Data stays in this browser unless you export or autosave it.
          </Text>
        </AppShell.Section>
      </AppShell.Navbar>
      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
