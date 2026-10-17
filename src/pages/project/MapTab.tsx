// The project's map: put each monitoring site where it is – pick a site and click the map, click the map and choose
// the site (or make a new one there), drag a pin to move it, or type coordinates. Locations are kept as NZTM.

import { useEffect, useMemo, useRef, useState } from 'react';
import { ActionIcon, Anchor, Badge, Button, Card, CloseButton, Grid, Group, Menu, Modal, Paper, ScrollArea, Select, SimpleGrid, Stack, Switch, Text, TextInput, Tooltip, UnstyledButton } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { Link } from 'react-router-dom';
import { IconCurrentLocation, IconDownload, IconFocus2, IconMapPin, IconMapPinOff, IconPlus, IconSearch } from '@tabler/icons-react';
import { useProject } from '../../hooks/useProjectData';
import { newSite, saveSite } from '../../db/repo';
import type { Site } from '../../db/types';
import { SITE_ROLES, SITE_TYPES } from '../../db/types';
import { formatLatLng, parseCoordinates, roundedNztm, siteLatLng } from '../../lib/nztm';
import { sitesGeoJson, sitesKml } from '../../lib/sitesGeo';
import { downloadBlob, safeFileName } from '../../db/backup';
import { SiteMap, type MapSite, type SiteMapHandle } from '../../components/map/SiteMap';

type Pick = { lat: number; lng: number; easting: number; northing: number };
type Place = { name: string; detail: string; lat: number; lng: number; box?: [number, number, number, number] };

const nztmText = (s: { easting?: number; northing?: number }) => `NZTM ${s.easting} E, ${s.northing} N`;
const label = (s: Site) => (s.name ? `${s.code} – ${s.name}` : s.code);

