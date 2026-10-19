// The client data pack: set up how it looks and what the client sees and can do, see it as they will, and make the
// file – one HTML page with the project's data that opens in any browser, offline.

import { useEffect, useMemo, useRef, useState } from 'react';
import { ActionIcon, Alert, Button, Card, ColorInput, FileButton, Grid, Group, NumberInput, SegmentedControl, Select, Stack, Switch, Text, TextInput, Textarea, Title, Tooltip } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconArrowDown, IconArrowUp, IconDeviceDesktop, IconDeviceMobile, IconDownload, IconPhoto, IconPlus, IconTrash } from '@tabler/icons-react';
import { useProject } from '../../hooks/useProjectData';
import { useSettings } from '../../hooks/useSettings';
import { db } from '../../db/db';
import type { PackSection, PackSettings } from '../../db/types';
import { buildPackData, DEFAULT_SECTIONS, packParams, packPeriod, packSettings, packSites, SECTION_TEXT, type PackData } from '../../pack/model';
import { packHtml } from '../../pack/html';
import { renderPack } from '../../pack/viewer';
import { aerialSnapshot, AERIAL_ATTRIBUTION, mapBox } from '../../pack/aerial';
import { PopupPicker, type PickerData } from '../../components/PopupPicker';
import { ReportSites } from '../../components/report/ReportSites';
import { APP_VERSION } from '../../lib/version';
import { formatDate, todayStr } from '../../lib/dates';
import { siteLatLng } from '../../lib/nztm';
import { sizeText } from '../../lib/issued';
import { downloadBlob, safeFileName } from '../../db/backup';
import { readImageFile } from '../../lib/image';
import { uid } from '../../lib/ids';
import { unitLabel } from '../../lib/units';
import { KIND_TEXT } from '../../lib/continuous';

const NONE: PackSettings = {};
const ACCENTS = ['#0f766e', '#1c7ed6', '#2f3b52', '#5f3dc4', '#c2255c', '#e8590c', '#2b8a3e', '#495057'];

/** The pack drawn as the client will see it. */
function PackPreview({ data, phone }: { data: PackData | null; phone: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (host.current && data) renderPack(data, host.current);
  }, [data]);
  return (
    <div style={{ height: 'calc(100vh - 150px)', minHeight: 480, overflow: 'auto', background: 'var(--mantine-color-gray-2)', borderRadius: 8, padding: phone ? '12px 0' : 0 }}>
      <div ref={host} style={{ width: phone ? 390 : '100%', margin: '0 auto', minHeight: '100%', boxShadow: phone ? '0 2px 12px rgba(0,0,0,.18)' : undefined }} />
    </div>
  );
}

function SectionRow({ sec, first, last, onChange, onMove, onDelete }: { sec: PackSection; first: boolean; last: boolean; onChange: (s: PackSection) => void; onMove: (d: -1 | 1) => void; onDelete?: () => void }) {
  return (
    <Card withBorder padding="xs" style={{ opacity: sec.on ? 1 : 0.65 }}>
      <Group gap="xs" wrap="nowrap" align="flex-start">
        <Switch checked={sec.on} onChange={(e) => onChange({ ...sec, on: e.currentTarget.checked })} mt={6} aria-label={`Show ${sec.title}`} />
        <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
          <TextInput size="xs" value={sec.title} onChange={(e) => onChange({ ...sec, title: e.currentTarget.value })} aria-label="Heading" />
          <Text size="xs" c="dimmed">
            {SECTION_TEXT[sec.type].split(' – ')[1]}
          </Text>
          {sec.on && sec.type === 'graphs' && (
            <SegmentedControl
              size="xs"
              value={sec.mode ?? 'picker'}
              onChange={(v) => onChange({ ...sec, mode: v as PackSection['mode'] })}
              data={[
                { value: 'picker', label: 'One at a time, picked from a list' },
                { value: 'all', label: 'Every analyte, one after another' },
              ]}
            />
          )}
          {sec.type === 'text' && <Textarea size="xs" autosize minRows={2} maxRows={10} value={sec.text ?? ''} onChange={(e) => onChange({ ...sec, text: e.currentTarget.value })} placeholder="Use **bold**, *italic* and “- ” for bullets" />}
        </Stack>
        <Stack gap={2}>
          <ActionIcon size="sm" variant="subtle" disabled={first} onClick={() => onMove(-1)} aria-label="Move up">
            <IconArrowUp size={14} />
          </ActionIcon>
          <ActionIcon size="sm" variant="subtle" disabled={last} onClick={() => onMove(1)} aria-label="Move down">
            <IconArrowDown size={14} />
          </ActionIcon>
          {onDelete && (
            <ActionIcon size="sm" variant="subtle" color="red" onClick={onDelete} aria-label="Remove">
              <IconTrash size={14} />
            </ActionIcon>
          )}
        </Stack>
      </Group>
    </Card>
  );
}

