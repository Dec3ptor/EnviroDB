import { InboxPanel } from '../../components/InboxPanel';
import { lazy, Suspense, useMemo, useState, type ReactNode } from 'react';
import { Badge, Button, Center, Group, Loader, Menu, Modal, SegmentedControl, Stack, Tabs, Text, ThemeIcon, UnstyledButton, ActionIcon } from '@mantine/core';
import { Link, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { IconChartLine, IconDots, IconDownload, IconFileReport, IconLayoutDashboard, IconSettings, IconShieldCheck, IconTable, IconUpload, IconSparkles, IconMap, IconDeviceMobile, IconDeviceMobileDown, IconQrcode } from '@tabler/icons-react';
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
import { FieldResultsModal, FieldSheetModal } from '../../components/FieldSheet';
import { ReceiveFromPhone } from '../../components/ReceiveFromPhone';
import { FieldCodesModal } from '../../components/FieldCodes';
import type { FieldResults } from '../../field/model';
import { useSettings, useSettingsReady } from '../../hooks/useSettings';
import { useFeatures } from '../../hooks/useFeatures';
import { featureOn, PROJECT_TABS, tabOf, viewOff, visibleViews, type ProjectView } from '../../lib/features';
import { EmptyState } from '../../components/common';
import { db } from '../../db/db';

// the map (and Leaflet) loads only when the tab is opened
const MapTab = lazy(() => import('./MapTab').then((m) => ({ default: m.MapTab })));
const PackTab = lazy(() => import('./Pack').then((m) => ({ default: m.PackTab })));

const TAB_ICONS: Record<string, typeof IconTable> = {
  overview: IconLayoutDashboard,
  data: IconTable,
  charts: IconChartLine,
  map: IconMap,
  compliance: IconShieldCheck,
  reports: IconFileReport,
  setup: IconSettings,
};

/** The project's QA/QC findings to look at (only worked out when the project has QA/QC on). */
function QaCount() {
  const qa = useProjectQa('12m');
  return qa.toCheck ? (
    <Badge size="xs" circle={qa.toCheck < 10} color="orange" title={`${qa.toCheck} to look at in the last 12 months`} aria-label={`${qa.toCheck} QA/QC findings to look at`}>
      {qa.toCheck}
    </Badge>
  ) : null;
}

/** Field work for a phone: the three ways, in one place. */
function FieldWorkModal({ opened, onClose, onPick }: { opened: boolean; onClose: () => void; onPick: (what: 'sheet' | 'codes' | 'receive') => void }) {
  const choices = [
    { what: 'sheet' as const, icon: IconDeviceMobile, title: 'Field sheet for a phone', text: 'The day’s sites and readings as a QR code to scan – the phone records the results, with or without a signal.' },
    { what: 'codes' as const, icon: IconQrcode, title: 'Printable field codes', text: 'A PDF of QR codes for the project and each site, to keep in the site folder or fix at the site.' },
    { what: 'receive' as const, icon: IconDeviceMobileDown, title: 'Receive from a phone', text: 'Take a phone’s results straight onto this computer, over Wi-Fi or by camera.' },
  ];
  return (
    <Modal opened={opened} onClose={onClose} title="Field work" size="md">
      <Stack gap="xs">
        {choices.map((c) => (
          <UnstyledButton key={c.what} onClick={() => onPick(c.what)} className="edb-choice">
            <Group wrap="nowrap" align="flex-start" gap="sm">
              <ThemeIcon variant="light" size={36} radius="md">
                <c.icon size={20} />
              </ThemeIcon>
              <div>
                <Text fw={600}>{c.title}</Text>
                <Text size="sm" c="dimmed">
                  {c.text}
                </Text>
              </div>
            </Group>
          </UnstyledButton>
        ))}
      </Stack>
    </Modal>
  );
}

function Header() {
  const { project, sites, samples } = useProject();
  const settings = useSettings();
  const on = useFeatures();
  const navigate = useNavigate();
  const loc = useLocation();
  const base = `/projects/${project.id}`;
  const current = (loc.pathname.slice(base.length + 1).split('/')[0] || 'overview') as ProjectView | 'import' | 'consent-setup';
  const [aiOpen, setAiOpen] = useState(false);
  const [fieldWork, setFieldWork] = useState(false);
  const [fieldOpen, setFieldOpen] = useState(false);
  const [codesOpen, setCodesOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [received, setReceived] = useState<{ results: FieldResults; name: string } | null>(null);
  const facts = useMemo(() => ({ project, sites, sampleDates: samples.map((x) => x.date) }), [project, sites, samples]);
  const tab = tabOf(current);
  const views = visibleViews(tab, facts, settings);
  // a view reached by a link shows in the switch even when it wouldn't otherwise (so you see where you are)
  const here = PROJECT_TABS.flatMap((t) => t.views).find((v) => v.value === current);
  const switchViews = here && !views.some((v) => v.value === here.value) ? [...views, here] : views;
  const go = (v: string) => navigate(v === 'overview' ? base : `${base}/${v}`);
  const meta = [project.client, project.consents && `Consent ${project.consents}`, project.regulator, `${sites.length} sites`, `${samples.length} samples`].filter(Boolean).join(' · ');
  const ai = on('ai');
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
          {ai && (
            <Button variant="default" leftSection={<IconSparkles size={16} />} onClick={() => setAiOpen(true)} visibleFrom="md">
              Copy for AI input
            </Button>
          )}
          <Menu position="bottom-end" width={260}>
            <Menu.Target>
              <ActionIcon variant="default" size={36} aria-label="More project actions">
                <IconDots size={18} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              {ai && (
                <Menu.Item leftSection={<IconSparkles size={16} />} onClick={() => setAiOpen(true)} hiddenFrom="md">
                  Copy for AI input
                </Menu.Item>
              )}
              {on('field') && (
                <Menu.Item leftSection={<IconDeviceMobile size={16} />} onClick={() => setFieldWork(true)}>
                  Field work…
                </Menu.Item>
              )}
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
      <Tabs value={tab} onChange={(v) => v && go(v)} variant="outline">
        <Tabs.List style={{ flexWrap: 'nowrap', overflowX: 'auto', overflowY: 'hidden', scrollbarWidth: 'none' }}>
          {PROJECT_TABS.map((t) => {
            const Icon = TAB_ICONS[t.value];
            return (
              <Tabs.Tab key={t.value} value={t.value} leftSection={<Icon size={16} />} rightSection={t.value === 'data' && project.qa ? <QaCount /> : undefined} ref={t.value === tab ? scrollIntoTabs : undefined}>
                {t.label}
              </Tabs.Tab>
            );
          })}
        </Tabs.List>
      </Tabs>
      {switchViews.length > 1 && current !== 'import' && current !== 'consent-setup' && (
        <SegmentedControl
          size="xs"
          value={current}
          onChange={go}
          style={{ alignSelf: 'flex-start' }}
          data={switchViews.map((v) => ({
            value: v.value,
            label:
              v.value === 'qa' && project.qa ? (
                <Group gap={6} wrap="nowrap">
                  <span>{v.label}</span>
                  <QaCount />
                </Group>
              ) : (
                v.label
              ),
          }))}
        />
      )}
      {ai && <AiInputModal opened={aiOpen} onClose={() => setAiOpen(false)} />}
      <FieldWorkModal
        opened={fieldWork}
        onClose={() => setFieldWork(false)}
        onPick={(w) => {
          setFieldWork(false);
          if (w === 'sheet') setFieldOpen(true);
          else if (w === 'codes') setCodesOpen(true);
          else setReceiveOpen(true);
        }}
      />
      <FieldSheetModal opened={fieldOpen} onClose={() => setFieldOpen(false)} />
      {codesOpen && <FieldCodesModal opened={codesOpen} onClose={() => setCodesOpen(false)} />}
      {receiveOpen && <ReceiveFromPhone opened={receiveOpen} onClose={() => setReceiveOpen(false)} onReceived={(results, name) => setReceived({ results, name })} />}
      {received && <FieldResultsModal results={received.results} fileName={received.name} onClose={() => setReceived(null)} />}
    </Stack>
  );
}

/**
 * A view that's switched off – QA/QC for this project, or a feature the team doesn't use – reached by a link: why,
 * and how to turn it on. Otherwise the view itself.
 */
function Shown({ view, children }: { view: ProjectView; children: ReactNode }) {
  const { project, sites, samples } = useProject();
  const settings = useSettingsReady();
  if (!settings) return null;
  // trends and NPS-FM without freshwater sites say for themselves what they need
  const why = view === 'qa' || view === 'pack' || (view === 'npsfm' && !featureOn(settings, 'npsfm')) ? viewOff(view, { project, sites, sampleDates: samples.map((x) => x.date) }, settings) : null;
  if (!why) return <>{children}</>;
  return (
    <EmptyState
      title={why}
      action={
        view === 'qa' ? (
          <Button onClick={() => void db.projects.update(project.id, { qa: true, updatedAt: new Date().toISOString() })}>Turn on QA/QC checks for this project</Button>
        ) : (
          <Button component={Link} to="/settings?tab=team" variant="default">
            Settings → Features
          </Button>
        )
      }
    >
      {view === 'qa' ? 'They look for duplicates that disagree, unusual results and bottles that may have been swapped. They can be turned off again in Setup.' : 'Anyone in the team can switch it on – for everyone – in Settings, under Team.'}
    </EmptyState>
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
        <Route path="qa" element={<Shown view="qa"><QaTab /></Shown>} />
        <Route path="trends" element={<TrendsTab />} />
        <Route path="npsfm" element={<Shown view="npsfm"><NpsfmTab /></Shown>} />
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
            <Shown view="pack">
              <Suspense
                fallback={
                  <Center h={300}>
                    <Loader />
                  </Center>
                }
              >
                <PackTab />
              </Suspense>
            </Shown>
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