export function MapTab() {
  const { project, sites, siteColor } = useProject();
  const map = useRef<SiteMapHandle>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [placingId, setPlacingId] = useState<string | null>(null);
  const [pick, setPick] = useState<Pick | null>(null);
  const [pickSiteId, setPickSiteId] = useState<string | null>(null);
  const [drag, setDrag] = useState(true);
  const [query, setQuery] = useState('');
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchNote, setSearchNote] = useState('');
  const [making, setMaking] = useState(false);

  const located = useMemo(
    () =>
      sites.flatMap((s): MapSite[] => {
        const p = siteLatLng(s);
        return p ? [{ id: s.id, code: s.code, name: s.name, color: siteColor(s.id), ...p }] : [];
      }),
    [sites, siteColor],
  );
  const onMap = new Set(located.map((s) => s.id));
  const placing = placingId ? sites.find((s) => s.id === placingId) : undefined;
  const selected = selectedId ? sites.find((s) => s.id === selectedId) : undefined;

  // Esc stops placing
  useEffect(() => {
    if (!placingId) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPlacingId(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [placingId]);

  /** Put a site at a point, with an Undo in the notice. */
  const place = async (site: Site, lat: number, lng: number) => {
    const at = roundedNztm(lat, lng);
    const next = { ...site, ...at };
    await saveSite(next, site);
    setPlacingId(null);
    setPick(null);
    setSelectedId(site.id);
    const had = site.easting !== undefined && site.northing !== undefined;
    const id = `map-${site.id}-${Date.now()}`;
    notifications.show({
      id,
      title: `${site.code} ${had ? 'moved' : 'placed on the map'}`,
      message: (
        <Group gap="xs" justify="space-between" wrap="nowrap">
          <Text size="sm">{nztmText(at)}</Text>
          <Anchor
            component="button"
            size="sm"
            onClick={async () => {
              await saveSite({ ...next, easting: site.easting, northing: site.northing }, next);
              notifications.hide(id);
            }}
          >
            Undo
          </Anchor>
        </Group>
      ),
      autoClose: 8000,
    });
  };

  const removeLocation = async (site: Site) => {
    const next = { ...site, easting: undefined, northing: undefined };
    await saveSite(next, site);
    const id = `map-off-${site.id}-${Date.now()}`;
    notifications.show({
      id,
      title: `${site.code} taken off the map`,
      message: (
        <Anchor
          component="button"
          size="sm"
          onClick={async () => {
            await saveSite({ ...next, easting: site.easting, northing: site.northing }, next);
            notifications.hide(id);
          }}
        >
          Undo
        </Anchor>
      ),
      autoClose: 8000,
    });
  };

  const pickPoint = (lat: number, lng: number) => {
    setPick({ lat, lng, ...roundedNztm(lat, lng) });
    // the site most likely meant: the one selected, else the first not on the map yet
    setPickSiteId(selectedId ?? sites.find((s) => !onMap.has(s.id))?.id ?? null);
  };

  const onMapClick = (lat: number, lng: number) => {
    if (placing) void place(placing, lat, lng);
    else pickPoint(lat, lng);
  };

  const select = (s: Site) => {
    setSelectedId(s.id);
    const p = siteLatLng(s);
    if (p) map.current?.flyTo(p.lat, p.lng);
  };

  const search = async () => {
    const q = query.trim();
    setPlaces(null);
    setSearchNote('');
    if (!q) return;
    const c = parseCoordinates(q);
    if (c) {
      pickPoint(c.lat, c.lng);
      map.current?.flyTo(c.lat, c.lng, 16);
      return;
    }
    setSearching(true);
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=nz&limit=6&accept-language=en&q=${encodeURIComponent(q)}`);
      const found = (await res.json()) as Array<{ display_name: string; lat: string; lon: string; boundingbox?: string[] }>;
      const list = found.map((p): Place => {
        const [name, ...rest] = p.display_name.split(', ');
        const b = p.boundingbox?.map(Number);
        return { name, detail: rest.slice(0, 3).join(', '), lat: Number(p.lat), lng: Number(p.lon), box: b && b.length === 4 ? [b[0], b[2], b[1], b[3]] : undefined };
      });
      setPlaces(list);
      if (!list.length) setSearchNote(`No places found for “${q}”.`);
    } catch {
      setSearchNote('Place search is unavailable right now (it needs the internet). Coordinates still work.');
    } finally {
      setSearching(false);
    }
  };

  const download = (kind: 'geojson' | 'kml') => {
    const name = safeFileName(`${project.code ? `${project.code} ` : ''}${project.name} sites`);
    if (kind === 'geojson') downloadBlob(new Blob([sitesGeoJson(sites, project)], { type: 'application/geo+json' }), `${name}.geojson`);
    else downloadBlob(new Blob([sitesKml(sites, project)], { type: 'application/vnd.google-earth.kml+xml' }), `${name}.kml`);
  };

  const pickSite = pickSiteId ? sites.find((s) => s.id === pickSiteId) : undefined;
  const siteOptions = [
    ...sites.filter((s) => !onMap.has(s.id)).map((s) => ({ value: s.id, label: `${label(s)} · not on the map yet` })),
    ...sites.filter((s) => onMap.has(s.id)).map((s) => ({ value: s.id, label: `${label(s)} · move here` })),
  ];

  return (
    <Grid gutter="md">
      <Grid.Col span={{ base: 12, md: 8, lg: 9 }} order={{ base: 1, md: 2 }}>
        <Card withBorder radius="md" p={0} pos="relative" h={{ base: '62dvh', md: 'calc(100dvh - 230px)' }} mih={420}>
          <SiteMap ref={map} sites={located} selectedId={selectedId} pick={pick} picking={!!placing} draggable={drag} onMapClick={onMapClick} onSiteClick={(id) => setSelectedId(id)} onSiteMove={(id, lat, lng) => {
            const s = sites.find((x) => x.id === id);
            if (s) void place(s, lat, lng);
          }} />
          {placing && (
            <Paper shadow="md" radius="md" px="md" py={8} withBorder pos="absolute" top={12} left="50%" style={{ transform: 'translateX(-50%)', zIndex: 1000, maxWidth: 'calc(100% - 120px)' }}>
              <Group gap="sm" wrap="nowrap">
                <IconCurrentLocation size={18} />
                <Text size="sm">
                  Click the map where <b>{placing.code}</b> is
                </Text>
                <Button size="compact-sm" variant="default" onClick={() => setPlacingId(null)}>
                  Cancel
                </Button>
              </Group>
            </Paper>
          )}
        </Card>
      </Grid.Col>

      <Grid.Col span={{ base: 12, md: 4, lg: 3 }} order={{ base: 2, md: 1 }}>
        <Stack gap="sm">
          <Card withBorder radius="md" p="sm">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void search();
              }}
            >
              <TextInput
                aria-label="Find a place or coordinates"
                description="Place name, latitude and longitude, or NZTM"
                placeholder="Find a place or coordinates"
                value={query}
                onChange={(e) => {
                  setQuery(e.currentTarget.value);
                  if (!e.currentTarget.value) setPlaces(null);
                }}
                leftSection={<IconSearch size={16} />}
                rightSection={
                  <ActionIcon type="submit" variant="subtle" loading={searching} aria-label="Find">
                    <IconSearch size={14} />
                  </ActionIcon>
                }
              />
            </form>
            {places && places.length > 0 && (
              <Stack gap={2} mt={6}>
                {places.map((p, i) => (
                  <UnstyledButton
                    key={i}
                    className="edb-site-row"
                    p={6}
                    onClick={() => {
                      if (p.box) map.current?.fitBounds(...p.box);
                      else map.current?.flyTo(p.lat, p.lng, 15);
                      setPlaces(null);
                    }}
                  >
                    <Text size="sm" fw={500}>
                      {p.name}
                    </Text>
                    <Text size="xs" c="dimmed" lineClamp={1}>
                      {p.detail}
                    </Text>
                  </UnstyledButton>
                ))}
                <Text size="xs" c="dimmed">
                  Place search © OpenStreetMap contributors
                </Text>
              </Stack>
            )}
            {searchNote && (
              <Text size="xs" c="dimmed" mt={6}>
                {searchNote}
              </Text>
            )}
          </Card>

          {pick && !placing && (
            <Card withBorder radius="md" p="sm" style={{ borderColor: 'var(--mantine-color-orange-5)' }}>
              <Group justify="space-between" wrap="nowrap" align="flex-start">
                <div>
                  <Text size="sm" fw={600}>
                    The point you picked
                  </Text>
                  <Text size="xs" c="dimmed">
                    {nztmText(pick)} · {formatLatLng(pick)}
                  </Text>
                </div>
                <CloseButton size="sm" aria-label="Clear the point" onClick={() => setPick(null)} />
              </Group>
              {sites.length > 0 && (
                <Stack gap={6} mt="xs">
                  <Select label="Site at this point" data={siteOptions} value={pickSiteId} onChange={setPickSiteId} searchable placeholder="Choose a site" size="xs" comboboxProps={{ withinPortal: true }} />
                  <Button size="xs" leftSection={<IconMapPin size={14} />} disabled={!pickSite} onClick={() => pickSite && place(pickSite, pick.lat, pick.lng)}>
                    {pickSite ? `Put ${pickSite.code} here` : 'Put the site here'}
                  </Button>
                </Stack>
              )}
              <Button size="xs" variant="light" mt={6} fullWidth leftSection={<IconPlus size={14} />} onClick={() => setMaking(true)}>
                New site here
              </Button>
            </Card>
          )}

          <Card withBorder radius="md" p="sm">
            <Group justify="space-between" mb={4} wrap="nowrap">
              <Text size="sm" fw={600}>
                Sites
              </Text>
              <Badge variant="light" color={located.length === sites.length ? 'teal' : 'orange'}>
                {located.length} of {sites.length} on the map
              </Badge>
            </Group>
            {!sites.length ? (
              <Text size="sm" c="dimmed">
                No sites yet. Click the map and choose <i>New site here</i>, or add them in{' '}
                <Anchor component={Link} to={`/projects/${project.id}/setup`}>
                  Setup
                </Anchor>
                .
              </Text>
            ) : (
              <ScrollArea.Autosize mah={360} type="auto" offsetScrollbars>
                <Stack gap={2}>
                  {sites.map((s) => {
                    const here = onMap.has(s.id);
                    return (
                      <Group key={s.id} className={`edb-site-row${s.id === selectedId ? ' sel' : ''}`} p={6} gap="xs" wrap="nowrap" onClick={() => select(s)}>
                        <span style={{ width: 12, height: 12, borderRadius: '50%', background: siteColor(s.id), flexShrink: 0, boxShadow: '0 0 0 1px rgba(0,0,0,.3)' }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <Text size="sm" fw={600} lh={1.2} c={s.active ? undefined : 'dimmed'}>
                            {s.code}
                            {!s.active && ' (inactive)'}
                          </Text>
                          {s.name && (
                            <Text size="xs" c="dimmed" truncate>
                              {s.name}
                            </Text>
                          )}
                        </div>
                        {here ? (
                          <Tooltip label="Move: click the map where it is">
                            <ActionIcon
                              variant={placingId === s.id ? 'filled' : 'subtle'}
                              aria-label={`Move ${s.code}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedId(s.id);
                                setPlacingId(placingId === s.id ? null : s.id);
                              }}
                            >
                              <IconCurrentLocation size={16} />
                            </ActionIcon>
                          </Tooltip>
                        ) : (
                          <Button
                            size="compact-xs"
                            variant={placingId === s.id ? 'filled' : 'light'}
                            color="orange"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedId(s.id);
                              setPlacingId(placingId === s.id ? null : s.id);
                            }}
                          >
                            Place
                          </Button>
                        )}
                      </Group>
                    );
                  })}
                </Stack>
              </ScrollArea.Autosize>
            )}
          </Card>

          {selected && (
            <Card withBorder radius="md" p="sm">
              <Group justify="space-between" wrap="nowrap" align="flex-start">
                <div style={{ minWidth: 0 }}>
                  <Text size="sm" fw={600}>
                    {label(selected)}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {[selected.type, selected.role].filter(Boolean).join(' · ')}
                  </Text>
                </div>
                <CloseButton size="sm" aria-label="Close" onClick={() => setSelectedId(null)} />
              </Group>
              {onMap.has(selected.id) ? (
                <>
                  <Text size="xs" mt={6}>
                    {nztmText(selected)}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {formatLatLng(siteLatLng(selected)!)}
                  </Text>
                  <SimpleGrid cols={2} spacing={6} mt="xs">
                    <Button size="xs" variant="default" leftSection={<IconFocus2 size={14} />} onClick={() => select(selected)}>
                      Zoom to
                    </Button>
                    <Button size="xs" variant="default" color="red" leftSection={<IconMapPinOff size={14} />} onClick={() => removeLocation(selected)}>
                      Take off map
                    </Button>
                  </SimpleGrid>
                </>
              ) : (
                <Text size="xs" c="dimmed" mt={6}>
                  Not on the map yet: choose <i>Place</i> and click where it is, or type its coordinates in the search box.
                </Text>
              )}
            </Card>
          )}

          <Card withBorder radius="md" p="sm">
            <Stack gap="xs">
              <Switch size="sm" label="Drag pins to move sites" checked={drag} onChange={(e) => setDrag(e.currentTarget.checked)} />
              <Text size="xs" c="dimmed">
                Click the map to pick a point, then choose its site – or choose a site’s <i>Place</i> button and click where it is. Every change can be undone from its notice.
              </Text>
              <Group gap="xs" grow>
                <Button size="xs" variant="default" leftSection={<IconFocus2 size={14} />} onClick={() => map.current?.fitSites()}>
                  Show all
                </Button>
                <Menu position="bottom-end">
                  <Menu.Target>
                    <Button size="xs" variant="default" leftSection={<IconDownload size={14} />} disabled={!located.length}>
                      Download
                    </Button>
                  </Menu.Target>
                  <Menu.Dropdown>
                    <Menu.Item onClick={() => download('geojson')}>
                      <Text size="sm">GeoJSON</Text>
                      <Text size="xs" c="dimmed">
                        For QGIS or ArcGIS
                      </Text>
                    </Menu.Item>
                    <Menu.Item onClick={() => download('kml')}>
                      <Text size="sm">KML</Text>
                      <Text size="xs" c="dimmed">
                        For Google Earth
                      </Text>
                    </Menu.Item>
                  </Menu.Dropdown>
                </Menu>
              </Group>
            </Stack>
          </Card>
        </Stack>
      </Grid.Col>

      {making && pick && (
        <NewSiteModal
          at={pick}
          onClose={() => setMaking(false)}
          onMade={(id) => {
            setMaking(false);
            setPick(null);
            setSelectedId(id);
          }}
        />
      )}
    </Grid>
  );
}

