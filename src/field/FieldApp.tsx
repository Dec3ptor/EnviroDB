// Field mode, on a phone: open the field sheet made on the computer (a QR code, a link or a file), record each site's
// readings and what was seen – it all stays on the phone, with or without a signal – then send the results back as a
// file (to the team's OneDrive Inbox folder, or by email), for EnviroDB on the computer to add.

import { useEffect, useMemo, useRef, useState } from 'react';
import { ActionIcon, Alert, Anchor, AppShell, Badge, Button, Card, Center, Chip, FileButton, Group, Loader, Modal, NumberInput, Progress, SegmentedControl, Select, Stack, Text, TextInput, Textarea, Title, UnstyledButton } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { HashRouter, Route, Routes, useLocation, useNavigate, useParams, useSearchParams, Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { IconArrowLeft, IconCamera, IconCheck, IconChevronRight, IconCloudOff, IconCurrentLocation, IconDeviceDesktop, IconFileImport, IconList, IconMap, IconMapPin, IconPlus, IconQrcode, IconSend, IconTrash, IconWifiOff } from '@tabler/icons-react';
import { addFromCode, addSheet, addSite, deleteSheet, fieldDb, getPref, resultsFileName, resultsOf, saveVisit, setPref, updateSite } from './db';
import { currentPosition, LocationPicker, NavigateMenu, SheetMap, type Placed, type SiteStatus } from './FieldMap';
import { SITE_TYPES } from '../db/types';
import { APPEARANCE, checkSheet, decodeCode, decodeSheet, distanceM, fieldLinkPath, FLOW, newFieldSiteId, NOT_SAMPLED, readingWarning, WEATHER, type FieldCodeFill, type FieldSheet, type FieldSite, type FieldVisit } from './model';
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
  const openFile = async (f: File | null) => {
    if (!f) return;
    try {
      const sheet = checkSheet(JSON.parse(await f.text()));
      await addSheet(sheet);
      navigate(`/field/s/${encodeURIComponent(sheet.id)}`);
    } catch (e) {
      notifications.show({ color: 'red', message: (e as Error).message });
    }
  };
  return (
    <Stack gap="md">
      <Header title="EnviroDB field" />
      {offline === 'ready' ? (
        <Text size="xs" c="dimmed">
          <IconCloudOff size={13} style={{ verticalAlign: -2 }} /> Ready to work with no signal. Records stay on this phone until you send them.
        </Text>
      ) : offline === 'unsupported' || offline === 'failed' ? (
        <Alert color="orange" variant="light" p="xs">
          <Text size="xs">This browser can’t keep EnviroDB for use with no signal – open field sheets while you have one. Records still stay on this phone.</Text>
        </Alert>
      ) : null}
      {sheets === undefined ? (
        <Loader size="sm" />
      ) : sheets.length ? (
        sheets.map((s) => {
          const mine = (visits ?? []).filter((v) => v.sheetId === s.id);
          const done = mine.filter((v) => v.visit.done || v.visit.notSampled).length;
          return (
            <Card key={s.id} withBorder padding="md" component={Link} to={`/field/s/${encodeURIComponent(s.id)}`} style={{ color: 'inherit', textDecoration: 'none' }}>
              <Group justify="space-between" wrap="nowrap">
                <div style={{ minWidth: 0 }}>
                  <Text fw={600}>{s.sheet.project.name}</Text>
                  <Text size="sm" c="dimmed">
                    {s.sheet.round} · {showDate(s.sheet.date)}
                  </Text>
                  <Text size="xs" c={done === s.sheet.sites.length ? 'teal' : 'dimmed'} mt={4}>
                    {done} of {s.sheet.sites.length} sites{s.sentAt ? ` · sent ${showDate(s.sentAt.slice(0, 10))}` : ''}
                  </Text>
                </div>
                <IconChevronRight size={20} />
              </Group>
            </Card>
          );
        })
      ) : (
        <Card withBorder padding="lg">
          <Text fw={600} mb={4}>
            No field sheets on this phone yet
          </Text>
          <Text size="sm" c="dimmed">
            On the computer, open the project in EnviroDB and choose <b>Field sheet</b> (in the project’s ⋯ menu). Scan its QR code with this phone’s camera – or open the sheet’s file from OneDrive below. A project’s or a site’s <b>printed field code</b> works too.
          </Text>
        </Card>
      )}
      <ScanCodeButton />
      <FileButton accept=".json,application/json" onChange={(f) => void openFile(f)}>
        {(props) => (
          <Button {...props} variant="default" size="md" leftSection={<IconFileImport size={18} />}>
            Open a field sheet file
          </Button>
        )}
      </FileButton>
      <Anchor size="xs" c="dimmed" href="./" onClick={(e) => (e.preventDefault(), (location.hash = '#/'), location.reload())}>
        Open the rest of EnviroDB (needs the team’s shared folder)
      </Anchor>
    </Stack>
  );
}

