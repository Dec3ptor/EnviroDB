// Maps in field mode: the sheet's sites on a map with where you are, the way to each (in the phone's map app for
// directions), and placing a site – one from the computer, or a new one added here – by GPS or on the map. Map
// pictures need a signal; with none, the pins and your position still show on a plain background.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Card, Group, Menu, Modal, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCurrentLocation, IconFocus2, IconMapPin, IconNavigation, IconZoomScan } from '@tabler/icons-react';
import { SiteMap, type MapSite, type SiteMapHandle } from '../components/map/SiteMap';
import { wayTo, type FieldSite } from './model';

export type LatLngAcc = { lat: number; lng: number; acc?: number };

// the latest place the phone gave, shared: a map following you, and a button asking where you are, agree at once
let lastFix: (LatLngAcc & { t: number }) | null = null;
const fixOf = (p: GeolocationPosition): LatLngAcc => ({ lat: Number(p.coords.latitude.toFixed(6)), lng: Number(p.coords.longitude.toFixed(6)), acc: Math.round(p.coords.accuracy) });

/** Where the phone is now: the place it gave in the last 15 seconds, or a fresh one. */
export function currentPosition(): Promise<LatLngAcc> {
  if (lastFix && Date.now() - lastFix.t < 15000) return Promise.resolve(lastFix);
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('This phone can’t give its location here.'));
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const fix = fixOf(p);
        lastFix = { ...fix, t: Date.now() };
        resolve(fix);
      },
      () => reject(new Error('The location couldn’t be found (is location allowed for the browser?).')),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 10000 },
    );
  });
}

/** Where the phone is, followed while `on`. */
export function useMyPosition(on: boolean): { me: LatLngAcc | null; error: string } {
  const [me, setMe] = useState<LatLngAcc | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!on || !navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setError('');
        const fix = fixOf(p);
        lastFix = { ...fix, t: Date.now() };
        setMe(fix);
      },
      () => setError('Your location isn’t available – is location allowed for the browser?'),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [on]);
  return { me, error };
}