function NewSiteModal({ at, onClose, onMade }: { at: Pick; onClose: () => void; onMade: (id: string) => void }) {
  const { project, sites } = useProject();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<Site['type']>('Surface water');
  const [role, setRole] = useState<Site['role']>('');
  const taken = sites.some((s) => s.code.trim().toLowerCase() === code.trim().toLowerCase());
  return (
    <Modal opened onClose={onClose} title="New site at this point">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!code.trim() || taken) return;
          const s = newSite(project.id, { code: code.trim(), name: name.trim() || undefined, type, role, easting: at.easting, northing: at.northing, order: Math.max(0, ...sites.map((x) => x.order)) + 1 });
          await saveSite(s);
          notifications.show({ title: `${s.code} added`, message: nztmText(s), autoClose: 5000 });
          onMade(s.id);
        }}
      >
        <Stack gap="sm">
          <Text size="xs" c="dimmed">
            {nztmText(at)} · {formatLatLng(at)}
          </Text>
          <SimpleGrid cols={{ base: 1, xs: 2 }}>
            <TextInput label="Code" required value={code} onChange={(e) => setCode(e.currentTarget.value)} placeholder="e.g. SW3" error={taken ? 'A site already has this code' : undefined} data-autofocus />
            <TextInput label="Name" value={name} onChange={(e) => setName(e.currentTarget.value)} placeholder="e.g. Stream at the bridge" />
            <Select label="Type" data={[...SITE_TYPES]} value={type} onChange={(v) => v && setType(v as Site['type'])} allowDeselect={false} />
            <Select label="Role" data={SITE_ROLES.map((r) => ({ value: r, label: r || '—' }))} value={role} onChange={(v) => setRole((v ?? '') as Site['role'])} />
          </SimpleGrid>
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!code.trim() || taken}>
              Add site
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
