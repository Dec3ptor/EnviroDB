// Printable field codes: a PDF of QR codes for the project – its own (the day's field sheet, all its sites) and one for
// each site – to scan with a phone in the field instead of the computer's screen.

import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Checkbox, Grid, Group, Modal, SegmentedControl, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconDownload, IconQrcode } from '@tabler/icons-react';
import { useProject } from '../hooks/useProjectData';
import { useSettings } from '../hooks/useSettings';
import { ReportSites } from './report/ReportSites';
import { PopupPicker, type PickerData } from './PopupPicker';
import { defaultMeasures, makeCodes } from '../db/field';
import { codeLink, type FieldCode } from '../field/model';
import { LockedBadge, lockKey } from './TeamKey';
import { MoreOptions } from './common';
import { noted } from './FieldSheet';
import { CODE_LAYOUTS, downloadFieldCodes, fieldCodesPdfBytes, fitsQr, type CodeLayout, type CodesPdfInput } from '../reports/fieldCodes';
import { PdfPreview } from '../reports/PdfPreview';
import { safeFileName } from '../db/backup';
import { todayStr } from '../lib/dates';
import { unitLabel } from '../lib/units';
import { siteLatLng } from '../lib/nztm';

type Links = { project: string; sites: string[] };

export function FieldCodesModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const data = useProject();
  const { project } = data;
  const settings = useSettings();
  const [what, setWhat] = useState<string[]>(['project', 'sites']);
  const [siteIds, setSiteIds] = useState<string[] | null>(null);
  const [layout, setLayout] = useState<CodeLayout>('cards');
  const [measureIds, setMeasureIds] = useState<string[]>([]);
  const [observe, setObserve] = useState({ weather: true, flow: true, appearance: true, photos: true });
  const [fill, setFill] = useState({ time: true, gps: true });
  const [withLocation, setWithLocation] = useState(true);
  const [withNotes, setWithNotes] = useState(false);
  const [show, setShow] = useState({ name: true, project: true, readings: true });
  const [links, setLinks] = useState<Links | null>(null);
  const [input, setInput] = useState<CodesPdfInput | null>(null);
  const [saving, setSaving] = useState(false);
  const located = data.sites.some((s) => siteLatLng(s));
  useEffect(() => {
    if (!opened) return;
    setSiteIds(null);
    setMeasureIds(defaultMeasures(data));
    setObserve({ weather: true, flow: data.sites.some((s) => /surface|discharge|storm/i.test(s.type)), appearance: true, photos: true });
    setWithLocation(located);
  }, [opened]);

  const made = useMemo(
    () => (opened ? makeCodes(data, { siteIds: siteIds ?? data.sites.map((s) => s.id), measureIds, observe, fill, withLocation, withNotes }) : null),
    [opened, data, siteIds, measureIds, observe, fill, withLocation, withNotes],
  );
  // the project's data is read again whenever anything changes (a colleague's edit, say): the PDF is made again only
  // when the codes themselves change
  const madeKey = made ? JSON.stringify(made) : '';
  const codes = useMemo(() => made, [madeKey]);
  // locked with the team key when the team has it on
  const key = lockKey(settings);
  useEffect(() => {
    if (!codes) return;
    let live = true;
    setLinks(null);
    const base = `${location.origin}${location.pathname}`;
    const link = (c: FieldCode) => codeLink(base, c, key);
    void Promise.all([link(codes.project), ...codes.sites.map(link)]).then(([p, ...s]) => live && setLinks({ project: p, sites: s }));
    return () => {
      live = false;
    };
  }, [codes, key]);
  const projectFits = !!links && fitsQr(links.project);
  // the PDF, a moment after the last change (each one makes it again)
  useEffect(() => {
    if (!codes || !links || links.sites.length !== codes.sites.length) return;
    const t = window.setTimeout(
      () =>
        setInput({
          project: { name: project.name, code: project.code || undefined },
          projectCode: what.includes('project') && projectFits ? { code: codes.project, link: links.project } : undefined,
          siteCodes: what.includes('sites') ? codes.sites.map((code, i) => ({ code, link: links.sites[i] })) : [],
          layout,
          show: { ...show, location: withLocation, notes: withNotes },
          fill,
          printed: todayStr(),
          dateFormat: settings.dateFormat,
          lockedWith: key?.id,
        }),
      250,
    );
    return () => window.clearTimeout(t);
  }, [codes, links, what, layout, show, withLocation, withNotes, fill, projectFits, settings.dateFormat, key]);
  const nothing = !input || (!input.projectCode && !input.siteCodes.length);
  const load = useMemo(() => (input && !nothing ? () => fieldCodesPdfBytes(input) : null), [input, nothing]);

  const paramData: PickerData = useMemo(() => {
    const groups = new Map<string, PickerData[number]['items']>();
    for (const p of data.params) groups.set(p.group, [...(groups.get(p.group) ?? []), { value: p.id, label: p.name, hint: unitLabel(p.unit) }]);
    const order = (g: string) => (g === 'Field' ? 0 : g === 'Physical' ? 1 : 2);
    return [...groups].sort((a, b) => order(a[0]) - order(b[0])).map(([group, items]) => ({ group, items }));
  }, [data.params]);

  const download = async () => {
    if (!input || nothing) return;
    setSaving(true);
    try {
      await downloadFieldCodes(input, `${safeFileName(`Field codes - ${project.code || project.name}`)}.pdf`);
    } catch (e) {
      notifications.show({ color: 'red', message: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };
  const n = codes?.sites.length ?? 0;
  return (
    <Modal opened={opened} onClose={onClose} title="Printable field codes" size="min(1200px, 96vw)">
      <Grid gutter="lg">
        <Grid.Col span={{ base: 12, md: 5 }}>
          <Stack gap="sm">
            <Text size="sm" c="dimmed">
              QR codes to print and take into the field: scanned with a phone, they open the day’s field sheet – no computer screen needed. They hold no dates, so they serve every round.
            </Text>
            <Checkbox.Group label="Codes" value={what} onChange={setWhat}>
              <Stack gap={6} mt={4}>
                <Checkbox value="project" label="The project’s code – the day’s sheet with all the sites (a cover page)" />
                <Checkbox value="sites" label="A code for each site – scanned at the site, it opens that site" />
              </Stack>
            </Checkbox.Group>
            <ReportSites sites={data.sites} chosen={siteIds} onChange={(ids) => setSiteIds(ids.length >= data.sites.length ? null : ids)} rememberedFor="these codes" />
            {what.includes('sites') && (
              <div>
                <Text size="sm" fw={500} mb={4}>
                  Layout of the sites’ codes
                </Text>
                <SegmentedControl fullWidth value={layout} onChange={(v) => setLayout(v as CodeLayout)} data={CODE_LAYOUTS.map((l) => ({ value: l.value, label: l.label }))} />
                <Text size="xs" c="dimmed" mt={4}>
                  {CODE_LAYOUTS.find((l) => l.value === layout)!.hint}
                </Text>
              </div>
            )}
            <PopupPicker label="Readings to take" data={paramData} value={measureIds} onChange={setMeasureIds} placeholder="None – notes only" noun="readings" />
            <MoreOptions label="More options" summary={[...noted(observe), fill.time && 'time filled in', fill.gps && 'GPS', withLocation && located && 'locations', withNotes && 'notes'].filter(Boolean).join(', ')}>
              <Stack gap="sm">
                <Group gap="lg">
                  <Checkbox label="Weather" checked={observe.weather} onChange={(e) => setObserve({ ...observe, weather: e.currentTarget.checked })} />
                  <Checkbox label="Flow" checked={observe.flow} onChange={(e) => setObserve({ ...observe, flow: e.currentTarget.checked })} />
                  <Checkbox label="Appearance" checked={observe.appearance} onChange={(e) => setObserve({ ...observe, appearance: e.currentTarget.checked })} />
                  <Checkbox label="Photos" checked={observe.photos} onChange={(e) => setObserve({ ...observe, photos: e.currentTarget.checked })} />
                </Group>
                <div>
                  <Text size="sm" fw={500} mb={4}>
                    When a site’s code is scanned
                  </Text>
                  <Stack gap={6}>
                    <Checkbox label="Fill in the time sampled" checked={fill.time} onChange={(e) => setFill({ ...fill, time: e.currentTarget.checked })} />
                    <Checkbox label="Record the phone’s location (GPS)" checked={fill.gps} onChange={(e) => setFill({ ...fill, gps: e.currentTarget.checked })} />
                    <Checkbox
                      label="Sites’ locations"
                      description={located ? 'For directions on the phone, and to say when the phone is far from the site (the wrong site?)' : 'None of the sites has a location yet (Setup → Sites)'}
                      checked={withLocation && located}
                      disabled={!located}
                      onChange={(e) => setWithLocation(e.currentTarget.checked)}
                    />
                    <Checkbox
                      label="Sites’ directions and notes"
                      description={
                        key
                          ? 'Locked with the team key: only the team’s phones can read them.'
                          : 'Anyone who scans a code can read what it holds – leave this off if the notes have gate codes or keys and the codes are left at the sites (or lock the codes with the team key, in Settings).'
                      }
                      checked={withNotes}
                      onChange={(e) => setWithNotes(e.currentTarget.checked)}
                    />
                  </Stack>
                </div>
                <div>
                  <Text size="sm" fw={500} mb={4}>
                    Printed beside each code
                  </Text>
                  <Group gap="lg">
                    <Checkbox label="Site name" checked={show.name} onChange={(e) => setShow({ ...show, name: e.currentTarget.checked })} />
                    <Checkbox label="Project" checked={show.project} onChange={(e) => setShow({ ...show, project: e.currentTarget.checked })} />
                    <Checkbox label="Readings" checked={show.readings} onChange={(e) => setShow({ ...show, readings: e.currentTarget.checked })} />
                  </Group>
                </div>
              </Stack>
            </MoreOptions>
            {links && what.includes('project') && !projectFits && (
              <Alert color="orange" variant="light" p="xs">
                <Text size="xs">Too many sites for the project’s code ({n}) – it’s left out. Print a code for each site, or choose fewer sites.</Text>
              </Alert>
            )}
            <LockedBadge k={key} />
            <Text size="xs" c="dimmed">
              <IconQrcode size={13} style={{ verticalAlign: -2 }} /> Test one first: scan a code in the preview with a phone. Print again after adding sites or changing the readings{key ? ', or after a new team key' : ''}.
            </Text>
          </Stack>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 7 }}>
          <Group justify="flex-end" mb="xs">
            <Button leftSection={<IconDownload size={16} />} onClick={() => void download()} loading={saving} disabled={nothing}>
              Download the PDF
            </Button>
          </Group>
          <div style={{ height: 'min(74vh, 880px)', display: 'flex', flexDirection: 'column' }}>
            {nothing && input ? (
              <Text c="dimmed" size="sm">
                Choose the project’s code, the sites’ codes or both.
              </Text>
            ) : (
              <PdfPreview load={load} building={!input} fill />
            )}
          </div>
        </Grid.Col>
      </Grid>
    </Modal>
  );
}
