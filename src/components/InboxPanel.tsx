// The lab inbox on the import pages: lab files waiting in the workspace's Inbox folder and the projects' lab
// folders, by project – import them (several at once) or set them aside – and where EnviroDB looks.

import { useMemo, useState } from 'react';
import { ActionIcon, Alert, Anchor, Badge, Button, Card, Checkbox, Group, Select, Stack, Text, Tooltip } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconFolderOpen, IconInbox, IconRefresh, IconTrash, IconX } from '@tabler/icons-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { db } from '../db/db';
import { saveProject } from '../db/repo';
import type { Project } from '../db/types';
import { formatDate } from '../lib/dates';
import {
  INBOX_DIR, allowProjectsRoot, checkInbox, chooseProjectFolder, connectProjectsRoot, dismissInboxFiles, projectFolderPath, queueInboxImport, useInbox, type InboxCandidate,
} from '../sync/inbox';
import { currentWorkspaceFolder } from '../sync/workspace';

const ago = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');
/** Where a file is: "Inbox / Hill Labs", or "Project folder · Clients / Kōwhai / Lab results". */
const where = (f: InboxCandidate) => {
  const dirs = f.path.split('/').slice(0, -1);
  return f.where === 'inbox' ? dirs.join(' / ') || 'Inbox' : `Project folder · ${dirs.join(' / ') || '–'}`;
};
const sizeText = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** The lab inbox – for every project, or (`projectId`) one project's lab files and its lab folder. */
export function InboxPanel({ projectId }: { projectId?: string }) {
  const inbox = useInbox();
  const navigate = useNavigate();
  const projects = useLiveQuery(() => db.projects.where('status').equals('active').toArray(), []) ?? [];
  const byId = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const files = projectId ? inbox.files.filter((f) => f.projectId === projectId || (!f.projectKnown && !f.projectId)) : inbox.files;
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [chosen, setChosen] = useState<Record<string, string | null>>({});

  const groups = useMemo(() => {
    const m = new Map<string, InboxCandidate[]>();
    for (const f of files) m.set(f.projectId ?? '', [...(m.get(f.projectId ?? '') ?? []), f]);
    return [...m].sort(([a], [b]) => (a ? 0 : 1) - (b ? 0 : 1) || (byId.get(a)?.name ?? '').localeCompare(byId.get(b)?.name ?? ''));
  }, [files, byId]);

  const importInto = (pid: string, list: InboxCandidate[]) => {
    if (!list.length) return;
    queueInboxImport(pid, list);
    setPicked(new Set());
    navigate(`/projects/${pid}/import`);
  };
  const dismiss = async (list: InboxCandidate[]) => {
    await dismissInboxFiles(list);
    setPicked((p) => new Set([...p].filter((k) => !list.some((f) => f.key === k))));
    notifications.show({ message: `${list.length} file${list.length === 1 ? '' : 's'} set aside – not shown again unless changed.` });
  };
  const makeInbox = async () => {
    const ws = currentWorkspaceFolder();
    if (!ws) return;
    await ws.write(`${INBOX_DIR}/README.txt`, 'Save lab result files here – Excel, CSV, PDF reports or the zip they came in – by hand or with an Outlook rule.\r\nEnviroDB lists them on its Import page to import into a project, and remembers the ones imported.\r\n');
    void checkInbox();
  };

  const project = projectId ? byId.get(projectId) : undefined;
  const projectPath = project ? projectFolderPath(project, inbox.root.name) : undefined;
  const missing = project ? inbox.missing.find((m) => m.projectId === project.id) : undefined;

  return (
    <Card withBorder p="sm">
      <Group gap="xs" mb={6} wrap="nowrap">
        <IconInbox size={18} />
        <Text fw={600} size="sm">
          Lab inbox
        </Text>
        <Badge variant="light" color={files.length ? 'teal' : 'gray'}>
          {files.length} new
        </Badge>
        <div style={{ flex: 1 }} />
        <Text size="xs" c="dimmed" visibleFrom="sm">
          {inbox.checking ? 'Looking…' : inbox.checkedAt ? `Checked ${ago(inbox.checkedAt)}` : ''}
        </Text>
        <Tooltip label="Look now">
          <ActionIcon variant="default" onClick={() => void checkInbox()} loading={inbox.checking} aria-label="Look for new lab files now">
            <IconRefresh size={16} />
          </ActionIcon>
        </Tooltip>
      </Group>

      <Stack gap="xs">
        {groups.map(([pid, list]) => {
          const p = byId.get(pid);
          const target = pid || chosen[list[0].key] || projectId || null;
          const sel = list.filter((f) => picked.has(f.key));
          const take = sel.length ? sel : list;
          return (
            <Card key={pid || 'unknown'} withBorder p="xs" radius="sm">
              <Group gap="xs" mb={4} wrap="wrap">
                <Text size="sm" fw={600}>
                  {p ? p.name : 'Project not known'}
                </Text>
                {!p && (
                  <Select
                    size="xs"
                    w={240}
                    placeholder="Choose the project"
                    data={projects.map((x) => ({ value: x.id, label: x.code ? `${x.name} (${x.code})` : x.name }))}
                    value={chosen[list[0].key] ?? projectId ?? null}
                    onChange={(v) => setChosen((c) => ({ ...c, [list[0].key]: v }))}
                    searchable
                    comboboxProps={{ withinPortal: true }}
                    aria-label="Import into"
                  />
                )}
                <div style={{ flex: 1 }} />
                <Button size="compact-sm" disabled={!target} onClick={() => importInto(target!, take)}>
                  {sel.length ? `Import ${sel.length} chosen` : list.length === 1 ? 'Import' : `Import all ${list.length}`}
                </Button>
                {(sel.length > 0 || list.length === 1) && (
                  <Tooltip label="Not lab results to import – don’t show again (unless the file changes)">
                    <Button size="compact-sm" variant="subtle" color="gray" leftSection={<IconX size={14} />} onClick={() => void dismiss(take)}>
                      {sel.length ? `Set aside ${sel.length} chosen` : 'Not lab results'}
                    </Button>
                  </Tooltip>
                )}
              </Group>
              <Stack gap={2}>
                {list.map((f) => (
                  <Group key={f.key} gap="xs" wrap="nowrap">
                    <Checkbox
                      size="xs"
                      checked={picked.has(f.key)}
                      onChange={(e) => {
                        const on = e.currentTarget.checked;
                        setPicked((s) => {
                          const n = new Set(s);
                          if (on) n.add(f.key);
                          else n.delete(f.key);
                          return n;
                        });
                      }}
                      aria-label={`Choose ${f.name}`}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Text size="sm" lineClamp={1}>
                        {f.name}{' '}
                        {f.amended && (
                          <Badge size="xs" color="orange" variant="light">
                            changed since imported
                          </Badge>
                        )}
                      </Text>
                      <Text size="xs" c="dimmed" lineClamp={1}>
                        {where(f)} · {formatDate(new Date(f.modified).toISOString().slice(0, 10))} · {sizeText(f.size)}
                        {f.labName ? ` · ${f.labName}` : ''}
                      </Text>
                    </div>
                    {list.length > 1 && (
                      <Tooltip label="Not lab results – don’t show again (unless the file changes)">
                        <ActionIcon size="sm" variant="subtle" color="gray" aria-label={`Set aside ${f.name}`} onClick={() => void dismiss([f])}>
                          <IconX size={14} />
                        </ActionIcon>
                      </Tooltip>
                    )}
                  </Group>
                ))}
              </Stack>
            </Card>
          );
        })}
        {!files.length && (
          <Text size="sm" c="dimmed">
            {inbox.checking ? 'Looking for lab files…' : 'No new lab files.'}
          </Text>
        )}

        {/* where EnviroDB looks */}
        <Stack gap={4}>
          <Text size="xs" c="dimmed">
            {inbox.hasInbox ? (
              <>
                The team’s <b>Inbox</b> folder in the workspace folder: save lab files there (by hand or with an Outlook rule).
              </>
            ) : (
              <>
                No Inbox folder in the workspace folder yet.{' '}
                <Anchor component="button" size="xs" onClick={() => void makeInbox()}>
                  Make one
                </Anchor>{' '}
                – then save lab files there (by hand or with an Outlook rule) and they show up here.
              </>
            )}
          </Text>
          <ProjectsRootLine project={project} projectPath={projectPath} missing={!!missing} />
          {inbox.others > 0 && (
            <Text size="xs" c="dimmed">
              {inbox.others} other file{inbox.others === 1 ? '' : 's'} looked at aren’t lab results (reports, EnviroDB’s own downloads …).
            </Text>
          )}
          {inbox.error && (
            <Alert color="red" variant="light" p={6}>
              {inbox.error}
            </Alert>
          )}
        </Stack>
      </Stack>
    </Card>
  );
}

