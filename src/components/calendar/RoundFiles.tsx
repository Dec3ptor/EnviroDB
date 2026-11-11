// A sampling round's paperwork, in its dialog: the files linked to the round – its chain of custody, field sheets –
// opened here; files added to it (kept with the project's files); and the paperwork made for it: the sample list,
// bottle labels and the lab's own forms.

import { useState } from 'react';
import { ActionIcon, Anchor, Badge, Button, FileButton, Group, Menu, Stack, Text, Tooltip } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconExternalLink, IconLink, IconPaperclip, IconPrinter, IconX } from '@tabler/icons-react';
import type { CalendarRow, FileLink, Project, ProjectFile } from '../../db/types';
import { useProjectFiles } from '../../hooks/useProjectFiles';
import { addProjectFiles, kindLabel, linkProjectFile, roundFiles, webAddress } from '../../lib/projectFiles';
import { currentWorkspaceFolder, useWorkspace } from '../../sync/workspace';
import { FileIcon, FileViewer } from '../FileViewer';
import { RoundPaperworkModal } from '../RoundPaperwork';

export function RoundFiles({ project, row, months, label, lab, cocNumber, onOver }: {
  project: Pick<Project, 'id' | 'code' | 'name'>;
  row: CalendarRow;
  /** The round's months ('YYYY-MM'), the first first. */
  months: string[];
  /** The round in words: "October 2026". */
  label: string;
  lab?: string;
  cocNumber?: string;
  /** Told when something is open over the round's dialog (so Escape closes only that). */
  onOver?: (open: boolean) => void;
}) {
  const files = useProjectFiles(project.id);
  const ws = useWorkspace();
  const [viewing, setShown] = useState<ProjectFile | null>(null);
  const [making, setMade] = useState(false);
  const [busy, setBusy] = useState(false);
  const setViewing = (f: ProjectFile | null) => {
    setShown(f);
    onOver?.(!!f);
  };
  const setMaking = (on: boolean) => {
    setMade(on);
    onOver?.(on);
  };
  const mine = roundFiles(files, { row: row.id, months });
  const link: FileLink = { kind: 'round', month: months[0], row: row.id };
  const canKeep = ws.phase === 'ready' && !!currentWorkspaceFolder()?.writeBlob;
  // the project's files that aren't linked to anything: a chain of custody uploaded before, to link to this round
  const loose = files.filter((f) => !f.linked && !f.eachRound && (f.kind === 'coc' || f.kind === 'field' || f.kind === 'other' || f.kind === 'correspondence'));
  const add = async (list: File[]) => {
    if (!list.length) return;
    setBusy(true);
    try {
      const r = await addProjectFiles(project, list, { linked: link, kind: 'coc' });
      const n = r.added.length + r.relinked.length;
      if (n) notifications.show({ color: 'teal', message: `${n} file${n === 1 ? '' : 's'} added to the round – in the project’s Files too, and with the round’s samples once they’re in.` });
      if (r.skipped.length) notifications.show({ color: 'blue', message: `Already with the project, linked to something else: ${r.skipped.join(', ')} – change it in the Files tab.` });
      for (const e of r.errors) notifications.show({ color: 'red', message: e });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Stack gap={4}>
      <Group justify="space-between" gap="xs">
        <Text fw={600} size="sm">
          Paperwork {mine.length ? `(${mine.length})` : ''}
        </Text>
        <Group gap={4}>
          {loose.length > 0 && (
            <Menu position="bottom-end" withinPortal>
              <Menu.Target>
                <Button size="compact-xs" variant="subtle" leftSection={<IconLink size={14} />}>
                  Link a file
                </Button>
              </Menu.Target>
              <Menu.Dropdown mah={280} style={{ overflowY: 'auto' }}>
                <Menu.Label>The project’s files not linked to anything</Menu.Label>
                {loose.slice(0, 30).map((f) => (
                  <Menu.Item key={f.id} leftSection={<FileIcon f={f} size={14} />} onClick={() => void linkProjectFile(f, link, `the ${label} round`)}>
                    {f.name}
                  </Menu.Item>
                ))}
              </Menu.Dropdown>
            </Menu>
          )}
          {canKeep && (
            <FileButton onChange={(list) => void add(list)} multiple>
              {(props) => (
                <Button {...props} size="compact-xs" variant="subtle" leftSection={<IconPaperclip size={14} />} loading={busy}>
                  Add files
                </Button>
              )}
            </FileButton>
          )}
          <Button size="compact-xs" variant="light" leftSection={<IconPrinter size={14} />} onClick={() => setMaking(true)}>
            Paperwork…
          </Button>
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
              <Tooltip label="Take it off the round (it stays in the project’s files)">
                <ActionIcon size="sm" variant="subtle" color="gray" ml="auto" onClick={() => void linkProjectFile(f, undefined)} aria-label={`Take ${f.name} off the round`}>
                  <IconX size={14} />
                </ActionIcon>
              </Tooltip>
            </Group>
          );
        })
      ) : (
        <Text size="xs" c="dimmed">
          The round’s chain of custody and field sheets – add them here once they’re filled in, and they show with the round’s samples. Paperwork… makes the sample list, bottle labels and your lab’s form to print.
        </Text>
      )}
      {viewing && <FileViewer file={viewing} onClose={() => setViewing(null)} />}
      {making && <RoundPaperworkModal projectId={project.id} round={{ months, label, rowId: row.id, siteIds: row.siteIds }} lab={lab} cocNumber={cocNumber} onClose={() => setMaking(false)} />}
    </Stack>
  );
}
