import { useState } from 'react';
import { ActionIcon, Anchor, Autocomplete, Box, Button, Card, Group, Modal, NumberInput, Select, SimpleGrid, Stack, Switch, Table, TagsInput, Text, TextInput, Textarea, Title, Tooltip } from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { Link, useNavigate } from 'react-router-dom';
import { IconArchive, IconArrowDown, IconArrowUp, IconPlus, IconTrash, IconListDetails, IconSparkles, IconMap } from '@tabler/icons-react';
import { useProject } from '../../hooks/useProjectData';
import { useEditable } from '../../hooks/useEditable';
import { ProjectForm } from '../Projects';
import { deleteProject, deleteSite, newSite, saveProject, saveSite } from '../../db/repo';
import type { NdHandling, Project, Site } from '../../db/types';
import { SITE_ROLES, SITE_TYPES } from '../../db/types';
import { COMMON_UNITS, unitLabel } from '../../lib/units';
import { db } from '../../db/db';
import { MoreOptions } from '../../components/common';
import { compareParams } from '../../data/parameters';
import { SaveButton, SaveIcon, UnsavedBadge } from '../../components/Unsaved';
import { confirmDeleteParameter } from '../../components/DeleteParameter';

function SiteRow({ site, index, count, onMove }: { site: Site; index: number; count: number; onMove: (dir: -1 | 1) => void }) {
  const [s, setS, { dirty, reset }] = useEditable(site);
  const { results } = useProject();
  const n = results.filter((r) => r.siteId === site.id).length;
  return (
    <Table.Tr className={dirty ? 'edb-unsaved-row' : undefined}>
      <Table.Td>
        <Group gap={2} wrap="nowrap">
          <ActionIcon size="sm" variant="subtle" disabled={index === 0} onClick={() => onMove(-1)} aria-label="Move up">
            <IconArrowUp size={14} />
          </ActionIcon>
          <ActionIcon size="sm" variant="subtle" disabled={index === count - 1} onClick={() => onMove(1)} aria-label="Move down">
            <IconArrowDown size={14} />
          </ActionIcon>
        </Group>
      </Table.Td>
      <Table.Td>
        <TextInput size="xs" value={s.code} onChange={(e) => setS({ ...s, code: e.currentTarget.value })} w={90} />
      </Table.Td>
      <Table.Td>
        <TextInput size="xs" value={s.name ?? ''} onChange={(e) => setS({ ...s, name: e.currentTarget.value })} miw={180} />
      </Table.Td>
      <Table.Td>
        <Select size="xs" data={[...SITE_TYPES]} value={s.type} onChange={(v) => v && setS({ ...s, type: v as Site['type'] })} w={130} allowDeselect={false} />
      </Table.Td>
      <Table.Td>
        <Select size="xs" data={SITE_ROLES.map((r) => ({ value: r, label: r || '—' }))} value={s.role} onChange={(v) => setS({ ...s, role: (v ?? '') as Site['role'] })} w={170} />
      </Table.Td>
      <Table.Td>
        <TagsInput size="xs" value={s.aliases} onChange={(v) => setS({ ...s, aliases: v })} placeholder="Other names" miw={200} clearable />
      </Table.Td>
      <Table.Td>
        <Group gap={4} wrap="nowrap">
          <NumberInput size="xs" placeholder="Easting" value={s.easting ?? ''} onChange={(v) => setS({ ...s, easting: v === '' ? undefined : Number(v) })} w={95} hideControls />
          <NumberInput size="xs" placeholder="Northing" value={s.northing ?? ''} onChange={(v) => setS({ ...s, northing: v === '' ? undefined : Number(v) })} w={95} hideControls />
        </Group>
      </Table.Td>
      <Table.Td>
        <Text size="xs" c="dimmed">
          {n}
        </Text>
      </Table.Td>
      <Table.Td>
        <Group gap={4} wrap="nowrap">
          <SaveIcon dirty={dirty} disabled={!s.code.trim()} onClick={() => saveSite(s, site).then(reset)} label="Save site" />
          <ActionIcon
            variant="subtle"
            color="red"
            aria-label="Delete site"
            onClick={() =>
              modals.openConfirmModal({
                title: `Delete site ${site.code}?`,
                children: <Text size="sm">{n ? `This also deletes its ${n} results.` : 'The site has no data.'}</Text>,
                labels: { confirm: 'Delete', cancel: 'Cancel' },
                confirmProps: { color: 'red' },
                onConfirm: () => deleteSite(site.id),
              })
            }
          >
            <IconTrash size={16} />
          </ActionIcon>
        </Group>
      </Table.Td>
    </Table.Tr>
  );
}