export function PackTab() {
  const data = useProject();
  const { project } = data;
  const settings = useSettings();
  // edited here at once, saved with the project a moment later (shared with the team)
  const [pack, setPack] = useState<PackSettings>(() => project.pack ?? NONE);
  const saved = useRef(project.pack);
  useEffect(() => {
    if (project.pack !== saved.current) {
      saved.current = project.pack;
      setPack(project.pack ?? NONE);
    }
  }, [project.pack]);
  useEffect(() => {
    if (pack === (saved.current ?? NONE)) return;
    const h = setTimeout(() => {
      saved.current = pack;
      void db.projects.update(project.id, { pack, updatedAt: new Date().toISOString() });
    }, 500);
    return () => clearTimeout(h);
  }, [pack, project.id]);
  const set = (patch: Partial<PackSettings>) => setPack((p) => ({ ...p, ...patch }));
  const s = packSettings(pack);
  const sections = s.sections ?? DEFAULT_SECTIONS;
  const setSections = (list: PackSection[]) => set({ sections: list });

  // what's in it
  const sites = useMemo(() => packSites(data, s), [data, s.siteIds]);
  const params = useMemo(() => packParams(data, s), [data, s.parameterIds]);
  const period = useMemo(() => packPeriod(data, s, sites.map((x) => x.id)), [data, s.period, s.years, s.start, s.end, sites]);

  // the aerial photo behind the map, for these sites
  const box = useMemo(() => mapBox(sites.flatMap((x) => siteLatLng(x) ?? [])), [sites]);
  const [aerial, setAerial] = useState<{ key: string; image: string | null } | null>(null);
  const boxKey = box ? box.map((v) => v.toFixed(9)).join(',') : '';
  useEffect(() => {
    if (!s.aerial || !box || aerial?.key === boxKey) return;
    let live = true;
    void aerialSnapshot(box).then((image) => live && setAerial({ key: boxKey, image }));
    return () => {
      live = false;
    };
  }, [s.aerial, boxKey]);
  const map = s.aerial && box && aerial?.key === boxKey && aerial.image ? { image: aerial.image, box, attribution: AERIAL_ATTRIBUTION } : undefined;

  const next = (pack.version ?? 0) + 1;
  const [preview, setPreview] = useState<PackData | null>(null);
  useEffect(() => {
    const h = setTimeout(() => setPreview(buildPackData(data, pack, { version: next, made: todayStr(), app: APP_VERSION, company: settings.company, map })), 250);
    return () => clearTimeout(h);
  }, [data, pack, settings.company, map?.image]);
  const [phone, setPhone] = useState(false);
  const [busy, setBusy] = useState(false);
  const size = useMemo(() => (preview ? JSON.stringify(preview).length + 60_000 : 0), [preview]);

  const make = async () => {
    setBusy(true);
    try {
      const made = todayStr();
      const html = await packHtml(buildPackData(data, pack, { version: next, made, app: APP_VERSION, company: settings.company, map }));
      const name = `${safeFileName(s.title?.trim() || project.name)} - data pack v${next}.html`;
      downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), name);
      const updated = { ...pack, version: next, madeAt: new Date().toISOString(), madeBy: settings.author || undefined };
      saved.current = updated;
      setPack(updated);
      await db.projects.update(project.id, { pack: updated, updatedAt: new Date().toISOString() });
      notifications.show({ color: 'teal', title: `Data pack v${next} made`, message: `${name} (${sizeText(html.length)}) – send it to the client: it opens in any browser, offline.` });
    } catch (e) {
      notifications.show({ color: 'red', title: 'The pack could not be made', message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const paramData: PickerData = useMemo(() => {
    const withData = new Set(data.index.paramIdsWithData);
    const groups = new Map<string, PickerData[number]['items']>();
    for (const p of data.params) if (withData.has(p.id)) groups.set(p.group, [...(groups.get(p.group) ?? []), { value: p.id, label: p.name, hint: unitLabel(p.unit) }]);
    return [...groups].map(([group, items]) => ({ group, items }));
  }, [data.params, data.index]);
  const setData: PickerData = useMemo(() => {
    const groups = new Map<string, PickerData[number]['items']>();
    for (const g of data.guidelineSets) groups.set(g.family ?? 'Guidelines', [...(groups.get(g.family ?? 'Guidelines') ?? []), { value: g.id, label: g.name, short: g.shortName }]);
    return [...groups].map(([group, items]) => ({ group, items }));
  }, [data.guidelineSets]);
  const consentIds = useMemo(() => packParams(data, { ...s, parameterIds: undefined }).map((p) => p.id), [data]);

  const move = (i: number, d: -1 | 1) => {
    const list = [...sections];
    [list[i], list[i + d]] = [list[i + d], list[i]];
    setSections(list);
  };
  const noCoords = sites.every((x) => !siteLatLng(x));

  return (
    <Grid gutter="lg">
      <Grid.Col span={{ base: 12, lg: 5 }}>
        <Stack gap="md">
          <Card padding="md">
            <Title order={5}>Client data pack</Title>
            <Text size="sm" c="dimmed" mb="sm">
              One HTML file with the project’s data – summary, site map, graphs and tables – set up the way you want the client to see it. Email it or put it on a shared drive: it opens in any browser, offline, and
              sends nothing anywhere.
            </Text>
            <Button fullWidth leftSection={<IconDownload size={18} />} loading={busy} onClick={() => void make()} disabled={!preview}>
              Make the data pack (v{next})
            </Button>
            <Text size="xs" c="dimmed" mt={6}>
              {params.length} analytes · {sites.length} sites · {period.label}
              {size ? ` · about ${sizeText(size + (map?.image.length ?? 0))}` : ''}
              {pack.version ? ` · v${pack.version} made ${formatDate(pack.madeAt?.slice(0, 10))}${pack.madeBy ? ` by ${pack.madeBy}` : ''}` : ''}
            </Text>
          </Card>

          <Card padding="md">
            <Title order={5} mb="xs">
              How it looks
            </Title>
            <Stack gap="sm">
              <TextInput label="Title" placeholder={project.name} value={pack.title ?? ''} onChange={(e) => set({ title: e.currentTarget.value })} />
              <TextInput label="Under the title" placeholder={[project.client, project.consents && `Consent ${project.consents}`].filter(Boolean).join(' · ') || 'e.g. Water quality monitoring'} value={pack.subtitle ?? ''} onChange={(e) => set({ subtitle: e.currentTarget.value })} />
              <Textarea label="Introduction" description="At the top. **bold**, *italic*, “- ” for bullets" autosize minRows={2} maxRows={8} value={pack.intro ?? ''} onChange={(e) => set({ intro: e.currentTarget.value })} />
              <Group grow align="flex-start">
                <ColorInput label="Colour" value={s.accent} onChange={(v) => set({ accent: v })} swatches={ACCENTS} swatchesPerRow={8} format="hex" />
                <div>
                  <Text size="sm" fw={500} mb={4}>
                    Theme
                  </Text>
                  <SegmentedControl
                    fullWidth
                    size="xs"
                    value={s.theme}
                    onChange={(v) => set({ theme: v as PackSettings['theme'] })}
                    data={[
                      { value: 'light', label: 'Light' },
                      { value: 'dark', label: 'Dark' },
                      { value: 'auto', label: 'As their device' },
                    ]}
                  />
                </div>
              </Group>
              <Group gap="xs">
                <FileButton
                  accept="image/png,image/jpeg"
                  onChange={(f) => f && void readImageFile(f, 600).then((logo) => set({ logo }), (e: Error) => notifications.show({ color: 'red', message: e.message }))}
                >
                  {(props) => (
                    <Button {...props} size="xs" variant="default" leftSection={<IconPhoto size={14} />}>
                      {pack.logo ? 'Change the logo' : 'Add a logo'}
                    </Button>
                  )}
                </FileButton>
                {pack.logo && (
                  <>
                    <img src={pack.logo} alt="" style={{ maxHeight: 28, maxWidth: 120, objectFit: 'contain' }} />
                    <Button size="xs" variant="subtle" color="gray" onClick={() => set({ logo: undefined })}>
                      Remove
                    </Button>
                  </>
                )}
              </Group>
              <Textarea label="At the foot" description="e.g. who to contact, or a note on the data" autosize minRows={1} maxRows={6} value={pack.footer ?? ''} onChange={(e) => set({ footer: e.currentTarget.value })} />
            </Stack>
          </Card>

          <Card padding="md">
            <Title order={5} mb="xs">
              What’s in it
            </Title>
            <Stack gap="sm">
              <div>
                <Text size="sm" fw={500} mb={4}>
                  Dates
                </Text>
                <SegmentedControl
                  fullWidth
                  size="xs"
                  value={s.period}
                  onChange={(v) => set({ period: v as PackSettings['period'] })}
                  data={[
                    { value: 'all', label: 'All results' },
                    { value: 'years', label: 'The last few years' },
                    { value: 'custom', label: 'Between dates' },
                  ]}
                />
                {s.period === 'years' && <NumberInput mt={6} size="xs" label="Years" min={1} max={50} value={s.years ?? 5} onChange={(v) => set({ years: Number(v) || 5 })} w={120} />}
                {s.period === 'custom' && (
                  <Group grow mt={6}>
                    <TextInput size="xs" type="date" label="From" value={pack.start ?? ''} onChange={(e) => set({ start: e.currentTarget.value })} />
                    <TextInput size="xs" type="date" label="To" value={pack.end ?? ''} onChange={(e) => set({ end: e.currentTarget.value })} />
                  </Group>
                )}
              </div>
              <ReportSites sites={data.sites} chosen={pack.siteIds?.length ? pack.siteIds : null} onChange={(ids) => set({ siteIds: ids.length >= data.sites.length ? undefined : ids })} rememberedFor="the pack" />
              <PopupPicker
                label="Analytes"
                data={paramData}
                value={pack.parameterIds ?? []}
                onChange={(v) => set({ parameterIds: v.length ? v : undefined })}
                placeholder={consentIds.length && consentIds.length < data.index.paramIdsWithData.length ? `The consent’s analytes (${consentIds.length})` : 'Every analyte with results'}
                noun="analytes"
                presets={[
                  { label: 'The consent’s analytes', ids: consentIds },
                  { label: 'Every analyte', ids: data.index.paramIdsWithData },
                ]}
              />
              {data.continuous.series.length > 0 && (
                <Select
                  label="Rainfall or flow behind the graphs"
                  placeholder="Nothing"
                  clearable
                  data={data.continuous.series.map((x) => ({ value: `series:${x.id}`, label: `${x.name} (${KIND_TEXT[x.kind].toLowerCase()})` }))}
                  value={pack.overlay ?? null}
                  onChange={(v) => set({ overlay: v ?? undefined })}
                />
              )}
              <PopupPicker label="Guideline values" description="On the graphs and highlighted in the tables" data={setData} value={pack.guidelineSetIds ?? []} onChange={(v) => set({ guidelineSetIds: v.length ? v : undefined })} placeholder="None" noun="guideline sets" />
            </Stack>
          </Card>

          <Card padding="md">
            <Title order={5} mb="xs">
              What the client can see and do
            </Title>
            <Stack gap="xs">
              <Switch label="Consent limits and triggers" description="On the graphs, highlighted in the tables, and the compliance section" checked={s.limits} onChange={(e) => set({ limits: e.currentTarget.checked })} />
              <Switch label="Choose sites, analytes and dates" description="Off: the graphs and tables are shown as they are" checked={s.controls} onChange={(e) => set({ controls: e.currentTarget.checked })} />
              <Switch label="Download the results (CSV, for a spreadsheet)" checked={s.download} onChange={(e) => set({ download: e.currentTarget.checked })} />
              <Switch
                label="Aerial photo behind the site map"
                description={noCoords ? 'The sites have no locations yet – place them on the Map tab.' : s.aerial && aerial?.key === boxKey && !aerial.image ? 'The imagery couldn’t be loaded – the map shows the sites without it.' : 'LINZ imagery, taken when the pack is made'}
                checked={s.aerial}
                onChange={(e) => set({ aerial: e.currentTarget.checked })}
              />
            </Stack>
          </Card>

          <Card padding="md">
            <Group justify="space-between" mb="xs">
              <Title order={5}>Sections</Title>
              <Button size="xs" variant="subtle" leftSection={<IconPlus size={14} />} onClick={() => setSections([...sections, { id: uid('txt'), type: 'text', title: 'Notes', on: true, text: '' }])}>
                Text section
              </Button>
            </Group>
            <Text size="xs" c="dimmed" mb="xs">
              In the order they appear; switch off what the client doesn’t need.
            </Text>
            <Stack gap={6}>
              {sections.map((sec, i) => (
                <SectionRow
                  key={sec.id}
                  sec={sec}
                  first={i === 0}
                  last={i === sections.length - 1}
                  onChange={(n) => setSections(sections.map((x) => (x.id === sec.id ? n : x)))}
                  onMove={(d) => move(i, d)}
                  onDelete={sec.type === 'text' ? () => setSections(sections.filter((x) => x.id !== sec.id)) : undefined}
                />
              ))}
            </Stack>
            {pack.sections && (
              <Button size="xs" variant="subtle" color="gray" mt="xs" onClick={() => set({ sections: undefined })}>
                Back to the usual sections
              </Button>
            )}
          </Card>
        </Stack>
      </Grid.Col>
      <Grid.Col span={{ base: 12, lg: 7 }}>
        <Card padding="sm" style={{ position: 'sticky', top: 70 }}>
          <Group justify="space-between" mb="xs">
            <Text size="sm" fw={600}>
              As the client will see it
            </Text>
            <SegmentedControl
              size="xs"
              value={phone ? 'phone' : 'desk'}
              onChange={(v) => setPhone(v === 'phone')}
              data={[
                {
                  value: 'desk',
                  label: (
                    <Tooltip label="Computer">
                      <IconDeviceDesktop size={15} style={{ display: 'block' }} />
                    </Tooltip>
                  ),
                },
                {
                  value: 'phone',
                  label: (
                    <Tooltip label="Phone">
                      <IconDeviceMobile size={15} style={{ display: 'block' }} />
                    </Tooltip>
                  ),
                },
              ]}
            />
          </Group>
          {!data.samples.length && (
            <Alert color="orange" variant="light" mb="xs" p="xs">
              <Text size="xs">This project has no results yet.</Text>
            </Alert>
          )}
          <PackPreview data={preview} phone={phone} />
        </Card>
      </Grid.Col>
    </Grid>
  );
}
