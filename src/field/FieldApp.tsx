// Field mode, on a phone: open the field sheet made on the computer (a QR code, a link or a file), record each site's
// readings and what was seen – it all stays on the phone, with or without a signal – then send the results back as a
// file (to the team's OneDrive Inbox folder, or by email), for EnviroDB on the computer to add.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ActionIcon, Alert, Anchor, AppShell, Badge, Button, Card, Center, Chip, FileButton, Group, Loader, Modal, NumberInput, Progress, SegmentedControl, Select, Stack, Text, TextInput, Textarea, Title, UnstyledButton } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { HashRouter, Route, Routes, useLocation, useNavigate, useParams, useSearchParams, Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { IconArrowLeft, IconCheck, IconChevronRight, IconCloudOff, IconCurrentLocation, IconDeviceDesktop, IconFileZip, IconKey, IconList, IconLock, IconMap, IconMapPin, IconPencil, IconPlus, IconQrcode, IconSend, IconTrash, IconWifiOff, IconFileImport } from '@tabler/icons-react';
import { addFromCode, addSheet, addSite, addTeamKeys, deleteSheet, fieldDb, forgetTeamKeys, getPref, isJob, jobContents, knownProjects, nextPointCode, saveVisit, setPref, teamKeys, updateSite } from './db';
import { isSetupText, LockedError, readSetupText, showKeyId } from './lock';
import { currentPosition, LocationPicker, NavigateMenu, SheetMap, useMyPosition, type Placed, type SiteStatus } from './FieldMap';
import { APPEARANCE, checkSheet, decodeCode, decodeSheet, distanceM, fieldLinkPath, FLOW, newFieldSiteId, NOT_SAMPLED, readingWarning, unlockCode, unlockFile, unlockSheet, WEATHER, type FieldCodeFill, type FieldResults, type FieldSheet, type FieldSite, type FieldVisit } from './model';
import { AddReading, EditPointModal, NewJobModal, PhotoBadge, PhotoSection, photoSizeText, usePhotoCounts } from './JobParts';
import { jobFileName, jobZip, lockedJob, readyPhotos, withPhotoEntries } from './package';
import type { LinkPhoto } from './link/payload';
import { openCamera, scanVideo, stopCamera } from './link/scan';
import { keepOffline, type OfflineState } from './offline';
import { LinkPage } from './LinkPage';

const pad = (n: number) => String(n).padStart(2, '0');
const nowLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const showDate = (d?: string) => (d ? `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}${d.length > 10 ? `, ${d.slice(11, 16)}` : ''}` : '');

// the points added here that are still waiting for the GPS (each is saved with its location when it comes)
const awaitingFix = new Set<string>();
const awaitingSubs = new Set<() => void>();
const markLocating = (id: string, on: boolean) => {
  if (on) awaitingFix.add(id);
  else awaitingFix.delete(id);
  awaitingSubs.forEach((f) => f());
};
const useAwaitingFix = (id: string) =>
  useSyncExternalStore(
    (f) => {
      awaitingSubs.add(f);
      return () => void awaitingSubs.delete(f);
    },
    () => awaitingFix.has(id),
  );

function useOffline(): OfflineState {
  const [state, setState] = useState<OfflineState>('getting-ready');
  useEffect(() => {
    let live = true;
    // once the page has loaded everything it needs
    const go = () => void keepOffline().then((s) => live && setState(s));
    if (document.readyState === 'complete') setTimeout(go, 800);
    else window.addEventListener('load', () => setTimeout(go, 800), { once: true });
    return () => {
      live = false;
    };
  }, []);
  return state;
}

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

function Header({ title, back, right }: { title: string; back?: string; right?: React.ReactNode }) {
  const online = useOnline();
  return (
    <Group justify="space-between" wrap="nowrap" gap="xs" mb="md">
      <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
        {back && (
          <ActionIcon component={Link} to={back} variant="subtle" size="lg" aria-label="Back">
            <IconArrowLeft size={20} />
          </ActionIcon>
        )}
        <Title order={4} style={{ overflowWrap: 'anywhere' }}>
          {title}
        </Title>
      </Group>
      <Group gap={6} wrap="nowrap">
        {!online && (
          <Badge color="gray" leftSection={<IconWifiOff size={12} />} variant="light">
            Offline
          </Badge>
        )}
        {right}
      </Group>
    </Group>
  );
}

// ------------------------------------------------------------ the sheets on this phone