function BulkSitesModal({ onClose }: { onClose: () => void }) {
  const { project, sites } = useProject();
  const [text, setText] = useState('');
  const [type, setType] = useState<Site['type']>('Surface water');
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [code, ...rest] = l.split(/\t|,|\s+[-–]\s+/);
      return { code: code.trim(), name: rest.join(' ').trim() };
    })
    .filter((x) => x.code && !sites.some((s) => s.code.toLowerCase() === x.code.toLowerCase()));
  return (
    <Modal opened onClose={onClose} title="Add several sites" size="lg">
      <Stack gap="sm">
        <Textarea
          label="One site per line"
          description="Code, then optionally a name after a tab, comma or dash – e.g. “MW1, Monitoring well 1”. Paste straight from Excel."
          autosize
          minRows={6}
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
          data-autofocus
        />
        <Select label="Site type" data={[...SITE_TYPES]} value={type} onChange={(v) => v && setType(v as Site['type'])} allowDeselect={false} w={220} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!lines.length}
            onClick={async () => {
              let order = sites.length;
              await db.sites.bulkPut(lines.map((l) => newSite(project.id, { code: l.code, name: l.name || undefined, type, order: ++order })));
              onClose();
            }}
          >
            Add {lines.length} site{lines.length === 1 ? '' : 's'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function ParametersCard() {
  const { project, index, paramMap, results } = useProject();
  const used = index.paramIdsWithData.map((id) => paramMap.get(id)).filter((p): p is NonNullable<typeof p> => !!p).sort(compareParams);
  const [units, setUnits] = useState<Record<string, string>>({});
  if (!used.length) return null;
  const counts = new Map<string, number>();
  results.forEach((r) => counts.set(r.parameterId, (counts.get(r.parameterId) ?? 0) + 1));
  return (
    <Card>
      <Title order={4}>Parameters in this project</Title>
      <Text size="sm" c="dimmed" mb="sm">
        Display units apply everywhere (tables, graphs, reports); results are converted automatically, e.g. g/m³ → µg/L. Names and aliases are in <Anchor component={Link} to="/parameters">Parameters</Anchor>. Removing a parameter here deletes its results and rules in this project only.
      </Text>
      <MoreOptions label="Display units or remove" summary={`${used.length} parameters with results`}>
        <Table.ScrollContainer minWidth={500}>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Parameter</Table.Th>
                <Table.Th>Group</Table.Th>
                <Table.Th>Display unit</Table.Th>
                <Table.Th ta="right">Results</Table.Th>
                <Table.Th w={40} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {used.map((p) => {
                const changed = units[p.id] !== undefined && units[p.id] !== unitLabel(p.unit);
                return (
                <Table.Tr key={p.id} className={changed ? 'edb-unsaved-row' : undefined}>
                  <Table.Td>{p.name}</Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed">
                      {p.group}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Group gap={4} wrap="nowrap">
                      <Autocomplete size="xs" data={COMMON_UNITS} value={units[p.id] ?? unitLabel(p.unit)} onChange={(v) => setUnits({ ...units, [p.id]: v })} w={130} />
                      {changed && (
                        <SaveIcon dirty onClick={async () => { await db.parameters.update(p.id, { unit: units[p.id] }); notifications.show({ message: `${p.name} now shown in ${units[p.id]}` }); }} label="Save unit" />
                      )}
                    </Group>
                  </Table.Td>
                  <Table.Td ta="right">{counts.get(p.id) ?? 0}</Table.Td>
                  <Table.Td>
                    <Tooltip label="Remove from this project…" openDelay={300}>
                      <ActionIcon size="sm" variant="subtle" color="red" onClick={() => confirmDeleteParameter(p, project)} aria-label={`Remove ${p.name} from this project`}>
                        <IconTrash size={14} />
                      </ActionIcon>
                    </Tooltip>
                  </Table.Td>
                </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </MoreOptions>
    </Card>
  );
}

export function SetupTab() {
  const { project, sites, rules } = useProject();
  // the details as saved, with your unsaved edits on top (a colleague's change to anything else shows straight away)
  const [p, setP, { dirty, reset }] = useEditable<Project>(project);
  const [bulk, setBulk] = useState(false);
  const navigate = useNavigate();
  const move = async (i: number, dir: -1 | 1) => {
    const list = [...sites];
    const j = i + dir;
    [list[i], list[j]] = [list[j], list[i]];
    await db.sites.bulkUpdate(list.map((s, k) => ({ key: s.id, changes: { order: k + 1 } })));
  };
  return (
    <Stack gap="lg">
      {/* a new project's quickest start; once there are rules it is under Compliance › Add rule */}
      {!rules.length && (
        <Card style={{ borderColor: 'var(--mantine-color-teal-4)' }}>
          <Group justify="space-between" align="center" wrap="wrap" gap="sm">
            <div style={{ flex: '1 1 320px' }}>
              <Title order={4}>Set up from consent documents</Title>
              <Text size="sm" c="dimmed">
                Let an AI tool read the consent and turn its conditions into limits, triggers, sampling schedules and reporting dates. You review everything before it's imported.
              </Text>
            </div>
            <Button component={Link} to={`/projects/${project.id}/consent-setup`} leftSection={<IconSparkles size={16} />}>
              Set up with AI
            </Button>
          </Group>
        </Card>
      )}
      <Card className={dirty ? 'edb-unsaved-card' : undefined}>
        <Group justify="space-between" mb="sm">
          <Group gap="xs">
            <Title order={4}>Project details</Title>
            <UnsavedBadge dirty={dirty} />
          </Group>
          <SaveButton dirty={dirty} disabled={!dirty || !p.name.trim()} onClick={async () => { await saveProject(p, project); reset(); notifications.show({ message: 'Project saved', color: 'teal' }); }} />
        </Group>
        <ProjectForm value={p} onChange={setP} letters />
        <Textarea
          mt="sm"
          label="Other consent requirements"
          description="Requirements EnviroDB can't check automatically, e.g. narrative conditions, event-based sampling and notification duties. Included in Copy for AI input."
          autosize
          minRows={2}
          maxRows={10}
          value={p.consentNotes ?? ''}
          onChange={(e) => setP({ ...p, consentNotes: e.currentTarget.value })}
        />
        <Box mt="lg">
          <MoreOptions
            label="Assessment settings"
            summary={[p.hardnessAdjust ? 'metals hardness-modified' : 'metals not hardness-modified', `non-detects at ${p.ndHandling === 'half' ? 'half the DL' : p.ndHandling === 'zero' ? 'zero' : 'the DL'}`, p.percentileMethod === 'hazen' ? 'Hazen percentiles' : 'Excel percentiles'].join(' · ')}
          >
            <SimpleGrid cols={{ base: 1, sm: 3 }}>
              <Switch
                label="Hardness-modify metals guidelines"
                description="Adjust Cd, Cr(III), Cu, Pb, Ni, Zn guideline values using hardness measured in the same sample (ANZECC 2000, H > 30 mg/L)"
                checked={p.hardnessAdjust}
                onChange={(e) => setP({ ...p, hardnessAdjust: e.currentTarget.checked })}
              />
              <Select
                label="Non-detects in statistics"
                data={[
                  { value: 'dl', label: 'Use the detection limit (conservative)' },
                  { value: 'half', label: 'Use half the detection limit' },
                  { value: 'zero', label: 'Use zero' },
                ]}
                value={p.ndHandling}
                onChange={(v) => v && setP({ ...p, ndHandling: v as NdHandling })}
                allowDeselect={false}
              />
              <Select
                label="Percentile method"
                data={[
                  { value: 'excel', label: 'Excel PERCENTILE.INC' },
                  { value: 'hazen', label: 'Hazen (NPS-FM)' },
                ]}
                value={p.percentileMethod}
                onChange={(v) => v && setP({ ...p, percentileMethod: v as Project['percentileMethod'] })}
                allowDeselect={false}
              />
            </SimpleGrid>
          </MoreOptions>
        </Box>
      </Card>

      <Card>
        <Group justify="space-between" mb="sm">
          <div>
            <Title order={4}>Monitoring sites</Title>
            <Text size="sm" c="dimmed">
              Aliases are other names for a site used in lab files or spreadsheets (e.g. “Upstream”, “U/S”, “MW-01”). They're learned automatically when you match sites during import.
            </Text>
          </div>
          <Group gap="xs">
            <Button variant="default" component={Link} to={`/projects/${project.id}/map`} leftSection={<IconMap size={16} />}>
              Place on the map
            </Button>
            <Button variant="default" leftSection={<IconListDetails size={16} />} onClick={() => setBulk(true)}>
              Add several
            </Button>
            <Button leftSection={<IconPlus size={16} />} onClick={() => saveSite(newSite(project.id, { code: `Site ${sites.length + 1}`, order: sites.length + 1 }))}>
              Add site
            </Button>
          </Group>
        </Group>
        {sites.length ? (
          <Table.ScrollContainer minWidth={1100}>
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={60} />
                  <Table.Th>Code</Table.Th>
                  <Table.Th>Name</Table.Th>
                  <Table.Th>Type</Table.Th>
                  <Table.Th>Role</Table.Th>
                  <Table.Th>Aliases</Table.Th>
                  <Table.Th>NZTM E / N</Table.Th>
                  <Table.Th>Results</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {sites.map((s, i) => (
                  <SiteRow key={`${s.id}-${s.order}-${s.aliases.length}`} site={s} index={i} count={sites.length} onMove={(d) => move(i, d)} />
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        ) : (
          <Text size="sm" c="dimmed">
            No sites yet. You can also create sites while importing data.
          </Text>
        )}
      </Card>

      <ParametersCard />

      <Card style={{ borderColor: 'var(--mantine-color-red-3)' }}>
        <Title order={4} mb="xs">
          Archive or delete
        </Title>
        <Group>
          <Button variant="default" leftSection={<IconArchive size={16} />} onClick={() => db.projects.update(project.id, { status: project.status === 'active' ? 'archived' : 'active', updatedAt: new Date().toISOString() })}>
            {project.status === 'active' ? 'Archive project' : 'Restore project'}
          </Button>
          <Button
            color="red"
            variant="light"
            leftSection={<IconTrash size={16} />}
            onClick={() =>
              modals.openConfirmModal({
                title: 'Delete this project?',
                children: <Text size="sm">All sites, data, rules, schedules and notes for “{project.name}” will be permanently deleted from this browser. Consider downloading the project file first.</Text>,
                labels: { confirm: 'Delete project', cancel: 'Cancel' },
                confirmProps: { color: 'red' },
                onConfirm: async () => {
                  await deleteProject(project.id);
                  navigate('/projects');
                },
              })
            }
          >
            Delete project
          </Button>
        </Group>
      </Card>
      {bulk && <BulkSitesModal onClose={() => setBulk(false)} />}
    </Stack>
  );
}