function ProjectsRootLine({ project, projectPath, missing }: { project?: Project; projectPath?: string; missing: boolean }) {
  const inbox = useInbox();
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      if ((e as Error).name !== 'AbortError') notifications.show({ color: 'red', message: (e as Error).message });
    }
  };
  if (inbox.root.access === 'unsupported') return null;
  if (inbox.root.access === 'none')
    return (
      <Text size="xs" c="dimmed">
        Lab files kept in each project’s own folder:{' '}
        <Anchor component="button" size="xs" onClick={() => void run(connectProjectsRoot)}>
          show EnviroDB your projects folder
        </Anchor>{' '}
        (once, on this computer) – then choose each project’s lab folder in it.
      </Text>
    );
  if (inbox.root.access === 'prompt')
    return (
      <Group gap={6}>
        <Text size="xs" c="dimmed">
          Your projects folder ({inbox.root.name}) needs a click to look in again.
        </Text>
        <Button size="compact-xs" variant="light" onClick={() => void run(allowProjectsRoot)}>
          Allow
        </Button>
      </Group>
    );
  return (
    <Group gap={6} wrap="wrap">
      <Text size="xs" c="dimmed">
        Projects folder: <b>{inbox.root.name}</b>
        {project ? (
          projectPath ? (
            <>
              {' '}
              · this project’s lab files: <b>{projectPath}</b>
              {missing ? ' – not found there' : ''}
            </>
          ) : (
            ' · no lab folder chosen for this project'
          )
        ) : (
          ' · each project’s lab folder is set on its import page'
        )}
      </Text>
      {project && (
        <>
          <Button
            size="compact-xs"
            variant="light"
            leftSection={<IconFolderOpen size={12} />}
            onClick={() =>
              void run(async () => {
                const path = await chooseProjectFolder();
                await saveProject({ ...project, labFolder: path }, project);
                void checkInbox();
              })
            }
          >
            {project.labFolder ? 'Change' : 'Choose'} the lab folder
          </Button>
          {project.labFolder && (
            <Tooltip label="Stop looking in a lab folder for this project">
              <ActionIcon size="sm" variant="subtle" color="gray" aria-label="Clear the lab folder" onClick={() => void run(() => saveProject({ ...project, labFolder: undefined }, project))}>
                <IconTrash size={12} />
              </ActionIcon>
            </Tooltip>
          )}
        </>
      )}
      <Anchor component="button" size="xs" c="dimmed" onClick={() => void run(connectProjectsRoot)}>
        use another projects folder
      </Anchor>
    </Group>
  );
}
