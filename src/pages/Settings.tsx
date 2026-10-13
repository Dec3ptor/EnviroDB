import { useEffect, useState } from 'react';
import { Alert, Anchor, Badge, Button, Card, FileButton, Group, Modal, Select, SimpleGrid, Stack, Text, TextInput, Textarea, Title } from '@mantine/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { IconCloudUpload, IconDatabaseExport, IconDatabaseImport, IconLink, IconTrash, IconUnlink, IconShieldLock } from '@tabler/icons-react';
import { db, DATA_TABLES, ensureBuiltIns, saveSettings } from '../db/db';
import { autosaveSupported, downloadWorkspaceBackup, getAutosaveState, linkAutosaveFile, onAutosaveChange, readJsonFile, regrantAutosave, restoreWorkspace, unlinkAutosaveFile, type AutosaveState } from '../db/backup';
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
  const [auto, setAuto] = useState<AutosaveState>(getAutosaveState());
  useEffect(() => {
    const off = onAutosaveChange(setAuto);
    return () => {
      off();
    };
  }, []);
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
  const [wipe, setWipe] = useState(false);
  const [confirmText, setConfirmText] = useState('');

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

      <Card>
        <Group gap="xs" mb={4}>
          <IconShieldLock size={20} />
          <Title order={4}>Where your data is stored</Title>
        </Group>
        <Text size="sm" mb="sm">
          EnviroDB is a website, but your monitoring data never leaves your computer: it is kept in a database inside this browser (IndexedDB). That keeps client data private and makes everything fast and work offline, but it also means
          <b> clearing browser data, or using another computer or browser, will not show your projects</b>. Keep a copy using one of the options below.
        </Text>
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
          <Card padding="md" bg="var(--mantine-color-body)">
            <Group justify="space-between" mb={4}>
              <Text fw={600}>Autosave to a file</Text>
              {auto.status === 'on' ? <Badge color="teal">On</Badge> : auto.status === 'needs-permission' ? <Badge color="orange">Paused</Badge> : <Badge color="gray">Off</Badge>}
            </Group>
            <Text size="sm" c="dimmed" mb="sm">
              Save every change to a file you choose – put it in a OneDrive / SharePoint / Teams folder and it is backed up and can be opened on another computer.
            </Text>
            {!autosaveSupported() ? (
              <Alert color="orange" variant="light">
                Your browser can't write to files directly. Use Microsoft Edge or Google Chrome for autosave, or download backups below.
              </Alert>
            ) : auto.status === 'off' ? (
              <Button leftSection={<IconLink size={16} />} onClick={() => linkAutosaveFile().catch((e) => e.name !== 'AbortError' && notifications.show({ message: e.message, color: 'red' }))}>
                Choose autosave file…
              </Button>
            ) : (
              <Stack gap="xs">
                <Text size="sm">
                  File: <b>{auto.fileName}</b>
                  {'lastSaved' in auto && auto.lastSaved ? ` · last saved ${new Date(auto.lastSaved).toLocaleString('en-NZ')}` : ''}
                </Text>
                <Group gap="xs">
                  {auto.status === 'needs-permission' && (
                    <Button size="xs" color="orange" onClick={() => regrantAutosave()}>
                      Resume autosave
                    </Button>
                  )}
                  <Button size="xs" variant="default" leftSection={<IconUnlink size={14} />} onClick={() => unlinkAutosaveFile()}>
                    Stop autosaving
                  </Button>
                </Group>
              </Stack>
            )}
          </Card>
          <Card padding="md" bg="var(--mantine-color-body)">
            <Text fw={600} mb={4}>
              Backup file
            </Text>
            <Text size="sm" c="dimmed" mb="sm">
              Download everything as one file – projects, data, templates, report commentary and figures, and these settings (your signature and letterhead included) – or restore from a backup / autosave file. Last backup: {settings.lastBackupAt ? new Date(settings.lastBackupAt).toLocaleString('en-NZ') : 'never'}.
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
        </SimpleGrid>
        <Group gap="lg" mt="md">
          <Text size="sm" c="dimmed">
            {counts ? `${counts.projects} projects · ${counts.samples.toLocaleString()} samples · ${counts.results.toLocaleString()} results` : ''}
          </Text>
          <Text size="sm" c="dimmed">
            Storage used: {fmtBytes(estimate.usage)}
            {estimate.quota ? ` of ${fmtBytes(estimate.quota)} available` : ''}
          </Text>
          <Badge color={estimate.persisted ? 'teal' : 'gray'} variant="light">
            {estimate.persisted ? 'Protected from automatic clean-up' : 'Browser may clear data if disk is low'}
          </Badge>
        </Group>
        <Text size="xs" c="dimmed" mt="sm">
          Want a shared database for your team? A hosted database (e.g. Supabase, Firebase or an Azure service) can be connected later – but client data would then sit on that provider's servers, so check with your IT / data governance team first. Sharing a project file (project menu → “Download project file”) works today.
        </Text>
      </Card>


      <Card style={{ borderColor: 'var(--mantine-color-red-3)' }}>
        <Title order={4} mb="xs">
          Reset
        </Title>
        <Group>
          <Button variant="default" onClick={async () => { await ensureBuiltIns(); notifications.show({ message: 'Built-in guideline sets, templates and parameters refreshed', color: 'teal' }); }}>
            Refresh built-in guidelines &amp; templates
          </Button>
          <Button color="red" variant="light" leftSection={<IconTrash size={16} />} onClick={() => setWipe(true)}>
            Delete all data in this browser
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
          <Text size="sm">How should the backup be restored?</Text>
          <Button
            leftSection={<IconCloudUpload size={16} />}
            onClick={async () => {
              try {
                await restoreWorkspace(restoreFile, 'merge');
                notifications.show({ message: 'Backup merged into your data', color: 'teal' });
              } catch (e) {
                notifications.show({ message: (e as Error).message, color: 'red' });
              }
              setRestoreFile(null);
            }}
          >
            Merge with my current data
          </Button>
          <Button
            color="red"
            variant="light"
            onClick={() =>
              modals.openConfirmModal({
                title: 'Replace all data?',
                children: <Text size="sm">Everything currently in this browser will be replaced by the backup.</Text>,
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
            Replace all my data with the backup
          </Button>
        </Stack>
      </Modal>

      <Modal opened={wipe} onClose={() => setWipe(false)} title="Delete all data?">
        <Stack>
          <Text size="sm">This permanently deletes every project, result, rule, template and setting stored in this browser. Type DELETE to confirm.</Text>
          <TextInput value={confirmText} onChange={(e) => setConfirmText(e.currentTarget.value)} placeholder="DELETE" />
          <Text size="xs" c="dimmed">
            Autosave is switched off first so your autosave file is not overwritten.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setWipe(false)}>
              Cancel
            </Button>
            <Button
              color="red"
              disabled={confirmText !== 'DELETE'}
              onClick={async () => {
                await unlinkAutosaveFile();
                await db.transaction('rw', [...DATA_TABLES.map((t) => db.table(t)), db.meta], async () => {
                  for (const t of DATA_TABLES) await db.table(t).clear();
                  await db.meta.clear();
                });
                await ensureBuiltIns();
                setWipe(false);
                notifications.show({ message: 'All data deleted', color: 'teal' });
              }}
            >
              Delete everything
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
