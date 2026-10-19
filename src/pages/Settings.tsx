import { useEffect, useState } from 'react';
import { APP_BUILD, APP_VERSION } from '../lib/version';
import { QA_DEFAULTS } from '../lib/qa';
import { DEFAULT_LAB_DAYS, DEFAULT_SEND_DAYS } from '../lib/rounds';
import { Anchor, Badge, Button, Card, ColorInput, FileButton, Group, Modal, NumberInput, Select, SimpleGrid, Stack, Text, TextInput, Textarea, Title } from '@mantine/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { IconCloudUpload, IconDatabaseExport, IconDatabaseImport, IconShieldLock } from '@tabler/icons-react';
import { db, ensureBuiltIns, saveSettings } from '../db/db';
import { downloadWorkspaceBackup, readJsonFile, restoreWorkspace } from '../db/backup';
import { WorkspaceCard } from '../components/workspace/Workspace';
import { setMyName } from '../sync/workspace';
import { useSettings } from '../hooks/useSettings';
import { PageHeader } from '../components/common';
import type { Settings } from '../db/types';
import { SignatureInput, myDetails } from '../components/report/Signatures';
import { LetterheadCard } from '../components/report/Letterhead';
import { APP_COLOURS, DEFAULT_APP_COLOUR, isHexColour } from '../lib/palette';

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
          <TextInput
            label="Your name"
            description="“Prepared by” in reports ({{author}}), and how colleagues see you"
            value={author}
            onChange={(e) => setAuthor(e.currentTarget.value)}
            onBlur={() => {
              void saveSettings({ author });
              if (author.trim()) void setMyName(author);
            }}
          />
          <TextInput label="Company" description="The team’s – used in report footers ({{company}})" value={company} onChange={(e) => setCompany(e.currentTarget.value)} onBlur={() => saveSettings({ company })} />
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
          For report sign-offs where you are the signatory (“Me”). Paste your signature into the box – an image, or a whole signature copied from an email or a Word document – or upload one. It stays in this browser – colleagues use their own.
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

      <AppColourCard colour={settings.appColour} />

      <Card>
        <Title order={4} mb={4}>
          Sampling rounds
        </Title>
        <Text size="xs" c="dimmed" mb="xs">
          For the team: when a round on the monitoring calendar counts as overdue. Weekdays only.
        </Text>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <NumberInput
            label="Results due from the lab"
            description="Working days after the samples go to the lab"
            min={1}
            max={60}
            value={settings.labTurnaroundDays ?? DEFAULT_LAB_DAYS}
            onChange={(v) => typeof v === 'number' && v > 0 && void saveSettings({ labTurnaroundDays: v })}
            suffix=" working days"
          />
          <NumberInput
            label="Results to be sent on"
            description="Working days after they come back"
            min={1}
            max={60}
            value={settings.sendResultsDays ?? DEFAULT_SEND_DAYS}
            onChange={(v) => typeof v === 'number' && v > 0 && void saveSettings({ sendResultsDays: v })}
            suffix=" working days"
          />
        </SimpleGrid>
      </Card>

      <Card>
        <Title order={4} mb={4}>
          QA/QC checks
        </Title>
        <Text size="xs" c="dimmed" mb="xs">
          For the team: limits for field duplicates (relative percent difference) and how unusual a result must be before it’s flagged. Duplicates closer than 10× the detection limit have no limit.
        </Text>
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <NumberInput label="RPD limit" description="Results over 20× the detection limit" min={5} max={200} value={settings.qaRpdLimit ?? QA_DEFAULTS.rpdLimit} onChange={(v) => typeof v === 'number' && v > 0 && void saveSettings({ qaRpdLimit: v })} suffix="%" />
          <NumberInput label="RPD limit near detection" description="Results 10–20× the detection limit" min={5} max={200} value={settings.qaRpdLimitNearDl ?? QA_DEFAULTS.rpdLimitNearDl} onChange={(v) => typeof v === 'number' && v > 0 && void saveSettings({ qaRpdLimitNearDl: v })} suffix="%" />
          <NumberInput
            label="Unusual results"
            description="Robust standard deviations from the site’s others"
            min={2}
            max={10}
            step={0.5}
            decimalScale={1}
            value={settings.qaOutlierZ ?? QA_DEFAULTS.outlierZ}
            onChange={(v) => typeof v === 'number' && v >= 2 && void saveSettings({ qaOutlierZ: v })}
          />
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
        EnviroDB {APP_VERSION} (build {APP_BUILD.commit}{APP_BUILD.date ? `, ${APP_BUILD.date}` : ''}) · open source ·{' '}
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

/** The app's colour: this person's own, like light or dark. */
function AppColourCard({ colour }: { colour?: string }) {
  const saved = colour || DEFAULT_APP_COLOUR;
  const [value, setValue] = useState(saved);
  useEffect(() => setValue(saved), [saved]);
  const save = (v: string) => {
    const hex = v.trim().toLowerCase();
    if (isHexColour(hex) && hex !== saved) void saveSettings({ appColour: hex === DEFAULT_APP_COLOUR ? undefined : hex });
  };
  return (
    <Card>
      <Title order={4} mb={4}>
        App colour
      </Title>
      <Text size="sm" c="dimmed" mb="sm">
        The colour of buttons, links and highlights. It’s yours – colleagues choose their own. Reports and data packs keep their own colours (set in the template and the pack).
      </Text>
      <Group align="flex-end" gap="sm">
        <ColorInput label="Colour" w={220} format="hex" swatches={APP_COLOURS} swatchesPerRow={8} value={value} onChange={setValue} onChangeEnd={save} onBlur={() => !isHexColour(value) && setValue(saved)} />
        {saved !== DEFAULT_APP_COLOUR && (
          <Button variant="default" onClick={() => void saveSettings({ appColour: undefined })}>
            Back to teal
          </Button>
        )}
      </Group>
    </Card>
  );
}
