import { useEffect, useState } from 'react';
import { MantineProvider, Center, Loader } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { ModalsProvider } from '@mantine/modals';
import { DatesProvider } from '@mantine/dates';
import { HashRouter, Route, Routes, Navigate } from 'react-router-dom';
import { theme } from './theme';
import { ensureBuiltIns, requestPersistence } from './db/db';
import { initAutosave } from './db/backup';
import { Shell } from './components/Shell';
import { DashboardPage } from './pages/Dashboard';
import { ProjectsPage } from './pages/Projects';
import { ProjectLayout } from './pages/project/ProjectLayout';
import { ImportPage } from './pages/Import';
import { GuidelinesPage } from './pages/Guidelines';
import { TemplatesPage, TemplateEditorPage } from './pages/Templates';
import { SettingsPage } from './pages/Settings';

export function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      try {
        await ensureBuiltIns();
        await initAutosave();
        void requestPersistence();
        setReady(true);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, []);

  return (
    <MantineProvider theme={theme} defaultColorScheme="light">
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
            <HashRouter>
              <Routes>
                <Route element={<Shell />}>
                  <Route index element={<DashboardPage />} />
                  <Route path="projects" element={<ProjectsPage />} />
                  <Route path="projects/:projectId/*" element={<ProjectLayout />} />
                  <Route path="import" element={<ImportPage />} />
                  <Route path="guidelines" element={<GuidelinesPage />} />
                  <Route path="guidelines/:setId" element={<GuidelinesPage />} />
                  <Route path="templates" element={<TemplatesPage />} />
                  <Route path="templates/:templateId" element={<TemplateEditorPage />} />
                  <Route path="settings" element={<SettingsPage />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Route>
              </Routes>
            </HashRouter>
          )}
        </ModalsProvider>
      </DatesProvider>
    </MantineProvider>
  );
}