function Home({ offline }: { offline: OfflineState }) {
  const navigate = useNavigate();
  const sheets = useLiveQuery(() => fieldDb.sheets.orderBy('addedAt').reverse().toArray(), []);
  const visits = useLiveQuery(() => fieldDb.visits.toArray(), []);
  const photos = usePhotoCounts();
  const keys = useLiveQuery(() => teamKeys(), []);
  const [starting, setStarting] = useState(false);
  const openFile = async (f: File | null) => {
    if (!f) return;
    try {
      const { content, keyId } = await unlockFile(JSON.parse(await f.text()), await teamKeys());
      const sheet = checkSheet(content);
      await addSheet(sheet, keyId);
      navigate(`/field/s/${encodeURIComponent(sheet.id)}`);
    } catch (e) {
      const locked = e instanceof LockedError && e.reason === 'no-key';
      notifications.show({ color: 'red', title: locked ? 'This sheet is locked with your team’s key' : undefined, message: locked ? 'Set this phone up for the team first (Team key, below).' : (e as Error).message });
    }
  };
  return (
    <Stack gap="md">
      <Header title="EnviroDB field" />
      {offline === 'ready' ? (
        <Text size="xs" c="dimmed" mt={-8}>
          <IconCloudOff size={13} style={{ verticalAlign: -2 }} /> Works with no signal. Everything stays on this phone until you send it.
        </Text>
      ) : offline === 'unsupported' || offline === 'failed' ? (
        <Alert color="orange" variant="light" p="xs">
          <Text size="xs">This browser can’t keep EnviroDB for use with no signal – open jobs while you have one. Records still stay on this phone.</Text>
        </Alert>
      ) : null}
      <Button size="lg" leftSection={<IconPlus size={20} />} onClick={() => setStarting(true)}>
        New job
      </Button>
      <NewJobModal opened={starting} onClose={() => setStarting(false)} />
      {sheets === undefined ? (
        <Loader size="sm" />
      ) : sheets.length ? (
        sheets.map((s) => {
          const job = isJob(s.sheet);
          const mine = (visits ?? []).filter((v) => v.sheetId === s.id);
          const done = mine.filter((v) => v.visit.done || v.visit.notSampled).length;
          const pics = photos.get(s.id)?.n ?? 0;
          const status = job
            ? [`${s.sheet.sites.length} point${s.sheet.sites.length === 1 ? '' : 's'}`, pics ? `${pics} photo${pics === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ')
            : `${done} of ${s.sheet.sites.length} sites${pics ? ` · ${pics} photo${pics === 1 ? '' : 's'}` : ''}`;
          return (
            <Card key={s.id} withBorder padding="md" component={Link} to={`/field/s/${encodeURIComponent(s.id)}`} style={{ color: 'inherit', textDecoration: 'none' }}>
              <Group justify="space-between" wrap="nowrap">
                <div style={{ minWidth: 0 }}>
                  <Text fw={600}>{job ? s.sheet.round : s.sheet.project.name}</Text>
                  <Text size="sm" c="dimmed">
                    {job ? s.sheet.project.name || 'Project chosen on the computer' : s.sheet.round} · {showDate(s.sheet.date)}
                  </Text>
                  <Text size="xs" c={!job && done === s.sheet.sites.length ? 'teal' : 'dimmed'} mt={4}>
                    {status}
                    {s.sentAt ? ` · sent ${showDate(s.sentAt.slice(0, 10))}` : ''}
                  </Text>
                </div>
                <IconChevronRight size={20} />
              </Group>
            </Card>
          );
        })
      ) : (
        <Text size="sm" c="dimmed" ta="center" px="md">
          A job holds the photos, locations, readings and notes from a visit. Start one here – or scan a field sheet or a site’s printed code from the computer.
        </Text>
      )}
      <Group grow gap="xs">
        <ScanCodeButton size="sm" />
        <FileButton accept=".json,application/json" onChange={(f) => void openFile(f)}>
          {(props) => (
            <Button {...props} variant="default" size="sm" leftSection={<IconFileImport size={15} />}>
              Open a sheet file
            </Button>
          )}
        </FileButton>
      </Group>
      <Group justify="space-between" gap="xs">
        <Anchor size="xs" c="dimmed" href="./" onClick={(e) => (e.preventDefault(), (location.hash = '#/'), location.reload())}>
          Open the rest of EnviroDB (needs the team’s shared folder)
        </Anchor>
        <Anchor size="xs" c="dimmed" component={Link} to="/field/team">
          <IconKey size={12} style={{ verticalAlign: -1 }} /> {keys?.length ? `Team key ${showKeyId(keys[0].id)}` : 'Team key'}
        </Anchor>
      </Group>
    </Stack>
  );
}

/** Why a locked link, code or file didn't open – and setting up the phone, then trying again. */
function LockedNote({ error, what }: { error: Error; what: string }) {
  const location = useLocation();
  const navigate = useNavigate();
  const keys = useLiveQuery(() => teamKeys(), []);
  if (!(error instanceof LockedError)) return <Alert color="red">This {what} isn’t one EnviroDB can read: {error.message}</Alert>;
  if (error.reason === 'damaged') return <Alert color="red">This {what} didn’t open with the team key – it’s been changed or damaged. Make it again on the computer.</Alert>;
  const setUp = (keys ?? []).length > 0;
  return (
    <Alert color="orange" title={`This ${what} is locked with your team’s key`}>
      <Stack gap="xs">
        <Text size="sm">
          {setUp
            ? `This phone has a different key – the team has a newer one (${showKeyId(error.keyId)}), or the ${what} is another team’s. Set the phone up again from the computer.`
            : 'Only phones set up for the team can open it, and this one isn’t yet.'}
        </Text>
        <Text size="sm" c="dimmed">
          On the computer: Settings → Field codes: team key → Set up a phone. Then scan the key it shows – this {what} opens straight after.
        </Text>
        <Button leftSection={<IconKey size={16} />} onClick={() => navigate('/field/team', { state: { then: `${location.pathname}${location.search}` } })}>
          Set up this phone
        </Button>
      </Stack>
    </Alert>
  );
}

/** A sheet from a link (a scanned QR code): kept on the phone, then opened. Locked ones (`e=`) open with the team key. */
function OpenLink() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    const s = params.get('s');
    const e = params.get('e');
    if (!s && !e) return navigate('/field', { replace: true });
    void (async () => {
      try {
        const { sheet, keyId } = e ? await unlockSheet(e, await teamKeys()) : { sheet: await decodeSheet(s!), keyId: undefined };
        await addSheet(sheet, keyId);
        navigate(`/field/s/${encodeURIComponent(sheet.id)}`, { replace: true });
      } catch (err) {
        setError(err as Error);
      }
    })();
  }, [params]);
  return error ? (
    <Stack>
      <Header title="EnviroDB field" back="/field" />
      <LockedNote error={error} what="field sheet" />
    </Stack>
  ) : (
    <Center h={200}>
      <Loader />
    </Center>
  );
}

const todayLocal = () => nowLocal().slice(0, 10);

/** A printed code (a project's or a site's): its sites join today's sheet, and a site's code opens that site. */
function OpenCode() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    const k = params.get('k');
    const x = params.get('x');
    if (!k && !x) return navigate('/field', { replace: true });
    void (async () => {
      try {
        const { code, keyId } = x ? await unlockCode(x, await teamKeys()) : { code: await decodeCode(k!), keyId: undefined };
        const sheet = await addFromCode(code, todayLocal(), keyId);
        const at = `/field/s/${encodeURIComponent(sheet.id)}`;
        if (code.site) navigate(`${at}/${encodeURIComponent(code.site)}`, { replace: true, state: { scanned: code.fill } });
        else navigate(at, { replace: true });
      } catch (err) {
        setError(err as Error);
      }
    })();
  }, [params]);
  return error ? (
    <Stack>
      <Header title="EnviroDB field" back="/field" />
      <LockedNote error={error} what="code" />
    </Stack>
  ) : (
    <Center h={200}>
      <Loader />
    </Center>
  );
}

/** The team key from the code a computer shows: kept on this phone. */
async function takeTeamKey(text: string): Promise<boolean> {
  try {
    const keys = await readSetupText(text);
    await addTeamKeys(keys);
    notifications.show({ color: 'teal', title: 'This phone is set up for the team', message: `Team key ${showKeyId(keys[0].id)} – the same as the computer shows.` });
    return true;
  } catch (e) {
    notifications.show({ color: 'red', message: (e as Error).message });
    return false;
  }
}

/** Setting this phone up for the team: scanning the key a computer shows (Settings → Field codes: team key). */
function TeamPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const then = (location.state as { then?: string } | null)?.then;
  const keys = useLiveQuery(() => teamKeys(), []);
  const [scanning, setScanning] = useState<boolean | null>(null);
  const [removing, setRemoving] = useState(false);
  // not set up yet: straight to the camera
  useEffect(() => {
    if (keys && scanning === null) setScanning(keys.length === 0);
  }, [keys, scanning]);
  if (!keys) return <Loader />;
  return (
    <Stack gap="sm">
      <Header title="Team key" back="/field" />
      {keys.length ? (
        <Card withBorder padding="sm">
          <Group gap="xs" wrap="nowrap">
            <IconLock size={20} color="var(--mantine-color-teal-7)" />
            <div>
              <Text fw={600}>Set up for the team</Text>
              <Text size="sm" c="dimmed">
                Key {showKeyId(keys[0].id)}
                {keys.length > 1 ? ` (and ${keys.length - 1} older, for codes printed before it)` : ''}
              </Text>
            </div>
          </Group>
        </Card>
      ) : (
        <Text size="sm">
          If your team locks its field sheets and printed codes with a team key, they open only on phones set up with it. On the computer: <b>Settings → Field codes: team key → Set up a phone</b>, then scan the key it shows.
        </Text>
      )}
      {scanning ? (
        <Card withBorder padding="sm">
          <CodeScanner
            want="key"
            onKey={(text) =>
              void takeTeamKey(text).then((ok) => {
                if (!ok) return;
                setScanning(false);
                if (then) navigate(then, { replace: true });
              })
            }
          />
          <Button mt="xs" variant="default" fullWidth onClick={() => setScanning(false)}>
            Stop the camera
          </Button>
        </Card>
      ) : (
        <Button leftSection={<IconQrcode size={18} />} variant={keys.length ? 'default' : 'filled'} onClick={() => setScanning(true)}>
          {keys.length ? 'Scan a new team key' : 'Scan the team key'}
        </Button>
      )}
      {keys.length > 0 && (
        <Button variant="subtle" color="red" onClick={() => setRemoving(true)}>
          Remove the team key from this phone
        </Button>
      )}
      <Modal opened={removing} onClose={() => setRemoving(false)} title="Remove the team key from this phone?" centered>
        <Text size="sm" mb="md">
          Locked field sheets and codes won’t open on it until it’s set up again. What’s recorded on the phone stays.
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={() => setRemoving(false)}>
            Keep it
          </Button>
          <Button color="red" onClick={() => void forgetTeamKeys().then(() => setRemoving(false))}>
            Remove
          </Button>
        </Group>
      </Modal>
      <Text size="xs" c="dimmed">
        The key stays on this phone. With it, the phone opens the team’s locked field sheets and codes, and locks the results it sends back for them.
      </Text>
    </Stack>
  );
}

/** Scanning a printed field code (or a field sheet's code) from inside field mode, with the phone's camera. */
function ScanCodeButton({ size = 'md' }: { size?: 'md' | 'sm' }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  return (
    <>
      <Button variant="default" size={size} leftSection={<IconQrcode size={size === 'md' ? 18 : 15} />} onClick={() => setOpen(true)}>
        Scan a code
      </Button>
      <Modal opened={open} onClose={() => setOpen(false)} title="Scan a field code" centered>
        {open && (
          <CodeScanner
            onLink={(path) => {
              setOpen(false);
              navigate(path);
            }}
            onKey={(text) => {
              setOpen(false);
              void takeTeamKey(text);
            }}
          />
        )}
      </Modal>
    </>
  );
}

/**
 * The camera, reading codes until it finds a field link – or, `want: 'key'`, the team key (started once it's on
 * screen). The team key's code isn't a link, so a phone's own camera app never opens it as one.
 */
function CodeScanner({ want = 'link', onLink, onKey }: { want?: 'link' | 'key'; onLink?: (path: string) => void; onKey?: (text: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
  const [other, setOther] = useState(false);
  useEffect(() => {
    let stream: MediaStream | null = null;
    let stop = () => {};
    let done = false;
    void (async () => {
      try {
        stream = await openCamera('environment');
        const v = video.current;
        if (!v || done) return stopCamera(stream);
        v.srcObject = stream;
        await v.play();
        stop = scanVideo(v, () => {}, undefined, (text) => {
          if (done) return;
          if (isSetupText(text) && onKey) {
            done = true;
            return onKey(text);
          }
          const path = want === 'link' ? fieldLinkPath(text) : null;
          if (!path || !onLink) return setOther(true);
          done = true;
          onLink(path);
        });
      } catch (e) {
        if (!done) setError((e as Error).message);
      }
    })();
    return () => {
      done = true;
      stop();
      stopCamera(stream);
    };
  }, []);
  return error ? (
    <Alert color="red" variant="light">
      {error}
    </Alert>
  ) : (
    <Stack gap="xs">
      <video ref={video} muted playsInline style={{ width: '100%', borderRadius: 8, background: '#000' }} />
      <Text size="sm" c={other ? 'orange' : 'dimmed'}>
        {want === 'key'
          ? other
            ? 'That isn’t the team key – scan the code the computer shows under Set up a phone.'
            : 'Point the camera at the team key on the computer’s screen.'
          : other
            ? 'That code isn’t an EnviroDB field code – try the site’s or the project’s code.'
            : 'Point the camera at a project’s or a site’s printed code.'}
      </Text>
    </Stack>
  );
}

// ------------------------------------------------------------ a sheet: its sites

function SheetPage() {
  const { sheetId = '' } = useParams();
  const stored = useLiveQuery(async () => (await fieldDb.sheets.get(sheetId)) ?? null, [sheetId]);
  const visits = useLiveQuery(() => fieldDb.visits.where('sheetId').equals(sheetId).toArray(), [sheetId]);
  const projects = useLiveQuery(() => knownProjects(), []) ?? [];
  const photos = usePhotoCounts(sheetId);
  const navigate = useNavigate();
  const [removing, setRemoving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [atSite, setAtSite] = useState(false);
  // on a job, the GPS kept ready: a point added is placed where the phone is now
  const { me, error: gpsError } = useMyPosition(!!stored && isJob(stored.sheet));
  const [view, setView] = useState<'list' | 'map'>(() => {
    try {
      return sessionStorage.getItem('edb.field.view') === 'map' ? 'map' : 'list';
    } catch {
      return 'list';
    }
  });
  const show = (v: 'list' | 'map') => {
    setView(v);
    try {
      sessionStorage.setItem('edb.field.view', v);
    } catch {
      /* not remembered */
    }
  };
  if (stored === undefined || visits === undefined) return <Loader />;
  if (!stored) return <Navigate to="/field" />;
  const sheet = stored.sheet;
  const job = isJob(sheet);
  const byId = new Map(visits.map((v) => [v.visit.siteId, v.visit]));
  const done = sheet.sites.filter((s) => byId.get(s.id)?.done || byId.get(s.id)?.notSampled).length;
  const statusOf = (id: string): SiteStatus => {
    const v = byId.get(id);
    return v?.notSampled ? 'notSampled' : v?.done ? 'done' : (v && Object.keys(v.values).length) || photos.get(id) ? 'started' : 'todo';
  };
  const siteLink = (id: string) => `/field/s/${encodeURIComponent(sheet.id)}/${encodeURIComponent(id)}`;
  const changed = sheet.sites.some((s) => s.added || s.located) || photos.size > 0;
  // the project's sites this phone knows that aren't on the sheet yet
  const others = (projects.find((p) => p.project.id === sheet.project.id)?.sites ?? []).filter((s) => !sheet.sites.some((x) => x.id === s.id));
  /** A new point where the phone is: named P1, P2 … (renamed on its page), located as the GPS finds it. */
  const addPoint = async () => {
    setAdding(true);
    const site: FieldSite = { id: newFieldSiteId(), code: nextPointCode(sheet), type: 'Other', added: true, auto: true };
    await addSite(sheet.id, site);
    markLocating(site.id, true);
    navigate(siteLink(site.id));
    currentPosition(5000)
      .then(
        (p) => updateSite(sheet.id, site.id, { lat: p.lat, lng: p.lng, located: { at: new Date().toISOString(), how: 'gps', acc: p.acc } }),
        (e: Error) => void notifications.show({ color: 'orange', message: `${e.message} Set the point’s location on the map instead.` }),
      )
      .finally(() => markLocating(site.id, false));
    setAdding(false);
  };
  const total = [...photos.values()].reduce((n, p) => n + p.n, 0);
  return (
    <Stack gap="sm">
      <Header title={job ? sheet.round : sheet.project.name} back="/field" />
      <Text size="sm" c="dimmed" mt={-12}>
        {job ? sheet.project.name || 'Project chosen on the computer' : sheet.round} · {showDate(sheet.date)}
      </Text>
      {!job && <Progress value={(done / Math.max(1, sheet.sites.length)) * 100} color="teal" size="sm" />}
      {sheet.sites.length > 0 && (
        <Group justify="space-between">
          <Text size="xs" c="dimmed">
            {job ? `${sheet.sites.length} point${sheet.sites.length === 1 ? '' : 's'}${total ? ` · ${total} photo${total === 1 ? '' : 's'}` : ''}` : `${done} of ${sheet.sites.length} sites done`}
          </Text>
          <SegmentedControl
            size="xs"
            value={view}
            onChange={(v) => show(v as 'list' | 'map')}
            data={[
              { value: 'list', label: <Group gap={4} wrap="nowrap"><IconList size={14} /> List</Group> },
              { value: 'map', label: <Group gap={4} wrap="nowrap"><IconMap size={14} /> Map</Group> },
            ]}
          />
        </Group>
      )}
      {!sheet.sites.length && (
        <Text size="sm" c="dimmed">
          Add a point at each place you photograph or measure – it records where you are. Name it on its page if you like (or use a site’s code).
        </Text>
      )}
      {view === 'map' && sheet.sites.length > 0 && <SheetMap sites={sheet.sites} statusOf={statusOf} onOpen={(id) => navigate(siteLink(id))} />}
      {(view === 'list' || !sheet.sites.length) && sheet.sites.map((s) => {
        const v = byId.get(s.id);
        const pics = photos.get(s.id)?.n ?? 0;
        const status = v?.notSampled ? `Not sampled – ${v.notSampled}` : v?.done ? 'Done' : (v && Object.keys(v.values).length) || pics ? 'Started' : 'To do';
        return (
          <UnstyledButton key={s.id} component={Link} to={siteLink(s.id)} style={{ display: 'block' }}>
            <Card withBorder padding="sm">
              <Group justify="space-between" wrap="nowrap">
                <div style={{ minWidth: 0 }}>
                  <Text fw={700}>
                    {s.code}
                    {s.name ? (
                      <Text span fw={400} c="dimmed">
                        {' '}
                        {s.name}
                      </Text>
                    ) : null}
                  </Text>
                  {v && Object.keys(v.values).length > 0 && (
                    <Text size="xs" c="dimmed" lineClamp={1}>
                      {sheet.measures.filter((m) => v.values[m.id] !== undefined).map((m) => `${m.name.replace(/\s*\(field\)/i, '')} ${v.values[m.id]}`).join(' · ')}
                    </Text>
                  )}
                  {s.added && s.lat === undefined && (
                    <Text size="xs" c="orange">
                      No location yet
                    </Text>
                  )}
                </div>
                <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
                  <PhotoBadge n={pics} />
                  {s.added && !job && (
                    <Badge color="violet" variant="light">
                      New
                    </Badge>
                  )}
                  {/* a job's points: only once marked done (what's recorded shows on the card) */}
                  {(!job || status === 'Done') && (
                    <Badge color={status === 'Done' ? 'teal' : status.startsWith('Not') ? 'gray' : status === 'Started' ? 'yellow' : 'blue'} variant={status === 'To do' ? 'outline' : 'light'}>
                      {status.startsWith('Not') ? 'Not sampled' : status}
                    </Badge>
                  )}
                </Group>
              </Group>
            </Card>
          </UnstyledButton>
        );
      })}
      <Button size={job ? 'lg' : 'sm'} variant={job ? 'filled' : 'default'} leftSection={<IconCurrentLocation size={job ? 20 : 15} />} loading={adding} onClick={() => void addPoint()}>
        Add a point here
      </Button>
      {job && (
        <Text size="xs" c={gpsError ? 'orange' : 'dimmed'} ta="center" mt={-6}>
          {gpsError ? `${gpsError} Points can be placed on the map instead.` : me ? `Located to ±${me.acc ?? '?'} m` : 'Finding where you are…'}
        </Text>
      )}
      {(others.length > 0 || !job) && (
        <Group grow gap="xs">
          {others.length > 0 && (
            <Button variant="default" size="sm" leftSection={<IconMapPin size={15} />} onClick={() => setAtSite(true)}>
              At a project site…
            </Button>
          )}
          {!job && <ScanCodeButton size="sm" />}
        </Group>
      )}
      <AtSiteModal
        opened={atSite}
        sites={others}
        onClose={() => setAtSite(false)}
        onPick={(site) => {
          setAtSite(false);
          void addSite(sheet.id, site).then(() => navigate(siteLink(site.id)));
        }}
      />
      <Button size="md" mt="sm" color={job ? 'teal' : undefined} leftSection={<IconSend size={18} />} onClick={() => navigate(`/field/s/${encodeURIComponent(sheet.id)}/send`)} disabled={!visits.length && !changed}>
        {job ? 'Send the job' : 'Send the results'}
      </Button>
      <Button variant="subtle" color="red" size="xs" leftSection={<IconTrash size={14} />} onClick={() => setRemoving(true)}>
        {job ? 'Remove this job from the phone' : 'Remove this sheet from the phone'}
      </Button>
      <Modal opened={removing} onClose={() => setRemoving(false)} title={job ? 'Remove this job?' : 'Remove this sheet?'} centered>
        <Text size="sm" mb="md">
          {stored.sentAt ? 'It was sent.' : 'It hasn’t been sent yet – what’s recorded will be lost.'} It and everything recorded on it, photos included, are removed from this phone.
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={() => setRemoving(false)}>
            Keep it
          </Button>
          <Button color="red" onClick={() => void deleteSheet(sheet.id).then(() => navigate('/field'))}>
            Remove
          </Button>
        </Group>
      </Modal>
    </Stack>
  );
}

/** One of the project's sites (from the computer), the nearest first. */
function AtSiteModal({ opened, sites, onClose, onPick }: { opened: boolean; sites: FieldSite[]; onClose: () => void; onPick: (s: FieldSite) => void }) {
  const { me } = useMyPosition(opened);
  const list = useMemo(
    () =>
      sites
        .map((s) => ({ s, d: me && s.lat !== undefined && s.lng !== undefined ? distanceM(me, { lat: s.lat, lng: s.lng }) : null }))
        .sort((a, b) => (a.d ?? Infinity) - (b.d ?? Infinity) || a.s.code.localeCompare(b.s.code)),
    [sites, me],
  );
  return (
    <Modal opened={opened} onClose={onClose} title="At which site?" centered>
      <Stack gap={6}>
        {list.map(({ s, d }) => (
          <Button key={s.id} variant="default" justify="space-between" onClick={() => onPick(s)} rightSection={d !== null ? <Text size="xs" c="dimmed">{d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d)} m`}</Text> : undefined}>
            {s.code}
            {s.name ? ` – ${s.name}` : ''}
          </Button>
        ))}
      </Stack>
    </Modal>
  );
}

