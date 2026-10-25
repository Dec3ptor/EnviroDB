// Field mode on the computer: make a round's field sheet for a phone (a QR code to scan, a link or a file), and add
// the results file a phone sends back.

import { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Checkbox, CopyButton, Grid, Group, Modal, Stack, Switch, Table, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCheck, IconCopy, IconDeviceMobile, IconDownload, IconFolder, IconPlus } from '@tabler/icons-react';
import { useProject } from '../hooks/useProjectData';
import { useSettings } from '../hooks/useSettings';
import { ReportSites } from './report/ReportSites';
import { PopupPicker, type PickerData } from './PopupPicker';
import { commitField, defaultMeasures, makeSheet, planField } from '../db/field';
import { lockFile, sheetLink, type FieldResults } from '../field/model';
import { QrCode } from './QrCode';
import { MoreOptions } from './common';
import { LockedBadge, lockKey } from './TeamKey';
import { currentWorkspaceFolder } from '../sync/workspace';
import { downloadBlob, safeFileName } from '../db/backup';
import { formatDate, todayStr } from '../lib/dates';
import { unitLabel } from '../lib/units';
import { fmtNum } from '../lib/values';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** Room in a QR code a phone's camera reads easily (from a screen). */
const QR_MAX = 2300;

/** What the phone asks to note at each site, in a few words. */
export const noted = (o: { weather: boolean; flow: boolean; appearance: boolean; photos: boolean }) =>
  [o.weather && 'weather', o.flow && 'flow', o.appearance && 'appearance', o.photos && 'photos'].filter((x): x is string => !!x);