/** A sheet from a link (a scanned QR code): kept on the phone, then opened. */
function OpenLink() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  useEffect(() => {
    const s = params.get('s');
    if (!s) return navigate('/field', { replace: true });
    decodeSheet(s).then(
      async (sheet) => {
        await addSheet(sheet);
        navigate(`/field/s/${encodeURIComponent(sheet.id)}`, { replace: true });
      },
      (e: Error) => setError(e.message),
    );
  }, []);
  return error ? (
    <Stack>
      <Header title="EnviroDB field" back="/field" />
      <Alert color="red">This link isn’t a field sheet EnviroDB can read: {error}</Alert>
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
  const [error, setError] = useState('');
  useEffect(() => {
    const k = params.get('k');
    if (!k) return navigate('/field', { replace: true });
    decodeCode(k).then(
      async (code) => {
        const sheet = await addFromCode(code, todayLocal());
        const at = `/field/s/${encodeURIComponent(sheet.id)}`;
        if (code.site) navigate(`${at}/${encodeURIComponent(code.site)}`, { replace: true, state: { scanned: code.fill } });
        else navigate(at, { replace: true });
      },
      (e: Error) => setError(e.message),
    );
  }, []);
  return error ? (
    <Stack>
      <Header title="EnviroDB field" back="/field" />
      <Alert color="red">This code isn’t one EnviroDB can read: {error}</Alert>
    </Stack>
  ) : (
    <Center h={200}>
      <Loader />
    </Center>
  );
}

/** Scanning a printed field code (or a field sheet's code) from inside field mode, with the phone's camera. */
function ScanCodeButton({ size = 'md' }: { size?: 'md' | 'sm' }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  return (
    <>
      <Button variant="default" size={size} leftSection={<IconQrcode size={size === 'md' ? 18 : 15} />} onClick={() => setOpen(true)}>
        Scan a printed code
      </Button>
      <Modal opened={open} onClose={() => setOpen(false)} title="Scan a field code" centered>
        {open && (
          <CodeScanner
            onLink={(path) => {
              setOpen(false);
              navigate(path);
            }}
          />
        )}
      </Modal>
    </>
  );
}

/** The camera, reading codes until it finds a field link (started once it's on screen). */
function CodeScanner({ onLink }: { onLink: (path: string) => void }) {
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
          const path = fieldLinkPath(text);
          if (!path) return setOther(true);
          if (done) return;
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
        {other ? 'That code isn’t an EnviroDB field code – try the site’s or the project’s code.' : 'Point the camera at a project’s or a site’s printed code.'}
      </Text>
    </Stack>
  );
}

// ------------------------------------------------------------ a sheet: its sites

/** Readings taken only in bores. */
const BORE_ONLY = /^(swl|gw-level|water-level-bgl)$/;

