import { useEffect } from 'react';
import { AppShell, Burger, Group, NavLink, Text, ActionIcon, useMantineColorScheme, Divider, ScrollArea, Box } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { Link, Outlet, useLocation } from 'react-router-dom';
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
  IconDroplet,
  IconFlask,
  IconCalendarMonth,
  IconTestPipe,
} from '@tabler/icons-react';
import { db } from '../db/db';
import { WorkspaceBadge } from './workspace/Workspace';
import { VersionFooter } from './Version';

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
    { to: '/calendar', label: 'Monitoring calendar', icon: IconCalendarMonth, active: path.startsWith('/calendar') },
    { to: '/import', label: 'Import data', icon: IconUpload, active: path.startsWith('/import') },
    { to: '/quick-check', label: 'Quick check', icon: IconTestPipe, active: path.startsWith('/quick-check') },
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
            <WorkspaceBadge />
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
            Saved to your team’s workspace folder as you work.
          </Text>
          <VersionFooter />
        </AppShell.Section>
      </AppShell.Navbar>
      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