export function FieldSheetModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const data = useProject();
  const { project } = data;
  const settings = useSettings();
  const today = todayStr();
  const [date, setDate] = useState(today);
  const [round, setRound] = useState('');
  const [siteIds, setSiteIds] = useState<string[] | null>(null);
  const [measureIds, setMeasureIds] = useState<string[]>([]);
  const [observe, setObserve] = useState({ weather: true, flow: true, appearance: true, photos: true });
  const [withLast, setWithLast] = useState(true);
  const [link, setLink] = useState('');
  useEffect(() => {
    if (!opened) return;
    setDate(today);
    setRound(`${MONTH_NAMES[Number(today.slice(5, 7)) - 1]} ${today.slice(0, 4)} monitoring`);
    setSiteIds(null);
    setMeasureIds(defaultMeasures(data));
    setObserve({ weather: true, flow: data.sites.some((s) => /surface|discharge|storm/i.test(s.type)), appearance: true, photos: true });
  }, [opened]);

  const sheet = useMemo(
    () => (opened ? makeSheet(data, { round, date, siteIds: siteIds ?? data.sites.map((s) => s.id), measureIds, observe, withLast, by: settings.author }) : null),
    [opened, data, round, date, siteIds, measureIds, observe, withLast, settings.author],
  );
  // locked with the team key when the team has it on
  const key = lockKey(settings);
  useEffect(() => {
    if (!sheet) return;
    let live = true;
    setLink('');
    void sheetLink(`${location.origin}${location.pathname}`, sheet, key).then((l) => live && setLink(l));
    return () => {
      live = false;
    };
  }, [sheet, key]);
  const fileText = async () => JSON.stringify(sheet && key ? await lockFile(sheet, key) : sheet);
  const paramData: PickerData = useMemo(() => {
    const groups = new Map<string, PickerData[number]['items']>();
    for (const p of data.params) groups.set(p.group, [...(groups.get(p.group) ?? []), { value: p.id, label: p.name, hint: unitLabel(p.unit) }]);
    const order = (g: string) => (g === 'Field' ? 0 : g === 'Physical' ? 1 : 2);
    return [...groups].sort((a, b) => order(a[0]) - order(b[0])).map(([group, items]) => ({ group, items }));
  }, [data.params]);
  const fileName = sheet ? `${safeFileName(`Field sheet - ${project.code || project.name} - ${sheet.date}`)}.json` : '';
  const saveToFolder = async () => {
    const folder = currentWorkspaceFolder();
    if (!folder || !sheet) return;
    try {
      await folder.write(`Field sheets/${fileName}`, await fileText());
      notifications.show({ color: 'teal', message: `Saved to the shared folder: Field sheets/${fileName}. On the phone, open it from OneDrive in EnviroDB field.` });
    } catch (e) {
      notifications.show({ color: 'red', message: (e as Error).message });
    }
  };
  const fits = link.length > 0 && link.length <= QR_MAX;
  return (
    <Modal opened={opened} onClose={onClose} title="Field sheet for a phone" size="xl">
      {sheet && (
        <Grid gutter="lg">
          <Grid.Col span={{ base: 12, md: 7 }}>
            <Stack gap="sm">
              <Group grow align="flex-start">
                <TextInput label="Round" value={round} onChange={(e) => setRound(e.currentTarget.value)} />
                <TextInput label="Day" type="date" value={date} onChange={(e) => e.currentTarget.value && setDate(e.currentTarget.value)} />
              </Group>
              <ReportSites sites={data.sites} chosen={siteIds} onChange={(ids) => setSiteIds(ids.length >= data.sites.length ? null : ids)} rememberedFor="this sheet" />
              <PopupPicker label="Readings to take" data={paramData} value={measureIds} onChange={setMeasureIds} placeholder="None – notes only" noun="readings" />
              <MoreOptions label="More options" summary={[...noted(observe), withLast ? 'last time’s readings' : ''].filter(Boolean).join(', ') || 'Readings only'}>
                <Stack gap="sm">
                  <Group gap="lg">
                    <Checkbox label="Weather" checked={observe.weather} onChange={(e) => setObserve({ ...observe, weather: e.currentTarget.checked })} />
                    <Checkbox label="Flow" checked={observe.flow} onChange={(e) => setObserve({ ...observe, flow: e.currentTarget.checked })} />
                    <Checkbox label="Appearance" checked={observe.appearance} onChange={(e) => setObserve({ ...observe, appearance: e.currentTarget.checked })} />
                    <Checkbox label="Photos" checked={observe.photos} onChange={(e) => setObserve({ ...observe, photos: e.currentTarget.checked })} />
                  </Group>
                  <Switch label="Last time’s readings, to compare with on site" checked={withLast} onChange={(e) => setWithLast(e.currentTarget.checked)} />
                </Stack>
              </MoreOptions>
              <Text size="xs" c="dimmed">
                The phone keeps the sheet and what’s recorded on it, and works with no signal. It sends the results back as a file – save it to the team’s <b>Inbox</b> folder in OneDrive and EnviroDB picks it up, or drop it on the
                Import page. Made again for the same day, the phone keeps what it has recorded.
              </Text>
            </Stack>
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 5 }}>
            <Stack gap="xs" align="center">
              {fits ? (
                <>
                  <QrCode text={link} />
                  <Text size="sm" ta="center">
                    <IconDeviceMobile size={15} style={{ verticalAlign: -2 }} /> Scan with the phone’s camera
                  </Text>
                </>
              ) : (
                <Alert color="blue" variant="light" p="xs">
                  <Text size="xs">Too much for a QR code ({sheet.sites.length} sites) – save the sheet to the shared folder or send the link instead.</Text>
                </Alert>
              )}
              <CopyButton value={link}>
                {({ copied, copy }) => (
                  <Button size="xs" variant="default" fullWidth leftSection={copied ? <IconCheck size={14} /> : <IconCopy size={14} />} onClick={copy} disabled={!link}>
                    {copied ? 'Link copied' : 'Copy the link (to email or message it)'}
                  </Button>
                )}
              </CopyButton>
              {currentWorkspaceFolder() && (
                <Button size="xs" variant="default" fullWidth leftSection={<IconFolder size={14} />} onClick={() => void saveToFolder()}>
                  Save to the shared folder (Field sheets)
                </Button>
              )}
              <Button size="xs" variant="subtle" fullWidth leftSection={<IconDownload size={14} />} onClick={() => void fileText().then((t) => downloadBlob(new Blob([t], { type: 'application/json' }), fileName))}>
                Download the sheet file
              </Button>
              <Text size="xs" c="dimmed" ta="center">
                {sheet.sites.length} sites · {sheet.measures.length} readings each
              </Text>
              <LockedBadge k={key} />
            </Stack>
          </Grid.Col>
        </Grid>
      )}
    </Modal>
  );
}

