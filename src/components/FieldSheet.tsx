// Field mode on the computer: make a round's field sheet for a phone (a QR code to scan, a link or a file), and add
// the results file a phone sends back.

import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Checkbox, CopyButton, Grid, Group, Modal, Select, Stack, Switch, Table, Text, TextInput } from '@mantine/core';
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

const isJobName = (r: FieldResults) => r.sheet.id.startsWith('job-');
/** Photos dropped on the Import page (not from a phone). */
const isPhotosName = (r: FieldResults) => r.sheet.id.startsWith('photos-');

/** EnviroDB field on a phone: a code to scan once (then kept on the home screen); a quick job starts there. */
export function PhoneAppModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const link = `${location.origin}${location.pathname}#/field`;
  return (
    <Modal opened={opened} onClose={onClose} title="EnviroDB field on your phone" size="md" centered>
      <Stack gap="sm" align="center">
        <QrCode text={link} size={210} label="QR code to open EnviroDB field" />
        <Text size="sm" ta="center">
          Scan it with the phone’s camera, then add the page to the home screen (iPhone: Share → Add to Home Screen; Android: ⋮ → Add to Home screen).
        </Text>
        <Text size="sm" c="dimmed" ta="center">
          For a quick job tap <b>New job</b> on the phone – nothing to set up here first. Photos stay full size, each with where it was taken. Send the job file to the team’s Inbox folder (OneDrive), or drop it on Import.
        </Text>
        <CopyButton value={link}>
          {({ copied, copy }) => (
            <Button size="xs" variant="default" leftSection={copied ? <IconCheck size={14} /> : <IconCopy size={14} />} onClick={copy}>
              {copied ? 'Copied' : 'Copy the link'}
            </Button>
          )}
        </CopyButton>
      </Stack>
    </Modal>
  );
}

