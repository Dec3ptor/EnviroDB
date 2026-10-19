// Sharing report templates as a file, and importing a file someone sent.

import { useState } from 'react';
import { Alert, Badge, Button, Checkbox, Group, Modal, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconDownload, IconFileImport } from '@tabler/icons-react';
import { db } from '../../db/db';
import type { ReportTemplate } from '../../db/types';
import { downloadBlob } from '../../db/backup';
import { useSettings } from '../../hooks/useSettings';
import { templateFile, templateFileName, type TemplateImport } from '../../lib/templateShare';

/** Pick templates to share, and download them as one file. */
export function ShareTemplatesModal({ templates, initial, onClose }: { templates: ReportTemplate[]; initial: string[]; onClose: () => void }) {
  const settings = useSettings();
  const [picked, setPicked] = useState<Set<string>>(new Set(initial));
  const [signatures, setSignatures] = useState(false);
  const chosen = templates.filter((t) => picked.has(t.id));
  const hasSignatures = chosen.some((t) => t.blocks.some((b) => b.type === 'signatures' && b.signatories.some((s) => s.image)));
  const share = async () => {
    const [params, sets] = await Promise.all([db.parameters.toArray(), db.guidelineSets.toArray()]);
    const file = templateFile(chosen, { params, sets }, { signatures, by: settings.author });
    downloadBlob(new Blob([JSON.stringify(file)], { type: 'application/json' }), templateFileName(chosen));
    notifications.show({ color: 'teal', message: `${chosen.length === 1 ? `“${chosen[0].name}”` : `${chosen.length} templates`} saved as a file – send it to anyone using EnviroDB: they choose Import on their Report templates page.` });
    onClose();
  };
  const sorted = [...templates].sort((a, b) => Number(!!a.builtIn) - Number(!!b.builtIn) || a.name.localeCompare(b.name));
  return (
    <Modal opened onClose={onClose} title="Share report templates" size="lg">
      <Stack gap="sm">
        <Text size="sm" c="dimmed">
          Everyone in your workspace already has these. To give them to someone else – another team or company – save them as a file and send it; they choose <b>Import</b> on their Report templates page.
        </Text>
        <Stack gap={6} mah={340} style={{ overflowY: 'auto' }}>
          {sorted.map((t) => (
            <Checkbox
              key={t.id}
              checked={picked.has(t.id)}
              onChange={(e) => {
                const next = new Set(picked);
                if (e.currentTarget.checked) next.add(t.id);
                else next.delete(t.id);
                setPicked(next);
              }}
              label={
                <Group gap={6}>
                  <Text size="sm">{t.name}</Text>
                  {t.builtIn ? (
                    <Badge size="xs" variant="outline">
                      Built-in
                    </Badge>
                  ) : null}
                </Group>
              }
              description={`${t.blocks.length} sections${t.letterhead ? ' · on your letterhead' : ''}`}
            />
          ))}
        </Stack>
        {hasSignatures && <Checkbox checked={signatures} onChange={(e) => setSignatures(e.currentTarget.checked)} label="Include the signature pictures in their Signatures sections" description="Left out unless you tick this – they’re people’s signatures." />}
        <Text size="xs" c="dimmed">
          In the file: each template’s layout, sections, wording, logo and figures. Not in it: your letterhead (theirs is used), project data, sites or consent rules (they use their own), or your settings.
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button leftSection={<IconDownload size={16} />} disabled={!chosen.length} onClick={() => void share()}>
            Save {chosen.length === 1 ? 'the template' : `${chosen.length} templates`} as a file
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/** What's in a template file someone sent, and adding it. */
export function ImportTemplatesModal({ fileName, imports, onClose, onDone }: { fileName: string; imports: TemplateImport[]; onClose: () => void; onDone: (added: ReportTemplate[]) => void }) {
  const [picked, setPicked] = useState<Set<string>>(new Set(imports.map((i) => i.template.id)));
  const [busy, setBusy] = useState(false);
  const chosen = imports.filter((i) => picked.has(i.template.id));
  const add = async () => {
    setBusy(true);
    try {
      await db.templates.bulkPut(chosen.map((i) => i.template));
      notifications.show({ color: 'teal', message: `${chosen.length === 1 ? `“${chosen[0].template.name}”` : `${chosen.length} templates`} added – everyone in your workspace has ${chosen.length === 1 ? 'it' : 'them'} now.` });
      onDone(chosen.map((i) => i.template));
      onClose();
    } catch (e) {
      notifications.show({ color: 'red', message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal opened onClose={onClose} title="Import report templates" size="lg">
      <Stack gap="sm">
        <Text size="sm" c="dimmed">
          From <b>{fileName}</b>. They’re added as new templates for everyone in your workspace – nothing you have is changed.
        </Text>
        {imports.map((i) => (
          <Stack key={i.template.id} gap={4}>
            <Checkbox
              checked={picked.has(i.template.id)}
              onChange={(e) => {
                const next = new Set(picked);
                if (e.currentTarget.checked) next.add(i.template.id);
                else next.delete(i.template.id);
                setPicked(next);
              }}
              label={<Text size="sm" fw={600}>{i.template.name}</Text>}
              description={`${i.template.blocks.length} sections · ${i.template.pageSize} ${i.template.orientation}${i.template.style === 'letter' ? ' · letter' : ''}`}
            />
            {i.notes.length > 0 && (
              <Alert color="blue" variant="light" p="xs" ml={30}>
                {i.notes.map((n) => (
                  <Text size="xs" key={n}>
                    {n}
                  </Text>
                ))}
              </Alert>
            )}
          </Stack>
        ))}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button leftSection={<IconFileImport size={16} />} loading={busy} disabled={!chosen.length} onClick={() => void add()}>
            Add {chosen.length === 1 ? 'the template' : `${chosen.length} templates`}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