/** A phone's results file: what it holds, and adding it to the project. */
export function FieldResultsModal({ results, fileName, onClose, onAdded }: { results: FieldResults | null; fileName: string; onClose: () => void; onAdded?: (importId: string) => void }) {
  const data = useProject();
  const plan = useMemo(() => (results ? planField(data, results) : null), [data, results]);
  const [busy, setBusy] = useState(false);
  // the phone's new sites and the locations set there: all taken unless unticked
  const [skipNew, setSkipNew] = useState<Set<string>>(new Set());
  const [skipLoc, setSkipLoc] = useState<Set<string>>(new Set());
  if (!results || !plan) return null;
  const toggle = (set: Set<string>, id: string, on: boolean) => {
    const next = new Set(set);
    if (on) next.delete(id);
    else next.add(id);
    return next;
  };
  const newOnes = plan.newSites.filter((n) => !n.existing);
  const chosenNew = new Set(newOnes.filter((n) => !skipNew.has(n.field.id)).map((n) => n.field.id));
  const chosenLoc = new Set(plan.located.filter((l) => !skipLoc.has(l.site.id)).map((l) => l.site.id));
  const leftOut = new Set(newOnes.filter((n) => !chosenNew.has(n.field.id)).map((n) => n.site.id));
  const rows = plan.rows.filter((r) => !leftOut.has(r.site.id));
  const where = (lat?: number, lng?: number) => (lat !== undefined && lng !== undefined ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : 'no location');
  const away = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);
  const other = results.sheet.project.id && results.sheet.project.id !== data.project.id;
  const add = async () => {
    setBusy(true);
    try {
      const res = await commitField(data.project.id, plan, fileName, { newSites: chosenNew, located: chosenLoc });
      notifications.show({
        color: res.photoError ? 'orange' : 'teal',
        title: `Field results added: ${res.samples} sites, ${res.results} readings`,
        message:
          [
            res.sitesAdded ? `${res.sitesAdded} new site${res.sitesAdded === 1 ? '' : 's'} added.` : '',
            res.located ? `${res.located} location${res.located === 1 ? '' : 's'} set.` : '',
            res.photos ? `${res.photos} photos saved to the shared folder (Field photos).` : '',
            res.photoError ?? '',
          ]
            .filter(Boolean)
            .join(' ') || 'They join the lab’s results for the same day.',
      });
      onAdded?.(res.batch.id);
      onClose();
    } catch (e) {
      notifications.show({ color: 'red', title: 'Not added', message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const params = [...new Map(rows.flatMap((r) => r.values.map((v) => [v.param.id, v.param]))).values()];
  const warnings = rows.flatMap((r) => r.values.filter((v) => v.warning).map((v) => `${r.site.code} ${v.param.name}: ${fmtNum(v.value)} – ${v.warning}`));
  return (
    <Modal opened onClose={onClose} title="Field results from a phone" size="xl">
      <Stack gap="sm">
        <Text size="sm">
          <b>{results.sheet.round || 'Field results'}</b> · {formatDate(results.sheet.date)}
          {results.by ? ` · sampled by ${results.by}` : ''}
          {results.sent ? ` · sent ${formatDate(results.sent.slice(0, 10))}` : ''}
        </Text>
        {other && (
          <Alert color="orange" variant="light" p="xs">
            <Text size="sm">This sheet was made for another project ({results.sheet.project.name}). Only the sites this project has are added.</Text>
          </Alert>
        )}
        {plan.newSites.length > 0 && (
          <div>
            <Text size="sm" fw={600} mb={4}>
              New monitoring points from the field
            </Text>
            <Stack gap={4}>
              {plan.newSites.map((n) =>
                n.existing ? (
                  <Text size="sm" key={n.field.id} c="dimmed">
                    {n.field.code} – the project has this site already: its readings go to it.
                  </Text>
                ) : (
                  <Checkbox
                    key={n.field.id}
                    checked={chosenNew.has(n.field.id)}
                    onChange={(e) => setSkipNew(toggle(skipNew, n.field.id, e.currentTarget.checked))}
                    label={`${n.field.code}${n.field.name ? ` – ${n.field.name}` : ''} · ${n.site.type} · ${where(n.field.lat, n.field.lng)}${n.field.acc ? ` (±${n.field.acc} m)` : ''}`}
                    description={n.field.note}
                  />
                ),
              )}
            </Stack>
          </div>
        )}
        {plan.located.length > 0 && (
          <div>
            <Text size="sm" fw={600} mb={4}>
              Locations set in the field
            </Text>
            <Stack gap={4}>
              {plan.located.map((l) => (
                <Checkbox
                  key={l.site.id}
                  checked={chosenLoc.has(l.site.id)}
                  onChange={(e) => setSkipLoc(toggle(skipLoc, l.site.id, e.currentTarget.checked))}
                  label={`${l.site.code}: ${l.movedM === null ? `had no location – now ${where(l.lat, l.lng)}` : `moved ${away(l.movedM)}, to ${where(l.lat, l.lng)}`} · ${l.how === 'gps' ? `by GPS${l.acc ? ` ±${l.acc} m` : ''}` : 'placed on the map'}`}
                />
              ))}
            </Stack>
          </div>
        )}
        {rows.length ? (
          <Table.ScrollContainer minWidth={520}>
            <Table fz="sm" striped>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Site</Table.Th>
                  <Table.Th>Sampled</Table.Th>
                  {params.map((p) => (
                    <Table.Th key={p.id} ta="right">
                      {p.short || p.name}
                    </Table.Th>
                  ))}
                  <Table.Th>Seen</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((r) => (
                  <Table.Tr key={r.site.id}>
                    <Table.Td fw={600}>{r.site.code}</Table.Td>
                    <Table.Td style={{ whiteSpace: 'nowrap' }}>{formatDate(r.date, { time: true })}</Table.Td>
                    {params.map((p) => {
                      const v = r.values.find((x) => x.param.id === p.id);
                      return (
                        <Table.Td key={p.id} ta="right" c={v?.warning ? 'orange' : v?.derived ? 'dimmed' : undefined} title={v?.warning ?? (v?.derived ? `Worked out ${v.derived}` : undefined)} fs={v?.derived ? 'italic' : undefined}>
                          {v ? fmtNum(v.value) : '–'}
                        </Table.Td>
                      );
                    })}
                    <Table.Td>
                      <Text size="xs" c="dimmed" lineClamp={2}>
                        {[r.visit.weather, r.visit.flow && `flow ${r.visit.flow.toLowerCase()}`, r.visit.appearance, r.visit.notes].filter(Boolean).join(' · ')}
                        {r.visit.photos?.length ? ` · ${r.visit.photos.length} photos` : ''}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        ) : (
          <Text size="sm" c="dimmed">
            Nothing recorded for this project’s sites.
          </Text>
        )}
        {plan.notSampled.length > 0 && (
          <Text size="sm">
            Not sampled: {plan.notSampled.map((n) => `${n.site.code} (${n.reason.toLowerCase()})`).join(', ')}.
          </Text>
        )}
        {warnings.length > 0 && (
          <Alert color="orange" variant="light" p="xs" title="Readings to look at">
            {warnings.map((w) => (
              <Text size="xs" key={w}>
                {w}
              </Text>
            ))}
          </Alert>
        )}
        {(plan.unknownSites.length > 0 || plan.unknownParams.length > 0) && (
          <Text size="xs" c="dimmed">
            Left out: {[plan.unknownSites.length && `${plan.unknownSites.length} sites this project doesn’t have`, plan.unknownParams.length && `readings of ${plan.unknownParams.join(', ')}`].filter(Boolean).join('; ')}.
          </Text>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button leftSection={<IconPlus size={16} />} loading={busy} disabled={!rows.length && !chosenNew.size && !chosenLoc.size} onClick={() => void add()}>
            {rows.length ? `Add ${rows.length} sites’ results` : 'Add'}
          </Button>
        </Group>
        <Badge variant="light" color="gray" style={{ alignSelf: 'flex-start' }}>
          The readings join each site’s sample for the day; what was seen goes in its notes; photos go to the shared folder.
        </Badge>
      </Stack>
    </Modal>
  );
}

