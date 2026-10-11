import { Badge, Button, Group, Menu, Stack, Tabs, Text, ActionIcon } from '@mantine/core';
import { Link, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { IconChartLine, IconDots, IconDownload, IconFileReport, IconLayoutDashboard, IconSettings, IconShieldCheck, IconTable, IconUpload, IconCalendarEvent } from '@tabler/icons-react';
import { ProjectDataProvider, useProject } from '../../hooks/useProjectData';
import { OverviewTab } from './Overview';
import { DataTab } from './Data';
import { ChartsTab } from './Charts';
import { ComplianceTab } from './Compliance';
import { ScheduleTab } from './Schedule';
import { ReportsTab } from './Reports';
import { SetupTab } from './Setup';
import { ImportWizard } from '../Import';
import { downloadProjectPackage } from '../../db/backup';

const TABS = [
  { value: 'overview', label: 'Overview', icon: IconLayoutDashboard },
  { value: 'data', label: 'Data', icon: IconTable },
  { value: 'charts', label: 'Graphs', icon: IconChartLine },
  { value: 'compliance', label: 'Compliance', icon: IconShieldCheck },
  { value: 'schedule', label: 'Schedule', icon: IconCalendarEvent },
  { value: 'reports', label: 'Reports', icon: IconFileReport },
  { value: 'setup', label: 'Setup', icon: IconSettings },
];

function Header() {
  const { project, sites, samples } = useProject();
  const navigate = useNavigate();
  const loc = useLocation();
  const base = `/projects/${project.id}`;
  const current = loc.pathname.slice(base.length + 1).split('/')[0] || 'overview';
  return (
    <Stack gap="sm" mb="md">
      <Group justify="space-between" align="flex-start" wrap="wrap" gap="sm">
        <div style={{ minWidth: 0, flex: 1 }}>
          <Group gap="xs">
            <Text fw={700} fz={{ base: 20, sm: 24 }} style={{ overflowWrap: 'anywhere' }}>
              {project.name}
            </Text>
            {project.code && <Badge variant="outline">{project.code}</Badge>}
            {project.status === 'archived' && <Badge color="gray">Archived</Badge>}
          </Group>
          <Text size="sm" c="dimmed">
            {[project.client, project.consents && `Consent ${project.consents}`, project.regulator, `${sites.length} sites`, `${samples.length} samples`].filter(Boolean).join(' · ')}
          </Text>
        </div>
        <Group gap="xs">
          <Button component={Link} to={`${base}/import`} leftSection={<IconUpload size={16} />}>
            Import results
          </Button>
          <Button component={Link} to={`${base}/reports`} variant="light" leftSection={<IconFileReport size={16} />}>
            Generate report
          </Button>
          <Menu position="bottom-end">
            <Menu.Target>
              <ActionIcon variant="default" size="lg" aria-label="More">
                <IconDots size={18} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
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
        <Tabs.List style={{ flexWrap: 'nowrap', overflowX: 'auto', overflowY: 'hidden' }}>
          {TABS.map((t) => (
            <Tabs.Tab key={t.value} value={t.value} leftSection={<t.icon size={16} />}>
              {t.label}
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs>
    </Stack>
  );
}

export function ProjectLayout() {
  const { projectId } = useParams();
  if (!projectId) return null;
  return (
    <ProjectDataProvider projectId={projectId}>
      <Header />
      <Routes>
        <Route index element={<OverviewTab />} />
        <Route path="data" element={<DataTab />} />
        <Route path="charts" element={<ChartsTab />} />
        <Route path="compliance" element={<ComplianceTab />} />
        <Route path="schedule" element={<ScheduleTab />} />
        <Route path="reports" element={<ReportsTab />} />
        <Route path="setup" element={<SetupTab />} />
        <Route path="import" element={<ImportWizard projectId={projectId} />} />
      </Routes>
    </ProjectDataProvider>
  );
}