/** A new monitoring point, added on the phone: it goes back to the computer with the results. */
function AddSiteModal({ opened, sheet, onClose, onAdded }: { opened: boolean; sheet: FieldSheet; onClose: () => void; onAdded: (id: string) => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<string>('Surface water');
  const [note, setNote] = useState('');
  const [place, setPlace] = useState<Placed | null>(null);
  const [picking, setPicking] = useState(false);
  const [locating, setLocating] = useState(false);
  useEffect(() => {
    if (!opened) return;
    setCode('');
    setName('');
    setNote('');
    setPlace(null);
    // the kind most of the sheet's sites are, to start with
    const kinds = sheet.sites.map((s) => s.type).filter(Boolean) as string[];
    setType(kinds[0] ?? 'Surface water');
  }, [opened]);
  const taken = sheet.sites.some((s) => s.code.trim().toLowerCase() === code.trim().toLowerCase());
  const here = () => {
    setLocating(true);
    currentPosition().then(
      (p) => {
        setLocating(false);
        setPlace({ ...p, how: 'gps' });
      },
      (e: Error) => {
        setLocating(false);
        notifications.show({ color: 'orange', message: e.message });
      },
    );
  };
  const save = async () => {
    // a bore's readings (water level) aren't asked for at a stream, and the other way round
    const own = sheet.measures.filter((m) => type === 'Groundwater' || !BORE_ONLY.test(m.id)).map((m) => m.id);
    const site: FieldSite = {
      id: newFieldSiteId(),
      code: code.trim(),
      name: name.trim() || undefined,
      type,
      note: note.trim() || undefined,
      ...(own.length < sheet.measures.length ? { measures: own } : {}),
      added: true,
      ...(place ? { lat: place.lat, lng: place.lng, located: { at: new Date().toISOString(), how: place.how, acc: place.acc } } : {}),
    };
    await addSite(sheet.id, site);
    onAdded(site.id);
  };
  return (
    <Modal opened={opened} onClose={onClose} title="Add a monitoring point" centered>
      <Stack gap="sm">
        <TextInput size="md" label="Site code" placeholder="e.g. SW4" value={code} onChange={(e) => setCode(e.currentTarget.value)} error={taken ? 'The sheet already has a site with this code' : undefined} data-autofocus />
        <TextInput size="md" label="Name" placeholder="e.g. Kōwhai Stream at the ford" value={name} onChange={(e) => setName(e.currentTarget.value)} />
        <Select size="md" label="Kind" data={SITE_TYPES.filter((t) => t !== 'Quality control')} value={type} onChange={(x) => x && setType(x)} allowDeselect={false} />
        <Textarea size="md" label="Directions and notes" autosize minRows={2} placeholder="How to get there, what to watch for" value={note} onChange={(e) => setNote(e.currentTarget.value)} />
        <div>
          <Text size="sm" fw={500} mb={4}>
            Location
          </Text>
          <Group gap="xs">
            <Button variant="default" leftSection={<IconCurrentLocation size={16} />} loading={locating} onClick={here}>
              Where I am
            </Button>
            <Button variant="default" leftSection={<IconMap size={16} />} onClick={() => setPicking(true)}>
              On the map
            </Button>
          </Group>
          <Text size="xs" c="dimmed" mt={4}>
            {place ? `${place.lat.toFixed(5)}, ${place.lng.toFixed(5)} · ${place.how === 'gps' ? `by GPS${place.acc ? ` ±${place.acc} m` : ''}` : 'placed on the map'}` : 'Not set yet – it can be set later, from the site.'}
          </Text>
        </div>
        <Text size="xs" c="dimmed">
          The new site goes to the computer with the results, to be added to the project there.
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!code.trim() || taken} onClick={() => void save()}>
            Add the site
          </Button>
        </Group>
      </Stack>
      <LocationPicker
        opened={picking}
        title={`Location of ${code.trim() || 'the new site'}`}
        initial={place}
        others={sheet.sites}
        onClose={() => setPicking(false)}
        onSave={(p) => {
          setPlace(p);
          setPicking(false);
        }}
      />
    </Modal>
  );
}

