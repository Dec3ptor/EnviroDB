import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { MantineProvider, Center, Loader } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { ModalsProvider } from '@mantine/modals';
import { DatesProvider } from '@mantine/dates';
import { HashRouter, Route, Routes, Navigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { makeTheme, theme, themeVariables } from './theme';
import { ensureBuiltIns, getSettings, requestPersistence } from './db/db';
import { startWorkspace } from './sync/workspace';
import { WorkspaceGate } from './components/workspace/Workspace';
import { Shell } from './components/Shell';
import { DashboardPage } from './pages/Dashboard';
import { ProjectsPage } from './pages/Projects';
import { ProjectLayout } from './pages/project/ProjectLayout';
import { ImportPage } from './pages/Import';
import { GuidelinesPage } from './pages/Guidelines';
import { TemplatesPage, TemplateEditorPage } from './pages/Templates';
import { SettingsPage } from './pages/Settings';
import { ParametersPage } from './pages/Parameters';
import { CalendarPage } from './pages/Calendar';
import { QuickCheckPage } from './pages/QuickCheck';

// field mode, on a phone: its own small app, without the team's shared folder (loaded only when opened)
const FieldApp = lazy(() => import('./field/FieldApp'));
const isField = () => /^#\/field(\/|\?|$)/.test(window.location.hash);

export function App() {
  const [field] = useState(isField);
  // going between field mode and the rest of EnviroDB starts the page again
  useEffect(() => {
    const onHash = () => isField() !== field && window.location.reload();
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [field]);
  if (field)
    return (
      <MantineProvider theme={theme} defaultColorScheme="light">
        <Notifications position="top-center" />
        <Suspense
          fallback={
            <Center h="100vh">
              <Loader />
            </Center>
          }
        >
          <FieldApp />
        </Suspense>
      </MantineProvider>
    );
  return <MainApp />;
}

function MainApp() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // the app's colour, as chosen in Settings
  const colour = useLiveQuery(async () => (await getSettings()).appColour ?? '', [], '');
  const appTheme = useMemo(() => makeTheme(colour), [colour]);
  const appVariables = useMemo(() => themeVariables(colour), [colour]);
  useEffect(() => {
    (async () => {
      try {
        await ensureBuiltIns();
        void requestPersistence();
        setReady(true);
        await startWorkspace();
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, []);

  return (
    <MantineProvider theme={appTheme} cssVariablesResolver={appVariables} defaultColorScheme="light">
      <DatesProvider settings={{ firstDayOfWeek: 1, locale: 'en' }}>
        <ModalsProvider>
          <Notifications position="top-right" />
          {error ? (
            <Center h="100vh" p="xl">
              Could not open the local database: {error}. Private/incognito windows may block storage.
            </Center>
          ) : !ready ? (
            <Center h="100vh">
              <Loader />
            </Center>
          ) : (
            <WorkspaceGate>
              <HashRouter>
                <Routes>
                  <Route element={<Shell />}>
                    <Route index element={<DashboardPage />} />
                    <Route path="projects" element={<ProjectsPage />} />
                    <Route path="calendar" element={<CalendarPage />} />
                    <Route path="projects/:projectId/*" element={<ProjectLayout />} />
                    <Route path="import" element={<ImportPage />} />
                    <Route path="quick-check" element={<QuickCheckPage />} />
                    <Route path="guidelines" element={<GuidelinesPage />} />
                    <Route path="guidelines/:setId" element={<GuidelinesPage />} />
                    <Route path="templates" element={<TemplatesPage />} />
                    <Route path="templates/:templateId" element={<TemplateEditorPage />} />
                    <Route path="parameters" element={<ParametersPage />} />
                    <Route path="settings" element={<SettingsPage />} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Route>
                </Routes>
              </HashRouter>
            </WorkspaceGate>
          )}
        </ModalsProvider>
      </DatesProvider>
    </MantineProvider>
  );
}
