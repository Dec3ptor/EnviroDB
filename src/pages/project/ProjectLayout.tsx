import { InboxPanel } from '../../components/InboxPanel';
import { lazy, Suspense, useState } from 'react';
import { Badge, Button, Center, Group, Loader, Menu, Stack, Tabs, Text, ActionIcon } from '@mantine/core';
import { Link, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { IconChartLine, IconDots, IconDownload, IconFileReport, IconLayoutDashboard, IconSettings, IconShieldCheck, IconTable, IconUpload, IconCalendarEvent, IconSparkles, IconMap, IconListCheck, IconTrendingUp, IconFlag, IconPackageExport } from '@tabler/icons-react';
import { ProjectDataProvider, useProject } from '../../hooks/useProjectData';
import { OverviewTab } from './Overview';
import { DataTab } from './Data';
import { QaTab } from './QA';
import { TrendsTab } from './Trends';
import { NpsfmTab } from './Npsfm';
import { useProjectQa } from '../../hooks/useQa';
import { ChartsTab } from './Charts';
import { ComplianceTab } from './Compliance';
import { ScheduleTab } from './Schedule';
import { ReportsTab } from './Reports';
import { SetupTab } from './Setup';
import { ImportWizard } from '../Import';
import { ConsentSetupPage } from './ConsentSetup';
import { downloadProjectPackage } from '../../db/backup';
import { AiInputModal } from '../../components/AiInputModal';

// the map (and Leaflet) loads only when the tab is opened
const MapTab = lazy(() => import('./MapTab').then((m) => ({ default: m.MapTab })));
const PackTab = lazy(() => import('./Pack').then((m) => ({ default: m.PackTab })));

const TABS = [
  { value: 'overview', label: 'Overview', icon: IconLayoutDashboard },
  { value: 'data', label: 'Data', icon: IconTable },
  { value: 'qa', label: 'QA/QC', icon: IconListCheck },
  { value: 'charts', label: 'Graphs', icon: IconChartLine },
  { value: 'trends', label: 'Trends', icon: IconTrendingUp },
  { value: 'map', label: 'Map', icon: IconMap },
  { value: 'compliance', label: 'Compliance', icon: IconShieldCheck },
  { value: 'npsfm', label: 'NPS-FM', icon: IconFlag },
  { value: 'schedule', label: 'Schedule', icon: IconCalendarEvent },
  { value: 'reports', label: 'Reports', icon: IconFileReport },
  { value: 'pack', label: 'Data pack', icon: IconPackageExport },
  { value: 'setup', label: 'Setup', icon: IconSettings },
];

function Header() {
  const { project, sites, samples } = useProject();
  const navigate = useNavigate();
  const loc = useLocation();
  const base = `/projects/${project.id}`;
  const current = loc.pathname.slice(base.length + 1).split('/')[0] || 'overview';
  const [aiOpen, setAiOpen] = useState(false);
  const qa = useProjectQa('12m');
  const meta = [project.client, project.consents && `Consent ${project.consents}`, project.regulator, `${sites.length} sites`, `${samples.length} samples`].filter(Boolean).join(' · ');
  return (
    <Stack gap="sm" mb="md">
      <Group justify="space-between" align="flex-start" wrap="nowrap" gap="sm">
        <div style={{ minWidth: 0, flex: 1 }}>
          <Group gap="xs" wrap="nowrap" align="center">
            <Text fw={700} fz={{ base: 19, sm: 24 }} lh={1.25} lineClamp={2} style={{ overflowWrap: 'anywhere' }}>
              {project.name}
            </Text>
            {project.code && (
              <Badge variant="outline" visibleFrom="xs" style={{ flexShrink: 0 }}>
                {project.code}
              </Badge>
            )}
            {project.status === 'archived' && <Badge color="gray">Archived</Badge>}
          </Group>
          <Text size="sm" c="dimmed" lineClamp={1} title={meta}>
            {meta}
          </Text>
        </div>
        <Group gap="xs" wrap="nowrap">
          {current !== 'import' && (
            <Button component={Link} to={`${base}/import`} leftSection={<IconUpload size={16} />} px={{ base: 'sm', sm: 'md' }}>
              <Text span inherit visibleFrom="sm">
                Import results
              </Text>
              <Text span inherit hiddenFrom="sm">
                Import
              </Text>
            </Button>
          )}
          <Button variant="default" leftSection={<IconSparkles size={16} />} onClick={() => setAiOpen(true)} visibleFrom="md">
            Copy for AI input
          </Button>
          <Menu position="bottom-end" width={260}>
            <Menu.Target>
              <ActionIcon variant="default" size={36} aria-label="More project actions">
                <IconDots size={18} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item leftSection={<IconSparkles size={16} />} onClick={() => setAiOpen(true)} hiddenFrom="md">
                Copy for AI input
              </Menu.Item>
              <Menu.Item leftSection={<IconDownload size={16} />} onClick={() => downloadProjectPackage(project.id)}>
                Download project file (to share)
              </Menu.Item>
              <Menu.Item leftSection={<IconSettings size={16} />} onClick={() => navigate(`${base}/setup`)}>
                Project setup
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Group>
      <Tabs value={current} onChange={(v) => navigate(!v || v === 'overview' ? base : `${base}/${v}`)} variant="outline">
        <Tabs.List style={{ flexWrap: 'nowrap', overflowX: 'auto', overflowY: 'hidden', scrollbarWidth: 'none' }}>
          {TABS.map((t) => (
            <Tabs.Tab
              key={t.value}
              value={t.value}
              leftSection={<t.icon size={16} />}
              rightSection={
                t.value === 'qa' && qa.toCheck ? (
                  <Badge size="xs" circle={qa.toCheck < 10} color="orange" title={`${qa.toCheck} to look at in the last 12 months`} aria-label={`${qa.toCheck} to look at`}>
                    {qa.toCheck}
                  </Badge>
                ) : undefined
              }
              ref={t.value === current ? scrollIntoTabs : undefined}
            >
              {t.label}
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs>
      <AiInputModal opened={aiOpen} onClose={() => setAiOpen(false)} />
    </Stack>
  );
}

/** Keep the current tab in view when the tab bar scrolls sideways (phones). */
const scrollIntoTabs = (el: HTMLButtonElement | null) => el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });

export function ProjectLayout() {
  const { projectId } = useParams();
  if (!projectId) return null;
  return (
    <ProjectDataProvider projectId={projectId}>
      <Header />
      <Routes>
        <Route index element={<OverviewTab />} />
        <Route path="data" element={<DataTab />} />
        <Route path="qa" element={<QaTab />} />
        <Route path="trends" element={<TrendsTab />} />
        <Route path="npsfm" element={<NpsfmTab />} />
        <Route path="charts" element={<ChartsTab />} />
        <Route
          path="map"
          element={
            <Suspense
              fallback={
                <Center h={300}>
                  <Loader />
                </Center>
              }
            >
              <MapTab />
            </Suspense>
          }
        />
        <Route path="compliance" element={<ComplianceTab />} />
        <Route path="schedule" element={<ScheduleTab />} />
        <Route path="reports" element={<ReportsTab />} />
        <Route
          path="pack"
          element={
            <Suspense
              fallback={
                <Center h={300}>
                  <Loader />
                </Center>
              }
            >
              <PackTab />
            </Suspense>
          }
        />
        <Route path="setup" element={<SetupTab />} />
        <Route
          path="import"
          element={
            <Stack gap="md">
              <InboxPanel projectId={projectId} />
              <ImportWizard projectId={projectId} />
            </Stack>
          }
        />
        <Route path="consent-setup" element={<ConsentSetupPage />} />
      </Routes>
    </ProjectDataProvider>
  );
}