// ------------------------------------------------------------ a site: the readings

/** How far the phone was from the site's recorded place: a warning when it looks like the wrong site. */
function SiteDistance({ gps, site, code }: { gps: { lat: number; lng: number; acc?: number }; site: { lat: number; lng: number }; code: string }) {
  const d = distanceM(gps, site);
  const far = d > Math.max(150, 2 * (gps.acc ?? 0));
  const text = d >= 1000 ? `${(d / 1000).toFixed(d >= 10000 ? 0 : 1)} km` : `${Math.round(d)} m`;
  return far ? (
    <Alert color="orange" variant="light" p="xs">
      <Text size="sm">
        The phone is about {text} from {code}’s recorded location – is this the right site?
      </Text>
    </Alert>
  ) : (
    <Text size="xs" c="teal" mt={-6}>
      <IconCheck size={12} style={{ verticalAlign: -1 }} /> About {text} from {code}’s recorded location
    </Text>
  );
}

function SitePage() {
  const { sheetId = '', siteId = '' } = useParams();
  const stored = useLiveQuery(async () => (await fieldDb.sheets.get(sheetId)) ?? null, [sheetId]);
  // null: nothing recorded here yet (undefined: still looking)
  const saved = useLiveQuery(async () => (await fieldDb.visits.get(`${sheetId}|${siteId}`)) ?? null, [sheetId, siteId]);
  const navigate = useNavigate();
  const location = useLocation();
  const [v, setV] = useState<FieldVisit | null>(null);
  const [locating, setLocating] = useState(false);
  /** Opened by scanning the site's printed code: what it fills in, and what it did. */
  const [scanned, setScanned] = useState<{ fill: FieldCodeFill; did: string[] } | null>(null);
  const [placing, setPlacing] = useState(false);
  const [editing, setEditing] = useState(false);
  const finding = useAwaitingFix(siteId);
  // the site's record (a new one when there's none yet); the next site starts from its own
  useEffect(() => {
    if (saved === undefined || (saved && saved.visit.siteId !== siteId) || v?.siteId === siteId) return;
    // a new record starts from what the sheet filled in (a bore's stick-up and depth)
    const preset = stored?.sheet.sites.find((s) => s.id === siteId)?.preset;
    setV(saved?.visit ?? { siteId, values: { ...(preset ?? {}) } });
  }, [saved, siteId, stored]);
  // every change is kept on the phone at once
  const update = (patch: Partial<FieldVisit>) => {
    setV((cur) => {
      const next = { ...(cur ?? { siteId, values: {} }), ...patch };
      if (!next.time && (Object.keys(next.values).length || next.notes)) next.time = nowLocal();
      void saveVisit(sheetId, next);
      return next;
    });
  };
  const locate = () => {
    setLocating(true);
    currentPosition().then(
      (p) => {
        setLocating(false);
        update({ gps: p });
      },
      (e: Error) => {
        setLocating(false);
        notifications.show({ color: 'orange', message: e.message });
      },
    );
  };
  // a site's printed code, scanned here: the time and the location filled in (unless already recorded)
  const fill = (location.state as { scanned?: FieldCodeFill } | null)?.scanned;
  useEffect(() => {
    if (!fill || !v || v.siteId !== siteId) return;
    const did: string[] = [];
    if (fill.time && !v.time) {
      update({ time: nowLocal() });
      did.push('the time');
    }
    if (fill.gps && !v.gps) {
      locate();
      did.push('the location');
    }
    setScanned({ fill, did });
    navigate(location.pathname, { replace: true, state: null });
  }, [fill, v?.siteId]);
  if (stored === undefined || saved === undefined || !v || v.siteId !== siteId) return <Loader />;
  if (!stored) return <Navigate to="/field" />;
  const sheet = stored.sheet;
  const job = isJob(sheet);
  const site = sheet.sites.find((s) => s.id === siteId);
  if (!site) return <Navigate to={`/field/s/${encodeURIComponent(sheetId)}`} />;
  const idx = sheet.sites.indexOf(site);
  const next = sheet.sites[idx + 1];
  const back = `/field/s/${encodeURIComponent(sheetId)}`;
  /** The site's location, set here: kept on the phone, and sent to the computer with the results. */
  const place = async (p: Placed) => {
    await updateSite(sheetId, site.id, { lat: p.lat, lng: p.lng, located: { at: new Date().toISOString(), how: p.how, acc: p.acc } });
    notifications.show({ color: 'teal', message: `${site.code}’s location saved – it goes to the computer with the results.` });
  };
  const finish = () => {
    update({ done: true });
    navigate(next ? `${back}/${encodeURIComponent(next.id)}` : back);
  };
  return (
    <Stack gap="sm">
      <Header
        title={`${site.code}${site.name ? ` – ${site.name}` : ''}`}
        back={back}
        right={
          <Group gap={4} wrap="nowrap">
            {site.added && (
              <ActionIcon variant="subtle" size="lg" aria-label="Name this point" onClick={() => setEditing(true)}>
                <IconPencil size={18} />
              </ActionIcon>
            )}
            <Text size="xs" c="dimmed">
              {idx + 1}/{sheet.sites.length}
            </Text>
          </Group>
        }
      />
      {site.added && <EditPointModal opened={editing} sheet={sheet} site={site} onClose={() => setEditing(false)} />}
      <Card withBorder padding="xs">
        {site.note && (
          <Text size="sm" mb={6}>
            {site.note}
          </Text>
        )}
        {site.lat !== undefined && site.lng !== undefined ? (
          <Group gap="xs" wrap="wrap">
            <NavigateMenu lat={site.lat} lng={site.lng} label={site.code} size="xs" />
            <Button size="xs" variant="default" leftSection={<IconMapPin size={14} />} onClick={() => setPlacing(true)}>
              Move
            </Button>
            <Text size="xs" c="dimmed">
              {site.lat.toFixed(5)}, {site.lng.toFixed(5)}
              {site.located ? ' · set on this phone' : ''}
            </Text>
          </Group>
        ) : (
          <Group gap="xs" wrap="wrap">
            <Text size="sm" c="dimmed">
              {finding ? 'Finding where you are…' : 'No location yet.'}
            </Text>
            <Button size="xs" variant="default" leftSection={<IconMapPin size={14} />} onClick={() => setPlacing(true)}>
              Set the location
            </Button>
            {v.gps && (
              <Button size="xs" variant="light" onClick={() => void place({ lat: v.gps!.lat, lng: v.gps!.lng, acc: v.gps!.acc, how: 'gps' })}>
                Use the location recorded here
              </Button>
            )}
          </Group>
        )}
      </Card>
      <LocationPicker
        opened={placing}
        title={`Location of ${site.code}`}
        initial={site.lat !== undefined && site.lng !== undefined ? { lat: site.lat, lng: site.lng } : v.gps ?? null}
        others={sheet.sites.filter((x) => x.id !== site.id)}
        onClose={() => setPlacing(false)}
        onSave={(p) => {
          setPlacing(false);
          void place(p);
        }}
      />
      {scanned && (
        <Alert color="teal" variant="light" p="xs" icon={<IconQrcode size={16} />}>
          <Text size="sm">Scanned at {site.code}{scanned.did.length ? ` – ${scanned.did.join(' and ')} filled in` : ''}{locating ? ' (finding the location…)' : ''}.</Text>
        </Alert>
      )}
      {job && sheet.observe.photos && <PhotoSection sheetId={sheetId} site={site} onAdded={() => update({ time: v.time ?? nowLocal() })} />}
      {!site.added && (
        <Chip checked={!!v.notSampled} onChange={(on) => update({ notSampled: on ? NOT_SAMPLED[0] : undefined, done: on ? true : v.done })} color="gray">
          Not sampled
        </Chip>
      )}
      {v.notSampled ? (
        <SegmentedControl fullWidth data={[...NOT_SAMPLED]} value={NOT_SAMPLED.includes(v.notSampled as (typeof NOT_SAMPLED)[number]) ? v.notSampled : 'Other'} onChange={(x) => update({ notSampled: x })} />
      ) : (
        <>
          <Group gap="xs" align="flex-end" wrap="nowrap">
            <TextInput type="datetime-local" label={job ? 'Time' : 'Sampled at'} value={v.time ?? ''} onChange={(e) => update({ time: e.currentTarget.value || undefined })} style={{ flex: 1 }} size="md" />
            <Button variant="default" size="md" onClick={() => update({ time: nowLocal() })}>
              Now
            </Button>
          </Group>
          {sheet.measures.filter((m) => !site.measures || site.measures.includes(m.id)).map((m) => {
            const val = v.values[m.id];
            const last = site.last?.values[m.id];
            const warn = val !== undefined ? readingWarning(m, val, last) : null;
            return (
              <NumberInput
                key={m.id}
                size="md"
                label={`${m.name}${m.unit ? ` · ${m.unit}` : ''}`}
                description={[m.optional ? (site.preset?.[m.id] !== undefined ? 'Optional – from the bore’s details; change it if measured today' : 'Optional – if measured') : '', last !== undefined ? `Last time ${last}${site.last?.date ? ` (${showDate(site.last.date)})` : ''}` : ''].filter(Boolean).join(' · ') || undefined}
                error={warn ?? undefined}
                value={val ?? ''}
                inputMode="decimal"
                decimalScale={6}
                hideControls
                onChange={(x) => {
                  const values = { ...v.values };
                  if (x === '' || x === null || Number.isNaN(Number(x))) delete values[m.id];
                  else values[m.id] = Number(x);
                  update({ values });
                }}
              />
            );
          })}
          <AddReading sheet={sheet} />
          {sheet.observe.weather && <Select size="md" label="Weather" data={[...WEATHER]} value={v.weather ?? null} onChange={(x) => update({ weather: x ?? undefined })} clearable />}
          {sheet.observe.flow && <Select size="md" label="Flow" data={[...FLOW]} value={v.flow ?? null} onChange={(x) => update({ flow: x ?? undefined })} clearable />}
          {sheet.observe.appearance && <Select size="md" label="Appearance" data={[...APPEARANCE]} value={v.appearance ?? null} onChange={(x) => update({ appearance: x ?? undefined })} clearable />}
        </>
      )}
      <Textarea size="md" label="Notes" autosize minRows={2} value={v.notes ?? ''} onChange={(e) => update({ notes: e.currentTarget.value || undefined })} placeholder="Colour, odour, anything unusual" />
      {!site.added && <Group gap="xs">
        <Button variant="default" leftSection={<IconCurrentLocation size={16} />} loading={locating} onClick={locate}>
          {v.gps ? 'Record the location again' : 'Record the location'}
        </Button>
        {v.gps && (
          <Text size="xs" c="dimmed">
            {v.gps.lat}, {v.gps.lng}
            {v.gps.acc ? ` (±${v.gps.acc} m)` : ''}
          </Text>
        )}
      </Group>}
      {v.gps && site.lat !== undefined && site.lng !== undefined && <SiteDistance gps={v.gps} site={{ lat: site.lat, lng: site.lng }} code={site.code} />}
      {!job && sheet.observe.photos && <PhotoSection sheetId={sheetId} site={site} onAdded={() => update({ time: v.time ?? nowLocal() })} />}
      <Button size="lg" mt="sm" color="teal" leftSection={<IconCheck size={20} />} onClick={finish}>
        {v.done ? 'Done' : 'Done here'}
        {next ? ` – next: ${next.code}` : ''}
      </Button>
    </Stack>
  );
}

