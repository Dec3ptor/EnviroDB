import { useEffect, useState } from 'react';
import { Anchor, Badge, Button, Card, FileButton, Group, Modal, Select, SimpleGrid, Stack, Text, TextInput, Textarea, Title } from '@mantine/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { IconCloudUpload, IconDatabaseExport, IconDatabaseImport, IconShieldLock } from '@tabler/icons-react';
import { db, ensureBuiltIns, saveSettings } from '../db/db';
import { downloadWorkspaceBackup, readJsonFile, restoreWorkspace } from '../db/backup';
import { WorkspaceCard } from '../components/workspace/Workspace';
import { useSettings } from '../hooks/useSettings';
import { PageHeader } from '../components/common';
import type { Settings } from '../db/types';
import { SignatureInput, myDetails } from '../components/report/Signatures';
import { LetterheadCard } from '../components/report/Letterhead';

function fmtBytes(n?: number) {
  if (!n) return '—';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
}

export function SettingsPage() {
  const settings = useSettings();
  const [author, setAuthor] = useState(settings.author);
  const [company, setCompany] = useState(settings.company);
  const [sigLines, setSigLines] = useState(myDetails(settings));
  useEffect(() => {
    setAuthor(settings.author);
    setCompany(settings.company);
    setSigLines(settings.signatureDetails ?? settings.company);
  }, [settings.author, settings.company, settings.signatureDetails]);
  const [estimate, setEstimate] = useState<{ usage?: number; quota?: number; persisted?: boolean }>({});
  useEffect(() => {
    (async () => {
      try {
        const e = await navigator.storage?.estimate?.();
        const persisted = await navigator.storage?.persisted?.();
        setEstimate({ usage: e?.usage, quota: e?.quota, persisted });
      } catch {
        /* ignore */
      }
    })();
  }, []);
  const counts = useLiveQuery(async () => ({ projects: await db.projects.count(), samples: await db.samples.count(), results: await db.results.count() }), []);
  const [restoreFile, setRestoreFile] = useState<unknown | null>(null);

  return (
    <Stack gap="lg">
      <PageHeader title="Settings & backup" />
      <Card>
        <Title order={4} mb="xs">
          Your details
        </Title>
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <TextInput label="Your name" description="Used for “Prepared by” in reports ({{author}})" value={author} onChange={(e) => setAuthor(e.currentTarget.value)} onBlur={() => saveSettings({ author })} />
          <TextInput label="Company" description="Used in report footers ({{company}})" value={company} onChange={(e) => setCompany(e.currentTarget.value)} onBlur={() => saveSettings({ company })} />
          <Select
            label="Date format"
            data={[
              { value: 'D MMM YYYY', label: '12 Mar 2026' },
              { value: 'DD/MM/YYYY', label: '12/03/2026' },
              { value: 'YYYY-MM-DD', label: '2026-03-12' },
            ]}
            value={settings.dateFormat}
            onChange={(v) => v && saveSettings({ dateFormat: v as typeof settings.dateFormat })}
            allowDeselect={false}
          />
        </SimpleGrid>
        <Text size="sm" fw={500} mt="md">
          Your signature
        </Text>
        <Text size="xs" c="dimmed" mb={6}>
          For report sign-offs where you are the signatory (“Me”). Paste your signature into the box – an image, or a whole signature copied from an email or a Word document – or upload one. It stays on this computer with the rest of your data.
        </Text>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <SignatureInput
            image={settings.signatureImage}
            name={settings.author}
            onImage={(signatureImage) => saveSettings({ signatureImage })}
            onPeople={([{ person, images }]) => {
              const patch: Partial<Settings> = {};
              if (person.name) patch.author = person.name;
              if (person.name || person.details.length) patch.signatureDetails = person.details.join('\n');
              if (images[0]) patch.signatureImage = images[0];
              void saveSettings(patch);
            }}
          />
          <Textarea label="Lines under your name" description="One per line, e.g. job title, qualifications, company" autosize minRows={2} maxRows={6} value={sigLines} onChange={(e) => setSigLines(e.currentTarget.value)} onBlur={() => sigLines !== myDetails(settings) && saveSettings({ signatureDetails: sigLines })} />
        </SimpleGrid>
      </Card>

      <LetterheadCard />

      <WorkspaceCard />

      <Card>
        <Group gap="xs" mb={4}>
          <IconShieldLock size={20} />
          <Title order={4}>Where your data is stored</Title>
        </Group>
        <Text size="sm" mb="sm">
          Your team’s data is kept in the workspace folder, and a working copy in this browser (IndexedDB) makes everything fast. Nothing is uploaded anywhere else: the folder is only as shared as you make it
          in SharePoint, OneDrive or on your network drive.
        </Text>
        <Card padding="md" bg="var(--mantine-color-body)">
          <Text fw={600} mb={4}>
            Backup file
          </Text>
          <Text size="sm" c="dimmed" mb="sm">
            Download everything as one file – projects, data, templates, report commentary and figures, and these settings (your signature and letterhead included) – or restore from a backup, such as one of the
            daily copies in the workspace’s <i>backups</i> folder. Last downloaded: {settings.lastBackupAt ? new Date(settings.lastBackupAt).toLocaleString('en-NZ') : 'never'}.
          </Text>
          <Group gap="xs">
            <Button leftSection={<IconDatabaseExport size={16} />} onClick={() => downloadWorkspaceBackup()}>
              Download backup
            </Button>
            <FileButton
              accept="application/json,.json"
              onChange={async (f) => {
                if (!f) return;
                try {
                  setRestoreFile(await readJsonFile(f));
                } catch (e) {
                  notifications.show({ message: (e as Error).message, color: 'red' });
                }
              }}
            >
              {(p) => (
                <Button variant="default" leftSection={<IconDatabaseImport size={16} />} {...p}>
                  Restore…
                </Button>
              )}
            </FileButton>
          </Group>
        </Card>
        <Group gap="lg" mt="md">
          <Text size="sm" c="dimmed">
            {counts ? `${counts.projects} projects · ${counts.samples.toLocaleString()} samples · ${counts.results.toLocaleString()} results` : ''}
          </Text>
          <Text size="sm" c="dimmed">
            Storage used here: {fmtBytes(estimate.usage)}
            {estimate.quota ? ` of ${fmtBytes(estimate.quota)} available` : ''}
          </Text>
          <Badge color={estimate.persisted ? 'teal' : 'gray'} variant="light">
            {estimate.persisted ? 'Protected from automatic clean-up' : 'Browser may clear its copy if disk is low'}
          </Badge>
        </Group>
      </Card>

      <Card style={{ borderColor: 'var(--mantine-color-red-3)' }}>
        <Title order={4} mb="xs">
          Built-in reference data
        </Title>
        <Group>
          <Button variant="default" onClick={async () => { await ensureBuiltIns(); notifications.show({ message: 'Built-in guideline sets, templates and parameters refreshed', color: 'teal' }); }}>
            Refresh built-in guidelines &amp; templates
          </Button>
        </Group>
      </Card>

      <Text size="xs" c="dimmed">
        EnviroDB v{__APP_VERSION__} · open source ·{' '}
        <Anchor href="https://github.com/Dec3ptor/EnviroDB" target="_blank" size="xs">
          GitHub
        </Anchor>
      </Text>

      <Modal opened={!!restoreFile} onClose={() => setRestoreFile(null)} title="Restore backup">
        <Stack>
          <Text size="sm">How should the backup be restored? It changes the shared workspace, so everyone connected sees the result.</Text>
          <Button
            leftSection={<IconCloudUpload size={16} />}
            onClick={async () => {
              try {
                await restoreWorkspace(restoreFile, 'merge');
                notifications.show({ message: 'Backup merged into the workspace', color: 'teal' });
              } catch (e) {
                notifications.show({ message: (e as Error).message, color: 'red' });
              }
              setRestoreFile(null);
            }}
          >
            Merge it into the workspace
          </Button>
          <Button
            color="red"
            variant="light"
            onClick={() =>
              modals.openConfirmModal({
                title: 'Replace all data?',
                children: <Text size="sm">Everything in the workspace – for everyone connected to it – will be replaced by the backup. Anything added since the backup was made is removed.</Text>,
                labels: { confirm: 'Replace everything', cancel: 'Cancel' },
                confirmProps: { color: 'red' },
                onConfirm: async () => {
                  try {
                    await restoreWorkspace(restoreFile, 'replace');
                    notifications.show({ message: 'Backup restored', color: 'teal' });
                  } catch (e) {
                    notifications.show({ message: (e as Error).message, color: 'red' });
                  }
                  setRestoreFile(null);
                },
              })
            }
          >
            Replace everything in the workspace
          </Button>
        </Stack>
      </Modal>

    </Stack>
  );
}
