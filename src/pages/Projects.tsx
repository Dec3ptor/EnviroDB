import { useState } from 'react';
import { Badge, Button, Card, FileButton, Group, Modal, SegmentedControl, Select, SimpleGrid, Stack, Text, TextInput, Textarea, type ButtonProps } from '@mantine/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { notifications } from '@mantine/notifications';
import { IconFileImport, IconFlask, IconPlus, IconSearch } from '@tabler/icons-react';
import { db } from '../db/db';
import { newProject, saveProject } from '../db/repo';
import type { Project } from '../db/types';
import { EmptyState, GuidelinePicker, PageHeader } from '../components/common';
import { createDemoProject } from '../db/demo';
import { importProjectPackage, readJsonFile } from '../db/backup';
import { MONTH_LONG, formatDate } from '../lib/dates';
import { useParamsAndSets } from '../hooks/useProjectData';

export function ProjectForm({ value, onChange }: { value: Project; onChange: (p: Project) => void }) {
  const { sets } = useParamsAndSets();
  const set = <K extends keyof Project>(k: K, v: Project[K]) => onChange({ ...value, [k]: v });
  return (
    <Stack gap="sm">
      <TextInput label="Project name" required value={value.name} onChange={(e) => set('name', e.currentTarget.value)} placeholder="e.g. Kōwhai Quarry stormwater discharge" data-autofocus />
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <TextInput label="Project / job number" value={value.code ?? ''} onChange={(e) => set('code', e.currentTarget.value)} placeholder="e.g. 3-12345.00" />
        <TextInput label="Client" value={value.client ?? ''} onChange={(e) => set('client', e.currentTarget.value)} />
        <TextInput label="Consent / permit number(s)" value={value.consents ?? ''} onChange={(e) => set('consents', e.currentTarget.value)} placeholder="e.g. AUTH123456" />
        <TextInput label="Regulator" value={value.regulator ?? ''} onChange={(e) => set('regulator', e.currentTarget.value)} placeholder="e.g. Waikato Regional Council" />
      </SimpleGrid>
      <TextInput label="Location" value={value.location ?? ''} onChange={(e) => set('location', e.currentTarget.value)} />
      <Textarea label="Description" autosize minRows={2} value={value.description ?? ''} onChange={(e) => set('description', e.currentTarget.value)} />
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <Select
          label="Reporting year starts"
          description="Used for annual statistics and period presets"
          data={MONTH_LONG.map((m, i) => ({ value: String(i + 1), label: m }))}
          value={String(value.yearStartMonth)}
          onChange={(v) => v && set('yearStartMonth', Number(v))}
          allowDeselect={false}
        />
        <GuidelinePicker sets={sets} value={value.guidelineSetIds} onChange={(v) => set('guidelineSetIds', v)} label="Default guideline comparison" description="Highlighted in tables, shown on graphs" />
      </SimpleGrid>
    </Stack>
  );
}

export function NewProjectButton(props: ButtonProps) {
  const [opened, setOpened] = useState(false);
  const [p, setP] = useState<Project>(() => newProject());
  const navigate = useNavigate();
  return (
    <>
      <Button leftSection={<IconPlus size={16} />} {...props} onClick={() => { setP(newProject({ name: '' })); setOpened(true); }}>
        New project
      </Button>
      <Modal opened={opened} onClose={() => setOpened(false)} title="New project" size="lg">
        <Stack>
          <ProjectForm value={p} onChange={setP} />
          <Text size="xs" c="dimmed">
            Next you'll add monitoring sites, consent limits / triggers and reporting dates. All of this can be changed later.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setOpened(false)}>
              Cancel
            </Button>
            <Button
              disabled={!p.name.trim()}
              onClick={async () => {
                await saveProject({ ...p, name: p.name.trim() });
                setOpened(false);
                navigate(`/projects/${p.id}/setup`);
              }}
            >
              Create project
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}

export function ProjectsPage() {
  const projects = useLiveQuery(() => db.projects.toArray(), []);
  const counts = useLiveQuery(async () => {
    const m = new Map<string, { sites: number; samples: number; last?: string }>();
    for (const p of await db.projects.toArray()) {
      const sites = await db.sites.where('projectId').equals(p.id).count();
      const samples = await db.samples.where('projectId').equals(p.id).count();
      const last = await db.samples.where('[projectId+date]').between([p.id, ''], [p.id, '￿']).last();
      m.set(p.id, { sites, samples, last: last?.date });
    }
    return m;
  }, []);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'active' | 'archived'>('active');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const list = (projects ?? [])
    .filter((p) => p.status === status)
    .filter((p) => !q || [p.name, p.code, p.client, p.consents, p.location].join(' ').toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <Stack>
      <PageHeader
        title="Projects"
        description="Each project holds its sites, monitoring data, consent rules, schedules and reports."
        actions={
          <>
            <FileButton
              accept="application/json,.json"
              onChange={async (f) => {
                if (!f) return;
                try {
                  const id = await importProjectPackage(await readJsonFile(f));
                  notifications.show({ title: 'Project imported', message: f.name, color: 'teal' });
                  navigate(`/projects/${id}`);
                } catch (e) {
                  notifications.show({ title: 'Import failed', message: (e as Error).message, color: 'red' });
                }
              }}
            >
              {(props) => (
                <Button variant="default" leftSection={<IconFileImport size={16} />} {...props}>
                  Open project file
                </Button>
              )}
            </FileButton>
            <Button
              variant="default"
              leftSection={<IconFlask size={16} />}
              loading={busy}
              onClick={async () => {
                setBusy(true);
                const id = await createDemoProject();
                setBusy(false);
                navigate(`/projects/${id}`);
              }}
            >
              Demo project
            </Button>
            <NewProjectButton />
          </>
        }
      />
      <Group>
        <TextInput leftSection={<IconSearch size={16} />} placeholder="Search projects" value={q} onChange={(e) => setQ(e.currentTarget.value)} w={300} />
        <SegmentedControl value={status} onChange={(v) => setStatus(v as 'active' | 'archived')} data={[{ value: 'active', label: 'Active' }, { value: 'archived', label: 'Archived' }]} />
      </Group>
      {!list.length ? (
        <EmptyState title={status === 'active' ? 'No projects yet' : 'No archived projects'} action={status === 'active' ? <NewProjectButton /> : undefined}>
          {status === 'active' ? 'Create a project for each consent or monitoring programme.' : undefined}
        </EmptyState>
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
          {list.map((p) => {
            const c = counts?.get(p.id);
            return (
              <Card key={p.id} className="clickable-row" onClick={() => navigate(`/projects/${p.id}`)}>
                <Stack gap={6}>
                  <Group justify="space-between" wrap="nowrap" align="flex-start">
                    <Text fw={650} lineClamp={2}>
                      {p.name}
                    </Text>
                    {p.code && <Badge variant="outline">{p.code}</Badge>}
                  </Group>
                  <Text size="sm" c="dimmed" lineClamp={1}>
                    {[p.client, p.consents].filter(Boolean).join(' · ') || '—'}
                  </Text>
                  <Group gap="lg" mt={4}>
                    <Text size="sm">
                      <b>{c?.sites ?? '–'}</b> sites
                    </Text>
                    <Text size="sm">
                      <b>{c?.samples ?? '–'}</b> samples
                    </Text>
                    <Text size="sm" c="dimmed">
                      Last: {c?.last ? formatDate(c.last) : '—'}
                    </Text>
                  </Group>
                </Stack>
              </Card>
            );
          })}
        </SimpleGrid>
      )}
    </Stack>
  );
}
