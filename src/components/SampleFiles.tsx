// A sample's files, in its details: those linked to it (a lab job's result sheet, an import's file, its round's chain
// of custody, or one added here), each opened here – and Add files, kept in the shared folder and linked to the sample.

import { useState } from 'react';
import { Anchor, Badge, Button, FileButton, Group, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { Link } from 'react-router-dom';
import { IconExternalLink, IconPaperclip } from '@tabler/icons-react';
import type { Project, ProjectFile, Result, Sample } from '../db/types';
import { useProjectFiles, useRoundRows } from '../hooks/useProjectFiles';
import { addProjectFiles, fileIsAbout, kindLabel, linkProjectFile, webAddress } from '../lib/projectFiles';
import { currentWorkspaceFolder, useWorkspace } from '../sync/workspace';
import { FileIcon, FileViewer } from './FileViewer';

/** `onViewing`: told when a file is open over the details (so Escape closes only the file). */
export function SampleFiles({ sample, results, project, siteCode, onViewing }: { sample: Sample; results: Result[]; project: Pick<Project, 'id' | 'code' | 'name'>; siteCode?: string; onViewing?: (open: boolean) => void }) {
  const files = useProjectFiles(project.id);
  const rounds = useRoundRows(project.id);
  const ws = useWorkspace();
  const [viewing, setShown] = useState<ProjectFile | null>(null);
  const setViewing = (f: ProjectFile | null) => {
    setShown(f);
    onViewing?.(!!f);
  };
  const [busy, setBusy] = useState(false);
  const mine = files.filter((f) => fileIsAbout(f, sample, results, rounds));
  const canKeep = ws.phase === 'ready' && !!currentWorkspaceFolder()?.writeBlob;
  if (!mine.length && !canKeep) return null;
  const add = async (list: File[]) => {
    if (!list.length) return;
    setBusy(true);
    try {
      const r = await addProjectFiles(project, list);
      for (const f of r.added) await linkProjectFile(f, { kind: 'samples', sampleIds: [sample.id] }, `${siteCode ?? 'a'} sample of ${sample.date.slice(0, 10)}`);
      if (r.added.length) notifications.show({ color: 'teal', message: `${r.added.length} file${r.added.length === 1 ? '' : 's'} added to the sample – in the project’s Files too.` });
      if (r.skipped.length) notifications.show({ color: 'blue', message: `Already with the project: ${r.skipped.join(', ')} – link it from the Files tab.` });
      for (const e of r.errors) notifications.show({ color: 'red', message: e });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Stack gap={4}>
      <Group justify="space-between">
        <Text fw={600} size="sm">
          Files {mine.length ? `(${mine.length})` : ''}
        </Text>
        <Group gap={4}>
          <Anchor component={Link} to={`/projects/${project.id}/files`} size="xs" c="dimmed">
            The project’s files
          </Anchor>
          {canKeep && (
            <FileButton onChange={(list) => void add(list)} multiple>
              {(props) => (
                <Button {...props} size="compact-xs" variant="subtle" leftSection={<IconPaperclip size={14} />} loading={busy}>
                  Add files
                </Button>
              )}
            </FileButton>
          )}
        </Group>
      </Group>
      {mine.length ? (
        mine.map((f) => {
          const web = f.href ? webAddress(f.href) : null;
          return (
            <Group key={f.id} gap="xs" wrap="nowrap">
              <FileIcon f={f} size={16} />
              {web ? (
                <Anchor href={web} target="_blank" rel="noopener noreferrer" size="sm">
                  {f.name} <IconExternalLink size={11} style={{ verticalAlign: -1 }} />
                </Anchor>
              ) : (
                <Anchor component="button" type="button" size="sm" ta="left" onClick={() => setViewing(f)}>
                  {f.name}
                </Anchor>
              )}
              <Badge size="xs" variant="light" color="gray" style={{ flexShrink: 0 }}>
                {kindLabel(f.kind)}
              </Badge>
            </Group>
          );
        })
      ) : (
        <Text size="xs" c="dimmed">
          None linked. The lab’s result sheet, the chain of custody … add them here, or link them from the Files tab.
        </Text>
      )}
      {viewing && <FileViewer file={viewing} onClose={() => setViewing(null)} />}
    </Stack>
  );
}
