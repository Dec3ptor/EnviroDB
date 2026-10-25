import { useEffect, useState } from 'react';
import { Anchor, AppShell, Badge, Burger, Group, NavLink, Tabs, Text, ActionIcon, useMantineColorScheme, Divider, ScrollArea, Box } from '@mantine/core';
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
  IconDroplet,
  IconFlask,
  IconCalendarMonth,
  IconTestPipe,
} from '@tabler/icons-react';
import { db } from '../db/db';
import { WorkspaceBadge } from './workspace/Workspace';
import { VersionFooter } from './Version';
import { startInboxWatch, useInbox } from '../sync/inbox';
import { useFeature } from '../hooks/useFeatures';
import { noteTourOffered, Tour, tourToOffer } from './Onboarding';
import { SearchButton, SearchModal } from './Search';
import { ShortcutsHelp, useSearchAndShortcuts } from './Shortcuts';

/** The Library's pages: reference data shared by every project. */
export const LIBRARY = [
  { to: '/guidelines', label: 'Guidelines', icon: IconBook2 },
  { to: '/templates', label: 'Report templates', icon: IconTemplate },
  { to: '/parameters', label: 'Parameters', icon: IconFlask },
];

/** Importing and the Quick check: both start from a lab file. */
export const IMPORTING = [
  { to: '/import', label: 'Import data', icon: IconUpload },
  { to: '/quick-check', label: 'Quick check (no project)', icon: IconTestPipe },
];

/** Pages that go together, as tabs at the top of each: the Library's, or importing and the Quick check. */
export function SectionNav({ items }: { items: Array<{ to: string; label: string; icon: typeof IconBook2 }> }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const current = items.find((i) => pathname.startsWith(i.to))?.to ?? items[0].to;
  return (
    <Tabs value={current} onChange={(v) => v && navigate(v)} mb="md">
      <Tabs.List style={{ flexWrap: 'nowrap', overflowX: 'auto', overflowY: 'hidden', scrollbarWidth: 'none' }}>
        {items.map((i) => (
          <Tabs.Tab key={i.to} value={i.to} leftSection={<i.icon size={16} />}>
            {i.label}
          </Tabs.Tab>
        ))}
      </Tabs.List>
    </Tabs>
  );
}

export function Shell() {
  const [opened, { toggle, close }] = useDisclosure();
  const location = useLocation();
  const { colorScheme, toggleColorScheme } = useMantineColorScheme();
  const projects = useLiveQuery(() => db.projects.where('status').equals('active').toArray(), []);
  useEffect(() => close(), [location.pathname, close]);
  useEffect(() => startInboxWatch(), []);
  const inboxCount = useInbox().files.length;

  const path = location.pathname;
  const calendar = useFeature('calendar');
  const nav = [
    { to: '/', label: 'Dashboard', icon: IconLayoutDashboard, active: path === '/', tour: 'nav-dashboard' },
    { to: '/projects', label: 'Projects', icon: IconFolders, active: path === '/projects', tour: 'nav-projects' },
    ...(calendar ? [{ to: '/calendar', label: 'Monitoring calendar', icon: IconCalendarMonth, active: path.startsWith('/calendar'), tour: 'nav-calendar' }] : []),
    // the Quick check is with importing: both start from a lab file
    { to: '/import', label: 'Import data', icon: IconUpload, active: path.startsWith('/import') || path.startsWith('/quick-check'), badge: inboxCount, tour: 'nav-import' },
    // reference data shared by every project: guidelines, report templates and parameters
    { to: '/guidelines', label: 'Library', icon: IconBook2, active: LIBRARY.some((l) => path.startsWith(l.to)), tour: 'nav-library' },
  ];
  // Ctrl K search, ? for the shortcuts
  const { search, setSearch, help, setHelp } = useSearchAndShortcuts();
  // the tour: offered once when there's something to show, and whenever asked for
  const [tour, setTour] = useState(false);
  useEffect(() => {
    const on = () => setTour(true);
    window.addEventListener('edb:tour', on);
    return () => window.removeEventListener('edb:tour', on);
  }, []);
  useEffect(() => {
    if (projects?.length && tourToOffer()) {
      noteTourOffered();
      const t = setTimeout(() => setTour(true), 1200);
      return () => clearTimeout(t);
    }
  }, [projects?.length]);
  const recent = [...(projects ?? [])].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).slice(0, 8);

  return (
    <AppShell header={{ height: 56 }} navbar={{ width: 250, breakpoint: 'sm', collapsed: { mobile: !opened } }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="xs" wrap="nowrap">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            <Link to="/" style={{ textDecoration: 'none', color: 'inherit', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Box style={{ background: 'var(--mantine-primary-color-8)', borderRadius: 8, width: 30, height: 30, display: 'grid', placeItems: 'center' }}>
                <IconDroplet size={18} color="var(--mantine-primary-color-contrast)" />
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
            <SearchButton onClick={() => setSearch(true)} />
            <ActionIcon variant="default" size="lg" onClick={() => toggleColorScheme()} aria-label="Toggle colour scheme">
              {colorScheme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
            </ActionIcon>
          </Group>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="xs">
        <AppShell.Section>
          {nav.map((n) => (
            <NavLink
              key={n.to}
              component={Link}
              to={n.to}
              label={n.label}
              leftSection={<n.icon size={18} stroke={1.6} />}
              rightSection={'badge' in n && n.badge ? <Badge size="sm" variant="filled" title={`${n.badge} new lab file${n.badge === 1 ? '' : 's'} in the inbox`}>{n.badge}</Badge> : undefined}
              data-tour={n.tour}
              active={n.active}
              variant="light"
              style={{ borderRadius: 8 }}
            />
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
          <NavLink component={Link} to="/settings" label="Settings & backup" leftSection={<IconSettings size={18} stroke={1.6} />} active={path.startsWith('/settings')} variant="light" style={{ borderRadius: 8 }} data-tour="nav-settings" />
          <Text size="xs" c="dimmed" px="sm" py={4}>
            Saved to your team’s workspace folder as you work. <Anchor size="xs" onClick={() => setTour(true)}>Tour</Anchor>
          </Text>
          <VersionFooter />
        </AppShell.Section>
      </AppShell.Navbar>
      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
      <Tour open={tour} onClose={() => setTour(false)} />
      <SearchModal opened={search} onClose={() => setSearch(false)} />
      <ShortcutsHelp opened={help} onClose={() => setHelp(false)} />
    </AppShell>
  );
}