const isApple = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** Directions to a place in the phone's map app. */
export function NavigateMenu({ lat, lng, label, size = 'sm' }: { lat: number; lng: number; label: string; size?: 'xs' | 'sm' | 'md' }) {
  const at = `${lat},${lng}`;
  const google = `https://www.google.com/maps/dir/?api=1&destination=${at}`;
  const apple = `https://maps.apple.com/?daddr=${at}&q=${encodeURIComponent(label)}`;
  const other = `geo:${at}?q=${at}(${encodeURIComponent(label)})`;
  const items = isApple()
    ? [
        { href: apple, text: 'Apple Maps' },
        { href: google, text: 'Google Maps' },
      ]
    : [
        { href: google, text: 'Google Maps' },
        { href: other, text: 'Another map app' },
      ];
  return (
    <Menu position="bottom-start" withinPortal>
      <Menu.Target>
        <Button size={size} leftSection={<IconNavigation size={16} />}>
          Navigate
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>Directions to {label}</Menu.Label>
        {items.map((i) => (
          <Menu.Item key={i.text} component="a" href={i.href} target="_blank" rel="noreferrer">
            {i.text}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}

/** The colours of a site's pin, by how far along it is. */
export const STATUS_COLOURS = { todo: '#495057', started: '#f08c00', done: '#2b8a3e', notSampled: '#adb5bd' } as const;
export type SiteStatus = keyof typeof STATUS_COLOURS;
const STATUS_TEXT: Record<SiteStatus, string> = { todo: 'To do', started: 'Started', done: 'Done', notSampled: 'Not sampled' };

const placed = (s: FieldSite): s is FieldSite & { lat: number; lng: number } => s.lat !== undefined && s.lng !== undefined;

/** The sheet's sites on a map, with where you are; a site tapped shows how far it is and the way there. */
export function SheetMap({ sites, statusOf, onOpen }: { sites: FieldSite[]; statusOf: (id: string) => SiteStatus; onOpen: (id: string) => void }) {
  const { me, error } = useMyPosition(true);
  const map = useRef<SiteMapHandle>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const onMap = sites.filter(placed);
  const unplaced = sites.filter((s) => !placed(s));
  const pins: MapSite[] = onMap.map((s) => ({ id: s.id, code: s.code, name: s.name, color: STATUS_COLOURS[statusOf(s.id)], lat: s.lat, lng: s.lng }));
  const sel = onMap.find((s) => s.id === selected);
  // the first time where you are is known, with no site chosen: you and the sites in view
  const shown = useRef(false);
  useEffect(() => {
    if (!me || shown.current) return;
    shown.current = true;
    map.current?.fitPoints([...onMap, me]);
  }, [me]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Stack gap="xs">
      <div style={{ height: '58vh', minHeight: 320 }}>
        <SiteMap ref={map} sites={pins} selectedId={selected} me={me} line={me && sel ? [me, sel] : null} onSiteClick={setSelected} onMapClick={() => setSelected(null)} />
      </div>
      <Group gap="xs" justify="space-between">
        <Group gap={8}>
          {(Object.keys(STATUS_COLOURS) as SiteStatus[]).map((k) => (
            <Group key={k} gap={4} wrap="nowrap">
              <span style={{ width: 10, height: 10, borderRadius: 5, background: STATUS_COLOURS[k], display: 'inline-block' }} />
              <Text size="xs" c="dimmed">
                {STATUS_TEXT[k]}
              </Text>
            </Group>
          ))}
        </Group>
        <Group gap={6}>
          <Button size="xs" variant="default" leftSection={<IconZoomScan size={14} />} onClick={() => map.current?.fitPoints(me ? [...onMap, me] : onMap)} disabled={!onMap.length && !me}>
            All
          </Button>
          <Button size="xs" variant="default" leftSection={<IconFocus2 size={14} />} onClick={() => me && map.current?.flyTo(me.lat, me.lng, 17)} disabled={!me}>
            Me
          </Button>
        </Group>
      </Group>
      {error && (
        <Text size="xs" c="orange">
          {error}
        </Text>
      )}
      {sel ? (
        <Card withBorder padding="sm">
          <Group justify="space-between" wrap="nowrap" align="flex-start">
            <div style={{ minWidth: 0 }}>
              <Text fw={700}>
                {sel.code}
                {sel.name ? (
                  <Text span fw={400} c="dimmed">
                    {' '}
                    {sel.name}
                  </Text>
                ) : null}
              </Text>
              <Text size="sm" c="dimmed">
                {me ? `${wayTo(me, sel)} of you` : 'Finding where you are…'}
              </Text>
            </div>
            <Badge variant="light" color={statusOf(sel.id) === 'done' ? 'teal' : statusOf(sel.id) === 'started' ? 'yellow' : 'gray'} style={{ flexShrink: 0 }}>
              {STATUS_TEXT[statusOf(sel.id)]}
            </Badge>
          </Group>
          <Group gap="xs" mt="xs">
            <Button size="sm" variant="default" onClick={() => onOpen(sel.id)}>
              Open
            </Button>
            <NavigateMenu lat={sel.lat} lng={sel.lng} label={sel.code} />
          </Group>
        </Card>
      ) : (
        <Text size="xs" c="dimmed">
          Tap a site for how far it is and the way there.{navigator.onLine ? '' : ' No signal: the map pictures don’t show, but the sites and where you are do.'}
        </Text>
      )}
      {unplaced.length > 0 && (
        <Text size="xs" c="dimmed">
          No location yet: {unplaced.map((s) => s.code).join(', ')} – open {unplaced.length === 1 ? 'it' : 'one'} to set it.
        </Text>
      )}
    </Stack>
  );
}

export type Placed = { lat: number; lng: number; acc?: number; how: 'gps' | 'map' };

/**
 * Placing a site: tap the map (or drag the pin), or use where the phone is. The other sites show for reference.
 */
export function LocationPicker({ opened, title, initial, others, onSave, onClose }: { opened: boolean; title: string; initial?: { lat: number; lng: number } | null; others: FieldSite[]; onSave: (p: Placed) => void; onClose: () => void }) {
  const { me } = useMyPosition(opened);
  const [pick, setPick] = useState<Placed | null>(null);
  const map = useRef<SiteMapHandle>(null);
  useEffect(() => {
    if (opened) setPick(null);
  }, [opened]);
  const pins: MapSite[] = useMemo(() => others.filter(placed).map((s) => ({ id: s.id, code: s.code, name: s.name, color: '#868e96', lat: s.lat, lng: s.lng })), [others]);
  const point = pick ?? (initial ? { ...initial, how: 'map' as const } : null);
  // go to the site's place, or where you are once known
  const centred = useRef(false);
  useEffect(() => {
    if (!opened) {
      centred.current = false;
      return;
    }
    const t = window.setTimeout(() => {
      if (initial) {
        map.current?.flyTo(initial.lat, initial.lng, 17);
        centred.current = true;
      }
    }, 250);
    return () => window.clearTimeout(t);
  }, [opened]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!me || centred.current || !opened) return;
    centred.current = true;
    map.current?.flyTo(me.lat, me.lng, 17);
  }, [me, opened]);
  const useMine = () => {
    if (!me) return notifications.show({ color: 'orange', message: 'Your location isn’t known yet – wait a moment, or allow location for the browser.' });
    setPick({ ...me, how: 'gps' });
    map.current?.flyTo(me.lat, me.lng, 18);
  };
  return (
    <Modal opened={opened} onClose={onClose} title={title} fullScreen>
      <Stack gap="xs">
        <Text size="sm" c="dimmed">
          Tap the map where the site is, or use where you’re standing.
        </Text>
        <div style={{ height: '62vh', minHeight: 300 }}>
          {opened && <SiteMap ref={map} sites={pins} pick={point} picking me={me} onMapClick={(lat, lng) => setPick({ lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)), how: 'map' })} />}
        </div>
        <Group gap="xs">
          <Button variant="default" leftSection={<IconCurrentLocation size={16} />} onClick={useMine}>
            Use my location{me?.acc ? ` (±${me.acc} m)` : ''}
          </Button>
        </Group>
        <Text size="sm">
          <IconMapPin size={14} style={{ verticalAlign: -2 }} /> {point ? `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}${pick ? (pick.how === 'gps' ? ` · by GPS${pick.acc ? ` ±${pick.acc} m` : ''}` : ' · placed on the map') : ' · where it is now'}` : 'Not placed yet'}
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!pick} onClick={() => pick && onSave(pick)}>
            Save the location
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
