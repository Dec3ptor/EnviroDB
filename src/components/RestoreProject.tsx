// One project put back from a backup of the workspace: choose a daily copy from the shared folder (or a backup file),
// then the project – what's been deleted since is listed before it's put back; or the project as it was is brought in
// beside the one there is.

import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, FileButton, Group, List, Loader, Modal, Radio, Select, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useNavigate } from 'react-router-dom';
import { IconHistory, IconUpload } from '@tabler/icons-react';
import { readJsonFile, type WorkspaceBackup } from '../db/backup';
import { asWorkspaceBackup, backupProjects, bringInCopy, dailyCopies, missingRecords, projectFromBackup, putBackMissing, type BackupProject, type MissingRecords } from '../db/restoreProject';
import { formatDate } from '../lib/dates';
import { currentWorkspaceFolder, useWorkspace } from '../sync/workspace';

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** How a project in a backup compares with now, in a few words. */
function compared(p: BackupProject): { text: string; color: string } {
  if (!p.now) return { text: 'not in the workspace now', color: 'red' };
  const d = p.samples - p.now.samples;
  const r = p.results - p.now.results;
  if (d > 0 || r > 0) return { text: `${d > 0 ? plural(d, 'sample') : plural(r, 'result')} more than now`, color: 'orange' };
  if (d < 0 || r < 0) return { text: 'more data now', color: 'gray' };
  return { text: 'the same data as now', color: 'gray' };
}

export function RestoreProjectCard() {
  const ws = useWorkspace();
  const [open, setOpen] = useState(false);
  return (
    <Card padding="md" bg="var(--mantine-color-body)">
      <Text fw={600} mb={4}>
        One project from a backup
      </Text>
      <Text size="sm" c="dimmed" mb="sm">
        Something deleted by mistake – an import, a site, a whole project? Put back just that project from one of the daily copies in the workspace’s <i>backups</i> folder (or a backup you downloaded), without touching the others: either what’s been
        deleted since, or the project as it was, beside the one there is now.
      </Text>
      <Button variant="default" leftSection={<IconHistory size={16} />} onClick={() => setOpen(true)} disabled={ws.phase !== 'ready'}>
        Restore a project…
      </Button>
      {open && <RestoreProjectModal onClose={() => setOpen(false)} />}
    </Card>
  );
}

function RestoreProjectModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [copies, setCopies] = useState<Array<{ path: string; date: string }> | null>(null);
  const [path, setPath] = useState<string | null>(null);
  const [backup, setBackup] = useState<WorkspaceBackup | null>(null);
  const [from, setFrom] = useState('');
  const [projects, setProjects] = useState<BackupProject[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [missing, setMissing] = useState<MissingRecords | null>(null);
  const [how, setHow] = useState<'missing' | 'copy'>('missing');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    void dailyCopies(currentWorkspaceFolder()).then(setCopies);
  }, []);
  const take = async (obj: unknown, said: string) => {
    const b = asWorkspaceBackup(obj);
    setBackup(b);
    setFrom(said);
    setProjects(await backupProjects(b));
    setProjectId(null);
    setMissing(null);
  };
  const read = async (p: string | null) => {
    setPath(p);
    setError('');
    setBackup(null);
    if (!p) return;
    setBusy('read');
    try {
      const file = await currentWorkspaceFolder()?.read(p);
      if (!file) throw new Error('The copy isn’t in the shared folder any more.');
      await take(JSON.parse(file.text), `the daily copy of ${formatDate(copies?.find((c) => c.path === p)?.date ?? '')}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  };
  const readFile = async (f: File | null) => {
    if (!f) return;
    setPath(null);
    setError('');
    setBusy('read');
    try {
      const obj = await readJsonFile(f);
      await take(obj, `${f.name}${(obj as WorkspaceBackup)?.exportedAt ? `, made ${formatDate(String((obj as WorkspaceBackup).exportedAt).slice(0, 10))}` : ''}`);
    } catch (e) {
      setBackup(null);
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  };
  const project = projects.find((p) => p.id === projectId);
  useEffect(() => {
    setMissing(null);
    if (!backup || !projectId) return;
    let live = true;
    void missingRecords(projectFromBackup(backup, projectId)).then((m) => {
      if (!live) return;
      setMissing(m);
      // nothing's gone: the project as it was, beside this one, is the only thing to do
      setHow(m.total ? 'missing' : 'copy');
    });
    return () => {
      live = false;
    };
  }, [backup, projectId]);

  const run = async () => {
    if (!backup || !project) return;
    setBusy('restore');
    setError('');
    try {
      const pkg = projectFromBackup(backup, project.id);
      if (how === 'missing') {
        const n = await putBackMissing(pkg);
        notifications.show({ color: 'teal', title: `${project.name}: ${plural(n, 'record')} put back`, message: `From ${from}. What was there is as it was.`, autoClose: 10000 });
        onClose();
        navigate(`/projects/${project.id}`);
      } else {
        const id = await bringInCopy(pkg);
        notifications.show({ color: 'teal', title: project.now ? 'Brought in as a separate project' : `${project.name} is back`, message: `From ${from}.${project.now ? ' Delete it when you’ve finished comparing.' : ''}`, autoClose: 10000 });
        onClose();
        navigate(`/projects/${id}`);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  return (
    <Modal opened onClose={() => !busy && onClose()} title="Restore a project from a backup" size="lg">
      <Stack gap="sm">
        <Group align="flex-end" gap="xs">
          <Select
            label="Daily copy"
            description={copies && !copies.length ? 'None in the shared folder yet – one is made each day EnviroDB is used' : 'The workspace as it was at the start of that day'}
            placeholder={copies ? 'Choose a day…' : 'Looking in the backups folder…'}
            data={(copies ?? []).map((c) => ({ value: c.path, label: formatDate(c.date) }))}
            value={path}
            onChange={(v) => void read(v)}
            disabled={!copies?.length || !!busy}
            style={{ flex: 1 }}
            comboboxProps={{ withinPortal: true }}
          />
          <FileButton accept="application/json,.json" onChange={(f) => void readFile(f)}>
            {(p) => (
              <Button variant="default" leftSection={<IconUpload size={16} />} {...p} disabled={!!busy}>
                A backup file…
              </Button>
            )}
          </FileButton>
        </Group>
        {busy === 'read' && (
          <Group gap="xs">
            <Loader size="xs" />
            <Text size="sm" c="dimmed">
              Reading the backup …
            </Text>
          </Group>
        )}
        {backup && (
          <>
            <Text size="sm" fw={500}>
              The projects in {from}
            </Text>
            {projects.length ? (
              <Radio.Group value={projectId} onChange={setProjectId}>
                <Stack gap={6} mah={260} style={{ overflowY: 'auto' }}>
                  {projects.map((p) => {
                    const c = compared(p);
                    return (
                      <Radio
                        key={p.id}
                        value={p.id}
                        label={
                          <Group gap="xs" wrap="nowrap">
                            <Text size="sm">
                              {p.name}
                              {p.code ? ` (${p.code})` : ''}
                            </Text>
                            <Text size="xs" c="dimmed">
                              {plural(p.samples, 'sample')}
                            </Text>
                            <Badge size="xs" variant="light" color={c.color}>
                              {c.text}
                            </Badge>
                          </Group>
                        }
                      />
                    );
                  })}
                </Stack>
              </Radio.Group>
            ) : (
              <Text size="sm" c="dimmed">
                It has no projects.
              </Text>
            )}
          </>
        )}
        {project && missing && (
          <Radio.Group value={how} onChange={(v) => setHow(v as typeof how)}>
            <Stack gap="xs">
              <Radio
                value="missing"
                disabled={!missing.total}
                label={
                  <div>
                    <Text size="sm" fw={500}>
                      {missing.project ? 'Put the project back' : 'Put back what’s been deleted since'}
                    </Text>
                    {missing.total ? (
                      <>
                        <Text size="xs" c="dimmed">
                          {missing.project ? 'It isn’t in the workspace now: it comes back as it was, with ' : 'The backup has these and the workspace hasn’t: '}
                          {missing.counts.map((c) => c.text).join(', ') || plural(missing.total, 'record')}.{!missing.project && ' Everything there now is left as it is.'}
                        </Text>
                        {missing.samples.length > 0 && !missing.project && (
                          <List size="xs" mt={2}>
                            {missing.samples.slice(0, 6).map((s) => (
                              <List.Item key={s}>{s}</List.Item>
                            ))}
                            {missing.samples.length > 6 && <List.Item>… and {missing.samples.length - 6} more days</List.Item>}
                          </List>
                        )}
                      </>
                    ) : (
                      <Text size="xs" c="dimmed">
                        Nothing in the backup is missing from the workspace now.
                      </Text>
                    )}
                  </div>
                }
              />
              {!missing.project && (
                <Radio
                  value="copy"
                  label={
                    <div>
                      <Text size="sm" fw={500}>
                        Bring it in as it was, as a separate project
                      </Text>
                      <Text size="xs" c="dimmed">
                        “{project.name} (as of {formatDate(backup!.exportedAt.slice(0, 10))})”, beside the one there is – to compare with, or to copy values from. Nothing in the project now is changed.
                      </Text>
                    </div>
                  }
                />
              )}
            </Stack>
          </Radio.Group>
        )}
        {how === 'missing' && project && missing && missing.total > 0 && !missing.project && (
          <Text size="xs" c="dimmed">
            Something deleted on purpose since then comes back too – check the list. Files kept in the shared folder aren’t in a backup: a file’s entry comes back, its copy only if it’s still in the folder.
          </Text>
        )}
        {error && (
          <Alert color="red" variant="light" p="xs">
            <Text size="sm">{error}</Text>
          </Alert>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={!!busy}>
            Cancel
          </Button>
          <Button onClick={() => void run()} loading={busy === 'restore'} disabled={!project || !missing || (how === 'missing' && !missing.total)}>
            {how === 'copy' ? 'Bring it in' : missing?.project ? 'Put the project back' : `Put back ${missing?.total ? plural(missing.total, 'record') : ''}`}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