/** A phone's results file: what it holds, and adding it to the project. */
/** `more`: what's still to review after this; `smaller`: came by the flashing code, the photos made smaller. */
export function FieldResultsModal({ results, fileName, onClose, onAdded, more, smaller }: { results: FieldResults | null; fileName: string; onClose: () => void; onAdded?: (importId: string) => void; more?: string; smaller?: boolean }) {
  const data = useProject();
  const plan = useMemo(() => (results ? planField(data, results) : null), [data, results]);
  const [busy, setBusy] = useState(false);
  // each new point: a new site, with one of the project's sites (one nearby to start with), its photos kept with the
  // project (no site), or left out; the locations set in the field: all taken unless unticked
  const [pointChoice, setPointChoice] = useState<Record<string, string>>({});
  const [skipLoc, setSkipLoc] = useState<Set<string>>(new Set());
  if (!results || !plan) return null;
  const toggle = (set: Set<string>, id: string, on: boolean) => {
    const next = new Set(set);
    if (on) next.delete(id);
    else next.add(id);
    return next;
  };
  const newOnes = plan.newSites.filter((n) => !n.existing);
  const choiceOf = (id: string) => pointChoice[id] ?? newOnes.find((n) => n.field.id === id)?.suggest ?? 'new';
  const chosenNew = new Set(newOnes.filter((n) => choiceOf(n.field.id) === 'new').map((n) => n.field.id));
  const attach = new Map(newOnes.filter((n) => !['new', 'skip', 'project'].includes(choiceOf(n.field.id))).map((n) => [n.field.id, choiceOf(n.field.id)]));
  const toProject = new Set(newOnes.filter((n) => n.photosOnly && choiceOf(n.field.id) === 'project').map((n) => n.field.id));
  const chosenLoc = new Set(plan.located.filter((l) => !skipLoc.has(l.site.id)).map((l) => l.site.id));
  const leftOut = new Set(newOnes.filter((n) => ['skip', 'project'].includes(choiceOf(n.field.id))).map((n) => n.site.id));
  // the photos kept with the project
  const projectPics = plan.rows.filter((r) => newOnes.some((n) => n.site.id === r.site.id && toProject.has(n.field.id))).reduce((k, r) => k + (r.visit.photos?.length ?? 0), 0);
  // the rows as they'll be added: a point joining a site shows as that site
  const joined = new Map(newOnes.filter((n) => attach.has(n.field.id)).map((n) => [n.site.id, data.siteMap.get(attach.get(n.field.id)!)!]));
  const rows = plan.rows.filter((r) => !leftOut.has(r.site.id)).map((r) => (joined.get(r.site.id) ? { ...r, site: joined.get(r.site.id)!, from: r.site.code } : { ...r, from: undefined }));
  const pics = rows.flatMap((r) => r.visit.photos ?? []);
  // located: by the photo's own position, or (older phones) where the visit was recorded
  const located = rows.reduce((n, r) => n + (r.visit.photos ?? []).filter((p) => p.lat !== undefined || r.visit.gps).length, 0);
  const where = (lat?: number, lng?: number) => (lat !== undefined && lng !== undefined ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : 'no location');
  const away = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);
  const other = results.sheet.project.id && results.sheet.project.id !== data.project.id;
  const add = async () => {
    setBusy(true);
    try {
      const res = await commitField(data.project.id, plan, fileName, { newSites: chosenNew, located: chosenLoc, attach, project: toProject });
      notifications.show({
        color: res.photoError ? 'orange' : 'teal',
        title: res.results ? `Field results added: ${res.samples} site${res.samples === 1 ? '' : 's'}, ${res.results} reading${res.results === 1 ? '' : 's'}` : `${res.photos} photo${res.photos === 1 ? '' : 's'} added`,
        message:
          [
            res.sitesAdded ? `${res.sitesAdded} new site${res.sitesAdded === 1 ? '' : 's'} added.` : '',
            res.located ? `${res.located} location${res.located === 1 ? '' : 's'} set.` : '',
            res.photos ? (res.results ? `${res.photos} photo${res.photos === 1 ? '' : 's'} saved to the shared folder (Field photos)` : `Saved to the shared folder (Field photos)`) + (res.samples && !res.results ? `, ${res.photos - res.projectPhotos} with ${res.samples === 1 ? 'a site’s sample' : `${res.samples} sites’ samples`}` : '') + (res.projectPhotos ? `, ${res.projectPhotos} kept with the project – choose them for a report’s figures` : '') + '.' : '',
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
    <Modal opened onClose={onClose} title={isPhotosName(results) ? 'Photos to add' : isJobName(results) ? 'A field job from a phone' : 'Field results from a phone'} size="xl">
      <Stack gap="sm">
        <Text size="sm">
          <b>{isPhotosName(results) ? `${results.visits.reduce((n, v) => n + (v.photos?.length ?? 0), 0)} photos` : results.sheet.round || 'Field results'}</b> · {isPhotosName(results) ? 'from ' : ''}
          {formatDate(results.sheet.date)}
          {results.by && !isPhotosName(results) ? ` · sampled by ${results.by}` : ''}
          {results.sent && !isPhotosName(results) ? ` · sent ${formatDate(results.sent.slice(0, 10))}` : ''}
          {more ? ` · ${more}` : ''}
        </Text>
        {other && (
          <Alert color="orange" variant="light" p="xs">
            <Text size="sm">
              This {isJobName(results) ? 'job' : 'sheet'} was made for another project ({results.sheet.project.name}). {isJobName(results) ? 'Its points are added to this one.' : 'Only the sites this project has are added.'}
            </Text>
          </Alert>
        )}
        {!results.sheet.project.id && (
          <Text size="sm" c="dimmed">
            Adding to <b>{data.project.name}</b>. {isPhotosName(results) ? 'For' : 'The job was started without a project: for'} another one, close this and choose it under Project.
          </Text>
        )}
        {plan.newSites.length > 0 && (
          <div>
            <Text size="sm" fw={600} mb={4}>
              {isPhotosName(results) ? 'Where the photos were taken' : 'Points from the field'}
            </Text>
            <Stack gap={6}>
              {plan.newSites.map((n) => {
                const row = plan.rows.find((r) => r.site.id === n.site.id);
                const what = [row?.values.length ? `${row.values.length} reading${row.values.length === 1 ? '' : 's'}` : '', row?.visit.photos?.length ? `${row.visit.photos.length} photo${row.visit.photos.length === 1 ? '' : 's'}` : '', row?.visit.notes ? 'notes' : ''].filter(Boolean).join(', ');
                const label = `${n.field.code}${n.field.name ? ` – ${n.field.name}` : ''}`;
                if (n.existing)
                  return (
                    <Text size="sm" key={n.field.id} c="dimmed">
                      {label} – the project has this site already: {what || 'what was recorded'} goes to it.
                    </Text>
                  );
                const nearby = n.near.slice(0, 6).map((x) => ({ value: x.site.id, label: `With ${x.site.code} – ${away(x.m)} away` }));
                const rest = data.sites.filter((x) => !n.near.slice(0, 6).some((y) => y.site.id === x.id)).map((x) => ({ value: x.id, label: `With ${x.code}${x.name ? ` – ${x.name}` : ''}` }));
                return (
                  <Group key={n.field.id} gap="sm" wrap="wrap" align="center">
                    <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                      <Text size="sm" fw={500}>
                        {label}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {[what, n.field.lat !== undefined ? `${where(n.field.lat, n.field.lng)}${n.field.acc ? ` (±${n.field.acc} m)` : ''}` : 'no location', n.field.note, n.before && data.siteMap.get(n.suggest) ? `with ${data.siteMap.get(n.suggest)!.code} when added before` : ''].filter(Boolean).join(' · ')}
                      </Text>
                    </div>
                    <Select
                      size="xs"
                      w={290}
                      aria-label={`What ${n.field.code} is`}
                      value={choiceOf(n.field.id)}
                      onChange={(v) => v && setPointChoice({ ...pointChoice, [n.field.id]: v })}
                      allowDeselect={false}
                      searchable
                      data={[
                        { group: 'Add', items: [{ value: 'new', label: `A new site, ${n.field.code} (${n.site.type})` }] },
                        ...(nearby.length || rest.length ? [{ group: 'Part of a site', items: [...nearby, ...rest] }] : []),
                        { group: 'Or', items: [...(n.photosOnly ? [{ value: 'project', label: 'With the project – no site' }] : []), { value: 'skip', label: 'Leave it out' }] },
                      ]}
                    />
                  </Group>
                );
              })}
            </Stack>
            {newOnes.some((n) => n.field.auto) && (
              <Text size="xs" c="dimmed" mt={4}>
                {newOnes.some((n) => n.photosOnly)
                  ? 'Photos taken a few metres from one of the project’s sites start as part of that site (they join its sample for the day); the others are kept with the project – no site – ready for report figures. Choose a site or a new one for any of them.'
                  : 'Points named by the phone (P1, P2 …) a few metres from one of the project’s sites start as part of that site; the others as new sites.'}
              </Text>
            )}
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
                  label={`${l.site.code}: ${l.movedM === null ? `had no location – now ${where(l.lat, l.lng)}` : `moved ${away(l.movedM)}, to ${where(l.lat, l.lng)}`} · ${l.how === 'gps' ? `by GPS${l.acc ? ` ±${l.acc} m` : ''}` : l.how === 'photo' ? 'from its photos' : 'placed on the map'}`}
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
                  <Table.Th>{params.length ? 'Sampled' : 'Taken'}</Table.Th>
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
                  <Table.Tr key={`${r.site.id}-${r.from ?? ''}`}>
                    <Table.Td fw={600}>
                      {r.site.code}
                      {r.from ? (
                        <Text span size="xs" c="dimmed" fw={400}>
                          {' '}
                          (from {r.from})
                        </Text>
                      ) : null}
                    </Table.Td>
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
                        {[r.visit.weather, r.visit.flow && `flow ${r.visit.flow.toLowerCase()}`, r.visit.appearance, r.visit.notes, r.visit.photos?.length && `${r.visit.photos.length} photo${r.visit.photos.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
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
        {pics.length > 0 && (
          <Text size="sm">
            {pics.length} photo{pics.length === 1 ? '' : 's'}{smaller ? ' (made smaller to come by the flashing code – the phone’s job file has them full size)' : ', full size'}{located ? `, ${located === pics.length ? (pics.length === 1 ? '' : 'each ') : `${located} `}with where ${located === 1 ? 'it was' : 'they were'} taken` : ''} – saved to the shared folder (Field photos) and kept with the samples, ready for report figures.
          </Text>
        )}
        {projectPics > 0 && (
          <Text size="sm">
            {projectPics} photo{projectPics === 1 ? '' : 's'} kept with the project – no site: saved to the shared folder (Field photos/{data.project.code || data.project.name}), ready for report figures.
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
        {params.length > 0 && (
          <Text size="xs" c="dimmed">
            The readings join each site’s sample for the day; what was seen goes in its notes.
          </Text>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button leftSection={<IconPlus size={16} />} loading={busy} disabled={!rows.length && !chosenNew.size && !chosenLoc.size && !projectPics} onClick={() => void add()}>
            {rows.length ? `Add ${rows.length} site${rows.length === 1 ? '’s' : 's’'} ${rows.every((r) => !r.values.length) ? 'photos' : 'results'}${projectPics ? ' and the project’s photos' : ''}` : projectPics ? `Add ${projectPics} photo${projectPics === 1 ? '' : 's'} to the project` : 'Add'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