function SheetPage() {
  const { sheetId = '' } = useParams();
  const stored = useLiveQuery(async () => (await fieldDb.sheets.get(sheetId)) ?? null, [sheetId]);
  const visits = useLiveQuery(() => fieldDb.visits.where('sheetId').equals(sheetId).toArray(), [sheetId]);
  const navigate = useNavigate();
  const [removing, setRemoving] = useState(false);
  const [adding, setAdding] = useState(false);
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
  const byId = new Map(visits.map((v) => [v.visit.siteId, v.visit]));
  const done = sheet.sites.filter((s) => byId.get(s.id)?.done || byId.get(s.id)?.notSampled).length;
  const statusOf = (id: string): SiteStatus => {
    const v = byId.get(id);
    return v?.notSampled ? 'notSampled' : v?.done ? 'done' : v && Object.keys(v.values).length ? 'started' : 'todo';
  };
  const siteLink = (id: string) => `/field/s/${encodeURIComponent(sheet.id)}/${encodeURIComponent(id)}`;
  const changed = sheet.sites.some((s) => s.added || s.located);
  return (
    <Stack gap="sm">
      <Header title={sheet.project.name} back="/field" />
      <Text size="sm" c="dimmed" mt={-12}>
        {sheet.round} · {showDate(sheet.date)}
      </Text>
      <Progress value={(done / Math.max(1, sheet.sites.length)) * 100} color="teal" size="sm" />
      <Group justify="space-between">
        <Text size="xs" c="dimmed">
          {done} of {sheet.sites.length} sites done
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
      {view === 'map' && <SheetMap sites={sheet.sites} statusOf={statusOf} onOpen={(id) => navigate(siteLink(id))} />}
      {view === 'list' && sheet.sites.map((s) => {
        const v = byId.get(s.id);
        const status = v?.notSampled ? `Not sampled – ${v.notSampled}` : v?.done ? 'Done' : v && Object.keys(v.values).length ? 'Started' : 'To do';
        return (
          <UnstyledButton key={s.id} component={Link} to={`/field/s/${encodeURIComponent(sheet.id)}/${encodeURIComponent(s.id)}`} style={{ display: 'block' }}>
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
                </div>
                <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
                  {s.added && (
                    <Badge color="violet" variant="light">
                      New
                    </Badge>
                  )}
                  <Badge color={status === 'Done' ? 'teal' : status.startsWith('Not') ? 'gray' : status === 'Started' ? 'yellow' : 'blue'} variant={status === 'To do' ? 'outline' : 'light'}>
                    {status.startsWith('Not') ? 'Not sampled' : status}
                  </Badge>
                </Group>
              </Group>
            </Card>
          </UnstyledButton>
        );
      })}
      <Stack gap="xs">
        <Button variant="default" size="sm" leftSection={<IconPlus size={15} />} onClick={() => setAdding(true)}>
          Add a monitoring point
        </Button>
        <ScanCodeButton size="sm" />
      </Stack>
      <AddSiteModal
        opened={adding}
        sheet={sheet}
        onClose={() => setAdding(false)}
        onAdded={(id) => {
          setAdding(false);
          navigate(siteLink(id));
        }}
      />
      <Button size="md" mt="sm" leftSection={<IconSend size={18} />} onClick={() => navigate(`/field/s/${encodeURIComponent(sheet.id)}/send`)} disabled={!visits.length && !changed}>
        Send the results
      </Button>
      <Button variant="subtle" color="red" size="xs" leftSection={<IconTrash size={14} />} onClick={() => setRemoving(true)}>
        Remove this sheet from the phone
      </Button>
      <Modal opened={removing} onClose={() => setRemoving(false)} title="Remove this sheet?" centered>
        <Text size="sm" mb="md">
          {stored.sentAt ? 'Its results were sent.' : 'Its results haven’t been sent yet – they’ll be lost.'} The sheet and what was recorded are removed from this phone.
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

// ------------------------------------------------------------ a site: the readings

function readPhoto(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * k);
      c.height = Math.round(img.naturalHeight * k);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.78));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That photo couldn’t be read.'));
    };
    img.src = url;
  });
}

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
  // the site's record (a new one when there's none yet); the next site starts from its own
  useEffect(() => {
    if (saved === undefined || (saved && saved.visit.siteId !== siteId) || v?.siteId === siteId) return;
    setV(saved?.visit ?? { siteId, values: {} });
  }, [saved, siteId]);
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
      <Header title={`${site.code}${site.name ? ` – ${site.name}` : ''}`} back={back} right={<Text size="xs" c="dimmed">{idx + 1}/{sheet.sites.length}</Text>} />
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
              No location yet.
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
      <Chip checked={!!v.notSampled} onChange={(on) => update({ notSampled: on ? NOT_SAMPLED[0] : undefined, done: on ? true : v.done })} color="gray">
        Not sampled
      </Chip>
      {v.notSampled ? (
        <SegmentedControl fullWidth data={[...NOT_SAMPLED]} value={NOT_SAMPLED.includes(v.notSampled as (typeof NOT_SAMPLED)[number]) ? v.notSampled : 'Other'} onChange={(x) => update({ notSampled: x })} />
      ) : (
        <>
          <Group gap="xs" align="flex-end" wrap="nowrap">
            <TextInput type="datetime-local" label="Sampled at" value={v.time ?? ''} onChange={(e) => update({ time: e.currentTarget.value || undefined })} style={{ flex: 1 }} size="md" />
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
                description={last !== undefined ? `Last time ${last}${site.last?.date ? ` (${showDate(site.last.date)})` : ''}` : undefined}
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
          {sheet.observe.weather && <Select size="md" label="Weather" data={[...WEATHER]} value={v.weather ?? null} onChange={(x) => update({ weather: x ?? undefined })} clearable />}
          {sheet.observe.flow && <Select size="md" label="Flow" data={[...FLOW]} value={v.flow ?? null} onChange={(x) => update({ flow: x ?? undefined })} clearable />}
          {sheet.observe.appearance && <Select size="md" label="Appearance" data={[...APPEARANCE]} value={v.appearance ?? null} onChange={(x) => update({ appearance: x ?? undefined })} clearable />}
        </>
      )}
      <Textarea size="md" label="Notes" autosize minRows={2} value={v.notes ?? ''} onChange={(e) => update({ notes: e.currentTarget.value || undefined })} placeholder="Colour, odour, anything unusual" />
      <Group gap="xs">
        <Button variant="default" leftSection={<IconCurrentLocation size={16} />} loading={locating} onClick={locate}>
          {v.gps ? 'Record the location again' : 'Record the location'}
        </Button>
        {v.gps && (
          <Text size="xs" c="dimmed">
            {v.gps.lat}, {v.gps.lng}
            {v.gps.acc ? ` (±${v.gps.acc} m)` : ''}
          </Text>
        )}
      </Group>
      {v.gps && site.lat !== undefined && site.lng !== undefined && <SiteDistance gps={v.gps} site={{ lat: site.lat, lng: site.lng }} code={site.code} />}
      {sheet.observe.photos && (
        <div>
          <FileButton
            accept="image/*"
            capture="environment"
            onChange={async (f) => {
              if (!f) return;
              try {
                const dataUrl = await readPhoto(f);
                update({ photos: [...(v.photos ?? []), { name: `${site.code} ${(v.photos?.length ?? 0) + 1}.jpg`, dataUrl }] });
              } catch (e) {
                notifications.show({ color: 'red', message: (e as Error).message });
              }
            }}
          >
            {(props) => (
              <Button {...props} variant="default" leftSection={<IconCamera size={16} />}>
                Take a photo
              </Button>
            )}
          </FileButton>
          {!!v.photos?.length && (
            <Group gap={6} mt={6}>
              {v.photos.map((p, i) => (
                <div key={i} style={{ position: 'relative' }}>
                  <img src={p.dataUrl} alt={p.name} style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 6 }} />
                  <ActionIcon size="xs" color="red" variant="filled" style={{ position: 'absolute', top: 2, right: 2 }} aria-label="Remove photo" onClick={() => update({ photos: v.photos!.filter((_, j) => j !== i) })}>
                    <IconTrash size={10} />
                  </ActionIcon>
                </div>
              ))}
            </Group>
          )}
        </div>
      )}
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
  const [by, setBy] = useState<string | null>(null);
  useEffect(() => void getPref('name').then(setBy), []);
  const results = useMemo(() => (stored && visits ? resultsOf(stored.sheet, visits.map((x) => x.visit), by ?? '') : null), [stored, visits, by]);
  if (stored === null) return <Navigate to="/field" />;
  if (!stored || !visits || by === null || !results) return <Loader />;
  const sheet = stored.sheet;
  const missing = sheet.sites.filter((s) => !results.visits.some((v) => v.siteId === s.id && (v.done || v.notSampled)));
  const send = async () => {
    await setPref('name', by);
    const text = JSON.stringify(results);
    const file = new File([text], resultsFileName(sheet), { type: 'application/json' });
    const share = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    try {
      if (share.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: file.name });
      else {
        const url = URL.createObjectURL(file);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 3000);
      }
      await fieldDb.sheets.update(sheet.id, { sentAt: new Date().toISOString() });
      notifications.show({ color: 'teal', message: 'Results ready – save them to the team’s Inbox folder in OneDrive (or email them to yourself).' });
    } catch (e) {
      if ((e as Error).name !== 'AbortError') notifications.show({ color: 'red', message: (e as Error).message });
    }
  };
  return (
    <Stack gap="sm">
      <Header title="Send the results" back={`/field/s/${encodeURIComponent(sheet.id)}`} />
      <TextInput size="md" label="Sampled by" placeholder="Your name" value={by} onChange={(e) => setBy(e.currentTarget.value)} />
      <Card withBorder padding="sm">
        {sheet.sites.map((s) => {
          const v = results.visits.find((x) => x.siteId === s.id);
          return (
            <Text size="sm" key={s.id}>
              <b>{s.code}</b>{' '}
              {!v ? (
                <Text span c="orange">
                  nothing recorded
                </Text>
              ) : v.notSampled ? (
                <Text span c="dimmed">
                  not sampled – {v.notSampled}
                </Text>
              ) : (
                `${Object.keys(v.values).length} readings${v.photos?.length ? `, ${v.photos.length} photos` : ''}${v.done ? '' : ' (not marked done)'}`
              )}
            </Text>
          );
        })}
      </Card>
      {(results.newSites?.length || results.located?.length) && (
        <Card withBorder padding="sm">
          {results.newSites?.map((n) => (
            <Text size="sm" key={n.id}>
              <b>{n.code}</b> new monitoring point{n.lat !== undefined ? '' : ' (no location yet)'}
            </Text>
          ))}
          {results.located?.map((l) => (
            <Text size="sm" key={l.siteId}>
              <b>{sheet.sites.find((x) => x.id === l.siteId)?.code ?? '?'}</b> location set {l.how === 'gps' ? `by GPS${l.acc ? ` (±${l.acc} m)` : ''}` : 'on the map'}
            </Text>
          ))}
        </Card>
      ) || null}
      {missing.length > 0 && (
        <Alert color="orange" variant="light" p="xs">
          <Text size="sm">
            {missing.map((s) => s.code).join(', ')} {missing.length === 1 ? 'isn’t' : 'aren’t'} done yet. You can send what you have now and again later – the later file replaces it.
          </Text>
        </Alert>
      )}
      <Button
        size="lg"
        leftSection={<IconDeviceDesktop size={20} />}
        onClick={() => {
          void setPref('name', by);
          navigate(`/field/s/${encodeURIComponent(sheet.id)}/link`);
        }}
      >
        Send to the computer
      </Button>
      <Text size="xs" c="dimmed">
        At the computer: scan the code it shows, then hold this phone up to its camera. No signal or file needed – over Wi-Fi when the two can connect, otherwise as a flashing code.
      </Text>
      <Button size="md" variant="default" leftSection={<IconSend size={18} />} onClick={() => void send()}>
        Send as a file instead
      </Button>
      <Text size="xs" c="dimmed">
        Choose OneDrive and the team’s <b>Inbox</b> folder (EnviroDB on the computer picks it up there), or email it to yourself and drop it on the Import page. Needs a signal; the records stay on this phone until you remove the
        sheet.
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
  const [ready, setReady] = useState<ReturnType<typeof resultsOf> | null>(null);
  useEffect(() => {
    // the results as they are now (later changes on this page don't alter what's being sent)
    if (!stored || ready) return;
    void (async () => {
      const visits = await fieldDb.visits.where('sheetId').equals(sheetId).toArray();
      setReady(resultsOf(stored.sheet, visits.map((x) => x.visit), (await getPref('name')) ?? ''));
    })();
  }, [stored, ready, sheetId]);
  if (stored === null) return <Navigate to="/field" />;
  const back = `/field/s/${encodeURIComponent(sheetId)}/send`;
  return (
    <Stack gap="sm">
      <Header title="Send to the computer" back={back} />
      {ready ? <LinkPage results={ready} onSent={() => void fieldDb.sheets.update(sheetId, { sentAt: new Date().toISOString() })} onCancel={() => navigate(back)} /> : <Loader />}
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