// ------------------------------------------------------------ sending the results

function SendPage() {
  const { sheetId = '' } = useParams();
  const navigate = useNavigate();
  const stored = useLiveQuery(async () => (await fieldDb.sheets.get(sheetId)) ?? null, [sheetId]);
  const visits = useLiveQuery(() => fieldDb.visits.where('sheetId').equals(sheetId).toArray(), [sheetId]);
  const photos = usePhotoCounts(sheetId);
  const [by, setBy] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => void getPref('name').then(setBy), []);
  if (stored === null) return <Navigate to="/field" />;
  if (!stored || !visits || by === null) return <Loader />;
  const sheet = stored.sheet;
  const job = isJob(sheet);
  const byId = new Map(visits.map((x) => [x.visit.siteId, x.visit]));
  const recorded = sheet.sites.filter((s) => byId.has(s.id) || photos.has(s.id));
  const missing = job ? [] : sheet.sites.filter((s) => !byId.get(s.id)?.done && !byId.get(s.id)?.notSampled);
  const pics = [...photos.values()].reduce((a, p) => ({ n: a.n + p.n, size: a.size + p.size }), { n: 0, size: 0 });
  const big = pics.size > 20 * 1024 * 1024;
  /** The job file: a zip with everything (photos full size), shared to OneDrive, Teams or email – or saved. */
  const saveFile = async () => {
    setSaving(true);
    try {
      await setPref('name', by);
      const c = await jobContents(sheet.id, by);
      if (!c) return;
      let bytes = await jobZip(c.sheet, c.results, c.photos);
      // a sheet that came locked goes back locked, with the same key
      const k = stored.lockedWith ? (await teamKeys()).find((x) => x.id === stored.lockedWith) : undefined;
      if (k) bytes = await lockedJob(bytes, k);
      const file = new File([bytes as BlobPart], jobFileName(sheet, !!k), { type: k ? 'application/octet-stream' : 'application/zip' });
      const share = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (share.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: file.name });
      else {
        const url = URL.createObjectURL(file);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      }
      await fieldDb.sheets.update(sheet.id, { sentAt: new Date().toISOString() });
      notifications.show({ color: 'teal', message: `Job file ready (${photoSizeText(file.size)}). Save it to the team’s Inbox folder in OneDrive – or send it to yourself and drop it on the computer’s Import page.` });
    } catch (e) {
      if ((e as Error).name !== 'AbortError') notifications.show({ color: 'red', message: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };
  return (
    <Stack gap="sm">
      <Header title={job ? 'Send the job' : 'Send the results'} back={`/field/s/${encodeURIComponent(sheet.id)}`} />
      <TextInput size="md" label="Recorded by" placeholder="Your name" value={by} onChange={(e) => setBy(e.currentTarget.value)} />
      <Card withBorder padding="sm">
        <Stack gap={2}>
          {(job ? recorded : sheet.sites).map((s) => {
            const v = byId.get(s.id);
            const n = photos.get(s.id)?.n ?? 0;
            const bits = [v && Object.keys(v.values).length ? `${Object.keys(v.values).length} reading${Object.keys(v.values).length === 1 ? '' : 's'}` : '', n ? `${n} photo${n === 1 ? '' : 's'}` : '', v?.notes ? 'notes' : ''].filter(Boolean);
            return (
              <Text size="sm" key={s.id}>
                <b>{s.code}</b>{' '}
                {v?.notSampled ? (
                  <Text span c="dimmed">
                    not sampled – {v.notSampled}
                  </Text>
                ) : bits.length ? (
                  `${bits.join(', ')}${!job && !v?.done ? ' (not marked done)' : ''}`
                ) : (
                  <Text span c="orange">
                    nothing recorded
                  </Text>
                )}
              </Text>
            );
          })}
          {pics.n > 0 && (
            <Text size="xs" c="dimmed" mt={4}>
              {pics.n} photo{pics.n === 1 ? '' : 's'} in all, {photoSizeText(pics.size)} – they go full size, each with where it was taken.
            </Text>
          )}
        </Stack>
      </Card>
      {missing.length > 0 && (
        <Alert color="orange" variant="light" p="xs">
          <Text size="sm">
            {missing.map((s) => s.code).join(', ')} {missing.length === 1 ? 'isn’t' : 'aren’t'} done yet. You can send what you have now and again later – the later one replaces it.
          </Text>
        </Alert>
      )}
      <Button size="lg" leftSection={<IconFileZip size={20} />} loading={saving} onClick={() => void saveFile()}>
        Save the job file
      </Button>
      <Text size="xs" c="dimmed">
        One file with everything – photos full size. Choose <b>OneDrive → the team’s Inbox folder</b> and EnviroDB on the computer picks it up there. Or send it in Teams{big ? '' : ' or by email'} and drop it on the computer’s <b>Import</b> page. Needs a signal.
        {big ? ' At this size it’s too big for most email.' : ''}
        {stored.lockedWith ? ` Locked with the team key${job ? '' : ', as the sheet came'}: only the team’s computers can open it.` : ''}
      </Text>
      <Button
        size="md"
        variant="default"
        leftSection={<IconDeviceDesktop size={18} />}
        onClick={() => {
          void setPref('name', by);
          navigate(`/field/s/${encodeURIComponent(sheet.id)}/link`);
        }}
      >
        Send straight to the computer
      </Button>
      <Text size="xs" c="dimmed">
        Next to the computer, on the same Wi-Fi: on the computer choose <b>Import data → Receive from a phone</b>, then scan its code. No signal needed. If the Wi-Fi keeps them apart, the results go as a flashing code (photos made smaller – save the job file as well for them full size).
      </Text>
      {stored.sentAt && (
        <Text size="xs" c="teal">
          Last sent {showDate(stored.sentAt.slice(0, 10))} {stored.sentAt.slice(11, 16)}.
        </Text>
      )}
    </Stack>
  );
}

function LinkRoute() {
  const { sheetId = '' } = useParams();
  const navigate = useNavigate();
  const stored = useLiveQuery(async () => (await fieldDb.sheets.get(sheetId)) ?? null, [sheetId]);
  const [ready, setReady] = useState<{ results: FieldResults; photos: LinkPhoto[] } | null>(null);
  useEffect(() => {
    // what's recorded now (later changes on this page don't alter what's being sent): photos full size, located
    if (!stored || ready) return;
    void (async () => {
      const c = await jobContents(sheetId, (await getPref('name')) ?? '');
      if (!c) return;
      const out = readyPhotos(c.photos);
      setReady({ results: withPhotoEntries(c.results, out), photos: out.map((p) => ({ siteId: p.siteId, name: p.name, type: p.type, bytes: p.bytes })) });
    })();
  }, [stored, ready, sheetId]);
  if (stored === null) return <Navigate to="/field" />;
  const back = `/field/s/${encodeURIComponent(sheetId)}/send`;
  return (
    <Stack gap="sm">
      <Header title="Send to the computer" back={back} />
      {ready ? <LinkPage results={ready.results} photos={ready.photos} onSent={() => void fieldDb.sheets.update(sheetId, { sentAt: new Date().toISOString() })} onCancel={() => navigate(back)} /> : <Loader />}
    </Stack>
  );
}

function Navigate({ to }: { to: string }) {
  const navigate = useNavigate();
  useEffect(() => navigate(to, { replace: true }), [to]);
  return null;
}

export default function FieldApp() {
  const offline = useOffline();
  return (
    <HashRouter>
      <AppShell padding="md">
        <AppShell.Main style={{ maxWidth: 560, margin: '0 auto' }}>
          <Routes>
            <Route path="/field" element={<Home offline={offline} />} />
            <Route path="/field/open" element={<OpenLink />} />
            <Route path="/field/code" element={<OpenCode />} />
            <Route path="/field/team" element={<TeamPage />} />
            <Route path="/field/s/:sheetId" element={<SheetPage />} />
            <Route path="/field/s/:sheetId/send" element={<SendPage />} />
            <Route path="/field/s/:sheetId/link" element={<LinkRoute />} />
            <Route path="/field/s/:sheetId/:siteId" element={<SitePage />} />
            <Route path="*" element={<Navigate to="/field" />} />
          </Routes>
        </AppShell.Main>
      </AppShell>
    </HashRouter>
  );
}

export type { FieldSheet };
